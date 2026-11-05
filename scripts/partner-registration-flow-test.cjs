/* Local-only pending-dashboard browser and route-policy regression. */
const { createServer } = require('node:http');
const { spawn } = require('node:child_process');
const { build } = require('esbuild');
const assert = require('node:assert/strict');
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let browser, socket, server;

(async () => {
  const { routeAccess } = await import('../src/auth/policy.js');
  const base = { user: { id: 'registration-flow-user' }, profile: { id: 'registration-flow-user', full_name: 'Pending Partner', account_status: 'active' }, applications: [], roles: [], assessments: {}, staff: null, isAdmin: false };
  for (const role of ['professional', 'influencer', 'consultant']) {
    for (const status of ['submitted', 'under_review']) {
      const account = { ...base, applications: [{ id: `${role}-${status}`, role, status }] };
      assert.equal(routeAccess(account, role), 'allowed', `${role} ${status} opens its own pending dashboard`);
      for (const otherRole of ['professional', 'influencer', 'consultant'].filter(item => item !== role)) {
        assert.equal(routeAccess(account, otherRole), 'registration', `${role} cannot open ${otherRole}`);
      }
    }
  }

  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import Dashboard from './src/features/partners/PartnerDashboard.jsx';
      const root=createRoot(document.getElementById('root'));
      window.renderPending=(role,status)=>root.render(<Dashboard role={role} profile={{name:'Pending Partner',city:'Bhopal',services:['Electrician'],category:'Lifestyle',specialisation:'Career'}} approved={false} application={{status}} data={{orders:[],posts:[],reviews:[]}} online={false} busy={false} trial={null} setRoute={value=>window.lastAction={route:value}} setSheet={value=>window.lastAction={sheet:value}} act={fn=>fn()} setAvailability={async()=>({online:false})} setOnline={()=>{}} total={()=>0} money={value=>'₹'+value} onEditRegistration={()=>window.lastAction={registration:true}}/>);
    ` },
    bundle: true, write: false, outdir: 'out', jsx: 'automatic', format: 'iife', loader: { '.css': 'css' }, define: { 'import.meta.env.DEV': 'false' },
  });
  const javascript = bundle.outputFiles.find(file => file.path.endsWith('.js')).contents;
  const stylesheet = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.contents || '';
  server = createServer((request, response) => {
    if (request.url === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(javascript); return; }
    if (request.url === '/fixture.css') { response.setHeader('Content-Type', 'text/css'); response.end(stylesheet); return; }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div class="partner-dashboard-home-view"><div id="root"></div></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(5202, '127.0.0.1', resolve));
  browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9342', `--user-data-dir=${require('node:path').resolve('.tmp', `registration-flow-${Date.now()}`)}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let tab;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { tab = await (await fetch('http://127.0.0.1:9342/json/new?http://127.0.0.1:5202/', { method: 'PUT' })).json(); break; } catch { await pause(250); }
  }
  assert.ok(tab, 'Edge started');
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  let id = 0;
  const pending = new Map(), errors = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) { const request = pending.get(message.id); pending.delete(message.id); message.error ? request.reject(message.error) : request.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:5202/' }); await pause(500);
  for (const [role, status] of [['professional', 'submitted'], ['influencer', 'under_review'], ['consultant', 'submitted']]) {
    await evaluate(`window.renderPending(${JSON.stringify(role)},${JSON.stringify(status)})`); await pause(120);
    assert.ok(await evaluate(`document.body.textContent.includes(${JSON.stringify(status === 'under_review' ? 'Under review' : 'Submitted for review')})`));
    assert.ok(await evaluate(`document.body.textContent.includes('Listings, new bookings, work acceptance, availability, and payouts remain locked')`));
    assert.equal(await evaluate(`document.querySelectorAll('.pd-metrics,.pd-earnings,.pd-first-service,.pd-actions,.pd-work-section').length`), 0, `${role} pending dashboard has no operational surface`);
    for (const width of [360, 390, 430]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true }); await pause(80);
      assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), `${role} pending dashboard fits ${width}px`);
      assert.deepEqual(await evaluate(`[...document.querySelectorAll('button')].filter(button=>{const box=button.getBoundingClientRect();return box.width>0&&(box.width<43.5||box.height<43.5)}).map(button=>button.textContent.trim())`), [], `${role} pending controls meet mobile touch sizing`);
    }
    await evaluate(`document.querySelector('.pd-notice button').click()`); await pause(20);
    assert.equal(await evaluate(`window.lastAction.registration===true`), true, `${role} can return to its own registration details`);
  }
  assert.deepEqual(errors, []);
  console.log('PASS: submitted and under-review applications open only their matching pending dashboard; pending dashboards expose no listing, booking, availability, or payout controls; and all three roles fit 360/390/430px.');
  await send('Browser.close');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { socket?.close(); browser?.kill(); server?.close(); });
