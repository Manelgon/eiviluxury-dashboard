-- ============================================================
-- RGPD Fase 2 — EiviLuxury (patch nº 9)
-- Solicitudes de derechos ARCO. Ejecutar en el proyecto clínica.
-- ============================================================

create table if not exists eivi.derechos_arco (
  id            bigint generated always as identity primary key,
  cliente_id    bigint references eivi.clientes(id),
  nombre        text,
  contacto      text not null,        -- email o teléfono facilitado
  tipo_derecho  text not null check (tipo_derecho in
                ('acceso','rectificacion','supresion','portabilidad','oposicion','limitacion')),
  descripcion   text,
  canal         text not null default 'web',   -- web | whatsapp | panel
  estado        text not null default 'pendiente'
                check (estado in ('pendiente','en_proceso','resuelta')),
  notas_admin   text,
  resolucion_at timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists idx_arco_estado on eivi.derechos_arco(estado, created_at desc);

grant all on eivi.derechos_arco to service_role;
alter table eivi.derechos_arco enable row level security;

notify pgrst, 'reload schema';
