import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auditar } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * Cron diario de retención RGPD (Vercel Cron, ver vercel.json).
 * Protegido con CRON_SECRET. Plazos configurables por variables de entorno:
 *  - RETENCION_CHAT_MESES     (def. 24): conversaciones de WhatsApp
 *  - RETENCION_LOGS_MESES     (def. 24): logs de auditoría
 *  - RETENCION_PAPELERA_DIAS  (def. 30): pacientes en papelera → anonimización
 *  - RETENCION_ASISTENCIA_ANIOS (def. 5): SALVAGUARDA SANITARIA — un paciente
 *    con asistencia (cita completada) dentro de este plazo NO se anonimiza
 *    (Ley 41/2002 art. 17: conservación mínima de la documentación clínica;
 *    RGPD art. 17.3: la supresión cede ante la obligación legal). Queda en
 *    papelera = bloqueado (fuera de listados y del bot) hasta vencer el plazo.
 * NOTA: las citas y consentimientos NO se purgan (obligaciones sanitarias/fiscales).
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const meses = (n: number) => {
    const d = new Date();
    d.setDate(1); // evita desbordes de fin de mes
    d.setMonth(d.getMonth() - n);
    return d.toISOString();
  };
  const dias = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();

  const chatMeses = parseInt(process.env.RETENCION_CHAT_MESES ?? "24", 10);
  const logsMeses = parseInt(process.env.RETENCION_LOGS_MESES ?? "24", 10);
  const papeleraDias = parseInt(process.env.RETENCION_PAPELERA_DIAS ?? "30", 10);

  const resultado = { chat_purgado: 0, logs_purgados: 0, pacientes_anonimizados: 0, errores: [] as string[] };

  // 1. Conversaciones antiguas
  try {
    const { data, error } = await db()
      .from("historial_chat").delete().lt("created_at", meses(chatMeses)).select("id");
    if (error) throw error;
    resultado.chat_purgado = data?.length ?? 0;
  } catch (e: any) { resultado.errores.push(`chat: ${e.message}`); }

  // 2. Logs de auditoría antiguos
  try {
    const { data, error } = await db()
      .from("audit_logs").delete().lt("created_at", meses(logsMeses)).select("id");
    if (error) throw error;
    resultado.logs_purgados = data?.length ?? 0;
  } catch (e: any) { resultado.errores.push(`logs: ${e.message}`); }

  // 3. Pacientes en papelera hace más de N días → anonimizar (irreversible)
  //    SALVO que tengan asistencia dentro del plazo legal de conservación.
  const asistenciaAnios = parseInt(process.env.RETENCION_ASISTENCIA_ANIOS ?? "5", 10);
  try {
    const { data: aAnonimizar, error: e1 } = await db()
      .from("pacientes")
      .select("id")
      .not("deleted_at", "is", null)
      .lt("deleted_at", dias(papeleraDias))
      .not("telefono", "like", "anon-%");
    if (e1) throw e1;
    for (const c of aAnonimizar ?? []) {
      // Salvaguarda sanitaria: ¿tuvo asistencia dentro del plazo?
      const { data: ultima } = await db()
        .from("citas")
        .select("inicio")
        .eq("paciente_id", c.id)
        .eq("estado", "completada")
        .order("inicio", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (ultima && new Date(ultima.inicio).getTime() > Date.now() - asistenciaAnios * 365.25 * 86400_000) {
        void auditar(null, "rgpd.anonimizacion_pospuesta", { tipo: "paciente", id: c.id },
          { motivo: `asistencia dentro del plazo de conservación (${asistenciaAnios} años) — paciente bloqueado en papelera` });
        continue;
      }
      const { error: e2 } = await db().from("pacientes").update({
        nombre: "[anonimizado]", apellidos: null, email: null,
        telefono_contacto: null, telefono: `anon-${c.id}`, activo: false,
      }).eq("id", c.id);
      if (e2) { resultado.errores.push(`paciente ${c.id}: ${e2.message}`); continue; }
      resultado.pacientes_anonimizados++;
      void auditar(null, "rgpd.anonimizacion_automatica", { tipo: "paciente", id: c.id }, { motivo: `papelera > ${papeleraDias} días` });
    }
  } catch (e: any) { resultado.errores.push(`anonimizacion: ${e.message}`); }

  void auditar(null, "rgpd.cron_retencion", { tipo: "sistema" }, resultado as any);
  return NextResponse.json({ ok: true, ...resultado });
}
