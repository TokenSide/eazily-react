const { build } = require('esbuild');
const { createServer } = require('node:http');
const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

const pause = ms => new Promise(done => setTimeout(done, ms));
let server, browser, socket;

(async () => {
  const folder = resolve('docs/professional-discovery/final');
  mkdirSync(folder, { recursive: true });
  const bundle = await build({
    entryPoints: ['scripts/professional-discovery-fixture.jsx'],
    bundle: true,
    write: false,
    outdir: '.tmp/professional-discovery-fixture',
    jsx: 'automatic',
    format: 'iife',
    define: {
      'import.meta.env.VITE_SUPABASE_URL': '""',
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': '""',
      'import.meta.env.VITE_SUPABASE_ANON_KEY': '""',
      'import.meta.env.VITE_PARTNER_DEMO': '"true"',
      'import.meta.env.DEV': 'true',
    },
  });
  server = createServer((request, response) => {
    if (request.url.startsWith('/fixture.')) {
      const file = bundle.outputFiles.find(output => output.path.endsWith(request.url.endsWith('.css') ? '.css' : '.js'));
      response.setHeader('Content-Type', request.url.endsWith('.css') ? 'text/css' : 'text/javascript');
      return response.end(file.contents);
    }
    if (request.url.startsWith('/assets/')) {
      try { return response.end(readFileSync(resolve('public', `.${new URL(request.url, 'http://localhost').pathname}`))); }
      catch { response.statusCode = 404; return response.end(); }
    }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(done => server.listen(5211, '127.0.0.1', done));
  browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9371', `--user-data-dir=${resolve('.tmp', `professional-discovery-browser-${Date.now()}`)}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let tab;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { tab = await (await fetch('http://127.0.0.1:9371/json/new?http://127.0.0.1:5211/', { method: 'PUT' })).json(); break; }
    catch { await pause(250); }
  }
  assert.ok(tab, 'Edge started');
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(done => socket.addEventListener('open', done, { once: true }));
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const event = JSON.parse(data);
    if (!event.id) return;
    const promise = pending.get(event.id);
    pending.delete(event.id);
    event.error ? promise.reject(event.error) : promise.resolve(event.result);
  });
  const send = (method, params = {}) => new Promise((done, reject) => { pending.set(++id, { resolve: done, reject }); socket.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
  const screenshot = async name => writeFileSync(resolve(folder, name), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  for (const width of [360, 390, 430]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
    await send('Page.navigate', { url: 'http://127.0.0.1:5211/' });
    await pause(900);
    const list = await evaluate(`(()=>({cards:document.querySelectorAll('.vendor-list > .vendor-card').length,demo:document.body.textContent.includes('Demo profile'),overflow:document.documentElement.scrollWidth<=innerWidth}))()`);
    assert.ok(list.cards === 1 && list.demo && list.overflow, `${width}px professional list ${JSON.stringify(list)}`);
    await screenshot(`professional-list-${width}.png`);
    await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.includes('View Profile')).click()`);
    await pause(500);
    const profile = await evaluate(`(()=>({name:document.body.textContent.includes('Rahul Sharma'),portfolio:document.querySelectorAll('.professional-portfolio-grid img').length,book:[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Book Now'),bookVisible:[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Book Now'&&button.getBoundingClientRect().bottom<=innerHeight),overflow:document.documentElement.scrollWidth<=innerWidth}))()`);
    assert.ok(profile.name && profile.portfolio === 4 && profile.book && profile.bookVisible && profile.overflow, `${width}px profile ${JSON.stringify(profile)}`);
    await screenshot(`professional-profile-${width}.png`);
    await evaluate(`document.querySelector('.professional-portfolio-grid').scrollIntoView({block:'center'})`);
    await pause(180);
    const portfolio = await evaluate(`(()=>({columns:getComputedStyle(document.querySelector('.professional-portfolio-grid')).gridTemplateColumns.split(' ').length,overflow:document.documentElement.scrollWidth<=innerWidth}))()`);
    assert.ok(portfolio.columns === 2 && portfolio.overflow, `${width}px portfolio grid ${JSON.stringify(portfolio)}`);
    await screenshot(`professional-portfolio-${width}.png`);
    await evaluate(`document.querySelector('.professional-portfolio-grid button').click()`);
    await pause(300);
    assert.ok(await evaluate(`Boolean(document.querySelector('.portfolio-viewer-sheet img'))`), `${width}px full-screen portfolio viewer opens`);
    await evaluate('history.back()');
    await pause(300);
    assert.equal(await evaluate(`Boolean(document.querySelector('.portfolio-viewer-sheet'))`), false, `${width}px Back closes image viewer first`);
    assert.equal(await evaluate(`Boolean(document.querySelector('.professional-profile-sheet'))`), true, `${width}px profile remains after viewer Back`);
    await evaluate(`history.back()`);
    await pause(300);
    assert.equal(await evaluate(`Boolean(document.querySelector('.professional-profile-sheet'))`), false, `${width}px second Back returns to professional list`);
    console.log(`PASS professional list, profile, portfolio viewer and Back at ${width}px`);
  }

  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:5211/' });
  await pause(900);
  await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.includes('View Profile')).click()`);
  await pause(300);
  await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Book Now').click()`);
  await pause(250);
  assert.ok(await evaluate(`document.body.textContent.includes('creates no account, booking, consent, payment, review, or analytics record')`));
  await evaluate(`(()=>{const set=(element,value)=>{const setter=Object.getOwnPropertyDescriptor(element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set;setter.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));};set([...document.querySelectorAll('input')].find(input=>input.closest('label')?.textContent.includes('Service location')),'MP Nagar');set(document.querySelector('textarea'),'Routine AC service');document.querySelector('details').open=true;set(document.querySelector('input[type=date]'),'2026-12-15');})()`);
  await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.includes('Request confirmation')).click()`);
  await pause(300);
  assert.ok(await evaluate(`document.body.textContent.includes('Demo booking preview')&&document.body.textContent.includes('No account, booking, consent, payment, review, or analytics record was created')`));
  console.log('PASS Demo Book Now preview creates no backend record');

  await send('Page.navigate', { url: 'http://127.0.0.1:5211/?mode=home' });
  await pause(750);
  await evaluate(`document.querySelector('.more-service-showcase').scrollIntoView({block:'center'})`);
  await pause(500);
  const homeInitial = await evaluate(`(()=>{const section=document.querySelector('.more-service-showcase'),grid=section.querySelector('.more-service-grid');return {labels:[...grid.querySelectorAll('b')].map(node=>node.textContent.trim()),height:grid.getBoundingClientRect().height,overflow:document.documentElement.scrollWidth<=innerWidth}})()`);
  assert.equal(homeInitial.labels.length, 6);
  assert.equal(new Set(homeInitial.labels).size, 6);
  assert.ok(homeInitial.overflow);
  await pause(4700);
  const homeRotated = await evaluate(`(()=>{const grid=document.querySelector('.more-service-grid');return {labels:[...grid.querySelectorAll('b')].map(node=>node.textContent.trim()),height:grid.getBoundingClientRect().height}})()`);
  assert.notDeepEqual(homeRotated.labels, homeInitial.labels);
  assert.equal(new Set(homeRotated.labels).size, 6);
  assert.ok(Math.abs(homeRotated.height - homeInitial.height) <= 1, 'Rotation keeps section height stable');
  await evaluate(`document.querySelector('.more-service-card').click()`);
  assert.equal((await evaluate('window.lastRequest')).serviceName, homeRotated.labels[0], 'Rotated card opens its displayed service');

  await send('Page.navigate', { url: 'http://127.0.0.1:5211/?mode=home' });
  await pause(700);
  await evaluate(`document.querySelector('.more-service-showcase').scrollIntoView({block:'center'});document.querySelector('.more-service-showcase').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);
  const touched = await evaluate(`[...document.querySelectorAll('.more-service-card b')].map(node=>node.textContent.trim())`);
  await pause(4900);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.more-service-card b')].map(node=>node.textContent.trim())`), touched, 'Touch pauses rotation');
  await evaluate(`document.querySelector('.more-service-showcase').dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))`);
  await pause(5500);
  assert.notDeepEqual(await evaluate(`[...document.querySelectorAll('.more-service-card b')].map(node=>node.textContent.trim())`), touched, 'Rotation resumes after touch');

  await send('Page.navigate', { url: 'http://127.0.0.1:5211/?mode=home' });
  await pause(700);
  await evaluate(`document.querySelector('.more-service-showcase').scrollIntoView({block:'center'});window.dispatchEvent(new Event('scroll'))`);
  const scrolling = await evaluate(`[...document.querySelectorAll('.more-service-card b')].map(node=>node.textContent.trim())`);
  let activeScroll;
  try {
    activeScroll = setInterval(() => { evaluate(`window.dispatchEvent(new Event('scroll'))`).catch(() => {}); }, 250);
    await pause(4900);
  } finally { clearInterval(activeScroll); }
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.more-service-card b')].map(node=>node.textContent.trim())`), scrolling, 'Scrolling pauses rotation');
  await pause(5400);
  assert.notDeepEqual(await evaluate(`[...document.querySelectorAll('.more-service-card b')].map(node=>node.textContent.trim())`), scrolling, 'Rotation resumes after scrolling');

  await send('Page.navigate', { url: 'http://127.0.0.1:5211/?mode=home' });
  await pause(700);
  await evaluate(`document.querySelector('.more-service-showcase').scrollIntoView({block:'center'});Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))`);
  const backgrounded = await evaluate(`[...document.querySelectorAll('.more-service-card b')].map(node=>node.textContent.trim())`);
  await pause(4900);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.more-service-card b')].map(node=>node.textContent.trim())`), backgrounded, 'Background tab pauses rotation');
  await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))`);
  await pause(4900);
  assert.notDeepEqual(await evaluate(`[...document.querySelectorAll('.more-service-card b')].map(node=>node.textContent.trim())`), backgrounded, 'Visible tab resumes rotation');

  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Page.navigate', { url: 'http://127.0.0.1:5211/?mode=home' });
  await pause(700);
  await evaluate(`document.querySelector('.more-service-showcase').scrollIntoView({block:'center'})`);
  const reduced = await evaluate(`[...document.querySelectorAll('.more-service-card b')].map(node=>node.textContent.trim())`);
  await pause(4900);
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.more-service-card b')].map(node=>node.textContent.trim())`), reduced, 'Reduced motion disables auto-rotation');
  console.log('PASS 4.6s rotation, unique cards, stable height, card links, touch/background pause, resume, overflow and reduced motion');

  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  for (const width of [360, 390, 430]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: true });
    await send('Page.navigate', { url: 'http://127.0.0.1:5211/?mode=home' });
    await pause(700);
    await evaluate(`document.querySelector('.more-service-showcase').scrollIntoView({block:'center'})`);
    await pause(450);
    await screenshot(`home-more-${width}.png`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => { if (socket) socket.close(); if (browser) browser.kill(); if (server) server.close(); });
