import { useEffect, useMemo, useState } from 'react';
import { EmptyState, Field } from '../../components/Ui.jsx';
import { readRows, requireBackend, rpc, shareLink } from '../../services/experience.js';
import { setLanguage } from '../../lib/translate.js';
import SupportForm from './SupportForm.jsx';
import SupportThread from './SupportThread.jsx';
import { useRealtime } from '../../lib/realtime.jsx';
import ConsumerLegalCenter from '../legal/ConsumerLegal.jsx';

export default function ProfileDetails({ section, profile, accountId, notify, onProfile, onOpenBookings }) {
  const { revision } = useRealtime();
  if (section === 'Account & Profile') return <AccountProfile profile={profile} notify={notify} onProfile={onProfile} />;
  if (section === 'Location & Addresses') return <Addresses notify={notify} />;
  if (section === 'Notifications') return <Notifications accountId={accountId} notify={notify} revision={revision} onOpenBookings={onOpenBookings} />;
  if (section === 'Payments') return <Payments notify={notify} revision={revision} />;
  if (section === 'Service Management') return <Services notify={notify} revision={revision} />;
  if (section === 'App Preferences') return <Preferences notify={notify} />;
  if (section === 'Help & Support') return <Help notify={notify} revision={revision} />;
  if (section === 'Legal') return <ConsumerLegalCenter />;
  return <About notify={notify} />;
}

function AccountProfile({ profile, notify, onProfile }) {
  const [draft, setDraft] = useState({ full_name: profile?.full_name || '', email: profile?.email || '' });
  const [preview, setPreview] = useState(profile?.avatar_url || ''), [file, setFile] = useState(null), [removePhoto, setRemovePhoto] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (profile?.avatar_url && !profile.avatar_url.startsWith('http')) requireBackend().storage.from('profile-media').createSignedUrl(profile.avatar_url, 900).then(({ data }) => data?.signedUrl && setPreview(data.signedUrl)).catch(() => {});
  }, [profile?.avatar_url]);
  async function save(event) {
    event.preventDefault(); setBusy(true);
    try {
      const db = requireBackend(); let avatar_url = removePhoto ? null : profile?.avatar_url || null;
      if (file) {
        const { data: { user } } = await db.auth.getUser(); if (!user) throw new Error('Sign in to update your profile.');
        const blob = await squareImage(file); const path = `${user.id}/avatar.jpg`;
        const uploaded = await db.storage.from('profile-media').upload(path, blob, { contentType: 'image/jpeg', upsert: true }); if (uploaded.error) throw uploaded.error;
        avatar_url = path;
      }
      const result = await db.from('profiles').update({ full_name: draft.full_name, email: draft.email || null, avatar_url }).eq('id', profile.id).select().single();
      if (result.error) throw result.error; onProfile(result.data); notify('Changes saved / बदलाव सेव हो गए');
    } catch (error) { notify(error.message); } finally { setBusy(false); }
  }
  return <form onSubmit={save}><div className="profile-photo-editor">{preview ? <img src={preview.startsWith('blob:') || preview.startsWith('http') ? preview : undefined} alt="Profile preview" /> : <span>{(draft.full_name || 'U')[0]}</span>}<label className="btn btn-outline">Camera / Gallery<input hidden type="file" accept="image/jpeg,image/png" onChange={event => { const next = event.target.files[0]; if (next) { setFile(next); setRemovePhoto(false); setPreview(URL.createObjectURL(next)); } }} /></label>{preview && <button type="button" className="link" onClick={() => { setPreview(''); setFile(null); setRemovePhoto(true); }}>Remove photo</button>}</div><Field label="Name" value={draft.full_name} onChange={event => setDraft({ ...draft, full_name: event.target.value })} required /><Field label="Verified mobile" value={profile?.phone || ''} readOnly /><button type="button" className="btn btn-outline full" onClick={() => notify('Changing a mobile number requires reauthentication and OTP. Contact Support if the old number is unavailable.')}>Change mobile number</button><Field label="Email" type="email" value={draft.email} onChange={event => setDraft({ ...draft, email: event.target.value })} /><p className="policy-note">{profile?.email_verified ? 'Email verified' : 'A new email remains unverified until the configured verification link is completed.'}</p><button className="btn btn-primary full" disabled={busy}>Save changes</button></form>;
}

function Addresses({ notify }) {
  const blank = { label: 'Home', address: '', address_line_2: '', locality: '', city: '', pin_code: '', landmark: '', is_default: false };
  const [rows, setRows] = useState([]), [draft, setDraft] = useState(blank), [editing, setEditing] = useState(null), [permission, setPermission] = useState('prompt');
  const load = () => readRows('customer_addresses').then(setRows).catch(error => notify(error.message));
  useEffect(() => { readRows('customer_addresses').then(setRows).catch(error => notify(error.message)); }, [notify]);
  function locate() { navigator.geolocation?.getCurrentPosition(position => { setPermission('granted'); setDraft(current => ({ ...current, latitude: position.coords.latitude, longitude: position.coords.longitude })); }, error => { setPermission(error.code === 1 ? 'denied' : 'unavailable'); notify('Manual address entry remains available. Enable location for this app in device settings if desired.'); }); }
  async function save(event) { event.preventDefault(); try { const db = requireBackend(); const { data: { user } } = await db.auth.getUser(); const payload = { ...draft, customer_id: user.id }; const result = editing ? await db.from('customer_addresses').update(payload).eq('id', editing) : await db.from('customer_addresses').insert(payload); if (result.error) throw result.error; setDraft(blank); setEditing(null); await load(); notify(editing ? 'Address updated' : 'Address added / पता जोड़ दिया गया'); } catch (error) { notify(error.message); } }
  async function remove(row) { if (!confirm(`Delete ${row.label} address?`)) return; const result = await requireBackend().from('customer_addresses').delete().eq('id', row.id); if (result.error) notify(result.error.message); else load(); }
  async function makeDefault(id) { try { await rpc('set_default_address', { p_address_id: id }); await load(); } catch (error) { notify(error.message); } }
  return <><button className="btn btn-outline full" onClick={locate}>Use current location</button><p className="policy-note">Location permission: {permission}. Detected coordinates can always be corrected with manual entry.</p><form onSubmit={save}><Field label="Label" as="select" options={['Home', 'Work', 'Other']} value={draft.label} onChange={event => setDraft({ ...draft, label: event.target.value })} /><Field label="Address line 1" value={draft.address} onChange={event => setDraft({ ...draft, address: event.target.value })} required /><Field label="Address line 2" value={draft.address_line_2} onChange={event => setDraft({ ...draft, address_line_2: event.target.value })} /><Field label="Locality" value={draft.locality} onChange={event => setDraft({ ...draft, locality: event.target.value })} required /><div className="form-grid"><Field label="City" value={draft.city} onChange={event => setDraft({ ...draft, city: event.target.value })} required /><Field label="PIN code" value={draft.pin_code} onChange={event => setDraft({ ...draft, pin_code: event.target.value.replace(/\D/g, '').slice(0, 6) })} required /></div><Field label="Landmark (optional)" value={draft.landmark} onChange={event => setDraft({ ...draft, landmark: event.target.value })} /><button className="btn btn-primary full">{editing ? 'Save address changes' : 'Add address'}</button></form>{rows.map(row => <article className="review-item" key={row.id}><b>{row.label} {row.is_default && '· Default'}</b><p>{[row.address, row.address_line_2, row.locality, row.city, row.pin_code].filter(Boolean).join(', ')}</p><div className="review-actions"><button onClick={() => { setEditing(row.id); setDraft(row); }}>Edit</button><button onClick={() => remove(row)}>Delete</button>{!row.is_default && <button onClick={() => makeDefault(row.id)}>Set as default</button>}</div></article>)}</>;
}

function Notifications({ accountId, notify, revision, onOpenBookings }) {
  const defaults = { booking_updates: true, payment_notifications: true, promotions: false, consultation_reminders: true };
  const [prefs, setPrefs] = useState(defaults), [updates, setUpdates] = useState([]), [loading, setLoading] = useState(true);
  useEffect(() => { readRows('customer_notification_preferences').then(rows => rows[0] && setPrefs(rows[0])).catch(error => notify(error.message)); }, [notify]);
  useEffect(() => {
    if (!accountId) { setUpdates([]); setLoading(false); return undefined; }
    let active = true;
    readRows('seller_notifications', query => query.eq('account_id', accountId).eq('role', 'professional').order('created_at', { ascending: false }).limit(50))
      .then(async rows => {
        if (!rows.length) return [];
        const orders = await readRows('partner_orders', query => query.eq('customer_id', accountId).in('id', [...new Set(rows.map(row => row.order_id))]));
        const customerOrderIds = new Set(orders.map(order => order.id));
        return rows.filter(row => customerOrderIds.has(row.order_id));
      })
      .then(rows => { if (active) setUpdates(rows); })
      .catch(error => { if (active) notify(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [accountId, revision, notify]);
  async function toggle(key) { const next = { ...prefs, [key]: !prefs[key] }; setPrefs(next); try { const db = requireBackend(); const { data: { user } } = await db.auth.getUser(); const result = await db.from('customer_notification_preferences').upsert({ customer_id: user.id, ...next, updated_at: new Date().toISOString() }); if (result.error) throw result.error; } catch (error) { setPrefs(prefs); notify(error.message); } }
  return <><h3>Booking updates</h3><p className="policy-note">Updates appear here while you use the app. Android background push is not configured; a professional's response window does not guarantee notification delivery.</p>{loading ? <p>Loading booking updates…</p> : updates.length ? updates.map(item => <button className="choice" key={item.id} onClick={async () => { try { if (!item.read_at) await rpc('mark_seller_notifications_read', { p_id: item.id }); onOpenBookings?.(); } catch (error) { notify(error.message); } }}><b>{item.title}</b><small>{new Date(item.created_at).toLocaleString('en-IN')} · {item.read_at ? 'Read' : 'Unread'}</small></button>) : <EmptyState title="No booking updates yet" text="New Service Partner request updates will appear here." />}<h3>Notification preferences</h3><p className="policy-note">These preferences are saved for future delivery channels; they do not enable background push.</p>{Object.entries({ booking_updates: 'Service booking updates', payment_notifications: 'Payment notifications', promotions: 'Offers and promotions (opt-in)', consultation_reminders: 'Consultation appointment reminders' }).map(([key, label]) => <label className="preference-row" key={key}><span>{label}</span><input type="checkbox" checked={Boolean(prefs[key])} onChange={() => toggle(key)} /></label>)}</>;
}

function Payments({ notify, revision }) {
  const [rows, setRows] = useState([]), [methods, setMethods] = useState([]);
  useEffect(() => { Promise.all([readRows('customer_payments'), readRows('customer_payment_methods')]).then(([a, b]) => { setRows(a); setMethods(b); }).catch(error => notify(error.message)); }, [notify, revision]);
  return <><h3>Payment history</h3>{rows.map(row => <article className="review-item" key={row.id}><b>₹{(row.amount_paise / 100).toFixed(2)} · {row.status}</b><p>{row.method_label || row.provider} · {row.booking_id || 'No booking reference'}</p><small>{new Date(row.paid_at || row.created_at).toLocaleString()}</small>{row.status === 'paid' && <button onClick={() => notify('Receipt download is available when the provider invoice is attached.')}>Receipt / Invoice</button>}</article>)}{!rows.length && <EmptyState title="No payments yet" text="Authoritative provider transactions will appear here." />}<h3>Saved payment methods</h3>{methods.map(row => <p key={row.id}>{row.brand} ·•••• {row.last_four}</p>)}<button className="btn btn-outline full" disabled title="Cashfree secure saved-method flow is not configured">Add payment method</button></>;
}

function Services({ notify, revision }) {
  const [rows, setRows] = useState([]), [tab, setTab] = useState('Upcoming/Ongoing'), [helpFor, setHelpFor] = useState(null);
  useEffect(() => { readRows('service_requests').then(setRows).catch(error => notify(error.message)); }, [notify, revision]);
  const shown = useMemo(() => rows.filter(row => tab === 'All' || tab === 'Completed' && row.status === 'completed' || tab === 'Cancelled' && row.status === 'cancelled' || tab === 'Upcoming/Ongoing' && ['pending', 'accepted', 'in_progress'].includes(row.status)), [rows, tab]);
  async function cancel(row) { const reason = prompt('Cancellation reason'); if (!reason) return; try { await rpc('request_booking_cancellation', { p_booking_id: row.id, p_reason: reason, p_idempotency_key: crypto.randomUUID() }); setRows(current => current.map(item => item.id === row.id ? { ...item, status: 'cancelled' } : item)); notify('Cancellation recorded. Refund processing remains a separate status.'); } catch (error) { notify(error.message); } }
  return <><div className="filter-chips">{['Upcoming/Ongoing', 'Completed', 'Cancelled', 'All'].map(item => <button className={tab === item ? 'active' : ''} key={item} onClick={() => setTab(item)}>{item}</button>)}</div>{shown.map(row => <article className="review-item" key={row.id}><b>{row.service_name} · {row.status}</b><p>Booking {row.id.slice(0, 8)} · {row.details?.location || row.details?.city || ''}</p><small>{new Date(row.created_at).toLocaleString()}</small><div className="review-actions"><button onClick={() => notify('Tracking uses this booking status record.')}>Track status</button><button aria-expanded={helpFor === row.id} onClick={() => setHelpFor(current => current === row.id ? null : row.id)}>{helpFor === row.id ? 'Close help' : 'Get help'}</button>{['pending', 'accepted'].includes(row.status) && <button onClick={() => cancel(row)}>Cancel</button>}</div>{helpFor === row.id && <SupportForm notify={notify} initialBooking={`request:${row.id}`} />}</article>)}{!shown.length && <EmptyState title="No matching services" text="Your bookings, collaborations and consultations use the same account history." />}</>;
}

function Preferences({ notify }) {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('eazily-theme');
    return saved === 'dark' ? 'dark' : 'light';
  });
  const [language, setLang] = useState(localStorage.getItem('eazily-language') || 'English');
  function applyTheme(value) {
    setTheme(value);
    localStorage.setItem('eazily-theme', value);
    document.documentElement.dataset.customerTheme = value;
    notify('Appearance preference saved');
  }
  return <><label className="preference-row customer-theme-preference"><span><b>Dark Mode</b><small>Saved on this device</small></span><input type="checkbox" role="switch" checked={theme === 'dark'} onChange={event => applyTheme(event.target.checked ? 'dark' : 'light')} /></label><Field label="Language" as="select" options={['English', 'हिन्दी']} value={language} onChange={event => { setLang(event.target.value); setLanguage(event.target.value); notify('Language saved'); }} /></>;
}

const ticketStatus = { open: 'Received', in_progress: 'Support is working on it', waiting_customer: 'Waiting for your reply', resolved: 'Resolved', closed: 'Closed' };
function Help({ notify, revision }) {
  const [query, setQuery] = useState(''), [tickets, setTickets] = useState([]), [config, setConfig] = useState(null), [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    Promise.all([readRows('support_tickets', q => q.order('created_at', { ascending: false }).limit(50)), readRows('app_configuration')]).then(([rows, settings]) => {
      if (active) { setTickets(rows); setConfig(settings[0]); }
    }).catch(error => notify(error.message));
    return () => { active = false; };
  }, [notify, revision, reload]);
  const faqs = ['How do bookings work?', 'When will my refund arrive?', 'How are partners verified?', 'How do consultations work?'].filter(item => item.toLowerCase().includes(query.toLowerCase()));
  const phone = String(config?.support_phone || '').replace(/[^\d+]/g, '');
  return <>
    <h3>Report a problem</h3>
    <SupportForm notify={notify} onCreated={() => setReload(value => value + 1)} />
    {phone || config?.support_email ? <div className="support-contact">{phone && <a className="btn btn-outline" href={`tel:${phone}`}>Call support</a>}{phone && <a className="btn btn-outline" href={`https://wa.me/${phone.replace(/^\+/, '')}`} target="_blank" rel="noreferrer">WhatsApp</a>}{config?.support_email && <a className="btn btn-outline" href={`mailto:${config.support_email}`}>Email</a>}</div> : null}
    <p className="policy-note">Support: {config?.support_phone || config?.support_email || 'Contact details pending Eazily configuration'} · {config?.support_hours || 'Hours pending'}</p>
    <h3>My tickets</h3>
    {tickets.map(row => <article className="review-item support-ticket" key={row.id}><b>EAZ-{row.id.slice(0, 8).toUpperCase()}<span className={`support-badge ${row.status}`}>{ticketStatus[row.status] || row.status}</span>{row.priority === 'urgent' && <span className="support-badge urgent">Urgent</span>}</b><p>{row.category} · {String(row.description || '').slice(0, 160)}</p><small>Raised {new Date(row.created_at).toLocaleString('en-IN')} · Updated {new Date(row.updated_at).toLocaleString('en-IN')}</small><SupportThread ticket={row} revision={revision} /></article>)}
    {!tickets.length && <p className="policy-note">No tickets yet. Problems you report appear here with their status.</p>}
    <Field label="Search Help Center" value={query} onChange={event => setQuery(event.target.value)} />{faqs.map(item => <details key={item}><summary>{item}</summary><p>Open a ticket for account-specific help. Payment and refund decisions come only from authoritative records.</p></details>)}
    <button className="btn btn-outline full" onClick={() => notify('Eazily Assistant uses approved general help only. Talk to support for account decisions.')}>Open Eazily Assistant</button>
  </>;
}

function About({ notify }) { const [config, setConfig] = useState(null); useEffect(() => { readRows('app_configuration').then(rows => setConfig(rows[0])).catch(error => notify(error.message)); }, [notify]); const link = config?.public_app_link; return <><h3>About Eazily</h3><div style={{ lineHeight: 1.7 }}><p>Eazily is a technology-driven service platform created to make everyday services more accessible, convenient, and reliable. Our platform connects customers with professional service providers, helping users discover and book a wide range of services through one simple and convenient platform.</p><p>At Eazily, we understand that finding the right professional for a service can often take time and effort. Whether a customer needs assistance with home and property services, automobile-related services, personal services, professional consultation, or other everyday requirements, Eazily is designed to simplify the process and bring suitable service providers closer to the customer.</p><p>Our platform focuses on creating a smooth experience at every stage—from exploring available services and selecting a suitable professional to scheduling a service and managing bookings. We aim to provide customers with clear service information and a straightforward digital experience, while giving professional vendors an organized platform to present their services and connect with potential customers.</p><p>Eazily is built around the idea that essential services should be easier to find and easier to access. By bringing customers and service professionals together on a single platform, we aim to reduce the complexity involved in searching for services and create a more structured way to manage everyday service requirements.</p><p>For service providers, Eazily offers an opportunity to showcase their expertise, manage service requests, and reach customers through a digital platform. We believe that creating a professional and transparent environment can help build better connections between customers and service providers.</p><p>Our vision is to develop Eazily into a dependable service ecosystem where people can find the services they need with greater convenience and confidence. As we continue to expand our platform and service categories, our focus remains on technology, accessibility, service quality, and customer experience.</p><p>Eazily — Your Services, Made Simple.</p></div><p>App version: {config?.current_app_version || '1.0.0'}</p><button className="btn btn-outline full" disabled={!link} onClick={() => shareLink(link, notify)}>{link ? 'Share our app' : 'App link pending configuration'}</button></>; }

async function squareImage(file) { const image = await createImageBitmap(file), size = Math.min(image.width, image.height), canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512; canvas.getContext('2d').drawImage(image, (image.width - size) / 2, (image.height - size) / 2, size, size, 0, 0, 512, 512); image.close(); return await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .88)); }
