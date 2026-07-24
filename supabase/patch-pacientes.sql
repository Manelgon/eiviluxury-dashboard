-- ============================================================
-- Patch nº 10 — Renombrado: clientes → PACIENTES (BBDD de prueba)
-- Ejecutar en el proyecto de la clínica.
-- ============================================================

alter table eivi.clientes rename to pacientes;
alter table eivi.citas rename column cliente_id to paciente_id;
alter table eivi.citas rename column confirmada_cliente to confirmada_paciente;
alter table eivi.consentimientos rename column cliente_id to paciente_id;
alter table eivi.derechos_arco rename column cliente_id to paciente_id;

-- Recrear la vista de agenda con los nombres nuevos
-- (drop + create: Postgres no permite renombrar columnas de una vista con "or replace")
drop view if exists eivi.agenda_hoy;
create view eivi.agenda_hoy as
select c.inicio at time zone 'Europe/Madrid' as hora,
       m.nombre as medico,
       p.nombre || coalesce(' ' || p.apellidos, '') as paciente,
       p.telefono, t.nombre as tratamiento, c.estado, c.confirmada_paciente
from eivi.citas c
join eivi.medicos m on m.id = c.medico_id
join eivi.pacientes p on p.id = c.paciente_id
left join eivi.tratamientos t on t.id = c.tratamiento_id
where (c.inicio at time zone 'Europe/Madrid')::date = (now() at time zone 'Europe/Madrid')::date
  and c.estado in ('pendiente','confirmada')
order by c.inicio;

notify pgrst, 'reload schema';
