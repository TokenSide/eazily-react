/* Browser checks for customer-app motion, genuine async loading feedback and reduced motion. */
const { build } = require('esbuild');
const { createServer } = require('node:http');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

const pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms));
let server, browser, socket;

(async () => {
  const delay = 360;
  const mocks = {
    experience: `
      const wait=()=>new Promise(resolve=>setTimeout(resolve,${delay}));
      export async function readRows(){await wait();return []}
      export async function rpc(){await wait();return 0}
      export function requireBackend(){throw new Error('Test backend unavailable')}
      export function canonicalService(name){return ({'Master Electrician':'Electrician','Electrician Visit':'Electrician','Plumbing Professional':'Plumber','Cleaning Specialist':'Deep Cleaning','Home Cleaning':'Deep Cleaning','AC Repair':'AC Service','Painting Service':'Painter','Appliance Technician':'Appliance Repair'})[name]??name}
      export function experienceLink(){return location.href}
      export async function shareLink(){}
    `,
    marketplace: `
      const wait=()=>new Promise(resolve=>setTimeout(resolve,${delay}));
      export async function createServiceRequest(){await wait();return {id:'TEST-REQUEST-1',status:'pending'}}
      export async function getCurrentProfile(){await wait();return null}
    `
  };
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'jsx',
      contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import UserApp from './src/pages/UserApp.jsx';
        import './src/styles.css';
        import './src/experience.css';
        import './src/partner.css';
        localStorage.setItem('eazily-language','English');
        createRoot(document.getElementById('root')).render(<div className="phone-shell"><UserApp account={{user:{id:'test-user'},applications:[],roles:[]}} notify={message=>window.lastNotice=message} onWorkspace={()=>{}} onAddRole={()=>{}} /></div>);
      `
    },
    bundle: true,
    write: false,
    outdir: '.tmp/user-motion-fixture',
    jsx: 'automatic',
    define: {
      'import.meta.env.VITE_SUPABASE_URL': '""',
      'import.meta.env.VITE_SUPABASE_ANON_KEY': '""',
      'import.meta.env.DEV': 'false'
    },
    plugins: [{
      name: 'delayed-user-data',
      setup(api) {
        api.onLoad({ filter: /services[\\/]experience\.js$/ }, () => ({ contents: mocks.experience, loader: 'js' }));
        api.onLoad({ filter: /services[\\/]marketplace\.js$/ }, () => ({ contents: mocks.marketplace, loader: 'js' }));
      }
    }]
  });

  server = createServer((request, response) => {
    const file = bundle.outputFiles.find(output => output.path.endsWith(request.url === '/fixture.css' ? '.css' : '.js'));
    if (request.url.startsWith('/fixture.')) {
      response.setHeader('Content-Type', request.url.endsWith('.css') ? 'text/css' : 'text/javascript');
      return response.end(file.contents);
    }
    if (request.url.startsWith('/assets/')) {
      try {
        const pathname = new URL(request.url, 'http://localhost').pathname;
        response.setHeader('Content-Type', pathname.endsWith('.webp') ? 'image/webp' : 'image/png');
        return response.end(readFileSync(resolve('public', `.${pathname}`)));
      } catch {
        response.statusCode = 404;
        return response.end();
      }
    }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(resolveListen => server.listen(5205, '127.0.0.1', resolveListen));

  const profile = resolve('.tmp', `user-motion-browser-${Date.now()}`);
  mkdirSync(profile, { recursive: true });
  browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
    '--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=9345', `--user-data-dir=${profile}`, 'about:blank'
  ], { windowsHide: true, stdio: 'ignore' });
  let tab;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      tab = await (await fetch('http://127.0.0.1:9345/json/new?http://127.0.0.1:5205/', { method: 'PUT' })).json();
      break;
    } catch { await pause(250); }
  }
  assert.ok(tab, 'Edge started');
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(resolveOpen => socket.addEventListener('open', resolveOpen, { once: true }));
  let id = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener('message', ({ data }) => {
    const event = JSON.parse(data);
    if (event.id) {
      const item = pending.get(event.id);
      pending.delete(event.id);
      event.error ? item.reject(event.error) : item.resolve(event.result);
    }
    if (event.method === 'Runtime.exceptionThrown') errors.push(event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
  });
  const send = (method, params = {}) => new Promise((resolveSend, rejectSend) => {
    pending.set(++id, { resolve: resolveSend, reject: rejectSend });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description);
    return result.result.value;
  };
  const clickText = async (text, selector = 'button') => {
    await evaluate(`(()=>{const node=[...document.querySelectorAll(${JSON.stringify(selector)})].find(item=>item.textContent.trim()===${JSON.stringify(text)});if(!node)throw new Error('Missing ${text}');(node.closest('button')||node).click()})()`);
  };
  const output = resolve('docs/user-motion/after');
  mkdirSync(output, { recursive: true });
  const capture = async name => writeFileSync(resolve(output, name), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));

  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await send('Page.navigate', { url: 'http://127.0.0.1:5205/' });
  await pause(80);

  assert.equal(await evaluate('document.querySelectorAll(".user-skeleton-card").length'), 2, 'Real vendor loading renders dimension-matched skeletons');
  assert.ok(await evaluate('[...document.querySelectorAll(".user-skeleton-card")].every(card=>card.getBoundingClientRect().height>=190)'), 'Skeleton cards retain expected final-card height');
  await pause(delay + 180);
  assert.equal(await evaluate('document.querySelectorAll(".user-skeleton-card").length'), 0, 'Skeletons disappear as soon as real loading settles');

  const carouselHeight = await evaluate('document.querySelector(".hero-carousel").getBoundingClientRect().height');
  await evaluate('document.querySelectorAll(".hero-dots button")[1].click()');
  assert.deepEqual(await evaluate('(()=>{const promotion=document.querySelector(".hero-promotion"),dots=document.querySelector(".hero-dots button");return {animation:getComputedStyle(promotion).animationName,duration:getComputedStyle(promotion).animationDuration,indicator:getComputedStyle(dots).transitionDuration,height:document.querySelector(".hero-carousel").getBoundingClientRect().height}})()'), {
    animation: 'hero-slide-fade', duration: '0.22s', indicator: '0.18s, 0.18s, 0.18s', height: carouselHeight
  }, 'Carousel uses one fixed-size fade and gentle indicator transition');

  const target = await evaluate('(()=>{const button=[...document.querySelectorAll(".nav-item")].find(item=>item.textContent.trim()==="Explore"),rect=button.getBoundingClientRect();return {x:rect.left+rect.width/2,y:rect.top+rect.height/2}})()');
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 });
  await pause(45);
  const pressed = await evaluate('Number(getComputedStyle([...document.querySelectorAll(".nav-item")].find(item=>item.textContent.trim()==="Explore")).transform.match(/matrix\\(([^,]+)/)?.[1]||1)');
  assert.ok(pressed < 1 && pressed >= .97, 'Tap feedback scales the existing control inside its bounds');
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 });
  await pause(20);
  assert.ok(await evaluate('!!document.querySelector(".main-category-grid")'), 'Navigation is immediate');
  assert.deepEqual(await evaluate('(()=>{const screen=document.querySelector(".user-app-root>.screen"),style=getComputedStyle(screen);return {name:style.animationName,duration:style.animationDuration,transform:style.transform}})()'), {
    name: 'user-page-fade', duration: '0.22s', transform: 'none'
  }, 'User page transition is opacity-only and content starts in its final position');
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'), 'No horizontal overflow at 360px');
  await pause(280);
  await capture('categories-360.png');

  await clickText('Home', '.nav-item');
  await pause(260);
  await clickText('Packers & Movers', '.explore-grid b');
  await pause(30);
  assert.ok(await evaluate('!!document.querySelector(".form-sheet")'), 'Existing request form opens');
  await evaluate(`(()=>{const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const field of document.querySelectorAll('input[required]')){setter.call(field,field.type==='tel'?'9999999999':'Demo value');field.dispatchEvent(new Event('input',{bubbles:true}))}})()`);
  const submitSize = await evaluate('(()=>{const r=document.querySelector("button[type=submit]").getBoundingClientRect();return {width:r.width,height:r.height}})()');
  await evaluate('document.querySelector("button[type=submit]").click()');
  await pause(35);
  assert.ok(await evaluate('!!document.querySelector("button[type=submit]:disabled .user-button-spinner")'), 'Submit button shows progress only while the real request promise is pending');
  assert.deepEqual(await evaluate('(()=>{const r=document.querySelector("button[type=submit]").getBoundingClientRect();return {width:r.width,height:r.height}})()'), submitSize, 'Progress indicator preserves button dimensions');
  assert.equal(await evaluate('document.querySelectorAll(".success").length'), 0, 'Success is not shown before confirmation');
  await pause(delay + 80);
  assert.equal(await evaluate('document.querySelector(".success h2").textContent'), 'Request received', 'Success appears after confirmed completion');

  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: 'http://127.0.0.1:5205/' });
  await pause(delay + 180);
  assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'), 'No horizontal overflow at 430px');
  await capture('home-430.png');

  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Page.navigate', { url: 'http://127.0.0.1:5205/' });
  await pause(delay + 180);
  const initialSlide = await evaluate('[...document.querySelectorAll(".hero-dots button")].findIndex(button=>button.classList.contains("active"))');
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".hero-promotion")).animationName'), 'none', 'Carousel fade is disabled for reduced motion');
  assert.ok((await evaluate('parseFloat(getComputedStyle(document.querySelector(".screen")).animationDuration)')) <= 0.00001, 'Page fade is effectively disabled for reduced motion');
  await pause(4700);
  assert.equal(await evaluate('[...document.querySelectorAll(".hero-dots button")].findIndex(button=>button.classList.contains("active"))'), initialSlide, 'Carousel autoplay is disabled for reduced motion');
  assert.deepEqual(errors, [], 'No runtime exceptions');

  console.log('PASS user-only tap feedback, fixed-position page fade, carousel transition, real loading skeletons, submit progress, 360/430 overflow and reduced motion.');
  console.log(`Screenshots: ${output}`);
  await send('Browser.close');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  socket?.close();
  browser?.kill();
  server?.close();
});
