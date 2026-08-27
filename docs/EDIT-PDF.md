# Edit PDF (Overlay Editor) — Fitur & Audit Task

Dokumen ini menjelaskan (A) semua fitur yang **sudah ada** di menu *Edit PDF*
per 24 Agustus 2026, dan (B) hasil pemeriksaan terhadap 4 task terakhir.

Kode sumber: `apps/web/src/features/editor/`.

| Berkas | Peran |
| --- | --- |
| `edit-landing-page.tsx` | Halaman upload sebelum masuk editor |
| `overlay-editor.tsx` | Shell editor: header, zoom, pan, panel, simpan |
| `overlay/editor-canvas.tsx` | Kanvas: render halaman, gesture, seleksi, resize |
| `overlay/object-layer.tsx` | Lapisan SVG untuk objek overlay |
| `overlay/properties-bar.tsx` | Toolbar properti melayang (kontekstual) |
| `overlay/bar-popover.tsx` | Dropdown kecil untuk kontrol yang tidak muat di bar |
| `overlay/toolbar.tsx` | Rail tool vertikal di kiri |
| `overlay/scale.ts` | Matematika grip resize (union bounds, faktor skala) |
| `overlay/split.ts` | Memecah objek teks agar sebagian kata bisa bergaya lain |
| `overlay/ink-spans.ts` | Membaca perubahan warna tinta di dalam satu potongan teks |
| `overlay/viewport.ts` | Padding kanvas + kompensasi scroll saat zoom |
| `overlay/font-loading.ts` | Memuat face dari API sebagai web font |
| `overlay/store.ts` | State Zustand + history |
| `overlay/retype.ts` | Deteksi teks/garis cetak, sampling warna, pemetaan font |
| `overlay/serialize.ts` | Konversi objek editor → format wire API |

---

## A. Fitur yang ada saat ini

### 1. Masuk editor lewat upload langsung
- `/edit` hanya menampilkan dropzone; **tidak** ada pemilihan dari Recent Files
  (`edit-landing-page.tsx`).
- Dropzone dimatikan bila kapabilitas `upload` backend belum siap, lengkap dengan
  alasan ("Database atau storage belum tersedia").
- Upload memanggil `api.createEditSession(file)` lalu redirect ke
  `/edit/$sessionId`.

### 2. Render halaman
- PDF dirender oleh PDF.js lewat adapter `OverlayEditorEngine`
  (`packages/pdf-engine`). Backing store di-*oversample* sesuai
  `devicePixelRatio`, ukuran layout ditetapkan lewat CSS lebih dulu supaya
  halaman tidak "melompat" saat render selesai.
- Bitmap hasil render terakhir disimpan (`bufferRef`) dan dipakai untuk membaca
  piksel di belakang elemen — dasar dari alur *cover & retype*.
- Deteksi lapisan teks: kalau halaman hasil scan (`textLayer === "absent"`),
  panel menampilkan ajakan menjalankan OCR lebih dulu.

### 3. Rail tool (kiri, vertikal)
`overlay/toolbar.tsx`, dikelompokkan dengan pemisah:

| Grup | Tool |
| --- | --- |
| Navigasi | **Pilih**, **Geser halaman** (hand) |
| Teks | **Teks**, **Stabilo** |
| Bentuk | **Kotak**, **Elips**, **Garis**, **Panah**, **Coret bebas** |
| Media | **Sisipkan JPG** (maks. 20 gambar/dokumen) |
| Bantuan | **Sorot elemen asli** (tandai semua teks/garis yang bisa diambil alih) |

Rail dibatasi tinggi kanvas dan bisa di-scroll internal, jadi tidak lagi
menembus batas bawah layar pada viewport pendek atau zoom browser >100%.
Tooltip terbuka ke kanan (`side="right"`) agar tidak menabrak tepi jendela.

### 4. Cover & retype — mengedit teks yang sudah tercetak
Inti fitur Edit PDF. Dengan tool **Pilih**:
1. Semua *text run* dan garis vektor halaman dideteksi saat halaman dibuka
   (`detectedTargets`), lalu disorot saat kursor melewatinya.
2. Sekali klik pada teks cetak → `takeOver()`, lalu editor caret langsung
   terbuka di titik yang diklik (tanpa klik kedua):
   - membaca warna latar & warna tinta di sekitar elemen (`sampleRegion`),
   - membuat **kotak penutup** berwarna latar,
   - membuat **teks pengganti** yang menyalin isi, posisi, ukuran, rotasi, dan
     font terdekat (`matchFont`),
   - keduanya diberi `groupId` yang sama sehingga bergerak, diskalakan,
     diduplikasi, dan dihapus sebagai satu unit.
3. Penutupnya **dipatok** di tempat: menggeser atau mengubah ukuran teks
   pengganti tidak menggeser penutup, sehingga teks cetak aslinya tidak pernah
   tersingkap. Menghapus salah satunya menghapus keduanya — itulah cara
   membatalkan retype.
4. Bila latar di belakang elemen tidak rata, muncul peringatan bahwa tambalannya
   akan terlihat.
5. Lebar penutup disimpan sebagai `coverWidth`, dipakai untuk memperingatkan
   ketika teks pengganti lebih panjang dari aslinya (tidak ada reflow baris).

Garis/rule tabel juga bisa diambil alih dengan cara yang sama (jadi objek garis
yang warnanya dan ketebalannya bisa diubah).

### 5. Objek yang bisa dibuat sendiri
- **Teks baru**: klik di halaman, langsung terbuka kotak ketik. Grip kiri/kanan
  memberi teks lebar kotak, dan kata yang melewatinya turun ke baris berikutnya.
- **Kotak / Elips**: tarik untuk menggambar; ada isi warna opsional.
- **Garis / Panah**: tarik; panah punya mata panah solid di ujung.
- **Coret bebas**: gambar tangan bebas (tidak punya handle resize).
- **Gambar JPG**: disisipkan di tengah halaman, lebar awal 32% halaman dengan
  rasio asli dipertahankan.
- **Stabilo**: klik teks/garis cetak untuk menandainya dengan blok kuning
  transparan (opacity 0.4).

### 6. Seleksi, pemindahan, dan resize
- Klik objek teks → terpilih, editor caret terbuka, dan frame +
  **grip** ikut muncul; mengetik dan mengubah ukuran bisa berbarengan.
- **Sudut mengubah ukuran** (titik bundar), **tengah tepi adalah side handle**
  (batang mengikuti arah tepinya). Saat kotak cukup besar semuanya tampil; saat
  mengecil — halaman di-zoom menjauh — kedua tugas dibagi antar sisi: kiri tetap
  mengubah ukuran, kanan tetap side handle, jadi tidak ada tugas yang hilang.
- Objek yang sudah diambil alih ikut tersorot saat kursor melewatinya, jadi
  jelas ia masih bisa diklik lagi.
- Klik objek lain → terpilih; frame biru + **handle resize** muncul.
  Frame selalu memakai kotak gabungan seluruh anggota grup.
  - 4 sudut untuk semua jenis (kecuali coret bebas),
  - 4 sisi tambahan hanya untuk kotak/elips/gambar (grup yang mengandung teks
    tetap proporsional supaya glyph tidak melar).
- Grip sisi hanya menggerakkan satu sumbu; grip sudut menggerakkan keduanya.
- Teks diskalakan lewat `fontSize` (bukan melar), dengan koreksi offset baseline
  dan perataan.
- Menggeser badan objek memindahkan seluruh anggota grup.
- Tarik area kosong = menggeser halaman; tombol tengah mouse juga memindahkan
  halaman dari mana saja; menahan **Spasi** memberi efek hand tool.

### 7. Toolbar properti (melayang di atas kanvas)
`overlay/properties-bar.tsx` — muncul hanya saat ada objek terpilih, isinya menyesuaikan jenis objek:

- **Teks**: isi teks, pilihan font (dikelompokkan per keluarga + gaya), ukuran
  (dropdown ukuran umum + ukuran asli hasil retype), warna, segmented control
  **Tebal / Miring / Garis bawah / Coret**, dan **Perataan** kiri/tengah/kanan.
  Peringatan muncul bila teks melebihi lebar penutup.
- **Bentuk & garis**: warna garis, tebal garis, mata panah, warna isi, plus
  peringatan "objek ini tidak akan terlihat" bila tanpa garis dan tanpa isi.
- **Ukuran**: slider lebar/tinggi untuk kotak dan gambar.
- **Susunan**: Duplikat, Bawa ke depan, Kirim ke belakang.
- **Tampilan**: Opacity dan Rotasi (−180°…180°).
Kontrol yang muat berada langsung di bar (font, ukuran dengan −/+, tebal/miring/
garis bawah/coret, perataan); sisanya di popover: **Warna**, **Ubah isi**,
**Ukuran**, **Tampilan** (opacity, rotasi), dan **Posisi** (duplikat, bawa ke
depan, kirim ke belakang).

Panel kanan tetap ada untuk hal yang bukan milik satu objek:

- **Warna untuk objek baru**: warna default objek berikutnya.
- **Font**: face yang dipakai dokumen diunduh dari `GET /api/fonts/{id}/file` dan
  didaftarkan ke browser, jadi preview dan pengukuran memakai face yang sama
  dengan yang di-embed saat export (`overlay/font-loading.ts`).
- **Font di dokumen ini**: daftar font asli PDF dengan status `terpasang`,
  `→ Pengganti` (mis. Times→Tinos, Arial→Arimo, Calibri→Carlito,
  PMincho→Shippori Mincho), atau `belum ada`.
- **Dokumen**: jumlah objek dan gambar.

Panel otomatis tertutup pada viewport <1024px dan bisa dibuka/tutup dari header.

### 8. Zoom, pan, dan navigasi halaman
- Zoom 25%–400%; tombol −/+ (langkah 0,15), pinch trackpad / Ctrl+scroll.
  Pinch menahan titik di bawah kursor; tombol −/+ menahan titik tengah kanvas.
- Halaman diberi ruang kosong setengah viewport di setiap sisi, jadi paper bisa
  digeser bebas.
- Navigasi halaman lewat pil mengambang di bawah kanvas (halaman X / Y).

### 9. Riwayat, batasan, dan shortcut
- Undo/redo hingga 50 langkah; satu *burst* mengetik = satu langkah.
- Batas selaras dengan server: 500 objek/halaman, 5000 objek/dokumen,
  20 gambar/dokumen, 2000 karakter/teks. Pesan batas tampil di pita status.
- Shortcut: `Ctrl/Cmd+Z` undo, `Ctrl/Cmd+Shift+Z` redo, `Delete` hapus objek,
  `Enter` masuk mode ketik caret, `Escape` batal pilih, `Spasi`+tarik menggeser
  halaman.

### 10. Simpan
- Tombol **Simpan** aktif hanya bila kapabilitas `annotate` backend tersedia dan
  minimal ada satu objek.
- Objek diserialisasi ke `AnnotationDocument` (`serialize.ts`); hanya gambar yang
  benar-benar dipakai yang ikut diunggah.
- Original tidak pernah ditimpa — hasilnya menjadi versi baru dan muncul di
  Recent Files, dengan tombol unduh langsung di editor.

---

## B. Audit 4 task

Metode: pembacaan kode + `tsc -b`, `eslint`, dan `vitest run`
(Node 22 — Node 20 tidak bisa menjalankan jsdom di repo ini).
Tampilan browser **tidak** saya cek sendiri sesuai aturan proyek.

| # | Task | Status |
| --- | --- | --- |
| 1 | Klik sekali langsung bisa edit + geser besar kotak | **Berhasil** (diperbaiki 24 Agu 2026) |
| 2 | Kotak/pin bisa digeser, tidak stuck | **Berhasil** (diperbaiki 24 Agu 2026) |
| 3 | Zoom/pinch tidak berat | **Berhasil** (dilanjutkan 24 Agu 2026) |
| 4 | Desain panel properti mengikuti hellodani.co | **Berhasil** (ConfirmDialog dikembalikan 24 Agu 2026) |

Hasil gate: `typecheck` lolos, `eslint` 0 error (26 warning lama
`react-refresh`), `vitest` **291 lulus / 0 gagal**, `go test ./...` lulus.

### Task 1 — satu klik langsung edit + resize

Sudah dikerjakan:
- Klik sekali pada teks cetak langsung mengambil alih dan memilihnya; tidak ada
  lagi mode terpisah "Ganti teks asli" (`editor-canvas.tsx:377-383`).
- **Type-through** ala Canva: begitu objek teks terpilih, mengetik langsung
  mengubah isinya tanpa klik kedua (`editor-canvas.tsx:175-224`).
  `Enter` beralih ke editor caret, `Escape` batal pilih.
- Handle resize muncul bersamaan dengan seleksi — jadi memang "satu langkah"
  antara memilih, mengetik, dan mengubah ukuran (`editor-canvas.tsx:544-580`).
- `Backspace` pada teks terpilih menghapus karakter, bukan objeknya
  (`overlay-editor.tsx:241-246`).

Ditambahkan 24 Agustus 2026:
- **Klik pertama langsung membuka editor caret.** Tekanan yang tidak sempat
  bergeser dianggap klik, dan pada teks itu berarti "edit ini": editor terbuka
  saat pointer dilepas (`editor-canvas.tsx:458-467`). Karena
  dibaca saat pointer-up, menarik dalam satu gerakan tetap memindahkan objek —
  jadi klik-untuk-mengetik dan seret-untuk-memindah hidup berdampingan.
- **Caret mendarat di tempat yang diklik**, bukan selalu di akhir teks
  (`caretIndexAt` di `geometry.ts`). Kalau browser tidak bisa mengukur teks,
  caret jatuh di akhir seperti sebelumnya.
- **Frame dan grip tetap tampil selama mengetik** (grip diberi `z-30` supaya di
  atas kotak input), jadi mengubah isi dan mengubah ukuran bisa dilakukan tanpa
  keluar-masuk mode.
- Kotak input mengikuti tepi kiri visual teks (`boundsOf`), jadi teks rata
  tengah/kanan tidak lagi meleset.
- Hint di panel dan tooltip tool Pilih disesuaikan dengan perilaku baru.

Klik dua kali dan `Enter` tetap membuka editor yang sama, dan type-through
(mengetik langsung pada objek terpilih) tetap ada sebagai jalur keyboard.

### Task 2 — kotak/pin yang stuck

Sudah dikerjakan:
- Penutup + teks pengganti sekarang satu grup (`groupId`), sehingga menggeser
  salah satunya menggeser pasangannya (`editor-canvas.tsx:286-292`,
  `store.ts:145-160`, `store.ts:286-296`).
- Setelah `takeOver`, gesture `move` langsung aktif — jadi klik-lalu-tarik dalam
  satu gerakan sudah memindahkan hasil retype.
- Handle punya `touch-action: none` dan pointer capture dipindahkan ke surface,
  jadi drag tidak putus saat kursor keluar dari kotak kecil handle.

**Sudah diperbaiki (24 Agustus 2026):**
1. **Resize objek tunggal tidak lagi stuck.** Dulu gesture `scale` memakai
   `[gesture.start]` — snapshot yang tak pernah diperbarui — dengan delta satu
   frame saja, sehingga tiap `pointermove` menulis ulang ukuran yang nyaris sama.
   Sekarang gesture menyimpan **anggota seleksi saat drag dimulai** beserta titik
   awalnya, lalu tiap gerakan menghitung ulang dari snapshot itu dengan **total**
   perjalanan kursor (`editor-canvas.tsx`, varian gesture `scale`). Efek
   sampingnya: menarik balik ke titik awal mengembalikan ukuran persis semula dan
   tidak ada drift pembulatan.
2. **Handle vertikal tidak lagi terbalik.** Ruang PDF menghitung Y ke atas,
   tetapi rumus lama memakai konvensi layar: menarik grip bawah ke bawah justru
   mengecilkan kotak, dan grip sudut `ne` ikut memakai tanda `w` sehingga
   menariknya keluar malah menyusut. Sekarang anchor dan tanda delta dipilih per
   sumbu (`scale.ts`).
3. **Grip sisi hanya menggerakkan satu sumbu.** Sebelumnya satu faktor skala
   dipakai untuk lebar dan tinggi sekaligus, jadi menarik sisi kanan ikut
   mengubah tinggi. Kini `kx`/`ky` dihitung terpisah; grup yang mengandung teks
   tetap proporsional supaya glyph tidak melar.
4. **Regresi history diperbaiki.** `memberIds()` kini mengembalikan array kosong
   untuk id yang tidak ada (`store.ts`), sehingga `bringToFront`/`sendToBack`/
   `remove` untuk objek yang sudah hilang tidak lagi mendorong entri history —
   `store.test.ts` hijau kembali.

Logika penskalaan dipindahkan ke modul sendiri, `overlay/scale.ts`, dan ditutup
15 test unit di `overlay/scale.test.ts` (tumbuh terus mengikuti drag, kembali ke
ukuran awal, anchor di sisi berlawanan, batas minimum, teks lewat `fontSize`,
pasangan retype, gambar lewat titik pusatnya, dan union bounds satu grup).

**Frame grup sudah diperbaiki (24 Agustus 2026).** Frame dan posisi grip kini
dihitung dari `unionBounds()` seluruh anggota grup — sama dengan kotak yang
dipakai `scaleGroupPatches` — sehingga grip tidak lagi meleset dari area yang
benar-benar diskalakan.

### Task 3 — performa zoom/pinch

Sudah dikerjakan (`editor-canvas.tsx:100-149`, `overlay-editor.tsx:155-202`):
- Saat pinch, bitmap lama hanya di-*stretch* lewat CSS; render ulang PDF.js
  ditunda 180 ms sampai zoom berhenti (teknik yang sama dipakai viewer PDF.js).
  Ambang 0,02 membuat langkah zoom kecil tetap render langsung.
- Listener `wheel` dipasang `{ passive: false }` dan hanya mencegat pinch
  (ctrl/meta); swipe dua jari biasa tetap men-scroll.
- `clampZoom` menahan NaN dari trackpad (dulu bisa mengosongkan kanvas).
- Kompensasi scroll saat zoom kini menghitung padding halaman, jadi tampilan
  tidak "melayang" saat pinch.

Ditambahkan 24 Agustus 2026:
- **Render yang sudah tak terpakai dibatalkan.** `renderPageAtScale` menyimpan
  `RenderTask`-nya; render baru membatalkan yang masih berjalan, dan `destroy()`
  membatalkan semuanya (`packages/pdf-engine/src/index.ts`). Pembatalan ini
  **opt-in per engine**: `OverlayEditorEngine` menyalakannya karena hanya
  melukis satu viewport, sedangkan `FallbackViewerEngine` tidak — satu instance
  dipakai bersama oleh puluhan thumbnail di Split, dan semuanya harus selesai.
- **Zoom kembali ke titik kursor.** Anchor pinch diambil dari posisi kursor lagi
  (tengah viewport hanya untuk tombol −/+), memakai rumus yang sudah sadar
  padding — jadi tooltip "zoom ke titik kursor" kini benar.
- **Wheel di-coalesce per frame** dengan `requestAnimationFrame`: trackpad
  mengirim event lebih cepat daripada browser menggambar, dan sebelumnya tiap
  event memicu render ulang seluruh editor.
- Rumus scroll dan padding dipindahkan ke `overlay/viewport.ts`
  (`canvasPads`, `scrollForZoom`) dan ditutup 6 test unit di
  `overlay/viewport.test.ts` — termasuk pemeriksaan bahwa titik di bawah kursor
  benar-benar diam saat zoom in maupun zoom out.

Catatan yang tersisa:
- Pinch layar sentuh (touch) belum ditangani; yang bekerja hanya pinch trackpad
  karena browser mengubahnya menjadi `ctrl+wheel`.

### Task 4 — desain panel properti ala hellodani.co

Sudah dikerjakan (`properties-panel.tsx`, `packages/ui/src/index.tsx`):
- Judul section jadi *micro-label* kapital dengan tracking lebar dan garis
  pemisah putus-putus; padding section naik (lebih lega).
- Label field seragam kapital kecil; jarak antarelemen naik ke `space-y-4`.
- Deretan toggle diganti **segmented control** (track inset, segmen sama lebar)
  untuk Gaya, Perataan, dan Susunan.
- Empty state diberi ikon + kartu lembut, bukan paragraf polos.
- Ukuran + warna teks dijadikan satu baris grid dua kolom.
- Input teks/select memakai gaya lembut (`bg-canvas/70`) dengan ring fokus.
- `.form-control` dipindahkan ke `@layer components` supaya utility Tailwind bisa
  menimpanya — memperbaiki input yang diam-diam tetap 44px.

Catatan:
- Perubahan ikut merombak `packages/ui` secara umum ke arah **shadcn**
  (cva + tailwind-merge, `data-slot`). Efek sampingnya `ConfirmDialog` sempat
  kehilangan aksen khas hellodani.
- **Dikembalikan 24 Agustus 2026**: `ConfirmDialog` kembali memakai sudut
  `rounded-[2rem]`, border ink, bayangan offset merah `shadow-[8px_8px_0_#ff2d2d]`,
  judul `font-display` 3xl, ikon 48px, dan tombol ukuran penuh — persis seperti
  sebelum refactor. Yang tersisa dari refactor hanyalah atribut `data-slot`.
- Masih berubah: `Tooltip` kini `rounded-lg`/`shadow-md` (dulu
  `rounded-xl`/`shadow-xl`). Belum dikembalikan karena tidak disebut; bilang
  saja kalau ini juga harus kembali seperti semula.
- "Isi content"-nya sebagian besar masih kalimat lama; yang benar-benar ditulis
  ulang hanya empty state dan penjelasan font pengganti.

### Teks yang turun saat diedit, dan urutan tumpukan (26 Agustus 2026)

1. **Teks turun sedikit saat editor dibuka lalu naik lagi setelah selesai.**
   Glyph di SVG diletakkan pada baseline-nya, sedangkan teks yang diketik di
   dalam kolom ditaruh di dalam *line box*: kotak itu setinggi `line-height`,
   glyph menempati ascent dan descent milik fontnya, dan sisa ruangnya dibagi
   di atas dan di bawah. Posisi kotak dulu ditebak dengan `fontSize * 0.82`,
   meleset sekitar 8% dari ukuran huruf — cukup untuk terlihat. Sekarang
   offsetnya **diukur** dari metrik font (`baselineOffset()` di `geometry.ts`),
   dengan tebakan lama sebagai cadangan kalau browser tidak bisa mengukur.
2. **Bounding box bisa menimpa toolbar.** Frame, grip, dan cincin geser memakai
   `z-30`, sementara pembungkus halaman tidak membentuk konteks tumpukan
   sendiri — jadi angka itu bersaing langsung dengan toolbar. Halaman kini
   `relative z-0`, sehingga semua lapisan di dalamnya bertumpuk satu sama lain
   saja, dan chrome editor (rail, toolbar atas, panel, pil halaman) duduk di
   atasnya.

### Warna berbeda dalam satu potongan (26 Agustus 2026)

Mengklik baris yang warnanya campur membuat semuanya berwarna sama. Penyebabnya
di sumber datanya: PDF mengganti warna lewat operator graphics-state, **bukan**
dengan memulai run teks baru, jadi satu potongan dari PDF.js bisa memuat
"Nama: " hitam dan sebuah nama merah sekaligus — sementara `inkColorFor()`
mengambil satu warna saja untuk seluruh potongan.

Halamannya toh sudah dirender, jadi warnanya sekarang dibaca balik dari piksel,
per karakter (`overlay/ink-spans.ts`), dan potongan itu dipecah di tempat
warnanya berubah. Yang menjaga agar pembacaan itu tidak asal:

- Lebar tiap karakter diukur dengan face di layar lalu **diskalakan ke lebar
  yang dilaporkan PDF**, sehingga potongannya jatuh di tempat glyph-nya
  sungguhan berada.
- Warna dikuantisasi sebelum dibandingkan, dan satu karakter menyimpang
  diabaikan — itu anti-aliasing, bukan ganti warna. Perubahan baru dipercaya
  bila dua karakter berturut-turut menyepakatinya.
- Spasi tidak punya tinta untuk dibaca, jadi ia melanjutkan warna di
  sekitarnya alih-alih memulai potongan baru.

### Gaya untuk sebagian kata (26 Agustus 2026)

Satu objek teks membawa satu gaya, jadi menebalkan satu kata di tengah baris
sebelumnya menebalkan seluruh barisnya. Alih-alih model rich text, objeknya
**dipecah** saat gaya diterapkan pada teks yang diseleksi (`overlay/split.ts`):
bagian sebelum, bagian terpilih dengan gaya barunya, dan bagian sesudah.

- Tiap potongan ditaruh pada offset yang benar-benar terukur — termasuk lebar
  potongan tengah **setelah** bergaya baru, karena teks tebal lebih lebar.
- Ketiganya berbagi satu grup, jadi tetap satu kesatuan untuk digeser, dihapus,
  dan diatur lapisannya. Pasangan retype tetap memakai grupnya sendiri sehingga
  tambalannya ikut bersama.
- Potongan bergaya mempertahankan id aslinya, jadi toolbar tetap menunjuk apa
  yang barusan diubah.
- Menyeleksi seluruh teks, atau tidak menyeleksi apa pun, tetap mengubah
  objeknya utuh seperti sebelumnya.
- **Kotak yang membungkus tidak dipecah** — potongan terpisah tidak bisa saling
  mengalir, jadi gaya berlaku untuk seluruh kotak. Ini batas sadar dari
  pendekatan ini; jawaban sesungguhnya untuk itu adalah rich text.

Editor caret ikut menutup saat pemecahan terjadi, dan menyimpan teks pembuka
sesi supaya nilai lama tidak ditulis balik dan menyatukan kembali potongannya.

### Tempat tiap kontrol, dan pembagian grip (26 Agustus 2026)

- **Urungkan/Ulangi pindah ke header** (`overlay/history-controls.tsx`).
  Keduanya milik dokumen, bukan alat gambar, dan sekarang mati sampai memang ada
  yang bisa diurungkan — pada file yang baru dibuka, dua-duanya mati.
- **Hapus objek terpilih pindah ke toolbar atas.** Itu tindakan terhadap
  seleksi, dan toolbar atas memang hanya muncul saat ada seleksi.
- Rail kiri kini murni alat gambar.
- **Sudut mengubah ukuran, tengah tepi jadi side handle** (`gripsFor()`). Kotak
  yang lapang menampilkan semuanya. Kotak yang menyempit — karena halaman
  di-zoom menjauh — tidak lagi membuang side handle-nya; kedua tugas dibagi
  antar sisi: `nw`/`sw` untuk ukuran di kiri, `e` untuk side handle di kanan.
  Di bawah 26 px bahkan dua sudut pun bersentuhan, jadi tinggal `nw` dan `e`.
  Teks tidak punya side handle tinggi: kotaknya tumbuh sendiri per baris saat
  kata membungkus.
- **Objek yang sudah diambil alih kini terdeteksi saat dilewati kursor.**
  Sebelumnya ia bukan lagi target cetak, dan kode sengaja mengosongkan sorotan
  di atas objek sendiri — hasilnya tidak ada tanda apa pun. Sekarang ada garis
  tipis mengelilingi objek (atau seluruh pasangannya) plus kursor `move`.
- Ambang munculnya grip sisi dinaikkan dari 44 px ke 60 px, karena satu batang
  20 px ditambah dua sudut menyisakan terlalu sedikit celah pada 44 px.

### Toolbar dan grip dirapikan (26 Agustus 2026)

1. **Popover di toolbar tidak pernah terlihat.** Bar memakai `overflow-x-auto`
   agar bisa digeser di layar sempit, dan sebuah kontainer scroll memotong
   **kedua** sumbu — panel yang bersarang di dalamnya praktis tak kelihatan,
   sehingga tombolnya terasa mati. Panel sekarang dipasang lewat portal ke
   `body` dengan posisi tetap, dijaga tetap di dalam viewport.
2. **Pemicu popover diberi kata, bukan hanya ikon** ("Ubah isi", "Bungkus teks",
   "Tampilan", "Posisi"), mengikuti contoh Canva yang Anda lampirkan.
3. **Warna teks tidak terbaca sebagai kontrol warna.** Dulu hanya kotak kecil;
   sekarang glyph "A" dengan batang warna di bawahnya.
4. **Perataan menggeser kotaknya.** `x` menyimpan titik jangkar yang artinya
   berubah menurut perataan, jadi mengganti perataan memindahkan teks. Kini
   `alignPatch()` memindahkan jangkar sebanyak perubahan artinya, sehingga
   kotak tetap di tempatnya dan kata-katanya yang tersusun ulang di dalamnya.
5. **Kontrol garis terlalu sedikit.** Tebal garis naik ke bar sebagai stepper
   (− nilai +) dan mata panah jadi tombol tersendiri; popover warna kini hanya
   berisi warna.
6. **Grip berdempetan pada kotak kecil.** Grip sisi butuh ruang di tepinya
   sendiri: `gripsFor()` menghilangkannya di bawah 44 px dan mengembalikannya
   begitu tepi itu cukup panjang. Bentuknya juga berubah — sudut jadi titik
   bundar, sisi jadi batang memanjang mengikuti tepinya, semuanya `rounded-full`.

### Teks membungkus baris (25 Agustus 2026)

Grip **kiri dan kanan** pada teks kini mengatur **lebar kotaknya**, bukan ukuran
hurufnya — persis arti handle samping pada kotak teks di Canva. Grip sudut tetap
mengubah ukuran huruf, dan grip atas/bawah sengaja tidak ada karena hanya akan
memelarkan glyph.

Yang menarik: ini **tidak butuh perubahan engine sama sekali**. Format wire sudah
menerima banyak teks berposisi per halaman, jadi editor yang menghitung sendiri
di mana baris patah, lalu mengirim satu teks per baris dengan baseline masing-
masing. Ini baru bisa dipercaya setelah font disajikan dari API: browser
mengukur dengan face yang sama persis dengan yang akan di-embed, sehingga
patahan baris di preview sama dengan di hasil export.

- Pembungkusan rakus per kata; kata yang lebih lebar dari kotak mendapat
  barisnya sendiri, tidak dipotong di tengah.
- Kotak ketik ikut membungkus (`textarea`), jadi tampilan saat mengetik sama
  dengan hasilnya. Enter menyelesaikan penyuntingan, bukan membuat baris baru —
  engine menempatkan run, bukan mengalirkan teks.
- Klik pada baris ketiga menaruh caret di baris ketiga, bukan di awal.
- Toolbar punya **Bungkus teks**: memberi lebar kotak, mengaturnya dengan
  slider, atau mengembalikannya ke satu baris.
- Peringatan "meluber" hanya muncul saat teks memang tidak membungkus.

Batasnya: tinggi kotak mengikuti jumlah baris dan tumbuh ke bawah, sementara
tambalan hasil retype tidak ikut membesar — teks yang membungkus jadi beberapa
baris bisa menimpa baris cetak di bawahnya. Itu pilihan sadar: menumbuhkan
tambalan berarti menutup teks yang tidak diminta pengguna untuk ditutup.

### Nama font asli, dan deteksi paragraf yang dibatalkan (25 Agustus 2026)

**Deteksi paragraf dicabut.** Pengelompokan berdasarkan geometri terlalu sering
salah tebak pada dokumen sungguhan, sehingga satu klik berhenti bisa ditebak.
Sekali klik kembali mengambil **satu potongan teks**, persis seperti isi
filenya. Kodenya ada di riwayat git kalau suatu saat mau dicoba lagi dengan
heuristik yang lebih baik.

**Teks tebal berubah jadi tidak tebal — akar masalahnya bukan di pencocokan
font.** `getTextContent()` milik PDF.js melaporkan `fontFamily` sebagai
*fallback* saja: setiap face di halaman datang sebagai `"sans-serif"`,
`"serif"`, atau `"monospace"`, karena itu semua yang dibutuhkan sebuah text
layer. Jadi selama ini `matchFont()` tidak pernah melihat nama font yang
sebenarnya, dan:

- ketika ia mengambil hasil pertama, semua teks jadi **tebal** (face bold berada
  lebih awal secara alfabet);
- setelah diperbaiki agar memilih face polos, teks yang memang tebal jadi
  **tidak tebal**.

Keduanya gejala dari sebab yang sama. Sekarang `getTextRuns()` menarik
`getOperatorList()` lebih dulu — di situlah objek font didaftarkan — lalu
membaca nama asli dari `page.commonObjs`. PDF.js menyimpan hasil parse-nya,
jadi render setelahnya memakai parse yang sama.

Percobaan pertama juga menyertakan flag `bold`/`italic` dari objek font, dan itu
**salah**: flag tersebut hanya diekspor bila `getDocument` diberi opsi
`fontExtraProperties`, sehingga nilainya `undefined`. Membacanya sebagai
`false` justru membatalkan bobot yang sudah tersurat di nama, dan teks tebal
tetap jadi biasa. Diperiksa dengan menjalankan PDF.js di Node terhadap PDF
sungguhan di `data/`:

```
style g_d0_f1 {"fontFamily":"sans-serif", ...}
commonObjs g_d0_f1 has: true {"name":"BZZZZZ+Arial-BoldMT","fallbackName":"sans-serif"}
```

Jadi nama itulah satu-satunya petunjuk yang ada, dan ia harus selamat dari tag
subset (`BZZZZZ+`) maupun akhiran foundry (`MT`). Flag hanya dipakai bila
benar-benar ada; kalau tidak, nama yang memutuskan.

### Toolbar properti melayang (25 Agustus 2026)

Properti objek terpilih dipindahkan dari panel kanan ke **bar kontekstual yang
melayang di atas halaman**, mengikuti pola Canva. Bar hanya muncul saat ada
seleksi, dan menghilang begitu seleksi dilepas. Panel kanan tetap dipakai untuk
hal yang bukan milik satu objek (font dokumen, warna objek baru, ringkasan,
hasil simpan).

Ikut diperbaiki: tombol di bar dan di rail kiri kini ditandai
`data-editor-chrome`, dan pintasan papan ketik editor menghormatinya
(`overlay/keyboard.ts`). Sebelumnya, memberi fokus pada tombol toolbar lalu
menekan Spasi ikut menggeser halaman, dan mengetik ikut masuk ke objek teks
yang sedang dipilih.

### Temuan lanjutan kedua (25 Agustus 2026)

1. **Teks biasa berubah jadi tebal saat diklik.** `matchFont()` mencocokkan
   nama utuh lalu mengambil hasil pertama, sedangkan registry terurut menurut
   nama file — `Roboto-Bold` berada sebelum `Roboto-Regular`, jadi run "Roboto"
   yang biasa dijawab dengan face tebal. Gejalanya baru kelihatan setelah face
   asli dimuat ke browser; sebelumnya preview memakai font generik sehingga
   tebalnya tidak tampak. Sekarang pencocokan dilakukan **keluarga dulu, baru
   emphasis**: nama dipecah jadi stem + gaya oleh `describeFontName()`
   (`font-variants.ts`), lalu `closestStyle()` memilih face dengan gaya yang
   sama, jatuh ke face polos bila keluarga itu tidak punya.
   Efek samping yang ikut terperbaiki:
   - Alias metrik akhirnya benar-benar bekerja. `Tinos` dikirim sebagai
     `Tinos-Regular` dkk., bukan `Tinos` polos, jadi pencarian alias yang lama
     (cocok persis) selalu gagal dan Times jatuh ke serif generik. Kini alias
     dicocokkan per keluarga, dan bobot aslinya ikut terbawa
     (`TimesNewRomanPS-BoldMT` → `Tinos-Bold`).
   - Tag subset pada nama font (`ABCDEF+Roboto`) dibuang sebelum pencocokan.
2. **PDF tidak di tengah saat editor dibuka.** Halaman diberi bantalan setengah
   viewport di tiap sisi, dan scroller mulai dari 0 — artinya yang terlihat
   pertama adalah bantalan kosong, dengan kertas terdorong ke kanan-bawah.
   Sekarang tampilan ditempatkan sekali di atas halaman lewat `initialScroll()`
   (`overlay/viewport.ts`): terpusat secara horizontal, dan halaman yang lebih
   tinggi dari viewport dibuka di tepi atasnya, bukan di tengah-tengah.

### Temuan lanjutan (24 Agustus 2026)

Tiga hal yang dilaporkan setelah perbaikan di atas:

1. **`ConfirmDialog` tidak boleh berubah** — sudah dikembalikan, lihat catatan
   Task 4.
2. **Kotak teks tidak sepanjang teksnya** (sementara kotak garis sudah pas).
   Penyebabnya `boundsOf()` menebak lebar teks dengan rata-rata
   `panjang × ukuran × 0,52`, jadi "Iliad" mendapat kotak kelewat lebar dan
   "WWW" kelewat sempit; garis tidak terkena karena lebarnya dihitung dari titik
   sungguhan. Sekarang editor memasang **pengukur teks sungguhan** (metrik
   canvas untuk face yang dipilih) lewat `setTextMeasurer()` di `types.ts`,
   dengan cache di `textMeasurer()` (`geometry.ts`) karena bounds dihitung ulang
   tiap gerakan pointer. Satu perbaikan ini merapikan frame, area klik, dan
   posisi grip sekaligus. Kotak input caret juga tidak lagi memakai lebar
   minimum tetap 80px — lebarnya mengikuti teks yang sedang diketik.
3. **Kotak seleksi terlihat dobel.** Ada dua penanda yang digambar sekaligus:
   outline merah putus-putus di lapisan SVG (`SelectionOutline`, peninggalan
   dari sebelum ada grip) dan frame grip di kanvas — keduanya memakai warna
   `accent` yang sama dan hanya berselisih 3px, jadi terlihat seperti satu
   kotak bertumpuk. `SelectionOutline` dihapus; frame grip kini satu-satunya
   penanda. Saat kotak input caret terbuka, border input itulah framenya
   (frame kanvas disembunyikan) supaya tidak dobel lagi. Coretan bebas tetap
   mendapat frame, hanya tanpa grip.
4. **Bounding box tidak bisa dipakai memindahkan teks, dan grip kanan tidak pas
   di ujungnya.** Keduanya berakar pada satu hal: kotak input caret punya
   geometri sendiri (border, padding, lebar dengan sisa ruang) yang berbeda dari
   frame, dan input itu menutupi teksnya sehingga tarikan jatuh ke input.
   Sekarang input tidak lagi menggambar chrome apa pun — tanpa border, padding,
   maupun latar — sehingga **frame seleksi adalah satu-satunya kotak**, dan
   lebarnya dihitung dari `boundsOf()` atas teks yang sedang diketik, jadi grip
   selalu tepat di tepi kotak (`handleCenter()` di `scale.ts`). Untuk memindah,
   ada **cincin tarik** setinggi 10px di sekeliling frame (`ringStrips()`):
   menarik garis kotaknya menggeser objek, sementara menarik di dalam teks tetap
   menyeleksi karakter seperti input biasa.
5. **Teks asli muncul di belakang saat mengedit/memindah.** Dua penyebab
   terpisah, dua perbaikan:
   - Saat mengetik, SVG masih menggambar teks versi lama di bawah kotak input.
     Objek yang sedang diedit kini tidak digambar di lapisan objek
     (`hiddenId` di `object-layer.tsx`).
   - Saat memindahkan hasil retype, **penutupnya ikut bergeser** sehingga teks
     cetak aslinya tersingkap. Penutup sekarang berstatus `pinned`
     (`types.ts`): dia tetap di tempatnya saat pasangannya digeser atau
     diskalakan, ikut terhapus dan ikut naik-turun lapisan, dan tidak ikut
     tersalin saat duplikat. Klik di atas penutup otomatis memilih teks
     penggantinya (`pickAt()` di `store.ts`), jadi penutup yang dipatok tidak
     terasa seperti objek mati.

---

## C. Sisa pekerjaan

Daftar ini yang belum dikerjakan, per 26 Agustus 2026.

### Di Edit PDF

| # | Pekerjaan | Ukuran | Catatan |
| --- | --- | --- | --- |
| 1 | **Crop gambar** — grip sisi memotong gambar, bukan melebarkannya | Sedang–besar | Butuh kotak crop di format wire dan dukungan Go saat flatten. Satu-satunya sisa dari permintaan "handle ala Canva" |
| 2 | **Jarak baris** | Kecil–sedang | Baru relevan setelah teks bisa membungkus. Sekarang `LINE_HEIGHT` tetap 1,2; perlu jadi properti objek dan ikut ke bounds, layout, dan serialisasi |
| 3 | **"aA" ubah kapitalisasi** | Kecil | Murni tombol di toolbar |
| 4 | **Tambalan retype tidak ikut tumbuh** saat teks membungkus ke bawah | Perlu keputusan | Teks yang jadi beberapa baris bisa menimpa baris cetak di bawahnya. Menumbuhkan tambalan berarti menutup teks yang tidak diminta ditutup |
| 5 | **Pinch layar sentuh** | Kecil–sedang | Hanya pinch trackpad yang bekerja, karena browser mengubahnya jadi `ctrl+wheel` |
| 6 | **Deteksi paragraf** | Sedang | Dicabut 25 Agu karena tebakannya terlalu sering meleset; kodenya ada di riwayat git kalau mau dicoba lagi dengan heuristik lebih baik |

### Di luar Edit PDF

| # | Pekerjaan | Catatan |
| --- | --- | --- |
| 7 | **Gaya `Tooltip`** di `packages/ui` masih versi shadcn | `ConfirmDialog` sudah dikembalikan; tinggal diputuskan apakah Tooltip ikut |
| 8 | **`assets/fonts` jadi cache yang di-generate** | 41 MB, 102 file di repo. Rencananya `make fonts` mengunduh daftar terkunci (versi + sha256) dari Google Fonts |
| 9 | **26 peringatan eslint** | `react-refresh/only-export-components`, plus `react-hooks/refs` dan `set-state-in-effect` yang sengaja diturunkan ke warning saat upgrade dependency. 0 error |
| 10 | **Belum ada yang di-commit** | 47 berkas berubah/baru sejak `4bd126b`, semuanya masih di working tree |

Status fitur lain di luar editor tercatat di `docs/FEATURES.md` — antara lain
sembilan arah Convert yang masih mockup, tiga tingkat Compress yang belum ada,
dan bulk restore di Trash.

### Perintah verifikasi

```bash
nvm use && cd apps/web && bun run typecheck && bun run lint && bunx vitest run
```
