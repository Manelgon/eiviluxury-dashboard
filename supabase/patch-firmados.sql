-- ============================================================
-- Patch nº 13 — Archivo de documentos RGPD firmados
-- Bucket privado en Storage + campos de firmado en cada documento.
-- ============================================================

alter table eivi.rgpd_documentos add column if not exists firmado_path text;
alter table eivi.rgpd_documentos add column if not exists firmado_at timestamptz;
alter table eivi.rgpd_documentos add column if not exists firmado_por text;

-- Bucket privado (solo accesible con la service key del panel; se sirven URLs firmadas temporales)
insert into storage.buckets (id, name, public)
values ('rgpd-firmados', 'rgpd-firmados', false)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
