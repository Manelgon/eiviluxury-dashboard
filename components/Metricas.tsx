"use client";
import { useEffect, useState } from "react";
import { api } from "./api";

interface Semana { semana: string; total: number; canceladas: number; no_show: number; completadas: number }
interface Datos { pacientesTotal: number; escaladosPendientes: number; mensajes7d: number; semanas: Semana[] }

export default function Metricas() {
  const [d, setD] = useState<Datos | null>(null);
  const [rend, setRend] = useState<any | null>(null); // solo llega para dirección/admin
  const [tip, setTip] = useState<{ x: number; y: number; texto: string } | null>(null);

  useEffect(() => {
    api<Datos>("metricas").then(setD).catch(() => {});
    api<any>("metricas-medicos").then(setRend).catch(() => {}); // 403 para el resto: se oculta
  }, []);
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

      {/* ═══ Rendimiento (solo dirección/admin; incluye el cronómetro silencioso de consultas) ═══ */}
      {rend && (
        <>
          <h2 className="seccion" style={{ marginTop: 26 }}>Actividad por médico · últimos 90 días</h2>
          <p className="nota">El tiempo de consulta se mide automáticamente al registrar cada consulta (el médico no lo ve). Úsalo como orientación de carga y rendimiento, no como control minuto a minuto.</p>
          <table className="t">
            <thead><tr><th>Médico</th><th>Consultas</th><th>⏱ Media consulta</th><th>Citas completadas</th><th>Horas en citas</th><th>Pacientes asignados</th></tr></thead>
            <tbody>
              {rend.medicos.map((m: any) => (
                <tr key={m.medico_id}>
                  <td>{m.nombre}{m.tipo === "enfermera" ? " · Enf." : ""}</td>
                  <td>{m.consultas_90d}</td>
                  <td>{m.media_min_consulta != null ? `${m.media_min_consulta} min` : "—"}</td>
                  <td>{m.citas_completadas_90d}</td>
                  <td>{m.horas_citas_90d} h</td>
                  <td>{m.pacientes_asignados}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2 className="seccion" style={{ marginTop: 22 }}>Rendimiento por área</h2>
          <table className="t">
            <thead><tr><th>Área</th><th>Consultas</th><th>⏱ Media consulta</th><th>Citas completadas</th><th>Horas en citas</th></tr></thead>
            <tbody>
              {rend.areas.map((a: any) => (
                <tr key={a.area_id}>
                  <td>{a.nombre}</td>
                  <td>{a.consultas_90d}</td>
                  <td>{a.media_min_consulta != null ? `${a.media_min_consulta} min` : "—"}</td>
                  <td>{a.citas_completadas_90d}</td>
                  <td>{a.horas_citas_90d} h</td>
                </tr>
              ))}
              {rend.areas.length === 0 && <tr><td colSpan={5} className="vacio">Sin actividad todavía</td></tr>}
            </tbody>
          </table>

          <h2 className="seccion" style={{ marginTop: 22 }}>Rendimiento por tratamiento</h2>
          <table className="t">
            <thead><tr><th>Tratamiento</th><th>Área</th><th>Citas completadas</th><th>Horas totales</th><th>⏱ Media por cita</th></tr></thead>
            <tbody>
              {rend.tratamientos.map((t: any) => (
                <tr key={t.tratamiento_id}>
                  <td>{t.nombre}</td>
                  <td>{t.area ?? "—"}</td>
                  <td>{t.citas_completadas_90d}</td>
                  <td>{t.horas_90d} h</td>
                  <td>{t.media_min_cita != null ? `${t.media_min_cita} min` : "—"}</td>
                </tr>
              ))}
              {rend.tratamientos.length === 0 && <tr><td colSpan={5} className="vacio">Sin citas completadas todavía</td></tr>}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
