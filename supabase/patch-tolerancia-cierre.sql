-- ============================================================
-- Patch nº 21 — Tolerancia de cierre por médico
-- Cuántos minutos acepta alargar al FINAL de su tramo para no
-- perder el último hueco del día (ej: quedan 30' y el tratamiento
-- dura 60' → con tolerancia 30 el bot SÍ lo ofrece).
-- Regla: el hueco debe EMPEZAR dentro del horario y terminar como
-- máximo tolerancia_fin_min después del fin del tramo.
-- Lo gestiona el propio médico en Mi perfil → Mi horario.
-- ============================================================

alter table eivi.medicos add column if not exists tolerancia_fin_min integer not null default 0
  check (tolerancia_fin_min >= 0 and tolerancia_fin_min <= 120);

notify pgrst, 'reload schema';
