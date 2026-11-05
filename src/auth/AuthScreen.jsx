import { useEffect, useState } from 'react';
import { Brand } from '../components/Ui.jsx';
import Icon from '../components/Icon.jsx';
import OtpInput from './OtpInput.jsx';
import { maskPhone } from './policy.js';
import { DEVELOPMENT_OTP_ENABLED } from './config.js';
import { PARTNER_DEMO_ENABLED } from '../features/partners/demo/config.js';
import './auth.css';
import { ConsumerLegalLinks } from '../features/legal/ConsumerLegal.jsx';

export default function AuthScreen({ auth, onBack, onContinue, partnerRole, onEnterDemo }) {
  const [phone, setPhone] = useState('');
  const [contact, setContact] = useState('');
  const [fullName, setFullName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [legalAccepted, setLegalAccepted] = useState(false);
  const [legalError, setLegalError] = useState('');
  const [mode, setMode] = useState('signup');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [time, setTime] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setTime(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const busy = ['otp_sending', 'verifying', 'initialising'].includes(auth.status);
  const remaining = Math.max(0, Math.ceil((auth.resendAt - time) / 1000));
  const partnerAuth = Boolean(partnerRole);
  const customerSignup = !partnerAuth && mode === 'signup';
  const serviceJoin = partnerRole === 'professional';
  const compactSignin = !customerSignup && !serviceJoin;
  const customerRequest = () => ({ contact, shouldCreateUser: mode === 'signup', ...(mode === 'signup' ? { data: { full_name: fullName.trim(), date_of_birth: dateOfBirth } } : {}) });
  const submit = async event => {
    event.preventDefault();
    if (!partnerAuth && mode === 'signup' && !legalAccepted) {
      setLegalError('Please accept the Terms & Conditions and Privacy Policy to continue.');
      return;
    }
    setLegalError('');
    if (sent) {
      if (await auth.controller.verifyOtp(code)) onContinue();
    } else if (await auth.controller.sendOtp(partnerAuth ? phone : customerRequest())) setSent(true);
  };
  const reset = nextMode => {
    auth.controller.changeNumber();
    setMode(nextMode);
    setLegalError('');
    setSent(false);
    setCode('');
  };
  const skipForTesting = async () => {
    if (!DEVELOPMENT_OTP_ENABLED || !auth.developmentOtp) return;
    if (await auth.controller.sendOtp({ contact: '9999999999', data: { full_name: 'Local Tester', date_of_birth: '1990-01-01' } }) && await auth.controller.verifyOtp('0000')) onContinue();
  };
  const destination = auth.contactType === 'email' ? auth.contact : maskPhone(auth.phone);
  const continueWithGoogle = () => {
    if (mode === 'signup' && !legalAccepted) {
      setLegalError('Please accept the Terms & Conditions and Privacy Policy to continue.');
      return;
    }
    setLegalError('');
    void auth.controller.signInWithGoogle();
  };

  return <main className={`setup${partnerAuth ? '' : ' auth-customer'}${customerSignup ? ' auth-signup' : ''}${compactSignin ? ' auth-compact-signin' : ''}${auth.status === 'configuration_required' ? ' auth-unconfigured' : ''}`}>
    {serviceJoin && <button className="icon-btn" aria-label="Back" onClick={onBack}><Icon name="arrowLeft" /></button>}
    {serviceJoin && <Brand />}
    <form className="setup-body" onSubmit={submit}>
      {partnerAuth ? <>
        {serviceJoin && <span className="eyebrow">Service Partner</span>}
        <h1>{serviceJoin ? 'Sign in / Register with phone' : 'Sign in to Eazily'}</h1>
        <p className="lead">{serviceJoin ? 'A verified phone account must complete the existing registration and approval steps before receiving real work.' : 'One verified account for customer and approved partner workspaces.'}</p>
      </> : <>
        <h1>{mode === 'signup' ? 'Create Your Account' : 'Welcome Back'}</h1>
        <p className="lead">{mode === 'signup' ? 'Get started to book services easily with Eazily.' : 'Sign in to continue to your Eazily home.'}</p>
      </>}
      {DEVELOPMENT_OTP_ENABLED && auth.developmentOtp && <p className="auth-development-note" role="status"><b>Local development login</b><br />Use OTP <b>0000</b>. This creates only a temporary test session.</p>}
      {auth.status === 'configuration_required' && <p className="auth-environment-note" role="status">Real sign-in and registration are unavailable in this environment because live authentication is not configured.</p>}
      {!sent ? partnerAuth ? <>
        <label className="form-label" htmlFor="auth-phone">Mobile number</label>
        <div className="auth-input"><span>+91</span><input id="auth-phone" type="tel" autoComplete="tel-national" inputMode="tel" value={phone} onChange={event => setPhone(event.target.value)} required /></div>
      </> : <div className="auth-fields">
        {mode === 'signup' && <>
          <label className="form-label" htmlFor="auth-name">Full Name</label>
          <input className="field" id="auth-name" autoComplete="name" maxLength="100" value={fullName} onChange={event => setFullName(event.target.value)} required />
          <label className="form-label" htmlFor="auth-dob">Date of Birth</label>
          <input className="field" id="auth-dob" type="date" autoComplete="bday" max={new Date().toISOString().slice(0, 10)} value={dateOfBirth} onChange={event => setDateOfBirth(event.target.value)} required />
        </>}
        <label className="form-label" htmlFor="auth-contact">Mobile Number or Email</label>
        <input className="field" id="auth-contact" type="text" autoComplete={mode === 'signup' ? 'email' : 'username'} inputMode="email" value={contact} onChange={event => setContact(event.target.value)} placeholder="98765 43210 or you@example.com" required />
      </div> : <>
        <p>Enter the code sent to {destination}</p>
        <OtpInput value={code} onChange={setCode} disabled={busy} length={auth.otpLength} />
        <button type="button" className="link" disabled={busy} onClick={() => { auth.controller.changeNumber(); setSent(false); setCode(''); }}>Change {auth.contactType === 'email' ? 'email' : 'number'}</button>
        <button type="button" className="link" disabled={busy || remaining > 0} onClick={async () => { setCode(''); await auth.controller.sendOtp(partnerAuth ? auth.phone : customerRequest()); }}>{remaining ? `Resend in ${remaining}s` : 'Resend OTP'}</button>
      </>}
      {auth.error && auth.status !== 'configuration_required' && <p role="alert">{auth.error}</p>}
      <button className="btn btn-primary full" disabled={busy || auth.status === 'configuration_required'}>{busy ? 'Please wait…' : sent ? (partnerAuth ? 'Verify & Continue' : 'Sign Up / Continue') : 'Send OTP'}</button>
      {!partnerAuth && <>
        <div className="auth-divider"><span>OR</span></div>
        <button className="btn btn-outline full auth-google" type="button" disabled={busy || auth.status === 'configuration_required'} onClick={continueWithGoogle}><span aria-hidden="true">G</span>Continue with Google</button>
        {DEVELOPMENT_OTP_ENABLED && auth.developmentOtp && <>
          <button className="link auth-skip" type="button" disabled={busy} onClick={() => void skipForTesting()}>Skip for Testing</button>
          <small className="auth-test-note">Testing only — OTP 0000</small>
        </>}
        {mode === 'signup' && <>
          <label className="auth-legal-consent"><input type="checkbox" checked={legalAccepted} onChange={event => { setLegalAccepted(event.target.checked); if (event.target.checked) setLegalError(''); }} /> <span>I agree to Eazily&apos;s <a href="/terms" target="_blank" rel="noreferrer">Terms &amp; Conditions</a> and <a href="/privacy" target="_blank" rel="noreferrer">Privacy Policy</a>.</span></label>
          {legalError && <small className="auth-legal-error" role="alert">{legalError}</small>}
        </>}
        <p className="auth-mode-switch">{mode === 'signup' ? 'Already have an account?' : 'New to Eazily?'} <button className="link" type="button" disabled={busy} onClick={() => reset(mode === 'signup' ? 'signin' : 'signup')}>{mode === 'signup' ? 'Sign In' : 'Create Account'}</button></p>
      </>}
      {partnerAuth && <ConsumerLegalLinks />}
      <button className="link" type="button" onClick={() => onBack('support')}>Can’t access this number?</button>
      {PARTNER_DEMO_ENABLED && onEnterDemo && <section className="auth-demo-preview" aria-label="Isolated test preview">
        <div className="divider">Local demo</div>
        <p>Browse sample customer and partner screens. No account, booking, approval, consent or payment is created.</p>
        <button className="btn btn-outline full" type="button" onClick={onEnterDemo}>Enter Demo Mode</button>
      </section>}
    </form>
  </main>;
}
