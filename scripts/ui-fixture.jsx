// Browser-only fixture. Not imported by the production app.
// Exercises REAL components (chat workspace, partner profile/messages, admin)
// with fake non-live accounts so theme migration can be visually verified
// without touching production auth or guest routing.
import { createRoot } from 'react-dom/client';
import { AccountContext } from '../src/lib/account.js';
import ChatWorkspace, { ChatBubble } from '../src/features/chat/ChatWorkspace.jsx';
import PartnerApp from '../src/pages/PartnerApp.jsx';
import AdminApp from '../src/pages/AdminApp.jsx';
import PartnerOnboarding from '../src/features/partners/PartnerOnboarding.jsx';
import { ConversationList, Conversation } from '../src/features/chat/ChatWorkspace.jsx';
import DemoWorkspace from '../src/features/partners/demo/DemoWorkspace.jsx';
import '../src/styles.css';
import '../src/experience.css';
import '../src/partner.css';
import '../src/realtime.css';
import '../src/customer-theme.css';

const notify = () => {};
const partnerApp = { id: 'fixture-app', role: 'professional', status: 'approved',
  details: { name: 'Fixture Electricals', city: 'Bhopal', category: 'Home & Property', services: ['Electrician'], stage: 5, registrationComplete: true } };
const partnerAccount = { user: { id: 'fixture-partner' }, profile: { name: 'Fixture Partner', role: 'partner' },
  roles: ['professional'], applications: [partnerApp] };
const adminAccount = { user: { id: 'fixture-admin' }, profile: { name: 'Fixture Admin', role: 'admin' },
  roles: [], applications: [], staff: null };
const context = account => ({ ...account, requestAuth: () => {}, refresh: async () => account, logout: () => {} });

const view = new URLSearchParams(location.search).get('view') || 'chat';
function Fixture() {
  if (view === 'chat') return <AccountContext.Provider value={context(partnerAccount)}><ChatWorkspace role="professional" notify={notify} /></AccountContext.Provider>;
  if (view === 'partner') return <AccountContext.Provider value={context(partnerAccount)}><PartnerApp role="professional" account={partnerAccount} notify={notify} onWorkspace={() => {}} onAddRole={() => {}} onEditRegistration={() => {}} /></AccountContext.Provider>;
  if (view === 'admin') return <AccountContext.Provider value={context(adminAccount)}><AdminApp notify={notify} account={adminAccount} logout={() => {}} /></AccountContext.Provider>;
  if (view === 'partner-edit') return <AccountContext.Provider value={context(partnerAccount)}><PartnerOnboarding role="professional" existing={partnerApp} account={partnerAccount} notify={notify} onDone={() => {}} onBack={() => {}} onPreview={() => {}} /></AccountContext.Provider>;
  if (view === 'onboarding-professional') return <AccountContext.Provider value={context(partnerAccount)}><PartnerOnboarding role="professional" existing={null} account={partnerAccount} notify={notify} onDone={() => {}} onBack={() => {}} onPreview={() => {}} /></AccountContext.Provider>;
  if (view === 'onboarding-influencer') return <AccountContext.Provider value={context(partnerAccount)}><PartnerOnboarding role="influencer" existing={null} account={partnerAccount} notify={notify} onDone={() => {}} onBack={() => {}} onPreview={() => {}} /></AccountContext.Provider>;
  if (view === 'demo-consultant') return <DemoWorkspace initialRole="consultant" onExit={() => {}} />;
  if (view === 'demo-professional') return <DemoWorkspace initialRole="professional" onExit={() => {}} />;

  if (view === 'chat-list') {
    const rows = [
      { id: 'c1', conversation_type: 'service', other_name: 'Rohan Sharma', context_label: 'AC Service', reference: 'EAZ-A1B2C3D4', status: 'active', last_preview: 'Job ke liye confirm hai kya?', last_activity_at: '2026-11-05T10:24:00+05:30', unread_count: 2 },
      { id: 'c2', conversation_type: 'service', other_name: 'Pooja Kulkarni', context_label: 'Plumbing', reference: 'EAZ-E5F6A7B8', status: 'active', last_preview: 'Technician kab tak pahunchega?', last_activity_at: '2026-11-04T18:10:00+05:30', unread_count: 0 },
      { id: 'c3', conversation_type: 'consultant', other_name: 'Amit Mishra', context_label: 'Career session', reference: 'EAZ-C9D0E1F2', status: 'active', last_preview: 'Service complete ho gaya. Thanks!', last_activity_at: '2026-10-29T12:00:00+05:30', unread_count: 0 },
      { id: 'c4', conversation_type: 'support', other_name: 'Eazily Support', context_label: 'Support', reference: null, status: 'active', last_preview: 'Aapka KYC verify ho gaya hai.', last_activity_at: '2026-10-28T09:00:00+05:30', unread_count: 0 },
    ];
    return <ConversationList role="professional" rows={rows} selectedId={null} search="" setSearch={() => {}} onOpen={() => {}} loading={false} error="" onRetry={() => {}} onMore={() => {}} />;
  }
  if (view === 'chat-list-customer') {
    const rows = [
      { id: 'c1', conversation_type: 'service', other_name: 'Spark Electricals', context_label: 'AC Service', reference: 'EAZ-A1B2C3D4', status: 'active', last_preview: 'Kal 10 baje pahunch jaunga.', last_activity_at: '2026-11-05T10:24:00+05:30', unread_count: 1 },
      { id: 'c4', conversation_type: 'support', other_name: 'Eazily Support', context_label: 'Support', reference: null, status: 'active', last_preview: 'Aapka KYC verify ho gaya hai.', last_activity_at: '2026-10-28T09:00:00+05:30', unread_count: 0 },
    ];
    return <ConversationList role={null} rows={rows} selectedId={null} search="" setSearch={() => {}} onOpen={() => {}} loading={false} error="" onRetry={() => {}} onMore={() => {}} />;
  }
  if (view === 'chat-thread-real') {
    const convo = { id: 'fx-1', other_name: 'Rohan Sharma', context_label: 'AC Service', reference: 'EAZ-A1B2C3D4', status: 'active', archived: false, muted: false, blocked_by: null };
    const msgs = [
      { id: 'm0', sender_kind: 'system', body: 'Conversation started from booking EAZ-A1B2C3D4', created_at: '2026-11-04T10:00:00+05:30' },
      { id: 'm1', sender_kind: 'them', body: 'Hello, AC service ke liye aap kal aa sakte hain?', created_at: '2026-11-04T10:02:00+05:30' },
      { id: 'm2', sender_kind: 'you', body: 'Haan ji, main kal 10 baje tak aapke location par pahunch jaunga.', created_at: '2026-11-04T10:03:00+05:30', read: true },
      { id: 'm3', sender_kind: 'them', body: 'Theek hai, address wahi MP Nagar wala hai.', created_at: '2026-11-04T10:06:00+05:30' },
      { id: 'm4', sender_kind: 'you', body: 'Bilkul, milte hain kal 10 baje.', created_at: '2026-11-04T10:07:00+05:30', read: true },
    ];
    const mockServices = { getChatMessages: async () => msgs, markChatRead: async () => ({}) };
    return <AccountContext.Provider value={context(partnerAccount)}><div className="chat-workspace"><Conversation conversation={convo} notify={() => {}} onBack={() => {}} onChanged={() => {}} servicesOverride={mockServices} /></div></AccountContext.Provider>;
  }
  if (view === 'chat-thread') {
    const messages = [
      { id: 'm0', sender_kind: 'system', body: 'Conversation started from booking BK-1042', created_at: '2026-11-04T10:00:00+05:30' },
      { id: 'm1', sender_kind: 'them', body: 'Namaste, main kal subah 10 baje aa jaunga. Kya switchboard ka photo bhej sakte hain?', created_at: '2026-11-04T10:02:00+05:30' },
      { id: 'm2', sender_kind: 'you', body: 'Ji bilkul, abhi bhejta hoon. MCB bhi trip ho rahi hai, wo bhi dekh lijiyega.', created_at: '2026-11-04T10:03:00+05:30', read: true },
      { id: 'm3', sender_kind: 'you', body: 'Aur parking basement mein hai, gate pe guard ko batana.', created_at: '2026-11-04T10:03:30+05:30', read: true },
      { id: 'm4', sender_kind: 'them', body: 'Theek hai, parts ka estimate pehle bhej dunga. Payment sirf Eazily app ke through hi hogi.', created_at: '2026-11-05T09:15:00+05:30' },
      { id: 'm5', sender_kind: 'you', body: 'Perfect, kal milte hain.', created_at: '2026-11-05T09:20:00+05:30', read: false },
    ];
    return <AccountContext.Provider value={context(partnerAccount)}><div className="chat-workspace"><section className="chat-thread" aria-label="Fixture conversation">
      <header className="chat-thread-head"><span><b>Ramesh Yadav</b><small>Electrician visit · BK-1042 · Online</small></span></header>
      <div className="chat-privacy">Eazily payment protection applies only to payments made through Eazily official payment system.</div>
      <div className="chat-messages">
        <p className="chat-date">Nov 4, 2026</p>
        <p className="chat-system">{messages[0].body}</p>
        {messages.slice(1, 4).map(message => <ChatBubble key={message.id} message={message} />)}
        <p className="chat-date">Nov 5, 2026</p>
        {messages.slice(4).map(message => <ChatBubble key={message.id} message={message} />)}
      </div>
      <form className="chat-composer"><label className="chat-attach" aria-label="Attach image or PDF">+<input type="file" readOnly /></label><textarea aria-label="Message" rows="1" placeholder="Write a message" readOnly /><button className="chat-send" type="button" aria-label="Send message"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/></svg></button></form>
    </section></div></AccountContext.Provider>;
  }
  return <p>Unknown fixture view</p>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
