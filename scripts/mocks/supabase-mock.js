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
  rpc: name => (name === 'admin_dashboard_summary' && typeof window !== 'undefined' && window.__adminSummary !== undefined
    ? Promise.resolve({ data: window.__adminSummary, error: null })
    : chainable()),
  storage: { from: () => chainable() },
  auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
};
export default supabase;
