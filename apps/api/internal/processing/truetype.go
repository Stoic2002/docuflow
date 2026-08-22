package processing

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"os"
	"sort"
	"strings"
)

// Minimal TrueType reader. It extracts only what embedding a font into a PDF
// as a CIDFontType2 requires: metrics for the font descriptor, per-glyph
// advance widths, and a Unicode-to-glyph mapping. Outlines are never parsed;
// the original font program is embedded verbatim.

const (
	maxFontBytes = 12 << 20

	// fsType bits from the OS/2 table. A font whose vendor set the restricted
	// bit must not be embedded, so the registry refuses to load it.
	fsTypeRestricted = 0x0002
)

var (
	ErrInvalidFont       = errors.New("unsupported or malformed font file")
	ErrFontNotEmbeddable = errors.New("font license forbids embedding")
)

type TrueTypeFont struct {
	Data        []byte
	PostScript  string
	UnitsPerEm  float64
	Ascent      float64
	Descent     float64
	CapHeight   float64
	ItalicAngle float64
	BBox        [4]float64
	FixedPitch  bool
	Serif       bool
	// PanoseFamily is byte 0 of the OS/2 Panose block: 2 is Latin text,
	// 3 hand written, 4 decorative. It separates a display or script face from
	// an ordinary text face, which nothing else in the font reliably does.
	PanoseFamily uint8
	numGlyphs    int
	advances     []uint16
	runeToGlyph  map[rune]uint16
	restrictedBy uint16
	tables       map[string]tableRecord
	loca         []uint32
	longLoca     bool
}

type fontReader struct {
	data []byte
}

func (r fontReader) u8(offset int) (uint8, error) {
	if offset < 0 || offset+1 > len(r.data) {
		return 0, ErrInvalidFont
	}
	return r.data[offset], nil
}

func (r fontReader) u16(offset int) (uint16, error) {
	if offset < 0 || offset+2 > len(r.data) {
		return 0, ErrInvalidFont
	}
	return binary.BigEndian.Uint16(r.data[offset:]), nil
}

func (r fontReader) i16(offset int) (int16, error) {
	value, err := r.u16(offset)
	return int16(value), err
}

func (r fontReader) u32(offset int) (uint32, error) {
	if offset < 0 || offset+4 > len(r.data) {
		return 0, ErrInvalidFont
	}
	return binary.BigEndian.Uint32(r.data[offset:]), nil
}

type tableRecord struct {
	offset int
	length int
}

// ParseTrueType reads a .ttf font program. TrueType collections (.ttc) and
// CFF-flavoured OpenType (.otf) are rejected: a PDF FontFile2 stream must
// contain a single glyf-based font.
func ParseTrueType(data []byte) (*TrueTypeFont, error) {
	if len(data) < 12 || len(data) > maxFontBytes {
		return nil, ErrInvalidFont
	}
	reader := fontReader{data: data}
	version, err := reader.u32(0)
	if err != nil {
		return nil, err
	}
	if version != 0x00010000 && version != 0x74727565 {
		return nil, fmt.Errorf("%w: only glyf-based TrueType is supported", ErrInvalidFont)
	}
	numTables, err := reader.u16(4)
	if err != nil {
		return nil, err
	}
	tables := make(map[string]tableRecord, numTables)
	for index := 0; index < int(numTables); index++ {
		entry := 12 + index*16
		if entry+16 > len(data) {
			return nil, ErrInvalidFont
		}
		offset, offsetErr := reader.u32(entry + 8)
		length, lengthErr := reader.u32(entry + 12)
		if offsetErr != nil || lengthErr != nil {
			return nil, ErrInvalidFont
		}
		if int(offset) > len(data) || int(offset)+int(length) > len(data) {
			return nil, ErrInvalidFont
		}
		tables[string(data[entry:entry+4])] = tableRecord{offset: int(offset), length: int(length)}
	}
	for _, required := range []string{"head", "hhea", "maxp", "hmtx", "cmap", "glyf", "loca"} {
		if _, ok := tables[required]; !ok {
			return nil, fmt.Errorf("%w: missing %s table", ErrInvalidFont, required)
		}
	}
	font := &TrueTypeFont{Data: data, tables: tables}
	if err := font.readHead(reader, tables["head"]); err != nil {
		return nil, err
	}
	if err := font.readHhea(reader, tables["hhea"]); err != nil {
		return nil, err
	}
	if err := font.readMaxp(reader, tables["maxp"]); err != nil {
		return nil, err
	}
	if err := font.readHmtx(reader, tables["hmtx"]); err != nil {
		return nil, err
	}
	if err := font.readCmap(reader, tables["cmap"]); err != nil {
		return nil, err
	}
	if err := font.readLoca(reader, tables["loca"]); err != nil {
		return nil, err
	}
	font.readOS2(reader, tables["OS/2"])
	font.readPost(reader, tables["post"])
	font.readName(reader, tables["name"])
	if font.PostScript == "" {
		font.PostScript = "EmbeddedFont"
	}
	if font.CapHeight == 0 {
		font.CapHeight = font.Ascent
	}
	// The post table's isFixedPitch flag is unset in plenty of shipping fonts,
	// so pitch is confirmed from the advances themselves, which cannot lie.
	if measuredMonospace(font) {
		font.FixedPitch = true
	}
	return font, nil
}

// measuredMonospace checks whether characters of wildly different shapes all
// advance by the same amount.
func measuredMonospace(font *TrueTypeFont) bool {
	probes := []rune{'i', 'M', 'W', '.', 'l', '1', 'm'}
	var reference float64
	for _, probe := range probes {
		advance := font.Advance(probe)
		if advance == 0 {
			return false
		}
		if reference == 0 {
			reference = advance
			continue
		}
		if math.Abs(advance-reference) > 0.5 {
			return false
		}
	}
	return reference > 0
}

func (f *TrueTypeFont) readHead(reader fontReader, table tableRecord) error {
	locaFormat, err := reader.i16(table.offset + 50)
	if err != nil {
		return err
	}
	f.longLoca = locaFormat == 1
	unitsPerEm, err := reader.u16(table.offset + 18)
	if err != nil {
		return err
	}
	if unitsPerEm == 0 {
		return fmt.Errorf("%w: unitsPerEm is zero", ErrInvalidFont)
	}
	f.UnitsPerEm = float64(unitsPerEm)
	for index, offset := range []int{table.offset + 36, table.offset + 38, table.offset + 40, table.offset + 42} {
		value, err := reader.i16(offset)
		if err != nil {
			return err
		}
		f.BBox[index] = f.scale(float64(value))
	}
	return nil
}

func (f *TrueTypeFont) readHhea(reader fontReader, table tableRecord) error {
	ascent, err := reader.i16(table.offset + 4)
	if err != nil {
		return err
	}
	descent, err := reader.i16(table.offset + 6)
	if err != nil {
		return err
	}
	metrics, err := reader.u16(table.offset + 34)
	if err != nil {
		return err
	}
	f.Ascent = f.scale(float64(ascent))
	f.Descent = f.scale(float64(descent))
	f.advances = make([]uint16, 0, metrics)
	return nil
}

func (f *TrueTypeFont) readMaxp(reader fontReader, table tableRecord) error {
	numGlyphs, err := reader.u16(table.offset + 4)
	if err != nil {
		return err
	}
	if numGlyphs == 0 {
		return fmt.Errorf("%w: font has no glyphs", ErrInvalidFont)
	}
	f.numGlyphs = int(numGlyphs)
	return nil
}

// readHmtx stores one advance per glyph. Trailing glyphs beyond
// numberOfHMetrics repeat the final advance, which is how monospaced tails are
// encoded.
func (f *TrueTypeFont) readHmtx(reader fontReader, table tableRecord) error {
	metrics := cap(f.advances)
	if metrics == 0 || metrics > f.numGlyphs {
		metrics = f.numGlyphs
	}
	advances := make([]uint16, f.numGlyphs)
	var last uint16
	for index := 0; index < metrics; index++ {
		advance, err := reader.u16(table.offset + index*4)
		if err != nil {
			return err
		}
		advances[index], last = advance, advance
	}
	for index := metrics; index < f.numGlyphs; index++ {
		advances[index] = last
	}
	f.advances = advances
	return nil
}

func (f *TrueTypeFont) readCmap(reader fontReader, table tableRecord) error {
	count, err := reader.u16(table.offset + 2)
	if err != nil {
		return err
	}
	best, bestScore := -1, -1
	for index := 0; index < int(count); index++ {
		entry := table.offset + 4 + index*8
		platform, platformErr := reader.u16(entry)
		encoding, encodingErr := reader.u16(entry + 2)
		offset, offsetErr := reader.u32(entry + 4)
		if platformErr != nil || encodingErr != nil || offsetErr != nil {
			return ErrInvalidFont
		}
		// Prefer full Unicode coverage, then the BMP subtables.
		score := -1
		switch {
		case platform == 3 && encoding == 10:
			score = 4
		case platform == 0 && encoding >= 4:
			score = 3
		case platform == 3 && encoding == 1:
			score = 2
		case platform == 0:
			score = 1
		}
		if score > bestScore {
			best, bestScore = table.offset+int(offset), score
		}
	}
	if best < 0 {
		return fmt.Errorf("%w: no usable cmap subtable", ErrInvalidFont)
	}
	format, err := reader.u16(best)
	if err != nil {
		return err
	}
	f.runeToGlyph = map[rune]uint16{}
	switch format {
	case 4:
		return f.readCmapFormat4(reader, best)
	case 12:
		return f.readCmapFormat12(reader, best)
	default:
		return fmt.Errorf("%w: cmap format %d is unsupported", ErrInvalidFont, format)
	}
}

func (f *TrueTypeFont) readCmapFormat4(reader fontReader, offset int) error {
	segCountX2, err := reader.u16(offset + 6)
	if err != nil || segCountX2 == 0 || segCountX2%2 != 0 {
		return ErrInvalidFont
	}
	segCount := int(segCountX2 / 2)
	endBase := offset + 14
	startBase := endBase + segCount*2 + 2
	deltaBase := startBase + segCount*2
	rangeBase := deltaBase + segCount*2
	for segment := 0; segment < segCount; segment++ {
		end, endErr := reader.u16(endBase + segment*2)
		start, startErr := reader.u16(startBase + segment*2)
		delta, deltaErr := reader.i16(deltaBase + segment*2)
		rangeOffset, rangeErr := reader.u16(rangeBase + segment*2)
		if endErr != nil || startErr != nil || deltaErr != nil || rangeErr != nil {
			return ErrInvalidFont
		}
		if start > end || start == 0xFFFF {
			continue
		}
		for code := int(start); code <= int(end); code++ {
			var glyph uint16
			if rangeOffset == 0 {
				glyph = uint16(int(delta) + code)
			} else {
				address := rangeBase + segment*2 + int(rangeOffset) + (code-int(start))*2
				value, err := reader.u16(address)
				if err != nil || value == 0 {
					continue
				}
				glyph = uint16(int(delta) + int(value))
			}
			if glyph != 0 && int(glyph) < f.numGlyphs {
				f.runeToGlyph[rune(code)] = glyph
			}
		}
	}
	return nil
}

func (f *TrueTypeFont) readCmapFormat12(reader fontReader, offset int) error {
	groups, err := reader.u32(offset + 12)
	if err != nil {
		return err
	}
	for index := 0; index < int(groups); index++ {
		entry := offset + 16 + index*12
		start, startErr := reader.u32(entry)
		end, endErr := reader.u32(entry + 4)
		glyph, glyphErr := reader.u32(entry + 8)
		if startErr != nil || endErr != nil || glyphErr != nil {
			return ErrInvalidFont
		}
		if start > end || end-start > 0x10FFFF {
			continue
		}
		for code := start; code <= end; code++ {
			id := glyph + (code - start)
			if id != 0 && int(id) < f.numGlyphs {
				f.runeToGlyph[rune(code)] = uint16(id)
			}
		}
	}
	return nil
}

func (f *TrueTypeFont) readOS2(reader fontReader, table tableRecord) {
	if table.length == 0 {
		return
	}
	if fsType, err := reader.u16(table.offset + 8); err == nil {
		f.restrictedBy = fsType
	}
	version, err := reader.u16(table.offset)
	if err != nil {
		return
	}
	if version >= 2 && table.length >= 90 {
		if capHeight, err := reader.i16(table.offset + 88); err == nil && capHeight > 0 {
			f.CapHeight = f.scale(float64(capHeight))
		}
	}
	// Panose byte 0 is the family kind and byte 1 the serif style; serif
	// designs are Latin Text families whose style falls in the cove/square
	// range, leaving 11 and above as the sans-serif styles.
	family, familyErr := reader.u8(table.offset + 32)
	serifStyle, serifErr := reader.u8(table.offset + 33)
	if familyErr == nil {
		f.PanoseFamily = family
	}
	if familyErr == nil && serifErr == nil {
		f.Serif = family == 2 && serifStyle >= 2 && serifStyle <= 10
	}
}

func (f *TrueTypeFont) readPost(reader fontReader, table tableRecord) {
	if table.length < 16 {
		return
	}
	if raw, err := reader.u32(table.offset + 4); err == nil {
		f.ItalicAngle = float64(int32(raw)) / 65536
	}
	if fixed, err := reader.u32(table.offset + 12); err == nil {
		f.FixedPitch = fixed != 0
	}
}

// readName pulls the PostScript name (nameID 6), preferring the Windows
// UTF-16BE record that virtually every font ships.
func (f *TrueTypeFont) readName(reader fontReader, table tableRecord) {
	if table.length == 0 {
		return
	}
	count, countErr := reader.u16(table.offset + 2)
	storage, storageErr := reader.u16(table.offset + 4)
	if countErr != nil || storageErr != nil {
		return
	}
	for index := 0; index < int(count); index++ {
		entry := table.offset + 6 + index*12
		platform, platformErr := reader.u16(entry)
		nameID, nameErr := reader.u16(entry + 6)
		length, lengthErr := reader.u16(entry + 8)
		offset, offsetErr := reader.u16(entry + 10)
		if platformErr != nil || nameErr != nil || lengthErr != nil || offsetErr != nil || nameID != 6 {
			continue
		}
		start := table.offset + int(storage) + int(offset)
		if start < 0 || start+int(length) > len(reader.data) {
			continue
		}
		raw := reader.data[start : start+int(length)]
		var name string
		if platform == 3 || platform == 0 {
			var builder strings.Builder
			for position := 0; position+1 < len(raw); position += 2 {
				builder.WriteRune(rune(binary.BigEndian.Uint16(raw[position:])))
			}
			name = builder.String()
		} else {
			name = string(raw)
		}
		if cleaned := sanitizeFontName(name); cleaned != "" {
			f.PostScript = cleaned
			return
		}
	}
}

// sanitizeFontName keeps a name safe to write as a bare PDF name object.
func sanitizeFontName(value string) string {
	var builder strings.Builder
	for _, r := range value {
		if r > 32 && r < 127 && !strings.ContainsRune("()<>[]{}/%#", r) {
			builder.WriteRune(r)
		}
	}
	return builder.String()
}

func (f *TrueTypeFont) scale(value float64) float64 {
	if f.UnitsPerEm == 0 {
		return value
	}
	return value * 1000 / f.UnitsPerEm
}

// AllowsEmbedding reports the vendor's fsType permission. A restricted font is
// never written into an output PDF.
func (f *TrueTypeFont) AllowsEmbedding() bool {
	return f.restrictedBy&fsTypeRestricted == 0
}

func (f *TrueTypeFont) GlyphIndex(r rune) uint16 { return f.runeToGlyph[r] }

// Advance returns the glyph advance in 1/1000 em, the unit PDF text space uses.
func (f *TrueTypeFont) Advance(r rune) float64 {
	glyph := f.runeToGlyph[r]
	if int(glyph) >= len(f.advances) {
		return 0
	}
	return f.scale(float64(f.advances[glyph]))
}

func (f *TrueTypeFont) MeasureString(value string, fontSize float64) float64 {
	var total float64
	for _, r := range value {
		total += f.Advance(r)
	}
	return total * fontSize / 1000
}

// Supports reports whether every rune in the string has a glyph, so a caller
// can pick a different font instead of rendering .notdef boxes.
func (f *TrueTypeFont) Supports(value string) bool {
	for _, r := range value {
		if r == '\n' || r == '\r' || r == '\t' {
			continue
		}
		if _, ok := f.runeToGlyph[r]; !ok {
			return false
		}
	}
	return true
}

func (f *TrueTypeFont) descriptorFlags() int {
	flags := 32
	if f.FixedPitch {
		flags |= 1
	}
	if f.Serif {
		flags |= 2
	}
	if math.Abs(f.ItalicAngle) > 0.01 {
		flags |= 64
	}
	return flags
}

// usedGlyphs returns the sorted distinct glyph identifiers a set of strings
// needs, so only those widths reach the /W array.
func (f *TrueTypeFont) usedGlyphs(values []string) []uint16 {
	seen := map[uint16]bool{}
	for _, value := range values {
		for _, r := range value {
			if glyph, ok := f.runeToGlyph[r]; ok {
				seen[glyph] = true
			}
		}
	}
	glyphs := make([]uint16, 0, len(seen))
	for glyph := range seen {
		glyphs = append(glyphs, glyph)
	}
	sort.Slice(glyphs, func(a, b int) bool { return glyphs[a] < glyphs[b] })
	return glyphs
}

func LoadTrueTypeFile(path string) (*TrueTypeFont, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if info.Size() > maxFontBytes {
		return nil, fmt.Errorf("%w: font exceeds %d bytes", ErrInvalidFont, maxFontBytes)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	font, err := ParseTrueType(data)
	if err != nil {
		return nil, err
	}
	if !font.AllowsEmbedding() {
		return nil, ErrFontNotEmbeddable
	}
	return font, nil
}

// readLoca resolves the glyph offset table so a subset can copy individual
// outlines without decoding them.
func (f *TrueTypeFont) readLoca(reader fontReader, table tableRecord) error {
	f.loca = make([]uint32, f.numGlyphs+1)
	for index := 0; index <= f.numGlyphs; index++ {
		if f.longLoca {
			value, err := reader.u32(table.offset + index*4)
			if err != nil {
				return err
			}
			f.loca[index] = value
			continue
		}
		value, err := reader.u16(table.offset + index*2)
		if err != nil {
			return err
		}
		f.loca[index] = uint32(value) * 2
	}
	return nil
}

func (f *TrueTypeFont) glyphData(glyph uint16) []byte {
	table, ok := f.tables["glyf"]
	if !ok || int(glyph)+1 >= len(f.loca) {
		return nil
	}
	start, end := f.loca[glyph], f.loca[glyph+1]
	if end <= start || int(end) > table.length {
		return nil
	}
	return f.Data[table.offset+int(start) : table.offset+int(end)]
}

// glyphClosure expands a glyph set to include every component a composite
// glyph references, so accented characters keep their base and mark outlines.
func (f *TrueTypeFont) glyphClosure(glyphs []uint16) map[uint16]bool {
	keep := map[uint16]bool{}
	var visit func(uint16)
	visit = func(glyph uint16) {
		if keep[glyph] || int(glyph) >= f.numGlyphs {
			return
		}
		keep[glyph] = true
		data := f.glyphData(glyph)
		if len(data) < 10 || int16(binary.BigEndian.Uint16(data)) >= 0 {
			return
		}
		offset := 10
		for {
			if offset+4 > len(data) {
				return
			}
			flags := binary.BigEndian.Uint16(data[offset:])
			component := binary.BigEndian.Uint16(data[offset+2:])
			offset += 4
			if flags&0x0001 != 0 {
				offset += 4
			} else {
				offset += 2
			}
			switch {
			case flags&0x0008 != 0:
				offset += 2
			case flags&0x0040 != 0:
				offset += 4
			case flags&0x0080 != 0:
				offset += 8
			}
			visit(component)
			if flags&0x0020 == 0 {
				return
			}
		}
	}
	visit(0)
	for _, glyph := range glyphs {
		visit(glyph)
	}
	return keep
}

func tableChecksum(data []byte) uint32 {
	var sum uint32
	full := len(data) / 4 * 4
	for index := 0; index < full; index += 4 {
		sum += binary.BigEndian.Uint32(data[index:])
	}
	if remainder := len(data) - full; remainder > 0 {
		var padded [4]byte
		copy(padded[:], data[full:])
		sum += binary.BigEndian.Uint32(padded[:])
	}
	return sum
}

func pad4(data []byte) []byte {
	if remainder := len(data) % 4; remainder != 0 {
		return append(data, make([]byte, 4-remainder)...)
	}
	return data
}

// subsetTables are the only tables a PDF needs from a CIDFontType2 program.
// cmap, name, and post are dropped because Identity-H addresses glyphs
// directly and the ToUnicode CMap carries the text mapping.
var subsetTables = []string{"cvt ", "fpgm", "glyf", "head", "hhea", "hmtx", "loca", "maxp", "prep"}

// Subset rebuilds the font program keeping only the requested outlines. Glyph
// identifiers are preserved — unused glyphs become zero-length entries — so
// CIDToGIDMap stays /Identity and no re-encoding is needed.
func (f *TrueTypeFont) Subset(glyphs []uint16) ([]byte, error) {
	if _, ok := f.tables["glyf"]; !ok {
		return nil, ErrInvalidFont
	}
	keep := f.glyphClosure(glyphs)
	var glyf []byte
	loca := make([]byte, 0, (f.numGlyphs+1)*4)
	appendOffset := func(value int) {
		loca = append(loca, byte(value>>24), byte(value>>16), byte(value>>8), byte(value))
	}
	for glyph := 0; glyph < f.numGlyphs; glyph++ {
		appendOffset(len(glyf))
		if !keep[uint16(glyph)] {
			continue
		}
		outline := f.glyphData(uint16(glyph))
		glyf = append(glyf, outline...)
		if remainder := len(glyf) % 4; remainder != 0 {
			glyf = append(glyf, make([]byte, 4-remainder)...)
		}
	}
	appendOffset(len(glyf))

	built := map[string][]byte{"glyf": glyf, "loca": loca}
	for _, tag := range subsetTables {
		if _, done := built[tag]; done {
			continue
		}
		table, ok := f.tables[tag]
		if !ok {
			continue
		}
		copied := make([]byte, table.length)
		copy(copied, f.Data[table.offset:table.offset+table.length])
		built[tag] = copied
	}
	head, ok := built["head"]
	if !ok || len(head) < 54 {
		return nil, ErrInvalidFont
	}
	// The rebuilt loca is always long format, and the checksum adjustment is
	// recomputed once the whole file exists.
	binary.BigEndian.PutUint16(head[50:], 1)
	binary.BigEndian.PutUint32(head[8:], 0)

	tags := make([]string, 0, len(built))
	for tag := range built {
		tags = append(tags, tag)
	}
	sort.Strings(tags)

	numTables := len(tags)
	entrySelector := 0
	for 1<<(entrySelector+1) <= numTables {
		entrySelector++
	}
	searchRange := 16 << entrySelector
	header := make([]byte, 12+numTables*16)
	binary.BigEndian.PutUint32(header[0:], 0x00010000)
	binary.BigEndian.PutUint16(header[4:], uint16(numTables))
	binary.BigEndian.PutUint16(header[6:], uint16(searchRange))
	binary.BigEndian.PutUint16(header[8:], uint16(entrySelector))
	binary.BigEndian.PutUint16(header[10:], uint16(numTables*16-searchRange))

	body := []byte{}
	offset := len(header)
	for index, tag := range tags {
		data := built[tag]
		entry := 12 + index*16
		copy(header[entry:], tag)
		binary.BigEndian.PutUint32(header[entry+4:], tableChecksum(data))
		binary.BigEndian.PutUint32(header[entry+8:], uint32(offset))
		binary.BigEndian.PutUint32(header[entry+12:], uint32(len(data)))
		padded := pad4(append([]byte{}, data...))
		body = append(body, padded...)
		offset += len(padded)
	}
	font := append(header, body...)
	adjustment := 0xB1B0AFBA - tableChecksum(font)
	headOffset := 0
	for index, tag := range tags {
		if tag == "head" {
			headOffset = int(binary.BigEndian.Uint32(header[12+index*16+8:]))
		}
	}
	binary.BigEndian.PutUint32(font[headOffset+8:], adjustment)
	return font, nil
}
