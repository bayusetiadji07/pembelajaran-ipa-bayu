# Prompt: Landing Page Pembelajaran IPA — Bayu Setiadji, S.Pd., Gr.

Buatkan saya sebuah **landing page pembelajaran IPA** dalam bentuk **single-file HTML** (HTML + CSS + JS dalam satu file, tanpa backend/server), menggunakan **Tailwind CDN** untuk styling dan **vanilla JavaScript** untuk interaktivitas. Landing page ini untuk Bayu Setiadji, S.Pd., Gr., guru mata pelajaran IPA di SMP Negeri 3 Besuki, Situbondo, yang mengajar dengan kerangka Kurikulum Merdeka (Fase D).

## Tujuan
Landing page ini berfungsi sebagai profil guru sekaligus portal ringan bagi siswa untuk mengakses materi, media pembelajaran, dan pengumuman kelas.

## Tema Visual
Tema "Laboratorium" — bersih, modern, dengan nuansa sains:
- Palet warna: biru sains (misal `#1e3a8a`/`#2563eb`) + hijau (`#059669`) sebagai aksen + putih/abu terang sebagai base
- Font: Google Fonts (misal Poppins untuk heading, Inter untuk body) via CDN
- Ikon: gunakan Lucide Icons via CDN untuk ikon-ikon bertema sains (atom, mikroskop, tabung reaksi, DNA, dll)
- Ilustrasi: buat SVG inline bertema laboratorium/sains (atom, tabung reaksi, dll), boleh diberi animasi CSS ringan (misal atom berputar pelan di hero section)
- Background pattern: gunakan CSS/SVG pattern ringan (grid halus atau pola molekul), bukan file gambar eksternal
- Semua aset visual harus berupa kode (SVG/CSS/CDN font & icon) — TIDAK ada file gambar terpisah, supaya file tetap single-file dan portable
- Foto profil guru: sediakan slot untuk foto base64 (placeholder avatar/inisial dulu jika belum ada foto asli)

## Struktur Halaman Publik

1. **Hero Section**
   - Nama & jabatan: Bayu Setiadji, S.Pd., Gr. — Guru IPA SMP Negeri 3 Besuki
   - Tagline yang menarik untuk siswa
   - CTA scroll ke bagian materi

2. **Tentang Guru**
   - Foto/avatar, deskripsi singkat, peran (guru IPA, pembina OSN)

3. **Materi/Ringkasan Bab IPA**
   - Kartu-kartu topik, dikelompokkan per kelas (VII, VIII, IX) sesuai Kurikulum Merdeka Fase D
   - Setiap kartu bisa diklik untuk expand/collapse ringkasan singkat materi
   - Desain kartu dengan ikon sains yang relevan per topik

4. **Media Pembelajaran**
   - Grid/list link ke media pembelajaran (simulasi interaktif, LKPD digital, video, latihan soal)
   - Filter/kategori: Simulasi, LKPD, Video, Latihan Soal
   - Setiap item punya judul, deskripsi singkat, ikon kategori, dan link/tombol akses

5. **Pengumuman Kelas**
   - Papan pengumuman sederhana, urut dari terbaru
   - Setiap pengumuman punya judul, isi singkat, dan tanggal

6. **Kontak & Sosial Media**
   - Link ke TikTok, Instagram, dan Lynk.id
   - Bisa dalam bentuk tombol/ikon sosial media yang menarik

7. **Footer**
   - Nama sekolah, tahun ajaran, credit

## Sistem Admin Panel (WAJIB)

Sertakan mode admin dalam file HTML yang sama, dengan ketentuan:

- **Akses admin**: sembunyikan dari tampilan publik. Gunakan salah satu cara — klik logo/nama guru 5x berturut-turut, ATAU akses via parameter URL `?admin=true`
- **Login sederhana**: form password (password disimpan sebagai konstanta di kode JS, mudah diubah developer)
- **Setelah login, admin bisa mengelola:**
  - Profil guru (nama, jabatan, deskripsi, foto — upload gambar dikonversi ke base64 otomatis via JS)
  - CRUD kartu materi (tambah/edit/hapus topik, kelas, ringkasan)
  - CRUD media pembelajaran (tambah/edit/hapus link, kategori, deskripsi)
  - CRUD pengumuman (tambah/edit/hapus, dengan tanggal otomatis)
  - Edit link sosial media & kontak
- **Penyimpanan data**: gunakan `localStorage` browser (karena tidak ada backend). Semua perubahan admin langsung tersimpan dan otomatis ter-render ulang di tampilan publik tanpa reload halaman
- **Export/Import JSON**: sediakan tombol untuk export seluruh data (profil, materi, media, pengumuman) ke file `.json`, dan tombol import untuk memuat kembali data dari file `.json` — ini penting karena localStorage hanya tersimpan per-browser/device, jadi Bayu perlu cara memindahkan data saat re-upload file HTML ke hosting
- **Tombol "Kembali ke tampilan publik"** untuk keluar dari mode admin
- Berikan **data default/contoh** (beberapa materi, media, dan pengumuman dummy) supaya halaman tidak kosong saat pertama kali dibuka, dan Bayu bisa langsung melihat contoh sebelum mengisi data sendiri

## Ketentuan Teknis Tambahan

- Fully responsive (mobile-first, karena banyak siswa akan akses dari HP)
- Tidak ada dependency backend/database eksternal — murni client-side
- Kode terorganisir rapi dengan komentar yang jelas per section agar mudah diedit manual jika diperlukan
- Pastikan performa ringan dan cepat dimuat meskipun banyak ilustrasi SVG dan animasi
