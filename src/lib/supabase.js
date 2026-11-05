// Single Supabase entry point for the whole app.
//
// Two modes, chosen at build time by scripts/build-policy.mjs:
//   connected  - EAZILY_TARGET_ENV is staging/development/local. A real client is
//               created from VITE_SUPABASE_URL + the publishable (or legacy anon)
//               key, and every src/services/* caller reaches hosted Postgres.
//   sample     - no target declared. Exports stay null, so the services keep their
//               existing `if (!supabase) return []` demo guards and the app runs
//               entirely on fixtures with no network access.
//
// Never place a service-role or other server-only secret in a VITE_ variable:
// anything prefixed VITE_ is inlined into the JavaScript bundle.
import { createClient } from '@supabase/supabase-js';

// Vite inlines these as literals, so each name must be accessed statically.
const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
const legacyAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();
const key = publishableKey || legacyAnonKey;

export const isSupabaseConfigured = Boolean(url && key);

if ((url || key) && !isSupabaseConfigured) {
  console.warn(
    '[eazily] Supabase is half-configured. Set both VITE_SUPABASE_URL and ' +
      'VITE_SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_ANON_KEY) to connect; ' +
      'the app is running on local fixtures until then.'
  );
}

export const supabase = isSupabaseConfigured
  ? createClient(url, key, {
      db: { schema: 'public' },
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;