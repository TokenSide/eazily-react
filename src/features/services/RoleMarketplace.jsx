import { useEffect, useRef, useState } from 'react';
import { EmptyState, Sheet } from '../../components/Ui.jsx';
import Icon from '../../components/Icon.jsx';
import { readRows, requireBackend, shareLink, rpc } from '../../services/experience.js';
import { Carousel, VendorCard } from './ServiceExperience.jsx';
import { requestSignIn, useAccount } from '../../lib/account.js';
import { translate } from '../../lib/translate.js';
import { UserBusyLabel, UserVendorSkeleton } from '../user-motion/UserLoading.jsx';
import { useRealtime } from '../../lib/realtime.jsx';
import { INFLUENCER_FOLLOWER_FILTERS, matchesFollowerFilter } from '../../lib/influencerFollowers.js';
import { displayInfluencerCategory, influencerCategorySearchNames } from '../../data/influencerCategories.js';
import { displayConsultantCategory, consultantCategorySearchNames } from '../../data/consultantCategories.js';

export default function RoleMarketplace({ service, initialProvider, onBack, onMessage, notify }) {
  const { revision } = useRealtime();
  const role = service.categoryId === 'influencers' ? 'influencer' : 'consultant';
  const serviceName = role === 'influencer' ? displayInfluencerCategory(service.serviceName) : displayConsultantCategory(service.serviceName);
  const { user } = useAccount();
  const [providers, setProviders] = useState([]);
  const [selected, setSelected] = useState(initialProvider || null);
  const [followerFilter, setFollowerFilter] = useState('All');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const categoryNames = role === 'influencer'
      ? influencerCategorySearchNames(serviceName)
      : consultantCategorySearchNames(serviceName);
    readRows('partner_directory', q => q.eq('partner_role', role).overlaps('service_names', categoryNames).limit(50))
      .then(items => { if (active) setProviders(role === 'consultant' ? items.map(item => ({ ...item, available_now: null })) : items); })
      .catch(error => notify(error.message))
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [role, serviceName, notify, revision]);
  useEffect(() => setSelected(initialProvider || null), [initialProvider]);
  const title = role === 'influencer' ? 'Available Influencers' : 'Available Consultants';
  const visibleProviders = role === 'influencer' ? providers.filter(item => matchesFollowerFilter(item, followerFilter)) : providers;
  return <main className="screen service-experience">
    <header className="topbar"><button className="icon-btn" onClick={onBack}><Icon name="arrowLeft" /></button><h1>{serviceName}</h1></header>
    <div className="experience-body"><nav className="crumb">Categories → {role === 'influencer' ? 'Influencers' : 'Consultancy'} → {serviceName} → {title}</nav><h2>{title}</h2>
      {role === 'influencer' && <div className="influencer-filter-chips" aria-label="Filter influencers by follower count">{INFLUENCER_FOLLOWER_FILTERS.map(item => <button type="button" className={followerFilter === item ? 'active' : ''} aria-pressed={followerFilter === item} key={item} onClick={() => setFollowerFilter(item)}>{item}</button>)}</div>}
      {loading ? <UserVendorSkeleton count={2} /> : <><div className="vendor-list">{visibleProviders.map(item => <VendorCard key={item.id} vendor={item} onOpen={setSelected} />)}</div>
      {!visibleProviders.length && <EmptyState title={providers.length ? 'No influencers in this follower tier' : `No ${role}s published yet`} text={providers.length ? 'Choose another follower range. All includes eligible influencers below 20K.' : 'Only approved profiles with published offerings appear here.'} />}</>}
      <RoleSections role={role} providers={visibleProviders} onOpen={setSelected} notify={notify} />
    </div>
    {selected && <Sheet className="vendor-sheet" onClose={() => setSelected(null)}><RoleProfile provider={selected} role={role} user={user} onMessage={onMessage} notify={notify} /></Sheet>}
  </main>;
}

function RoleProfile({ provider, role, user, onMessage, notify }) {
  const details = provider.details || {}, profile = provider.profile_details || {};
  const [saved, setSaved] = useState(false), [introSlot, setIntroSlot] = useState(''), [busy, setBusy] = useState(false), [sentEnquiryId, setSentEnquiryId] = useState('');
  const requestKey = useRef(crypto.randomUUID());
  useEffect(() => { setSentEnquiryId(''); requestKey.current = crypto.randomUUID(); }, [provider.id]);
  useEffect(() => {
    if (user) readRows('saved_partner_profiles', q => q.eq('post_id', provider.id)).then(rows => setSaved(Boolean(rows.length))).catch(error => notify(error.message));
  }, [provider.id, user, notify]);
  async function save() {
    if (!user) return requestSignIn();
    const database = requireBackend();
    const result = saved ? await database.from('saved_partner_profiles').delete().eq('post_id', provider.id).eq('customer_id', user.id) : await database.from('saved_partner_profiles').insert({ post_id: provider.id, customer_id: user.id });
    if (result.error) return notify(result.error.message);
    setSaved(current => !current);
  }
  async function continueAction() {
    if (!user) return requestSignIn();
    if (role === 'consultant') {
      if (details.postType && details.postType !== 'offering') return notify('Choose a published consultation offering to send an enquiry.');
      if (!introSlot || Date.parse(introSlot) <= Date.now()) return notify('Choose a future preferred consultation time.');
      if (busy || sentEnquiryId) return;
      setBusy(true);
      try {
        const result = await rpc('book_partner_offering', { p_post: provider.id, p_slot: new Date(introSlot).toISOString(), p_key: requestKey.current });
        setSentEnquiryId(result.id);
        requestKey.current = crypto.randomUUID();
        notify(`Consultation enquiry EAZ-${result.id.slice(0, 8).toUpperCase()} saved for your selected consultant. No payment has been made.`);
        setIntroSlot('');
      } catch (error) { notify(error.message); }
      finally { setBusy(false); }
      return;
    }
    if (details.postType && details.postType !== 'offering') return notify('This post is for viewing. Choose a published collaboration offering to send an enquiry.');
    if (!introSlot || Date.parse(introSlot) <= Date.now()) return notify('Choose a future preferred collaboration time.');
    if (busy || sentEnquiryId) return;
    setBusy(true);
    try {
      const result = await rpc('book_partner_offering', { p_post: provider.id, p_slot: new Date(introSlot).toISOString(), p_key: requestKey.current });
      setSentEnquiryId(result.id);
      requestKey.current = crypto.randomUUID();
      notify(`Collaboration enquiry EAZ-${result.id.slice(0, 8).toUpperCase()} saved. No payment has been made.`);
      setIntroSlot('');
    } catch (error) { notify(error.message); }
    finally { setBusy(false); }
  }
  return <><VendorCard vendor={role === 'consultant' ? { ...provider, available_now: null } : provider} /><h2>{provider.display_name}</h2><p>{provider.description}</p><button className="btn btn-outline full" onClick={save}>{saved ? translate('Saved') : translate('Save Provider')}</button><button className="btn btn-outline full" onClick={() => onMessage(provider.id)}>Message Provider</button>
    {role === 'influencer' ? <><h3>Platforms & audience</h3>{(profile.platforms || []).map(item => <p key={item.name}><b>{item.name}</b>{item.count ? ` · ${Number(item.count).toLocaleString()} self-reported followers` : ' · Audience not provided'}</p>)}<h3>Collaboration package</h3><p>{details.deliverableCount} × {details.deliverables} · {details.timeline} days · {details.revisions || 0} revisions</p><p>Usage rights: {details.usageRights || 'Not provided'} · Advertising permissions: {details.advertisingPermissions || 'Not provided'}</p><section className="payment-breakdown"><b>Collaboration enquiry</b><p>{details.totalPaise != null ? `Listed estimate: ₹${(Number(details.totalPaise) / 100).toLocaleString('en-IN')}` : 'Price will be reviewed before any payment.'}</p><p>Sending an enquiry does not charge you or confirm a paid collaboration. Official payment and payout setup is pending.</p></section>{(!details.postType || details.postType === 'offering') && <><label className="field-wrap"><span>Preferred collaboration date and time</span><input className="field" type="datetime-local" value={introSlot} min={new Date().toISOString().slice(0, 16)} onChange={event => setIntroSlot(event.target.value)} /></label><button className="btn btn-primary full" onClick={continueAction} disabled={busy || !introSlot || Boolean(sentEnquiryId)}>{busy ? <UserBusyLabel>Sending…</UserBusyLabel> : sentEnquiryId ? 'Enquiry sent' : 'Send collaboration enquiry'}</button></>}</>
    : <><h3>Expertise</h3>{profile.qualificationName && <p>Qualification provided: {profile.qualificationName}</p>}{provider.experience_years > 0 && <p>{provider.experience_years} years of reported experience</p>}{provider.languages?.filter(Boolean).length > 0 && <p>Languages: {provider.languages.filter(Boolean).join(', ')}</p>}{details.mode && <p>Published mode: {details.mode}</p>}{details.duration && <p>Published session length: {details.duration} minutes</p>}<section className="payment-breakdown"><b>Consultation enquiry</b><p>{details.totalPaise != null ? `Listed estimate: ₹${(Number(details.totalPaise) / 100).toLocaleString('en-IN')}` : 'A price is not available for payment yet.'}</p><p>This request is unpaid. A five-minute session, paid consultation and official payment require separate confirmed setup.</p></section>{(!details.postType || details.postType === 'offering') && <><label className="field-wrap"><span>Preferred consultation date and time</span><input className="field" type="datetime-local" value={introSlot} min={new Date().toISOString().slice(0, 16)} onChange={event => setIntroSlot(event.target.value)} /></label><button className="btn btn-primary full" onClick={continueAction} disabled={busy || !introSlot || Boolean(sentEnquiryId)}>{busy ? <UserBusyLabel>Sending…</UserBusyLabel> : sentEnquiryId ? 'Enquiry sent' : 'Send consultation enquiry'}</button></>}</>}
    <RoleSections role={role} providers={[]} onOpen={() => {}} notify={notify} vendor={provider} /></>;
}

function RoleSections({ role, providers, onOpen, notify, vendor }) {
  const steps = role === 'influencer' ? [['Review the package', 'Check deliverables, schedule, usage rights and the listed estimate.'], ['Send an enquiry', 'Your request reaches the selected approved influencer. No payment is taken.'], ['Discuss the scope', 'Both sides can review the saved request and its status.'], ['Payment setup pending', 'A paid collaboration cannot start until official payment and payout handling is configured.']] : [['Review the offering', 'Check the selected consultant, field and listed estimate.'], ['Send an enquiry', 'Choose a preferred time; only the selected consultant receives this unpaid request.'], ['Track the response', 'Both sides can see the saved request and its current status.'], ['Payment setup pending', 'A paid consultation or five-minute session is not confirmed by this enquiry.']];
  const related = role === 'influencer' ? ['Reel collaboration', 'Story package', 'YouTube campaign', 'Brand content'] : ['Online consultation', 'Offline consultation', 'Other published consultants'];
  return <><Carousel title="Alternatives & related offerings">{related.map(item => <article className="related-card" key={item}><b>{item}</b></article>)}</Carousel><section className="experience-section"><h2>Our Process</h2><ol className="process-timeline">{steps.map(([title, text]) => <li key={title}><b>{title}</b><p>{text}</p></li>)}</ol></section><section className="experience-section promises-card"><h2>Eazily Promises</h2><p>Clear terms and charges before confirmation.</p><p>Customer approval for scope or cost changes.</p><p>Official payment setup is pending; do not pay a personal account.</p></section><Carousel title={vendor ? `Other Top ${role === 'influencer' ? 'Influencers' : 'Consultants'}` : `Top ${role === 'influencer' ? 'Influencers' : 'Consultants'}`}>{providers.filter(item => item.id !== vendor?.id).map(item => <VendorCard key={item.id} vendor={item} onOpen={onOpen} />)}</Carousel><section className="experience-section"><h2>Frequently Asked Questions</h2>{['What is included?', 'How is pricing confirmed?', 'How do cancellations work?', 'What happens if there is a dispute?', 'How can I contact support?'].map(question => <details className="faq-row" key={question}><summary>{question}</summary><p>Published role-specific terms will appear here before confirmation.</p></details>)}</section><section className="experience-section"><h2>Customer Reviews</h2><p>Genuine reviews from completed Eazily {role === 'influencer' ? 'collaborations' : 'consultations'} will appear here.</p><button className="btn btn-outline">View All Reviews</button></section><section className="experience-section share-card"><h2>Share this experience with your loved ones</h2><p>Found an offering worth sharing? Send it to friends and family.</p><button className="btn btn-outline" onClick={() => shareLink(location.href, notify, true)}>Copy Link</button></section></>;
}
