// Browser-only fixture. It is not imported by the production application.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ServiceExperience from '../src/features/services/ServiceExperience.jsx';
import RequestSheet from '../src/features/requests/RequestSheet.jsx';
import UserHome from '../src/features/home/UserHome.jsx';
import '../src/styles.css';
import '../src/experience.css';

const service = { categoryId: 'manpower', serviceName: 'AC Service' };

function ProfileFixture() {
  const [vendor, setVendor] = useState(null);
  const [request, setRequest] = useState(null);
  const [notice, notify] = useState('');
  const [city, setCity] = useState('Bhopal');
  return <div className="phone-shell"><ServiceExperience service={service} vendor={vendor} setVendor={setVendor} onService={() => {}} onBook={setRequest} onMessage={() => {}} onBack={() => {}} location={city} setLocation={setCity} notify={notify} />{request && <RequestSheet request={request} onClose={() => setRequest(null)} notify={notify} />}<div id="fixture-notice">{notice}</div></div>;
}

function HomeFixture() {
  const search = <div className="catalog-search">Search services</div>;
  return <div className="phone-shell"><UserHome route="home" navigate={route => { window.lastRoute = route; }} setRequest={request => { window.lastRequest = request; }} setProfileSheet={() => {}} notify={message => { window.lastNotice = message; }} searchArea={search} onVendor={() => {}} onMessage={() => {}} city="Bhopal" onCityChange={() => {}} /></div>;
}

export { ProfileFixture, HomeFixture };

const mode = new URL(window.location.href).searchParams.get('mode');
createRoot(document.getElementById('root')).render(mode === 'home' ? <HomeFixture /> : <ProfileFixture />);
