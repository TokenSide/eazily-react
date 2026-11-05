const assert = require('node:assert/strict');

(async () => {
  const { mergeCustomerBookings, serviceRequestStatus, partnerBookingStatus } = await import('../src/features/services/customerBookings.js');
  const customer = 'customer-1';
  const unassigned = { id: 'request-1', customer_id: customer, request_type: 'service', service_name: 'AC Service', status: 'pending', assigned_vendor_id: null, created_at: '2026-09-01T00:00:00Z' };
  const assigned = { ...unassigned, id: 'request-2', assigned_vendor_id: 'vendor-1', idempotency_key: 'key-2' };
  assert.equal(serviceRequestStatus(unassigned), 'Finding a professional');
  assert.equal(serviceRequestStatus({ ...unassigned, status: 'accepted' }), 'Finding a professional', 'No vendor means no confirmed claim');
  assert.equal(serviceRequestStatus(assigned), 'Requested · awaiting professional');
  assert.equal(serviceRequestStatus({ ...assigned, status: 'accepted' }), 'Confirmed');
  const partner = { id: 'order-1', customer_id: customer, role: 'professional', title: 'AC Service', status: 'requested', details: {}, created_at: '2026-09-02T00:00:00Z' };
  assert.equal(partnerBookingStatus(partner), 'Requested · awaiting professional');
  assert.equal(partnerBookingStatus({ ...partner, status: 'accepted' }), 'Confirmed');
  assert.equal(partnerBookingStatus({ ...partner, status: 'requested', backup_price_approval_pending: true }), 'Backup price approval needed');
  assert.equal(mergeCustomerBookings([unassigned, assigned], [partner]).length, 3, 'Same service is not proof of a duplicate');
  const linked = { ...partner, details: { serviceRequestId: assigned.id } };
  assert.deepEqual(mergeCustomerBookings([unassigned, assigned], [linked]).map(item => item.record.id), ['order-1', 'request-1']);
  assert.deepEqual(mergeCustomerBookings([unassigned, assigned], [{ ...partner, source_request_id: assigned.id }]).map(item => item.record.id), ['order-1', 'request-1']);
  assert.equal(mergeCustomerBookings([assigned], [{ ...partner, request_key: assigned.idempotency_key }]).length, 1);
  assert.equal(mergeCustomerBookings([assigned], [{ ...linked, customer_id: 'someone-else' }]).length, 2, 'Never merge different customers');
  console.log('PASS: one customer list, honest unassigned/assigned statuses, requested/confirmed states, and explicit-link deduplication.');
})().catch(error => { console.error(error); process.exitCode = 1; });
