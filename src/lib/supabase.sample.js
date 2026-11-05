// Sample-build stand-in for ./supabase.js.
//
// scripts/build-policy.mjs resolves `src/lib/supabase.js` to this file whenever a
// build does not declare a non-production EAZILY_TARGET_ENV. Because the real module
// imports @supabase/supabase-js statically, it cannot be tree-shaken out of a sample
// bundle; swapping the module keeps the shipped JavaScript free of the Supabase
// client, its endpoint and its key, and every `if (!supabase)` guard in
// src/services/* keeps the app on local fixtures.
//
// Nothing may import this file directly. Keep the exported names identical to
// ./supabase.js.
export const isSupabaseConfigured = false;
export const supabase = null;