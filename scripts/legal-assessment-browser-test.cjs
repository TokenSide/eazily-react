/* Local development-only browser verification. Start Vite on 127.0.0.1:5173 first. */
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const pause = milliseconds => new Promise(resolvePause => setTimeout(resolvePause, milliseconds));
let browser, socket;

(async () => {
  assert.equal((await fetch('http://127.0.0.1:5173/')).status, 200, 'Start Vite before this check');
  const output = resolve('.tmp', `legal-assessment-browser-${Date.now()}`);
  mkdirSync(output, { recursive: true });
  browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9341', `--user-data-dir=${resolve(output, 'browser')}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let tab;
  for (let count = 0; count < 40; count += 1) {
    try { tab = await (await fetch('http://127.0.0.1:9341/json/new?http://127.0.0.1:5173/', { method: 'PUT' })).json(); break; } catch { await pause(250); }
  }
  if (!tab) throw new Error('Edge did not start');
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(resolveOpen => socket.addEventListener('open', resolveOpen, { once: true }));
  let id = 0;
  const pending = new Map(), errors = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) { const request = pending.get(message.id); pending.delete(message.id); message.error ? request.reject(message.error) : request.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise((resolveRequest, reject) => { pending.set(++id, { resolve: resolveRequest, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; };
  const click = async (label, selector = 'button', contains = false) => { await evaluate(`(()=>{const element=[...document.querySelectorAll(${JSON.stringify(selector)})].find(node=>${contains ? 'node.textContent.includes' : 'node.textContent.trim()==='}(${JSON.stringify(label)}));if(!element)throw new Error('Missing control: '+${JSON.stringify(label)});element.click();})()`); await pause(220); };
  const screenshot = async name => writeFileSync(resolve(output, name), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/' }); await pause(1500);
  for (let count = 0; count < 40 && !await evaluate(`document.body.textContent.includes('English')||document.body.textContent.includes('Join as a Partner')`); count += 1) await pause(200);
  if (await evaluate(`document.body.textContent.includes('English')`)) await click('English');
  await click('Join as a Partner', '.welcome-choice b'); await click('Influencer', '.welcome-choice b');
  for (let count = 0; count < 40 && !await evaluate(`Boolean(document.querySelector('.auth-input input'))`); count += 1) await pause(200);
  await evaluate(`(()=>{const input=document.querySelector('.auth-input input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'9888888888');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('Send OTP');
  await evaluate(`(()=>{const input=document.querySelector('.otp-digits input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'0000');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('Verify & Continue');
  for (let count = 0; count < 40 && !await evaluate(`Boolean(document.querySelector('.partner-onboarding'))`); count += 1) await pause(200);
  for (let step = 0; step < 5; step += 1) await click('Skip for now');
  assert.ok(await evaluate(`document.body.textContent.includes('Influencer Terms & Conditions')`));
  assert.equal(await evaluate(`document.querySelector('[name=influencerTermsAccepted]').checked`), false);
  await click('Complete registration');
  assert.ok(await evaluate(`document.querySelector('[role=alert]').textContent.includes('explicitly accept')`), 'Unchecked submission shows an inline explanation');
  assert.ok(await evaluate(`!document.querySelector('.toast').textContent.includes('Testing draft saved')`), 'Influencer completion is never converted into a draft save');
  await click('Influencer Terms & Conditions');
  assert.equal(await evaluate(`document.querySelectorAll('.influencer-legal-document h2').length`), 21);
  assert.ok(await evaluate(`document.querySelector('.influencer-legal-document').textContent.includes('Effective Date: 12 September 2026')`));
  await screenshot('influencer-terms.png');
  await click('Close');
  assert.equal(await evaluate(`document.querySelector('[name=influencerTermsAccepted]').checked`), false, 'Reading Terms does not check consent');
  await click('Influencer Privacy Policy');
  assert.equal(await evaluate(`document.querySelectorAll('.influencer-legal-document h2').length`), 19);
  assert.ok(await evaluate(`document.querySelector('.influencer-legal-document').textContent.includes('Last Updated: 12 September 2026')`));
  await click('Close');
  for (const width of [360, 390, 430]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true }); await pause(120);
    assert.equal(await evaluate(`Math.round(document.querySelector('.phone-shell').getBoundingClientRect().width)`), width);
    assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), `Influencer registration has no overflow at ${width}px`);
  }
  await click('Open Demo dashboard');
  for (let count = 0; count < 40 && !await evaluate(`Boolean(document.querySelector('.demo-workspace'))`); count += 1) await pause(150);
  assert.ok(await evaluate(`document.body.textContent.includes('Demo Mode — sample data, no real bookings or payments.')`));
  assert.equal(await evaluate(`document.querySelector('.demo-controls select').value`), 'influencer');
  await evaluate('sessionStorage.clear();localStorage.clear();history.replaceState({},"","/");location.reload()'); await pause(1500);
  await click('English'); await click('Join as a Partner', '.welcome-choice b'); await click('Consultant', '.welcome-choice b');
  for (let count = 0; count < 40 && !await evaluate(`Boolean(document.querySelector('.auth-input input'))`); count += 1) await pause(200);
  await evaluate(`(()=>{const input=document.querySelector('.auth-input input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'9888888888');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('Send OTP');
  await evaluate(`(()=>{const input=document.querySelector('.otp-digits input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'0000');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('Verify & Continue');
  for (let count = 0; count < 40 && !await evaluate(`Boolean(document.querySelector('.partner-onboarding'))`); count += 1) await pause(200);
  for (let step = 0; step < 4; step += 1) await click('Skip for now');
  assert.ok(await evaluate(`document.body.textContent.includes('Assessment unavailable')`));
  assert.ok(await evaluate(`document.body.textContent.includes('Testing only')`));
  await screenshot('consultant-assessment-unavailable.png');
  await click('Skip for now');
  assert.equal(await evaluate(`document.querySelector('.partner-simple-header h1').textContent.includes('Review and consultation terms')`), true);
  assert.equal(await evaluate(`document.querySelector('[name=consultantTermsAccepted]').checked`), false);
  assert.equal(await evaluate(`document.querySelector('[name=consultantPrivacyAcknowledged]').checked`), false);
  assert.ok(await evaluate(`document.querySelector('[name=consultantTermsAccepted]').disabled && document.querySelector('[name=consultantPrivacyAcknowledged]').disabled`), 'Drafts cannot be acknowledged');
  await click('Consultant Terms & Conditions — Draft preview');
  assert.equal(await evaluate(`document.querySelectorAll('.influencer-legal-document h2').length`), 33);
  assert.ok(await evaluate(`document.querySelector('.consultant-legal-sheet').textContent.includes('33.5 Platform administrative actio')`));
  assert.ok(await evaluate(`document.querySelector('.consultant-legal-sheet').scrollWidth <= document.querySelector('.consultant-legal-sheet').clientWidth + 1`), 'No horizontal overflow at mobile width');
  await screenshot('consultant-terms-draft.png');
  await click('Close');
  await click('Consultant Privacy Policy — Draft preview');
  assert.ok(await evaluate(`document.querySelector('.consultant-legal-sheet').textContent.includes('laws and profes')`));
  await screenshot('consultant-privacy-draft.png');
  await click('Close');
  assert.equal(await evaluate(`document.querySelector('[name=consultantTermsAccepted]').checked`), false, 'Reading draft does not imply consent');
  await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
  await click('Consultant Privacy Policy — Draft preview');
  assert.equal(await evaluate(`document.querySelectorAll('.influencer-legal-document h2').length`), 42);
  assert.ok(await evaluate(`document.querySelector('.consultant-legal-sheet').scrollWidth <= document.querySelector('.consultant-legal-sheet').clientWidth + 1`), 'No overflow at 320px');
  await screenshot('consultant-privacy-320px.png');
  await click('Close');
  await click('Complete registration');
  assert.ok(await evaluate(`document.querySelector('.partner-simple-header h1').textContent.includes('Your expertise')`), 'Consultant completion validates earlier required steps');
  assert.ok(await evaluate(`!document.querySelector('.toast').textContent.includes('Testing draft saved')`), 'Consultant completion is never converted into a draft save');
  for (let step = 0; step < 4; step += 1) await click('Skip for now');
  await click('Skip for now');
  for (const width of [360, 390, 430]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true }); await pause(120);
    assert.equal(await evaluate(`Math.round(document.querySelector('.phone-shell').getBoundingClientRect().width)`), width);
    assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), `Consultant registration has no overflow at ${width}px`);
  }
  await click('Open Demo dashboard');
  for (let count = 0; count < 40 && !await evaluate(`Boolean(document.querySelector('.demo-workspace'))`); count += 1) await pause(150);
  assert.ok(await evaluate(`document.body.textContent.includes('Demo Mode — sample data, no real bookings or payments.')`));
  assert.equal(await evaluate(`document.querySelector('.demo-controls select').value`), 'consultant');
  assert.deepEqual(errors, [], 'No uncaught runtime errors');
  console.log(`PASS: Influencer and Consultant registration completion opens the matching isolated Demo dashboard; Consultant assessment Skip for now remains local-only; legal controls remain explicit; and 360/390/430px layouts have no overflow. Screenshots: ${output}`);
  await send('Browser.close');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { socket?.close(); browser?.kill(); });
