# Índice de SQL — Panel EiviLuxury (misma BBDD `eivi` que el bot)
Proyecto Supabase: `zohkencmpagiwxyljsiq` · Requiere haber aplicado antes los SQL del repo `eiviluxury-bot` (su INDICE.md). Orden:

| # | Archivo | Qué hace | ¿Aplicado? |
|---|---------|----------|------------|
| 5 | `panel.sql` | Tabla `usuarios_panel` (login del panel con roles) + instrucciones de alta de usuarios | ✅ |
| 6 | `patch-rol-admin.sql` | Añade el rol `admin` (técnico) a los roles permitidos | ✅ |
| 7 | `patch-enfermera.sql` | Rol `enfermera` + campo `tipo` en medicos (columnas de enfermería en la agenda) | ✅ |
| 8 | `patch-rgpd-fase1.sql` | RGPD fase 1: tabla `audit_logs`, tabla `consentimientos` granulares (personales/clínicos/recordatorios/publicidad), `deleted_at` en clientes | ✅ |
| 9 | `patch-rgpd-fase2.sql` | RGPD fase 2: tabla `derechos_arco` (solicitudes de derechos desde web, WhatsApp y panel) | ✅ |
| 10 | `patch-pacientes.sql` | Renombrado: tabla `clientes`→`pacientes`, columnas `cliente_id`→`paciente_id`, `confirmada_cliente`→`confirmada_paciente`, vista recreada. ⚠️ Requiere desplegar a la vez panel y bot renombrados | ✅ |
| 11 | `patch-verificacion-identidad.sql` | Verificación de identidad en solicitudes ARCO (quién, cuándo, método) — obligatoria para resolver acceso/portabilidad | ✅ |
| 12 | `patch-documentos-rgpd.sql` | Documentos normativos editables (RAT, runbook de brechas, DPIA, subencargados, política IA) pre-rellenados para la clínica | ✅ |
| 13 | `patch-firmados.sql` | Archivo de firmados: bucket privado `rgpd-firmados` en Storage + campos firmado_path/at/por en documentos | ⬜ pendiente |
| 14 | `patch-historia-clinica.sql` | HISTORIA CLÍNICA fundacional: asignación paciente-médico-área (único por área), catálogo CIE-10, consultas con VERSIONADO inmutable (trigger + motivo de edición obligatorio), diagnósticos por consulta + lista de problemas auto-sincronizada, alergias transversales, constantes, registro de accesos. Tras aplicarlo: importar cie10es_2026_clean.csv en la tabla eivi.cie10 (Table Editor → Import) | ⬜ pendiente |

> Nota: los patches 1-9 ya aplicados conservan la nomenclatura antigua ("cliente") en su texto — NO se editan (regla del índice). El nombre actual de las tablas es el que fija el patch 10.

> Regla: cada cambio de base de datos nuevo = un patch nuevo numerado aquí, nunca editar los ya aplicados. Los SQL van SIEMPRE a git (no llevan secretos); al .gitignore solo van .env y claves.
