// TEST-ONLY mock of src/auth/runtime.js. Scenarios drive account states without a backend.
const BASE = { user: { id: 'fixture-user', phone: '+919876543210', phone_confirmed_at: 'fixture' }, profile: { id: 'fixture-user', full_name: 'Fixture User', phone: '+919876543210', city: 'Bhopal', role: 'customer', account_status: 'active' }, applications: [], roles: [], assessments: {}, staff: null, isAdmin: false };
const EMPTY = { user: null, profile: null, applications: [], roles: [], assessments: {}, staff: null, isAdmin: false };
export const authRuntime = {
  client: { auth: { developmentOtp: false, onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } },
  loadAccount: async () => {
    const s = window.__scenario || 'signed_out';
    if (s === 'loading') return new Promise(() => {});
    if (s === 'expired') { const e = new Error('session gone'); e.code = 'session_not_found'; throw e; }
    if (s === 'customer') return BASE;
    if (s === 'wrong_role') return { ...BASE, applications: [{ id: 'app-prof', role: 'professional', status: 'approved', details: { name: 'Fixture Electricals' } }] };
    if (s === 'allowed_role') return { ...BASE, applications: [{ id: 'app-prof', role: 'professional', status: 'approved', details: { name: 'Fixture Electricals', city: 'Bhopal', category: 'Home & Property', services: ['Electrician'] } }] };
    if (s === 'admin') return { ...BASE, isAdmin: true, profile: { ...BASE.profile, role: 'admin' } };
    if (s === 'staff_admin') return { ...BASE, staff: { staff_role: 'support', permissions: ['support.manage'] } };
    return EMPTY;
  },
};
