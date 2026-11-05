/* Run after npm run build. Uses the installed Edge browser, no external test service. */
const { createServer } = require('node:http');
const { readFileSync, existsSync, mkdirSync } = require('node:fs');
const { resolve, extname } = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const { build } = require('esbuild');
const edgePath = '/tmp/chrome-shim';
const pause = ms => new Promise(r => setTimeout(r, ms));
const root = resolve(process.env.EAZILY_SMOKE_DIST || 'dist');
const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/fixture') { res.setHeader('Content-Type', 'text/html'); res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>'); return; }
  if (pathname === '/fixture.js' || pathname === '/fixture.css') { res.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(readFileSync(resolve('.tmp', pathname.slice(1)))); return; }
  let file = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  if (!file.startsWith(root + require('node:path').sep) || !existsSync(file) || !extname(file)) file = resolve(root, 'index.html');
  res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[extname(file)] || 'application/octet-stream');
  res.end(readFileSync(file));
});
let browser, socket;
(async () => {
  await build({ entryPoints: ['scripts/error-boundary-fixture.jsx'], bundle: true, outfile: '.tmp/fixture.js', jsx: 'automatic', format: 'esm', define: { 'import.meta.env.VITE_SUPABASE_URL': '""', 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': '""', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '""' } });
  await new Promise(r => server.listen(5203, '127.0.0.1', r));
  const browserProfile = `.tmp/browser-error-boundary-${Date.now()}`;
  mkdirSync(browserProfile, { recursive: true });
  browser = spawn(edgePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9341', `--user-data-dir=${resolve(browserProfile)}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let tab;
  for (let n = 0; n < 40; n++) {
    try { tab = await (await fetch('http://127.0.0.1:9341/json/new?http://127.0.0.1:5203/fixture', { method: 'PUT' })).json(); break; } catch { await pause(250); }
  }
  if (!tab) throw new Error('Edge did not start');
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(r => socket.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const event = JSON.parse(data);
    if (event.id) { const p = pending.get(event.id); pending.delete(event.id); event.error ? p.reject(event.error) : p.resolve(event.result); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression, label) => {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (await evaluate(`Boolean(${expression})`)) return;
      await pause(100);
    }
    throw new Error(`Timed out waiting for ${label}`);
  };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });

  await waitFor(`document.querySelector('.error-fallback')`, 'error fallback replacing the crashed subtree');
  assert.equal(await evaluate(`document.querySelector('.error-fallback').getAttribute('role')`), 'alert', 'Fallback announces itself as an alert');
  assert.equal(await evaluate(`document.querySelectorAll('.error-fallback').length`), 1, 'One fallback replaces the crashed subtree');
  assert.equal(await evaluate(`document.getElementById('fixture-ok')`), null, 'Crashed children are unmounted');
  assert.equal(await evaluate(`document.querySelector('.error-fallback h1').textContent.trim()`), 'Something went wrong');
  assert.ok(await evaluate(`document.querySelector('.error-fallback p').textContent.includes('this screen')`), 'Fallback names the failed area');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.error-actions button')].map(b=>b.textContent.trim())`), ['Try again', 'Reload app'], 'Fallback offers retry and reload');
  assert.equal(await evaluate(`document.getElementById('fixture-reports').textContent`), '1', 'onError reports the failure once');
  assert.ok(await evaluate(`document.querySelector('.error-detail code').textContent.includes('Fixture render failure')`), 'Technical details carry the error for support');
  assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), 'Fallback has no mobile horizontal overflow');

  await evaluate(`document.getElementById('fixture-fix').click()`); await pause(250);
  assert.equal(await evaluate(`document.querySelectorAll('.error-fallback').length`), 1, 'Clearing the fault alone does not silently retry');
  await evaluate(`[...document.querySelectorAll('.error-actions button')].find(b=>b.textContent.trim()==='Try again').click()`); await pause(300);
  assert.equal(await evaluate(`document.querySelectorAll('.error-fallback').length`), 0, 'Retry clears the fallback once the fault is gone');
  assert.equal(await evaluate(`document.getElementById('fixture-ok').textContent`), 'recovered', 'Children render again after a successful retry');

  await evaluate(`document.getElementById('fixture-break').click()`); await pause(250);
  await waitFor(`document.querySelector('.error-fallback')`, 'second crash after a recovered render');
  assert.equal(await evaluate(`document.getElementById('fixture-reports').textContent`), '2', 'A recovered boundary still catches the next failure');
  assert.equal(await evaluate(`document.getElementById('fixture-break') !== null`), true, 'Controls outside the boundary stay interactive');

  await send('Page.navigate', { url: 'http://127.0.0.1:5203/' }); await pause(1600);
  assert.equal(await evaluate(`document.querySelectorAll('.error-fallback').length`), 0, 'Production build renders normally without tripping the boundary');
  assert.ok(await evaluate(`Boolean(document.querySelector('.phone-shell'))`), 'Production shell still mounts');

  console.log('PASS: crashed subtree replaced by an alert fallback, failure reported once, retry clears only after the fault is fixed, children render again, a recovered boundary catches the next crash, controls outside the boundary stay interactive, and the production build mounts without tripping it.');
  await send('Browser.close');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { socket?.close(); browser?.kill(); server.close(); });