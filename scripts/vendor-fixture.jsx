// Browser-only fixture. Not imported by the production app.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ServiceExperience from '../src/features/services/ServiceExperience.jsx';
import RequestSheet from '../src/features/requests/RequestSheet.jsx';
import '../src/styles.css';
import '../src/experience.css';
const service = { categoryId: 'manpower', serviceName: 'Plumber' };
const alpha = { id: 'fixture-a', display_name: 'Fixture Alpha', business_name: 'Alpha Plumbing', service_names: ['Plumber'], coverage: ['Bhopal'], languages: ['Hindi'], portfolio: [], prices: {} };
const beta = { ...alpha, id: 'fixture-b', display_name: 'Fixture Beta', business_name: 'Beta Plumbing' };
export default function Fixture() {
  const [vendor, setVendor] = useState(null);
  const [request, setRequest] = useState(null);
  const [notice, notify] = useState('');
  const [city, setCity] = useState('Bhopal');
  return <><div className="fixture-controls"><button onClick={() => setVendor(alpha)}>Open Alpha</button><button onClick={() => setVendor(beta)}>Open Beta</button></div><ServiceExperience service={service} vendor={vendor} setVendor={setVendor} onService={() => {}} onBook={setRequest} onBack={() => {}} location={city} setLocation={setCity} notify={notify} />{request && <RequestSheet request={request} onClose={() => setRequest(null)} notify={notify} />}<div id="fixture-notice">{notice}</div></>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
