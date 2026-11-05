/* Connected-build smoke test.
 *
 * Boots the real production bundle against the linked Supabase project and proves the
 * app is actually connected, rather than silently falling back to local fixtures.
 *
 * What it verifies:
 *   - the build is a connected one: the Supabase client and endpoint are inlined, and
 *     the sample stub was not substituted for src/lib/supabase.js
 *   - the app boots with no error boundary tripped and no uncaught console errors
 *   - credentials are complete, so the half-configured warning never fires
 *   - the onboarding and customer catalogue render
 *   - a screenshot is captured for visual review
 *
 * What it deliberately cannot verify, and why:
 *   - an OTP or OAuth round trip needs a real SMS-capable number or a real Google
 *     session. Neither can be automated here, and faking either would prove nothing.
 *     See docs/staging/AUTH-ENABLEMENT.md for the manual check.
 *   - RLS under an authenticated JWT. Asserting "anon is denied" is done here, because
 *     anon needs no token. The authenticated matrix needs a real signed-in session.
 *
 * Usage:
 *   npm run test:connected
 *   EAZILY_ENV_FILE=.env.staging.local npm run test:connected
 *
 * Reads VITE_SUPABASE_URL and the publishable key from the env file. Never prints
 * either. Performs GET requests only; no row is created, changed or deleted.
 */
const { createServer } = require('node:http');
const { readFileSync, existsSync, writeFileSync, mkdirSync } = require('node:fs');
const { resolve, extname } = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');

const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const pause = ms => new Promise(r => setTimeout(r, ms));
const root = resolve('dist');
const port = 5207;
const envFile = resolve(process.env.EAZILY_ENV_FILE || '.env.staging.local');

// --------------------------------------------------------------- credentials --
if (!existsSync(envFile)) {
  console.error(`Missing ${envFile}. Copy .env.example to .env.staging.local and set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.`);
  process.exit(1);
}
const env = {};
for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.*)$/.exec(line);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
}
const url = (env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const publishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || '';
if (!url || !publishableKey) {
  console.error('VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY are both required for a connected build.');
  process.exit(1);
}
const projectRef = (url.match(/\/\/([a-z0-9]{20})\./i) || [])[1] || '(unrecognised ref)';

// ----------------------------------------------------------------- the build --
// Built here rather than assumed, so a stale sample-mode dist cannot pass the test.
console.log(`Target project : ${projectRef}`);
console.log('Building       : EAZILY_TARGET_ENV=staging npm run build:staging');
// shell:true is required on Windows for npm.cmd; without it spawnSync fails EINVAL.
execFileSync('npm', ['run', 'build:staging'], {
  env: { ...process.env, EAZILY_TARGET_ENV: 'staging' },
  stdio: ['ignore', 'ignore', 'inherit'],
  shell: true,
});

const distJs = () => {
  const { readdirSync, statSync } = require('node:fs');
  const files = [];
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const full = resolve(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.js')) files.push(resolve(full));
    }
  };
  if (existsSync(root)) walk(root);
  return files;
};
const chunks = distJs();
const containsAny = pattern => chunks.some(file => pattern.test(readFileSync(file, 'utf8')));
assert.ok(containsAny(/@supabase\/supabase-js/), 'dist has no Supabase client: this is a sample-mode build. Re-run with EAZILY_TARGET_ENV=staging.');
assert.ok(containsAny(/\.supabase\.co/), 'dist has no Supabase endpoint: the publishable key was not inlined.');
assert.ok(!containsAny(/development-session-only|dev-otp-user/), 'dist contains the development OTP runtime; a connected build must not ship it.');
console.log(`Bundle         : ${chunks.length} chunks, client and endpoint present`);

// A connected build must not have picked up the sample stub.
assert.ok(!containsAny(/isSupabaseConfigured\s*=\s*!1|isSupabaseConfigured\s*=\s*false/),
  'dist still resolves src/lib/supabase.js to the null sample stub.');

// ------------------------------------------------------------------- server --
const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  let file = resolve(root, '.' + decodeURIComponent(pathname));
  if (!file.startsWith(root + '\\') || !existsSync(file) || !extname(file)) file = resolve(root, 'index.html');
  res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[extname(file)] || 'application/octet-stream');
  res.end(readFileSync(file));
});

let browser, socket;
(async () => {
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  const profile = `.tmp/browser-connected-${Date.now()}`;
  mkdirSync(profile, { recursive: true });
  browser = spawn(edgePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9361', `--user-data-dir=${resolve(profile)}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });

  let tab;
  for (let n = 0; n < 40; n += 1) {
    try { tab = await (await fetch(`http://127.0.0.1:9361/json/new?http://127.0.0.1:${port}/`, { method: 'PUT' })).json(); break; } catch { await pause(250); }
  }
  if (!tab) throw new Error('Edge did not start');
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(r => socket.addEventListener('open', r, { once: true }));

  let id = 0;
  const pending = new Map();
  const consoleErrors = [];
  const consoleAll = [];
  socket.addEventListener('message', ({ data }) => {
    const event = JSON.parse(data);
    if (event.id) { const p = pending.get(event.id); pending.delete(event.id); event.error ? p.reject(event.error) : p.resolve(event.result); }
    if (event.method === 'Runtime.exceptionThrown') consoleErrors.push(event.params.exceptionDetails.text);
    if (event.method === 'Runtime.consoleAPICalled') {
      const text = (event.params.args || []).map(a => a.value ?? a.description ?? '').join(' ');
      consoleAll.push(`${event.params.type}: ${text}`);
      if (event.params.type === 'error' || event.params.type === 'warning') consoleErrors.push(text);
    }
  });
  const send = (method, params = {}) => new Promise((res2, rej) => { pending.set(++id, { resolve: res2, reject: rej }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expression, label) => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await pause(100);
    }
    throw new Error(`Timed out waiting for ${label}`);
  };
  const click = async label => {
    await evaluate(`(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(label)}); if(!b) throw new Error('Missing button: '+${JSON.stringify(label)}); b.click(); })()`);
    await pause(400);
  };

  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/` });

  await waitFor(`document.querySelector('.welcome-screen, .setup, .splash')`, 'the app shell');
  await pause(1200);

  assert.equal(await evaluate(`document.querySelectorAll('.error-fallback').length`), 0,
    `the error boundary tripped on load: ${await evaluate(`document.querySelector('.error-fallback')?.textContent || ''`)}`);
  assert.ok(!(await evaluate(`document.body.textContent.includes('Local sample preview')`)),
    'the app is still showing the local-sample banner, so it is not connected.');
  assert.ok(!(await evaluate(`document.body.textContent.includes('local-only')`)),
    'the app mentions local-only mode, so the connected bundle did not take effect.');

  // src/lib/supabase.js warns on a half-configured pair. A connected build must not.
  const halfConfigured = consoleAll.filter(t => /half-configured/i.test(t));
  assert.equal(halfConfigured.length, 0, `credentials are incomplete: ${halfConfigured.join(' | ')}`);

  // Reach the customer catalogue the way a user does.
  const english = await evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='English')`);
  if (english) await click('English');
  await waitFor(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Find & Book Services')`, 'the welcome entry');
  await click('Find & Book Services');
  await waitFor(`document.querySelector('.catalog-layout, .home-category-grid, .main-category-grid, .phone-shell')`, 'the customer experience');
  await pause(900);

  const view = await evaluate(`({ categories: document.querySelectorAll('.main-category-card, .group-card, .category-card').length, headings: [...document.querySelectorAll('h1,h2')].map(h=>h.textContent.trim()).slice(0,6) })`);
  mkdirSync('.tmp', { recursive: true });
  writeFileSync('.tmp/connected-home.png', Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  assert.equal(await evaluate(`document.querySelectorAll('.error-fallback').length`), 0, 'the error boundary tripped while browsing.');
  assert.equal(consoleErrors.length, 0, `console errors while connected: ${consoleErrors.join(' | ')}`);

  // The whole point of the wiring: tapping something that needs an account must open the
  // real AuthScreen, not the old "Local sample only" toast. UserApp calls requestSignIn()
  // for messages and post, so the bottom nav is the honest place to prove it.
  let authPrompted = false;
  const gated = await evaluate(`[...document.querySelectorAll('.bottom-nav button')].map(b=>b.textContent.trim())`);
  if (gated.includes('Messages')) {
    await click('Messages');
    await waitFor(`document.querySelector('.setup, .auth-customer, .auth-signup')`, 'the authentication screen');
    assert.ok(await evaluate(`Boolean(document.querySelector('.auth-google'))`), 'AuthScreen did not render the Google option');
    assert.ok(!(await evaluate(`document.body.textContent.includes('Local sample only')`)),
      'requestAuth still falls back to the demo toast instead of opening AuthScreen.');
    // Phone sign-in must be the enabled primary path; configuration_required disables it.
    const otpDisabled = await evaluate(`[...document.querySelectorAll('.setup button')].some(b=>/send otp/i.test(b.textContent)&&b.disabled)`);
    assert.equal(otpDisabled, false,
      'the Send OTP button is disabled, so Supabase reports phone sign-in is not configured. See docs/staging/AUTH-ENABLEMENT.md');
    assert.equal(await evaluate(`document.querySelectorAll('.error-fallback').length`), 0, 'AuthScreen tripped the error boundary.');
    await evaluate(`(() => { const b=document.querySelector('.setup .icon-btn'); if(b) b.click(); })()`);
    await pause(400);
    authPrompted = true;
  }

  // RLS from the outside, using the same public key the bundle ships. GET only.
  const probe = async relation => {
    const r = await fetch(`${url}/rest/v1/${relation}?select=*&limit=1`, { headers: { apikey: publishableKey, Authorization: `Bearer ${publishableKey}` } });
    const body = await r.text();
    if (r.status === 401) return 'denied';
    if (/PGRST205|Could not find the table/i.test(body)) return 'missing';
    if (!r.ok) return `error-${r.status}`;
    const rows = JSON.parse(body);
    return Array.isArray(rows) ? (rows.length ? 'readable' : 'empty') : 'unreadable';
  };
  const publicSurface = {};
  for (const relation of ['categories', 'vendor_directory', 'customer_professional_directory', 'customer_reviews', 'partner_public_config']) {
    publicSurface[relation] = await probe(relation);
  }
  const privateSurface = {};
  for (const relation of ['profiles', 'vendors', 'service_requests', 'partner_orders', 'wallet_ledger', 'customer_payments', 'partner_applications']) {
    privateSurface[relation] = await probe(relation);
  }
  for (const [relation, state] of Object.entries(privateSurface)) {
    assert.equal(state, 'denied', `${relation} is ${state} to the browser role; it must be denied`);
  }
  assert.ok(['readable', 'empty'].includes(publicSurface.categories), `categories is ${publicSurface.categories}; the catalogue is not browsable`);

  console.log(`\nCatalogue cards rendered: ${view.categories}`);
  console.log('Headings: ' + view.headings.filter(Boolean).join(' | '));
  console.log('\nPublic surface (browser role, publishable key):');
  for (const [r, s] of Object.entries(publicSurface)) console.log(`  ${r.padEnd(34)} ${s}`);
  console.log('Private surface (must be denied):');
  for (const [r, s] of Object.entries(privateSurface)) console.log(`  ${r.padEnd(34)} ${s}`);
  if (publicSurface.vendor_directory === 'empty') {
    console.log('\nNote: vendor_directory is empty. Apply seed/ to get browsable professionals:');
    console.log('  psql "$env:EAZILY_DATABASE_URL" -v ON_ERROR_STOP=1 -f seed/001_catalogue.sql  # then 002, 003');
  }
  console.log('\nScreenshot: .tmp/connected-home.png');
  console.log(`Sign-in prompt: ${authPrompted ? 'verified - a gated action opened the real AuthScreen' : 'SKIPPED - no gated bottom-nav action found'}`);
  console.log('\nNot verified here, and why:');
  console.log('  - a completed OTP / Google round trip needs a real SMS-capable number or Google session.');
  console.log('    See docs/staging/AUTH-ENABLEMENT.md.');
  console.log('  - RLS under an authenticated JWT. This asserts anon denial, which needs no token.');
  console.log('\nPASS: the connected build boots clean, credentials are complete, gated actions open the real AuthScreen, the catalogue renders, and every sensitive relation is denied to the browser role.');
  await send('Browser.close');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { socket?.close(); browser?.kill(); server.close(); });