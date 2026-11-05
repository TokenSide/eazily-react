import { useEffect, useRef, useState } from 'react';
import { readRows, requireBackend } from '../../services/experience.js';

export default function SupportThread({ ticket, revision = 0 }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [sendError, setSendError] = useState('');
  const [reload, setReload] = useState(0);
  const submitLock = useRef(false);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setLoading(true);
    setLoadError('');
    readRows('support_ticket_replies', query => query.eq('ticket_id', ticket.id).order('created_at').order('id'))
      .then(result => { if (active) setRows(result); })
      .catch(reason => { if (active) setLoadError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, ticket.id, revision, reload]);

  async function send(event) {
    event.preventDefault();
    if (submitLock.current || !body.trim()) return;
    submitLock.current = true;
    setSending(true);
    setSendError('');
    try {
      const db = requireBackend();
      const { data: { user }, error: authError } = await db.auth.getUser();
      if (authError) throw authError;
      if (!user) throw new Error('Sign in to reply.');
      const result = await db.from('support_ticket_replies')
        .insert({ ticket_id: ticket.id, author_id: user.id, body: body.trim() })
        .select('id,ticket_id,author_id,body,created_at').single();
      if (result.error) throw result.error;
      setRows(current => [...current, result.data].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at) || a.id.localeCompare(b.id)));
      setBody('');
    } catch (reason) {
      setSendError(reason.message);
    } finally {
      submitLock.current = false;
      setSending(false);
    }
  }

  return <details className="support-replies" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Conversation and replies</summary>
    {open && <>
      {loading && <p role="status">Loading replies…</p>}
      {loadError && <p role="alert">Could not load replies: {loadError} <button type="button" className="link" onClick={() => setReload(value => value + 1)}>Retry loading</button></p>}
      {!loading && !loadError && !rows.length && <p>No replies yet.</p>}
      {!loading && rows.map(row => <p className="support-thread-entry" key={row.id}><b>{row.author_id === ticket.customer_id ? 'Customer' : 'Support'}</b> · <small>{new Date(row.created_at).toLocaleString('en-IN')}</small><br />{row.body}</p>)}
      <button type="button" className="link" disabled={loading} onClick={() => setReload(value => value + 1)}>Refresh replies</button>
      <form onSubmit={send}>
        <label className="form-label" htmlFor={`support-reply-${ticket.id}`}>Reply</label>
        <textarea id={`support-reply-${ticket.id}`} className="field" required maxLength={2000} value={body} onChange={event => setBody(event.target.value)} />
        {sendError && <p role="alert">Reply was not sent: {sendError}</p>}
        <button type="submit" className="btn btn-outline" disabled={sending || !body.trim()}>{sending ? 'Sending…' : 'Send reply'}</button>
      </form>
    </>}
  </details>;
}
