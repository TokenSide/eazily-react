import { useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { Field } from '../../components/Ui.jsx';
import { canonicalCatalogService, catalog } from '../../data/catalog.js';
import { supabase } from '../../lib/supabase.js';
import { saveServicePartnerPost } from '../../services/partners.js';
import ServiceIllustration from '../user-art/ServiceIllustration.jsx';
import MediaPreview from './MediaPreview.jsx';
import MediaUpload from './MediaUpload.jsx';
import './service-posting.css';

const PRICING = ['Fixed Price', 'Starting Price', 'Inspection-Based Quote'];
const travelsToCustomer = place => ['At the customer’s location', 'Both'].includes(place);
const money = value => value === '' || value == null ? '—' : `₹${Number(value).toLocaleString('en-IN')}`;

function registeredServices(profile) {
  const groups = catalog.find(item => item.id === 'manpower').groups;
  const current = item => {
    const serviceName = canonicalCatalogService(item.serviceName || item.serviceId);
    const group = groups.find(entry => entry.items.includes(serviceName));
    return group ? { categoryId: group.id, categoryLabel: group.label, serviceId: serviceName, serviceName } : { ...item, serviceId: item.serviceId || serviceName, serviceName };
  };
  if (Array.isArray(profile.serviceSelections) && profile.serviceSelections.length) {
    return profile.serviceSelections.map(item => current({
      categoryId: item.categoryId,
      categoryLabel: item.categoryLabel,
      serviceId: item.serviceId,
      serviceName: item.serviceName,
    }));
  }
  return (profile.services || []).map(service => current({ categoryId: profile.category || '', categoryLabel: profile.category || '', serviceId: service, serviceName: service }));
}

function startingValues(post, profile, cached) {
  const source = post?.details || cached || {};
  const selected = registeredServices(profile).find(item => item.serviceId === source.serviceId && item.categoryId === source.categoryId)
    || registeredServices(profile).find(item => item.serviceName === source.service)
    || null;
  return {
    service: selected,
    title: source.title || selected?.serviceName || '',
    description: source.description || '',
    pricingType: PRICING.includes(source.pricingType) ? source.pricingType : 'Fixed Price',
    serviceCharge: source.serviceCharge ?? '',
    visitingCharge: travelsToCustomer(profile.servicePlace) ? (source.visitingCharge ?? '0') : '0',
    visitTreatment: source.visitTreatment === 'Included' ? 'Included' : 'Additional',
    primaryMedia: source.media?.slice(0, 1) || [],
    additionalMedia: source.media?.slice(1) || [],
  };
}

export default function ServicePostForm({ post, application, accountId, notify, onDone }) {
  const profile = application?.details || {};
  const idRef = useRef(post?.id || crypto.randomUUID());
  const lock = useRef(false);
  const storageKey = `eazily-service-post-draft:${accountId}:${post?.id || 'new'}`;
  let cached;
  try { cached = JSON.parse(sessionStorage.getItem(storageKey)); } catch { /* In-memory editing remains available. */ }
  const [values, setValues] = useState(() => startingValues(post, profile, cached));
  const [step, setStep] = useState(() => Math.min(3, Math.max(1, Number(cached?.savedStep || 1))));
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [success, setSuccess] = useState(null);
  const services = registeredServices(profile);
  const canVisit = travelsToCustomer(profile.servicePlace);

  function update(change) {
    setValues(current => {
      const next = typeof change === 'function' ? change(current) : change;
      try { sessionStorage.setItem(storageKey, JSON.stringify({ ...next, savedStep: step })); } catch { /* Keep the draft in state. */ }
      return next;
    });
  }

  function validate(targetStep = step) {
    const next = {};
    if (targetStep === 1) {
      if (!values.service) next.service = 'Apni registered service chunein / Choose a registered service.';
      if (values.title.trim().length < 3) next.title = 'Service title mein kam se kam 3 letters likhein.';
    }
    if (targetStep === 2) {
      const amount = Number(values.serviceCharge);
      if (values.serviceCharge === '' || !Number.isFinite(amount) || amount < 0 || (values.pricingType !== 'Inspection-Based Quote' && amount <= 0)) next.serviceCharge = values.pricingType === 'Inspection-Based Quote' ? 'Enter a valid amount (0 or more).' : 'Enter a service charge greater than ₹0.';
      const visit = Number(values.visitingCharge);
      if (canVisit && (values.visitingCharge === '' || !Number.isFinite(visit) || visit < 0)) next.visitingCharge = 'Visiting charge must be ₹0 or more.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function go(nextStep) {
    if (nextStep > step && !validate(step)) return;
    setStep(nextStep);
    try { sessionStorage.setItem(storageKey, JSON.stringify({ ...values, savedStep: nextStep })); } catch { /* Continue without browser cache. */ }
    document.querySelector('.partner-post-sheet')?.scrollTo?.({ top: 0, behavior: 'smooth' });
  }

  function payload() {
    const selected = values.service;
    return {
      postType: 'offering',
      categoryId: selected?.categoryId || '',
      category: selected?.categoryLabel || '',
      serviceId: selected?.serviceId || '',
      service: selected?.serviceName || '',
      title: values.title.trim(),
      description: values.description.trim(),
      pricingType: values.pricingType,
      serviceCharge: String(values.serviceCharge),
      visitingCharge: canVisit ? String(values.visitingCharge || 0) : '0',
      visitTreatment: canVisit ? values.visitTreatment : 'Additional',
      media: [...values.primaryMedia, ...values.additionalMedia].slice(0, 10),
    };
  }

  async function action(actionName) {
    if (lock.current) return;
    if (actionName === 'submit' && (!validate(1) || !validate(2))) { setStep(!values.service || values.title.trim().length < 3 ? 1 : 2); return; }
    lock.current = true;
    setBusy(true);
    try {
      const details = payload();
      let result;
      if (supabase) result = await saveServicePartnerPost(details, actionName, idRef.current);
      else {
        result = { id: idRef.current, partner_id: application.id, role: 'professional', details, status: 'draft', testing: true, updated_at: new Date().toISOString() };
        const key = `eazily-posts:${accountId}:professional`;
        const rows = JSON.parse(sessionStorage.getItem(key) || '[]');
        sessionStorage.setItem(key, JSON.stringify([...rows.filter(item => item.id !== result.id), result]));
      }
      sessionStorage.removeItem(storageKey);
      if (actionName === 'draft') {
        notify(supabase ? 'Draft saved' : 'Testing draft saved. It is not publicly published.');
        onDone(result);
        return;
      }
      const message = result.review_notes?.startsWith('Updated version awaiting Admin review')
        ? 'Badla hua version review mein hai. Pehle se approved post live rahegi.'
        : result.status === 'published'
        ? 'Aapki service post ho gayi!'
        : result.status === 'pending_review'
          ? 'Service review ke liye bhej di gayi. Approval ke baad live hogi.'
          : 'Service save ho gayi. Verification approve hone ke baad live ho sakegi.';
      setSuccess({ result, message });
      notify(message);
    } catch (error) {
      notify(error.message);
      setErrors(current => ({ ...current, submit: error.message }));
    } finally { lock.current = false; setBusy(false); }
  }

  if (success) return <section className="service-post-flow service-post-success" role="status">
    <span className="service-success-icon"><Icon name="check" size={28} /></span>
    <h2>{success.message}</h2>
    <p>{success.result.status === 'draft' ? 'Yeh draft sirf aapke Service Partner workspace mein hai.' : 'Aap My Services mein iska status dekh sakte hain.'}</p>
    <button type="button" className="btn btn-primary full" onClick={() => onDone(success.result)}>My Services dekhein</button>
    <button type="button" className="btn btn-outline full" onClick={() => { sessionStorage.removeItem(storageKey); onDone(success.result, { addAnother: true }); }}>Ek aur service jodein</button>
  </section>;

  return <form className="service-post-flow" onSubmit={event => { event.preventDefault(); action('submit'); }}>
    <header className="service-post-heading"><div><span>Step {step} of 3</span><h2>{['Kaunsa kaam?', 'Aapki fees.', 'Photo aur post.'][step - 1]}</h2></div><button type="button" className="link" disabled={busy} onClick={() => action('draft')}>Save Draft</button></header>
    <div className="service-post-progress" aria-label={`Step ${step} of 3`}><i style={{ width: `${step / 3 * 100}%` }} /></div>
    {step === 1 && <ServiceStep values={values} update={update} services={services} search={search} setSearch={setSearch} errors={errors} onEditProfile={() => onDone(null, { editProfile: true })} />}
    {step === 2 && <FeesStep values={values} update={update} canVisit={canVisit} servicePlace={profile.servicePlace} errors={errors} />}
    {step === 3 && <PhotoStep values={values} update={update} profile={profile} canVisit={canVisit} onEdit={go} errors={errors} />}
    {errors.submit && <p className="inline-error" role="alert">{errors.submit}</p>}
    <footer className="service-post-actions">
      {step > 1 && <button type="button" className="btn btn-outline" disabled={busy} onClick={() => go(step - 1)}>Peeche / Back</button>}
      {step < 3 ? <button type="button" className="btn btn-primary" onClick={() => go(step + 1)}>Aage / Continue</button> : <button className="btn btn-primary" disabled={busy}>{busy ? 'Posting…' : 'Post Karein / Publish Service'}</button>}
    </footer>
  </form>;
}

function ServiceStep({ values, update, services, search, setSearch, errors, onEditProfile }) {
  const visible = services.filter(item => `${item.serviceName} ${item.categoryLabel}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="service-post-step"><p className="service-step-intro">Registration mein chuni hui service select karein. Har post mein ek service hogi.</p><Field label="Search your services" value={search} placeholder="Electrician, AC Service…" onChange={event => setSearch(event.target.value)} />
    <div className="registered-service-options">{visible.map(item => <button type="button" key={`${item.categoryId}-${item.serviceId}`} className={values.service?.categoryId === item.categoryId && values.service?.serviceId === item.serviceId ? 'selected' : ''} aria-pressed={values.service?.categoryId === item.categoryId && values.service?.serviceId === item.serviceId} onClick={() => update(current => ({ ...current, service: item, title: !current.service || current.title === current.service.serviceName ? item.serviceName : current.title }))}><ServiceIllustration name={item.serviceName} /><span><b>{item.serviceName}</b><small>{item.categoryLabel}</small></span><Icon name={values.service?.serviceId === item.serviceId && values.service?.categoryId === item.categoryId ? 'check' : 'plus'} size={18} /></button>)}</div>
    {!visible.length && <p className="service-empty">No matching registered services.</p>}{errors.service && <p className="inline-error" role="alert">{errors.service}</p>}
    <button type="button" className="service-profile-link link" onClick={onEditProfile}>Offer something else? Update registered services</button>
    <div><Field label="Service title" value={values.title} maxLength={120} required onChange={event => update(current => ({ ...current, title: event.target.value }))} />{errors.title && <p className="inline-error" role="alert">{errors.title}</p>}</div>
    <Field label="Is service mein kya kaam karenge? — Optional" as="textarea" maxLength={500} placeholder="Ceiling fan fitting aur connection checking." value={values.description} onChange={event => update(current => ({ ...current, description: event.target.value }))} />
  </section>;
}

function FeesStep({ values, update, canVisit, servicePlace, errors }) {
  return <section className="service-post-step"><div><Field label="Service charge — ₹" type="number" inputMode="decimal" min="0" step="0.01" required value={values.serviceCharge} onChange={event => update(current => ({ ...current, serviceCharge: event.target.value }))} /><small className="field-help">Is kaam ke liye aapki fees.</small>{errors.serviceCharge && <p className="inline-error" role="alert">{errors.serviceCharge}</p>}</div>
    {canVisit && <><div><Field label="Visiting charge — ₹" type="number" inputMode="decimal" min="0" step="0.01" value={values.visitingCharge} onChange={event => update(current => ({ ...current, visitingCharge: event.target.value }))} /><small className="field-help">Customer ke yahan aane ki fees. ₹0 means no visiting charge.</small>{errors.visitingCharge && <p className="inline-error" role="alert">{errors.visitingCharge}</p>}</div><label className="field-wrap"><span>Visiting charge treatment</span><select className="field" value={values.visitTreatment} onChange={event => update(current => ({ ...current, visitTreatment: event.target.value }))}><option>Additional</option><option>Included</option></select></label><p className="service-price-note">{values.visitTreatment === 'Additional' ? 'Customer-location booking mein visiting charge service fee ke alag lagta hai.' : 'Visiting charge aapki service fee mein included hai; alag se nahi judta.'}</p></>}
    {!canVisit && <p className="service-price-note"><b>At-shop service:</b> Visiting charge apply nahi hoga.</p>}
    <details className="service-pricing-options"><summary>Other pricing options</summary><label className="field-wrap"><span>Pricing type</span><select className="field" value={values.pricingType} onChange={event => update(current => ({ ...current, pricingType: event.target.value }))}>{PRICING.map(item => <option key={item}>{item}</option>)}</select></label></details>
    <section className="service-own-summary"><span>Your charges</span><p><b>Service</b><strong>{money(values.serviceCharge)}</strong></p>{canVisit && <p><b>Visiting ({values.visitTreatment})</b><strong>{money(values.visitingCharge || 0)}</strong></p>}<small>{servicePlace || 'Registered service location'} · Customer pricing is calculated separately by Eazily.</small></section>
  </section>;
}

function PhotoStep({ values, update, profile, canVisit, onEdit, errors }) {
  const media = [...values.primaryMedia, ...values.additionalMedia];
  return <section className="service-post-step"><p className="service-step-intro">Apne asli kaam ki photo add karein. Photo optional hai.</p>
    <MediaUpload role="professional" label="Photo Add Karein" photosOnly single maxSizeMb={50} value={values.primaryMedia} onChange={change => update(current => ({ ...current, primaryMedia: typeof change === 'function' ? change(current.primaryMedia) : change }))} />
    <details className="service-more-media"><summary>Add more photos or video.</summary><MediaUpload role="professional" label="More work media" maxSizeMb={50} value={values.additionalMedia} onChange={change => update(current => ({ ...current, additionalMedia: typeof change === 'function' ? change(current.additionalMedia) : change }))} /></details>
    <section className="service-partner-preview"><span className="eyebrow">Aapki Service · Partner preview</span><div className="service-preview-cover">{media.length ? <MediaPreview media={media.slice(0, 1)} /> : <><ServiceIllustration name={values.service?.serviceName || values.service?.categoryLabel} /><small>Service illustration — add your own work photo anytime.</small></>}</div><h3>{values.title || 'Service title'}</h3>{values.description && <p>{values.description}</p>}<p className="service-preview-price"><b>{money(values.serviceCharge)}</b> service charge</p>{canVisit && <p>{money(values.visitingCharge || 0)} visiting charge · {values.visitTreatment}</p>}<p>{profile.businessName || profile.name || 'Service Partner'} · {profile.serviceAreas || profile.locality || profile.city || 'Registered area'}</p><div className="service-preview-edits"><button type="button" className="link" onClick={() => onEdit(1)}>Edit service</button><button type="button" className="link" onClick={() => onEdit(2)}>Edit fees</button></div></section>
    {errors.submit && <p className="inline-error" role="alert">{errors.submit}</p>}
  </section>;
}
