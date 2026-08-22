package documents

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"os"
	"path/filepath"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/local/pdf-web-studio/apps/api/internal/processing"
	"github.com/local/pdf-web-studio/apps/api/internal/storage"
)

var (
	ErrInvalidPDF = errors.New("invalid PDF upload")
	ErrTooLarge   = errors.New("upload exceeds configured size limit")
	ErrNotFound   = errors.New("document not found")
)

type Service struct {
	repository     *Repository
	storage        *storage.Store
	maxUploadBytes int64
	fonts          *processing.FontRegistry
}

func NewService(repository *Repository, store *storage.Store, maxUploadBytes int64, fonts *processing.FontRegistry) *Service {
	return &Service{repository: repository, storage: store, maxUploadBytes: maxUploadBytes, fonts: fonts}
}

func (s *Service) Upload(ctx context.Context, filename, contentType string, source io.Reader) (Document, Version, error) {
	displayName, err := validateUploadMetadata(filename, contentType)
	if err != nil {
		return Document{}, Version{}, err
	}
	return s.storePDF(ctx, displayName, source, "upload", map[string]any{"source": "multipart", "originalImmutable": true}, nil)
}

func (s *Service) ConvertJPEGsToPDF(ctx context.Context, images []processing.JPEGInput) (Document, Version, error) {
	if len(images) == 0 || len(images) > 20 {
		return Document{}, Version{}, processing.ErrJPEGInputRequired
	}
	temporary, err := s.storage.CreateTemp("jpg-to-pdf-*.pdf")
	if err != nil {
		return Document{}, Version{}, fmt.Errorf("create conversion temporary file: %w", err)
	}
	temporaryName := temporary.Name()
	defer func() {
		_ = temporary.Close()
		_ = os.Remove(temporaryName)
	}()
	if err := processing.WriteJPEGsAsPDF(temporary, images); err != nil {
		return Document{}, Version{}, err
	}
	if _, err := temporary.Seek(0, io.SeekStart); err != nil {
		return Document{}, Version{}, fmt.Errorf("rewind converted PDF: %w", err)
	}
	inputs := make([]map[string]any, len(images))
	var inputBytes int64
	for index, image := range images {
		inputs[index] = map[string]any{"name": image.Name, "byteSize": image.ByteSize, "width": image.Width, "height": image.Height}
		inputBytes += image.ByteSize
	}
	pageCount := int32(len(images))
	return s.storePDF(ctx, "converted-images.pdf", temporary, "convert-jpg-to-pdf", map[string]any{
		"source": "jpg", "inputCount": len(images), "inputs": inputs, "beforeBytes": inputBytes,
		"pageSize": "auto-oriented-a4", "originalImmutable": true,
	}, &pageCount)
}

func (s *Service) storePDF(ctx context.Context, displayName string, source io.Reader, initialOperation string, details map[string]any, declaredPageCount *int32) (Document, Version, error) {
	temporary, err := s.storage.CreateTemp("upload-*.pdf")
	if err != nil {
		return Document{}, Version{}, fmt.Errorf("create upload temporary file: %w", err)
	}
	temporaryName := temporary.Name()
	defer func() {
		_ = temporary.Close()
		_ = os.Remove(temporaryName)
	}()

	header := make([]byte, 1024)
	headerLength, readErr := io.ReadFull(source, header)
	if readErr != nil && !errors.Is(readErr, io.ErrUnexpectedEOF) {
		return Document{}, Version{}, fmt.Errorf("read PDF signature: %w", readErr)
	}
	if headerLength == 0 || bytes.Index(header[:headerLength], []byte("%PDF-")) < 0 {
		return Document{}, Version{}, ErrInvalidPDF
	}
	hash := sha256.New()
	limited := io.LimitReader(io.MultiReader(bytes.NewReader(header[:headerLength]), source), s.maxUploadBytes+1)
	byteSize, err := io.Copy(io.MultiWriter(temporary, hash), limited)
	if err != nil {
		return Document{}, Version{}, fmt.Errorf("stream PDF upload: %w", err)
	}
	if byteSize > s.maxUploadBytes {
		return Document{}, Version{}, ErrTooLarge
	}
	checksum := hex.EncodeToString(hash.Sum(nil))
	documentID := uuid.New()
	versionID := uuid.New()
	relativePath, err := s.storage.Relative("originals", documentID.String()+".pdf")
	if err != nil {
		return Document{}, Version{}, fmt.Errorf("build original storage path: %w", err)
	}
	if err := s.storage.CommitTemp(temporary, relativePath); err != nil {
		return Document{}, Version{}, err
	}
	committedPath, err := s.storage.Resolve(relativePath)
	if err != nil {
		return Document{}, Version{}, err
	}
	if err := os.Chmod(committedPath, 0o440); err != nil {
		_ = os.Remove(committedPath)
		return Document{}, Version{}, fmt.Errorf("make original read-only: %w", err)
	}
	pageCount := declaredPageCount
	if pageCount == nil {
		pageCount, _ = processing.QPDFPageCount(ctx, committedPath)
	}
	document, version, err := s.repository.CreateUpload(ctx, CreateUploadParams{
		DocumentID: documentID, VersionID: versionID, OriginalName: displayName,
		ByteSize: byteSize, PageCount: pageCount, StoragePath: relativePath, Checksum: checksum,
		UploadDetails: details, InitialOperation: initialOperation,
	})
	if err != nil {
		_ = os.Remove(committedPath)
		return Document{}, Version{}, err
	}
	return document, version, nil
}

func (s *Service) List(ctx context.Context) ([]Document, error) {
	return s.repository.List(ctx)
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (Document, error) {
	value, err := s.repository.Get(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return Document{}, ErrNotFound
	}
	return value, err
}

func (s *Service) Delete(ctx context.Context, id uuid.UUID) error {
	deleted, err := s.repository.SoftDelete(ctx, id)
	if err != nil {
		return err
	}
	if !deleted {
		return ErrNotFound
	}
	return nil
}

func (s *Service) ListTrash(ctx context.Context) ([]Document, error) {
	return s.repository.ListDeleted(ctx)
}

func (s *Service) Restore(ctx context.Context, id uuid.UUID) error {
	restored, err := s.repository.Restore(ctx, id)
	if err != nil {
		return err
	}
	if !restored {
		return ErrNotFound
	}
	return nil
}

func (s *Service) PermanentDelete(ctx context.Context, id uuid.UUID) error {
	document, err := s.repository.GetDeleted(ctx, id)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	versions, err := s.repository.Versions(ctx, id)
	if err != nil {
		return err
	}
	paths := make([]string, 0, len(versions)+1)
	paths = append(paths, document.OriginalPath)
	for _, version := range versions {
		paths = append(paths, version.StoragePath)
	}
	staged, err := s.storage.StageDeletion(paths)
	if err != nil {
		return fmt.Errorf("stage permanent deletion: %w", err)
	}
	deleted, err := s.repository.HardDelete(ctx, id)
	if err != nil || !deleted {
		if rollbackErr := staged.Rollback(); rollbackErr != nil {
			return fmt.Errorf("permanent delete failed: %v; restore files: %w", err, rollbackErr)
		}
		if err != nil {
			return err
		}
		return ErrNotFound
	}
	if err := staged.Commit(); err != nil {
		return fmt.Errorf("clean staged deleted files: %w", err)
	}
	return nil
}

func (s *Service) Versions(ctx context.Context, id uuid.UUID) ([]Version, error) {
	if _, err := s.Get(ctx, id); err != nil {
		return nil, err
	}
	return s.repository.Versions(ctx, id)
}

func (s *Service) Version(ctx context.Context, documentID, versionID uuid.UUID) (Version, error) {
	if _, err := s.Get(ctx, documentID); err != nil {
		return Version{}, err
	}
	value, err := s.repository.Version(ctx, documentID, versionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Version{}, ErrNotFound
	}
	return value, err
}

func (s *Service) OpenOriginal(ctx context.Context, id uuid.UUID) (Document, *os.File, error) {
	document, err := s.Get(ctx, id)
	if err != nil {
		return Document{}, nil, err
	}
	file, err := s.storage.Open(document.OriginalPath)
	return document, file, err
}

func (s *Service) OpenVersion(ctx context.Context, documentID, versionID uuid.UUID) (Version, *os.File, error) {
	version, err := s.Version(ctx, documentID, versionID)
	if err != nil {
		return Version{}, nil, err
	}
	file, err := s.storage.Open(version.StoragePath)
	return version, file, err
}

func validateUploadMetadata(filename, contentType string) (string, error) {
	filename = strings.ReplaceAll(filename, "\\", "/")
	displayName := filepath.Base(filename)
	if displayName == "." || displayName == "" || strings.ContainsAny(displayName, "\r\n") {
		return "", ErrInvalidPDF
	}
	if strings.ToLower(filepath.Ext(displayName)) != ".pdf" {
		return "", ErrInvalidPDF
	}
	mediaType, _, err := mime.ParseMediaType(contentType)
	if err != nil || (mediaType != "application/pdf" && mediaType != "application/octet-stream") {
		return "", ErrInvalidPDF
	}
	return displayName, nil
}
