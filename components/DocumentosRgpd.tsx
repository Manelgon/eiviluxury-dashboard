"use client";
import { useEffect, useState } from "react";
import { api } from "./api";

interface Doc { id: string; titulo: string; descripcion: string | null; contenido: any; actualizado_por: string | null; actualizado_at: string | null }

const ETIQUETAS: Record<string, string> = {
  responsable: "Responsable del tratamiento", domicilio: "Domicilio", contacto: "Contacto",
  actividades: "Actividades de tratamiento", nombre: "Nombre", finalidad: "Finalidad",
  base_legal: "Base legal", categorias_datos: "Categorías de datos", interesados: "Interesados",
  destinatarios: "Destinatarios", transferencias: "Transferencias internacionales",
  plazo: "Plazo de conservación", medidas: "Medidas de seguridad",
  contacto_responsable: "Contacto del responsable", enlace_aepd: "Sede AEPD", pasos: "Pasos del protocolo",
  conclusion: "Conclusión", notas: "Notas", criterios: "Criterios", criterio: "Criterio", aplica: "¿Aplica?",
  proveedores: "Proveedores", servicio: "Servicio", ubicacion: "Ubicación", dpa: "Estado del DPA",
  herramientas: "Herramientas", uso_permitido: "Uso permitido", datos_prohibidos: "Datos prohibidos",
};
const L = (k: string) => ETIQUETAS[k] ?? k;

export default function DocumentosRgpd() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [abierto, setAbierto] = useState<Doc | null>(null);
  const cargar = () => api<Doc[]>("documentos-rgpd").then(setDocs).catch((e) => alert(e.message));
  useEffect(() => { cargar(); }, []);

  return (
    <>
      <p className="nota">
        Documentación exigible del RGPD, pre-rellenada para la clínica: <b>revisar con el asesor de protección de datos</b>, completar los campos entre [corchetes], y usar la versión imprimible para firmar y archivar.
      </p>
      <div className="grid">
        {docs.map((d) => (
          <div className="card" key={d.id}>
            <h3 style={{ fontSize: 15 }}>{d.titulo}</h3>
            <p className="nota">{d.descripcion}</p>
            <p className="nota" style={{ fontSize: 11.5 }}>
              {d.actualizado_at
                ? `Última edición: ${new Date(d.actualizado_at).toLocaleDateString("es-ES")} · ${d.actualizado_por}`
                : "Sin revisar todavía"}
            </p>
            <div className="fila" style={{ marginBottom: 0 }}>
              <button className="btn mini oro" onClick={() => setAbierto(d)}>✎ Editar</button>
              <button className="btn mini suave" onClick={() => imprimirDoc(d)}>🖨 Imprimir / firmar</button>
            </div>
          </div>
        ))}
      </div>
      {abierto && <EditorDoc doc={abierto} onCerrar={() => { setAbierto(null); cargar(); }} />}
    </>
  );
}

/* Editor genérico: strings → textarea · arrays de objetos → tabla editable */
function EditorDoc({ doc, onCerrar }: { doc: Doc; onCerrar: () => void }) {
  const [c, setC] = useState<any>(JSON.parse(JSON.stringify(doc.contenido)));
  const [msg, setMsg] = useState("");

  async function guardar() {
    try {
      await api(`documentos-rgpd/${doc.id}`, { method: "PATCH", body: { contenido: c } });
      setMsg("Guardado ✓");
      setTimeout(onCerrar, 600);
    } catch (e: any) { setMsg(e.message); }
  }

  return (
    <div className="modal-bg" onClick={onCerrar}>
      <div className="modal" style={{ width: "min(860px,96vw)" }} onClick={(e) => e.stopPropagation()}>
        <h3>{doc.titulo}</h3>
        {Object.entries(c).map(([clave, valor]) => (
          <div className="campo" key={clave}>
            <label style={{ fontWeight: 600 }}>{L(clave)}</label>
            {typeof valor === "string" ? (
              <textarea rows={Math.min(4, Math.ceil(String(valor).length / 90) || 1)} value={valor as string}
                onChange={(e) => setC({ ...c, [clave]: e.target.value })} />
            ) : Array.isArray(valor) && typeof valor[0] === "string" ? (
              <>
                {(valor as string[]).map((v, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, marginBottom: 4 }}>
                    <textarea rows={2} value={v} onChange={(e) => {
                      const arr = [...(valor as string[])]; arr[i] = e.target.value; setC({ ...c, [clave]: arr });
                    }} />
                    <button className="btn mini suave" onClick={() => setC({ ...c, [clave]: (valor as string[]).filter((_, j) => j !== i) })}>✕</button>
                  </div>
                ))}
                <button className="btn mini suave" onClick={() => setC({ ...c, [clave]: [...(valor as string[]), ""] })}>+ Añadir</button>
              </>
            ) : Array.isArray(valor) ? (
              <>
                {(valor as any[]).map((fila, i) => (
                  <div className="card" key={i} style={{ marginBottom: 8, padding: 12 }}>
                    {Object.entries(fila).map(([k2, v2]) => (
                      <div key={k2} style={{ marginBottom: 6 }}>
                        <label style={{ fontSize: 11.5, color: "var(--muted)" }}>{L(k2)}</label>
                        <textarea rows={Math.min(3, Math.ceil(String(v2).length / 90) || 1)} value={String(v2)}
                          onChange={(e) => {
                            const arr = [...(valor as any[])]; arr[i] = { ...arr[i], [k2]: e.target.value }; setC({ ...c, [clave]: arr });
                          }} />
                      </div>
                    ))}
                    <button className="btn mini suave" onClick={() => setC({ ...c, [clave]: (valor as any[]).filter((_, j) => j !== i) })}>✕ Quitar</button>
                  </div>
                ))}
                <button className="btn mini suave" onClick={() => {
                  const plantilla = Object.fromEntries(Object.keys((valor as any[])[0] ?? { texto: "" }).map((k) => [k, ""]));
                  setC({ ...c, [clave]: [...(valor as any[]), plantilla] });
                }}>+ Añadir</button>
              </>
            ) : null}
          </div>
        ))}
        <div className="fila" style={{ justifyContent: "flex-end" }}>
          <span className="nota" style={{ margin: 0 }}>{msg}</span>
          <button className="btn suave" onClick={onCerrar}>Cerrar</button>
          <button className="btn oro" onClick={guardar}>Guardar</button>
        </div>
      </div>
    </div>
  );
}

/* Versión imprimible para firmar */
function imprimirDoc(d: Doc) {
  const esc = (s: any) => String(s ?? "").replace(/</g, "&lt;");
  const bloque = (clave: string, valor: any): string => {
    if (typeof valor === "string") return `<h2>${esc(L(clave))}</h2><p>${esc(valor)}</p>`;
    if (Array.isArray(valor) && typeof valor[0] === "string")
      return `<h2>${esc(L(clave))}</h2><ol>${(valor as string[]).map((v) => `<li>${esc(v)}</li>`).join("")}</ol>`;
    if (Array.isArray(valor)) {
      return `<h2>${esc(L(clave))}</h2>` + (valor as any[]).map((fila) =>
        `<table class="ficha">${Object.entries(fila).map(([k, v]) => `<tr><td class="k">${esc(L(k))}</td><td>${esc(v)}</td></tr>`).join("")}</table>`
      ).join("");
    }
    return "";
  };
  const w = window.open("", "_blank");
  if (!w) { alert("El navegador bloqueó la ventana"); return; }
  w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${esc(d.titulo)}</title>
<style>
body{font-family:'Segoe UI',sans-serif;color:#1c1a17;max-width:800px;margin:26px auto;padding:0 20px;font-size:13px;line-height:1.55}
h1{font-size:19px;letter-spacing:3px;font-weight:300}h1 b{font-weight:600}
.sub{color:#8d8577;font-size:12px;margin-bottom:6px}
h2{font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#b3925f;margin:20px 0 6px;border-bottom:1px solid #e8e0d3;padding-bottom:3px}
table.ficha{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:12.5px}
table.ficha td{border:1px solid #e8e0d3;padding:5px 8px;vertical-align:top}
table.ficha td.k{width:190px;color:#8d8577;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
ol li{margin-bottom:6px}
.firma{margin-top:44px;display:flex;gap:40px}
.firma div{flex:1;border-top:1px solid #1c1a17;padding-top:6px;font-size:11.5px;color:#5f5a52}
@media print{body{margin:0}}
</style></head><body onload="window.print()">
<h1>EIVI<b>LUXURY</b> · ${esc(d.titulo)}</h1>
<p class="sub">${esc(d.descripcion ?? "")} — ${d.actualizado_at ? `Última revisión: ${new Date(d.actualizado_at).toLocaleDateString("es-ES")} (${esc(d.actualizado_por)})` : "Documento sin revisar"}</p>
${Object.entries(d.contenido).map(([k, v]) => bloque(k, v)).join("")}
<div class="firma"><div>Fecha</div><div>Firma del responsable del tratamiento</div></div>
</body></html>`);
  w.document.close();
}
