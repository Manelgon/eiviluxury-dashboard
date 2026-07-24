-- ============================================================
-- Patch nº 23 — MEAP completo en consultas (modelo SANIAN)
-- Añade el JUICIO CLÍNICO (la "A" de Motivo-Exploración-
-- Aproximación-Plan) a consultas y a su histórico versionado,
-- y actualiza el trigger de versionado para vigilarlo también.
-- ============================================================

alter table eivi.consultas add column if not exists juicio_clinico text;
alter table eivi.consultas_versiones add column if not exists juicio_clinico text;

create or replace function eivi.guardar_version_consulta() returns trigger as $$
begin
  if (old.motivo is distinct from new.motivo
      or old.exploracion is distinct from new.exploracion
      or old.juicio_clinico is distinct from new.juicio_clinico
      or old.plan is distinct from new.plan
      or old.tratamiento is distinct from new.tratamiento) then
    if new.motivo_edicion is null or length(trim(new.motivo_edicion)) = 0 then
      raise exception 'Modificar una consulta clinica requiere indicar el motivo de la edicion';
    end if;
    insert into eivi.consultas_versiones
      (consulta_id, version_number, motivo, exploracion, juicio_clinico, plan, tratamiento, notas,
       paciente_id, medico_id, area_id, editado_por, motivo_edicion)
    values
      (old.id, old.version_number, old.motivo, old.exploracion, old.juicio_clinico, old.plan, old.tratamiento, old.notas,
       old.paciente_id, old.medico_id, old.area_id, new.editado_por, new.motivo_edicion);
    new.version_number := old.version_number + 1;
    new.editada := true;
    new.editada_at := now();
  end if;
  return new;
end $$ language plpgsql;

notify pgrst, 'reload schema';
