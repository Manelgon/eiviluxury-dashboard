-- ============================================================
-- RGPD Fase 1 — EiviLuxury (esquema eivi)
-- Auditoría, consentimientos granulares y borrado suave.
-- Ejecutar en el proyecto de la clínica. (Patch nº 8 del índice)
-- ============================================================

-- 1. Auditoría de acciones (panel y bot)
create table if not exists eivi.audit_logs (
  id            bigint generated always as identity primary key,
  actor_id      uuid,                -- usuario del panel (null = bot/anónimo)
  actor_email   text,
  accion        text not null,       -- ej: cita.crear, cliente.eliminar, auth.login
  recurso_tipo  text,
  recurso_id    text,
  recurso_label text,
  metadata      jsonb,
  created_at    timestamptz not null default now()
);
create index if not exists idx_audit_created on eivi.audit_logs(created_at desc);
create index if not exists idx_audit_accion on eivi.audit_logs(accion);

-- 2. Consentimientos granulares por finalidad (huella RGPD)
create table if not exists eivi.consentimientos (
  id          bigint generated always as identity primary key,
  cliente_id  bigint not null references eivi.clientes(id) on delete cascade,
  tipo        text not null check (tipo in (
                'datos_personales',            -- tratamiento de datos identificativos
                'datos_clinicos',              -- tratamiento de datos de salud (art. 9)
                'comunicaciones_recordatorios',-- recordatorios de cita por WhatsApp
                'publicidad'                   -- novedades y promociones
              )),
  aceptado    boolean not null,
  texto       text,                  -- texto literal presentado al cliente
  canal       text not null default 'whatsapp',  -- whatsapp | panel | presencial
  created_at  timestamptz not null default now(),
  revocado_at timestamptz
);
create index if not exists idx_consent_cliente on eivi.consentimientos(cliente_id, tipo);

-- 3. Borrado suave de clientes (reversible; nada se destruye)
alter table eivi.clientes add column if not exists deleted_at timestamptz;

-- Permisos
grant all on eivi.audit_logs to service_role;
grant all on eivi.consentimientos to service_role;
alter table eivi.audit_logs enable row level security;
alter table eivi.consentimientos enable row level security;
