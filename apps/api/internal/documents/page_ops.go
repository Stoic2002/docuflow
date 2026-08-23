package documents

import (
	"context"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	"github.com/local/pdf-web-studio/apps/api/internal/processing"
)

type InsertOptions struct {
	Position string
	Page     int
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
