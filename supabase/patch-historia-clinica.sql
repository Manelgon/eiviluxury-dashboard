-- ============================================================
-- Patch nº 14 — HISTORIA CLÍNICA (fase sanitaria, fundacional)
-- Basado en el modelo SANIAN, adaptado a las reglas EiviLuxury:
--  · Un paciente puede tener varios médicos, pero solo UNO por área
--  · Un médico solo ve consultas/diagnósticos de SUS áreas
--  · Las alergias son transversales: las ven TODOS los médicos del paciente
--  · Versionado inmutable de consultas (exigencia legal) con motivo de edición
-- ============================================================

-- ---------- 1. Asignación paciente ↔ médico por área ----------
create table if not exists eivi.paciente_medico_area (
  id          bigint generated always as identity primary key,
  paciente_id bigint not null references eivi.pacientes(id) on delete cascade,
  medico_id   bigint not null,
  area_id     bigint not null,
  activo      boolean not null default true,
  created_at  timestamptz not null default now(),
  -- el médico debe pertenecer al área (aprovecha la PK compuesta de medico_areas)
  foreign key (medico_id, area_id) references eivi.medico_areas(medico_id, area_id)
);
-- Solo un médico ACTIVO por (paciente, área)
create unique index if not exists uq_pma_paciente_area
  on eivi.paciente_medico_area(paciente_id, area_id) where activo;
create index if not exists idx_pma_medico on eivi.paciente_medico_area(medico_id) where activo;

-- ---------- 2. Catálogo CIE-10 (importar CSV cie10es_2026_clean.csv) ----------
create table if not exists eivi.cie10 (
  codigo          text primary key,
  descripcion     text not null,
  nodo_final      text,
  manifestacion   text,
  perinatal       text,
  pediatrico      text,
  obstetrico      text,
  adulto          text,
  mujer           text,
  hombre          text,
  poa_exento      text,
  dp_no_principal text,
  vcdp            text
);
create index if not exists idx_cie10_descripcion on eivi.cie10 using gin (to_tsvector('spanish', descripcion));

-- ---------- 3. Consultas clínicas (con versionado inmutable) ----------
create table if not exists eivi.consultas (
  id             bigint generated always as identity primary key,
  paciente_id    bigint not null references eivi.pacientes(id),
  medico_id      bigint not null references eivi.medicos(id),
  area_id        bigint not null references eivi.areas(id),
  cita_id        bigint references eivi.citas(id),
  fecha          timestamptz not null default now(),
  motivo         text not null,
  exploracion    text,
  plan           text,
  tratamiento    text,
  notas          text,
  estado         text not null default 'borrador' check (estado in ('borrador','firmada')),
  -- versionado
  version_number integer not null default 1,
  editada        boolean not null default false,
  editada_at     timestamptz,
  editado_por    text,            -- email del panel que edita (lo fija la API)
  motivo_edicion text,            -- OBLIGATORIO al modificar contenido clínico
  created_at     timestamptz not null default now()
);
create index if not exists idx_consultas_paciente on eivi.consultas(paciente_id, fecha desc);
create index if not exists idx_consultas_medico on eivi.consultas(medico_id, fecha desc);

-- Histórico inmutable: cada edición congela el estado ANTERIOR
create table if not exists eivi.consultas_versiones (
  id             bigint generated always as identity primary key,
  consulta_id    bigint not null references eivi.consultas(id) on delete cascade,
  version_number integer not null,
  motivo         text, exploracion text, plan text, tratamiento text, notas text,
  paciente_id    bigint not null,
  medico_id      bigint not null,
  area_id        bigint not null,
  editado_por    text,
  motivo_edicion text not null,
  created_at     timestamptz not null default now(),
  unique (consulta_id, version_number)
);

create or replace function eivi.guardar_version_consulta() returns trigger as $$
begin
  if (old.motivo is distinct from new.motivo
      or old.exploracion is distinct from new.exploracion
      or old.plan is distinct from new.plan
      or old.tratamiento is distinct from new.tratamiento) then
    if new.motivo_edicion is null or length(trim(new.motivo_edicion)) = 0 then
      raise exception 'Modificar una consulta clinica requiere indicar el motivo de la edicion';
    end if;
    insert into eivi.consultas_versiones
      (consulta_id, version_number, motivo, exploracion, plan, tratamiento, notas,
       paciente_id, medico_id, area_id, editado_por, motivo_edicion)
    values
      (old.id, old.version_number, old.motivo, old.exploracion, old.plan, old.tratamiento, old.notas,
       old.paciente_id, old.medico_id, old.area_id, new.editado_por, new.motivo_edicion);
    new.version_number := old.version_number + 1;
    new.editada := true;
    new.editada_at := now();
  end if;
  return new;
end $$ language plpgsql;

drop trigger if exists trg_version_consulta on eivi.consultas;
create trigger trg_version_consulta
  before update on eivi.consultas
  for each row execute function eivi.guardar_version_consulta();

-- ---------- 4. Diagnósticos ----------
-- Por consulta (el acto clínico)
create table if not exists eivi.consulta_diagnosticos (
  id          bigint generated always as identity primary key,
  consulta_id bigint not null references eivi.consultas(id) on delete cascade,
  codigo      text not null references eivi.cie10(codigo) on delete restrict,
  paciente_id bigint not null references eivi.pacientes(id),
  medico_id   bigint not null,
  area_id     bigint not null,
  estado      text not null default 'sospecha' check (estado in ('sospecha','confirmado','descartado')),
  notas       text,
  created_at  timestamptz not null default now()
);
create index if not exists idx_cdiag_consulta on eivi.consulta_diagnosticos(consulta_id);
create index if not exists idx_cdiag_paciente on eivi.consulta_diagnosticos(paciente_id);

-- Lista de problemas del paciente (resumen longitudinal, se mantiene sola)
create table if not exists eivi.paciente_diagnosticos (
  id               bigint generated always as identity primary key,
  paciente_id      bigint not null references eivi.pacientes(id) on delete cascade,
  codigo           text not null references eivi.cie10(codigo) on delete restrict,
  area_id          bigint not null,
  medico_id        bigint,
  estado           text not null default 'sospecha' check (estado in ('sospecha','confirmado','descartado')),
  fecha_inicio     date not null default (now() at time zone 'Europe/Madrid')::date,
  fecha_resolucion date,
  notas            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (paciente_id, codigo)
);

create or replace function eivi.sync_diagnostico_paciente() returns trigger as $$
begin
  insert into eivi.paciente_diagnosticos (paciente_id, codigo, area_id, medico_id, estado, notas)
  values (new.paciente_id, new.codigo, new.area_id, new.medico_id, new.estado, new.notas)
  on conflict (paciente_id, codigo) do update set
    estado = excluded.estado,
    area_id = excluded.area_id,
    medico_id = excluded.medico_id,
    fecha_resolucion = case when excluded.estado = 'descartado'
                            then (now() at time zone 'Europe/Madrid')::date
                            else null end,
    updated_at = now();
  return new;
end $$ language plpgsql;

drop trigger if exists trg_sync_diag on eivi.consulta_diagnosticos;
create trigger trg_sync_diag
  after insert or update of estado on eivi.consulta_diagnosticos
  for each row execute function eivi.sync_diagnostico_paciente();

-- ---------- 5. Alergias (TRANSVERSALES: seguridad clínica) ----------
create table if not exists eivi.alergias_catalogo (
  id          bigint generated always as identity primary key,
  codigo      text unique not null,
  descripcion text not null
);
create table if not exists eivi.paciente_alergias (
  id          bigint generated always as identity primary key,
  paciente_id bigint not null references eivi.pacientes(id) on delete cascade,
  alergia_id  bigint not null references eivi.alergias_catalogo(id) on delete restrict,
  estado      text not null default 'pendiente' check (estado in ('pendiente','confirmada','descartada')),
  notas       text,
  medico_id   bigint,
  created_at  timestamptz not null default now(),
  unique (paciente_id, alergia_id)
);

insert into eivi.alergias_catalogo (codigo, descripcion) values
  ('ANEST_LOC', 'Anestésicos locales (lidocaína, articaína...)'),
  ('LATEX', 'Látex'),
  ('PENICILINA', 'Penicilina y derivados'),
  ('AINES', 'AAS / antiinflamatorios (AINEs)'),
  ('HIALURONIDASA', 'Hialuronidasa'),
  ('CLORHEXIDINA', 'Clorhexidina'),
  ('YODO', 'Povidona yodada / contrastes yodados'),
  ('NIQUEL', 'Níquel (metales)'),
  ('PARABENOS', 'Parabenos / conservantes cosméticos'),
  ('TOXINA', 'Toxina botulínica (reacción previa)'),
  ('OTRA', 'Otra (especificar en notas)')
on conflict (codigo) do nothing;

-- ---------- 6. Constantes clínicas ----------
create table if not exists eivi.constantes_catalogo (
  id     bigint generated always as identity primary key,
  codigo text unique not null,
  nombre text not null,
  unidad text
);
create table if not exists eivi.consulta_constantes (
  id           bigint generated always as identity primary key,
  consulta_id  bigint not null references eivi.consultas(id) on delete cascade,
  constante_id bigint not null references eivi.constantes_catalogo(id) on delete restrict,
  paciente_id  bigint not null references eivi.pacientes(id),
  valor        numeric not null,
  notas        text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_cconst_paciente on eivi.consulta_constantes(paciente_id, constante_id, created_at);

insert into eivi.constantes_catalogo (codigo, nombre, unidad) values
  ('PESO', 'Peso', 'kg'),
  ('ALTURA', 'Altura', 'cm'),
  ('IMC', 'Índice de masa corporal', 'kg/m2'),
  ('TAS', 'Tensión arterial sistólica', 'mmHg'),
  ('TAD', 'Tensión arterial diastólica', 'mmHg'),
  ('FC', 'Frecuencia cardiaca', 'lpm'),
  ('TOXINA_U', 'Toxina botulínica administrada', 'U'),
  ('RELLENO_ML', 'Relleno administrado', 'ml')
on conflict (codigo) do nothing;

-- ---------- 7. Registro de accesos a historia clínica (RGPD) ----------
create table if not exists eivi.accesos_historia (
  id          bigint generated always as identity primary key,
  user_email  text,
  paciente_id bigint not null,
  recurso     text not null,     -- ej: 'historia', 'consulta:12', 'export'
  detalles    jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_accesos_paciente on eivi.accesos_historia(paciente_id, created_at desc);

-- ---------- Permisos ----------
grant all on all tables in schema eivi to service_role;
grant all on all sequences in schema eivi to service_role;
alter table eivi.paciente_medico_area  enable row level security;
alter table eivi.cie10                 enable row level security;
alter table eivi.consultas             enable row level security;
alter table eivi.consultas_versiones   enable row level security;
alter table eivi.consulta_diagnosticos enable row level security;
alter table eivi.paciente_diagnosticos enable row level security;
alter table eivi.alergias_catalogo     enable row level security;
alter table eivi.paciente_alergias     enable row level security;
alter table eivi.constantes_catalogo   enable row level security;
alter table eivi.consulta_constantes   enable row level security;
alter table eivi.accesos_historia      enable row level security;

notify pgrst, 'reload schema';
