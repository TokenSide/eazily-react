// Support attention alerts come from operational_review_tasks (one row per deduplication key,
// readable by admins and support.manage staff). notification_outbox holds one copy per staff
// member, so it is not used here.
export const ATTENTION_TYPES = ['booking_attention', 'urgent_ticket_attention'];
const labels = { booking_attention: 'Possible no-show', urgent_ticket_attention: 'Urgent ticket waiting' };
const statusLabels = { pending: 'Needs attention', in_review: 'In review', resolved: 'Resolved', cancelled: 'Cancelled' };

// Returns only safe display fields; phone, address, document or payload data is never copied.
export function buildAttentionAlerts(rows = []) {
  const newest = new Map();
  for (const row of rows) {
    if (!ATTENTION_TYPES.includes(row?.task_type) || !row.related_entity_id) continue;
    if (['resolved', 'cancelled'].includes(row.status)) continue;
    const key = `${row.task_type}:${row.related_entity_type}:${row.related_entity_id}`;
    const current = newest.get(key);
    if (!current || Date.parse(row.created_at || 0) > Date.parse(current.created_at || 0)) newest.set(key, row);
  }
  return [...newest.values()]
    .map(row => ({
      id: row.id,
      type: row.task_type,
      label: labels[row.task_type],
      target: row.related_entity_type === 'partner_orders' ? 'booking' : 'ticket',
      entityId: String(row.related_entity_id),
      reference: `EAZ-${String(row.related_entity_id).slice(0, 8).toUpperCase()}`,
      at: row.due_at || row.created_at || null,
      status: statusLabels[row.status] || row.status,
      state: row.status,
      escalated: Boolean(row.escalated_at),
    }))
    .sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0));
}
