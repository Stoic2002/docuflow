package migrations

import "embed"

// FS contains the versioned Goose migrations used by both local development and tests.
//
//go:embed *.sql
var FS embed.FS
