"use client";
import { useEffect, useState } from "react";
import { api, fmtFechaHora } from "./api";

/* ============================================================
   MI AGENDA — autogestión del médico/enfermería freelancer.
   · Antelación mínima con la que el bot ofrece sus huecos
   · Semana tipo (horario semanal recurrente, varios tramos/día)
   · Ausencias y vacaciones (días completos o franja de un día)
   Regla dura: un bloqueo no puede pisar citas reservadas — el
   diálogo de conflicto permite resolverlas ahí mismo
   (cancelar → lista de espera + aviso WhatsApp automático).
   Todo queda auditado y dirección lo ve en Logs.
   ============================================================ */

const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const DOW = [1, 2, 3, 4, 5, 6, 0]; // orden visual → dia_semana en BBDD

export default function MiAgenda() {
  const [datos, setDatos] = useState<any | null>(null);
  const [error, setError] = useState("");
  const cargar = () => api<any>("mi-agenda").then((d) => { setDatos(d); setError(""); }).catch((e) => setError(e.message));
  useEffect(() => { cargar(); }, []);

  if (error) return <div className="error">{error}</div>;
  if (!datos) return <p className="nota">Cargando tu agenda…</p>;

  return (
    <>
      <Antelacion actual={datos.ficha?.antelacion_horas ?? 0} onCambio={cargar} />
      <SemanaTipo horarios={datos.horarios} onCambio={cargar} />
      <Ausencias bloqueos={datos.bloqueos} onCambio={cargar} />
    </>
  );
}

/* ---------- Antelación del bot ---------- */
function Antelacion({ actual, onCambio }: { actual: number; onCambio: () => void }) {
  const OPCIONES = [
    { h: 0, t: "Al momento (acepto huecos de última hora)" },
    { h: 4, t: "4 horas" }, { h: 12, t: "12 horas" }, { h: 24, t: "24 horas" },
    { h: 48, t: "48 horas" }, { h: 72, t: "3 días" }, { h: 168, t: "1 semana" },
  ];
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <p className="nota" style={{ marginTop: 0 }}>
        <b>Antelación mínima de reserva</b> — el bot solo ofrecerá huecos tuyos que empiecen al menos con esta antelación. Las reservas de hoy para hoy quedan marcadas ⚡ y recepción las ve al instante.
      </p>
      <div className="fila" style={{ marginBottom: 0 }}>
        <select value={actual} style={{ maxWidth: 340 }} onChange={async (e) => {
          try { await api("mi-agenda", { method: "PATCH", body: { antelacion_horas: Number(e.target.value) } }); onCambio(); }
          catch (er: any) { alert(er.message); }
        }}>
          {OPCIONES.map((o) => <option key={o.h} value={o.h}>{o.t}</option>)}
          {!OPCIONES.some((o) => o.h === actual) && <option value={actual}>{actual} horas</option>}
        </select>
      </div>
    </div>
  );
}

/* ---------- Semana tipo ---------- */
function SemanaTipo({ horarios, onCambio }: { horarios: any[]; onCambio: () => void }) {
  const [add, setAdd] = useState<{ dia: number; inicio: string; fin: string } | null>(null);

  const tramosDe = (dow: number) => horarios.filter((h) => h.dia_semana === dow);

  async function crear() {
    if (!add) return;
    if (add.fin <= add.inicio) { alert("La hora de fin debe ser posterior a la de inicio"); return; }
    try {
      await api("horarios", { method: "POST", body: { dia_semana: add.dia, hora_inicio: add.inicio, hora_fin: add.fin } });
      setAdd(null); onCambio();
    } catch (e: any) { alert(e.message); }
  }

  async function copiarDia(desde: number, hacia: number) {
    for (const t of tramosDe(desde)) {
      await api("horarios", { method: "POST", body: { dia_semana: hacia, hora_inicio: String(t.hora_inicio).slice(0, 5), hora_fin: String(t.hora_fin).slice(0, 5) } }).catch(() => {});
    }
    onCambio();
  }

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <p className="nota" style={{ marginTop: 0 }}>
        <b>Mi semana tipo</b> — tus tramos de trabajo recurrentes. El bot y la agenda solo ofrecen citas dentro de estos tramos. Puedes tener varios tramos al día (mañana y tarde) y días sin tramo (no trabajas).
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
        {DOW.map((dow, i) => (
          <div key={dow} style={{ border: "1px solid var(--linea)", borderRadius: 8, padding: "8px 10px" }}>
            <b style={{ fontSize: 12.5, letterSpacing: 1, textTransform: "uppercase", color: "var(--muted)" }}>{DIAS[i]}</b>
            {tramosDe(dow).map((t) => (
              <div key={t.id} className="fila" style={{ marginBottom: 4, marginTop: 6 }}>
                <span className="chip confirmada">{String(t.hora_inicio).slice(0, 5)}–{String(t.hora_fin).slice(0, 5)}</span>
                <button className="btn mini suave" title="Quitar tramo" onClick={async () => {
                  if (!confirm(`¿Quitar el tramo del ${DIAS[i]} ${String(t.hora_inicio).slice(0, 5)}–${String(t.hora_fin).slice(0, 5)}? Si tienes citas futuras en ese tramo, recuerda reprogramarlas.`)) return;
                  await api(`horarios/${t.id}`, { method: "DELETE" }); onCambio();
                }}>✕</button>
              </div>
            ))}
            {tramosDe(dow).length === 0 && <p className="nota" style={{ margin: "6px 0", fontSize: 11.5 }}>Sin tramo</p>}
            <div className="fila" style={{ marginBottom: 0 }}>
              <button className="btn mini suave" onClick={() => setAdd({ dia: dow, inicio: "09:00", fin: "14:00" })}>+ Tramo</button>
              {i > 0 && tramosDe(DOW[i - 1]).length > 0 && tramosDe(dow).length === 0 && (
                <button className="btn mini suave" title={`Copiar los tramos del ${DIAS[i - 1]}`} onClick={() => copiarDia(DOW[i - 1], dow)}>⧉ Como {DIAS[i - 1].toLowerCase().slice(0, 3)}.</button>
              )}
            </div>
          </div>
        ))}
      </div>
      {add && (
        <div className="modal-bg" onClick={() => setAdd(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Nuevo tramo · {DIAS[DOW.indexOf(add.dia)]}</h3>
            <div className="campo" style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}><label>Desde</label><input type="time" value={add.inicio} onChange={(e) => setAdd({ ...add, inicio: e.target.value })} /></div>
              <div style={{ flex: 1 }}><label>Hasta</label><input type="time" value={add.fin} onChange={(e) => setAdd({ ...add, fin: e.target.value })} /></div>
            </div>
            <div className="fila" style={{ justifyContent: "flex-end" }}>
              <button className="btn suave" onClick={() => setAdd(null)}>Cerrar</button>
              <button className="btn oro" onClick={crear}>Añadir tramo</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Ausencias y vacaciones ---------- */
function Ausencias({ bloqueos, onCambio }: { bloqueos: any[]; onCambio: () => void }) {
  const hoy = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" }).format(new Date());
  const [modo, setModo] = useState<"dias" | "franja">("dias");
  const [f, setF] = useState({ fecha_inicio: hoy, fecha_fin: hoy, hora_inicio: "09:00", hora_fin: "14:00", motivo: "" });
  const [conflictos, setConflictos] = useState<any[] | null>(null);
  const [msg, setMsg] = useState("");

  async function crear() {
    setMsg(""); setConflictos(null);
    const body: any = modo === "dias"
      ? { fecha_inicio: f.fecha_inicio, fecha_fin: f.fecha_fin, motivo: f.motivo || null }
      : { fecha_inicio: f.fecha_inicio, fecha_fin: f.fecha_inicio, hora_inicio: f.hora_inicio, hora_fin: f.hora_fin, motivo: f.motivo || null };
    try {
      await api("bloqueos", { method: "POST", body });
      setMsg("Ausencia creada ✓ — el bot deja de ofrecer esos huecos al momento");
      onCambio();
    } catch (e: any) {
      // 409 con citas dentro: mostrar el resolutor
      if (e.citas_conflicto) setConflictos(e.citas_conflicto);
      else setMsg(e.message);
    }
  }

  async function cancelarAEspera(citaId: number) {
    try {
      await api(`citas/${citaId}`, { method: "PATCH", body: { estado: "cancelada", a_lista_espera: true } });
      setConflictos((prev) => (prev ?? []).filter((c) => c.id !== citaId));
      setMsg("Cita cancelada: paciente en lista de espera y avisado por WhatsApp ✓");
    } catch (e: any) { alert(e.message); }
  }

  return (
    <div className="card">
      <p className="nota" style={{ marginTop: 0 }}>
        <b>Ausencias y vacaciones</b> — días completos o una franja de un día. No se puede bloquear encima de citas ya reservadas: si las hay, te las mostraré para resolverlas aquí mismo.
      </p>
      <div className="fila">
        <div className="subtabs" style={{ marginBottom: 0 }}>
          <button className={modo === "dias" ? "on" : ""} onClick={() => setModo("dias")}>Días completos</button>
          <button className={modo === "franja" ? "on" : ""} onClick={() => setModo("franja")}>Franja de un día</button>
        </div>
      </div>
      <div className="fila" style={{ flexWrap: "wrap" }}>
        <input type="date" value={f.fecha_inicio} min={hoy} onChange={(e) => setF({ ...f, fecha_inicio: e.target.value, fecha_fin: modo === "dias" && e.target.value > f.fecha_fin ? e.target.value : f.fecha_fin })} />
        {modo === "dias" ? (
          <><span>hasta</span><input type="date" value={f.fecha_fin} min={f.fecha_inicio} onChange={(e) => setF({ ...f, fecha_fin: e.target.value })} /></>
        ) : (
          <><input type="time" value={f.hora_inicio} onChange={(e) => setF({ ...f, hora_inicio: e.target.value })} />
            <span>a</span><input type="time" value={f.hora_fin} onChange={(e) => setF({ ...f, hora_fin: e.target.value })} /></>
        )}
        <input placeholder="Motivo (opcional: vacaciones, congreso…)" value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} style={{ width: 240 }} />
        <button className="btn oro" onClick={crear}>+ Crear ausencia</button>
      </div>
      {msg && <p className="nota" style={{ color: "var(--verde)" }}>{msg}</p>}

      {conflictos && conflictos.length > 0 && (
        <div style={{ border: "1.5px solid var(--rojo)", background: "#faf0f0", borderRadius: 10, padding: "10px 14px", marginBottom: 10 }}>
          <p style={{ margin: "0 0 8px", fontSize: 13.5 }}>
            <b style={{ color: "var(--rojo)" }}>⚠ {conflictos.length} cita(s) dentro del periodo.</b> Resuélvelas y vuelve a pulsar "+ Crear ausencia":
          </p>
          {conflictos.map((c) => (
            <div className="linea-cita" key={c.id}>
              <span>{fmtFechaHora(c.inicio)} · {[c.pacientes?.nombre, c.pacientes?.apellidos].filter(Boolean).join(" ") || c.pacientes?.telefono}{c.tratamientos?.nombre ? ` · ${c.tratamientos.nombre}` : ""}</span>
              <button className="btn mini oro" onClick={() => cancelarAEspera(c.id)}>Cancelar → lista de espera (avisa al paciente)</button>
            </div>
          ))}
          <p className="nota" style={{ margin: "8px 0 0", fontSize: 11.5 }}>
            Al cancelar, Alexia escribe al paciente por WhatsApp: le explica la ausencia, queda con prioridad en tu lista de espera y puede reprogramar respondiendo al mensaje.
          </p>
        </div>
      )}

      {conflictos && conflictos.length === 0 && (
        <p className="nota" style={{ color: "var(--verde)" }}>Conflictos resueltos ✓ — pulsa "+ Crear ausencia" otra vez para confirmarla.</p>
      )}

      <table className="t">
        <thead><tr><th>Desde</th><th>Hasta</th><th>Motivo</th><th></th></tr></thead>
        <tbody>
          {bloqueos.map((b) => (
            <tr key={b.id}>
              <td>{fmtFechaHora(b.inicio)}</td>
              <td>{fmtFechaHora(b.fin)}</td>
              <td>{b.motivo ?? "—"}</td>
              <td><button className="btn mini suave" onClick={async () => {
                if (!confirm("¿Eliminar esta ausencia? Sus huecos volverán a ofrecerse.")) return;
                await api(`bloqueos/${b.id}`, { method: "DELETE" }); onCambio();
              }}>Eliminar</button></td>
            </tr>
          ))}
          {bloqueos.length === 0 && <tr><td colSpan={4} className="vacio">Sin ausencias próximas</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
