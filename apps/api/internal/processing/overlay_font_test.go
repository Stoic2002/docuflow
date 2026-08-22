package processing

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

const systemFontDir = "/System/Library/Fonts/Supplemental"

// fontFixtureDir builds a registry directory from fonts the host happens to
// ship. Like the qpdf tests, it skips rather than fails when they are absent.
func fontFixtureDir(t *testing.T, names ...string) string {
	t.Helper()
	directory := t.TempDir()
	copied := 0
	for _, name := range names {
		data, err := os.ReadFile(filepath.Join(systemFontDir, name))
		if err != nil {
			continue
		}
		if err := os.WriteFile(filepath.Join(directory, name), data, 0o600); err != nil {
			t.Fatal(err)
		}
		copied++
	}
	if copied != len(names) {
		t.Skipf("host does not provide the test fonts %v", names)
	}
	return directory
}

func TestFontRegistryScansDirectory(t *testing.T) {
	directory := fontFixtureDir(t, "Arial.ttf", "Georgia.ttf")
	if err := os.WriteFile(filepath.Join(directory, "notes.txt"), []byte("ignored"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "broken.ttf"), []byte("not a font"), 0o600); err != nil {
		t.Fatal(err)
	}
	registry := LoadFontRegistry(directory)
	available := registry.Available()
	if len(available) != 2 {
		t.Fatalf("Available() = %#v, want two fonts", available)
	}
	byID := map[string]RegisteredFont{}
	for _, font := range available {
		byID[font.ID] = font
	}
	arial, ok := byID["arialmt"]
	if !ok {
		t.Fatalf("Arial was not registered: %#v", available)
	}
	if arial.Serif {
		t.Error("Arial must not be classified as a serif face")
	}
	georgia, ok := byID["georgia"]
	if !ok {
		t.Fatalf("Georgia was not registered: %#v", available)
	}
	if !georgia.Serif {
		t.Error("Georgia must be classified as a serif face")
	}
	// A malformed file is reported rather than silently dropped.
	if len(registry.Issues()) != 1 || registry.Issues()[0].File != "broken.ttf" {
		t.Fatalf("Issues() = %#v, want one entry for broken.ttf", registry.Issues())
	}
	if _, err := registry.Lookup("does-not-exist"); !errors.Is(err, ErrFontUnknown) {
		t.Fatalf("Lookup(unknown) = %v, want ErrFontUnknown", err)
	}
	if font, err := registry.Lookup(""); font != nil || err != nil {
		t.Fatalf(`Lookup("") = %v, %v, want the built-in default`, font, err)
	}
}

func TestNilRegistryOnlyAllowsTheBuiltInFont(t *testing.T) {
	var registry *FontRegistry
	if registry.Available() != nil {
		t.Error("a nil registry must offer no embeddable fonts")
	}
	if _, err := registry.Lookup("arialmt"); !errors.Is(err, ErrFontUnknown) {
		t.Fatalf("Lookup on nil registry = %v, want ErrFontUnknown", err)
	}
}

func TestOverlayRejectsUnknownFont(t *testing.T) {
	directory := fontFixtureDir(t, "Arial.ttf")
	registry := LoadFontRegistry(directory)
	file, err := os.Create(filepath.Join(t.TempDir(), "out.pdf"))
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	pages := []OverlayPage{{
		PageSize: PageSize{Width: 612, Height: 792},
		Texts:    []TextOverlay{{Text: "Halo", X: 10, Y: 10, FontSize: 12, Opacity: 1, Font: "comic-sans"}},
	}}
	if err := WriteOverlayPDFWithFonts(file, pages, registry); !errors.Is(err, ErrFontUnknown) {
		t.Fatalf("WriteOverlayPDFWithFonts = %v, want ErrFontUnknown", err)
	}
}

func TestOverlayRejectsGlyphsTheFontLacks(t *testing.T) {
	directory := fontFixtureDir(t, "Georgia.ttf")
	registry := LoadFontRegistry(directory)
	file, err := os.Create(filepath.Join(t.TempDir(), "out.pdf"))
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	pages := []OverlayPage{{
		PageSize: PageSize{Width: 612, Height: 792},
		Texts:    []TextOverlay{{Text: "日本語", X: 10, Y: 10, FontSize: 12, Opacity: 1, Font: "georgia"}},
	}}
	err = WriteOverlayPDFWithFonts(file, pages, registry)
	if err == nil || !strings.Contains(err.Error(), "cannot render") {
		t.Fatalf("WriteOverlayPDFWithFonts = %v, want a missing-glyph error", err)
	}
}

func TestEmbeddedFontRoundTripsThroughTextExtraction(t *testing.T) {
	for _, tool := range []string{"qpdf", "pdftotext"} {
		if _, err := exec.LookPath(tool); err != nil {
			t.Skipf("%s is optional", tool)
		}
	}
	directory := fontFixtureDir(t, "Arial.ttf", "Georgia.ttf")
	registry := LoadFontRegistry(directory)
	// Characters beyond Latin-1 are the whole point of embedding: the built-in
	// Helvetica path would replace them with question marks.
	const unicodeLine = "Ékonomi Ωmega — kutipan “miring” ±½"
	pages := []OverlayPage{{
		PageSize: PageSize{Width: 595.28, Height: 841.89},
		Texts: []TextOverlay{
			{Text: "Arial embedded", X: 60, Y: 760, FontSize: 20, Opacity: 1, Font: "arialmt"},
			{Text: unicodeLine, X: 60, Y: 720, FontSize: 14, Opacity: 1, Font: "arialmt"},
			{Text: "Georgia embedded", X: 60, Y: 680, FontSize: 16, Opacity: 1, Font: "georgia", Color: RGB{R: 0.8}},
			{Text: "Helvetica bawaan", X: 60, Y: 640, FontSize: 14, Opacity: 1},
		},
	}}
	outputPath := filepath.Join(t.TempDir(), "fonts.pdf")
	file, err := os.Create(outputPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := WriteOverlayPDFWithFonts(file, pages, registry); err != nil {
		t.Fatal(err)
	}
	_ = file.Close()

	if err := RunCommand(context.Background(), "qpdf", filepath.Dir(outputPath), []string{"--check", outputPath}); err != nil {
		var toolErr *ToolError
		if errors.As(err, &toolErr) {
			t.Fatalf("qpdf --check: %v: %s", err, toolErr.Output)
		}
		t.Fatalf("qpdf --check: %v", err)
	}
	raw, err := os.ReadFile(outputPath)
	if err != nil {
		t.Fatal(err)
	}
	body := string(raw)
	for _, want := range []string{"/Subtype /Type0", "/Encoding /Identity-H", "/Subtype /CIDFontType2", "/FontFile2", "/ToUnicode", "/CIDToGIDMap /Identity"} {
		if !strings.Contains(body, want) {
			t.Errorf("output PDF is missing %s", want)
		}
	}
	if embedded := strings.Count(body, "/FontFile2"); embedded != 2 {
		t.Errorf("embedded font programs = %d, want 2", embedded)
	}

	// The strongest check: a reader must recover the original characters, which
	// only works when the ToUnicode CMap is correct.
	extracted, err := RunAndCapture(context.Background(), "pdftotext", []string{outputPath, "-"})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"Arial embedded", "Georgia embedded", "Helvetica bawaan", unicodeLine} {
		if !strings.Contains(extracted, want) {
			t.Errorf("pdftotext did not recover %q from:\n%s", want, extracted)
		}
	}
}

func TestDocumentFontsReportsEmbeddedFaces(t *testing.T) {
	if !PDFFontsAvailable() {
		t.Skip("pdffonts is optional")
	}
	directory := fontFixtureDir(t, "Arial.ttf")
	registry := LoadFontRegistry(directory)
	outputPath := filepath.Join(t.TempDir(), "scan.pdf")
	file, err := os.Create(outputPath)
	if err != nil {
		t.Fatal(err)
	}
	pages := []OverlayPage{{
		PageSize: PageSize{Width: 612, Height: 792},
		Texts: []TextOverlay{
			{Text: "Embedded Arial", X: 40, Y: 700, FontSize: 18, Opacity: 1, Font: "arialmt"},
			{Text: "Built-in Helvetica", X: 40, Y: 660, FontSize: 18, Opacity: 1},
		},
	}}
	if err := WriteOverlayPDFWithFonts(file, pages, registry); err != nil {
		t.Fatal(err)
	}
	_ = file.Close()

	fonts, err := DocumentFonts(context.Background(), outputPath, "")
	if err != nil {
		t.Fatal(err)
	}
	var sawEmbedded, sawStandard bool
	for _, font := range fonts {
		if strings.Contains(font.Name, "ArialMT") && font.Embedded {
			sawEmbedded = true
		}
		if strings.Contains(font.Name, "Helvetica") && !font.Embedded {
			sawStandard = true
		}
	}
	if !sawEmbedded {
		t.Errorf("DocumentFonts did not report the embedded Arial: %#v", fonts)
	}
	if !sawStandard {
		t.Errorf("DocumentFonts did not report the non-embedded Helvetica: %#v", fonts)
	}
}

func TestSubsetShrinksTheFontProgram(t *testing.T) {
	directory := fontFixtureDir(t, "Arial.ttf")
	font, err := LoadTrueTypeFile(filepath.Join(directory, "Arial.ttf"))
	if err != nil {
		t.Fatal(err)
	}
	glyphs := font.usedGlyphs([]string{"Halo dunia"})
	subset, err := font.Subset(glyphs)
	if err != nil {
		t.Fatal(err)
	}
	if len(subset) >= len(font.Data)/4 {
		t.Fatalf("subset is %d bytes against a %d byte original; expected a large reduction", len(subset), len(font.Data))
	}
	// The rebuilt file must still be a TrueType container the viewer can read.
	if len(subset) < 12 || string(subset[0:4]) != "\x00\x01\x00\x00" {
		t.Fatal("subset lost its TrueType signature")
	}
	tags := map[string]bool{}
	numTables := int(subset[4])<<8 | int(subset[5])
	for index := 0; index < numTables; index++ {
		entry := 12 + index*16
		tags[string(subset[entry:entry+4])] = true
	}
	for _, required := range []string{"head", "hhea", "maxp", "hmtx", "loca", "glyf"} {
		if !tags[required] {
			t.Errorf("subset is missing the %s table", required)
		}
	}
	// Identity-H addresses glyphs directly, so cmap is deliberately dropped.
	if tags["cmap"] {
		t.Error("subset should not carry a cmap table")
	}
}

func TestSubsetKeepsCompositeGlyphComponents(t *testing.T) {
	directory := fontFixtureDir(t, "Arial.ttf")
	font, err := LoadTrueTypeFile(filepath.Join(directory, "Arial.ttf"))
	if err != nil {
		t.Fatal(err)
	}
	// "É" is a composite of the E outline and an acute accent, so its closure
	// must pull in more glyphs than the single requested identifier.
	accented := font.GlyphIndex('É')
	if accented == 0 {
		t.Skip("host Arial has no É glyph")
	}
	closure := font.glyphClosure([]uint16{accented})
	if !closure[accented] {
		t.Fatal("closure dropped the requested glyph")
	}
	if len(closure) < 3 {
		t.Fatalf("closure = %d glyphs, expected .notdef plus the composite and its components", len(closure))
	}
	if base := font.GlyphIndex('E'); base != 0 && !closure[base] {
		t.Error("closure did not pull in the base E outline the composite references")
	}
}
