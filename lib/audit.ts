import { db } from "./db";
import type { UsuarioPanel } from "./auth";

/**
 * Registro de auditoría "never-fail": si el log falla, la operación
 * principal NO se bloquea (solo console.error).
 *
 * ⚠️ REGLA DEL PROYECTO (no negociable): TODA acción nueva que se añada
 * al panel o a la API (crear/editar/eliminar/cambiar estado de cualquier
 * cosa, logins, exports, envíos...) DEBE llamar a auditar() con una
 * acción con nombre en formato "recurso.verbo" (ej: "cita.crear").
 * El proyecto no está finalizado: si añades una acción sin log, la
 * auditoría RGPD queda incompleta.
 */
export async function auditar(
  actor: UsuarioPanel | null,
  accion: string,
  recurso?: { tipo?: string; id?: string | number; label?: string },
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    await db().from("audit_logs").insert({
      actor_id: actor?.user_id ?? null,
      actor_email: actor?.email ?? null,
      accion,
      recurso_tipo: recurso?.tipo ?? null,
      recurso_id: recurso?.id !== undefined ? String(recurso.id) : null,
      recurso_label: recurso?.label ?? null,
      metadata: metadata ?? null,
    });
  } catch (e) {
    console.error("auditar() falló:", e);
  }
}
