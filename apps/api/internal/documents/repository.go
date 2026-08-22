package documents

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	db "github.com/local/pdf-web-studio/apps/api/internal/database/db"
)

type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

type CreateUploadParams struct {
	DocumentID       uuid.UUID
	VersionID        uuid.UUID
	OriginalName     string
	ByteSize         int64
	PageCount        *int32
	StoragePath      string
	Checksum         string
	UploadDetails    map[string]any
	InitialOperation string
}

type CreateVersionParams struct {
	ID              uuid.UUID
	DocumentID      uuid.UUID
	ParentVersionID uuid.UUID
	Operation       string
	StoragePath     string
	ByteSize        int64
	Checksum        string
	Metadata        map[string]any
}

func (r *Repository) CreateUpload(ctx context.Context, params CreateUploadParams) (Document, Version, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Document{}, Version{}, fmt.Errorf("begin upload transaction: %w", err)
	}
	defer tx.Rollback(ctx)
	queries := db.New(tx)
	document, err := queries.CreateDocument(ctx, db.CreateDocumentParams{
		ID: params.DocumentID, OriginalName: params.OriginalName, MediaType: "application/pdf",
		ByteSize: params.ByteSize, PageCount: params.PageCount, OriginalPath: params.StoragePath,
		ChecksumSha256: params.Checksum,
	})
	if err != nil {
		return Document{}, Version{}, fmt.Errorf("insert document: %w", err)
	}
	metadata, err := json.Marshal(params.UploadDetails)
	if err != nil {
		return Document{}, Version{}, fmt.Errorf("encode upload metadata: %w", err)
	}
	operation := params.InitialOperation
	if operation == "" {
		operation = "upload"
	}
	version, err := queries.CreateDocumentVersion(ctx, db.CreateDocumentVersionParams{
		ID: params.VersionID, DocumentID: params.DocumentID, Operation: operation,
		StoragePath: params.StoragePath, ByteSize: params.ByteSize, ChecksumSha256: params.Checksum,
		Metadata: string(metadata),
	})
	if err != nil {
		return Document{}, Version{}, fmt.Errorf("insert upload version: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Document{}, Version{}, fmt.Errorf("commit upload transaction: %w", err)
	}
	return mapDocument(document), mapVersion(version), nil
}

func (r *Repository) List(ctx context.Context) ([]Document, error) {
	rows, err := db.New(r.pool).ListDocuments(ctx)
	if err != nil {
		return nil, fmt.Errorf("list documents: %w", err)
	}
	result := make([]Document, 0, len(rows))
	for _, row := range rows {
		result = append(result, mapDocument(row))
	}
	return result, nil
}

func (r *Repository) Get(ctx context.Context, id uuid.UUID) (Document, error) {
	row, err := db.New(r.pool).GetDocument(ctx, id)
	if err != nil {
		return Document{}, err
	}
	return mapDocument(row), nil
}

func (r *Repository) ListDeleted(ctx context.Context) ([]Document, error) {
	rows, err := db.New(r.pool).ListDeletedDocuments(ctx)
	if err != nil {
		return nil, fmt.Errorf("list deleted documents: %w", err)
	}
	result := make([]Document, 0, len(rows))
	for _, row := range rows {
		result = append(result, mapDocument(row))
	}
	return result, nil
}

func (r *Repository) GetDeleted(ctx context.Context, id uuid.UUID) (Document, error) {
	row, err := db.New(r.pool).GetDeletedDocument(ctx, id)
	if err != nil {
		return Document{}, err
	}
	return mapDocument(row), nil
}

func (r *Repository) SoftDelete(ctx context.Context, id uuid.UUID) (bool, error) {
	rows, err := db.New(r.pool).SoftDeleteDocument(ctx, id)
	if err != nil {
		return false, fmt.Errorf("soft delete document: %w", err)
	}
	return rows == 1, nil
}

func (r *Repository) Restore(ctx context.Context, id uuid.UUID) (bool, error) {
	rows, err := db.New(r.pool).RestoreDocument(ctx, id)
	if err != nil {
		return false, fmt.Errorf("restore document: %w", err)
	}
	return rows == 1, nil
}

func (r *Repository) HardDelete(ctx context.Context, id uuid.UUID) (bool, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return false, fmt.Errorf("begin permanent delete transaction: %w", err)
	}
	defer tx.Rollback(ctx)
	queries := db.New(tx)
	if err := queries.ClearDocumentVersionParents(ctx, id); err != nil {
		return false, fmt.Errorf("clear version parents: %w", err)
	}
	if err := queries.DeleteProcessingRunsForDocument(ctx, &id); err != nil {
		return false, fmt.Errorf("delete processing runs: %w", err)
	}
	if err := queries.DeleteDocumentVersions(ctx, id); err != nil {
		return false, fmt.Errorf("delete document versions: %w", err)
	}
	rows, err := queries.HardDeleteDocument(ctx, id)
	if err != nil {
		return false, fmt.Errorf("delete document record: %w", err)
	}
	if rows != 1 {
		return false, nil
	}
	if err := tx.Commit(ctx); err != nil {
		return false, fmt.Errorf("commit permanent delete transaction: %w", err)
	}
	return true, nil
}

func (r *Repository) Versions(ctx context.Context, documentID uuid.UUID) ([]Version, error) {
	rows, err := db.New(r.pool).ListDocumentVersions(ctx, documentID)
	if err != nil {
		return nil, fmt.Errorf("list document versions: %w", err)
	}
	result := make([]Version, 0, len(rows))
	for _, row := range rows {
		result = append(result, mapVersion(row))
	}
	return result, nil
}

func (r *Repository) Version(ctx context.Context, documentID, versionID uuid.UUID) (Version, error) {
	row, err := db.New(r.pool).GetDocumentVersion(ctx, db.GetDocumentVersionParams{
		DocumentID: documentID, ID: versionID,
	})
	if err != nil {
		return Version{}, err
	}
	return mapVersion(row), nil
}

func (r *Repository) LatestVersion(ctx context.Context, documentID uuid.UUID) (Version, error) {
	row, err := db.New(r.pool).GetLatestDocumentVersion(ctx, documentID)
	if err != nil {
		return Version{}, err
	}
	return mapVersion(row), nil
}

func (r *Repository) CreateVersion(ctx context.Context, params CreateVersionParams) (Version, error) {
	metadata, err := json.Marshal(params.Metadata)
	if err != nil {
		return Version{}, fmt.Errorf("encode version metadata: %w", err)
	}
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return Version{}, fmt.Errorf("begin version transaction: %w", err)
	}
	defer tx.Rollback(ctx)
	queries := db.New(tx)
	parentID := params.ParentVersionID
	row, err := queries.CreateDocumentVersion(ctx, db.CreateDocumentVersionParams{
		ID: params.ID, DocumentID: params.DocumentID, ParentVersionID: &parentID,
		Operation: params.Operation, StoragePath: params.StoragePath, ByteSize: params.ByteSize,
		ChecksumSha256: params.Checksum, Metadata: string(metadata),
	})
	if err != nil {
		return Version{}, fmt.Errorf("create document version: %w", err)
	}
	if raw, exists := params.Metadata["pageCount"]; exists {
		var value int32
		switch count := raw.(type) {
		case int:
			value = int32(count)
		case int32:
			value = count
		case int64:
			value = int32(count)
		case float64:
			value = int32(count)
		}
		if value > 0 {
			if err := queries.UpdateDocumentPageCount(ctx, db.UpdateDocumentPageCountParams{ID: params.DocumentID, PageCount: &value}); err != nil {
				return Version{}, fmt.Errorf("update document page count: %w", err)
			}
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return Version{}, fmt.Errorf("commit document version: %w", err)
	}
	return mapVersion(row), nil
}

func (r *Repository) Rename(ctx context.Context, id uuid.UUID, name string) (Document, error) {
	value, err := db.New(r.pool).RenameDocument(ctx, db.RenameDocumentParams{ID: id, OriginalName: name})
	if err != nil {
		return Document{}, err
	}
	return mapDocument(value), nil
}

func (r *Repository) StartProcessing(ctx context.Context, documentID uuid.UUID, operation string, input map[string]any) (uuid.UUID, error) {
	encoded, err := json.Marshal(input)
	if err != nil {
		return uuid.Nil, err
	}
	id := uuid.New()
	_, err = db.New(r.pool).CreateProcessingRun(ctx, db.CreateProcessingRunParams{
		ID: id, DocumentID: &documentID, Operation: operation, Input: string(encoded),
	})
	return id, err
}

func (r *Repository) FinishProcessing(ctx context.Context, id uuid.UUID, status string, output map[string]any, errorCode string) error {
	encoded, err := json.Marshal(output)
	if err != nil {
		return err
	}
	var code *string
	if errorCode != "" {
		code = &errorCode
	}
	return db.New(r.pool).FinishProcessingRun(ctx, db.FinishProcessingRunParams{
		ID: id, Status: status, Output: string(encoded), ErrorCode: code,
	})
}
