import { NextRequest, NextResponse } from "next/server";
import { db, authClient } from "@/lib/db";
import { usuarioDesdeRequest, puede, UsuarioPanel } from "@/lib/auth";
import { auditar } from "@/lib/audit";
import { madridAUtc, sumarMin, diaSemana, hoyMadrid, sumarDias } from "@/lib/tiempo";

export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
const err = (mensaje: string, status = 400) => json({ error: mensaje }, status);

/**
 * Ámbito clínico del usuario:
 *  - admin/direccion → acceso total (areas = null)
 *  - medico → SOLO sus áreas y SOLO pacientes con asignación activa suya
 *  - recepcion/enfermera → SIN acceso a datos clínicos
 */
async function ambitoClinico(u: UsuarioPanel): Promise<{ total: boolean; areas: number[]; medicoId: number | null } | null> {
  if (u.rol === "admin" || u.rol === "direccion") return { total: true, areas: [], medicoId: null };
  if (u.rol === "medico" && u.medico_id) {
    const { data } = await db().from("medico_areas").select("area_id").eq("medico_id", u.medico_id);
    return { total: false, areas: (data ?? []).map((a: any) => a.area_id), medicoId: u.medico_id };
  }
  return null;
}

/** ¿Puede este ámbito ver a este paciente? (médico: asignación activa) */
async function puedeVerPaciente(ambito: { total: boolean; medicoId: number | null }, pacienteId: number): Promise<boolean> {
  if (ambito.total) return true;
  const { data } = await db()
    .from("paciente_medico_area").select("id")
    .eq("paciente_id", pacienteId).eq("medico_id", ambito.medicoId).eq("activo", true).limit(1);
  return (data?.length ?? 0) > 0;
}

/** Registro RGPD de lecturas de historia clínica. */
async function logAccesoHistoria(u: UsuarioPanel, pacienteId: number, recurso: string, detalles?: Record<string, unknown>) {
  try {
    await db().from("accesos_historia").insert({ user_email: u.email, paciente_id: pacienteId, recurso, detalles: detalles ?? null });
  } catch (e) { console.error("logAccesoHistoria falló:", e); }
}

async function handler(req: NextRequest, ruta: string[]): Promise<NextResponse> {
  const [r0, r1, r2] = ruta;
  const metodo = req.method;
  const esMultipart = (req.headers.get("content-type") ?? "").includes("multipart/form-data");
  const body = metodo === "GET" || metodo === "DELETE" || esMultipart ? {} : await req.json().catch(() => ({}));
  const q = req.nextUrl.searchParams;

  // ---------- LOGIN (sin token) ----------
  if (r0 === "login" && metodo === "POST") {
    const { email, password } = body;
    if (!email || !password) return err("Faltan email o contraseña");
    const { data, error } = await authClient().auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      void auditar(null, "auth.login_fallido", { tipo: "auth", label: email });
      return err("Credenciales incorrectas", 401);
    }
    const { data: fila } = await db()
      .from("usuarios_panel")
      .select("nombre, rol")
      .eq("user_id", data.user.id)
      .eq("activo", true)
      .maybeSingle();
    if (!fila) return err("Tu usuario no tiene acceso al panel", 403);
    void auditar({ user_id: data.user.id, email, nombre: fila.nombre, rol: fila.rol, medico_id: null } as UsuarioPanel, "auth.login", { tipo: "auth", label: email });
    return json({ token: data.session.access_token, nombre: fila.nombre, rol: fila.rol });
  }

  // ---------- Solicitud pública de derechos RGPD (sin token) ----------
  if (r0 === "derechos-publico" && metodo === "POST") {
    const { nombre, contacto, tipo_derecho, descripcion, acepta } = body;
    if (!contacto || !tipo_derecho) return err("Faltan el contacto o el tipo de derecho");
    if (acepta !== true) return err("Debes aceptar el tratamiento de tu solicitud");
    const validos = ["acceso", "rectificacion", "supresion", "portabilidad", "oposicion", "limitacion"];
    if (!validos.includes(tipo_derecho)) return err("Tipo de derecho no válido");
    const { error } = await db().from("derechos_arco").insert({
      nombre: nombre ?? null, contacto, tipo_derecho, descripcion: descripcion ?? null, canal: "web",
    });
    if (error) return err(error.message, 500);
    void auditar(null, "rgpd.derecho_arco.solicitud", { tipo: "derecho_arco", label: `${tipo_derecho} · ${contacto}` }, { canal: "web" });
    return json({ ok: true });
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
        .select("id, nombre, especialidad, activo, tipo, medico_areas(area_id)")
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
        .select("id, medico_id, inicio, fin, estado, confirmada_paciente, notas, pacientes(id, nombre, apellidos, telefono), tratamientos(nombre)")
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
        const { paciente_id, medico_id, tratamiento_id, fecha, hora, duracion_min, notas } = body;
        if (!paciente_id || !medico_id || !fecha || !hora) return err("Faltan datos de la cita");
        const inicio = madridAUtc(fecha, hora);
        const fin = sumarMin(inicio, Number(duracion_min ?? 30));
        const { data, error } = await db()
          .from("citas")
          .insert({
            paciente_id, medico_id,
            tratamiento_id: tratamiento_id ?? null,
            inicio: inicio.toISOString(), fin: fin.toISOString(),
            estado: "confirmada", notas: notas ?? null, creada_via: "panel",
          })
          .select("id")
          .single();
        if (error) return error.code === "23P01" ? err("Ese hueco se solapa con otra cita del médico") : err(error.message, 500);
        void auditar(u, "cita.crear", { tipo: "cita", id: data.id }, { paciente_id, medico_id, fecha, hora });
        return json({ ok: true, id: data.id });
      }
      if (metodo === "PATCH" && r1) {
        if (!puede(u, "gestion")) return err("Sin permiso", 403);
        const { estado } = body;
        if (!["pendiente", "confirmada", "cancelada", "completada", "no_show"].includes(estado)) return err("Estado no válido");
        const { error } = await db().from("citas").update({ estado }).eq("id", Number(r1));
        if (error) return err(error.message, 500);
        void auditar(u, "cita.cambiar_estado", { tipo: "cita", id: r1 }, { estado });
        return json({ ok: true });
      }
      return err("Método no soportado", 405);
    }

    // ---------- Pacientes ----------
    case "pacientes": {
      if (metodo === "GET" && !r1) {
        const busca = q.get("q")?.trim();
        const papelera = q.get("papelera") === "1";
        let cq = db()
          .from("pacientes")
          .select("id, telefono, telefono_contacto, nombre, apellidos, email, consentimiento_rgpd, activo, created_at, deleted_at")
          .order("created_at", { ascending: false })
          .limit(100);
        cq = papelera ? cq.not("deleted_at", "is", null) : cq.is("deleted_at", null);
        if (busca) cq = cq.or(`nombre.ilike.%${busca}%,apellidos.ilike.%${busca}%,telefono.ilike.%${busca}%`);
        const { data, error } = await cq;
        if (error) return err(error.message, 500);
        return json(data);
      }
      // Exportación completa (derechos de acceso y portabilidad)
      if (metodo === "GET" && r1 && r2 === "exportar") {
        if (!puede(u, "gestion")) return err("Sin permiso", 403);
        const { data: paciente, error: eP } = await db().from("pacientes").select("*").eq("id", Number(r1)).maybeSingle();
        if (eP || !paciente) return err("Paciente no encontrado", 404);
        const [citas, consentimientos, derechos, chat] = await Promise.all([
          db().from("citas")
            .select("inicio, fin, estado, confirmada_paciente, notas, creada_via, medicos(nombre), tratamientos(nombre)")
            .eq("paciente_id", paciente.id).order("inicio"),
          db().from("consentimientos")
            .select("tipo, aceptado, texto, canal, created_at, revocado_at")
            .eq("paciente_id", paciente.id).order("created_at"),
          db().from("derechos_arco")
            .select("tipo_derecho, descripcion, canal, estado, created_at, resolucion_at")
            .or(`paciente_id.eq.${paciente.id},contacto.eq.${paciente.telefono}`)
            .order("created_at"),
          db().from("historial_chat")
            .select("message, created_at")
            .eq("session_id", paciente.telefono).order("created_at").limit(3000),
        ]);
        void auditar(u, "paciente.exportar", { tipo: "paciente", id: r1, label: paciente.telefono });
        return json({
          generado: new Date().toISOString(),
          paciente,
          citas: citas.data ?? [],
          consentimientos: consentimientos.data ?? [],
          solicitudes_derechos: derechos.data ?? [],
          conversaciones: chat.data ?? [],
        });
      }
      if (metodo === "GET" && r1) {
        const { data: paciente, error } = await db()
          .from("pacientes")
          .select("*")
          .eq("id", Number(r1))
          .maybeSingle();
        if (error || !paciente) return err("Paciente no encontrado", 404);
        const { data: citas } = await db()
          .from("citas")
          .select("id, inicio, estado, confirmada_paciente, medicos(nombre), tratamientos(nombre)")
          .eq("paciente_id", paciente.id)
          .order("inicio", { ascending: false })
          .limit(50);
        return json({ ...paciente, citas: citas ?? [] });
      }
      if (metodo === "PATCH" && r1) {
        if (!puede(u, "gestion")) return err("Sin permiso", 403);
        // Estado actual del paciente (para la escalera desactivar → eliminar → anonimizar)
        const { data: actual } = await db()
          .from("pacientes").select("activo, deleted_at").eq("id", Number(r1)).maybeSingle();
        if (!actual) return err("Paciente no encontrado", 404);
        // Borrado suave y restauración
        if (body.eliminar === true) {
          if (actual.activo) return err("Escalera de baja: primero hay que DESACTIVAR al paciente; solo entonces se puede enviar a la papelera.");
          const { error } = await db().from("pacientes").update({ deleted_at: new Date().toISOString() }).eq("id", Number(r1));
          if (error) return err(error.message, 500);
          void auditar(u, "paciente.eliminar", { tipo: "paciente", id: r1 }, { papelera_desde: new Date().toISOString() });
          return json({ ok: true });
        }
        // Anonimización irreversible (derecho de supresión con obligación de conservar lo operativo)
        if (body.anonimizar === true) {
          if (!puede(u, "usuarios")) return err("Solo admin o dirección pueden anonimizar", 403);
          if (!actual.deleted_at) return err("Escalera de baja: solo se puede anonimizar a un paciente que esté en la papelera.");
          // Salvaguarda sanitaria (Ley 41/2002 art. 17): con asistencia reciente, no anonimizar
          const anios = parseInt(process.env.RETENCION_ASISTENCIA_ANIOS ?? "5", 10);
          const { data: ultima } = await db()
            .from("citas").select("inicio").eq("paciente_id", Number(r1)).eq("estado", "completada")
            .order("inicio", { ascending: false }).limit(1).maybeSingle();
          if (ultima && new Date(ultima.inicio).getTime() > Date.now() - anios * 365.25 * 86400_000 && body.forzar !== true) {
            return err(
              `Este paciente tiene asistencia dentro del plazo legal de conservación (${anios} años, Ley 41/2002). Debe permanecer bloqueado en la papelera hasta que venza. Solo fuérzalo con el aval de vuestro asesor de protección de datos.`,
              409
            );
          }
          const { error } = await db().from("pacientes").update({
            nombre: "[anonimizado]", apellidos: null, email: null,
            telefono_contacto: null, telefono: `anon-${r1}`,
            activo: false, deleted_at: new Date().toISOString(),
          }).eq("id", Number(r1));
          if (error) return err(error.message, 500);
          void auditar(u, "paciente.anonimizar", { tipo: "paciente", id: r1 },
            { forzado: body.forzar === true, en_papelera_desde: actual.deleted_at });
          return json({ ok: true });
        }
        if (body.restaurar === true) {
          const { error } = await db().from("pacientes").update({ deleted_at: null }).eq("id", Number(r1));
          if (error) return err(error.message, 500);
          void auditar(u, "paciente.restaurar", { tipo: "paciente", id: r1 }, { estaba_en_papelera_desde: actual.deleted_at });
          return json({ ok: true });
        }
        const permitidos = ["nombre", "apellidos", "email", "telefono_contacto", "idioma", "activo"];
        const cambios: Record<string, unknown> = {};
        for (const k of permitidos) if (k in body) cambios[k] = body[k];
        const { error } = await db().from("pacientes").update(cambios).eq("id", Number(r1));
        if (error) return err(error.message, 500);
        // Log con VALORES (no solo nombres de campo). Activo tiene acción propia.
        if ("activo" in cambios && Object.keys(cambios).length === 1) {
          void auditar(u, cambios.activo ? "paciente.reactivar" : "paciente.desactivar",
            { tipo: "paciente", id: r1 }, { activo: cambios.activo });
        } else {
          void auditar(u, "paciente.editar", { tipo: "paciente", id: r1 }, { cambios });
        }
        return json({ ok: true });
      }
      return err("Método no soportado", 405);
    }

    // ---------- Consentimientos (huella RGPD por finalidad) ----------
    case "consentimientos": {
      if (metodo === "GET") {
        const pacienteId = q.get("paciente_id");
        if (!pacienteId) return err("Falta paciente_id");
        const { data, error } = await db()
          .from("consentimientos")
          .select("id, tipo, aceptado, texto, canal, created_at, revocado_at")
          .eq("paciente_id", Number(pacienteId))
          .order("created_at", { ascending: false });
        return error ? err(error.message, 500) : json(data);
      }
      if (!puede(u, "gestion")) return err("Sin permiso", 403);
      if (metodo === "POST") {
        const { paciente_id, tipo, aceptado, texto } = body;
        if (!paciente_id || !tipo || typeof aceptado !== "boolean") return err("Faltan paciente_id, tipo o aceptado");
        const { error } = await db().from("consentimientos").insert({
          paciente_id, tipo, aceptado, texto: texto ?? null, canal: "panel",
        });
        if (error) return err(error.message, 500);
        void auditar(u, "consentimiento.registrar", { tipo: "paciente", id: paciente_id }, { tipo_consentimiento: tipo, aceptado });
        return json({ ok: true });
      }
      if (metodo === "PATCH" && r1) {
        const { error } = await db().from("consentimientos").update({ revocado_at: new Date().toISOString() }).eq("id", Number(r1));
        if (error) return err(error.message, 500);
        void auditar(u, "consentimiento.revocar", { tipo: "consentimiento", id: r1 }, { revocado_at: new Date().toISOString() });
        return json({ ok: true });
      }
      return err("Método no soportado", 405);
    }

    // ---------- Derechos ARCO (gestión) ----------
    case "derechos": {
      if (!puede(u, "gestion")) return err("Sin permiso", 403);
      if (metodo === "GET") {
        const { data, error } = await db()
          .from("derechos_arco")
          .select("id, paciente_id, nombre, contacto, tipo_derecho, descripcion, canal, estado, notas_admin, resolucion_at, created_at, identidad_verificada, identidad_verificada_por, identidad_verificada_at, identidad_metodo")
          .order("created_at", { ascending: false })
          .limit(200);
        return error ? err(error.message, 500) : json(data);
      }
      if (metodo === "PATCH" && r1) {
        const { data: fila } = await db()
          .from("derechos_arco")
          .select("tipo_derecho, identidad_verificada")
          .eq("id", Number(r1)).maybeSingle();
        if (!fila) return err("Solicitud no encontrada", 404);

        const cambios: Record<string, unknown> = {};
        // Verificación de identidad (art. 12.6 RGPD)
        if (body.verificar_identidad === true) {
          cambios.identidad_verificada = true;
          cambios.identidad_verificada_por = u.email;
          cambios.identidad_verificada_at = new Date().toISOString();
          cambios.identidad_metodo = body.metodo ?? null;
        }
        if (body.estado && ["pendiente", "en_proceso", "resuelta"].includes(body.estado)) {
          // Acceso y portabilidad implican ENTREGAR datos: exigen identidad verificada
          const exigeIdentidad = ["acceso", "portabilidad"].includes(fila.tipo_derecho);
          const verificada = fila.identidad_verificada || cambios.identidad_verificada === true;
          if (body.estado === "resuelta" && exigeIdentidad && !verificada) {
            return err(
              "No se puede resolver una solicitud de acceso/portabilidad sin verificar antes la identidad del solicitante (art. 12.6 RGPD). Usa el botón 'Verificar identidad'.",
              409
            );
          }
          cambios.estado = body.estado;
          if (body.estado === "resuelta") cambios.resolucion_at = new Date().toISOString();
        }
        if ("notas_admin" in body) cambios.notas_admin = body.notas_admin;
        if (Object.keys(cambios).length === 0) return err("Nada que actualizar");
        const { error } = await db().from("derechos_arco").update(cambios).eq("id", Number(r1));
        if (error) return err(error.message, 500);
        void auditar(u, "rgpd.derecho_arco.actualizar", { tipo: "derecho_arco", id: r1 }, cambios);
        return json({ ok: true });
      }
      return err("Método no soportado", 405);
    }

    // ---------- Documentos normativos RGPD ----------
    case "documentos-rgpd": {
      if (!puede(u, "config")) return err("Sin permiso", 403);

      // ---- Versión firmada escaneada (Supabase Storage, bucket privado) ----
      if (metodo === "POST" && r1 && r2 === "firmado") {
        const fd = await req.formData().catch(() => null);
        const archivo = fd?.get("archivo") as File | null;
        if (!archivo) return err("Falta el archivo");
        if (archivo.size > 10 * 1024 * 1024) return err("Máximo 10 MB");
        const ext = (archivo.name.split(".").pop() ?? "").toLowerCase();
        if (!["pdf", "jpg", "jpeg", "png"].includes(ext)) return err("Formato no válido: PDF, JPG o PNG");
        const path = `${r1}/firmado-${Date.now()}.${ext}`;
        const buf = Buffer.from(await archivo.arrayBuffer());
        const { error: eU } = await db().storage.from("rgpd-firmados")
          .upload(path, buf, { contentType: archivo.type || "application/octet-stream" });
        if (eU) return err(eU.message, 500);
        const { error } = await db().from("rgpd_documentos").update({
          firmado_path: path, firmado_at: new Date().toISOString(), firmado_por: u.email,
        }).eq("id", r1);
        if (error) return err(error.message, 500);
        void auditar(u, "rgpd.documento.firmado_subir", { tipo: "documento_rgpd", id: r1 }, { path, bytes: archivo.size, nombre_original: archivo.name });
        return json({ ok: true });
      }
      if (metodo === "GET" && r1 && r2 === "firmado") {
        const { data: docF } = await db().from("rgpd_documentos").select("firmado_path").eq("id", r1).maybeSingle();
        if (!docF?.firmado_path) return err("No hay versión firmada", 404);
        const { data: signed, error } = await db().storage.from("rgpd-firmados").createSignedUrl(docF.firmado_path, 300);
        if (error) return err(error.message, 500);
        void auditar(u, "rgpd.documento.firmado_ver", { tipo: "documento_rgpd", id: r1 }, { path: docF.firmado_path });
        return json({ url: signed.signedUrl });
      }
      if (metodo === "DELETE" && r1 && r2 === "firmado") {
        const { data: docF } = await db().from("rgpd_documentos").select("firmado_path").eq("id", r1).maybeSingle();
        if (docF?.firmado_path) await db().storage.from("rgpd-firmados").remove([docF.firmado_path]);
        const { error } = await db().from("rgpd_documentos").update({
          firmado_path: null, firmado_at: null, firmado_por: null,
        }).eq("id", r1);
        if (error) return err(error.message, 500);
        void auditar(u, "rgpd.documento.firmado_quitar", { tipo: "documento_rgpd", id: r1 }, { path: docF?.firmado_path ?? null });
        return json({ ok: true });
      }

      if (metodo === "GET") {
        const { data, error } = await db().from("rgpd_documentos").select("*").order("id");
        return error ? err(error.message, 500) : json(data);
      }
      if (metodo === "PATCH" && r1) {
        const { contenido } = body;
        if (!contenido || typeof contenido !== "object") return err("Falta el contenido");
        const { error } = await db().from("rgpd_documentos").update({
          contenido, actualizado_por: u.email, actualizado_at: new Date().toISOString(),
        }).eq("id", r1);
        if (error) return err(error.message, 500);
        void auditar(u, "rgpd.documento.guardar", { tipo: "documento_rgpd", id: r1 }, { contenido });
        return json({ ok: true });
      }
      return err("Método no soportado", 405);
    }

    // ---------- Logs de auditoría (admin y dirección) ----------
    case "logs": {
      if (!puede(u, "usuarios")) return err("Sin permiso", 403);
      const page = Math.max(1, Number(q.get("page") ?? 1));
      const size = 50;
      let lq = db()
        .from("audit_logs")
        .select("id, actor_email, accion, recurso_tipo, recurso_id, recurso_label, metadata, created_at", { count: "exact" })
        .order("created_at", { ascending: false })
        .range((page - 1) * size, page * size - 1);
      const accion = q.get("accion");
      const busca = q.get("q")?.trim();
      if (accion) lq = lq.eq("accion", accion);
      if (busca) lq = lq.or(`actor_email.ilike.%${busca}%,recurso_label.ilike.%${busca}%,accion.ilike.%${busca}%`);
      const { data, error, count } = await lq;
      if (error) return err(error.message, 500);
      return json({ logs: data ?? [], total: count ?? 0, page, size });
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
        void auditar(u, "escalado.resolver", { tipo: "escalado", id: r1 }, { resuelto: body.resuelto === true });
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
        if (!error) void auditar(u, "config.tratamiento.crear", { tipo: "tratamiento", label: body.nombre }, body);
        return error ? err(error.message, 500) : json({ ok: true });
      }
      if (metodo === "PATCH" && r1) {
        const { error } = await db().from("tratamientos").update(body).eq("id", Number(r1));
        if (!error) void auditar(u, "config.tratamiento.editar", { tipo: "tratamiento", id: r1 }, body);
        return error ? err(error.message, 500) : json({ ok: true });
      }
      return err("Método no soportado", 405);
    }

    case "areas": {
      if (metodo === "GET") {
        const { data, error } = await db().from("areas").select("id, nombre, descripcion, activo").order("nombre");
        return error ? err(error.message, 500) : json(data);
      }
      if (!puede(u, "config")) return err("Sin permiso", 403);
      if (metodo === "POST") {
        if (!body.nombre) return err("Falta el nombre del área");
        const { error } = await db().from("areas").insert({ nombre: body.nombre, descripcion: body.descripcion ?? null });
        if (!error) void auditar(u, "config.area.crear", { tipo: "area", label: body.nombre }, body);
        return error ? err(error.message, 500) : json({ ok: true });
      }
      if (metodo === "PATCH" && r1) {
        const cambios: Record<string, unknown> = {};
        for (const k of ["nombre", "descripcion", "activo"]) if (k in body) cambios[k] = body[k];
        const { error } = await db().from("areas").update(cambios).eq("id", Number(r1));
        if (!error) void auditar(u, "config.area.editar", { tipo: "area", id: r1 }, cambios);
        return error ? err(error.message, 500) : json({ ok: true });
      }
      return err("Método no soportado", 405);
    }

    // ---------- Usuarios del panel (solo admin y dirección) ----------
    case "usuarios": {
      if (!puede(u, "usuarios")) return err("Sin permiso", 403);
      if (metodo === "GET") {
        const { data, error } = await db()
          .from("usuarios_panel")
          .select("user_id, email, nombre, rol, medico_id, activo, created_at, medicos(nombre)")
          .order("created_at");
        return error ? err(error.message, 500) : json(data);
      }
      if (metodo === "POST") {
        const { email, password, nombre, rol, medico_id } = body;
        if (!email || !password || !rol) return err("Faltan email, contraseña o rol");
        if (String(password).length < 8) return err("La contraseña debe tener al menos 8 caracteres");
        if (!["admin", "direccion", "recepcion", "enfermera", "medico"].includes(rol)) return err("Rol no válido");
        // 1. Crear el usuario de acceso (queda dado de alta directamente, sin email de confirmación)
        const { data: nuevo, error: eA } = await db().auth.admin.createUser({
          email, password, email_confirm: true,
        });
        if (eA) return err(`No se pudo crear el acceso: ${eA.message}`, 500);
        // 2. Su fila de rol en el panel
        const { error: eI } = await db().from("usuarios_panel").insert({
          user_id: nuevo.user.id, email, nombre: nombre ?? null, rol, medico_id: medico_id ?? null,
        });
        if (eI) return err(eI.message, 500);
        void auditar(u, "usuario.crear", { tipo: "usuario", id: nuevo.user.id, label: email },
          { rol, nombre: nombre ?? null, medico_id: medico_id ?? null }); // la contraseña NUNCA se registra
        return json({ ok: true });
      }
      if (metodo === "PATCH" && r1) {
        const cambios: Record<string, unknown> = {};
        for (const k of ["nombre", "rol", "medico_id", "activo"]) if (k in body) cambios[k] = body[k];
        if (u.rol !== "admin" && cambios.rol === "admin") return err("Solo un admin puede conceder el rol admin", 403);
        if (r1 === u.user_id && cambios.activo === false) return err("No puedes desactivarte a ti mismo");
        if (Object.keys(cambios).length > 0) {
          const { error } = await db().from("usuarios_panel").update(cambios).eq("user_id", r1);
          if (error) return err(error.message, 500);
        }
        if (body.password) {
          if (String(body.password).length < 8) return err("La contraseña debe tener al menos 8 caracteres");
          const { error } = await db().auth.admin.updateUserById(r1, { password: body.password });
          if (error) return err(error.message, 500);
          void auditar(u, "usuario.password_reset", { tipo: "usuario", id: r1 });
        }
        if (Object.keys(cambios).length > 0) void auditar(u, "usuario.editar", { tipo: "usuario", id: r1 }, cambios);
        return json({ ok: true });
      }
      return err("Método no soportado", 405);
    }

    case "faq": {
      if (metodo === "GET") {
        const { data, error } = await db().from("faq").select("*").order("id");
        return error ? err(error.message, 500) : json(data);
      }
      if (!puede(u, "config")) return err("Sin permiso", 403);
      if (metodo === "POST") {
        const { error } = await db().from("faq").insert(body);
        if (!error) void auditar(u, "config.faq.crear", { tipo: "faq", label: body.pregunta }, body);
        return error ? err(error.message, 500) : json({ ok: true });
      }
      if (metodo === "PATCH" && r1) {
        const { error } = await db().from("faq").update(body).eq("id", Number(r1));
        if (!error) void auditar(u, "config.faq.editar", { tipo: "faq", id: r1 }, body);
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
        if (!error) void auditar(u, "config.horario.crear", { tipo: "horario" }, body);
        return error ? err(error.message, 500) : json({ ok: true });
      }
      if (metodo === "DELETE" && r1) {
        const { data: fila } = await db().from("horarios").select("*").eq("id", Number(r1)).maybeSingle();
        const { error } = await db().from("horarios").delete().eq("id", Number(r1));
        if (!error) void auditar(u, "config.horario.eliminar", { tipo: "horario", id: r1 }, { eliminado: fila });
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
        if (!error) void auditar(u, "config.bloqueo.crear", { tipo: "bloqueo" }, { medico_id, fecha_inicio, fecha_fin, motivo });
        return error ? err(error.message, 500) : json({ ok: true });
      }
      if (metodo === "DELETE" && r1) {
        const { data: fila } = await db().from("bloqueos").select("*").eq("id", Number(r1)).maybeSingle();
        const { error } = await db().from("bloqueos").delete().eq("id", Number(r1));
        if (!error) void auditar(u, "config.bloqueo.eliminar", { tipo: "bloqueo", id: r1 }, { eliminado: fila });
        return error ? err(error.message, 500) : json({ ok: true });
      }
      return err("Método no soportado", 405);
    }

    // ================= HISTORIA CLÍNICA =================

    // ---------- Buscador CIE-10 ----------
    case "cie10": {
      const ambito = await ambitoClinico(u);
      if (!ambito) return err("Sin acceso a datos clínicos", 403);
      const busca = q.get("q")?.trim();
      if (!busca || busca.length < 2) return json([]);
      // Por código exacto/prefijo o por texto en la descripción
      const esCodigo = /^[A-Za-z]\d/.test(busca);
      let cq = db().from("cie10").select("codigo, descripcion").eq("nodo_final", "1").limit(20);
      cq = esCodigo
        ? cq.ilike("codigo", `${busca}%`)
        : cq.ilike("descripcion", `%${busca}%`);
      const { data, error } = await cq;
      if (error) return err(error.message, 500);
      return json(data);
    }

    // ---------- Asignación paciente ↔ médico por área ----------
    case "asignaciones": {
      if (metodo === "GET") {
        const pacienteId = q.get("paciente_id");
        if (pacienteId) {
          if (!puede(u, "gestion") && u.rol !== "medico") return err("Sin permiso", 403);
          const { data, error } = await db()
            .from("paciente_medico_area")
            .select("id, medico_id, area_id, activo, created_at, medicos(nombre), areas(nombre)")
            .eq("paciente_id", Number(pacienteId))
            .order("created_at", { ascending: false });
          if (error) return err(error.message, 500);
          return json(data);
        }
        // Mis pacientes (rol médico): pacientes con asignación activa a este médico
        if (q.get("mias") === "1") {
          const ambito = await ambitoClinico(u);
          if (!ambito || ambito.total) return err("Solo para el rol médico", 400);
          const { data, error } = await db()
            .from("paciente_medico_area")
            .select("paciente_id, area_id, areas(nombre), pacientes(id, nombre, apellidos, telefono, activo)")
            .eq("medico_id", ambito.medicoId).eq("activo", true)
            .order("created_at", { ascending: false });
          if (error) return err(error.message, 500);
          return json(data);
        }
        return err("Falta paciente_id o mias=1");
      }
      if (metodo === "POST") {
        if (!puede(u, "gestion")) return err("Sin permiso", 403);
        const { paciente_id, medico_id, area_id } = body;
        if (!paciente_id || !medico_id || !area_id) return err("Faltan paciente, médico o área");
        const { data, error } = await db()
          .from("paciente_medico_area")
          .insert({ paciente_id, medico_id, area_id })
          .select("id").single();
        if (error) {
          if (error.code === "23505")
            return err("Este paciente ya tiene un médico activo en esa área. Desactiva primero la asignación anterior.");
          if (error.code === "23503")
            return err("Ese médico no pertenece al área seleccionada.");
          return err(error.message, 500);
        }
        void auditar(u, "asignacion.crear", { tipo: "asignacion", id: String(data.id) },
          { paciente_id, medico_id, area_id });
        return json({ ok: true, id: data.id });
      }
      if (metodo === "PATCH" && r1) {
        if (!puede(u, "gestion")) return err("Sin permiso", 403);
        const { data: actual } = await db()
          .from("paciente_medico_area").select("paciente_id, medico_id, area_id, activo")
          .eq("id", Number(r1)).maybeSingle();
        if (!actual) return err("Asignación no encontrada", 404);
        const activo = body.activo === true;
        const { error } = await db().from("paciente_medico_area").update({ activo }).eq("id", Number(r1));
        if (error) {
          if (error.code === "23505")
            return err("Ya hay otro médico activo en esa área para este paciente.");
          return err(error.message, 500);
        }
        void auditar(u, activo ? "asignacion.reactivar" : "asignacion.desactivar",
          { tipo: "asignacion", id: r1 }, { ...actual, activo_nuevo: activo });
        return json({ ok: true });
      }
      return err("Método no soportado", 405);
    }

    // ---------- Historia clínica del paciente ----------
    case "historia": {
      const ambito = await ambitoClinico(u);
      if (!ambito) return err("Sin acceso a datos clínicos", 403);
      const pacienteId = Number(q.get("paciente_id"));
      if (!pacienteId) return err("Falta paciente_id");
      if (!(await puedeVerPaciente(ambito, pacienteId))) return err("Este paciente no está asignado a ti", 403);

      let consQ = db()
        .from("consultas")
        .select("id, fecha, motivo, exploracion, plan, tratamiento, notas, estado, version_number, editada, editada_at, editado_por, area_id, medico_id, cita_id, medicos(nombre), areas(nombre)")
        .eq("paciente_id", pacienteId).order("fecha", { ascending: false }).limit(200);
      let diagQ = db()
        .from("paciente_diagnosticos")
        .select("id, codigo, estado, fecha_inicio, fecha_resolucion, notas, area_id, areas(nombre), cie10(descripcion)")
        .eq("paciente_id", pacienteId).order("fecha_inicio", { ascending: false });
      // El médico solo ve consultas y diagnósticos de SUS áreas
      if (!ambito.total) {
        consQ = consQ.in("area_id", ambito.areas.length ? ambito.areas : [-1]);
        diagQ = diagQ.in("area_id", ambito.areas.length ? ambito.areas : [-1]);
      }
      const [{ data: consultas, error: e1 }, { data: diagnosticos, error: e2 }, { data: alergias, error: e3 }] =
        await Promise.all([
          consQ,
          diagQ,
          // Alergias TRANSVERSALES: siempre visibles (seguridad clínica)
          db().from("paciente_alergias")
            .select("id, estado, notas, created_at, alergias_catalogo(codigo, descripcion)")
            .eq("paciente_id", pacienteId).order("created_at"),
        ]);
      if (e1 || e2 || e3) return err((e1 ?? e2 ?? e3)!.message, 500);

      // Constantes de las consultas visibles
      const idsConsultas = (consultas ?? []).map((c: any) => c.id);
      const { data: constantes } = idsConsultas.length
        ? await db().from("consulta_constantes")
            .select("consulta_id, valor, notas, constantes_catalogo(codigo, nombre, unidad)")
            .in("consulta_id", idsConsultas)
        : { data: [] };
      const { data: diagConsulta } = idsConsultas.length
        ? await db().from("consulta_diagnosticos")
            .select("consulta_id, codigo, estado, notas, cie10(descripcion)")
            .in("consulta_id", idsConsultas)
        : { data: [] };

      void logAccesoHistoria(u, pacienteId, "historia", {
        consultas: (consultas ?? []).length,
        ambito: ambito.total ? "total" : `areas:${ambito.areas.join(",")}`,
      });
      return json({
        consultas: consultas ?? [],
        diagnosticos: diagnosticos ?? [],
        alergias: alergias ?? [],
        constantes: constantes ?? [],
        diagnosticos_consulta: diagConsulta ?? [],
        ambito: ambito.total ? null : ambito.areas,
      });
    }

    // ---------- Consultas clínicas ----------
    case "consultas": {
      const ambito = await ambitoClinico(u);
      if (!ambito) return err("Sin acceso a datos clínicos", 403);

      // Versiones anteriores de una consulta (histórico inmutable)
      if (metodo === "GET" && r1 && r2 === "versiones") {
        const { data: consulta } = await db().from("consultas")
          .select("paciente_id, area_id").eq("id", Number(r1)).maybeSingle();
        if (!consulta) return err("Consulta no encontrada", 404);
        if (!ambito.total && !ambito.areas.includes(consulta.area_id)) return err("Fuera de tu área", 403);
        if (!(await puedeVerPaciente(ambito, consulta.paciente_id))) return err("Este paciente no está asignado a ti", 403);
        const { data, error } = await db().from("consultas_versiones")
          .select("version_number, motivo, exploracion, plan, tratamiento, notas, editado_por, motivo_edicion, created_at")
          .eq("consulta_id", Number(r1)).order("version_number", { ascending: false });
        if (error) return err(error.message, 500);
        void logAccesoHistoria(u, consulta.paciente_id, `consulta:${r1}:versiones`);
        return json(data);
      }

      if (metodo === "POST") {
        const { paciente_id, area_id, motivo, exploracion, plan, tratamiento, notas, cita_id, estado, diagnosticos, constantes } = body;
        if (!paciente_id || !area_id || !motivo?.trim()) return err("Faltan paciente, área o motivo");
        let medicoId = body.medico_id;
        if (!ambito.total) {
          // El médico firma con su propia identidad y solo en sus áreas / sus pacientes
          medicoId = ambito.medicoId;
          if (!ambito.areas.includes(Number(area_id))) return err("No perteneces a esa área", 403);
          if (!(await puedeVerPaciente(ambito, Number(paciente_id)))) return err("Este paciente no está asignado a ti", 403);
        }
        if (!medicoId) return err("Falta el médico");
        const { data: creada, error } = await db().from("consultas").insert({
          paciente_id, medico_id: medicoId, area_id, cita_id: cita_id ?? null,
          motivo: motivo.trim(), exploracion: exploracion ?? null, plan: plan ?? null,
          tratamiento: tratamiento ?? null, notas: notas ?? null,
          estado: estado === "firmada" ? "firmada" : "borrador",
        }).select("id").single();
        if (error) return err(error.message, 500);

        // Diagnósticos CIE-10 de la consulta (el trigger sincroniza la lista de problemas)
        for (const d of Array.isArray(diagnosticos) ? diagnosticos : []) {
          if (!d?.codigo) continue;
          const { error: eD } = await db().from("consulta_diagnosticos").insert({
            consulta_id: creada.id, codigo: d.codigo, paciente_id, medico_id: medicoId, area_id,
            estado: ["sospecha", "confirmado", "descartado"].includes(d.estado) ? d.estado : "sospecha",
            notas: d.notas ?? null,
          });
          if (eD) console.error("diagnóstico no guardado:", d.codigo, eD.message);
        }
        // Constantes clínicas
        for (const c of Array.isArray(constantes) ? constantes : []) {
          if (!c?.constante_id || c.valor === undefined || c.valor === null || c.valor === "") continue;
          await db().from("consulta_constantes").insert({
            consulta_id: creada.id, constante_id: c.constante_id, paciente_id, valor: Number(c.valor), notas: c.notas ?? null,
          });
        }
        void auditar(u, "consulta.crear", { tipo: "consulta", id: String(creada.id) },
          { paciente_id, medico_id: medicoId, area_id, motivo: motivo.trim(), estado: estado ?? "borrador",
            diagnosticos: (diagnosticos ?? []).map((d: any) => d.codigo) });
        void logAccesoHistoria(u, Number(paciente_id), `consulta:${creada.id}:crear`);
        return json({ ok: true, id: creada.id });
      }

      if (metodo === "PATCH" && r1) {
        const { data: actual } = await db().from("consultas")
          .select("paciente_id, medico_id, area_id, estado, version_number").eq("id", Number(r1)).maybeSingle();
        if (!actual) return err("Consulta no encontrada", 404);
        if (!ambito.total) {
          if (actual.medico_id !== ambito.medicoId) return err("Solo puedes editar tus propias consultas", 403);
        }
        const cambios: Record<string, unknown> = {};
        for (const k of ["motivo", "exploracion", "plan", "tratamiento", "notas"]) if (k in body) cambios[k] = body[k];
        const cambiaContenido = Object.keys(cambios).length > 0;
        if (body.estado === "firmada") cambios.estado = "firmada";
        if (cambiaContenido) {
          if (!body.motivo_edicion?.trim())
            return err("Modificar una consulta clínica requiere indicar el motivo de la edición");
          cambios.motivo_edicion = body.motivo_edicion.trim();
          cambios.editado_por = u.email;
        }
        if (!Object.keys(cambios).length) return err("Nada que actualizar");
        const { error } = await db().from("consultas").update(cambios).eq("id", Number(r1));
        if (error) {
          // La excepción del trigger de versionado llega como texto legible
          return err(error.message.includes("motivo de la edicion")
            ? "Modificar una consulta clínica requiere indicar el motivo de la edición"
            : error.message, 400);
        }
        void auditar(u, body.estado === "firmada" && !cambiaContenido ? "consulta.firmar" : "consulta.editar",
          { tipo: "consulta", id: r1 },
          { paciente_id: actual.paciente_id, cambios, motivo_edicion: body.motivo_edicion ?? null, version_anterior: actual.version_number });
        return json({ ok: true });
      }
      return err("Método no soportado", 405);
    }

    // ---------- Catálogo de constantes clínicas ----------
    case "constantes-catalogo": {
      const { data, error } = await db().from("constantes_catalogo").select("id, codigo, nombre, unidad").order("id");
      if (error) return err(error.message, 500);
      return json(data);
    }

    // ---------- Alergias (transversales) ----------
    case "alergias": {
      if (metodo === "GET" && r1 === "catalogo") {
        const { data, error } = await db().from("alergias_catalogo").select("id, codigo, descripcion").order("descripcion");
        if (error) return err(error.message, 500);
        return json(data);
      }
      const ambito = await ambitoClinico(u);
      if (!ambito) return err("Sin acceso a datos clínicos", 403);
      if (metodo === "POST") {
        const { paciente_id, alergia_id, estado, notas } = body;
        if (!paciente_id || !alergia_id) return err("Faltan paciente o alergia");
        if (!(await puedeVerPaciente(ambito, Number(paciente_id)))) return err("Este paciente no está asignado a ti", 403);
        const { data, error } = await db().from("paciente_alergias").insert({
          paciente_id, alergia_id,
          estado: ["pendiente", "confirmada", "descartada"].includes(estado) ? estado : "pendiente",
          notas: notas ?? null, medico_id: ambito.medicoId,
        }).select("id").single();
        if (error) {
          if (error.code === "23505") return err("Esa alergia ya está registrada para este paciente.");
          return err(error.message, 500);
        }
        void auditar(u, "alergia.registrar", { tipo: "paciente", id: String(paciente_id) },
          { alergia_id, estado: estado ?? "pendiente", notas: notas ?? null });
        return json({ ok: true, id: data.id });
      }
      if (metodo === "PATCH" && r1) {
        const { data: actual } = await db().from("paciente_alergias")
          .select("paciente_id, estado, notas").eq("id", Number(r1)).maybeSingle();
        if (!actual) return err("Alergia no encontrada", 404);
        if (!(await puedeVerPaciente(ambito, actual.paciente_id))) return err("Este paciente no está asignado a ti", 403);
        const cambios: Record<string, unknown> = {};
        if ("estado" in body && ["pendiente", "confirmada", "descartada"].includes(body.estado)) cambios.estado = body.estado;
        if ("notas" in body) cambios.notas = body.notas;
        if (!Object.keys(cambios).length) return err("Nada que actualizar");
        const { error } = await db().from("paciente_alergias").update(cambios).eq("id", Number(r1));
        if (error) return err(error.message, 500);
        void auditar(u, "alergia.editar", { tipo: "paciente", id: String(actual.paciente_id) },
          { antes: { estado: actual.estado, notas: actual.notas }, despues: cambios });
        return json({ ok: true });
      }
      return err("Método no soportado", 405);
    }

    // ---------- Métricas ----------
    case "metricas": {
      if (!puede(u, "metricas")) return err("Sin permiso", 403);
      const hoy = hoyMadrid();
      const hace8s = sumarDias(hoy, -56);
      const desdeISO = madridAUtc(hace8s, "00:00").toISOString();

      const [{ data: citas }, { count: pacientesTotal }, { count: escalPend }, { count: msgs7d }] = await Promise.all([
        db().from("citas").select("inicio, estado").gte("inicio", desdeISO),
        db().from("pacientes").select("id", { count: "exact", head: true }),
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
        pacientesTotal: pacientesTotal ?? 0,
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
