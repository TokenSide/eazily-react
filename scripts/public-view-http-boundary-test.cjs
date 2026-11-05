// Read-only check against an isolated local PostgREST instance with public exposed.
// The full view contents and publication rules are covered by security-definer-views-test.cjs.
const assert = require('node:assert/strict');

const views = [
  'customer_reviews', 'vendor_directory', 'partner_directory',
  'partner_public_config', 'customer_professional_directory',
  'customer_professional_reviews', 'customer_service_verification',
];
const base = new URL(process.env.EAZILY_LOCAL_POSTGREST_URL || 'http://127.0.0.1:3008');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname),
  'HTTP boundary test must target local PostgREST only');

(async () => {
  for (const view of views) {
    const publicView = await fetch(new URL(`/${view}`, base));
    assert.equal(publicView.status, 200, `${view}: public view must be readable`);
    assert.ok(Array.isArray(await publicView.json()), `${view}: expected JSON rows`);

    const directRpc = await fetch(new URL(`/rpc/read_${view}`, base));
    assert.ok([404, 406].includes(directRpc.status),
      `${view}: public HTTP RPC must be unavailable (${directRpc.status})`);

    const internalRpc = await fetch(new URL(`/rpc/read_${view}`, base), {
      headers: { 'Accept-Profile': 'eazily_public_read_internal' },
    });
    assert.equal(internalRpc.status, 406,
      `${view}: dedicated helper schema must not be exposed`);
  }
  console.log('PASS: seven public HTTP views, no direct helper RPC, internal schema not exposed.');
})().catch(error => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
