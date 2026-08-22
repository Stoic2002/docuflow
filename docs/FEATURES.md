# Fitur Docuflow

Dokumen ini menjelaskan fitur yang tersedia pada vertical slice lokal Docuflow, dependency yang dibutuhkan, serta batasan yang masih berlaku. Status fitur ditentukan oleh `GET /api/capabilities`, sehingga dependency opsional yang tidak tersedia akan menonaktifkan aksi terkait tanpa membuat aplikasi berhenti.

## Arti status

| Status | Arti |
| --- | --- |
| Tersedia | Dapat digunakan melalui UI dan API. |
| Bergantung capability | Implementasi tersedia, tetapi hanya aktif jika executable atau service yang dibutuhkan terdeteksi backend. |
| Preview | Dapat membuka dan melihat PDF, tetapi tidak mengubah konten native. |
| Mockup | Tampilan tersedia untuk memvalidasi alur UX; belum memproses file. |
| Lanjutan | Fondasi backend tersedia, tetapi alur UI publik belum lengkap. |

## Ringkasan fitur

| Fitur | Route utama | Status | Dependency |
| --- | --- | --- | --- |
| Dashboard | `/` | Tersedia | API, PostgreSQL, storage lokal |
| Edit PDF | `/edit` | Preview | PDF.js; editing native memerlukan SDK komersial |
| Merge PDF | `/merge` | Bergantung capability | qpdf |
| Split PDF | `/split` | Bergantung capability | qpdf |
| Compress PDF | `/compress` | Bergantung capability | qpdf |
| Convert JPG → PDF | `/convert` | Tersedia | API, PostgreSQL, storage lokal |
| Format Convert lainnya | `/convert` | Mockup | Engine terkait belum dipilih |
| Searchable OCR | `/ocr` | Bergantung capability | OCRmyPDF dan language pack |
| Recent Files | `/recent` | Tersedia | API, PostgreSQL, storage lokal |
| Trash | `/trash` | Tersedia | API, PostgreSQL, storage lokal |
| All Tools | `/all-tools` | Tersedia | Mengikuti capability setiap tool |
| Settings/status | `/settings` | Tersedia | Endpoint capabilities |

## Upload dan penyimpanan

- Upload PDF dilakukan secara streaming dan dibatasi oleh `MAX_UPLOAD_BYTES`.
- Backend memvalidasi ekstensi, MIME type, dan signature `%PDF-`.
- SHA-256 dihitung saat file diterima untuk pemeriksaan integritas.
- Nama file pengguna hanya disimpan sebagai metadata. File fisik menggunakan UUID dan database hanya menyimpan path relatif terhadap `STORAGE_ROOT`.
- Original disimpan sebagai file immutable dan tidak pernah ditimpa oleh operasi berikutnya.
- Hasil pemrosesan ditulis ke temporary file, divalidasi, lalu dipindahkan secara atomik ke penyimpanan versi.
- Upload dan hasil tool yang berhasil masuk ke Recent Files.

## Edit PDF dan Preview

Alur `/edit` menerima satu PDF lalu membuka workspace Preview. Fallback berbasis PDF.js menyediakan:

- tampilan PDF di browser;
- jumlah halaman;
- thumbnail halaman yang dirender secara virtual;
- indikasi sampel keberadaan text layer;
- zoom dan state UI editor yang disimpan secara lokal.

Fallback bukan native PDF editor. Tool untuk mengubah teks, gambar, anotasi, dan ekspor edit tetap dinonaktifkan sampai Apryse atau Nutrient dipilih, SDK berhasil dipasang, dan lisensi dikonfigurasi. Integrasi vendor nantinya tetap harus berada di balik kontrak `PdfEngine`; API vendor tidak disebarkan langsung ke komponen React.

## Merge PDF

Merge tersedia di `/merge` ketika qpdf terdeteksi oleh proses Go API.

- menerima 2 sampai 20 file PDF;
- urutan file dapat diubah dengan drag-and-drop;
- menghasilkan satu PDF baru;
- hasil dapat diunduh dan tercatat sebagai versi;
- tombol proses tetap dinonaktifkan sebelum minimal dua PDF tersedia.

Pemrosesan menggunakan `exec.CommandContext` dengan daftar argumen eksplisit. Backend tidak membangun shell command dari input pengguna.

## Split PDF

Split tersedia di `/split` ketika qpdf terdeteksi.

- menerima tepat satu PDF sebagai input;
- menampilkan pemilih halaman visual, bukan input rentang teks;
- seluruh halaman dipilih secara default setelah PDF selesai dianalisis;
- pengguna dapat memilih satu atau banyak halaman;
- setiap halaman terpilih menghasilkan satu file PDF mandiri;
- setiap output memiliki tombol download tersendiri;
- tombol proses dinonaktifkan sampai PDF dan minimal satu halaman tersedia.

Contoh: memilih halaman 1, 2, dan 3 menghasilkan tiga file PDF terpisah, bukan satu PDF berisi rentang 1–3.

## Compress PDF

Compress tersedia di `/compress` ketika qpdf terdeteksi. Implementasi saat ini hanya melakukan optimasi lossless/struktural, seperti object streams, Flate recompression, dan linearization.

- tidak melakukan advanced image downsampling;
- tidak mengklaim kualitas kompresi gambar seperti layanan kompresi khusus;
- output hanya disimpan bila ukurannya benar-benar lebih kecil;
- bila hasil tidak lebih kecil, temporary output dibuang dan API mengembalikan `COMPRESSION_NOT_SMALLER`;
- tombol proses dinonaktifkan sebelum satu PDF diunggah.

Pengembangan lebih lanjut untuk fitur ini sedang ditunda sesuai prioritas produk saat ini.

Tiga tingkat kompresi yang direncanakan tidak akan dipalsukan dengan mengganti angka `--compression-level` qpdf saja. Rancangan yang disarankan:

- **Rendah/Ringan:** structural lossless dengan qpdf; kualitas gambar tidak diubah.
- **Sedang/Seimbang:** optimasi gambar moderat dan structural pass.
- **Tinggi/Maksimal:** downsampling gambar lebih agresif dengan konsekuensi kualitas visual.

Mode Sedang dan Tinggi memerlukan engine pemrosesan gambar PDF tambahan, misalnya Ghostscript atau SDK PDF yang dipilih. Ghostscript sekarang tersedia pada mesin verifikasi lokal melalui dependency OCRmyPDF, tetapi kontrak mode, argumen aman, metrik kualitas, dan UI tiga tingkat belum diimplementasikan. Keduanya tetap unavailable sampai implementasi tersebut selesai dan outputnya diuji; qpdf sendiri tidak cukup untuk membuat tiga tier yang bermakna.

## Searchable OCR

OCR tersedia di `/ocr` ketika OCRmyPDF dan language pack yang diperlukan terdeteksi.

- menerima satu PDF;
- bahasa yang diizinkan saat ini: English (`eng`) dan Bahasa Indonesia (`ind`);
- menghasilkan PDF dengan text layer yang dapat dicari atau diseleksi;
- tombol proses dinonaktifkan ketika OCRmyPDF tidak tersedia atau file belum diunggah.

Searchable OCR tidak merekonstruksi layout menjadi dokumen yang sepenuhnya editable. Pada mesin verifikasi lokal, OCRmyPDF 17.10.0, Tesseract 5.5.3, serta model `eng` dan `ind` sudah tersedia. Alur API telah diverifikasi dengan fixture image-only: input tidak memiliki text layer, output valid menurut qpdf, teks uji dapat diekstrak, dan checksum download cocok dengan metadata versi.

## Convert

Halaman `/convert` sekarang memiliki vertical slice JPG/JPEG → PDF yang aktif:

- menerima satu sampai 20 JPG/JPEG;
- urutan drag-and-drop menjadi urutan halaman;
- upload setiap gambar di-stream ke temporary storage dan dibatasi oleh batas ukuran per file;
- ekstensi, MIME, struktur JPEG, serta batas dimensi/pixel divalidasi;
- setiap gambar ditempatkan proporsional pada A4 portrait atau landscape;
- byte JPEG asli di-embed tanpa recompression;
- gambar sumber temporary dibersihkan dan tidak disimpan sebagai dokumen;
- PDF hasil disimpan immutable, masuk Recent Files, dan dapat diunduh;
- orientasi EXIF belum diterapkan pada slice pertama ini.

Sembilan arah konversi lain masih berupa mockup UX. Kartu dan tombol aksinya sengaja dinonaktifkan karena engine terkait belum dipilih dan diverifikasi di backend Go.

Format yang ditampilkan:

- JPG ke PDF — **aktif**;
- Word ke PDF;
- PowerPoint ke PDF;
- Excel ke PDF;
- HTML ke PDF;
- PDF ke JPG;
- PDF ke Word;
- PDF ke PowerPoint;
- PDF ke Excel;
- PDF ke HTML.

PDF → JPG memungkinkan sebagai tahap berikutnya menggunakan Poppler yang sudah tersedia pada mesin verifikasi lokal. Office → PDF memerlukan LibreOffice yang benar-benar menjadi dependency deployment; HTML → PDF memerlukan renderer headless. PDF → Word/PowerPoint/Excel/HTML memerlukan engine yang dapat menjaga fidelity dan belum akan disimulasikan.

## Recent Files

Halaman `/recent` menampilkan dokumen yang tersimpan menggunakan TanStack Table.

- membuka detail/Preview;
- mengunduh original atau versi;
- melihat metadata dan riwayat versi;
- memindahkan dokumen ke Trash melalui dialog konfirmasi reusable yang tampil sebagai modal terpusat;
- menampilkan loading, empty, dan actionable error state.

Delete dari Recent Files adalah soft delete. File original dan versi belum dihapus pada tahap ini sehingga dokumen masih dapat dipulihkan.

## Trash

Halaman `/trash` menangani dokumen yang sudah dihapus dari Recent Files.

- Restore mengembalikan dokumen ke Recent Files;
- Delete permanently memerlukan konfirmasi terpisah;
- permanent delete hanya menerima record yang sudah berstatus deleted;
- seluruh path file diambil dari database, diselesaikan melalui safe path resolver, dan tidak berasal dari absolute path request;
- file original/versi dipindahkan lebih dulu ke area temporary;
- row database terkait dihapus dalam transaksi;
- kegagalan transaksi mengembalikan file yang sudah di-stage;
- setelah commit berhasil, byte yang di-stage dihapus permanen.

## Detail, versi, dan page operations

Detail dokumen tersedia di `/documents/$documentId`. Riwayat versi dan content endpoint mendukung download dengan HTTP range.

Backend juga memiliki operasi qpdf untuk:

- extract page range;
- rotate;
- reorder;
- delete pages.

UI organize berbasis dokumen tersedia di `/documents/$documentId/organize` untuk reorder halaman. Tool-first public flow untuk rotate dan delete pages masih merupakan pekerjaan lanjutan dan tidak dianggap selesai hanya karena endpoint backend sudah ada.

## Capability dan perilaku disabled

`/settings` dan dashboard membaca status runtime dari `/api/capabilities`, termasuk:

- koneksi PostgreSQL;
- storage lokal;
- qpdf dan versinya;
- OCRmyPDF dan alasannya bila tidak tersedia;
- native content editing;
- merge, split, compression, OCR, dan conversion.

Pada halaman tool, area upload dan tombol proses mengikuti status capability. Tombol juga tetap disabled sampai jumlah file atau pilihan halaman memenuhi syarat, dengan teks bantuan yang menjelaskan langkah berikutnya.

Status mesin verifikasi terakhir:

- qpdf `12.4.0`: tersedia;
- OCRmyPDF 17.10.0 dan Tesseract 5.5.3: tersedia dengan bahasa `eng` dan `ind`;
- Ghostscript 10.07.1: tersedia sebagai dependency OCR, tetapi mode Compress Sedang/Tinggi belum diimplementasikan;
- Apryse/Nutrient: belum dipilih dan belum berlisensi;
- JPG/JPEG → PDF built-in: tersedia; engine arah konversi lainnya belum tersedia.

## Endpoint utama

| Method | Endpoint | Fungsi |
| --- | --- | --- |
| `GET` | `/api/health` | Status API, database, dan storage |
| `GET` | `/api/capabilities` | Status dependency dan fitur runtime |
| `GET` / `POST` | `/api/documents` | List dan upload dokumen |
| `GET` / `DELETE` | `/api/documents/{documentId}` | Detail dan soft delete |
| `GET` | `/api/documents/{documentId}/content` | Download original |
| `GET` | `/api/documents/{documentId}/versions` | Riwayat versi |
| `GET` | `/api/documents/{documentId}/versions/{versionId}/content` | Download versi |
| `GET` | `/api/documents/trash` | List Trash |
| `POST` | `/api/documents/{documentId}/restore` | Restore soft-deleted document |
| `DELETE` | `/api/documents/{documentId}/permanent` | Permanent delete yang terkonfirmasi |
| `POST` | `/api/edit-sessions` | Membuat sesi Preview dari upload langsung |
| `POST` | `/api/tools/merge` | Merge PDF |
| `POST` | `/api/tools/split` | Split menjadi multi-output |
| `POST` | `/api/tools/extract` | Extract page range |
| `POST` | `/api/tools/rotate` | Rotate halaman |
| `POST` | `/api/tools/reorder` | Reorder halaman |
| `POST` | `/api/tools/delete-pages` | Delete halaman |
| `POST` | `/api/tools/compress` | Structural/lossless compression |
| `POST` | `/api/tools/ocr` | Searchable OCR |
| `POST` | `/api/tools/convert/jpg-to-pdf` | Satu hingga 20 JPG menjadi satu PDF |

Format error API konsisten:

```json
{
  "error": {
    "code": "STABLE_ERROR_CODE",
    "message": "Safe user-facing message",
    "details": {}
  }
}
```

## Jaminan keamanan dan integritas

- Original PDF tidak ditimpa.
- Tidak ada pemanggilan `/bin/sh`, `bash -c`, atau command string dari input pengguna.
- Absolute path dari request tidak disimpan atau dipercaya.
- Path traversal ditolak oleh storage resolver.
- Temporary file dibersihkan pada success, failure, dan cancellation.
- PDF document state dan `ArrayBuffer` besar tidak disimpan di Zustand.
- Secret, database password, dan license key hanya berasal dari environment lokal yang diabaikan Git.
- Dependency opsional yang hilang menghasilkan capability unavailable, bukan crash.

## Keputusan dan pekerjaan lanjutan

- Memilih Apryse atau Nutrient beserta model lisensinya untuk native editing.
- Mengintegrasikan Poppler untuk PDF → JPG serta memilih engine Office/HTML yang tetap mempertahankan Go sebagai satu-satunya application backend.
- Menyediakan tool-first UI untuk rotate dan delete pages.
- Menambah rename metadata dan kebijakan retensi/expiry Trash.
- Menambah peringatan khusus untuk PDF signed/encrypted.
- Memperluas golden corpus dan visual regression menuju target hardening PRD.
