"use client";
import { useEffect, useState } from "react";
import { api, fmtFechaHora } from "./api";

const COLOR = (a: string) =>
  a.startsWith("auth.") ? "completada"
  : a.includes("eliminar") || a.includes("fallido") || a.includes("revocar") ? "cancelada"
  : a.includes("crear") || a.includes("registrar") ? "confirmada"
  : "pendiente";

export default function Logs() {
  const [datos, setDatos] = useState<{ logs: any[]; total: number; page: number; size: number } | null>(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [detalle, setDetalle] = useState<any | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      api(`logs?page=${page}${q ? `&q=${encodeURIComponent(q)}` : ""}`).then(setDatos).catch((e) => alert(e.message));
    }, 300);
    return () => clearTimeout(t);
  }, [q, page]);

  const totalPaginas = datos ? Math.max(1, Math.ceil(datos.total / datos.size)) : 1;

  return (
    <>
      <p className="nota">Registro de auditoría RGPD: quién hizo qué y cuándo. Cada acción del panel y del asistente queda aquí. Solo visible para admin y dirección.</p>
      <div className="fila">
        <input placeholder="Buscar por acción, email o registro…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} style={{ maxWidth: 340 }} />
        <div style={{ flex: 1 }} />
        <button className="btn mini suave" disabled={page <= 1} onClick={() => setPage(page - 1)}>←</button>
        <span className="nota" style={{ margin: 0 }}>{page} / {totalPaginas} · {datos?.total ?? 0} registros</span>
        <button className="btn mini suave" disabled={page >= totalPaginas} onClick={() => setPage(page + 1)}>→</button>
      </div>
      <table className="t">
        <thead><tr><th>Cuándo</th><th>Quién</th><th>Acción</th><th>Registro</th><th></th></tr></thead>
        <tbody>
          {(datos?.logs ?? []).map((l) => (
            <tr key={l.id}>
              <td style={{ whiteSpace: "nowrap" }}>{fmtFechaHora(l.created_at)}</td>
              <td>{l.actor_email ?? <i style={{ color: "var(--muted)" }}>bot / sistema</i>}</td>
              <td><span className={`chip ${COLOR(l.accion)}`}>{l.accion}</span></td>
              <td>{l.recurso_label ?? (l.recurso_tipo ? `${l.recurso_tipo} #${l.recurso_id ?? ""}` : "—")}</td>
              <td>{l.metadata && <button className="btn mini suave" onClick={() => setDetalle(l)}>Detalle</button>}</td>
            </tr>
          ))}
          {datos?.logs.length === 0 && <tr><td colSpan={5} className="vacio">Sin registros</td></tr>}
        </tbody>
      </table>
      {detalle && (
        <div className="modal-bg" onClick={() => setDetalle(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{detalle.accion}</h3>
            <p className="nota">{fmtFechaHora(detalle.created_at)} · {detalle.actor_email ?? "bot / sistema"}</p>
            <pre style={{ background: "#fdfbf7", border: "1px solid var(--linea)", borderRadius: 10, padding: 12, fontSize: 12.5, overflow: "auto" }}>
              {JSON.stringify(detalle.metadata, null, 2)}
            </pre>
            <div className="fila" style={{ justifyContent: "flex-end" }}>
              <button className="btn suave" onClick={() => setDetalle(null)}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
