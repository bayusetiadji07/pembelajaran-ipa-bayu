# Pindah ke proyek Supabase baru

Memindahkan situs dari proyek **`riajhxegskgwytmpcvut`** (website-sekolah) ke
**`scvafmwzonmigzjfgcrb`**, berikut seluruh datanya.

Proyek lama **tidak disentuh**. Ia tetap utuh sebagai cadangan sampai yang baru
terbukti berjalan, dan tabel `ag_*` milik aplikasi presensi memang tinggal di
sana — yang pindah hanya tabel `ipa_*` dan Edge Function `pak-bay`.

---

## Yang hanya bisa dikerjakan Pak Bayu

Tiga hal ini tidak bisa saya lakukan, dan dua di antaranya menghalangi langkah
berikutnya.

### 1. Buat akun admin di proyek baru

Panel admin memakai Supabase Auth. Akun di proyek baru adalah akun yang berbeda
dengan UID yang berbeda pula, dan UID itulah yang menentukan siapa yang boleh
mengubah isi halaman.

Dashboard proyek baru → **Authentication → Users → Add user** → isi surel dan
kata sandi.

Kata sandinya **jangan dikirimkan ke saya**. Saya tidak memasukkan kata sandi ke
formulir mana pun. Yang saya butuhkan hanya UID-nya, yang tampil di daftar
pengguna setelah akun dibuat — UID bukan rahasia, ia memang dipakai terbuka di
dalam aturan RLS.

### 2. Pasang GEMINI_API_KEY di proyek baru

Tanpa ini Pak Bay menjawab `belum_disiapkan`.

Dashboard proyek baru → **Edge Functions → Secrets** → tambahkan
`GEMINI_API_KEY`. Kuncinya Anda tempel sendiri; saya tidak menangani kunci API.

### 3. Pulihkan sambungan Supabase di Claude Code

Jalankan `/mcp` lalu hubungkan ulang Supabase. Selama masih `Unauthorized`,
seluruh langkah di bawah berhenti di tempat.

Alternatifnya, semua SQL di bawah bisa Anda tempel sendiri lewat **SQL Editor**
di dashboard — tapi akan jauh lebih lama.

---

## Urutan langkah

### Tahap 1 — Salin struktur

Dari proyek lama saya baca skema aslinya (definisi tabel, indeks, kebijakan RLS,
dan ketiga fungsi), lalu bangun ulang persis di proyek baru.

Yang ikut pindah:

| Objek | Isi |
|---|---|
| `ipa_konten` | satu baris jsonb berisi seluruh isi halaman |
| `ipa_statistik` | penghitung kunjungan |
| `ipa_saran` | kotak saran |
| `ipa_komentar` | komentar siswa, suka, dan balasan |
| `ipa_tutor_percakapan` | riwayat obrolan Pak Bay |
| `ipa_tutor_pengetahuan` | catatan kurasi Pak Bay |
| `ipa_tutor_kuota` | pemakaian harian AI |
| fungsi | `ipa_tambah_kunjungan`, `ipa_tambah_suka`, `ipa_tutor_naikkan_kuota` |
| bucket | `ipa-materi` beserta berkas di dalamnya |

**Catatan penting — skemanya dibaca, bukan diingat.** Saya tidak menuliskan DDL
tebakan di dokumen ini. Tipe kolom, nilai bawaan, dan teks kebijakan RLS harus
disalin apa adanya dari proyek lama; menebaknya berisiko menghasilkan tabel yang
mirip tapi tidak sama.

### Tahap 2 — Ganti cara mengenali admin

Aturan RLS yang sekarang menuliskan UID admin langsung di dalam kebijakan:

```sql
using (auth.uid() = '525f84fc-fbbd-44dd-944d-a64433c6a7dd'::uuid)
```

Pola ini persis yang membuat pemindahan ini merepotkan — ada sekitar dua puluh
kebijakan yang semuanya harus diubah hanya karena UID-nya berganti.

Karena kebijakannya toh ditulis ulang, sekalian diperbaiki: satu tabel kecil
`ipa_admin` berisi daftar UID, dan satu fungsi `ipa_adalah_admin()`
(`security definer`, `set search_path = ''`) yang dipanggil kebijakan. Menambah
admin, mengganti akun, atau pindah proyek lagi nanti cukup satu baris `insert`.

Kalau Anda lebih suka apa adanya — UID baru ditulis langsung seperti sekarang —
bilang saja, tinggal saya ganti nilainya.

### Tahap 3 — Pindahkan datanya

Isi tabel disalin lewat `insert ... select` dari hasil ekspor proyek lama.
Berkas di bucket `ipa-materi` diunduh lalu diunggah ulang.

Satu hal yang perlu diputuskan saat sampai di sini: `ipa_tutor_percakapan`
berisi riwayat obrolan siswa. Isinya bisa ikut dipindah, atau ditinggal supaya
proyek baru mulai dengan log bersih — tidak ada yang rusak bila ditinggal,
karena Pak Bay hanya memakainya untuk menyambung percakapan yang sedang
berjalan.

### Tahap 4 — Deploy Edge Function

`pak-bay` di-deploy ke proyek baru dengan `verify_jwt` mati, sama seperti
sekarang. Sumbernya sudah ada di repo: `supabase/functions/pak-bay/index.ts`.

Versi di repo itu sekaligus berisi perubahan perilaku Pak Bay menjadi penuntun
berpikir, yang memang belum sempat terpasang di proyek lama.

### Tahap 5 — Arahkan halaman ke proyek baru

Dua berkas, masing-masing dua baris:

| Berkas | Yang diubah |
|---|---|
| `index.html` | `SUPABASE_URL`, `SUPABASE_KEY` |
| `dukungan.html` | `SUPABASE_URL`, `SUPABASE_KEY` |

Kunci yang dipakai adalah **publishable key** proyek baru — kunci yang memang
dirancang untuk diletakkan di kode halaman. Yang menjaga data bukan kerahasiaan
kunci itu, melainkan aturan RLS. Kunci `service_role` tidak boleh menyentuh
berkas ini.

Langkah ini dilakukan **paling akhir**, setelah proyek baru terbukti lengkap.
Begitu ini di-push, situs langsung membaca dari proyek baru.

### Tahap 6 — Verifikasi

Diperiksa satu per satu, bukan sekadar "halaman terbuka":

- halaman memuat materi, media, galeri, pengumuman dari proyek baru;
- komentar lama tampil beserta jumlah suka dan balasannya;
- menyukai komentar menambah angkanya;
- mengirim saran baru masuk ke `ipa_saran`;
- login admin berhasil dengan akun baru, dan menyimpan perubahan benar-benar
  tersimpan — ini yang membuktikan RLS-nya benar;
- Pak Bay menjawab, dan jawabannya berupa pertanyaan balik;
- halaman `dukungan.html` menampilkan QRIS;
- penghitung kunjungan bertambah.

### Kalau ada yang meleset

Kembalikan dua konstanta di Tahap 5 ke nilai lama, push, selesai — situs membaca
proyek lama lagi. Karena proyek lama tidak disentuh sama sekali, pengembaliannya
tidak kehilangan apa pun.

---

## Yang perlu disepakati saat pengerjaan

1. UID admin baru, setelah akunnya Anda buat.
2. Riwayat `ipa_tutor_percakapan` ikut dipindah atau mulai bersih.
3. Pola admin: tabel `ipa_admin` (disarankan) atau UID ditulis langsung.
