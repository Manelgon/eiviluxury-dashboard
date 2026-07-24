import { createClient } from "@supabase/supabase-js";

// El cliente va tipado laxo: el esquema "eivi" no encaja en los genéricos
// por defecto de supabase-js y aquí no usamos tipos generados.
type SupabaseClient = any;

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

let _db: SupabaseClient | null = null;
let _auth: SupabaseClient | null = null;

/** Cliente con service_role sobre el esquema eivi (solo servidor). */
export function db(): SupabaseClient {
  if (!_db) {
    _db = createClient(req("SUPABASE_URL"), req("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
      db: { schema: "eivi" },
    });
  }
  return _db;
}

/** Cliente anónimo solo para login / verificación de tokens. */
export function authClient(): SupabaseClient {
  if (!_auth) {
    _auth = createClient(req("SUPABASE_URL"), req("SUPABASE_ANON_KEY"), {
      auth: { persistSession: false },
    });
  }
  return _auth;
}
