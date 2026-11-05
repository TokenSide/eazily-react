import { useCallback, useEffect, useRef, useState } from 'react';
import { readRows, rpc } from '../../services/experience.js';
import { useRealtime } from '../../lib/realtime.jsx';
import { ATTENTION_TYPES, buildAttentionAlerts } from './supportAttention.js';
import './support-attention.css';

const ACKNOWLEDGE_NOTE = 'Acknowledged from Admin attention alerts';

// Compact no-show / urgent-ticket alert list for admins and support.manage staff.
// Acknowledge/Resolve go through act_on_support_attention; status is shown only as returned by the server.
export default function SupportAttentionAlerts({ onOpen }) {
  const { revision } = useRealtime();
  const [alerts, setAlerts] = useState([]), [error, setError] = useState(''), [loaded, setLoaded] = useState(false), [reload, setReload] = useState(0);
  const [pending, setPending] = useState({}), [resolving, setResolving] = useState(null), [reason, setReason] = useState(''), [feedback, setFeedback] = useState({}), [notice, setNotice] = useState('');
  const locks = useRef(new Set());

  useEffect(() => {
    let active = true;
    readRows('operational_review_tasks', query => query
      .in('task_type', ATTENTION_TYPES).in('status', ['pending', 'in_review'])
      .order('created_at', { ascending: false }).limit(50))
      .then(rows => { if (active) { setAlerts(buildAttentionAlerts(rows)); setError(''); } })
      .catch(reason => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [revision, reload]);

  const act = useCallback(async (alert, action, note) => {
    // One request per alert at a time; repeated taps are ignored until the server answers.
    if (locks.current.has(alert.id)) return;
    locks.current.add(alert.id);
    setPending(current => ({ ...current, [alert.id]: action }));
    setFeedback(current => ({ ...current, [alert.id]: null }));
    try {
      await rpc('act_on_support_attention', { p_task: alert.id, p_action: action, p_reason: note });
      setFeedback(current => ({ ...current, [alert.id]: { ok: true, text: action === 'resolve' ? 'Resolved.' : 'Acknowledged.' } }));
      // A resolved alert leaves the open list, so confirm it above the list.
      setNotice(action === 'resolve' ? `${alert.label} · ${alert.reference} resolved.` : '');
      if (action === 'resolve') { setResolving(null); setReason(''); }
      setReload(value => value + 1);
    } catch (reason) {
      setFeedback(current => ({ ...current, [alert.id]: { ok: false, text: reason.message } }));
    } finally {
      locks.current.delete(alert.id);
      setPending(current => { const next = { ...current }; delete next[alert.id]; return next; });
    }
  }, []);

  const trimmed = reason.trim();
  return <section className="admin-panel attention-alerts" aria-label="Support attention alerts">
    <div className="admin-panel-head"><h2>Attention alerts</h2>{alerts.length > 0 && <span className="attention-count">{alerts.length}</span>}</div>
    {notice && <p className="attention-ok" role="status">{notice}</p>}
    {error ? <p role="alert">Alerts could not be loaded: {error}</p>
      : !loaded ? <p role="status">Loading alerts…</p>
        : !alerts.length ? <p className="policy-note">No open no-show or urgent-ticket alerts.</p>
          : <ul>{alerts.map(alert => { const busy = pending[alert.id], message = feedback[alert.id]; return <li key={alert.id} className="attention-item">
            <button type="button" className={`attention-alert ${alert.type}`} onClick={() => onOpen(alert)}>
              <b>{alert.label}{alert.escalated && <span className="attention-badge">Escalated</span>}</b>
              <span>{alert.target === 'booking' ? 'Booking' : 'Ticket'} {alert.reference}</span>
              <small>{alert.at ? new Date(alert.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Time unavailable'} · {alert.status}</small>
            </button>
            {resolving === alert.id ? <form className="attention-resolve" onSubmit={event => { event.preventDefault(); if (trimmed.length >= 3) act(alert, 'resolve', trimmed); }}>
              <label className="field-wrap"><span className="form-label">Resolution reason</span><textarea className="field" required minLength={3} maxLength={1000} value={reason} disabled={Boolean(busy)} placeholder="What was done? e.g. Called customer, professional reassigned" onChange={event => setReason(event.target.value)} /></label>
              <div className="attention-actions"><button type="submit" className="btn btn-primary" disabled={Boolean(busy) || trimmed.length < 3}>{busy === 'resolve' ? 'Resolving…' : 'Confirm resolve'}</button><button type="button" className="link" disabled={Boolean(busy)} onClick={() => { setResolving(null); setReason(''); }}>Cancel</button></div>
            </form> : <div className="attention-actions">
              {alert.state === 'pending' && <button type="button" className="btn btn-outline" disabled={Boolean(busy)} onClick={() => act(alert, 'acknowledge', ACKNOWLEDGE_NOTE)}>{busy === 'acknowledge' ? 'Acknowledging…' : 'Acknowledge'}</button>}
              <button type="button" className="btn btn-outline" disabled={Boolean(busy)} onClick={() => { setResolving(alert.id); setReason(''); }}>Resolve</button>
            </div>}
            {message && <p className={message.ok ? 'attention-ok' : 'inline-error'} role={message.ok ? 'status' : 'alert'}>{message.text}</p>}
          </li>; })}</ul>}
  </section>;
}
