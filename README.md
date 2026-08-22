# Docuflow

Tool-first PDF workspace built with React/TypeScript/Vite and one Go API. Every public tool starts from its own upload surface; Recent Files is secondary history rather than a prerequisite. PostgreSQL stores metadata, PDF bytes stay on the configured local filesystem, and originals remain immutable.

Dokumentasi status dan perilaku setiap fitur tersedia di [docs/FEATURES.md](docs/FEATURES.md).

## What works

- Streaming multipart upload with size, extension, MIME, and `%PDF-` signature validation.
- SHA-256 integrity metadata, UUID physical filenames, relative database paths, read-only committed originals, and atomic output rename.
- Document list/detail, original/version content with range support, version history, recoverable Trash, Restore, and explicitly confirmed permanent deletion of original/version bytes.
- Direct multipart Edit sessions, Merge, Split, Compress, OCR, and JPG-to-PDF endpoints; Split accepts one PDF and creates one independent output for every visually selected page, while legacy document-ID JSON calls remain compatible.
- Browser Preview fallback behind a replaceable `PdfEngine` contract, with PDF.js page count, virtual thumbnails, and sampled usable-text-layer detection.
- Public tool routes: `/edit`, `/merge`, `/split`, `/compress`, `/convert`, `/ocr`, `/all-tools`, `/recent`, `/trash`, and `/settings`.
- qpdf-backed merge, split/extract, rotate, reorder, delete-pages, and structural compression paths.
- OCRmyPDF searchable-text-layer path with `eng`/`ind` allowlisting.
- Health/capability endpoints; missing qpdf, OCRmyPDF, OCR language packs, or commercial SDKs never prevent startup.
- TanStack file-based Router, Query, Table, and Virtual; dnd-kit merge ordering/page UI; Zustand editor UI state; React Hook Form/Zod upload/tool forms; Tailwind and Radix-based UI primitives.

qpdf and OCRmyPDF operations are enabled only when their executables are present in the Go API process `PATH`. The fallback is deliberately labeled **Preview**, is view-only, and never claims native content editing or editable OCR reconstruction.

## Prerequisites

- Bun 1.3.14 (declared by root `packageManager`)
- Go 1.24+
- PostgreSQL 16+ locally, or a PostgreSQL-compatible Supabase connection
- Optional: qpdf and OCRmyPDF/Tesseract language packs

On macOS, the verified OCR setup is:

```sh
brew install ocrmypdf tesseract-lang
```

`tesseract-lang` is required for the Indonesian (`ind`) option; the base Tesseract package provides English. Restart the Go API after installing so a new capability detector can observe the executables and languages.

No Docker, Redis, external queue, Python backend, Rust backend, or system-software installer is included.

## Configuration

```sh
cp .env.example .env
```

For local PostgreSQL, create and start a database outside this repository:

```sh
createdb pdf_web_studio
```

The default `.env.example` URI then works. For Supabase, replace `DATABASE_URL` in the ignored `.env` with the project transaction-pooler URI and `sslmode=require`. pgx uses simple query protocol so the `:6543` transaction pooler does not depend on session-level prepared statements.

Never commit `.env`, a database password, vendor license key, or OCR document contents. The real Supabase password used during verification is not stored in this repository.

Other settings:

- `API_ADDR` defaults to `127.0.0.1:8080`.
- `FRONTEND_ORIGIN` defaults to `http://localhost:5173`.
- `STORAGE_ROOT` defaults to the repository `data/` directory when the API is started from `apps/api`.
- `MAX_UPLOAD_BYTES` defaults to 50 MiB.
- `REQUEST_TIMEOUT` defaults to 30 seconds; `PROCESSING_TIMEOUT` defaults to 5 minutes.

## Run locally

```sh
make setup
make generate
make migrate
```

Start the API and frontend in separate terminals:

```sh
make dev-api
make dev-web
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). Vite proxies `/api` to the Go API, so normal local development does not rely on permissive CORS.

The main navigation is job-based:

- **Edit PDF** creates a direct upload session and opens Preview mode until a commercial editing provider is configured.
- **Merge**, **Split**, and **Compress** upload directly to their own operation; Split presents visual page choices and separate downloads for every selected page, and qpdf availability controls whether processing can start.
- **Convert** now supports one to 20 ordered JPG/JPEG inputs → one immutable PDF using a Go-owned streaming implementation. Word, PowerPoint, Excel, HTML, and all PDF-to-other-format cards remain explicit disabled mockups until their engines are selected and verified.
- **All Tools** contains OCR and secondary destinations. **Recent Files** is only history.

Equivalent frontend commands from the root are:

```sh
bun install
bun run dev
bun run build
bun run typecheck
bun run lint
bun run test
```

`make generate` runs pinned sqlc (`v1.29.0`) through Go and generates TanStack's route tree. Goose migrations are embedded in the Go migration command, so a global Goose/sqlc installation is not required.

## Tests

```sh
make test
bun run build
```

Go tests cover safe path resolution/traversal, upload metadata/magic/size validation, explicit qpdf/OCRmyPDF argument construction, stable error mapping, direct multipart dispatch/session URLs, and database schema integration. The database integration test clearly skips when `TEST_DATABASE_URL` is absent; point it at an already migrated disposable database to run it:

```sh
cd apps/api
TEST_DATABASE_URL='postgres://localhost:5432/pdf_web_studio?sslmode=disable' go test ./...
```

The Playwright test assumes both development servers are already running:

```sh
bun run test:e2e
```

It verifies upload → list → open → download and compares SHA-256 bytes with `test/fixtures/sample.pdf`. Browser binaries are not installed automatically; if Playwright reports a missing executable, install the appropriate browser outside this project according to local policy.

## API and code layout

- `openapi/openapi.yaml` is the API contract/source of truth.
- `packages/api-client` is a hand-written thin client kept central so React components do not contain raw `fetch` calls. Code generation was intentionally deferred until the Go generator choice (`oapi-codegen` vs `ogen`) is made; the thin client mirrors the OpenAPI schemas used by this slice.
- `packages/pdf-engine` owns `PdfEngine`, PDF.js inspection, and `FallbackViewerEngine`; React components do not import PDF.js or Apryse/Nutrient APIs directly.
- `apps/api/internal/documents` owns immutable-file and version workflows.
- `apps/api/internal/processing` owns capability detection, validated argument builders, and `exec.CommandContext` calls without a shell.
- `apps/api/migrations` and `apps/api/queries` are the Goose/sqlc inputs; generated code is committed under `apps/api/internal/database/db`.

For merge, the current local MVP stores the merged result as a version of the first uploaded input and records all input document IDs in metadata. Direct tool uploads are currently also recorded in internal Recent history (`savedToRecent: true`) because persistence still uses the mature immutable-document pipeline; users never need to select those records before starting a tool. Compression is structural/lossless (`qpdf` object streams, Flate recompression, and linearization), not advanced image downsampling. If the output is not smaller, it is discarded and `COMPRESSION_NOT_SMALLER` is returned.

Deleting an item from Recent Files sets `documents.deleted_at` and moves the record into Trash while original/version bytes remain read-only. Trash supports Restore and a separately confirmed permanent delete. Permanent delete accepts only already-deleted records, validates every database-owned relative path through the storage resolver, deduplicates shared original/upload-version paths, stages files in `data/temporary/`, deletes related database rows transactionally, then removes the staged bytes. A failed database transaction restores the staged files.

## Known limitations and open decisions

- Apryse vs Nutrient and licensing remain unresolved. Native text/image editing, overlay annotations, and SDK export are disabled; they are not simulated by the fallback viewer.
- PDF.js samples up to three pages for usable text. `unknown` means inspection failed; `absent` is a scan signal, not proof about every page.
- Searchable OCR adds/selects a text layer; it does not reconstruct a fully editable original layout.
- JPG/JPEG → PDF is active, preserves multipart order, and places each source image proportionally on an auto-oriented A4 page without recompressing it. EXIF rotation is not applied in this first slice. PDF → JPG and Office/HTML conversions remain disabled until their runtime engines and output validation are integrated.
- Rename metadata and automatic Trash retention/expiry are not exposed yet; users must explicitly choose permanent deletion.
- qpdf 12.4.0, OCRmyPDF 17.10.0, Tesseract 5.5.3, English/Indonesian language packs, and Ghostscript 10.07.1 are available on the current local verification machine. Merge and the single-input/multi-output Split flow have been exercised end-to-end. Searchable OCR was also exercised through the Go API: an image-only fixture with zero extractable words produced a valid PDF whose text layer contained the expected test text, and the downloaded SHA-256 matched the recorded version checksum.
- Golden-corpus/visual-regression coverage is still below the PRD's 25-document hardening target.
- Signed/encrypted PDF warnings, vendor editing, overlay editing, and a public tool-first rotate/delete workflow remain follow-up work.

Originals under `data/originals/` are never opened for application writes after commit. Processing uses `data/temporary/`, validates the result, atomically renames into `data/versions/`, and only then records the new version. Runtime data is ignored by Git except for directory placeholders.
