package processing

import (
	"context"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func writeTestJPEG(t *testing.T, path string, tint color.RGBA) JPEGInput {
	t.Helper()
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	pixels := image.NewRGBA(image.Rect(0, 0, 16, 12))
	for y := 0; y < 12; y++ {
		for x := 0; x < 16; x++ {
			pixels.Set(x, y, tint)
		}
	}
	if err := jpeg.Encode(file, pixels, &jpeg.Options{Quality: 80}); err != nil {
		t.Fatal(err)
	}
	_ = file.Close()
	stat, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	input, err := InspectJPEG(path, filepath.Base(path), stat.Size())
	if err != nil {
		t.Fatal(err)
	}
	return input
}

func TestValidateShapeRejectsMalformedGeometry(t *testing.T) {
	twoPoints := []Point{{X: 10, Y: 10}, {X: 20, Y: 20}}
	cases := []struct {
		name  string
		shape ShapeOverlay
	}{
		{"rectangle with one point", ShapeOverlay{Kind: ShapeRectangle, Points: twoPoints[:1]}},
		{"ellipse with three points", ShapeOverlay{Kind: ShapeEllipse, Points: append(twoPoints, Point{X: 5, Y: 5})}},
		{"line with one point", ShapeOverlay{Kind: ShapeLine, Points: twoPoints[:1]}},
		{"polyline with one point", ShapeOverlay{Kind: ShapePolyline, Points: twoPoints[:1]}},
		{"unknown kind", ShapeOverlay{Kind: "triangle", Points: twoPoints}},
		{"too many points", ShapeOverlay{Kind: ShapePolyline, Points: make([]Point, maxShapePoints+1)}},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if err := validateShape(testCase.shape); err == nil {
				t.Fatalf("validateShape(%#v) accepted malformed geometry", testCase.shape)
			}
		})
	}
	valid := ShapeOverlay{Kind: ShapeRectangle, Points: twoPoints, StrokeWidth: 1}
	if err := validateShape(valid); err != nil {
		t.Fatalf("validateShape(valid) = %v", err)
	}
}

func TestWriteOverlayPDFRejectsMalformedShape(t *testing.T) {
	file, err := os.Create(filepath.Join(t.TempDir(), "invalid.pdf"))
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	pages := []OverlayPage{{
		PageSize: PageSize{Width: 612, Height: 792},
		Shapes:   []ShapeOverlay{{Kind: ShapeRectangle, Points: []Point{{X: 1, Y: 1}}}},
	}}
	if err := WriteOverlayPDF(file, pages); err == nil {
		t.Fatal("WriteOverlayPDF accepted a rectangle with one point")
	}
}

func TestShapeContentUsesExpectedOperators(t *testing.T) {
	corners := []Point{{X: 100, Y: 100}, {X: 200, Y: 180}}
	red := RGB{R: 1}
	cases := []struct {
		name  string
		shape ShapeOverlay
		want  []string
	}{
		{
			"stroked rectangle",
			ShapeOverlay{Kind: ShapeRectangle, Points: corners, Stroke: red, StrokeWidth: 2, Opacity: 1},
			[]string{"100.000 100.000 100.000 80.000 re", "1.0000 0.0000 0.0000 RG", "2.000 w", "\nS\n"},
		},
		{
			"filled and stroked rectangle",
			ShapeOverlay{Kind: ShapeRectangle, Points: corners, Stroke: red, StrokeWidth: 1, Fill: &RGB{B: 1}, Opacity: 1},
			[]string{"0.0000 0.0000 1.0000 rg", "\nB\n"},
		},
		{
			"filled ellipse without stroke",
			ShapeOverlay{Kind: ShapeEllipse, Points: corners, Fill: &red, Opacity: 1},
			[]string{" c\n", "\nf\n"},
		},
		{
			"polyline is stroked only",
			ShapeOverlay{Kind: ShapePolyline, Points: []Point{{X: 1, Y: 2}, {X: 3, Y: 4}, {X: 5, Y: 6}}, Stroke: red, StrokeWidth: 3, Fill: &red, Opacity: 1},
			[]string{"1.000 2.000 m", "3.000 4.000 l", "5.000 6.000 l", "\nS\n"},
		},
		{
			"rotation emits a cm transform",
			ShapeOverlay{Kind: ShapeRectangle, Points: corners, Stroke: red, StrokeWidth: 1, Rotation: 45, Opacity: 1},
			[]string{" cm\n"},
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			content := shapeContent(testCase.shape)
			for _, want := range testCase.want {
				if !strings.Contains(content, want) {
					t.Fatalf("shapeContent() missing %q in:\n%s", want, content)
				}
			}
			if strings.Count(content, "q ") != 1 || strings.Count(content, "Q\n") != 1 {
				t.Fatalf("shapeContent() must balance q/Q:\n%s", content)
			}
		})
	}
}

func TestTextContentCarriesColour(t *testing.T) {
	green := textContent(TextOverlay{Text: "Hijau", X: 10, Y: 10, FontSize: 12, Opacity: 1, Color: RGB{G: 0.5}})
	if !strings.Contains(green, "0.0000 0.5000 0.0000 rg") {
		t.Fatalf("textContent() lost the requested colour:\n%s", green)
	}
	// An unset colour must stay black so existing tools render unchanged.
	blackDefault := textContent(TextOverlay{Text: "Hitam", X: 10, Y: 10, FontSize: 12, Opacity: 1})
	if !strings.Contains(blackDefault, "0.0000 0.0000 0.0000 rg") {
		t.Fatalf("textContent() default colour is not black:\n%s", blackDefault)
	}
}

func TestOverlayEmbedsEachImageOnce(t *testing.T) {
	directory := t.TempDir()
	logo := writeTestJPEG(t, filepath.Join(directory, "logo.jpg"), color.RGBA{R: 200, G: 30, B: 30, A: 255})
	stamp := writeTestJPEG(t, filepath.Join(directory, "stamp.jpg"), color.RGBA{R: 20, G: 120, B: 220, A: 255})
	size := PageSize{Width: 612, Height: 792}
	place := func(input JPEGInput) ImageOverlay {
		return ImageOverlay{Image: input, CenterX: 306, CenterY: 396, Width: 64, Height: 48, Opacity: 1}
	}
	pages := []OverlayPage{
		{PageSize: size, Images: []ImageOverlay{place(logo)}},
		{PageSize: size, Images: []ImageOverlay{place(logo), place(stamp)}},
		{PageSize: size, Images: []ImageOverlay{place(logo)}},
	}
	outputPath := filepath.Join(directory, "images.pdf")
	file, err := os.Create(outputPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := WriteOverlayPDF(file, pages); err != nil {
		t.Fatal(err)
	}
	_ = file.Close()
	raw, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatal(err)
	}
	body := string(raw)
	if embedded := strings.Count(body, "/Subtype /Image"); embedded != 2 {
		t.Fatalf("embedded image objects = %d, want 2 (one per distinct source)", embedded)
	}
	// A page must only advertise the XObjects it actually draws.
	firstPage := body[strings.Index(body, "4 0 obj"):strings.Index(body, "5 0 obj")]
	if !strings.Contains(firstPage, "/Im0") || strings.Contains(firstPage, "/Im1") {
		t.Fatalf("page one resources should list /Im0 only:\n%s", firstPage)
	}
	secondPage := body[strings.Index(body, "6 0 obj"):strings.Index(body, "7 0 obj")]
	if !strings.Contains(secondPage, "/Im0") || !strings.Contains(secondPage, "/Im1") {
		t.Fatalf("page two resources should list both images:\n%s", secondPage)
	}
}

func TestOverlayWithShapesAndColourIsValidPDF(t *testing.T) {
	if _, err := exec.LookPath("qpdf"); err != nil {
		t.Skip("qpdf is optional")
	}
	directory := t.TempDir()
	logo := writeTestJPEG(t, filepath.Join(directory, "logo.jpg"), color.RGBA{R: 10, G: 180, B: 90, A: 255})
	size := PageSize{Width: 595.28, Height: 841.89}
	pages := []OverlayPage{{
		PageSize: size,
		Texts: []TextOverlay{
			{Text: "Docuflow overlay editor", X: 72, Y: 760, FontSize: 18, Opacity: 1, Color: RGB{R: 0.85, G: 0.18, B: 0.18}},
			{Text: "Teks kedua", X: 297, Y: 720, FontSize: 11, Opacity: 0.6, Align: "center"},
		},
		Shapes: []ShapeOverlay{
			{Kind: ShapeRectangle, Points: []Point{{X: 72, Y: 600}, {X: 300, Y: 700}}, Stroke: RGB{B: 0.7}, StrokeWidth: 2, Fill: &RGB{R: 0.95, G: 0.95, B: 1}, Opacity: 0.9},
			{Kind: ShapeEllipse, Points: []Point{{X: 330, Y: 600}, {X: 520, Y: 700}}, Stroke: RGB{R: 0.9, G: 0.4}, StrokeWidth: 3, Opacity: 1},
			{Kind: ShapeLine, Points: []Point{{X: 72, Y: 560}, {X: 520, Y: 560}}, Stroke: RGB{}, StrokeWidth: 1, Opacity: 1},
			{Kind: ShapePolyline, Points: []Point{{X: 72, Y: 480}, {X: 140, Y: 530}, {X: 210, Y: 470}, {X: 280, Y: 520}}, Stroke: RGB{R: 0.2, G: 0.5, B: 0.2}, StrokeWidth: 2.5, Opacity: 1, Rotation: 5},
		},
		Images: []ImageOverlay{{Image: logo, CenterX: 450, CenterY: 480, Width: 96, Height: 72, Opacity: 1, Rotation: -12}},
	}}
	outputPath := filepath.Join(directory, "overlay.pdf")
	file, err := os.Create(outputPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := WriteOverlayPDF(file, pages); err != nil {
		t.Fatal(err)
	}
	_ = file.Close()
	if err := RunCommand(context.Background(), "qpdf", directory, []string{"--check", outputPath}); err != nil {
		var toolErr *ToolError
		if errors.As(err, &toolErr) {
			t.Fatalf("qpdf --check failed: %v: %s", err, toolErr.Output)
		}
		t.Fatalf("qpdf --check failed: %v", err)
	}
	count, err := QPDFPageCount(context.Background(), outputPath)
	if err != nil || count == nil || *count != 1 {
		t.Fatalf("page count = %v, %v", count, err)
	}
}
