import { useEffect, useRef, useState } from 'react';
import { translate } from '../../lib/translate.js';
import { catalog } from '../../data/catalog.js';
import { displayInfluencerCategory } from '../../data/influencerCategories.js';
import { displayConsultantCategory } from '../../data/consultantCategories.js';
import { EmptyState, Sheet } from '../../components/Ui.jsx';
import Icon from '../../components/Icon.jsx';
import ServiceIllustration from '../user-art/ServiceIllustration.jsx';
import { UserVendorSkeleton } from '../user-motion/UserLoading.jsx';
import { experienceLink, readRows, requireBackend, serviceNamesForLookup, shareLink } from '../../services/experience.js';
import { getCustomerProfessionals } from '../../services/marketplace.js';
import { useRealtime } from '../../lib/realtime.jsx';
import { getDemoCustomerProfessionals } from './customerProfessionalDemo.js';
import ProfessionalProfile from './ProfessionalProfile.jsx';
import './professional-profile.css';
import './professional-profile-sticky.css';

function VendorAvatar({ photoUrl, name }) {
  const [broken, setBroken] = useState(false);
  if (!photoUrl || broken) return <Icon name="person" size={40} />;
  return <img className="avatar" src={photoUrl} alt={name} onError={() => setBroken(true)} />;
}

export function Carousel({ title, children }) {
  const rail = useRef(null);
  return <section className="experience-section"><div className="section-head"><h2>{translate(title)}</h2><div className="rail-controls"><button aria-label={`Previous ${title}`} onClick={() => rail.current.scrollBy({ left: -260, behavior: 'smooth' })}>←</button><button aria-label={`Next ${title}`} onClick={() => rail.current.scrollBy({ left: 260, behavior: 'smooth' })}>→</button></div></div><div ref={rail} className="experience-rail">{children}</div></section>;
}

export function VendorCard({ vendor, onOpen }) {
  const name = vendor.display_name || vendor.business_name || 'Professional';
  const specialisation = vendor.partner_role === 'influencer'
    ? [vendor.specialisation || null, ...(vendor.service_names || [])].filter(Boolean).map(displayInfluencerCategory).filter((item, index, items) => items.indexOf(item) === index).join(', ')
    : vendor.partner_role === 'consultant'
      ? [[...new Set((vendor.service_names || []).map(displayConsultantCategory))].join(', '), vendor.specialisation].filter(Boolean).join(' · ')
    : vendor.specialisation || vendor.service_names?.join(', ');
  return <article className="vendor-card"><div className="pro-top">{<VendorAvatar photoUrl={vendor.photo_url} name={name} />}<div><h3>{translate(name)}</h3>{vendor.business_name && vendor.business_name !== vendor.display_name && <p>{translate(vendor.business_name)}</p>}{vendor.demo ? <span className="sample-label">{translate('Demo profile')}</span> : vendor.document_verified_at && <span className="chip">{translate('Document verified')}</span>}</div></div>{specialisation && <p>{translate(specialisation)}</p>}<p>{translate(vendor.review_count ? `★ ${vendor.rating} · ${vendor.review_count} reviews` : 'No reviews yet')}{vendor.experience_years > 0 && translate(` · ${vendor.experience_years} years`)}</p><p>{translate(vendor.starting_price == null ? 'Request a Quote' : `From ₹${vendor.starting_price}`)}{vendor.available_now != null ? translate(` · ${vendor.available_now ? 'Online now' : 'Offline now'}`) : vendor.availability && translate(` · ${vendor.availability}`)}</p>{onOpen && <button className="btn btn-outline full" onClick={() => onOpen(vendor)}>{translate('View Profile')}</button>}</article>;
}

function Reviews({ service, notify }) {
  const { revision } = useRealtime();
  const [rows, setRows] = useState([]);
  const [limit, setLimit] = useState(3);
  const [all, setAll] = useState(false);
  const [rating, setRating] = useState('All');
  const [sort, setSort] = useState('newest');
  useEffect(() => {
    let active = true;
    readRows('customer_reviews', query => query.eq('service_name', service.serviceName).limit(100)).then(data => { if (active) setRows(data); }).catch(error => notify(error.message));
    return () => { active = false; };
  }, [service.serviceName, notify, revision]);
  const filtered = rows.filter(review => rating === 'All' || review.rating === Number(rating)).sort((a, b) => sort === 'highest' ? b.rating - a.rating : new Date(b.created_at) - new Date(a.created_at));
  const render = items => items.map(review => <article className="review-item" key={review.id}><b>{translate(`${review.customer_display_name} · ${'★'.repeat(review.rating)}`)}</b><small>{translate(new Date(review.created_at).toLocaleDateString())}{review.verified_booking && translate(' · Verified booking')}</small><p>{translate(review.review_text)}</p>{(review.authorised_photos || []).map(url => <img key={url} src={url} alt="Customer service result" loading="lazy" />)}</article>);
  return <><section className="experience-section"><h2>{translate('Customer Reviews')}</h2><p>{translate(rows.length ? `${(rows.reduce((sum, row) => sum + row.rating, 0) / rows.length).toFixed(1)} / 5 · ${rows.length} reviews` : 'No customer reviews for this service yet.')}</p>{render(rows.slice(0, limit))}</section><section className="review-actions">{limit < rows.length && <button className="btn btn-outline" onClick={() => setLimit(value => value + 3)}>{translate('Show More')}</button>}<button className="btn btn-outline" onClick={() => setAll(true)}>{translate('View All Reviews')}</button></section>{all && <Sheet onClose={() => setAll(false)}><h2>{translate('All Reviews')}</h2><div className="vendor-filters"><label>{translate('Rating ')}<select value={rating} onChange={event => setRating(event.target.value)}>{['All', '5', '4', '3', '2', '1'].map(value => <option key={value}>{translate(value)}</option>)}</select></label><label>{translate('Sort ')}<select value={sort} onChange={event => setSort(event.target.value)}><option value="newest">{translate('Newest')}</option><option value="highest">{translate('Highest rating')}</option></select></label></div>{filtered.length ? render(filtered) : <EmptyState title="No matching reviews" text="Reviews will appear after customers share their experiences." />}</Sheet>}</>;
}

export function ServiceSections({ service, vendors, onService, onVendor, notify, policy }) {
  const group = catalog.find(category => category.id === service.categoryId)?.groups?.find(item => item.items.includes(service.serviceName));
  const related = service.serviceName === 'Plumber' ? ['Tap repair', 'Leakage repair', 'Basin installation', 'Drain cleaning'] : (group?.items || []).filter(name => name !== service.serviceName).slice(0, 6);
  const url = experienceLink(service);
  const questions = ['What is included?', 'Are materials charged separately?', 'Is there a visit or inspection charge?', 'How is the final price confirmed?', 'How do rescheduling and cancellation work?', 'How can I contact support?', 'Is a warranty available for this service?'];
  const alternatives = vendors.filter(item => item.review_count > 0).sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0)).slice(0, 6);
  return <>
    <Carousel title="Alternatives & related services">{related.length ? related.map(name => <button className="related-card" key={name} onClick={() => onService({ ...service, serviceName: service.serviceName === 'Plumber' ? 'Plumber' : name, requirement: name })}><ServiceIllustration name={name} /><b>{translate(name)}</b><small>{translate('Explore available professionals')}</small></button>) : <p>{translate('No related services listed yet.')}</p>}</Carousel>
    <section className="experience-section"><h2>{translate('Our Process')}</h2><ol className="process-timeline">{[['Tell us what you need', `Choose ${service.serviceName} and send a booking request.`], [policy?.fixed_price ? 'Review the service price' : 'Assessment & price confirmation', policy?.fixed_price ? 'Review the listed scope and price before confirming.' : 'Your professional reviews the requirement. Any visit or inspection charge must be shown before confirmation.'], ['Approve the work', 'Review the scope and price before work begins. Additional work or charges need your approval.'], ['Service completion & cleanup', 'Your professional completes the agreed service and leaves the work area clean where applicable.'], ['Booking support', 'Access support from your booking.']].map(([title, text]) => <li key={title}><b>{translate(title)}</b><p>{translate(text)}</p></li>)}</ol></section>
    <section className="experience-section promises-card"><h2>{translate('Eazily Promises')}</h2>{[['rupee', 'Clear charges', 'See applicable pricing before confirmation.'], ['check', 'Customer approval', 'Approve any additional work or cost.'], ['person', 'Professional conduct', 'Providers are expected to maintain hygiene and respectful behaviour.'], ['message', 'Booking support', 'Get help with service-related concerns.']].map(([icon, title, text]) => <div className="promise-line" key={title}><Icon name={icon} /><p><b>{translate(title)}</b><br />{translate(text)}</p></div>)}</section>
    <Carousel title={`Top ${service.serviceName === 'Plumber' || service.categoryId === 'manpower' && ['home-property', 'electronics', 'vehicle'].includes(group?.id) ? 'Technicians' : 'Professionals'}`}>{alternatives.length ? alternatives.map(item => <VendorCard vendor={item} onOpen={onVendor} key={item.id} />) : <p>{translate('No rated professionals available in this location yet.')}</p>}</Carousel>
    <section className="experience-section"><h2>{translate('Frequently Asked Questions')}</h2>{questions.map((question, index) => <details className="faq-row" key={question}><summary>{translate(question)}</summary><p>{translate(policy?.faq?.[index] || 'This service policy has not been published yet. Ask for these details before confirming a booking.')}</p></details>)}</section>
    <Reviews service={service} notify={notify} />
    <section className="experience-section share-card"><h2>{translate('Share this experience with your loved ones')}</h2><p>{translate('Found a service worth sharing? Send it to your friends and family.')}</p><div className="review-actions"><button className="btn btn-primary" onClick={() => shareLink(url, notify)}>{translate('Share')}</button><button className="btn btn-outline" onClick={() => shareLink(url, notify, true)}>{translate('Copy Link')}</button><a href={`https://wa.me/?text=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer">{translate('WhatsApp')}</a></div><input className="field" readOnly aria-label="Experience link" value={url} /></section>
  </>;
}

export default function ServiceExperience({ service, vendor, setVendor, onService, onBook, onMessage, onBack, onCloseVendor, location, setLocation, notify, demoMode = false }) {
  const { revision } = useRealtime();
  const [vendors, setVendors] = useState([]);
  const [policy, setPolicy] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sort, setSort] = useState('rating');
  const [available, setAvailable] = useState(false);
  const [minRating, setMinRating] = useState('0');
  const [showAll, setShowAll] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const serviceNames = serviceNamesForLookup(service.serviceName);
    Promise.all([demoMode ? Promise.resolve([]) : getCustomerProfessionals(service.serviceName, location), getDemoCustomerProfessionals(service.serviceName, location, demoMode), demoMode ? Promise.resolve([]) : readRows('service_policies', query => query.in('service_name', serviceNames).limit(serviceNames.length))]).then(([professionals, samples, policies]) => {
      if (!active) return;
      setVendors([...professionals, ...samples]);
      setPolicy(policies.find(item => item.service_name === service.serviceName) || policies[0] || null);
      setLoading(false);
    }).catch(nextError => { if (active) { setError(nextError.message); setLoading(false); } });
    return () => { active = false; };
  }, [service.serviceName, location, revision, demoMode]);
  useEffect(() => {
    if (!vendor) return undefined;
    if (vendor.demo) { setSaved(false); return undefined; }
    let active = true;
    const table = vendor.partner_role ? 'saved_partner_profiles' : 'saved_vendors';
    const column = vendor.partner_role ? 'post_id' : 'vendor_id';
    readRows(table, query => query.eq(column, vendor.id)).then(rows => { if (active) setSaved(rows.length > 0); }).catch(error => notify(error.message));
    return () => { active = false; };
  }, [vendor, notify]);
  async function save() {
    if (vendor.demo) { setSaved(value => !value); return; }
    try {
      const db = requireBackend();
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error('Sign in to save professionals.');
      const table = vendor.partner_role ? 'saved_partner_profiles' : 'saved_vendors';
      const column = vendor.partner_role ? 'post_id' : 'vendor_id';
      const response = saved ? await db.from(table).delete().eq(column, vendor.id).eq('customer_id', user.id) : await db.from(table).insert({ [column]: vendor.id, customer_id: user.id });
      if (response.error) throw response.error;
      setSaved(value => !value);
    } catch (saveError) { notify(saveError.message); }
  }
  const main = catalog.find(category => category.id === service.categoryId);
  const group = main?.groups?.find(item => item.items.includes(service.serviceName));
  const matches = vendors.filter(item => (!available || item.available_now) && Number(item.rating || 0) >= Number(minRating)).sort((a, b) => sort === 'price' ? (a.starting_price ?? Infinity) - (b.starting_price ?? Infinity) : Number(b.rating || 0) - Number(a.rating || 0));
  const visibleMatches = showAll ? matches : matches.slice(0, 3);
  return <main className="screen service-experience user-art-service"><header className="topbar"><button className="icon-btn" onClick={onBack} aria-label="Back to categories"><Icon name="arrowLeft" /></button><h1>{translate(service.serviceName)}</h1></header><div className="experience-body"><nav className="crumb" aria-label="Breadcrumb">{translate('Categories → ')}{translate(main?.label)} {group && translate(`→ ${group.label}`)}{translate(` → ${service.serviceName} → Available professionals`)}</nav><label className="field-wrap">{translate('Service city ')}<input className="field" value={location} onChange={event => setLocation(event.target.value)} placeholder="Enter city as listed by the professional" /></label><h2>{translate(`Available ${service.serviceName === 'Plumber' ? 'Plumbers' : 'Professionals'}`)}</h2>{service.requirement && <p>{translate(`Requirement: ${service.requirement}`)}</p>}<div className="vendor-filters"><label>{translate('Sort ')}<select value={sort} onChange={event => setSort(event.target.value)}><option value="rating">{translate('Highest rated')}</option><option value="price">{translate('Lowest starting price')}</option></select></label><label>{translate('Rating ')}<select value={minRating} onChange={event => setMinRating(event.target.value)}><option value="0">{translate('All ratings')}</option><option value="4">{translate('4+ stars')}</option><option value="4.5">{translate('4.5+ stars')}</option></select></label><label><input type="checkbox" checked={available} onChange={event => setAvailable(event.target.checked)} />{translate(' Available now')}</label></div>{loading ? <UserVendorSkeleton count={2} /> : error ? <p role="alert">{translate(`Could not load professionals: ${error}`)}</p> : matches.length ? <><div className="vendor-list">{visibleMatches.map(item => <VendorCard key={item.id} vendor={item} onOpen={setVendor} />)}</div>{matches.length > 3 && <button className="btn btn-outline" onClick={() => setShowAll(value => !value)}>{translate(showAll ? 'Show fewer professionals' : `See all ${matches.length} professionals`)}</button>}</> : <EmptyState title="No matching professionals yet" text="Try another city or filter. Only approved, active professionals who provide this service appear here." />}<ServiceSections service={service} vendors={vendors} onService={onService} onVendor={setVendor} notify={notify} policy={policy} /></div>{vendor && <ProfessionalProfile vendor={vendor} service={service} vendors={matches} policy={policy} saved={saved} onSave={save} onMessage={onMessage} onVendor={setVendor} notify={notify} onClose={onCloseVendor || (() => setVendor(null))} onBook={() => onBook({ ...service, vendorId: vendor.partner_id ? null : vendor.id, partnerPostId: vendor.partner_id ? vendor.id : null, vendorName: vendor.display_name || vendor.business_name, fixedPrice: policy?.fixed_price ? vendor.prices?.[service.serviceName] : null, startingPrice: vendor.starting_price, visitingCharge: vendor.visiting_charge, demo: Boolean(vendor.demo) })} />}</main>;
}
