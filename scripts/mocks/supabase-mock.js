// TEST-ONLY mock of src/lib/supabase.js for the router authorization harness.
// No network: every query chain resolves empty.
const chainable = () => new Proxy(function () {}, {
  get(_t, p) {
    if (p === 'then') return resolve => resolve({ data: [], error: null, count: 0 });
    if (p === Symbol.toPrimitive) return () => 0;
    return chainable();
  },
  apply() { return chainable(); },
});
export const isSupabaseConfigured = true;
export const supabase = {
  from: () => chainable(),
  rpc: () => chainable(),
  storage: { from: () => chainable() },
  auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
};
export default supabase;
