package database

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestDatabaseSchemaWhenConfigured(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("TEST_DATABASE_URL is not set; skipping PostgreSQL integration test")
	}
	pool, err := pgxpool.New(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	var tableCount int
	err = pool.QueryRow(t.Context(), `
		SELECT count(*) FROM information_schema.tables
		WHERE table_schema = 'public'
		  AND table_name IN ('documents', 'document_versions', 'processing_runs')
	`).Scan(&tableCount)
	if err != nil {
		t.Fatal(err)
	}
	if tableCount != 3 {
		t.Fatalf("found %d application tables, want 3; run migrations first", tableCount)
	}
	var deletedAtColumns int
	err = pool.QueryRow(t.Context(), `
		SELECT count(*) FROM information_schema.columns
		WHERE table_schema = 'public'
		  AND table_name = 'documents'
		  AND column_name = 'deleted_at'
	`).Scan(&deletedAtColumns)
	if err != nil {
		t.Fatal(err)
	}
	if deletedAtColumns != 1 {
		t.Fatal("documents.deleted_at is missing; run migrations")
	}
}
