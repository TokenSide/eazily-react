/* Local-only dashboard regression through the isolated development Demo Mode. Start Vite on 127.0.0.1:5173 first. */
const { mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const pause = ms => new Promise(done => setTimeout(done, ms));
let browser, socket;

(async () => {
  assert.equal((await fetch('http://127.0.0.1:5173/')).status, 200, 'Start the local Vite server first');
  const profile = resolve('.tmp', `realtime-browser-${Date.now()}`);
  mkdirSync(profile, { recursive: true });
  browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9348', `--user-data-dir=${profile}`, 'about:blank'
  ], { windowsHide: true, stdio: 'ignore' });
  let tab;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { tab = await (await fetch('http://127.0.0.1:9348/json/new?http://127.0.0.1:5173/', { method: 'PUT' })).json(); break; }
    catch { await pause(250); }
  }
  if (!tab) throw new Error('Edge did not start');
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(done => socket.addEventListener('open', done, { once: true }));
  let id = 0;
  const pending = new Map(), errors = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) { const request = pending.get(message.id); pending.delete(message.id); message.error ? request.reject(message.error) : request.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise((resolveRequest, reject) => { pending.set(++id, { resolve: resolveRequest, reject }); socket.send(JSON.stringify({ id, method, params })); });
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
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/' }); await pause(1200);
  await evaluate(`localStorage.setItem('eazily-language','English');location.reload()`);
  await waitFor(`[...document.querySelectorAll('button')].some(button=>button.textContent.includes('Join as a Partner'))`, 'welcome screen');
  await evaluate(`([...document.querySelectorAll('button')].find(button=>button.textContent.includes('Join as a Partner'))).click()`); await pause(200);
  await waitFor(`[...document.querySelectorAll('.welcome-choice b')].some(label=>label.textContent.trim()==='Service Professional')`, 'partner choices');
  await evaluate(`([...document.querySelectorAll('.welcome-choice b')].find(label=>label.textContent.trim()==='Service Professional')).closest('button').click()`); await pause(800);
  await waitFor(`document.querySelector('#auth-phone')`, 'Service Partner authentication screen');
  assert.ok(await evaluate(`document.querySelector('h1').textContent.includes('Sign in / Register with phone')`), 'Service Partner join keeps the real phone action explicit');
  assert.ok(await evaluate(`document.body.textContent.includes('Local development login')&&document.body.textContent.includes('0000')`), 'Temporary local OTP is clearly labelled');
  assert.ok(await evaluate(`[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Preview Service Partner Dashboard')`), 'Local Service Partner preview is offered');
  const sessionBeforePhone = await evaluate(`JSON.stringify({...sessionStorage})`);
  for (const width of [360, 390, 430]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true }); await pause(80);
    assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), `Service join has no overflow at ${width}px`);
    assert.ok(await evaluate(`document.querySelector('.auth-demo-preview .btn').getBoundingClientRect().height>=44`), `Preview action remains touchable at ${width}px`);
  }
  await evaluate(`(() => { const input=document.querySelector('#auth-phone'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'9999999999'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`); await pause(100);
  assert.ok(await evaluate(`![...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Send OTP').disabled`), 'Local OTP request is available');
  await evaluate(`([...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Send OTP')).click()`);
  await waitFor(`document.querySelectorAll('.otp-digits input').length===4`, 'four-digit local OTP input');
  assert.equal(await evaluate(`document.querySelectorAll('.partner-workspace').length`), 0, 'Entering a phone number does not open a partner dashboard');
  assert.equal(await evaluate(`JSON.stringify({...sessionStorage})`), sessionBeforePhone, 'Requesting a local OTP creates no session');
  await evaluate(`([...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Preview Service Partner Dashboard')).click()`);
  await waitFor(`document.querySelector('.demo-workspace')`, 'isolated Service Partner demo');
  assert.ok(await evaluate(`document.body.textContent.includes('sample data, no real bookings or payments')`), 'Dashboard regression runs only in the isolated development demo');
  assert.ok(await evaluate(`Boolean(document.querySelector('.partner-workspace.role-professional'))`), 'Preview opens the existing Service Partner demo directly');
  assert.equal(await evaluate(`JSON.stringify({...sessionStorage})`), sessionBeforePhone, 'Demo preview creates no authenticated session');

  for (const role of ['professional','influencer','consultant']) {
    await evaluate(`(() => { const select=document.querySelector('.demo-controls select'); select.value=${JSON.stringify(role)}; select.dispatchEvent(new Event('change',{bubbles:true})); })()`); await pause(200);
    assert.ok(await evaluate(`Boolean(document.querySelector('.partner-workspace.role-${role}'))`), `${role} dashboard opens`);
    assert.equal(await evaluate(`document.querySelectorAll('.bottom-nav button').length`), 5, `${role} navigation remains intact`);
    assert.equal(await evaluate(`document.querySelectorAll('.realtime-status').length`), 0, 'Unconfigured local backend does not pretend to be live');
    for (const width of [360, 390, 430]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true }); await pause(80);
      assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), `${role} has no overflow at ${width}px`);
      assert.equal(await evaluate(`Math.round(document.querySelector('.phone-shell').getBoundingClientRect().width)`), width);
    }
  }

  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }); await pause(100);
  assert.equal(await evaluate(`Math.round(document.querySelector('.phone-shell').getBoundingClientRect().width)`), 430, 'Desktop stays a centered phone-width app');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`), true, 'Reduced-motion preference is available to the UI');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await evaluate(`([...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Exit Demo Mode')).click()`);
  await waitFor(`[...document.querySelectorAll('.welcome-choice b')].some(label=>label.textContent.trim()==='Service Professional')`, 'partner choices after demo exit');
  await evaluate(`([...document.querySelectorAll('.welcome-choice b')].find(label=>label.textContent.trim()==='Service Professional')).closest('button').click()`);
  await waitFor(`document.querySelector('#auth-phone')`, 'Service Partner local authentication screen');
  await evaluate(`(() => { const input=document.querySelector('#auth-phone'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'9999999999'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
  await evaluate(`([...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Send OTP')).click()`);
  await waitFor(`document.querySelectorAll('.otp-digits input').length===4`, 'four-digit local OTP input');
  await evaluate(`(() => { const input=document.querySelector('.otp-digits input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'0000'); input.dispatchEvent(new Event('input',{bubbles:true})); })()`); await pause(100);
  await evaluate(`([...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Verify & Continue')).click()`);
  await waitFor(`document.querySelector('.registration-progress')`, 'existing Service Partner registration gate');
  assert.equal(await evaluate(`document.querySelectorAll('.partner-workspace').length`), 0, 'Local OTP does not grant an approved dashboard');
  assert.ok(await evaluate(`Boolean(sessionStorage.getItem('eazilyDevOtpSession'))`), 'Local login persists only in the browser session');
  await evaluate(`location.reload()`);
  await waitFor(`document.querySelector('.registration-progress')`, 'local session registration restore');
  assert.equal(await evaluate(`document.querySelectorAll('.partner-workspace').length`), 0, 'Refresh still enforces registration');
  assert.deepEqual(errors, [], 'No uncaught dashboard runtime errors');
  console.log('PASS: local OTP 0000 signs into an unapproved development account, phone entry alone creates no session, registration remains required, the isolated preview remains separate, and dashboards render at 360/390/430 px without runtime errors.');
  await send('Browser.close');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { socket?.close(); browser?.kill(); });
