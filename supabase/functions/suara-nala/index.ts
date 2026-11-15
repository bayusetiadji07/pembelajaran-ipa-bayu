// =============================================================================
// Suara Kak Nala — Gemini TTS, suara perempuan bawaan "Leda".
//
// Mengikuti cara proyek NalarSTEM, yang memakai suara sama untuk tokoh yang
// sama. Halaman memanggil ini lebih dulu; bila gagal karena kuota habis,
// jaringan putus, atau terlalu lama, halaman memakai suara bawaan perangkat.
// Jadi fungsi ini boleh gagal tanpa membuat fiturnya mati.
//
// Kuota TTS gratis Gemini jauh lebih kecil daripada kuota teks — catatan di
// kode NalarSTEM menyebut sekitar sepuluh permintaan per hari per model.
// Karena itu:
//   - beberapa model dicoba bergantian, yang kehabisan kuota diistirahatkan;
//   - hasilnya disimpan di memori instance, jawaban sama tidak memakai kuota;
//   - pemakaian harian dibatasi di basis data supaya tidak bisa dikuras satu
//     orang, sebab endpoint ini terbuka untuk siswa tanpa akun.
//
// Masukan : { teks: string }
// Keluaran: { audio: <WAV base64>, model } | { galat, pesan }
//
// Men-deploy:
//   supabase functions deploy suara-nala --project-ref riajhxegskgwytmpcvut --no-verify-jwt
// =============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUARA = "Leda";
const MODEL_TTS = [
  "gemini-2.5-flash-preview-tts",
  "gemini-2.5-pro-preview-tts",
  "gemini-3.1-flash-tts-preview",
  "gemini-3.8-flash-tts",
];

const BATAS_HURUF  = 1200;
const BATAS_HARIAN = 150;    // seluruh pengunjung per hari
const BATAS_PANGGILAN_MS = 20000;
const ANGGARAN_MS = 40000;
const ISTIRAHAT_MS = 30 * 60 * 1000;   // model yang kehabisan kuota dilewati

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jawab(isi: unknown, status = 200) {
  return new Response(JSON.stringify(isi), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// Bertahan selama instance hidup. Jawaban yang diputar ulang tidak memakai kuota.
const simpanan = new Map<string, { audio: string; model: string }>();
const habis = new Map<string, number>();

/** Bungkus PCM 16-bit mono menjadi berkas WAV. */
function wav(pcm: Uint8Array, rate: number): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const tulis = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  tulis(0, "RIFF");  v.setUint32(4, 36 + pcm.length, true);
  tulis(8, "WAVE");  tulis(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  tulis(36, "data"); v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

/**
 * Membersihkan audio TTS.
 *
 * Pada tiap tanda baca Gemini menyisipkan bunyi napas/desis pelan yang di
 * pengeras suara ponsel terdengar seperti "kresek". Gerbang derau per bingkai
 * 10 ms memisahkan ucapan dari napas memakai dua ukuran sekaligus: energi dan
 * kerapatan perpotongan nol. Napas berenergi rendah tetapi rapat
 * perpotongannya; konsonan desis seperti s dan h juga rapat, maka ia
 * diselamatkan bila menempel pada bingkai yang keras.
 *
 * Disalin dari pendekatan yang sudah terbukti di NalarSTEM untuk suara yang
 * sama persis.
 */
function bersihkanAudio(pcm: Uint8Array, rate: number): Uint8Array {
  const v = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const n = pcm.length >> 1;
  const F = Math.round(rate / 100);          // bingkai 10 ms
  const nb = Math.ceil(n / F);
  const db = new Float32Array(nb);
  const zcr = new Float32Array(nb);

  for (let k = 0; k < nb; k++) {
    let s = 0, z = 0, c = 0, lalu = 0;
    for (let i = k * F; i < Math.min(n, (k + 1) * F); i++) {
      const x = v.getInt16(i * 2, true);
      s += x * x;
      if (c && (x >= 0) !== (lalu >= 0)) z++;
      lalu = x; c++;
    }
    db[k] = 20 * Math.log10(Math.sqrt(s / Math.max(c, 1)) / 32768 + 1e-9);
    zcr[k] = z / Math.max(c, 1);
  }

  const kuat = (k: number) => k >= 0 && k < nb && db[k] >= -32;
  const bicara = new Uint8Array(nb);
  for (let k = 0; k < nb; k++) {
    bicara[k] = (kuat(k) ||
      (db[k] >= -42 && (zcr[k] < 0.06 || kuat(k - 1) || kuat(k - 2) || kuat(k + 1) || kuat(k + 2)))) ? 1 : 0;
  }

  // Ucapan dijaga 30 ms sebelum dan 40 ms sesudahnya
  const buka = new Float32Array(nb);
  for (let k = 0; k < nb; k++) {
    if (bicara[k]) for (let j = Math.max(0, k - 3); j <= Math.min(nb - 1, k + 4); j++) buka[j] = 1;
  }

  const keluar = new Uint8Array(pcm.length);
  const vo = new DataView(keluar.buffer);
  const langkah = 1 / F;                      // penguatan berubah mulus, tanpa letupan
  const fade = Math.round(rate * 0.012);
  let g = buka[0];
  for (let i = 0; i < n; i++) {
    const tujuan = buka[Math.floor(i / F)];
    g += Math.max(-langkah, Math.min(langkah, tujuan - g));
    let x = v.getInt16(i * 2, true) * g;
    if (i < fade) x *= i / fade;
    if (i > n - fade) x *= (n - i) / fade;
    vo.setInt16(i * 2, Math.max(-32768, Math.min(32767, Math.round(x))), true);
  }
  return keluar;
}

/** base64 dari data biner, dipotong agar tidak meledakkan tumpukan panggilan. */
function keBase64(b: Uint8Array): string {
  let s = "";
  const N = 0x8000;
  for (let i = 0; i < b.length; i += N) s += String.fromCharCode(...b.subarray(i, i + N));
  return btoa(s);
}

function dariBase64(s: string): Uint8Array {
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}

async function ttsSekali(kunci: string, model: string, teks: string) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": kunci },
      // Teks polos tanpa instruksi gaya: sebagian model ikut membacakan
      // instruksi bila ditulis di dalam teksnya.
      body: JSON.stringify({
        contents: [{ parts: [{ text: teks }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: SUARA } } },
        },
      }),
      signal: AbortSignal.timeout(BATAS_PANGGILAN_MS),
    },
  );

  const d = await r.json().catch(() => ({}));
  const bagian = d?.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
  if (!r.ok || !bagian) {
    console.warn(`TTS ${model} gagal: ${r.status}`);
    return { status: r.status };
  }

  const pcm = dariBase64(bagian.inlineData.data);
  const rate = Number((String(bagian.inlineData.mimeType || "").match(/rate=(\d+)/) || [, "24000"])[1]);

  // Durasi wajar: kira-kira 0,04 sampai 0,12 detik per huruf. Lebih panjang
  // dari itu berarti model membacakan sesuatu selain teks yang diminta.
  const detik = pcm.length / 2 / rate;
  if (detik > teks.length * 0.12 + 3) {
    console.warn(`TTS ${model} terlalu panjang: ${detik.toFixed(1)} dtk untuk ${teks.length} huruf`);
    return { status: 422 };
  }

  console.log(`TTS ${model} berhasil: ${detik.toFixed(1)} dtk`);
  return { audio: keBase64(wav(bersihkanAudio(pcm, rate), rate)) };
}

Deno.serve(async (req: Request) => {
  const mulai = Date.now();
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jawab({ galat: "Metode tidak didukung." }, 405);

  const kunciAI = Deno.env.get("GEMINI_API_KEY");
  if (!kunciAI) return jawab({ galat: "belum_disiapkan", pesan: "Kunci API belum dipasang." }, 503);

  let badan: { teks?: string };
  try { badan = await req.json(); }
  catch { return jawab({ galat: "Permintaan tidak terbaca." }, 400); }

  const teks = String(badan.teks ?? "").replace(/\s+/g, " ").trim().slice(0, BATAS_HURUF);
  if (teks.length < 2) return jawab({ galat: "Teks kosong." }, 400);

  const tersimpan = simpanan.get(teks);
  if (tersimpan) return jawab({ ...tersimpan, simpanan: true });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const hariIni = new Date().toISOString().slice(0, 10);

  const { data: kuota } = await sb
    .from("ipa_tutor_kuota").select("suara").eq("tanggal", hariIni).maybeSingle();
  if ((kuota?.suara ?? 0) >= BATAS_HARIAN) {
    return jawab({ galat: "batas_harian", pesan: "Kuota suara hari ini sudah habis." }, 503);
  }

  for (const model of MODEL_TTS) {
    if (Date.now() - (habis.get(model) || 0) < ISTIRAHAT_MS) continue;
    if (Date.now() - mulai > ANGGARAN_MS) break;
    try {
      const h = await ttsSekali(kunciAI, model, teks);
      if (h.audio) {
        simpanan.set(teks, { audio: h.audio, model });
        if (simpanan.size > 120) simpanan.delete(simpanan.keys().next().value!);
        await sb.rpc("ipa_suara_naikkan_kuota", { p_tanggal: hariIni });
        return jawab({ audio: h.audio, model });
      }
      if (h.status === 429 || h.status === 404 || h.status === 403) habis.set(model, Date.now());
    } catch (e) {
      console.warn(`TTS ${model} terputus:`, String(e).slice(0, 120));
    }
  }

  // Bukan keadaan darurat: halaman akan memakai suara bawaan perangkat.
  return jawab({ galat: "tidak_tersedia", pesan: "Suara Leda sedang tidak tersedia." }, 503);
});
