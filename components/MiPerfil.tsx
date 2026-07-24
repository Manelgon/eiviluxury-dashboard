"use client";
import { useEffect, useState } from "react";
import { api } from "./api";
import MiAgenda from "./MiAgenda";

/* ============================================================
   MI PERFIL (dentro de Configuración ⚙) — para cualquier usuario
   con ficha de médico/enfermería vinculada.
   · Ficha: lo identificativo se MUESTRA pero no se puede tocar
     (nombre, nº colegiado, DNI, nacimiento, tipo, áreas — eso lo
     cambia dirección); lo de contacto sí lo edita él.
   · Debajo, su agenda completa: antelación, semana tipo, ausencias.
   ============================================================ */

export default function MiPerfil({ inicial, onVolver }: { inicial?: string; onVolver?: () => void }) {
  const [sub, setSub] = useState<"ficha" | "horario" | "ausencias">(
    inicial === "horario" || inicial === "ausencias" ? inicial : "ficha");
  useEffect(() => {
    if (inicial === "horario" || inicial === "ausencias" || inicial === "ficha") setSub(inicial);
  }, [inicial]);
  const [datos, setDatos] = useState<any | null>(null);
  const [f, setF] = useState({ telefono: "", email: "", direccion: "", bio: "" });
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<any>("mi-agenda").then((d) => {
      setDatos(d);
      const x = d.ficha ?? {};
      setF({ telefono: x.telefono ?? "", email: x.email ?? "", direccion: x.direccion ?? "", bio: x.bio ?? "" });
    }).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="error">{error}</div>;
  if (!datos) return <p className="nota">Cargando tu perfil…</p>;
  const ficha = datos.ficha ?? {};
  const areas = (ficha.medico_areas ?? []).map((x: any) => x.areas?.nombre).filter(Boolean);

  async function guardar() {
    setMsg("");
    try { await api("mi-agenda", { method: "PATCH", body: f }); setMsg("Guardado ✓"); }
    catch (e: any) { setMsg(e.message); }
  }

  const Bloqueado = ({ etiqueta, valor }: { etiqueta: string; valor: any }) => (
    <div style={{ flex: 1, minWidth: 150 }}>
      <label style={{ fontSize: 11.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>🔒 {etiqueta}</label>
      <p style={{ margin: "3px 0 0", fontSize: 14 }}>{valor || "—"}</p>
    </div>
  );

  return (
    <>
      <div className="subtabs">
        {onVolver && <button onClick={onVolver}>← Configuración</button>}
        <button className={sub === "ficha" ? "on" : ""} onClick={() => setSub("ficha")}>Mi ficha</button>
        <button className={sub === "horario" ? "on" : ""} onClick={() => setSub("horario")}>Mi horario</button>
        <button className={sub === "ausencias" ? "on" : ""} onClick={() => setSub("ausencias")}>Ausencias y vacaciones</button>
      </div>

      {sub === "horario" && <MiAgenda seccion="horario" />}
      {sub === "ausencias" && <MiAgenda seccion="ausencias" />}
      {sub === "ficha" && (
      <div className="card" style={{ marginBottom: 14 }}>
        <p className="nota" style={{ marginTop: 0 }}>
          <b>Mi ficha</b> — los datos con 🔒 son identificativos y solo los puede modificar dirección; los de contacto los editas tú.
        </p>
        <div className="fila" style={{ flexWrap: "wrap", gap: 16, marginBottom: 12 }}>
          <Bloqueado etiqueta="Nombre" valor={ficha.nombre} />
          <Bloqueado etiqueta="Tipo" valor={ficha.tipo === "enfermera" ? "Enfermería" : "Médico"} />
          <Bloqueado etiqueta="Nº colegiado" valor={ficha.num_colegiado} />
          <Bloqueado etiqueta="DNI / NIE" valor={ficha.dni} />
          <Bloqueado etiqueta="Fecha de nacimiento" valor={ficha.fecha_nacimiento ? new Date(ficha.fecha_nacimiento).toLocaleDateString("es-ES") : null} />
          <Bloqueado etiqueta="Áreas" valor={areas.join(" · ")} />
        </div>
        <div className="campo" style={{ display: "flex", gap: 10 }}>
          <div style={{ flex: 1 }}><label>Teléfono</label>
            <input value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} /></div>
          <div style={{ flex: 1 }}><label>Email</label>
            <input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        </div>
        <div className="campo"><label>Dirección</label>
          <input value={f.direccion} onChange={(e) => setF({ ...f, direccion: e.target.value })} /></div>
        <div className="campo"><label>Bio / notas</label>
          <textarea rows={2} value={f.bio} onChange={(e) => setF({ ...f, bio: e.target.value })} /></div>
        <div className="fila" style={{ justifyContent: "flex-end", marginBottom: 0 }}>
          <span className="nota" style={{ margin: 0 }}>{msg}</span>
          <button className="btn oro" onClick={guardar}>Guardar contacto</button>
        </div>
      </div>
      )}
    </>
  );
}
