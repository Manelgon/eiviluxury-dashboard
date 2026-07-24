-- ============================================================
-- Patch nº 17 — Fuera el campo "especialidad" de medicos
-- La especialidad del médico SON sus áreas (medico_areas):
-- un solo lugar donde mantenerlo, sin datos duplicados.
-- ============================================================

alter table eivi.medicos drop column if exists especialidad;

notify pgrst, 'reload schema';
