package documents

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"

	"github.com/google/uuid"
	"github.com/local/pdf-web-studio/apps/api/internal/processing"
)

// An annotation document is what the overlay editor submits: a list of pages,
// each carrying the text, shapes, and images drawn on it. Coordinates are PDF
// user-space points with the origin at the bottom-left of the page, matching
// the rest of the processing package. The editor performs the single flip from
// its own top-left canvas.

const (
	MaxAnnotationObjectsPerPage = 500
	MaxAnnotationObjects        = 5000
	MaxAnnotationTextLength     = 2000
	MaxAnnotationAssets         = 20

	// annotationBleed lets an object hang off the page edge, which a canvas
	// drag naturally produces, while still rejecting nonsense coordinates.
	annotationBleed = 2000
)

var ErrAnnotationEmpty = errors.New("annotation document contains no objects")

// AnnotationError carries a reason that is safe to show the user, because it
// describes their own submitted geometry rather than anything server-side.
type AnnotationError struct{ Reason string }

func (e *AnnotationError) Error() string { return "invalid annotation: " + e.Reason }

func annotationFailure(format string, args ...any) error {
	return &AnnotationError{Reason: fmt.Sprintf(format, args...)}
}

type AnnotationText struct {
	Text          string
	X             float64
	Y             float64
	FontSize      float64
	Font          string
	Color         processing.RGB
	Opacity       float64
	Rotation      float64
	Align         string
	Bold          bool
	Italic        bool
	Underline     bool
	Strikethrough bool
}

type AnnotationShape struct {
	Kind        string
	Points      []processing.Point
	Stroke      processing.RGB
	StrokeWidth float64
	Fill        *processing.RGB
	Opacity     float64
	Rotation    float64
	Arrow       bool
}

type AnnotationImage struct {
	Asset    string
	CenterX  float64
	CenterY  float64
	Width    float64
	Height   float64
	Opacity  float64
	Rotation float64
}

type AnnotationPage struct {
	Page   int
	Texts  []AnnotationText
	Shapes []AnnotationShape
	Images []AnnotationImage
}

type AnnotationDocument struct {
	Pages []AnnotationPage
}

func (p AnnotationPage) objectCount() int {
	return len(p.Texts) + len(p.Shapes) + len(p.Images)
}

func (d AnnotationDocument) objectCount() int {
	total := 0
	for _, page := range d.Pages {
		total += page.objectCount()
	}
	return total
}

func finite(values ...float64) bool {
	for _, value := range values {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return false
		}
	}
	return true
}

func withinPage(size processing.PageSize, values ...float64) bool {
	for index, value := range values {
		limit := size.Width
		if index%2 == 1 {
			limit = size.Height
		}
		if value < -annotationBleed || value > limit+annotationBleed {
			return false
		}
	}
	return true
}

func validAlign(value string) bool {
	switch value {
	case "", "left", "center", "right":
		return true
	}
	return false
}

func validOpacity(value float64) bool {
	return finite(value) && value >= 0 && value <= 1
}

func validRotation(value float64) bool {
	return finite(value) && value >= -360 && value <= 360
}

// Annotate flattens an editor document onto the current version and saves the
// result as a new version. The original is never touched.
func (s *Service) Annotate(ctx context.Context, documentID uuid.UUID, annotations AnnotationDocument, assets map[string]processing.JPEGInput) (Document, Version, error) {
	if annotations.objectCount() == 0 {
		return Document{}, Version{}, ErrAnnotationEmpty
	}
	if annotations.objectCount() > MaxAnnotationObjects {
		return Document{}, Version{}, annotationFailure("a document may hold at most %d objects", MaxAnnotationObjects)
	}
	if len(assets) > MaxAnnotationAssets {
		return Document{}, Version{}, annotationFailure("a document may reference at most %d images", MaxAnnotationAssets)
	}
	document, parent, input, err := s.operationInput(ctx, documentID)
	if err != nil {
		return Document{}, Version{}, err
	}
	sizes, err := processing.PDFPageSizes(ctx, input, "")
	if err != nil {
		return Document{}, Version{}, err
	}
	pages, counts, err := buildAnnotationPages(annotations, sizes, assets)
	if err != nil {
		return Document{}, Version{}, err
	}
	metadata := map[string]any{
		"objects":     annotations.objectCount(),
		"pagesEdited": counts,
		"assets":      len(assets),
		"beforeBytes": parent.ByteSize,
	}
	return s.applyOverlay(ctx, document, parent, input, "annotate", metadata, pages, true)
}

func buildAnnotationPages(annotations AnnotationDocument, sizes []processing.PageSize, assets map[string]processing.JPEGInput) ([]processing.OverlayPage, int, error) {
	pages := make([]processing.OverlayPage, len(sizes))
	for index, size := range sizes {
		pages[index].PageSize = size
	}
	seen := map[int]bool{}
	for _, page := range annotations.Pages {
		if page.Page < 1 || page.Page > len(sizes) {
			return nil, 0, annotationFailure("page %d is outside the document, which has %d pages", page.Page, len(sizes))
		}
		if seen[page.Page] {
			return nil, 0, annotationFailure("page %d appears more than once", page.Page)
		}
		seen[page.Page] = true
		if page.objectCount() > MaxAnnotationObjectsPerPage {
			return nil, 0, annotationFailure("page %d holds more than %d objects", page.Page, MaxAnnotationObjectsPerPage)
		}
		size := sizes[page.Page-1]
		target := &pages[page.Page-1]
		if err := appendAnnotationTexts(target, page, size); err != nil {
			return nil, 0, err
		}
		if err := appendAnnotationShapes(target, page, size); err != nil {
			return nil, 0, err
		}
		if err := appendAnnotationImages(target, page, size, assets); err != nil {
			return nil, 0, err
		}
	}
	return pages, len(seen), nil
}

func appendAnnotationTexts(target *processing.OverlayPage, page AnnotationPage, size processing.PageSize) error {
	for index, text := range page.Texts {
		where := fmt.Sprintf("text %d on page %d", index+1, page.Page)
		if strings.TrimSpace(text.Text) == "" {
			return annotationFailure("%s is empty", where)
		}
		if len(text.Text) > MaxAnnotationTextLength {
			return annotationFailure("%s exceeds %d characters", where, MaxAnnotationTextLength)
		}
		if strings.ContainsAny(text.Text, "\n\r") {
			return annotationFailure("%s contains a line break; submit each line as its own object", where)
		}
		if !finite(text.X, text.Y) || !withinPage(size, text.X, text.Y) {
			return annotationFailure("%s sits outside the page", where)
		}
		if !finite(text.FontSize) || text.FontSize < 1 || text.FontSize > 400 {
			return annotationFailure("%s has an unusable font size", where)
		}
		if !validOpacity(text.Opacity) || !validRotation(text.Rotation) {
			return annotationFailure("%s has an invalid opacity or rotation", where)
		}
		if !validAlign(text.Align) {
			return annotationFailure("%s uses an unknown alignment %q", where, text.Align)
		}
		target.Texts = append(target.Texts, processing.TextOverlay{
			Text: text.Text, X: text.X, Y: text.Y, FontSize: text.FontSize,
			Opacity: text.Opacity, Rotation: text.Rotation, Align: text.Align,
			Color: text.Color, Font: text.Font,
			Bold: text.Bold, Italic: text.Italic,
			Underline: text.Underline, Strikethrough: text.Strikethrough,
		})
	}
	return nil
}

func appendAnnotationShapes(target *processing.OverlayPage, page AnnotationPage, size processing.PageSize) error {
	for index, shape := range page.Shapes {
		where := fmt.Sprintf("shape %d on page %d", index+1, page.Page)
		if len(shape.Points) == 0 {
			return annotationFailure("%s has no points", where)
		}
		for _, point := range shape.Points {
			if !finite(point.X, point.Y) || !withinPage(size, point.X, point.Y) {
				return annotationFailure("%s sits outside the page", where)
			}
		}
		if !finite(shape.StrokeWidth) || shape.StrokeWidth < 0 || shape.StrokeWidth > 72 {
			return annotationFailure("%s has an unusable stroke width", where)
		}
		if shape.StrokeWidth == 0 && shape.Fill == nil {
			return annotationFailure("%s would be invisible: give it a stroke or a fill", where)
		}
		if !validOpacity(shape.Opacity) || !validRotation(shape.Rotation) {
			return annotationFailure("%s has an invalid opacity or rotation", where)
		}
		// An arrow head needs a shaft to point along, and a closed outline has
		// no final segment to speak of.
		if shape.Arrow && shape.Kind != "line" && shape.Kind != "polyline" {
			return annotationFailure("%s cannot carry an arrow head", where)
		}
		target.Shapes = append(target.Shapes, processing.ShapeOverlay{
			Kind: processing.ShapeKind(shape.Kind), Points: shape.Points,
			Stroke: shape.Stroke, StrokeWidth: shape.StrokeWidth, Fill: shape.Fill,
			Opacity: shape.Opacity, Rotation: shape.Rotation, Arrow: shape.Arrow,
		})
	}
	return nil
}

func appendAnnotationImages(target *processing.OverlayPage, page AnnotationPage, size processing.PageSize, assets map[string]processing.JPEGInput) error {
	for index, image := range page.Images {
		where := fmt.Sprintf("image %d on page %d", index+1, page.Page)
		asset, ok := assets[image.Asset]
		if !ok {
			return annotationFailure("%s references the unknown asset %q", where, image.Asset)
		}
		if !finite(image.CenterX, image.CenterY) || !withinPage(size, image.CenterX, image.CenterY) {
			return annotationFailure("%s sits outside the page", where)
		}
		if !finite(image.Width, image.Height) || image.Width <= 0 || image.Height <= 0 {
			return annotationFailure("%s has a non-positive size", where)
		}
		if image.Width > size.Width+annotationBleed || image.Height > size.Height+annotationBleed {
			return annotationFailure("%s is larger than the page allows", where)
		}
		if !validOpacity(image.Opacity) || !validRotation(image.Rotation) {
			return annotationFailure("%s has an invalid opacity or rotation", where)
		}
		target.Images = append(target.Images, processing.ImageOverlay{
			Image: asset, CenterX: image.CenterX, CenterY: image.CenterY,
			Width: image.Width, Height: image.Height,
			Opacity: image.Opacity, Rotation: image.Rotation,
		})
	}
	return nil
}
