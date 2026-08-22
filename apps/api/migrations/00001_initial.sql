-- +goose Up
CREATE TABLE documents (
    id uuid PRIMARY KEY,
    original_name text NOT NULL,
    media_type text NOT NULL CHECK (media_type = 'application/pdf'),
    byte_size bigint NOT NULL CHECK (byte_size > 0),
    page_count integer NULL CHECK (page_count IS NULL OR page_count > 0),
    original_path text NOT NULL UNIQUE,
    checksum_sha256 text NOT NULL CHECK (length(checksum_sha256) = 64),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX documents_created_at_idx ON documents (created_at DESC);
CREATE INDEX documents_checksum_sha256_idx ON documents (checksum_sha256);

CREATE TABLE document_versions (
    id uuid PRIMARY KEY,
    document_id uuid NOT NULL REFERENCES documents(id) ON DELETE RESTRICT,
    parent_version_id uuid NULL REFERENCES document_versions(id) ON DELETE RESTRICT,
    operation text NOT NULL,
    storage_path text NOT NULL UNIQUE,
    byte_size bigint NOT NULL CHECK (byte_size > 0),
    checksum_sha256 text NOT NULL CHECK (length(checksum_sha256) = 64),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX document_versions_document_created_idx
    ON document_versions (document_id, created_at DESC);
CREATE INDEX document_versions_parent_idx
    ON document_versions (parent_version_id) WHERE parent_version_id IS NOT NULL;

CREATE TABLE processing_runs (
    id uuid PRIMARY KEY,
    document_id uuid NULL REFERENCES documents(id) ON DELETE SET NULL,
    operation text NOT NULL,
    status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'cancelled')),
    input jsonb NOT NULL DEFAULT '{}'::jsonb,
    output jsonb NOT NULL DEFAULT '{}'::jsonb,
    error_code text NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz NULL
);

CREATE INDEX processing_runs_document_started_idx
    ON processing_runs (document_id, started_at DESC);
CREATE INDEX processing_runs_status_idx ON processing_runs (status);

-- +goose Down
DROP TABLE processing_runs;
DROP TABLE document_versions;
DROP TABLE documents;
