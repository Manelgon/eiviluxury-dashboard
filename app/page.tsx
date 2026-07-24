"use client";
import { useEffect, useState } from "react";
import { api, setToken, getToken } from "@/components/api";
import Inicio from "@/components/Inicio";
import Agenda from "@/components/Agenda";
import Clientes from "@/components/Clientes";
import Config from "@/components/Config";
import Metricas from "@/components/Metricas";

type Me = { nombre: string | null; rol: string };

export default function Page() {
  const [me, setMe] = useState<Me | null>(null);
  const [cargando, setCargando] = useState(true);
  const [tab, setTab] = useState("inicio");

  useEffect(() => {
    if (!getToken()) { setCargando(false); return; }
    api<Me>("me").then(setMe).catch(() => setToken(null)).finally(() => setCargando(false));
  }, []);

  if (cargando) return <div className="login-wrap"><div style={{ color: "#d4bc94" }}>Cargando…</div></div>;
  if (!me) return <Login onOk={(m) => setMe(m)} />;

  const esMedico = me.rol === "medico" || me.rol === "enfermera";
  if (esMedico && tab === "inicio") setTab("agenda");
  return (
    <>
      <div className="topbar">
        <div className="marca">EIVI<b>LUXURY</b> · Panel</div>
        <div className="tabs">
          {!esMedico && <button className={tab === "inicio" ? "on" : ""} onClick={() => setTab("inicio")}>Inicio</button>}
          <button className={tab === "agenda" ? "on" : ""} onClick={() => setTab("agenda")}>Agenda</button>
          {!esMedico && <button className={tab === "clientes" ? "on" : ""} onClick={() => setTab("clientes")}>Clientes</button>}
          {!esMedico && <button className={tab === "config" ? "on" : ""} onClick={() => setTab("config")}>Configuración</button>}
          {!esMedico && <button className={tab === "metricas" ? "on" : ""} onClick={() => setTab("metricas")}>Métricas</button>}
        </div>
        <span className="quien">{me.nombre ?? ""} · {me.rol}</span>
        <button className="salir" onClick={() => { setToken(null); setMe(null); }}>Salir</button>
      </div>
      <div className="main">
        {tab === "inicio" && !esMedico && <Inicio />}
        {tab === "agenda" && <Agenda />}
        {tab === "clientes" && <Clientes />}
        {tab === "config" && <Config />}
        {tab === "metricas" && <Metricas />}
      </div>
    </>
  );
}

function Login({ onOk }: { onOk: (m: Me) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true); setError("");
    try {
      const r = await api<{ token: string; nombre: string; rol: string }>("login", {
        method: "POST", body: { email, password },
      });
      setToken(r.token);
      onOk({ nombre: r.nombre, rol: r.rol });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="marca">EIVI<b>LUXURY</b></div>
        <div className="sub">Panel de gestión</div>
        <form onSubmit={entrar}>
          <div>
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div>
            <label>Contraseña</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button className="btn oro" disabled={enviando}>{enviando ? "Entrando…" : "Entrar"}</button>
        </form>
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  );
}
