-- ============================================================
-- Patch nº 18 — MI AGENDA (autonomía del médico freelancer)
--  · antelacion_horas: antelación mínima con la que el bot puede
--    ofrecer huecos de ese médico (0 = al momento)
--  · citas.reactiva: reserva "de hoy para hoy" (alerta ⚡ recepción)
--  · citas.enfermera_id: enfermera de apoyo (cita compartida en
--    ambas columnas de la agenda)
--  · tratamientos.requiere_enfermeria: al reservar, pedir apoyo
--  · avisos: cola de mensajes proactivos que el bot envía por
--    WhatsApp (cancelación → lista de espera, reprogramación...)
-- ============================================================

alter table eivi.medicos add column if not exists antelacion_horas integer not null default 0
  check (antelacion_horas >= 0 and antelacion_horas <= 336); -- máx. 2 semanas

alter table eivi.citas add column if not exists reactiva boolean not null default false;
alter table eivi.citas add column if not exists enfermera_id bigint references eivi.medicos(id);
create index if not exists idx_citas_enfermera on eivi.citas(enfermera_id) where enfermera_id is not null;

alter table eivi.tratamientos add column if not exists requiere_enfermeria boolean not null default false;

create table if not exists eivi.avisos (
  id          bigint generated always as identity primary key,
  paciente_id bigint references eivi.pacientes(id) on delete cascade,
  telefono    text not null,          -- WhatsApp del paciente (destino)
  tipo        text not null check (tipo in ('cita_cancelada_espera','cita_reprogramada','recepcion_llamar')),
  mensaje     text not null,          -- texto ya redactado que enviará el bot
  payload     jsonb,                  -- contexto (cita, médico, motivo...)
  estado      text not null default 'pendiente' check (estado in ('pendiente','enviado','fallido')),
  created_at  timestamptz not null default now(),
  enviado_at  timestamptz
);
create index if not exists idx_avisos_pendientes on eivi.avisos(estado) where estado = 'pendiente';

grant all on eivi.avisos to service_role;
grant usage, select on all sequences in schema eivi to service_role;
alter table eivi.avisos enable row level security;

notify pgrst, 'reload schema';
