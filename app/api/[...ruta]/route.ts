import { NextRequest, NextResponse } from "next/server";
import { db, authClient } from "@/lib/db";
import { usuarioDesdeRequest, puede, UsuarioPanel } from "@/lib/auth";
import { auditar } from "@/lib/audit";
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
        void auditar(u, "cita.crear", { tipo: "cita", id: data.id }, { cliente_id, medico_id, fecha, hora });
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

    // ---------- Clientes ----------
    case "clientes": {
      if (metodo === "GET" && !r1) {
        const busca = q.get("q")?.trim();
        const papelera = q.get("papelera") === "1";
        let cq = db()
          .from("clientes")
          .select("id, telefono, telefono_contacto, nombre, apellidos, email, consentimiento_rgpd, activo, created_at, deleted_at")
          .order("created_at", { ascending: false })
          .limit(100);
        cq = papelera ? cq.not("deleted_at", "is", null) : cq.is("deleted_at", null);
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
        // Estado actual del cliente (para la escalera desactivar → eliminar → anonimizar)
        const { data: actual } = await db()
          .from("clientes").select("activo, deleted_at").eq("id", Number(r1)).maybeSingle();
        if (!actual) return err("Cliente no encontrado", 404);
        // Borrado suave y restauración
        if (body.eliminar === true) {
          if (actual.activo) return err("Escalera de baja: primero hay que DESACTIVAR al cliente; solo entonces se puede enviar a la papelera.");
          const { error } = await db().from("clientes").update({ deleted_at: new Date().toISOString() }).eq("id", Number(r1));
          if (error) return err(error.message, 500);
          void auditar(u, "cliente.eliminar", { tipo: "cliente", id: r1 }, { papelera_desde: new Date().toISOString() });
          return json({ ok: true });
        }
        // Anonimización irreversible (derecho de supresión con obligación de conservar lo operativo)
        if (body.anonimizar === true) {
          if (!puede(u, "usuarios")) return err("Solo admin o dirección pueden anonimizar", 403);
          if (!actual.deleted_at) return err("Escalera de baja: solo se puede anonimizar a un cliente que esté en la papelera.");
          // Salvaguarda sanitaria (Ley 41/2002 art. 17): con asistencia reciente, no anonimizar
          const anios = parseInt(process.env.RETENCION_ASISTENCIA_ANIOS ?? "5", 10);
          const { data: ultima } = await db()
            .from("citas").select("inicio").eq("cliente_id", Number(r1)).eq("estado", "completada")
            .order("inicio", { ascending: false }).limit(1).maybeSingle();
          if (ultima && new Date(ultima.inicio).getTime() > Date.now() - anios * 365.25 * 86400_000 && body.forzar !== true) {
            return err(
              `Este cliente tiene asistencia dentro del plazo legal de conservación (${anios} años, Ley 41/2002). Debe permanecer bloqueado en la papelera hasta que venza. Solo fuérzalo con el aval de vuestro asesor de protección de datos.`,
              409
            );
          }
          const { error } = await db().from("clientes").update({
            nombre: "[anonimizado]", apellidos: null, email: null,
            telefono_contacto: null, telefono: `anon-${r1}`,
            activo: false, deleted_at: new Date().toISOString(),
          }).eq("id", Number(r1));
          if (error) return err(error.message, 500);
          void auditar(u, "cliente.anonimizar", { tipo: "cliente", id: r1 },
            { forzado: body.forzar === true, en_papelera_desde: actual.deleted_at });
          return json({ ok: true });
        }
        if (body.restaurar === true) {
          const { error } = await db().from("clientes").update({ deleted_at: null }).eq("id", Number(r1));
          if (error) return err(error.message, 500);
          void auditar(u, "cliente.restaurar", { tipo: "cliente", id: r1 }, { estaba_en_papelera_desde: actual.deleted_at });
          return json({ ok: true });
        }
        const permitidos = ["nombre", "apellidos", "email", "telefono_contacto", "idioma", "activo"];
        const cambios: Record<string, unknown> = {};
        for (const k of permitidos) if (k in body) cambios[k] = body[k];
        const { error } = await db().from("clientes").update(cambios).eq("id", Number(r1));
        if (error) return err(error.message, 500);
        // Log con VALORES (no solo nombres de campo). Activo tiene acción propia.
        if ("activo" in cambios && Object.keys(cambios).length === 1) {
          void auditar(u, cambios.activo ? "cliente.reactivar" : "cliente.desactivar",
            { tipo: "cliente", id: r1 }, { activo: cambios.activo });
        } else {
          void auditar(u, "cliente.editar", { tipo: "cliente", id: r1 }, { cambios });
        }
        return json({ ok: true });
      }
      return err("Método no soportado", 405);
    }

    // ---------- Consentimientos (huella RGPD por finalidad) ----------
    case "consentimientos": {
      if (metodo === "GET") {
        const clienteId = q.get("cliente_id");
        if (!clienteId) return err("Falta cliente_id");
        const { data, error } = await db()
          .from("consentimientos")
          .select("id, tipo, aceptado, texto, canal, created_at, revocado_at")
          .eq("cliente_id", Number(clienteId))
          .order("created_at", { ascending: false });
        return error ? err(error.message, 500) : json(data);
      }
      if (!puede(u, "gestion")) return err("Sin permiso", 403);
      if (metodo === "POST") {
        const { cliente_id, tipo, aceptado, texto } = body;
        if (!cliente_id || !tipo || typeof aceptado !== "boolean") return err("Faltan cliente_id, tipo o aceptado");
        const { error } = await db().from("consentimientos").insert({
          cliente_id, tipo, aceptado, texto: texto ?? null, canal: "panel",
        });
        if (error) return err(error.message, 500);
        void auditar(u, "consentimiento.registrar", { tipo: "cliente", id: cliente_id }, { tipo_consentimiento: tipo, aceptado });
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
          .select("id, cliente_id, nombre, contacto, tipo_derecho, descripcion, canal, estado, notas_admin, resolucion_at, created_at")
          .order("created_at", { ascending: false })
          .limit(200);
        return error ? err(error.message, 500) : json(data);
      }
      if (metodo === "PATCH" && r1) {
        const cambios: Record<string, unknown> = {};
        if (body.estado && ["pendiente", "en_proceso", "resuelta"].includes(body.estado)) {
          cambios.estado = body.estado;
          if (body.estado === "resuelta") cambios.resolucion_at = new Date().toISOString();
        }
        if ("notas_admin" in body) cambios.notas_admin = body.notas_admin;
        if (Object.keys(cambios).length === 0) return err("Nada que actualizar");
        const { error } = await db().from("derechos_arco").update(cambios).eq("id", Number(r1));
        if (error) return err(error.message, 500);
        void auditar(u, "rgpd.derecho_arco.cambiar_estado", { tipo: "derecho_arco", id: r1 }, cambios);
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
