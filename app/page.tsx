"use client";
import { useEffect, useState } from "react";
import { api, setToken, getToken } from "@/components/api";
import Inicio from "@/components/Inicio";
import Agenda from "@/components/Agenda";
import Pacientes from "@/components/Pacientes";
import Config from "@/components/Config";
import Metricas from "@/components/Metricas";
import MisPacientes from "@/components/MisPacientes";
import MiAgenda from "@/components/MiAgenda";
import IdleTimeout from "@/components/IdleTimeout";

type Me = { nombre: string | null; rol: string; medico_id?: number | null };

export default function Page() {
  const [me, setMe] = useState<Me | null>(null);
  const [cargando, setCargando] = useState(true);
  const [tab, setTab] = useState("inicio");
  const [configSub, setConfigSub] = useState("tratamientos");
  const [menuConf, setMenuConf] = useState(false);

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
      <IdleTimeout onLogout={() => setMe(null)} />
      <div className="topbar">
        <div className="marca">EIVI<b>LUXURY</b> · Panel</div>
        <div className="tabs">
          {!esMedico && <button className={tab === "inicio" ? "on" : ""} onClick={() => setTab("inicio")}>Inicio</button>}
          <button className={tab === "agenda" ? "on" : ""} onClick={() => setTab("agenda")}>Agenda</button>
          {Boolean(me.medico_id) && <button className={tab === "mi-agenda" ? "on" : ""} onClick={() => setTab("mi-agenda")}>Mi agenda</button>}
          {Boolean(me.medico_id) && me.rol !== "enfermera" && <button className={tab === "mis-pacientes" ? "on" : ""} onClick={() => setTab("mis-pacientes")}>Mis pacientes</button>}
          {!esMedico && <button className={tab === "pacientes" ? "on" : ""} onClick={() => setTab("pacientes")}>Pacientes</button>}
          {!esMedico && <button className={tab === "metricas" ? "on" : ""} onClick={() => setTab("metricas")}>Métricas</button>}
        </div>
        <span className="quien">{me.nombre ?? ""} · {me.rol}</span>
        {!esMedico && (
          <div className="tuerca-wrap">
            <button className={`tuerca ${tab === "config" ? "on" : ""}`} title="Configuración"
              onClick={() => setMenuConf(!menuConf)}>⚙</button>
            {menuConf && (
              <>
                <div className="menu-fondo" onClick={() => setMenuConf(false)} />
                <div className="menu-conf">
                  {[
                    { id: "tratamientos", t: "Tratamientos y precios" },
                    { id: "faq", t: "FAQ del bot" },
                    { id: "horarios", t: "Horarios" },
                    { id: "bloqueos", t: "Vacaciones y bloqueos" },
                    { id: "areas", t: "Áreas de la clínica" },
                    { id: "medicos", t: "Médicos y enfermería" },
                    { id: "derechos", t: "Derechos RGPD" },
                    { id: "docs-rgpd", t: "Documentos RGPD" },
                    ...(me.rol === "admin" || me.rol === "direccion"
                      ? [{ id: "usuarios", t: "Usuarios y permisos" }, { id: "logs", t: "Logs de actividad" }]
                      : []),
                  ].map((o) => (
                    <button key={o.id} className={tab === "config" && configSub === o.id ? "on" : ""}
                      onClick={() => { setTab("config"); setConfigSub(o.id); setMenuConf(false); }}>
                      {o.t}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        <button className="salir" onClick={() => { setToken(null); setMe(null); }}>Salir</button>
      </div>
      <div className="main">
        {tab === "inicio" && !esMedico && <Inicio />}
        {tab === "agenda" && <Agenda />}
        {tab === "mi-agenda" && Boolean(me.medico_id) && <MiAgenda />}
        {tab === "mis-pacientes" && Boolean(me.medico_id) && me.rol !== "enfermera" && <MisPacientes />}
        {tab === "pacientes" && <Pacientes rol={me.rol} />}
        {tab === "config" && <Config sub={configSub} setSub={setConfigSub} rol={me.rol} />}
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
      const r = await api<{ token: string; nombre: string; rol: string; medico_id?: number | null }>("login", {
        method: "POST", body: { email, password },
      });
      setToken(r.token);
      onOk({ nombre: r.nombre, rol: r.rol, medico_id: r.medico_id ?? null });
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
