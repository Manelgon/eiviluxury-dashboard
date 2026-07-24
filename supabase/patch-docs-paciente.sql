-- ============================================================
-- Patch nº 24 — Cronómetro silencioso + documentos del paciente
--  · consultas.duracion_seg: lo que tardó el médico en registrar
--    la consulta (se mide solo, INVISIBLE para el médico; solo lo
--    ven dirección/admin en Métricas → Actividad por médico)
--  · paciente_documentos + bucket privado docs-pacientes: fotos
--    antes/después, consentimientos de tratamiento firmados,
--    pruebas, informes… (acceso clínico, siempre auditado)
-- ============================================================

alter table eivi.consultas add column if not exists duracion_seg integer
  check (duracion_seg is null or (duracion_seg >= 0 and duracion_seg <= 14400));

create table if not exists eivi.paciente_documentos (
  id          bigint generated always as identity primary key,
  paciente_id bigint not null references eivi.pacientes(id) on delete cascade,
  consulta_id bigint references eivi.consultas(id) on delete set null,
  categoria   text not null check (categoria in ('foto_antes','foto_despues','consentimiento','prueba','informe','otro')),
  titulo      text not null,
  path        text not null,
  mime        text,
  bytes       integer,
  subido_por  text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_pdocs_paciente on eivi.paciente_documentos(paciente_id, created_at desc);

-- Bucket privado (solo service key; se sirven URLs firmadas temporales)
insert into storage.buckets (id, name, public)
values ('docs-pacientes', 'docs-pacientes', false)
on conflict (id) do nothing;

grant all on eivi.paciente_documentos to service_role;
grant usage, select on all sequences in schema eivi to service_role;
alter table eivi.paciente_documentos enable row level security;

notify pgrst, 'reload schema';
