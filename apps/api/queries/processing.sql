-- name: CreateProcessingRun :one
INSERT INTO processing_runs (id, document_id, operation, status, input)
VALUES (sqlc.arg(id), sqlc.narg(document_id), sqlc.arg(operation), 'running', sqlc.arg(input)::text::jsonb)
RETURNING *;

-- name: FinishProcessingRun :exec
UPDATE processing_runs
SET status = sqlc.arg(status), output = sqlc.arg(output)::text::jsonb,
    error_code = sqlc.narg(error_code), finished_at = now()
WHERE id = sqlc.arg(id);
