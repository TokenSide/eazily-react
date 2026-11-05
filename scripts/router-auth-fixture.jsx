// TEST-ONLY full-shell router harness: real App.jsx + mocked auth/service boundary.
import { createRoot } from 'react-dom/client';
import App from '../src/App.jsx';
const q = new URLSearchParams(location.search);
window.__scenario = q.get('scenario') || 'signed_out';
const path = q.get('path') || '/';
history.replaceState({}, '', path + (q.toString() ? '?' + q.toString() : ''));
createRoot(document.getElementById('root')).render(<App />);
