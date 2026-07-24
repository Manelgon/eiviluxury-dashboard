-- ============================================================
-- Patch nº 19 — FICHA COMPLETA DEL PACIENTE (modelo SANIAN)
--  · cip: identificador interno UUID (como el CIP de sanidad)
--  · dni / fecha_nacimiento / direccion / sexo (los completa
--    RECEPCIÓN en persona — el bot no los pide ni los ve)
--  · alta_completa: el bot da de alta "a medias" (contacto +
--    consentimiento) y reserva la cita igual; la ficha queda
--    PENDIENTE DE ALTA hasta que recepción la complete en clínica
--  · vista pacientes_bot: lo ÚNICO del paciente que puede leer
--    el bot (contacto y comercial; jamás DNI, dirección ni nada
--    clínico)
-- ============================================================

alter table eivi.pacientes add column if not exists cip uuid unique default gen_random_uuid();
update eivi.pacientes set cip = gen_random_uuid() where cip is null;

alter table eivi.pacientes add column if not exists dni              text;
alter table eivi.pacientes add column if not exists fecha_nacimiento date;
alter table eivi.pacientes add column if not exists direccion        text;
alter table eivi.pacientes add column if not exists sexo             text check (sexo in ('mujer','hombre','otro'));
alter table eivi.pacientes add column if not exists alta_completa    boolean not null default false;

create unique index if not exists uq_pacientes_dni on eivi.pacientes(dni) where dni is not null;

-- Datos de prueba existentes: los que ya tienen nombre y consentimiento se consideran alta completa
update eivi.pacientes set alta_completa = true where nombre is not null and consentimiento_rgpd = true;

-- ---------- Vista para el bot: SOLO contacto y comercial ----------
-- El bot identifica, saluda, reserva, recuerda y hace marketing/encuestas.
-- NUNCA lee dni, direccion, fecha_nacimiento, sexo, ni tablas clínicas.
create or replace view eivi.pacientes_bot as
  select id, cip, telefono, telefono_contacto, nombre, apellidos, email,
         consentimiento_rgpd, activo, deleted_at, alta_completa, created_at
  from eivi.pacientes;

grant select on eivi.pacientes_bot to service_role;

notify pgrst, 'reload schema';
