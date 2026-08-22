-- name: CreateDocument :one
INSERT INTO documents (
    id, original_name, media_type, byte_size, page_count, original_path, checksum_sha256
) VALUES (
    $1, $2, $3, $4, $5, $6, $7
)
RETURNING *;

-- name: ListDocuments :many
SELECT * FROM documents
WHERE deleted_at IS NULL
ORDER BY created_at DESC, id DESC;

-- name: GetDocument :one
SELECT * FROM documents WHERE id = $1 AND deleted_at IS NULL;

-- name: ListDeletedDocuments :many
SELECT * FROM documents
WHERE deleted_at IS NOT NULL
ORDER BY deleted_at DESC, id DESC;

-- name: GetDeletedDocument :one
SELECT * FROM documents WHERE id = $1 AND deleted_at IS NOT NULL;

-- name: SoftDeleteDocument :execrows
UPDATE documents
SET deleted_at = now(), updated_at = now()
WHERE id = $1 AND deleted_at IS NULL;

-- name: RestoreDocument :execrows
UPDATE documents
SET deleted_at = NULL, updated_at = now()
WHERE id = $1 AND deleted_at IS NOT NULL;

-- name: ClearDocumentVersionParents :exec
UPDATE document_versions
SET parent_version_id = NULL
WHERE document_id = $1;

-- name: DeleteDocumentVersions :exec
DELETE FROM document_versions WHERE document_id = $1;

-- name: DeleteProcessingRunsForDocument :exec
DELETE FROM processing_runs WHERE document_id = $1;

-- name: HardDeleteDocument :execrows
DELETE FROM documents WHERE id = $1 AND deleted_at IS NOT NULL;

-- name: UpdateDocumentPageCount :exec
UPDATE documents SET page_count = $2, updated_at = now() WHERE id = $1;

-- name: RenameDocument :one
UPDATE documents
SET original_name = $2, updated_at = now()
WHERE id = $1 AND deleted_at IS NULL
RETURNING *;

-- name: CreateDocumentVersion :one
INSERT INTO document_versions (
    id, document_id, parent_version_id, operation, storage_path, byte_size, checksum_sha256, metadata
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, sqlc.arg(metadata)::text::jsonb
)
RETURNING *;

-- name: ListDocumentVersions :many
SELECT * FROM document_versions
WHERE document_id = $1
ORDER BY created_at DESC, id DESC;

-- name: GetDocumentVersion :one
SELECT * FROM document_versions
WHERE document_id = $1 AND id = $2;

-- name: GetLatestDocumentVersion :one
SELECT * FROM document_versions
WHERE document_id = $1
ORDER BY created_at DESC, id DESC
LIMIT 1;
