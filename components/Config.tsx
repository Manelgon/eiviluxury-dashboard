"use client";
import { useEffect, useState } from "react";
import { api } from "./api";

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export default function Config() {
  const [sub, setSub] = useState<"tratamientos" | "faq" | "horarios" | "bloqueos">("tratamientos");
  return (
    <>
      <div className="subtabs">
        <button className={sub === "tratamientos" ? "on" : ""} onClick={() => setSub("tratamientos")}>Tratamientos y precios</button>
        <button className={sub === "faq" ? "on" : ""} onClick={() => setSub("faq")}>FAQ del bot</button>
        <button className={sub === "horarios" ? "on" : ""} onClick={() => setSub("horarios")}>Horarios</button>
        <button className={sub === "bloqueos" ? "on" : ""} onClick={() => setSub("bloqueos")}>Vacaciones y bloqueos</button>
      </div>
      {sub === "tratamientos" && <Tratamientos />}
      {sub === "faq" && <Faq />}
      {sub === "horarios" && <Horarios />}
      {sub === "bloqueos" && <Bloqueos />}
    </>
  );
}

function Tratamientos() {
  const [lista, setLista] = useState<any[]>([]);
  const [areas, setAreas] = useState<any[]>([]);
  const [nuevo, setNuevo] = useState<any | null>(null);
  const cargar = () => api<any[]>("tratamientos").then(setLista).catch(() => {});
  useEffect(() => { cargar(); api<any[]>("areas").then(setAreas).catch(() => {}); }, []);

  async function actualizar(id: number, campos: any) {
    try { await api(`tratamientos/${id}`, { method: "PATCH", body: campos }); cargar(); }
    catch (e: any) { alert(e.message); }
  }

  return (
    <>
      <p className="nota">El precio en blanco = "requiere valoración" (Alexia no dará cifra). Los cambios los usa el bot al momento.</p>
      <table className="t">
        <thead><tr><th>Tratamiento</th><th>Área</th><th>Precio €</th><th>Valoración</th><th>Min</th><th>Activo</th></tr></thead>
        <tbody>
          {lista.map((t) => (
            <tr key={t.id} style={{ opacity: t.activo ? 1 : 0.5 }}>
              <td>{t.nombre}</td>
              <td>{t.areas?.nombre ?? "—"}</td>
              <td style={{ width: 110 }}>
                <input type="number" step="0.01" defaultValue={t.precio_eur ?? ""} placeholder="valorac."
                  onBlur={(e) => actualizar(t.id, { precio_eur: e.target.value === "" ? null : Number(e.target.value) })} />
              </td>
              <td><input type="checkbox" defaultChecked={t.requiere_valoracion} onChange={(e) => actualizar(t.id, { requiere_valoracion: e.target.checked })} /></td>
              <td style={{ width: 80 }}>
                <input type="number" defaultValue={t.duracion_min} onBlur={(e) => actualizar(t.id, { duracion_min: Number(e.target.value) || 30 })} />
              </td>
              <td><input type="checkbox" defaultChecked={t.activo} onChange={(e) => actualizar(t.id, { activo: e.target.checked })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="fila" style={{ marginTop: 12 }}>
        <button className="btn oro" onClick={() => setNuevo({ nombre: "", area_id: areas[0]?.id ?? null, precio_eur: "", duracion_min: 30, requiere_valoracion: false })}>+ Añadir tratamiento</button>
      </div>
      {nuevo && (
        <div className="modal-bg" onClick={() => setNuevo(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Nuevo tratamiento</h3>
            <div className="campo"><label>Nombre</label><input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} /></div>
            <div className="campo"><label>Área</label>
              <select value={nuevo.area_id ?? ""} onChange={(e) => setNuevo({ ...nuevo, area_id: Number(e.target.value) })}>
                {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
            </div>
            <div className="campo" style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}><label>Precio € (vacío = valoración)</label><input type="number" step="0.01" value={nuevo.precio_eur} onChange={(e) => setNuevo({ ...nuevo, precio_eur: e.target.value })} /></div>
              <div style={{ flex: 1 }}><label>Duración (min)</label><input type="number" value={nuevo.duracion_min} onChange={(e) => setNuevo({ ...nuevo, duracion_min: Number(e.target.value) })} /></div>
            </div>
            <div className="fila" style={{ justifyContent: "flex-end" }}>
              <button className="btn suave" onClick={() => setNuevo(null)}>Cerrar</button>
              <button className="btn oro" onClick={async () => {
                try {
                  await api("tratamientos", { method: "POST", body: { nombre: nuevo.nombre, area_id: nuevo.area_id, precio_eur: nuevo.precio_eur === "" ? null : Number(nuevo.precio_eur), duracion_min: nuevo.duracion_min, requiere_valoracion: nuevo.precio_eur === "" } });
                  setNuevo(null); cargar();
                } catch (e: any) { alert(e.message); }
              }}>Guardar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Faq() {
  const [lista, setLista] = useState<any[]>([]);
  const cargar = () => api<any[]>("faq").then(setLista).catch(() => {});
  useEffect(() => { cargar(); }, []);

  return (
    <>
      <p className="nota">Alexia relee estas respuestas cada 5 minutos. Desactiva en vez de borrar para conservar el histórico.</p>
      {lista.map((f) => (
        <div className="card" key={f.id} style={{ marginBottom: 10, opacity: f.activo ? 1 : 0.5 }}>
          <div className="campo"><label>Pregunta</label>
            <input defaultValue={f.pregunta} onBlur={(e) => api(`faq/${f.id}`, { method: "PATCH", body: { pregunta: e.target.value } })} /></div>
          <div className="campo"><label>Respuesta</label>
            <textarea rows={2} defaultValue={f.respuesta} onBlur={(e) => api(`faq/${f.id}`, { method: "PATCH", body: { respuesta: e.target.value } })} /></div>
          <label style={{ fontSize: 12.5 }}>
            <input type="checkbox" defaultChecked={f.activo} onChange={(e) => api(`faq/${f.id}`, { method: "PATCH", body: { activo: e.target.checked } })} /> Activa
          </label>
        </div>
      ))}
      <button className="btn oro" onClick={async () => {
        const pregunta = prompt("Pregunta:"); if (!pregunta) return;
        const respuesta = prompt("Respuesta:"); if (!respuesta) return;
        await api("faq", { method: "POST", body: { pregunta, respuesta } }); cargar();
      }}>+ Añadir pregunta</button>
    </>
  );
}

function Horarios() {
  const [lista, setLista] = useState<any[]>([]);
  const [medicos, setMedicos] = useState<any[]>([]);
  const [f, setF] = useState({ medico_id: 0, dia_semana: 1, hora_inicio: "09:00", hora_fin: "17:00" });
  const cargar = () => api<any[]>("horarios").then(setLista).catch(() => {});
  useEffect(() => { cargar(); api<any[]>("medicos").then((m) => { setMedicos(m); if (m[0]) setF((x) => ({ ...x, medico_id: m[0].id })); }); }, []);

  return (
    <>
      <p className="nota">Horario semanal recurrente de cada médico. La agenda del bot solo ofrece huecos dentro de estos tramos.</p>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="fila">
          <select value={f.medico_id} onChange={(e) => setF({ ...f, medico_id: Number(e.target.value) })} style={{ width: 220 }}>
            {medicos.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>
          <select value={f.dia_semana} onChange={(e) => setF({ ...f, dia_semana: Number(e.target.value) })} style={{ width: 140 }}>
            {[1, 2, 3, 4, 5, 6, 0].map((d) => <option key={d} value={d}>{DIAS[d]}</option>)}
          </select>
          <input type="time" value={f.hora_inicio} onChange={(e) => setF({ ...f, hora_inicio: e.target.value })} style={{ width: 120 }} />
          <input type="time" value={f.hora_fin} onChange={(e) => setF({ ...f, hora_fin: e.target.value })} style={{ width: 120 }} />
          <button className="btn oro" onClick={async () => { try { await api("horarios", { method: "POST", body: f }); cargar(); } catch (e: any) { alert(e.message); } }}>+ Añadir tramo</button>
        </div>
      </div>
      <table className="t">
        <thead><tr><th>Médico</th><th>Día</th><th>Tramo</th><th></th></tr></thead>
        <tbody>
          {lista.map((h) => (
            <tr key={h.id}>
              <td>{h.medicos?.nombre}</td>
              <td>{DIAS[h.dia_semana]}</td>
              <td>{String(h.hora_inicio).slice(0, 5)} – {String(h.hora_fin).slice(0, 5)}</td>
              <td><button className="btn mini suave" onClick={() => { if (confirm("¿Eliminar tramo?")) api(`horarios/${h.id}`, { method: "DELETE" }).then(cargar); }}>Eliminar</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Bloqueos() {
  const [lista, setLista] = useState<any[]>([]);
  const [medicos, setMedicos] = useState<any[]>([]);
  const [f, setF] = useState({ medico_id: 0, fecha_inicio: "", fecha_fin: "", motivo: "" });
  const cargar = () => api<any[]>("bloqueos").then(setLista).catch(() => {});
  useEffect(() => { cargar(); api<any[]>("medicos").then((m) => { setMedicos(m); if (m[0]) setF((x) => ({ ...x, medico_id: m[0].id })); }); }, []);

  return (
    <>
      <p className="nota">Vacaciones, congresos, festivos… El bot no ofrecerá huecos dentro de un bloqueo.</p>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="fila">
          <select value={f.medico_id} onChange={(e) => setF({ ...f, medico_id: Number(e.target.value) })} style={{ width: 220 }}>
            {medicos.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>
          <input type="date" value={f.fecha_inicio} onChange={(e) => setF({ ...f, fecha_inicio: e.target.value })} />
          <span>hasta</span>
          <input type="date" value={f.fecha_fin} onChange={(e) => setF({ ...f, fecha_fin: e.target.value })} />
          <input placeholder="Motivo (opcional)" value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })} style={{ width: 200 }} />
          <button className="btn oro" onClick={async () => {
            if (!f.fecha_inicio || !f.fecha_fin) { alert("Indica las fechas"); return; }
            try { await api("bloqueos", { method: "POST", body: f }); cargar(); } catch (e: any) { alert(e.message); }
          }}>+ Bloquear</button>
        </div>
      </div>
      <table className="t">
        <thead><tr><th>Médico</th><th>Desde</th><th>Hasta</th><th>Motivo</th><th></th></tr></thead>
        <tbody>
          {lista.map((b) => (
            <tr key={b.id}>
              <td>{b.medicos?.nombre}</td>
              <td>{new Date(b.inicio).toLocaleDateString("es-ES")}</td>
              <td>{new Date(b.fin).toLocaleDateString("es-ES")}</td>
              <td>{b.motivo ?? "—"}</td>
              <td><button className="btn mini suave" onClick={() => { if (confirm("¿Eliminar bloqueo?")) api(`bloqueos/${b.id}`, { method: "DELETE" }).then(cargar); }}>Eliminar</button></td>
            </tr>
          ))}
          {lista.length === 0 && <tr><td colSpan={5} className="vacio">Sin bloqueos próximos</td></tr>}
        </tbody>
      </table>
    </>
  );
}
