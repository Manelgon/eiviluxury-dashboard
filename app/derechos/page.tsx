"use client";
import { useState } from "react";

const TIPOS = [
  ["acceso", "Acceso — saber qué datos míos tenéis"],
  ["rectificacion", "Rectificación — corregir mis datos"],
  ["supresion", "Supresión — eliminar mis datos"],
  ["portabilidad", "Portabilidad — recibir una copia de mis datos"],
  ["oposicion", "Oposición — que dejéis de usar mis datos para un fin"],
  ["limitacion", "Limitación — restringir el tratamiento"],
];

export default function DerechosPage() {
  const [f, setF] = useState({ nombre: "", contacto: "", tipo_derecho: "acceso", descripcion: "", acepta: false });
  const [estado, setEstado] = useState<"" | "enviando" | "ok" | "error">("");
  const [msg, setMsg] = useState("");

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEstado("enviando");
    try {
      const res = await fetch("/api/derechos-publico", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      setEstado("ok");
    } catch (err: any) {
      setMsg(err.message); setEstado("error");
    }
  }

  return (
    <div className="login-wrap" style={{ padding: "40px 16px", alignItems: "flex-start" }}>
      <div className="login-card" style={{ width: "min(560px,94vw)", textAlign: "left" }}>
        <div style={{ textAlign: "center" }}>
          <div className="marca">EIVI<b>LUXURY</b></div>
          <div className="sub">Ejercicio de derechos de protección de datos</div>
        </div>
        {estado === "ok" ? (
          <div>
            <h3 style={{ marginBottom: 8 }}>Solicitud recibida ✓</h3>
            <p style={{ fontSize: 14, color: "var(--gris)" }}>
              Hemos registrado tu solicitud. Conforme al RGPD, te responderemos en el plazo máximo de un mes
              al contacto que nos has facilitado. Puede que te pidamos acreditar tu identidad antes de resolverla.
              Si no quedas conforme, puedes reclamar ante la AEPD (aepd.es).
            </p>
          </div>
        ) : (
          <form onSubmit={enviar}>
            <p style={{ fontSize: 13.5, color: "var(--gris)", marginBottom: 14 }}>
              Como paciente o usuario de Clínica EiviLuxury puedes ejercer tus derechos sobre tus datos personales.
              Rellena este formulario y te responderemos en el plazo legal de un mes.
            </p>
            <div>
              <label>Nombre y apellidos</label>
              <input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
            </div>
            <div>
              <label>Email o teléfono de contacto *</label>
              <input required value={f.contacto} onChange={(e) => setF({ ...f, contacto: e.target.value })} />
            </div>
            <div>
              <label>Derecho que quieres ejercer *</label>
              <select value={f.tipo_derecho} onChange={(e) => setF({ ...f, tipo_derecho: e.target.value })}>
                {TIPOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </div>
            <div>
              <label>Detalles (opcional)</label>
              <textarea rows={3} value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} />
            </div>
            <label style={{ fontSize: 13, display: "flex", gap: 8, alignItems: "flex-start" }}>
              <input type="checkbox" style={{ width: "auto", marginTop: 3 }} checked={f.acepta}
                onChange={(e) => setF({ ...f, acepta: e.target.checked })} required />
              <span>Acepto que Clínica EiviLuxury trate estos datos con la única finalidad de gestionar mi solicitud. *</span>
            </label>
            <button className="btn oro" disabled={estado === "enviando"} style={{ marginTop: 6 }}>
              {estado === "enviando" ? "Enviando…" : "Enviar solicitud"}
            </button>
            {estado === "error" && <div className="error">{msg}</div>}
          </form>
        )}
      </div>
    </div>
  );
}
