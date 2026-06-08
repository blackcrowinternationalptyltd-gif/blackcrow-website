import {createClient} from '@supabase/supabase-js';

/**
 * Returns a Supabase server client or null if env vars are missing.
 * Set SUPABASE_URL and SUPABASE_SERVICE_KEY (preferred) or SUPABASE_ANON_KEY
 * in your .env file.
 */
export function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {auth: {persistSession: false}});
}
