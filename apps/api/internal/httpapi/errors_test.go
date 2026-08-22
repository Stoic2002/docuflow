package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/local/pdf-web-studio/apps/api/internal/config"
	"github.com/local/pdf-web-studio/apps/api/internal/documents"
	"github.com/local/pdf-web-studio/apps/api/internal/processing"
)

func TestMultipartContentTypeDetection(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/tools/merge", nil)
	request.Header.Set("Content-Type", "multipart/form-data; boundary=safe-boundary")
	if !isMultipart(request) {
		t.Fatal("multipart/form-data should select the direct upload handler")
	}
	request.Header.Set("Content-Type", "application/json")
	if isMultipart(request) {
		t.Fatal("application/json must remain on the backwards-compatible handler")
	}
}

func TestEditSessionResponseUsesServerOwnedRelativeURLs(t *testing.T) {
	id := uuid.New()
	response := editSessionResponse(documents.Document{ID: id, OriginalName: "report.pdf", ByteSize: 42})
	if response["id"] != id.String() || response["mode"] != "preview" {
		t.Fatalf("unexpected edit session: %#v", response)
	}
	expected := "/api/documents/" + id.String() + "/content"
	if response["previewUrl"] != expected || response["downloadUrl"] != expected {
		t.Fatalf("session URLs are not server-owned API paths: %#v", response)
	}
}

func TestDocumentErrorMapping(t *testing.T) {
	server := &Server{config: config.Config{MaxUploadBytes: 42}}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/documents", nil)
	server.writeDocumentError(recorder, request, documents.ErrTooLarge)
	if recorder.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusRequestEntityTooLarge)
	}
	var body errorEnvelope
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Error.Code != "UPLOAD_TOO_LARGE" || body.Error.Details["maxBytes"] != float64(42) {
		t.Fatalf("unexpected error envelope: %#v", body)
	}
}

func TestToolErrorMapping(t *testing.T) {
	server := &Server{}
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/tools/ocr", nil)
	server.writeToolResult(recorder, request, documents.Document{}, documents.Version{}, &processing.ToolError{
		Code: processing.CodeToolUnavailable, Tool: "ocrmypdf", Err: errors.New("missing"),
	})
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusServiceUnavailable)
	}
	var body errorEnvelope
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if body.Error.Code != processing.CodeToolUnavailable {
		t.Fatalf("code = %q, want %q", body.Error.Code, processing.CodeToolUnavailable)
	}
}

func TestParseSplitPagesForOneInput(t *testing.T) {
	pageCount := int32(5)
	upload := directUpload{document: documents.Document{OriginalName: "one.pdf", PageCount: &pageCount}}
	pages, err := parseSplitPages(map[string]string{"pages": `[1,2,3]`}, upload)
	if err != nil {
		t.Fatal(err)
	}
	if len(pages) != 3 || pages[0] != 1 || pages[2] != 3 {
		t.Fatalf("unexpected pages: %#v", pages)
	}
	legacy, err := parseSplitPages(map[string]string{"ranges": "1-3"}, upload)
	if err != nil || len(legacy) != 3 {
		t.Fatalf("legacy range should expand to three pages: %#v, %v", legacy, err)
	}
	if _, err := parseSplitPages(map[string]string{"pages": `[1,6]`}, upload); err == nil {
		t.Fatal("out-of-bounds page should fail before processing")
	}
}
