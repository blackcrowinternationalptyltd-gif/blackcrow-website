import {createClient} from '@supabase/supabase-js';

/**
 * Returns a Supabase server client, or null if env vars are missing.
 *
 * On Oxygen/Cloudflare Workers there is no `process.env`, so env vars are
 * passed in from the loader/action context (see server.js getLoadContext).
 * Call as: getSupabase(context.env)
 *
 * Prefers the anon key (read-only, safe in a server worker) and falls back
 * to the service key if the anon key isn't configured.
 */
export function getSupabase(env) {
  const url = env?.SUPABASE_URL;
  const key = env?.SUPABASE_ANON_KEY ?? env?.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {auth: {persistSession: false}});
}
