package documents

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/local/pdf-web-studio/apps/api/internal/processing"
)

var (
	ErrInvalidPassword       = errors.New("invalid PDF password")
	ErrPDFNotEncrypted       = errors.New("PDF is not encrypted")
	ErrInvalidFilename       = errors.New("invalid document filename")
	ErrInvalidWatermarkImage = errors.New("invalid watermark image")
	ErrSignatureConfirmation = errors.New("signature invalidation confirmation required")
)

type signatureConfirmationKey struct{}

func WithSignatureConfirmation(ctx context.Context, confirmed bool) context.Context {
	return context.WithValue(ctx, signatureConfirmationKey{}, confirmed)
}
func signatureConfirmed(ctx context.Context) bool {
	value, _ := ctx.Value(signatureConfirmationKey{}).(bool)
	return value
}

func (s *Service) HasSignatures(ctx context.Context, documentID uuid.UUID) (bool, error) {
	_, _, input, err := s.operationInput(ctx, documentID)
	if err != nil {
		return false, err
	}
	return processing.QPDFHasSignatures(ctx, input)
}

type InsertOptions struct {
	Position string
	Page     int
}

type ProtectionOptions struct {
	Password     string
	Printing     bool
	Copying      bool
	Modification bool
	Annotation   bool
	FormFilling  bool
	Assembly     bool
}

type WatermarkOptions struct {
	Text       string
	FontSize   float64
	Opacity    float64
	Rotation   float64
	Horizontal string
	Vertical   string
	PageRange  string
	Foreground bool
	Scale      float64
}

type PageNumberOptions struct {
	Position     string
	StartNumber  int
	PageRange    string
	FontSize     float64
	Margin       float64
	Prefix       string
	Suffix       string
	IncludeTotal bool
	SkipFirst    bool
}

type HeaderFooterBand struct {
	Left   string
	Center string
	Right  string
}

type HeaderFooterOptions struct {
	Header    HeaderFooterBand
	Footer    HeaderFooterBand
	FontSize  float64
	Margin    float64
	PageRange string
	SkipFirst bool
}

func validatePagesAllowDuplicates(pages []int, pageCount int) error {
	if len(pages) == 0 {
		return ErrInvalidOperation
	}
	for _, page := range pages {
		if page < 1 || page > pageCount {
			return ErrInvalidOperation
		}
	}
	return nil
}

func (s *Service) DuplicatePages(ctx context.Context, documentID uuid.UUID, selected []int) (Document, Version, error) {
	document, parent, input, err := s.operationInput(ctx, documentID)
	if err != nil {
		return Document{}, Version{}, err
	}
	pageCount, err := processing.QPDFPageCount(ctx, input)
	if err != nil || pageCount == nil || processing.ValidatePageOrder(selected, int(*pageCount)) != nil {
		return Document{}, Version{}, ErrInvalidOperation
	}
	duplicates := make(map[int]bool, len(selected))
	for _, page := range selected {
		duplicates[page] = true
	}
	order := make([]int, 0, int(*pageCount)+len(selected))
	for page := 1; page <= int(*pageCount); page++ {
		order = append(order, page)
		if duplicates[page] {
			order = append(order, page)
		}
	}
	metadata := map[string]any{"pages": selected, "beforeBytes": parent.ByteSize, "pageCount": len(order)}
	return s.execute(ctx, document, parent, "duplicate-pages", metadata, false, func(output string) (string, []string, error) {
		args, err := processing.QPDFDuplicateArgs(input, order, output)
		return "qpdf", args, err
	})
}

func insertionLists(pageCount int, options InsertOptions) ([]int, []int, error) {
	cut := 0
	switch options.Position {
	case "beginning":
		cut = 0
	case "end":
		cut = pageCount
	case "before":
		if options.Page < 1 || options.Page > pageCount {
			return nil, nil, ErrInvalidOperation
		}
		cut = options.Page - 1
	case "after":
		if options.Page < 1 || options.Page > pageCount {
			return nil, nil, ErrInvalidOperation
		}
		cut = options.Page
	default:
		return nil, nil, ErrInvalidOperation
	}
	before := make([]int, cut)
	for i := range before {
		before[i] = i + 1
	}
	after := make([]int, pageCount-cut)
	for i := range after {
		after[i] = cut + i + 1
	}
	return before, after, nil
}

func (s *Service) InsertPages(ctx context.Context, documentID, sourceDocumentID uuid.UUID, options InsertOptions) (Document, Version, error) {
	document, parent, input, err := s.operationInput(ctx, documentID)
	if err != nil {
		return Document{}, Version{}, err
	}
	_, sourceParent, source, err := s.operationInput(ctx, sourceDocumentID)
	if err != nil {
		return Document{}, Version{}, err
	}
	pageCount, err := processing.QPDFPageCount(ctx, input)
	if err != nil || pageCount == nil {
		return Document{}, Version{}, ErrInvalidOperation
	}
	sourceCount, err := processing.QPDFPageCount(ctx, source)
	if err != nil || sourceCount == nil {
		return Document{}, Version{}, ErrInvalidOperation
	}
	before, after, err := insertionLists(int(*pageCount), options)
	if err != nil {
		return Document{}, Version{}, err
	}
	inserted := make([]int, int(*sourceCount))
	for i := range inserted {
		inserted[i] = i + 1
	}
	metadata := map[string]any{"sourceDocumentId": sourceDocumentID, "sourceVersionId": sourceParent.ID, "position": options.Position, "page": options.Page, "beforeBytes": parent.ByteSize, "pageCount": int(*pageCount) + int(*sourceCount)}
	return s.execute(ctx, document, parent, "insert-pages", metadata, false, func(output string) (string, []string, error) {
		args, err := processing.QPDFInsertArgs(input, before, source, inserted, after, output)
		return "qpdf", args, err
	})
}

func (s *Service) InsertBlankPage(ctx context.Context, documentID uuid.UUID, options InsertOptions, sizeName, orientation string) (Document, Version, error) {
	document, parent, input, err := s.operationInput(ctx, documentID)
	if err != nil {
		return Document{}, Version{}, err
	}
	pageCount, err := processing.QPDFPageCount(ctx, input)
	if err != nil || pageCount == nil {
		return Document{}, Version{}, ErrInvalidOperation
	}
	before, after, err := insertionLists(int(*pageCount), options)
	if err != nil {
		return Document{}, Version{}, err
	}
	var size processing.PageSize
	if sizeName == "same" {
		sizes, sizeErr := processing.PDFPageSizes(ctx, input, "")
		if sizeErr != nil {
			return Document{}, Version{}, sizeErr
		}
		index := 0
		if len(before) > 0 {
			index = len(before) - 1
		}
		size = sizes[index]
	} else {
		size, err = processing.PresetPageSize(sizeName, orientation)
		if err != nil {
			return Document{}, Version{}, ErrInvalidOperation
		}
	}
	blank, err := s.storage.CreateTemp("blank-page-*.pdf")
	if err != nil {
		return Document{}, Version{}, err
	}
	blankPath := blank.Name()
	defer os.Remove(blankPath)
	if err := processing.WriteBlankPDF(blank, []processing.PageSize{size}); err != nil {
		_ = blank.Close()
		return Document{}, Version{}, err
	}
	_ = blank.Close()
	metadata := map[string]any{"position": options.Position, "page": options.Page, "pageSize": sizeName, "orientation": orientation, "beforeBytes": parent.ByteSize, "pageCount": int(*pageCount) + 1}
	return s.execute(ctx, document, parent, "insert-blank-page", metadata, false, func(output string) (string, []string, error) {
		args, err := processing.QPDFInsertArgs(input, before, blankPath, []int{1}, after, output)
		return "qpdf", args, err
	})
}

func (s *Service) ExtractAsDocument(ctx context.Context, documentID uuid.UUID, selection string) (Document, Version, error) {
	source, parent, input, err := s.operationInput(ctx, documentID)
	if err != nil {
		return Document{}, Version{}, err
	}
	if signed, checkErr := processing.QPDFHasSignatures(ctx, input); checkErr != nil {
		return Document{}, Version{}, checkErr
	} else if signed && !signatureConfirmed(ctx) {
		return Document{}, Version{}, ErrSignatureConfirmation
	}
	pageCount, err := processing.QPDFPageCount(ctx, input)
	if err != nil || pageCount == nil || processing.ValidatePageSelectionWithin(selection, int(*pageCount)) != nil {
		return Document{}, Version{}, ErrInvalidOperation
	}
	temporary, err := s.storage.CreateTemp("extract-*.pdf")
	if err != nil {
		return Document{}, Version{}, err
	}
	path := temporary.Name()
	_ = temporary.Close()
	_ = os.Remove(path)
	defer os.Remove(path)
	args, err := processing.QPDFExtractArgs(input, selection, path)
	if err != nil {
		return Document{}, Version{}, ErrInvalidOperation
	}
	if err := processing.RunCommand(ctx, "qpdf", filepath.Dir(path), args); err != nil {
		return Document{}, Version{}, err
	}
	file, err := os.Open(path)
	if err != nil {
		return Document{}, Version{}, err
	}
	defer file.Close()
	baseName := source.OriginalName
	if strings.HasSuffix(strings.ToLower(baseName), ".pdf") {
		baseName = baseName[:len(baseName)-4]
	}
	name := baseName + "-extracted.pdf"
	return s.storePDF(ctx, name, file, "extract", map[string]any{"sourceDocumentId": documentID, "sourceVersionId": parent.ID, "ranges": selection, "originalImmutable": true}, nil)
}

func randomOwnerPassword() (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func (s *Service) Protect(ctx context.Context, documentID uuid.UUID, options ProtectionOptions) (Document, Version, error) {
	document, parent, input, err := s.operationInput(ctx, documentID)
	if err != nil {
		return Document{}, Version{}, err
	}
	ownerPassword, err := randomOwnerPassword()
	if err != nil {
		return Document{}, Version{}, err
	}
	metadata := map[string]any{"printing": options.Printing, "copying": options.Copying, "modification": options.Modification, "annotation": options.Annotation, "formFilling": options.FormFilling, "assembly": options.Assembly, "encryption": "AES-256", "beforeBytes": parent.ByteSize}
	return s.execute(ctx, document, parent, "protect", metadata, false, func(output string) (string, []string, error) {
		args, err := processing.QPDFProtectArgs(input, output, options.Password, ownerPassword, options.Printing, options.Copying, options.Modification, options.Annotation, options.FormFilling, options.Assembly)
		return "qpdf", args, err
	})
}

func (s *Service) Unlock(ctx context.Context, documentID uuid.UUID, password string) (Document, Version, error) {
	if len(password) > 128 {
		return Document{}, Version{}, ErrInvalidPassword
	}
	document, parent, input, err := s.operationInput(ctx, documentID)
	if err != nil {
		return Document{}, Version{}, err
	}
	status, statusErr := processing.RunAndCapture(ctx, "qpdf", []string{"--show-encryption", "--password=" + password, input})
	if statusErr != nil {
		return Document{}, Version{}, ErrInvalidPassword
	}
	if strings.Contains(strings.ToLower(status), "incorrect password") {
		return Document{}, Version{}, ErrInvalidPassword
	}
	if strings.Contains(status, "File is not encrypted") {
		return Document{}, Version{}, ErrPDFNotEncrypted
	}
	if signed, checkErr := processing.QPDFHasSignaturesWithPassword(ctx, input, password); checkErr != nil {
		return Document{}, Version{}, checkErr
	} else if signed && !signatureConfirmed(ctx) {
		return Document{}, Version{}, ErrSignatureConfirmation
	}
	return s.execute(ctx, document, parent, "unlock", map[string]any{"beforeBytes": parent.ByteSize}, false, func(output string) (string, []string, error) {
		return "qpdf", processing.QPDFUnlockArgs(input, output, password), nil
	})
}

func selectedPageSet(selection string, count int, skipFirst bool) (map[int]bool, error) {
	pages := make([]int, count)
	for i := range pages {
		pages[i] = i + 1
	}
	var err error
	if selection != "" {
		pages, err = processing.ExpandPageSelection(selection, count)
		if err != nil {
			return nil, ErrInvalidOperation
		}
	}
	result := make(map[int]bool, len(pages))
	for _, page := range pages {
		if !(skipFirst && page == 1) {
			result[page] = true
		}
	}
	return result, nil
}

func overlayPoint(size processing.PageSize, horizontal, vertical string, margin float64) (float64, float64, string) {
	if margin < 0 {
		margin = 0
	}
	x, align := size.Width/2, "center"
	if horizontal == "left" {
		x, align = margin, "left"
	} else if horizontal == "right" {
		x, align = size.Width-margin, "right"
	}
	y := size.Height / 2
	if vertical == "top" {
		y = size.Height - margin
	} else if vertical == "bottom" {
		y = margin
	}
	return x, y, align
}

func (s *Service) applyOverlay(ctx context.Context, document Document, parent Version, input, operation string, metadata map[string]any, pages []processing.OverlayPage, foreground bool) (Document, Version, error) {
	overlay, err := s.storage.CreateTemp(operation + "-overlay-*.pdf")
	if err != nil {
		return Document{}, Version{}, err
	}
	overlayPath := overlay.Name()
	defer os.Remove(overlayPath)
	if err := processing.WriteOverlayPDF(overlay, pages); err != nil {
		_ = overlay.Close()
		return Document{}, Version{}, err
	}
	_ = overlay.Close()
	return s.execute(ctx, document, parent, operation, metadata, false, func(output string) (string, []string, error) {
		args, err := processing.QPDFOverlayArgs(input, overlayPath, output, foreground)
		return "qpdf", args, err
	})
}

func (s *Service) WatermarkText(ctx context.Context, documentID uuid.UUID, options WatermarkOptions) (Document, Version, error) {
	if strings.TrimSpace(options.Text) == "" || len(options.Text) > 200 {
		return Document{}, Version{}, ErrInvalidOperation
	}
	document, parent, input, err := s.operationInput(ctx, documentID)
	if err != nil {
		return Document{}, Version{}, err
	}
	sizes, err := processing.PDFPageSizes(ctx, input, "")
	if err != nil {
		return Document{}, Version{}, err
	}
	selected, err := selectedPageSet(options.PageRange, len(sizes), false)
	if err != nil {
		return Document{}, Version{}, err
	}
	pages := make([]processing.OverlayPage, len(sizes))
	for i, size := range sizes {
		pages[i].PageSize = size
		if selected[i+1] {
			x, y, align := overlayPoint(size, options.Horizontal, options.Vertical, 36)
			pages[i].Texts = []processing.TextOverlay{{Text: options.Text, X: x, Y: y, FontSize: options.FontSize, Opacity: options.Opacity, Rotation: options.Rotation, Align: align}}
		}
	}
	return s.applyOverlay(ctx, document, parent, input, "watermark", map[string]any{"type": "text", "text": options.Text, "pageRange": options.PageRange, "foreground": options.Foreground, "beforeBytes": parent.ByteSize}, pages, options.Foreground)
}

func (s *Service) WatermarkImage(ctx context.Context, documentID uuid.UUID, image processing.JPEGInput, options WatermarkOptions) (Document, Version, error) {
	document, parent, input, err := s.operationInput(ctx, documentID)
	if err != nil {
		return Document{}, Version{}, err
	}
	sizes, err := processing.PDFPageSizes(ctx, input, "")
	if err != nil {
		return Document{}, Version{}, err
	}
	selected, err := selectedPageSet(options.PageRange, len(sizes), false)
	if err != nil {
		return Document{}, Version{}, err
	}
	if options.Scale <= 0 || options.Scale > 1 {
		return Document{}, Version{}, ErrInvalidOperation
	}
	pages := make([]processing.OverlayPage, len(sizes))
	for i, size := range sizes {
		pages[i].PageSize = size
		if selected[i+1] {
			maxWidth, maxHeight := size.Width*options.Scale, size.Height*options.Scale
			ratio := float64(image.Width) / float64(image.Height)
			width, height := maxWidth, maxWidth/ratio
			if height > maxHeight {
				height, width = maxHeight, maxHeight*ratio
			}
			x, y, _ := overlayPoint(size, options.Horizontal, options.Vertical, 36)
			pages[i].Images = []processing.ImageOverlay{{Image: image, CenterX: x, CenterY: y, Width: width, Height: height, Opacity: options.Opacity, Rotation: options.Rotation}}
		}
	}
	return s.applyOverlay(ctx, document, parent, input, "watermark", map[string]any{"type": "image", "imageName": image.Name, "pageRange": options.PageRange, "foreground": options.Foreground, "beforeBytes": parent.ByteSize}, pages, options.Foreground)
}

func (s *Service) AddPageNumbers(ctx context.Context, documentID uuid.UUID, options PageNumberOptions) (Document, Version, error) {
	if len(options.Prefix) > 100 || len(options.Suffix) > 100 {
		return Document{}, Version{}, ErrInvalidOperation
	}
	document, parent, input, err := s.operationInput(ctx, documentID)
	if err != nil {
		return Document{}, Version{}, err
	}
	sizes, err := processing.PDFPageSizes(ctx, input, "")
	if err != nil {
		return Document{}, Version{}, err
	}
	selected, err := selectedPageSet(options.PageRange, len(sizes), options.SkipFirst)
	if err != nil {
		return Document{}, Version{}, err
	}
	if options.StartNumber < 0 {
		return Document{}, Version{}, ErrInvalidOperation
	}
	if options.FontSize == 0 {
		options.FontSize = 11
	}
	if options.Margin == 0 {
		options.Margin = 32
	}
	parts := strings.Split(options.Position, "-")
	if len(parts) != 2 {
		return Document{}, Version{}, ErrInvalidOperation
	}
	pages := make([]processing.OverlayPage, len(sizes))
	number := options.StartNumber
	for i, size := range sizes {
		pages[i].PageSize = size
		if selected[i+1] {
			label := fmt.Sprintf("%s%d%s", options.Prefix, number, options.Suffix)
			if options.IncludeTotal {
				label = fmt.Sprintf("%s%d of %d%s", options.Prefix, number, len(sizes), options.Suffix)
			}
			x, y, align := overlayPoint(size, parts[1], parts[0], options.Margin)
			pages[i].Texts = []processing.TextOverlay{{Text: label, X: x, Y: y, FontSize: options.FontSize, Opacity: 1, Align: align}}
			number++
		}
	}
	return s.applyOverlay(ctx, document, parent, input, "page-numbers", map[string]any{"position": options.Position, "startNumber": options.StartNumber, "pageRange": options.PageRange, "skipFirst": options.SkipFirst, "beforeBytes": parent.ByteSize}, pages, true)
}

func replaceVariables(value, filename string, page, pages int) string {
	result := strings.ReplaceAll(value, "{page}", fmt.Sprint(page))
	result = strings.ReplaceAll(result, "{pages}", fmt.Sprint(pages))
	result = strings.ReplaceAll(result, "{filename}", filename)
	return strings.ReplaceAll(result, "{date}", time.Now().Format("2006-01-02"))
}

func (s *Service) AddHeaderFooter(ctx context.Context, documentID uuid.UUID, options HeaderFooterOptions) (Document, Version, error) {
	for _, value := range []string{options.Header.Left, options.Header.Center, options.Header.Right, options.Footer.Left, options.Footer.Center, options.Footer.Right} {
		if len(value) > 500 {
			return Document{}, Version{}, ErrInvalidOperation
		}
	}
	document, parent, input, err := s.operationInput(ctx, documentID)
	if err != nil {
		return Document{}, Version{}, err
	}
	sizes, err := processing.PDFPageSizes(ctx, input, "")
	if err != nil {
		return Document{}, Version{}, err
	}
	selected, err := selectedPageSet(options.PageRange, len(sizes), options.SkipFirst)
	if err != nil {
		return Document{}, Version{}, err
	}
	if options.FontSize == 0 {
		options.FontSize = 10
	}
	if options.Margin == 0 {
		options.Margin = 30
	}
	pages := make([]processing.OverlayPage, len(sizes))
	for i, size := range sizes {
		pages[i].PageSize = size
		if !selected[i+1] {
			continue
		}
		for _, band := range []struct {
			value    HeaderFooterBand
			vertical string
		}{{options.Header, "top"}, {options.Footer, "bottom"}} {
			for _, item := range []struct{ text, horizontal string }{{band.value.Left, "left"}, {band.value.Center, "center"}, {band.value.Right, "right"}} {
				if item.text == "" {
					continue
				}
				x, y, align := overlayPoint(size, item.horizontal, band.vertical, options.Margin)
				pages[i].Texts = append(pages[i].Texts, processing.TextOverlay{Text: replaceVariables(item.text, document.OriginalName, i+1, len(sizes)), X: x, Y: y, FontSize: options.FontSize, Opacity: 1, Align: align})
			}
		}
	}
	return s.applyOverlay(ctx, document, parent, input, "header-footer", map[string]any{"pageRange": options.PageRange, "skipFirst": options.SkipFirst, "beforeBytes": parent.ByteSize}, pages, true)
}

func (s *Service) Metadata(ctx context.Context, documentID uuid.UUID) (processing.PDFMetadata, error) {
	_, _, input, err := s.operationInput(ctx, documentID)
	if err != nil {
		return processing.PDFMetadata{}, err
	}
	return processing.ReadPDFMetadata(ctx, input)
}

func (s *Service) UpdateMetadata(ctx context.Context, documentID uuid.UUID, values processing.PDFMetadata) (Document, Version, error) {
	for _, value := range []string{values.Title, values.Author, values.Subject, values.Keywords} {
		if len(value) > 4096 {
			return Document{}, Version{}, ErrInvalidOperation
		}
	}
	document, parent, input, err := s.operationInput(ctx, documentID)
	if err != nil {
		return Document{}, Version{}, err
	}
	jsonFile, err := s.storage.CreateTemp("metadata-*.json")
	if err != nil {
		return Document{}, Version{}, err
	}
	jsonPath := jsonFile.Name()
	_ = jsonFile.Close()
	defer os.Remove(jsonPath)
	updates := map[string]*string{"Title": &values.Title, "Author": &values.Author, "Subject": &values.Subject, "Keywords": &values.Keywords}
	if err := processing.WriteMetadataUpdateJSON(ctx, input, jsonPath, updates); err != nil {
		return Document{}, Version{}, err
	}
	return s.execute(ctx, document, parent, "metadata", map[string]any{"fields": []string{"title", "author", "subject", "keywords"}, "beforeBytes": parent.ByteSize}, false, func(output string) (string, []string, error) {
		return "qpdf", []string{"--update-from-json=" + jsonPath, input, output}, nil
	})
}

func NormalizePDFName(value string) (string, error) {
	name := strings.TrimSpace(value)
	if strings.ContainsAny(name, "/\\\x00\r\n") || name == "" || name == "." || name == ".." || len(name) > 240 {
		return "", ErrInvalidFilename
	}
	for strings.HasSuffix(strings.ToLower(name), ".pdf.pdf") {
		name = name[:len(name)-4]
	}
	if !strings.HasSuffix(strings.ToLower(name), ".pdf") {
		name += ".pdf"
	}
	if len(strings.TrimSuffix(name, ".pdf")) == 0 {
		return "", ErrInvalidFilename
	}
	return name, nil
}

func (s *Service) Rename(ctx context.Context, documentID uuid.UUID, name string) (Document, error) {
	normalized, err := NormalizePDFName(name)
	if err != nil {
		return Document{}, err
	}
	if _, err = s.Get(ctx, documentID); err != nil {
		return Document{}, err
	}
	return s.repository.Rename(ctx, documentID, normalized)
}

func (s *Service) RenderThumbnail(ctx context.Context, documentID uuid.UUID, page int) (*os.File, error) {
	_, _, input, err := s.operationInput(ctx, documentID)
	if err != nil {
		return nil, err
	}
	count, err := processing.QPDFPageCount(ctx, input)
	if err != nil || count == nil || page < 1 || page > int(*count) {
		return nil, ErrInvalidOperation
	}
	marker, err := s.storage.CreateTemp("thumbnail-*")
	if err != nil {
		return nil, err
	}
	markerPath := marker.Name()
	_ = marker.Close()
	_ = os.Remove(markerPath)
	outputPath := markerPath + ".png"
	if err := processing.RunCommand(ctx, "pdftoppm", filepath.Dir(markerPath), []string{"-f", fmt.Sprint(page), "-l", fmt.Sprint(page), "-singlefile", "-scale-to", "320", "-png", input, markerPath}); err != nil {
		_ = os.Remove(outputPath)
		return nil, err
	}
	file, err := os.Open(outputPath)
	if err != nil {
		_ = os.Remove(outputPath)
		return nil, err
	}
	return file, nil
}
