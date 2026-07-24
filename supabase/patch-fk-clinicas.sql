-- ============================================================
-- Patch nº 22 — FKs directas que faltaban en las tablas clínicas
-- El patch 14 dejó medico_id/area_id sin FK propia en varias
-- tablas (solo la compuesta a medico_areas): PostgREST no podía
-- resolver los joins con areas/medicos ("Could not find a
-- relationship ... in the schema cache").
-- ============================================================

do $$ begin
  alter table eivi.paciente_medico_area
    add constraint fk_pma_medico foreign key (medico_id) references eivi.medicos(id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table eivi.paciente_medico_area
    add constraint fk_pma_area foreign key (area_id) references eivi.areas(id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table eivi.paciente_diagnosticos
    add constraint fk_pdiag_area foreign key (area_id) references eivi.areas(id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table eivi.paciente_diagnosticos
    add constraint fk_pdiag_medico foreign key (medico_id) references eivi.medicos(id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table eivi.consulta_diagnosticos
    add constraint fk_cdiag_area foreign key (area_id) references eivi.areas(id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table eivi.consulta_diagnosticos
    add constraint fk_cdiag_medico foreign key (medico_id) references eivi.medicos(id);
exception when duplicate_object then null; end $$;

notify pgrst, 'reload schema';
