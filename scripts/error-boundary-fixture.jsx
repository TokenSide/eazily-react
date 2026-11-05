// Browser-only fixture. Not imported by the production app.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ErrorBoundary from '../src/components/ErrorBoundary.jsx';
import '../src/styles.css';

function Boom() {
  throw new Error('Fixture render failure');
}

export default function Fixture() {
  const [broken, setBroken] = useState(true);
  const [reports, setReports] = useState(0);
  return <>
    <button id="fixture-break" onClick={() => setBroken(true)}>Break</button>
    <button id="fixture-fix" onClick={() => setBroken(false)}>Fix</button>
    <span id="fixture-reports">{reports}</span>
    <ErrorBoundary label="this screen" onError={() => setReports(count => count + 1)}>
      {broken ? <Boom /> : <p id="fixture-ok">recovered</p>}
    </ErrorBoundary>
  </>;
}

createRoot(document.getElementById('root')).render(<Fixture />);