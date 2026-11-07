// =============================================================================
// AI Tutor "Kak Nala" — perantara antara halaman publik dan Google Gemini.
//
// Perannya BUKAN menjawab, melainkan menuntun: balasannya diarahkan berupa
// pertanyaan balik yang memancing siswa berpikir satu langkah lebih jauh.
// Jalan keluarnya tetap disediakan — bila siswa sudah berkali-kali buntu atau
// memang meminta jawaban, penjelasan diberikan lalu ditutup pertanyaan
// pengecek pemahaman. Metode Socratic tanpa pintu keluar hanya membuat anak
// SMP patah semangat.
//
// Fungsi ini sengaja TIDAK memakai verify_jwt karena penggunanya siswa tanpa
// akun. Sebagai gantinya ia menjaga dirinya sendiri: membatasi panjang pesan,
// membatasi jumlah pesan per sesi, dan membatasi pemakaian harian secara
// menyeluruh supaya kuota AI tidak bisa dihabiskan orang iseng.
//
// Kunci API hanya hidup di sini sebagai rahasia lingkungan; halaman tidak
// pernah menerimanya.
//
// Slug fungsinya tetap "pak-bay" meski asistennya kini bernama Kak Nala.
// Slug itu tidak pernah dilihat siswa, sedangkan menggantinya berarti membuat
// fungsi baru dan sempat memutus halaman yang sedang tayang.
//
// Men-deploy ulang:
//   supabase functions deploy pak-bay --project-ref riajhxegskgwytmpcvut --no-verify-jwt
// =============================================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// gemini-2.5-flash dijadikan yang utama berdasarkan pengukuran, bukan karena
// ia model yang lebih baru. Selama berjam-jam gemini-3.8-flash menolak dengan
// 503 "high demand" di setiap permintaan, dan ia tidak menolak dengan cepat:
// perlu 8 sampai 12 detik sebelum mengaku sibuk. Akibatnya tiap jawaban
// membayar pajak sepuluh detik untuk model yang sudah pasti gagal, lalu baru
// dijawab cadangannya dalam 2 sampai 3 detik. Menaruh yang sehat di depan
// memangkas sebagian besar waktu tunggu siswa. Bila 3.8 pulih, ia tetap
// terpakai sebagai cadangan pertama.
const MODEL_UTAMA  = "gemini-2.5-flash";
const BATAS_HARIAN = 400;   // total pesan seluruh pengunjung per hari
const BATAS_SESI   = 30;    // pesan per sesi peramban per hari
const BATAS_HURUF  = 600;   // panjang maksimal pertanyaan siswa

// Model pengganti bila yang utama sedang sibuk. Daftarnya ditulis tetap,
// bukan dicari lewat ListModels: panggilan pencarian itu sendiri memakan
// beberapa detik, dan yang langka di Edge Function adalah waktu.
// gemini-flash-latest sengaja tidak dipakai. Dalam pengukuran ia tidak pernah
// sekali pun menjawab tepat waktu — selalu macet sampai batas, sehingga hanya
// menambah belasan detik pada kasus terburuk tanpa pernah menolong.
const MODEL_CADANGAN = ["gemini-3.8-flash"];

// Batas waktu tiap panggilan ke Gemini. Tanpa ini satu sambungan yang macet
// menggantung tanpa henti: anggaran waktu di bawah hanya diperiksa di ANTARA
// percobaan, tidak bisa menyela percobaan yang sedang berjalan. Pernah
// terukur satu permintaan menggantung lewat 90 detik karenanya.
//
// Enam detik, bukan sembilan: jawaban yang sehat datang dalam 2 sampai 3
// detik, jadi yang belum menjawab setelah enam detik praktis tidak pernah
// menjadi jalan tercepat — ia hanya menunda model berikutnya.
const BATAS_PANGGILAN_MS = 6000;

// Edge Function dimatikan paksa bila terlalu lama menunggu (WallClockTime).
// Dulu fungsi ini mati justru saat 503 terjadi, karena coba-ulang berjeda
// lalu pencarian model menghabiskan jatah waktunya sebelum sempat menjawab.
// Sekarang waktunya dianggarkan sendiri, dan kalau habis kita menyerah
// dengan pesan yang sopan alih-alih dibunuh di tengah jalan.
const ANGGARAN_MS = 18000;
const SISA_MINIMAL_MS = 3500;   // tidak memulai percobaan baru di bawah ini

// Model baru memakai sebagian jatah keluaran untuk berpikir sebelum menulis,
// jadi angkanya harus longgar. Jawaban tetap pendek karena diatur lewat
// perintah sistem, bukan lewat batas ini.
const BATAS_KELUARAN = 2048;

// Setelah sekian giliran, siswa yang masih buntu berhak atas penjelasan.
const GILIRAN_SEBELUM_DIBANTU = 3;

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

Deno.serve(async (req: Request) => {
  const mulaiPermintaan = Date.now();
  const sisaWaktu = () => ANGGARAN_MS - (Date.now() - mulaiPermintaan);

  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jawab({ galat: "Metode tidak didukung." }, 405);

  const kunciAI = Deno.env.get("GEMINI_API_KEY");
  if (!kunciAI) {
    return jawab({ galat: "belum_disiapkan",
      pesan: "Tutor belum diaktifkan. Kunci API belum dipasang." }, 503);
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let badan: { sesi?: string; pesan?: string };
  try { badan = await req.json(); }
  catch { return jawab({ galat: "Permintaan tidak terbaca." }, 400); }

  const sesi = String(badan.sesi ?? "").trim();
  const pesan = String(badan.pesan ?? "").trim();

  if (sesi.length < 8 || sesi.length > 64) return jawab({ galat: "Sesi tidak sah." }, 400);
  if (pesan.length < 1) return jawab({ galat: "Pesannya masih kosong." }, 400);
  if (pesan.length > BATAS_HURUF) {
    return jawab({ galat: `Pertanyaannya terlalu panjang. Maksimal ${BATAS_HURUF} huruf.` }, 400);
  }

  const hariIni = new Date().toISOString().slice(0, 10);

  // Kelimanya dijalankan serentak, bukan berurutan. Tidak ada yang bergantung
  // pada hasil yang lain, sementara berurutan berarti lima kali bolak-balik ke
  // basis data sebelum Gemini sempat dihubungi. Pemeriksaan batas tetap
  // dilakukan sebelum AI dipanggil; paling banter beberapa kueri ringan
  // terlanjur jalan saat batasnya memang sudah terlampaui.
  const [resSesi, resKuota, resKonten, resPengetahuan, resRiwayat] = await Promise.all([
    sb.from("ipa_tutor_percakapan")
      .select("id", { count: "exact", head: true })
      .eq("sesi", sesi).eq("peran", "siswa").gte("dibuat_pada", hariIni),
    sb.from("ipa_tutor_kuota").select("jumlah").eq("tanggal", hariIni).maybeSingle(),
    sb.from("ipa_konten").select("data").eq("id", 1).maybeSingle(),
    sb.from("ipa_tutor_pengetahuan").select("topik, isi").eq("aktif", true).limit(60),
    sb.from("ipa_tutor_percakapan").select("peran, pesan")
      .eq("sesi", sesi).order("dibuat_pada", { ascending: false }).limit(10),
  ]);

  if ((resSesi.count ?? 0) >= BATAS_SESI) {
    return jawab({ galat: "batas_sesi",
      pesan: "Kamu sudah banyak bertanya hari ini. Lanjut lagi besok ya!" }, 429);
  }

  if ((resKuota.data?.jumlah ?? 0) >= BATAS_HARIAN) {
    return jawab({ galat: "batas_harian",
      pesan: "Kak Nala sedang istirahat karena hari ini sudah banyak sekali pertanyaan. Coba lagi besok ya!" }, 429);
  }

  const konten = (resKonten.data?.data ?? {}) as Record<string, any>;

  const pangkas = (t: unknown, n: number) => {
    const s = String(t ?? "").trim();
    if (s.length <= n) return s;
    const potong = s.slice(0, n);
    return potong.slice(0, potong.lastIndexOf(" ")) + "…";
  };

  const daftarMateri = (konten.materi ?? [])
    .map((m: any) => `- [Kelas ${m.kelas}] ${m.judul} — ${pangkas(m.ringkasan, 150)}`)
    .join("\n");

  const daftarMedia = (konten.media ?? [])
    .map((m: any) => `- [${m.kategori}] ${m.judul} — ${pangkas(m.deskripsi, 110)}`)
    .join("\n");

  const daftarPengumuman = (konten.pengumuman ?? [])
    .slice(0, 5)
    .map((p: any) => `- (${p.tanggal}) ${p.judul} — ${pangkas(p.isi, 140)}`)
    .join("\n");

  const daftarPengetahuan = (resPengetahuan.data ?? [])
    .map((p: any) => `- ${p.topik}: ${p.isi}`).join("\n");

  const percakapan = (resRiwayat.data ?? []).reverse().map((r: any) => ({
    role: r.peran === "siswa" ? "user" : "model",
    parts: [{ text: r.pesan }],
  }));

  // Dihitung di sini, bukan diserahkan ke model: model buruk dalam menghitung,
  // padahal angka inilah yang menentukan kapan ia berhenti bertanya balik.
  const giliranSiswa = percakapan.filter((p) => p.role === "user").length + 1;
  const sudahLamaBuntu = giliranSiswa >= GILIRAN_SEBELUM_DIBANTU;

  const namaGuru = konten?.profil?.nama ?? "Bayu Setiadji";

  const perintahSistem = `Kamu adalah "Kak Nala", teman berpikir pada halaman pembelajaran IPA milik ${namaGuru}, guru IPA SMP Negeri 3 Besuki, Situbondo.

PERAN UTAMAMU: MENUNTUN, BUKAN MENJAWAB
Tugasmu membuat siswa menemukan jawabannya sendiri. Secara umum, balasanmu berakhir dengan SATU pertanyaan balik yang membawa siswa satu langkah lebih dekat ke jawaban.

Cara menuntun:
1. Mulai dari apa yang sudah siswa tahu. Tanyakan dugaannya dulu sebelum apa pun.
2. Hargai bagian yang sudah benar dengan menyebutkannya secara spesifik, baru arahkan bagian yang keliru.
3. Pecah persoalan besar jadi langkah kecil. Satu pertanyaan saja tiap balasan, jangan memberondong.
4. Pakai contoh sehari-hari yang bisa dia bayangkan atau coba sendiri di rumah.
5. Bila jawabannya salah, jangan katakan "salah" lalu berhenti. Ajukan pertanyaan yang membuat dia sendiri menemukan janggalnya.
6. Bila jawabannya benar, katakan benar dengan jelas, lalu minta dia menjelaskan alasannya atau terapkan ke situasi baru.

KAPAN BERHENTI BERTANYA DAN MULAI MENJELASKAN
Ini sama pentingnya. Berikan penjelasan yang utuh dan jelas, lalu tutup dengan satu pertanyaan pengecek pemahaman, bila:
- siswa memintanya terus terang ("kasih tahu saja", "aku menyerah", "langsung jawabannya"), atau
- siswa terdengar frustrasi, atau
- sudah ${GILIRAN_SEBELUM_DIBANTU} kali bertukar pesan tentang hal yang sama dan dia masih buntu.
Saat ini siswa sudah mengirim ${giliranSiswa} pesan dalam percakapan ini.${sudahLamaBuntu ? " Karena sudah cukup banyak, condonglah MENJELASKAN sekarang bila ia memang masih belum paham — jangan terus bertanya balik." : ""}

YANG DIJAWAB LANGSUNG, TANPA DITANYA BALIK
Menuntun hanya cocok untuk konsep. Jawab saja apa adanya untuk:
- pertanyaan tentang isi halaman ini: materi apa yang ada, media apa yang bisa dipakai, ada pengumuman apa;
- fakta tunggal yang tidak ada yang bisa dipikirkan, misalnya lambang suatu unsur;
- saran urutan belajar.
Untuk saran belajar, tanyakan dulu kelas berapa dia bila belum diketahui.

CARA MENULIS — PENTING
- Tulis POLOS tanpa format apa pun. JANGAN memakai tanda bintang, pagar, garis bawah, atau penanda tebal/miring. Panel obrolan menampilkannya mentah sehingga jadi jelek.
- Bila menyebut materi atau media, sebutkan JUDULNYA SAJA. JANGAN menyalin keterangan atau ringkasannya.
- Pendek: 2 sampai 4 kalimat, dan selalu SELESAIKAN kalimat terakhirmu.
- Bahasa Indonesia hangat dan sederhana untuk siswa SMP kelas VII sampai IX.
- Panggil siswa HANYA dengan "kamu". JANGAN pernah menyapa "Nak", "Adik", "Dik", "Anak-anak", atau sapaan sejenis — itu terdengar menggurui dan membuat jarak.
- Jangan memuji berlebihan. "Wah, pertanyaan bagus sekali!" di setiap balasan terasa palsu. Langsung saja ke pokoknya.

SIAPA KAMU
- Kamu ASISTEN AI, bukan guru sungguhan. Bila ada yang mengira kamu manusia atau mengira kamu Pak Bayu, luruskan dengan ramah.
- Kamu tidak bisa memberi nilai, mengubah tugas, atau mengurus hal administrasi sekolah. Untuk itu arahkan siswa menemui Pak Bayu langsung atau lewat kotak saran di halaman ini.

BATAS
- Hanya bahas IPA dan isi halaman ini. Untuk pertanyaan di luar itu, tolak dengan ramah lalu tawarkan topik IPA.
- JANGAN mengarang judul materi atau media yang tidak ada di daftar. Kalau memang belum ada, katakan terus terang dan sarankan bertanya ke Pak Bayu.
- Bila siswa meminta dibuatkan jawaban PR atau tugas supaya tinggal disalin, jangan diberikan. Tawarkan menemaninya mengerjakan langkah demi langkah.
- Jangan pernah meminta data pribadi siswa: alamat, nomor HP, akun, atau kata sandi.
- Bila siswa bercerita soal masalah pribadi yang berat, tanggapi dengan empati singkat lalu sarankan bicara dengan guru, wali kelas, atau orang tua.

CATATAN KURASI DARI PAK BAYU (ini paling berwenang; bila bertentangan dengan pengetahuan umummu, IKUTI catatan ini)
${daftarPengetahuan || "(belum ada)"}

DAFTAR MATERI (keterangan setelah tanda — hanya untuk pemahamanmu, jangan disalin ke jawaban)
${daftarMateri || "(belum ada)"}

DAFTAR MEDIA (keterangan setelah tanda — hanya untuk pemahamanmu, jangan disalin ke jawaban)
${daftarMedia || "(belum ada)"}

DAFTAR PENGUMUMAN TERBARU
${daftarPengumuman || "(belum ada)"}`;

  const muatan = {
    systemInstruction: { parts: [{ text: perintahSistem }] },
    contents: [...percakapan, { role: "user", parts: [{ text: pesan }] }],
    generationConfig: { temperature: 0.8, maxOutputTokens: BATAS_KELUARAN },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT",        threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_HATE_SPEECH",       threshold: "BLOCK_MEDIUM_AND_ABOVE" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_LOW_AND_ABOVE" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
    ],
  };

  async function coba(model: string): Promise<{ teks?: string; kode?: number; alasan?: string }> {
    // Jangan menunggu lebih lama dari yang tersisa, dan jangan pernah lebih
    // dari batas satu panggilan. Tanpa penyela ini, model yang menggantung
    // menahan jawaban sampai platformnya sendiri yang membunuh fungsi.
    const jatah = Math.max(1000, Math.min(BATAS_PANGGILAN_MS, sisaWaktu() - 1500));
    const mulaiPanggilan = Date.now();

    let r: Response;
    try {
      r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${kunciAI}`,
        { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(muatan), signal: AbortSignal.timeout(jatah) },
      );
    } catch (e) {
      const lama = Date.now() - mulaiPanggilan;
      console.warn(`Model ${model} tidak menjawab dalam ${lama}ms:`, String(e).slice(0, 120));
      return { kode: 503 };   // diperlakukan sebagai kesibukan: coba model lain
    }

    console.log(`Model ${model} menjawab ${r.status} dalam ${Date.now() - mulaiPanggilan}ms`);
    if (!r.ok) {
      const rinci = await r.text();
      console.error(`Model ${model} menolak:`, r.status, rinci.slice(0, 250));
      return { kode: r.status };
    }
    const d = await r.json();
    const kandidat = d?.candidates?.[0];
    if (kandidat?.finishReason && kandidat.finishReason !== "STOP") {
      console.warn(`Model ${model} berhenti karena:`, kandidat.finishReason);
    }
    return {
      teks: kandidat?.content?.parts?.[0]?.text?.trim() ?? "",
      alasan: kandidat?.finishReason,
    };
  }

  let balasan = "";
  let kodeTerakhir = 0;
  let adaPercobaan = false;   // sempatkah satu model dicoba sebelum waktu habis?

  try {
    // Satu percobaan per model, langsung pindah ke cadangan. Mengulang model
    // yang sama saat ia 503 hampir selalu sia-sia dan hanya memakan waktu
    // yang dibutuhkan model berikutnya.
    for (const model of [MODEL_UTAMA, ...MODEL_CADANGAN]) {
      if (sisaWaktu() < SISA_MINIMAL_MS) {
        console.warn("Anggaran waktu habis, berhenti sebelum", model);
        break;
      }
      adaPercobaan = true;
      const h = await coba(model);
      if (h.teks !== undefined) {
        if (model !== MODEL_UTAMA) console.log("Terlayani model cadangan:", model);
        balasan = h.teks; kodeTerakhir = 0; break;
      }
      kodeTerakhir = h.kode ?? 0;
      // Galat selain kesibukan tidak akan membaik dengan ganti model.
      if (h.kode !== 503 && h.kode !== 429 && h.kode !== 404) break;
    }

    if (!balasan && kodeTerakhir) {
      if (kodeTerakhir === 429) {
        return jawab({ galat: "kuota_ai",
          pesan: "Kuota harian AI sudah habis. Coba lagi besok ya!" }, 429);
      }
      if (kodeTerakhir === 503) {
        return jawab({ galat: "sedang_sibuk",
          pesan: "Kak Nala sedang ramai sekali ditanya. Tunggu sebentar lalu kirim lagi ya." }, 503);
      }
      return jawab({ galat: "ai_gagal",
        pesan: "Kak Nala sedang tidak bisa menjawab. Coba sebentar lagi." }, 502);
    }

    if (!balasan) {
      // Dua sebab berbeda bisa sampai ke sini, dan keduanya tidak pantas
      // diberi pesan yang sama. Anggaran waktu habis sebelum satu pun model
      // sempat dicoba berarti sedang sibuk — mencoba lagi memang masuk akal.
      // Sedangkan model yang menjawab kosong biasanya karena penyaring
      // keamanannya menahan jawaban; menyuruh siswa mencoba lagi hanya
      // membuatnya mengulang hal yang sama dan kecewa lagi.
      if (!adaPercobaan) {
        return jawab({ galat: "sedang_sibuk",
          pesan: "Kak Nala sedang ramai sekali ditanya. Tunggu sebentar lalu kirim lagi ya." }, 503);
      }
      balasan = "Maaf, pertanyaan itu belum bisa Kak Nala jawab. Coba tanyakan hal lain seputar IPA ya.";
    }
  } catch (e) {
    console.error("Gagal menghubungi Gemini:", e);
    return jawab({ galat: "ai_gagal",
      pesan: "Kak Nala sedang tidak bisa dihubungi. Coba sebentar lagi." }, 502);
  }

  balasan = balasan
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|$)/g, "$1$2")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ");

  // Keduanya berjalan serentak. Jawabannya sudah siap di titik ini, jadi tiap
  // bolak-balik ke basis data di sini murni menunda sampainya ke siswa.
  await Promise.all([
    sb.from("ipa_tutor_percakapan").insert([
      { sesi, peran: "siswa", pesan },
      { sesi, peran: "tutor", pesan: balasan },
    ]),
    sb.rpc("ipa_tutor_naikkan_kuota", { p_tanggal: hariIni }),
  ]);

  return jawab({ balasan });
});
