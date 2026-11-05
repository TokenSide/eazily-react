import { lazy, Suspense, useState } from 'react';
import { PARTNER_DEMO_ENABLED } from './config.js';

const DemoWorkspace = PARTNER_DEMO_ENABLED ? lazy(() => import('./DemoWorkspace.jsx')) : null;

export default function DemoGate({ role, children }) {
  const [active, setActive] = useState(false);
  // Unmount the actual partner workspace. No real data or service callbacks cross this boundary.
  if (PARTNER_DEMO_ENABLED && active) return <Suspense fallback={<p role="status">Opening local demo…</p>}><DemoWorkspace initialRole={role} onExit={() => setActive(false)} /></Suspense>;
  return children(PARTNER_DEMO_ENABLED ? () => setActive(true) : undefined);
}
