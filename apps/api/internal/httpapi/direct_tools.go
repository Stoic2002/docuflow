package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/local/pdf-web-studio/apps/api/internal/documents"
	"github.com/local/pdf-web-studio/apps/api/internal/processing"
)

const maxDirectFieldBytes = 64 * 1024

type directUpload struct {
	document documents.Document
	version  documents.Version
}

type directMultipart struct {
	files  []directUpload
	fields map[string]string
}

func (s *Server) createEditSession(w http.ResponseWriter, r *http.Request) {
	parsed, ok := s.readDirectMultipart(w, r, 1)
	if !ok {
		return
	}
	upload := parsed.files[0]
	writeJSON(w, http.StatusCreated, map[string]any{
		"session":  editSessionResponse(upload.document),
		"document": upload.document,
	})
}

func (s *Server) getEditSession(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "sessionId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_SESSION_ID", "Edit session ID is invalid", nil)
		return
	}
	document, err := s.documents.Get(r.Context(), id)
	if err != nil {
		s.writeDocumentError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"session": editSessionResponse(document), "document": document})
}

func (s *Server) exportEditSession(w http.ResponseWriter, r *http.Request) {
	if _, err := uuid.Parse(chi.URLParam(r, "sessionId")); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_SESSION_ID", "Edit session ID is invalid", nil)
		return
	}
	writeError(w, http.StatusServiceUnavailable, "PDF_EDITING_UNAVAILABLE", "Native PDF editing is unavailable; preview mode cannot export edits", map[string]any{
		"mode": "preview", "originalSafe": true,
	})
}

func editSessionResponse(document documents.Document) map[string]any {
	id := document.ID.String()
	return map[string]any{
		"id": id, "filename": document.OriginalName, "byteSize": document.ByteSize,
		"pageCount": document.PageCount, "mode": "preview",
		"previewUrl":  "/api/documents/" + id + "/content",
		"downloadUrl": "/api/documents/" + id + "/content",
	}
}

func (s *Server) mergeDirect(w http.ResponseWriter, r *http.Request) {
	if !s.requireTool(w, "qpdf") {
		return
	}
	parsed, ok := s.readDirectMultipart(w, r, 20)
	if !ok {
		return
	}
	if len(parsed.files) < 2 {
		writeError(w, http.StatusBadRequest, "MERGE_REQUIRES_MULTIPLE_FILES", "Choose at least two PDF files to merge", nil)
		return
	}
	ids := make([]uuid.UUID, len(parsed.files))
	for index, upload := range parsed.files {
		ids[index] = upload.document.ID
	}
	document, version, err := s.documents.Merge(r.Context(), ids)
	s.writeDirectToolResult(w, r, document, version, err)
}

func (s *Server) splitDirect(w http.ResponseWriter, r *http.Request) {
	if !s.requireTool(w, "qpdf") {
		return
	}
	parsed, ok := s.readDirectMultipart(w, r, 1)
	if !ok {
		return
	}
	pages, err := parseSplitPages(parsed.fields, parsed.files[0])
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_SPLIT_PAGES", "Choose one or more valid pages to split", map[string]any{"reason": err.Error()})
		return
	}
	upload := parsed.files[0]
	document, versions, splitErr := s.documents.SplitPages(r.Context(), upload.document.ID, pages)
	if splitErr != nil {
		s.writeToolResult(w, r, document, documents.Version{}, splitErr)
		return
	}
	results := make([]map[string]any, 0, len(versions))
	baseName := strings.TrimSuffix(document.OriginalName, filepath.Ext(document.OriginalName))
	for index, version := range versions {
		result := directToolResult(document, version)
		result["outputName"] = fmt.Sprintf("%s-page-%d.pdf", baseName, pages[index])
		results = append(results, result)
	}
	writeJSON(w, http.StatusCreated, map[string]any{"results": results, "savedToRecent": true})
}

func parseSplitPages(fields map[string]string, upload directUpload) ([]int, error) {
	pageCount := upload.document.PageCount
	if pageCount == nil {
		return nil, errors.New("document page count is unavailable")
	}
	rawPages := strings.TrimSpace(fields["pages"])
	if rawPages != "" {
		var pages []int
		if err := json.Unmarshal([]byte(rawPages), &pages); err != nil {
			return nil, errors.New("pages must be a JSON integer array")
		}
		if err := processing.ValidatePageOrder(pages, int(*pageCount)); err != nil {
			return nil, err
		}
		return pages, nil
	}
	return processing.ExpandPageSelection(strings.TrimSpace(fields["ranges"]), int(*pageCount))
}

func (s *Server) compressDirect(w http.ResponseWriter, r *http.Request) {
	if !s.requireTool(w, "qpdf") {
		return
	}
	parsed, ok := s.readDirectMultipart(w, r, 1)
	if !ok {
		return
	}
	mode := parsed.fields["mode"]
	if mode != "" && mode != "lossless-structural" {
		writeError(w, http.StatusBadRequest, "UNSUPPORTED_COMPRESSION_MODE", "Only lossless structural compression is available", nil)
		return
	}
	document, version, err := s.documents.Compress(r.Context(), parsed.files[0].document.ID)
	s.writeDirectToolResult(w, r, document, version, err)
}

func (s *Server) ocrDirect(w http.ResponseWriter, r *http.Request) {
	if !s.requireTool(w, "ocrmypdf") {
		return
	}
	parsed, ok := s.readDirectMultipart(w, r, 1)
	if !ok {
		return
	}
	language := parsed.fields["language"]
	if language == "" {
		language = "eng"
	}
	if language != "eng" && language != "ind" {
		writeError(w, http.StatusBadRequest, "UNSUPPORTED_OCR_LANGUAGE", "Choose English or Indonesian for OCR", nil)
		return
	}
	document, version, err := s.documents.OCR(r.Context(), parsed.files[0].document.ID, language)
	s.writeDirectToolResult(w, r, document, version, err)
}

func (s *Server) readDirectMultipart(w http.ResponseWriter, r *http.Request, maxFiles int) (directMultipart, bool) {
	reader, err := r.MultipartReader()
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_MULTIPART", "Expected a multipart PDF upload", nil)
		return directMultipart{}, false
	}
	result := directMultipart{fields: map[string]string{}}
	for {
		part, nextErr := reader.NextPart()
		if errors.Is(nextErr, io.EOF) {
			break
		}
		if nextErr != nil {
			s.writeDirectMultipartError(w, r, nextErr)
			return directMultipart{}, false
		}
		if !s.consumeDirectPart(w, r, part, maxFiles, &result) {
			_ = part.Close()
			return directMultipart{}, false
		}
		_ = part.Close()
	}
	if len(result.files) == 0 {
		writeError(w, http.StatusBadRequest, "FILE_REQUIRED", "Choose a PDF file", nil)
		return directMultipart{}, false
	}
	return result, true
}

func (s *Server) consumeDirectPart(w http.ResponseWriter, r *http.Request, part *multipart.Part, maxFiles int, result *directMultipart) bool {
	if part.FileName() != "" {
		if part.FormName() != "file" && part.FormName() != "files" && part.FormName() != "files[]" {
			writeError(w, http.StatusBadRequest, "UNEXPECTED_FILE_FIELD", "PDF files must use the file field", nil)
			return false
		}
		if len(result.files) >= maxFiles {
			writeError(w, http.StatusBadRequest, "TOO_MANY_FILES", fmt.Sprintf("Choose no more than %d PDF files", maxFiles), nil)
			return false
		}
		document, version, err := s.documents.Upload(r.Context(), part.FileName(), part.Header.Get("Content-Type"), part)
		if err != nil {
			s.writeDocumentError(w, r, err)
			return false
		}
		result.files = append(result.files, directUpload{document: document, version: version})
		return true
	}
	value, err := io.ReadAll(io.LimitReader(part, maxDirectFieldBytes+1))
	if err != nil {
		s.writeDirectMultipartError(w, r, err)
		return false
	}
	if len(value) > maxDirectFieldBytes {
		writeError(w, http.StatusBadRequest, "FORM_FIELD_TOO_LARGE", "A form field is too large", nil)
		return false
	}
	result.fields[part.FormName()] = string(value)
	return true
}

func (s *Server) writeDirectMultipartError(w http.ResponseWriter, r *http.Request, err error) {
	var maxBytesError *http.MaxBytesError
	if errors.As(err, &maxBytesError) {
		writeError(w, http.StatusRequestEntityTooLarge, "UPLOAD_TOO_LARGE", "The upload exceeds the configured limit", map[string]any{"maxBytesPerFile": s.config.MaxUploadBytes})
		return
	}
	s.writeDocumentError(w, r, err)
}

func (s *Server) writeDirectToolResult(w http.ResponseWriter, r *http.Request, document documents.Document, version documents.Version, err error) {
	if err != nil {
		s.writeToolResult(w, r, document, version, err)
		return
	}
	writeJSON(w, http.StatusCreated, directToolResult(document, version))
}

func directToolResult(document documents.Document, version documents.Version) map[string]any {
	return map[string]any{
		"document":      document,
		"version":       version,
		"downloadUrl":   fmt.Sprintf("/api/documents/%s/versions/%s/content", document.ID, version.ID),
		"beforeBytes":   version.Metadata["beforeBytes"],
		"afterBytes":    version.ByteSize,
		"savedToRecent": true,
	}
}
