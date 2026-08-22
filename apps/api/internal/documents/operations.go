package documents

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/local/pdf-web-studio/apps/api/internal/processing"
)

var (
	ErrInvalidOperation      = errors.New("invalid PDF operation request")
	ErrCompressionNotSmaller = errors.New("structural optimization did not reduce file size")
)

type commandBuilder func(outputPath string) (tool string, args []string, err error)

func (s *Service) Merge(ctx context.Context, documentIDs []uuid.UUID) (Document, Version, error) {
	if len(documentIDs) < 2 || len(documentIDs) > 20 {
		return Document{}, Version{}, ErrInvalidOperation
	}
	seen := make(map[uuid.UUID]struct{}, len(documentIDs))
	inputPaths := make([]string, 0, len(documentIDs))
	var primary Document
	var parent Version
	var totalBytes int64
	for index, id := range documentIDs {
		if _, exists := seen[id]; exists {
			return Document{}, Version{}, ErrInvalidOperation
		}
		seen[id] = struct{}{}
		document, err := s.Get(ctx, id)
		if err != nil {
			return Document{}, Version{}, err
		}
		latest, err := s.latestVersion(ctx, id)
		if err != nil {
			return Document{}, Version{}, err
		}
		input, err := s.storage.Resolve(latest.StoragePath)
		if err != nil {
			return Document{}, Version{}, err
		}
		if index == 0 {
			primary, parent = document, latest
		}
		totalBytes += latest.ByteSize
		inputPaths = append(inputPaths, input)
	}
	metadata := map[string]any{"documentIds": documentIDs, "beforeBytes": totalBytes}
	return s.execute(ctx, primary, parent, "merge", metadata, false, func(outputPath string) (string, []string, error) {
		args, err := processing.QPDFMergeArgs(inputPaths, outputPath)
		return "qpdf", args, err
	})
}

func (s *Service) Extract(ctx context.Context, documentID uuid.UUID, selection, operation string) (Document, Version, error) {
	if operation != "split" && operation != "extract" {
		return Document{}, Version{}, ErrInvalidOperation
	}
	document, parent, input, err := s.operationInput(ctx, documentID)
	if err != nil {
		return Document{}, Version{}, err
	}
	metadata := map[string]any{"ranges": selection, "beforeBytes": parent.ByteSize}
	return s.execute(ctx, document, parent, operation, metadata, false, func(outputPath string) (string, []string, error) {
		args, err := processing.QPDFExtractArgs(input, selection, outputPath)
		return "qpdf", args, err
	})
}

func (s *Service) SplitPages(ctx context.Context, documentID uuid.UUID, pages []int) (Document, []Version, error) {
	document, parent, input, err := s.operationInput(ctx, documentID)
	if err != nil {
		return Document{}, nil, err
	}
	pageCount, err := processing.QPDFPageCount(ctx, input)
	if err != nil || pageCount == nil || processing.ValidatePageOrder(pages, int(*pageCount)) != nil {
		return Document{}, nil, ErrInvalidOperation
	}
	versions := make([]Version, 0, len(pages))
	for _, page := range pages {
		selection := strconv.Itoa(page)
		metadata := map[string]any{
			"page": page, "ranges": selection, "pageCount": 1, "beforeBytes": parent.ByteSize,
		}
		_, version, splitErr := s.execute(ctx, document, parent, "split", metadata, false, func(outputPath string) (string, []string, error) {
			args, buildErr := processing.QPDFExtractArgs(input, selection, outputPath)
			return "qpdf", args, buildErr
		})
		if splitErr != nil {
			return document, nil, splitErr
		}
		versions = append(versions, version)
	}
	return document, versions, nil
}

func (s *Service) Reorder(ctx context.Context, documentID uuid.UUID, order []int) (Document, Version, error) {
	document, parent, input, err := s.operationInput(ctx, documentID)
	if err != nil {
		return Document{}, Version{}, err
	}
	pageCount, err := processing.QPDFPageCount(ctx, input)
	if err != nil || pageCount == nil || len(order) != int(*pageCount) || processing.ValidatePageOrder(order, int(*pageCount)) != nil {
		return Document{}, Version{}, ErrInvalidOperation
	}
	metadata := map[string]any{"pageOrder": order, "beforeBytes": parent.ByteSize, "pageCount": *pageCount}
	return s.execute(ctx, document, parent, "reorder", metadata, false, func(outputPath string) (string, []string, error) {
		args, err := processing.QPDFReorderArgs(input, order, outputPath)
		return "qpdf", args, err
	})
}

func (s *Service) DeletePages(ctx context.Context, documentID uuid.UUID, deleted []int) (Document, Version, error) {
	document, parent, input, err := s.operationInput(ctx, documentID)
	if err != nil {
		return Document{}, Version{}, err
	}
	pageCount, err := processing.QPDFPageCount(ctx, input)
	if err != nil || pageCount == nil || processing.ValidatePageOrder(deleted, int(*pageCount)) != nil || len(deleted) == int(*pageCount) {
		return Document{}, Version{}, ErrInvalidOperation
	}
	removed := make(map[int]struct{}, len(deleted))
	for _, page := range deleted {
		removed[page] = struct{}{}
	}
	kept := make([]int, 0, int(*pageCount)-len(deleted))
	for page := 1; page <= int(*pageCount); page++ {
		if _, exists := removed[page]; !exists {
			kept = append(kept, page)
		}
	}
	metadata := map[string]any{"deletedPages": deleted, "beforeBytes": parent.ByteSize, "pageCount": len(kept)}
	return s.execute(ctx, document, parent, "delete-pages", metadata, false, func(outputPath string) (string, []string, error) {
		args, err := processing.QPDFReorderArgs(input, kept, outputPath)
		return "qpdf", args, err
	})
}

func (s *Service) Rotate(ctx context.Context, documentID uuid.UUID, pages []int, degrees int) (Document, Version, error) {
	document, parent, input, err := s.operationInput(ctx, documentID)
	if err != nil {
		return Document{}, Version{}, err
	}
	pageCount, err := processing.QPDFPageCount(ctx, input)
	if err != nil || pageCount == nil || processing.ValidatePageOrder(pages, int(*pageCount)) != nil {
		return Document{}, Version{}, ErrInvalidOperation
	}
	metadata := map[string]any{"pages": pages, "degrees": degrees, "beforeBytes": parent.ByteSize, "pageCount": *pageCount}
	return s.execute(ctx, document, parent, "rotate", metadata, false, func(outputPath string) (string, []string, error) {
		args, err := processing.QPDFRotateArgs(input, degrees, pages, outputPath)
		return "qpdf", args, err
	})
}

func (s *Service) Compress(ctx context.Context, documentID uuid.UUID) (Document, Version, error) {
	document, parent, input, err := s.operationInput(ctx, documentID)
	if err != nil {
		return Document{}, Version{}, err
	}
	metadata := map[string]any{"mode": "lossless-structural", "beforeBytes": parent.ByteSize}
	return s.execute(ctx, document, parent, "compress", metadata, true, func(outputPath string) (string, []string, error) {
		return "qpdf", processing.QPDFCompressArgs(input, outputPath), nil
	})
}

func (s *Service) OCR(ctx context.Context, documentID uuid.UUID, language string) (Document, Version, error) {
	document, parent, input, err := s.operationInput(ctx, documentID)
	if err != nil {
		return Document{}, Version{}, err
	}
	metadata := map[string]any{
		"language": language, "mode": "searchable-text-layer", "editableLayoutReconstruction": false,
		"beforeBytes": parent.ByteSize,
	}
	return s.execute(ctx, document, parent, "ocr", metadata, false, func(outputPath string) (string, []string, error) {
		args, err := processing.OCRmyPDFArgs(input, outputPath, language)
		return "ocrmypdf", args, err
	})
}

func (s *Service) operationInput(ctx context.Context, documentID uuid.UUID) (Document, Version, string, error) {
	document, err := s.Get(ctx, documentID)
	if err != nil {
		return Document{}, Version{}, "", err
	}
	parent, err := s.latestVersion(ctx, documentID)
	if err != nil {
		return Document{}, Version{}, "", err
	}
	path, err := s.storage.Resolve(parent.StoragePath)
	return document, parent, path, err
}

func (s *Service) latestVersion(ctx context.Context, documentID uuid.UUID) (Version, error) {
	value, err := s.repository.LatestVersion(ctx, documentID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Version{}, ErrNotFound
	}
	return value, err
}

func (s *Service) execute(
	ctx context.Context,
	document Document,
	parent Version,
	operation string,
	metadata map[string]any,
	requireSmaller bool,
	build commandBuilder,
) (Document, Version, error) {
	inputPath, resolveErr := s.storage.Resolve(parent.StoragePath)
	if resolveErr != nil {
		return Document{}, Version{}, resolveErr
	}
	if operation != "unlock" {
		if signed, checkErr := processing.QPDFHasSignatures(ctx, inputPath); checkErr != nil {
			return Document{}, Version{}, checkErr
		} else if signed && !signatureConfirmed(ctx) {
			return Document{}, Version{}, ErrSignatureConfirmation
		}
	}
	runID, err := s.repository.StartProcessing(ctx, document.ID, operation, metadata)
	if err != nil {
		return Document{}, Version{}, fmt.Errorf("start processing record: %w", err)
	}
	fail := func(processErr error) (Document, Version, error) {
		status := "failed"
		if errors.Is(processErr, context.Canceled) || errors.Is(ctx.Err(), context.Canceled) {
			status = "cancelled"
		}
		_ = s.repository.FinishProcessing(context.WithoutCancel(ctx), runID, status, map[string]any{}, processing.ErrorCode(processErr))
		return Document{}, Version{}, processErr
	}
	temporary, err := s.storage.CreateTemp(operation + "-*.pdf")
	if err != nil {
		return fail(err)
	}
	temporaryPath := temporary.Name()
	_ = temporary.Close()
	_ = os.Remove(temporaryPath)
	defer os.Remove(temporaryPath)
	tool, args, err := build(temporaryPath)
	if err != nil {
		return fail(fmt.Errorf("%w: %v", ErrInvalidOperation, err))
	}
	if err := processing.RunCommand(ctx, tool, filepath.Dir(temporaryPath), args); err != nil {
		return fail(err)
	}
	byteSize, checksum, err := inspectPDF(temporaryPath)
	if err != nil {
		return fail(err)
	}
	metadata["afterBytes"] = byteSize
	if requireSmaller && byteSize >= parent.ByteSize {
		return fail(ErrCompressionNotSmaller)
	}
	versionID := uuid.New()
	destination, err := s.storage.Relative("versions", versionID.String()+".pdf")
	if err != nil {
		return fail(err)
	}
	completed, err := os.OpenFile(temporaryPath, os.O_RDWR, 0)
	if err != nil {
		return fail(err)
	}
	if err := s.storage.CommitTemp(completed, destination); err != nil {
		return fail(err)
	}
	committedPath, err := s.storage.Resolve(destination)
	if err != nil {
		return fail(err)
	}
	if err := os.Chmod(committedPath, 0o440); err != nil {
		_ = os.Remove(committedPath)
		return fail(err)
	}
	version, err := s.repository.CreateVersion(ctx, CreateVersionParams{
		ID: versionID, DocumentID: document.ID, ParentVersionID: parent.ID, Operation: operation,
		StoragePath: destination, ByteSize: byteSize, Checksum: checksum, Metadata: metadata,
	})
	if err != nil {
		_ = os.Remove(committedPath)
		return fail(err)
	}
	_ = s.repository.FinishProcessing(context.WithoutCancel(ctx), runID, "succeeded", map[string]any{
		"versionId": version.ID, "beforeBytes": parent.ByteSize, "afterBytes": byteSize,
	}, "")
	return document, version, nil
}

func inspectPDF(path string) (int64, string, error) {
	file, err := os.Open(path)
	if err != nil {
		return 0, "", fmt.Errorf("open PDF output: %w", err)
	}
	defer file.Close()
	header := make([]byte, 1024)
	headerLength, readErr := io.ReadFull(file, header)
	if readErr != nil && !errors.Is(readErr, io.ErrUnexpectedEOF) {
		return 0, "", fmt.Errorf("read PDF output header: %w", readErr)
	}
	if bytes.Index(header[:headerLength], []byte("%PDF-")) < 0 {
		return 0, "", errors.New("processing output is not a PDF")
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return 0, "", err
	}
	hash := sha256.New()
	byteSize, err := io.Copy(hash, file)
	if err != nil {
		return 0, "", err
	}
	return byteSize, hex.EncodeToString(hash.Sum(nil)), nil
}
