// TEST-ONLY full-shell router harness: real App.jsx + mocked auth/service boundary.
import { createRoot } from 'react-dom/client';
import App from '../src/App.jsx';
import { AccountContext } from '../src/lib/account.js';
import { Conversation } from '../src/features/chat/ChatWorkspace.jsx';
import OrderDetail from '../src/features/partners/OrderDetail.jsx';
import { Sheet } from '../src/components/Ui.jsx';
const q = new URLSearchParams(location.search);
window.__scenario = q.get('scenario') || 'signed_out';
// Admin overview truth cases: default/omitted = missing summary (mock default), zeros = recorded empty counts.
window.__adminSummary = { one: { orders: 12 }, zeros: { orders: 0, partnerOrders: 0 }, positive: { orders: 12, partnerOrders: 7 } }[q.get('summary') || ''];
const path = q.get('path') || '/';
history.replaceState({}, '', path + (q.toString() ? '?' + q.toString() : ''));

// TEST-ONLY component fixture: real Conversation under real production CSS with fixture data.
// Verifies identity card, job-context card, options sheet and composer states without a backend.
if (q.get('view') === 'chat-fixture') {
  const fixtureUser = { id: 'u-fixture-customer' };
  const fixtureConversation = {
    id: 'conv-fixture-1',
    other_name: 'Ravi Verma (fixture)',
    context_label: 'Home Cleaning',
    reference: 'Order EA-1042',
    status: 'active',
    conversation_type: 'order',
    archived: false,
    muted: false,
    blocked_by: q.get('blocked') === '1' ? fixtureUser.id : null,
  };
  const fixtureMessages = [
    { id: 'm1', sender_kind: 'them', body: 'Namaste, confirming the 10 AM slot tomorrow.', created_at: '2026-11-04T10:00:00+05:30' },
    { id: 'm2', sender_kind: 'you', body: 'Confirmed. Please bring the deep-clean kit.', read: true, created_at: '2026-11-04T10:02:00+05:30' },
    { id: 'm3', sender_kind: 'system', body: 'Booking EA-1042 confirmed for 6 Nov, 10:00 AM.', created_at: '2026-11-05T09:00:00+05:30' },
  ];
  const servicesOverride = { getChatMessages: async () => fixtureMessages, markChatRead: async () => {} };
  createRoot(document.getElementById('root')).render(
    <AccountContext.Provider value={{ user: fixtureUser, profile: { id: fixtureUser.id, full_name: 'Chat Fixture' }, roles: [], requestAuth: () => {}, refresh: async () => {} }}>
      <Conversation conversation={fixtureConversation} notify={() => {}} onBack={() => {}} onChanged={() => {}} servicesOverride={servicesOverride} />
    </AccountContext.Provider>
  );
} else if (q.get('view') === 'order-fixture') {
  // TEST-ONLY component fixture: real OrderDetail (partner side) with a requested professional job.
  // expired=1 leaves the offer table empty so the honest expired-offer notice must replace actions.
  const order = {
    id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    title: 'Deep home cleaning (fixture)',
    role: 'professional',
    status: 'requested',
    partner_id: 'p-fixture-partner',
    match_service: 'Home Cleaning',
    match_city: 'Bhopal',
    details: {},
    created_at: '2026-11-05T09:00:00+05:30',
  };
  window.__fixtureRows = q.get('expired') === '1' ? {} : {
    service_booking_offers: [{ id: 'offer-1', order_id: order.id, partner_id: order.partner_id, status: 'offered', expires_at: new Date(Date.now() + 3600e3).toISOString() }],
  };
  // Same mounting context as production: OrderDetail inside the partner sheet in the workspace shell.
  createRoot(document.getElementById('root')).render(
    <AccountContext.Provider value={{ user: { id: 'u-fixture-partner' }, profile: { id: 'u-fixture-partner', full_name: 'Partner Fixture' }, roles: ['professional'], requestAuth: () => {}, refresh: async () => {} }}>
      <main className="partner-workspace role-professional">
        <Sheet className="partner-post-sheet" onClose={() => {}}>
          <OrderDetail order={order} notify={() => {}} onChange={() => {}} />
        </Sheet>
      </main>
    </AccountContext.Provider>
  );
} else {
  createRoot(document.getElementById('root')).render(<App />);
}
