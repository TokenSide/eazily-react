import { useEffect, useMemo, useState } from 'react';
import { Field } from '../../components/Ui.jsx';
import { readRows, requireBackend } from '../../services/experience.js';
import { translate } from '../../lib/translate.js';
import { useAccount } from '../../lib/account.js';
import { mergeCustomerBookings } from '../services/customerBookings.js';
import { UserBusyLabel } from '../user-motion/UserLoading.jsx';
import './support.css';

const categories = ['Booking', 'Payment', 'Refund', 'Partner', 'Consultation', 'Account', 'Other'];
// One-tap problem types for the issues the team must hear about quickly. Each maps to an existing category.
const supportProblems = [
  { id: 'not_arrived', label: 'Professional did not arrive', category: 'Partner', urgent: true },
  { id: 'late', label: 'Professional is running late', category: 'Partner' },
  { id: 'extra_money', label: 'Asked for extra money', category: 'Payment', urgent: true },
  { id: 'poor_work', label: 'Poor or incomplete work', category: 'Booking' },
  { id: 'unsafe', label: 'Rude or unsafe behaviour', category: 'Partner', urgent: true, safety: true },
  { id: 'payment', label: 'Payment or refund problem', category: 'Refund' },
  { id: 'app', label: 'App is not working', category: 'Account' },
  { id: 'other', label: 'Something else', category: 'Other' },
];
const draftKey = 'eazily-support-draft';
const reference = record => `EAZ-${String(record.id).slice(0, 8).toUpperCase()}`;

function readDraft() {
  try { return JSON.parse(sessionStorage.getItem(draftKey) || 'null') || {}; } catch { return {}; }
}

export default function SupportForm({ notify, initialBooking = '', bookingContext = null, onCreated }) {
  const { user } = useAccount();
  const draft = useMemo(readDraft, []);
  const [bookings, setBookings] = useState([]), [booking, setBooking] = useState(initialBooking), [category, setCategory] = useState(draft.category || 'Booking'), [problem, setProblem] = useState(draft.problem || ''), [urgent, setUrgent] = useState(Boolean(draft.urgent)), [message, setMessage] = useState(draft.message || ''), [screenshot, setScreenshot] = useState(null), [busy, setBusy] = useState(false), [created, setCreated] = useState(null);
  const selectedProblem = supportProblems.find(item => item.id === problem);

  useEffect(() => {
    let active = true;
    Promise.all([
      readRows('service_requests'),
      user?.id ? readRows('partner_orders', query => query.eq('customer_id', user.id).order('created_at', { ascending: false }).limit(30)) : Promise.resolve([]),
    ]).then(([requests, orders]) => { if (active) setBookings(mergeCustomerBookings(requests, orders)); }).catch(error => notify(error.message));
    return () => { active = false; };
  }, [notify, user?.id]);

  useEffect(() => {
    try { sessionStorage.setItem(draftKey, JSON.stringify({ category, problem, urgent, message })); } catch { /* storage can be unavailable */ }
  }, [category, problem, urgent, message]);

  const options = useMemo(() => {
    const rows = bookings.map(item => ({ value: `${item.type}:${item.record.id}`, item }));
    if (bookingContext && !rows.some(row => row.value === `partner:${bookingContext.id}`)) rows.unshift({ value: `partner:${bookingContext.id}`, item: { type: 'partner', record: bookingContext, status: bookingContext.status } });
    return rows;
  }, [bookings, bookingContext]);
  const chosen = options.find(row => row.value === booking)?.item;

  function pickProblem(item) {
    setProblem(current => current === item.id ? '' : item.id);
    setCategory(item.category);
    if (item.urgent) setUrgent(true);
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return notify('You are offline. Your message is saved on this screen — send it when you are back online.');
    setBusy(true);
    try {
      const db = requireBackend(), { data: { user: signedIn } } = await db.auth.getUser(); if (!signedIn) throw new Error('Sign in to request support.');
      let screenshot_path = null;
      if (screenshot) { screenshot_path = `${signedIn.id}/support/${crypto.randomUUID()}.${screenshot.name.split('.').pop()}`; const upload = await db.storage.from('profile-media').upload(screenshot_path, screenshot); if (upload.error) throw upload.error; }
      const record = chosen?.record;
      const description = `${selectedProblem ? `[${selectedProblem.label}] ` : ''}${message.trim()}`;
      const row = { customer_id: signedIn.id, booking_id: chosen?.type === 'request' ? record.id : null, partner_order_id: chosen?.type === 'partner' ? record.id : null, category, description, screenshot_path };
      if (urgent) row.priority = 'urgent';
      const result = await db.from('support_tickets').insert(row).select('id,status,priority,created_at').single();
      if (result.error) throw result.error;
      setMessage(''); setScreenshot(null); setProblem(''); setUrgent(false); setCreated(result.data);
      try { sessionStorage.removeItem(draftKey); } catch { /* storage can be unavailable */ }
      notify(urgent ? 'Urgent support ticket created. Our team will prioritise it.' : 'Support ticket created.');
      onCreated?.(result.data);
    } catch (error) { notify(error.message); } finally { setBusy(false); }
  }

  if (created) return <section className="support-created" role="status"><b>{translate('Ticket created')} · {reference(created)}</b><p>{translate(created.priority === 'urgent' ? 'Marked urgent. Support will look at this first.' : 'Support will review it and update the status here.')}</p><button type="button" className="btn btn-outline" onClick={() => setCreated(null)}>{translate('Report another problem')}</button></section>;

  return <form className="support-form" onSubmit={submit}>
    <p className="form-label">{translate('What went wrong?')}</p>
    <div className="support-problems" role="group" aria-label={translate('What went wrong?')}>{supportProblems.map(item => <button type="button" key={item.id} className={problem === item.id ? 'selected' : ''} aria-pressed={problem === item.id} onClick={() => pickProblem(item)}>{translate(item.label)}</button>)}</div>
    {selectedProblem?.safety && <p className="support-emergency" role="alert">{translate('If you are in danger right now, call 112.')} <a href="tel:112">{translate('Call 112')}</a></p>}
    <label className="field-wrap"><span className="form-label">{translate('Which booking? (optional)')}</span><select className="field" value={booking} onChange={event => setBooking(event.target.value)}><option value="">{translate('General help')}</option>{options.map(({ value, item }) => <option key={value} value={value}>{item.record.service_name || item.record.title || item.record.role} · {item.status || item.record.status} · {reference(item.record)}</option>)}</select></label>
    <Field label="How can we help?" as="textarea" required minLength={10} maxLength={5000} value={message} placeholder={translate('What happened, when, and what do you need from us?')} onChange={event => setMessage(event.target.value)} />
    <small className="support-count">{message.trim().length < 10 ? translate('At least 10 characters') : `${message.trim().length}/5000`}</small>
    <label className="consent support-urgent"><input type="checkbox" checked={urgent} onChange={event => setUrgent(event.target.checked)} /> {translate('This is urgent — I need help now')}</label>
    <details className="support-more"><summary>{translate('More options')}</summary><Field label="Issue category" as="select" options={categories} value={category} onChange={event => setCategory(event.target.value)} /><label className="field-wrap"><span>{translate('Screenshot (optional)')}</span><input className="field" type="file" accept="image/jpeg,image/png" onChange={event => setScreenshot(event.target.files[0] || null)} /></label></details>
    <button className="btn btn-primary full" disabled={busy}>{busy ? <UserBusyLabel>Submitting…</UserBusyLabel> : translate(urgent ? 'Send urgent ticket' : 'Raise a ticket')}</button>
  </form>;
}
