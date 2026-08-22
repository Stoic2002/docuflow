# Font untuk overlay editor

Letakkan file `.ttf` di direktori ini. Backend memindainya saat start dan
menawarkannya lewat `GET /api/fonts`. Direktori bisa dipindah dengan `FONT_DIR`.

## Aturan

- **Hanya TrueType (`.ttf`).** Koleksi `.ttc` dan OpenType CFF (`.otf`) ditolak
  karena stream `FontFile2` pada PDF harus berisi satu font berbasis `glyf`.
- **Lisensi harus mengizinkan embedding.** Registry membaca bit `fsType` pada
  tabel OS/2 dan menolak font yang vendornya melarang embedding. Pengecekan itu
  membaca niat vendor, **bukan** pengganti membaca lisensinya. Font sistem
  bawaan macOS/Windows umumnya tidak boleh didistribusikan ulang — jangan
  disalin ke sini untuk deployment.
- Font yang aman dipakai adalah yang berlisensi SIL OFL atau Apache-2.0,
  misalnya keluarga Noto, Inter, Source Sans, atau Liberation.

## Perilaku kalau kosong

Direktori kosong atau tidak ada bukan error. Editor tetap jalan dengan
Helvetica bawaan PDF — tanpa embedding, dan hanya mencakup Latin-1.

Font yang ditolak tidak dibuang diam-diam; alasannya muncul di `GET /api/fonts`
pada field `issues`.
