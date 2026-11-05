/* Run after npm run build. Uses installed Edge and isolated local-only account fixtures. */
const { createServer } = require('node:http');
const { readFileSync, writeFileSync, existsSync, mkdirSync } = require('node:fs');
const { resolve, extname, sep } = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const pause = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));
const root = resolve('dist');
const server = createServer((request, response) => {
  let file = resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (!file.startsWith(root + sep) || !existsSync(file) || !extname(file)) file = resolve(root, 'index.html');
  response.setHeader('Content-Type', ({ '.js':'text/javascript','.css':'text/css','.html':'text/html','.webp':'image/webp','.png':'image/png' })[extname(file)] || 'application/octet-stream');
  response.end(readFileSync(file));
});
let browser, socket;
(async () => {
  await new Promise(resolvePromise => server.listen(5207, '127.0.0.1', resolvePromise));
  const profile = `.tmp/chat-browser-${Date.now()}`; mkdirSync(profile, { recursive: true });
  browser = spawn(edgePath, ['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=9347',`--user-data-dir=${resolve(profile)}`,'about:blank'], { windowsHide:true, stdio:'ignore' });
  let tab;
  for (let attempt=0; attempt<40; attempt++) { try { tab = await (await fetch('http://127.0.0.1:9347/json/new?http://127.0.0.1:5207', { method:'PUT' })).json(); break; } catch { await pause(250); } }
  if (!tab) throw new Error('Edge did not start');
  socket = new WebSocket(tab.webSocketDebuggerUrl); await new Promise(resolvePromise => socket.addEventListener('open', resolvePromise, { once:true }));
  let sequence=0; const pending=new Map(), errors=[];
  socket.addEventListener('message', ({data}) => { const event=JSON.parse(data); if(event.id){const item=pending.get(event.id);pending.delete(event.id);event.error?item.reject(event.error):item.resolve(event.result);} if(event.method==='Runtime.exceptionThrown')errors.push(event.params.exceptionDetails.exception?.description||event.params.exceptionDetails.text); });
  const send=(method,params={})=>new Promise((resolvePromise,reject)=>{pending.set(++sequence,{resolve:resolvePromise,reject});socket.send(JSON.stringify({id:sequence,method,params}));});
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
  const click=async label=>{await evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(item=>item.textContent.trim()===${JSON.stringify(label)});if(!button)throw new Error('Missing button: '+${JSON.stringify(label)});button.click();})()`);await pause(250);};
  await send('Runtime.enable');
  const account = { user:{id:'11111111-1111-4111-8111-111111111111',testing:true,phone:'9999999999'}, profile:{id:'11111111-1111-4111-8111-111111111111',full_name:'Chat Layout Tester'}, roles:['professional','influencer','consultant'], applications:[
    {id:'22222222-2222-4222-8222-222222222222',role:'professional',status:'draft',details:{name:'Service Test',businessName:'Service Test',registrationComplete:true,registrationStatus:'skipped_for_testing'}},
    {id:'33333333-3333-4333-8333-333333333333',role:'influencer',status:'draft',details:{name:'Influencer Test',creatorName:'Influencer Test',registrationComplete:true}},
    {id:'44444444-4444-4444-8444-444444444444',role:'consultant',status:'draft',details:{name:'Consultant Test',registrationComplete:true,assessmentStatus:'skipped_for_testing'}}
  ]};
  await pause(1000);
  await evaluate(`sessionStorage.setItem('eazily-testing-account',${JSON.stringify(JSON.stringify(account))});localStorage.setItem('eazily-language','English');localStorage.setItem('eazily-workspace:${account.user.id}','customer');location.href='/user/home'`);
  await pause(1300); await click('Messages');
  assert.ok(await evaluate(`Boolean(document.querySelector('.chat-workspace'))`));
  assert.ok(await evaluate(`document.body.textContent.includes('No conversations yet')`));
  assert.equal(await evaluate(`document.querySelectorAll('.conversation').length`),0,'Customer demo message rows were removed');
  for (const width of [360,390,430]) {
    await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true}); await pause(180);
    assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),`Customer chat has no overflow at ${width}px`);
    writeFileSync(`.tmp/chat-customer-${width}.png`,Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
  }
  const paths={professional:'/seller/service/dashboard',influencer:'/seller/influencer/dashboard',consultant:'/seller/consultant/dashboard'};
  const colours={professional:'#15803D',influencer:'#C2410C',consultant:'#2563EB'};
  for (const role of Object.keys(paths)) {
    await evaluate(`localStorage.setItem('eazily-workspace:${account.user.id}',${JSON.stringify(role)});location.href=${JSON.stringify(paths[role])}`); await pause(1100); await click('Messages');
    assert.ok(await evaluate(`Boolean(document.querySelector('.partner-workspace.role-${role} .chat-workspace'))`),`${role} uses shared chat workspace`);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.partner-workspace')).getPropertyValue('--role').trim()`),colours[role],`${role} keeps its theme`);
    for (const width of [360,390,430]) { await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true}); await pause(120); assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),`${role} chat has no overflow at ${width}px`); }
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false}); await pause(200);
  assert.ok(await evaluate(`document.querySelector('.phone-shell').getBoundingClientRect().width<=430`),'Desktop chat stays in the centered mobile frame');
  assert.deepEqual(errors,[],'No uncaught browser errors');
  console.log('PASS: customer and all three partner Messages screens, role themes, 360/390/430 overflow, placeholder removal, and centered desktop mobile frame.');
  await send('Browser.close');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{socket?.close();browser?.kill();server.close();});
