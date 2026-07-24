"use client";
import { useEffect, useMemo, useState } from "react";
import { api, fmtHora, fmtFechaHora, hoyISO } from "./api";

/* ============ Registro de widgets disponibles ============ */
const CATALOGO: { id: string; titulo: string }[] = [
  { id: "kpis", titulo: "Resumen de hoy" },
  { id: "citas_hoy", titulo: "Próximas citas de hoy" },
  { id: "escalados", titulo: "Conversaciones pendientes" },
  { id: "semana", titulo: "Citas esta semana" },
];
const ORDEN_DEFECTO = ["kpis", "citas_hoy", "escalados", "semana"];

interface Prefs { orden: string[]; ocultos: string[] }

function cargarPrefs(): Prefs {
  try {
    const raw = localStorage.getItem("eivi_inicio");
    if (raw) {
      const p = JSON.parse(raw);
      const validos = CATALOGO.map((w) => w.id);
      return {
        orden: [...p.orden.filter((id: string) => validos.includes(id)), ...validos.filter((v) => !p.orden.includes(v))],
        ocultos: (p.ocultos ?? []).filter((id: string) => validos.includes(id)),
      };
    }
  } catch {}
  return { orden: ORDEN_DEFECTO, ocultos: [] };
}

export default function Inicio() {
  const [prefs, setPrefs] = useState<Prefs>({ orden: ORDEN_DEFECTO, ocultos: [] });
  const [editar, setEditar] = useState(false);
  const [arrastrando, setArrastrando] = useState<string | null>(null);

  useEffect(() => { setPrefs(cargarPrefs()); }, []);
  const guardar = (p: Prefs) => { setPrefs(p); localStorage.setItem("eivi_inicio", JSON.stringify(p)); };

  const visibles = prefs.orden.filter((id) => !prefs.ocultos.includes(id));
  const ocultos = CATALOGO.filter((w) => prefs.ocultos.includes(w.id));

  function soltar(sobre: string) {
    if (!arrastrando || arrastrando === sobre) return;
    const orden = [...prefs.orden];
    const de = orden.indexOf(arrastrando);
    const a = orden.indexOf(sobre);
    orden.splice(de, 1);
    orden.splice(a, 0, arrastrando);
    guardar({ ...prefs, orden });
  }

  return (
    <>
      <div className="fila">
        <h2 className="seccion" style={{ margin: 0, flex: 1 }}>Inicio</h2>
        <button className={`btn mini ${editar ? "oro" : "suave"}`} onClick={() => setEditar(!editar)}>
          {editar ? "✓ Guardar disposición" : "✎ Personalizar"}
        </button>
      </div>

      {editar && (
        <p className="nota">
          Arrastra las tarjetas para reordenarlas · pulsa ✕ para quitar una ·{" "}
          {ocultos.length > 0 ? "añade desde abajo las que quitaste." : "todas las tarjetas están visibles."}
        </p>
      )}

      <div className="inicio-grid">
        {visibles.map((id) => {
          const meta = CATALOGO.find((w) => w.id === id)!;
          return (
            <div
              key={id}
              className={`widget ${editar ? "editando" : ""} ${arrastrando === id ? "arrastrando" : ""}`}
              draggable={editar}
              onDragStart={() => setArrastrando(id)}
              onDragEnd={() => setArrastrando(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => soltar(id)}
            >
              <div className="widget-cab">
                <span>{meta.titulo}</span>
                {editar && (
                  <button className="widget-x" title="Quitar"
                    onClick={() => guardar({ ...prefs, ocultos: [...prefs.ocultos, id] })}>✕</button>
                )}
              </div>
              <div className="widget-cuerpo">
                {id === "kpis" && <WKpis />}
                {id === "citas_hoy" && <WCitasHoy />}
                {id === "escalados" && <WEscalados />}
                {id === "semana" && <WSemana />}
              </div>
            </div>
          );
        })}
      </div>

      {editar && ocultos.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <p className="nota" style={{ marginTop: 0 }}>Añadir tarjetas:</p>
          <div className="fila" style={{ marginBottom: 0 }}>
            {ocultos.map((w) => (
              <button key={w.id} className="btn mini suave"
                onClick={() => guardar({ ...prefs, ocultos: prefs.ocultos.filter((o) => o !== w.id) })}>
                + {w.titulo}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/* ============ Widgets ============ */

function WKpis() {
  const [d, setD] = useState<any | null>(null);
  useEffect(() => { api(`agenda?fecha=${hoyISO()}`).then(setD).catch(() => {}); }, []);
  const stats = useMemo(() => {
    const citas = (d?.medicos ?? []).flatMap((m: any) => m.citas);
    return {
      total: citas.length,
      confirmadas: citas.filter((c: any) => c.confirmada_cliente || c.estado === "confirmada").length,
      pendientes: citas.filter((c: any) => c.estado === "pendiente").length,
    };
  }, [d]);
  return (
    <div className="mini-kpis">
      <div><b>{stats.total}</b><span>citas hoy</span></div>
      <div><b>{stats.confirmadas}</b><span>confirmadas</span></div>
      <div><b>{stats.pendientes}</b><span>pendientes</span></div>
    </div>
  );
}

function WCitasHoy() {
  const [d, setD] = useState<any | null>(null);
  useEffect(() => { api(`agenda?fecha=${hoyISO()}`).then(setD).catch(() => {}); }, []);
  const proximas = useMemo(() => {
    const ahora = Date.now();
    return (d?.medicos ?? [])
      .flatMap((m: any) => m.citas.map((c: any) => ({ ...c, medico: m.nombre })))
      .filter((c: any) => new Date(c.inicio).getTime() >= ahora - 15 * 60_000)
      .sort((a: any, b: any) => a.inicio.localeCompare(b.inicio))
      .slice(0, 6);
  }, [d]);
  if (!proximas.length) return <p className="nota">No quedan citas hoy.</p>;
  return (
    <div>
      {proximas.map((c: any) => (
        <div className="linea-cita" key={c.id}>
          <b>{fmtHora(c.inicio)}</b>
          <span>{[c.clientes?.nombre, c.clientes?.apellidos].filter(Boolean).join(" ") || c.clientes?.telefono}</span>
          <em>{c.medico}</em>
        </div>
      ))}
    </div>
  );
}

function WEscalados() {
  const [lista, setLista] = useState<any[]>([]);
  useEffect(() => { api<any[]>("escalados").then((l) => setLista(l.filter((e) => !e.resuelto))).catch(() => {}); }, []);
  if (!lista.length) return <p className="nota">Nada pendiente — Alexia al mando 🙌</p>;
  return (
    <div>
      {lista.slice(0, 5).map((e) => (
        <div className="linea-cita" key={e.id}>
          <b>{e.telefono}</b>
          <span>{e.motivo ?? "—"}</span>
          <em>{fmtFechaHora(e.created_at)}</em>
        </div>
      ))}
      {lista.length > 5 && <p className="nota">…y {lista.length - 5} más en Clientes → Escaladas</p>}
    </div>
  );
}

function WSemana() {
  const [d, setD] = useState<any | null>(null);
  useEffect(() => { api("metricas").then(setD).catch(() => {}); }, []);
  if (!d) return <p className="nota">Cargando…</p>;
  const ultimas = d.semanas.slice(-4);
  const max = Math.max(1, ...ultimas.map((s: any) => s.total));
  return (
    <div className="barras" style={{ height: 90 }}>
      {ultimas.map((s: any) => (
        <div className="barra-col" key={s.semana}>
          <div className="barra" style={{ height: `${(s.total / max) * 100}%` }}
            title={`Semana del ${s.semana}: ${s.total} citas`} />
          <span className="barra-lbl">{new Date(`${s.semana}T12:00:00Z`).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}</span>
        </div>
      ))}
    </div>
  );
}
