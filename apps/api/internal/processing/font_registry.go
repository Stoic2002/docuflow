package processing

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"unicode"
)

// A FontRegistry is built from a directory of .ttf files that the deployment
// supplies, mirroring how qpdf and OCRmyPDF are treated: a missing or empty
// directory degrades the font list instead of failing startup.

const maxRegistryFonts = 64

var ErrFontUnknown = errors.New("font is not registered")

type RegisteredFont struct {
	ID     string `json:"id"`
	Family string `json:"family"`
	Serif  bool   `json:"serif"`
	Fixed  bool   `json:"fixed"`
	font   *TrueTypeFont
}

// FontIssue records a file the registry deliberately refused, so /settings can
// explain the gap rather than silently dropping a font.
type FontIssue struct {
	File   string `json:"file"`
	Reason string `json:"reason"`
}

type FontRegistry struct {
	byID   map[string]*RegisteredFont
	order  []*RegisteredFont
	issues []FontIssue
	dir    string
}

func slugFont(value string) string {
	var builder strings.Builder
	previousDash := false
	for _, r := range value {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			builder.WriteRune(unicode.ToLower(r))
			previousDash = false
		case !previousDash && builder.Len() > 0:
			builder.WriteByte('-')
			previousDash = true
		}
	}
	return strings.Trim(builder.String(), "-")
}

// LoadFontRegistry scans a directory for embeddable TrueType fonts. It never
// returns an error for a missing directory; an empty registry simply means only
// the built-in Helvetica is offered.
func LoadFontRegistry(directory string) *FontRegistry {
	registry := &FontRegistry{byID: map[string]*RegisteredFont{}, dir: directory}
	if directory == "" {
		return registry
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		return registry
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.EqualFold(filepath.Ext(entry.Name()), ".ttf") {
			continue
		}
		names = append(names, entry.Name())
	}
	sort.Strings(names)
	for _, name := range names {
		if len(registry.order) >= maxRegistryFonts {
			registry.issues = append(registry.issues, FontIssue{File: name, Reason: fmt.Sprintf("registry is limited to %d fonts", maxRegistryFonts)})
			continue
		}
		font, err := LoadTrueTypeFile(filepath.Join(directory, name))
		if err != nil {
			reason := err.Error()
			if errors.Is(err, ErrFontNotEmbeddable) {
				reason = "the vendor's license forbids embedding this font in a PDF"
			}
			registry.issues = append(registry.issues, FontIssue{File: name, Reason: reason})
			continue
		}
		id := slugFont(font.PostScript)
		if id == "" {
			id = slugFont(strings.TrimSuffix(name, filepath.Ext(name)))
		}
		if _, clash := registry.byID[id]; clash {
			registry.issues = append(registry.issues, FontIssue{File: name, Reason: fmt.Sprintf("another font already registered the id %q", id)})
			continue
		}
		entry := &RegisteredFont{ID: id, Family: font.PostScript, Serif: font.Serif, Fixed: font.FixedPitch, font: font}
		registry.byID[id] = entry
		registry.order = append(registry.order, entry)
	}
	return registry
}

func (r *FontRegistry) Directory() string { return r.dir }

func (r *FontRegistry) Issues() []FontIssue {
	if r == nil {
		return nil
	}
	return r.issues
}

// Available lists the embeddable fonts an editor may offer.
func (r *FontRegistry) Available() []RegisteredFont {
	if r == nil {
		return nil
	}
	list := make([]RegisteredFont, 0, len(r.order))
	for _, entry := range r.order {
		list = append(list, RegisteredFont{ID: entry.ID, Family: entry.Family, Serif: entry.Serif, Fixed: entry.Fixed})
	}
	return list
}

func (r *FontRegistry) Lookup(id string) (*TrueTypeFont, error) {
	if id == "" {
		return nil, nil
	}
	if r == nil {
		return nil, fmt.Errorf("%w: %s", ErrFontUnknown, id)
	}
	entry, ok := r.byID[id]
	if !ok {
		return nil, fmt.Errorf("%w: %s", ErrFontUnknown, id)
	}
	return entry.font, nil
}

// DocumentFont is one font already embedded in an uploaded PDF, as reported by
// pdffonts.
type DocumentFont struct {
	Name     string `json:"name"`
	Type     string `json:"type"`
	Embedded bool   `json:"embedded"`
	Subset   bool   `json:"subset"`
}

// DocumentFonts lists the fonts a PDF already uses. It lets the editor offer
// the document's own typefaces first, so added text matches what is on the
// page instead of defaulting to Helvetica.
func DocumentFonts(ctx context.Context, inputPath, password string) ([]DocumentFont, error) {
	args := []string{}
	if password != "" {
		args = append(args, "-upw", password)
	}
	args = append(args, inputPath)
	output, err := RunAndCapture(ctx, "pdffonts", args)
	if err != nil {
		return nil, err
	}
	lines := strings.Split(output, "\n")
	fonts := []DocumentFont{}
	seen := map[string]bool{}
	for index, line := range lines {
		// The first two lines are the column header and its underline rule.
		if index < 2 || strings.TrimSpace(line) == "" {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		name := fields[0]
		// pdffonts prefixes subset fonts with a six-letter tag and a plus sign.
		subset := len(name) > 7 && name[6] == '+'
		if subset {
			name = name[7:]
		}
		embedded := false
		for _, field := range fields[1:] {
			if field == "yes" {
				embedded = true
				break
			}
		}
		key := name + "|" + fields[1]
		if seen[key] {
			continue
		}
		seen[key] = true
		fonts = append(fonts, DocumentFont{Name: name, Type: fields[1], Embedded: embedded, Subset: subset})
	}
	return fonts, nil
}

func PDFFontsAvailable() bool {
	_, err := exec.LookPath("pdffonts")
	return err == nil
}
