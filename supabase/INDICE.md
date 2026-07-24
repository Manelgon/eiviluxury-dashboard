# Índice de SQL — Panel EiviLuxury (misma BBDD `eivi` que el bot)
Proyecto Supabase: `zohkencmpagiwxyljsiq` · Requiere haber aplicado antes los SQL del repo `eiviluxury-bot` (su INDICE.md). Orden:

| # | Archivo | Qué hace | ¿Aplicado? |
|---|---------|----------|------------|
| 5 | `panel.sql` | Tabla `usuarios_panel` (login del panel con roles) + instrucciones de alta de usuarios | ✅ |
| 6 | `patch-rol-admin.sql` | Añade el rol `admin` (técnico) a los roles permitidos | ✅ |
| 7 | `patch-enfermera.sql` | Rol `enfermera` + campo `tipo` en medicos (columnas de enfermería en la agenda) | ✅ |

> Regla: cada cambio de base de datos nuevo = un patch nuevo numerado aquí, nunca editar los ya aplicados. Los SQL van SIEMPRE a git (no llevan secretos); al .gitignore solo van .env y claves.
