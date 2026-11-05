export function serviceRequestStatus(request) {
  if (request.request_type === 'service' && !request.assigned_vendor_id &&
    ['pending', 'accepted', 'in_progress'].includes(request.status)) return 'Finding a professional';
  if (request.status === 'pending') {
    return request.request_type === 'service'
      ? request.assigned_vendor_id ? 'Requested · awaiting professional' : 'Finding a professional'
      : 'Requested';
  }
  return ({ accepted: 'Confirmed', in_progress: 'In progress', completed: 'Completed', cancelled: 'Cancelled' })[request.status] || request.status;
}

export function partnerBookingStatus(order) {
  if (order.backup_price_approval_pending) return 'Backup price approval needed';
  if (order.status === 'accepted' && order.journey_status === 'on_the_way') return 'On the way';
  if (order.role === 'influencer' && order.status === 'requested') return 'Collaboration enquiry sent';
  if (order.role === 'influencer' && order.status === 'accepted') return 'Collaboration enquiry accepted';
  if (order.role === 'consultant' && order.status === 'requested') return order.free_intro ? 'Introduction requested' : 'Consultation enquiry sent';
  if (order.role === 'consultant' && order.status === 'accepted') return order.free_intro ? 'Introduction accepted' : 'Consultation enquiry accepted';
  if (order.status === 'requested') return order.role === 'professional' ? 'Requested · awaiting professional' : 'Requested';
  return ({ accepted: 'Confirmed', active: 'In progress', awaiting_acceptance: 'Awaiting customer confirmation', completed: 'Completed', cancelled: 'Cancelled', disputed: 'Disputed' })[order.status] || order.status;
}

// Only explicit server references or the exact original idempotency key prove
// that two records represent one booking. Similar names/dates are not a link.
export function mergeCustomerBookings(requests, orders) {
  const linkedRequests = new Set();
  for (const order of orders) {
    const reference = order.source_request_id || order.service_request_id || order.details?.serviceRequestId || order.details?.service_request_id || order.details?.sourceRequestId;
    for (const request of requests) {
      if (request.customer_id !== order.customer_id) continue;
      if (reference === request.id || request.details?.partnerOrderId === order.id || request.details?.partner_order_id === order.id ||
        (request.idempotency_key && order.request_key === request.idempotency_key)) linkedRequests.add(request.id);
    }
  }
  return [
    ...requests.filter(request => !linkedRequests.has(request.id)).map(record => ({ type: 'request', record, status: serviceRequestStatus(record) })),
    ...orders.map(record => ({ type: 'partner', record, status: partnerBookingStatus(record) })),
  ].sort((a, b) => Date.parse(b.record.created_at || 0) - Date.parse(a.record.created_at || 0));
}
