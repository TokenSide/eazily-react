const assert = require('node:assert/strict');
const { existsSync, readFileSync, readdirSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const { build } = require('esbuild');
const { runInNewContext } = require('node:vm');
(async () => {
  const { createDemoState } = await import('../src/features/partners/demo/fixtures.js');
  const { demoReducer, demoTotal, leadStatus } = await import('../src/features/partners/demo/model.js');
  const { serviceQuote, collaborationQuote } = await import('../src/features/partners/demo/pricing.js');
  const now = Date.parse('2026-09-12T10:00:00Z');
  let state = createDemoState(now);
  const original = structuredClone(state);
  const act = (role, type, orderId, more = {}) => { state = demoReducer(state, { role, type, orderId, now, ...more }); return state; };
  for (const role of ['professional', 'influencer', 'consultant']) {
    assert.equal(state.workspaces[role].orders.length, 7);
    act(role, 'lead'); act(role, 'lead');
    assert.equal(state.workspaces[role].orders.filter(o => o.status === 'requested').length, 4);
    const id = `demo-${role}-0`;
    act(role, 'reject', id, { reason: 'x' }); assert.match(state.error, /at least 3/);
    act(role, 'accept', id); assert.equal(state.error, '');
    act(role, 'message', id, { body: 'Sample message' });
    assert.equal(state.workspaces[role].orders.find(o => o.id === id).messages[0].body, 'Sample message');
    act(role, 'reject', `demo-${role}-1`, { reason: 'Sample unavailable slot' });
    assert.equal(leadStatus(state.workspaces[role].orders.find(o => o.id === `demo-${role}-1`)), 'lost');
  }
  const p = 'professional', id = 'demo-professional-0';
  act(p, 'pay', id); assert.match(state.error, /approved/);
  act(p, 'arrival', id, { code: 'wrong' }); assert.match(state.error, /Incorrect/);
  act(p, 'arrival', id, { code: '246810' }); act(p, 'quote', id); act(p, 'approve', id);
  const before = demoTotal(state.workspaces[p], 'pending');
  act(p, 'pay', id); assert.equal(demoTotal(state.workspaces[p], 'pending'), before + 400);
  act(p, 'pay', id); assert.equal(demoTotal(state.workspaces[p], 'pending'), before + 400, 'Duplicate payment does not duplicate earnings');
  act(p, 'complete', id); assert.equal(leadStatus(state.workspaces[p].orders.find(o => o.id === id)), 'won');
  assert.equal(demoTotal(state.workspaces[p], 'available'), 0, 'Service earnings remain pending');
  const i = 'influencer', iid = 'demo-influencer-4';
  act(i, 'arrival', 'demo-influencer-0', { code: '246810' }); assert.match(state.error, /service jobs only/);
  act(i, 'prepay', iid); act(i, 'scope', iid);
  assert.equal(demoTotal(state.workspaces[i], 'security_hold'), 1080);
  act(i, 'release', iid); assert.match(state.error, /unavailable/);
  act(i, 'complete', iid); const available = demoTotal(state.workspaces[i], 'available');
  act(i, 'release', iid); assert.equal(demoTotal(state.workspaces[i], 'available'), available + 1080);
  act(i, 'release', iid); assert.equal(demoTotal(state.workspaces[i], 'available'), available + 1080);
  act('consultant', 'complete', 'demo-consultant-4');
  assert.equal(state.workspaces.consultant.orders.find(o => o.id === 'demo-consultant-4').status, 'completed');
  assert.equal(state.workspaces.consultant.earnings.length, 0);
  assert.deepEqual(createDemoState(now), original, 'Actions never mutate the seed or another instance');
  state = demoReducer(state, { type: 'reset', now });
  assert.deepEqual(state.workspaces, original.workspaces, 'Reset recreates all and only demo state');
  // Existing arrival lock and acceptance collision guard.
  act(p, 'accept', id);
  for (let j = 0; j < 5; j++) act(p, 'arrival', id, { code: '000000' });
  act(p, 'arrival', id, { code: '246810' }); assert.match(state.error, /locked/);
  state = createDemoState(now);
  state.workspaces[p].orders[0].deadline = state.workspaces[p].orders[2].deadline;
  act(p, 'accept', id); assert.match(state.error, /within one hour/);
  console.log('PASS isolated state, supported transitions, rejection, messages, repeated leads, reset, payment idempotency, earnings, locks and collision guards');

  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,phone text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;`);
    for (const f of ['schema', 'experience', 'wallet', 'partners', 'operations', 'seller_subscriptions', 'seller_pricing']) await db.exec(readFileSync('supabase/' + f + '.sql', 'utf8'));
    await db.exec('update seller_pricing_rules set enabled=true,seller_tax_bps=0,customer_tax_bps=0,fee_tax_bps=0,separate_fee_paise=0,include_visiting=true,include_additional=true');
    for (const base of [10000, 40000, 100000, 100001, 220099]) {
      const actual = (await db.query("select eazily_private.calculate('professional',$1) as quote", [{ servicePaise: base, visitingPaise: 0, additionalPaise: 0, quantity: 1, taxInclusive: false }])).rows[0].quote;
      for (const [key, value] of Object.entries(serviceQuote(base))) assert.equal(value, actual[key], key + ' matches SQL');
    }
    assert.throws(() => serviceQuote(9999), /unconfigured/);
    const config = (await db.query('select * from partner_config')).rows[0];
    for (const amount of [2000, 4000, 4999.99]) {
      const fee = Math.round(amount * Number(config.influencer_platform_fee_percent)) / 100;
      const payout = amount - fee, initial = Math.round(payout * Number(config.influencer_initial_release_percent)) / 100;
      assert.deepEqual(collaborationQuote(amount), { customerTotal: amount, platformFee: fee, partnerPayout: payout, initialRelease: initial, securityHold: payout - initial });
    }
  } finally { await db.close(); }
  console.log('PASS sample pricing compared with actual SQL and collaboration config defaults in local PGlite');
  const directory = 'src/features/partners/demo/';
  for (const file of readdirSync(directory).filter(f => /\.(jsx|js)$/.test(f))) {
    assert.doesNotMatch(readFileSync(directory + file, 'utf8'), /\b(fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon\s*\(|localStorage|sessionStorage|window\.open|location\s*=|navigator\.share|Notification\.requestPermission)/, 'No IO in ' + file);
  }
  for (const [dev, flag, enabled] of [[false, '', false], [false, 'false', false], [true, 'false', false], [false, 'true', true], [true, 'true', true]]) {
    const bundled = await build({ entryPoints: [directory + 'config.js'], bundle: true, write: false, format: 'cjs', define: { 'import.meta.env.DEV': String(dev), 'import.meta.env.VITE_PARTNER_DEMO': JSON.stringify(flag) } });
    const context = { module: { exports: {} } };
    runInNewContext(bundled.outputFiles[0].text, context);
    assert.equal(context.module.exports.PARTNER_DEMO_ENABLED, enabled, 'Only the explicit demo flag controls test-build access');
  }
  const graph = await build({ entryPoints: [directory + 'DemoWorkspace.jsx'], bundle: true, write: false, metafile: true, jsx: 'automatic', loader: { '.css': 'empty' }, define: { 'import.meta.env.VITE_PARTNER_DEMO': '"true"' } });
  for (const dependency of Object.keys(graph.metafile.inputs)) assert.doesNotMatch(dependency, /supabase|services\/|OrderDetail|PostForm|Checkout|src\/App\.jsx/, 'Demo cannot import live capabilities: ' + dependency);
  const assetMode = process.argv.find(arg => arg.startsWith('--assets='))?.slice('--assets='.length);
  assert.ok(!assetMode || ['off', 'on'].includes(assetMode), 'Use --assets=off or --assets=on');
  if (assetMode) {
    const files = readdirSync('dist/assets');
    const assets = files.filter(file => file.endsWith('.js')).map(file => readFileSync('dist/assets/' + file, 'utf8')).join('\n');
    const demoChunk = files.some(file => /^DemoWorkspace-.*\.js$/.test(file));
    const sampleChunk = files.some(file => /^customerProfessionalFixtures-.*\.js$/.test(file));
    const sampleAssets = existsSync('dist/assets/demo');
    if (assetMode === 'off') {
      assert.doesNotMatch(assets, /Enter Demo Mode|Opening local demo|Simulate New Lead|Lakeview Electricals|DemoWorkspace|demo-professional-ac-rahul/, 'Release bundle excludes demo entry controls, workspace and sample profiles');
      assert.equal(demoChunk || sampleChunk || sampleAssets, false, 'Release assets exclude demo chunks and sample photos');
    } else {
      assert.match(assets, /demo-professional-ac-rahul/, 'Explicit test bundle includes customer sample profiles');
      assert.equal(demoChunk && sampleChunk && sampleAssets, true, 'Explicit test bundle includes demo chunks and sample photos');
    }
    console.log('PASS ' + assetMode + ' build asset boundary');
  }
  console.log('PASS explicit demo flag in Vite production/debug builds; demo files contain no network or storage operations');
})().catch(error => { console.error(error); process.exitCode = 1; });
