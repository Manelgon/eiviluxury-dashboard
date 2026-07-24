-- ============================================================
-- Rol ENFERMERA + personal de enfermería en la agenda
-- Ejecutar en el proyecto de la clínica.
-- ============================================================

-- 1. El personal de agenda (tabla medicos) ahora distingue tipo
alter table eivi.medicos add column if not exists tipo text not null default 'medico';
alter table eivi.medicos drop constraint if exists medicos_tipo_check;
alter table eivi.medicos add constraint medicos_tipo_check check (tipo in ('medico','enfermera'));

-- 2. Rol de panel 'enfermera'
alter table eivi.usuarios_panel drop constraint if exists usuarios_panel_rol_check;
alter table eivi.usuarios_panel add constraint usuarios_panel_rol_check
  check (rol in ('admin','direccion','recepcion','enfermera','medico'));

-- 3. Da de alta a la enfermera como columna de agenda (ajusta el nombre):
-- insert into eivi.medicos (nombre, especialidad, tipo) values ('Enfermería', 'Enfermería', 'enfermera');
--    y su horario en eivi.horarios como cualquier médico.
-- 4. Si además tendrá acceso al panel: crea su usuario en Authentication y:
-- insert into eivi.usuarios_panel (user_id, email, nombre, rol, medico_id)
-- values ('UUID', 'enfermeria@eiviluxury.com', 'Nombre', 'enfermera', ID_DE_SU_FILA_EN_MEDICOS);
