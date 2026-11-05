/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from './supabase.js';

const RealtimeContext = createContext({
  available: false,
  connectionState: 'Offline',
  networkOnline: true,
  revision: 0,
  scopes: [],
  lastSyncedAt: null,
  setPublicAudience: () => {},
  retry: () => {}
});

const safeAudience = value => String(value || '').trim().toLowerCase().replace(/[^a-z0-9:_-]/g, '').slice(0, 90);

export function useRealtimeController({ user, workspace, onAuthoritativeRefresh }) {
  const [connectionState, setConnectionState] = useState('Offline');
  const [networkOnline, setNetworkOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [publicAudience, setPublicAudienceState] = useState('');
  const [revision, setRevision] = useState(0);
  const [scopes, setScopes] = useState([]);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [generation, setGeneration] = useState(0);
  const seenIds = useRef(new Set());
  const pendingScopes = useRef(new Set());
  const flushTimer = useRef(null);
  const refreshRef = useRef(onAuthoritativeRefresh);
  refreshRef.current = onAuthoritativeRefresh;

  const available = Boolean(supabase && user?.id && workspace);
  const setPublicAudience = useCallback(value => setPublicAudienceState(safeAudience(value)), []);
  const retry = useCallback(() => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    setConnectionState('Connecting');
    setGeneration(value => value + 1);
  }, []);

  useEffect(() => {
    const online = () => { setNetworkOnline(true); setConnectionState('Reconnecting'); setGeneration(value => value + 1); };
    const offline = () => { setNetworkOnline(false); setConnectionState('Offline'); };
    const visible = () => {
      if (document.visibilityState === 'visible' && navigator.onLine && available) {
        setConnectionState('Reconnecting');
        setGeneration(value => value + 1);
      }
    };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    document.addEventListener('visibilitychange', visible);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [available]);

  useEffect(() => {
    if (!available) {
      setConnectionState('Offline');
      setScopes([]);
      seenIds.current.clear();
      return undefined;
    }
    if (!navigator.onLine) {
      setNetworkOnline(false);
      setConnectionState('Offline');
      return undefined;
    }

    let active = true;
    let reconnectTimer;
    let availabilityTimer;
    const pending = pendingScopes.current;
    const channels = [];
    const subscribed = new Set();
    setConnectionState(generation ? 'Reconnecting' : 'Connecting');

    const flush = async () => {
      flushTimer.current = null;
      if (!active) return;
      const changedScopes = [...pending];
      pending.clear();
      if (!changedScopes.length) return;
      setScopes(changedScopes);
      setRevision(value => value + 1);
      try { await refreshRef.current?.(changedScopes); } catch { /* Screens retain their previous authorised state and expose their own retry UI. */ }
      if (active) setLastSyncedAt(new Date());
    };

    const receive = payload => {
      const event = payload?.new;
      if (!event?.id) return;
      const id = String(event.id);
      if (seenIds.current.has(id)) return;
      seenIds.current.add(id);
      if (seenIds.current.size > 256) seenIds.current.delete(seenIds.current.values().next().value);
      pending.add(event.scope || 'all');
      clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(flush, 120);
    };

    const addChannel = (name, audienceKey) => {
      const channel = supabase.channel(`eazily-realtime:${name}:${user.id}:${generation}`)
        .on('postgres_changes', {
          event: 'INSERT', schema: 'public', table: 'realtime_events', filter: `audience_key=eq.${audienceKey}`
        }, receive)
        .subscribe(status => {
          if (!active) return;
          if (status === 'SUBSCRIBED') {
            subscribed.add(name);
            if (subscribed.size === channels.length) {
              setConnectionState('Live');
              pending.add('all');
              clearTimeout(flushTimer.current);
              flushTimer.current = setTimeout(flush, 0);
              if (workspace === 'customer' && !availabilityTimer) availabilityTimer = setInterval(() => {
                pending.add('availability');
                clearTimeout(flushTimer.current);
                flushTimer.current = setTimeout(flush, 0);
              }, 60000);
            }
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            subscribed.delete(name);
            setConnectionState(navigator.onLine ? 'Reconnecting' : 'Offline');
            clearTimeout(reconnectTimer);
            reconnectTimer = setTimeout(() => { if (active && navigator.onLine) setGeneration(value => value + 1); }, 4000);
          }
        });
      channels.push(channel);
    };

    addChannel('account', user.id);
    if (['professional', 'influencer', 'consultant'].includes(workspace)) addChannel('role', workspace);
    if (workspace === 'admin') addChannel('admin', 'admin');
    if (workspace === 'customer' && publicAudience) addChannel('public', publicAudience);

    return () => {
      active = false;
      clearTimeout(reconnectTimer);
      clearInterval(availabilityTimer);
      clearTimeout(flushTimer.current);
      pending.clear();
      channels.forEach(channel => supabase.removeChannel(channel));
    };
  }, [available, generation, publicAudience, user?.id, workspace]);

  return useMemo(() => ({
    available, connectionState, networkOnline, revision, scopes, lastSyncedAt,
    setPublicAudience, retry
  }), [available, connectionState, networkOnline, revision, scopes, lastSyncedAt, setPublicAudience, retry]);
}

export function RealtimeProvider({ value, children }) {
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  return useContext(RealtimeContext);
}

export function usePublicRealtimeAudience(city) {
  const { setPublicAudience } = useRealtime();
  useEffect(() => {
    setPublicAudience(city ? `city:${city}` : '');
    return () => setPublicAudience('');
  }, [city, setPublicAudience]);
}
