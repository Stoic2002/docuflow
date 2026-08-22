package httpapi

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"os"
	"strconv"

	"github.com/google/uuid"
	"github.com/local/pdf-web-studio/apps/api/internal/documents"
	"github.com/local/pdf-web-studio/apps/api/internal/processing"
)

type toolRequest struct {
	DocumentID        string                     `json:"documentId"`
	DocumentIDs       []string                   `json:"documentIds"`
	Ranges            string                     `json:"ranges"`
	Pages             []int                      `json:"pages"`
	PageOrder         []int                      `json:"pageOrder"`
	Degrees           int                        `json:"degrees"`
	Language          string                     `json:"language"`
	SourceDocumentID  string                     `json:"sourceDocumentId"`
	Position          string                     `json:"position"`
	Page              int                        `json:"page"`
	PageSize          string                     `json:"pageSize"`
	Orientation       string                     `json:"orientation"`
	Password          string                     `json:"password"`
	ConfirmPassword   string                     `json:"confirmPassword"`
	Printing          bool                       `json:"printing"`
	Copying           bool                       `json:"copying"`
	Modification      bool                       `json:"modification"`
	Annotation        bool                       `json:"annotation"`
	FormFilling       bool                       `json:"formFilling"`
	Assembly          bool                       `json:"assembly"`
	WatermarkType     string                     `json:"watermarkType"`
	Text              string                     `json:"text"`
	FontSize          float64                    `json:"fontSize"`
	Opacity           float64                    `json:"opacity"`
	Rotation          float64                    `json:"rotation"`
	Horizontal        string                     `json:"horizontal"`
	Vertical          string                     `json:"vertical"`
	PageRange         string                     `json:"pageRange"`
	Foreground        bool                       `json:"foreground"`
	Scale             float64                    `json:"scale"`
	StartNumber       int                        `json:"startNumber"`
	Margin            float64                    `json:"margin"`
	Prefix            string                     `json:"prefix"`
	Suffix            string                     `json:"suffix"`
	IncludeTotal      bool                       `json:"includeTotal"`
	SkipFirst         bool                       `json:"skipFirst"`
	Header            documents.HeaderFooterBand `json:"header"`
	Footer            documents.HeaderFooterBand `json:"footer"`
	ConfirmSignatures bool                       `json:"confirmSignatures"`
}

func (s *Server) mergeDocuments(w http.ResponseWriter, r *http.Request) {
	if isMultipart(r) {
		s.mergeDirect(w, r)
		return
	}
	if !s.requireTool(w, "qpdf") {
		return
	}
	request, ok := decodeToolRequest(w, r)
	if !ok {
		return
	}
	ids := make([]uuid.UUID, 0, len(request.DocumentIDs))
	for _, rawID := range request.DocumentIDs {
		id, err := uuid.Parse(rawID)
		if err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_DOCUMENT_ID", "A document ID is invalid", nil)
			return
		}
		ids = append(ids, id)
	}
	document, version, err := s.documents.Merge(r.Context(), ids)
	s.writeToolResult(w, r, document, version, err)
}

func (s *Server) splitDocument(w http.ResponseWriter, r *http.Request) {
	if isMultipart(r) {
		s.splitDirect(w, r)
		return
	}
	s.extractPages(w, r, "split")
}

func (s *Server) extractDocument(w http.ResponseWriter, r *http.Request) {
	s.extractPages(w, r, "extract")
}

func (s *Server) extractPages(w http.ResponseWriter, r *http.Request, operation string) {
	if !s.requireTool(w, "qpdf") {
		return
	}
	request, id, ok := parseSingleDocumentRequest(w, r)
	if !ok {
		return
	}
	if operation == "extract" {
		document, version, err := s.documents.ExtractAsDocument(r.Context(), id, request.Ranges)
		s.writeToolResult(w, r, document, version, err)
		return
	}
	document, version, err := s.documents.Extract(r.Context(), id, request.Ranges, operation)
	s.writeToolResult(w, r, document, version, err)
}

func (s *Server) duplicateDocumentPages(w http.ResponseWriter, r *http.Request) {
	if !s.requireTool(w, "qpdf") {
		return
	}
	request, id, ok := parseSingleDocumentRequest(w, r)
	if !ok {
		return
	}
	document, version, err := s.documents.DuplicatePages(r.Context(), id, request.Pages)
	s.writeToolResult(w, r, document, version, err)
}

func (s *Server) insertDocumentPages(w http.ResponseWriter, r *http.Request) {
	if !s.requireTool(w, "qpdf") {
		return
	}
	request, id, ok := parseSingleDocumentRequest(w, r)
	if !ok {
		return
	}
	sourceID, err := uuid.Parse(request.SourceDocumentID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_DOCUMENT_ID", "Source document ID is invalid", nil)
		return
	}
	document, version, err := s.documents.InsertPages(r.Context(), id, sourceID, documents.InsertOptions{Position: request.Position, Page: request.Page})
	s.writeToolResult(w, r, document, version, err)
}

func (s *Server) insertBlankPage(w http.ResponseWriter, r *http.Request) {
	if !s.requireTool(w, "qpdf") {
		return
	}
	request, id, ok := parseSingleDocumentRequest(w, r)
	if !ok {
		return
	}
	document, version, err := s.documents.InsertBlankPage(r.Context(), id, documents.InsertOptions{Position: request.Position, Page: request.Page}, request.PageSize, request.Orientation)
	s.writeToolResult(w, r, document, version, err)
}

func (s *Server) protectDocument(w http.ResponseWriter, r *http.Request) {
	if !s.requireTool(w, "qpdf") {
		return
	}
	request, id, ok := parseSingleDocumentRequest(w, r)
	if !ok {
		return
	}
	if request.Password == "" || request.Password != request.ConfirmPassword {
		writeError(w, http.StatusUnprocessableEntity, "PASSWORD_VALIDATION_FAILED", "Passwords must match and cannot be empty", nil)
		return
	}
	document, version, err := s.documents.Protect(r.Context(), id, documents.ProtectionOptions{Password: request.Password, Printing: request.Printing, Copying: request.Copying, Modification: request.Modification, Annotation: request.Annotation, FormFilling: request.FormFilling, Assembly: request.Assembly})
	s.writeToolResult(w, r, document, version, err)
}

func (s *Server) unlockDocument(w http.ResponseWriter, r *http.Request) {
	if !s.requireTool(w, "qpdf") {
		return
	}
	request, id, ok := parseSingleDocumentRequest(w, r)
	if !ok {
		return
	}
	document, version, err := s.documents.Unlock(r.Context(), id, request.Password)
	s.writeToolResult(w, r, document, version, err)
}

func watermarkOptions(request toolRequest) documents.WatermarkOptions {
	return documents.WatermarkOptions{Text: request.Text, FontSize: request.FontSize, Opacity: request.Opacity, Rotation: request.Rotation, Horizontal: request.Horizontal, Vertical: request.Vertical, PageRange: request.PageRange, Foreground: request.Foreground, Scale: request.Scale}
}

func (s *Server) watermarkDocument(w http.ResponseWriter, r *http.Request) {
	if !s.requireTool(w, "qpdf") || !s.requireTool(w, "pdfinfo") {
		return
	}
	if isMultipart(r) {
		s.watermarkImage(w, r)
		return
	}
	request, id, ok := parseSingleDocumentRequest(w, r)
	if !ok {
		return
	}
	if request.WatermarkType != "text" {
		writeError(w, http.StatusUnprocessableEntity, "INVALID_WATERMARK_IMAGE", "Image watermarks require a multipart JPEG upload", nil)
		return
	}
	document, version, err := s.documents.WatermarkText(r.Context(), id, watermarkOptions(request))
	s.writeToolResult(w, r, document, version, err)
}

func (s *Server) watermarkImage(w http.ResponseWriter, r *http.Request) {
	reader, err := r.MultipartReader()
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_MULTIPART", "Expected image watermark form data", nil)
		return
	}
	fields := map[string]string{}
	var image processing.JPEGInput
	var imagePath string
	defer func() {
		if imagePath != "" {
			_ = os.Remove(imagePath)
		}
	}()
	for {
		part, nextErr := reader.NextPart()
		if errors.Is(nextErr, io.EOF) {
			break
		}
		if nextErr != nil {
			writeError(w, http.StatusBadRequest, "INVALID_MULTIPART", "Watermark upload is invalid", nil)
			return
		}
		if part.FileName() == "" {
			value, readErr := io.ReadAll(io.LimitReader(part, 4097))
			_ = part.Close()
			if readErr != nil || len(value) > 4096 {
				writeError(w, http.StatusBadRequest, "INVALID_MULTIPART", "A watermark field is invalid", nil)
				return
			}
			fields[part.FormName()] = string(value)
			continue
		}
		if part.FormName() != "image" || imagePath != "" {
			_ = part.Close()
			writeError(w, http.StatusBadRequest, "INVALID_WATERMARK_IMAGE", "Upload exactly one JPEG watermark image", nil)
			return
		}
		temporary, tempErr := s.storage.CreateTemp("watermark-*.jpg")
		if tempErr != nil {
			_ = part.Close()
			s.writeDocumentError(w, r, tempErr)
			return
		}
		imagePath = temporary.Name()
		size, copyErr := io.Copy(temporary, io.LimitReader(part, 10*1024*1024+1))
		_ = temporary.Close()
		_ = part.Close()
		if copyErr != nil || size > 10*1024*1024 {
			writeError(w, http.StatusUnprocessableEntity, "INVALID_WATERMARK_IMAGE", "The watermark image is invalid or too large", nil)
			return
		}
		image, err = processing.InspectJPEG(imagePath, part.FileName(), size)
		if err != nil {
			writeError(w, http.StatusUnprocessableEntity, "INVALID_WATERMARK_IMAGE", "The watermark image must be a valid JPEG", nil)
			return
		}
	}
	id, err := uuid.Parse(fields["documentId"])
	if err != nil || imagePath == "" {
		writeError(w, http.StatusBadRequest, "INVALID_WATERMARK_IMAGE", "Document and JPEG image are required", nil)
		return
	}
	parseFloat := func(name string, fallback float64) float64 {
		value, parseErr := strconv.ParseFloat(fields[name], 64)
		if parseErr != nil {
			return fallback
		}
		return value
	}
	options := documents.WatermarkOptions{Opacity: parseFloat("opacity", .25), Rotation: parseFloat("rotation", 0), Horizontal: fields["horizontal"], Vertical: fields["vertical"], PageRange: fields["pageRange"], Foreground: fields["foreground"] == "true", Scale: parseFloat("scale", .25)}
	ctx := documents.WithSignatureConfirmation(r.Context(), fields["confirmSignatures"] == "true")
	document, version, err := s.documents.WatermarkImage(ctx, id, image, options)
	s.writeToolResult(w, r, document, version, err)
}

func (s *Server) addPageNumbers(w http.ResponseWriter, r *http.Request) {
	if !s.requireTool(w, "qpdf") || !s.requireTool(w, "pdfinfo") {
		return
	}
	request, id, ok := parseSingleDocumentRequest(w, r)
	if !ok {
		return
	}
	document, version, err := s.documents.AddPageNumbers(r.Context(), id, documents.PageNumberOptions{Position: request.Position, StartNumber: request.StartNumber, PageRange: request.PageRange, FontSize: request.FontSize, Margin: request.Margin, Prefix: request.Prefix, Suffix: request.Suffix, IncludeTotal: request.IncludeTotal, SkipFirst: request.SkipFirst})
	s.writeToolResult(w, r, document, version, err)
}

func (s *Server) addHeaderFooter(w http.ResponseWriter, r *http.Request) {
	if !s.requireTool(w, "qpdf") || !s.requireTool(w, "pdfinfo") {
		return
	}
	request, id, ok := parseSingleDocumentRequest(w, r)
	if !ok {
		return
	}
	document, version, err := s.documents.AddHeaderFooter(r.Context(), id, documents.HeaderFooterOptions{Header: request.Header, Footer: request.Footer, FontSize: request.FontSize, Margin: request.Margin, PageRange: request.PageRange, SkipFirst: request.SkipFirst})
	s.writeToolResult(w, r, document, version, err)
}

func (s *Server) rotateDocument(w http.ResponseWriter, r *http.Request) {
	if !s.requireTool(w, "qpdf") {
		return
	}
	request, id, ok := parseSingleDocumentRequest(w, r)
	if !ok {
		return
	}
	document, version, err := s.documents.Rotate(r.Context(), id, request.Pages, request.Degrees)
	s.writeToolResult(w, r, document, version, err)
}

func (s *Server) reorderDocument(w http.ResponseWriter, r *http.Request) {
	if !s.requireTool(w, "qpdf") {
		return
	}
	request, id, ok := parseSingleDocumentRequest(w, r)
	if !ok {
		return
	}
	document, version, err := s.documents.Reorder(r.Context(), id, request.PageOrder)
	s.writeToolResult(w, r, document, version, err)
}

func (s *Server) deleteDocumentPages(w http.ResponseWriter, r *http.Request) {
	if !s.requireTool(w, "qpdf") {
		return
	}
	request, id, ok := parseSingleDocumentRequest(w, r)
	if !ok {
		return
	}
	document, version, err := s.documents.DeletePages(r.Context(), id, request.Pages)
	s.writeToolResult(w, r, document, version, err)
}

func (s *Server) compressDocument(w http.ResponseWriter, r *http.Request) {
	if isMultipart(r) {
		s.compressDirect(w, r)
		return
	}
	if !s.requireTool(w, "qpdf") {
		return
	}
	_, id, ok := parseSingleDocumentRequest(w, r)
	if !ok {
		return
	}
	document, version, err := s.documents.Compress(r.Context(), id)
	s.writeToolResult(w, r, document, version, err)
}

func (s *Server) ocrDocument(w http.ResponseWriter, r *http.Request) {
	if isMultipart(r) {
		s.ocrDirect(w, r)
		return
	}
	if !s.requireTool(w, "ocrmypdf") {
		return
	}
	request, id, ok := parseSingleDocumentRequest(w, r)
	if !ok {
		return
	}
	document, version, err := s.documents.OCR(r.Context(), id, request.Language)
	s.writeToolResult(w, r, document, version, err)
}

func isMultipart(r *http.Request) bool {
	mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	return err == nil && mediaType == "multipart/form-data"
}

func (s *Server) requireTool(w http.ResponseWriter, tool string) bool {
	capabilities := s.detector.Detect()
	available := capabilities.QPDF.Available
	reason := capabilities.QPDF.Reason
	if tool == "ocrmypdf" {
		available = capabilities.OCRmyPDF.Available
		reason = capabilities.OCRmyPDF.Reason
	}
	if tool == "pdfinfo" {
		available = capabilities.PDFInfo.Available
		reason = capabilities.PDFInfo.Reason
	}
	if tool == "pdftoppm" {
		available = capabilities.PDFToPPM.Available
		reason = capabilities.PDFToPPM.Reason
	}
	if !available {
		writeError(w, http.StatusServiceUnavailable, processing.CodeToolUnavailable, tool+" is unavailable", map[string]any{"reason": reason})
		return false
	}
	return true
}

func parseSingleDocumentRequest(w http.ResponseWriter, r *http.Request) (toolRequest, uuid.UUID, bool) {
	request, ok := decodeToolRequest(w, r)
	if !ok {
		return toolRequest{}, uuid.Nil, false
	}
	id, err := uuid.Parse(request.DocumentID)
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_DOCUMENT_ID", "Document ID is invalid", nil)
		return toolRequest{}, uuid.Nil, false
	}
	*r = *r.WithContext(documents.WithSignatureConfirmation(r.Context(), request.ConfirmSignatures))
	return request, id, true
}

func decodeToolRequest(w http.ResponseWriter, r *http.Request) (toolRequest, bool) {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var request toolRequest
	if err := decoder.Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", "Request body is invalid", nil)
		return toolRequest{}, false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", "Request body must contain one JSON object", nil)
		return toolRequest{}, false
	}
	return request, true
}

func (s *Server) writeToolResult(w http.ResponseWriter, r *http.Request, document documents.Document, version documents.Version, err error) {
	if err == nil {
		writeJSON(w, http.StatusCreated, map[string]any{"document": document, "version": version})
		return
	}
	switch {
	case errors.Is(err, documents.ErrInvalidPassword):
		writeError(w, http.StatusUnprocessableEntity, "INVALID_PASSWORD", "The PDF password is incorrect", nil)
	case errors.Is(err, documents.ErrPDFNotEncrypted):
		writeError(w, http.StatusConflict, "PDF_NOT_ENCRYPTED", "This PDF is not encrypted", nil)
	case errors.Is(err, documents.ErrInvalidWatermarkImage):
		writeError(w, http.StatusUnprocessableEntity, "INVALID_WATERMARK_IMAGE", "The watermark image is invalid", nil)
	case errors.Is(err, documents.ErrSignatureConfirmation):
		writeError(w, http.StatusConflict, "SIGNATURE_CONFIRMATION_REQUIRED", "This document contains digital signatures. Confirm that modification may invalidate them before continuing", nil)
	case errors.Is(err, documents.ErrInvalidOperation):
		writeError(w, http.StatusUnprocessableEntity, "INVALID_PDF_OPERATION", "The PDF operation parameters are invalid", nil)
	case errors.Is(err, documents.ErrCompressionNotSmaller):
		writeError(w, http.StatusConflict, "COMPRESSION_NOT_SMALLER", "Structural optimization did not reduce the file size; no version was saved", nil)
	case errors.Is(err, documents.ErrNotFound):
		writeError(w, http.StatusNotFound, "DOCUMENT_NOT_FOUND", "Document was not found", nil)
	default:
		var toolError *processing.ToolError
		if errors.As(err, &toolError) {
			status := http.StatusUnprocessableEntity
			message := "The PDF tool could not process this document"
			if toolError.Code == processing.CodeToolUnavailable {
				status = http.StatusServiceUnavailable
				message = toolError.Tool + " is unavailable"
			} else if toolError.Code == processing.CodeToolTimeout {
				status = http.StatusGatewayTimeout
				message = "The PDF operation timed out; original is safe"
			}
			slog.ErrorContext(r.Context(), "PDF tool failed", "tool", toolError.Tool, "code", toolError.Code, "error", toolError.Err, "output", toolError.Output)
			writeError(w, status, toolError.Code, message, nil)
			return
		}
		slog.ErrorContext(r.Context(), "PDF processing failed", "error", err)
		writeError(w, http.StatusInternalServerError, "PDF_PROCESSING_FAILED", "The PDF operation failed; original is safe", nil)
	}
}
