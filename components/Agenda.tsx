"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, fmtHora, hoyISO } from "./api";

type Modo = "dia" | "semana" | "mes";
const DIAS_SEMANA = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

interface Cita {
  id: number; medico_id: number; inicio: string; estado: string;
  confirmada_paciente?: boolean; notas?: string | null;
  reactiva?: boolean; enfermera_id?: number | null; es_apoyo?: boolean;
  llegada_at?: string | null; consulta_inicio_at?: string | null; consulta_fin_at?: string | null;
  pacientes?: { id: number; nombre: string | null; apellidos: string | null; telefono: string; alta_completa?: boolean } | null;
  tratamientos?: { nombre: string } | null;
}

const ETIQUETA_ESTADO: Record<string, string> = {
  pendiente: "pendiente", confirmada: "confirmada", en_espera: "en espera",
  en_consulta: "en consulta", completada: "completada", cancelada: "cancelada", no_show: "no vino",
};
const ICONO_ESTADO: Record<string, string> = { en_espera: "🪑", en_consulta: "🩺", completada: "✓" };

/** Minutos de espera REAL: solo cuenta desde su hora de cita (llegar antes no es esperar). */
const minEspera = (c: Cita) => {
  if (!c.llegada_at) return null;
  const desde = Math.max(new Date(c.llegada_at).getTime(), new Date(c.inicio).getTime());
  const hasta = c.consulta_inicio_at ? new Date(c.consulta_inicio_at).getTime() : Date.now();
  return Math.max(0, Math.round((hasta - desde) / 60000));
};
interface Medico { id: number; nombre: string; tipo?: string; medico_areas?: { area_id: number; areas: { nombre: string } | null }[]; horario?: { hora_inicio: string; hora_fin: string }[]; citas?: Cita[] }

const sumaDias = (fecha: string, n: number) => {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const lunesDe = (fecha: string) => {
  const d = new Date(`${fecha}T12:00:00Z`);
  return sumaDias(fecha, -((d.getUTCDay() + 6) % 7));
};
const fmtDiaCorto = (fecha: string) =>
  new Date(`${fecha}T12:00:00Z`).toLocaleDateString("es-ES", { day: "numeric", month: "short" });

export default function Agenda({ medicoId = null, rol = "" }: { medicoId?: number | null; rol?: string }) {
  const [modo, setModo] = useState<Modo>("dia");
  const [fecha, setFecha] = useState(hoyISO());
  const [error, setError] = useState("");
  const [nueva, setNueva] = useState<{ medico_id?: number; hora?: string } | null>(null);
  const [medicos, setMedicos] = useState<Medico[]>([]);
  const [refresco, setRefresco] = useState(0);
  const [soloYo, setSoloYo] = useState(false); // directivo-médico: ver solo su columna
  const soloId = soloYo && medicoId ? medicoId : null;
  const recargar = () => setRefresco((n) => n + 1);

  useEffect(() => { api<Medico[]>("medicos").then((m) => setMedicos(m.filter((x: any) => x.activo))).catch(() => {}); }, []);

  const saltoDia = modo === "dia" ? 1 : modo === "semana" ? 7 : 30;
  const titulo =
    modo === "dia"
      ? new Date(`${fecha}T12:00:00Z`).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
      : modo === "semana"
      ? `Semana del ${fmtDiaCorto(lunesDe(fecha))}`
      : new Date(`${fecha}T12:00:00Z`).toLocaleDateString("es-ES", { month: "long", year: "numeric" });

  return (
    <>
      <div className="fila">
        <div className="subtabs" style={{ marginBottom: 0 }}>
          {(["dia", "semana", "mes"] as Modo[]).map((m) => (
            <button key={m} className={modo === m ? "on" : ""} onClick={() => setModo(m)}>
              {m === "dia" ? "Día" : m === "semana" ? "Semana" : "Mes"}
            </button>
          ))}
        </div>
        <button className="btn suave mini" onClick={() => setFecha(sumaDias(fecha, -saltoDia))}>←</button>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={{ width: 150 }} />
        <button className="btn suave mini" onClick={() => setFecha(sumaDias(fecha, saltoDia))}>→</button>
        <button className="btn suave mini" onClick={() => setFecha(hoyISO())}>Hoy</button>
        {medicoId && (
          <button className={`btn mini ${soloYo ? "oro" : "suave"}`} title="Ver solo tu columna de citas"
            onClick={() => setSoloYo(!soloYo)}>👤 Solo mi columna</button>
        )}
        <div style={{ flex: 1 }} />
        <button className="btn oro" onClick={() => setNueva({})}>+ Nueva cita</button>
      </div>
      <h2 className="seccion" style={{ textTransform: "none", letterSpacing: 1 }}>{titulo}</h2>
      {error && <div className="error">{error}</div>}

      {modo === "dia" && <VistaDia fecha={fecha} refresco={refresco} soloId={soloId} miFicha={medicoId} rol={rol} onError={setError} onNueva={(m, h) => setNueva({ medico_id: m, hora: h })} onCambio={recargar} />}
      {modo === "semana" && <VistaSemana fecha={fecha} refresco={refresco} soloId={soloId} onIrDia={(f) => { setFecha(f); setModo("dia"); }} />}
      {modo === "mes" && <VistaMes fecha={fecha} refresco={refresco} soloId={soloId} onIrDia={(f) => { setFecha(f); setModo("dia"); }} />}

      {nueva && (
        <NuevaCita
          fecha={fecha}
          medicos={medicos}
          preMedico={nueva.medico_id}
          preHora={nueva.hora}
          onCerrar={() => { setNueva(null); recargar(); }}
        />
      )}
    </>
  );
}

/* ================= VISTA DÍA: tabla horas × doctores ================= */

function VistaDia({ fecha, refresco, soloId, miFicha, rol, onError, onNueva, onCambio }:
  { fecha: string; refresco: number; soloId: number | null; miFicha: number | null; rol: string; onError: (e: string) => void; onNueva: (medico: number, hora: string) => void; onCambio: () => void }) {
  const [crudo, setCrudo] = useState<{ medicos: Medico[] } | null>(null);
  const [sel, setSel] = useState<Cita | null>(null);
  const datos = useMemo(() => crudo && ({ ...crudo, medicos: crudo.medicos.filter((m) => !soloId || m.id === soloId) }), [crudo, soloId]);
  const esGestion = ["admin", "direccion", "recepcion"].includes(rol);
  // Tic por minuto: mantiene fresco el "lleva X min esperando" sin recargar
  const [, setTic] = useState(0);
  useEffect(() => { const t = setInterval(() => setTic((n) => n + 1), 60_000); return () => clearInterval(t); }, []);

  useEffect(() => {
    api<{ medicos: Medico[] }>(`agenda?fecha=${fecha}`).then((d) => { setCrudo(d); onError(""); }).catch((e) => onError(e.message));
  }, [fecha, refresco, onError]);

  const franjas = useMemo(() => {
    let min = 9 * 60, max = 20 * 60;
    for (const m of datos?.medicos ?? []) {
      for (const h of m.horario ?? []) {
        const i = parseInt(String(h.hora_inicio).slice(0, 2)) * 60 + parseInt(String(h.hora_inicio).slice(3, 5));
        const f = parseInt(String(h.hora_fin).slice(0, 2)) * 60 + parseInt(String(h.hora_fin).slice(3, 5));
        min = Math.min(min, i); max = Math.max(max, f);
      }
      for (const c of m.citas ?? []) {
        const hm = fmtHora(c.inicio);
        const v = parseInt(hm.slice(0, 2)) * 60 + parseInt(hm.slice(3, 5));
        min = Math.min(min, v); max = Math.max(max, v + 30);
      }
    }
    const out: string[] = [];
    for (let t = min; t < max; t += 30) out.push(`${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`);
    return out;
  }, [datos]);

  const enHorario = (m: Medico, franja: string) =>
    (m.horario ?? []).some((h) => String(h.hora_inicio).slice(0, 5) <= franja && franja < String(h.hora_fin).slice(0, 5));

  if (!datos) return <p className="nota">Cargando agenda…</p>;

  return (
    <>
      <div className="tabla-scroll">
        <table className="tabla-agenda">
          <thead>
            <tr>
              <th className="th-hora"></th>
              {datos.medicos.map((m) => (
                <th key={m.id} className={m.tipo === "enfermera" ? "th-enf" : ""}>
                  {m.nombre}
                  <small>{[m.tipo === "enfermera" ? "Enfermería" : null, ...(m.medico_areas ?? []).map((x) => x.areas?.nombre)].filter(Boolean).join(" · ")}</small>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {franjas.map((f) => (
              <tr key={f}>
                <td className="td-hora">{f}</td>
                {datos.medicos.map((m) => {
                  const citas = (m.citas ?? []).filter((c) => {
                    const h = fmtHora(c.inicio);
                    return h >= f && h < sumarFranja(f);
                  });
                  const abierto = enHorario(m, f);
                  return (
                    <td key={m.id} className={abierto ? "td-libre" : "td-cerrado"}
                      onClick={() => citas.length === 0 && abierto && onNueva(m.id, f)}>
                      {citas.map((c) => (
                        <div key={c.id} className={`bloque-cita ${c.estado}`}
                          style={c.es_apoyo ? { opacity: 0.75, borderLeftStyle: "dashed" } : undefined}
                          onClick={(e) => { e.stopPropagation(); setSel(c); }}>
                          <b>{fmtHora(c.inicio)}</b> {ICONO_ESTADO[c.estado] ? `${ICONO_ESTADO[c.estado]} ` : ""}{c.reactiva ? "⚡ " : ""}{c.pacientes && c.pacientes.alta_completa === false ? "⏳ " : ""}{[c.pacientes?.nombre, c.pacientes?.apellidos].filter(Boolean).join(" ") || c.pacientes?.telefono}
                          {c.es_apoyo && <small>apoyo</small>}
                          {c.tratamientos && <small>{c.tratamientos.nombre}</small>}
                        </div>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="nota">Clic en una casilla libre = nueva cita a esa hora · clic en una cita = gestionarla · gris = fuera de horario.</p>

      {sel && (
        <div className="modal-bg" onClick={() => setSel(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{fmtHora(sel.inicio)} · {[sel.pacientes?.nombre, sel.pacientes?.apellidos].filter(Boolean).join(" ") || sel.pacientes?.telefono}</h3>
            <p className="nota">{sel.tratamientos?.nombre ?? "Sin tratamiento asignado"} · <span className={`chip ${sel.estado}`}>{ETIQUETA_ESTADO[sel.estado] ?? sel.estado}{sel.confirmada_paciente ? " ✓" : ""}</span></p>
            {sel.pacientes && sel.pacientes.alta_completa === false && (
              <p className="nota" style={{ color: "var(--ambar)" }}>⏳ Paciente nuevo con <b>alta pendiente</b>: al llegar, completar su ficha en recepción (DNI, fecha de nacimiento y consentimiento de datos clínicos).</p>
            )}
            {sel.estado === "en_espera" && sel.llegada_at && (
              <p className="nota">
                🪑 En sala de espera desde las <b>{fmtHora(sel.llegada_at)}</b>
                {new Date(sel.llegada_at) < new Date(sel.inicio) && Date.now() < new Date(sel.inicio).getTime()
                  ? <> · llegó antes de su hora (la espera cuenta desde las {fmtHora(sel.inicio)})</>
                  : <> · lleva <b>{minEspera(sel)} min</b> esperando desde su hora</>}
              </p>
            )}
            {sel.estado === "en_consulta" && (
              <p className="nota">🩺 En consulta ahora mismo. Se cerrará sola al guardar la consulta (MEAP) del paciente, o con el botón Finalizar.</p>
            )}
            {sel.notas && <p className="nota">Notas: {sel.notas}</p>}
            <div className="fila" style={{ justifyContent: "flex-end" }}>
              {/* Llegada del paciente: la marca recepción/dirección/admin */}
              {esGestion && ["pendiente", "confirmada"].includes(sel.estado) && (
                <button className="btn mini oro" onClick={() => cambiar(sel.id, "en_espera")}>🪑 Ha llegado</button>
              )}
              {/* Empezar consulta: SOLO el titular de la cita (médico, directivo-médico o enfermera titular).
                  Si la enfermera va de apoyo, la empieza el médico y el estado se comparte. */}
              {miFicha === sel.medico_id && ["pendiente", "confirmada", "en_espera"].includes(sel.estado) && (
                <button className="btn mini oro" onClick={() => cambiar(sel.id, "en_consulta")}>🩺 Empezar consulta</button>
              )}
              {miFicha === sel.medico_id && sel.estado === "en_consulta" && (
                <button className="btn mini oro" onClick={() => cambiar(sel.id, "completada")}>✓ Finalizar consulta</button>
              )}
              {/* Corrección manual de gestión (por si el flujo no se siguió): marcar completada */}
              {esGestion && ["pendiente", "confirmada", "en_espera", "en_consulta"].includes(sel.estado) && (
                <button className="btn mini suave" onClick={() => cambiar(sel.id, "completada")}>Completada</button>
              )}
              {["pendiente", "confirmada", "en_espera"].includes(sel.estado) && (
                <>
                  <button className="btn mini suave" onClick={() => cambiar(sel.id, "no_show")}>No vino</button>
                  <button className="btn mini suave" onClick={() => { if (confirm("¿Cancelar esta cita?")) cambiar(sel.id, "cancelada"); }}>Cancelar cita</button>
                  <button className="btn mini suave" title="Cancela, apunta al paciente en lista de espera y Alexia le avisa por WhatsApp"
                    onClick={async () => {
                      if (!confirm("¿Cancelar y pasar al paciente a lista de espera? Alexia le avisará por WhatsApp y podrá reprogramar respondiendo.")) return;
                      try { await api(`citas/${sel.id}`, { method: "PATCH", body: { estado: "cancelada", a_lista_espera: true } }); setSel(null); onCambio(); }
                      catch (e: any) { alert(e.message); }
                    }}>Cancelar → espera 📩</button>
                </>
              )}
              <button className="btn suave" onClick={() => setSel(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  async function cambiar(id: number, estado: string) {
    try { await api(`citas/${id}`, { method: "PATCH", body: { estado } }); setSel(null); onCambio(); }
    catch (e: any) { alert(e.message); }
  }
}

const sumarFranja = (f: string) => {
  const t = parseInt(f.slice(0, 2)) * 60 + parseInt(f.slice(3, 5)) + 30;
  return `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
};

/* ================= VISTA SEMANA: doctores × días ================= */

function VistaSemana({ fecha, refresco, soloId, onIrDia }: { fecha: string; refresco: number; soloId: number | null; onIrDia: (f: string) => void }) {
  const lunes = lunesDe(fecha);
  const dias = Array.from({ length: 7 }, (_, i) => sumaDias(lunes, i));
  const [datos, setDatos] = useState<{ medicos: Medico[]; citas: Cita[] } | null>(null);

  useEffect(() => {
    api(`agenda?desde=${lunes}&hasta=${dias[6]}`).then(setDatos).catch(() => {});
  }, [lunes, refresco]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!datos) return <p className="nota">Cargando semana…</p>;
  const fechaDe = (c: Cita) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" }).format(new Date(c.inicio));

  return (
    <div className="tabla-scroll">
      <table className="tabla-agenda">
        <thead>
          <tr>
            <th className="th-hora"></th>
            {dias.map((d, i) => (
              <th key={d} className={d === hoyISO() ? "th-hoy" : ""}>{DIAS_SEMANA[i]}<small>{fmtDiaCorto(d)}</small></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {datos.medicos.filter((m) => !soloId || m.id === soloId).map((m) => (
            <tr key={m.id}>
              <td className="td-medico">{m.nombre}{m.tipo === "enfermera" && <small> · Enf.</small>}</td>
              {dias.map((d) => {
                const del = datos.citas.filter((c) => c.medico_id === m.id && fechaDe(c) === d);
                return (
                  <td key={d} className="td-libre td-centro" onClick={() => onIrDia(d)}>
                    {del.length > 0 ? (
                      <>
                        <b className="num-citas">{del.length}</b>
                        <small className="horas-mini">{del.slice(0, 3).map((c) => fmtHora(c.inicio)).join(" · ")}{del.length > 3 ? " …" : ""}</small>
                      </>
                    ) : <span className="sin-citas">—</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="nota">Clic en cualquier casilla para abrir ese día.</p>
    </div>
  );
}

/* ================= VISTA MES: calendario ================= */

function VistaMes({ fecha, refresco, soloId, onIrDia }: { fecha: string; refresco: number; soloId: number | null; onIrDia: (f: string) => void }) {
  const primero = `${fecha.slice(0, 7)}-01`;
  const inicioGrid = lunesDe(primero);
  const celdas = Array.from({ length: 42 }, (_, i) => sumaDias(inicioGrid, i));
  const [citas, setCitas] = useState<Cita[]>([]);

  useEffect(() => {
    api<{ citas: Cita[] }>(`agenda?desde=${inicioGrid}&hasta=${celdas[41]}`).then((d) => setCitas(d.citas)).catch(() => {});
  }, [inicioGrid, refresco]); // eslint-disable-line react-hooks/exhaustive-deps

  const mes = fecha.slice(0, 7);
  const porDia = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of citas) {
      if (soloId && c.medico_id !== soloId) continue;
      const f = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" }).format(new Date(c.inicio));
      m[f] = (m[f] ?? 0) + 1;
    }
    return m;
  }, [citas, soloId]);

  return (
    <div>
      <div className="mes-grid mes-cab">
        {DIAS_SEMANA.map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="mes-grid">
        {celdas.map((d) => (
          <div key={d}
            className={`mes-dia ${d.slice(0, 7) !== mes ? "otro-mes" : ""} ${d === hoyISO() ? "es-hoy" : ""}`}
            onClick={() => onIrDia(d)}>
            <span>{Number(d.slice(8, 10))}</span>
            {porDia[d] > 0 && <b className="mes-num">{porDia[d]} cita{porDia[d] > 1 ? "s" : ""}</b>}
          </div>
        ))}
      </div>
      <p className="nota">Clic en un día para abrir su agenda.</p>
    </div>
  );
}

/* ================= Modal nueva cita ================= */

function NuevaCita({ fecha, medicos, preMedico, preHora, onCerrar }:
  { fecha: string; medicos: Medico[]; preMedico?: number; preHora?: string; onCerrar: () => void }) {
  const [busca, setBusca] = useState("");
  const [pacientes, setPacientes] = useState<any[]>([]);
  const [pacienteId, setPacienteId] = useState<number | null>(null);
  const [medicoId, setMedicoId] = useState<number | null>(preMedico ?? medicos[0]?.id ?? null);
  const [tratamientos, setTratamientos] = useState<any[]>([]);
  const [tratId, setTratId] = useState<number | null>(null);
  const [dia, setDia] = useState(fecha);
  const [hora, setHora] = useState(preHora ?? "10:00");
  const [notas, setNotas] = useState("");
  const [enfermeraId, setEnfermeraId] = useState<number | "">("");
  const [error, setError] = useState("");
  const tratSel = tratamientos.find((t) => t.id === tratId);
  // Enfermeras de apoyo: si el tratamiento tiene área, solo las de ESA área
  const enfermeras = medicos.filter((m) =>
    m.tipo === "enfermera" &&
    (!tratSel?.area_id || (m.medico_areas ?? []).some((x) => x.area_id === tratSel.area_id)));

  useEffect(() => { api<any[]>("tratamientos").then(setTratamientos).catch(() => {}); }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      if (busca.trim().length >= 2) api<any[]>(`pacientes?q=${encodeURIComponent(busca)}`).then(setPacientes).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [busca]);

  async function guardar() {
    if (!pacienteId || !medicoId) { setError("Selecciona paciente y personal"); return; }
    const trat = tratamientos.find((t) => t.id === tratId);
    try {
      await api("citas", {
        method: "POST",
        body: { paciente_id: pacienteId, medico_id: medicoId, tratamiento_id: tratId, fecha: dia, hora, duracion_min: trat?.duracion_min ?? 30, notas: notas || null, enfermera_id: enfermeraId || null },
      });
      onCerrar();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="modal-bg" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Nueva cita</h3>
        <div className="campo">
          <label>Paciente (busca por nombre o teléfono)</label>
          <input value={busca} onChange={(e) => { setBusca(e.target.value); setPacienteId(null); }} placeholder="Ej. María / 34612..." autoFocus />
          {pacientes.length > 0 && !pacienteId && (
            <div style={{ border: "1px solid var(--linea)", borderRadius: 8, marginTop: 4, maxHeight: 140, overflow: "auto" }}>
              {pacientes.map((c) => (
                <div key={c.id} style={{ padding: "7px 10px", cursor: "pointer" }}
                  onClick={() => { setPacienteId(c.id); setBusca(`${c.nombre ?? ""} ${c.apellidos ?? ""} (${c.telefono})`); }}>
                  {c.nombre} {c.apellidos} · {c.telefono}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="campo"><label>Doctor/a o enfermería</label>
          <select value={medicoId ?? ""} onChange={(e) => setMedicoId(Number(e.target.value))}>
            {medicos.map((m) => <option key={m.id} value={m.id}>{m.nombre}{m.tipo === "enfermera" ? " (Enfermería)" : ""}</option>)}
          </select>
        </div>
        <div className="campo"><label>Tratamiento (opcional)</label>
          <select value={tratId ?? ""} onChange={(e) => setTratId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">— Sin especificar —</option>
            {tratamientos.filter((t) => t.activo).map((t) => <option key={t.id} value={t.id}>{t.nombre} ({t.duracion_min}′){t.requiere_enfermeria ? " · 💉" : ""}</option>)}
          </select>
        </div>
        {enfermeras.length > 0 && (
          <div className="campo">
            <label>Enfermera de apoyo {tratSel?.requiere_enfermeria ? "· este tratamiento la requiere 💉" : "(opcional)"}</label>
            <select value={enfermeraId} onChange={(e) => setEnfermeraId(e.target.value ? Number(e.target.value) : "")}
              style={tratSel?.requiere_enfermeria && !enfermeraId ? { borderColor: "var(--rojo)" } : undefined}>
              <option value="">— Sin apoyo —</option>
              {enfermeras.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
            </select>
            {enfermeraId !== "" && <p className="nota" style={{ margin: "4px 0 0", fontSize: 11.5 }}>La cita aparecerá también en su columna y ocupará su franja.</p>}
          </div>
        )}
        <div className="campo" style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><label>Fecha</label><input type="date" value={dia} onChange={(e) => setDia(e.target.value)} /></div>
          <div style={{ flex: 1 }}><label>Hora</label><input type="time" value={hora} onChange={(e) => setHora(e.target.value)} step={300} /></div>
        </div>
        <div className="campo"><label>Notas</label><input value={notas} onChange={(e) => setNotas(e.target.value)} /></div>
        {error && <div className="error">{error}</div>}
        <div className="fila" style={{ marginTop: 14, justifyContent: "flex-end" }}>
          <button className="btn suave" onClick={onCerrar}>Cerrar</button>
          <button className="btn oro" onClick={guardar}>Guardar cita</button>
        </div>
      </div>
    </div>
  );
}
