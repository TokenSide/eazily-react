// Pure in-memory service. No network, storage, authentication, payment SDK, or production service imports.
import { createDemoState, sampleOrder, roles } from './fixtures.js';
import { serviceQuote } from './pricing.js';

function ensure(condition, message) { if (!condition) throw new Error(message); }
export function demoReducer(state, action) {
  const now = action.now ?? Date.now();
  if (action.type === 'reset') return { ...createDemoState(now), notice: 'All three demo workspaces reset. Your actual account was not changed.' };
  if (action.type === 'dismiss') return { ...state, notice: '', error: '' };
  try {
    ensure(roles.includes(action.role), 'Unknown demo partner');
    const next = structuredClone(state), ws = next.workspaces[action.role];
    const at = new Date(now).toISOString();
    next.error = ''; next.notice = '';
    const announce = (title, order) => {
      next.notice = title;
      ws.notifications.unshift({ id: `demo-event-${ws.notifications.length}-${now}`, title, order_id: order?.id, read_at: null });
      order?.events.push({ kind: title, at });
    };
    if (action.type === 'lead') {
      const order = sampleOrder(action.role, ws.nextIndex++, now);
      ws.orders.unshift(order); announce('New sample request received', order); return next;
    }
    if (action.type === 'online') { ws.online = !!action.value; announce(ws.online ? 'Demo availability: online' : 'Demo availability: offline'); return next; }
    if (action.type === 'read') { ws.notifications.forEach(n => { if (!action.id || n.id === action.id) n.read_at = at; }); return next; }
    const order = ws.orders.find(o => o.id === action.orderId);
    ensure(order, 'Sample request not found');
    const requireStatus = (...statuses) => ensure(statuses.includes(order.status), 'This action is unavailable at the current stage.');
    const earning = (state, amount) => { if (!ws.earnings.some(e => e.order_id === order.id && e.state === state)) ws.earnings.push({ id: `${order.id}-${state}`, order_id: order.id, state, amount }); };
    switch (action.type) {
      case 'accept':
        requireStatus('requested');
        ensure(!ws.orders.some(o => o.id !== order.id && ['accepted', 'active'].includes(o.status) && Math.abs(Date.parse(o.deadline) - Date.parse(order.deadline)) < 3600000), 'Another accepted or active sample booking is within one hour of this slot.');
        order.status = 'accepted'; announce('Sample request accepted', order); break;
      case 'reject':
        requireStatus('requested'); ensure(action.reason?.trim().length >= 3, 'Enter a rejection reason of at least 3 characters.');
        order.status = 'cancelled'; announce(`Sample request rejected: ${action.reason.trim()}`, order); break;
      case 'arrival':
        requireStatus('accepted'); ensure(order.role === 'professional', 'Arrival verification is available for service jobs only.');
        if (order.lockUntil > now) throw new Error('Demo code locked for 15 minutes after five attempts. Reset Demo Data to retry now.');
        if (action.code !== '246810') {
          order.attempts = (order.attempts || 0) + 1;
          if (order.attempts >= 5) order.lockUntil = now + 15 * 60000;
          next.error = order.lockUntil ? 'Demo code locked for 15 minutes. Reset Demo Data to retry now.' : 'Incorrect sample arrival code. Use 246810.';
          return next;
        }
        order.arrivalVerified = true; order.status = 'active'; announce('Sample arrival verified; work in progress', order); break;
      case 'quote':
        requireStatus('active', 'awaiting_acceptance');
        ensure(order.role === 'professional' && order.arrivalVerified && order.quote?.status !== 'paid', 'A verified service arrival and unpaid booking are required.');
        order.quote = { ...serviceQuote(order.amount * 100), status: 'proposed' }; order.status = 'awaiting_acceptance';
        announce('Sample final quote sent', order); break;
      case 'approve':
        ensure(order.quote?.status === 'proposed', 'A proposed sample quote is required.');
        order.quote.status = 'approved'; announce('Simulated customer approved the quote', order); break;
      case 'pay':
        ensure(order.role === 'professional' && order.quote?.status === 'approved' && !order.payment, 'An approved, unpaid service quote is required.');
        order.payment = 'paid'; order.quote.status = 'paid'; earning('pending', order.quote.sellerPayablePaise / 100);
        announce('Simulated payment successful — demo pending earnings updated', order); break;
      case 'prepay':
        ensure(order.role === 'influencer' && order.prepaid && !order.payment, 'Use an unpaid prepaid-collaboration sample.');
        order.payment = 'paid'; announce('Simulated prepaid payment successful; scope confirmation is next', order); break;
      case 'scope':
        ensure(order.role === 'influencer' && order.payment === 'paid' && !order.scopeConfirmed, 'A paid sample collaboration with unconfirmed scope is required.');
        order.scopeConfirmed = true;
        earning('pending', order.collaboration.initialRelease); earning('security_hold', order.collaboration.securityHold);
        announce('Simulated trusted scope confirmation — 70% pending, 30% held', order); break;
      case 'complete':
        requireStatus('awaiting_acceptance'); order.status = 'completed';
        announce('Simulated customer confirmed completion', order); break;
      case 'release':
        requireStatus('completed');
        ensure(order.role === 'influencer' && order.payment === 'paid' && order.scopeConfirmed && !order.holdReleased, 'A completed sample collaboration with an unreleased hold is required.');
        ws.earnings.filter(e => e.order_id === order.id && e.state === 'security_hold').forEach(e => { e.state = 'available'; });
        order.holdReleased = true; announce('Simulated trusted hold release — demo available earnings updated', order); break;
      case 'message':
        ensure(action.body?.trim().length > 0 && action.body.trim().length <= 4000, 'Demo messages must contain 1–4000 characters.');
        order.messages.push({ id: `${order.id}-message-${order.messages.length}`, body: action.body.trim(), at, sender: 'You (demo)' });
        announce('Demo message saved locally; nothing was sent', order); break;
      default: throw new Error('This capability is unavailable in the demo.');
    }
    return next;
  } catch (error) { return { ...state, error: error.message, notice: '' }; }
}

export function demoTotal(workspace, status) { return workspace.earnings.filter(e => e.state === status).reduce((sum, e) => sum + e.amount, 0); }
export function leadStatus(order) { return order.status === 'requested' ? 'new' : order.status === 'cancelled' ? 'lost' : order.status === 'completed' ? 'won' : 'active'; }
