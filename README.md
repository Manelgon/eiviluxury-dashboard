# 💛 Panel de gestión — Clínica EiviLuxury

Panel web para recepción y dirección: agenda visual por médico, clientes, conversaciones escaladas por Alexia, configuración del bot (tratamientos/precios, FAQ, horarios, bloqueos) y métricas. Login con roles (dirección / recepción / médico) vía Supabase Auth.

Trabaja sobre el **mismo Supabase del bot** (esquema `eivi`): lo que cambias aquí, Alexia lo usa al momento.

## Despliegue en Vercel (fase actual)

1. **SQL**: en Supabase (proyecto clínica) → SQL Editor → ejecuta `supabase/panel.sql`.
2. **Crear usuarios**: Supabase → Authentication → Users → **Add user** (email + contraseña). Copia el UUID del usuario y ejecútale su fila de rol (instrucciones dentro de `panel.sql`).
3. **GitHub**: sube este proyecto a un repo nuevo `eiviluxury-panel` (misma rutina git de siempre; el `.gitignore` ya excluye lo que no debe subirse).
4. **Vercel**: [vercel.com](https://vercel.com) → Add New → Project → importa el repo `eiviluxury-panel` → antes de Deploy, añade en **Environment Variables**:

| Variable | Valor |
|---|---|
| `SUPABASE_URL` | `https://TU-PROYECTO.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | la service_role del proyecto clínica |
| `SUPABASE_ANON_KEY` | la anon/publishable del mismo proyecto (Settings → API) |

5. **Deploy** → te da una URL `https://eiviluxury-panel.vercel.app` con HTTPS. Puedes conectar un dominio propio (ej. `panel.eiviluxury.com`) en Settings → Domains.

> Las claves viven solo en el servidor de Vercel (las rutas API); el navegador nunca las ve.

## Roles

- **direccion**: todo (agenda, clientes, configuración, métricas)
- **recepcion**: gestión diaria completa
- **medico**: solo su agenda del día (vincula `medico_id` en `usuarios_panel`)

## Fase Docker (más adelante)

El `Dockerfile` ya está preparado (build standalone). Cuando toque: mismo flujo GitHub→GHCR→Portainer que los bots, con las 3 variables de entorno y labels de Traefik para el subdominio.

## Fase 2 — Gestor de pacientes e historia clínica

La base de SANIAN (consultas versionadas, diagnósticos CIE-10, alergias, constantes, documentos con registro de accesos y auditoría) se adoptará mapeando `eivi.clientes → patients` y `eivi.medicos → practitioners`. Requisitos previos: revisión RGPD sanitaria y roles por médico ya operativos (este panel ya los trae).
