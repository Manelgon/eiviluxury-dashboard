-- ============================================================
-- Patch nº 16 — FICHA COMPLETA DEL FACULTATIVO
-- Basado en practitioners de SANIAN (license_number, dni,
-- specialty, birth_date, address, bio), adaptado a eivi.medicos.
-- Permite crear el médico completo desde el alta de usuario:
-- un solo formulario crea auth + usuarios_panel + ficha medicos.
-- ============================================================

alter table eivi.medicos add column if not exists num_colegiado    text;  -- nº de colegiado (obligatorio para médicos reales; lo exige la API si tipo=medico)
alter table eivi.medicos add column if not exists dni              text;
alter table eivi.medicos add column if not exists telefono         text;
alter table eivi.medicos add column if not exists email            text;
alter table eivi.medicos add column if not exists fecha_nacimiento date;
alter table eivi.medicos add column if not exists direccion        text;
alter table eivi.medicos add column if not exists bio              text;

-- Únicos solo cuando están informados (las fichas seed antiguas quedan a null sin conflicto)
create unique index if not exists uq_medicos_dni       on eivi.medicos(dni) where dni is not null;
create unique index if not exists uq_medicos_colegiado on eivi.medicos(num_colegiado) where num_colegiado is not null;

notify pgrst, 'reload schema';
