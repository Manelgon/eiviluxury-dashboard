"use client";
import { useEffect, useState } from "react";
import { api } from "./api";

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

export default function Config({ sub, setSub, rol }: { sub: string; setSub: (s: string) => void; rol: string }) {
  const puedeUsuarios = rol === "admin" || rol === "direccion";
  return (
    <>
      <div className="subtabs">
        <button className={sub === "tratamientos" ? "on" : ""} onClick={() => setSub("tratamientos")}>Tratamientos y precios</button>
        <button className={sub === "faq" ? "on" : ""} onClick={() => setSub("faq")}>FAQ del bot</button>
        <button className={sub === "horarios" ? "on" : ""} onClick={() => setSub("horarios")}>Horarios</button>
        <button className={sub === "bloqueos" ? "on" : ""} onClick={() => setSub("bloqueos")}>Vacaciones y bloqueos</button>
        <button className={sub === "areas" ? "on" : ""} onClick={() => setSub("areas")}>Áreas</button>
        {puedeUsuarios && <button className={sub === "usuarios" ? "on" : ""} onClick={() => setSub("usuarios")}>Usuarios y permisos</button>}
      </div>
      {sub === "tratamientos" && <Tratamientos />}
      {sub === "faq" && <Faq />}
      {sub === "horarios" && <Horarios />}
      {sub === "bloqueos" && <Bloqueos />}
      {sub === "areas" && <Areas />}
      {sub === "usuarios" && puedeUsuarios && <Usuarios rolActual={rol} />}
    </>
  );
}

function Areas() {
  const [lista, setLista] = useState<any[]>([]);
  const [nombre, setNombre] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const cargar = () => api<any[]>("areas").then(setLista).catch(() => {});
  useEffect(() => { cargar(); }, []);

  return (
    <>
      <p className="nota">Las áreas organizan tratamientos y médicos. Desactivar en vez de borrar (los tratamientos vinculados se conservan).</p>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="fila" style={{ marginBottom: 0 }}>
          <input placeholder="Nombre del área nueva" value={nombre} onChange={(e) => setNombre(e.target.value)} style={{ width: 240 }} />
          <input placeholder="Descripción (opcional)" value={descripcion} onChange={(e) => setDescripcion(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <button className="btn oro" onClick={async () => {
            if (!nombre.trim()) return;
            try { await api("areas", { method: "POST", body: { nombre: nombre.trim(), descripcion: descripcion.trim() || null } }); setNombre(""); setDescripcion(""); cargar(); }
            catch (e: any) { alert(e.message); }
          }}>+ Crear área</button>
        </div>
      </div>
      <table className="t">
        <thead><tr><th>Área</th><th>Descripción</th><th>Activa</th></tr></thead>
        <tbody>
          {lista.map((a) => (
            <tr key={a.id} style={{ opacity: a.activo ? 1 : 0.5 }}>
              <td style={{ width: 260 }}>
                <input defaultValue={a.nombre} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== a.nombre) api(`areas/${a.id}`, { method: "PATCH", body: { nombre: e.target.value.trim() } }).catch((er: any) => alert(er.message)); }} />
              </td>
              <td><input defaultValue={a.descripcion ?? ""} onBlur={(e) => api(`areas/${a.id}`, { method: "PATCH", body: { descripcion: e.target.value || null } })} /></td>
              <td><input type="checkbox" defaultChecked={a.activo} onChange={(e) => api(`areas/${a.id}`, { method: "PATCH", body: { activo: e.target.checked } })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Usuarios({ rolActual }: { rolActual: string }) {
  const [lista, setLista] = useState<any[]>([]);
  const [medicos, setMedicos] = useState<any[]>([]);
  const [nuevo, setNuevo] = useState<any | null>(null);
  const ROLES = ["direccion", "recepcion", "enfermera", "medico", ...(rolActual === "admin" ? ["admin"] : [])];
  const cargar = () => api<any[]>("usuarios").then(setLista).catch((e) => alert(e.message));
  useEffect(() => { cargar(); api<any[]>("medicos").then(setMedicos).catch(() => {}); }, []);

  return (
    <>
      <p className="nota">Los usuarios se dan de alta al momento: pueden entrar con su email y contraseña nada más crearlos. Roles: admin (técnico) · direccion (todo) · recepcion (gestión) · enfermera (agenda completa) · medico (solo su agenda, requiere vincular su columna).</p>
      <div className="fila">
        <button className="btn oro" onClick={() => setNuevo({ email: "", password: "", nombre: "", rol: "recepcion", medico_id: null })}>+ Crear usuario</button>
      </div>
      <table className="t">
        <thead><tr><th>Email</th><th>Nombre</th><th>Rol</th><th>Vinculado a</th><th>Activo</th><th></th></tr></thead>
        <tbody>
          {lista.map((us) => (
            <tr key={us.user_id} style={{ opacity: us.activo ? 1 : 0.5 }}>
              <td>{us.email}</td>
              <td>{us.nombre ?? "—"}</td>
              <td style={{ width: 140 }}>
                <select defaultValue={us.rol} onChange={(e) => api(`usuarios/${us.user_id}`, { method: "PATCH", body: { rol: e.target.value } }).catch((er: any) => { alert(er.message); cargar(); })}>
                  {[...new Set([us.rol, ...ROLES])].map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </td>
              <td style={{ width: 180 }}>
                {["medico", "enfermera"].includes(us.rol) ? (
                  <select defaultValue={us.medico_id ?? ""} onChange={(e) => api(`usuarios/${us.user_id}`, { method: "PATCH", body: { medico_id: e.target.value ? Number(e.target.value) : null } })}>
                    <option value="">— sin vincular —</option>
                    {medicos.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                  </select>
                ) : "—"}
              </td>
              <td><input type="checkbox" defaultChecked={us.activo} onChange={(e) => api(`usuarios/${us.user_id}`, { method: "PATCH", body: { activo: e.target.checked } }).catch((er: any) => { alert(er.message); cargar(); })} /></td>
              <td>
                <button className="btn mini suave" onClick={() => {
                  const p = prompt(`Nueva contraseña para ${us.email} (mín. 8 caracteres):`);
                  if (p) api(`usuarios/${us.user_id}`, { method: "PATCH", body: { password: p } }).then(() => alert("Contraseña cambiada")).catch((er: any) => alert(er.message));
                }}>Contraseña</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {nuevo && (
        <div className="modal-bg" onClick={() => setNuevo(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Crear usuario del panel</h3>
            <div className="campo"><label>Email</label><input type="email" value={nuevo.email} onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} /></div>
            <div className="campo"><label>Contraseña (mín. 8 caracteres)</label><input type="text" value={nuevo.password} onChange={(e) => setNuevo({ ...nuevo, password: e.target.value })} /></div>
            <div className="campo"><label>Nombre</label><input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} /></div>
            <div className="campo"><label>Rol</label>
              <select value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value })}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            {["medico", "enfermera"].includes(nuevo.rol) && (
              <div className="campo"><label>Vincular a su columna de agenda</label>
                <select value={nuevo.medico_id ?? ""} onChange={(e) => setNuevo({ ...nuevo, medico_id: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">— elegir —</option>
                  {medicos.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                </select>
              </div>
            )}
            <div className="fila" style={{ justifyContent: "flex-end" }}>
              <button className="btn suave" onClick={() => setNuevo(null)}>Cerrar</button>
              <button className="btn oro" onClick={async () => {
                try { await api("usuarios", { method: "POST", body: nuevo }); setNuevo(null); cargar(); }
                catch (e: any) { alert(e.message); }
              }}>Crear y dar de alta</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Tratamientos() {
  const [lista, setLista] = useState<any[]>([]);
  const [areas, setAreas] = useState<any[]>([]);
  const [nuevo, setNuevo] = useState<any | null>(null);
  const cargar = () => api<any[]>("tratamientos").then(setLista).catch(() => {});
  useEffect(() => { cargar(); api<any[]>("areas").then((a) => setAreas(a.filter((x: any) => x.activo))).catch(() => {}); }, []);

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
