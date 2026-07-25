"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import { api, fmtFechaHora } from "./api";
import HistoriaClinica, { Asignaciones } from "./HistoriaClinica";
import ListaEspera from "./ListaEspera";

export default function Pacientes({ rol }: { rol?: string }) {
  const [sub, setSub] = useState<"pacientes" | "espera" | "escalados">("pacientes");
  return (
    <>
      <div className="subtabs">
        <button className={sub === "pacientes" ? "on" : ""} onClick={() => setSub("pacientes")}>Pacientes</button>
        <button className={sub === "espera" ? "on" : ""} onClick={() => setSub("espera")}>Lista de espera</button>
        <button className={sub === "escalados" ? "on" : ""} onClick={() => setSub("escalados")}>Conversaciones escaladas</button>
      </div>
      {sub === "pacientes" && <ListaPacientes rol={rol} />}
      {sub === "espera" && <ListaEspera />}
      {sub === "escalados" && <Escalados />}
    </>
  );
}

function ListaPacientes({ rol }: { rol?: string }) {
  const [q, setQ] = useState("");
  const [lista, setLista] = useState<any[]>([]);
  const [ficha, setFicha] = useState<any | null>(null);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [citaPara, setCitaPara] = useState<any | null>(null);
  const [papelera, setPapelera] = useState(false);
  const [nuevo, setNuevo] = useState(false);

  const cargar = () =>
    api<any[]>(`pacientes?${papelera ? "papelera=1&" : ""}${q ? `q=${encodeURIComponent(q)}` : ""}`).then(setLista).catch(() => {});
  useEffect(() => {
    const t = setTimeout(cargar, 300);
    return () => clearTimeout(t);
  }, [q, papelera]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="fila">
        <input placeholder="Buscar paciente por nombre, apellidos o teléfono…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 340 }} />
        <button className="btn oro" onClick={() => setNuevo(true)}>+ Nuevo paciente</button>
        <div style={{ flex: 1 }} />
        <button className={`btn mini ${papelera ? "oro" : "suave"}`} onClick={() => { setPapelera(!papelera); setAbierto(null); }}>
          🗑 Papelera {papelera ? "(viendo eliminados)" : ""}
        </button>
      </div>
      <table className="t">
        <thead><tr><th>Nombre</th><th>Teléfono</th><th>Email</th><th>RGPD</th><th>Alta</th></tr></thead>
        <tbody>
          {lista.map((c) => (
            <Fragment key={c.id}>
              <tr className={`fila-paciente ${abierto === c.id ? "abierta" : ""}`}
                onClick={() => setAbierto(abierto === c.id ? null : c.id)}>
                <td>
                  {[c.nombre, c.apellidos].filter(Boolean).join(" ") || <i style={{ color: "var(--muted)" }}>sin nombre</i>}
                  {!c.alta_completa && !c.deleted_at && <span className="chip pendiente" style={{ marginLeft: 6 }} title="El bot lo registró con datos de contacto; recepción debe completar la ficha (DNI, fecha de nacimiento...) cuando venga">⏳ alta pendiente</span>}
                </td>
                <td>{c.telefono}{c.telefono_contacto ? ` · ☎ ${c.telefono_contacto}` : ""}</td>
                <td>{c.email ?? "—"}</td>
                <td>{c.consentimiento_rgpd ? <span className="chip confirmada">aceptado</span> : <span className="chip cancelada">no</span>}</td>
                <td>{new Date(c.created_at).toLocaleDateString("es-ES")}</td>
              </tr>
              {abierto === c.id && (
                <tr className="fila-acciones">
                  <td colSpan={5}>
                    <div className="acciones-paciente">
                      {papelera ? (
                        <>
                          <PapeleraInfo deletedAt={c.deleted_at} />
                          <button className="btn mini oro" onClick={async () => {
                            await api(`pacientes/${c.id}`, { method: "PATCH", body: { restaurar: true } });
                            cargar();
                          }}>♻️ Restaurar paciente</button>
                          <button className="btn mini suave" style={{ color: "var(--rojo)" }} onClick={async () => {
                            if (!confirm("⚠️ ANONIMIZAR es IRREVERSIBLE: se borran nombre, email y teléfonos para siempre (se conservan citas y consentimientos como registro). ¿Continuar?")) return;
                            try { await api(`pacientes/${c.id}`, { method: "PATCH", body: { anonimizar: true } }); cargar(); }
                            catch (e: any) {
                              if (String(e.message).includes("plazo legal") &&
                                confirm(`${e.message}\n\n¿FORZAR la anonimización igualmente? (quedará auditado)`)) {
                                try { await api(`pacientes/${c.id}`, { method: "PATCH", body: { anonimizar: true, forzar: true } }); cargar(); }
                                catch (e2: any) { alert(e2.message); }
                              } else if (!String(e.message).includes("plazo legal")) alert(e.message);
                            }
                          }}>⚠️ Anonimizar (definitivo)</button>
                        </>
                      ) : (
                        <>
                          <button className="btn mini" onClick={() => api(`pacientes/${c.id}`).then(setFicha)}>📋 Ver ficha</button>
                          <button className="btn mini oro" onClick={() => setCitaPara(c)}>📅 Nueva cita</button>
                          <a className="btn mini suave" href={`https://wa.me/${c.telefono}`} target="_blank" rel="noopener"
                            onClick={(e) => e.stopPropagation()}>💬 WhatsApp</a>
                          <button className="btn mini suave" onClick={async () => {
                            await api(`pacientes/${c.id}`, { method: "PATCH", body: { activo: !c.activo } });
                            cargar();
                          }}>{c.activo ? "🚫 Desactivar" : "✅ Reactivar"}</button>
                          {!c.activo && (
                            <button className="btn mini suave" style={{ color: "var(--rojo)" }} onClick={async () => {
                              if (!confirm("¿Enviar este paciente a la papelera? Es reversible desde 🗑 Papelera durante 30 días.")) return;
                              await api(`pacientes/${c.id}`, { method: "PATCH", body: { eliminar: true } });
                              cargar();
                            }}>🗑 Eliminar (a papelera)</button>
                          )}
                          {!c.activo && <span className="chip">desactivado — ya puede eliminarse</span>}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {lista.length === 0 && <tr><td colSpan={5} className="vacio">Sin resultados</td></tr>}
        </tbody>
      </table>
      {ficha && <FichaPaciente paciente={ficha} rol={rol} onCerrar={() => { setFicha(null); cargar(); }} />}
      {citaPara && <NuevaCitaPaciente paciente={citaPara} onCerrar={() => setCitaPara(null)} />}
      {nuevo && <NuevoPaciente onCerrar={(ok) => { setNuevo(false); if (ok) cargar(); }} />}
    </>
  );
}

/* Alta de paciente desde el panel (gente de paso, sin WhatsApp previo).
   El consentimiento se recoge EN PERSONA y queda registrado con canal "panel". */
function NuevoPaciente({ onCerrar }: { onCerrar: (ok: boolean) => void }) {
  const [f, setF] = useState({ telefono: "", nombre: "", apellidos: "", email: "", telefono_contacto: "", dni: "", fecha_nacimiento: "", direccion: "", sexo: "" });
  const [consent, setConsent] = useState(false);
  const [consentClinicos, setConsentClinicos] = useState(false);
  const [publicidad, setPublicidad] = useState<null | boolean>(null);
  const [areas, setAreas] = useState<any[]>([]);
  const [medicos, setMedicos] = useState<any[]>([]);
  const [areaId, setAreaId] = useState<number | "">("");
  const [medicoId, setMedicoId] = useState<number | "">("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<any[]>("areas").then((a) => setAreas(a.filter((x: any) => x.activo))).catch(() => {});
    api<any[]>("medicos").then((m) => setMedicos(m.filter((x: any) => x.activo && x.tipo !== "enfermera"))).catch(() => {});
  }, []);
  const medicosDelArea = medicos.filter((m: any) => (m.medico_areas ?? []).some((ma: any) => ma.area_id === areaId));
  // El alta en recepción se hace COMPLETA: los 4 datos clave + médico de referencia son obligatorios
  const fichaCompleta = Boolean(f.telefono.trim() && f.nombre.trim() && f.apellidos.trim() && f.dni.trim() && f.fecha_nacimiento && areaId && medicoId);

  async function crear() {
    setError("");
    try {
      const r = await api<{ id: number; alta_completa: boolean }>("pacientes", {
        method: "POST",
        body: { ...f, sexo: f.sexo || null, fecha_nacimiento: f.fecha_nacimiento || null, consentimiento: consent, consentimiento_clinicos: consentClinicos, ...(publicidad !== null ? { acepta_publicidad: publicidad } : {}) },
      });
      // Médico de referencia elegido en el alta → asignación directa
      if (areaId && medicoId) {
        await api("asignaciones", { method: "POST", body: { paciente_id: r.id, area_id: areaId, medico_id: medicoId } }).catch((e: any) => alert(`Paciente creado, pero la asignación falló: ${e.message}`));
      }
      onCerrar(true);
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="modal-bg" onClick={() => onCerrar(false)}>
      <div className="modal" style={{ width: "min(640px,96vw)", maxHeight: "92vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h3>Nuevo paciente (alta en recepción)</h3>
        <div className="campo" style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><label>Teléfono móvil *</label><input value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} placeholder="34612345678" /></div>
          <div style={{ flex: 1 }}><label>Teléfono de contacto (si difiere)</label><input value={f.telefono_contacto} onChange={(e) => setF({ ...f, telefono_contacto: e.target.value })} /></div>
        </div>
        <div className="campo" style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><label>Nombre *</label><input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></div>
          <div style={{ flex: 1 }}><label>Apellidos *</label><input value={f.apellidos} onChange={(e) => setF({ ...f, apellidos: e.target.value })} /></div>
        </div>
        <div className="campo" style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><label>DNI / NIE *</label><input value={f.dni} onChange={(e) => setF({ ...f, dni: e.target.value })} /></div>
          <div style={{ flex: 1 }}><label>Fecha de nacimiento *</label><input type="date" value={f.fecha_nacimiento} onChange={(e) => setF({ ...f, fecha_nacimiento: e.target.value })} /></div>
          <div style={{ flex: 1 }}><label>Sexo</label>
            <select value={f.sexo} onChange={(e) => setF({ ...f, sexo: e.target.value })}>
              <option value="">—</option><option value="mujer">Mujer</option><option value="hombre">Hombre</option><option value="otro">Otro</option>
            </select>
          </div>
        </div>
        <div className="campo" style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><label>Email</label><input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <div style={{ flex: 2 }}><label>Dirección</label><input value={f.direccion} onChange={(e) => setF({ ...f, direccion: e.target.value })} /></div>
        </div>
        <div className="campo" style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><label>Área *</label>
            <select value={areaId} onChange={(e) => { setAreaId(e.target.value ? Number(e.target.value) : ""); setMedicoId(""); }}>
              <option value="">— Elegir —</option>
              {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}><label>Médico de referencia *</label>
            <select value={medicoId} onChange={(e) => setMedicoId(e.target.value ? Number(e.target.value) : "")} disabled={!areaId}>
              <option value="">— Elegir —</option>
              {medicosDelArea.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
            </select>
          </div>
        </div>
        <p className="nota" style={{ margin: "4px 0 8px" }}>El alta en recepción se hace completa: todos los campos con * son obligatorios — un paciente no puede existir sin su médico de referencia (queda asignado al crearlo).</p>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, marginBottom: 6 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          El paciente ha dado EN PERSONA su consentimiento al tratamiento de datos personales *
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, marginBottom: 6 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={consentClinicos} onChange={(e) => setConsentClinicos(e.target.checked)} />
          Y al tratamiento de sus datos clínicos y de salud (historia clínica) *
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, marginBottom: 6 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={publicidad === true} onChange={(e) => setPublicidad(e.target.checked ? true : null)} />
          Acepta además recibir novedades y promociones (opcional)
        </label>
        {error && <div className="error">{error}</div>}
        <div className="fila" style={{ justifyContent: "flex-end" }}>
          <button className="btn suave" onClick={() => onCerrar(false)}>Cerrar</button>
          <button className="btn oro" disabled={!consent || !consentClinicos || !fichaCompleta} onClick={crear}>Crear paciente</button>
        </div>
      </div>
    </div>
  );
}

function NuevaCitaPaciente({ paciente, onCerrar }: { paciente: any; onCerrar: () => void }) {
  const [medicos, setMedicos] = useState<any[]>([]);
  const [tratamientos, setTratamientos] = useState<any[]>([]);
  const [medicoId, setMedicoId] = useState<number | null>(null);
  const [tratId, setTratId] = useState<number | null>(null);
  const [dia, setDia] = useState(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" }).format(new Date()));
  const [hora, setHora] = useState("10:00");
  const [error, setError] = useState("");

  useEffect(() => {
    api<any[]>("medicos").then((m) => { const act = m.filter((x: any) => x.activo); setMedicos(act); if (act[0]) setMedicoId(act[0].id); });
    api<any[]>("tratamientos").then(setTratamientos).catch(() => {});
  }, []);

  async function guardar() {
    if (!medicoId) return;
    const trat = tratamientos.find((t) => t.id === tratId);
    try {
      await api("citas", {
        method: "POST",
        body: { paciente_id: paciente.id, medico_id: medicoId, tratamiento_id: tratId, fecha: dia, hora, duracion_min: trat?.duracion_min ?? 30 },
      });
      onCerrar();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="modal-bg" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Nueva cita · {[paciente.nombre, paciente.apellidos].filter(Boolean).join(" ") || paciente.telefono}</h3>
        <div className="campo"><label>Doctor/a o enfermería</label>
          <select value={medicoId ?? ""} onChange={(e) => setMedicoId(Number(e.target.value))}>
            {medicos.map((m) => <option key={m.id} value={m.id}>{m.nombre}{m.tipo === "enfermera" ? " (Enfermería)" : ""}</option>)}
          </select>
        </div>
        <div className="campo"><label>Tratamiento (opcional)</label>
          <select value={tratId ?? ""} onChange={(e) => setTratId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">— Sin especificar —</option>
            {tratamientos.filter((t) => t.activo).map((t) => <option key={t.id} value={t.id}>{t.nombre} ({t.duracion_min}′)</option>)}
          </select>
        </div>
        <div className="campo" style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><label>Fecha</label><input type="date" value={dia} onChange={(e) => setDia(e.target.value)} /></div>
          <div style={{ flex: 1 }}><label>Hora</label><input type="time" value={hora} onChange={(e) => setHora(e.target.value)} step={300} /></div>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="fila" style={{ justifyContent: "flex-end" }}>
          <button className="btn suave" onClick={onCerrar}>Cerrar</button>
          <button className="btn oro" onClick={guardar}>Guardar cita</button>
        </div>
      </div>
    </div>
  );
}

function FichaPaciente({ paciente, rol, onCerrar }: { paciente: any; rol?: string; onCerrar: () => void }) {
  const [f, setF] = useState({
    nombre: paciente.nombre ?? "", apellidos: paciente.apellidos ?? "", email: paciente.email ?? "", telefono_contacto: paciente.telefono_contacto ?? "",
    dni: paciente.dni ?? "", fecha_nacimiento: paciente.fecha_nacimiento ?? "", direccion: paciente.direccion ?? "", sexo: paciente.sexo ?? "",
  });
  const [altaCompleta, setAltaCompleta] = useState<boolean>(paciente.alta_completa ?? false);
  const [msg, setMsg] = useState("");
  const [verHistoria, setVerHistoria] = useState(false);
  // La ficha está BLOQUEADA por defecto: se edita solo tras pulsar Editar / Completar ficha
  const [editando, setEditando] = useState(false);
  const inicial = useRef({ ...f }); // foto inicial para restaurar si se cancela
  const faltan = [
    !f.nombre.trim() && "nombre", !f.apellidos.trim() && "apellidos",
    !f.dni.trim() && "DNI", !f.fecha_nacimiento && "fecha de nacimiento",
  ].filter(Boolean) as string[];
  const cancelarEdicion = () => { setF({ ...inicial.current }); setEditando(false); setMsg(""); };
  // Datos clínicos: solo dirección/admin desde esta ficha (recepción gestiona lo administrativo)
  const clinico = rol === "admin" || rol === "direccion";

  async function guardar(completarAlta = false) {
    try {
      const r = await api<any>(`pacientes/${paciente.id}`, {
        method: "PATCH",
        body: {
          ...f, email: f.email || null, telefono_contacto: f.telefono_contacto || null,
          dni: f.dni || null, fecha_nacimiento: f.fecha_nacimiento || null, direccion: f.direccion || null, sexo: f.sexo || null,
          ...(completarAlta ? { alta_completa: true } : {}),
        },
      });
      if (completarAlta) setAltaCompleta(true);
      inicial.current = { ...f }; // lo guardado pasa a ser el nuevo estado base
      setEditando(false);         // y la ficha vuelve a quedar bloqueada
      setMsg(completarAlta ? "Alta completada ✓" : "Guardado ✓");
    } catch (e: any) { setMsg(e.message); }
  }

  const nombreCompleto = [f.nombre, f.apellidos].filter(Boolean).join(" ");
  const Campo = ({ e, span, children }: { e: string; span?: boolean; children: any }) => (
    <div style={span ? { gridColumn: "1 / -1" } : undefined}>
      <label style={{ fontSize: 11, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>{e}</label>
      {children}
    </div>
  );

  return (
    // PANTALLA COMPLETA (como el gestor de consulta): la ficha del paciente no es un modal
    <div className="pantalla-consulta">
      <div className="cab-consulta">
        <div className="fila" style={{ alignItems: "center", marginBottom: 0, flexWrap: "wrap" }}>
          <button className="btn suave mini" onClick={onCerrar}>← Volver</button>
          <div style={{ flex: 1, minWidth: 180 }}>
            <h3 style={{ margin: 0 }}>{nombreCompleto || `Ficha · ${paciente.telefono}`}</h3>
            <p className="nota" style={{ margin: "2px 0 0" }}>
              {paciente.telefono} · CIP{" "}
              <code style={{ fontSize: 11, cursor: "copy" }} title={`${paciente.cip ?? ""} — clic para copiar`}
                onClick={() => { if (paciente.cip) navigator.clipboard?.writeText(String(paciente.cip)); }}>
                {paciente.cip ? `${String(paciente.cip).slice(0, 8)}… 📋` : "—"}
              </code>
            </p>
          </div>
          {altaCompleta
            ? <span className="chip confirmada">alta completa</span>
            : <span className="chip pendiente">⏳ alta pendiente</span>}
          <button className="btn mini suave" onClick={() => exportarPaciente(paciente.id, "informe")}>🖨 Informe</button>
          <button className="btn mini suave" title="Para derechos de acceso y portabilidad (queda auditado)"
            onClick={() => exportarPaciente(paciente.id, "json")}>⬇ JSON</button>
        </div>
      </div>
      <div className="cuerpo-consulta">
        {!altaCompleta && (
          <p className="nota" style={{ margin: "4px 0 8px", color: "var(--ambar)" }}>
            ⏳ Alta pendiente — completar con el paciente en recepción (nombre, apellidos, DNI y fecha de nacimiento).
          </p>
        )}

        {/* ═══ Datos del paciente en rejilla (BLOQUEADOS salvo en edición) ═══ */}
        <div className="card" style={{ marginTop: 8, marginBottom: 12 }}>
          <div className="fila" style={{ marginBottom: 10 }}>
            <p className="nota" style={{ margin: 0, textTransform: "uppercase", letterSpacing: 1.5, fontSize: 11.5 }}>
              <b>Datos del paciente</b>{!editando && " 🔒"}
            </p>
            <div style={{ flex: 1 }} />
            {!editando && (altaCompleta
              ? <button className="btn mini suave" onClick={() => setEditando(true)}>✏ Editar</button>
              : <button className="btn mini oro" onClick={() => setEditando(true)}>✎ Completar ficha</button>)}
          </div>
          {editando && !altaCompleta && faltan.length > 0 && (
            <p className="nota" style={{ marginTop: 0, color: "var(--ambar)" }}>
              Para completar el alta faltan: <b>{faltan.join(", ")}</b>. Sin ellos no se puede guardar — solo cancelar (la ficha se queda como estaba).
            </p>
          )}
          <fieldset disabled={!editando} style={{ border: "none", margin: 0, padding: 0 }}>
          <div className="grid-ficha">
            <Campo e="Nombre"><input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Campo>
            <Campo e="Apellidos"><input value={f.apellidos} onChange={(e) => setF({ ...f, apellidos: e.target.value })} /></Campo>
            <Campo e="DNI / NIE"><input value={f.dni} onChange={(e) => setF({ ...f, dni: e.target.value })} /></Campo>
            <Campo e="Fecha de nacimiento"><input type="date" value={f.fecha_nacimiento} onChange={(e) => setF({ ...f, fecha_nacimiento: e.target.value })} /></Campo>
            <Campo e="Sexo">
              <select value={f.sexo} onChange={(e) => setF({ ...f, sexo: e.target.value })}>
                <option value="">—</option><option value="mujer">Mujer</option><option value="hombre">Hombre</option><option value="otro">Otro</option>
              </select>
            </Campo>
            <Campo e="Teléfono de contacto"><input placeholder="Si difiere del WhatsApp" value={f.telefono_contacto} onChange={(e) => setF({ ...f, telefono_contacto: e.target.value })} /></Campo>
            <Campo e="Email"><input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Campo>
            <Campo e="Dirección" span><input value={f.direccion} onChange={(e) => setF({ ...f, direccion: e.target.value })} /></Campo>
          </div>
          </fieldset>
        </div>

        <p className="nota">
          Consentimiento RGPD: {paciente.consentimiento_rgpd ? `aceptado el ${new Date(paciente.consentimiento_fecha).toLocaleString("es-ES")}` : "no aceptado"}
        </p>
        <Consentimientos pacienteId={paciente.id} />
        <Asignaciones pacienteId={paciente.id} />
        {clinico && (
          <div style={{ marginTop: 14 }}>
            <div className="fila" style={{ marginBottom: 6 }}>
              <h3 style={{ margin: 0 }}>Historia clínica</h3>
              <button className="btn mini suave" onClick={() => setVerHistoria(!verHistoria)}>
                {verHistoria ? "Ocultar" : "Abrir historia"}
              </button>
              {!verHistoria && <span className="nota" style={{ margin: 0 }}>Cada lectura queda registrada (RGPD)</span>}
            </div>
            {verHistoria && (
              <HistoriaClinica pacienteId={paciente.id}
                nombrePaciente={[paciente.nombre, paciente.apellidos].filter(Boolean).join(" ") || paciente.telefono} />
            )}
          </div>
        )}
        <h3 style={{ marginTop: 16 }}>Citas</h3>
        <table className="t">
          <thead><tr><th>Cuándo</th><th>Médico</th><th>Tratamiento</th><th>Estado</th></tr></thead>
          <tbody>
            {paciente.citas.map((c: any) => (
              <tr key={c.id}>
                <td>{fmtFechaHora(c.inicio)}</td>
                <td>{c.medicos?.nombre ?? "—"}</td>
                <td>{c.tratamientos?.nombre ?? "—"}</td>
                <td><span className={`chip ${c.estado}`}>{c.estado}</span></td>
              </tr>
            ))}
            {paciente.citas.length === 0 && <tr><td colSpan={4} className="vacio">Sin citas</td></tr>}
          </tbody>
        </table>
        <div className="fila" style={{ marginTop: 14, justifyContent: "flex-end" }}>
          <span className="nota">{msg}</span>
          {!editando && <button className="btn suave" onClick={onCerrar}>Cerrar</button>}
          {editando && (
            <>
              <button className="btn suave" title="Descarta los cambios: la ficha se queda como estaba al abrir"
                onClick={cancelarEdicion}>↩ Cancelar</button>
              {altaCompleta
                ? <button className="btn oro" onClick={() => guardar(false)}>💾 Guardar cambios</button>
                : <button className="btn oro" disabled={faltan.length > 0}
                    title={faltan.length > 0 ? `Faltan: ${faltan.join(", ")}` : "Guarda la ficha y marca el alta como completa"}
                    onClick={() => guardar(true)}>✓ Guardar y completar alta</button>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

async function exportarPaciente(id: number, formato: "json" | "informe") {
  try {
    const d = await api<any>(`pacientes/${id}/exportar`);
    if (formato === "json") {
      const blob = new Blob([JSON.stringify(d, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `eiviluxury-paciente-${id}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      return;
    }
    const w = window.open("", "_blank");
    if (!w) { alert("El navegador bloqueó la ventana del informe"); return; }
    w.document.write(htmlInforme(d));
    w.document.close();
  } catch (e: any) { alert(e.message); }
}

function htmlInforme(d: any): string {
  const f = (iso: string) => new Date(iso).toLocaleString("es-ES", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Madrid" });
  const esc = (s: any) => String(s ?? "—").replace(/</g, "&lt;");
  const p = d.paciente;
  const filas = (arr: any[], fn: (x: any) => string) => arr.length ? arr.map(fn).join("") : `<tr><td colspan="9" style="color:#8d8577">Sin registros</td></tr>`;
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Informe de datos · ${esc(p.nombre)} ${esc(p.apellidos ?? "")}</title>
<style>
body{font-family:'Segoe UI',sans-serif;color:#1c1a17;background:#fff;max-width:820px;margin:24px auto;padding:0 20px;font-size:13.5px;line-height:1.5}
h1{font-size:20px;letter-spacing:4px;font-weight:300}h1 b{font-weight:600}
h2{font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#b3925f;margin:26px 0 8px;border-bottom:1px solid #e8e0d3;padding-bottom:4px}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th{text-align:left;color:#8d8577;font-size:10.5px;text-transform:uppercase;letter-spacing:1px;padding:5px 8px;border-bottom:1px solid #e8e0d3}
td{padding:5px 8px;border-bottom:1px solid #f1ece2;vertical-align:top}
.meta{color:#8d8577;font-size:11.5px}
@media print{body{margin:0}}
</style></head><body onload="window.print()">
<h1>EIVI<b>LUXURY</b> · Informe de datos personales</h1>
<p class="meta">Generado el ${f(d.generado)} · En respuesta al ejercicio de derechos de acceso/portabilidad (art. 15 y 20 RGPD)</p>
<h2>Datos identificativos</h2>
<table>
<tr><td><b>CIP interno</b></td><td>${esc(p.cip)}</td></tr>
<tr><td><b>Nombre</b></td><td>${esc(p.nombre)} ${esc(p.apellidos ?? "")}</td></tr>
<tr><td><b>DNI / NIE</b></td><td>${esc(p.dni)}</td></tr>
<tr><td><b>Fecha de nacimiento</b></td><td>${p.fecha_nacimiento ? esc(p.fecha_nacimiento) : "—"}</td></tr>
<tr><td><b>Dirección</b></td><td>${esc(p.direccion)}</td></tr>
<tr><td><b>Teléfono (WhatsApp)</b></td><td>${esc(p.telefono)}</td></tr>
<tr><td><b>Teléfono de contacto</b></td><td>${esc(p.telefono_contacto)}</td></tr>
<tr><td><b>Email</b></td><td>${esc(p.email)}</td></tr>
<tr><td><b>Fecha de alta</b></td><td>${f(p.created_at)}</td></tr>
</table>
<h2>Consentimientos</h2>
<table><tr><th>Finalidad</th><th>Decisión</th><th>Fecha</th><th>Canal</th><th>Revocado</th></tr>
${filas(d.consentimientos, (c: any) => `<tr><td>${esc(c.tipo)}</td><td>${c.aceptado ? "Aceptado" : "Rechazado"}</td><td>${f(c.created_at)}</td><td>${esc(c.canal)}</td><td>${c.revocado_at ? f(c.revocado_at) : "—"}</td></tr>`)}
</table>
<h2>Citas</h2>
<table><tr><th>Fecha y hora</th><th>Profesional</th><th>Tratamiento</th><th>Estado</th></tr>
${filas(d.citas, (c: any) => `<tr><td>${f(c.inicio)}</td><td>${esc(c.medicos?.nombre)}</td><td>${esc(c.tratamientos?.nombre)}</td><td>${esc(c.estado)}</td></tr>`)}
</table>
<h2>Solicitudes de derechos</h2>
<table><tr><th>Fecha</th><th>Derecho</th><th>Canal</th><th>Estado</th></tr>
${filas(d.solicitudes_derechos, (s: any) => `<tr><td>${f(s.created_at)}</td><td>${esc(s.tipo_derecho)}</td><td>${esc(s.canal)}</td><td>${esc(s.estado)}</td></tr>`)}
</table>
<h2>Conversaciones por WhatsApp (${d.conversaciones.length} mensajes)</h2>
<table><tr><th>Fecha</th><th>Quién</th><th>Mensaje</th></tr>
${filas(d.conversaciones, (m: any) => `<tr><td style="white-space:nowrap">${f(m.created_at)}</td><td>${m.message?.role === "user" ? "Paciente" : "Alexia"}</td><td>${esc(m.message?.content)}</td></tr>`)}
</table>
<p class="meta" style="margin-top:26px">Clínica EiviLuxury · Carrer Canaries 41, Eivissa · 971 312 902 — Documento generado desde el panel de gestión; la exportación queda registrada en la auditoría del sistema.</p>
</body></html>`;
}

const DIAS_PAPELERA = 30; // ventana antes de la anonimización automática (RETENCION_PAPELERA_DIAS)

function PapeleraInfo({ deletedAt }: { deletedAt: string | null }) {
  if (!deletedAt) return null;
  const dias = Math.floor((Date.now() - new Date(deletedAt).getTime()) / 86400_000);
  const quedan = DIAS_PAPELERA - dias;
  return (
    <span className={`chip ${quedan <= 0 ? "cancelada" : "pendiente"}`}>
      🗑 en papelera desde {new Date(deletedAt).toLocaleDateString("es-ES")} ({dias} día{dias === 1 ? "" : "s"})
      {quedan > 0
        ? ` · anonimización automática en ${quedan} día${quedan === 1 ? "" : "s"}`
        : " · elegible para anonimización"}
    </span>
  );
}

const TIPOS_CONSENT: Record<string, string> = {
  datos_personales: "Datos personales",
  datos_clinicos: "Datos clínicos (salud)",
  comunicaciones_recordatorios: "Recordatorios de cita",
  publicidad: "Publicidad y novedades",
};

function Consentimientos({ pacienteId }: { pacienteId: number }) {
  const [lista, setLista] = useState<any[]>([]);
  const cargar = () => api<any[]>(`consentimientos?paciente_id=${pacienteId}`).then(setLista).catch(() => {});
  useEffect(() => { cargar(); }, [pacienteId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Estado vigente por tipo: el registro más reciente no revocado
  const vigente = (tipo: string) => lista.find((c) => c.tipo === tipo && !c.revocado_at);

  return (
    <div className="card" style={{ marginTop: 8 }}>
      <p className="nota" style={{ marginTop: 0 }}><b>Consentimientos por finalidad</b> (huella RGPD con fecha y canal)</p>
      {Object.entries(TIPOS_CONSENT).map(([tipo, etiqueta]) => {
        const v = vigente(tipo);
        return (
          <div key={tipo} className="linea-cita">
            <span style={{ flex: 1 }}>{etiqueta}</span>
            {v ? (
              <>
                <span className={`chip ${v.aceptado ? "confirmada" : "cancelada"}`}>
                  {v.aceptado ? "aceptado" : "rechazado"} · {new Date(v.created_at).toLocaleDateString("es-ES")} · {v.canal}
                </span>
                <button className="btn mini suave" onClick={async () => {
                  if (!confirm(`¿Revocar el consentimiento de "${etiqueta}"?`)) return;
                  await api(`consentimientos/${v.id}`, { method: "PATCH", body: { revocar: true } });
                  cargar();
                }}>Revocar</button>
              </>
            ) : (
              <>
                <span className="chip">sin registro</span>
                <button className="btn mini suave" onClick={async () => {
                  await api("consentimientos", { method: "POST", body: { paciente_id: pacienteId, tipo, aceptado: true, texto: `Consentimiento de ${etiqueta} otorgado verbalmente/en persona y registrado desde el panel` } });
                  cargar();
                }}>Registrar ✓</button>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Escalados() {
  const [lista, setLista] = useState<any[]>([]);
  const cargar = () => api<any[]>("escalados").then(setLista).catch(() => {});
  useEffect(() => { cargar(); }, []);

  return (
    <table className="t">
      <thead><tr><th>Cuándo</th><th>Teléfono</th><th>Motivo</th><th>Estado</th><th></th></tr></thead>
      <tbody>
        {lista.map((e) => (
          <tr key={e.id} style={{ opacity: e.resuelto ? 0.55 : 1 }}>
            <td>{fmtFechaHora(e.created_at)}</td>
            <td>{e.telefono}</td>
            <td>{e.motivo ?? "—"}</td>
            <td>{e.resuelto ? <span className="chip completada">resuelto</span> : <span className="chip pendiente">pendiente</span>}</td>
            <td>
              {!e.resuelto && <button className="btn mini suave" onClick={() => api(`escalados/${e.id}`, { method: "PATCH", body: { resuelto: true } }).then(cargar)}>Marcar resuelto</button>}
            </td>
          </tr>
        ))}
        {lista.length === 0 && <tr><td colSpan={5} className="vacio">Nada escalado — Alexia lo tiene todo bajo control 🙌</td></tr>}
      </tbody>
    </table>
  );
}
