import { useCallback, useEffect, useState } from 'react';
import { EmptyState, Field } from '../../components/Ui.jsx';
import { useRealtime } from '../../lib/realtime.jsx';
import { readRows, rpc } from '../../services/experience.js';
import { getChatMessages } from '../../services/chat.js';

export default function ChatSupportReview({ notify }) {
  const { revision } = useRealtime();
  const [reports, setReports] = useState([]), [selected, setSelected] = useState(null), [messages, setMessages] = useState([]);
  const [reason, setReason] = useState('Reviewing a participant safety report'), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setReports(await readRows('chat_reports', query => query.in('status', ['pending','reviewing']).order('created_at').limit(100))); }
    catch (value) { setError(value.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load, revision]);
  async function open(report) {
    if (reason.trim().length < 10) return notify('Enter a clear reason for opening private messages.');
    try {
      const conversationId = await rpc('open_reported_chat', { p_report: report.id, p_reason: reason.trim() });
      await rpc('record_chat_staff_view', { p_conversation: conversationId, p_reason: reason.trim() });
      setMessages(await getChatMessages(conversationId)); setSelected(report);
    } catch (value) { notify(value.message); }
  }
  return <section className="admin-panel chat-support-review"><div className="admin-panel-head"><div><h2>Reported conversations</h2><small>Access requires chat.review permission, an open report, a recorded reason, and a time-limited audit grant.</small></div></div>
    <Field label="Required access reason" value={reason} maxLength={1000} onChange={event => setReason(event.target.value)} />
    {loading && <p role="status">Loading permitted chat reports…</p>}{error && <p role="alert">Unable to load chat reports: {error}</p>}
    {!loading && !error && !reports.length && <EmptyState title="No permitted chat reports" text="Only staff with the dedicated chat review permission can see this queue." icon="shield" />}
    {reports.map(report => <article className="admin-record" key={report.id}><b>{report.reason.replaceAll('_',' ')}</b><span className="application-state">{report.status}</span><p>{report.details || 'No additional details supplied.'}</p><small>{new Date(report.created_at).toLocaleString('en-IN')}</small><button className="btn btn-outline" onClick={() => open(report)}>Open with audit record</button></article>)}
    {selected && <section className="chat-staff-transcript"><h3>Read-only reported conversation</h3>{messages.map(message => <article key={message.id}><b>{message.sender_kind}</b><p>{message.body}</p><small>{new Date(message.created_at).toLocaleString('en-IN')}</small></article>)}</section>}
  </section>;
}
