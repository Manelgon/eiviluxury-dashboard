"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
import Logs from "./Logs";
import Derechos from "./Derechos";
import DocumentosRgpd from "./DocumentosRgpd";

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
        <button className={sub === "medicos" ? "on" : ""} onClick={() => setSub("medicos")}>Médicos</button>
        {puedeUsuarios && <button className={sub === "usuarios" ? "on" : ""} onClick={() => setSub("usuarios")}>Usuarios y permisos</button>}
        <button className={sub === "derechos" ? "on" : ""} onClick={() => setSub("derechos")}>Derechos RGPD</button>
        <button className={sub === "docs-rgpd" ? "on" : ""} onClick={() => setSub("docs-rgpd")}>Documentos RGPD</button>
        {puedeUsuarios && <button className={sub === "logs" ? "on" : ""} onClick={() => setSub("logs")}>Logs</button>}
      </div>
      {sub === "tratamientos" && <Tratamientos />}
      {sub === "faq" && <Faq />}
      {sub === "horarios" && <Horarios />}
      {sub === "bloqueos" && <Bloqueos />}
      {sub === "areas" && <Areas />}
      {sub === "medicos" && <Medicos />}
      {sub === "usuarios" && puedeUsuarios && <Usuarios rolActual={rol} />}
      {sub === "derechos" && <Derechos />}
      {sub === "docs-rgpd" && <DocumentosRgpd />}
      {sub === "logs" && puedeUsuarios && <Logs />}
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

/* Fichas de médicos y enfermería: la agenda, sus áreas, y a lo que se vincula el usuario del panel */
function Medicos() {
  const [lista, setLista] = useState<any[]>([]);
  const [areas, setAreas] = useState<any[]>([]);
  const [nuevo, setNuevo] = useState<any | null>(null);
  const [editar, setEditar] = useState<any | null>(null);
  const cargar = () => api<any[]>("medicos").then(setLista).catch((e) => alert(e.message));
  useEffect(() => { cargar(); api<any[]>("areas").then((a) => setAreas(a.filter((x: any) => x.activo))).catch(() => {}); }, []);

  async function actualizar(id: number, campos: any) {
    try { await api(`medicos/${id}`, { method: "PATCH", body: campos }); cargar(); }
    catch (e: any) { alert(e.message); cargar(); }
  }

  return (
    <>
      <p className="nota">
        La ficha de un médico es su columna de agenda: aquí se crea, se le asignan sus áreas y luego se le da horario (Horarios) y usuario del panel (Usuarios y permisos → vincular). Desactivar en vez de borrar: se conservan sus citas e historia.
      </p>
      <div className="fila">
        <button className="btn oro" onClick={() => setNuevo({ nombre: "", tipo: "medico", areas: [] })}>+ Crear médico</button>
      </div>
      <table className="t">
        <thead><tr><th>Nombre</th><th>Tipo</th><th>Áreas (su especialidad)</th><th>Activo</th><th></th></tr></thead>
        <tbody>
          {lista.map((m) => {
            const suyas = (m.medico_areas ?? []).map((x: any) => x.area_id);
            return (
              <tr key={m.id} style={{ opacity: m.activo ? 1 : 0.5 }}>
                <td style={{ width: 220 }}>
                  <input defaultValue={m.nombre} onBlur={(e) => { if (e.target.value.trim() && e.target.value !== m.nombre) actualizar(m.id, { nombre: e.target.value.trim() }); }} />
                </td>
                <td style={{ width: 130 }}>
                  <select defaultValue={m.tipo ?? "medico"} onChange={(e) => actualizar(m.id, { tipo: e.target.value })}>
                    <option value="medico">medico</option>
                    <option value="enfermera">enfermería</option>
                  </select>
                </td>
                <td>
                  {areas.map((a) => (
                    <label key={a.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, marginRight: 12, fontSize: 12.5 }}>
                      <input type="checkbox" style={{ width: "auto" }} checked={suyas.includes(a.id)}
                        onChange={(e) => actualizar(m.id, { areas: e.target.checked ? [...suyas, a.id] : suyas.filter((x: number) => x !== a.id) })} />
                      {a.nombre}
                    </label>
                  ))}
                </td>
                <td><input type="checkbox" defaultChecked={m.activo} onChange={(e) => actualizar(m.id, { activo: e.target.checked })} /></td>
                <td><button className="btn mini suave" title={m.num_colegiado ? `Colegiado ${m.num_colegiado}` : "Sin nº colegiado"} onClick={() => setEditar(m)}>✎ Ficha</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {editar && <FichaMedico medico={editar} onCerrar={(ok) => { setEditar(null); if (ok) cargar(); }} />}
      {nuevo && (
        <div className="modal-bg" onClick={() => setNuevo(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Nueva ficha de médico</h3>
            <div className="campo"><label>Nombre (como se verá en agenda y bot)</label>
              <input value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} placeholder="Dr./Dra. Nombre Apellido" /></div>
            <div className="campo"><label>Tipo</label>
              <select value={nuevo.tipo} onChange={(e) => setNuevo({ ...nuevo, tipo: e.target.value })}>
                <option value="medico">Médico</option>
                <option value="enfermera">Enfermería</option>
              </select>
            </div>
            <div className="campo"><label>Áreas en las que trabaja</label>
              <div>
                {areas.map((a) => (
                  <label key={a.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, marginRight: 12, fontSize: 13 }}>
                    <input type="checkbox" style={{ width: "auto" }} checked={nuevo.areas.includes(a.id)}
                      onChange={(e) => setNuevo({ ...nuevo, areas: e.target.checked ? [...nuevo.areas, a.id] : nuevo.areas.filter((x: number) => x !== a.id) })} />
                    {a.nombre}
                  </label>
                ))}
              </div>
            </div>
            <div className="fila" style={{ justifyContent: "flex-end" }}>
              <button className="btn suave" onClick={() => setNuevo(null)}>Cerrar</button>
              <button className="btn oro" onClick={async () => {
                if (!nuevo.nombre.trim()) { alert("Falta el nombre"); return; }
                try { await api("medicos", { method: "POST", body: nuevo }); setNuevo(null); cargar(); }
                catch (e: any) { alert(e.message); }
              }}>Crear ficha</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* Editor de la ficha completa del facultativo (datos SANIAN: colegiado, DNI...) */
function FichaMedico({ medico, onCerrar }: { medico: any; onCerrar: (ok: boolean) => void }) {
  const [f, setF] = useState({
    num_colegiado: medico.num_colegiado ?? "", dni: medico.dni ?? "", telefono: medico.telefono ?? "",
    email: medico.email ?? "", fecha_nacimiento: medico.fecha_nacimiento ?? "", direccion: medico.direccion ?? "", bio: medico.bio ?? "",
  });
  const [error, setError] = useState("");
  return (
    <div className="modal-bg" onClick={() => onCerrar(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Ficha · {medico.nombre}</h3>
        <div className="campo" style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><label>Nº colegiado</label><input value={f.num_colegiado} onChange={(e) => setF({ ...f, num_colegiado: e.target.value })} /></div>
          <div style={{ flex: 1 }}><label>DNI</label><input value={f.dni} onChange={(e) => setF({ ...f, dni: e.target.value })} /></div>
          <div style={{ flex: 1 }}><label>Fecha de nacimiento</label><input type="date" value={f.fecha_nacimiento} onChange={(e) => setF({ ...f, fecha_nacimiento: e.target.value })} /></div>
        </div>
        <div className="campo" style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><label>Teléfono</label><input value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} /></div>
          <div style={{ flex: 1 }}><label>Email</label><input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        </div>
        <div className="campo"><label>Dirección</label><input value={f.direccion} onChange={(e) => setF({ ...f, direccion: e.target.value })} /></div>
        <div className="campo"><label>Bio / notas</label><textarea rows={2} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} /></div>
        {error && <div className="error">{error}</div>}
        <div className="fila" style={{ justifyContent: "flex-end" }}>
          <button className="btn suave" onClick={() => onCerrar(false)}>Cerrar</button>
          <button className="btn oro" onClick={async () => {
            try {
              await api(`medicos/${medico.id}`, {
                method: "PATCH",
                body: Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === "" ? null : v])),
              });
              onCerrar(true);
            } catch (e: any) { setError(e.message); }
          }}>Guardar</button>
        </div>
      </div>
    </div>
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
      <p className="nota">Los usuarios se dan de alta al momento: pueden entrar con su email y contraseña nada más crearlos. Roles: admin (técnico) · direccion (todo) · recepcion (gestión) · enfermera (agenda completa) · medico (solo su agenda, requiere vincular su columna). Si un médico nuevo no aparece en "Vinculado a", crea antes su ficha en <b>Configuración → Médicos</b>: sin vincular no verá agenda ni pacientes.</p>
      <div className="fila">
        <button className="btn oro" onClick={() => setNuevo({ paso: "tipo" })}>+ Crear usuario</button>
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
        <CrearUsuario rolActual={rolActual} medicos={medicos}
          onCerrar={(ok) => { setNuevo(null); if (ok) { cargar(); api<any[]>("medicos").then(setMedicos).catch(() => {}); } }} />
      )}
    </>
  );
}

/* Alta de usuario en dos pasos: elegir QUÉ se crea → formulario adaptado.
   Médico/enfermería crean a la vez el acceso Y su ficha (o se vinculan a una existente). */
function CrearUsuario({ rolActual, medicos, onCerrar }: { rolActual: string; medicos: any[]; onCerrar: (ok: boolean) => void }) {
  const [tipo, setTipo] = useState<string | null>(null);
  const [areas, setAreas] = useState<any[]>([]);
  const [f, setF] = useState<any>({ email: "", password: "", nombre: "" });
  const [ficha, setFicha] = useState<any>({ nombre: "", num_colegiado: "", dni: "", telefono: "", fecha_nacimiento: "", direccion: "", bio: "", areas: [] });
  const [vincularA, setVincularA] = useState<number | "">(""); // ficha existente en vez de crear
  const [error, setError] = useState("");
  const [creando, setCreando] = useState(false);

  useEffect(() => { api<any[]>("areas").then((a) => setAreas(a.filter((x: any) => x.activo))).catch(() => {}); }, []);

  const TIPOS = [
    { id: "medico", t: "🩺 Médico", d: "Acceso + ficha de facultativo (nº colegiado, áreas, agenda). Solo ve su agenda y sus pacientes." },
    { id: "enfermera", t: "💉 Enfermería", d: "Acceso + ficha de enfermería con su columna de agenda." },
    { id: "direccion", t: "👔 Dirección", d: "Acceso total: gestión, configuración, usuarios, logs e historia clínica." },
    { id: "recepcion", t: "🛎 Recepción", d: "Gestión de agenda, pacientes y lista de espera. Sin datos clínicos ni usuarios." },
    ...(rolActual === "admin" ? [{ id: "admin", t: "⚙ Admin (técnico)", d: "Todo, incluido conceder rol admin." }] : []),
  ];
  const esSanitario = tipo === "medico" || tipo === "enfermera";
  const fichasLibres = medicos.filter((m: any) => m.activo && (tipo !== "medico" || m.tipo !== "enfermera") && (tipo !== "enfermera" || m.tipo === "enfermera"));

  async function crear() {
    setError("");
    if (!f.email || !f.password) { setError("Faltan email o contraseña"); return; }
    setCreando(true);
    try {
      const body: any = { email: f.email, password: f.password, rol: tipo };
      if (esSanitario) {
        if (vincularA) { body.medico_id = vincularA; body.nombre = f.nombre || medicos.find((m: any) => m.id === vincularA)?.nombre; }
        else { body.ficha = ficha; body.nombre = ficha.nombre; }
      } else body.nombre = f.nombre;
      await api("usuarios", { method: "POST", body });
      onCerrar(true);
    } catch (e: any) { setError(e.message); }
    finally { setCreando(false); }
  }

  return (
    <div className="modal-bg" onClick={() => onCerrar(false)}>
      <div className="modal" style={{ width: "min(680px,96vw)", maxHeight: "92vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        {!tipo ? (
          <>
            <h3>¿Qué usuario quieres crear?</h3>
            {TIPOS.map((t) => (
              <button key={t.id} className="card" style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 8, cursor: "pointer" }}
                onClick={() => setTipo(t.id)}>
                <b>{t.t}</b>
                <p className="nota" style={{ margin: "4px 0 0" }}>{t.d}</p>
              </button>
            ))}
            <div className="fila" style={{ justifyContent: "flex-end" }}>
              <button className="btn suave" onClick={() => onCerrar(false)}>Cerrar</button>
            </div>
          </>
        ) : (
          <>
            <h3>{TIPOS.find((t) => t.id === tipo)?.t} · nuevo usuario</h3>

            {/* Acceso al panel */}
            <div className="campo" style={{ display: "flex", gap: 10 }}>
              <div style={{ flex: 1 }}><label>Email de acceso</label>
                <input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
              <div style={{ flex: 1 }}><label>Contraseña (mín. 8)</label>
                <input type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
            </div>

            {!esSanitario && (
              <div className="campo"><label>Nombre</label>
                <input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></div>
            )}

            {esSanitario && (
              <>
                {fichasLibres.length > 0 && (
                  <div className="campo"><label>¿Ya existe su ficha? (opcional — si eliges una, no se crea ficha nueva)</label>
                    <select value={vincularA} onChange={(e) => setVincularA(e.target.value ? Number(e.target.value) : "")}>
                      <option value="">— No, crear ficha nueva —</option>
                      {fichasLibres.map((m: any) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                    </select>
                  </div>
                )}
                {!vincularA && (
                  <div className="card" style={{ marginBottom: 10 }}>
                    <p className="nota" style={{ marginTop: 0 }}><b>Ficha del facultativo</b> — se crea a la vez que el acceso y queda vinculada</p>
                    <div className="campo"><label>Nombre (como saldrá en agenda y bot) *</label>
                      <input value={ficha.nombre} onChange={(e) => setFicha({ ...ficha, nombre: e.target.value })} placeholder="Dr./Dra. Nombre Apellidos" /></div>
                    <div className="campo" style={{ display: "flex", gap: 10 }}>
                      <div style={{ flex: 1 }}><label>Nº colegiado {tipo === "medico" ? "*" : "(opcional)"}</label>
                        <input value={ficha.num_colegiado} onChange={(e) => setFicha({ ...ficha, num_colegiado: e.target.value })} /></div>
                      <div style={{ flex: 1 }}><label>DNI</label>
                        <input value={ficha.dni} onChange={(e) => setFicha({ ...ficha, dni: e.target.value })} /></div>
                      <div style={{ flex: 1 }}><label>Fecha de nacimiento</label>
                        <input type="date" value={ficha.fecha_nacimiento} onChange={(e) => setFicha({ ...ficha, fecha_nacimiento: e.target.value })} /></div>
                    </div>
                    <div className="campo" style={{ display: "flex", gap: 10 }}>
                      <div style={{ flex: 1 }}><label>Teléfono</label>
                        <input value={ficha.telefono} onChange={(e) => setFicha({ ...ficha, telefono: e.target.value })} /></div>
                      <div style={{ flex: 2 }}><label>Dirección</label>
                        <input value={ficha.direccion} onChange={(e) => setFicha({ ...ficha, direccion: e.target.value })} /></div>
                    </div>
                    <div className="campo"><label>Áreas en las que trabaja {tipo === "medico" ? "*" : ""}</label>
                      <div>
                        {areas.map((a) => (
                          <label key={a.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, marginRight: 12, fontSize: 13 }}>
                            <input type="checkbox" style={{ width: "auto" }} checked={ficha.areas.includes(a.id)}
                              onChange={(e) => setFicha({ ...ficha, areas: e.target.checked ? [...ficha.areas, a.id] : ficha.areas.filter((x: number) => x !== a.id) })} />
                            {a.nombre}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="campo"><label>Bio / notas (opcional)</label>
                      <textarea rows={2} value={ficha.bio} onChange={(e) => setFicha({ ...ficha, bio: e.target.value })} /></div>
                    <p className="nota" style={{ margin: 0 }}>Después: asigna su horario en Configuración → Horarios para que aparezca en la agenda y el bot le pueda dar citas.</p>
                  </div>
                )}
              </>
            )}

            {error && <div className="error">{error}</div>}
            <div className="fila" style={{ justifyContent: "flex-end" }}>
              <button className="btn suave" onClick={() => setTipo(null)}>← Atrás</button>
              <button className="btn oro" disabled={creando} onClick={crear}>{creando ? "Creando…" : "Crear y dar de alta"}</button>
            </div>
          </>
        )}
      </div>
    </div>
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
        <thead><tr><th>Tratamiento</th><th>Área</th><th>Precio €</th><th>Valoración</th><th>Min</th><th>💉 Enferm.</th><th>Activo</th></tr></thead>
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
              <td><input type="checkbox" title="Requiere enfermera de apoyo" defaultChecked={t.requiere_enfermeria} onChange={(e) => actualizar(t.id, { requiere_enfermeria: e.target.checked })} /></td>
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
