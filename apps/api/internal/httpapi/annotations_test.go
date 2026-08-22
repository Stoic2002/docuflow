package httpapi

import (
	"math"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/local/pdf-web-studio/apps/api/internal/processing"
)

func TestParseHexColor(t *testing.T) {
	cases := []struct {
		input   string
		r, g, b float64
		wantErr bool
	}{
		{input: "#ffffff", r: 1, g: 1, b: 1},
		{input: "#000000"},
		{input: "ff0000", r: 1},
		{input: "#f00", r: 1},
		{input: "  #00ff00  ", g: 1},
		{input: "#0000ff", b: 1},
		{input: "#12345", wantErr: true},
		{input: "#gggggg", wantErr: true},
		{input: "rebeccapurple", wantErr: true},
		{input: "", wantErr: true},
	}
	for _, testCase := range cases {
		t.Run(testCase.input, func(t *testing.T) {
			color, err := parseHexColor(testCase.input)
			if testCase.wantErr {
				if err == nil {
					t.Fatalf("parseHexColor(%q) accepted an invalid colour", testCase.input)
				}
				return
			}
			if err != nil {
				t.Fatalf("parseHexColor(%q) = %v", testCase.input, err)
			}
			if math.Abs(color.R-testCase.r) > 0.001 || math.Abs(color.G-testCase.g) > 0.001 || math.Abs(color.B-testCase.b) > 0.001 {
				t.Fatalf("parseHexColor(%q) = %#v", testCase.input, color)
			}
		})
	}
}

func TestAnnotationDefaultsMatchTheEngine(t *testing.T) {
	fill := "#102030"
	request := annotationRequest{Pages: []annotationPageRequest{{
		Page:   1,
		Texts:  []annotationTextRequest{{Text: "tanpa opsi", X: 10, Y: 20, FontSize: 12}},
		Shapes: []annotationShapeRequest{{Kind: "rectangle", Fill: &fill}},
		Images: []annotationImageRequest{{Asset: "logo", Width: 10, Height: 10}},
	}}}
	document, err := request.toDocument()
	if err != nil {
		t.Fatal(err)
	}
	page := document.Pages[0]
	// An omitted opacity must mean fully opaque, never invisible.
	if page.Texts[0].Opacity != 1 || page.Shapes[0].Opacity != 1 || page.Images[0].Opacity != 1 {
		t.Error("omitted opacity did not default to 1")
	}
	// An omitted colour is black, matching the engine's zero value.
	if page.Texts[0].Color != (processing.RGB{}) {
		t.Errorf("omitted colour = %#v, want black", page.Texts[0].Color)
	}
	if page.Shapes[0].StrokeWidth != 1 {
		t.Errorf("omitted stroke width = %v, want 1", page.Shapes[0].StrokeWidth)
	}
	if page.Shapes[0].Fill == nil || math.Abs(page.Shapes[0].Fill.R-16.0/255) > 0.001 {
		t.Errorf("fill = %#v, want #102030 parsed", page.Shapes[0].Fill)
	}
}

func TestAnnotationOmittedFillStaysUnfilled(t *testing.T) {
	request := annotationRequest{Pages: []annotationPageRequest{{
		Page:   1,
		Shapes: []annotationShapeRequest{{Kind: "line"}},
	}}}
	document, err := request.toDocument()
	if err != nil {
		t.Fatal(err)
	}
	if document.Pages[0].Shapes[0].Fill != nil {
		t.Error("an omitted fill must leave the shape unfilled")
	}
}

func TestAnnotationRejectsBadColour(t *testing.T) {
	request := annotationRequest{Pages: []annotationPageRequest{{
		Page:  1,
		Texts: []annotationTextRequest{{Text: "x", Color: "not-a-colour"}},
	}}}
	if _, err := request.toDocument(); err == nil {
		t.Fatal("toDocument accepted an invalid colour")
	}
}

func TestDecodeAnnotationJSON(t *testing.T) {
	cases := []struct {
		name string
		body string
		ok   bool
	}{
		{"valid document", `{"pages":[{"page":1,"texts":[{"text":"a","x":1,"y":2,"fontSize":10}]}]}`, true},
		{"empty object", `{}`, true},
		{"unknown field", `{"pages":[],"sneaky":true}`, false},
		{"trailing object", `{"pages":[]}{"pages":[]}`, false},
		{"not an object", `[1,2,3]`, false},
		{"truncated", `{"pages":`, false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			_, ok := decodeAnnotationJSON(recorder, strings.NewReader(testCase.body))
			if ok != testCase.ok {
				t.Fatalf("decodeAnnotationJSON(%s) ok = %v, want %v (body: %s)", testCase.name, ok, testCase.ok, recorder.Body.String())
			}
		})
	}
}
