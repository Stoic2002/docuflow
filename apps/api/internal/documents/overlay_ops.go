package documents

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/local/pdf-web-studio/apps/api/internal/processing"
)

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
	if err := processing.WriteOverlayPDFWithFonts(overlay, pages, s.fonts); err != nil {
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
