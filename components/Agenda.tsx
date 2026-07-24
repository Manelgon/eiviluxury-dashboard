"use client";
import { useCallback, useEffect, useState } from "react";
import { api, fmtHora, hoyISO } from "./api";

interface Cita {
  id: number; medico_id: number; inicio: string; estado: string;
  confirmada_cliente: boolean; notas: string | null;
  clientes: { id: number; nombre: string | null; apellidos: string | null; telefono: string } | null;
  tratamientos: { nombre: string } | null;
}
interface Medico { id: number; nombre: string; especialidad: string | null; horario: { hora_inicio: string; hora_fin: string }[]; citas: Cita[] }

export default function Agenda() {
  const [fecha, setFecha] = useState(hoyISO());
  const [datos, setDatos] = useState<{ medicos: Medico[] } | null>(null);
  const [error, setError] = useState("");
  const [nueva, setNueva] = useState(false);

  const cargar = useCallback(() => {
    api<{ medicos: Medico[] }>(`agenda?fecha=${fecha}`).then(setDatos).catch((e) => setError(e.message));
  }, [fecha]);
  useEffect(cargar, [cargar]);

  async function cambiarEstado(id: number, estado: string) {
    try { await api(`citas/${id}`, { method: "PATCH", body: { estado } }); cargar(); }
    catch (e: any) { alert(e.message); }
  }

  const mover = (dias: number) => {
    const d = new Date(`${fecha}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    setFecha(d.toISOString().slice(0, 10));
  };

  return (
    <>
      <h2 className="seccion">Agenda del día</h2>
      <div className="fila">
        <button className="btn suave mini" onClick={() => mover(-1)}>← Anterior</button>
        <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} style={{ width: 160 }} />
        <button className="btn suave mini" onClick={() => mover(1)}>Siguiente →</button>
        <button className="btn suave mini" onClick={() => setFecha(hoyISO())}>Hoy</button>
        <div style={{ flex: 1 }} />
        <button className="btn oro" onClick={() => setNueva(true)}>+ Nueva cita</button>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="agenda-grid">
        {datos?.medicos.map((m) => (
          <div className="med-col" key={m.id}>
            <header>
              <b>{m.nombre}</b>
              <span>
                {m.especialidad ?? ""}{m.horario.length > 0
                  ? ` · ${m.horario.map((h) => `${String(h.hora_inicio).slice(0, 5)}–${String(h.hora_fin).slice(0, 5)}`).join(", ")}`
                  : " · no pasa consulta este día"}
              </span>
            </header>
            {m.citas.length === 0 && <div className="vacio">Sin citas</div>}
            {m.citas.map((c) => (
              <div className="cita" key={c.id}>
                <div>
                  <div className="hora">{fmtHora(c.inicio)}</div>
                  <div className="quien-c">{[c.clientes?.nombre, c.clientes?.apellidos].filter(Boolean).join(" ") || c.clientes?.telefono}</div>
                  {c.tratamientos && <div className="trat">{c.tratamientos.nombre}</div>}
                  <span className={`chip ${c.estado}`}>{c.estado}{c.confirmada_cliente ? " ✓" : ""}</span>
                </div>
                <div className="acciones">
                  {["pendiente", "confirmada"].includes(c.estado) && (
                    <>
                      <button className="btn mini suave" onClick={() => cambiarEstado(c.id, "completada")}>Completada</button>
                      <button className="btn mini suave" onClick={() => cambiarEstado(c.id, "no_show")}>No vino</button>
                      <button className="btn mini suave" onClick={() => { if (confirm("¿Cancelar esta cita?")) cambiarEstado(c.id, "cancelada"); }}>Cancelar</button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      {nueva && <NuevaCita fecha={fecha} medicos={datos?.medicos ?? []} onCerrar={() => { setNueva(false); cargar(); }} />}
    </>
  );
}

function NuevaCita({ fecha, medicos, onCerrar }: { fecha: string; medicos: Medico[]; onCerrar: () => void }) {
  const [busca, setBusca] = useState("");
  const [clientes, setClientes] = useState<any[]>([]);
  const [clienteId, setClienteId] = useState<number | null>(null);
  const [medicoId, setMedicoId] = useState<number | null>(medicos[0]?.id ?? null);
  const [tratamientos, setTratamientos] = useState<any[]>([]);
  const [tratId, setTratId] = useState<number | null>(null);
  const [dia, setDia] = useState(fecha);
  const [hora, setHora] = useState("10:00");
  const [notas, setNotas] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { api<any[]>("tratamientos").then(setTratamientos).catch(() => {}); }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      if (busca.trim().length >= 2) api<any[]>(`clientes?q=${encodeURIComponent(busca)}`).then(setClientes).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [busca]);

  async function guardar() {
    if (!clienteId || !medicoId) { setError("Selecciona cliente y médico"); return; }
    const trat = tratamientos.find((t) => t.id === tratId);
    try {
      await api("citas", {
        method: "POST",
        body: { cliente_id: clienteId, medico_id: medicoId, tratamiento_id: tratId, fecha: dia, hora, duracion_min: trat?.duracion_min ?? 30, notas: notas || null },
      });
      onCerrar();
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="modal-bg" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Nueva cita</h3>
        <div className="campo">
          <label>Cliente (busca por nombre o teléfono)</label>
          <input value={busca} onChange={(e) => { setBusca(e.target.value); setClienteId(null); }} placeholder="Ej. María / 34612..." />
          {clientes.length > 0 && !clienteId && (
            <div style={{ border: "1px solid var(--linea)", borderRadius: 8, marginTop: 4, maxHeight: 140, overflow: "auto" }}>
              {clientes.map((c) => (
                <div key={c.id} style={{ padding: "7px 10px", cursor: "pointer" }}
                  onClick={() => { setClienteId(c.id); setBusca(`${c.nombre ?? ""} ${c.apellidos ?? ""} (${c.telefono})`); }}>
                  {c.nombre} {c.apellidos} · {c.telefono}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="campo"><label>Médico</label>
          <select value={medicoId ?? ""} onChange={(e) => setMedicoId(Number(e.target.value))}>
            {medicos.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
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
