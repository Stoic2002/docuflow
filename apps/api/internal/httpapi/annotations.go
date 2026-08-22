package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/local/pdf-web-studio/apps/api/internal/documents"
	"github.com/local/pdf-web-studio/apps/api/internal/processing"
)

const (
	maxAnnotationBodyBytes = 4 << 20
	maxAnnotationAssetSize = 10 << 20
)

// The wire format of one overlay editor document. Coordinates are PDF points
// with the origin at the bottom-left of the page.
type annotationRequest struct {
	Pages []annotationPageRequest `json:"pages"`
}

type annotationPageRequest struct {
	Page   int                      `json:"page"`
	Texts  []annotationTextRequest  `json:"texts"`
	Shapes []annotationShapeRequest `json:"shapes"`
	Images []annotationImageRequest `json:"images"`
}

type annotationTextRequest struct {
	Text     string   `json:"text"`
	X        float64  `json:"x"`
	Y        float64  `json:"y"`
	FontSize float64  `json:"fontSize"`
	Font     string   `json:"font"`
	Color    string   `json:"color"`
	Opacity  *float64 `json:"opacity"`
	Rotation float64  `json:"rotation"`
	Align    string   `json:"align"`
}

type annotationPointRequest struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type annotationShapeRequest struct {
	Kind        string                   `json:"kind"`
	Points      []annotationPointRequest `json:"points"`
	Stroke      string                   `json:"stroke"`
	StrokeWidth *float64                 `json:"strokeWidth"`
	Fill        *string                  `json:"fill"`
	Opacity     *float64                 `json:"opacity"`
	Rotation    float64                  `json:"rotation"`
}

type annotationImageRequest struct {
	Asset    string   `json:"asset"`
	CenterX  float64  `json:"centerX"`
	CenterY  float64  `json:"centerY"`
	Width    float64  `json:"width"`
	Height   float64  `json:"height"`
	Opacity  *float64 `json:"opacity"`
	Rotation float64  `json:"rotation"`
}

// parseHexColor accepts #rgb and #rrggbb, with or without the leading hash.
func parseHexColor(value string) (processing.RGB, error) {
	trimmed := strings.TrimPrefix(strings.TrimSpace(value), "#")
	if len(trimmed) == 3 {
		expanded := make([]byte, 0, 6)
		for index := 0; index < 3; index++ {
			expanded = append(expanded, trimmed[index], trimmed[index])
		}
		trimmed = string(expanded)
	}
	if len(trimmed) != 6 {
		return processing.RGB{}, fmt.Errorf("colour %q must be #rgb or #rrggbb", value)
	}
	components := make([]float64, 3)
	for index := 0; index < 3; index++ {
		part, err := strconv.ParseUint(trimmed[index*2:index*2+2], 16, 8)
		if err != nil {
			return processing.RGB{}, fmt.Errorf("colour %q is not valid hexadecimal", value)
		}
		components[index] = float64(part) / 255
	}
	return processing.RGB{R: components[0], G: components[1], B: components[2]}, nil
}

// colorOr returns black when the field is omitted, matching the engine default.
func colorOr(value string) (processing.RGB, error) {
	if strings.TrimSpace(value) == "" {
		return processing.RGB{}, nil
	}
	return parseHexColor(value)
}

func opacityOr(value *float64) float64 {
	if value == nil {
		return 1
	}
	return *value
}

func strokeWidthOr(value *float64) float64 {
	if value == nil {
		return 1
	}
	return *value
}

func (request annotationRequest) toDocument() (documents.AnnotationDocument, error) {
	document := documents.AnnotationDocument{Pages: make([]documents.AnnotationPage, 0, len(request.Pages))}
	for _, page := range request.Pages {
		converted := documents.AnnotationPage{Page: page.Page}
		for _, text := range page.Texts {
			color, err := colorOr(text.Color)
			if err != nil {
				return documents.AnnotationDocument{}, err
			}
			converted.Texts = append(converted.Texts, documents.AnnotationText{
				Text: text.Text, X: text.X, Y: text.Y, FontSize: text.FontSize, Font: text.Font,
				Color: color, Opacity: opacityOr(text.Opacity), Rotation: text.Rotation, Align: text.Align,
			})
		}
		for _, shape := range page.Shapes {
			stroke, err := colorOr(shape.Stroke)
			if err != nil {
				return documents.AnnotationDocument{}, err
			}
			var fill *processing.RGB
			if shape.Fill != nil {
				parsed, fillErr := parseHexColor(*shape.Fill)
				if fillErr != nil {
					return documents.AnnotationDocument{}, fillErr
				}
				fill = &parsed
			}
			points := make([]processing.Point, len(shape.Points))
			for index, point := range shape.Points {
				points[index] = processing.Point{X: point.X, Y: point.Y}
			}
			converted.Shapes = append(converted.Shapes, documents.AnnotationShape{
				Kind: shape.Kind, Points: points, Stroke: stroke, StrokeWidth: strokeWidthOr(shape.StrokeWidth),
				Fill: fill, Opacity: opacityOr(shape.Opacity), Rotation: shape.Rotation,
			})
		}
		for _, image := range page.Images {
			converted.Images = append(converted.Images, documents.AnnotationImage{
				Asset: image.Asset, CenterX: image.CenterX, CenterY: image.CenterY,
				Width: image.Width, Height: image.Height,
				Opacity: opacityOr(image.Opacity), Rotation: image.Rotation,
			})
		}
		document.Pages = append(document.Pages, converted)
	}
	return document, nil
}

// exportEditSession flattens the editor's overlay document onto the session's
// PDF and stores the result as a new version. The original stays immutable.
func (s *Server) exportEditSession(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "sessionId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_SESSION_ID", "Edit session ID is invalid", nil)
		return
	}
	if !s.requireTool(w, "qpdf") || !s.requireTool(w, "pdfinfo") {
		return
	}
	request, assets, cleanup, ok := s.readAnnotationRequest(w, r)
	defer cleanup()
	if !ok {
		return
	}
	annotations, err := request.toDocument()
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "ANNOTATION_INVALID", err.Error(), nil)
		return
	}
	document, version, err := s.documents.Annotate(r.Context(), id, annotations, assets)
	s.writeDirectToolResult(w, r, document, version, err)
}

// readAnnotationRequest accepts either a plain JSON body or a multipart form
// whose "document" field holds the JSON and whose file parts are the images it
// references by asset name.
func (s *Server) readAnnotationRequest(w http.ResponseWriter, r *http.Request) (annotationRequest, map[string]processing.JPEGInput, func(), bool) {
	assets := map[string]processing.JPEGInput{}
	paths := []string{}
	cleanup := func() {
		for _, path := range paths {
			_ = os.Remove(path)
		}
	}
	if !isMultipart(r) {
		request, ok := decodeAnnotationJSON(w, io.LimitReader(r.Body, maxAnnotationBodyBytes+1))
		return request, assets, cleanup, ok
	}
	reader, err := r.MultipartReader()
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_MULTIPART", "Expected an annotation form", nil)
		return annotationRequest{}, nil, cleanup, false
	}
	var request annotationRequest
	seenDocument := false
	for {
		part, nextErr := reader.NextPart()
		if errors.Is(nextErr, io.EOF) {
			break
		}
		if nextErr != nil {
			writeError(w, http.StatusBadRequest, "INVALID_MULTIPART", "The annotation form is invalid", nil)
			return annotationRequest{}, nil, cleanup, false
		}
		if part.FileName() == "" {
			if part.FormName() != "document" {
				_ = part.Close()
				writeError(w, http.StatusBadRequest, "UNEXPECTED_FIELD", "Only a document field is accepted", nil)
				return annotationRequest{}, nil, cleanup, false
			}
			decoded, ok := decodeAnnotationJSON(w, io.LimitReader(part, maxAnnotationBodyBytes+1))
			_ = part.Close()
			if !ok {
				return annotationRequest{}, nil, cleanup, false
			}
			request, seenDocument = decoded, true
			continue
		}
		name := part.FormName()
		if name == "" || name == "document" || len(assets) >= documents.MaxAnnotationAssets {
			_ = part.Close()
			writeError(w, http.StatusBadRequest, "INVALID_ASSET", "Each image part must use its asset name as the field name", nil)
			return annotationRequest{}, nil, cleanup, false
		}
		if _, clash := assets[name]; clash {
			_ = part.Close()
			writeError(w, http.StatusBadRequest, "INVALID_ASSET", fmt.Sprintf("Asset %q was uploaded more than once", name), nil)
			return annotationRequest{}, nil, cleanup, false
		}
		temporary, tempErr := s.storage.CreateTemp("annotation-*.jpg")
		if tempErr != nil {
			_ = part.Close()
			s.writeDocumentError(w, r, tempErr)
			return annotationRequest{}, nil, cleanup, false
		}
		path := temporary.Name()
		paths = append(paths, path)
		size, copyErr := io.Copy(temporary, io.LimitReader(part, maxAnnotationAssetSize+1))
		_ = temporary.Close()
		_ = part.Close()
		if copyErr != nil || size > maxAnnotationAssetSize {
			writeError(w, http.StatusUnprocessableEntity, "INVALID_ASSET", "An annotation image is invalid or too large", nil)
			return annotationRequest{}, nil, cleanup, false
		}
		image, inspectErr := processing.InspectJPEG(path, part.FileName(), size)
		if inspectErr != nil {
			writeError(w, http.StatusUnprocessableEntity, "INVALID_ASSET", "Annotation images must be valid JPEG files", nil)
			return annotationRequest{}, nil, cleanup, false
		}
		assets[name] = image
	}
	if !seenDocument {
		writeError(w, http.StatusBadRequest, "ANNOTATION_REQUIRED", "The form must include a document field", nil)
		return annotationRequest{}, nil, cleanup, false
	}
	return request, assets, cleanup, true
}

func decodeAnnotationJSON(w http.ResponseWriter, source io.Reader) (annotationRequest, bool) {
	decoder := json.NewDecoder(source)
	decoder.DisallowUnknownFields()
	var request annotationRequest
	if err := decoder.Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", "The annotation document is not valid JSON", nil)
		return annotationRequest{}, false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", "The annotation document must be one JSON object", nil)
		return annotationRequest{}, false
	}
	return request, true
}
