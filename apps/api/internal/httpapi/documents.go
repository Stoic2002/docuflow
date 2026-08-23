package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/local/pdf-web-studio/apps/api/internal/documents"
	"github.com/local/pdf-web-studio/apps/api/internal/processing"
)

var errMultipleMultipartParts = errors.New("only one multipart file is allowed")

func (s *Server) listDocuments(w http.ResponseWriter, r *http.Request) {
	values, err := s.documents.List(r.Context())
	if err != nil {
		s.writeDocumentError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"documents": values})
}

func (s *Server) listTrash(w http.ResponseWriter, r *http.Request) {
	values, err := s.documents.ListTrash(r.Context())
	if err != nil {
		s.writeDocumentError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"documents": values})
}

func (s *Server) uploadDocument(w http.ResponseWriter, r *http.Request) {
	reader, err := r.MultipartReader()
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_MULTIPART", "Expected a multipart PDF upload", nil)
		return
	}
	part, err := reader.NextPart()
	if err != nil {
		writeError(w, http.StatusBadRequest, "FILE_REQUIRED", "A PDF file is required", nil)
		return
	}
	defer part.Close()
	if part.FormName() != "file" || part.FileName() == "" {
		writeError(w, http.StatusBadRequest, "FILE_REQUIRED", "The first multipart part must be the PDF file", nil)
		return
	}
	singleFile := &singleMultipartFile{source: part, reader: reader}
	document, _, err := s.documents.Upload(r.Context(), part.FileName(), part.Header.Get("Content-Type"), singleFile)
	if err != nil {
		s.writeDocumentError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"document": document})
}

func (s *Server) getDocument(w http.ResponseWriter, r *http.Request) {
	id, ok := documentID(w, r)
	if !ok {
		return
	}
	document, err := s.documents.Get(r.Context(), id)
	if err != nil {
		s.writeDocumentError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"document": document})
}

func (s *Server) renameDocument(w http.ResponseWriter, r *http.Request) {
	id, ok := documentID(w, r)
	if !ok {
		return
	}
	var request struct {
		Name string `json:"name"`
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", "Request body is invalid", nil)
		return
	}
	document, err := s.documents.Rename(r.Context(), id, request.Name)
	if err != nil {
		s.writeDocumentError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"document": document})
}

func (s *Server) getDocumentMetadata(w http.ResponseWriter, r *http.Request) {
	if !s.requireTool(w, "qpdf") {
		return
	}
	id, ok := documentID(w, r)
	if !ok {
		return
	}
	document, err := s.documents.Get(r.Context(), id)
	if err != nil {
		s.writeDocumentError(w, r, err)
		return
	}
	metadata, err := s.documents.Metadata(r.Context(), id)
	if err != nil {
		s.writeDocumentError(w, r, err)
		return
	}
	signed, err := s.documents.HasSignatures(r.Context(), id)
	if err != nil {
		s.writeDocumentError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"metadata": metadata, "information": map[string]any{"pageCount": document.PageCount, "fileSize": document.ByteSize, "createdAt": document.CreatedAt, "modifiedAt": document.UpdatedAt, "signed": signed}})
}

func (s *Server) updateDocumentMetadata(w http.ResponseWriter, r *http.Request) {
	if !s.requireTool(w, "qpdf") {
		return
	}
	id, ok := documentID(w, r)
	if !ok {
		return
	}
	var request processing.PDFMetadata
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", "Metadata request is invalid", nil)
		return
	}
	ctx := documents.WithSignatureConfirmation(r.Context(), r.Header.Get("X-Confirm-Signature-Invalidation") == "true")
	document, version, err := s.documents.UpdateMetadata(ctx, id, request)
	s.writeToolResult(w, r, document, version, err)
}

func (s *Server) getPageThumbnail(w http.ResponseWriter, r *http.Request) {
	if !s.requireTool(w, "pdftoppm") {
		return
	}
	id, ok := documentID(w, r)
	if !ok {
		return
	}
	page, err := strconv.Atoi(chi.URLParam(r, "page"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_PAGE_SELECTION", "Page number is invalid", nil)
		return
	}
	file, err := s.documents.RenderThumbnail(r.Context(), id, page)
	if err != nil {
		s.writeDocumentError(w, r, err)
		return
	}
	name := file.Name()
	defer func() { _ = file.Close(); _ = os.Remove(name) }()
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	_, _ = io.Copy(w, file)
}

func (s *Server) deleteDocument(w http.ResponseWriter, r *http.Request) {
	id, ok := documentID(w, r)
	if !ok {
		return
	}
	if err := s.documents.Delete(r.Context(), id); err != nil {
		s.writeDocumentError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) restoreDocument(w http.ResponseWriter, r *http.Request) {
	id, ok := documentID(w, r)
	if !ok {
		return
	}
	if err := s.documents.Restore(r.Context(), id); err != nil {
		s.writeDocumentError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) permanentlyDeleteDocument(w http.ResponseWriter, r *http.Request) {
	id, ok := documentID(w, r)
	if !ok {
		return
	}
	if err := s.documents.PermanentDelete(r.Context(), id); err != nil {
		s.writeDocumentError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type bulkDocumentsRequest struct {
	DocumentIDs []string `json:"documentIds"`
}

func (s *Server) bulkDeleteDocuments(w http.ResponseWriter, r *http.Request) {
	ids, ok := decodeBulkDocuments(w, r)
	if !ok {
		return
	}
	result, err := s.documents.DeleteMany(r.Context(), ids)
	s.writeBulkResult(w, r, result, err)
}

func (s *Server) bulkPermanentlyDeleteDocuments(w http.ResponseWriter, r *http.Request) {
	ids, ok := decodeBulkDocuments(w, r)
	if !ok {
		return
	}
	result, err := s.documents.PermanentDeleteMany(r.Context(), ids)
	s.writeBulkResult(w, r, result, err)
}

func decodeBulkDocuments(w http.ResponseWriter, r *http.Request) ([]uuid.UUID, bool) {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	var request bulkDocumentsRequest
	if err := decoder.Decode(&request); err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", "Request body is invalid", nil)
		return nil, false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeError(w, http.StatusBadRequest, "INVALID_JSON", "Request body must contain one JSON object", nil)
		return nil, false
	}
	ids := make([]uuid.UUID, 0, len(request.DocumentIDs))
	for _, value := range request.DocumentIDs {
		id, err := uuid.Parse(value)
		if err != nil {
			writeError(w, http.StatusBadRequest, "INVALID_DOCUMENT_ID", "Document ID is invalid", map[string]any{"documentId": value})
			return nil, false
		}
		ids = append(ids, id)
	}
	return ids, true
}

// writeBulkResult always reports per document. A bulk delete that skips one
// already-missing row still removed the rest, and the client has to be able to
// say which is which.
func (s *Server) writeBulkResult(w http.ResponseWriter, r *http.Request, result documents.BulkResult, err error) {
	switch {
	case errors.Is(err, documents.ErrNoDocumentsSelected):
		writeError(w, http.StatusBadRequest, "NO_DOCUMENTS_SELECTED", "Select at least one document", nil)
		return
	case errors.Is(err, documents.ErrTooManyDocuments):
		writeError(w, http.StatusUnprocessableEntity, "TOO_MANY_DOCUMENTS", "Select fewer documents and try again", map[string]any{"maxDocuments": documents.MaxBulkDocuments})
		return
	case err != nil:
		s.writeDocumentError(w, r, err)
		return
	}
	failed := make([]map[string]any, 0, len(result.Failures))
	for _, failure := range result.Failures {
		code, message := bulkFailureCode(failure.Reason)
		if code == "DOCUMENT_OPERATION_FAILED" {
			slog.ErrorContext(r.Context(), "bulk document operation failed", "documentId", failure.DocumentID, "error", failure.Reason)
		}
		failed = append(failed, map[string]any{"documentId": failure.DocumentID, "code": code, "message": message})
	}
	writeJSON(w, http.StatusOK, map[string]any{"deleted": result.Deleted, "failed": failed})
}

func bulkFailureCode(err error) (string, string) {
	if errors.Is(err, documents.ErrNotFound) {
		return "DOCUMENT_NOT_FOUND", "Document or version was not found"
	}
	return "DOCUMENT_OPERATION_FAILED", "The document request could not be completed"
}

func (s *Server) getDocumentContent(w http.ResponseWriter, r *http.Request) {
	id, ok := documentID(w, r)
	if !ok {
		return
	}
	document, file, err := s.documents.OpenOriginal(r.Context(), id)
	if err != nil {
		s.writeDocumentError(w, r, err)
		return
	}
	defer file.Close()
	s.servePDF(w, r, file, document.OriginalName, document.CreatedAt)
}

func (s *Server) listDocumentVersions(w http.ResponseWriter, r *http.Request) {
	id, ok := documentID(w, r)
	if !ok {
		return
	}
	versions, err := s.documents.Versions(r.Context(), id)
	if err != nil {
		s.writeDocumentError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"versions": versions})
}

func (s *Server) getDocumentVersionContent(w http.ResponseWriter, r *http.Request) {
	documentID, ok := documentID(w, r)
	if !ok {
		return
	}
	versionID, err := uuid.Parse(chi.URLParam(r, "versionId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_VERSION_ID", "Version ID is invalid", nil)
		return
	}
	version, file, err := s.documents.OpenVersion(r.Context(), documentID, versionID)
	if err != nil {
		s.writeDocumentError(w, r, err)
		return
	}
	defer file.Close()
	s.servePDF(w, r, file, fmt.Sprintf("version-%s.pdf", version.ID), version.CreatedAt)
}

func (s *Server) servePDF(w http.ResponseWriter, r *http.Request, file multipart.File, filename string, modified time.Time) {
	seeker, ok := file.(io.ReadSeeker)
	if !ok {
		writeError(w, http.StatusInternalServerError, "STORAGE_READ_ERROR", "The stored PDF could not be opened", nil)
		return
	}
	disposition := mime.FormatMediaType("inline", map[string]string{"filename": filename})
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Content-Disposition", disposition)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-transform")
	http.ServeContent(w, r, filename, modified, seeker)
}

func documentID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(chi.URLParam(r, "documentId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "INVALID_DOCUMENT_ID", "Document ID is invalid", nil)
		return uuid.Nil, false
	}
	return id, true
}

func (s *Server) writeDocumentError(w http.ResponseWriter, r *http.Request, err error) {
	if errors.Is(err, context.Canceled) {
		return
	}
	switch {
	case errors.Is(err, documents.ErrInvalidPDF):
		writeError(w, http.StatusUnprocessableEntity, "INVALID_PDF", "Upload must be a valid PDF with a .pdf extension", nil)
	case errors.Is(err, documents.ErrTooLarge), errors.Is(err, errMultipleMultipartParts):
		if errors.Is(err, errMultipleMultipartParts) {
			writeError(w, http.StatusBadRequest, "TOO_MANY_FILES", "Upload exactly one PDF file", nil)
			return
		}
		writeError(w, http.StatusRequestEntityTooLarge, "UPLOAD_TOO_LARGE", "The PDF exceeds the configured upload limit", map[string]any{"maxBytes": s.config.MaxUploadBytes})
	case errors.Is(err, documents.ErrNotFound):
		writeError(w, http.StatusNotFound, "DOCUMENT_NOT_FOUND", "Document or version was not found", nil)
	case errors.Is(err, documents.ErrInvalidFilename):
		writeError(w, http.StatusUnprocessableEntity, "INVALID_FILENAME", "Use a valid PDF display name without path separators", nil)
	default:
		slog.ErrorContext(r.Context(), "document request failed", "error", err)
		writeError(w, http.StatusInternalServerError, "DOCUMENT_OPERATION_FAILED", "The document request could not be completed", nil)
	}
}

type singleMultipartFile struct {
	source io.Reader
	reader *multipart.Reader
	done   bool
}

func (r *singleMultipartFile) Read(buffer []byte) (int, error) {
	count, err := r.source.Read(buffer)
	if !errors.Is(err, io.EOF) || r.done {
		return count, err
	}
	r.done = true
	next, nextErr := r.reader.NextPart()
	if nextErr == nil {
		_ = next.Close()
		return count, errMultipleMultipartParts
	}
	if !errors.Is(nextErr, io.EOF) {
		return count, nextErr
	}
	return count, io.EOF
}
