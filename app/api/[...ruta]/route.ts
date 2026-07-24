import { NextRequest, NextResponse } from "next/server";
import { db, authClient } from "@/lib/db";
import { usuarioDesdeRequest, puede, UsuarioPanel } from "@/lib/auth";
import { madridAUtc, sumarMin, diaSemana, hoyMadrid, sumarDias } from "@/lib/tiempo";

export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
const err = (mensaje: string, status = 400) => json({ error: mensaje }, status);

async function handler(req: NextRequest, ruta: string[]): Promise<NextResponse> {
  const [r0, r1] = ruta;
  const metodo = req.method;
  const body = metodo === "GET" || metodo === "DELETE" ? {} : await req.json().catch(() => ({}));
  const q = req.nextUrl.searchParams;

  // ---------- LOGIN (sin token) ----------
  if (r0 === "login" && metodo === "POST") {
    const { email, password } = body;
    if (!email || !password) return err("Faltan email o contraseña");
    const { data, error } = await authClient().auth.signInWithPassword({ email, password });
    if (error || !data.session) return err("Credenciales incorrectas", 401);
    const { data: fila } = await db()
      .from("usuarios_panel")
      .select("nombre, rol")
      .eq("user_id", data.user.id)
      .eq("activo", true)
      .maybeSingle();
    if (!fila) return err("Tu usuario no tiene acceso al panel", 403);
    return json({ token: data.session.access_token, nombre: fila.nombre, rol: fila.rol });
  }

  // ---------- Autenticación ----------
  const u = await usuarioDesdeRequest(req);
  if (!u) return err("No autorizado", 401);

  switch (r0) {
    case "me":
      return json(u);

    // ---------- Agenda ----------
    case "medicos": {
      const { data, error } = await db()
        .from("medicos")
        .select("id, nombre, especialidad, activo")
        .order("nombre");
      if (error) return err(error.message, 500);
      return json(data);
    }

    case "agenda": {
      let medQ = db().from("medicos").select("id, nombre, especialidad, tipo").eq("activo", true).order("nombre");
      // El médico ve su columna + las de enfermería; enfermera y demás roles ven todo
      if (u.rol === "medico" && u.medico_id) medQ = medQ.or(`id.eq.${u.medico_id},tipo.eq.enfermera`);
      const { data: medicos, error: e1 } = await medQ;
      if (e1) return err(e1.message, 500);

      // Modo rango (vistas semana/mes): ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
      const desde = q.get("desde"), hasta = q.get("hasta");
      if (desde && hasta) {
        const dias = (new Date(hasta).getTime() - new Date(desde).getTime()) / 86400000;
        if (dias < 0 || dias > 45) return err("Rango no válido (máx. 45 días)");
        const { data: citas, error: e2 } = await db()
          .from("citas")
          .select("id, medico_id, inicio, estado")
          .gte("inicio", madridAUtc(desde, "00:00").toISOString())
          .lte("inicio", madridAUtc(hasta, "23:59").toISOString())
          .neq("estado", "cancelada")
          .in("medico_id", (medicos ?? []).map((m: any) => m.id))
          .order("inicio");
        if (e2) return err(e2.message, 500);
        return json({ medicos, citas: citas ?? [] });
      }

      const fecha = q.get("fecha") ?? hoyMadrid();
      const ini = madridAUtc(fecha, "00:00").toISOString();
      const fin = madridAUtc(fecha, "23:59").toISOString();

      const { data: citas, error: e2 } = await db()
        .from("citas")
        .select("id, medico_id, inicio, fin, estado, confirmada_cliente, notas, clientes(id, nombre, apellidos, telefono), tratamientos(nombre)")
        .gte("inicio", ini)
        .lte("inicio", fin)
        .neq("estado", "cancelada")
        .in("medico_id", (medicos ?? []).map((m: any) => m.id))
        .order("inicio");
      if (e2) return err(e2.message, 500);

      const dow = diaSemana(fecha);
      const { data: horarios } = await db()
        .from("horarios")
        .select("medico_id, hora_inicio, hora_fin")
        .eq("dia_semana", dow);

      return json({
        fecha,
        medicos: (medicos ?? []).map((m: any) => ({
          ...m,
          horario: (horarios ?? []).filter((h: any) => h.medico_id === m.id),
          citas: (citas ?? []).filter((c: any) => c.medico_id === m.id),
        })),
      });
    }

    case "citas": {
      if (metodo === "POST") {
        if (!puede(u, "gestion")) return err("Sin permiso", 403);
        const { cliente_id, medico_id, tratamiento_id, fecha, hora, duracion_min, notas } = body;
        if (!cliente_id || !medico_id || !fecha || !hora) return err("Faltan datos de la cita");
        const inicio = madridAUtc(fecha, hora);
        const fin = sumarMin(inicio, Number(duracion_min ?? 30));
        const { data, error } = await db()
          .from("citas")
          .insert({
            cliente_id, medico_id,
            tratamiento_id: tratamiento_id ?? null,
            inicio: inicio.toISOString(), fin: fin.toISOString(),
            estado: "confirmada", notas: notas ?? null, creada_via: "panel",
          })
          .select("id")
          .single();
        if (error) return error.code === "23P01" ? err("Ese hueco se solapa con otra cita del médico") : err(error.message, 500);
        return json({ ok: true, id: data.id });
      }
      if (metodo === "PATCH" && r1) {
        if (!puede(u, "gestion")) return err("Sin permiso", 403);
        const { estado } = body;
        if (!["pendiente", "confirmada", "cancelada", "completada", "no_show"].includes(estado)) return err("Estado no válido");
        const { error } = await db().from("citas").update({ estado }).eq("id", Number(r1));
        if (error) return err(error.message, 500);
        return json({ ok: true });
      }
      return err("Método no soportado", 405);
    }

    // ---------- Clientes ----------
    case "clientes": {
      if (metodo === "GET" && !r1) {
        const busca = q.get("q")?.trim();
        let cq = db()
          .from("clientes")
          .select("id, telefono, telefono_contacto, nombre, apellidos, email, consentimiento_rgpd, activo, created_at")
          .order("created_at", { ascending: false })
          .limit(100);
        if (busca) cq = cq.or(`nombre.ilike.%${busca}%,apellidos.ilike.%${busca}%,telefono.ilike.%${busca}%`);
        const { data, error } = await cq;
        if (error) return err(error.message, 500);
        return json(data);
      }
      if (metodo === "GET" && r1) {
        const { data: cliente, error } = await db()
          .from("clientes")
          .select("*")
          .eq("id", Number(r1))
          .maybeSingle();
        if (error || !cliente) return err("Cliente no encontrado", 404);
        const { data: citas } = await db()
          .from("citas")
          .select("id, inicio, estado, confirmada_cliente, medicos(nombre), tratamientos(nombre)")
          .eq("cliente_id", cliente.id)
          .order("inicio", { ascending: false })
          .limit(50);
        return json({ ...cliente, citas: citas ?? [] });
      }
      if (metodo === "PATCH" && r1) {
        if (!puede(u, "gestion")) return err("Sin permiso", 403);
        const permitidos = ["nombre", "apellidos", "email", "telefono_contacto", "idioma", "activo"];
        const cambios: Record<string, unknown> = {};
        for (const k of permitidos) if (k in body) cambios[k] = body[k];
        const { error } = await db().from("clientes").update(cambios).eq("id", Number(r1));
        if (error) return err(error.message, 500);
        return json({ ok: true });
      }
      return err("Método no soportado", 405);
    }

    // ---------- Escalados ----------
    case "escalados": {
      if (metodo === "GET") {
        const { data, error } = await db()
          .from("escalados")
          .select("id, telefono, motivo, resuelto, created_at")
          .order("created_at", { ascending: false })
          .limit(100);
        if (error) return err(error.message, 500);
        return json(data);
      }
      if (metodo === "PATCH" && r1) {
        if (!puede(u, "gestion")) return err("Sin permiso", 403);
        const { error } = await db().from("escalados").update({ resuelto: body.resuelto === true }).eq("id", Number(r1));
        if (error) return err(error.message, 500);
        return json({ ok: true });
      }
      return err("Método no soportado", 405);
    }

    // ---------- Configuración: tratamientos / faq / horarios / bloqueos ----------
    case "tratamientos": {
      if (metodo === "GET") {
        const { data, error } = await db()
          .from("tratamientos")
          .select("id, nombre, descripcion, precio_eur, requiere_valoracion, duracion_min, activo, area_id, areas(nombre)")
          .order("nombre");
        return error ? err(error.message, 500) : json(data);
      }
      if (!puede(u, "config")) return err("Sin permiso", 403);
      if (metodo === "POST") {
        const { error } = await db().from("tratamientos").insert(body);
        return error ? err(error.message, 500) : json({ ok: true });
      }
      if (metodo === "PATCH" && r1) {
        const { error } = await db().from("tratamientos").update(body).eq("id", Number(r1));
        return error ? err(error.message, 500) : json({ ok: true });
      }
      return err("Método no soportado", 405);
    }

    case "areas": {
      const { data, error } = await db().from("areas").select("id, nombre").eq("activo", true).order("nombre");
      return error ? err(error.message, 500) : json(data);
    }

    case "faq": {
      if (metodo === "GET") {
        const { data, error } = await db().from("faq").select("*").order("id");
        return error ? err(error.message, 500) : json(data);
      }
      if (!puede(u, "config")) return err("Sin permiso", 403);
      if (metodo === "POST") {
        const { error } = await db().from("faq").insert(body);
        return error ? err(error.message, 500) : json({ ok: true });
      }
      if (metodo === "PATCH" && r1) {
        const { error } = await db().from("faq").update(body).eq("id", Number(r1));
        return error ? err(error.message, 500) : json({ ok: true });
      }
      return err("Método no soportado", 405);
    }

    case "horarios": {
      if (metodo === "GET") {
        const { data, error } = await db()
          .from("horarios")
          .select("id, medico_id, dia_semana, hora_inicio, hora_fin, medicos(nombre)")
          .order("medico_id")
          .order("dia_semana");
        return error ? err(error.message, 500) : json(data);
      }
      if (!puede(u, "config")) return err("Sin permiso", 403);
      if (metodo === "POST") {
        const { error } = await db().from("horarios").insert(body);
        return error ? err(error.message, 500) : json({ ok: true });
      }
      if (metodo === "DELETE" && r1) {
        const { error } = await db().from("horarios").delete().eq("id", Number(r1));
        return error ? err(error.message, 500) : json({ ok: true });
      }
      return err("Método no soportado", 405);
    }

    case "bloqueos": {
      if (metodo === "GET") {
        const { data, error } = await db()
          .from("bloqueos")
          .select("id, medico_id, inicio, fin, motivo, medicos(nombre)")
          .gte("fin", new Date().toISOString())
          .order("inicio");
        return error ? err(error.message, 500) : json(data);
      }
      if (!puede(u, "config")) return err("Sin permiso", 403);
      if (metodo === "POST") {
        const { medico_id, fecha_inicio, hora_inicio, fecha_fin, hora_fin, motivo } = body;
        if (!medico_id || !fecha_inicio || !fecha_fin) return err("Faltan datos del bloqueo");
        const { error } = await db().from("bloqueos").insert({
          medico_id,
          inicio: madridAUtc(fecha_inicio, hora_inicio ?? "00:00").toISOString(),
          fin: madridAUtc(fecha_fin, hora_fin ?? "23:59").toISOString(),
          motivo: motivo ?? null,
        });
        return error ? err(error.message, 500) : json({ ok: true });
      }
      if (metodo === "DELETE" && r1) {
        const { error } = await db().from("bloqueos").delete().eq("id", Number(r1));
        return error ? err(error.message, 500) : json({ ok: true });
      }
      return err("Método no soportado", 405);
    }

    // ---------- Métricas ----------
    case "metricas": {
      if (!puede(u, "metricas")) return err("Sin permiso", 403);
      const hoy = hoyMadrid();
      const hace8s = sumarDias(hoy, -56);
      const desdeISO = madridAUtc(hace8s, "00:00").toISOString();

      const [{ data: citas }, { count: clientesTotal }, { count: escalPend }, { count: msgs7d }] = await Promise.all([
        db().from("citas").select("inicio, estado").gte("inicio", desdeISO),
        db().from("clientes").select("id", { count: "exact", head: true }),
        db().from("escalados").select("id", { count: "exact", head: true }).eq("resuelto", false),
        db().from("historial_chat").select("id", { count: "exact", head: true })
          .gte("created_at", madridAUtc(sumarDias(hoy, -7), "00:00").toISOString()),
      ]);

      // Agrupar por semana (lunes)
      const semanas: Record<string, { total: number; canceladas: number; no_show: number; completadas: number }> = {};
      for (let i = 0; i < 8; i++) {
        const lunes = lunesDe(sumarDias(hoy, -7 * (7 - i)));
        semanas[lunes] = { total: 0, canceladas: 0, no_show: 0, completadas: 0 };
      }
      for (const c of citas ?? []) {
        const lunes = lunesDe(new Date(c.inicio).toISOString().slice(0, 10));
        if (!semanas[lunes]) continue;
        semanas[lunes].total++;
        if (c.estado === "cancelada") semanas[lunes].canceladas++;
        if (c.estado === "no_show") semanas[lunes].no_show++;
        if (c.estado === "completada") semanas[lunes].completadas++;
      }
      return json({
        clientesTotal: clientesTotal ?? 0,
        escaladosPendientes: escalPend ?? 0,
        mensajes7d: msgs7d ?? 0,
        semanas: Object.entries(semanas).map(([semana, v]) => ({ semana, ...v })),
      });
    }

    default:
      return err("Ruta no encontrada", 404);
  }
}

function lunesDe(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 0 = lunes
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

type Ctx = { params: { ruta: string[] } };
export async function GET(req: NextRequest, ctx: Ctx) { return handler(req, ctx.params.ruta); }
export async function POST(req: NextRequest, ctx: Ctx) { return handler(req, ctx.params.ruta); }
export async function PATCH(req: NextRequest, ctx: Ctx) { return handler(req, ctx.params.ruta); }
export async function DELETE(req: NextRequest, ctx: Ctx) { return handler(req, ctx.params.ruta); }
