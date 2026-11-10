// Memotret tiap media pembelajaran untuk dijadikan gambar pratinjau di kartu.
//
// Kenapa gambar statis, bukan iframe hidup: satu halaman media berisi
// aplikasi utuh. Memuat 25 aplikasi sekaligus di kartu akan menghabiskan
// kuota dan membuat HP siswa tersendat, padahal yang dibutuhkan hanya
// gambaran sekilas. Gambar hasil potret ini sekitar 20 KB per media.
//
// Media berupa video YouTube tidak ikut dipotret: thumbnail resminya sudah
// tersedia dan selalu mutakhir, diambil langsung oleh halaman.
//
// Jalankan ulang bila ada media baru atau tampilannya berubah:
//   node alat/potret-media.js
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { promisify } = require("util");

const jalankan = promisify(execFile);

const SUPABASE = "https://riajhxegskgwytmpcvut.supabase.co";
const KUNCI = "sb_publishable_kUte5XzkrxtGohaMEVNpKA_u6UkZd2g";
const CHROME = "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe";

const AKAR = path.resolve(__dirname, "..", "..");
const TUJUAN = path.join(AKAR, "media-pratinjau");
const SEMENTARA = path.join(require("os").tmpdir(), "potret-media");

const LEBAR_TANGKAP = 1280, TINGGI_TANGKAP = 800;
const LEBAR_SIMPAN = 640;          // cukup tajam untuk kartu, tetap ringan
const BATAS_MS = 45000;

const adalahYouTube = (u) => /(?:youtube\.com|youtu\.be)/i.test(u || "");
const rapikan = (u) => {
  const s = String(u || "").trim();
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : "https://" + s;
};

async function ambilMedia() {
  const r = await fetch(`${SUPABASE}/rest/v1/ipa_konten?id=eq.1&select=data`, {
    headers: { apikey: KUNCI },
  });
  if (!r.ok) throw new Error("gagal membaca daftar media: HTTP " + r.status);
  const j = await r.json();
  return (j[0]?.data?.media) || [];
}

async function potret(url, keluar) {
  await jalankan(CHROME, [
    "--headless", "--disable-gpu", "--hide-scrollbars", "--no-sandbox",
    `--window-size=${LEBAR_TANGKAP},${TINGGI_TANGKAP}`,
    "--virtual-time-budget=14000",
    "--screenshot=" + keluar,
    url,
  ], { timeout: BATAS_MS }).catch(() => {});
  return fs.existsSync(keluar) && fs.statSync(keluar).size > 5000;
}

// Pengubahan ke WebP memakai ffmpeg, bukan npx sharp-cli: path proyek ini
// mengandung spasi, dan memanggil npx lewat shell menyambung argumen tanpa
// pelindung sehingga path-nya terpecah di tiap spasi.
async function keWebp(masuk, keluar) {
  await jalankan("ffmpeg", [
    "-y", "-loglevel", "error",
    "-i", masuk,
    "-vf", `scale=${LEBAR_SIMPAN}:-2`,
    "-quality", "72",
    keluar,
  ], { timeout: 120000 });
  return fs.existsSync(keluar);
}

(async () => {
  fs.mkdirSync(TUJUAN, { recursive: true });
  fs.mkdirSync(SEMENTARA, { recursive: true });

  const media = await ambilMedia();
  const perlu = media.filter((m) => !adalahYouTube(m.link));
  console.log(`${media.length} media, ${media.length - perlu.length} video YouTube dilewati, ${perlu.length} dipotret\n`);

  let berhasil = 0;
  const gagal = [];

  for (const m of perlu) {
    const url = rapikan(m.link);
    const png = path.join(SEMENTARA, m.id + ".png");
    const webp = path.join(TUJUAN, m.id + ".webp");
    const judul = String(m.judul || m.id).slice(0, 38);

    const ok = await potret(url, png);
    if (!ok) { gagal.push(judul); console.log(`  GAGAL  ${judul}`); continue; }

    await keWebp(png, webp);
    if (!fs.existsSync(webp)) { gagal.push(judul); console.log(`  GAGAL ubah  ${judul}`); continue; }

    const kb = Math.round(fs.statSync(webp).size / 1024);
    console.log(`  ok     ${judul.padEnd(40)} ${String(kb).padStart(4)} KB`);
    berhasil++;
  }

  console.log(`\nberhasil ${berhasil} dari ${perlu.length}`);
  if (gagal.length) {
    console.log("gagal (kartunya akan memakai sampul berwarna kategori):");
    gagal.forEach((g) => console.log("  - " + g));
  }
})();
