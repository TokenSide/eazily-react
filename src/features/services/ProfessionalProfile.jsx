import { useEffect, useState } from 'react';
import { translate } from '../../lib/translate.js';
import { EmptyState, Sheet } from '../../components/Ui.jsx';
import Icon from '../../components/Icon.jsx';
import { experienceLink, shareLink } from '../../services/experience.js';
import { getCustomerProfessionalFullImage, getCustomerProfessionalMedia, getCustomerProfessionalReviews } from '../../services/marketplace.js';

const money = value => value == null ? null : `₹${Number(value).toLocaleString('en-IN')}`;
const nameOf = vendor => vendor.display_name || vendor.business_name || 'Professional';

function Stat({ value, label }) {
  if (value == null || value === '') return null;
  return <div className="professional-stat"><b>{translate(value)}</b><small>{translate(label)}</small></div>;
}

function ProfilePhoto({ url, name }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) return <div className="professional-profile-photo fallback"><Icon name="person" size={42} /></div>;
  return <img className="professional-profile-photo" src={url} alt={name} onError={() => setBroken(true)} />;
}

export default function ProfessionalProfile({ vendor, service, vendors, policy, saved, onSave, onBook, onMessage, onVendor, notify, onClose }) {
  const [media, setMedia] = useState({ photo: vendor.photo_url || null, portfolio: [] });
  const [reviews, setReviews] = useState([]);
  const [viewer, setViewer] = useState(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([getCustomerProfessionalMedia(vendor), getCustomerProfessionalReviews(vendor, service.serviceName)])
      .then(([nextMedia, nextReviews]) => {
        if (!active) return;
        setMedia(nextMedia);
        setReviews(nextReviews);
      }).catch(error => notify(error.message));
    return () => { active = false; };
  }, [vendor, service.serviceName, notify]);
  async function openImage(item) {
    setViewerLoading(true);
    setViewer({ src: item.thumbnail, alt: `${nameOf(vendor)} past work` });
    const src = await getCustomerProfessionalFullImage(item.media);
    setViewer(current => current ? { ...current, src: src || current.src } : current);
    setViewerLoading(false);
  }
  const selectedPrice = vendor.prices?.[service.serviceName] ?? vendor.starting_price;
  const alternatives = vendors.filter(item => item.id !== vendor.id).slice(0, 4);
  const reviewCount = Number(vendor.review_count || reviews.length || 0);
  const url = experienceLink(service, vendor.id);
  return <>
    <Sheet className="vendor-sheet professional-profile-sheet" onClose={onClose}>
      <div className="professional-profile">
        <header className="professional-profile-hero">
          <ProfilePhoto url={media.photo} name={nameOf(vendor)} />
          <div className="professional-profile-title">
            {vendor.demo && <span className="sample-label">{translate('Demo profile · Sample data')}</span>}
            <h2>{translate(nameOf(vendor))}</h2>
            {vendor.business_name && vendor.business_name !== vendor.display_name && <p>{translate(vendor.business_name)}</p>}
            <p className="professional-service-category">{translate(service.serviceName)}</p>
            {!vendor.demo && vendor.document_verified_at && <span className="verified-label"><Icon name="check" size={13} /> {translate('Identity documents verified')}</span>}
            {vendor.specialisation && <p>{translate(vendor.specialisation)}</p>}
          </div>
        </header>

        <div className="professional-stat-grid">
          <Stat value={reviewCount && Number.isFinite(Number(vendor.rating)) ? `★ ${Number(vendor.rating).toFixed(1)}` : null} label={`${reviewCount} ${vendor.demo ? 'sample' : 'genuine'} review${reviewCount === 1 ? '' : 's'}`} />
          <Stat value={vendor.experience_years > 0 ? `${vendor.experience_years} yrs` : null} label="Experience" />
          <Stat value={vendor.completed_jobs > 0 ? vendor.completed_jobs : null} label="Completed Eazily jobs" />
          <Stat value={vendor.expected_response_minutes > 0 ? `~${vendor.expected_response_minutes} min` : null} label="Typical response" />
        </div>

        <section className="professional-profile-section service-summary-card">
          <span className="eyebrow">{translate('Selected service')}</span>
          <h3>{translate(service.serviceName)}</h3>
          <div className="service-price-line"><span>{translate(vendor.pricing_type || 'Service price')}</span><b>{translate(selectedPrice == null ? 'Request a quote' : `${vendor.pricing_type === 'Starting Price' ? 'From ' : ''}${money(selectedPrice)}`)}</b></div>
          {vendor.visiting_charge != null && <div className="service-price-line"><span>{translate('Visiting charge')}</span><b>{translate(money(vendor.visiting_charge))}</b></div>}
        </section>

        <section className="professional-profile-section">
          <h3>{translate('Availability & service area')}</h3>
          <div className="professional-facts">
            <p><Icon name="clock" size={17} /><span><b>{translate(vendor.available_now ? 'Online · Available now' : vendor.availability || 'Availability by confirmation')}</b>{vendor.expected_response_minutes > 0 && <small>{translate('Response time is calculated from completed booking activity.')}</small>}</span></p>
            {(vendor.distance || vendor.city || vendor.coverage?.length) && <p><Icon name="location" size={17} /><span><b>{translate([vendor.distance, vendor.city].filter(Boolean).join(' · '))}</b><small>{translate((vendor.coverage || []).join(', '))}</small></span></p>}
          </div>
        </section>

        {vendor.description && <section className="professional-profile-section"><h3>{translate('About professional')}</h3><p>{translate(vendor.description)}</p></section>}
        {(vendor.languages?.length || vendor.qualifications?.length) && <section className="professional-profile-section professional-details-grid">
          {vendor.languages?.length > 0 && <div><h3>{translate('Languages')}</h3><p>{translate(vendor.languages.join(', '))}</p></div>}
          {vendor.qualifications?.length > 0 && <div><h3>{translate('Partner-reported qualifications')}</h3><p>{translate(vendor.qualifications.join(', '))}</p></div>}
        </section>}

        {vendor.reported_skills?.length > 0 && <section className="professional-profile-section"><h3>{translate('Partner-selected skills')}</h3><p>{translate(vendor.reported_skills.join(', '))}</p></section>}

        <section className="professional-profile-section">
          <h3>{translate('Services offered')}</h3>
          <div className="professional-service-list">{(vendor.service_names || [service.serviceName]).map(name => <div key={name}><span>{translate(name)}</span><b>{translate(vendor.prices?.[name] == null ? 'Request a quote' : money(vendor.prices[name]))}</b></div>)}</div>
        </section>

        <section className="professional-profile-section">
          <h3>{translate('Past Work')}</h3>
          {media.portfolio.length ? <div className="professional-portfolio-grid">{media.portfolio.map((item, index) => <button type="button" key={`${item.thumbnail}-${index}`} onClick={() => openImage(item)} aria-label={`Open past work image ${index + 1}`}><img src={item.thumbnail} alt={`${nameOf(vendor)} past work ${index + 1}`} loading="lazy" /></button>)}</div> : <EmptyState title="No approved work photos yet" text="Approved portfolio photos will appear here when this professional publishes them." />}
        </section>

        <section className="professional-profile-section">
          <h3>{translate('Customer Reviews')}</h3>
          {vendor.demo && <span className="sample-label">{translate('Sample reviews')}</span>}
          {reviews.length ? <div className="professional-reviews">{reviews.slice(0, 6).map(review => <article key={review.id}><b>{translate(`${review.customer_display_name || 'Eazily customer'} · ${'★'.repeat(review.rating)}`)}</b><small>{translate(new Date(review.created_at).toLocaleDateString())}{!vendor.demo && translate(' · Verified booking')}</small><p>{translate(review.review_text || review.body)}</p></article>)}</div> : <EmptyState title="No customer reviews yet" text="Reviews appear only after a completed Eazily booking." />}
        </section>

        <section className="professional-profile-section"><h3>{translate('Pricing information')}</h3><p>{translate('The professional confirms the scope, any visit charge, and final price before work begins.')}</p>{(policy?.cancellation_policy || vendor.cancellation_policy) && <p>{translate(policy?.cancellation_policy || vendor.cancellation_policy)}</p>}</section>
        <section className="professional-profile-section"><h3>{translate('Other Professionals You May Like')}</h3>{alternatives.length ? <div className="professional-alternatives">{alternatives.map(item => <button type="button" key={item.id} onClick={() => onVendor(item)}><span><b>{translate(nameOf(item))}</b><small>{translate(item.review_count ? `★ ${item.rating} · ${item.review_count} reviews` : 'No reviews yet')}</small></span><Icon name="chevronRight" size={17} /></button>)}</div> : <p className="profile-empty-copy">{translate('No other approved professionals are available for this service in your location yet.')}</p>}</section>
        <section className="professional-profile-section"><h3>{translate('Our Process')}</h3><ol className="process-timeline">{[['Choose your professional', `${service.serviceName} stays selected for this booking.`], ['Describe the requirement', 'Add your location, preferred date, and service details.'], ['Confirm scope and price', 'Review applicable visit charges and approve the final scope before work begins.'], ['Complete and review', 'Track the booking and review only after the service is completed.']].map(([title, text]) => <li key={title}><b>{translate(title)}</b><p>{translate(text)}</p></li>)}</ol></section>
        <section className="professional-profile-section promises-card"><h3>{translate('Eazily Promises')}</h3>{[['rupee', 'Clear charges'], ['check', 'Customer approval before added work'], ['shield', 'Official booking records'], ['message', 'Booking support']].map(([icon, text]) => <div className="promise-line" key={text}><Icon name={icon} /><p><b>{translate(text)}</b></p></div>)}</section>

        <section className="professional-profile-section share-card"><h3>{translate('Share this professional')}</h3><div className="review-actions"><button className="btn btn-outline" onClick={() => shareLink(url, notify)}>{translate('Share')}</button><button className="btn btn-outline" onClick={() => shareLink(url, notify, true)}>{translate('Copy Link')}</button></div></section>
        <div className="professional-profile-actions"><button className="btn btn-outline" onClick={onSave}>{translate(saved ? 'Saved · Remove' : 'Save professional')}</button>{vendor.partner_role && <button className="btn btn-outline" onClick={() => onMessage(vendor.partner_id || vendor.id)}>{translate('Message')}</button>}</div>
      </div>
      <footer className="vendor-booking-footer professional-booking-footer"><button className="btn btn-primary full" onClick={onBook}>{translate('Book Now')}</button></footer>
    </Sheet>
    {viewer && <Sheet className="portfolio-viewer-sheet" onClose={() => setViewer(null)}><div className="portfolio-viewer"><img src={viewer.src} alt={viewer.alt} />{viewerLoading && <small>{translate('Loading full image…')}</small>}<button className="btn btn-outline" onClick={() => setViewer(null)}>{translate('Close image')}</button></div></Sheet>}
  </>;
}
