import { useEffect, useRef, useState } from 'react';
import { Field } from '../../components/Ui.jsx';
import Icon from '../../components/Icon.jsx';
import { catalog } from '../../data/catalog.js';
import { influencerCategories, displayInfluencerCategory } from '../../data/influencerCategories.js';
import { consultantCategories, displayConsultantCategory } from '../../data/consultantCategories.js';
import { setLanguage, translate as t } from '../../lib/translate.js';
import { saveApplication } from '../../services/partners.js';
import { isSupabaseConfigured } from '../../lib/supabase.js';
import MediaUpload from './MediaUpload.jsx';
import { InfluencerLegalModal } from './legal/InfluencerLegal.jsx';
import { influencerPrivacy, influencerTerms } from './legal/influencerLegal.js';
import ConsultantLegal from './legal/ConsultantLegal.jsx';
import { rpc } from '../../services/experience.js';
import ConsultantAssessment from './ConsultantAssessment.jsx';
import ServicePartnerOnboarding from './ServicePartnerOnboarding.jsx';
import { CONSULTANT_ASSESSMENT_TEST_SKIP_ENABLED } from './consultantAssessmentConfig.js';
import { IN_APP_BACK_EVENT } from '../../lib/nativeShell.js';
import { PARTNER_DEMO_ENABLED } from './demo/config.js';
import { lookupIfsc, lookupPincode, useLookup } from './registrationLookups.js';
import { LookupHint } from './RegistrationAssist.jsx';

const roleTitles = {
  professional: ['Your work', 'Your business', 'Experience and team', 'Documents', 'Receive your earnings', 'Review and agree'],
  influencer: ['Your profile / आपकी जानकारी', 'Your location / आपकी लोकेशन', 'Your content & reach / आपका कंटेंट और रीच', 'Your social accounts / आपके सोशल अकाउंट', 'Verification & payments / पहचान और भुगतान', 'Review & submit / जाँचें और जमा करें'],
  consultant: ['Your expertise', 'Qualifications', 'Current work and experience', 'Identity and bank', 'Field assessment / क्षेत्र मूल्यांकन', 'Review and consultation terms']
};
const initial = role => ({ language: localStorage.getItem('eazily-language') || 'English', stage: 0, platforms: role === 'influencer' ? [{ name: 'Instagram', url: '', band: '' }] : [], services: [], relatedNiches: [], documents: {}, media: [], termsAccepted: false, informationAccurate: false, promotionalConsent: false, consentVersion: role === 'influencer' ? influencerTerms.version : 'partner-registration-2026-09' });
const followerBands = ['Below the current bands', '20K–under 50K', '50K–under 100K', '100K–under 500K', '500K–under 1M', '1M+'];
const priceBands = ['₹1,000–₹10,000', 'Above ₹10,000–₹50,000', 'Above ₹50,000–₹1,00,000', 'Above ₹1,00,000', 'Custom amount'];
const today = new Date().toISOString().slice(0, 10);

export default function PartnerOnboarding(props) {
  if (props.role === 'professional') return <ServicePartnerOnboarding existing={props.existing} account={props.account} notify={props.notify} onDone={props.onDone} onBack={props.onBack} onPreview={props.onPreview} />;
  return <OtherPartnerOnboarding {...props} />;
}

function OtherPartnerOnboarding({ role, existing, account, notify, onDone, onBack, onPreview }) {
  const titles = roleTitles[role];
  const [values, setValues] = useState(() => prefillFromAccount(normalizeValues(role, existing?.details), account));
  const [savedApplication, setSavedApplication] = useState(existing || null);
  const [stage, setStage] = useState(() => initialStage(role, existing?.details));
  const [busy, setBusy] = useState(false);
  const [legalDocument, setLegalDocument] = useState(null);
  const [consentError, setConsentError] = useState('');
  const [consultantLegalReady, setConsultantLegalReady] = useState(false);
  const formRef = useRef(null);
  const submitLock = useRef(false);
  const canSkip = PARTNER_DEMO_ENABLED && !isSupabaseConfigured;
  useEffect(() => {
    const back = event => {
      event.detail.handled = true;
      if (stage > 0) setStage(current => current - 1);
      else onBack();
    };
    window.addEventListener(IN_APP_BACK_EVENT, back);
    return () => window.removeEventListener(IN_APP_BACK_EVENT, back);
  }, [stage, onBack]);
  async function persist(submit = false, exit = false, savedStage = stage, sourceValues = values) {
    setBusy(true);
    try {
      const bandCounts = { 'Below the current bands': 0, '20K–under 50K': 20000, '50K–under 100K': 50000, '100K–under 500K': 100000, '500K–under 1M': 500000, '1M+': 1000000 };
      const platforms = sourceValues.platforms?.map(page => ({ ...page, count: bandCounts[page.band] ?? page.count ?? 0 }));
      const submittedConsent = role === 'influencer'
        ? { documentId: influencerTerms.documentId, version: influencerTerms.version, termsAccepted: sourceValues.termsAccepted, informationAccurate: sourceValues.informationAccurate, promotionalConsent: sourceValues.promotionalConsent }
        : { version: sourceValues.consentVersion, acceptedAt: new Date().toISOString(), termsAccepted: role === 'consultant' ? true : sourceValues.termsAccepted, informationAccurate: sourceValues.informationAccurate, promotionalConsent: sourceValues.promotionalConsent };
      const details = { ...sourceValues, stage: savedStage, platforms, insightScreenshots: platforms?.flatMap(page => page.insightScreenshots || []).length ? platforms.flatMap(page => page.insightScreenshots || []) : sourceValues.insightScreenshots, consent: submit ? submittedConsent : sourceValues.consent };
      if (!isSupabaseConfigured && submit) throw new Error('Submission is unavailable in testing mode. Connect the live service to submit your application.');
      const result = isSupabaseConfigured
        ? await saveApplication(role, details, submit)
        : { id: savedApplication?.id || `testing-${role}`, role, details: { ...details, registrationComplete: false }, status: 'draft', testing: true };
      setSavedApplication(result);
      notify(!isSupabaseConfigured ? 'Testing draft saved for this session only. It is not a completed registration.' : submit ? 'Application submitted for review' : 'Draft saved');
      if (submit || exit) onDone(result, { completed: submit, submitted: submit, draft: !submit, exit });
      return result;
    } catch (error) { notify(error.message); return null; } finally { setBusy(false); }
  }
  async function next(skip = false) {
    if (!(skip === true && canSkip) && !validateStep(role, stage, values)) {
      notify('Complete the required items on this step. You can save and exit with an incomplete draft.');
      formRef.current?.querySelector(':invalid')?.focus();
      return;
    }
    const nextStage = Math.min(5, stage + 1);
    const result = await persist(false, false, nextStage);
    if (result) { setStage(nextStage); setValues(current => ({ ...current, stage: nextStage })); window.scrollTo(0, 0); }
  }
  async function skipConsultantAssessment() {
    if (role !== 'consultant' || stage !== 4 || !CONSULTANT_ASSESSMENT_TEST_SKIP_ENABLED || isSupabaseConfigured) return;
    const nextValues = { ...values, assessmentStatus: 'skipped_for_testing', assessmentScore: null, stage: 5 };
    setValues(nextValues);
    const result = await persist(false, false, 5, nextValues);
    if (result) { setStage(5); window.scrollTo(0, 0); }
  }
  async function submit(event) {
    event.preventDefault();
    if (submitLock.current) return;
    if (role === 'consultant' && isSupabaseConfigured) {
      try {
        const legal = await rpc('get_consultant_legal_status', { p_application_id: savedApplication?.id || null });
        if (!legal.eligible) throw new Error('Accept the current approved Consultant Terms and acknowledge the Privacy Policy before submitting. Incomplete drafts cannot be accepted.');
      } catch (error) { setConsentError(error.message); notify(error.message); return; }
    }
    if ((role === 'influencer' || isSupabaseConfigured) && ((role !== 'consultant' && !values.termsAccepted) || !values.informationAccurate)) {
      if (role === 'influencer') setConsentError(!values.termsAccepted ? 'You must explicitly accept the Eazily Influencer Terms & Conditions before submitting.' : 'Confirm that the supplied information is accurate before submitting.');
      formRef.current?.querySelector('input[name="influencerTermsAccepted"], input:invalid')?.focus();
      return notify(role === 'influencer' ? 'Complete the required Influencer consent before submitting.' : 'Accept the terms and confirm that the supplied information is accurate.');
    }
    const invalidStage = [0, 1, 2, 3, 4, 5].find(step => !validateStep(role, step, values));
    if (invalidStage !== undefined) {
      setStage(invalidStage);
      notify('Complete the required items before submitting. Your form data is still here.');
      setTimeout(() => formRef.current?.querySelector(':invalid')?.focus(), 0);
      return;
    }
    if (!isSupabaseConfigured) {
      notify('Live registration is unavailable because phone verification and backend submission are not configured. Your form data remains on this page. Use Save & exit for a testing draft or Demo Mode for a sample dashboard.');
      return;
    }
    submitLock.current = true;
    try { await persist(true); }
    finally { submitLock.current = false; }
  }
  async function previewForTesting() {
    if (!canSkip || busy) return;
    if (!onPreview) {
      notify('Demo Mode is not enabled. Use Save & exit to keep a testing draft for this session.');
      return;
    }
    const result = await persist(false, false, stage, values);
    if (!result) return;
    notify('Opening isolated Demo Mode. No account, consent, approval, listing, booking, or payout was created.');
    onPreview(result);
  }
  return <main className={`partner-onboarding role-${role}`}>
    <header className="partner-simple-header wizard-header"><button className="icon-btn" onClick={stage ? () => setStage(stage - 1) : onBack}><Icon name="arrowLeft" /></button><div className="wizard-head-copy"><span className="wizard-brand">{t('Eazily')}</span><span className="wizard-step">{t('Step')} {stage + 1} {t('of')} {titles.length}{savedApplication?.id ? ` · ${t('Draft saved')}` : ''}</span><h1>{t(titles[stage])}</h1></div><select aria-label="Language" value={values.language} onChange={event => { setLanguage(event.target.value); setValues(current => ({ ...current, language: event.target.value })); }}><option>English</option><option>हिन्दी</option></select></header>
    <div className="registration-progress" aria-label={`Step ${stage + 1} of ${titles.length}`}>{titles.map((title, index) => <i key={title} className={index <= stage ? 'done' : ''} />)}</div>
    <section className="partner-form-card"><span className={`application-state ${existing?.status || 'draft'}`}>{(existing?.status || 'Draft').replace('_', ' ')}</span>{existing?.review_notes && <div className="safety-card"><b>{t('Changes requested')}</b><p>{existing.review_notes}</p></div>}
      {!isSupabaseConfigured && <p className="testing-notice" role="status">Testing mode: drafts stay in this session only and are lost on refresh. Complete registration cannot submit without live phone verification and the backend. Demo Mode, when enabled, uses isolated sample data.</p>}
      <form ref={formRef} onSubmit={submit} noValidate><Step role={role} stage={stage} values={values} setValues={setValues} notify={notify} onEdit={setStage} openLegal={setLegalDocument} consentError={consentError} clearConsentError={() => setConsentError('')} application={savedApplication} onSkipConsultantAssessment={skipConsultantAssessment} />
        {role === 'consultant' && stage === 5 && <ConsultantLegal application={savedApplication} onEligibilityChange={setConsultantLegalReady} />}
        {canSkip && !(role === 'consultant' && stage === 4) && <button type="button" className="btn btn-outline" disabled={busy} onClick={() => stage === 5 ? previewForTesting() : next(true)}>{stage === 5 && onPreview ? 'Open Demo dashboard' : 'Skip for now'}</button>}
        {role === 'consultant' && consentError && <p role="alert" className="inline-error">{consentError}</p>}<p className="warm-copy">{stage < 5 ? 'बहुत बढ़िया! अगला छोटा कदम।' : 'Review each answer before sending it for human verification.'}</p>
        <div className="registration-actions"><button type="button" className="link" disabled={busy} onClick={() => persist(false, true)}>{t('Save & exit')}</button>{stage < 5 ? <button type="button" className="btn btn-primary wizard-continue" disabled={busy} onClick={next}>{t('Continue')}</button> : <button className="btn btn-primary wizard-continue" disabled={busy || (role === 'consultant' && isSupabaseConfigured && !consultantLegalReady)}>{busy ? 'Submitting…' : t('Submit for review')}</button>}</div>
      </form>
    </section>
    {legalDocument && <InfluencerLegalModal documentKey={legalDocument} onClose={() => setLegalDocument(null)} />}
  </main>;
}

function normalizeValues(role, saved) {
  const values = { ...initial(role), ...(saved || {}) };
  if (role !== 'influencer') return values;
  values.category = displayInfluencerCategory(values.category);
  values.relatedNiches = [...new Set((values.relatedNiches || []).map(displayInfluencerCategory))].filter(item => item && item !== values.category);
  const platforms = values.platforms?.length ? values.platforms : [{ name: 'Instagram', url: '', band: '' }];
  const acceptedCurrentVersion = saved?.consent?.documentId === influencerTerms.documentId && saved?.consent?.version === influencerTerms.version;
  return { ...values, consentVersion: influencerTerms.version, termsAccepted: acceptedCurrentVersion ? Boolean(values.termsAccepted) : false, platforms: platforms.map((page, index) => index === 0 ? { ...page, postingFrequency: page.postingFrequency ?? values.postingFrequency, frequencyPeriod: page.frequencyPeriod ?? values.frequencyPeriod, pageStarted: page.pageStarted ?? values.pageStarted, pageAgeApproximate: page.pageAgeApproximate ?? values.pageAgeApproximate, insightScreenshots: page.insightScreenshots ?? values.insightScreenshots } : page) };
}

// Same account defaults the Service Partner form uses; saved or typed values always win.
function prefillFromAccount(values, account) {
  const suggestions = { name: account?.profile?.full_name, email: account?.profile?.email || account?.user?.email, city: account?.profile?.city };
  const next = { ...values };
  Object.entries(suggestions).forEach(([name, value]) => { if (!String(next[name] ?? '').trim() && value) next[name] = value; });
  return next;
}

function initialStage(role, saved) {
  const stage = Math.min(Number(saved?.stage || 0), 5);
  if (role === 'consultant' && saved?.assessmentStatus !== 'passed' && !(CONSULTANT_ASSESSMENT_TEST_SKIP_ENABLED && !isSupabaseConfigured && saved?.assessmentStatus === 'skipped_for_testing')) return Math.min(stage, 4);
  if (role !== 'influencer') return stage;
  if (stage === 2 && !saved?.reachFormat) return 3;
  if (stage === 3 && saved?.reachFormat) return 2;
  return stage;
}

function Step({ role, stage, values, setValues, notify, onEdit, openLegal, consentError, clearConsentError, application, onSkipConsultantAssessment }) {
  const set = name => event => setValues(current => {
    const next = { ...current, [name]: event.target.type === 'checkbox' ? event.target.checked : event.target.value };
    if (role === 'influencer' && name === 'category') return { ...next, relatedNiches: (current.relatedNiches || []).filter(item => item !== next.category) };
    return role === 'consultant' && ['category', 'specialisation'].includes(name)
      ? { ...next, assessmentStatus: 'not_started', assessmentScore: null, assessmentAttemptId: null, assessmentFieldId: null }
      : next;
  });
  const field = (name, label, props = {}) => <Field key={name} label={t(label)} value={values[name] ?? ''} onChange={set(name)} {...props} />;
  const upload = (name, label, documents = false) => <MediaUpload role={role} label={label} documents={documents} autoUpload documentCamera={documents} value={values[name] || []} onChange={change => setValues(current => ({ ...current, [name]: typeof change === 'function' ? change(current[name] || []) : change }))} />;
  if (stage === 0) return <>{role === 'professional' && <ServiceSelection values={values} setValues={setValues} />}{role === 'influencer' && <InfluencerProfile values={values} setValues={setValues} field={field} />}{role === 'consultant' && <><ConsultantExpertise values={values} setValues={setValues} />{field('mode', 'Consultation mode', { as: 'select', options: ['Online', 'In person', 'Both'] })}</>} {role !== 'influencer' && <LocationFields values={values} setValues={setValues} notify={notify} />}</>;
  if (role === 'influencer' && stage === 1) return <LocationFields values={values} setValues={setValues} notify={notify} />;
  if (role === 'professional') return <ProfessionalStep stage={stage} values={values} setValues={setValues} field={field} upload={upload} />;
  if (role === 'influencer') return <InfluencerStep stage={stage} values={values} setValues={setValues} field={field} upload={upload} onEdit={onEdit} openLegal={openLegal} consentError={consentError} clearConsentError={clearConsentError} />;
  return <ConsultantStep stage={stage} values={values} setValues={setValues} field={field} upload={upload} application={application} notify={notify} onSkipAssessment={onSkipConsultantAssessment} />;
}

function ServiceSelection({ values, setValues }) {
  const groups = catalog.find(item => item.id === 'manpower').groups;
  const selected = groups.find(item => item.label === values.category);
  return <>{<Field label="Primary service category" as="select" options={['', ...groups.map(item => item.label)]} value={values.category || ''} onChange={event => setValues(current => ({ ...current, category: event.target.value, services: [] }))} required />}<div className="chip-grid">{(selected?.items || []).map(service => <label className={values.services?.includes(service) ? 'selected' : ''} key={service}><input type="checkbox" checked={values.services?.includes(service) || false} onChange={event => setValues(current => ({ ...current, services: event.target.checked ? [...(current.services || []), service] : current.services.filter(item => item !== service) }))} />{service}</label>)}</div></>;
}

function LocationFields({ values, setValues, notify }) {
  function locate() {
    if (!navigator.geolocation) return notify('Location is unavailable. Enter your city and PIN code manually.');
    navigator.geolocation.getCurrentPosition(position => setValues(current => ({ ...current, locationPermission: 'granted', latitude: position.coords.latitude, longitude: position.coords.longitude })), error => { setValues(current => ({ ...current, locationPermission: error.code === 1 ? 'denied' : 'unavailable' })); notify('Location was not available. Manual city and PIN entry remains available.'); }, { enableHighAccuracy: false, timeout: 10000 });
  }
  const pin = useLookup(lookupPincode, /^\d{6}$/.test(values.pinCode || '') ? values.pinCode : '');
  const filledCity = useRef('');
  useEffect(() => {
    if (pin.status !== 'found' || !pin.result.city) return;
    setValues(current => {
      if (current.city && current.city !== filledCity.current) return current;
      filledCity.current = pin.result.city;
      return { ...current, city: pin.result.city };
    });
  }, [pin.status, pin.result, setValues]);
  return <section className="location-permission"><b>Location</b><p>Location helps match nearby work. It is requested once and registration never requires continuous tracking.</p><button type="button" className="btn btn-outline" onClick={locate}>Use current location</button>{values.locationPermission && <small>Status: {values.locationPermission}. You can correct the area below.</small>}<Field label="PIN code" inputMode="numeric" autoComplete="postal-code" maxLength={6} value={values.pinCode || ''} onChange={event => setValues(current => ({ ...current, pinCode: event.target.value.replace(/\D/g, '').slice(0, 6) }))} required /><LookupHint state={pin} idle="Enter your 6-digit PIN — your city fills automatically." found={result => `${result.city}, ${result.state} — city filled. You can edit it.`} notFound="PIN not found. Enter your city manually." /><Field label="City" value={values.city || ''} onChange={event => setValues(current => ({ ...current, city: event.target.value }))} required /></section>;
}

function ProfessionalStep({ stage, values, field, upload }) {
  if (stage === 1) return <>{field('name', "Owner's name", { required: true })}{field('businessName', 'Shop or business name')}{field('shopOwnership', 'Shop arrangement', { as: 'select', options: ['Owned', 'Rented', 'No fixed shop'], required: true })}{field('address', values.shopOwnership === 'No fixed shop' ? 'Private base area' : 'Shop address', { required: true })}<p className="policy-note">A private home/base address is never shown publicly.</p></>;
  if (stage === 2) return <>{field('experience', 'Experience', { as: 'select', options: ['Less than 1 year', '1–3 years', '3–5 years', '5–10 years', '10+ years'], required: true })}{field('workStyle', 'How do you work?', { as: 'select', options: ['Alone', 'Team'], required: true })}{values.workStyle === 'Team' && field('workerCount', 'Workers in your team', { type: 'number', min: 1, required: true })}{upload('ownerShopMedia', values.shopOwnership === 'No fixed shop' ? 'Owner photo and work-setup photo' : 'Shop and owner photo')}</>;
  if (stage === 3) return <>{upload('gumasta', 'Gumasta / Shop registration', true)}{upload('udyam', 'MSME / Udyam certificate — Optional', true)}{upload('aadhaar', 'Aadhaar identity verification', true)}{upload('pan', 'PAN card', true)}<p className="policy-note">Documents stay private and remain pending until an authorised reviewer verifies them.</p></>;
  if (stage === 4) return <BankFields values={values} field={field} />;
  return <ReviewTerms role="professional" values={values} field={field} />;
}

function InfluencerProfile({ values, setValues, field }) {
  const related = values.relatedNiches || (values.relatedNichesText ? values.relatedNichesText.split(',').map(item => item.trim()).filter(Boolean) : []);
  const categoryOptions = [...new Set(['', ...influencerCategories, values.category].filter(Boolean))];
  return <>{field('creatorName', 'Creator or business name', { required: true })}{field('name', 'Full name', { required: true })}{field('dateOfBirth', 'Date of Birth / जन्म तिथि', { type: 'date', max: today, 'aria-describedby': 'dob-note' })}<small id="dob-note" className="policy-note">Private profile information. It is not shown publicly.</small>{field('email', 'Email address', { type: 'email', required: true })}{field('category', 'Primary content category', { as: 'select', options: categoryOptions, required: true })}<p className="form-label">Related content categories <small>(optional)</small></p><div className="chip-grid">{influencerCategories.map(category => <label className={related.includes(category) ? 'selected' : ''} key={category}><input type="checkbox" checked={related.includes(category)} disabled={category === values.category} onChange={event => setValues(current => ({ ...current, relatedNiches: event.target.checked ? [...related, category].filter(item => item !== current.category) : related.filter(item => item !== category) }))} />{category}</label>)}</div><p className="policy-note">Your primary category cannot also be selected as related.</p></>;
}

function ConsultantExpertise({ values, setValues }) {
  const selected = (values.consultationFields || []).filter(item => item.category && item.category !== values.category);
  const update = (category, specialisation, extras = selected) => setValues(current => ({
    ...current, category, specialisation,
    consultationFields: [{ category, specialisation }, ...extras.filter(item => displayConsultantCategory(item.category) !== displayConsultantCategory(category))],
    assessmentStatus: 'not_started', assessmentScore: null, assessmentAttemptId: null, assessmentFieldId: null,
  }));
  return <>
    <Field label="Consultation category" as="select" options={['', ...new Set([...consultantCategories, values.category].filter(Boolean))]} value={values.category || ''} onChange={event => update(event.target.value, values.specialisation)} required />
    {values.category && !consultantCategories.includes(values.category) && <p className="policy-note">Saved category: {values.category}. Displayed as {displayConsultantCategory(values.category)} where applicable. Changing it requires a new category-specific assessment; your previous result remains attached to its original saved field.</p>}
    <Field label="Specialisation" value={values.specialisation || ''} onChange={event => update(values.category, event.target.value)} required />
    <p className="form-label">Additional expertise <small>(optional; each selected field needs its own assessment)</small></p>
    <div className="chip-grid">{consultantCategories.map(category => <label className={selected.some(item => displayConsultantCategory(item.category) === category) ? 'selected' : ''} key={category}><input type="checkbox" checked={selected.some(item => displayConsultantCategory(item.category) === category)} disabled={category === displayConsultantCategory(values.category)} onChange={event => update(values.category, values.specialisation, event.target.checked ? [...selected, { category, specialisation: '' }] : selected.filter(item => displayConsultantCategory(item.category) !== category))} />{category}</label>)}</div>
    {selected.map((item, index) => <Field key={item.category} label={`${displayConsultantCategory(item.category)} specialisation`} value={item.specialisation || ''} onChange={event => update(values.category, values.specialisation, selected.map((entry, entryIndex) => entryIndex === index ? { ...entry, specialisation: event.target.value } : entry))} required />)}
  </>;
}

function InfluencerStep({ stage, values, setValues, field, upload, onEdit, openLegal, consentError, clearConsentError }) {
  if (stage === 2) return <><h3>Estimated campaign reach</h3>{values.platforms.some(page => page.url) ? <><h3>Your current content</h3>{values.platforms.map((page, index) => page.url && <PlatformContent key={`${page.name}-${index}`} page={page} index={index} setValues={setValues} />)}</> : <p className="policy-note">{t('You will add posting frequency and Insights screenshots for each social account in the next step, right after its link.')}</p>}{field('reachFormat', 'Content format', { as: 'select', options: ['Reel', 'Story', 'Post', 'Package'], required: true })}{field('reachQuantity', 'Quantity', { type: 'number', min: 1, required: true })}{field('expectedReach', 'Expected accounts reached', { as: 'select', options: ['20K', '30K', '40K', '50K', '100K', 'Custom'], required: true })}{values.expectedReach === 'Custom' && field('customReach', 'Custom accounts reached', { type: 'number', min: 1, required: true })}{field('reachBasis', 'Target applies to', { as: 'select', options: ['Each deliverable', 'Whole package'], required: true })}{field('reportingPeriod', 'How many days after publishing will you share insights? Hindi: पोस्ट करने के कितने दिन बाद आप इनसाइट्स शेयर करेंगे?', { as: 'select', options: ['7 days', '15 days', '30 days'], required: true })}<p className="policy-note">Example: Choose 7 days to share your reach and engagement screenshots 7 days after the post goes live.</p><p className="policy-note">Reach is an estimate based on past performance. Actual results may vary.</p></>;
  // Content details depend on the account links entered here, so they are completed on this step too
  // (the same fields are still shown and validated on the content step).
  if (stage === 3) return <><PlatformFields values={values} setValues={setValues} />{values.platforms.some(page => page.url) && <><h3>Your current content</h3><p className="policy-note">{t('Required for each account with a link. This saves a trip back to the previous step.')}</p>{values.platforms.map((page, index) => page.url && <PlatformContent key={`${page.name}-${index}`} page={page} index={index} setValues={setValues} />)}</>}<p className="policy-note">Manual links are self-reported until reviewed. Never provide a social password. Automatic follower verification is unavailable.</p></>;
  if (stage === 4) return <><section><h3>Identity verification</h3>{upload('aadhaar', 'Aadhaar verification', true)}<p className="policy-note">Private identity documents and bank information do not appear on your public profile. Entering details does not mark an account verified.</p></section><section><h3>Payout details</h3><BankFields values={values} setValues={setValues} field={field} /></section></>;
  return <InfluencerReview values={values} setValues={setValues} onEdit={onEdit} field={field} openLegal={openLegal} consentError={consentError} clearConsentError={clearConsentError} />;
}

function PlatformContent({ page, index, setValues }) {
  const update = (name, value) => setValues(current => ({ ...current, platforms: current.platforms.map((item, itemIndex) => itemIndex === index ? { ...item, [name]: value } : item) }));
  const contentUpload = change => update('insightScreenshots', typeof change === 'function' ? change(page.insightScreenshots || []) : change);
  return <section className="platform-fields"><h4>{page.name || 'Social account'} content</h4><div className="frequency-row"><Field label="Number of posts/reels" type="number" min="0" value={page.postingFrequency ?? ''} onChange={event => update('postingFrequency', event.target.value)} required /><Field label="Frequency period" as="select" options={['Per day', 'Per week', 'Per month']} value={page.frequencyPeriod || ''} onChange={event => update('frequencyPeriod', event.target.value)} required /></div><Field label={`${page.name || 'Account'} starting month/year`} type="month" value={page.pageStarted || ''} onChange={event => update('pageStarted', event.target.value)} /><label className="consent"><input type="checkbox" checked={Boolean(page.pageAgeApproximate)} onChange={event => update('pageAgeApproximate', event.target.checked)} /> This date is approximate</label><MediaUpload role="influencer" label="Previous 30 days' Insights screenshots" documents autoUpload value={page.insightScreenshots || []} onChange={contentUpload} /><small className="policy-note">Screenshots stay private to reviewers.</small></section>;
}

function InfluencerReview({ values, setValues, onEdit, field, openLegal, consentError, clearConsentError }) {
  const summary = (title, stage, body) => <section className="summary"><div className="summary-heading"><h3>{title}</h3><button type="button" className="link" onClick={() => onEdit(stage)}>Edit</button></div><p>{body}</p></section>;
  return <>{field('referralSource', 'How did you hear about us?', { as: 'select', options: ['', 'Instagram', 'WhatsApp', 'YouTube', 'Facebook', 'Google', 'Friend/Referral', 'Eazily Team', 'Poster/Event', 'Other'] })}{values.referralSource === 'Friend/Referral' && field('referralCode', 'Referral code (optional)')}{values.referralSource === 'Other' && field('referralOther', 'Please specify (optional)')}{summary('Profile and categories', 0, `${values.creatorName || ''} · ${values.name || ''} · ${values.dateOfBirth ? `Date of Birth: ${values.dateOfBirth}` : 'Date of Birth: Not provided'} · ${values.category || ''}${(values.relatedNiches || []).length ? ` · ${(values.relatedNiches || []).join(', ')}` : ''}`)}{summary('Location', 1, `${values.city || ''} · ${values.pinCode || ''}`)}{summary('Content and estimated reach', 2, `${values.reachFormat || ''} · ${values.reachQuantity || ''} · ${values.expectedReach === 'Custom' ? values.customReach : values.expectedReach || ''} · ${values.reportingPeriod || 'Reporting period pending'}`)}{summary('Social accounts', 3, (values.platforms || []).map(page => `${page.name}: ${page.url || 'Not added'} · ${page.band || 'Follower band pending'} · ${page.priceBand || 'Charge not selected'}${page.priceBand === 'Custom amount' && page.customPrice ? ` (₹${page.customPrice})` : ''} (self-reported)`).join(' | '))}{summary('Verification and payout status', 4, `Aadhaar: ${values.aadhaar?.length ? 'Submitted for review' : 'Not submitted'} · Bank: ${values.accountNumber ? 'Details entered, verification pending' : 'Not entered'}`)}<section className="summary"><p>Reach is an estimate based on past performance. Actual results may vary.</p><p>Paid collaborations only. These registration answers do not create a booking, campaign, guaranteed result, or payment obligation.</p><div className="legal-actions"><button type="button" className="link" onClick={() => openLegal('terms')}>Influencer Terms &amp; Conditions</button><button type="button" className="link" onClick={() => openLegal('privacy')}>Influencer Privacy Policy</button></div><small>Terms version {influencerTerms.version} · Privacy version {influencerPrivacy.version}</small></section><div className="consent legal-consent-line"><input id="influencer-terms-consent" name="influencerTermsAccepted" type="checkbox" required checked={Boolean(values.termsAccepted)} onChange={event => { clearConsentError(); setValues(current => ({ ...current, termsAccepted: event.target.checked, consentVersion: influencerTerms.version })); }} /><span><label htmlFor="influencer-terms-consent">I have read and agree to the Eazily </label><button type="button" className="link legal-inline-link" onClick={() => openLegal('terms')}>Influencer Terms &amp; Conditions</button>.</span></div>{consentError && <p className="inline-error" role="alert">{consentError}</p>}<label className="consent"><input type="checkbox" required checked={Boolean(values.informationAccurate)} onChange={event => { clearConsentError(); setValues(current => ({ ...current, informationAccurate: event.target.checked })); }} /> I confirm that the supplied information is accurate.</label><label className="consent"><input type="checkbox" checked={Boolean(values.promotionalConsent)} onChange={event => setValues(current => ({ ...current, promotionalConsent: event.target.checked }))} /> Send me promotional messages (optional).</label></>;
}

function PlatformFields({ values, setValues }) {
  const update = (index, name, value) => setValues(current => ({ ...current, platforms: current.platforms.map((item, itemIndex) => itemIndex === index ? { ...item, [name]: value } : item) }));
  return <>{values.platforms.map((page, index) => { const customInvalid = page.priceBand === 'Custom amount' && (!page.customPrice || Number(page.customPrice) <= 0); return <section className="platform-fields" key={index}><div className="summary-heading"><h3>Account {index + 1}</h3>{index > 0 && <button type="button" className="link" onClick={() => setValues(current => ({ ...current, platforms: current.platforms.filter((_, itemIndex) => itemIndex !== index) }))}>Remove</button>}</div><Field label="Platform" as="select" options={['Instagram', 'YouTube', 'Other']} value={page.name} onChange={event => update(index, 'name', event.target.value)} /><Field label="Handle or profile link" value={page.url} onChange={event => update(index, 'url', event.target.value)} required /><Field label="Follower band" as="select" options={followerBands} value={page.band} onChange={event => update(index, 'band', event.target.value)} required /><Field label="Approximate collaboration charge / आप लगभग कितना चार्ज करते हैं?" as="select" options={['', ...priceBands]} value={page.priceBand || ''} onChange={event => update(index, 'priceBand', event.target.value)} required /><p className="policy-note">Select your usual charge for one collaboration on this account. You can set the exact price when creating a post.</p>{page.priceBand === 'Custom amount' && <><Field label="Your approximate charge (₹)" type="number" min="0.01" step="0.01" inputMode="decimal" value={page.customPrice || ''} aria-invalid={customInvalid} onChange={event => update(index, 'customPrice', event.target.value)} required />{customInvalid && <p className="inline-error" role="alert">Enter a positive custom amount.</p>}</>}</section>; })}<button type="button" className="btn btn-outline" onClick={() => setValues(current => ({ ...current, platforms: [...current.platforms, { name: 'Instagram', url: '', band: '' }] }))}>+ Add another account</button></>;
}

function ConsultantStep({ stage, values, setValues, field, upload, application, notify, onSkipAssessment }) {
  if (stage === 1) return <>{field('qualificationName', 'Qualification name', { required: true })}{field('institution', 'Institution or issuing body', { required: true })}{field('completionYear', 'Completion year', { type: 'number', min: 1950, max: new Date().getFullYear(), required: true })}{upload('qualifications', 'Degree documents and certificates', true)}{['Legal Consultancy', 'Health Consultancy', 'CA Consultancy'].includes(displayConsultantCategory(values.category)) && field('professionalLicense', 'Professional registration or licence', { required: true })}</>;
  if (stage === 2) return <>{field('workStatus', 'Current work status', { as: 'select', options: ['Employed', 'Self-employed', 'Freelance', 'Not currently working'], required: true })}{field('currentRole', 'Current role or job title', { required: true })}{values.workStatus === 'Employed' && field('organisation', 'Employer or organisation')}{field('experience', 'Relevant experience', { as: 'select', options: ['Less than 1 year', '1–3 years', '3–5 years', '5–10 years', '10+ years'], required: true })}</>;
  if (stage === 3) return <>{field('name', 'Full name', { required: true })}{field('email', 'Email address', { type: 'email', required: true })}{upload('aadhaar', 'Aadhaar verification', true)}{upload('pan', 'PAN card', true)}<details><summary>Additional ID — Optional</summary>{upload('additionalId', 'Voter ID or Passport', true)}</details><BankFields values={values} setValues={setValues} field={field} /></>;
  if (stage === 4) return <ConsultantAssessment application={application} values={values} setValues={setValues} notify={notify} onSkip={onSkipAssessment} />;
  return <ReviewTerms role="consultant" values={values} field={field} />;
}

function BankFields({ values = {}, setValues, field }) {
  const bank = useLookup(lookupIfsc, /^[A-Z]{4}0[A-Z0-9]{6}$/.test(values.ifsc || '') ? values.ifsc : '');
  const ifscProps = setValues ? { maxLength: 11, autoCapitalize: 'characters', onChange: event => setValues(current => ({ ...current, ifsc: event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })) } : {};
  return <>{field('accountHolder', 'Account holder name', { required: true })}{setValues && values.name && values.accountHolder !== values.name && <button type="button" className="link registration-inline-action" onClick={() => setValues(current => ({ ...current, accountHolder: current.name }))}>{t('Use my name')}: {values.name}</button>}{field('accountNumber', 'Bank account number', { inputMode: 'numeric', required: true })}{field('accountConfirmation', 'Confirm bank account number', { inputMode: 'numeric', required: true })}{field('ifsc', 'IFSC', { required: true, ...ifscProps })}<LookupHint state={bank} idle="" found={result => `${result.bank}${result.branch ? ` · ${result.branch} branch` : ''}${result.city ? `, ${result.city}` : ''}`} notFound="IFSC not found. Check the code with your bank passbook or cheque." /><p className="policy-note">Bank verification remains pending until the configured payment process confirms it. Never share a bank PIN or OTP.</p></>;
}

function ReviewTerms({ role, values, field }) {
  const terms = role === 'professional' ? 'Arrive sober, avoid tobacco at customer premises, maintain hygiene and respect, clean the work area, disclose charges, and use official Eazily payments.' : role === 'influencer' ? 'Paid collaborations only. Report truthful statistics and complete agreed deliverables. The client prepays; the configured provider handles the 70/30 payout schedule and disputes.' : 'Work within approved expertise, protect confidentiality, keep credentials accurate, and use official Eazily payments. Rates are set by Eazily and the free introduction never converts automatically.';
  return <>{field('referralSource', 'How did you hear about us?', { as: 'select', options: ['', 'Instagram', 'WhatsApp', 'YouTube', 'Facebook', 'Google', 'Friend/Referral', 'Eazily Team', 'Poster/Event', 'Other'] })}{values.referralSource === 'Friend/Referral' && field('referralCode', 'Referral code (optional)')}{values.referralSource === 'Other' && field('referralOther', 'Please specify (optional)')}<section className="summary"><h3>Editable summary</h3><p>{values.name || values.creatorName} · {role === 'consultant' ? displayConsultantCategory(values.category) : values.category} · {values.city}</p><p>{terms}</p>{role !== 'consultant' && <><a href="/terms" target="_blank" rel="noreferrer">Terms and Conditions</a> · <a href="/privacy" target="_blank" rel="noreferrer">Privacy Notice</a></>}</section>{role !== 'consultant' && <label className="consent"><input type="checkbox" checked={Boolean(values.termsAccepted)} onChange={event => fieldChange(event, 'termsAccepted')} /> I accept the role-specific terms.</label>}<label className="consent"><input type="checkbox" checked={Boolean(values.informationAccurate)} onChange={event => fieldChange(event, 'informationAccurate')} /> I confirm that the supplied information is accurate.</label><label className="consent"><input type="checkbox" checked={Boolean(values.promotionalConsent)} onChange={event => fieldChange(event, 'promotionalConsent')} /> Send me promotional messages (optional).</label></>;
  function fieldChange(event, key) { field(key, key) .props.onChange(event); }
}

function validateStep(role, stage, values) {
  if (stage === 0) return role === 'influencer' ? values.creatorName && values.name && values.email && values.category && (!values.dateOfBirth || values.dateOfBirth <= today) : Boolean(values.category && values.city && values.pinCode && (role !== 'professional' || values.services?.length) && (role !== 'consultant' || (values.specialisation && (values.consultationFields || []).every(item => item.specialisation))));
  if (stage === 5) return Boolean(values.informationAccurate && (role === 'consultant' || values.termsAccepted));
  if (role === 'influencer' && stage === 1) return Boolean(values.city && values.pinCode);
  if (role === 'professional') return stage === 1 ? values.name && values.shopOwnership && values.address : stage === 2 ? values.experience && values.workStyle : stage === 3 ? Boolean(values.aadhaar?.length && values.pan?.length && (values.gumasta?.length || values.gumastaHelp || values.shopOwnership === 'No fixed shop')) : values.accountHolder && values.accountNumber && values.accountNumber === values.accountConfirmation && values.ifsc;
  if (role === 'influencer') {
    if (stage === 2) {
      const configuredAccounts = (values.platforms || []).filter(item => item.url);
      return values.expectedReach && values.reachFormat && values.reachQuantity && values.reportingPeriod && configuredAccounts.every(item => item.postingFrequency && item.frequencyPeriod && item.insightScreenshots?.length);
    }
    if (stage === 3) return values.platforms?.length && values.platforms.every(item => item.url && item.band && item.priceBand && (item.priceBand !== 'Custom amount' || Number(item.customPrice) > 0));
    return stage === 4 ? values.aadhaar?.length && values.accountHolder && values.accountNumber && values.accountNumber === values.accountConfirmation && values.ifsc : false;
  }
  if (stage < 4) return stage === 1 ? values.qualificationName && values.institution && values.qualifications?.length && (!['Legal Consultancy', 'Health Consultancy', 'CA Consultancy'].includes(displayConsultantCategory(values.category)) || values.professionalLicense) : stage === 2 ? values.workStatus && values.currentRole && values.experience : values.name && values.email && values.aadhaar?.length && values.pan?.length && values.accountHolder && values.accountNumber && values.accountNumber === values.accountConfirmation && values.ifsc;
  if (CONSULTANT_ASSESSMENT_TEST_SKIP_ENABLED && !isSupabaseConfigured && values.assessmentStatus === 'skipped_for_testing') return true;
  const assessmentFields = values.consultationFields?.length ? values.consultationFields : [{ category: values.category, specialisation: values.specialisation }];
  return assessmentFields.length === 1 ? values.assessmentStatus === 'passed' : assessmentFields.every(item => values.assessmentResults?.[`${String(item.category).trim().toLowerCase()}::${String(item.specialisation).trim().toLowerCase()}`]?.status === 'passed');
}
