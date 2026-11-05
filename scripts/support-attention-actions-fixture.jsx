// Browser fixture: SupportAttentionAlerts with an in-page fake of readRows/rpc (services/experience.js).
// The fake mirrors act_on_support_attention: server-owned status, reason 3-1000, acknowledge only when pending.
import { createRoot } from 'react-dom/client';
import SupportAttentionAlerts from '../src/features/admin/SupportAttentionAlerts.jsx';

const tasks = [
  { id: 'task-noshow', task_type: 'booking_attention', related_entity_type: 'partner_orders', related_entity_id: 'a1b2c3d4-0000-4000-8000-000000000001', status: 'pending', due_at: '2026-09-27T09:00:00Z', created_at: '2026-09-27T09:00:00Z' },
  { id: 'task-urgent', task_type: 'urgent_ticket_attention', related_entity_type: 'support_tickets', related_entity_id: 'f9e8d7c6-0000-4000-8000-000000000002', status: 'pending', due_at: '2026-09-27T10:00:00Z', created_at: '2026-09-27T10:00:00Z' },
];
window.__attention = { calls: [], failNext: '', delay: 400, opened: [] };

export async function readRows(table, build) {
  if (table !== 'operational_review_tasks') return [];
  let rows = tasks.map(task => ({ ...task }));
  const query = { in: (column, values) => { rows = rows.filter(row => values.includes(row[column])); return query; }, order: () => query, limit: () => query };
  build(query);
  return rows;
}

export async function rpc(name, args) {
  window.__attention.calls.push({ name, args });
  await new Promise(done => setTimeout(done, window.__attention.delay));
  if (name !== 'act_on_support_attention') throw new Error('Unexpected RPC');
  if (window.__attention.failNext) { const message = window.__attention.failNext; window.__attention.failNext = ''; throw new Error(message); }
  const reason = String(args.p_reason || '').trim();
  if (reason.length < 3 || reason.length > 1000) throw new Error('Give a reason of 3-1000 characters');
  const task = tasks.find(item => item.id === args.p_task);
  if (!task) throw new Error('Support attention task not found');
  if (args.p_action === 'acknowledge') { if (task.status !== 'pending') throw new Error('Support attention task cannot be acknowledged'); task.status = 'in_review'; }
  else if (args.p_action === 'resolve') task.status = 'resolved';
  return { ...task };
}

createRoot(document.getElementById('root')).render(<SupportAttentionAlerts onOpen={alert => window.__attention.opened.push(alert.entityId)} />);
