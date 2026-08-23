package documents

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	"github.com/local/pdf-web-studio/apps/api/internal/processing"
)

// DocumentFonts lists the typefaces the PDF already uses, so the editor can
// tell the user which of them the server can actually reproduce.
func (s *Service) DocumentFonts(ctx context.Context, documentID uuid.UUID) ([]processing.DocumentFont, error) {
	_, _, input, err := s.operationInput(ctx, documentID)
	if err != nil {
		return nil, err
	}
	return processing.DocumentFonts(ctx, input, "")
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
