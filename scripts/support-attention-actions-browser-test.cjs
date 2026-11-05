/* Self-served browser check of Admin attention alert Acknowledge/Resolve actions (no network). */
const { build } = require('esbuild');
const { createServer } = require('node:http');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

const pause = ms => new Promise(done => setTimeout(done, ms));
const fixture = resolve('scripts/support-attention-actions-fixture.jsx');
let server, browser, socket;

(async () => {
  const folder = resolve('.tmp', `attention-actions-${Date.now()}`);
  mkdirSync(folder, { recursive: true });
  const bundle = await build({
    entryPoints: [fixture], bundle: true, write: false, outdir: resolve(folder, 'out'), jsx: 'automatic', format: 'iife',
    define: { 'import.meta.env.VITE_SUPABASE_URL': '""', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '""', 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': '""', 'import.meta.env.DEV': 'false' },
    plugins: [{ name: 'attention-fakes', setup(context) {
      context.onResolve({ filter: /services\/experience\.js$/ }, args => /SupportAttentionAlerts\.jsx$/.test(args.importer) ? { path: fixture } : undefined);
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
  await new Promise(done => server.listen(5214, '127.0.0.1', done));
  browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9374', `--user-data-dir=${resolve(folder, 'browser')}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let tab;
  for (let attempt = 0; attempt < 40 && !tab; attempt += 1) { try { tab = await (await fetch('http://127.0.0.1:9374/json/new?about:blank', { method: 'PUT' })).json(); } catch { await pause(250); } }
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
  const item = label => `[...document.querySelectorAll('.attention-item')].find(li=>li.textContent.includes(${JSON.stringify(label)}))`;
  const button = (label, text) => `[...(${item(label)}?.querySelectorAll('button')||[])].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const calls = action => evaluate(`window.__attention.calls.filter(c=>c.args.p_action===${JSON.stringify(action)}).length`);
  const setReason = value => evaluate(`(()=>{const area=document.querySelector('.attention-resolve textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(area,${JSON.stringify(value)});area.dispatchEvent(new Event('input',{bubbles:true}));})()`);

  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:5214/' });
  for (let attempt = 0; attempt < 40 && await evaluate(`document.querySelectorAll('.attention-item').length`) < 2; attempt += 1) await pause(150);
  assert.equal(await evaluate(`document.querySelectorAll('.attention-item').length`), 2, 'Two open alerts');

  // Acknowledge: a double tap sends one RPC, shows a loading label, then the server status after refresh.
  await evaluate(`(()=>{const b=${button('Possible no-show', 'Acknowledge')};b.click();b.click();})()`);
  await pause(80);
  assert.equal(await evaluate(`${button('Possible no-show', 'Acknowledging…')}?.disabled`), true, 'Acknowledge shows a disabled loading state');
  await evaluate(`${button('Possible no-show', 'Acknowledging…')}?.click()`);
  await pause(700);
  assert.equal(await calls('acknowledge'), 1, 'Double tap sends one acknowledge');
  assert.deepEqual(await evaluate(`window.__attention.calls[0]`), { name: 'act_on_support_attention', args: { p_task: 'task-noshow', p_action: 'acknowledge', p_reason: 'Acknowledged from Admin attention alerts' } });
  assert.match(await evaluate(`${item('Possible no-show')}.textContent`), /In review/, 'Status comes from the refreshed server row');
  assert.equal(await evaluate(`Boolean(${button('Possible no-show', 'Acknowledge')})`), false, 'Acknowledge hidden once in review');
  assert.match(await evaluate(`${item('Possible no-show')}.textContent`), /Acknowledged\./);

  // Resolve: needs a 3+ character reason; server errors are shown and nothing changes locally.
  await evaluate(`${button('Urgent ticket waiting', 'Resolve')}.click()`); await pause(100);
  const confirmDisabled = () => evaluate(`[...document.querySelectorAll('.attention-resolve button')].find(b=>/resolve/i.test(b.textContent)).disabled`);
  assert.equal(await confirmDisabled(), true, 'Empty reason cannot resolve');
  await setReason('ok'); await pause(50);
  assert.equal(await confirmDisabled(), true, 'Reason under 3 characters cannot resolve');
  await setReason('Called customer, professional reassigned'); await pause(50);
  await evaluate(`window.__attention.failNext='Support permission required'`);
  await evaluate(`document.querySelector('.attention-resolve').requestSubmit()`); await pause(700);
  assert.match(await evaluate(`${item('Urgent ticket waiting')}.textContent`), /Support permission required/, 'Server error shown');
  assert.equal(await evaluate(`document.querySelectorAll('.attention-item').length`), 2, 'Failed resolve keeps the alert');
  const before = await calls('resolve');
  await evaluate(`(()=>{const f=document.querySelector('.attention-resolve');f.requestSubmit();f.requestSubmit();})()`);
  await pause(80);
  assert.match(await evaluate(`document.querySelector('.attention-resolve')?.textContent||''`), /Resolving…/, 'Resolve shows a loading state');
  await pause(700);
  assert.equal(await calls('resolve') - before, 1, 'Double submit sends one resolve');
  assert.equal(await evaluate(`document.querySelectorAll('.attention-item').length`), 1, 'Resolved alert leaves the refreshed list');
  assert.match(await evaluate(`document.querySelector('.attention-alerts [role=status]')?.textContent||''`), /Urgent ticket waiting · EAZ-F9E8D7C6 resolved\./, 'Resolve success notice');
  writeFileSync(resolve(folder, 'attention-actions.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  // Opening the existing detail still works.
  await evaluate(`${item('Possible no-show')}.querySelector('.attention-alert').click()`);
  assert.deepEqual(await evaluate('window.__attention.opened'), ['a1b2c3d4-0000-4000-8000-000000000001'], 'Alert opens its detail');
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true, 'No overflow at 390px');
  assert.deepEqual(errors, [], 'No page errors');
  console.log(`PASS: acknowledge/resolve call act_on_support_attention once per tap, show loading and server errors, need a 3+ character resolve reason, refresh from the server, and keep alert detail opening. Screenshot: ${folder}`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { socket?.close(); browser?.kill(); server?.close(); });
