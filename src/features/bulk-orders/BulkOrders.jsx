import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { BULK_PRICING_IS_DEMO, bulkServices, bulkSummary, priceFor } from './bulkPricing.js';
import { requireBackend } from '../../services/experience.js';
import './bulk-orders.css';

const places = ['Office', 'Society', 'Shop', 'Hotel', 'School / Institute', 'Commercial Property', 'Other'];
const callbackTimes = ['ASAP', 'Morning', 'Afternoon', 'Evening'];
const visitTimes = ['Morning', 'Afternoon', 'Evening', 'Flexible'];
const money = value => `₹${Number(value || 0).toLocaleString('en-IN')}`;
const readSession = (key, fallback) => { try { return JSON.parse(sessionStorage.getItem(key)) ?? fallback; } catch { return fallback; } };

function ServiceCard({ service, quantity, onChange }) {
  const selected = quantity > 0;
  const pricing = priceFor(service, quantity || 1);
  const remaining = pricing.nextTier ? pricing.nextTier.minimum - pricing.quantity : 0;
  const lower = pricing.tier === 'standard' ? 1 : Number(pricing.tier.split('-')[1]);
  const progress = pricing.nextTier ? Math.min(100, Math.max(0, ((pricing.quantity - lower) / (pricing.nextTier.minimum - lower)) * 100)) : 100;
  return <article className={`bulk-service-card${selected ? ' selected' : ''}`}>
    <div className="bulk-service-heading"><div><h3>{service.name}</h3><p>{service.description}</p></div>{!selected && <button type="button" className="bulk-add" onClick={() => onChange(1)}>Add</button>}</div>
    {selected && <>
      <div className="bulk-quantity-row"><button type="button" aria-label={`Decrease ${service.name}`} disabled={quantity <= 1} onClick={() => onChange(Math.max(1, quantity - 1))}>−</button><div><strong>{quantity}</strong><span>{quantity === 1 ? service.unit : service.units}</span></div><button type="button" aria-label={`Increase ${service.name}`} onClick={() => onChange(quantity + 1)}>+</button></div>
      {pricing.customQuote ? <div className="bulk-rate custom" key={`${service.id}-custom`}><small>Custom quote required</small><strong>Price available on request</strong><span>Large requirement detected.</span></div> : <div className="bulk-rate" key={`${service.id}-${pricing.tier}`}><span>Demo standard rate {money(service.standardRate)}/{service.unit.toLowerCase()}</span><small>Demo estimate</small><strong>{money(pricing.rate)} <em>/ {service.unit.toLowerCase()}</em></strong></div>}
      {pricing.nextTier && <div className="bulk-next-tier"><div className="bulk-progress"><span style={{ width: `${progress}%` }} /></div>{pricing.nextTier.rate ? <p><b>{pricing.quantity} / {pricing.nextTier.minimum}</b> · Add {remaining} more {service.nextUnit} to preview the next demo tier</p> : <p><b>{pricing.quantity} / {pricing.nextTier.minimum}</b> · Add {remaining} more for a custom quote</p>}</div>}
      <button type="button" className="bulk-remove" onClick={() => onChange(0)}>Remove service</button>
    </>}
  </article>;
}

function Estimate({ summary }) {
  if (!summary.lines.length) return null;
  return <section className="bulk-estimate"><span className="bulk-kicker">DEMO ESTIMATE · FINAL QUOTE PENDING</span>{summary.lines.length > 1 && <div className="bulk-lines">{summary.lines.map(line => <div key={line.service.id}><span>{line.service.name}<small>{line.quantity} × {line.customQuote ? 'Custom quote' : money(line.rate)}</small></span><b>{line.customQuote ? 'On request' : money(line.total)}</b></div>)}</div>}{summary.needsQuote ? <><h2>Custom quote required</h2><p>One or more large requirements need a customised price.</p></> : <h2>{money(summary.total)}</h2>}<p>{summary.items} {summary.items === 1 ? 'service item' : 'service items'} · Indicative only; no price is approved.</p></section>;
}

function CallbackModal({ profile, onClose, onSuccess }) {
  const [form, setForm] = useState({ name: profile?.full_name || '', mobile: profile?.phone || '', time: 'ASAP', note: '' });
  const [error, setError] = useState('');
  function submit(event) { event.preventDefault(); if (!form.mobile.trim()) { setError('Enter a mobile number for the callback.'); return; } onSuccess(form); }
  return <div className="bulk-modal-overlay" onMouseDown={event => event.target === event.currentTarget && onClose()}><section className="bulk-callback" role="dialog" aria-modal="true" aria-labelledby="callback-title"><button type="button" className="bulk-modal-close" onClick={onClose} aria-label="Close"><Icon name="close" /></button><div className="bulk-handle" /><h2 id="callback-title">Request a Callback</h2><p>Tell us when you’d like our bulk-order team to contact you.</p><form onSubmit={submit}>
    <label>Name<input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label><label>Mobile Number<input inputMode="tel" value={form.mobile} readOnly={Boolean(profile?.phone)} onChange={event => setForm({ ...form, mobile: event.target.value })} /></label>
    <fieldset><legend>Preferred callback time</legend><div className="bulk-chip-grid compact">{callbackTimes.map(time => <button type="button" className={form.time === time ? 'active' : ''} key={time} onClick={() => setForm({ ...form, time })}>{time}</button>)}</div></fieldset>
    <label>Anything we should know? <span>(optional)</span><textarea maxLength={300} value={form.note} onChange={event => setForm({ ...form, note: event.target.value })} /></label>{error && <p className="bulk-error" role="alert">{error}</p>}<button className="btn btn-primary full">Request Callback</button>
  </form></section></div>;
}

export default function BulkOrders({ profile, accountId, onBack }) {
  const draftKey = `eazily-bulk-demo-draft:${accountId || 'guest'}`;
  const saved = readSession(draftKey, {});
  const [step, setStep] = useState('order');
  const [place, setPlace] = useState(saved.place || '');
  const [quantities, setQuantities] = useState(saved.quantities || {});
  const [details, setDetails] = useState(saved.details || { address: '', date: '', time: 'Flexible', company: '' });
  const [error, setError] = useState('');
  const [callbackOpen, setCallbackOpen] = useState(false);
  const [callbackDone, setCallbackDone] = useState(false);
  const [request, setRequest] = useState(null);
  const [requestKey, setRequestKey] = useState(() => saved.requestKey || crypto.randomUUID());
  const [requests, setRequests] = useState([]);
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const submitInFlight = useRef(false);
  const summary = useMemo(() => bulkSummary(quantities), [quantities]);

  useEffect(() => { sessionStorage.setItem(draftKey, JSON.stringify({ place, quantities, details, requestKey })); }, [details, draftKey, place, quantities, requestKey]);
  useEffect(() => {
    setRequests([]);
    if (!accountId) { setHistoryError('Sign in to view and submit bulk quote requests.'); return; }
    let active = true;
    setHistoryLoading(true);
    try {
      requireBackend().from('bulk_quote_requests').select('id,customer_type,services,status,created_at')
        .eq('customer_id', accountId).order('created_at', { ascending: false }).limit(20)
        .then(({ data, error: loadError }) => {
          if (!active) return;
          if (loadError) throw loadError;
          setRequests(data || []);
          setHistoryError('');
        }).catch(loadError => { if (active) setHistoryError(loadError.message || 'Could not load bulk requests.'); })
        .finally(() => { if (active) setHistoryLoading(false); });
    } catch (loadError) { setHistoryError(loadError.message); setHistoryLoading(false); }
    return () => { active = false; };
  }, [accountId, historyRevision]);
  function goDetails() {
    if (!place) { setError('Select where the service is required.'); return; }
    if (!summary.lines.length) { setError('Add at least one service.'); return; }
    setError('');
    setStep('details'); window.scrollTo(0, 0);
  }
  function review(event) { event.preventDefault(); if (!details.address.trim() || !details.date) { setError('Enter the service address and preferred date.'); return; } setError(''); setStep('review'); window.scrollTo(0, 0); }
  async function submit() {
    if (submitInFlight.current) return;
    submitInFlight.current = true;
    setSubmitting(true);
    setError('');
    try {
      if (!accountId) throw new Error('Sign in to submit a bulk quote request. Your form is saved on this device.');
      const { data, error: submitError } = await requireBackend().rpc('submit_bulk_quote_request', {
        p_idempotency_key: requestKey,
        p_customer_type: place,
        p_services: summary.lines.map(line => ({ service_id: line.service.id, quantity: line.quantity })),
        p_address: details.address,
        p_preferred_date: details.date,
        p_preferred_time: details.time,
        p_company_name: details.company || null,
      });
      if (submitError) throw submitError;
      if (!data) throw new Error('No request ID was returned. Please retry with the saved form.');
      setRequest({ id: data, items: summary.items });
      setHistoryRevision(revision => revision + 1);
      sessionStorage.removeItem(draftKey);
      setPlace(''); setQuantities({}); setDetails({ address: '', date: '', time: 'Flexible', company: '' });
      setRequestKey(crypto.randomUUID());
      setStep('success'); window.scrollTo(0, 0);
    } catch (submitError) {
      setError(submitError.message || 'Request was not submitted. Please retry.');
    } finally {
      submitInFlight.current = false;
      setSubmitting(false);
    }
  }
  function back() { if (step === 'success') setStep('order'); else if (step === 'review') setStep('details'); else if (step === 'details') setStep('order'); else onBack(); }

  return <main className="screen bulk-orders"><header className="bulk-header"><button type="button" onClick={back} aria-label="Back"><Icon name="arrowLeft" /></button><div><h1>Bulk Orders</h1>{step === 'order' && <p>Request a bulk quote.</p>}</div></header>
    {step === 'order' && <><section className="bulk-intro"><h2>Tell us what you need and see your bulk estimate instantly.</h2>{BULK_PRICING_IS_DEMO && <p className="bulk-demo-note">Rates shown are demo estimates only. Submitting sends a real quote request when signed in; no payment or final price is created.</p>}</section>
      {historyLoading && <p role="status">Loading your bulk requests…</p>}{historyError && <p className="bulk-error" role="alert">{historyError}</p>}
      {requests.length > 0 && <section className="bulk-history"><span className="bulk-kicker">MY BULK REQUESTS</span>{requests.map(item => <article key={item.id}><div><b>{item.id}</b><p>{item.services.map(line => `${bulkServices.find(service => service.id === line.service_id)?.name || line.service_id} × ${line.quantity}`).join(' · ')}</p></div><span>Quote {item.status}</span></article>)}</section>}
      <section className="bulk-section"><h2>Where do you need the services?</h2><div className="bulk-chip-grid">{places.map(item => <button type="button" className={place === item ? 'active' : ''} key={item} onClick={() => { setPlace(item); setError(''); }}>{item}</button>)}</div></section>
      <section className="bulk-section"><h2>Choose bulk services</h2><div className="bulk-service-list">{bulkServices.map(service => <ServiceCard key={service.id} service={service} quantity={Number(quantities[service.id] || 0)} onChange={quantity => { setQuantities(current => ({ ...current, [service.id]: quantity })); setError(''); }} />)}</div></section>
      <Estimate summary={summary} /><section className="bulk-help"><h2>Need help with a larger requirement?</h2><p>Our team can help with larger quantities or custom requirements.</p><button type="button" className="btn btn-outline full" onClick={() => setCallbackOpen(true)}>Request a Callback</button></section>{error && <p className="bulk-error page" role="alert">{error}</p>}
      {summary.lines.length > 0 && <aside className="bulk-sticky"><div><b>{summary.items} Services</b><strong>{summary.needsQuote ? 'Custom quote' : money(summary.total)}</strong><small>Demo estimate only</small></div><button type="button" className="btn btn-primary" onClick={goDetails}>Continue</button></aside>}
    </>}
    {step === 'details' && <section className="bulk-page-card"><span className="bulk-kicker">LOCATION & DATE</span><h2>Where should we provide the service?</h2><form onSubmit={review}><label>Service Address<textarea value={details.address} onChange={event => setDetails({ ...details, address: event.target.value })} required /></label><label>Preferred Date<input type="date" min={new Date().toISOString().slice(0, 10)} value={details.date} onChange={event => setDetails({ ...details, date: event.target.value })} required /></label><fieldset><legend>Preferred Time <span>(optional)</span></legend><div className="bulk-chip-grid compact">{visitTimes.map(time => <button type="button" className={details.time === time ? 'active' : ''} key={time} onClick={() => setDetails({ ...details, time })}>{time}</button>)}</div></fieldset><label>Company / Society Name <span>(optional)</span><input placeholder="ABC Technologies Pvt Ltd" value={details.company} onChange={event => setDetails({ ...details, company: event.target.value })} /></label>{profile && <div className="bulk-account"><b>Customer details</b><p>{profile.full_name || 'Name not provided'} · {profile.phone || 'Mobile not provided'}{profile.email ? ` · ${profile.email}` : ''}</p></div>}{error && <p className="bulk-error" role="alert">{error}</p>}<button className="btn btn-primary full">Review Bulk Request</button></form></section>}
    {step === 'review' && <section className="bulk-page-card bulk-review"><span className="bulk-kicker">BULK QUOTE REQUEST</span><h2>{place}</h2>{details.company && <p>{details.company}</p>}<div className="bulk-review-lines">{summary.lines.map(line => <article key={line.service.id}><span><b>{line.service.name}</b><small>{line.quantity} {line.quantity === 1 ? line.service.unit : line.service.units}</small></span><strong>{line.customQuote ? 'On request' : money(line.total)}</strong></article>)}</div><div className="bulk-review-detail"><span>Service Location<b>{details.address}</b></span><span>Preferred Date<b>{new Date(`${details.date}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} · {details.time}</b></span></div><div className="bulk-review-total"><span>Demo estimate · not an approved price</span><strong>{summary.needsQuote ? 'Custom quote required' : money(summary.total)}</strong></div>{error && <p className="bulk-error" role="alert">{error}</p>}<button type="button" className="btn btn-primary full" onClick={submit} disabled={submitting}>{submitting ? 'Submitting…' : 'Submit Quote Request'}</button><button type="button" className="btn btn-outline full" onClick={() => setCallbackOpen(true)}>Request a Callback</button></section>}
    {step === 'success' && <section className="bulk-success"><span><Icon name="check" size={32} /></span><h2>Quote Request Submitted</h2><p>Your bulk requirement was saved for review. A final price has not been approved.</p><div><small>Request ID</small><strong>{request?.id}</strong><p>{request?.items} Service units</p></div><button type="button" className="btn btn-primary full" onClick={() => setStep('order')}>View Bulk Requests</button><button type="button" className="btn btn-outline full" onClick={onBack}>Back</button></section>}
    {callbackOpen && <CallbackModal profile={profile} onClose={() => setCallbackOpen(false)} onSuccess={form => { sessionStorage.setItem(`eazily-bulk-demo-callback:${accountId || 'guest'}`, JSON.stringify({ ...form, requestedAt: new Date().toISOString() })); setCallbackOpen(false); setCallbackDone(true); }} />}
    {callbackDone && <div className="bulk-modal-overlay"><section className="bulk-callback bulk-callback-success" role="dialog" aria-modal="true"><span><Icon name="check" /></span><h2>Callback Requested</h2><p>We’ll contact you on your registered number.</p><p className="bulk-demo-note">Test session only · No backend callback was created.</p><button type="button" className="btn btn-primary full" onClick={() => setCallbackDone(false)}>Continue Bulk Order</button></section></div>}
  </main>;
}
