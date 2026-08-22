# Font untuk overlay editor

Direktori ini sudah berisi font bawaan. Backend memindainya saat start dan
menawarkannya lewat `GET /api/fonts`. Lokasinya bisa dipindah dengan `FONT_DIR`.

## Yang sudah tersedia

61 face dari 17 keluarga, dikelompokkan per keluarga di daftar font editor.

### Pengganti font dokumen

| Keluarga | Gaya | Menggantikan |
| --- | --- | --- |
| **Liberation Sans** | Regular, Bold, Italic, Bold Italic | Arial, Helvetica |
| **Liberation Serif** | Regular, Bold, Italic, Bold Italic | Times New Roman |
| **Liberation Mono** | Regular, Bold, Italic, Bold Italic | Courier New |

Keluarga Liberation dipilih bukan karena selera, tetapi karena **metriknya
kompatibel** dengan tiga font yang paling sering dipakai dokumen. Lebar tiap
karakternya sama persis, sehingga teks pengganti pada alur cover & retype
menempati ruang yang sama dengan teks aslinya dan tata letak halaman tidak
bergeser.

### Sans-serif

Inter, Roboto, Open Sans, Lato, Poppins, Montserrat, Oswald, Bebas Neue.

### Serif

Merriweather, Lora, EB Garamond.

### Monospace

JetBrains Mono, Source Code Pro, Roboto Mono.

### Script

Pacifico, Great Vibes.

Karena hampir semua keluarga lengkap dengan gaya tebal dan miringnya, tombol
Tebal dan Miring di editor memakai font aslinya, bukan mensintesis efeknya.

## Lisensi

Semuanya berlisensi **SIL Open Font License 1.1**, kecuali Roboto yang
**Apache License 2.0**. Keduanya mengizinkan embedding ke dalam PDF dan
redistribusi.

Teks lisensi tiap keluarga wajib ikut didistribusikan dan tersimpan lengkap di
`LICENSES.md`. Jangan menghapus berkas itu.

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
  `NamaFont-Bold.ttf`. Editor mengelompokkan daftar font berdasarkan nama
  keluarga ini dan memakainya untuk mencari pasangan tebal/miringnya.
- **Font variabel tidak cocok.** Yang ikut di-embed hanya instance bawaannya,
  jadi semua ketebalan akan tampak sama. Pakai berkas statis per gaya.

File yang ditolak tidak dibuang diam-diam; alasannya muncul di `GET /api/fonts`
pada field `issues`.

## Kalau direktori dikosongkan

Bukan error. Editor tetap jalan dengan Helvetica bawaan PDF — tanpa embedding,
dan hanya mencakup Latin-1, sehingga karakter di luar itu akan ditolak.
