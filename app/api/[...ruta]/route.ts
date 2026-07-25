import { NextRequest, NextResponse } from "next/server";
import { db, authClient } from "@/lib/db";
import { usuarioDesdeRequest, puede, UsuarioPanel } from "@/lib/auth";
import { auditar } from "@/lib/audit";
import { madridAUtc, sumarMin, diaSemana, hoyMadrid, sumarDias } from "@/lib/tiempo";

export const dynamic = "force-dynamic";

const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
const err = (mensaje: string, status = 400) => json({ error: mensaje }, status);

/** Error al pedir datos clínicos sin ámbito: distingue el médico sin vincular del resto de roles. */
const errAmbito = (u: UsuarioPanel) =>
  u.rol === "medico" && !u.medico_id
    ? err("Tu usuario médico aún no está vinculado a su ficha de médico. Dirección o admin deben vincularlo en Configuración → Usuarios y permisos (y crear antes la ficha en Configuración → Médicos si no existe).", 403)
    : err("Sin acceso a datos clínicos", 403);

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
      .select("nombre, rol, medico_id")
      .eq("user_id", data.user.id)
      .eq("activo", true)
      .maybeSingle();
    if (!fila) return err("Tu usuario no tiene acceso al panel", 403);
    void auditar({ user_id: data.user.id, email, nombre: fila.nombre, rol: fila.rol, medico_id: null } as UsuarioPanel, "auth.login", { tipo: "auth", label: email });
    return json({
      token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      nombre: fila.nombre, rol: fila.rol, medico_id: fila.medico_id ?? null,
    });
  }

  // ---------- Renovación de sesión (sin token: usa el refresh_token) ----------
  // El access token de Supabase caduca a la hora; el panel lo renueva solo.
  if (r0 === "refresh" && metodo === "POST") {
    const { refresh_token } = body;
    if (!refresh_token) return err("Falta el refresh_token", 400);
    const { data, error } = await authClient().auth.refreshSession({ refresh_token });
    if (error || !data.session) return err("Sesión caducada, vuelve a iniciar sesión", 401);
    return json({ token: data.session.access_token, refresh_token: data.session.refresh_token });
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
      if (metodo === "GET") {
        const { data, error } = await db()
          .from("medicos")
          .select("id, nombre, activo, tipo, antelacion_horas, num_colegiado, dni, telefono, email, fecha_nacimiento, direccion, bio, medico_areas(area_id)")
          .order("nombre");
        if (error) return err(error.message, 500);
        return json(data);
      }
      if (!puede(u, "config")) return err("Sin permiso", 403);
      if (metodo === "POST") {
        // Punto único de alta: los médicos se crean SIEMPRE desde Usuarios y permisos
        // (acceso + ficha + áreas + agenda en una sola operación atómica)
        return err("Los médicos se crean desde Configuración → Usuarios y permisos (+ Crear usuario → Médico/Enfermería), que da de alta a la vez el acceso, la ficha, sus áreas y su agenda.", 405);
      }
      if (metodo === "PATCH" && r1) {
        const cambios: Record<string, unknown> = {};
        for (const k of ["nombre", "tipo", "activo", "antelacion_horas", "tolerancia_fin_min", "num_colegiado", "dni", "telefono", "email", "fecha_nacimiento", "direccion", "bio"])
          if (k in body) cambios[k] = body[k];
        // DESACTIVAR: no se puede con citas futuras pendientes — resolverlas primero
        if (cambios.activo === false) {
          const { data: futuras } = await db().from("citas")
            .select("id, inicio, estado, pacientes(nombre, apellidos, telefono), tratamientos(nombre)")
            .or(`medico_id.eq.${r1},enfermera_id.eq.${r1}`)
            .in("estado", ["pendiente", "confirmada", "en_espera", "en_consulta"])
            .gte("inicio", new Date().toISOString()).order("inicio");
          if ((futuras?.length ?? 0) > 0) {
            return json({
              error: `No se puede desactivar: tiene ${futuras!.length} cita(s) futuras reservadas. Resuélvelas primero desde la Agenda (Cancelar → lista de espera avisa al paciente) y vuelve a intentarlo.`,
              citas_conflicto: futuras,
            }, 409);
          }
        }
        if (Object.keys(cambios).length) {
          const { error } = await db().from("medicos").update(cambios).eq("id", Number(r1));
          if (error) {
            if (error.code === "23505") return err("Ya existe un médico con ese DNI o número de colegiado");
            return err(error.message, 500);
          }
        }
        // Cascada: al desactivar la ficha se desactiva TODO lo relacionado
        if (cambios.activo === false) {
          await db().from("paciente_medico_area").update({ activo: false }).eq("medico_id", Number(r1)).eq("activo", true);
          await db().from("usuarios_panel").update({ activo: false }).eq("medico_id", Number(r1)).in("rol", ["medico", "enfermera"]);
          void auditar(u, "config.medico.desactivar_cascada", { tipo: "medico", id: r1 },
            { desactivado: ["ficha", "asignaciones_pacientes", "usuario_panel"], nota: "horarios y bloqueos se conservan por si se reactiva; el bot y la agenda dejan de ofrecerle al instante" });
        }
        // Reactivar: vuelve la ficha y su acceso al panel (las asignaciones de pacientes se reactivan a mano)
        if (cambios.activo === true) {
          await db().from("usuarios_panel").update({ activo: true }).eq("medico_id", Number(r1)).in("rol", ["medico", "enfermera"]);
          void auditar(u, "config.medico.reactivar", { tipo: "medico", id: r1 }, { reactivado: ["ficha", "usuario_panel"] });
        }
        // Sincronizar áreas del médico (si vienen en el body)
        if (Array.isArray(body.areas)) {
          const deseadas = body.areas.map(Number).filter(Boolean);
          const { data: actuales } = await db().from("medico_areas").select("area_id").eq("medico_id", Number(r1));
          const tiene = (actuales ?? []).map((a: any) => a.area_id);
          for (const a of deseadas.filter((x: number) => !tiene.includes(x))) {
            const { error: eA } = await db().from("medico_areas").insert({ medico_id: Number(r1), area_id: a });
            if (eA && eA.code !== "23505") return err(eA.message, 500);
          }
          for (const a of tiene.filter((x: number) => !deseadas.includes(x))) {
            const { error: eD } = await db().from("medico_areas").delete().eq("medico_id", Number(r1)).eq("area_id", a);
            if (eD) {
              if (eD.code === "23503")
                return err("No se puede quitar esa área: el médico tiene pacientes asignados o historia clínica en ella. Desactiva antes esas asignaciones.");
              return err(eD.message, 500);
            }
          }
          cambios.areas = deseadas;
        }
        void auditar(u, "config.medico.editar", { tipo: "medico", id: r1 }, { cambios });
        return json({ ok: true });
      }
      return err("Método no soportado", 405);
    }

    case "agenda": {
      let medQ = db().from("medicos").select("id, nombre, tipo, medico_areas(area_id, areas(nombre))").eq("activo", true).order("nombre");
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
        .select("id, medico_id, enfermera_id, reactiva, inicio, fin, estado, confirmada_paciente, notas, llegada_at, consulta_inicio_at, consulta_fin_at, pacientes(id, nombre, apellidos, telefono, alta_completa), tratamientos(nombre, area_id)")
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
            // La cita aparece en la columna del médico Y en la de la enfermera de apoyo
          citas: (citas ?? []).filter((c: any) => c.medico_id === m.id || c.enfermera_id === m.id)
            .map((c: any) => ({ ...c, es_apoyo: c.enfermera_id === m.id && c.medico_id !== m.id })),
        })),
      });
    }

    case "citas": {
      if (metodo === "POST") {
        // gestion (recepción/dirección/admin) crea para cualquier médico;
        // el rol medico solo puede crear citas EN SU PROPIA agenda (ej. al resolver su lista de espera)
        const esMedicoPropio = u.rol === "medico" && u.medico_id;
        if (!puede(u, "gestion") && !esMedicoPropio) return err("Sin permiso", 403);
        const { paciente_id, tratamiento_id, fecha, hora, duracion_min, notas, enfermera_id } = body;
        const medico_id = esMedicoPropio && !puede(u, "gestion") ? u.medico_id : body.medico_id;
        if (!paciente_id || !medico_id || !fecha || !hora) return err("Faltan datos de la cita");
        const inicio = madridAUtc(fecha, hora);
        const fin = sumarMin(inicio, Number(duracion_min ?? 30));
        const reactiva = fecha === hoyMadrid(); // ⚡ reserva de hoy para hoy
        // Si lleva enfermera de apoyo, su franja también debe estar libre
        if (enfermera_id) {
          const { data: pisada } = await db().from("citas").select("id")
            .or(`medico_id.eq.${enfermera_id},enfermera_id.eq.${enfermera_id}`)
            .in("estado", ["pendiente", "confirmada", "en_espera", "en_consulta"])
            .lt("inicio", fin.toISOString()).gt("fin", inicio.toISOString()).limit(1);
          if ((pisada?.length ?? 0) > 0) return err("La enfermera de apoyo ya está ocupada en esa franja");
        }
        const { data, error } = await db()
          .from("citas")
          .insert({
            paciente_id, medico_id,
            tratamiento_id: tratamiento_id ?? null,
            enfermera_id: enfermera_id ?? null,
            inicio: inicio.toISOString(), fin: fin.toISOString(),
            estado: "confirmada", notas: notas ?? null, creada_via: "panel", reactiva,
          })
          .select("id")
          .single();
        if (error) return error.code === "23P01" ? err("Ese hueco se solapa con otra cita del médico") : err(error.message, 500);
        void auditar(u, "cita.crear", { tipo: "cita", id: data.id }, { paciente_id, medico_id, fecha, hora, reactiva, enfermera_id: enfermera_id ?? null });
        return json({ ok: true, id: data.id, reactiva });
      }
      if (metodo === "PATCH" && r1) {
        // gestion: cualquier cita · titular clínico (médico, directivo-médico o enfermera titular): solo las suyas
        const { data: cita } = await db().from("citas")
          .select("id, paciente_id, medico_id, enfermera_id, tratamiento_id, inicio, estado, llegada_at, consulta_inicio_at, consulta_fin_at, pacientes(id, nombre, telefono), medicos!citas_medico_id_fkey(nombre), tratamientos(nombre, area_id)")
          .eq("id", Number(r1)).maybeSingle();
        if (!cita) return err("Cita no encontrada", 404);
        const esTitular = Boolean(u.medico_id) && u.medico_id === cita.medico_id;
        if (!puede(u, "gestion") && !esTitular) return err("Sin permiso", 403);
        const { estado } = body;
        if (!["pendiente", "confirmada", "en_espera", "en_consulta", "cancelada", "completada", "no_show"].includes(estado)) return err("Estado no válido");

        // ---- FLUJO DE CLÍNICA: llegada → consulta → completada, con tiempos ----
        const ahora = new Date().toISOString();
        const cambios: Record<string, unknown> = { estado };
        if (estado === "en_espera") {
          // La llegada la marca recepción/dirección/admin
          if (!puede(u, "gestion")) return err("La llegada del paciente la marca recepción", 403);
          if (!["pendiente", "confirmada"].includes(cita.estado)) return err(`La cita está "${cita.estado}"; no se puede marcar llegada`);
          if (!(cita as any).llegada_at) cambios.llegada_at = ahora;
        }
        if (estado === "en_consulta") {
          // Empezar consulta: SOLO el profesional titular de la cita (médico, directivo-médico
          // o enfermera con cita propia). En consulta compartida (enfermera de apoyo) la empieza
          // el MÉDICO; el estado vive en la cita, así que se comparte solo.
          if (!esTitular) return err("La consulta la empieza el profesional titular de la cita", 403);
          if (["cancelada", "completada", "no_show"].includes(cita.estado)) return err(`La cita está "${cita.estado}"; no se puede abrir consulta`);
          if (!(cita as any).consulta_inicio_at) cambios.consulta_inicio_at = ahora;
          if (!(cita as any).llegada_at) cambios.llegada_at = ahora; // pasó directo sin marcarse la llegada
        }
        if (estado === "completada") {
          // Sin llegada ni consulta empezada NO hay nada que completar (regla de Manel)
          if (!["en_espera", "en_consulta"].includes(cita.estado))
            return err("El paciente aún no ha llegado ni ha empezado la consulta: marca antes la llegada (🪑) o la consulta (🩺)");
          if ((cita as any).consulta_inicio_at && !(cita as any).consulta_fin_at) cambios.consulta_fin_at = ahora; // cierre del contador
        }
        const { error } = await db().from("citas").update(cambios).eq("id", Number(r1));
        if (error) return err(error.message, 500);
        void auditar(u, "cita.cambiar_estado", { tipo: "cita", id: r1 }, { estado, paciente_id: cita.paciente_id });

        // Cancelación → lista de espera + aviso WhatsApp automático al paciente
        if (estado === "cancelada" && body.a_lista_espera === true) {
          const p: any = cita.pacientes, m: any = cita.medicos, t: any = cita.tratamientos;
          // Área: la del tratamiento; si no lleva, la única del médico
          let areaId: number | null = t?.area_id ?? null;
          if (!areaId) {
            const { data: ma } = await db().from("medico_areas").select("area_id").eq("medico_id", cita.medico_id);
            areaId = ma?.length === 1 ? ma[0].area_id : (ma?.[0]?.area_id ?? null);
          }
          if (areaId) {
            const { data: le, error: eLE } = await db().from("lista_espera").insert({
              paciente_id: cita.paciente_id, area_id: areaId, medico_id: cita.medico_id,
              tratamiento_id: cita.tratamiento_id, creada_via: "panel",
              preferencia: "reprogramar: su cita fue cancelada por ausencia del médico",
            }).select("id").single();
            if (!eLE || eLE.code === "23505") {
              const cuando = new Date(cita.inicio).toLocaleString("es-ES", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });
              const mensaje =
                `Hola${p?.nombre ? ` ${p.nombre}` : ""}, soy Alexia, de *Clínica EiviLuxury* 🙏 Lamento comunicarte que tu cita del ${cuando}` +
                `${m?.nombre ? ` con ${m.nombre}` : ""}${t?.nombre ? ` (${t.nombre})` : ""} ha tenido que cancelarse por una ausencia del doctor. ` +
                `Te he puesto con prioridad en su lista de espera y te avisaremos en cuanto haya hueco. ` +
                `Si lo prefieres, dímelo y te busco ahora mismo otra fecha u otro doctor.`;
              await db().from("avisos").insert({
                paciente_id: cita.paciente_id, telefono: p?.telefono, tipo: "cita_cancelada_espera",
                mensaje, payload: { cita_id: cita.id, lista_espera_id: le?.id ?? null, medico: m?.nombre ?? null },
              });
              void auditar(u, "cita.cancelada_a_espera", { tipo: "cita", id: r1 },
                { paciente_id: cita.paciente_id, area_id: areaId, aviso: "whatsapp_encolado" });
            }
          }
        }
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
          .select("id, cip, telefono, telefono_contacto, nombre, apellidos, email, consentimiento_rgpd, activo, alta_completa, created_at, deleted_at")
          .order("created_at", { ascending: false })
          .limit(100);
        cq = papelera ? cq.not("deleted_at", "is", null) : cq.is("deleted_at", null);
        // El CIP es el identificador de referencia de la clínica: si pegan un CIP completo, búsqueda exacta
        const esCip = busca && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(busca);
        if (esCip) cq = cq.eq("cip", busca);
        else if (busca) cq = cq.or(`nombre.ilike.%${busca}%,apellidos.ilike.%${busca}%,telefono.ilike.%${busca}%`);
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
            .select("inicio, fin, estado, confirmada_paciente, notas, creada_via, medicos!citas_medico_id_fkey(nombre), tratamientos(nombre)")
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
        // El rol médico solo abre la ficha de SUS pacientes asignados
        if (u.rol === "medico") {
          const ambitoP = await ambitoClinico(u);
          if (!ambitoP || !(await puedeVerPaciente(ambitoP, Number(r1)))) return err("Este paciente no está asignado a ti", 403);
        }
        const { data: paciente, error } = await db()
          .from("pacientes")
          .select("*")
          .eq("id", Number(r1))
          .maybeSingle();
        if (error || !paciente) return err("Paciente no encontrado", 404);
        const { data: citas } = await db()
          .from("citas")
          .select("id, inicio, estado, confirmada_paciente, medicos!citas_medico_id_fkey(nombre), tratamientos(nombre, areas(nombre))")
          .eq("paciente_id", paciente.id)
          .order("inicio", { ascending: false })
          .limit(50);
        return json({ ...paciente, citas: citas ?? [] });
      }
      // Alta de paciente desde el panel (gente de paso / walk-ins)
      if (metodo === "POST" && !r1) {
        if (!puede(u, "gestion")) return err("Sin permiso", 403);
        const { telefono, nombre, apellidos, email, telefono_contacto, dni, fecha_nacimiento, direccion, sexo, acepta_publicidad } = body;
        if (!telefono?.trim() || !nombre?.trim()) return err("Faltan el teléfono y el nombre");
        if (body.consentimiento !== true) return err("Sin el consentimiento de datos personales (dado en persona) no se puede crear al paciente");
        if (body.consentimiento_clinicos !== true) return err("En el alta presencial también es necesario el consentimiento del tratamiento de datos clínicos (historia clínica)");
        const tel = String(telefono).replace(/\D/g, "");
        // Alta completa si recepción ya tiene lo esencial de la ficha
        const alta_completa = Boolean(nombre?.trim() && apellidos?.trim() && dni?.trim() && fecha_nacimiento);
        const { data: nuevoP, error } = await db().from("pacientes").insert({
          telefono: tel,
          nombre: nombre.trim(), apellidos: apellidos?.trim() || null,
          email: email?.trim() || null, telefono_contacto: telefono_contacto?.trim() || null,
          dni: dni?.trim() || null, fecha_nacimiento: fecha_nacimiento || null,
          direccion: direccion?.trim() || null, sexo: sexo || null,
          consentimiento_rgpd: true, consentimiento_fecha: new Date().toISOString(),
          alta_completa,
        }).select("id, cip").single();
        if (error) {
          if (error.code === "23505") return err("Ya existe un paciente con ese teléfono o DNI");
          return err(error.message, 500);
        }
        // Huella RGPD granular (canal panel: consentimiento presencial)
        const consentimientos = [
          { paciente_id: nuevoP.id, tipo: "datos_personales", aceptado: true, canal: "panel", texto: "Consentimiento del tratamiento de datos personales otorgado en persona en la clínica y registrado desde el panel" },
          { paciente_id: nuevoP.id, tipo: "datos_clinicos", aceptado: true, canal: "panel", texto: "Consentimiento del tratamiento de sus datos clínicos y de salud (historia clínica) otorgado en persona en la clínica" },
          { paciente_id: nuevoP.id, tipo: "comunicaciones_recordatorios", aceptado: true, canal: "panel", texto: "Acepta recibir recordatorios y comunicaciones operativas de sus citas (registrado en persona)" },
          ...(typeof acepta_publicidad === "boolean"
            ? [{ paciente_id: nuevoP.id, tipo: "publicidad", aceptado: acepta_publicidad, canal: "panel", texto: acepta_publicidad ? "Acepta recibir novedades y promociones (registrado en persona)" : "Rechaza recibir publicidad (registrado en persona)" }]
            : []),
        ];
        await db().from("consentimientos").insert(consentimientos);
        void auditar(u, "paciente.crear", { tipo: "paciente", id: String(nuevoP.id), label: tel },
          { origen: "panel", nombre: nombre.trim(), alta_completa, con_dni: Boolean(dni) });
        return json({ ok: true, id: nuevoP.id, cip: nuevoP.cip, alta_completa });
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
        const permitidos = ["nombre", "apellidos", "email", "telefono_contacto", "idioma", "activo", "dni", "fecha_nacimiento", "direccion", "sexo"];
        const cambios: Record<string, unknown> = {};
        for (const k of permitidos) if (k in body) cambios[k] = body[k];
        // Completar el alta (recepción, con el paciente delante): exige la ficha mínima
        if (body.alta_completa === true) {
          const { data: fila } = await db().from("pacientes").select("nombre, apellidos, dni, fecha_nacimiento").eq("id", Number(r1)).maybeSingle();
          const final = { ...fila, ...cambios } as any;
          if (!final?.nombre || !final?.apellidos || !final?.dni || !final?.fecha_nacimiento)
            return err("Para completar el alta faltan datos de la ficha: nombre, apellidos, DNI y fecha de nacimiento.");
          cambios.alta_completa = true;
        }
        const { error } = await db().from("pacientes").update(cambios).eq("id", Number(r1));
        if (error) {
          if (error.code === "23505") return err("Ya existe otro paciente con ese DNI");
          return err(error.message, 500);
        }
        if (cambios.alta_completa === true)
          void auditar(u, "paciente.alta_completada", { tipo: "paciente", id: r1 }, { con_dni: Boolean((cambios.dni ?? true)) });
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
          .select("id, nombre, descripcion, precio_eur, requiere_valoracion, requiere_enfermeria, duracion_min, activo, area_id, areas(nombre)")
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
        const { email, password, nombre, rol, medico_id, ficha } = body;
        if (!email || !password || !rol) return err("Faltan email, contraseña o rol");
        if (String(password).length < 8) return err("La contraseña debe tener al menos 8 caracteres");
        if (!["admin", "direccion", "recepcion", "enfermera", "medico"].includes(rol)) return err("Rol no válido");

        // Vincular a ficha EXISTENTE: solo si nadie la tiene ya (vínculo único)
        if (medico_id) {
          const { data: ocupada } = await db().from("usuarios_panel").select("email").eq("medico_id", medico_id).limit(1);
          if ((ocupada?.length ?? 0) > 0)
            return err(`Esa ficha de médico ya está vinculada al usuario ${ocupada![0].email}. La vinculación es única y fija.`);
        }
        // 1. Si es médico/enfermera con FICHA NUEVA: crearla primero (si falla, no se crea nada más)
        let fichaId: number | null = medico_id ?? null;
        if (["medico", "enfermera"].includes(rol) && ficha && !medico_id) {
          if (!ficha.nombre?.trim()) return err("Falta el nombre para la ficha del médico");
          if (rol === "medico" && !ficha.num_colegiado?.trim())
            return err("El número de colegiado es obligatorio para crear una ficha de médico");
          const areaIds = (Array.isArray(ficha.areas) ? ficha.areas : []).map(Number).filter(Boolean);
          if (areaIds.length === 0) return err(rol === "medico" ? "Elige al menos un área para el médico" : "Elige al menos un área para la enfermera (también trabajan por áreas)");
          const tramosFicha = (Array.isArray(ficha.horario) ? ficha.horario : []).filter(
            (t: any) => t && t.dia_semana !== undefined && t.hora_inicio && t.hora_fin && t.hora_fin > t.hora_inicio);
          if (tramosFicha.length === 0) return err("Añade al menos un tramo de horario semanal: no puede haber médico ni enfermera sin agenda");
          const { data: m, error: eM } = await db().from("medicos").insert({
            nombre: ficha.nombre.trim(),
            tipo: rol === "enfermera" ? "enfermera" : "medico",
            num_colegiado: ficha.num_colegiado?.trim() || null,
            dni: ficha.dni?.trim() || null,
            telefono: ficha.telefono?.trim() || null,
            email: ficha.email?.trim() || email,
            fecha_nacimiento: ficha.fecha_nacimiento || null,
            direccion: ficha.direccion?.trim() || null,
            bio: ficha.bio?.trim() || null,
          }).select("id").single();
          if (eM) {
            if (eM.code === "23505") return err("Ya existe un médico con ese DNI o número de colegiado");
            return err(`No se pudo crear la ficha del médico: ${eM.message}`, 500);
          }
          for (const areaId of areaIds) {
            const { error: eA2 } = await db().from("medico_areas").insert({ medico_id: m.id, area_id: areaId });
            if (eA2 && eA2.code !== "23505") { await db().from("medicos").delete().eq("id", m.id); return err(eA2.message, 500); }
          }
          for (const t of tramosFicha) {
            const { error: eH } = await db().from("horarios").insert({
              medico_id: m.id, dia_semana: Number(t.dia_semana), hora_inicio: t.hora_inicio, hora_fin: t.hora_fin });
            if (eH) { await db().from("medicos").delete().eq("id", m.id); return err(`Horario no válido: ${eH.message}`, 500); }
          }
          fichaId = m.id;
          void auditar(u, "config.medico.crear", { tipo: "medico", id: String(m.id), label: ficha.nombre.trim() },
            { origen: "alta_usuario", num_colegiado: ficha.num_colegiado ?? null, dni: ficha.dni ?? null, areas: areaIds });
        }

        // 2. Crear el usuario de acceso (queda dado de alta directamente, sin email de confirmación)
        const { data: nuevo, error: eA } = await db().auth.admin.createUser({
          email, password, email_confirm: true,
        });
        if (eA) {
          // deshacer la ficha recién creada para no dejarla huérfana
          if (fichaId && ficha && !medico_id) await db().from("medicos").delete().eq("id", fichaId);
          return err(`No se pudo crear el acceso: ${eA.message}`, 500);
        }
        // 3. Su fila de rol en el panel, ya vinculada a la ficha
        const { error: eI } = await db().from("usuarios_panel").insert({
          user_id: nuevo.user.id, email, nombre: nombre ?? ficha?.nombre ?? null, rol, medico_id: fichaId,
        });
        if (eI) return err(eI.message, 500);
        void auditar(u, "usuario.crear", { tipo: "usuario", id: nuevo.user.id, label: email },
          { rol, nombre: nombre ?? ficha?.nombre ?? null, medico_id: fichaId, ficha_creada: Boolean(ficha && !medico_id) }); // la contraseña NUNCA se registra
        return json({ ok: true, medico_id: fichaId });
      }
      if (metodo === "PATCH" && r1) {
        const cambios: Record<string, unknown> = {};
        for (const k of ["nombre", "rol", "medico_id", "activo"]) if (k in body) cambios[k] = body[k];
        if (u.rol !== "admin" && cambios.rol === "admin") return err("Solo un admin puede conceder el rol admin", 403);
        if (r1 === u.user_id && cambios.activo === false) return err("No puedes desactivarte a ti mismo");
        // Vinculación usuario ↔ ficha: se fija UNA vez y no la cambia nadie
        if ("medico_id" in cambios) {
          const { data: actualU } = await db().from("usuarios_panel").select("medico_id").eq("user_id", r1).maybeSingle();
          if (actualU?.medico_id)
            return err("La vinculación con la ficha de médico es fija: una vez establecida no se puede cambiar ni quitar.", 403);
          if (cambios.medico_id) {
            const { data: ocupada } = await db().from("usuarios_panel").select("email").eq("medico_id", cambios.medico_id).limit(1);
            if ((ocupada?.length ?? 0) > 0)
              return err(`Esa ficha ya está vinculada al usuario ${ocupada![0].email}. La vinculación es única.`);
          } else {
            delete cambios.medico_id; // quitar un vínculo no existe como operación
          }
        }
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
      // config gestiona todos; cualquier usuario con ficha vinculada gestiona SOLO el suyo
      const propio = Boolean(u.medico_id);
      if (!puede(u, "config") && !propio) return err("Sin permiso", 403);
      if (metodo === "POST") {
        const datos = { ...body };
        if (!puede(u, "config")) datos.medico_id = u.medico_id; // el servidor fuerza el suyo
        if (!datos.medico_id) datos.medico_id = u.medico_id;    // Mi agenda de un directivo-médico
        const { error } = await db().from("horarios").insert(datos);
        if (!error) void auditar(u, propio && !puede(u, "config") ? "mi_agenda.horario.crear" : "config.horario.crear", { tipo: "horario" }, datos);
        return error ? err(error.message, 500) : json({ ok: true });
      }
      if (metodo === "DELETE" && r1) {
        const { data: fila } = await db().from("horarios").select("*").eq("id", Number(r1)).maybeSingle();
        if (!fila) return err("Tramo no encontrado", 404);
        if (!puede(u, "config") && fila.medico_id !== u.medico_id) return err("Solo puedes tocar tu propio horario", 403);
        const { error } = await db().from("horarios").delete().eq("id", Number(r1));
        if (!error) void auditar(u, !puede(u, "config") ? "mi_agenda.horario.eliminar" : "config.horario.eliminar", { tipo: "horario", id: r1 }, { eliminado: fila });
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
      const propio = Boolean(u.medico_id);
      if (!puede(u, "config") && !propio) return err("Sin permiso", 403);
      if (metodo === "POST") {
        const { fecha_inicio, hora_inicio, fecha_fin, hora_fin, motivo } = body;
        const medico_id = !puede(u, "config") ? u.medico_id : (body.medico_id ?? u.medico_id);
        if (!medico_id || !fecha_inicio || !fecha_fin) return err("Faltan datos del bloqueo");
        const ini = madridAUtc(fecha_inicio, hora_inicio ?? "00:00").toISOString();
        const fin = madridAUtc(fecha_fin, hora_fin ?? "23:59").toISOString();
        // REGLA: no se puede bloquear encima de citas reservadas — primero hay que resolverlas
        const { data: conflicto } = await db().from("citas")
          .select("id, inicio, fin, estado, pacientes(nombre, apellidos, telefono), tratamientos(nombre)")
          .or(`medico_id.eq.${medico_id},enfermera_id.eq.${medico_id}`)
          .in("estado", ["pendiente", "confirmada", "en_espera", "en_consulta"])
          .lt("inicio", fin).gt("fin", ini).order("inicio");
        if ((conflicto?.length ?? 0) > 0) {
          return json({
            error: `Hay ${conflicto!.length} cita(s) reservadas dentro de ese periodo. Resuélvelas primero (cancelar → lista de espera, con aviso automático al paciente) y vuelve a crear el bloqueo.`,
            citas_conflicto: conflicto,
          }, 409);
        }
        const { error } = await db().from("bloqueos").insert({ medico_id, inicio: ini, fin, motivo: motivo ?? null });
        if (!error) void auditar(u, !puede(u, "config") ? "mi_agenda.bloqueo.crear" : "config.bloqueo.crear", { tipo: "bloqueo" }, { medico_id, fecha_inicio, fecha_fin, hora_inicio: hora_inicio ?? null, hora_fin: hora_fin ?? null, motivo });
        return error ? err(error.message, 500) : json({ ok: true });
      }
      if (metodo === "DELETE" && r1) {
        const { data: fila } = await db().from("bloqueos").select("*").eq("id", Number(r1)).maybeSingle();
        if (!fila) return err("Bloqueo no encontrado", 404);
        if (!puede(u, "config") && fila.medico_id !== u.medico_id) return err("Solo puedes tocar tus propios bloqueos", 403);
        const { error } = await db().from("bloqueos").delete().eq("id", Number(r1));
        if (!error) void auditar(u, !puede(u, "config") ? "mi_agenda.bloqueo.eliminar" : "config.bloqueo.eliminar", { tipo: "bloqueo", id: r1 }, { eliminado: fila });
        return error ? err(error.message, 500) : json({ ok: true });
      }
      return err("Método no soportado", 405);
    }

    // ---------- Mi agenda (autogestión de quien tenga ficha: médico, enfermería o directivo-médico) ----------
    case "mi-agenda": {
      if (!u.medico_id)
        return err("Tu usuario no está vinculado a ninguna ficha de médico (Configuración → Usuarios y permisos)", 403);
      if (metodo === "GET") {
        const [{ data: ficha }, { data: horarios }, { data: bloqueos }, { data: citasProx }] = await Promise.all([
          db().from("medicos")
            .select("id, nombre, tipo, antelacion_horas, tolerancia_fin_min, num_colegiado, dni, telefono, email, fecha_nacimiento, direccion, bio, medico_areas(areas(nombre))")
            .eq("id", u.medico_id).maybeSingle(),
          db().from("horarios").select("id, dia_semana, hora_inicio, hora_fin").eq("medico_id", u.medico_id).order("dia_semana").order("hora_inicio"),
          db().from("bloqueos").select("id, inicio, fin, motivo").eq("medico_id", u.medico_id).gte("fin", new Date().toISOString()).order("inicio"),
          db().from("citas").select("id", { count: "exact", head: false }).eq("medico_id", u.medico_id)
            .in("estado", ["pendiente", "confirmada", "en_espera", "en_consulta"]).gte("inicio", new Date().toISOString()).limit(1),
        ]);
        return json({ ficha, horarios: horarios ?? [], bloqueos: bloqueos ?? [], tiene_citas_futuras: (citasProx?.length ?? 0) > 0 });
      }
      if (metodo === "PATCH") {
        const cambios: Record<string, unknown> = {};
        if ("antelacion_horas" in body) {
          const horas = Number(body.antelacion_horas);
          if (!Number.isFinite(horas) || horas < 0 || horas > 336) return err("Antelación no válida (0 a 336 horas)");
          cambios.antelacion_horas = horas;
        }
        if ("tolerancia_fin_min" in body) {
          const min = Number(body.tolerancia_fin_min);
          if (!Number.isFinite(min) || min < 0 || min > 120) return err("Tolerancia no válida (0 a 120 minutos)");
          cambios.tolerancia_fin_min = min;
        }
        // El médico solo edita sus datos de CONTACTO. Lo identificativo (nombre,
        // nº colegiado, DNI, nacimiento, áreas, tipo) lo cambia solo dirección.
        for (const k of ["telefono", "email", "direccion", "bio"]) if (k in body) cambios[k] = body[k] || null;
        if (!Object.keys(cambios).length) return err("Nada que actualizar");
        const { error } = await db().from("medicos").update(cambios).eq("id", u.medico_id);
        if (error) return err(error.message, 500);
        void auditar(u, "mi_agenda.perfil.editar", { tipo: "medico", id: String(u.medico_id) }, { cambios });
        return json({ ok: true });
      }
      return err("Método no soportado", 405);
    }

    // ================= HISTORIA CLÍNICA =================

    // ---------- Buscador CIE-10 ----------
    case "cie10": {
      const ambito = await ambitoClinico(u);
      if (!ambito) return errAmbito(u);
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
        // Mis pacientes: pacientes con asignación activa a la ficha del usuario
        // (rol médico, o directivo/admin que también pasa consulta)
        if (q.get("mias") === "1") {
          if (!u.medico_id) return errAmbito(u);
          const { data, error } = await db()
            .from("paciente_medico_area")
            .select("paciente_id, area_id, areas(nombre), pacientes(id, nombre, apellidos, telefono, activo)")
            .eq("medico_id", u.medico_id).eq("activo", true)
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
      if (!ambito) return errAmbito(u);
      const pacienteId = Number(q.get("paciente_id"));
      if (!pacienteId) return err("Falta paciente_id");
      if (!(await puedeVerPaciente(ambito, pacienteId))) return err("Este paciente no está asignado a ti", 403);

      let consQ = db()
        .from("consultas")
        .select("id, fecha, motivo, exploracion, juicio_clinico, plan, tratamiento, notas, estado, version_number, editada, editada_at, editado_por, area_id, medico_id, cita_id, medicos(nombre), areas(nombre)")
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
      if (!ambito) return errAmbito(u);

      // Versiones anteriores de una consulta (histórico inmutable)
      if (metodo === "GET" && r1 && r2 === "versiones") {
        const { data: consulta } = await db().from("consultas")
          .select("paciente_id, area_id").eq("id", Number(r1)).maybeSingle();
        if (!consulta) return err("Consulta no encontrada", 404);
        if (!ambito.total && !ambito.areas.includes(consulta.area_id)) return err("Fuera de tu área", 403);
        if (!(await puedeVerPaciente(ambito, consulta.paciente_id))) return err("Este paciente no está asignado a ti", 403);
        const { data, error } = await db().from("consultas_versiones")
          .select("version_number, motivo, exploracion, juicio_clinico, plan, tratamiento, notas, editado_por, motivo_edicion, created_at")
          .eq("consulta_id", Number(r1)).order("version_number", { ascending: false });
        if (error) return err(error.message, 500);
        void logAccesoHistoria(u, consulta.paciente_id, `consulta:${r1}:versiones`);
        return json(data);
      }

      if (metodo === "POST") {
        const { paciente_id, area_id, motivo, exploracion, juicio_clinico, plan, tratamiento, notas, cita_id, estado, diagnosticos, constantes, duracion_seg } = body;
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
          motivo: motivo.trim(), exploracion: exploracion ?? null, juicio_clinico: juicio_clinico ?? null, plan: plan ?? null,
          tratamiento: tratamiento ?? null, notas: notas ?? null,
          estado: estado === "firmada" ? "firmada" : "borrador",
          // Cronómetro SILENCIOSO: el médico no lo ve; dirección lo analiza en Métricas
          duracion_seg: Number.isFinite(Number(duracion_seg)) ? Math.min(14400, Math.max(0, Math.round(Number(duracion_seg)))) : null,
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
        // FLUJO DE CLÍNICA: guardar el MEAP CIERRA la cita vinculada → completada + fin del contador.
        // Si no vino cita_id explícita, se busca la cita EN CONSULTA de este paciente con este médico.
        let citaCerrar: number | null = cita_id ? Number(cita_id) : null;
        if (!citaCerrar) {
          const { data: abierta } = await db().from("citas").select("id")
            .eq("paciente_id", Number(paciente_id)).eq("medico_id", Number(medicoId)).eq("estado", "en_consulta")
            .order("inicio", { ascending: false }).limit(1).maybeSingle();
          citaCerrar = abierta?.id ?? null;
        }
        if (citaCerrar) {
          await db().from("citas")
            .update({ estado: "completada", consulta_fin_at: new Date().toISOString() })
            .eq("id", citaCerrar)
            .in("estado", ["en_espera", "en_consulta"]); // sin llegada/consulta no se completa nada
          void auditar(u, "cita.completada_por_consulta", { tipo: "cita", id: String(citaCerrar) }, { consulta_id: creada.id });
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
        for (const k of ["motivo", "exploracion", "juicio_clinico", "plan", "tratamiento", "notas"]) if (k in body) cambios[k] = body[k];
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

    // ---------- Lista de espera ----------
    case "lista-espera": {
      // medico → entradas de SUS áreas; gestion (recepción/dirección/admin) → todas
      const esGestion = puede(u, "gestion");
      let areasMedico: number[] | null = null;
      if (!esGestion) {
        const ambito = await ambitoClinico(u);
        if (!ambito) return err("Sin permiso", 403);
        areasMedico = ambito.total ? null : ambito.areas;
      }
      if (metodo === "GET") {
        const verResueltas = q.get("resueltas") === "1";
        let lq = db()
          .from("lista_espera")
          .select("id, paciente_id, area_id, medico_id, tratamiento_id, preferencia, estado, notas, creada_via, cita_id, created_at, resuelta_at, pacientes(nombre, apellidos, telefono), areas(nombre), medicos(nombre), tratamientos(nombre)")
          .order("created_at"); // antigüedad primero: el que más espera, arriba
        lq = verResueltas
          ? lq.in("estado", ["agendada", "cancelada"]).order("resuelta_at", { ascending: false }).limit(100)
          : lq.in("estado", ["pendiente", "contactado"]);
        if (areasMedico) lq = lq.in("area_id", areasMedico.length ? areasMedico : [-1]);
        const { data, error } = await lq;
        if (error) return err(error.message, 500);
        return json(data);
      }
      if (metodo === "POST") {
        if (!esGestion) return err("Sin permiso", 403);
        const { paciente_id, area_id, medico_id, tratamiento_id, preferencia } = body;
        if (!paciente_id || !area_id) return err("Faltan paciente o área");
        const { data, error } = await db().from("lista_espera").insert({
          paciente_id, area_id, medico_id: medico_id ?? null, tratamiento_id: tratamiento_id ?? null,
          preferencia: preferencia ?? null, creada_via: "panel",
        }).select("id").single();
        if (error) {
          if (error.code === "23505") return err("Este paciente ya está en la lista de espera de ese área.");
          return err(error.message, 500);
        }
        void auditar(u, "lista_espera.crear", { tipo: "lista_espera", id: String(data.id) },
          { paciente_id, area_id, medico_id: medico_id ?? null, preferencia: preferencia ?? null });
        return json({ ok: true, id: data.id });
      }
      if (metodo === "PATCH" && r1) {
        const { data: actual } = await db()
          .from("lista_espera").select("paciente_id, area_id, estado, notas").eq("id", Number(r1)).maybeSingle();
        if (!actual) return err("Entrada no encontrada", 404);
        if (areasMedico && !areasMedico.includes(actual.area_id)) return err("Fuera de tu área", 403);
        const cambios: Record<string, unknown> = {};
        if ("estado" in body) {
          if (!["pendiente", "contactado", "agendada", "cancelada"].includes(body.estado)) return err("Estado no válido");
          cambios.estado = body.estado;
          if (body.estado === "agendada" || body.estado === "cancelada") cambios.resuelta_at = new Date().toISOString();
        }
        if ("notas" in body) cambios.notas = body.notas;
        if ("cita_id" in body) cambios.cita_id = body.cita_id;
        if (!Object.keys(cambios).length) return err("Nada que actualizar");
        const { error } = await db().from("lista_espera").update(cambios).eq("id", Number(r1));
        if (error) return err(error.message, 500);
        void auditar(u, "lista_espera.actualizar", { tipo: "lista_espera", id: r1 },
          { antes: { estado: actual.estado, notas: actual.notas }, despues: cambios, paciente_id: actual.paciente_id });
        return json({ ok: true });
      }
      return err("Método no soportado", 405);
    }

    // ---------- Documentos del paciente (fotos antes/después, consentimientos, pruebas) ----------
    case "documentos-paciente": {
      const ambito = await ambitoClinico(u);
      if (!ambito) return errAmbito(u);

      if (metodo === "GET" && r1 && r2 === "ver") {
        const { data: doc } = await db().from("paciente_documentos").select("paciente_id, path, titulo").eq("id", Number(r1)).maybeSingle();
        if (!doc) return err("Documento no encontrado", 404);
        if (!(await puedeVerPaciente(ambito, doc.paciente_id))) return err("Este paciente no está asignado a ti", 403);
        const { data: signed, error } = await db().storage.from("docs-pacientes").createSignedUrl(doc.path, 300);
        if (error) return err(error.message, 500);
        void logAccesoHistoria(u, doc.paciente_id, `documento:${r1}:ver`, { titulo: doc.titulo });
        return json({ url: signed.signedUrl });
      }
      if (metodo === "GET") {
        const pacienteId = Number(q.get("paciente_id"));
        if (!pacienteId) return err("Falta paciente_id");
        if (!(await puedeVerPaciente(ambito, pacienteId))) return err("Este paciente no está asignado a ti", 403);
        const { data, error } = await db().from("paciente_documentos")
          .select("id, categoria, titulo, mime, bytes, subido_por, consulta_id, created_at")
          .eq("paciente_id", pacienteId).order("created_at", { ascending: false });
        if (error) return err(error.message, 500);
        void logAccesoHistoria(u, pacienteId, "documentos:listar", { total: data?.length ?? 0 });
        return json(data);
      }
      if (metodo === "POST") {
        const fd = await req.formData().catch(() => null);
        const archivo = fd?.get("archivo") as File | null;
        const pacienteId = Number(fd?.get("paciente_id"));
        const categoria = String(fd?.get("categoria") ?? "otro");
        const titulo = String(fd?.get("titulo") ?? "").trim();
        const consultaId = fd?.get("consulta_id") ? Number(fd?.get("consulta_id")) : null;
        if (!archivo || !pacienteId || !titulo) return err("Faltan el archivo, el paciente o el título");
        if (!(await puedeVerPaciente(ambito, pacienteId))) return err("Este paciente no está asignado a ti", 403);
        if (archivo.size > 15 * 1024 * 1024) return err("Máximo 15 MB");
        const ext = (archivo.name.split(".").pop() ?? "").toLowerCase();
        if (!["pdf", "jpg", "jpeg", "png", "webp", "heic"].includes(ext)) return err("Formato no válido: PDF, JPG, PNG, WEBP o HEIC");
        const path = `paciente-${pacienteId}/${Date.now()}-${categoria}.${ext}`;
        const buf = Buffer.from(await archivo.arrayBuffer());
        const { error: eU } = await db().storage.from("docs-pacientes")
          .upload(path, buf, { contentType: archivo.type || "application/octet-stream" });
        if (eU) return err(eU.message, 500);
        const { data: fila, error } = await db().from("paciente_documentos").insert({
          paciente_id: pacienteId, consulta_id: consultaId, categoria, titulo,
          path, mime: archivo.type || null, bytes: archivo.size, subido_por: u.email,
        }).select("id").single();
        if (error) return err(error.message, 500);
        void auditar(u, "paciente.documento.subir", { tipo: "paciente", id: String(pacienteId) },
          { documento_id: fila.id, categoria, titulo, bytes: archivo.size });
        void logAccesoHistoria(u, pacienteId, `documento:${fila.id}:subir`, { categoria, titulo });
        return json({ ok: true, id: fila.id });
      }
      if (metodo === "DELETE" && r1) {
        if (!puede(u, "usuarios")) return err("Solo dirección o admin pueden eliminar documentos clínicos", 403);
        const { data: doc } = await db().from("paciente_documentos").select("*").eq("id", Number(r1)).maybeSingle();
        if (!doc) return err("Documento no encontrado", 404);
        await db().storage.from("docs-pacientes").remove([doc.path]);
        const { error } = await db().from("paciente_documentos").delete().eq("id", Number(r1));
        if (error) return err(error.message, 500);
        void auditar(u, "paciente.documento.eliminar", { tipo: "paciente", id: String(doc.paciente_id) },
          { eliminado: { categoria: doc.categoria, titulo: doc.titulo, path: doc.path } });
        return json({ ok: true });
      }
      return err("Método no soportado", 405);
    }

    // ---------- Actividad y rendimiento (SOLO dirección/admin — cronómetro silencioso) ----------
    case "metricas-medicos": {
      if (!["admin", "direccion"].includes(u.rol)) return err("Solo para dirección o admin", 403);
      const desde = new Date(Date.now() - 90 * 86400_000).toISOString();
      const [{ data: meds }, { data: cons }, { data: citas }, { data: asig }, { data: areasL }, { data: tratsL }] = await Promise.all([
        db().from("medicos").select("id, nombre, tipo").eq("activo", true).order("nombre"),
        db().from("consultas").select("medico_id, area_id, duracion_seg").gte("fecha", desde),
        db().from("citas").select("medico_id, tratamiento_id, inicio, fin, llegada_at, consulta_inicio_at, consulta_fin_at").eq("estado", "completada").gte("inicio", desde),
        db().from("paciente_medico_area").select("medico_id").eq("activo", true),
        db().from("areas").select("id, nombre"),
        db().from("tratamientos").select("id, nombre, area_id"),
      ]);
      const horasDe = (arr: any[]) =>
        Math.round(arr.reduce((t: number, c: any) => t + (new Date(c.fin).getTime() - new Date(c.inicio).getTime()), 0) / 3600_000 * 10) / 10;
      const mediaMin = (arr: any[]) => {
        const con = arr.filter((c: any) => c.duracion_seg != null);
        return con.length ? Math.round(con.reduce((t: number, c: any) => t + c.duracion_seg, 0) / con.length / 60) : null;
      };
      // Espera media en sala: SOLO cuenta desde la HORA DE LA CITA (llegar antes no es espera)
      const esperaMedia = (arr: any[]) => {
        const con = arr.filter((c: any) => c.llegada_at && c.consulta_inicio_at);
        if (!con.length) return null;
        const tot = con.reduce((s: number, c: any) =>
          s + Math.max(0, new Date(c.consulta_inicio_at).getTime() - Math.max(new Date(c.llegada_at).getTime(), new Date(c.inicio).getTime())), 0);
        return Math.round(tot / con.length / 60_000);
      };
      // Tiempo REAL en consulta (del "Empezar consulta" al cierre) — el médico no lo ve nunca
      const consultaRealMedia = (arr: any[]) => {
        const con = arr.filter((c: any) => c.consulta_inicio_at && c.consulta_fin_at);
        if (!con.length) return null;
        return Math.round(con.reduce((s: number, c: any) =>
          s + (new Date(c.consulta_fin_at).getTime() - new Date(c.consulta_inicio_at).getTime()), 0) / con.length / 60_000);
      };

      const medicos = (meds ?? []).map((m: any) => {
        const suyas = (cons ?? []).filter((c: any) => c.medico_id === m.id);
        const citasM = (citas ?? []).filter((c: any) => c.medico_id === m.id);
        return {
          medico_id: m.id, nombre: m.nombre, tipo: m.tipo,
          consultas_90d: suyas.length,
          media_min_consulta: mediaMin(suyas),
          espera_media_min: esperaMedia(citasM),
          consulta_real_media_min: consultaRealMedia(citasM),
          citas_completadas_90d: citasM.length,
          horas_citas_90d: horasDe(citasM),
          pacientes_asignados: (asig ?? []).filter((a: any) => a.medico_id === m.id).length,
        };
      });

      // Rendimiento por ÁREA (consultas del área + citas de tratamientos del área)
      const areas = (areasL ?? []).map((a: any) => {
        const consA = (cons ?? []).filter((c: any) => c.area_id === a.id);
        const tratIds = (tratsL ?? []).filter((t: any) => t.area_id === a.id).map((t: any) => t.id);
        const citasA = (citas ?? []).filter((c: any) => tratIds.includes(c.tratamiento_id));
        return {
          area_id: a.id, nombre: a.nombre,
          consultas_90d: consA.length,
          media_min_consulta: mediaMin(consA),
          citas_completadas_90d: citasA.length,
          horas_citas_90d: horasDe(citasA),
        };
      }).filter((a: any) => a.consultas_90d > 0 || a.citas_completadas_90d > 0);

      // Rendimiento por TRATAMIENTO (citas completadas)
      const tratamientos = (tratsL ?? []).map((t: any) => {
        const citasT = (citas ?? []).filter((c: any) => c.tratamiento_id === t.id);
        const mediaCita = citasT.length
          ? Math.round(citasT.reduce((s: number, c: any) => s + (new Date(c.fin).getTime() - new Date(c.inicio).getTime()), 0) / citasT.length / 60_000)
          : null;
        return {
          tratamiento_id: t.id, nombre: t.nombre,
          area: (areasL ?? []).find((a: any) => a.id === t.area_id)?.nombre ?? null,
          citas_completadas_90d: citasT.length,
          horas_90d: horasDe(citasT),
          media_min_cita: mediaCita,
        };
      }).filter((t: any) => t.citas_completadas_90d > 0)
        .sort((a: any, b: any) => b.citas_completadas_90d - a.citas_completadas_90d);

      return json({ medicos, areas, tratamientos });
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
      if (!ambito) return errAmbito(u);
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
