package documents

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
	db "github.com/local/pdf-web-studio/apps/api/internal/database/db"
)

type Document struct {
	ID             uuid.UUID  `json:"id"`
	OriginalName   string     `json:"originalName"`
	MediaType      string     `json:"mediaType"`
	ByteSize       int64      `json:"byteSize"`
	PageCount      *int32     `json:"pageCount"`
	ChecksumSHA256 string     `json:"checksumSha256"`
	CreatedAt      time.Time  `json:"createdAt"`
	UpdatedAt      time.Time  `json:"updatedAt"`
	DeletedAt      *time.Time `json:"deletedAt,omitempty"`
	OriginalPath   string     `json:"-"`
}

type Version struct {
	ID              uuid.UUID      `json:"id"`
	DocumentID      uuid.UUID      `json:"documentId"`
	ParentVersionID *uuid.UUID     `json:"parentVersionId"`
	Operation       string         `json:"operation"`
	ByteSize        int64          `json:"byteSize"`
	ChecksumSHA256  string         `json:"checksumSha256"`
	Metadata        map[string]any `json:"metadata"`
	CreatedAt       time.Time      `json:"createdAt"`
	StoragePath     string         `json:"-"`
}

func mapDocument(value db.Document) Document {
	return Document{
		ID: value.ID, OriginalName: value.OriginalName, MediaType: value.MediaType,
		ByteSize: value.ByteSize, PageCount: value.PageCount, OriginalPath: value.OriginalPath,
		ChecksumSHA256: value.ChecksumSha256, CreatedAt: value.CreatedAt, UpdatedAt: value.UpdatedAt,
		DeletedAt: value.DeletedAt,
	}
}

func mapVersion(value db.DocumentVersion) Version {
	metadata := map[string]any{}
	_ = json.Unmarshal(value.Metadata, &metadata)
	return Version{
		ID: value.ID, DocumentID: value.DocumentID, ParentVersionID: value.ParentVersionID,
		Operation: value.Operation, StoragePath: value.StoragePath, ByteSize: value.ByteSize,
		ChecksumSHA256: value.ChecksumSha256, Metadata: metadata, CreatedAt: value.CreatedAt,
	}
}
