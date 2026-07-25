"use client";
import { useEffect, useState } from "react";
import { api, setToken, setRefresh, getToken } from "@/components/api";
import Inicio from "@/components/Inicio";
import Agenda from "@/components/Agenda";
import Pacientes from "@/components/Pacientes";
import Config from "@/components/Config";
import Metricas from "@/components/Metricas";
import MisPacientes from "@/components/MisPacientes";
import IdleTimeout from "@/components/IdleTimeout";

type Me = { nombre: string | null; rol: string; medico_id?: number | null };

export default function Page() {
  const [me, setMe] = useState<Me | null>(null);
  const [cargando, setCargando] = useState(true);
  const [tab, setTab] = useState("inicio");
  const [configSub, setConfigSub] = useState("catalogo");
  const [menuConf, setMenuConf] = useState(false);
  const [grupoAbierto, setGrupoAbierto] = useState<string | null>(null);
  const [menuMovil, setMenuMovil] = useState(false);

  useEffect(() => {
    if (!getToken()) { setCargando(false); return; }
    api<Me>("me").then(setMe).catch(() => setToken(null)).finally(() => setCargando(false));
  }, []);

  if (cargando) return <div className="login-wrap"><div style={{ color: "#d4bc94" }}>Cargando…</div></div>;
  if (!me) return <Login onOk={(m) => setMe(m)} />;

  const esMedico = me.rol === "medico" || me.rol === "enfermera";
  if (esMedico && tab === "inicio") setTab("agenda");

  // Navegación principal (compartida por la topbar de escritorio y el drawer móvil)
  const tabsNav = [
    ...(!esMedico ? [{ id: "inicio", t: "Inicio" }] : []),
    { id: "agenda", t: "Agenda" },
    ...(me.medico_id && me.rol !== "enfermera" ? [{ id: "mis-pacientes", t: "Mis pacientes" }] : []),
    ...(!esMedico ? [{ id: "pacientes", t: "Pacientes" }, { id: "metricas", t: "Métricas" }] : []),
  ];
  // Menú de configuración (compartido por la tuerca y el drawer móvil)
  const menuConfig: any[] = [
    ...(me.medico_id ? [{
      grupo: `Mi perfil${esMedico ? "" : " (médico)"}`,
      hijos: [
        { id: "mi-perfil:ficha", t: "Mi ficha" },
        { id: "mi-perfil:horario", t: "Mi horario" },
        { id: "mi-perfil:ausencias", t: "Ausencias y vacaciones" },
      ],
    }] : []),
    ...(esMedico ? [] : [
      { id: "catalogo", t: "Áreas y tratamientos" },
      { id: "faq", t: "FAQ del bot" },
      {
        grupo: "Equipo",
        hijos: [
          ...(me.rol === "admin" || me.rol === "direccion" ? [{ id: "usuarios", t: "Usuarios y permisos" }] : []),
          { id: "horarios", t: "Horarios" },
          { id: "bloqueos", t: "Vacaciones y bloqueos" },
        ],
      },
      {
        grupo: "RGPD",
        hijos: [
          { id: "derechos", t: "Derechos y solicitudes" },
          { id: "docs-rgpd", t: "Documentos normativos" },
          ...(me.rol === "admin" || me.rol === "direccion" ? [{ id: "logs", t: "Logs de actividad" }] : []),
        ],
      },
    ]),
  ];
  const irConfig = (id: string) => { setTab("config"); setConfigSub(id); setMenuConf(false); setGrupoAbierto(null); setMenuMovil(false); };
  const irTab = (id: string) => { setTab(id); setMenuMovil(false); };
  const renderMenuConfig = (sub = false) => menuConfig.map((o) => o.hijos ? (
    <div key={o.grupo}>
      <button className={tab === "config" && o.hijos.some((h: any) => h.id === configSub) ? "on" : ""}
        onClick={() => setGrupoAbierto(grupoAbierto === o.grupo ? null : o.grupo)}>
        {o.grupo} {grupoAbierto === o.grupo ? "▾" : "▸"}
      </button>
      {grupoAbierto === o.grupo && o.hijos.map((h: any) => (
        <button key={h.id} style={{ paddingLeft: 30, fontSize: 13 }}
          className={tab === "config" && configSub === h.id ? "on" : ""}
          onClick={() => irConfig(h.id)}>
          {h.t}
        </button>
      ))}
    </div>
  ) : (
    <button key={o.id} className={tab === "config" && configSub === o.id ? "on" : ""} onClick={() => irConfig(o.id)}>
      {o.t}
    </button>
  ));

  return (
    <>
      <IdleTimeout onLogout={() => setMe(null)} />
      <div className="topbar">
        <div className="marca">EIVI<b>LUXURY</b> · Panel</div>
        <div className="tabs">
          {tabsNav.map((t) => (
            <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>{t.t}</button>
          ))}
        </div>
        <span className="quien">{me.nombre ?? ""} · {me.rol}</span>
        {(!esMedico || Boolean(me.medico_id)) && (
          <div className="tuerca-wrap">
            <button className={`tuerca ${tab === "config" ? "on" : ""}`} title="Configuración"
              onClick={() => setMenuConf(!menuConf)}>⚙</button>
            {menuConf && (
              <>
                <div className="menu-fondo" onClick={() => { setMenuConf(false); setGrupoAbierto(null); }} />
                <div className="menu-conf">
                  {renderMenuConfig()}
                </div>
              </>
            )}
          </div>
        )}
        <button className="salir" onClick={() => { setToken(null); setMe(null); }}>Salir</button>
        <button className="burger" title="Menú" onClick={() => setMenuMovil(true)}>☰</button>
      </div>
      {menuMovil && (
        <>
          <div className="drawer-fondo" onClick={() => { setMenuMovil(false); setGrupoAbierto(null); }} />
          <aside className="drawer">
            <div className="drawer-cab">
              <div>
                <div style={{ fontWeight: 700 }}>{me.nombre ?? ""}</div>
                <div style={{ fontSize: 12, color: "#8a8378" }}>{me.rol}</div>
              </div>
              <button className="drawer-x" onClick={() => { setMenuMovil(false); setGrupoAbierto(null); }}>✕</button>
            </div>
            <nav className="drawer-nav">
              {tabsNav.map((t) => (
                <button key={t.id} className={tab === t.id ? "on" : ""} onClick={() => irTab(t.id)}>{t.t}</button>
              ))}
              {(!esMedico || Boolean(me.medico_id)) && (
                <>
                  <div className="drawer-sep">⚙ Configuración</div>
                  {renderMenuConfig()}
                </>
              )}
              <div className="drawer-sep" />
              <button className="drawer-salir" onClick={() => { setToken(null); setMe(null); }}>Salir</button>
            </nav>
          </aside>
        </>
      )}
      <div className="main">
        {tab === "inicio" && !esMedico && <Inicio />}
        {tab === "agenda" && <Agenda medicoId={me.medico_id ?? null} />}
        {tab === "mis-pacientes" && Boolean(me.medico_id) && me.rol !== "enfermera" && <MisPacientes />}
        {tab === "pacientes" && <Pacientes rol={me.rol} />}
        {tab === "config" && <Config sub={configSub} setSub={setConfigSub} rol={me.rol} tieneFicha={Boolean(me.medico_id)} />}
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
      const r = await api<{ token: string; refresh_token?: string; nombre: string; rol: string; medico_id?: number | null }>("login", {
        method: "POST", body: { email, password },
      });
      setToken(r.token);
      setRefresh(r.refresh_token ?? null);
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
