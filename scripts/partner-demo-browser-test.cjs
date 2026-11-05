/* npm run dev first. Isolated Edge test profile; no existing browser/account is used. */
const { writeFileSync, mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const pause = ms => new Promise(r => setTimeout(r, ms));
let browser, socket;
(async () => {
  assert.equal((await fetch('http://127.0.0.1:5173/src/features/partners/demo/DemoWorkspace.jsx')).status, 200);
  const folder = resolve('.tmp', `partner-demo-${Date.now()}`);
  mkdirSync(folder, { recursive: true });
  const screenshots = resolve('docs', 'partner-demo'); mkdirSync(screenshots, { recursive: true });
  browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9340', `--user-data-dir=${resolve(folder, 'browser')}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let tab;
  for (let i = 0; i < 40; i++) { try { tab = await (await fetch('http://127.0.0.1:9340/json/new?http://127.0.0.1:5173/', { method: 'PUT' })).json(); break; } catch { await pause(250); } }
  assert.ok(tab, 'Edge started');
  socket = new WebSocket(tab.webSocketDebuggerUrl); await new Promise(r => socket.addEventListener('open', r, { once: true }));
  let id = 0, observingDemo = false; const pending = new Map(), errors = [], networkViolations = [];
  socket.addEventListener('message', ({ data }) => {
    const event = JSON.parse(data);
    if (event.id) { const p = pending.get(event.id); pending.delete(event.id); event.error ? p.reject(event.error) : p.resolve(event.result); }
    if (event.method === 'Runtime.exceptionThrown') errors.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
    if (event.method === 'Runtime.consoleAPICalled' && event.params.type === 'error') errors.push(event.params.args.map(a => a.value || a.description).join(' '));
    if (observingDemo && event.method === 'Network.requestWillBeSent') {
      const r = event.params.request;
      if (!r.url.startsWith('http://127.0.0.1:5173/') || r.method !== 'GET') networkViolations.push({ url: r.url, method: r.method });
    }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { pending.set(++id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const waitFor = async expression => { for (let i = 0; i < 50; i++) { if (await evaluate(expression)) return; await pause(100); } throw new Error('Timed out: ' + expression + '\n' + await evaluate('document.body.innerText')); };
  const click = async text => { await evaluate(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw new Error('Missing button '+${JSON.stringify(text)});b.click();})()`); await pause(120); };
  const input = async (selector, value) => { await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error('Missing input');Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`); await pause(100); };
  const storage = () => evaluate('JSON.stringify({local:{...localStorage},session:{...sessionStorage}})');
  const screenshot = async name => {
    await evaluate('window.scrollTo(0,0)'); await pause(100);
    writeFileSync(resolve(screenshots, name + '.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    const size = (await send('Page.getLayoutMetrics')).cssContentSize;
    const viewport = await evaluate('({width:innerWidth,height:innerHeight,deviceScaleFactor:1,mobile:innerWidth<=430})');
    // Expand only screenshot height so the fixed bottom bar does not mask the middle of a long artifact.
    await send('Emulation.setDeviceMetricsOverride', { ...viewport, height: Math.ceil(size.height) }); await pause(80);
    writeFileSync(resolve(screenshots, name + '-full.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await send('Emulation.setDeviceMetricsOverride', viewport); await pause(80);
  };
  const openWork = async title => { await click('My Orders'); await evaluate(`(()=>{const c=[...document.querySelectorAll('.demo-stack article')].find(c=>c.querySelector('h3')?.textContent===${JSON.stringify(title)});if(!c)throw new Error('Missing sample '+${JSON.stringify(title)});c.querySelector('button').click();})()`); await pause(120); };
  await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/' }); await pause(1200);
  const roles = [['professional', 'service'], ['influencer', 'influencer'], ['consultant', 'consultant']];
  const account = { user: { id: 'demo-browser-real-account-fixture', testing: true }, profile: { name: 'Actual account fixture' }, roles: roles.map(r => r[0]), applications: roles.map(([role]) => ({ id: 'actual-fixture-' + role, role, status: 'draft', details: { name: 'Actual account fixture', city: 'Bhopal', category: 'Home & Property', services: ['Electrician'], stage: 5, registrationComplete: true } })) };
  await evaluate(`sessionStorage.setItem('eazily-testing-account',${JSON.stringify(JSON.stringify(account))});localStorage.setItem('eazily-language','English');`);
  for (const [role, path] of roles) {
    observingDemo = false;
    await send('Page.navigate', { url: 'http://127.0.0.1:5173/seller/' + path + '/dashboard' });
    await waitFor(`!![...document.querySelectorAll('button')].find(b=>b.textContent.includes('Enter Demo Mode'))`);
    const beforeStorage = await storage(), beforeMetrics = await evaluate('document.querySelector(".pd-metrics").textContent');
    observingDemo = true; await click('Enter Demo Mode'); await waitFor(`!!document.querySelector('.demo-workspace')`);
    assert.ok(await evaluate(`document.body.innerText.includes('Demo Mode — sample data, no real bookings or payments.')`));
    assert.equal(await evaluate(`document.querySelector('.demo-controls select').value`), role);
    // Trap communication and storage APIs after module loading; count any attempt, even caught exceptions.
    await evaluate(`window.demoForbidden=[];window.demoRestore=[];for(const [owner,key] of [[window,'fetch'],[XMLHttpRequest.prototype,'open'],[navigator,'sendBeacon'],[Storage.prototype,'setItem'],[Storage.prototype,'removeItem'],[Storage.prototype,'clear'],[window,'open'],[window,'WebSocket'],[window,'EventSource'],[Notification,'requestPermission']]){const original=owner[key];window.demoRestore.push(()=>owner[key]=original);owner[key]=()=>{window.demoForbidden.push(key);throw new Error('Forbidden demo IO: '+key);};}`);
    for (const width of [360, 390, 430]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true }); await pause(100);
      assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'), role + ' no horizontal overflow ' + width);
      assert.equal(await evaluate('Math.round(document.querySelector(".phone-shell").getBoundingClientRect().width)'), width);
      assert.equal(await evaluate('document.querySelectorAll(".bottom-nav").length'), 1);
      assert.deepEqual(await evaluate(`[...document.querySelectorAll('.demo-controls button,.demo-controls select,.bottom-nav button')].filter(e=>{const r=e.getBoundingClientRect();return r.width<43.5||r.height<43.5}).map(e=>e.textContent)`), []);
      await screenshot(role + '-' + width);
      await evaluate('window.scrollTo(0,document.documentElement.scrollHeight)'); await pause(100);
      assert.ok(await evaluate('document.querySelector(".demo-content").getBoundingClientRect().bottom<=document.querySelector(".bottom-nav").getBoundingClientRect().top'), 'Nav clears content');
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false }); await pause(100);
    assert.ok(await evaluate('document.querySelector(".phone-shell").getBoundingClientRect().width<=430'));
    assert.ok(await evaluate('Math.abs(document.querySelector(".phone-shell").getBoundingClientRect().left-(document.documentElement.clientWidth-document.querySelector(".phone-shell").getBoundingClientRect().width)/2)<2'));
    await screenshot(role + '-desktop');
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const metricsBefore = await evaluate('document.querySelector(".pd-metrics").textContent');
    await click('Simulate New Lead'); await click('Simulate New Lead');
    assert.notEqual(await evaluate('document.querySelector(".pd-metrics").textContent'), metricsBefore);
    assert.ok(await evaluate('document.querySelector("[role=status]").textContent.includes("New sample request")'));
    await click('My Orders'); assert.ok(await evaluate('document.body.innerText.includes("9 samples")'));
    // Reset isolates all demo data and dismisses the selected sample.
    await click('Reset Demo Data');
    const title = { professional: 'Ceiling fan repair', influencer: 'Café launch reel', consultant: 'CV review session' }[role];
    await openWork(title); await click('Accept sample request');
    assert.ok(await evaluate('document.querySelector(".demo-content").innerText.includes("Lead status: active")'));
    await click('Open mock conversation'); await input('.demo-content textarea', 'This is only a local demo message.'); await click('Send demo message');
    assert.ok(await evaluate('document.querySelector(".demo-content").innerText.includes("This is only a local demo message.")'));
    await openWork(title);
    if (role === 'professional') {
      await input('.demo-content input', '246810'); await click('Verify demo arrival'); await click('Send sample final quote'); await click('Simulate customer quote approval'); await click('Simulate successful payment'); await click('Simulate customer completion');
    } else if (role === 'influencer') {
      assert.ok(await evaluate('document.querySelector(".demo-limitation").textContent.includes("no connected start-campaign")'));
      await openWork('Dessert launch story'); await click('Simulate prepaid payment'); await click('Simulate trusted scope confirmation'); await click('Simulate customer completion'); await click('Simulate trusted hold release');
    } else {
      assert.ok(await evaluate('document.querySelector(".demo-limitation").textContent.includes("no connected start-session")'));
      await openWork('Five-minute career introduction'); await click('Simulate customer completion');
    }
    assert.ok(await evaluate('document.querySelector(".demo-content .demo-badge").textContent.includes("completed")'));
    await screenshot(role + '-completed');
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
    await click('Home'); await click('View details'); // overview -> local Earnings
    assert.ok(await evaluate('document.querySelector(".demo-content").innerText.includes("Demo earnings")'));
    if (role === 'professional') assert.ok(await evaluate('document.querySelector(".demo-content").innerText.includes("1,300.00")'), '₹900 seed plus ₹400 sample payment remains pending');
    if (role === 'influencer') assert.ok(await evaluate('document.querySelector(".demo-content").innerText.includes("2,295.00")'), '₹1,215 seeded available plus ₹1,080 released hold');
    if (role === 'consultant') assert.ok(await evaluate('document.querySelector(".demo-content").innerText.includes("No simulated payments yet")'));
    await click('Post'); assert.ok(await evaluate('document.querySelector(".demo-content").textContent.includes("Read-only examples")'));
    assert.equal(await evaluate('document.querySelectorAll(".partner-post-sheet").length'), 0);
    const otherRole = role === 'professional' ? 'influencer' : 'professional';
    await input('.demo-controls select', otherRole); assert.equal(await evaluate('document.querySelector(".demo-controls select").value'), otherRole);
    await input('.demo-controls select', role); await openWork(role === 'professional' ? title : role === 'influencer' ? 'Dessert launch story' : 'Five-minute career introduction');
    assert.ok(await evaluate('document.querySelector(".demo-content .demo-badge").textContent.includes("completed")'), 'Switch retains independent role progress');
    await click('Reset Demo Data'); await click('My Orders'); assert.ok(await evaluate('document.body.innerText.includes("7 samples")'));
    assert.deepEqual(await evaluate('window.demoForbidden'), [], 'No demo network, storage, external or push calls');
    assert.equal(await storage(), beforeStorage, 'Actual browser storage untouched');
    await evaluate('window.demoRestore.forEach(restore=>restore())'); observingDemo = false;
    await click('Exit Demo Mode'); await waitFor('!!document.querySelector(".pd-metrics")');
    assert.equal(await evaluate('document.querySelector(".pd-metrics").textContent'), beforeMetrics);
    assert.ok(await evaluate('document.querySelector(".pd-identity").textContent.includes("Verification pending")'), 'Actual account remains unverified');
    assert.equal(await storage(), beforeStorage, 'Exit preserves actual account and storage');
    assert.equal(await evaluate('document.querySelectorAll(".demo-workspace,.demo-feedback").length'), 0);
    console.log('PASS ' + role + ': mobile 360/390/430, desktop frame, supported journey, counts, messages, earnings, switch/reset/exit and IO isolation');
  }
  assert.deepEqual(networkViolations, [], 'No external or mutation requests during demo'); assert.deepEqual(errors, [], 'No runtime errors');
  console.log('Screenshots: ' + screenshots); await send('Browser.close');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { socket?.close(); browser?.kill(); });
