/* Self-served mobile browser check of Step 1 "Verify your mobile" for an email/Google account.
   No Supabase, SMS or network: the fixture replaces only the auth client and registration RPCs. */
const { build } = require('esbuild');
const { createServer } = require('node:http');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

const pause = ms => new Promise(done => setTimeout(done, ms));
const fixture = resolve('scripts/service-partner-verify-mobile-fixture.jsx');
let server, browser, socket;

(async () => {
  const folder = resolve('.tmp', `verify-mobile-${Date.now()}`);
  mkdirSync(folder, { recursive: true });
  const bundle = await build({
    entryPoints: [fixture], bundle: true, write: false, outdir: resolve(folder, 'out'), jsx: 'automatic', format: 'iife',
    loader: { '.png': 'empty', '.webp': 'empty', '.svg': 'empty', '.jpg': 'empty' },
    define: {
      'import.meta.env.VITE_SUPABASE_URL': '"https://fixture.invalid"',
      // Public anon-shaped key so the screen behaves as "backend configured"; nothing is contacted.
      'import.meta.env.VITE_SUPABASE_ANON_KEY': '"eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.fixture"',
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': '""',
      'import.meta.env.VITE_PARTNER_DEMO': '"false"',
      'import.meta.env.DEV': 'false',
      'import.meta.env.VITE_ENABLE_SERVICE_REGISTRATION_TEST_SKIP': '"false"',
      'import.meta.env.VITE_ENABLE_LOCAL_OTP': '"false"',
    },
    plugins: [{ name: 'verify-mobile-fakes', setup(context) {
      context.onResolve({ filter: /(^|\/)runtime\.js$/ }, args => /[\\/]src[\\/]auth[\\/]/.test(args.importer) ? { path: fixture } : undefined);
      context.onResolve({ filter: /services\/partners\.js$/ }, args => /ServicePartnerOnboarding\.jsx$/.test(args.importer) ? { path: fixture } : undefined);
    } }],
  });
  server = createServer((request, response) => {
    if (request.url.startsWith('/fixture.')) {
      const css = request.url.endsWith('.css');
      const file = bundle.outputFiles.find(output => output.path.endsWith(css ? '.css' : '.js'));
      response.setHeader('Content-Type', css ? 'text/css' : 'text/javascript');
      return response.end(file ? file.contents : '');
    }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(done => server.listen(5213, '127.0.0.1', done));
  browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9373', `--user-data-dir=${resolve(folder, 'browser')}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let tab;
  for (let attempt = 0; attempt < 40 && !tab; attempt += 1) {
    try { tab = await (await fetch('http://127.0.0.1:9373/json/new?about:blank', { method: 'PUT' })).json(); } catch { await pause(250); }
  }
  assert.ok(tab, 'Edge started');
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(done => socket.addEventListener('open', done, { once: true }));
  let id = 0; const pending = new Map(), errors = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) { const request = pending.get(message.id); pending.delete(message.id); message.error ? request.reject(message.error) : request.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise((done, reject) => { pending.set(++id, { resolve: done, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
  const click = async label => { await evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(item=>item.textContent.trim()===${JSON.stringify(label)});if(!button)throw new Error('Missing button: '+${JSON.stringify(label)});if(button.disabled)throw new Error('Disabled button: '+${JSON.stringify(label)});button.click();})()`); await pause(250); };
  const setInput = async (selector, value) => { await evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(selector)});if(!input)throw new Error('Missing input '+${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`); await pause(120); };
  const setField = async (label, value) => setInput(`[data-fixture-label="${label}"]`, value);
  const title = () => evaluate(`document.querySelector('.partner-simple-header h1')?.textContent.trim()`);
  const card = () => evaluate(`(()=>{const c=document.querySelector('.verify-mobile');return c?{text:c.textContent,alerts:[...c.querySelectorAll('[role=alert]')].map(a=>a.textContent),digits:c.querySelectorAll('.otp-digits input').length}:null})()`);
  const shot = async name => writeFileSync(resolve(folder, name), Buffer.from((await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })).data, 'base64'));
  const tagLabels = () => evaluate(`document.querySelectorAll('.field-wrap').forEach(wrap=>{const label=wrap.querySelector('.form-label')?.textContent.trim();const input=wrap.querySelector('input');if(label&&input)input.dataset.fixtureLabel=label;})`);

  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:5213/' });
  for (let attempt = 0; attempt < 50 && !await evaluate(`Boolean(document.querySelector('.partner-simple-header h1'))`); attempt += 1) await pause(200);
  assert.match(await title(), /Your Details/, 'Step 1 opens');

  let state = await card();
  assert.ok(state && /Verify your mobile/.test(state.text), 'Email/Google account sees the Verify mobile card');
  assert.equal(await evaluate(`[...document.querySelectorAll('.form-label')].some(l=>l.textContent.trim()==='Verified mobile number')`), false, 'No verified phone is shown before confirmation');
  await shot('verify-card.png');

  await tagLabels();
  await setField('Date of birth', '1990-05-01');
  await click('Continue');
  assert.match(await title(), /Your Details/, 'Step 1 cannot continue without a confirmed phone');
  assert.ok(await evaluate(`document.body.textContent.includes('A verified mobile number is required')`), 'Missing verified phone is reported');

  await setField('Mobile number', '98765 43210');
  await click('Send OTP');
  await pause(300);
  state = await card();
  assert.ok(state.text.includes('Code sent to +91 ••••••3210'), 'Masked destination shown');
  assert.equal(state.digits, 6, 'Six-digit code entry');
  assert.match(state.text, /Resend code in \d+s/, 'Resend wait is visible');
  assert.deepEqual(await evaluate('window.__verify.updates'), [{ phone: '+919876543210' }], 'Phone change requested once through Supabase');
  await shot('verify-code.png');

  await setInput('.verify-mobile .otp-digits input', '111111');
  await click('Verify mobile');
  await pause(300);
  state = await card();
  assert.ok(state && state.alerts.some(text => /incorrect or expired/.test(text)), 'Wrong/expired code shows an error and keeps the card');
  await click('Continue');
  assert.match(await title(), /Your Details/, 'Wrong code cannot pass Step 1');

  await evaluate('window.__verify.confirms=false');
  await setInput('.verify-mobile .otp-digits input', '123456');
  await click('Verify mobile');
  await pause(400);
  state = await card();
  assert.ok(state && state.alerts.some(text => /could not be confirmed/.test(text)), 'A phone value without phone_confirmed_at is not treated as verified');
  await click('Continue');
  assert.match(await title(), /Your Details/, 'Unconfirmed phone cannot pass Step 1');

  await evaluate('window.__verify.confirms=true');
  await setInput('.verify-mobile .otp-digits input', '123456');
  await click('Verify mobile');
  for (let attempt = 0; attempt < 20 && await card(); attempt += 1) await pause(150);
  assert.equal(await card(), null, 'Card closes after Supabase confirmation');
  assert.equal(await evaluate(`[...document.querySelectorAll('.field-wrap')].find(w=>w.querySelector('.form-label')?.textContent.trim()==='Verified mobile number')?.querySelector('input')?.value`), '+919876543210', 'Verified number comes from the confirmed account');
  await shot('verified.png');
  await click('Continue');
  await pause(300);
  assert.match(await title(), /Shop Details/, 'Confirmed phone lets Step 1 continue');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true, 'No horizontal overflow at 390px');
  assert.deepEqual(errors, [], 'No page errors');
  console.log(`PASS: email/Google account sees Verify mobile; wrong code, and an OTP result without phone_confirmed_at, cannot pass Step 1; resend wait and masked number shown; only a confirmed phone (same account) fills the verified field and continues. Screenshots: ${folder}`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { socket?.close(); browser?.kill(); server?.close(); });
