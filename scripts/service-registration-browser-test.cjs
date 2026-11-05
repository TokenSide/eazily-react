/* Local-only mobile browser check. Start Vite on 127.0.0.1:5173 first. */
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms));
let browser, socket;

(async () => {
  assert.equal((await fetch('http://127.0.0.1:5173/')).status, 200, 'Start the local Vite server first');
  const folder = resolve('.tmp', `service-registration-review-${Date.now()}`);
  mkdirSync(folder, { recursive: true });
  const profile = resolve(folder, 'browser');
  browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9341', `--user-data-dir=${profile}`, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });
  let tab;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { tab = await (await fetch('http://127.0.0.1:9341/json/new?http://127.0.0.1:5173/', { method: 'PUT' })).json(); break; }
    catch { await pause(250); }
  }
  if (!tab) throw new Error('Edge did not start');
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(resolveOpen => socket.addEventListener('open', resolveOpen, { once: true }));
  let id = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const request = pending.get(message.id); pending.delete(message.id);
      message.error ? request.reject(message.error) : request.resolve(message.result);
    }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise((resolveSend, reject) => { pending.set(++id, { resolve: resolveSend, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const click = async label => {
    await evaluate(`(()=>{const button=[...document.querySelectorAll('button,.welcome-choice b')].find(item=>item.textContent.trim()===${JSON.stringify(label)});if(!button)throw new Error('Missing control: '+${JSON.stringify(label)});button.click();})()`);
    await pause(260);
  };
  const setField = async (label, value) => {
    await evaluate(`(()=>{const wrap=[...document.querySelectorAll('.field-wrap')].find(item=>item.querySelector('.form-label')?.textContent.trim()===${JSON.stringify(label)});if(!wrap)throw new Error('Missing field: '+${JSON.stringify(label)});const input=wrap.querySelector('input,select,textarea');const proto=input.tagName==='SELECT'?HTMLSelectElement.prototype:input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(input,${JSON.stringify(value)});input.dispatchEvent(new Event('change',{bubbles:true}));input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await pause(80);
  };
  const title = () => evaluate(`document.querySelector('.partner-simple-header h1').textContent.trim()`);
  const screen = async name => writeFileSync(resolve(folder, name), Buffer.from((await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true })).data, 'base64'));

  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/' });
  await pause(1500);
  for (let attempt = 0; attempt < 40 && !await evaluate(`document.body.textContent.includes('English')||document.body.textContent.includes('Join as a Partner')`); attempt += 1) await pause(200);
  if (await evaluate(`document.body.textContent.includes('English')`)) await click('English');
  await click('Join as a Partner'); await click('Service Professional');
  for (let attempt = 0; attempt < 40 && !await evaluate(`Boolean(document.querySelector('.auth-input input'))`); attempt += 1) await pause(200);
  await evaluate(`(()=>{const input=document.querySelector('.auth-input input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'9999999999');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('Send OTP');
  await evaluate(`(()=>{const input=document.querySelector('.otp-digits input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'0000');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('Verify & Continue');
  for (let attempt = 0; attempt < 40 && !await evaluate(`Boolean(document.querySelector('.partner-simple-header h1'))`); attempt += 1) await pause(200);
  assert.match(await title(), /Your Details/);
  assert.equal(await evaluate(`document.querySelectorAll('.registration-progress i').length`), 6, 'Exactly six steps');
  assert.equal(await evaluate(`document.querySelectorAll('.media-upload').length`), 0, 'Step 1 has no uploads');
  assert.equal(await evaluate(`document.querySelectorAll('.service-registration-test-skip button').length`), 1, 'Step 1 has one testing-only skip');
  await click('Skip for now');
  assert.match(await title(), /Shop Details/, 'Skip advances without pretending Step 1 is complete');
  assert.equal(await evaluate(`document.querySelectorAll('.service-registration-test-skip button').length`), 1, 'Step 2 has one testing-only skip');
  await click('Back');
  assert.match(await title(), /Your Details/);
  await evaluate(`Object.defineProperty(navigator,'geolocation',{configurable:true,value:{getCurrentPosition:(success,failure)=>failure(new Error('denied'))}})`);
  await click('Use my current location');
  assert.ok(await evaluate(`document.body.textContent.includes('Status: denied')`), 'Denied location remains a manual-address flow');
  await setField('Full name', 'Fictional Test Shopkeeper');
  await setField('Date of birth', '1990-01-02');
  await setField('Email address — Optional', 'shop@example.invalid');
  await click('Continue');
  assert.match(await title(), /Shop Details/, 'Step 1 Continue opens Step 2');
  await evaluate(`document.dispatchEvent(new Event('visibilitychange'))`);
  await pause(400);
  assert.match(await title(), /Shop Details/, 'An account refresh keeps the completed Step 1 position');
  await click('Back');
  assert.equal(await evaluate(`document.querySelector('.field-wrap input').value`), 'Fictional Test Shopkeeper', 'Back retains Step 1 fields');
  await click('Save & Exit');
  assert.ok(await evaluate(`document.querySelector('.toast').textContent.includes('Testing draft saved for this session only')`), 'Save & Exit clearly reports a testing draft');
  assert.equal(await evaluate(`location.pathname`), '/user/home', 'Save & Exit leaves registration');
  await evaluate(`history.pushState({},'', '/seller/service/dashboard');window.dispatchEvent(new PopStateEvent('popstate'))`);
  for (let attempt = 0; attempt < 40 && !await evaluate(`Boolean(document.querySelector('.partner-simple-header h1'))`); attempt += 1) await pause(100);
  assert.equal(await evaluate(`document.querySelector('.field-wrap input').value`), 'Fictional Test Shopkeeper', 'Same-session draft is restored without becoming a completed registration');
  await click('Continue');
  assert.match(await title(), /Shop Details/);
  assert.equal(await evaluate(`document.querySelectorAll('.service-registration-test-skip button').length`), 1, 'Step 2 keeps its testing-only skip');
  assert.equal(await evaluate(`document.querySelectorAll('.media-upload').length`), 0, 'Step 2 has no uploads');
  for (const [label, value] of [['Shop or business name', 'Fictional Bhopal Repairs'], ['Shop ownership', 'Rented'], ['Address', 'Sample Market'], ['Area / locality', 'MP Nagar'], ['City', 'Bhopal'], ['State', 'Madhya Pradesh'], ['PIN code', '462011']]) await setField(label, value);
  await click('Continue');
  assert.match(await title(), /Your Services/);
  assert.equal(await evaluate(`document.querySelectorAll('.service-registration-test-skip button').length`), 1, 'Step 3 has one testing-only skip');
  assert.equal(await evaluate(`document.querySelectorAll('.service-category-grid button').length`), 8, 'All eight existing catalogue categories');
  await click('Electrician'); await click('Electronics'); await click('AC Service');
  await setField('Experience — Years', '4'); await setField('Additional months', '3'); await setField('Workers besides you', '0');
  assert.equal(await evaluate(`document.querySelectorAll('.selected-service-chips button').length`), 2, 'Multi-category selections are shown as chips');
  assert.ok(await evaluate(`[...document.querySelectorAll('.service-skill-suggestions button')].some(item=>item.textContent.includes('Wiring'))`), 'Electrician suggests Wiring');
  assert.ok(await evaluate(`[...document.querySelectorAll('.service-skill-suggestions button')].some(item=>item.textContent.includes('AC Cleaning'))`), 'Selections from another category also suggest skills');
  assert.equal(await evaluate(`document.querySelectorAll('.service-confirmed-skills button').length`), 0, 'Suggestions are not confirmed automatically');
  await click('Wiring');
  assert.equal(await evaluate(`document.querySelectorAll('.service-confirmed-skills button').length`), 1, 'Partner explicitly confirms a suggested skill');
  assert.equal(await evaluate(`document.querySelectorAll('.selected-service-chips button').length`), 2, 'Confirming a skill does not offer another service');
  await click('Auto-fill Bio');
  assert.ok(await evaluate(`document.querySelector('.service-bio-section textarea').value.includes('4 years 3 months') && document.querySelector('.service-bio-section textarea').value.includes('Wiring')`), 'Bio uses entered experience and confirmed skills');
  await setField('Bio - optional', 'My own professional introduction.');
  await click('Vehicle');
  assert.equal(await evaluate(`document.querySelector('.service-bio-section textarea').value`), 'My own professional introduction.', 'Changing category does not overwrite edited bio');
  await evaluate(`document.querySelector('[aria-label="Remove Wiring"]').click()`);
  assert.equal(await evaluate(`document.querySelectorAll('.service-confirmed-skills button').length`), 0, 'Confirmed skills are removable');
  await click('Continue');
  assert.match(await title(), /Work Preferences/);
  assert.equal(await evaluate(`document.querySelectorAll('.service-registration-test-skip button').length`), 1, 'Step 4 has one testing-only skip');
  await click('Back');
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.selected-service-chips button')].map(item=>item.textContent.trim()).sort()`), ['AC Service', 'Electrician'], 'Back preserves services');
  await click('Continue');
  await setField('Where do you provide the service?', 'Both'); await setField('Service areas / localities', 'MP Nagar, Arera Colony');
  await click('Mon'); await click('Sat'); await setField('Opening time', '09:00'); await setField('Closing time', '18:00');
  await click('Continue');
  assert.match(await title(), /Bank Details/);
  assert.equal(await evaluate(`document.querySelectorAll('.service-registration-test-skip button').length`), 1, 'Step 5 has one testing-only skip');
  assert.equal(await evaluate(`document.querySelectorAll('.media-upload').length`), 0, 'Step 5 has typed fields only');
  await setField('Account holder’s name', 'Fictional Test Shopkeeper'); await setField('Bank account number', '0012345678'); await setField('Re-enter account number', '0012345678'); await setField('IFSC code', 'SBIN0001234'); await setField('Bank name', 'Sample Bank');
  await click('Continue');
  assert.match(await title(), /Documents/);
  assert.equal(await evaluate(`document.querySelectorAll('.service-registration-test-skip button').length`), 1, 'Step 6 has one testing-only skip');
  assert.equal(await evaluate(`document.querySelectorAll('.document-upload-card').length`), 5, 'All upload groups appear only in Step 6');
  assert.ok(await evaluate(`document.querySelector('.registration-review').textContent.includes('•••• 5678')`), 'Review masks the account number');
  assert.ok(await evaluate(`document.body.textContent.includes('Documents pending:') && document.body.textContent.includes('Service Partner Terms & Conditions') && document.body.textContent.includes('Service Partner Privacy Policy')`), 'Missing real policies are named and visibly block consent');
  await click('Complete registration');
  assert.ok(await evaluate(`document.querySelector('.toast').textContent.includes('Live registration is unavailable because phone verification and backend submission are not configured')`), 'Unavailable live submission is reported honestly');
  assert.equal(await evaluate(`location.pathname`), '/seller/service/dashboard');
  assert.ok(await evaluate(`Boolean(document.querySelector('.service-registration'))`), 'Failed completion retains the form');
  assert.ok(await evaluate(`!document.querySelector('.toast').textContent.includes('Testing draft saved')`), 'Failed completion is never reported as a draft save');

  for (const width of [360, 390, 430]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true }); await pause(180);
    assert.equal(await evaluate(`Math.round(document.querySelector('.phone-shell').getBoundingClientRect().width)`), width);
    assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), `No horizontal overflow at ${width}px`);
    const smallControls = await evaluate(`[...document.querySelectorAll('.service-registration button')].filter(item=>{const box=item.getBoundingClientRect();return box.width>0&&box.height<43.5}).map(item=>({text:item.textContent.trim(),height:item.getBoundingClientRect().height,className:item.className}))`);
    assert.deepEqual(smallControls, [], `Touch controls remain at least 44px at ${width}px`);
    await screen(`service-registration-${width}.png`);
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }); await pause(180);
  const frame = await evaluate(`(()=>{const box=document.querySelector('.phone-shell').getBoundingClientRect();return {width:box.width,left:box.left}})()`);
  assert.equal(frame.width, 430); assert.equal(frame.left, await evaluate(`(document.documentElement.clientWidth-430)/2`), 'Desktop preview is a centered 430px phone frame');
  await click('Open Demo dashboard'); await pause(500);
  assert.equal(await evaluate(`location.pathname`), '/seller/service/dashboard', 'Final local skip opens the Service dashboard preview');
  assert.ok(await evaluate(`document.body.textContent.includes('Demo Mode — sample data, no real bookings or payments.')`), 'Dashboard clearly identifies the isolated preview as Demo Mode');
  assert.equal(await evaluate(`document.querySelector('.demo-controls select').value`), 'professional', 'The matching Service dashboard preview opens');
  await send('Page.reload');
  for (let attempt = 0; attempt < 40 && !await evaluate(`Boolean(document.querySelector('.partner-onboarding'))`); attempt += 1) await pause(150);
  assert.equal(await evaluate(`document.querySelectorAll('.demo-workspace').length`), 0, 'Refresh cannot turn Demo completion into a partner account');
  assert.equal(await evaluate(`location.pathname`), '/seller/service/dashboard', 'Refresh keeps the requested workspace URL behind registration');
  assert.deepEqual(errors, [], 'No uncaught runtime errors');
  console.log(`PASS: all six Service Partner registration pages have a development-only skip; intermediate skip preserves the draft; final skip opens a labelled local preview without approval; required production validation remains intact; widths 360/390/430 plus desktop have no overflow. Screenshots: ${folder}`);
  await send('Browser.close');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { socket?.close(); browser?.kill(); });
