# Font untuk overlay editor

Direktori ini sudah berisi font bawaan. Backend memindainya saat start dan
menawarkannya lewat `GET /api/fonts`. Lokasinya bisa dipindah dengan `FONT_DIR`.

## Yang sudah tersedia

| Keluarga | Gaya | Untuk apa |
| --- | --- | --- |
| **Liberation Sans** | Regular, Bold, Italic, Bold Italic | Pengganti **Arial** dan Helvetica |
| **Liberation Serif** | Regular, Bold, Italic, Bold Italic | Pengganti **Times New Roman** |
| **Liberation Mono** | Regular, Bold, Italic, Bold Italic | Pengganti **Courier New** |
| **Inter** | Regular, Bold, Italic | Sans modern untuk teks baru |

Keluarga Liberation dipilih bukan karena selera, tetapi karena **metriknya
kompatibel** dengan tiga font yang paling sering dipakai dokumen. Lebar tiap
karakternya sama persis dengan Arial, Times New Roman, dan Courier New —
sehingga teks pengganti pada alur cover & retype menempati ruang yang sama
dengan teks aslinya, dan tata letak halaman tidak bergeser.

Karena tiap keluarga lengkap dengan gaya tebal dan miringnya, tombol Tebal dan
Miring di editor memakai font aslinya, bukan mensintesis efeknya.

## Lisensi

Semuanya berlisensi **SIL Open Font License 1.1**, yang mengizinkan embedding ke
dalam PDF dan redistribusi. Teks lisensinya wajib ikut didistribusikan dan
tersimpan di sini:

- `LICENSE-Liberation.txt`
- `LICENSE-Inter.txt`

Jangan menghapus kedua file itu.

## Menambah font sendiri

Salin file `.ttf` ke direktori ini lalu **jalankan ulang API** — registry hanya
dibaca sekali saat start.

- **Hanya TrueType (`.ttf`).** Koleksi `.ttc` dan OpenType CFF (`.otf`) ditolak
  karena stream `FontFile2` pada PDF harus berisi satu font berbasis `glyf`.
- **Lisensi harus mengizinkan embedding.** Registry membaca bit `fsType` pada
  tabel OS/2 dan menolak font yang vendornya melarangnya. Pengecekan itu membaca
  niat vendor, **bukan** pengganti membaca lisensinya. Font bawaan sistem
  macOS/Windows umumnya tidak boleh didistribusikan ulang — jangan disalin ke
  sini untuk deployment.
- Beri nama file dengan pola keluarga dan gayanya, misalnya
  `NamaFont-Bold.ttf`, supaya editor dapat mengenali pasangan tebal/miringnya.

File yang ditolak tidak dibuang diam-diam; alasannya muncul di `GET /api/fonts`
pada field `issues`.

## Kalau direktori dikosongkan

Bukan error. Editor tetap jalan dengan Helvetica bawaan PDF — tanpa embedding,
dan hanya mencakup Latin-1, sehingga karakter di luar itu akan ditolak.
