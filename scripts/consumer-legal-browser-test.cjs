// Isolated local production pages + mocked approved-version UI contract. No remote backend.
const { createServer } = require('node:http');
const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('node:fs');
const { resolve, extname, dirname } = require('node:path');
const { spawn } = require('node:child_process');
const { build } = require('esbuild');
const assert = require('node:assert/strict');
const pause = ms => new Promise(r => setTimeout(r, ms));
const output = resolve('.tmp', `consumer-legal-browser-${Date.now()}`), root = resolve('dist');
let browser, socket, server;
(async () => {
  mkdirSync(output, { recursive: true });
  await build({ entryPoints: ['scripts/consumer-legal-fixture.jsx'], outfile: resolve(output, 'fixture.js'), bundle: true, format: 'esm', jsx: 'automatic', define: { 'import.meta.env': '{}' }, plugins: [{ name: 'isolated-consumer-fixture', setup(b) {
    b.onResolve({ filter: /lib\/supabase\.js$/ }, () => ({ path: 'fixture-backend', namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const isSupabaseConfigured=true;export const supabase={auth:{getSession:async()=>({data:{session:{user:{id:'fixture-account'}}},error:null})},rpc:(name,args)=>window.consumerFixture.rpc(name,args)};`, loader: 'js' }));
    b.onResolve({ filter: /\?raw$/ }, args => ({ path: resolve(args.resolveDir, args.path.replace(/\?raw$/, '')), namespace: 'raw' }));
    b.onLoad({ filter: /.*/, namespace: 'raw' }, args => ({ contents: readFileSync(args.path, 'utf8'), loader: 'text' }));
    b.onResolve({ filter: /^\// }, args => args.kind === 'url-token' ? { path: args.path, external: true } : null);
  } }] });
  server = createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    if (pathname === '/fixture') { res.setHeader('Content-Type', 'text/html'); res.end('<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>'); return; }
    const file = ['/fixture.js', '/fixture.css'].includes(pathname) ? resolve(output, pathname.slice(1)) : resolve(root, '.' + pathname);
    const safe = file.startsWith(root + '\\') || dirname(file) === output;
    const target = safe && existsSync(file) && extname(file) ? file : resolve(root, 'index.html');
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' })[extname(target)] || 'application/octet-stream');
    res.end(readFileSync(target));
  });
  await new Promise(r => server.listen(5201, '127.0.0.1', r));
  browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9343', `--user-data-dir=${resolve(output, 'browser')}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let tab;
  for (let i = 0; i < 40; i++) { try { tab = await (await fetch('http://127.0.0.1:9343/json/new?http://127.0.0.1:5201/', { method: 'PUT' })).json(); break; } catch { await pause(250); } }
  assert.ok(tab, 'Browser started'); socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(r => socket.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map(), errors = [], remote = [];
  socket.addEventListener('message', ({ data }) => { const e = JSON.parse(data); if (e.id) { const p = pending.get(e.id); pending.delete(e.id); e.error ? p.reject(e.error) : p.resolve(e.result); } if (e.method === 'Runtime.exceptionThrown') errors.push(e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text); if (e.method === 'Network.requestWillBeSent' && /^https?:/.test(e.params.request.url) && !e.params.request.url.startsWith('http://127.0.0.1:5201/')) remote.push(e.params.request.url); });
  const send = (method, params = {}) => new Promise((resolveSend, reject) => { pending.set(++id, { resolve: resolveSend, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
  const wait = async expression => { for (let i = 0; i < 60; i++) { if (await evaluate(expression)) return; await pause(100); } throw new Error('Timed out: ' + expression + '\n' + await evaluate('document.body.innerText')); };
  const click = async (label, selector = 'button') => { await evaluate(`(()=>{const item=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.textContent.trim()===${JSON.stringify(label)});if(!item)throw new Error('Missing '+${JSON.stringify(label)});item.click()})()`); await pause(200); };
  const shot = async name => writeFileSync(resolve(output, `${name}.png`), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await send('Runtime.enable'); await send('Network.enable'); await send('Page.enable');
  for (const width of [360, 390, 430]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
    for (const [path, count, ending] of [['terms', 33, 'Will achieve a particular.'], ['privacy', 34, 'under its own privacy policy']]) {
      await send('Page.navigate', { url: `http://127.0.0.1:5201/${path}` });
      await wait(`Boolean(document.querySelector('.consumer-policy-page'))`); await pause(900);
      assert.equal(await evaluate(`document.querySelectorAll('.influencer-legal-document h2').length`), count);
      assert.ok(await evaluate(`document.body.textContent.includes(${JSON.stringify(ending)})`));
      assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth`), `${path} fits ${width}`);
      assert.equal(await evaluate(`document.querySelectorAll('input[type=checkbox]').length`), 0, 'Opening a policy is not consent');
      await shot(`${path}-${width}`);
      await evaluate('window.scrollTo(0,document.body.scrollHeight)');
      assert.ok(await evaluate('scrollY>0'), 'Long document scrolls');
    }
  }
  await send('Page.navigate', { url: 'http://127.0.0.1:5201/' });
  await wait(`document.body.textContent.includes('Find & Book Services') || [...document.querySelectorAll('button')].some(b=>b.textContent==='English')`);
  if (await evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent==='English')`)) await click('English');
  await click('Sign In'); await wait(`Boolean(document.querySelector('#auth-phone'))`);
  await click('Consumer Terms & Conditions (draft)'); await wait(`Boolean(document.querySelector('.consumer-policy-sheet'))`);
  await click('Close policy'); assert.ok(await evaluate(`Boolean(document.querySelector('#auth-phone'))`), 'Sign-in stays usable');
  await evaluate(`document.querySelector('button[aria-label=Back]').click()`); await pause(200);
  await click('Find & Book Services', '.welcome-choice b'); await wait(`Boolean(document.querySelector('.bottom-nav'))`);
  await click('Profile'); await click('Legal'); await wait(`Boolean(document.querySelector('[name=consumerTermsAccepted]'))`);
  assert.ok(await evaluate(`['consumerTermsAccepted','consumerPrivacyAcknowledged'].every(name=>{const c=document.querySelector('[name='+name+']');return !c.checked && c.disabled})`));
  await shot('profile-drafts');

  // Approved-version contract: actual React components/services, isolated fake RPC.
  await send('Page.navigate', { url: 'http://127.0.0.1:5201/fixture' });
  await wait(`Boolean(document.querySelector('[name=consumerTermsAccepted]')) && !document.querySelector('[name=consumerTermsAccepted]').disabled`);
  await click('Consumer Terms & Conditions'); await click('Close policy');
  assert.equal(await evaluate(`document.querySelector('[name=consumerTermsAccepted]').checked`), false);
  await click('Fixture book service'); await wait(`document.querySelectorAll('[role=dialog]').length>0`);
  assert.equal(await evaluate(`window.consumerFixture.calls.filter(c=>c.name==='submit_request').length`), 0, 'Transaction does not run before acknowledgment');
  await click('Continue browsing');
  await evaluate(`document.querySelector('[name=consumerTermsAccepted]').click()`); await pause(100);
  assert.ok(await evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Save acknowledgment').disabled`), 'One checkbox is insufficient');
  await evaluate(`document.querySelector('[name=consumerPrivacyAcknowledged]').click()`); await pause(100);
  await click('Save acknowledgment'); await wait(`document.body.textContent.includes('Your current Terms acceptance')`);
  assert.equal(await evaluate(`window.consumerFixture.calls.filter(c=>c.name==='accept_consumer_policies').length`), 1);
  assert.equal(await evaluate(`window.consumerFixture.calls.filter(c=>c.name==='submit_request').length`), 0, 'Saving consent never automatically repeats a transaction');
  await click('Fixture book service'); await wait(`document.querySelector('#fixture-result').textContent==='fixture-booking'`);
  await evaluate(`window.consumerFixture.documents=window.consumerFixture.documents.map(d=>({...d,id:d.id+'-v2',version:'fixture-v2'}));window.dispatchEvent(new Event('focus'))`);
  await wait(`Boolean(document.querySelector('[name=consumerTermsAccepted]'))`);
  assert.ok(await evaluate(`!document.querySelector('[name=consumerTermsAccepted]').checked && !document.querySelector('[name=consumerPrivacyAcknowledged]').checked`));
  await evaluate(`window.consumerFixture.stale=true;document.querySelector('[name=consumerTermsAccepted]').click();document.querySelector('[name=consumerPrivacyAcknowledged]').click()`); await pause(100);
  await click('Save acknowledgment'); await wait(`document.body.textContent.includes('policies changed')`);
  assert.ok(await evaluate(`!document.querySelector('[name=consumerTermsAccepted]').checked`), 'Stale-version rejection clears choices');
  await evaluate(`window.consumerFixture.fail=true;window.dispatchEvent(new Event('focus'))`);
  await wait(`document.body.textContent.includes('Fixture connection unavailable')`);
  assert.ok(await evaluate(`document.querySelector('[name=consumerTermsAccepted]').disabled`), 'Failures disable acceptance');
  await evaluate(`window.consumerFixture.fail=false;window.consumerFixture.stale=false`); await click('Retry policies');
  await wait(`!document.querySelector('[name=consumerTermsAccepted]').disabled`);
  for (const width of [360, 390, 430]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'));
    await shot(`approved-acknowledgment-${width}`);
  }
  assert.deepEqual(errors, []); assert.deepEqual(remote, [], 'No external service contacted');
  console.log(`PASS: public/sign-up/Profile draft access; 360/390/430px policies; separate unchecked choices; approved-version transaction prompt, explicit retry, stale/error recovery; no remote requests. Screenshots: ${output}`);
  await send('Browser.close');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { socket?.close(); browser?.kill(); server?.close(); });
