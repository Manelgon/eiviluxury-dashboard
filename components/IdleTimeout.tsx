"use client";
import { useEffect, useRef, useState } from "react";
import { setToken } from "./api";

const LIMITE_MS = 30 * 60_000; // 30 minutos de inactividad
const AVISO_MS = 60_000;       // aviso 60s antes

/** Cierre de sesión por inactividad (obligatorio con datos de pacientes en pantalla). */
export default function IdleTimeout({ onLogout }: { onLogout: () => void }) {
  const deadline = useRef(Date.now() + LIMITE_MS);
  const [quedan, setQuedan] = useState<number | null>(null);

  useEffect(() => {
    const actividad = () => { deadline.current = Date.now() + LIMITE_MS; setQuedan(null); };
    const eventos = ["mousemove", "mousedown", "keydown", "touchstart", "scroll"];
    eventos.forEach((e) => window.addEventListener(e, actividad, { passive: true }));

    const tick = setInterval(() => {
      const resto = deadline.current - Date.now();
      if (resto <= 0) {
        setToken(null);
        onLogout();
      } else if (resto <= AVISO_MS) {
        setQuedan(Math.ceil(resto / 1000));
      }
    }, 1000);

    return () => {
      eventos.forEach((e) => window.removeEventListener(e, actividad));
      clearInterval(tick);
    };
  }, [onLogout]);

  if (quedan === null) return null;
  return (
    <div className="modal-bg" style={{ zIndex: 200 }}>
      <div className="modal" style={{ textAlign: "center" }}>
        <h3>¿Sigues ahí?</h3>
        <p className="nota">Por seguridad, la sesión se cerrará en <b>{quedan}s</b> por inactividad.</p>
        <button className="btn oro" onClick={() => { deadline.current = Date.now() + LIMITE_MS; setQuedan(null); }}>
          Seguir conectado
        </button>
      </div>
    </div>
  );
}
