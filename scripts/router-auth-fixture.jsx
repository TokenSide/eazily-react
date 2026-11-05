// TEST-ONLY full-shell router harness: real App.jsx + mocked auth/service boundary.
import { createRoot } from 'react-dom/client';
import App from '../src/App.jsx';
const q = new URLSearchParams(location.search);
window.__scenario = q.get('scenario') || 'signed_out';
// Admin overview truth cases: default/omitted = missing summary (mock default), zeros = recorded empty counts.
window.__adminSummary = { one: { orders: 12 }, zeros: { orders: 0, partnerOrders: 0 }, positive: { orders: 12, partnerOrders: 7 } }[q.get('summary') || ''];
const path = q.get('path') || '/';
history.replaceState({}, '', path + (q.toString() ? '?' + q.toString() : ''));
createRoot(document.getElementById('root')).render(<App />);
