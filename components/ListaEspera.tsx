"use client";
import { useEffect, useState } from "react";
import { api } from "./api";

/* ============================================================
   Lista de espera — la alimenta el bot (cuando el médico de
   referencia no tiene hueco esta semana) o recepción.
   La gestiona el médico desde su perfil (solo sus áreas) y
   también recepción/dirección (todas).
   Flujo por entrada: contactar (WhatsApp) → 📅 crear la cita
   (queda "agendada" y ligada a la cita) o ✕ quitarla.
   ============================================================ */

export default function ListaEspera({ rolMedico = false }: { rolMedico?: boolean }) {
  const [lista, setLista] = useState<any[]>([]);
  const [resueltas, setResueltas] = useState(false);
  const [error, setError] = useState("");
  const [citaPara, setCitaPara] = useState<any | null>(null);

  const cargar = () =>
    api<any[]>(`lista-espera${resueltas ? "?resueltas=1" : ""}`).then((d) => { setLista(d); setError(""); }).catch((e) => setError(e.message));
  useEffect(() => { cargar(); }, [resueltas]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="error">{error}</div>;

  const dias = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);

  return (
    <>
      <div className="fila">
        <p className="nota" style={{ margin: 0, flex: 1 }}>
          Ordenada por antigüedad: el paciente que más lleva esperando, arriba. Al liberarse un hueco (una cancelación, un bloqueo que se quita), empieza por aquí.
        </p>
        <button className={`btn mini ${resueltas ? "oro" : "suave"}`} onClick={() => setResueltas(!resueltas)}>
          {resueltas ? "← Ver pendientes" : "Historial resueltas"}
        </button>
      </div>
      <table className="t">
        <thead><tr><th>Paciente</th><th>Área</th><th>Médico preferido</th><th>Preferencia</th><th>Espera</th><th>Estado</th><th></th></tr></thead>
        <tbody>
          {lista.map((e) => {
            const nombre = [e.pacientes?.nombre, e.pacientes?.apellidos].filter(Boolean).join(" ") || e.pacientes?.telefono;
            return (
              <tr key={e.id}>
                <td>{nombre}<br /><span className="nota" style={{ margin: 0, fontSize: 11.5 }}>{e.pacientes?.telefono}</span></td>
                <td>{e.areas?.nombre ?? "—"}{e.tratamientos?.nombre ? <><br /><span className="nota" style={{ margin: 0, fontSize: 11.5 }}>{e.tratamientos.nombre}</span></> : null}</td>
                <td>{e.medicos?.nombre ?? "cualquiera"}</td>
                <td>{e.preferencia ?? "—"}{e.notas ? <><br /><span className="nota" style={{ margin: 0, fontSize: 11.5 }}>🗒 {e.notas}</span></> : null}</td>
                <td>{resueltas ? (e.resuelta_at ? new Date(e.resuelta_at).toLocaleDateString("es-ES") : "—")
                  : <span className={`chip ${dias(e.created_at) >= 7 ? "cancelada" : "pendiente"}`}>{dias(e.created_at)} día{dias(e.created_at) === 1 ? "" : "s"}</span>}</td>
                <td><span className={`chip ${e.estado === "agendada" ? "confirmada" : e.estado === "cancelada" ? "cancelada" : e.estado === "contactado" ? "completada" : "pendiente"}`}>{e.estado}</span></td>
                <td>
                  {!resueltas && (
                    <div className="fila" style={{ marginBottom: 0, flexWrap: "wrap" }}>
                      <a className="btn mini suave" href={`https://wa.me/${e.pacientes?.telefono}`} target="_blank" rel="noopener">💬</a>
                      {e.estado === "pendiente" && (
                        <button className="btn mini suave" title="Marcar como contactado" onClick={async () => {
                          await api(`lista-espera/${e.id}`, { method: "PATCH", body: { estado: "contactado" } }); cargar();
                        }}>✆ Contactado</button>
                      )}
                      <button className="btn mini oro" onClick={() => setCitaPara(e)}>📅 Crear cita</button>
                      <button className="btn mini suave" title="Añadir nota interna" onClick={async () => {
                        const n = prompt("Nota interna:", e.notas ?? "");
                        if (n === null) return;
                        await api(`lista-espera/${e.id}`, { method: "PATCH", body: { notas: n || null } }); cargar();
                      }}>🗒</button>
                      <button className="btn mini suave" style={{ color: "var(--rojo)" }} onClick={async () => {
                        if (!confirm(`¿Quitar a ${nombre} de la lista de espera?`)) return;
                        await api(`lista-espera/${e.id}`, { method: "PATCH", body: { estado: "cancelada" } }); cargar();
                      }}>✕</button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
          {lista.length === 0 && <tr><td colSpan={7} className="vacio">{resueltas ? "Sin entradas resueltas" : "Nadie en lista de espera 🙌"}</td></tr>}
        </tbody>
      </table>
      {citaPara && (
        <CitaDesdeEspera entrada={citaPara} rolMedico={rolMedico}
          onCerrar={(ok) => { setCitaPara(null); if (ok) cargar(); }} />
      )}
    </>
  );
}

/* Crear la cita que resuelve la entrada: al guardar, la entrada pasa a "agendada" y queda ligada a la cita */
function CitaDesdeEspera({ entrada, rolMedico, onCerrar }: { entrada: any; rolMedico: boolean; onCerrar: (ok: boolean) => void }) {
  const [medicos, setMedicos] = useState<any[]>([]);
  const [tratamientos, setTratamientos] = useState<any[]>([]);
  const [medicoId, setMedicoId] = useState<number | "">(entrada.medico_id ?? "");
  const [tratId, setTratId] = useState<number | "">(entrada.tratamiento_id ?? "");
  const [dia, setDia] = useState(new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" }).format(new Date()));
  const [hora, setHora] = useState("10:00");
  const [error, setError] = useState("");
  const nombre = [entrada.pacientes?.nombre, entrada.pacientes?.apellidos].filter(Boolean).join(" ") || entrada.pacientes?.telefono;

  useEffect(() => {
    if (!rolMedico) api<any[]>("medicos").then((m) => setMedicos(m.filter((x: any) => x.activo))).catch(() => {});
    api<any[]>("tratamientos").then(setTratamientos).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function guardar() {
    const trat = tratamientos.find((t) => t.id === tratId);
    try {
      const r = await api<{ id: number }>("citas", {
        method: "POST",
        body: {
          paciente_id: entrada.paciente_id,
          ...(rolMedico ? {} : { medico_id: medicoId || entrada.medico_id }),
          tratamiento_id: tratId || null,
          fecha: dia, hora, duracion_min: trat?.duracion_min ?? 30,
          notas: "Desde lista de espera",
        },
      });
      await api(`lista-espera/${entrada.id}`, { method: "PATCH", body: { estado: "agendada", cita_id: r.id } });
      onCerrar(true);
    } catch (e: any) { setError(e.message); }
  }

  return (
    <div className="modal-bg" onClick={() => onCerrar(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Cita desde lista de espera · {nombre}</h3>
        <p className="nota">
          Esperando {entrada.areas?.nombre ?? ""}{entrada.medicos?.nombre ? ` con ${entrada.medicos.nombre}` : ""}
          {entrada.preferencia ? ` · preferencia: "${entrada.preferencia}"` : ""} — avisa al paciente antes de reservar (💬).
        </p>
        {!rolMedico && (
          <div className="campo"><label>Médico</label>
            <select value={medicoId} onChange={(e) => setMedicoId(e.target.value ? Number(e.target.value) : "")}>
              <option value="">— Elegir —</option>
              {medicos.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
            </select>
          </div>
        )}
        <div className="campo"><label>Tratamiento (opcional)</label>
          <select value={tratId} onChange={(e) => setTratId(e.target.value ? Number(e.target.value) : "")}>
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
          <button className="btn suave" onClick={() => onCerrar(false)}>Cerrar</button>
          <button className="btn oro" onClick={guardar}>Reservar y resolver</button>
        </div>
      </div>
    </div>
  );
}
