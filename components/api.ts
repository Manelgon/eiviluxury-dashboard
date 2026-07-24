"use client";

let token: string | null = null;
export function setToken(t: string | null) {
  token = t;
  if (typeof window !== "undefined") {
    if (t) localStorage.setItem("eivi_token", t);
    else { localStorage.removeItem("eivi_token"); localStorage.removeItem("eivi_refresh"); }
  }
}
export function getToken(): string | null {
  if (token) return token;
  if (typeof window !== "undefined") token = localStorage.getItem("eivi_token");
  return token;
}
export function setRefresh(t: string | null) {
  if (typeof window === "undefined") return;
  if (t) localStorage.setItem("eivi_refresh", t);
  else localStorage.removeItem("eivi_refresh");
}
const getRefresh = () => (typeof window !== "undefined" ? localStorage.getItem("eivi_refresh") : null);

/* El access token de Supabase caduca a la hora: si un 401 llega con refresh_token
   guardado, se renueva la sesión en silencio y se reintenta la petición. */
let renovando: Promise<boolean> | null = null;
async function renovarSesion(): Promise<boolean> {
  if (renovando) return renovando; // varias peticiones a la vez: una sola renovación
  renovando = (async () => {
    const rt = getRefresh();
    if (!rt) return false;
    try {
      const res = await fetch("/api/refresh", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: rt }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok || !d.token) return false;
      setToken(d.token);
      if (d.refresh_token) setRefresh(d.refresh_token);
      return true;
    } catch { return false; }
  })();
  const ok = await renovando;
  renovando = null;
  return ok;
}

export async function api<T = any>(ruta: string, opts: { method?: string; body?: unknown } = {}, reintento = false): Promise<T> {
  const res = await fetch(`/api/${ruta}`, {
    method: opts.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !reintento && ruta !== "login" && ruta !== "refresh") {
      if (await renovarSesion()) return api<T>(ruta, opts, true); // sesión renovada: reintentar
    }
    if (res.status === 401) setToken(null);
    const e: any = new Error(res.status === 401 ? "Sesión caducada — vuelve a iniciar sesión" : data.error ?? `Error ${res.status}`);
    Object.assign(e, data); // extras del error (ej. citas_conflicto en un 409)
    throw e;
  }
  return data as T;
}

export const fmtFechaHora = (iso: string) =>
  new Date(iso).toLocaleString("es-ES", {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid",
  });

export const fmtHora = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });

export const hoyISO = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" }).format(new Date());
