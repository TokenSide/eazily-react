import { translate } from "../../lib/translate.js";
import { useEffect, useRef, useState } from "react";
import Icon from "../../components/Icon.jsx";
import { BottomNav, Field, Sheet } from "../../components/Ui.jsx";
import { heroSlides, promiseItems, topServices } from "../../data/userExperience.js";
import { getActiveServiceCatalogue, getCurrentProfile, getNearbyCustomerProfessionals } from '../../services/marketplace.js';
import { ReferralCard } from '../account/CustomerAccount.jsx';
import ServiceIllustration from '../user-art/ServiceIllustration.jsx';
import { firstHomeHeroArtwork, homeHeroArtwork } from './homeHeroArtwork.js';
import { UserVendorSkeleton } from '../user-motion/UserLoading.jsx';
import './home-carousel.css';
import { mergeServicePool, nextServiceStart, serviceWindow } from './moreServiceRotation.js';
import { getDemoNearbyCustomerProfessionals } from '../services/customerProfessionalDemo.js';
const moreHomeServices = topServices.filter(service => !['Electrician', 'AC Service'].includes(service.name));
const bulkTickerMessage = 'Office, society ya event? • Multiple services ek saath • Apni requirement bhejein';
function ProviderPhoto({ url, name }) {
  const [broken, setBroken] = useState(false);
  if (!url || broken) return <Icon name="person" size={42} />;
  return <img src={url} alt={name} loading="lazy" onError={() => setBroken(true)} />;
}

function HomeProviderCarousel({ providers, loading, onOpen, motionReduced }) {
  const count = providers.length;
  const providerIds = providers.map(provider => provider.id).join('|');
  const slides = count > 1 ? [providers[count - 1], ...providers, providers[0]] : providers;
  const [index, setIndex] = useState(count > 1 ? 1 : 0);
  const [transitioning, setTransitioning] = useState(true);
  const [drag, setDrag] = useState(0);
  const start = useRef(null), paused = useRef(false), suppressClick = useRef(false);
  useEffect(() => { setTransitioning(false); setIndex(count > 1 ? 1 : 0); setDrag(0); }, [count, providerIds]);
  useEffect(() => {
    if (count <= 1 || motionReduced) return undefined;
    const timer = window.setInterval(() => { if (!paused.current && !document.hidden) { setTransitioning(true); setIndex(value => value + 1); } }, 3800);
    return () => window.clearInterval(timer);
  }, [count, motionReduced]);
  const finish = event => {
    if (start.current == null) return;
    const movement = event.clientX - start.current;
    suppressClick.current = Math.abs(movement) > 8;
    setDrag(0); start.current = null; paused.current = false;
    if (Math.abs(movement) > 38) { setTransitioning(true); setIndex(value => value + (movement < 0 ? 1 : -1)); }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    window.setTimeout(() => { suppressClick.current = false; }, 60);
  };
  const current = count ? (index - 1 + count) % count : 0;
  if (loading) return <UserVendorSkeleton count={1} rail />;
  if (!count) return null;
  return <div className="home-provider-carousel"><div className="home-provider-viewport" onPointerDown={event => { start.current = event.clientX; paused.current = true; }} onPointerMove={event => { if (start.current == null) return; const movement = event.clientX - start.current; if (Math.abs(movement) > 8 && !event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.setPointerCapture(event.pointerId); setDrag(movement); }} onPointerUp={finish} onPointerCancel={finish}><div className={`home-provider-track${transitioning ? ' is-moving' : ''}`} style={{ transform: `translate3d(calc(${-index * 100}% + ${index * 30 + drag}px),0,0)` }} onTransitionEnd={() => { if (index === 0) { setTransitioning(false); setIndex(count); } else if (index === count + 1) { setTransitioning(false); setIndex(1); } }}>{slides.map((provider, slideIndex) => { const name = provider.display_name || provider.business_name || 'Professional'; const service = provider.selected_service || provider.service_names?.[0] || 'Home service'; return <article className="home-provider-card" key={`${provider.id}-${slideIndex}`} onClick={() => { if (!suppressClick.current) onOpen(provider); }}><div className="home-provider-photo"><ProviderPhoto url={provider.photo_url} name={name} />{provider.demo && <span>Demo profile</span>}</div><div className="home-provider-details"><small>{translate(service)}</small><h3>{translate(name)}</h3><div className="home-provider-facts"><span>★ {Number(provider.rating || 0).toFixed(1)}</span>{provider.experience_years > 0 && <span>{provider.experience_years} Years</span>}<span>{provider.starting_price == null ? 'Request a quote' : `From ₹${provider.starting_price}`}</span>{(provider.city || provider.coverage?.[0]) && <span><Icon name="location" size={13} />{translate(provider.city || provider.coverage[0])}</span>}</div><button type="button" className="btn btn-outline full" onClick={event => { event.stopPropagation(); onOpen(provider); }}>View Profile</button></div></article>; })}</div></div>{count > 1 && <div className="home-provider-dots" aria-label="Provider slides">{providers.map((provider, dot) => <button type="button" key={provider.id} className={dot === current ? 'active' : ''} aria-label={`Show provider ${dot + 1}`} onClick={() => { setTransitioning(true); setIndex(dot + 1); }} />)}</div>}</div>;
}
export default function UserHome({
  route,
  navigate,
  setRequest,
  setProfileSheet,
  notify,
  searchArea,
  onVendor,
  onBulkOrders,
  city,
  onCityChange,
  demoMode = false
}) {
  const [professionals, setProfessionals] = useState([]);
  const [professionalsLoading, setProfessionalsLoading] = useState(true);
  const [customer, setCustomer] = useState(null);
  useEffect(() => {
    let active = true;
    setProfessionalsLoading(true);
    (demoMode ? getDemoNearbyCustomerProfessionals(city, true) : getNearbyCustomerProfessionals(city)).then(rows => {
      if (active) {
        setProfessionals(rows);
        setProfessionalsLoading(false);
      }
    }).catch(e => {
      if (active) setProfessionalsLoading(false);
      notify(e.message);
    });
    if (!demoMode) getCurrentProfile().then(p => {
      if (active) setCustomer(p);
    }).catch(e => notify(e.message));
    return () => {
      active = false;
    };
  }, [city, demoMode, notify]);
  const [locationOpen, setLocationOpen] = useState(false);
  const [location, setLocation] = useState({
    locality: city,
    address: "Service city"
  });
  const [draftLocation, setDraftLocation] = useState(location);
  const [addressSearch, setAddressSearch] = useState("");
  const [heroIndex, setHeroIndex] = useState(0);
  const [brokenHeroArt, setBrokenHeroArt] = useState({});
  const [heroPaused, setHeroPaused] = useState(false);
  const [motionReduced, setMotionReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [cart, setCart] = useState([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [moreServicePool, setMoreServicePool] = useState(() => demoMode ? mergeServicePool(moreHomeServices, topServices) : moreHomeServices);
  const [moreServiceStart, setMoreServiceStart] = useState(0);
  const [moreServiceChanging, setMoreServiceChanging] = useState(false);
  const touchStart = useRef(null);
  const bulkTickerText = useRef(null);
  const bulkTickerTrack = useRef(null);
  const moreServicePaused = useRef(false);
  const moreServiceInteracting = useRef(false);
  const moreServiceGrid = useRef(null);
  const moreServiceResumeTimer = useRef(null);
  const moreServiceTransitionTimer = useRef(null);
  const serviceShowcases = useRef([]);
  const slide = heroSlides[heroIndex];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good Morning" : hour < 17 ? "Good Afternoon" : "Good Evening";
  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = event => setMotionReduced(event.matches);
    preference.addEventListener('change', updatePreference);
    return () => preference.removeEventListener('change', updatePreference);
  }, []);
  useEffect(() => {
    const text = bulkTickerText.current;
    const track = bulkTickerTrack.current;
    if (!text || !track) return undefined;
    const updateSpeed = () => {
      const distance = text.getBoundingClientRect().width + 24;
      track.style.setProperty('--bulk-ticker-distance', `${distance}px`);
      track.style.setProperty('--bulk-ticker-duration', `${distance / 32}s`);
    };
    updateSpeed();
    const observer = new ResizeObserver(updateSpeed);
    observer.observe(text);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (demoMode) return undefined;
    let active = true;
    getActiveServiceCatalogue().then(services => {
      if (!active || !services.length) return;
      setMoreServicePool(mergeServicePool(moreHomeServices.map(service => ({ ...service, categoryId: 'manpower' })), services));
      setMoreServiceStart(0);
    }).catch(() => {});
    return () => { active = false; };
  }, [demoMode]);
  useEffect(() => {
    if (motionReduced || moreServicePool.length <= 6) return undefined;
    const rotate = () => {
      if (document.hidden || moreServicePaused.current || document.querySelector('[role="dialog"]')) return;
      setMoreServiceChanging(true);
      window.clearTimeout(moreServiceTransitionTimer.current);
      moreServiceTransitionTimer.current = window.setTimeout(() => {
        if (moreServicePaused.current || document.hidden || document.querySelector('[role="dialog"]')) {
          setMoreServiceChanging(false);
          return;
        }
        setMoreServiceStart(start => nextServiceStart(moreServicePool, start));
        setMoreServiceChanging(false);
      }, 160);
    };
    const interval = window.setInterval(rotate, 4600);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(moreServiceTransitionTimer.current);
    };
  }, [motionReduced, moreServicePool]);
  useEffect(() => {
    let scrollTimer;
    const pauseOnScroll = () => {
      if (!moreServiceGrid.current?.getBoundingClientRect) return;
      const bounds = moreServiceGrid.current.getBoundingClientRect();
      if (bounds.bottom < 0 || bounds.top > window.innerHeight) return;
      pauseMoreServices();
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => resumeMoreServices(), 300);
    };
    window.addEventListener('scroll', pauseOnScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', pauseOnScroll);
      window.clearTimeout(scrollTimer);
      window.clearTimeout(moreServiceResumeTimer.current);
    };
  }, []);
  function pauseMoreServices() {
    moreServicePaused.current = true;
    window.clearTimeout(moreServiceResumeTimer.current);
    window.clearTimeout(moreServiceTransitionTimer.current);
    setMoreServiceChanging(false);
  }
  function resumeMoreServices(delay = 700) {
    if (moreServiceInteracting.current) return;
    window.clearTimeout(moreServiceResumeTimer.current);
    moreServiceResumeTimer.current = window.setTimeout(() => { if (!moreServiceInteracting.current) moreServicePaused.current = false; }, delay);
  }
  function startMoreServiceInteraction() { moreServiceInteracting.current = true; pauseMoreServices(); }
  function endMoreServiceInteraction() { moreServiceInteracting.current = false; resumeMoreServices(); }
  useEffect(() => {
    if (heroPaused || document.hidden || motionReduced) return undefined;
    const timer = window.setInterval(() => setHeroIndex(index => (index + 1) % heroSlides.length), 4500);
    return () => window.clearInterval(timer);
  }, [heroPaused, motionReduced]);
  useEffect(() => {
    const sections = serviceShowcases.current.filter(Boolean);
    if (motionReduced || !('IntersectionObserver' in window)) {
      sections.forEach(section => section.classList.add('is-visible'));
      return undefined;
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.14 });
    sections.forEach(section => {
      section.classList.add('service-showcase-ready');
      observer.observe(section);
    });
    return () => observer.disconnect();
  }, [motionReduced]);
  useEffect(() => {
    const selector = `link[data-eazily-home-hero="${firstHomeHeroArtwork}"]`;
    if (document.head.querySelector(selector)) return undefined;
    const link = document.createElement('link');
    link.rel = 'preload';
    link.as = 'image';
    link.type = 'image/webp';
    link.href = firstHomeHeroArtwork;
    link.fetchPriority = 'high';
    link.dataset.eazilyHomeHero = firstHomeHeroArtwork;
    document.head.append(link);
    return () => link.remove();
  }, []);
  function useCurrentLocation() {
    if (!navigator.geolocation) return notify("Location is not supported on this device");
    navigator.geolocation.getCurrentPosition(() => {
      notify("Location detected. Enter your city to find matching professionals.");
    }, () => notify("Location permission denied. Search for an address instead."), {
      enableHighAccuracy: false,
      timeout: 8000
    });
  }
  function completeSwipe(event) {
    const movement = event.changedTouches[0].clientX - (touchStart.current ?? event.changedTouches[0].clientX);
    if (Math.abs(movement) > 45) setHeroIndex(index => (index + (movement < 0 ? 1 : heroSlides.length - 1)) % heroSlides.length);
    touchStart.current = null;
    setHeroPaused(false);
  }
  return <main className="screen home-v3 user-art-home">
    <section className={`hero-carousel hero-header hero-theme-${slide.id}`} onMouseEnter={() => setHeroPaused(true)} onMouseLeave={() => setHeroPaused(false)} onTouchStart={event => {
      touchStart.current = event.touches[0].clientX;
      setHeroPaused(true);
    }} onTouchEnd={completeSwipe}><header className="user-home-header"><div className="user-brand-row"><button className="location-selector compact-location" onClick={() => setLocationOpen(true)}><Icon name="location" size={15} /><span><b>{translate(location.locality)}</b><small>{translate(location.address)}</small></span><Icon name="chevronRight" size={13} /></button></div><h1>{translate(greeting)}{translate(customer?.full_name ? `, ${customer.full_name}` : "")}</h1><p>{translate("What can we make easier for you today?")}</p></header><div className="search-cart-row">{translate(searchArea)}</div><div className={`hero-promotion hero-promotion-${slide.id}`} key={slide.id}><div className="hero-copy"><span>{translate(slide.eyebrow)}</span><h2>{translate(slide.title)}</h2><p>{translate(slide.text)}</p><button className="btn btn-white" onClick={() => setRequest({
          categoryId: slide.categoryId,
          serviceName: slide.serviceName
        })}>{translate(slide.action)} <Icon name="chevronRight" size={15} /></button></div><div className="hero-person" aria-hidden="true"><img src={homeHeroArtwork[slide.id]} alt="" width="480" height="600" style={brokenHeroArt[slide.id] ? { visibility: 'hidden' } : undefined} onError={() => setBrokenHeroArt(current => current[slide.id] ? current : { ...current, [slide.id]: true })} loading={heroIndex === 0 ? "eager" : "lazy"} fetchPriority={heroIndex === 0 ? "high" : "low"} decoding="async" /></div></div><div className="hero-art" aria-hidden="true"><i /><i /></div><div className="hero-dots home-bulk-orders-dots">{translate(heroSlides.map((item, index) => <button type="button" key={item.id} className={index === heroIndex ? "active" : ""} aria-label={`Show promotion ${index + 1}`} onClick={() => setHeroIndex(index)} />))}</div>
      <section className="home-bulk-orders-strip" aria-labelledby="home-bulk-orders-title" onTouchStart={event => event.stopPropagation()} onTouchEnd={event => event.stopPropagation()}>
        <div className="home-bulk-orders-top">
          <div className="home-bulk-orders-label"><span className="home-bulk-orders-icon"><Icon name="building" size={17} /></span><h2 id="home-bulk-orders-title">{translate("BULK ORDERS")}</h2></div>
          <button className="home-bulk-orders-cta" type="button" onClick={onBulkOrders}>{translate("Get Quote")} <Icon name="chevronRight" size={16} /></button>
        </div>
        <div className="home-bulk-orders-ticker-row">
          <div className="home-bulk-orders-ticker-window" tabIndex={0} aria-label={translate(bulkTickerMessage)}>
            <div className="home-bulk-orders-ticker-track" ref={bulkTickerTrack} aria-hidden="true">
              <span ref={bulkTickerText}>{translate(bulkTickerMessage)}</span><span>{translate(bulkTickerMessage)}</span>
            </div>
          </div>
        </div>
      </section></section>
    <section className="section"><div className="section-head"><h2>{translate("Explore Services")}</h2><button onClick={() => navigate("categories")}>{translate("View all")}</button></div><div className="explore-grid">{translate(topServices.map(service => <button key={service.id} onClick={() => setRequest({
          categoryId: service.categoryId ?? "manpower",
          serviceName: service.requestName
        })}><i><ServiceIllustration name={service.requestName} /></i><b>{translate(service.name)}</b></button>))}</div></section>
    <section className="section home-professionals-section"><div className="section-head"><div><h2>{translate("Top Professionals Near You")}</h2><p>{translate("Trusted professionals ready to help")}</p></div></div><HomeProviderCarousel providers={professionals} loading={professionalsLoading} onOpen={onVendor} motionReduced={motionReduced} /></section>
    <section className="section home-service-showcase more-service-showcase" ref={node => { serviceShowcases.current[0] = node; }} onTouchStart={startMoreServiceInteraction} onTouchEnd={endMoreServiceInteraction} onTouchCancel={endMoreServiceInteraction} onPointerDown={startMoreServiceInteraction} onPointerUp={endMoreServiceInteraction} onPointerCancel={endMoreServiceInteraction} onFocusCapture={startMoreServiceInteraction} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) endMoreServiceInteraction(); }}>
      <i className="service-showcase-glow" aria-hidden="true" />
      <div className="section-head service-showcase-heading"><div><span>{translate("QUICK ACCESS")}</span><h2>{translate("More services")}</h2><p>{translate("More ways Eazily can help at home.")}</p></div><button onClick={() => navigate("categories")}>{translate("See all")}</button></div>
      <div ref={moreServiceGrid} className={`more-service-grid${moreServiceChanging ? ' is-changing' : ''}`}>{translate(serviceWindow(moreServicePool, moreServiceStart).map((service, index) => <button type="button" className="more-service-card" key={`more-${service.id || service.requestName}`} style={{ '--service-order': index }} onClick={() => { pauseMoreServices(); resumeMoreServices(1200); setRequest({ categoryId: service.categoryId ?? "manpower", serviceName: service.requestName }); }}><i><ServiceIllustration name={service.requestName} /></i><span><b>{translate(service.name)}</b><small>{translate("Explore service")}</small></span><Icon name="chevronRight" size={17} /></button>))}</div>
    </section>
    <section className="section promise-section"><span className="eyebrow">{translate("SERVICE STANDARDS")}</span><h2>{translate("The Eazily Promise")}</h2><div className="promise-rail">{translate(promiseItems.map(item => <article key={item.id}><b>{translate(item.number)}</b><div><h3>{translate(item.title)}</h3><p>{translate(item.text)}</p></div></article>))}</div><small>{translate("Eazily protection applies only to payments completed through the official Eazily payment system or company QR. Cash payments and payments made to a professional\u2019s personal QR are not covered.")}</small></section>
    <ReferralCard onOpen={() => setProfileSheet("Refer & Earn")} />
    <BottomNav route={route} onChange={navigate} />
    {translate(locationOpen ? <Sheet onClose={() => setLocationOpen(false)}><span className="eyebrow">{translate("YOUR SERVICE AREA")}</span><h2 className="sheet-title">{translate("Choose your location")}</h2><button className="location-action" onClick={useCurrentLocation}><Icon name="location" /><span><b>{translate("Use my current location")}</b><small>{translate("Only after you allow access")}</small></span></button><Field label="Search for an address" placeholder="Locality, landmark or PIN code" value={addressSearch} onChange={event => setAddressSearch(event.target.value)} /><h3 className="location-label">{translate("Saved and recent")}</h3>{translate([{
        locality: "Nehru Park",
        address: "Bhopal, Madhya Pradesh"
      }, {
        locality: "MP Nagar",
        address: "Zone 1, Bhopal"
      }].map(item => <button className={`saved-location ${draftLocation.locality === item.locality ? "selected" : ""}`} key={item.locality} onClick={() => setDraftLocation(item)}><Icon name="home" /><span><b>{translate(item.locality)}</b><small>{translate(item.address)}</small></span><Icon name="chevronRight" /></button>))}<button className="btn btn-outline full" onClick={() => notify("Add-address form ready for connection")}>{translate("Add a new address")}</button><button className="btn btn-primary full" onClick={() => {
        setLocation({ locality: addressSearch.trim() || draftLocation.locality, address: "Service city" });
        onCityChange(addressSearch.trim() || "Bhopal");
        setLocationOpen(false);
        notify("Location updated");
      }}>{translate("Confirm location")}</button></Sheet> : null)}
    {translate(cartOpen ? <Sheet onClose={() => setCartOpen(false)}><span className="eyebrow">{translate("YOUR CART")}</span><h2 className="sheet-title">{translate("Selected services")}</h2>{translate(cart.length ? <><div className="cart-list">{translate(cart.map(item => <article key={item.id}><span><b>{translate(item.name)}</b><small>Choose a professional to confirm pricing</small></span><button aria-label={`Remove ${item.name}`} onClick={() => setCart(current => current.filter(entry => entry.id !== item.id))}>{translate("Remove")}</button></article>))}</div><button className="btn btn-primary full" onClick={() => {
          setCartOpen(false);
          setRequest({
            categoryId: "manpower",
            serviceName: cart[0].name
          });
        }}>{translate("Continue to checkout")}</button></> : <div className="cart-empty"><Icon name="cart" size={38} /><h3>{translate("Your cart is empty")}</h3><p>{translate("Add a nearby service to compare and book.")}</p></div>)}</Sheet> : null)}
  </main>;
}
