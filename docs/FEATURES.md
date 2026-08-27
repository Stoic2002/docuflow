# Fitur Docuflow

Dokumen ini menjelaskan fitur yang tersedia pada vertical slice lokal Docuflow, dependency yang dibutuhkan, serta batasan yang masih berlaku. Status fitur ditentukan oleh `GET /api/capabilities`, sehingga dependency opsional yang tidak tersedia akan menonaktifkan aksi terkait tanpa membuat aplikasi berhenti.

## Arti status

| Status | Arti |
| --- | --- |
| Tersedia | Dapat digunakan melalui UI dan API. |
| Bergantung capability | Implementasi tersedia, tetapi hanya aktif jika executable atau service yang dibutuhkan terdeteksi backend. |
| Preview | Dapat membuka dan melihat PDF, tetapi tidak mengubah konten native. |
| Mockup | Tampilan tersedia untuk memvalidasi alur UX; belum memproses file. |

## Dua pola masuk yang berlaku sekarang

Ini perlu dibaca lebih dulu, karena tidak semua tool dimulai dengan cara yang sama.

**Mulai dari upload langsung** — halaman menampilkan dropzone, dan tombol aksi tetap disabled sampai file masuk:

`/edit`, `/merge`, `/split`, `/compress`, `/ocr`, `/convert`

**Mulai dari memilih dokumen yang sudah ada** — halaman menampilkan dropdown "Choose a recent PDF" yang diisi dari Recent Files:

`/protect`, `/unlock`, `/watermark`, `/page-numbers`, `/header-footer`, `/metadata`, dan Organize di `/documents/{documentId}/organize`

Pola kedua **belum sesuai** dengan aturan produk "semua tool dimulai dari upload langsung". Enam halaman tersebut dan Organize masih mengharuskan dokumen sudah ada di Recent Files lebih dulu, dan kartu "Organize PDF" di All Tools mengarah ke `/recent`, bukan ke halaman upload. Menyeragamkannya menjadi upload-first masih pekerjaan terbuka; sampai itu selesai, dokumen ini menjelaskan keadaan sebenarnya, bukan keadaan yang diinginkan.

## Ringkasan fitur

| Fitur | Route utama | Masuk lewat | Status | Dependency |
| --- | --- | --- | --- | --- |
| Dashboard | `/` | — | Tersedia | API, PostgreSQL, storage lokal |
| All Tools | `/all-tools` | — | Tersedia | Mengikuti capability setiap tool |
| Settings/status | `/settings` | — | Tersedia | Endpoint capabilities |
| Edit PDF (overlay editor) | `/edit` | Upload | Bergantung capability | PDF.js, qpdf, pdfinfo |
| Ganti teks asli (cover & retype) | `/edit` | Upload | Bergantung capability | PDF.js, qpdf, pdfinfo |
| Edit teks asli secara native | `/edit` | — | Belum tersedia | Memerlukan SDK komersial |
| Merge PDF | `/merge` | Upload | Bergantung capability | qpdf |
| Split PDF | `/split` | Upload | Bergantung capability | qpdf |
| Compress PDF | `/compress` | Upload | Bergantung capability | qpdf |
| Searchable OCR | `/ocr` | Upload | Bergantung capability | OCRmyPDF dan language pack |
| Convert JPG → PDF | `/convert` | Upload | Tersedia | API, PostgreSQL, storage lokal |
| Arah konversi lainnya | `/convert` | — | Mockup | Engine terkait belum dipilih |
| Watermark | `/watermark` | Pilih dokumen | Bergantung capability | qpdf, pdfinfo |
| Page Numbers | `/page-numbers` | Pilih dokumen | Bergantung capability | qpdf, pdfinfo |
| Header & Footer | `/header-footer` | Pilih dokumen | Bergantung capability | qpdf, pdfinfo |
| PDF Metadata | `/metadata` | Pilih dokumen | Bergantung capability | qpdf |
| Protect PDF | `/protect` | Pilih dokumen | Bergantung capability | qpdf |
| Unlock PDF | `/unlock` | Pilih dokumen | Bergantung capability | qpdf |
| Organize halaman | `/documents/{documentId}/organize` | Pilih dokumen | Bergantung capability | qpdf, pdftoppm |
| Detail dan riwayat versi | `/documents/{documentId}` | Pilih dokumen | Tersedia | API, PostgreSQL, storage lokal |
| Recent Files | `/recent` | — | Tersedia | API, PostgreSQL, storage lokal |
| Trash | `/trash` | — | Tersedia | API, PostgreSQL, storage lokal |

## Upload dan penyimpanan

- Upload PDF dilakukan secara streaming dan dibatasi oleh `MAX_UPLOAD_BYTES`.
- Backend memvalidasi ekstensi, MIME type, dan signature `%PDF-`.
- SHA-256 dihitung saat file diterima untuk pemeriksaan integritas.
- Nama file pengguna hanya disimpan sebagai metadata. File fisik menggunakan UUID dan database hanya menyimpan path relatif terhadap `STORAGE_ROOT`.
- Original disimpan sebagai file immutable dan tidak pernah ditimpa oleh operasi berikutnya.
- Hasil pemrosesan ditulis ke temporary file, divalidasi, lalu dipindahkan secara atomik ke penyimpanan versi.
- Upload dan hasil tool yang berhasil masuk ke Recent Files.

## Edit PDF dan Preview

Alur `/edit` menerima satu PDF lewat upload langsung, lalu membuka workspace Preview. Fallback berbasis PDF.js menyediakan:

- tampilan PDF di browser;
- jumlah halaman;
- thumbnail halaman yang dirender secara virtual;
- indikasi sampel keberadaan text layer;
- zoom dan state UI editor yang disimpan secara lokal.

Fallback bukan native PDF editor. Mengubah teks yang **sudah ada** di dalam PDF tetap memerlukan Apryse atau Nutrient, dan tombolnya tetap dinonaktifkan sampai SDK dipilih, dipasang, dan dilisensikan. Integrasi vendor nantinya tetap harus berada di balik kontrak `PdfEngine`; API vendor tidak disebarkan langsung ke komponen React.

Yang sudah tersedia tanpa SDK komersial adalah **overlay editing** — menambahkan objek baru di atas halaman. Lihat bagian berikutnya.

## Overlay editor

Objek yang ditambahkan diratakan ke atas halaman oleh backend dan disimpan sebagai versi baru lewat `POST /api/edit-sessions/{sessionId}/export`.

Kanvas menampilkan halaman yang dirender PDF.js dengan lapisan objek SVG di atasnya. Tersedia:

- tool Pilih, Geser halaman, Teks, Stabilo, Kotak, Elips, Garis, Panah, Coret bebas, dan Sisipkan JPG, tersusun sebagai rel vertikal melayang di kiri kanvas;
- **teks dan garis yang sudah ada di halaman langsung bisa diklik** dengan tool Pilih, tanpa berpindah mode. Deteksi berjalan saat halaman dibuka; kursor yang melewati elemen yang bisa diambil alih akan menyorotinya, dan tombol Sorot elemen asli menandai semuanya sekaligus;
- klik dua kali pada teks untuk mengubahnya **langsung di kanvas**, bukan lewat panel;
- geser objek dengan tool Pilih;
- geser halaman dengan menahan `Spasi` lalu menarik, dengan tool Geser halaman, atau dengan menarik area kosong saat tool Pilih aktif;
- panel Properti untuk warna, isi, ketebalan garis, ukuran teks, font, perataan, opacity, dan rotasi;
- undo/redo, hapus objek terpilih, navigasi halaman, dan zoom;
- pintasan papan tik: `Delete` menghapus objek terpilih, `Ctrl/Cmd+Z` urungkan, `Ctrl/Cmd+Shift+Z` ulangi;
- zoom dengan cubit dua jari di trackpad atau `Ctrl` + scroll, yang memperbesar ke titik kursor; usap dua jari biasa tetap menggulung halaman;
- editor memakai seluruh viewport: navigasi utama aplikasi disembunyikan dan kanvas mengisi tepi ke tepi, dengan panel properti mengambang di atasnya;
- warna diisi lewat pemilih warna maupun kode hex, dan ukuran teks dipilih dari daftar ukuran umum;
- teks bisa ditebalkan, dimiringkan, digarisbawahi, dan dicoret. Kalau keluarga font yang dipilih menyediakan file bold atau italic sungguhan, gaya itulah yang dipakai; kalau tidak, efeknya **disintesis** engine — tebal memakai mode render isi-plus-goresan, miring memiringkan matriks teks, sedangkan garis bawah dan coret digambar selebar teks menurut metrik fontnya sehingga tetap benar pada teks rata kanan maupun miring;
- **Stabilo** menandai teks atau garis yang sudah ada dengan blok transparan yang mengikuti bentuknya persis;
- **Panah** menggambar garis bermata panah yang ukurannya mengikuti ketebalan garis;
- objek bisa diduplikat, dibawa ke depan, atau dikirim ke belakang — yang terakhir berguna untuk memastikan penutup teks berada di bawah teks penggantinya.

Halaman aktif dan tingkat zoom disimpan di store editor yang sama dengan objek overlay, dan keduanya kembali ke nilai awal saat sesi ditutup.

Pratinjau di kanvas memakai font yang terpasang di browser, sedangkan hasil PDF memakai font yang di-embed backend. Untuk font yang tidak dimiliki browser, proporsinya bisa sedikit berbeda di layar; hasil akhirnya yang menentukan.

### Ganti teks asli (cover & retype)

Dengan tool Pilih, setiap potongan teks yang sudah ada di halaman langsung bisa diklik. Klik salah satunya, dan Docuflow:

1. mengukur warna latar di sekeliling teks itu dari halaman yang sudah dirender;
2. menebak warna tinta aslinya dari piksel yang paling jauh dari warna latar;
3. memilih font terdaftar yang paling mendekati font yang dipakai halaman;
4. menutup teks lama dengan kotak sewarna latar, lalu menulis teks yang sama di atasnya pada baseline yang persis sama.

Teks itu kemudian tinggal diedit di panel Properti. Penutup dan teks penggantinya dibuat sebagai satu langkah, jadi satu kali undo membatalkan keduanya.

**Batasannya harus dipahami sebelum dipakai:**

- Hasilnya **rapi hanya pada latar polos**. Pada foto, gradasi, atau tekstur, tambalannya akan terlihat. Docuflow mengukur keseragaman latar lebih dulu dan memberi peringatan bila tidak rata — tetapi tetap mengizinkan, karena kadang itu memang yang diinginkan.
- **Ini bukan redaksi yang aman.** Teks lama tetap ada di dalam file dan masih terbaca oleh ekstraktor teks seperti `pdftotext`; ia hanya tertutup secara visual. Untuk menghapus informasi sensitif secara permanen, cara ini tidak boleh dipakai.
- Halaman hasil scan tidak punya teks yang bisa dipilih. Jalankan Searchable OCR lebih dulu.
- Teks pengganti tidak mengalir ulang. Kalau teks baru lebih panjang, ia akan melewati batas teks lama.

Untuk mengubah teks berikut reflow paragrafnya, tetap dibutuhkan SDK komersial.

### Garis & tabel

Docuflow juga membaca operator grafis halaman dan mengenali garis lurus yang sudah ada: pembatas tabel, garis bawah, dan pemisah. Garis-garis itu ikut bisa diklik dengan tool Pilih, lalu ditutup dan digantikan objek garis baru yang bisa digeser, diubah warna dan ketebalannya, atau dihapus.

Yang dikenali:

- goresan mendatar dan tegak sepanjang minimal 8 pt;
- persegi panjang tipis (≤ 4 pt), karena banyak tabel menggambar pembatasnya sebagai kotak terisi, bukan garis;
- jumlah tabel dilaporkan dengan mengelompokkan garis yang saling berpotongan.

Yang **tidak** dikenali:

- garis diagonal dan kurva, karena editor hanya bisa menawarkan garis lurus sebagai penggantinya;
- garis pada halaman hasil scan, karena itu piksel gambar dan bukan vektor;
- halaman dengan MediaBox tidak dimulai dari titik nol atau punya rotasi — deteksi dilewati dan melaporkan nol garis, alih-alih menempatkan garis di posisi yang salah.

Tabel dikenali sebagai kumpulan garisnya, bukan sebagai satu objek dengan baris dan kolom. Mengedit isi selnya dilakukan lewat tool Ganti teks asli.

## Objek overlay

Objek yang didukung:

- **Teks** — warna, ukuran, rotasi, opacity, rata kiri/tengah/kanan, dan pilihan font.
- **Bentuk** — rectangle, ellipse, line, dan polyline untuk freehand, dengan stroke, fill opsional, ketebalan, opacity, dan rotasi.
- **Gambar** — JPEG, diposisikan lewat titik tengah, ukuran, opacity, dan rotasi.

Koordinat memakai satuan poin PDF dengan titik asal di **kiri-bawah** halaman. Kanvas editor melakukan satu kali pembalikan sumbu saat mengirim, sehingga backend tetap berada di sistem koordinat native PDF.

Batasan yang divalidasi backend: maksimal 500 objek per halaman dan 5000 per dokumen, teks maksimal 2000 karakter dan tidak boleh mengandung baris baru, nomor halaman harus ada di dokumen dan tidak boleh diulang, serta bentuk tanpa stroke maupun fill ditolak karena tidak akan terlihat. Pesan error menyebut objek mana yang bermasalah.

Original tidak pernah ditimpa; hasilnya selalu menjadi versi baru.

## Font

`GET /api/fonts` menampilkan font TrueType yang dapat di-embed. Backend memindai direktori `FONT_DIR` (default `assets/fonts`) saat start.

`GET /api/fonts/{fontId}/file` mengirim program TrueType-nya sendiri. Editor memuatnya sebagai web font, sehingga **preview dan pengukuran teks di browser memakai face yang sama persis dengan yang di-embed saat export** — bukan menebak dengan font yang kebetulan terpasang di mesin pengguna. Ini yang membuat kotak seleksi, grip, dan posisi caret akurat. Hanya id yang ada di `/api/fonts` yang bisa diakses, jadi pemeriksaan `fsType` dan lisensi yang sudah dilakukan registry tetap berlaku, dan tidak ada jalur ke filesystem. Respons memakai `ETag` plus `Cache-Control: public, max-age=86400`, dan hanya font yang benar-benar dipakai dokumen yang diunduh — bukan seratusnya.

Repo ini menyertakan **100 file `.ttf`** — SIL OFL 1.1 dan Apache 2.0, plus GUST Font License untuk keluarga Computer Modern — mencakup keluarga sans, serif, monospace, display, dan script:

Arimo, Bebas Neue, Caladea, Carlito, CMU Serif, CMU Typewriter, EB Garamond, Gelasio, Great Vibes, Inter, JetBrains Mono, Lato, Libre Baskerville, Liberation Mono, Liberation Sans, Liberation Serif, Lora, Merriweather, Montserrat, Open Sans, Oswald, Pacifico, Poppins, PT Serif, Roboto, Roboto Mono, Shippori Mincho, Source Code Pro, Source Serif 4, Tinos.

Keluarga Tinos/Arimo/Carlito/Caladea/Gelasio sengaja disertakan sebagai pengganti bebas yang metriknya kompatibel dengan Times New Roman, Arial, Calibri, Cambria, dan Georgia — kebutuhan umum format akademik dan CV; font proprietary aslinya tidak boleh didistribusikan bersama repo. Panel editor memetakan nama PostScript yang umum di dokumen (mis. `ArialMT`, `TimesNewRomanPSMT`, `MS-PMincho`) langsung ke penggantinya dan menandainya `→ NamaPengganti`. Rincian lisensi tiap keluarga ada di `assets/fonts/LICENSES.md`.

Sebagian besar keluarga disertakan lengkap dengan gaya tebal, miring, dan tebal-miringnya. Keluarga Liberation penting secara khusus karena metriknya kompatibel dengan Arial, Times New Roman, dan Courier New — lebar tiap karakternya sama persis, sehingga teks pengganti pada alur cover & retype menempati ruang yang sama dengan teks aslinya dan tata letak halaman tidak bergeser.

- Hanya `.ttf` berbasis `glyf`; `.ttc` dan `.otf` CFF ditolak.
- Bit `fsType` pada tabel OS/2 dibaca, dan font yang vendornya melarang embedding ditolak. Ini membaca niat vendor, bukan pengganti membaca lisensinya.
- Font di-embed sebagai `CIDFontType2` dengan encoding `Identity-H` dan CMap `ToUnicode`, sehingga teks hasilnya tetap dapat diseleksi dan dicari.
- Hanya glyph yang dipakai yang ikut di-embed. Halaman uji berisi enam font turun dari 3,2 MB menjadi 194 KB.
- Direktori kosong bukan error. Editor tetap jalan dengan Helvetica bawaan PDF, yang tidak perlu di-embed tetapi hanya mencakup Latin-1.
- File yang ditolak dilaporkan pada field `issues`, bukan dibuang diam-diam.

Belum didukung: shaping untuk aksara yang membutuhkannya seperti Arab, Thai, dan Devanagari. Latin dan Bahasa Indonesia sudah benar.

### Font yang sudah ada di dokumen

`GET /api/documents/{documentId}/fonts` memindai font yang **sudah dipakai** PDF yang diupload, lewat `pdffonts`. Editor menampilkannya di panel kanan dan menandai mana yang sudah terpasang di server dan mana yang belum.

Font yang bertanda **belum ada** tidak bisa dipakai untuk teks pengganti; Docuflow memilih font terdekat yang tersedia. Daftar ini memberi tahu persis file `.ttf` mana yang perlu disalin ke `assets/fonts/`.

## Merge PDF

Merge tersedia di `/merge` ketika qpdf terdeteksi oleh proses Go API.

- menerima 2 sampai 20 file PDF lewat upload langsung;
- urutan file dapat diubah dengan drag-and-drop;
- menghasilkan satu PDF baru;
- hasil dapat diunduh dan tercatat sebagai versi;
- tombol proses tetap dinonaktifkan sebelum minimal dua PDF tersedia.

Pemrosesan menggunakan `exec.CommandContext` dengan daftar argumen eksplisit. Backend tidak membangun shell command dari input pengguna.

## Split PDF

Split tersedia di `/split` ketika qpdf terdeteksi.

- menerima tepat satu PDF sebagai input;
- menampilkan pemilih halaman visual berbasis thumbnail, bukan input rentang teks;
- seluruh halaman dipilih secara default setelah PDF selesai dianalisis;
- pengguna dapat membatalkan pilihan halaman mana pun;
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

**Tiga tingkat kompresi (rendah/sedang/tinggi) belum ada — tidak di UI maupun di API.** Halaman `/compress` hanya menyediakan satu mode lossless. Tiga tingkat itu tidak akan dipalsukan dengan mengganti angka `--compression-level` qpdf saja. Rancangan yang disarankan:

- **Rendah/Ringan:** structural lossless dengan qpdf; kualitas gambar tidak diubah.
- **Sedang/Seimbang:** optimasi gambar moderat dan structural pass.
- **Tinggi/Maksimal:** downsampling gambar lebih agresif dengan konsekuensi kualitas visual.

Mode Sedang dan Tinggi memerlukan engine pemrosesan gambar PDF tambahan, misalnya Ghostscript atau SDK PDF yang dipilih. Ghostscript tersedia pada mesin verifikasi lokal melalui dependency OCRmyPDF, tetapi kontrak mode, argumen aman, metrik kualitas, dan UI tiga tingkat belum diimplementasikan.

## Searchable OCR

OCR tersedia di `/ocr` ketika OCRmyPDF dan language pack yang diperlukan terdeteksi.

- menerima satu PDF lewat upload langsung;
- bahasa yang diizinkan saat ini: English (`eng`) dan Bahasa Indonesia (`ind`);
- menghasilkan PDF dengan text layer yang dapat dicari atau diseleksi;
- tombol proses dinonaktifkan ketika OCRmyPDF tidak tersedia atau file belum diunggah.

Searchable OCR tidak merekonstruksi layout menjadi dokumen yang sepenuhnya editable.

## Convert

Halaman `/convert` memiliki vertical slice JPG/JPEG → PDF yang aktif:

- menerima satu sampai 20 JPG/JPEG;
- urutan drag-and-drop menjadi urutan halaman;
- upload setiap gambar di-stream ke temporary storage dan dibatasi oleh batas ukuran per file;
- ekstensi, MIME, struktur JPEG, serta batas dimensi/pixel divalidasi;
- setiap gambar ditempatkan proporsional pada A4 portrait atau landscape;
- byte JPEG asli di-embed tanpa recompression;
- gambar sumber temporary dibersihkan dan tidak disimpan sebagai dokumen;
- PDF hasil disimpan immutable, masuk Recent Files, dan dapat diunduh;
- orientasi EXIF belum diterapkan pada slice pertama ini.

Sembilan arah konversi lain masih berupa mockup UX dengan kartu dan tombol yang sengaja dinonaktifkan: Word/PowerPoint/Excel/HTML → PDF, dan PDF → JPG/Word/PowerPoint/Excel/HTML.

PDF → JPG memungkinkan sebagai tahap berikutnya menggunakan Poppler yang sudah tersedia pada mesin verifikasi lokal. Office → PDF memerlukan LibreOffice yang benar-benar menjadi dependency deployment; HTML → PDF memerlukan renderer headless. PDF → Word/PowerPoint/Excel/HTML memerlukan engine yang dapat menjaga fidelity dan belum akan disimulasikan.

## Watermark, Page Numbers, Header & Footer

Ketiganya memakai jalur overlay yang sama di backend dan aktif ketika qpdf **dan** pdfinfo terdeteksi. Semuanya masih dimulai dengan memilih dokumen dari Recent Files.

- **Watermark** (`/watermark`) — teks dengan preset umum, atau logo JPEG. Opacity, rotasi, skala, penempatan horizontal/vertikal, dan rentang halaman dapat diatur, dengan pratinjau representatif di sisi kanan.
- **Page Numbers** (`/page-numbers`) — enam preset penempatan, nomor awal, prefix, suffix, opsi menyertakan total halaman, lewati halaman pertama, dan rentang halaman.
- **Header & Footer** (`/header-footer`) — tiga kolom (kiri, tengah, kanan) untuk header dan footer secara terpisah, dengan variabel `{page}`, `{pages}`, `{filename}`, dan `{date}`.

## PDF Metadata

`/metadata` membaca judul, penulis, subject, dan keywords yang tertanam, lalu menyimpannya kembali sebagai versi baru. Panel kanan menampilkan jumlah halaman, ukuran file, dan waktu modifikasi. Field yang dikosongkan akan dihapus dari dokumen.

## Protect dan Unlock

- **Protect** (`/protect`) — memasang password buka dengan enkripsi AES-256 dan mengatur izin pembaca (printing, copying, modification, annotation, form filling, assembly). Izin pembaca adalah petunjuk kebijakan, bukan jaminan terhadap segala bentuk ekstraksi konten. Konfirmasi password wajib cocok sebelum tombol aktif.
- **Unlock** (`/unlock`) — melepas enkripsi hanya bila password yang benar diberikan.

Dokumen yang mengandung tanda tangan digital memicu peringatan, dan tombol proses tetap disabled sampai pengguna mencentang konfirmasi bahwa modifikasi dapat membatalkan tanda tangan tersebut. Ini berlaku untuk seluruh tool pada kelompok ini.

## Organize halaman

`/documents/{documentId}/organize` menampilkan thumbnail halaman dan mendukung:

- seleksi halaman;
- reorder lewat drag-and-drop, lalu disimpan sebagai satu operasi;
- rotate;
- delete pages;
- duplicate pages;
- extract menjadi dokumen baru;
- insert PDF lain;
- insert halaman kosong.

Thumbnail memerlukan `pdftoppm`; operasi halamannya memerlukan qpdf.

## Recent Files

Halaman `/recent` menampilkan dokumen yang tersimpan menggunakan TanStack Table:

- membuka detail/Preview;
- mengunduh original atau versi;
- rename display name;
- melihat metadata dan riwayat versi;
- memindahkan dokumen ke Trash melalui dialog konfirmasi reusable yang tampil sebagai modal terpusat;
- **menghapus banyak dokumen sekaligus** — lihat di bawah;
- menampilkan loading, empty, dan actionable error state.

Delete dari Recent Files adalah soft delete. File original dan versi belum dihapus pada tahap ini sehingga dokumen masih dapat dipulihkan.

### Bulk delete

Setiap baris punya checkbox, dan checkbox di kepala tabel memilih atau membatalkan seluruh baris sekaligus dengan status setengah-terpilih bila hanya sebagian yang dipilih. Begitu ada yang terpilih, sebuah bar muncul di atas tabel dengan jumlah dokumen terpilih, tombol Batalkan pilihan, dan tombol hapus yang menyebut jumlahnya. Konfirmasi tetap melewati dialog reusable yang sama.

Seleksi dikunci pada ID dokumen, sehingga refetch yang mengubah urutan baris tidak memindahkan pilihan ke dokumen lain.

## Trash

Halaman `/trash` menangani dokumen yang sudah dihapus dari Recent Files.

- Restore mengembalikan dokumen ke Recent Files;
- Delete permanently memerlukan konfirmasi terpisah;
- **hapus permanen banyak dokumen sekaligus** lewat checkbox per kartu dan checkbox Pilih semua, dengan dialog konfirmasi yang menyebut jumlahnya;
- permanent delete hanya menerima record yang sudah berstatus deleted;
- seluruh path file diambil dari database, diselesaikan melalui safe path resolver, dan tidak berasal dari absolute path request;
- file original/versi dipindahkan lebih dulu ke area temporary;
- row database terkait dihapus dalam transaksi;
- kegagalan transaksi mengembalikan file yang sudah di-stage;
- setelah commit berhasil, byte yang di-stage dihapus permanen.

### Semantik bulk delete

Kedua endpoint bulk memproses dokumen **satu per satu** dan selalu menjawab per dokumen:

```json
{ "deleted": ["<uuid>"], "failed": [{ "documentId": "<uuid>", "code": "DOCUMENT_NOT_FOUND", "message": "…" }] }
```

- Satu dokumen yang gagal tidak membatalkan sisanya. Ini disengaja: dokumen yang sudah hilang tidak boleh menggagalkan 19 dokumen lain yang valid.
- Untuk hapus permanen, setiap dokumen tetap di-stage dan di-commit sendiri-sendiri. Dokumen yang dilaporkan `deleted` benar-benar hilang beserta byte-nya; dokumen yang dilaporkan `failed` masih utuh, baik row maupun file-nya.
- ID yang diulang di dalam satu permintaan hanya diproses sekali.
- Maksimal 200 dokumen per permintaan; lebih dari itu ditolak dengan `TOO_MANY_DOCUMENTS`, dan daftar kosong ditolak dengan `NO_DOCUMENTS_SELECTED`.
- Permintaan yang diputus di tengah jalan berhenti pada dokumen berikutnya; yang sudah ter-commit tetap terhapus.
- UI menyebutkan **nama** dokumen yang gagal, bukan hanya jumlahnya.

Bulk restore di Trash belum ada; pemulihan masih satu per satu.

## Detail, versi, dan page operations

Detail dokumen tersedia di `/documents/{documentId}`. Riwayat versi dan content endpoint mendukung download dengan HTTP range.

Rotate, reorder, delete pages, duplicate, extract, dan insert tersedia lewat UI Organize di atas. Alur tool-first publik untuk rotate dan delete pages — yaitu halaman sendiri yang dimulai dari upload — masih pekerjaan lanjutan dan tidak dianggap selesai hanya karena endpoint backend sudah ada.

## Capability dan perilaku disabled

`/settings` dan dashboard membaca status runtime dari `/api/capabilities`, termasuk koneksi PostgreSQL, storage lokal, qpdf, OCRmyPDF, pdfinfo, pdftoppm, pdffonts beserta versinya atau alasan ketidaktersediaannya, serta flag per fitur.

Pada halaman tool, area upload dan tombol proses mengikuti status capability. Tombol juga tetap disabled sampai jumlah file atau pilihan halaman memenuhi syarat, dengan teks bantuan yang menjelaskan langkah berikutnya. Kartu di All Tools menampilkan lencana Available/Unavailable per tool.

Pesan "Capability unavailable — qpdf is not installed or is not on PATH" berarti dependency sistem belum terpasang di mesin, bukan bug aplikasi. qpdf dan OCRmyPDF harus ikut disediakan di environment deployment.

Snapshot mesin verifikasi lokal terakhir:

- qpdf `12.4.0`: tersedia;
- OCRmyPDF 17.10.0 dan Tesseract 5.5.3: tersedia dengan bahasa `eng` dan `ind`;
- Ghostscript 10.07.1: tersedia sebagai dependency OCR, tetapi mode Compress Sedang/Tinggi belum diimplementasikan;
- Apryse/Nutrient: belum dipilih dan belum berlisensi;
- JPG/JPEG → PDF built-in: tersedia; engine arah konversi lainnya belum tersedia.

## Endpoint utama

Kontrak lengkapnya ada di `openapi/openapi.yaml`.

| Method | Endpoint | Fungsi |
| --- | --- | --- |
| `GET` | `/api/health` | Status API, database, dan storage |
| `GET` | `/api/capabilities` | Status dependency dan fitur runtime |
| `GET` | `/api/fonts` | Font yang dapat di-embed dan file yang ditolak |
| `POST` | `/api/edit-sessions` | Membuat sesi Preview dari upload langsung |
| `GET` | `/api/edit-sessions/{sessionId}` | Detail sesi Preview |
| `POST` | `/api/edit-sessions/{sessionId}/export` | Meratakan dokumen overlay editor menjadi versi baru |
| `GET` / `POST` | `/api/documents` | List dan upload dokumen |
| `GET` | `/api/documents/trash` | List Trash |
| `POST` | `/api/documents/bulk-delete` | Soft delete banyak dokumen sekaligus |
| `POST` | `/api/documents/bulk-permanent-delete` | Hapus permanen banyak dokumen sekaligus |
| `GET` / `PATCH` / `DELETE` | `/api/documents/{documentId}` | Detail, rename, dan soft delete |
| `POST` | `/api/documents/{documentId}/restore` | Restore soft-deleted document |
| `DELETE` | `/api/documents/{documentId}/permanent` | Permanent delete yang terkonfirmasi |
| `GET` | `/api/documents/{documentId}/content` | Download original |
| `GET` | `/api/documents/{documentId}/versions` | Riwayat versi |
| `GET` | `/api/documents/{documentId}/versions/{versionId}/content` | Download versi |
| `GET` | `/api/documents/{documentId}/fonts` | Font yang sudah dipakai di dalam dokumen |
| `GET` / `PATCH` | `/api/documents/{documentId}/metadata` | Baca dan ubah metadata tertanam |
| `GET` | `/api/documents/{documentId}/pages/{page}/thumbnail` | Thumbnail satu halaman |
| `POST` | `/api/tools/merge` | Merge PDF |
| `POST` | `/api/tools/split` | Split menjadi multi-output |
| `POST` | `/api/tools/extract` | Extract page range |
| `POST` | `/api/tools/rotate` | Rotate halaman |
| `POST` | `/api/tools/reorder` | Reorder halaman |
| `POST` | `/api/tools/delete-pages` | Delete halaman |
| `POST` | `/api/tools/duplicate-pages` | Duplicate halaman |
| `POST` | `/api/tools/insert-pages` | Sisipkan halaman dari PDF lain |
| `POST` | `/api/tools/insert-blank-page` | Sisipkan halaman kosong |
| `POST` | `/api/tools/protect` | Enkripsi AES-256 dan izin pembaca |
| `POST` | `/api/tools/unlock` | Lepas enkripsi dengan password yang benar |
| `POST` | `/api/tools/watermark` | Watermark teks atau JPEG |
| `POST` | `/api/tools/page-numbers` | Nomor halaman |
| `POST` | `/api/tools/header-footer` | Header dan footer |
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

- Menyeragamkan pola masuk: memindahkan Protect, Unlock, Watermark, Page Numbers, Header & Footer, Metadata, dan Organize dari "pilih dokumen" ke upload langsung.
- Memilih Apryse atau Nutrient beserta model lisensinya untuk native editing teks yang sudah ada.
- Mengimplementasikan Compress tiga tingkat dengan engine gambar tambahan, bukan sekadar mengganti angka `--compression-level`.
- Mengintegrasikan Poppler untuk PDF → JPG serta memilih engine Office/HTML yang tetap mempertahankan Go sebagai satu-satunya application backend.
- Menyediakan tool-first UI untuk rotate dan delete pages.
- Menambahkan bulk restore di Trash, serta kebijakan retensi/expiry Trash.
- Memperluas golden corpus dan visual regression menuju target hardening PRD.
