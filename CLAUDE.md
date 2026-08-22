# Docuflow (pdf-app / PDF Web Studio)

Aplikasi PDF berbasis web. Monorepo Bun: `apps/web` (React + TypeScript + Vite),
`apps/api` (Go), `packages/api-client`, `packages/pdf-engine`, `packages/ui`.

Nama produk yang dipakai di UI adalah **Docuflow** (nama internal repo masih
pdf-web-studio).

## Baca dulu

- `README.md`
- `docs/FEATURES.md` — daftar fitur beserta status implementasinya
- `openapi/` — kontrak API
- PRD asli (`pdf-web-studio-prd.md`) adalah sumber kebenaran awal; kalau ada
  konflik, instruksi user menang.

## Stack

Frontend: TanStack Router / Query / Table / Virtual, Zustand untuk state editor,
React Hook Form + Zod, Tailwind + shadcn/ui (Radix).
Backend: Go, `net/http` + Chi, PostgreSQL via pgx/v5 + sqlc + Goose (migrasi
embedded). File PDF disimpan di filesystem lokal (`data/`, lihat `STORAGE_ROOT`).
Engine PDF lewat adapter yang bisa diganti; `qpdf` dan `OCRmyPDF` dipanggil
lewat `os/exec.CommandContext` kalau tersedia di PATH.

## Perintah

```bash
make setup        # bun install + go mod download
make generate     # sqlc generate + generate-routes
make migrate      # goose up
make dev-api      # Go API di 127.0.0.1:8080
make dev-web      # Vite di 127.0.0.1:5173
make test         # go test + typecheck + lint + test web
```

Konfigurasi lewat `.env` (contoh di `.env.example`). **Jangan menulis kredensial
DB asli ke file yang ter-commit** — password Supabase hanya di `.env` yang di-ignore.

## Cara kerja

- Bahasa Indonesia.
- **Jangan membuka/menggecek browser sendiri.** User yang mengecek tampilan di
  browsernya. Sampaikan apa yang perlu dilihat, jangan drive browser.
- Kalau menjalankan server, beritahu perintah yang bisa dipakai user untuk
  menjalankan sendiri, dan pastikan port dibebaskan setelah selesai.
- Kerjakan **satu fitur dulu sampai tuntas**, jangan menyapu semua fitur sekaligus.

## Aturan UI/UX

- Referensi desain: https://hellodani.co/ — bersih, lega, tipografi kuat.
- Semua tool dimulai dari **upload langsung**, bukan memilih dokumen dari Recent Files.
- Tombol aksi **disabled** selama file belum diupload.
- Dialog/sheet harus muncul di tengah dengan z-index di atas tabel — pernah bug
  muncul di bawah tabel.
- Hapus dari Recent Files harus lewat **dialog konfirmasi reusable**, dan file
  fisiknya di `data/` ikut terhapus.
- Perhatikan proporsi tombol (pernah ada keluhan tombol "gepeng").

## Perilaku fitur

- Navigasi: Edit PDF, Merge, Split, Compress, Convert, All Tools, Recent Files.
- **Split menghasilkan multi-output**: split 1–3 berarti 3 file yang bisa
  di-download, bukan satu file. Input rentang halaman jangan berupa text input polos.
- **Compress**: tiga tingkat (rendah / sedang / tinggi). Catatan: qpdf hanya
  melakukan optimasi struktural lossless, output disimpan hanya bila benar-benar
  lebih kecil — jangan menjanjikan kompresi agresif tanpa engine tambahan.
- **Convert**: jpg/word/powerpoint/excel/html ⇄ pdf. Sebagian masih mockup;
  cek `docs/FEATURES.md` untuk status terkini sebelum menyatakan sesuatu berfungsi.
- **Organize**: thumbnail, seleksi, reorder, rotate, delete, extract, duplicate,
  insert PDF, halaman kosong.
- **Protect** AES-256 dan **Unlock** berbasis kredensial.
- OCR lewat OCRmyPDF (opsional, butuh binary terpasang).

Kalau sebuah kapabilitas menampilkan "Capability unavailable — qpdf is not
installed or is not on PATH", itu masalah dependency sistem di mesin, bukan bug
aplikasi. qpdf dan OCRmyPDF harus ikut disediakan di environment deployment.

## Catatan

Disarikan dari 5 sesi Codex (Agustus 2026); korpus mentahnya tidak disimpan di repo.
