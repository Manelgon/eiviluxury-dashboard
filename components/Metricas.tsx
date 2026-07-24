"use client";
import { useEffect, useState } from "react";
import { api } from "./api";

interface Semana { semana: string; total: number; canceladas: number; no_show: number; completadas: number }
interface Datos { pacientesTotal: number; escaladosPendientes: number; mensajes7d: number; semanas: Semana[] }

export default function Metricas() {
  const [d, setD] = useState<Datos | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; texto: string } | null>(null);

  useEffect(() => { api<Datos>("metricas").then(setD).catch(() => {}); }, []);
  if (!d) return <p className="nota">Cargando métricas…</p>;

  const max = Math.max(1, ...d.semanas.map((s) => s.total));
  const fmtSem = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-ES", { day: "numeric", month: "short" });

  return (
    <>
      <h2 className="seccion">Últimos 30 días de actividad</h2>
      <div className="kpis">
        <div className="kpi"><div className="v">{d.pacientesTotal}</div><div className="l">Pacientes registrados</div></div>
        <div className="kpi"><div className="v">{d.mensajes7d}</div><div className="l">Mensajes gestionados · 7 días</div></div>
        <div className="kpi"><div className="v">{d.escaladosPendientes}</div><div className="l">Escalados pendientes</div></div>
        <div className="kpi"><div className="v">{d.semanas.reduce((a, s) => a + s.total, 0)}</div><div className="l">Citas · 8 semanas</div></div>
      </div>

      <div className="chart" onMouseLeave={() => setTip(null)}>
        <h3>Citas por semana</h3>
        <div className="barras">
          {d.semanas.map((s) => (
            <div className="barra-col" key={s.semana}>
              <div
                className="barra"
                style={{ height: `${(s.total / max) * 100}%` }}
                onMouseMove={(e) => {
                  const r = (e.currentTarget.closest(".chart") as HTMLElement).getBoundingClientRect();
                  setTip({
                    x: e.clientX - r.left, y: e.clientY - r.top,
                    texto: `Semana del ${fmtSem(s.semana)} — ${s.total} citas · ${s.completadas} completadas · ${s.canceladas} canceladas · ${s.no_show} no-show`,
                  });
                }}
                aria-label={`Semana del ${fmtSem(s.semana)}: ${s.total} citas`}
              />
              <span className="barra-lbl">{fmtSem(s.semana)}</span>
            </div>
          ))}
        </div>
        {tip && <div className="tip" style={{ left: tip.x, top: tip.y }}>{tip.texto}</div>}
      </div>

      <div style={{ marginTop: 14 }}>
        <table className="t">
          <thead><tr><th>Semana del</th><th>Citas</th><th>Completadas</th><th>Canceladas</th><th>No-show</th></tr></thead>
          <tbody>
            {[...d.semanas].reverse().map((s) => (
              <tr key={s.semana}>
                <td>{fmtSem(s.semana)}</td><td>{s.total}</td><td>{s.completadas}</td><td>{s.canceladas}</td><td>{s.no_show}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
