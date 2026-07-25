-- ============================================================
-- Patch nº 25 — Flujo del paciente en clínica
-- confirmada → en_espera (llega, lo marca recepción)
--            → en_consulta (el titular empieza la consulta)
--            → completada (al guardar el MEAP o finalizar)
-- Tiempos: llegada_at / consulta_inicio_at / consulta_fin_at.
-- La espera se calcula SOLO desde su hora de cita (si llega
-- antes, ese rato no cuenta). Métricas solo dirección/admin.
-- ============================================================

alter table eivi.citas add column if not exists llegada_at timestamptz;
alter table eivi.citas add column if not exists consulta_inicio_at timestamptz;
alter table eivi.citas add column if not exists consulta_fin_at timestamptz;

-- Ampliar los estados permitidos (se busca el check actual por definición,
-- sin depender del nombre, y se recrea con los nuevos estados)
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'eivi.citas'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%estado%'
  loop
    execute format('alter table eivi.citas drop constraint %I', c.conname);
  end loop;
  alter table eivi.citas add constraint citas_estado_check
    check (estado in ('pendiente','confirmada','en_espera','en_consulta','completada','cancelada','no_show'));
end $$;

notify pgrst, 'reload schema';

-- VERIFICACIÓN: debe devolver 3 filas (las 3 columnas nuevas)
select column_name from information_schema.columns
where table_schema = 'eivi' and table_name = 'citas'
  and column_name in ('llegada_at','consulta_inicio_at','consulta_fin_at');
