-- ============================================================
-- Patch nº 15 — LISTA DE ESPERA + médico de referencia
-- Reglas EiviLuxury:
--  · Al crear una cita, si el paciente no tiene médico asignado en ese
--    área, el médico de la cita queda como su médico de referencia
--    (lo hace el bot/panel en código; aquí solo la tabla de espera).
--  · Si el médico asignado no tiene hueco esta semana, el bot ofrece
--    otro doctor o apuntarse a esta lista. La gestiona el médico desde
--    su perfil del panel (y recepción/dirección también la ven).
-- ============================================================

create table if not exists eivi.lista_espera (
  id             bigint generated always as identity primary key,
  paciente_id    bigint not null references eivi.pacientes(id) on delete cascade,
  area_id        bigint not null references eivi.areas(id),
  medico_id      bigint references eivi.medicos(id),      -- médico preferido (normalmente el de referencia)
  tratamiento_id bigint references eivi.tratamientos(id),
  preferencia    text,                                    -- "cuanto antes", "mañanas", "a partir del día 20"...
  estado         text not null default 'pendiente' check (estado in ('pendiente','contactado','agendada','cancelada')),
  notas          text,                                    -- notas internas del médico/recepción
  creada_via     text not null default 'bot',             -- bot | panel
  cita_id        bigint references eivi.citas(id),        -- cita creada al resolverla
  created_at     timestamptz not null default now(),
  resuelta_at    timestamptz
);
-- Solo una entrada PENDIENTE por paciente y área (evita duplicados del bot)
create unique index if not exists uq_lista_espera_pendiente
  on eivi.lista_espera(paciente_id, area_id) where estado = 'pendiente';
create index if not exists idx_lista_espera_medico on eivi.lista_espera(medico_id, estado);
create index if not exists idx_lista_espera_area   on eivi.lista_espera(area_id, estado);

grant all on eivi.lista_espera to service_role;
grant usage, select on all sequences in schema eivi to service_role;
alter table eivi.lista_espera enable row level security;

notify pgrst, 'reload schema';
