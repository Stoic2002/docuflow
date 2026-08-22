package processing

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func createTestJPEG(t *testing.T, name string, width, height int, fill color.RGBA) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	canvas := image.NewRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			canvas.SetRGBA(x, y, fill)
		}
	}
	if err := jpeg.Encode(file, canvas, &jpeg.Options{Quality: 85}); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestWriteJPEGsAsPDFPreservesInputOrderAndPageCount(t *testing.T) {
	firstPath := createTestJPEG(t, "portrait.jpg", 80, 120, color.RGBA{R: 240, A: 255})
	secondPath := createTestJPEG(t, "landscape.jpg", 160, 90, color.RGBA{B: 220, A: 255})
	inputs := make([]JPEGInput, 0, 2)
	for _, path := range []string{firstPath, secondPath} {
		stat, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		input, err := InspectJPEG(path, filepath.Base(path), stat.Size())
		if err != nil {
			t.Fatal(err)
		}
		inputs = append(inputs, input)
	}
	output, err := os.CreateTemp(t.TempDir(), "converted-*.pdf")
	if err != nil {
		t.Fatal(err)
	}
	defer output.Close()
	if err := WriteJPEGsAsPDF(output, inputs); err != nil {
		t.Fatal(err)
	}
	contents, err := os.ReadFile(output.Name())
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(contents, []byte("%PDF-1.4")) {
		t.Fatal("converted output is missing a PDF signature")
	}
	if !bytes.Contains(contents, []byte("/Count 2")) {
		t.Fatal("converted output does not declare two pages")
	}
	portraitPage := bytes.Index(contents, []byte("/MediaBox [0 0 595.28 841.89]"))
	landscapePage := bytes.Index(contents, []byte("/MediaBox [0 0 841.89 595.28]"))
	if portraitPage < 0 || landscapePage < 0 || portraitPage >= landscapePage {
		t.Fatal("page orientation or input ordering was not preserved")
	}
	if _, err := exec.LookPath("qpdf"); err == nil {
		pageCount, err := QPDFPageCount(context.Background(), output.Name())
		if err != nil {
			t.Fatalf("qpdf rejected generated PDF: %v", err)
		}
		if pageCount == nil || *pageCount != 2 {
			t.Fatalf("qpdf page count = %v, want 2", pageCount)
		}
	}
}

func TestInspectJPEGRejectsNonJPEG(t *testing.T) {
	path := filepath.Join(t.TempDir(), "fake.jpg")
	if err := os.WriteFile(path, []byte("not-an-image"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := InspectJPEG(path, "fake.jpg", 12); err != ErrInvalidJPEG {
		t.Fatalf("expected ErrInvalidJPEG, got %v", err)
	}
}

func TestWriteJPEGsAsPDFRequiresInput(t *testing.T) {
	output, err := os.CreateTemp(t.TempDir(), "empty-*.pdf")
	if err != nil {
		t.Fatal(err)
	}
	defer output.Close()
	if err := WriteJPEGsAsPDF(output, nil); err != ErrJPEGInputRequired {
		t.Fatalf("expected ErrJPEGInputRequired, got %v", err)
	}
}
