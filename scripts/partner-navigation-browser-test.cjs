/* Requires the local Vite dev server. Uses only isolated session fixtures. */
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { resolve } = require('node:path');
const { mkdirSync } = require('node:fs');
const pause = milliseconds => new Promise(resolvePause => setTimeout(resolvePause, milliseconds));
let browser, socket;

(async () => {
  assert.equal((await fetch('http://127.0.0.1:5173/')).status, 200, 'Start the local Vite server first');
  const { routeAccess } = await import('../src/auth/policy.js');
  const profile = resolve('.tmp', `partner-navigation-${Date.now()}`); mkdirSync(profile, { recursive: true });
  browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', ['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=9365',`--user-data-dir=${profile}`,'about:blank'], { windowsHide:true, stdio:'ignore' });
  let tab;
  for (let attempt=0; attempt<40; attempt+=1) { try { tab=await(await fetch('http://127.0.0.1:9365/json/new?http://127.0.0.1:5173/',{method:'PUT'})).json(); break; } catch { await pause(250); } }
  assert.ok(tab, 'Edge started'); socket=new WebSocket(tab.webSocketDebuggerUrl); await new Promise(resolveOpen=>socket.addEventListener('open',resolveOpen,{once:true}));
  let id=0; const pending=new Map(), errors=[];
  socket.addEventListener('message',({data})=>{const message=JSON.parse(data);if(message.id){const request=pending.get(message.id);pending.delete(message.id);message.error?request.reject(message.error):request.resolve(message.result);}if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);});
  const send=(method,params={})=>new Promise((resolveSend,reject)=>{pending.set(++id,{resolve:resolveSend,reject});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
  const waitFor=async expression=>{for(let attempt=0;attempt<50;attempt+=1){if(await evaluate(`Boolean(${expression})`))return;await pause(100);}throw new Error('Timed out: '+expression+'\n'+await evaluate('document.body.innerText'));};
  const click=async label=>{await evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(item=>item.textContent.trim()===${JSON.stringify(label)});if(!button)throw new Error('Missing ${label}');button.click();})()`);await pause(160);};
  await send('Runtime.enable'); await send('Page.enable');
  await send('Page.navigate',{url:'http://127.0.0.1:5173/scripts/partner-navigation-fixture.html'});await waitFor('window.renderRole');
  for(const role of ['professional','influencer','consultant']){
    const policyAccount={user:{id:`navigation-${role}`},profile:{id:`navigation-${role}`,full_name:'Pending Partner',account_status:'active'},roles:[role],applications:[{id:`application-${role}`,role,status:'submitted'}],assessments:{},staff:null,isAdmin:false};
    assert.equal(routeAccess(policyAccount,role),'allowed');
    for(const other of ['professional','influencer','consultant'].filter(item=>item!==role))assert.equal(routeAccess(policyAccount,other),'registration',role+' cannot open '+other+' directly');
    await evaluate(`window.renderRole(${JSON.stringify(role)})`);
    await waitFor(`document.querySelector('.partner-workspace.role-${role}')`);
    assert.ok(await evaluate(`document.body.textContent.includes('Verification pending')`),role+' shows pending status inside its dashboard');
    assert.equal(await evaluate(`document.querySelectorAll('.bottom-nav button').length`),2,role+' pending workspace exposes only safe routes');
    for(const width of [360,390,430]){
      await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});await pause(100);
      assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),role+' fits '+width+'px');
    }
    await click('Profile'); await waitFor(`document.querySelector('.partner-profile-page')`);
    await evaluate('history.back()'); await waitFor(`document.querySelector('.pd-dashboard')`);
    await click('Profile'); await waitFor(`document.querySelector('.partner-profile-page')`);
    const handled=await evaluate(`(()=>{const detail={handled:false};window.dispatchEvent(new CustomEvent('eazily-in-app-back',{detail}));return detail.handled;})()`);
    assert.equal(handled,true,role+' handles the native in-app back event'); await waitFor(`document.querySelector('.pd-dashboard')`);

    await evaluate(`document.documentElement.style.setProperty('--safe-area-inset-top','32px');document.documentElement.style.setProperty('--safe-area-inset-bottom','24px')`);await pause(100);
    assert.equal(await evaluate(`Math.round(document.querySelector('.phone-shell').getBoundingClientRect().top)`),0);
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.phone-shell')).paddingTop`),'32px',role+' consumes Android top inset');
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.bottom-nav')).paddingBottom`),'31px',role+' consumes Android gesture inset');

    console.log('PASS '+role+': browser Back, native-event Back, safe insets, 360/390/430, pending lock, and role isolation');
  }
  assert.deepEqual(errors,[],'No browser exceptions');
  await send('Browser.close');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{socket?.close();browser?.kill();});
