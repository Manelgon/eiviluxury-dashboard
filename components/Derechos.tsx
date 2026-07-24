"use client";
import { useEffect, useState } from "react";
import { api, fmtFechaHora } from "./api";

const TIPO_L: Record<string, string> = {
  acceso: "Acceso", rectificacion: "Rectificación", supresion: "Supresión",
  portabilidad: "Portabilidad", oposicion: "Oposición", limitacion: "Limitación",
};

export default function Derechos() {
  const [lista, setLista] = useState<any[]>([]);
  const cargar = () => api<any[]>("derechos").then(setLista).catch((e) => alert(e.message));
  useEffect(() => { cargar(); }, []);

  async function cambiar(id: number, estado: string) {
    try { await api(`derechos/${id}`, { method: "PATCH", body: { estado } }); cargar(); }
    catch (e: any) { alert(e.message); }
  }

  const urlPublica = typeof window !== "undefined" ? `${window.location.origin}/derechos` : "/derechos";

  return (
    <>
      <p className="nota">
        Solicitudes de derechos RGPD (acceso, rectificación, supresión…). Plazo legal de respuesta: <b>1 mes</b>.
        Formulario público para pacientes: <a href="/derechos" target="_blank" rel="noopener">{urlPublica}</a> — Alexia también las registra desde WhatsApp.
        Para una supresión con obligación de conservar historial: usar <b>Anonimizar</b> en la papelera de clientes (solo admin/dirección).
      </p>
      <table className="t">
        <thead><tr><th>Fecha</th><th>Solicitante</th><th>Derecho</th><th>Detalle</th><th>Canal</th><th>Estado</th><th>Notas</th></tr></thead>
        <tbody>
          {lista.map((d) => (
            <tr key={d.id} style={{ opacity: d.estado === "resuelta" ? 0.6 : 1 }}>
              <td style={{ whiteSpace: "nowrap" }}>{fmtFechaHora(d.created_at)}</td>
              <td>{d.nombre ?? "—"}<br /><small style={{ color: "var(--muted)" }}>{d.contacto}</small></td>
              <td><span className="chip">{TIPO_L[d.tipo_derecho] ?? d.tipo_derecho}</span></td>
              <td style={{ maxWidth: 260 }}>{d.descripcion ?? "—"}</td>
              <td>{d.canal}</td>
              <td style={{ width: 130 }}>
                <select value={d.estado} onChange={(e) => cambiar(d.id, e.target.value)}>
                  <option value="pendiente">pendiente</option>
                  <option value="en_proceso">en proceso</option>
                  <option value="resuelta">resuelta</option>
                </select>
                {d.resolucion_at && <small style={{ display: "block", color: "var(--muted)" }}>resuelta {new Date(d.resolucion_at).toLocaleDateString("es-ES")}</small>}
              </td>
              <td>
                <button className="btn mini suave" onClick={async () => {
                  const n = prompt("Notas internas:", d.notas_admin ?? "");
                  if (n !== null) { await api(`derechos/${d.id}`, { method: "PATCH", body: { notas_admin: n } }); cargar(); }
                }}>{d.notas_admin ? "📝 Ver/editar" : "＋ Añadir"}</button>
              </td>
            </tr>
          ))}
          {lista.length === 0 && <tr><td colSpan={7} className="vacio">Sin solicitudes</td></tr>}
        </tbody>
      </table>
    </>
  );
}
