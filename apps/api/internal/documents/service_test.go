package documents

import (
	"errors"
	"strings"
	"testing"

	"github.com/local/pdf-web-studio/apps/api/internal/storage"
)

func TestValidateUploadMetadata(t *testing.T) {
	tests := []struct {
		name        string
		filename    string
		contentType string
		want        string
		wantError   bool
	}{
		{name: "valid", filename: "report.pdf", contentType: "application/pdf", want: "report.pdf"},
		{name: "basename windows path", filename: `C:\\fake\\report.pdf`, contentType: "application/pdf", want: "report.pdf"},
		{name: "wrong extension", filename: "report.exe", contentType: "application/pdf", wantError: true},
		{name: "wrong mime", filename: "report.pdf", contentType: "text/plain", wantError: true},
		{name: "header injection", filename: "report.pdf\r\nmalicious", contentType: "application/pdf", wantError: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := validateUploadMetadata(test.filename, test.contentType)
			if test.wantError && !errors.Is(err, ErrInvalidPDF) {
				t.Fatalf("error = %v, want ErrInvalidPDF", err)
			}
			if !test.wantError && (err != nil || got != test.want) {
				t.Fatalf("validateUploadMetadata() = %q, %v; want %q", got, err, test.want)
			}
		})
	}
}

func TestUploadRejectsInvalidMagicAndSizeBeforeDatabase(t *testing.T) {
	store, err := storage.New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	service := NewService(nil, store, 12)
	_, _, err = service.Upload(t.Context(), "fake.pdf", "application/pdf", strings.NewReader("not a PDF"))
	if !errors.Is(err, ErrInvalidPDF) {
		t.Fatalf("invalid magic error = %v, want ErrInvalidPDF", err)
	}
	_, _, err = service.Upload(t.Context(), "large.pdf", "application/pdf", strings.NewReader("%PDF-1.4 this is too large"))
	if !errors.Is(err, ErrTooLarge) {
		t.Fatalf("large upload error = %v, want ErrTooLarge", err)
	}
}

func TestNormalizePDFName(t *testing.T) {
	tests := map[string]string{"proposal": "proposal.pdf", "REPORT.PDF": "REPORT.PDF", "report.pdf.pdf": "report.pdf", "  final.pdf  ": "final.pdf"}
	for input, want := range tests {
		got, err := NormalizePDFName(input)
		if err != nil || got != want {
			t.Fatalf("NormalizePDFName(%q) = %q, %v; want %q", input, got, err, want)
		}
	}
	for _, input := range []string{"", "../secret.pdf", `folder\\secret.pdf`, "bad\nname.pdf", ".pdf"} {
		if _, err := NormalizePDFName(input); !errors.Is(err, ErrInvalidFilename) {
			t.Fatalf("NormalizePDFName(%q) error = %v", input, err)
		}
	}
}

func TestOrganizeValidationHelpers(t *testing.T) {
	before, after, err := insertionLists(4, InsertOptions{Position: "after", Page: 2})
	if err != nil {
		t.Fatal(err)
	}
	if len(before) != 2 || before[1] != 2 || len(after) != 2 || after[0] != 3 {
		t.Fatalf("before=%v after=%v", before, after)
	}
	if _, _, err := insertionLists(4, InsertOptions{Position: "before", Page: 0}); !errors.Is(err, ErrInvalidOperation) {
		t.Fatalf("invalid insert = %v", err)
	}
	selected, err := selectedPageSet("1-3", 4, true)
	if err != nil {
		t.Fatal(err)
	}
	if selected[1] || !selected[2] || !selected[3] {
		t.Fatalf("selected = %#v", selected)
	}
	if got := replaceVariables("{filename} {page}/{pages} {date}", "report.pdf", 2, 5); !strings.Contains(got, "report.pdf 2/5") {
		t.Fatalf("variables = %q", got)
	}
}
