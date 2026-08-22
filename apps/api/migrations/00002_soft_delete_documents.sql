-- +goose Up
ALTER TABLE documents
    ADD COLUMN deleted_at timestamptz NULL;

CREATE INDEX documents_active_created_at_idx
    ON documents (created_at DESC, id DESC)
    WHERE deleted_at IS NULL;

-- +goose Down
DROP INDEX documents_active_created_at_idx;
ALTER TABLE documents DROP COLUMN deleted_at;
