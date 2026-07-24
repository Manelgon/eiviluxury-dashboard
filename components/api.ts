"use client";

let token: string | null = null;
export function setToken(t: string | null) {
  token = t;
  if (typeof window !== "undefined") {
    if (t) localStorage.setItem("eivi_token", t);
    else localStorage.removeItem("eivi_token");
  }
}
export function getToken(): string | null {
  if (token) return token;
  if (typeof window !== "undefined") token = localStorage.getItem("eivi_token");
  return token;
}

export async function api<T = any>(ruta: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
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
    if (res.status === 401) setToken(null);
    const e: any = new Error(data.error ?? `Error ${res.status}`);
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
