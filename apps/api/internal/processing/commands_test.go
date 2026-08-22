package processing

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestQPDFArgumentConstruction(t *testing.T) {
	merge, err := QPDFMergeArgs([]string{"/safe/a.pdf", "/safe/b.pdf"}, "/safe/out.pdf")
	if err != nil {
		t.Fatal(err)
	}
	wantMerge := []string{"--empty", "--pages", "/safe/a.pdf", "1-z", "/safe/b.pdf", "1-z", "--", "/safe/out.pdf"}
	if !reflect.DeepEqual(merge, wantMerge) {
		t.Fatalf("QPDFMergeArgs() = %#v, want %#v", merge, wantMerge)
	}
	reorder, err := QPDFReorderArgs("/safe/in.pdf", []int{3, 1, 2}, "/safe/out.pdf")
	if err != nil {
		t.Fatal(err)
	}
	wantReorder := []string{"/safe/in.pdf", "--pages", ".", "3,1,2", "--", "/safe/out.pdf"}
	if !reflect.DeepEqual(reorder, wantReorder) {
		t.Fatalf("QPDFReorderArgs() = %#v, want %#v", reorder, wantReorder)
	}
}

func TestPhaseOneQPDFArgumentsAreExplicit(t *testing.T) {
	insert, err := QPDFInsertArgs("/safe/current.pdf", []int{1, 2}, "/safe/source.pdf", []int{1, 2}, []int{3}, "/safe/out.pdf")
	if err != nil {
		t.Fatal(err)
	}
	wantInsert := []string{"--empty", "--pages", "/safe/current.pdf", "1,2", "/safe/source.pdf", "1,2", "/safe/current.pdf", "3", "--", "/safe/out.pdf"}
	if !reflect.DeepEqual(insert, wantInsert) {
		t.Fatalf("insert args = %#v", insert)
	}
	protect, err := QPDFProtectArgs("/safe/in.pdf", "/safe/out.pdf", "open secret", "owner secret", true, false, false, true, true, false)
	if err != nil {
		t.Fatal(err)
	}
	if protect[0] != "--encrypt" || protect[len(protect)-2] != "/safe/in.pdf" || protect[len(protect)-1] != "/safe/out.pdf" {
		t.Fatalf("unexpected protect args: %#v", protect)
	}
	if _, err := QPDFProtectArgs("/safe/in.pdf", "/safe/out.pdf", "same", "same", true, true, true, true, true, true); err == nil {
		t.Fatal("equal user and owner passwords should be rejected")
	}
}

func TestGeneratedOverlayBlankMetadataProtectAndUnlock(t *testing.T) {
	if _, err := exec.LookPath("qpdf"); err != nil {
		t.Skip("qpdf is optional")
	}
	directory := t.TempDir()
	inputPath := filepath.Join(directory, "multi-page.pdf")
	input, err := os.Create(inputPath)
	if err != nil {
		t.Fatal(err)
	}
	pages := []OverlayPage{
		{PageSize: PageSize{Width: 612, Height: 792}, Texts: []TextOverlay{{Text: "Page 1", X: 306, Y: 30, FontSize: 12, Opacity: 1, Align: "center"}}},
		{PageSize: PageSize{Width: 595.28, Height: 841.89}, Texts: []TextOverlay{{Text: "Page 2", X: 297.64, Y: 30, FontSize: 12, Opacity: .5, Rotation: 10, Align: "center"}}},
	}
	if err := WriteOverlayPDF(input, pages); err != nil {
		t.Fatal(err)
	}
	_ = input.Close()
	if err := RunCommand(context.Background(), "qpdf", directory, []string{"--check", inputPath}); err != nil {
		t.Fatal(err)
	}
	count, err := QPDFPageCount(context.Background(), inputPath)
	if err != nil || count == nil || *count != 2 {
		t.Fatalf("page count = %v, %v", count, err)
	}

	metadataJSON := filepath.Join(directory, "metadata.json")
	title, author, empty := "Foundation", "Docuflow", ""
	if err := WriteMetadataUpdateJSON(context.Background(), inputPath, metadataJSON, map[string]*string{"Title": &title, "Author": &author, "Subject": &empty}); err != nil {
		t.Fatal(err)
	}
	metadataPath := filepath.Join(directory, "metadata.pdf")
	if err := RunCommand(context.Background(), "qpdf", directory, []string{"--update-from-json=" + metadataJSON, inputPath, metadataPath}); err != nil {
		var toolErr *ToolError
		if errors.As(err, &toolErr) {
			t.Fatalf("%v: %s", err, toolErr.Output)
		}
		t.Fatal(err)
	}
	metadata, err := ReadPDFMetadata(context.Background(), metadataPath)
	if err != nil {
		t.Fatal(err)
	}
	if metadata.Title != title || metadata.Author != author || metadata.Subject != "" {
		t.Fatalf("metadata = %#v", metadata)
	}

	protectedPath := filepath.Join(directory, "protected.pdf")
	args, err := QPDFProtectArgs(metadataPath, protectedPath, "correct horse", "owner secret", true, false, false, false, true, false)
	if err != nil {
		t.Fatal(err)
	}
	if err := RunCommand(context.Background(), "qpdf", directory, args); err != nil {
		t.Fatal(err)
	}
	if output, err := RunAndCapture(context.Background(), "qpdf", []string{"--show-encryption", "--password=correct horse", protectedPath}); err != nil || !strings.Contains(output, "AESv3") {
		t.Fatalf("protected encryption = %q, %v", output, err)
	}
	wrongOutput, _ := RunAndCapture(context.Background(), "qpdf", []string{"--show-encryption", "--password=wrong", protectedPath})
	if !strings.Contains(strings.ToLower(wrongOutput), "incorrect password") {
		t.Fatalf("wrong password status = %q", wrongOutput)
	}
	unlockedPath := filepath.Join(directory, "unlocked.pdf")
	if err := RunCommand(context.Background(), "qpdf", directory, QPDFUnlockArgs(protectedPath, unlockedPath, "correct horse")); err != nil {
		t.Fatal(err)
	}
	output, err := RunAndCapture(context.Background(), "qpdf", []string{"--show-encryption", unlockedPath})
	if err != nil || !strings.Contains(output, "File is not encrypted") {
		t.Fatalf("unlock status = %q, %v", output, err)
	}
}

func TestPageSelectionValidation(t *testing.T) {
	for _, valid := range []string{"1", "1-3", "1-3,5,9-10"} {
		if err := ValidatePageSelection(valid); err != nil {
			t.Fatalf("ValidatePageSelection(%q) = %v", valid, err)
		}
	}
	for _, invalid := range []string{"", "0", "3-1", "1;cat", "1--2", "1 z"} {
		if err := ValidatePageSelection(invalid); err == nil {
			t.Fatalf("ValidatePageSelection(%q) unexpectedly succeeded", invalid)
		}
	}
}

func TestPageSelectionBounds(t *testing.T) {
	if err := ValidatePageSelectionWithin("1-3,5", 5); err != nil {
		t.Fatalf("valid bounded selection: %v", err)
	}
	if err := ValidatePageSelectionWithin("1-6", 5); err == nil {
		t.Fatal("selection beyond the page count should fail")
	}
}

func TestExpandPageSelection(t *testing.T) {
	pages, err := ExpandPageSelection("1-3,5", 5)
	if err != nil {
		t.Fatal(err)
	}
	want := []int{1, 2, 3, 5}
	if !reflect.DeepEqual(pages, want) {
		t.Fatalf("pages = %#v, want %#v", pages, want)
	}
	if _, err := ExpandPageSelection("1-3,3", 5); err == nil {
		t.Fatal("duplicate pages should fail")
	}
}

func TestOCRArgumentsAreExplicit(t *testing.T) {
	args, err := OCRmyPDFArgs("/safe/in.pdf", "/safe/out.pdf", "ind")
	if err != nil {
		t.Fatal(err)
	}
	want := []string{"--skip-text", "--language", "ind", "--output-type", "pdf", "--optimize", "0", "--jobs", "1", "/safe/in.pdf", "/safe/out.pdf"}
	if !reflect.DeepEqual(args, want) {
		t.Fatalf("OCRmyPDFArgs() = %#v, want %#v", args, want)
	}
	if _, err := OCRmyPDFArgs("/safe/in.pdf", "/safe/out.pdf", "eng;rm"); err == nil {
		t.Fatal("OCRmyPDFArgs accepted an unsafe language")
	}
}
