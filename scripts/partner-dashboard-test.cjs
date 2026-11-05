/* Local only: start npm run dev first. Uses an isolated Edge profile and in-memory banner fixtures. */
const { createServer } = require('node:http');
const { writeFileSync, mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawn } = require('node:child_process');
const { build } = require('esbuild');
const assert = require('node:assert/strict');
const pause = ms => new Promise(r => setTimeout(r, ms));
let browser, socket, server;
(async () => {
  assert.equal((await fetch('http://127.0.0.1:5173/')).status, 200, 'Start the local Vite server before this check');
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import Carousel from './src/features/partners/PartnerBannerCarousel.jsx';
    import Dashboard from './src/features/partners/PartnerDashboard.jsx';
    const root = createRoot(document.getElementById('root'));
    const past = new Date(Date.now()-100*86400000).toISOString();
    const props = {role:'professional',banners:[],application:{status:'approved',reviewed_at:past},trial:{approval_started_at:past,trial_ends_at:new Date(Date.now()-86400000).toISOString(),status:'active',current_period_end:new Date(Date.now()+86400000).toISOString()},setRoute:value=>window.destination=value,setSheet:value=>window.destination=value};
    window.renderBanner = updates => { Object.assign(props,updates); root.render(<Carousel {...props}/>); };
    window.renderBanner({});
    window.renderDashboard = role => {
      const request={id:'fixture-request',title:'Existing request fixture',status:'requested',details:{deliverables:'Existing deliverable'}};
      const ongoing={id:'fixture-active',title:'Existing active fixture',status:'active',deadline:'2026-10-05T10:00:00Z',details:{deliverables:'Existing deliverable'}};
      root.render(<Dashboard role={role} profile={{name:'Fixture partner',services:['Electrician']}} approved={true} application={{status:'approved'}} data={{orders:[request,ongoing,{id:'fixture-completed',status:'completed'}],posts:[{id:'fixture-post',status:'published',details:{title:'Existing post'}}],reviews:[]}} online={false} busy={false} trial={null} setRoute={value=>window.dashboardAction={route:value}} setSheet={value=>window.dashboardAction={sheet:value}} act={fn=>fn()} setAvailability={async value=>{window.availabilityRequested=value;return {online:value};}} setOnline={value=>window.onlineResult=value} total={state=>state==='available'?1200:400} money={value=>String(value)} onEditRegistration={()=>window.dashboardAction={registration:true}}/>);
    };
  ` }, bundle: true, write: false, jsx: 'automatic', format: 'iife', loader: {'.css':'empty'}, define: {'import.meta.env.DEV':'false'} });
  server = createServer((req, res) => {
    if (req.url === '/fixture.js') { res.setHeader('Content-Type','text/javascript'); res.end(bundle.outputFiles[0].contents); }
    else { res.setHeader('Content-Type','text/html'); res.end('<!doctype html><html><body><div id="root"></div><script src="/fixture.js"></script></body></html>'); }
  });
  await new Promise(r => server.listen(5201, '127.0.0.1', r));
  const folder = resolve('.tmp', `partner-dashboard-review-${Date.now()}`);
  mkdirSync(folder, {recursive:true});
  browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=9338',`--user-data-dir=${resolve(folder,'browser')}`,'about:blank'], {windowsHide:true,stdio:'ignore'});
  let tab;
  for (let i=0;i<40;i++) { try { tab=await (await fetch('http://127.0.0.1:9338/json/new?http://127.0.0.1:5173/', {method:'PUT'})).json(); break; } catch { await pause(250); } }
  if (!tab) throw new Error('Edge did not start');
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(r => socket.addEventListener('open',r,{once:true}));
  let id=0; const pending=new Map(), errors=[];
  socket.addEventListener('message',({data})=>{
    const message=JSON.parse(data);
    if(message.id){const request=pending.get(message.id);pending.delete(message.id);message.error?request.reject(message.error):request.resolve(message.result);}
    if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);
    if(message.method==='Runtime.consoleAPICalled' && message.params.type==='error')errors.push(message.params.args.map(a=>a.value||a.description).join(' '));
  });
  const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
  const click=async(label,selector='button')=>{await evaluate(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b)throw new Error('Missing button: '+${JSON.stringify(label)});b.click();})()`);await pause(200);};
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  const navigation = await send('Page.navigate',{url:'http://127.0.0.1:5173/'});
  if (navigation.errorText) throw new Error('Local navigation failed: '+navigation.errorText);
  await pause(1800);
  assert.equal(await evaluate('location.origin'),'http://127.0.0.1:5173','Browser reached the local app');
  const roles=[['professional','service','#15803D'],['influencer','influencer','#C2410C'],['consultant','consultant','#2563EB']];
  const account={user:{id:'local-dashboard-review',testing:true},profile:{name:'Local test'},roles:roles.map(r=>r[0]),applications:roles.map(([role])=>({id:'local-'+role,role,status:'draft',details:{name:'Local test',city:'Bhopal',category:'Home & Property',services:['Electrician'],stage:5,registrationComplete:true}}))};
  await evaluate(`sessionStorage.setItem('eazily-testing-account',${JSON.stringify(JSON.stringify(account))});localStorage.setItem('eazily-language','English');`);
  for(const [role,path,colour] of roles){
    await send('Page.navigate',{url:'http://127.0.0.1:5173/seller/'+path+'/dashboard'});await pause(1400);
    assert.ok(await evaluate(`!!document.querySelector('.partner-workspace.role-${role}')`),role+' dashboard renders');
    assert.equal(await evaluate(`document.querySelector('.partner-workspace').style.getPropertyValue('--role')`),colour);
    assert.ok(await evaluate(`document.documentElement.scrollWidth<=innerWidth`),role+' has no mobile overflow');
    assert.equal(await evaluate(`document.querySelectorAll('.partner-banner-carousel').length`),0,'No fabricated campaigns');
    assert.equal(await evaluate(`document.querySelectorAll('.bottom-nav button').length`),5);
    await click('Profile');
    assert.ok(await evaluate(`!!document.querySelector('.partner-profile-page')`),role+' profile route opens');
    await evaluate('history.back()');await pause(250);
    assert.ok(await evaluate(`!!document.querySelector('.pd-dashboard')`),role+' browser/device history returns to dashboard root');
    writeFileSync(resolve(folder,role+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    const liveTotals = await evaluate(`document.querySelector('.pd-metrics').textContent`);
    await click('Enter Demo Mode');
    for (let attempt=0;attempt<30 && !await evaluate(`!!document.querySelector('.demo-workspace')`);attempt++) await pause(100);
    assert.ok(await evaluate(`!!document.querySelector('.demo-workspace')`), 'Interactive samples are isolated');
    await click('Exit Demo Mode');
    assert.equal(await evaluate(`document.querySelector('.pd-metrics').textContent`),liveTotals,'Demo never affects actual totals');
    assert.equal(await evaluate(`document.querySelectorAll('.pd-work-item').length`),0,'Samples do not enter actual work');
    for (const width of [360,390,430]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});await pause(200);
      await evaluate('window.scrollTo(0,0)');await pause(100);
      assert.equal(await evaluate('Math.round(document.querySelector(".phone-shell").getBoundingClientRect().width)'),width,'Phone uses full available width');
      assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),role+' has no horizontal overflow at '+width);
      assert.equal(await evaluate('getComputedStyle(document.querySelector(".pd-metrics")).gridTemplateColumns.split(" ").length'),2,'Overview remains 2 by 2');
      assert.ok(await evaluate('[...document.querySelectorAll(".pd-metrics article > span:last-child,.pd-empty p,.pd-sample p")].every(el=>parseFloat(getComputedStyle(el).fontSize)>=14)'),'Body and metric text is readable');
      const smallControls=await evaluate('[...document.querySelectorAll(".pd-dashboard button,.pd-topbar button,.bottom-nav button")].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&(r.width<43.5||r.height<43.5)}).map(el=>el.textContent)');
      assert.deepEqual(smallControls,[],'Touch targets at least 44px');
      writeFileSync(resolve(folder,role+'-'+width+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
      const layout=await send('Page.getLayoutMetrics');
      await send('Emulation.setDeviceMetricsOverride',{width,height:Math.ceil(layout.cssContentSize.height),deviceScaleFactor:1,mobile:true});await pause(150);
      writeFileSync(resolve(folder,role+'-demo-'+width+'.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:layout.cssContentSize.height,scale:1}})).data,'base64'));
      await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});await pause(100);
      await evaluate('window.scrollTo(0,document.documentElement.scrollHeight)');await pause(100);
      assert.ok(await evaluate('document.querySelector(".pd-dashboard").lastElementChild.getBoundingClientRect().bottom<=document.querySelector(".bottom-nav").getBoundingClientRect().top'),'Bottom navigation does not cover the final card');
      console.log('PASS mobile layout: '+role+' at '+width+'px');
    }
    await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});await pause(200);
    await evaluate('window.scrollTo(0,0)');await pause(100);
    const frame=await evaluate('(()=>{const r=document.querySelector(".phone-shell").getBoundingClientRect();const nav=document.querySelector(".bottom-nav").getBoundingClientRect();return {width:r.width,left:r.left,navWidth:nav.width,navLeft:nav.left}})()');
    assert.equal(frame.width,430,'Desktop retains phone width');assert.equal(frame.left,await evaluate('(document.documentElement.clientWidth-430)/2'),'Mobile frame centered');
    assert.equal(frame.navWidth,430);assert.equal(frame.navLeft,frame.left,'Navigation remains within mobile frame');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".pd-metrics")).gridTemplateColumns.split(" ").length'),2);
    assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),'No desktop overflow');
    writeFileSync(resolve(folder,role+'-desktop.png'),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    await click('Post');assert.ok(await evaluate(`!!document.querySelector('.partner-post-sheet form')`),role+' posting form opens');
    assert.ok(await evaluate(`document.querySelector('.partner-post-sheet').getBoundingClientRect().width<=430`),'Posting keeps its original width');
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await pause(150);
    await click('Profile');await click('Edit Profile');
    assert.ok(await evaluate(`!!document.querySelector('.partner-onboarding')`),role+' registration editing opens');
    console.log('PASS dashboard, mobile width, palette, posting and registration entry: '+role);
  }
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:'http://127.0.0.1:5173/seller/service/dashboard'});await pause(1200);
  assert.ok(await evaluate(`document.querySelector('.phone-shell').getBoundingClientRect().width<=430`),'Desktop retains the mobile dashboard frame');
  // Real component with isolated fixtures; these records never enter the app or a database.
  await send('Page.navigate',{url:'http://127.0.0.1:5201/'});await pause(500);
  assert.equal(await evaluate(`document.querySelectorAll('.partner-banner-carousel').length`),0);
  const fixtures=Array.from({length:3},(_,i)=>({id:String(i),role:'professional',headline:'TEST ONLY '+i,supporting_line:'Isolated regression fixture',action_kind:'orders',action_label:'Open test destination'}));
  await evaluate(`window.renderBanner({banners:${JSON.stringify(fixtures)}})`);await pause(250);
  assert.ok(await evaluate(`!!document.querySelector('.partner-banner-carousel')`),'Banners render after asynchronous arrival');
  await evaluate(`document.querySelector('[aria-label="Show campaign 3"]').click()`);await pause(100);
  await evaluate(`window.renderBanner({banners:${JSON.stringify(fixtures.slice(0,1))}})`);await pause(150);
  assert.equal(await evaluate(`document.querySelector('h2').textContent`),'TEST ONLY 0','Shrinking a selected list does not crash');
  await click('Open test destination');assert.equal(await evaluate('window.destination'),'orders');
  for(const [kind,destination] of Object.entries({subscription:'Subscription',training:'Training',post:'post',orders:'orders',profile:'profile',support:'Help & Support'})){
    await evaluate(`window.renderBanner({banners:[${JSON.stringify({...fixtures[0],action_kind:kind})}]})`);await pause(80);
    await click('Open test destination');assert.equal(await evaluate('window.destination'),destination);
  }
  await evaluate(`window.renderBanner({role:'influencer'})`);await pause(100);
  assert.equal(await evaluate(`document.querySelectorAll('.partner-banner-carousel').length`),0,'Other-role campaigns are hidden');
  await evaluate(`window.renderBanner({role:'professional',trial:{approval_date_missing:true}})`);await pause(100);
  assert.equal(await evaluate(`document.querySelectorAll('.partner-banner-carousel').length`),0,'Untrusted eligibility is hidden');
  await evaluate(`window.renderBanner({trial:{approval_started_at:new Date(Date.now()-100*86400000).toISOString(),trial_ends_at:new Date(Date.now()-86400000).toISOString(),status:'active',current_period_end:new Date(Date.now()+86400000).toISOString()},banners:${JSON.stringify(fixtures)}})`);await pause(150);
  await click('Pause');
  await evaluate(`document.querySelector('.partner-banner-carousel').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));document.querySelector('.partner-banner-carousel').dispatchEvent(new MouseEvent('mouseout',{bubbles:true}));`);
  await pause(6200);
  assert.equal(await evaluate(`document.querySelector('h2').textContent`),'TEST ONLY 0','Manual pause survives hover exit');
  await click('Play');await pause(6300);
  assert.equal(await evaluate(`document.querySelector('h2').textContent`),'TEST ONLY 1','Play resumes automatic advancement');
  await click('Pause');
  await evaluate(`(()=>{const el=document.querySelector('.partner-banner-carousel');for(const [type,x] of [['touchstart',180],['touchend',60]]){const event=new Event(type,{bubbles:true});Object.defineProperty(event,type==='touchstart'?'touches':'changedTouches',{value:[{clientX:x}]});el.dispatchEvent(event);}})()`);await pause(150);
  assert.equal(await evaluate(`document.querySelector('h2').textContent`),'TEST ONLY 2','Swipe advances one slide');
  assert.ok(await evaluate(`[...document.querySelectorAll('button')].some(b=>b.textContent==='Play')`),'Swipe preserves manual pause');
  await evaluate(`document.getElementById('root').style.marginTop='1800px';window.scrollTo(0,0)`);await pause(150);
  await click('Play');await pause(6200);
  assert.equal(await evaluate(`document.querySelector('h2').textContent`),'TEST ONLY 2','Offscreen carousel pauses after asynchronous arrival');
  await evaluate(`document.querySelector('.partner-banner-carousel').scrollIntoView()`);await pause(6300);
  assert.equal(await evaluate(`document.querySelector('h2').textContent`),'TEST ONLY 0','Visible carousel resumes');
  for (const [role] of roles) {
    await evaluate('window.renderDashboard('+JSON.stringify(role)+')');await pause(150);
    assert.equal(await evaluate(`document.querySelectorAll('.pd-work-item').length`),2,'Existing requested and active orders appear');
    assert.deepEqual(await evaluate(`[...document.querySelectorAll('.pd-metrics strong')].map(el=>el.textContent)`),['1','1','1','1200'],'Existing metric definitions retained');
    assert.equal(await evaluate(`document.querySelectorAll('.pd-preview-control,.pd-preview').length`),0,'Production dashboard has no preview controls');
    await click('View request');assert.equal(await evaluate('window.dashboardAction.sheet.order.id'),'fixture-request','Request opens existing order sheet');
    await evaluate(`document.querySelector('.pd-work-item .pd-text-button').click()`);assert.equal(await evaluate('window.dashboardAction.sheet.order.id'),'fixture-active');
    await evaluate(`document.querySelector('.pd-actions .pd-primary').click()`);
    assert.deepEqual(await evaluate('window.dashboardAction'),role==='consultant'?{route:'orders'}:{sheet:'post'},'Primary action retains existing destination');
    if(role==='professional') {
      await evaluate(`document.querySelector('[role="switch"]').click()`);await pause(100);
      assert.equal(await evaluate('window.availabilityRequested'),true);assert.equal(await evaluate('window.onlineResult'),true,'Existing availability callback retained');
    }
    if(role==='influencer') assert.ok(await evaluate(`document.querySelector('.pd-dashboard').textContent.includes('Existing deliverable')`),'Existing deliverables displayed');
    console.log('PASS existing data and action callbacks: '+role);
  }
  assert.deepEqual(errors,[],'No browser exceptions or console errors');
  console.log('PASS carousel: async arrival, list shrink, role/trust filtering, six destinations, pause/play and swipe.');
  console.log('Screenshots: '+folder);
  await send('Browser.close');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{socket?.close();browser?.kill();server?.close();});
