import { db, authClient } from "./db";

export interface UsuarioPanel {
  user_id: string;
  email: string;
  nombre: string | null;
  rol: "admin" | "direccion" | "recepcion" | "enfermera" | "medico";
  medico_id: number | null;
}

/** Valida el Bearer token y devuelve el usuario del panel (o null). */
export async function usuarioDesdeRequest(req: Request): Promise<UsuarioPanel | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return null;

  const { data, error } = await authClient().auth.getUser(token);
  if (error || !data.user) return null;

  const { data: fila } = await db()
    .from("usuarios_panel")
    .select("user_id, email, nombre, rol, medico_id")
    .eq("user_id", data.user.id)
    .eq("activo", true)
    .maybeSingle();

  return (fila as UsuarioPanel) ?? null;
}

export function puede(u: UsuarioPanel, accion: "gestion" | "config" | "metricas"): boolean {
  if (u.rol === "admin" || u.rol === "direccion") return true;
  if (u.rol === "recepcion") return accion === "gestion" || accion === "config" || accion === "metricas";
  if (u.rol === "enfermera") return accion === "gestion"; // gestiona citas, sin config ni métricas
  // medico: solo lectura de su agenda (se filtra en la ruta)
  return false;
}
