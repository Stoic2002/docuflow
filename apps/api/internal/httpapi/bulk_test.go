package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/local/pdf-web-studio/apps/api/internal/documents"
)

func decodeBulkBody(t *testing.T, body string) ([]uuid.UUID, int, string) {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/documents/bulk-delete", strings.NewReader(body))
	ids, ok := decodeBulkDocuments(recorder, request)
	if ok {
		return ids, http.StatusOK, ""
	}
	var envelope errorEnvelope
	if err := json.NewDecoder(recorder.Body).Decode(&envelope); err != nil {
		t.Fatal(err)
	}
	return nil, recorder.Code, envelope.Error.Code
}

func TestDecodeBulkDocumentsAcceptsOnlyOneWellFormedObject(t *testing.T) {
	id := uuid.New()
	ids, _, _ := decodeBulkBody(t, `{"documentIds":["`+id.String()+`"]}`)
	if len(ids) != 1 || ids[0] != id {
		t.Fatalf("unexpected ids: %#v", ids)
	}

	for _, test := range []struct{ name, body, code string }{
		{"malformed", `{"documentIds":`, "INVALID_JSON"},
		{"unknown field", `{"documentIds":[],"purge":true}`, "INVALID_JSON"},
		{"trailing object", `{"documentIds":[]}{"documentIds":[]}`, "INVALID_JSON"},
		{"not a uuid", `{"documentIds":["../../etc/passwd"]}`, "INVALID_DOCUMENT_ID"},
	} {
		t.Run(test.name, func(t *testing.T) {
			_, status, code := decodeBulkBody(t, test.body)
			if status != http.StatusBadRequest || code != test.code {
				t.Fatalf("status = %d, code = %q; want 400 and %q", status, code, test.code)
			}
		})
	}
}

func TestWriteBulkResultRejectsSelectionsTheServiceRefused(t *testing.T) {
	for _, test := range []struct {
		name   string
		err    error
		status int
		code   string
	}{
		{"empty", documents.ErrNoDocumentsSelected, http.StatusBadRequest, "NO_DOCUMENTS_SELECTED"},
		{"oversized", documents.ErrTooManyDocuments, http.StatusUnprocessableEntity, "TOO_MANY_DOCUMENTS"},
	} {
		t.Run(test.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodPost, "/api/documents/bulk-delete", nil)
			(&Server{}).writeBulkResult(recorder, request, documents.BulkResult{}, test.err)
			if recorder.Code != test.status {
				t.Fatalf("status = %d, want %d", recorder.Code, test.status)
			}
			var envelope errorEnvelope
			if err := json.NewDecoder(recorder.Body).Decode(&envelope); err != nil {
				t.Fatal(err)
			}
			if envelope.Error.Code != test.code {
				t.Fatalf("code = %q, want %q", envelope.Error.Code, test.code)
			}
		})
	}
}

// A partial batch still succeeded for most documents, so the response is 200
// with both halves named rather than a blanket error.
func TestWriteBulkResultReportsPerDocumentOutcomes(t *testing.T) {
	deleted, missing := uuid.New(), uuid.New()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/documents/bulk-permanent-delete", nil)
	(&Server{}).writeBulkResult(recorder, request, documents.BulkResult{
		Deleted:  []uuid.UUID{deleted},
		Failures: []documents.BulkFailure{{DocumentID: missing, Reason: documents.ErrNotFound}},
	}, nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	var body struct {
		Deleted []string `json:"deleted"`
		Failed  []struct {
			DocumentID string `json:"documentId"`
			Code       string `json:"code"`
		} `json:"failed"`
	}
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if len(body.Deleted) != 1 || body.Deleted[0] != deleted.String() {
		t.Fatalf("unexpected deleted list: %#v", body.Deleted)
	}
	if len(body.Failed) != 1 || body.Failed[0].DocumentID != missing.String() || body.Failed[0].Code != "DOCUMENT_NOT_FOUND" {
		t.Fatalf("unexpected failed list: %#v", body.Failed)
	}
}

// An empty batch must serialise as [] so the client can read .length directly.
func TestWriteBulkResultNeverSerialisesNullLists(t *testing.T) {
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/documents/bulk-delete", nil)
	(&Server{}).writeBulkResult(recorder, request, documents.BulkResult{Deleted: []uuid.UUID{}}, nil)
	if body := recorder.Body.String(); !strings.Contains(body, `"deleted":[]`) || !strings.Contains(body, `"failed":[]`) {
		t.Fatalf("empty lists must be arrays, got %s", body)
	}
}
