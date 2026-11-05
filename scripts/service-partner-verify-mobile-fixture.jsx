// Browser fixture: an email/Google account (no confirmed phone) on Service Partner Step 1.
// The real auth controller and registration screen run; only the Supabase client and the
// registration save RPCs are replaced by in-page fakes (see the browser test's esbuild plugin).
import { createRoot } from 'react-dom/client';
import { useAuth } from '../src/auth/useAuth.js';
import ServicePartnerOnboarding from '../src/features/partners/ServicePartnerOnboarding.jsx';
import '../src/styles.css';
import '../src/experience.css';
import '../src/partner.css';

const ACCOUNT_ID = 'email-account-1';
const listeners = new Set();
const state = { user: { id: ACCOUNT_ID, email: 'asha@example.in', app_metadata: { provider: 'email' } }, pending: '' };
window.__verify = { confirms: true, updates: [], verifies: [] };
const notifyAuth = event => listeners.forEach(listener => listener(event, { user: state.user }));
const client = {
  auth: {
    onAuthStateChange(listener) { listeners.add(listener); return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } }; },
    async updateUser(body) { window.__verify.updates.push(body); state.pending = body.phone; queueMicrotask(() => notifyAuth('USER_UPDATED')); return { data: { user: state.user }, error: null }; },
    async verifyOtp(body) {
      window.__verify.verifies.push(body);
      if (body.type !== 'phone_change' || body.token !== '123456' || body.phone !== state.pending) return { data: {}, error: { code: 'otp_expired' } };
      // Supabase stores the phone without "+"; phone_confirmed_at is set only when the server confirms.
      state.user = { ...state.user, phone: body.phone.replace('+', ''), ...(window.__verify.confirms ? { phone_confirmed_at: '2026-09-27T10:00:00Z' } : {}) };
      queueMicrotask(() => notifyAuth('USER_UPDATED'));
      return { data: { user: state.user }, error: null };
    },
    async getUser() { return { data: { user: state.user }, error: null }; },
    async signOut() { return { error: null }; },
  },
};
const loadAccount = async () => ({ user: state.user, profile: { id: ACCOUNT_ID, full_name: 'Asha Verma', email: state.user.email, city: 'Bhopal', role: 'customer', account_status: 'active' }, applications: [], roles: ['customer'], staff: null, isAdmin: false, assessments: {} });

export const authRuntime = { client, loadAccount };
export const getServicePartnerLegalDocuments = async () => [];
export const saveApplication = async (role, details) => ({ id: 'fixture-application', role, status: 'draft', details });
export const submitServicePartnerApplication = async () => { throw new Error('Submission is not part of this fixture'); };

function App() {
  const auth = useAuth();
  if (!auth.account.user) return <p role="status">Loading…</p>;
  return <div className="phone-shell"><ServicePartnerOnboarding account={auth.account} existing={null} notify={message => { window.__toasts = [...(window.__toasts || []), message]; }} onDone={() => {}} onBack={() => {}} /></div>;
}

if (typeof document !== 'undefined' && document.getElementById('root')) createRoot(document.getElementById('root')).render(<App />);
