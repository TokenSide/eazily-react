/* Unit check: admin attention alerts are de-duplicated, open-only and carry no sensitive fields. */
const assert = require('node:assert/strict');

(async () => {
  const { buildAttentionAlerts } = await import('../src/features/admin/supportAttention.js');
  const order = 'a1b2c3d4-0000-4000-8000-000000000001', ticket = 'f9e8d7c6-0000-4000-8000-000000000002';
  const alerts = buildAttentionAlerts([
    { id: 't1', task_type: 'booking_attention', related_entity_type: 'partner_orders', related_entity_id: order, status: 'pending', due_at: '2026-09-27T09:00:00Z', created_at: '2026-09-27T09:00:00Z', phone: '+919876543210', address: 'House 1', resolution_note: 'Aadhaar 1234' },
    { id: 't2', task_type: 'booking_attention', related_entity_type: 'partner_orders', related_entity_id: order, status: 'pending', due_at: '2026-09-27T10:00:00Z', created_at: '2026-09-27T10:00:00Z' },
    { id: 't3', task_type: 'urgent_ticket_attention', related_entity_type: 'support_tickets', related_entity_id: ticket, status: 'in_review', due_at: '2026-09-27T11:00:00Z', escalated_at: '2026-09-27T11:30:00Z', created_at: '2026-09-27T11:00:00Z' },
    { id: 't4', task_type: 'urgent_ticket_attention', related_entity_type: 'support_tickets', related_entity_id: 'old', status: 'resolved', created_at: '2026-09-27T08:00:00Z' },
    { id: 't5', task_type: 'payout_review', related_entity_type: 'partner_payouts', related_entity_id: 'x', status: 'pending' },
  ]);
  assert.equal(alerts.length, 2, 'One alert per booking/ticket; resolved and unrelated tasks hidden');
  assert.deepEqual(alerts.map(a => a.id), ['t3', 't2'], 'Newest first, newest duplicate kept');
  assert.deepEqual(alerts[1], { id: 't2', type: 'booking_attention', label: 'Possible no-show', target: 'booking', entityId: order, reference: 'EAZ-A1B2C3D4', at: '2026-09-27T10:00:00Z', status: 'Needs attention', state: 'pending', escalated: false });
  assert.equal(alerts[0].target, 'ticket'); assert.equal(alerts[0].status, 'In review'); assert.equal(alerts[0].escalated, true);
  assert.doesNotMatch(JSON.stringify(alerts), /9876543210|House 1|Aadhaar|resolution_note/, 'No phone, address or document details');
  assert.deepEqual(buildAttentionAlerts(), []);
  console.log('PASS: attention alerts are open-only, one per booking/ticket, newest first, and contain no phone/address/document data.');
})().catch(error => { console.error(error); process.exitCode = 1; });
