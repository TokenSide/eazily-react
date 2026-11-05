import { useEffect, useRef, useState } from 'react';

export default function PartnerBannerCarousel({ role, banners, trial, application, setRoute, setSheet }) {
  const [index, setIndex] = useState(0), [paused, setPaused] = useState(false);
  const [interacting, setInteracting] = useState(false);
  const [visible, setVisible] = useState(true);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const carouselRef = useRef(null);
  const touchStart = useRef(null);
  const approvalDate = trial?.approval_started_at || application.reviewed_at;
  const trusted = application.status === 'approved' && approvalDate && !trial?.approval_date_missing;
  const trialEnd = trusted ? (trial?.approval_started_at ? trial.trial_ends_at : new Date(new Date(approvalDate).getTime() + 60 * 86400000).toISOString()) : null;
  const eligible = trusted && trialEnd && Date.parse(trialEnd) <= Date.now() && trial?.status === 'active' && trial.current_period_end && Date.parse(trial.current_period_end) > Date.now();
  const eligibleBanners = eligible ? banners.filter(banner => banner.role === role).slice(0, 4) : [];
  const hasBanners = eligibleBanners.length > 0;
  const activeIndex = index < eligibleBanners.length ? index : 0;
  useEffect(() => { if (index >= eligibleBanners.length) setIndex(0); }, [eligibleBanners.length, index]);
  useEffect(() => {
    const update = () => setPageVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(() => {
    if (!carouselRef.current || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.2 });
    observer.observe(carouselRef.current);
    return () => observer.disconnect();
  }, [hasBanners]);
  useEffect(() => {
    if (paused || interacting || !visible || !pageVisible || eligibleBanners.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const timer = window.setInterval(() => setIndex(current => (current + 1) % eligibleBanners.length), 6000);
    return () => window.clearInterval(timer);
  }, [eligibleBanners.length, paused, interacting, visible, pageVisible]);
  if (!eligibleBanners.length) return null;
  const banner = eligibleBanners[activeIndex];
  function action() {
    const actions = { subscription: () => setSheet('Subscription'), training: () => setSheet('Training'), post: () => setSheet('post'), orders: () => setRoute('orders'), profile: () => setRoute('profile'), support: () => setSheet('Help & Support') };
    actions[banner.action_kind]?.();
  }
  function swipe(event) {
    const distance = event.changedTouches[0].clientX - (touchStart.current ?? event.changedTouches[0].clientX);
    if (Math.abs(distance) > 45) setIndex(current => (current + (distance < 0 ? 1 : eligibleBanners.length - 1)) % eligibleBanners.length);
    touchStart.current = null; setInteracting(false);
  }
  return <section ref={carouselRef} className={`partner-banner-carousel role-${role}`} onMouseEnter={() => setInteracting(true)} onMouseLeave={() => setInteracting(false)} onTouchStart={event => { touchStart.current = event.touches[0].clientX; setInteracting(true); }} onTouchEnd={swipe} onTouchCancel={() => { touchStart.current = null; setInteracting(false); }} aria-roledescription="carousel" aria-label="Partner campaigns"><div className="partner-banner-content">{banner.image_url && <img src={banner.image_url} alt={banner.image_alt || banner.headline} />}{banner.sponsored && <span className="partner-banner-sponsored">Sponsored</span>}<div><h2>{banner.headline}</h2><p>{banner.supporting_line}</p><button className="btn btn-white" onClick={action}>{banner.action_label}</button></div></div>{eligibleBanners.length > 1 && <div className="partner-banner-controls"><button type="button" onClick={() => setPaused(current => !current)}>{paused ? 'Play' : 'Pause'}</button><div>{eligibleBanners.map((item, itemIndex) => <button type="button" key={item.id} className={itemIndex === activeIndex ? 'active' : ''} aria-label={`Show campaign ${itemIndex + 1}`} onClick={() => setIndex(itemIndex)} />)}</div></div>}</section>;
}
