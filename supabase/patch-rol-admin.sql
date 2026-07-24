-- Añade el rol 'admin' (técnico/superusuario) a los roles del panel.
-- Ejecutar en el proyecto de la clínica.
alter table eivi.usuarios_panel drop constraint if exists usuarios_panel_rol_check;
alter table eivi.usuarios_panel add constraint usuarios_panel_rol_check
  check (rol in ('admin','direccion','recepcion','medico'));

-- Tu usuario admin (pega tu UUID de Authentication → Users):
-- insert into eivi.usuarios_panel (user_id, email, nombre, rol)
-- values ('TU-UUID', 'serincosol@gmail.com', 'Manel (admin)', 'admin');
