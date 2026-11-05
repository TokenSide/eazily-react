const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { createHmac, webcrypto } = require('node:crypto');
const vm = require('node:vm');

const secret = 'local-test-only-secret';
const orderId = 'eazily_local_test_order';
let collaboration = { order_id: 'order-1', cashfree_order_id: orderId, customer_total: 100, payment_status: 'pending' };
let order = { id: 'order-1', status: 'awaiting_acceptance' };
let handler;

function query(table) {
  let action = 'select', patch, filters = [];
  const rows = () => table === 'cashfree_collaborations' ? [collaboration] : [order];
  const matches = row => filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value);
  const execute = () => {
    const row = rows().find(matches);
    if (row && action === 'update') Object.assign(row, patch);
    return { data: row ? { ...row } : null, error: null };
  };
  const builder = {
    select() { if (action !== 'update') action = 'select'; return builder; },
    update(value) { action = 'update'; patch = value; return builder; },
    eq(key, value) { filters.push([key, value]); return builder; },
    in(key, values) { filters.push([key, values]); return builder; },
    single() { return Promise.resolve(execute()); },
    maybeSingle() { return Promise.resolve(execute()); },
    then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
  };
  return builder;
}

const source = readFileSync('supabase/functions/cashfree-webhook/index.ts', 'utf8')
  .replace(/^import .*;\r?\n/m, '')
  .replace('(a: string, b: string)', '(a, b)')
  .replace(/Deno\.env\.get\(([^)]*)\)!/g, 'Deno.env.get($1)');
vm.runInNewContext(source, {
  TextEncoder, crypto: webcrypto, btoa, Response,
  Deno: { env: { get: name => ({
    EAZILY_FINANCIAL_PROVIDERS_ENABLED: 'true', CASHFREE_CLIENT_SECRET: secret,
    SUPABASE_URL: 'https://example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-only',
  })[name] }, serve: callback => { handler = callback; } },
  createClient: () => ({ from: query }),
});

async function send(type, overrideSignature) {
  const body = JSON.stringify({ type, data: { order: { order_id: orderId }, payment: { payment_amount: 100, payment_currency: 'INR' } } });
  const timestamp = 'test-timestamp';
  const signature = overrideSignature ?? createHmac('sha256', secret).update(timestamp + body).digest('base64');
  return handler({ text: async () => body, headers: { get: name => ({ 'x-webhook-timestamp': timestamp, 'x-webhook-signature': signature })[name] } });
}

(async () => {
  assert.equal((await send('PAYMENT_SUCCESS_WEBHOOK', 'forged')).status, 401);
  assert.equal(collaboration.payment_status, 'pending', 'An unsigned event cannot change payment state');
  collaboration.payment_status = 'paid';
  assert.equal((await send('PAYMENT_FAILED_WEBHOOK')).status, 200);
  assert.equal(collaboration.payment_status, 'paid', 'A late failure cannot undo a verified payment');
  order.status = 'completed';
  assert.equal((await send('PAYMENT_SUCCESS_WEBHOOK')).status, 200);
  assert.equal(order.status, 'completed', 'A duplicate success cannot reset a completed order');
  collaboration.payment_status = 'pending';
  await send('PAYMENT_FAILED_WEBHOOK');
  assert.equal(collaboration.payment_status, 'failed');
  await send('PAYMENT_SUCCESS_WEBHOOK');
  assert.equal(collaboration.payment_status, 'paid', 'A later successful attempt can settle a failed attempt');
  console.log('Cashfree webhook state regression: passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
