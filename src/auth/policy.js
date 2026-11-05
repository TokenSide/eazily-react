export const EMPTY_ACCOUNT = Object.freeze({ user:null, profile:null, applications:[], roles:[], staff:null, isAdmin:false });
export function normalizeIndianPhone(value) {
  let digits=String(value).replace(/[\s()-]/g,'');
  if (digits.startsWith('+91')) digits=digits.slice(3);
  else if (/^91\d{10}$/.test(digits)) digits=digits.slice(2);
  if (!/^[6-9]\d{9}$/.test(digits)) throw new Error('Enter a valid Indian mobile number.');
  return `+91${digits}`;
}
// A phone counts as verified only when Supabase has confirmed it (phone_confirmed_at). Returns "+<digits>" or ''.
export function confirmedPhone(user) {
  if (!user?.phone_confirmed_at) return '';
  const digits=String(user.phone||'').replace(/\D/g,'');
  return digits?`+${digits}`:'';
}
export const maskPhone=phone=>`+91 ••••••${phone.slice(-4)}`;
export const validOtp=code=>/^\d{6}$/.test(code);
export function safeAuthError(error) {
  const code=error?.code;
  if (code==='otp_expired') return 'The code is incorrect or expired. Request a new code.';
  if (code==='over_sms_send_rate_limit'||code==='over_request_rate_limit'||error?.status===429) return 'Too many attempts. Please wait before trying again.';
  if (error?.name==='AuthRetryableFetchError'||error?.name==='TypeError') return 'Connection unavailable. Check your connection and try again.';
  // SMS provider / Send SMS hook not configured or failing on the Supabase side. Never implies a code was sent.
  if (['sms_send_failed','phone_provider_disabled','otp_disabled','hook_timeout','hook_timeout_after_retry'].includes(code)) return 'SMS verification is temporarily unavailable. No code was sent. Please try again later.';
  if (code==='phone_exists') return 'This mobile number is already linked to another account.';
  return 'Verification could not be completed. Check the code or try again later.';
}
export function accountState(account) {
  if (!account.user) return 'signed_out';
  if (!account.profile) return 'profile_required';
  if (account.profile.account_status==='closed') return 'blocked';
  if (['suspended','blocked'].includes(account.profile.account_status)) return account.profile.account_status;
  return account.profile.full_name?.trim() ? 'authenticated' : 'profile_required';
}
export function routeAccess(account,role) {
  if (!account.user) return role==='customer'?'public':'signed_out';
  const state=accountState(account);
  if (state!=='authenticated') return state;
  if (role==='customer') return 'allowed';
  if (role==='admin') return account.isAdmin?'allowed':'denied';
  if (!['professional','influencer','consultant'].includes(role)) return 'denied';
  const application=account.applications.find(a=>a.role===role);
  if (!application||application.status==='draft'||application.status==='changes_required') return 'registration';
  if (['suspended','blocked'].includes(application.status)) return application.status;
  if (application.status==='rejected') return 'rejected';
  // A submitted application owns this workspace even while human review is
  // pending. The workspace itself keeps operational actions locked until the
  // application is approved.
  if (['submitted','under_review'].includes(application.status)) return 'allowed';
  if (application.status!=='approved') return 'approval_pending';
  if (role==='consultant'&&account.assessments?.[application.id]!==true) return 'assessment_required';
  return 'allowed';
}
export function clearAccountStorage(storage) {
  if (!storage) return;
  try {for (const key of Object.keys(storage)) if (key.startsWith('eazily-')&&!['eazily-language','eazily-theme'].includes(key)) storage.removeItem(key);} catch { /* Storage can be unavailable. Memory is still cleared. */ }
}
