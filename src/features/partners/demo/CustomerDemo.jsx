import { useState } from 'react';
import Icon from '../../../components/Icon.jsx';
import { customerProfessionalSamples } from './customerProfessionalFixtures.js';

export default function CustomerDemo({ onPartner, onExit }) {
  const [view, setView] = useState('home');
  const [selected, setSelected] = useState(null);
  const open = profile => { setSelected(profile); setView('professional'); };
  const navigate = destination => { setSelected(null); setView(destination); };
  return <main className="demo-workspace demo-customer" style={{ '--role': '#6D28D9', '--role-bg': '#F3EEFF', '--pd-border': '#D8C7FF' }}>
    <section className="demo-controls">
      <strong><Icon name="shield" size={18} />Demo Mode — customer sample screens</strong>
      <p>Fictional professionals and photos. No account, real search, booking, payment or consent is used.</p>
      <div className="demo-control-grid"><button type="button" onClick={onPartner}>Partner previews</button><button type="button" onClick={onExit}>Exit Demo Mode</button></div>
    </section>
    <div className="demo-content demo-stack">
      {view === 'professional' && selected ? <>
        <button type="button" className="demo-back" onClick={() => navigate('explore')}>← Sample professionals</button>
        <img className="demo-customer-hero" src={selected.photo_url} alt="" />
        <span className="demo-badge">Demo profile · sample data</span>
        <h2>{selected.business_name || selected.display_name}</h2>
        <p>{selected.description}</p>
        <p>{selected.service_names.join(', ')} · {selected.city}</p>
        {selected.portfolio?.length > 0 && <><h3>Sample past work</h3><div className="demo-customer-grid">{selected.portfolio.map(photo => <img key={photo} src={photo} alt="Sample past work" loading="lazy" />)}</div></>}
        <p className="demo-limitation">Booking is unavailable in Demo Mode. Sign in with a real verified account to request a service.</p>
      </> : view === 'profile' ? <>
        <span className="demo-badge">Sample customer</span><h2>Customer Profile</h2>
        <p>No personal details, bookings, payment methods or messages are loaded in this preview.</p>
        <button type="button" onClick={() => navigate('explore')}>Browse sample professionals</button>
      </> : <>
        <span className="demo-badge">{view === 'home' ? 'Customer Home · Demo' : 'Explore · Demo'}</span>
        <h2>{view === 'home' ? 'Find & Book Services preview' : 'Sample professionals'}</h2>
        <p>See the type of local services and professional profiles Eazily can show. These cards contain sample data only.</p>
        <div className="demo-customer-grid">{customerProfessionalSamples.map(profile => <button type="button" className="demo-customer-card" key={profile.id} onClick={() => open(profile)}><img src={profile.photo_url} alt="" loading="lazy" /><b>{profile.selected_service}</b><span>{profile.business_name || profile.display_name}</span><small>Sample profile</small></button>)}</div>
      </>}
    </div>
    <nav className="demo-customer-nav" aria-label="Customer demo navigation"><button type="button" onClick={() => navigate('home')}>Home</button><button type="button" onClick={() => navigate('explore')}>Explore</button><button type="button" onClick={() => navigate('profile')}>Profile</button></nav>
  </main>;
}
