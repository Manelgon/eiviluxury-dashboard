-- ============================================================
-- Panel EiviLuxury: usuarios del panel con roles
-- Ejecutar en el proyecto de la clínica (después del schema del bot).
--
-- Cómo dar de alta a una persona del equipo:
-- 1. Supabase → Authentication → Users → Add user (email + contraseña).
-- 2. Copia su UUID y ejecuta:
--    insert into eivi.usuarios_panel (user_id, email, nombre, rol)
--    values ('UUID-AQUI', 'recepcion@eiviluxury.com', 'Nombre', 'recepcion');
--    (roles: 'direccion' = todo · 'recepcion' = gestión diaria ·
--     'medico' = su agenda; en ese caso rellena también medico_id)
-- ============================================================

create table if not exists eivi.usuarios_panel (
  user_id    uuid primary key,
  email      text not null unique,
  nombre     text,
  rol        text not null check (rol in ('direccion','recepcion','medico')),
  medico_id  bigint references eivi.medicos(id),
  activo     boolean not null default true,
  created_at timestamptz not null default now()
);

grant all on eivi.usuarios_panel to service_role;
alter table eivi.usuarios_panel enable row level security;
