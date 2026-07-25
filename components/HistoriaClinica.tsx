"use client";
import { useEffect, useRef, useState } from "react";
import { api, fmtFechaHora, getToken } from "./api";

/* ============================================================
   Historia clínica del paciente
   · Alergias transversales SIEMPRE visibles y destacadas en rojo
   · Lista de problemas (diagnósticos CIE-10 longitudinales)
   · Timeline de consultas con versionado inmutable
   · El servidor ya filtra por áreas según el rol (médico)
   ============================================================ */

interface Historia {
  consultas: any[];
  diagnosticos: any[];
  alergias: any[];
  constantes: any[];
  diagnosticos_consulta: any[];
  ambito: number[] | null; // null = acceso total
}

export default function HistoriaClinica({ pacienteId, nombrePaciente }: { pacienteId: number; nombrePaciente?: string }) {
  const [h, setH] = useState<Historia | null>(null);
  const [p, setP] = useState<any | null>(null); // ficha administrativa + citas
  const [pestana, setPestana] = useState<"resumen" | "consultas" | "diagnosticos" | "documentos" | "ficha">("resumen");
  const [error, setError] = useState("");
  const [nueva, setNueva] = useState(false);

  const cargar = () => {
    api<Historia>(`historia?paciente_id=${pacienteId}`).then((d) => { setH(d); setError(""); }).catch((e) => setError(e.message));
    api<any>(`pacientes/${pacienteId}`).then(setP).catch(() => setP(null));
  };
  useEffect(() => { cargar(); }, [pacienteId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="error" style={{ marginTop: 10 }}>{error}</div>;
  if (!h) return <p className="nota">Cargando historia clínica…</p>;

  const constantesDe = (consultaId: number) => h.constantes.filter((c: any) => c.consulta_id === consultaId);
  const diagnosticosDe = (consultaId: number) => h.diagnosticos_consulta.filter((d: any) => d.consulta_id === consultaId);
  const edad = p?.fecha_nacimiento ? Math.floor((Date.now() - new Date(p.fecha_nacimiento).getTime()) / 31_557_600_000) : null;
  const nombre = nombrePaciente ?? (p ? [p.nombre, p.apellidos].filter(Boolean).join(" ") : `Paciente #${pacienteId}`);
  const problemasActivos = h.diagnosticos.filter((d: any) => !d.fecha_resolucion && d.estado !== "descartado");
  const citasFuturas = (p?.citas ?? []).filter((c: any) => new Date(c.inicio) > new Date() && ["pendiente", "confirmada"].includes(c.estado));
  // Última constante registrada de cada tipo clave (las consultas vienen ordenadas desc)
  const ultimaConstante = (codigo: string) => {
    for (const c of h.consultas) {
      const k = constantesDe(c.id).find((x: any) => x.constantes_catalogo?.codigo === codigo);
      if (k) return `${k.valor} ${k.constantes_catalogo?.unidad ?? ""}`;
    }
    return null;
  };

  const Dato = ({ e, v }: { e: string; v: any }) => (
    <div style={{ minWidth: 130 }}>
      <label style={{ fontSize: 10.5, color: "var(--muted)", textTransform: "uppercase", letterSpacing: 1 }}>{e}</label>
      <p style={{ margin: "2px 0 0", fontSize: 13.5 }}>{v ?? "—"}</p>
    </div>
  );

  return (
    <div style={{ marginTop: 6 }}>
      {/* ═══ Cabecera del paciente (modelo SANIAN) ═══ */}
      <div className="fila" style={{ marginBottom: 8, alignItems: "baseline" }}>
        <h3 style={{ margin: 0 }}>{nombre}</h3>
        <span className="nota" style={{ margin: 0 }}>
          {edad != null ? `${edad} años · ` : ""}{p?.sexo ? `${p.sexo} · ` : ""}{p?.telefono ?? ""}
          {p?.cip ? <> · CIP <code style={{ fontSize: 10.5 }}>{String(p.cip).slice(0, 8)}…</code></> : ""}
        </span>
        {p && (p.alta_completa
          ? <span className="chip confirmada">alta completa</span>
          : <span className="chip pendiente">⏳ alta pendiente</span>)}
      </div>
      <Alergias pacienteId={pacienteId} alergias={h.alergias} onCambio={cargar} />

      {/* ═══ Pestañas ═══ */}
      <div className="subtabs" style={{ marginTop: 12 }}>
        <button className={pestana === "resumen" ? "on" : ""} onClick={() => setPestana("resumen")}>Resumen</button>
        <button className={pestana === "consultas" ? "on" : ""} onClick={() => setPestana("consultas")}>Consultas ({h.consultas.length})</button>
        <button className={pestana === "diagnosticos" ? "on" : ""} onClick={() => setPestana("diagnosticos")}>Diagnósticos</button>
        <button className={pestana === "documentos" ? "on" : ""} onClick={() => setPestana("documentos")}>Documentos</button>
        <button className={pestana === "ficha" ? "on" : ""} onClick={() => setPestana("ficha")}>Ficha</button>
      </div>

      {/* ═══ RESUMEN GENERAL ═══ */}
      {pestana === "resumen" && (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="fila" style={{ flexWrap: "wrap", gap: 18, marginBottom: 0 }}>
              <Dato e="Talla" v={ultimaConstante("ALTURA")} />
              <Dato e="Peso" v={ultimaConstante("PESO")} />
              <Dato e="IMC" v={ultimaConstante("IMC")} />
              <Dato e="Toxina (última)" v={ultimaConstante("TOXINA_U")} />
              <Dato e="Relleno (último)" v={ultimaConstante("RELLENO_ML")} />
            </div>
          </div>
          <div className="card" style={{ marginBottom: 12 }}>
            <p className="nota" style={{ marginTop: 0 }}><b>Diagnósticos activos</b> ({problemasActivos.length})</p>
            {problemasActivos.length === 0 && <p className="nota" style={{ margin: 0 }}>Ninguno</p>}
            {problemasActivos.map((d: any) => (
              <div className="linea-cita" key={d.id}>
                <b style={{ minWidth: 70 }}>{d.codigo}</b>
                <span>{d.cie10?.descripcion ?? ""} <em>· {d.areas?.nombre ?? ""}</em></span>
                <span className={`chip ${d.estado === "confirmado" ? "confirmada" : "pendiente"}`}>{d.estado}</span>
              </div>
            ))}
          </div>
          <div className="card" style={{ marginBottom: 12 }}>
            <p className="nota" style={{ marginTop: 0 }}><b>Próximas citas</b></p>
            {citasFuturas.length === 0 && <p className="nota" style={{ margin: 0 }}>Sin citas próximas</p>}
            {citasFuturas.map((c: any) => (
              <div className="linea-cita" key={c.id}>
                <span>{fmtFechaHora(c.inicio)} · {c.medicos?.nombre ?? ""}{c.tratamientos?.nombre ? ` · ${c.tratamientos.nombre}` : ""}</span>
                <span className={`chip ${c.estado}`}>{c.estado}</span>
              </div>
            ))}
          </div>
          <div className="card">
            <div className="fila" style={{ marginBottom: 6 }}>
              <p className="nota" style={{ margin: 0 }}><b>Últimas consultas</b></p>
              <div style={{ flex: 1 }} />
              <button className="btn mini oro" onClick={() => setNueva(true)}>+ Nueva consulta</button>
            </div>
            {h.consultas.length === 0 && <p className="nota" style={{ margin: 0 }}>Sin consultas todavía</p>}
            {h.consultas.slice(0, 3).map((c: any) => (
              <div className="linea-cita" key={c.id} style={{ cursor: "pointer" }} onClick={() => setPestana("consultas")}>
                <b style={{ minWidth: 120 }}>{fmtFechaHora(c.fecha)}</b>
                <span>{c.motivo} <em>· {c.areas?.nombre ?? ""} · {c.medicos?.nombre ?? ""}</em></span>
                <span className={`chip ${c.estado === "firmada" ? "confirmada" : "pendiente"}`}>{c.estado}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ═══ CONSULTAS (historial completo) ═══ */}
      {pestana === "consultas" && (
        <>
          <div className="fila" style={{ marginBottom: 6 }}>
            <div style={{ flex: 1 }} />
            <button className="btn mini oro" onClick={() => setNueva(true)}>+ Nueva consulta</button>
          </div>
          {h.consultas.length === 0 && <p className="nota">Sin consultas todavía</p>}
          {h.consultas.map((c: any) => (
            <Consulta key={c.id} c={c} constantes={constantesDe(c.id)} diagnosticos={diagnosticosDe(c.id)} onCambio={cargar} />
          ))}
        </>
      )}

      {/* ═══ DIAGNÓSTICOS (lista de problemas completa) ═══ */}
      {pestana === "diagnosticos" && (
        <div className="card">
          <p className="nota" style={{ marginTop: 0 }}><b>Lista de problemas</b> (diagnósticos CIE-10 del paciente{h.ambito ? " · solo tus áreas" : ""})</p>
          {h.diagnosticos.length === 0 && <p className="nota" style={{ margin: 0 }}>Sin diagnósticos registrados</p>}
          {h.diagnosticos.map((d: any) => (
            <div className="linea-cita" key={d.id}>
              <b style={{ minWidth: 70 }}>{d.codigo}</b>
              <span>{d.cie10?.descripcion ?? ""} <em>· {d.areas?.nombre ?? ""}</em></span>
              <span className={`chip ${d.estado === "confirmado" ? "confirmada" : d.estado === "descartado" ? "cancelada" : "pendiente"}`}>
                {d.estado} · {new Date(d.fecha_inicio).toLocaleDateString("es-ES")}
                {d.fecha_resolucion ? ` → resuelto ${new Date(d.fecha_resolucion).toLocaleDateString("es-ES")}` : ""}
              </span>
            </div>
          ))}
          <p className="nota" style={{ marginBottom: 0 }}>Los diagnósticos se añaden y cambian de estado desde las consultas (la lista se sincroniza sola).</p>
        </div>
      )}

      {/* ═══ DOCUMENTOS ═══ */}
      {pestana === "documentos" && <DocumentosPaciente pacienteId={pacienteId} />}

      {/* ═══ FICHA (datos administrativos, solo lectura para el médico) ═══ */}
      {pestana === "ficha" && (
        <div className="card">
          {p ? (
            <div className="fila" style={{ flexWrap: "wrap", gap: 18, marginBottom: 0 }}>
              <Dato e="Nombre" v={[p.nombre, p.apellidos].filter(Boolean).join(" ")} />
              <Dato e="Fecha de nacimiento" v={p.fecha_nacimiento ? new Date(p.fecha_nacimiento).toLocaleDateString("es-ES") : null} />
              <Dato e="Sexo" v={p.sexo} />
              <Dato e="DNI / NIE" v={p.dni} />
              <Dato e="Teléfono (WhatsApp)" v={p.telefono} />
              <Dato e="Teléfono contacto" v={p.telefono_contacto} />
              <Dato e="Email" v={p.email} />
              <Dato e="Dirección" v={p.direccion} />
              <Dato e="CIP interno" v={p.cip} />
              <Dato e="Alta" v={p.alta_completa ? "completa" : "⏳ pendiente"} />
            </div>
          ) : <p className="nota" style={{ margin: 0 }}>No tienes acceso a la ficha administrativa de este paciente.</p>}
          <p className="nota" style={{ marginBottom: 0 }}>Los datos administrativos los gestiona recepción/dirección desde Pacientes.</p>
        </div>
      )}

      {nueva && (
        <NuevaConsulta pacienteId={pacienteId} nombrePaciente={nombre} ambito={h.ambito}
          problemas={h.diagnosticos} alergias={h.alergias}
          onCerrar={(guardada) => { setNueva(false); if (guardada) { cargar(); setPestana("consultas"); } }} />
      )}
    </div>
  );
}

/* ---------------- Alergias (rojo, bien visibles) ---------------- */
function Alergias({ pacienteId, alergias, onCambio }: { pacienteId: number; alergias: any[]; onCambio: () => void }) {
  const [anadiendo, setAnadiendo] = useState(false);
  const [catalogo, setCatalogo] = useState<any[]>([]);
  const [alergiaId, setAlergiaId] = useState<number | "">("");
  const [estado, setEstado] = useState("confirmada");
  const [notas, setNotas] = useState("");

  useEffect(() => { if (anadiendo && !catalogo.length) api<any[]>("alergias/catalogo").then(setCatalogo).catch(() => {}); }, [anadiendo]); // eslint-disable-line react-hooks/exhaustive-deps

  const activas = alergias.filter((a: any) => a.estado !== "descartada");
  return (
    <div style={{
      border: `1.5px solid ${activas.length ? "var(--rojo)" : "var(--linea)"}`,
      background: activas.length ? "#faf0f0" : "transparent",
      borderRadius: 10, padding: "10px 14px",
    }}>
      <div className="fila" style={{ marginBottom: activas.length ? 8 : 0 }}>
        <b style={{ color: activas.length ? "var(--rojo)" : "var(--muted)", fontSize: 13, letterSpacing: 1 }}>
          {activas.length ? `⚠ ALERGIAS (${activas.length})` : "Sin alergias registradas"}
        </b>
        <div style={{ flex: 1 }} />
        <button className="btn mini suave" onClick={() => setAnadiendo(!anadiendo)}>{anadiendo ? "Cancelar" : "+ Añadir"}</button>
      </div>
      {activas.map((a: any) => (
        <span key={a.id} className="chip cancelada" style={{ marginRight: 6, marginBottom: 4, fontWeight: 600 }}
          title={a.notas ?? ""}>
          {a.alergias_catalogo?.descripcion}{a.estado === "pendiente" ? " (por confirmar)" : ""}{a.notas ? ` — ${a.notas}` : ""}
        </span>
      ))}
      {alergias.filter((a: any) => a.estado === "descartada").map((a: any) => (
        <span key={a.id} className="chip" style={{ marginRight: 6, textDecoration: "line-through" }}>
          {a.alergias_catalogo?.descripcion}
        </span>
      ))}
      {anadiendo && (
        <div className="fila" style={{ marginTop: 8, flexWrap: "wrap" }}>
          <select value={alergiaId} onChange={(e) => setAlergiaId(e.target.value ? Number(e.target.value) : "")} style={{ maxWidth: 260 }}>
            <option value="">— Alergia —</option>
            {catalogo.map((c) => <option key={c.id} value={c.id}>{c.descripcion}</option>)}
          </select>
          <select value={estado} onChange={(e) => setEstado(e.target.value)} style={{ maxWidth: 150 }}>
            <option value="confirmada">Confirmada</option>
            <option value="pendiente">Por confirmar</option>
          </select>
          <input placeholder="Notas (reacción, gravedad…)" value={notas} onChange={(e) => setNotas(e.target.value)} style={{ maxWidth: 240 }} />
          <button className="btn mini oro" onClick={async () => {
            if (!alergiaId) return;
            try {
              await api("alergias", { method: "POST", body: { paciente_id: pacienteId, alergia_id: alergiaId, estado, notas: notas || null } });
              setAnadiendo(false); setAlergiaId(""); setNotas(""); onCambio();
            } catch (e: any) { alert(e.message); }
          }}>Guardar</button>
        </div>
      )}
    </div>
  );
}

/* ---------------- Documentos y pruebas del paciente ---------------- */
const CATEGORIAS_DOC: Record<string, string> = {
  foto_antes: "📷 Foto antes", foto_despues: "📷 Foto después",
  consentimiento: "✍ Consentimiento firmado", prueba: "🧪 Prueba/analítica",
  informe: "📄 Informe", otro: "📎 Otro",
};

function DocumentosPaciente({ pacienteId }: { pacienteId: number }) {
  const [lista, setLista] = useState<any[]>([]);
  const [subiendo, setSubiendo] = useState(false);
  const [categoria, setCategoria] = useState("foto_antes");
  const [titulo, setTitulo] = useState("");

  const cargar = () => api<any[]>(`documentos-paciente?paciente_id=${pacienteId}`).then(setLista).catch(() => {});
  useEffect(() => { cargar(); }, [pacienteId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function subir(file: File) {
    if (!titulo.trim()) { alert("Pon un título al documento (ej.: 'Antes — labios, sesión 1')"); return; }
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.append("archivo", file);
      fd.append("paciente_id", String(pacienteId));
      fd.append("categoria", categoria);
      fd.append("titulo", titulo.trim());
      const res = await fetch("/api/documentos-paciente", {
        method: "POST", headers: { Authorization: `Bearer ${getToken()}` }, body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al subir");
      setTitulo(""); cargar();
    } catch (e: any) { alert(e.message); }
    finally { setSubiendo(false); }
  }

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <p className="nota" style={{ marginTop: 0 }}>
        <b>Documentos y pruebas</b> — fotos antes/después, consentimientos de tratamiento firmados, analíticas… (cada lectura queda registrada)
      </p>
      {lista.map((d) => (
        <div className="linea-cita" key={d.id}>
          <span className="chip">{CATEGORIAS_DOC[d.categoria] ?? d.categoria}</span>
          <span>{d.titulo}<em> · {new Date(d.created_at).toLocaleDateString("es-ES")} · {d.subido_por}</em></span>
          <button className="btn mini suave" onClick={async () => {
            try { const { url } = await api<{ url: string }>(`documentos-paciente/${d.id}/ver`); window.open(url, "_blank"); }
            catch (e: any) { alert(e.message); }
          }}>👁 Ver</button>
        </div>
      ))}
      {lista.length === 0 && <p className="nota" style={{ margin: 0 }}>Sin documentos</p>}
      <div className="fila" style={{ marginTop: 10, marginBottom: 0, flexWrap: "wrap" }}>
        <select value={categoria} onChange={(e) => setCategoria(e.target.value)} style={{ maxWidth: 210 }}>
          {Object.entries(CATEGORIAS_DOC).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input placeholder="Título (ej.: Antes — labios, sesión 1)" value={titulo} onChange={(e) => setTitulo(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <label className="btn mini oro" style={{ cursor: "pointer" }}>
          {subiendo ? "Subiendo…" : "⬆ Subir (PDF/foto)"}
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic" style={{ display: "none" }} disabled={subiendo}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) subir(f); e.target.value = ""; }} />
        </label>
      </div>
    </div>
  );
}

/* ---------------- Una consulta del timeline ---------------- */
function Consulta({ c, constantes, diagnosticos, onCambio }: { c: any; constantes: any[]; diagnosticos: any[]; onCambio: () => void }) {
  const [abierta, setAbierta] = useState(false);
  const [versiones, setVersiones] = useState<any[] | null>(null);
  const [editando, setEditando] = useState(false);

  return (
    <div className="card" style={{ marginBottom: 8, padding: "10px 14px" }}>
      <div className="fila" style={{ marginBottom: 0, cursor: "pointer" }} onClick={() => setAbierta(!abierta)}>
        <b style={{ minWidth: 130 }}>{fmtFechaHora(c.fecha)}</b>
        <span style={{ flex: 1 }}>{c.motivo} <em style={{ fontStyle: "normal", color: "var(--muted)", fontSize: 12 }}>
          · {c.areas?.nombre ?? ""} · {c.medicos?.nombre ?? ""}</em></span>
        <span className={`chip ${c.estado === "firmada" ? "confirmada" : "pendiente"}`}>{c.estado}</span>
        {c.editada && <span className="chip" title={`Editada el ${fmtFechaHora(c.editada_at)} por ${c.editado_por}`}>v{c.version_number}</span>}
        <span style={{ color: "var(--muted)" }}>{abierta ? "▴" : "▾"}</span>
      </div>
      {abierta && (
        <div style={{ marginTop: 10, borderTop: "1px dashed var(--linea)", paddingTop: 10 }}>
          {[["Exploración", c.exploracion], ["Juicio clínico", c.juicio_clinico], ["Plan", c.plan], ["Tratamiento aplicado", c.tratamiento], ["Notas", c.notas]]
            .filter(([, v]) => v).map(([t, v]) => (
              <p key={t as string} style={{ margin: "4px 0", fontSize: 13.5 }}><b style={{ color: "var(--muted)", fontSize: 11.5, textTransform: "uppercase", letterSpacing: 1 }}>{t}</b><br />{v as string}</p>
            ))}
          {diagnosticos.length > 0 && (
            <p style={{ margin: "6px 0", fontSize: 13 }}>
              <b style={{ color: "var(--muted)", fontSize: 11.5, textTransform: "uppercase", letterSpacing: 1 }}>Diagnósticos</b><br />
              {diagnosticos.map((d: any) => (
                <span key={d.codigo} className={`chip ${d.estado === "confirmado" ? "confirmada" : d.estado === "descartado" ? "cancelada" : "pendiente"}`} style={{ marginRight: 6 }}>
                  {d.codigo} · {d.cie10?.descripcion} ({d.estado})
                </span>
              ))}
            </p>
          )}
          {constantes.length > 0 && (
            <p style={{ margin: "6px 0", fontSize: 13 }}>
              <b style={{ color: "var(--muted)", fontSize: 11.5, textTransform: "uppercase", letterSpacing: 1 }}>Constantes</b><br />
              {constantes.map((k: any, i: number) => (
                <span key={i} className="chip" style={{ marginRight: 6 }}>
                  {k.constantes_catalogo?.nombre}: {k.valor} {k.constantes_catalogo?.unidad ?? ""}
                </span>
              ))}
            </p>
          )}
          <div className="fila" style={{ marginTop: 8, marginBottom: 0 }}>
            <button className="btn mini suave" onClick={() => setEditando(true)}>✎ Editar</button>
            {c.estado === "borrador" && (
              <button className="btn mini oro" onClick={async () => {
                if (!confirm("¿Firmar esta consulta? Después, cualquier cambio exigirá motivo y quedará versionado.")) return;
                try { await api(`consultas/${c.id}`, { method: "PATCH", body: { estado: "firmada" } }); onCambio(); }
                catch (e: any) { alert(e.message); }
              }}>✒ Firmar</button>
            )}
            {c.editada && (
              <button className="btn mini suave" onClick={async () => {
                if (versiones) { setVersiones(null); return; }
                try { setVersiones(await api<any[]>(`consultas/${c.id}/versiones`)); } catch (e: any) { alert(e.message); }
              }}>{versiones ? "Ocultar versiones" : `🕓 Versiones (${c.version_number - 1})`}</button>
            )}
          </div>
          {versiones && versiones.map((v: any) => (
            <div key={v.version_number} className="card" style={{ marginTop: 8, padding: "8px 12px", background: "#f7f4ee" }}>
              <p className="nota" style={{ margin: 0 }}>
                <b>v{v.version_number}</b> · sustituida el {fmtFechaHora(v.created_at)} por {v.editado_por ?? "—"} · motivo: <i>{v.motivo_edicion}</i>
              </p>
              <p style={{ margin: "4px 0 0", fontSize: 13 }}>{v.motivo}{v.exploracion ? ` — ${v.exploracion}` : ""}{v.juicio_clinico ? ` — ${v.juicio_clinico}` : ""}{v.plan ? ` — ${v.plan}` : ""}</p>
            </div>
          ))}
        </div>
      )}
      {editando && <EditarConsulta c={c} onCerrar={(ok) => { setEditando(false); if (ok) onCambio(); }} />}
    </div>
  );
}

/* ---------------- Editar consulta (exige motivo de edición) ---------------- */
function EditarConsulta({ c, onCerrar }: { c: any; onCerrar: (ok: boolean) => void }) {
  const [f, setF] = useState({ motivo: c.motivo ?? "", exploracion: c.exploracion ?? "", juicio_clinico: c.juicio_clinico ?? "", plan: c.plan ?? "", tratamiento: c.tratamiento ?? "", notas: c.notas ?? "" });
  const [motivoEdicion, setMotivoEdicion] = useState("");
  const [error, setError] = useState("");

  async function guardar() {
    try {
      await api(`consultas/${c.id}`, { method: "PATCH", body: { ...f, motivo_edicion: motivoEdicion } });
      onCerrar(true);
    } catch (e: any) { setError(e.message); }
  }
  return (
    <div className="modal-bg" onClick={() => onCerrar(false)}>
      <div className="modal" style={{ width: "min(700px,96vw)" }} onClick={(e) => e.stopPropagation()}>
        <h3>Editar consulta · {fmtFechaHora(c.fecha)} (v{c.version_number})</h3>
        <p className="nota">La versión anterior queda archivada de forma inmutable (exigencia legal de la historia clínica).</p>
        {(["motivo", "exploracion", "juicio_clinico", "plan", "tratamiento", "notas"] as const).map((k) => (
          <div className="campo" key={k}>
            <label style={{ textTransform: "capitalize" }}>{k === "tratamiento" ? "Tratamiento aplicado" : k === "juicio_clinico" ? "Juicio clínico" : k}</label>
            <textarea rows={2} value={(f as any)[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
          </div>
        ))}
        <div className="campo">
          <label style={{ color: "var(--rojo)", fontWeight: 600 }}>Motivo de la edición (obligatorio)</label>
          <input value={motivoEdicion} onChange={(e) => setMotivoEdicion(e.target.value)} placeholder="Ej.: corrección de error de transcripción" />
        </div>
        {error && <div className="error">{error}</div>}
        <div className="fila" style={{ justifyContent: "flex-end" }}>
          <button className="btn suave" onClick={() => onCerrar(false)}>Cancelar</button>
          <button className="btn oro" onClick={guardar} disabled={!motivoEdicion.trim()}>Guardar nueva versión</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Gestor de consulta (modelo SANIAN: MEAP + diagnósticos + constantes) ---------------- */
function NuevaConsulta({ pacienteId, nombrePaciente, ambito, problemas = [], alergias = [], onCerrar }:
  { pacienteId: number; nombrePaciente?: string; ambito: number[] | null; problemas?: any[]; alergias?: any[]; onCerrar: (guardada: boolean) => void }) {
  const [areas, setAreas] = useState<any[]>([]);
  const [medicos, setMedicos] = useState<any[]>([]);
  const [areaId, setAreaId] = useState<number | "">("");
  const [medicoId, setMedicoId] = useState<number | "">("");
  const [f, setF] = useState({ motivo: "", exploracion: "", juicio_clinico: "", plan: "", tratamiento: "", notas: "" });
  const [diags, setDiags] = useState<{ codigo: string; descripcion: string; estado: string; previo?: string }[]>([]);
  const [constCat, setConstCat] = useState<any[]>([]);
  const [constVals, setConstVals] = useState<Record<number, string>>({});
  const [firmar, setFirmar] = useState(false);
  const [error, setError] = useState("");
  const esMedico = ambito !== null;
  const alergiasActivas = alergias.filter((a: any) => a.estado !== "descartada");
  const inicioRegistro = useRef(Date.now()); // cronómetro silencioso (no visible; métricas de dirección)

  useEffect(() => {
    api<any[]>("areas").then((a) => {
      const activas = a.filter((x: any) => x.activo && (!esMedico || ambito!.includes(x.id)));
      setAreas(activas);
      if (activas.length === 1) setAreaId(activas[0].id);
    }).catch(() => {});
    if (!esMedico) api<any[]>("medicos").then((m) => setMedicos(m.filter((x: any) => x.activo && x.tipo !== "enfermera"))).catch(() => {});
    api<any[]>("constantes-catalogo").then(setConstCat).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const medicosDelArea = medicos.filter((m: any) => (m.medico_areas ?? []).some((ma: any) => ma.area_id === areaId));

  // Contexto de lista de problemas: al elegir un código, saber si el paciente ya lo tiene
  function elegirDiagnostico(d: { codigo: string; descripcion: string }) {
    if (diags.some((x) => x.codigo === d.codigo)) return;
    const previo = problemas.find((p: any) => p.codigo === d.codigo && !p.fecha_resolucion);
    const resuelto = problemas.find((p: any) => p.codigo === d.codigo && p.fecha_resolucion);
    setDiags([...diags, {
      ...d,
      estado: previo?.estado === "confirmado" ? "confirmado" : "sospecha",
      previo: previo ? `ya en su lista de problemas (${previo.estado}) — esta consulta lo actualizará`
        : resuelto ? "estaba resuelto/descartado — se reactivará con el estado que elijas" : undefined,
    }]);
  }

  async function guardar() {
    if (!areaId || !f.motivo.trim()) { setError("El área y el motivo son obligatorios"); return; }
    try {
      await api("consultas", {
        method: "POST",
        body: {
          paciente_id: pacienteId, area_id: areaId,
          ...(esMedico ? {} : { medico_id: medicoId || undefined }),
          ...f,
          estado: firmar ? "firmada" : "borrador",
          diagnosticos: diags.map((d) => ({ codigo: d.codigo, estado: d.estado })),
          constantes: Object.entries(constVals).filter(([, v]) => v !== "").map(([id, valor]) => ({ constante_id: Number(id), valor })),
          duracion_seg: Math.round((Date.now() - inicioRegistro.current) / 1000),
        },
      });
      onCerrar(true);
    } catch (e: any) { setError(e.message); }
  }

  const Tarjeta = ({ titulo, children }: { titulo: string; children: any }) => (
    <div className="card" style={{ marginBottom: 12 }}>
      <p className="nota" style={{ marginTop: 0, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1.5, fontSize: 11.5 }}><b>{titulo}</b></p>
      {children}
    </div>
  );

  return (
    <div className="modal-bg" onClick={() => onCerrar(false)}>
      <div className="modal" style={{ width: "min(1150px,97vw)", maxHeight: "94vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        {/* Cabecera del gestor */}
        <div className="fila" style={{ marginBottom: 4 }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0 }}>Registro clínico{nombrePaciente ? ` · ${nombrePaciente}` : ""}</h3>
            <p className="nota" style={{ margin: "2px 0 0" }}>
              {new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </p>
          </div>
          <button className="btn oro" onClick={guardar}>💾 Guardar consulta</button>
        </div>
        {alergiasActivas.length > 0 && (
          <p style={{ margin: "6px 0 10px" }}>
            {alergiasActivas.map((a: any) => (
              <span key={a.id} className="chip cancelada" style={{ marginRight: 6, fontWeight: 600 }}>⚠ {a.alergias_catalogo?.descripcion}</span>
            ))}
          </p>
        )}

        <div className="grid-consulta">
          {/* ═══ IZQUIERDA: diagnósticos + MEAP ═══ */}
          <div>
            <Tarjeta titulo="Diagnósticos (CIE-10)">
              <BuscadorCie10 onElegir={elegirDiagnostico} />
              {diags.length === 0 && <p className="nota" style={{ margin: 0, textAlign: "center", letterSpacing: 1 }}>Añade diagnósticos desde el buscador</p>}
              {diags.map((d, i) => (
                <div className="linea-cita" key={d.codigo}>
                  <b style={{ minWidth: 70 }}>{d.codigo}</b>
                  <span>
                    {d.descripcion}
                    {d.previo && <><br /><em style={{ fontStyle: "normal", fontSize: 11.5, color: "var(--ambar)" }}>{d.previo}</em></>}
                    {!d.previo && <><br /><em style={{ fontStyle: "normal", fontSize: 11.5, color: "var(--muted)" }}>nuevo para este paciente</em></>}
                  </span>
                  <select value={d.estado} style={{ maxWidth: 140 }}
                    onChange={(e) => { const arr = [...diags]; arr[i] = { ...d, estado: e.target.value }; setDiags(arr); }}>
                    <option value="sospecha">Sospecha</option>
                    <option value="confirmado">Confirmado</option>
                    <option value="descartado">Descartado/Resuelto</option>
                  </select>
                  <button className="btn mini suave" onClick={() => setDiags(diags.filter((x) => x.codigo !== d.codigo))}>✕</button>
                </div>
              ))}
            </Tarjeta>

            <Tarjeta titulo="Motivo de consulta *">
              <textarea rows={2} value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })}
                placeholder="Describa el síntoma o motivo principal…" />
            </Tarjeta>
            <Tarjeta titulo="Exploración">
              <textarea rows={3} value={f.exploracion} onChange={(e) => setF({ ...f, exploracion: e.target.value })}
                placeholder="Hallazgos de la exploración física…" />
            </Tarjeta>
            <Tarjeta titulo="Juicio clínico">
              <textarea rows={3} value={f.juicio_clinico} onChange={(e) => setF({ ...f, juicio_clinico: e.target.value })}
                placeholder="Juicio clínico y diagnósticos diferenciales…" />
            </Tarjeta>
            <Tarjeta titulo="Plan">
              <textarea rows={3} value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })}
                placeholder="Prescripciones, derivaciones y recomendaciones…" />
            </Tarjeta>
          </div>

          {/* ═══ DERECHA: contexto + constantes ═══ */}
          <div>
            <Tarjeta titulo="Área y médico">
              <div className="campo">
                <label>Área</label>
                <select value={areaId} onChange={(e) => { setAreaId(e.target.value ? Number(e.target.value) : ""); setMedicoId(""); }}>
                  <option value="">— Elegir área —</option>
                  {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                </select>
              </div>
              {!esMedico && (
                <div className="campo" style={{ marginBottom: 0 }}>
                  <label>Médico</label>
                  <select value={medicoId} onChange={(e) => setMedicoId(e.target.value ? Number(e.target.value) : "")}>
                    <option value="">— Elegir médico —</option>
                    {medicosDelArea.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                  </select>
                </div>
              )}
            </Tarjeta>

            <Tarjeta titulo="Tratamiento aplicado">
              <textarea rows={2} value={f.tratamiento} onChange={(e) => setF({ ...f, tratamiento: e.target.value })}
                placeholder="Producto, unidades, zonas tratadas…" />
            </Tarjeta>

            <Tarjeta titulo="Constantes">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {constCat.map((k) => (
                  <div key={k.id}>
                    <label style={{ fontSize: 11, color: "var(--muted)" }}>{k.nombre}{k.unidad ? ` (${k.unidad})` : ""}</label>
                    <input type="number" step="any" value={constVals[k.id] ?? ""}
                      onChange={(e) => setConstVals({ ...constVals, [k.id]: e.target.value })} />
                  </div>
                ))}
              </div>
            </Tarjeta>

            <Tarjeta titulo="Notas internas">
              <textarea rows={2} value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })}
                placeholder="Notas no clínicas (seguimiento, avisos…)" />
            </Tarjeta>

            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, margin: "4px 0 10px" }}>
              <input type="checkbox" checked={firmar} onChange={(e) => setFirmar(e.target.checked)} style={{ width: "auto" }} />
              ✒ Firmar directamente (si no, queda como borrador)
            </label>
            {error && <div className="error">{error}</div>}
            <div className="fila" style={{ justifyContent: "flex-end", marginBottom: 0 }}>
              <button className="btn suave" onClick={() => onCerrar(false)}>Cancelar</button>
              <button className="btn oro" onClick={guardar}>Guardar consulta</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Buscador CIE-10 asíncrono ---------------- */
function BuscadorCie10({ onElegir }: { onElegir: (d: { codigo: string; descripcion: string }) => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<any[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (q.trim().length < 2) { setRes([]); return; }
    timer.current = setTimeout(() => {
      api<any[]>(`cie10?q=${encodeURIComponent(q.trim())}`).then(setRes).catch(() => setRes([]));
    }, 300);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [q]);

  return (
    <div className="campo" style={{ position: "relative" }}>
      <label>Diagnósticos CIE-10 (buscar por código o descripción)</label>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ej.: L70, acné, cicatriz…" />
      {res.length > 0 && (
        <div style={{
          position: "absolute", zIndex: 30, left: 0, right: 0, top: "100%", maxHeight: 220, overflowY: "auto",
          background: "#fff", border: "1px solid var(--linea)", borderRadius: 8, boxShadow: "0 8px 24px rgba(0,0,0,.12)",
        }}>
          {res.map((r) => (
            <div key={r.codigo} style={{ padding: "7px 12px", cursor: "pointer", fontSize: 13, borderBottom: "1px solid #f1ece2" }}
              onMouseDown={() => { onElegir(r); setQ(""); setRes([]); }}>
              <b>{r.codigo}</b> · {r.descripcion}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Asignaciones paciente ↔ médico por área ---------------- */
export function Asignaciones({ pacienteId }: { pacienteId: number }) {
  const [lista, setLista] = useState<any[]>([]);
  const [areas, setAreas] = useState<any[]>([]);
  const [medicos, setMedicos] = useState<any[]>([]);
  const [areaId, setAreaId] = useState<number | "">("");
  const [medicoId, setMedicoId] = useState<number | "">("");

  const cargar = () => api<any[]>(`asignaciones?paciente_id=${pacienteId}`).then(setLista).catch(() => {});
  useEffect(() => {
    cargar();
    api<any[]>("areas").then((a) => setAreas(a.filter((x: any) => x.activo))).catch(() => {});
    api<any[]>("medicos").then((m) => setMedicos(m.filter((x: any) => x.activo && x.tipo !== "enfermera"))).catch(() => {});
  }, [pacienteId]); // eslint-disable-line react-hooks/exhaustive-deps

  const medicosDelArea = medicos.filter((m: any) => (m.medico_areas ?? []).some((ma: any) => ma.area_id === areaId));

  return (
    <div className="card" style={{ marginTop: 8 }}>
      <p className="nota" style={{ marginTop: 0 }}>
        <b>Médicos asignados por área</b> — cada área solo admite un médico activo; el médico solo ve la historia de sus pacientes y sus áreas
      </p>
      {lista.map((a: any) => (
        <div className="linea-cita" key={a.id} style={{ opacity: a.activo ? 1 : 0.5 }}>
          <span>{a.medicos?.nombre ?? `Médico #${a.medico_id}`} <em>· {a.areas?.nombre ?? `Área #${a.area_id}`}</em></span>
          <span className={`chip ${a.activo ? "confirmada" : ""}`}>{a.activo ? "activa" : "inactiva"}</span>
          <button className="btn mini suave" onClick={async () => {
            try { await api(`asignaciones/${a.id}`, { method: "PATCH", body: { activo: !a.activo } }); cargar(); }
            catch (e: any) { alert(e.message); }
          }}>{a.activo ? "Desactivar" : "Reactivar"}</button>
        </div>
      ))}
      {lista.length === 0 && <p className="nota" style={{ margin: 0 }}>Sin médicos asignados</p>}
      <div className="fila" style={{ marginTop: 10, marginBottom: 0, flexWrap: "wrap" }}>
        <select value={areaId} onChange={(e) => { setAreaId(e.target.value ? Number(e.target.value) : ""); setMedicoId(""); }} style={{ maxWidth: 200 }}>
          <option value="">— Área —</option>
          {areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
        </select>
        <select value={medicoId} onChange={(e) => setMedicoId(e.target.value ? Number(e.target.value) : "")} style={{ maxWidth: 220 }}>
          <option value="">— Médico —</option>
          {medicosDelArea.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
        </select>
        <button className="btn mini oro" disabled={!areaId || !medicoId} onClick={async () => {
          try {
            await api("asignaciones", { method: "POST", body: { paciente_id: pacienteId, area_id: areaId, medico_id: medicoId } });
            setAreaId(""); setMedicoId(""); cargar();
          } catch (e: any) { alert(e.message); }
        }}>Asignar</button>
      </div>
    </div>
  );
}
