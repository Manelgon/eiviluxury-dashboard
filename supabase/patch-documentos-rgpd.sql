-- ============================================================
-- Patch nº 12 — Documentos normativos RGPD editables
-- RAT (art. 30), runbook de brechas (art. 33), checklist DPIA,
-- subencargados y política de IA. Pre-rellenados para EiviLuxury:
-- REVISAR con el asesor de protección de datos antes de firmar.
-- ============================================================

create table if not exists eivi.rgpd_documentos (
  id             text primary key,
  titulo         text not null,
  descripcion    text,
  contenido      jsonb not null default '{}'::jsonb,
  actualizado_por text,
  actualizado_at timestamptz,
  created_at     timestamptz not null default now()
);
grant all on eivi.rgpd_documentos to service_role;
alter table eivi.rgpd_documentos enable row level security;

insert into eivi.rgpd_documentos (id, titulo, descripcion, contenido) values

('rat', 'Registro de Actividades de Tratamiento (RAT)', 'Art. 30 RGPD. Documento imprimible y firmable.', '{
  "responsable": "Clinica EiviLuxury — [RAZON SOCIAL Y NIF]",
  "domicilio": "Carrer Canaries 41, bajo. 07800 Eivissa, Illes Balears",
  "contacto": "971 312 902 · [email del responsable]",
  "actividades": [
    {"nombre": "Gestion de pacientes y citas", "finalidad": "Alta de pacientes, agenda de citas y su gestion via WhatsApp (asistente Alexia) y panel interno", "base_legal": "Ejecucion de contrato (art. 6.1.b) y consentimiento explicito (art. 9.2.a) para datos de salud", "categorias_datos": "Identificativos (nombre, telefono, email), datos de citas y tratamientos solicitados", "interesados": "Pacientes y solicitantes de informacion", "destinatarios": "No se ceden a terceros; encargados de tratamiento segun lista de subencargados", "transferencias": "EEUU bajo Data Privacy Framework / SCCs (ver subencargados)", "plazo": "Vida de la relacion + bloqueo; documentacion clinica minimo 5 anios (Ley 41/2002)", "medidas": "Cifrado en transito y reposo, control de acceso por roles, auditoria de acciones, cierre de sesion por inactividad"},
    {"nombre": "Recordatorios de cita", "finalidad": "Envio de recordatorios y comunicaciones operativas por WhatsApp", "base_legal": "Ejecucion de contrato (art. 6.1.b)", "categorias_datos": "Telefono, datos de la cita", "interesados": "Pacientes con cita", "destinatarios": "Encargados (mensajeria)", "transferencias": "Ver subencargados", "plazo": "Hasta fin de la relacion", "medidas": "Las generales del sistema"},
    {"nombre": "Comunicaciones comerciales", "finalidad": "Envio de novedades y promociones de la clinica", "base_legal": "Consentimiento (art. 6.1.a), revocable en cualquier momento", "categorias_datos": "Nombre y telefono", "interesados": "Pacientes que han consentido expresamente", "destinatarios": "Ninguno", "transferencias": "Ver subencargados", "plazo": "Hasta revocacion del consentimiento", "medidas": "Registro de consentimiento con fecha, texto y canal; exclusion inmediata al revocar"},
    {"nombre": "Ejercicio de derechos RGPD", "finalidad": "Gestion de solicitudes de derechos de los interesados", "base_legal": "Obligacion legal (art. 6.1.c)", "categorias_datos": "Identificativos y contenido de la solicitud", "interesados": "Solicitantes", "destinatarios": "Ninguno", "transferencias": "No", "plazo": "El necesario para acreditar el cumplimiento", "medidas": "Verificacion de identidad previa a la entrega de datos; auditoria"}
  ]
}'::jsonb),

('runbook', 'Protocolo de brechas de seguridad', 'Art. 33-34 RGPD: que hacer en las primeras 72 horas.', '{
  "contacto_responsable": "[Nombre y telefono del responsable interno] · Soporte tecnico: Manel Mendez (automatizatelo.com)",
  "enlace_aepd": "https://sedeagpd.gob.es",
  "pasos": [
    "1. CONTENER: identificar el sistema afectado (panel, bot, Supabase, servidor) y cortar el acceso — cambiar claves comprometidas, desactivar usuarios afectados, pausar el bot si procede",
    "2. REGISTRAR: anotar fecha y hora del descubrimiento, que datos y cuantos pacientes pueden estar afectados, y capturas de evidencias (los Logs del panel son la fuente principal)",
    "3. EVALUAR: si hay riesgo para los derechos de los pacientes (datos de salud = riesgo alto casi siempre)",
    "4. NOTIFICAR A LA AEPD en un maximo de 72 HORAS desde el descubrimiento si hay riesgo (sede electronica AEPD)",
    "5. COMUNICAR A LOS PACIENTES afectados sin dilacion si el riesgo es alto (art. 34)",
    "6. REMEDIAR: parchear la causa, rotar todas las claves, documentar lo aprendido en este runbook"
  ]
}'::jsonb),

('dpia', 'Evaluacion de Impacto (EIPD/DPIA)', 'Checklist orientativo AEPD. La valoracion final corresponde al asesor de proteccion de datos.', '{
  "conclusion": "requerida (pendiente de validacion por el asesor)",
  "notas": "El tratamiento incluye datos de salud (categoria especial) a escala de negocio con perfilado nulo. Criterio AEPD: dos o mas marcadores suelen exigir EIPD.",
  "criterios": [
    {"criterio": "Datos de categoria especial (salud)", "aplica": "SI"},
    {"criterio": "Tratamiento a gran escala", "aplica": "A VALORAR (volumen de pacientes de la clinica)"},
    {"criterio": "Interesados vulnerables", "aplica": "POSIBLE (pacientes)"},
    {"criterio": "Uso de nuevas tecnologias (IA conversacional)", "aplica": "SI"},
    {"criterio": "Evaluacion o scoring / decisiones automatizadas con efectos", "aplica": "NO (la IA solo agenda e informa; no decide tratamientos)"},
    {"criterio": "Observacion sistematica o geolocalizacion", "aplica": "NO"}
  ]
}'::jsonb),

('subencargados', 'Subencargados de tratamiento', 'Proveedores que tratan datos por cuenta de la clinica. Verificar DPA de cada uno.', '{
  "proveedores": [
    {"nombre": "Supabase Inc.", "servicio": "Base de datos y autenticacion", "ubicacion": "UE (proyecto en region europea) / EEUU", "dpa": "DPA disponible en supabase.com/legal — PENDIENTE verificar y archivar"},
    {"nombre": "Vercel Inc.", "servicio": "Alojamiento del panel de gestion", "ubicacion": "EEUU (DPF/SCCs)", "dpa": "DPA disponible en vercel.com/legal — PENDIENTE verificar"},
    {"nombre": "OpenAI LLC", "servicio": "Motor de IA del asistente Alexia (procesa el contenido de las conversaciones)", "ubicacion": "EEUU (DPF/SCCs)", "dpa": "DPA para API en openai.com/policies — PENDIENTE firmar; la API no usa los datos para entrenar por defecto"},
    {"nombre": "Servidor propio (VPS AutomatizateloServ)", "servicio": "Evolution API (pasarela WhatsApp) y bot", "ubicacion": "[UBICACION DEL VPS — indicar proveedor y pais]", "dpa": "Contrato encargado automatizatelo.com — PENDIENTE formalizar"},
    {"nombre": "WhatsApp / Meta", "servicio": "Canal de mensajeria (via conexion no oficial Evolution API)", "ubicacion": "EEUU/Irlanda", "dpa": "PUNTO CRITICO: la conexion no oficial carece de acuerdo de encargo. Plan: migrar a WhatsApp Business API oficial antes de tratar datos clinicos por este canal"},
    {"nombre": "GitHub (Microsoft)", "servicio": "Repositorios de codigo (sin datos personales)", "ubicacion": "EEUU", "dpa": "No trata datos de pacientes"}
  ]
}'::jsonb),

('politica_ia', 'Politica de uso de IA', 'Reglas de uso de sistemas de IA con datos de pacientes.', '{
  "notas": "El asistente Alexia usa la API de OpenAI. Los datos enviados son los minimos necesarios para la conversacion. Prohibido introducir datos de pacientes en herramientas de IA no listadas.",
  "herramientas": [
    {"nombre": "OpenAI API (gpt-4o-mini) via Alexia", "uso_permitido": "Conversaciones de agenda e informacion con pacientes; registro de solicitudes", "datos_prohibidos": "Diagnosticos, historia clinica, datos financieros completos"},
    {"nombre": "ChatGPT / otras IA de consumo", "uso_permitido": "Textos genericos SIN datos personales", "datos_prohibidos": "Cualquier dato identificativo o de salud de pacientes"}
  ]
}'::jsonb)

on conflict (id) do nothing;

notify pgrst, 'reload schema';
