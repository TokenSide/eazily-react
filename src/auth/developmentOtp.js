const STORAGE_KEY = 'eazilyDevOtpSession';
const USER_ID = 'dev-otp-user';

function readPhone(storage) {
  try {
    const value = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
    return /^\+91[6-9]\d{9}$/.test(value?.phone || '') ? value.phone : '';
  } catch {
    return '';
  }
}

export function createDevelopmentOtpRuntime(storage) {
  let phone = readPhone(storage);
  let pendingPhone = '';
  const listeners = new Set();
  // Mirrors a Supabase phone-OTP login (which confirms the phone). Development builds only.
  const user = () => phone ? { id: USER_ID, phone, phone_confirmed_at: 'development-otp-login', aud: 'authenticated', role: 'authenticated' } : null;
  const session = () => user() ? { user: user(), access_token: 'development-session-only' } : null;
  const notify = event => listeners.forEach(listener => listener(event, session()));
  const account = () => ({
    user: user(),
    profile: user() ? { id: USER_ID, full_name: 'Local Tester', phone, city: 'Bhopal', role: 'customer', account_status: 'active' } : null,
    applications: [], roles: [], assessments: {}, staff: null, isAdmin: false,
  });
  const auth = {
    developmentOtp: true,
    otpLength: 4,
    isOtpValid: code => /^\d{4}$/.test(code),
    onAuthStateChange(listener) {
      listeners.add(listener);
      return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
    },
    async signInWithOtp({ phone: requestedPhone }) {
      pendingPhone = requestedPhone;
      return { data: {}, error: null };
    },
    async verifyOtp({ phone: requestedPhone, token }) {
      if (token !== '0000' || requestedPhone !== pendingPhone) return { data: {}, error: { code: 'otp_expired' } };
      phone = requestedPhone;
      try { storage?.setItem(STORAGE_KEY, JSON.stringify({ phone })); } catch { /* Memory login still works for this page. */ }
      notify('SIGNED_IN');
      return { data: { user: user(), session: session() }, error: null };
    },
    async signOut() {
      phone = ''; pendingPhone = '';
      try { storage?.removeItem(STORAGE_KEY); } catch { /* Memory logout is still complete. */ }
      notify('SIGNED_OUT');
      return { error: null };
    },
  };
  return { client: { auth }, loadAccount: async () => account() };
}
