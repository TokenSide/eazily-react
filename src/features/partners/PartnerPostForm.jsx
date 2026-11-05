import { translate as t } from '../../lib/translate.js';
import { useRef, useState } from 'react';
import { Field } from '../../components/Ui.jsx';
import { partnerRoles } from '../../data/partners.js';
import { influencerCategories, displayInfluencerCategory } from '../../data/influencerCategories.js';
import { displayConsultantCategory } from '../../data/consultantCategories.js';
import { savePartnerPost } from '../../services/partners.js';
import { supabase } from '../../lib/supabase.js';
import PartnerFields from './PartnerFields.jsx';
import MediaPreview from './MediaPreview.jsx';
import MediaUpload from './MediaUpload.jsx';
import ServicePostForm from './ServicePostForm.jsx';
const titles = { professional: 'Create Service Post', influencer: 'Create Creator Post', consultant: 'Create Consultation Post' };
export default function PartnerPostForm({ role, post, application, accountId, offerings = [], notify, onDone }) {
  if (role === 'influencer') return <InfluencerComposer post={post} application={application} accountId={accountId} offerings={offerings} notify={notify} onDone={onDone} />;
  if (role === 'professional' && (!post || (post.details?.postType || 'offering') === 'offering')) return <ServicePostForm post={post} application={application} accountId={accountId} notify={notify} onDone={onDone} />;
  return <LegacyPartnerPostForm role={role} post={post} application={application} accountId={accountId} offerings={offerings} notify={notify} onDone={onDone} />;
}

function LegacyPartnerPostForm({ role, post, application, accountId, offerings = [], notify, onDone }) {
  const profile = application?.details || {};
  const [id] = useState(() => post?.id || crypto.randomUUID());
  const storageKey = 'eazily-post-draft:' + accountId + ':' + role + ':' + (post?.id || 'new');
  const [values, setValues] = useState(() => {
    let cached; try { cached = JSON.parse(sessionStorage.getItem(storageKey)); } catch { /* Cache failure does not block editing. */ }
    return post?.details || cached || { postType: 'offering', category: profile.category || '', service: profile.services?.length === 1 ? profile.services[0] : '', area: profile.city || '', pricingType: 'Fixed Price', visitingCharge: '', visitTreatment: 'Additional', quantity: 1, taxInclusive: false, mode: 'Online consultation', duration: '30', media: [] };
  });
  const [preview, setPreview] = useState(false), [busy, setBusy] = useState(false), lock = useRef(false);
  function update(change) {
    setValues(v => { const result = typeof change === 'function' ? change(v) : change; try { sessionStorage.setItem(storageKey, JSON.stringify(result)); } catch { /* Retain the in-memory draft. */ } return result; });
  }
  async function action(next) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      let result;
      if (!supabase) {
        result = { id, role, partner_id: application.id, details: values, status: 'draft', testing: true, updated_at: new Date().toISOString() };
        const key = 'eazily-posts:' + accountId + ':' + role;
        const rows = JSON.parse(sessionStorage.getItem(key) || '[]');
        sessionStorage.setItem(key, JSON.stringify([...rows.filter(p => p.id !== id), result]));
        notify('Testing draft saved. It is not publicly published.');
      } else { result = await savePartnerPost(role, values, next, id); notify(next === 'draft' ? 'Draft saved' : 'Post submitted for review'); }
      sessionStorage.removeItem(storageKey); onDone(result);
    } catch (e) { notify(e.message); } finally { lock.current = false; setBusy(false); }
  }
  const kinds = [['offering',titles[role]],['photo','Photo'],['video','Video'],['portfolio','Portfolio'],['offer','Offer'],['knowledge','Knowledge']].filter(([key]) => !(key === 'portfolio' && role !== 'professional') && !(key === 'offer' && role === 'consultant'));
  if (preview) return <section className="post-preview"><span className="eyebrow">{t('Preview')}</span><h2>{values.title || titles[role]}</h2><b>{profile.businessName || profile.creatorName || profile.name || partnerRoles[role].label}</b><p>{values.description}</p><p>{role === 'consultant' ? displayConsultantCategory(values.category) : values.service || values.category} · {profile.experience} · {values.area}</p>
    {role !== 'consultant' && values.postType === 'offering' && <p>{t('Your price')}: ₹{role === 'professional' ? values.serviceCharge || '—' : values.packagePrice || '—'}{role === 'professional' && <> · {t('Visiting charge (₹)')}: {values.visitingCharge || '—'}</>}</p>}
    <MediaPreview media={values.media}/><p>{t('Layout preview only. Booking is not available in seller preview.')}</p><p>{t('Media files')}: {values.media?.length || 0}</p><button type="button" className="btn btn-outline full" onClick={() => setPreview(false)}>{t('Back to Edit')}</button><button type="button" className="btn btn-primary full" disabled={busy} onClick={() => action('draft')}>{t('Save Draft')}</button></section>;
  return <form onSubmit={e => { e.preventDefault(); action('submit'); }}>
    <h2>{t(titles[role])}</h2><div className="chip-grid">{kinds.map(([key,label]) => <button type="button" aria-pressed={values.postType === key} className={values.postType === key ? 'selected' : ''} key={key} onClick={() => update(v => ({ ...v, postType: key }))}>{t(label)}</button>)}</div>
    <PartnerFields role={role} values={values} setValues={update} profile={profile} offerings={offerings} />
    <div className="post-actions"><button type="button" className="btn btn-outline" onClick={() => action('draft')} disabled={busy}>{t('Save Draft')}</button><button type="button" className="btn btn-outline" onClick={() => setPreview(true)}>{t('Preview')}</button><button className="btn btn-primary" disabled={busy}>{t('Submit for Review')}</button></div>
  </form>;
}

function InfluencerComposer({ post, application, accountId, offerings, notify, onDone }) {
  const profile = application?.details || {};
  const [id] = useState(() => post?.id || crypto.randomUUID());
  const storageKey = 'eazily-post-draft:' + accountId + ':influencer:' + (post?.id || 'new');
  const [values, setValues] = useState(() => {
    let cached; try { cached = JSON.parse(sessionStorage.getItem(storageKey)); } catch { /* In-memory editing remains available. */ }
    return post?.details || cached || { postType: 'offering', category: displayInfluencerCategory(profile.category), area: profile.city || '', media: [], caption: '', title: '', description: '', packageId: '', packageSnapshot: null, deliverables: 'Reel', deliverableCount: 1, packagePrice: '', timeline: '5', revisions: 0, usageRights: '', advertisingPermissions: '', serviceArea: profile.city || '' };
  });
  const [preview, setPreview] = useState(false), [busy, setBusy] = useState(false), lock = useRef(false);
  const update = change => setValues(current => { const next = typeof change === 'function' ? change(current) : change; try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Keep the draft in React state. */ } return next; });
  const selectedPackage = offerings.find(item => item.id === values.packageId);
  const categoryOptions = [...new Set([...influencerCategories, displayInfluencerCategory(values.category)].filter(Boolean))];
  function selectPackage(item) {
    if (!item) return update(current => ({ ...current, packageId: '', packageSnapshot: null }));
    const details = item.details || {};
    update(current => ({ ...current, packageId: item.id, deliverables: details.deliverables, deliverableCount: details.deliverableCount, packagePrice: details.packagePrice, timeline: details.timeline, revisions: details.revisions, usageRights: details.usageRights, advertisingPermissions: details.advertisingPermissions, packageTermsConfirmed: true, packageSnapshot: { id: item.id, title: details.title, category: details.category, deliverables: details.deliverables, deliverableCount: details.deliverableCount, packagePrice: details.packagePrice, timeline: details.timeline, revisions: details.revisions, usageRights: details.usageRights, advertisingPermissions: details.advertisingPermissions, area: details.area } }));
  }
  async function action(next) {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const caption = values.caption?.trim() || values.description?.trim() || '';
      const packageTitle = `${values.deliverableCount || 1} ${values.deliverables || 'collaboration'}`;
      const payload = { ...values, title: values.title?.trim() || caption.split(/[.!?\n]/)[0].slice(0, 120) || packageTitle, description: values.description?.trim() || caption, caption, category: displayInfluencerCategory(values.category || profile.category), postType: 'offering', packageSnapshot: values.packageSnapshot || { deliverables: values.deliverables, deliverableCount: values.deliverableCount, packagePrice: values.packagePrice, timeline: values.timeline, revisions: values.revisions, usageRights: values.usageRights, advertisingPermissions: values.advertisingPermissions, area: values.area } };
      if (next === 'submit' && (!payload.caption || !payload.packagePrice || !payload.usageRights || !payload.advertisingPermissions || !payload.packageTermsConfirmed)) throw new Error('Complete the caption and confirm all package terms before submitting.');
      const result = supabase ? await savePartnerPost('influencer', payload, next, id) : { id, role: 'influencer', partner_id: application.id, details: payload, status: 'draft', testing: true, updated_at: new Date().toISOString() };
      if (!supabase) {
        const key = 'eazily-posts:' + accountId + ':influencer';
        const rows = JSON.parse(sessionStorage.getItem(key) || '[]');
        sessionStorage.setItem(key, JSON.stringify([...rows.filter(item => item.id !== id), result]));
      }
      sessionStorage.removeItem(storageKey);
      notify(next === 'draft' ? 'Draft saved' : 'Post submitted for review');
      onDone(result);
    } catch (error) { notify(error.message); } finally { lock.current = false; setBusy(false); }
  }
  if (preview) return <section className="influencer-composer"><span className="eyebrow">{t('Preview')}</span><h2>{payloadTitle(values)}</h2><CreatorIdentity profile={profile} /><p>{values.caption || values.description}</p><PackageCard values={values} selectedPackage={selectedPackage} /><MediaPreview media={values.media} /><p className="policy-note">Preview only. Publishing still requires the existing moderation review.</p><button type="button" className="btn btn-outline full" onClick={() => setPreview(false)}>{t('Back to Edit')}</button><button type="button" className="btn btn-primary full" disabled={busy} onClick={() => action('draft')}>{t('Save Draft')}</button></section>;
  return <form className="influencer-composer" onSubmit={event => { event.preventDefault(); action('submit'); }}><h2>Create a Post / नई पोस्ट बनाएं</h2><CreatorIdentity profile={profile} /><MediaUpload role="influencer" label="Add photo or video" value={values.media || []} onChange={change => update(current => ({ ...current, media: typeof change === 'function' ? change(current.media || []) : change }))} /><Field label="What would you like to share?" as="textarea" value={values.caption || ''} placeholder="I create tech product reviews. Here is my latest work." maxLength={4000} required onChange={event => update(current => ({ ...current, caption: event.target.value }))} /><Field label="Category" as="select" options={categoryOptions} value={displayInfluencerCategory(values.category || profile.category)} required onChange={event => update(current => ({ ...current, category: event.target.value }))} /><PackageCard values={values} profile={profile} selectedPackage={selectedPackage} onSelect={selectPackage} offerings={offerings} onUpdate={update} /><details className="composer-more"><summary>More options</summary><Field label="Service area" value={values.area || profile.city || ''} onChange={event => update(current => ({ ...current, area: event.target.value }))} /><Field label="Hashtags (optional)" value={values.hashtags || ''} onChange={event => update(current => ({ ...current, hashtags: event.target.value }))} /></details><p className="policy-note">This post describes a paid package, but submitting it does not enable payment or payout.</p><div className="post-actions"><button type="button" className="btn btn-outline" onClick={() => action('draft')} disabled={busy}>Save Draft</button><button type="button" className="btn btn-outline" onClick={() => setPreview(true)} disabled={busy}>Preview</button><button className="btn btn-primary" disabled={busy}>{values.packageSnapshot || values.packagePrice ? 'Submit for Review' : 'Set up package & Submit'}</button></div></form>;
}

function payloadTitle(values) { return values.title || values.caption?.split(/[.!?\n]/)[0] || `${values.deliverableCount || 1} ${values.deliverables || 'collaboration'}`; }
function CreatorIdentity({ profile }) { return <section className="creator-identity"><b>{profile.businessName || profile.creatorName || profile.name || 'Creator profile'}</b><span>{displayInfluencerCategory(profile.category) || 'Category not provided'} · {profile.city || 'Location not provided'}</span><small>{(profile.platforms || []).filter(item => item.url).map(item => `${item.name} · ${item.band || 'Not provided'} · ${item.verified ? 'Verified' : 'Self-reported'}`).join(' | ') || 'Social audience not provided'}</small></section>; }
function PackageCard({ values, profile, selectedPackage, onSelect, offerings = [], onUpdate }) {
  const packageValues = values.packageSnapshot || values;
  return <section className="package-card"><div className="summary-heading"><h3>Collaboration package</h3>{onSelect && offerings.length > 0 && <select aria-label="Change package" value={values.packageId || ''} onChange={event => onSelect(offerings.find(item => item.id === event.target.value))}><option value="">Set up a package</option>{offerings.map(item => <option key={item.id} value={item.id}>{item.details.title || item.details.deliverables}</option>)}</select>}</div>{selectedPackage ? <p>{selectedPackage.details.category || 'Social account'} · {selectedPackage.details.deliverableCount || 1} {selectedPackage.details.deliverables} · ₹{selectedPackage.details.packagePrice} · {selectedPackage.details.timeline} days</p> : <p>{packageValues.deliverables ? `${packageValues.deliverableCount || 1} ${packageValues.deliverables} · ₹${packageValues.packagePrice || 'Price not set'} · ${packageValues.timeline || '—'} days` : 'Set up your collaboration package before publishing.'}</p>}{onUpdate && !selectedPackage && <div className="package-setup"><p><b>Set up your collaboration package</b></p><Field label="Saved social account/platform" as="select" options={['', ...(profile?.platforms || []).map(item => item.name)]} value={values.platform || ''} onChange={event => onUpdate(current => ({ ...current, platform: event.target.value }))} /><Field label="Deliverable" as="select" options={['Reel','Story','Post','Video','Review','Other']} value={values.deliverables || ''} onChange={event => onUpdate(current => ({ ...current, deliverables: event.target.value }))} /><Field label="Quantity" type="number" min="1" value={values.deliverableCount || 1} onChange={event => onUpdate(current => ({ ...current, deliverableCount: event.target.value }))} /><Field label="Exact collaboration charge (₹)" type="number" min="0.01" step="0.01" value={values.packagePrice || ''} required onChange={event => onUpdate(current => ({ ...current, packagePrice: event.target.value }))} /><Field label="Delivery time in days" type="number" min="1" value={values.timeline || ''} onChange={event => onUpdate(current => ({ ...current, timeline: event.target.value }))} /><details><summary>Package terms</summary><Field label="Included revisions" type="number" min="0" value={values.revisions || 0} onChange={event => onUpdate(current => ({ ...current, revisions: event.target.value }))} /><Field label="Content usage rights" as="textarea" required value={values.usageRights || ''} onChange={event => onUpdate(current => ({ ...current, usageRights: event.target.value }))} /><Field label="Advertising permissions" as="textarea" required value={values.advertisingPermissions || ''} onChange={event => onUpdate(current => ({ ...current, advertisingPermissions: event.target.value }))} /><label className="consent"><input type="checkbox" checked={Boolean(values.packageTermsConfirmed)} onChange={event => onUpdate(current => ({ ...current, packageTermsConfirmed: event.target.checked }))} /> I confirm these package terms.</label></details></div>}{selectedPackage && <div className="package-actions"><button type="button" className="link" onClick={() => onSelect(null)}>Change</button><button type="button" className="link" onClick={() => onUpdate(current => ({ ...current, packageId: '', packageSnapshot: null }))}>Edit package</button></div>}<p className="policy-note">Official payment and payout terms will be shown when the provider integration is configured.</p></section>;
}
