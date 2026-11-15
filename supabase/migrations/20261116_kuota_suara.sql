-- Kuota harian untuk pembacaan suara Kak Nala (Gemini TTS "Leda").
--
-- Kuota gratis TTS Gemini jauh lebih kecil daripada kuota teks, sementara
-- endpoint suaranya terbuka untuk siswa tanpa akun. Tanpa batas di sisi basis
-- data, satu orang bisa menghabiskannya untuk seluruh sekolah dalam semenit.
--
-- Dipisah dari kolom jumlah yang sudah ada karena batas teks dan batas suara
-- memang berbeda jauh; menggabungkannya membuat yang satu mematikan yang lain.
--
-- Jalankan lewat SQL Editor di dashboard, atau:
--   supabase db push --project-ref riajhxegskgwytmpcvut

alter table public.ipa_tutor_kuota
  add column if not exists suara integer not null default 0;

create or replace function public.ipa_suara_naikkan_kuota(p_tanggal date)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.ipa_tutor_kuota (tanggal, jumlah, suara)
  values (p_tanggal, 0, 1)
  on conflict (tanggal) do update
    set suara = public.ipa_tutor_kuota.suara + 1;
$$;

-- Hanya Edge Function (service role) yang boleh memanggilnya; bila terbuka
-- untuk anon, penghitungnya bisa dinaikkan sembarangan dari luar.
revoke execute on function public.ipa_suara_naikkan_kuota(date) from public;
revoke execute on function public.ipa_suara_naikkan_kuota(date) from anon;
revoke execute on function public.ipa_suara_naikkan_kuota(date) from authenticated;
