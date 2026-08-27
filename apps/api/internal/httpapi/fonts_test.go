package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/local/pdf-web-studio/apps/api/internal/processing"
)

// fontServer builds a server whose registry holds one font taken from the
// repository's own assets, so the test needs neither a database nor a host that
// happens to ship a particular typeface.
func fontServer(t *testing.T) (*Server, processing.RegisteredFont) {
	t.Helper()
	matches, err := filepath.Glob(filepath.Join("..", "..", "..", "..", "assets", "fonts", "*.ttf"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) == 0 {
		t.Skip("no fonts are bundled in assets/fonts")
	}
	data, err := os.ReadFile(matches[0])
	if err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, filepath.Base(matches[0])), data, 0o600); err != nil {
		t.Fatal(err)
	}
	registry := processing.LoadFontRegistry(directory)
	available := registry.Available()
	if len(available) != 1 {
		t.Fatalf("Available() = %#v, want exactly one font", available)
	}
	return &Server{fonts: registry}, available[0]
}

func fontFileRequest(id string) *http.Request {
	routeContext := chi.NewRouteContext()
	routeContext.URLParams.Add("fontId", id)
	request := httptest.NewRequest(http.MethodGet, "/api/fonts/"+id+"/file", nil)
	return request.WithContext(context.WithValue(request.Context(), chi.RouteCtxKey, routeContext))
}

func TestFontFileServesTheRegisteredProgram(t *testing.T) {
	server, font := fontServer(t)
	recorder := httptest.NewRecorder()
	server.getFontFile(recorder, fontFileRequest(font.ID))

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	if got := recorder.Header().Get("Content-Type"); got != "font/ttf" {
		t.Errorf("Content-Type = %q, want font/ttf", got)
	}
	body := recorder.Body.Bytes()
	if len(body) == 0 {
		t.Fatal("the font program was not written")
	}
	// A TrueType file starts with either the sfnt version or the "true" tag;
	// anything else means the wrong bytes went out.
	prefix := string(body[:4])
	if prefix != "\x00\x01\x00\x00" && prefix != "true" && prefix != "ttcf" {
		t.Errorf("body does not begin with a TrueType signature: %q", prefix)
	}
	if recorder.Header().Get("ETag") == "" {
		t.Error("an ETag is needed so the browser can keep the face cached")
	}
}

func TestFontFileAnswersNotModified(t *testing.T) {
	server, font := fontServer(t)
	first := httptest.NewRecorder()
	server.getFontFile(first, fontFileRequest(font.ID))

	request := fontFileRequest(font.ID)
	request.Header.Set("If-None-Match", first.Header().Get("ETag"))
	second := httptest.NewRecorder()
	server.getFontFile(second, request)

	if second.Code != http.StatusNotModified {
		t.Fatalf("status = %d, want 304", second.Code)
	}
	if second.Body.Len() != 0 {
		t.Error("a 304 must not repeat the font program")
	}
}

func TestFontFileRejectsAnythingOutsideTheRegistry(t *testing.T) {
	server, _ := fontServer(t)
	for _, id := range []string{"tidak-ada", "../../etc/passwd", ""} {
		recorder := httptest.NewRecorder()
		server.getFontFile(recorder, fontFileRequest(id))
		if recorder.Code != http.StatusNotFound {
			t.Errorf("status for %q = %d, want 404", id, recorder.Code)
		}
	}
}
