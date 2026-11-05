const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');

(async () => {
  const { mergeServicePool, nextServiceStart, serviceWindow } = await import('../src/features/home/moreServiceRotation.js');
  const { isCustomerEligibleProfessional } = await import('../src/services/customerProfessionalEligibility.js');
  const preferred = Array.from({ length: 6 }, (_, index) => ({ id: `p${index}`, name: `Service ${index}`, requestName: `Service ${index}` }));
  const catalogue = [...preferred, ...Array.from({ length: 7 }, (_, index) => ({ id: `c${index}`, name: `Extra ${index}`, requestName: `Extra ${index}` }))];
  const pool = mergeServicePool(preferred, catalogue);
  assert.equal(pool.length, 13);
  assert.equal(serviceWindow(pool, 0).length, 6);
  assert.equal(new Set(serviceWindow(pool, 0).map(service => service.requestName)).size, 6);
  assert.notDeepEqual(serviceWindow(pool, 0).map(service => service.requestName), serviceWindow(pool, nextServiceStart(pool, 0)).map(service => service.requestName));
  assert.deepEqual(serviceWindow(preferred, 0), preferred, 'Six services remain stable');

  const eligible = { id: 'one', partner_role: 'professional', verification_status: 'verified', account_status: 'active', post_status: 'published', accepting_bookings: true, service_names: ['AC Service'], coverage: ['Bhopal'], city: 'Bhopal', availability: 'Available today' };
  assert.equal(isCustomerEligibleProfessional(eligible, 'AC Service', 'Bhopal'), true);
  for (const rejected of [
    { ...eligible, verification_status: 'pending' },
    { ...eligible, account_status: 'suspended' },
    { ...eligible, post_status: 'draft' },
    { ...eligible, accepting_bookings: false },
    { ...eligible, service_names: ['Painter'] },
    { ...eligible, coverage: ['Indore'], city: 'Indore' },
    { ...eligible, availability: 'Offline only unavailable' },
  ]) assert.equal(isCustomerEligibleProfessional(rejected, 'AC Service', 'Bhopal'), false);

  const fixtureSource = readFileSync('src/features/partners/demo/customerProfessionalFixtures.js', 'utf8');
  const gateSource = readFileSync('src/features/services/customerProfessionalDemo.js', 'utf8');
  assert.match(gateSource, /CUSTOMER_PROFESSIONAL_DEMO_ENABLED = PARTNER_DEMO_ENABLED/);
  assert.match(gateSource, /!CUSTOMER_PROFESSIONAL_DEMO_ENABLED \|\| !isolatedDemo/, 'Samples require the explicit isolated demo path');
  const userSource = readFileSync('src/pages/UserApp.jsx', 'utf8');
  assert.match(userSource, /PARTNER_DEMO_ENABLED && !isSupabaseConfigured && !account\?\.user/, 'Real accounts cannot enter the sample customer path');
  assert.match(fixtureSource, /demo:\s*true/);
  assert.doesNotMatch(fixtureSource, /insert|upsert|rpc\(/i, 'Demo fixture performs no persistence');
  const sql = readFileSync('supabase/customer_professional_discovery_2026_09_21.sql', 'utf8');
  assert.match(sql, /application\.status = 'approved'/);
  assert.match(sql, /seller_can_receive_booking/);
  assert.match(sql, /review_order\.status = 'completed'/);
  assert.match(sql, /post\.status = 'published'/);
  const homeSource = readFileSync('src/features/home/UserHome.jsx', 'utf8');
  assert.match(homeSource, /setInterval\(rotate, 4600\)/);
  assert.match(homeSource, /clearInterval\(interval\)/, 'Rotation timer is cleared on component close');
  console.log('PASS: professional eligibility, isolated demo fixture, catalogue rotation windows, and customer discovery SQL gates.');
})().catch(error => { console.error(error); process.exitCode = 1; });
