-- ============================================================
-- Patch nº 11 — Verificación de identidad en solicitudes ARCO
-- Antes de entregar datos (acceso/portabilidad) hay que acreditar
-- la identidad del solicitante (art. 12.6 RGPD).
-- ============================================================

alter table eivi.derechos_arco add column if not exists identidad_verificada boolean not null default false;
alter table eivi.derechos_arco add column if not exists identidad_verificada_por text;
alter table eivi.derechos_arco add column if not exists identidad_verificada_at timestamptz;
alter table eivi.derechos_arco add column if not exists identidad_metodo text;

notify pgrst, 'reload schema';
