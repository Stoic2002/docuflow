package documents

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/local/pdf-web-studio/apps/api/internal/processing"
)

func a4() []processing.PageSize {
	return []processing.PageSize{{Width: 595.28, Height: 841.89}, {Width: 595.28, Height: 841.89}}
}

func textPage(page int, text AnnotationText) AnnotationDocument {
	return AnnotationDocument{Pages: []AnnotationPage{{Page: page, Texts: []AnnotationText{text}}}}
}

func validText() AnnotationText {
	return AnnotationText{Text: "Halo", X: 100, Y: 700, FontSize: 12, Opacity: 1}
}

func TestBuildAnnotationPagesRejectsInvalidDocuments(t *testing.T) {
	shape := func(s AnnotationShape) AnnotationDocument {
		return AnnotationDocument{Pages: []AnnotationPage{{Page: 1, Shapes: []AnnotationShape{s}}}}
	}
	cases := []struct {
		name     string
		document AnnotationDocument
		contains string
	}{
		{"page beyond the document", textPage(3, validText()), "outside the document"},
		{"page zero", textPage(0, validText()), "outside the document"},
		{"duplicate page", AnnotationDocument{Pages: []AnnotationPage{
			{Page: 1, Texts: []AnnotationText{validText()}},
			{Page: 1, Texts: []AnnotationText{validText()}},
		}}, "more than once"},
		{"blank text", textPage(1, AnnotationText{Text: "   ", X: 10, Y: 10, FontSize: 12, Opacity: 1}), "is empty"},
		{"line break in text", textPage(1, AnnotationText{Text: "dua\nbaris", X: 10, Y: 10, FontSize: 12, Opacity: 1}), "line break"},
		{"text far off page", textPage(1, AnnotationText{Text: "x", X: 99999, Y: 10, FontSize: 12, Opacity: 1}), "outside the page"},
		{"unusable font size", textPage(1, AnnotationText{Text: "x", X: 10, Y: 10, FontSize: 900, Opacity: 1}), "font size"},
		{"opacity above one", textPage(1, AnnotationText{Text: "x", X: 10, Y: 10, FontSize: 12, Opacity: 4}), "opacity or rotation"},
		{"unknown alignment", textPage(1, AnnotationText{Text: "x", X: 10, Y: 10, FontSize: 12, Opacity: 1, Align: "justify"}), "alignment"},
		{"shape without points", shape(AnnotationShape{Kind: "rectangle", StrokeWidth: 1, Opacity: 1}), "no points"},
		{"invisible shape", shape(AnnotationShape{Kind: "rectangle", Points: []processing.Point{{X: 1, Y: 1}, {X: 9, Y: 9}}, Opacity: 1}), "invisible"},
		{"shape stroke too wide", shape(AnnotationShape{Kind: "line", Points: []processing.Point{{X: 1, Y: 1}, {X: 9, Y: 9}}, StrokeWidth: 500, Opacity: 1}), "stroke width"},
		{"image with unknown asset", AnnotationDocument{Pages: []AnnotationPage{{Page: 1, Images: []AnnotationImage{
			{Asset: "missing", CenterX: 100, CenterY: 100, Width: 50, Height: 50, Opacity: 1},
		}}}}, "unknown asset"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			_, _, err := buildAnnotationPages(testCase.document, a4(), map[string]processing.JPEGInput{})
			if err == nil {
				t.Fatalf("buildAnnotationPages accepted %s", testCase.name)
			}
			var annotationError *AnnotationError
			if !errors.As(err, &annotationError) {
				t.Fatalf("error = %T, want *AnnotationError", err)
			}
			if !strings.Contains(annotationError.Reason, testCase.contains) {
				t.Fatalf("reason = %q, want it to mention %q", annotationError.Reason, testCase.contains)
			}
		})
	}
}

func TestBuildAnnotationPagesPlacesObjectsOnTheRightPage(t *testing.T) {
	document := AnnotationDocument{Pages: []AnnotationPage{{
		Page:   2,
		Texts:  []AnnotationText{validText()},
		Shapes: []AnnotationShape{{Kind: "ellipse", Points: []processing.Point{{X: 10, Y: 10}, {X: 90, Y: 60}}, StrokeWidth: 2, Opacity: 1}},
	}}}
	pages, edited, err := buildAnnotationPages(document, a4(), map[string]processing.JPEGInput{})
	if err != nil {
		t.Fatal(err)
	}
	if edited != 1 {
		t.Fatalf("edited pages = %d, want 1", edited)
	}
	if len(pages) != 2 {
		t.Fatalf("output pages = %d, want one per document page", len(pages))
	}
	if len(pages[0].Texts) != 0 || len(pages[0].Shapes) != 0 {
		t.Error("page one must stay untouched")
	}
	if len(pages[1].Texts) != 1 || len(pages[1].Shapes) != 1 {
		t.Errorf("page two = %d texts and %d shapes, want one each", len(pages[1].Texts), len(pages[1].Shapes))
	}
	// A page that is not mentioned still needs its size so the overlay lines up.
	if pages[0].Width != 595.28 {
		t.Errorf("untouched page lost its size: %#v", pages[0].PageSize)
	}
}

func TestAnnotationObjectLimits(t *testing.T) {
	page := AnnotationPage{Page: 1}
	for index := 0; index <= MaxAnnotationObjectsPerPage; index++ {
		page.Texts = append(page.Texts, validText())
	}
	_, _, err := buildAnnotationPages(AnnotationDocument{Pages: []AnnotationPage{page}}, a4(), nil)
	if err == nil || !strings.Contains(err.Error(), "more than") {
		t.Fatalf("per-page limit was not enforced: %v", err)
	}
}

// TestAnnotationDocumentRendersValidPDF exercises the whole mapping from an
// editor document through the overlay writer, without touching the database.
func TestAnnotationDocumentRendersValidPDF(t *testing.T) {
	if _, err := exec.LookPath("qpdf"); err != nil {
		t.Skip("qpdf is optional")
	}
	document := AnnotationDocument{Pages: []AnnotationPage{{
		Page: 1,
		Texts: []AnnotationText{
			{Text: "Catatan reviewer", X: 60, Y: 780, FontSize: 16, Opacity: 1, Color: processing.RGB{R: 0.85}},
			{Text: "rata tengah", X: 297.64, Y: 750, FontSize: 12, Opacity: 0.8, Align: "center"},
		},
		Shapes: []AnnotationShape{
			{Kind: "rectangle", Points: []processing.Point{{X: 50, Y: 600}, {X: 545, Y: 720}}, Stroke: processing.RGB{B: 0.8}, StrokeWidth: 2, Opacity: 1},
			{Kind: "polyline", Points: []processing.Point{{X: 60, Y: 500}, {X: 120, Y: 560}, {X: 200, Y: 490}}, Stroke: processing.RGB{R: 0.9, G: 0.4}, StrokeWidth: 3, Opacity: 1},
		},
	}}}
	pages, _, err := buildAnnotationPages(document, a4(), map[string]processing.JPEGInput{})
	if err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	outputPath := filepath.Join(directory, "annotated.pdf")
	file, err := os.Create(outputPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := processing.WriteOverlayPDFWithFonts(file, pages, nil); err != nil {
		t.Fatal(err)
	}
	_ = file.Close()
	if err := processing.RunCommand(context.Background(), "qpdf", directory, []string{"--check", outputPath}); err != nil {
		t.Fatalf("qpdf --check: %v", err)
	}
}
