"use client";
import { useEffect, useState } from "react";
import { api, fmtFechaHora } from "./api";

export default function Clientes() {
  const [sub, setSub] = useState<"clientes" | "escalados">("clientes");
  return (
    <>
      <div className="subtabs">
        <button className={sub === "clientes" ? "on" : ""} onClick={() => setSub("clientes")}>Clientes</button>
        <button className={sub === "escalados" ? "on" : ""} onClick={() => setSub("escalados")}>Conversaciones escaladas</button>
      </div>
      {sub === "clientes" ? <ListaClientes /> : <Escalados />}
    </>
  );
}

function ListaClientes() {
  const [q, setQ] = useState("");
  const [lista, setLista] = useState<any[]>([]);
  const [ficha, setFicha] = useState<any | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api<any[]>(`clientes${q ? `?q=${encodeURIComponent(q)}` : ""}`).then(setLista).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <>
      <div className="fila">
        <input placeholder="Buscar por nombre, apellidos o teléfono…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 340 }} />
      </div>
      <table className="t">
        <thead><tr><th>Nombre</th><th>Teléfono</th><th>Email</th><th>RGPD</th><th>Alta</th><th></th></tr></thead>
        <tbody>
          {lista.map((c) => (
            <tr key={c.id}>
              <td>{[c.nombre, c.apellidos].filter(Boolean).join(" ") || <i style={{ color: "var(--muted)" }}>sin nombre</i>}</td>
              <td>{c.telefono}{c.telefono_contacto ? ` · ☎ ${c.telefono_contacto}` : ""}</td>
              <td>{c.email ?? "—"}</td>
              <td>{c.consentimiento_rgpd ? <span className="chip confirmada">aceptado</span> : <span className="chip cancelada">no</span>}</td>
              <td>{new Date(c.created_at).toLocaleDateString("es-ES")}</td>
              <td><button className="btn mini suave" onClick={() => api(`clientes/${c.id}`).then(setFicha)}>Ficha</button></td>
            </tr>
          ))}
          {lista.length === 0 && <tr><td colSpan={6} className="vacio">Sin resultados</td></tr>}
        </tbody>
      </table>
      {ficha && <FichaCliente cliente={ficha} onCerrar={() => setFicha(null)} />}
    </>
  );
}

function FichaCliente({ cliente, onCerrar }: { cliente: any; onCerrar: () => void }) {
  const [f, setF] = useState({ nombre: cliente.nombre ?? "", apellidos: cliente.apellidos ?? "", email: cliente.email ?? "", telefono_contacto: cliente.telefono_contacto ?? "" });
  const [msg, setMsg] = useState("");

  async function guardar() {
    try {
      await api(`clientes/${cliente.id}`, { method: "PATCH", body: { ...f, email: f.email || null, telefono_contacto: f.telefono_contacto || null } });
      setMsg("Guardado ✓");
    } catch (e: any) { setMsg(e.message); }
  }

  return (
    <div className="modal-bg" onClick={onCerrar}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Ficha · {cliente.telefono}</h3>
        <div className="campo" style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><label>Nombre</label><input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></div>
          <div style={{ flex: 1 }}><label>Apellidos</label><input value={f.apellidos} onChange={(e) => setF({ ...f, apellidos: e.target.value })} /></div>
        </div>
        <div className="campo"><label>Email</label><input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div className="campo"><label>Teléfono de contacto (si difiere del WhatsApp)</label><input value={f.telefono_contacto} onChange={(e) => setF({ ...f, telefono_contacto: e.target.value })} /></div>
        <p className="nota">
          Consentimiento RGPD: {cliente.consentimiento_rgpd ? `aceptado el ${new Date(cliente.consentimiento_fecha).toLocaleString("es-ES")}` : "no aceptado"}
        </p>
        <h3 style={{ marginTop: 16 }}>Citas</h3>
        <table className="t">
          <thead><tr><th>Cuándo</th><th>Médico</th><th>Tratamiento</th><th>Estado</th></tr></thead>
          <tbody>
            {cliente.citas.map((c: any) => (
              <tr key={c.id}>
                <td>{fmtFechaHora(c.inicio)}</td>
                <td>{c.medicos?.nombre ?? "—"}</td>
                <td>{c.tratamientos?.nombre ?? "—"}</td>
                <td><span className={`chip ${c.estado}`}>{c.estado}</span></td>
              </tr>
            ))}
            {cliente.citas.length === 0 && <tr><td colSpan={4} className="vacio">Sin citas</td></tr>}
          </tbody>
        </table>
        <div className="fila" style={{ marginTop: 14, justifyContent: "flex-end" }}>
          <span className="nota">{msg}</span>
          <button className="btn suave" onClick={onCerrar}>Cerrar</button>
          <button className="btn oro" onClick={guardar}>Guardar cambios</button>
        </div>
      </div>
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
