package processing

import (
	"fmt"
	"sort"
	"strings"
)

// Font handling for the overlay writer. Text is drawn either with the built-in
// Helvetica, which needs no embedding but only covers Latin-1, or with a
// registered TrueType font embedded as a CIDFontType2 under Identity-H, which
// covers whatever the font itself covers.

// helveticaWidths holds the Adobe AFM advances for printable ASCII, indexed
// from the space character. They make centre and right alignment exact for the
// default font instead of relying on an average-width guess.
var helveticaWidths = [95]float64{
	278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
	556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
	1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
	667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
	333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
	556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
}

// helveticaAdvance returns the advance in 1/1000 em. Latin-1 accents outside
// the ASCII table fall back to the lowercase average, which is close enough for
// alignment and never used for the glyphs themselves.
func helveticaAdvance(r rune) float64 {
	if r >= 32 && r <= 126 {
		return helveticaWidths[r-32]
	}
	if r > 126 && r <= 255 {
		return 556
	}
	return 0
}

// resolvedFont binds one TextOverlay font choice to the PDF resource that will
// render it. A nil ttf means the built-in Helvetica.
type resolvedFont struct {
	resource string
	ttf      *TrueTypeFont
	texts    []string
}

func (f *resolvedFont) measure(value string, fontSize float64) float64 {
	if f.ttf != nil {
		return f.ttf.MeasureString(value, fontSize)
	}
	var total float64
	for _, r := range value {
		total += helveticaAdvance(r)
	}
	return total * fontSize / 1000
}

// show renders the string operand. Identity-H addresses glyphs directly, so an
// embedded font writes glyph identifiers as a hex string rather than text.
func (f *resolvedFont) show(value string) string {
	if f.ttf == nil {
		return fmt.Sprintf("(%s) Tj", escapePDFText(value))
	}
	var builder strings.Builder
	builder.WriteByte('<')
	for _, r := range value {
		fmt.Fprintf(&builder, "%04X", f.ttf.GlyphIndex(r))
	}
	builder.WriteString("> Tj")
	return builder.String()
}

// utf16beHex encodes a rune the way a ToUnicode CMap expects, splitting
// astral characters into a surrogate pair.
func utf16beHex(r rune) string {
	if r > 0xFFFF {
		r -= 0x10000
		return fmt.Sprintf("%04X%04X", 0xD800+(r>>10), 0xDC00+(r&0x3FF))
	}
	return fmt.Sprintf("%04X", r)
}

// resolveFonts maps every font referenced by the pages onto a PDF resource,
// rejecting an unknown font or a string the chosen font cannot render rather
// than silently drawing .notdef boxes.
func resolveFonts(pages []OverlayPage, registry *FontRegistry) (map[string]*resolvedFont, []*resolvedFont, error) {
	resolved := map[string]*resolvedFont{"": {resource: "F1"}}
	embedded := []*resolvedFont{}
	for _, page := range pages {
		for _, text := range page.Texts {
			entry, ok := resolved[text.Font]
			if !ok {
				font, err := registry.Lookup(text.Font)
				if err != nil {
					return nil, nil, err
				}
				entry = &resolvedFont{resource: fmt.Sprintf("F%d", len(embedded)+2), ttf: font}
				resolved[text.Font] = entry
				embedded = append(embedded, entry)
			}
			if entry.ttf != nil && !entry.ttf.Supports(text.Text) {
				return nil, nil, fmt.Errorf("font %q cannot render %q", text.Font, missingRunes(entry.ttf, text.Text))
			}
			entry.texts = append(entry.texts, text.Text)
		}
	}
	return resolved, embedded, nil
}

func missingRunes(font *TrueTypeFont, value string) string {
	var builder strings.Builder
	seen := map[rune]bool{}
	for _, r := range value {
		if _, ok := font.runeToGlyph[r]; ok || seen[r] {
			continue
		}
		seen[r] = true
		builder.WriteRune(r)
	}
	return builder.String()
}

// fontObjects numbers the five PDF objects one embedded font needs.
type fontObjects struct {
	typeZero   int
	cidFont    int
	descriptor int
	fontFile   int
	toUnicode  int
}

const objectsPerEmbeddedFont = 5

func (w *pdfWriter) writeRaw(data []byte) {
	if w.err != nil {
		return
	}
	_, w.err = w.file.Write(data)
}

// writeEmbeddedFont emits the Type0 wrapper, its CIDFontType2 descendant, the
// descriptor, the font program, and the ToUnicode CMap that keeps the text
// selectable and searchable.
func writeEmbeddedFont(writer *pdfWriter, entry *resolvedFont, ids fontObjects) error {
	font := entry.ttf
	glyphs := font.usedGlyphs(entry.texts)
	// Only the outlines this document draws are embedded; a full Arial is
	// roughly half a megabyte, a subset of it a few kilobytes.
	program, err := font.Subset(glyphs)
	if err != nil {
		return fmt.Errorf("subset %s: %w", font.PostScript, err)
	}

	writer.startObject(ids.typeZero)
	writer.write(fmt.Sprintf("<< /Type /Font /Subtype /Type0 /BaseFont /%s /Encoding /Identity-H /DescendantFonts [%d 0 R] /ToUnicode %d 0 R >>",
		font.PostScript, ids.cidFont, ids.toUnicode))
	writer.endObject()

	var widths strings.Builder
	for _, glyph := range glyphs {
		advance := 0.0
		if int(glyph) < len(font.advances) {
			advance = font.scale(float64(font.advances[glyph]))
		}
		fmt.Fprintf(&widths, "%d [%.0f] ", glyph, advance)
	}
	writer.startObject(ids.cidFont)
	writer.write(fmt.Sprintf("<< /Type /Font /Subtype /CIDFontType2 /BaseFont /%s /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor %d 0 R /DW 1000 /W [%s] /CIDToGIDMap /Identity >>",
		font.PostScript, ids.descriptor, strings.TrimSpace(widths.String())))
	writer.endObject()

	// StemV has no counterpart in a TrueType table; a mid-range constant is the
	// conventional substitute and only affects hinting hints for the viewer.
	writer.startObject(ids.descriptor)
	writer.write(fmt.Sprintf("<< /Type /FontDescriptor /FontName /%s /Flags %d /FontBBox [%.0f %.0f %.0f %.0f] /ItalicAngle %.1f /Ascent %.0f /Descent %.0f /CapHeight %.0f /StemV 80 /FontFile2 %d 0 R >>",
		font.PostScript, font.descriptorFlags(), font.BBox[0], font.BBox[1], font.BBox[2], font.BBox[3],
		font.ItalicAngle, font.Ascent, font.Descent, font.CapHeight, ids.fontFile))
	writer.endObject()

	writer.startObject(ids.fontFile)
	writer.write(fmt.Sprintf("<< /Length %d /Length1 %d >>\nstream\n", len(program), len(program)))
	writer.writeRaw(program)
	writer.write("\nendstream")
	writer.endObject()

	cmap := buildToUnicodeCMap(font, entry.texts)
	writer.startObject(ids.toUnicode)
	writer.write(fmt.Sprintf("<< /Length %d >>\nstream\n%sendstream", len(cmap), cmap))
	writer.endObject()
	return nil
}

func buildToUnicodeCMap(font *TrueTypeFont, texts []string) string {
	mapping := map[uint16]rune{}
	for _, text := range texts {
		for _, r := range text {
			if glyph, ok := font.runeToGlyph[r]; ok {
				if _, exists := mapping[glyph]; !exists {
					mapping[glyph] = r
				}
			}
		}
	}
	glyphs := make([]uint16, 0, len(mapping))
	for glyph := range mapping {
		glyphs = append(glyphs, glyph)
	}
	sort.Slice(glyphs, func(a, b int) bool { return glyphs[a] < glyphs[b] })

	var builder strings.Builder
	builder.WriteString("/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n")
	builder.WriteString("/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n")
	builder.WriteString("/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n")
	builder.WriteString("1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n")
	// A bfchar section may hold at most 100 entries, so long runs are chunked.
	for start := 0; start < len(glyphs); start += 100 {
		end := start + 100
		if end > len(glyphs) {
			end = len(glyphs)
		}
		fmt.Fprintf(&builder, "%d beginbfchar\n", end-start)
		for _, glyph := range glyphs[start:end] {
			fmt.Fprintf(&builder, "<%04X> <%s>\n", glyph, utf16beHex(mapping[glyph]))
		}
		builder.WriteString("endbfchar\n")
	}
	builder.WriteString("endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n")
	return builder.String()
}
