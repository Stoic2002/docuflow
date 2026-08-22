package processing

import (
	"context"
	"crypto/sha256"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func writeCorpusPDF(t *testing.T, path string, sizes []PageSize, imageInput *JPEGInput) {
	t.Helper()
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	pages := make([]OverlayPage, len(sizes))
	for i, size := range sizes {
		pages[i] = OverlayPage{PageSize: size, Texts: []TextOverlay{{Text: fmt.Sprintf("Deterministic fixture page %d", i+1), X: 36, Y: size.Height - 48, FontSize: 12, Opacity: 1}}}
		if imageInput != nil {
			pages[i].Images = []ImageOverlay{{Image: *imageInput, CenterX: size.Width / 2, CenterY: size.Height / 2, Width: 120, Height: 80, Opacity: 1}}
		}
	}
	if err := WriteOverlayPDF(file, pages); err != nil {
		t.Fatal(err)
	}
	_ = file.Close()
}

func TestDeterministicGoldenPDFCorpus(t *testing.T) {
	if _, err := exec.LookPath("qpdf"); err != nil {
		t.Skip("qpdf is optional")
	}
	directory := t.TempDir()
	ctx := context.Background()
	jpegPath := filepath.Join(directory, "fixture.jpg")
	jpegFile, err := os.Create(jpegPath)
	if err != nil {
		t.Fatal(err)
	}
	pixels := image.NewRGBA(image.Rect(0, 0, 24, 16))
	for y := 0; y < 16; y++ {
		for x := 0; x < 24; x++ {
			pixels.Set(x, y, color.RGBA{R: uint8(x * 10), G: uint8(y * 14), B: 90, A: 255})
		}
	}
	if err := jpeg.Encode(jpegFile, pixels, &jpeg.Options{Quality: 85}); err != nil {
		t.Fatal(err)
	}
	_ = jpegFile.Close()
	stat, _ := os.Stat(jpegPath)
	jpegInput, err := InspectJPEG(jpegPath, "fixture.jpg", stat.Size())
	if err != nil {
		t.Fatal(err)
	}
	letter := PageSize{Width: 612, Height: 792}
	a4 := PageSize{Width: 595.28, Height: 841.89}
	fixtures := map[string][]PageSize{"simple-text.pdf": {letter}, "multi-page.pdf": {letter, letter, letter, letter}, "image-heavy.pdf": {letter, letter, letter}, "scanned.pdf": {a4, a4}, "mixed-page-size.pdf": {letter, a4, {Width: 841.89, Height: 595.28}}, "large-document.pdf": make([]PageSize, 120), "metadata-filled.pdf": {letter}}
	for i := range fixtures["large-document.pdf"] {
		fixtures["large-document.pdf"][i] = letter
	}
	for name, sizes := range fixtures {
		var embedded *JPEGInput
		if name == "image-heavy.pdf" || name == "scanned.pdf" {
			embedded = &jpegInput
		}
		writeCorpusPDF(t, filepath.Join(directory, name), sizes, embedded)
	}
	rotated := filepath.Join(directory, "rotated-pages.pdf")
	args, err := QPDFRotateArgs(filepath.Join(directory, "multi-page.pdf"), 90, []int{2, 4}, rotated)
	if err != nil {
		t.Fatal(err)
	}
	if err := RunCommand(ctx, "qpdf", directory, args); err != nil {
		t.Fatal(err)
	}
	metadataJSON := filepath.Join(directory, "metadata.json")
	title, author := "Metadata fixture", "Docuflow"
	metadataPath := filepath.Join(directory, "metadata-filled.pdf")
	if err := WriteMetadataUpdateJSON(ctx, metadataPath, metadataJSON, map[string]*string{"Title": &title, "Author": &author}); err != nil {
		t.Fatal(err)
	}
	metadataOutput := filepath.Join(directory, "metadata-output.pdf")
	if err := RunCommand(ctx, "qpdf", directory, []string{"--update-from-json=" + metadataJSON, metadataPath, metadataOutput}); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(metadataOutput, metadataPath); err != nil {
		t.Fatal(err)
	}
	protected := filepath.Join(directory, "encrypted.pdf")
	protectArgs, err := QPDFProtectArgs(filepath.Join(directory, "simple-text.pdf"), protected, "fixture-password", "fixture-owner", true, false, false, false, false, false)
	if err != nil {
		t.Fatal(err)
	}
	if err := RunCommand(ctx, "qpdf", directory, protectArgs); err != nil {
		t.Fatal(err)
	}
	fixtures["rotated-pages.pdf"] = fixtures["multi-page.pdf"]
	fixtures["encrypted.pdf"] = fixtures["simple-text.pdf"]
	for name := range fixtures {
		path := filepath.Join(directory, name)
		if err := RunCommand(ctx, "qpdf", directory, []string{"--password=fixture-password", "--check", path}); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
}

func TestStructuralOperationsPreserveOriginalBytes(t *testing.T) {
	if _, err := exec.LookPath("qpdf"); err != nil {
		t.Skip("qpdf is optional")
	}
	directory := t.TempDir()
	input := filepath.Join(directory, "original.pdf")
	writeCorpusPDF(t, input, []PageSize{{Width: 612, Height: 792}, {Width: 612, Height: 792}, {Width: 612, Height: 792}}, nil)
	original, err := os.ReadFile(input)
	if err != nil {
		t.Fatal(err)
	}
	before := sha256.Sum256(original)
	operations := []struct {
		name  string
		args  []string
		pages int
	}{}
	reorder, _ := QPDFReorderArgs(input, []int{3, 1, 2}, filepath.Join(directory, "reordered.pdf"))
	operations = append(operations, struct {
		name  string
		args  []string
		pages int
	}{"reordered", reorder, 3})
	duplicate, _ := QPDFDuplicateArgs(input, []int{1, 2, 2, 3}, filepath.Join(directory, "duplicated.pdf"))
	operations = append(operations, struct {
		name  string
		args  []string
		pages int
	}{"duplicated", duplicate, 4})
	extract, _ := QPDFExtractArgs(input, "1,3", filepath.Join(directory, "extracted.pdf"))
	operations = append(operations, struct {
		name  string
		args  []string
		pages int
	}{"extracted", extract, 2})
	rotate, _ := QPDFRotateArgs(input, -90, []int{1, 3}, filepath.Join(directory, "rotated.pdf"))
	operations = append(operations, struct {
		name  string
		args  []string
		pages int
	}{"rotated", rotate, 3})
	blankPath := filepath.Join(directory, "blank.pdf")
	blank, err := os.Create(blankPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := WriteBlankPDF(blank, []PageSize{{Width: 612, Height: 792}}); err != nil {
		t.Fatal(err)
	}
	_ = blank.Close()
	insert, _ := QPDFInsertArgs(input, []int{1}, blankPath, []int{1}, []int{2, 3}, filepath.Join(directory, "inserted.pdf"))
	operations = append(operations, struct {
		name  string
		args  []string
		pages int
	}{"inserted", insert, 4})
	for _, operation := range operations {
		if err := RunCommand(context.Background(), "qpdf", directory, operation.args); err != nil {
			t.Fatalf("%s: %v", operation.name, err)
		}
		count, err := QPDFPageCount(context.Background(), filepath.Join(directory, operation.name+".pdf"))
		if err != nil || count == nil || int(*count) != operation.pages {
			t.Fatalf("%s pages=%v err=%v", operation.name, count, err)
		}
	}
	afterBytes, err := os.ReadFile(input)
	if err != nil {
		t.Fatal(err)
	}
	after := sha256.Sum256(afterBytes)
	if before != after {
		t.Fatal("original PDF bytes changed")
	}
}
