"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
import HistoriaClinica from "./HistoriaClinica";
import ListaEspera from "./ListaEspera";

/* Vista del rol médico: sus pacientes (asignación activa) → historia clínica,
   y su lista de espera. El servidor limita todo a sus áreas; aquí solo se navega. */
export default function MisPacientes() {
  const [sub, setSub] = useState<"pacientes" | "espera">("pacientes");
  const [lista, setLista] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [abierto, setAbierto] = useState<any | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    api<any[]>("asignaciones?mias=1").then(setLista).catch((e) => setError(e.message));
  }, []);

  // Agrupar por paciente (un paciente puede aparecer en varias áreas del mismo médico)
  const porPaciente = new Map<number, { p: any; areas: string[] }>();
  for (const a of lista) {
    if (!a.pacientes) continue;
    const prev = porPaciente.get(a.paciente_id);
    if (prev) prev.areas.push(a.areas?.nombre ?? "");
    else porPaciente.set(a.paciente_id, { p: a.pacientes, areas: [a.areas?.nombre ?? ""] });
  }
  const filtrados = [...porPaciente.values()].filter(({ p }) => {
    if (!q.trim()) return true;
    const t = q.trim().toLowerCase();
    return [p.nombre, p.apellidos, p.telefono].filter(Boolean).join(" ").toLowerCase().includes(t);
  });

  if (error) return <div className="error">{error}</div>;

  if (abierto) {
    const nombre = [abierto.nombre, abierto.apellidos].filter(Boolean).join(" ") || abierto.telefono;
    return (
      <>
        <div className="fila">
          <button className="btn mini suave" onClick={() => setAbierto(null)}>← Mis pacientes</button>
          <h3 style={{ margin: 0 }}>{nombre}</h3>
        </div>
        <HistoriaClinica pacienteId={abierto.id} nombrePaciente={nombre} />
      </>
    );
  }

  return (
    <>
      <div className="subtabs">
        <button className={sub === "pacientes" ? "on" : ""} onClick={() => setSub("pacientes")}>Mis pacientes</button>
        <button className={sub === "espera" ? "on" : ""} onClick={() => setSub("espera")}>Lista de espera</button>
      </div>
      {sub === "espera" ? <ListaEspera rolMedico /> : (
      <>
      <div className="fila">
        <input placeholder="Buscar entre mis pacientes…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
      </div>
      <table className="t">
        <thead><tr><th>Paciente</th><th>Teléfono</th><th>Áreas</th><th></th></tr></thead>
        <tbody>
          {filtrados.map(({ p, areas }) => (
            <tr key={p.id} style={{ cursor: "pointer" }} onClick={() => setAbierto(p)}>
              <td>{[p.nombre, p.apellidos].filter(Boolean).join(" ") || <i style={{ color: "var(--muted)" }}>sin nombre</i>}</td>
              <td>{p.telefono}</td>
              <td>{areas.filter(Boolean).map((a) => <span key={a} className="chip" style={{ marginRight: 4 }}>{a}</span>)}</td>
              <td><button className="btn mini oro">📋 Historia clínica</button></td>
            </tr>
          ))}
          {filtrados.length === 0 && <tr><td colSpan={4} className="vacio">No tienes pacientes asignados todavía</td></tr>}
        </tbody>
      </table>
      </>
      )}
    </>
  );
}
