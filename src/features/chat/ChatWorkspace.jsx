import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { EmptyState, Field } from '../../components/Ui.jsx';
import Avatar from '../../components/ui/Avatar.jsx';
import { useAccount } from '../../lib/account.js';
import { useRealtime } from '../../lib/realtime.jsx';
import { supabase } from '../../lib/supabase.js';
import {
  createChatAttachmentUrl, getChatMessages, listChatConversations, markChatRead, reportChat,
  sendChatMessage, setChatBlock, startChat, updateChatPreferences, uploadChatAttachment
} from '../../services/chat.js';
import './chat.css';

const time = value => value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : '';
const draftKey = (accountId, id) => `eazily-chat-draft:${accountId}:${id}`;

function Attachment({ value }) {
  const [url, setUrl] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    createChatAttachmentUrl(value.path).then(next => active && setUrl(next)).catch(reason => active && setError(reason.message));
    return () => { active = false; };
  }, [value.path]);
  if (error) return <small role="alert">Attachment unavailable: {error}</small>;
  if (!url) return <small>Preparing private attachment…</small>;
  return value.mimeType?.startsWith('image/')
    ? <a href={url} target="_blank" rel="noreferrer"><img className="chat-image" src={url} alt={value.name} /></a>
    : <a className="chat-document" href={url} target="_blank" rel="noreferrer"><Icon name="clipboard" />{value.name}</a>;
}

export function ChatBubble({ message }) {
  return <article className={`chat-bubble ${message.sender_kind}`}><p>{message.moderation_status === 'removed' ? 'Message removed' : message.body}</p>{message.attachment && <Attachment value={message.attachment} />}<small>{time(message.created_at)}{message.sender_kind === 'you' ? message.read ? ' · Read' : ' · Sent' : ''}</small></article>;
}

const chatTabs = role => [['all', 'All'], ['people', role ? 'Customers' : 'Partners'] , ['support', 'Support']];
const CHAT_TINTS = ['purple', 'blue', 'amber'];

export function ConversationList({ role = null, rows, selectedId, search, setSearch, onOpen, loading, error, onRetry, onMore }) {
  const [tab, setTab] = useState('all');
  const tabbed = useMemo(() => tab === 'all' ? rows : rows.filter(row => tab === 'support' ? row.conversation_type === 'support' : row.conversation_type !== 'support'), [rows, tab]);
  const tabs = chatTabs(role);
  const filtered = useMemo(() => tabbed.filter(row => `${row.other_name} ${row.context_label} ${row.reference || ''}`.toLowerCase().includes(search.toLowerCase())), [tabbed, search]);
  return <section className={`chat-list ${selectedId ? 'chat-list-hidden' : ''}`} aria-label="Conversations">
    <header className="chat-list-header"><h1>Messages</h1><p>{role ? 'Customer & Team Chats' : 'Partner & Support Chats'}</p></header>
    <label className="chat-search"><Icon name="search" size={18} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search messages..." /></label>
    <div className="chat-tabs" role="tablist">{tabs.map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} className={`chat-tab ${tab === key ? 'active' : ''}`} onClick={() => setTab(key)}>{label}</button>)}</div>
    {loading && <div className="chat-skeleton" role="status"><i /><i /><i /></div>}
    {error && <div className="chat-error" role="alert"><p>{error}</p><button className="btn btn-outline" onClick={onRetry}>Retry</button></div>}
    {!loading && !error && !filtered.length && <EmptyState title="No conversations yet" text="Message a published provider or open messages from a booking." icon="message" />}
    {filtered.map((row, index) => <button className={`chat-list-item ${selectedId === row.id ? 'active' : ''}`} key={row.id} onClick={() => onOpen(row)}>
      <Avatar name={row.other_name} tint={CHAT_TINTS[index % 3]} size={48} /><span className="chat-list-copy"><b>{row.other_name}{row.reference && <span className="chat-job-chip">Job</span>}</b><small>{row.context_label}{row.reference ? ` · ${row.reference}` : ''}{row.status !== 'active' ? ` · ${row.status}` : ''}</small><span>{row.last_preview || 'Conversation started'}</span></span><span className="chat-list-meta"><time>{time(row.last_activity_at)}</time>{Number(row.unread_count) > 0 && <b>{row.unread_count}</b>}</span>
    </button>)}
    {rows.length >= 30 && <button className="chat-more" onClick={onMore}>Load older conversations</button>}
  </section>;
}

export function Conversation({ conversation, notify, onBack, onChanged, servicesOverride = null }) {
  const getMessages = servicesOverride?.getChatMessages || getChatMessages;
  const markRead = servicesOverride?.markChatRead || markChatRead;
  const { user } = useAccount(), { revision, connectionState } = useRealtime();
  const [messages, setMessages] = useState([]), [draft, setDraft] = useState(() => sessionStorage.getItem(draftKey(user?.id, conversation.id)) || '');
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [sending, setSending] = useState(false), [failed, setFailed] = useState(null);
  const [showSafety, setShowSafety] = useState(false), [reportReason, setReportReason] = useState('spam'), [reportDetails, setReportDetails] = useState('');
  const filePick = useRef(null);
  const [uploading, setUploading] = useState(false), [failedUpload, setFailedUpload] = useState(null), [hasOlder, setHasOlder] = useState(false), [archived, setArchived] = useState(conversation.archived); const end = useRef(null), history = useRef(null);
  const load = useCallback(async () => {
    setError('');
    try {
      const rows = await getMessages(conversation.id);
      setMessages(rows); setHasOlder(rows.length === 40); const last = rows.at(-1);
      if (last && document.visibilityState === 'visible') await markRead(conversation.id, last.id);
      requestAnimationFrame(() => end.current?.scrollIntoView({ block: 'end' }));
    } catch (reason) { setError(reason.message); } finally { setLoading(false); }
  }, [conversation.id, getMessages, markRead]);
  useEffect(() => { setLoading(true); load(); }, [load, revision]);
  useEffect(() => { sessionStorage.setItem(draftKey(user?.id, conversation.id), draft); }, [user?.id, conversation.id, draft]);
  useEffect(() => {
    const visible = () => { if (document.visibilityState === 'visible' && messages.at(-1)) markRead(conversation.id, messages.at(-1).id).catch(() => {}); };
    document.addEventListener('visibilitychange', visible); return () => document.removeEventListener('visibilitychange', visible);
  }, [conversation.id, messages, markRead]);
  const submit = async (body = draft, options = {}) => {
    if (sending || (!body.trim() && !options.attachmentId)) return;
    const pending = options.key || crypto.randomUUID(); setSending(true); setFailed(null);
    try {
      await sendChatMessage({ conversationId: conversation.id, body, key: pending, ...options });
      setDraft(''); sessionStorage.removeItem(draftKey(user?.id, conversation.id)); await load(); onChanged();
    } catch (reason) { setFailed({ body, options, key: pending }); notify?.(reason.message); } finally { setSending(false); }
  };
  const upload = async (file, key = crypto.randomUUID()) => {
    if (!file || uploading) return;
    setUploading(true);
    try { const attachment = await uploadChatAttachment(conversation.id, file, key); setFailedUpload(null); await submit(file.name, { type: file.type === 'application/pdf' ? 'document' : 'image', attachmentId: attachment.id }); }
    catch (reason) { setFailedUpload({ file, key }); notify?.(reason.message); } finally { setUploading(false); }
  };
  const attach = event => { const file = event.target.files?.[0]; event.target.value = ''; upload(file); };
  const changePreference = async values => { try { await updateChatPreferences(conversation.id, values); if (values.archived != null) setArchived(values.archived); onChanged(); } catch (reason) { notify?.(reason.message); } };
  const loadOlder = async () => {
    const element = history.current, previousHeight = element?.scrollHeight || 0;
    try {
      const older = await getChatMessages(conversation.id, messages[0]?.created_at);
      setHasOlder(older.length === 40); setMessages(current => [...older, ...current.filter(row => !older.some(old => old.id === row.id))]);
      requestAnimationFrame(() => { if (element) element.scrollTop += element.scrollHeight - previousHeight; });
    } catch (reason) { notify?.(reason.message); }
  };
  const block = async () => { try { await setChatBlock(conversation.id, conversation.blocked_by !== user?.id); await onChanged(); } catch (reason) { notify?.(reason.message); } };
  const report = async event => { event.preventDefault(); try { await reportChat(conversation.id, null, reportReason, reportDetails); setShowSafety(false); notify?.('Report submitted for restricted review.'); await onChanged(); } catch (reason) { notify?.(reason.message); } };
  const blocked = Boolean(conversation.blocked_by);
  return <section className="chat-thread" aria-label={`Conversation with ${conversation.other_name}`}>
    <header className="chat-thread-head"><button className="icon-btn" onClick={onBack} aria-label="Back to conversations"><Icon name="arrowLeft" /></button><span><b>{conversation.other_name}</b><small>{conversation.context_label}{conversation.reference ? ` · ${conversation.reference}` : ''} · {connectionState}</small></span><button className="chat-menu-button" onClick={() => setShowSafety(value => !value)} aria-expanded={showSafety} aria-label="Conversation options"><Icon name="settings" size={20} /></button></header>
    {showSafety && <div className="chat-safety chat-options-sheet" role="dialog" aria-label="Conversation options"><div className="chat-options-head"><b>Conversation Options</b><button type="button" aria-label="Close options" onClick={() => setShowSafety(false)}><Icon name="close" size={18} /></button></div><button type="button" className="chat-option" onClick={() => { setShowSafety(false); filePick.current?.click(); }}><span className="chat-option-icon"><Icon name="plus" size={18} /></span><span><b>Send Photo or Document</b><small>Share service photos, invoice or other files</small></span><Icon name="chevronRight" size={16} /></button><button type="button" className="chat-option" onClick={() => changePreference({ muted: !conversation.muted })}><span className="chat-option-icon"><Icon name="bell" size={18} /></span><span><b>{conversation.muted ? 'Unmute conversation' : 'Mute conversation'}</b><small>Pause notifications from this chat</small></span><Icon name="chevronRight" size={16} /></button><button type="button" className="chat-option" onClick={() => changePreference({ archived: !archived })}><span className="chat-option-icon"><Icon name="history" size={18} /></span><span><b>{archived ? 'Unarchive' : 'Archive'}</b><small>Move this chat out of your main list</small></span><Icon name="chevronRight" size={16} /></button><button type="button" className="chat-option" onClick={block}><span className="chat-option-icon chat-option-warn"><Icon name="shield" size={18} /></span><span><b>{conversation.blocked_by === user?.id ? 'Unblock participant' : 'Block participant'}</b><small>Stop new messages from this person</small></span><Icon name="chevronRight" size={16} /></button><form onSubmit={report} className="chat-report-form"><b>Report an Issue</b><Field label="Reason" as="select" value={reportReason} onChange={event => setReportReason(event.target.value)} options={['spam','harassment','unsafe_request','payment_request','privacy','other']} /><Field label="Optional details" as="textarea" maxLength={2000} value={reportDetails} onChange={event => setReportDetails(event.target.value)} /><button className="btn btn-outline">Submit report</button></form></div>}
    {conversation.reference && <div className="chat-job-context"><span className="chat-job-icon"><Icon name="briefcase" size={18} /></span><div><b>{conversation.context_label}</b><small>{conversation.reference}</small></div><span className={`chat-job-status chat-job-${conversation.status || 'active'}`}>{conversation.status === 'active' ? 'Confirmed' : conversation.status}</span></div>}
    <div className="chat-privacy"><Icon name="shield" size={15} /> Eazily payment protection applies only to payments made through Eazily’s official payment system or official QR. Do not pay through a partner’s personal QR code or cash.</div>
    <div className="chat-messages" ref={history} aria-live="polite">{loading && <p role="status">Loading messages…</p>}{error && <div role="alert"><p>{error}</p><button onClick={load}>Retry</button></div>}{hasOlder&&<button className="chat-more" onClick={loadOlder}>Load older messages</button>}{messages.map((message,index) => <Fragment key={message.id}>{(!messages[index-1] || new Date(messages[index-1].created_at).toDateString() !== new Date(message.created_at).toDateString())&&<p className="chat-date">{new Date(message.created_at).toLocaleDateString('en-IN',{dateStyle:'medium'})}</p>}{message.sender_kind === 'system' ? <p className="chat-system">{message.body}</p> : <ChatBubble message={message} />}</Fragment>)}<div ref={end} /></div>
    {blocked ? <p className="chat-closed" role="status">This conversation is blocked. Existing booking obligations remain visible in Orders; contact Support if help is required.</p> : <form className="chat-composer" onSubmit={event => { event.preventDefault(); submit(); }}><label className="chat-attach" aria-label="Attach image or PDF"><Icon name="plus" /><input ref={filePick} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={attach} disabled={uploading || sending} /></label><textarea aria-label="Message" value={draft} onChange={event => setDraft(event.target.value)} maxLength={4000} rows={1} placeholder={connectionState === 'Offline' ? 'Draft saved while offline' : 'Write a message'} /><button className="chat-send" disabled={sending || uploading || !draft.trim()} aria-label={uploading ? 'Uploading attachment' : sending ? 'Sending message' : 'Send message'} aria-busy={sending || uploading}><Icon name="send" size={18} /></button></form>}
    {failed && <button className="chat-retry-send" onClick={() => submit(failed.body, { ...failed.options, key: failed.key })}>Message failed. Tap to retry safely.</button>}
    {failedUpload && <button className="chat-retry-send" onClick={() => upload(failedUpload.file, failedUpload.key)}>Attachment failed. Tap to retry the same upload.</button>}
  </section>;
}

export default function ChatWorkspace({ role = null, initialConversationId = null, initialOrderId = null, notify, embedded = false, onConversationHandled }) {
  const { revision } = useRealtime(); const [rows, setRows] = useState([]), [selected, setSelected] = useState(null), [search, setSearch] = useState('');
  const [loading, setLoading] = useState(Boolean(supabase)), [error, setError] = useState('');
  const load = useCallback(async () => {
    if (!supabase) { setRows([]); setLoading(false); return; }
    setError(''); try { const result = await listChatConversations(role); setRows(result); setSelected(current => current ? result.find(item => item.id === current.id) || current : current); }
    catch (reason) { setError(reason.message); } finally { setLoading(false); }
  }, [role]);
  useEffect(() => { load(); }, [load, revision]);
  useEffect(() => {
    if (!supabase || (!initialConversationId && !initialOrderId)) return;
    let active = true;
    (async () => {
      try {
        if (initialOrderId) await startChat({ orderId: initialOrderId });
        const refreshed = await listChatConversations(role);
        if (active) setRows(refreshed);
        const target = refreshed.find(item => item.id === initialConversationId || item.partner_order_id === initialOrderId);
        if (active && target) setSelected(target);
      } catch (reason) { if (active) notify?.(reason.message); }
      finally { onConversationHandled?.(); }
    })(); return () => { active = false; };
  }, [initialConversationId, initialOrderId, role, notify, onConversationHandled]);
  const loadMore = async () => { try { const more = await listChatConversations(role, rows.at(-1)?.last_activity_at); setRows(current => [...current, ...more]); } catch (reason) { notify?.(reason.message); } };
  return <div className={`chat-workspace ${embedded ? 'chat-embedded' : ''}`}>
    <ConversationList role={role} rows={rows} selectedId={selected?.id} search={search} setSearch={setSearch} onOpen={setSelected} loading={loading} error={error} onRetry={load} onMore={loadMore} />
    {selected && <Conversation conversation={selected} notify={notify} onBack={() => setSelected(null)} onChanged={load} />}
  </div>;
}
