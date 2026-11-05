import { useRealtime } from '../lib/realtime.jsx';

export default function RealtimeStatus() {
  const { available, connectionState, lastSyncedAt, retry } = useRealtime();
  if (!available) return null;
  const retryable = connectionState === 'Offline' || connectionState === 'Reconnecting';
  const label = connectionState === 'Live' ? 'Live' : connectionState;
  const title = lastSyncedAt
    ? `${label}. Last synced ${lastSyncedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : label;
  return <div className={`realtime-status realtime-${connectionState.toLowerCase()}`} role="status" aria-live="polite" title={title}>
    <span aria-hidden="true" />
    <b>{label}</b>
    {retryable && <button type="button" onClick={retry}>Retry</button>}
  </div>;
}

