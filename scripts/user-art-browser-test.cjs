/* Local, backend-free browser fixture using the actual UserApp. --before captures the original appearance. */
const { build } = require('esbuild');
const { createServer } = require('node:http');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { resolve, basename, dirname } = require('node:path');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const pause = ms => new Promise(r => setTimeout(r, ms));
const before = process.argv.includes('--before');
let server, browser, socket;
const assetRequests=new Set();
const heroRequests=new Set();
(async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'jsx', contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import UserApp from './src/pages/UserApp.jsx';
    import './src/styles.css';import './src/experience.css';import './src/partner.css';
    localStorage.setItem('eazily-language','English');
    window.addEventListener('eazily-sign-in',()=>window.signInRequested=true);
    createRoot(document.getElementById('root')).render(<div className="phone-shell"><UserApp account={{user:null,applications:[],roles:[]}} notify={message=>window.lastNotice=message} onWorkspace={()=>{}} onAddRole={()=>{}} /></div>);
  ` }, bundle: true, write: false, outdir: '.tmp/user-art-fixture', jsx: 'automatic', define: { 'import.meta.env.VITE_SUPABASE_URL': '""', 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': '""', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '""', 'import.meta.env.DEV': 'false' }, plugins: before ? [{name:'original-screens',setup(api){api.onLoad({filter:/(UserApp|UserHome|ServiceExperience)\.jsx$/},args=>({contents:readFileSync(resolve('.tmp/user-art-before',basename(args.path)),'utf8'),loader:'jsx',resolveDir:dirname(args.path)}));}}] : [] });
  server = createServer((req, res) => {
    const file = bundle.outputFiles.find(f => f.path.endsWith(req.url === '/fixture.css' ? '.css' : '.js'));
    if (req.url.startsWith('/fixture.')) { res.setHeader('Content-Type', req.url.endsWith('.css') ? 'text/css' : 'text/javascript'); return res.end(file.contents); }
    if (req.url.startsWith('/assets/')) { try { const pathname=new URL(req.url,'http://localhost').pathname;assetRequests.add(pathname);if(pathname.startsWith('/assets/user-carousel/'))heroRequests.add(pathname);res.setHeader('Content-Type',pathname.endsWith('.webp')?'image/webp':'image/png'); return res.end(readFileSync(resolve('public', '.' + pathname))); } catch { res.statusCode=404; return res.end(); } }
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
  });
  await new Promise(r => server.listen(5204, '127.0.0.1', r));
  const folder=resolve(before?'docs/user-illustrations/before':process.env.EAZILY_USER_ART_SHOTS || 'docs/user-illustrations/after');mkdirSync(folder,{recursive:true});
  const profile=resolve('.tmp','user-art-browser-'+Date.now());mkdirSync(profile,{recursive:true});
  browser=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=9364',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
  let tab;for(let i=0;i<40;i++){try{tab=await(await fetch('http://127.0.0.1:9364/json/new?http://127.0.0.1:5204/',{method:'PUT'})).json();break;}catch{await pause(250);}}
  assert.ok(tab,'Edge started');socket=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));
  let id=0;const pending=new Map(),errors=[];
  socket.addEventListener('message',({data})=>{const e=JSON.parse(data);if(e.id){const p=pending.get(e.id);pending.delete(e.id);e.error?p.reject(e.error):p.resolve(e.result);}if(e.method==='Runtime.exceptionThrown')errors.push(e.params.exceptionDetails.exception?.description||e.params.exceptionDetails.text);});
  const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description);return r.result.value;};
  const click=async(label,selector='button')=>{await evaluate(`(()=>{const b=[...document.querySelectorAll(${JSON.stringify(selector)})].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b)throw new Error('Missing '+${JSON.stringify(label)});b.click();})()`);await pause(120);};
  const capture=async(name,width)=>{
    await evaluate('window.scrollTo(0,0)');await pause(100);
    if(!before) {
      await evaluate(`Promise.all([...document.querySelectorAll('img.user-service-art')].map(img=>img.decode()))`);
      assert.ok(await evaluate(`[...document.querySelectorAll('img.user-service-art')].every(img=>img.complete&&img.naturalWidth>0&&getComputedStyle(img).objectFit==='contain')`),'Local artwork loads and preserves proportions');
    }
    writeFileSync(resolve(folder,`${name}-${width}.png`),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    if(!before){
      assert.ok(await evaluate('document.documentElement.scrollWidth<=innerWidth'),name+' no overflow at '+width);
      assert.ok(await evaluate(`[...document.querySelectorAll('.catalog-welcome')].every(e=>parseFloat(getComputedStyle(e).paddingLeft)>=16&&parseFloat(getComputedStyle(e).paddingRight)>=16)`),'Banner inset');
      assert.ok(await evaluate(`[...document.querySelectorAll('.main-category-card,.group-card,.service-option,.group-nav,.all-back,.mobile-current')].every(e=>e.scrollWidth<=e.clientWidth+1)`),name+' labels fit');
      assert.ok(await evaluate(`[...document.querySelectorAll('.group-card b,.service-option>span,.group-nav span')].every(e=>getComputedStyle(e).overflowWrap==='normal'&&getComputedStyle(e).wordBreak==='normal')`),'Wrap at spaces');
      assert.ok(await evaluate(`[...document.querySelectorAll('.user-service-art')].every(e=>e.getAttribute('aria-hidden')==='true')`),'Decorative art has no duplicate accessible name');
      assert.ok(await evaluate('(()=>{const content=document.querySelector(".catalog-content"),layout=document.querySelector(".catalog-layout");return !content||Math.abs(content.getBoundingClientRect().top-layout.getBoundingClientRect().top)<2})()'),'Main content stays top aligned without blank space');
      if(await evaluate('!!document.querySelector(".user-compact-services")')){
        assert.equal(await evaluate('getComputedStyle(document.querySelector(".service-option-grid")).gridTemplateColumns.split(" ").length'),2,'Two readable service columns on phones');
        assert.equal(await evaluate('getComputedStyle(document.querySelector(".service-option-grid")).columnGap'),'8px');
        assert.equal(await evaluate('document.querySelectorAll(".service-option small").length'),0,'No repetitive caption');
        assert.ok(await evaluate('[...document.querySelectorAll(".service-option > i")].every(e=>e.clientWidth===44&&e.clientHeight===37)'),'Original-proportion compact illustrations');
        assert.ok(await evaluate('[...document.querySelectorAll(".service-option>span")].every(e=>{const s=getComputedStyle(e);return parseFloat(s.fontSize)>=12&&parseFloat(s.fontSize)<=14&&e.scrollWidth<=e.clientWidth+1})'),'Readable whole-word labels');
        assert.ok(await evaluate('(()=>{const sidebar=document.querySelector(".catalog-side");if(!sidebar)return true;const side=sidebar.getBoundingClientRect(),grid=document.querySelector(".service-option-grid").getBoundingClientRect();return side.width>=76&&side.width<=88.5&&side.right<=grid.left&&sidebar.scrollWidth<=sidebar.clientWidth+1})()'),'Compact left sidebar without horizontal overflow');
        assert.ok(await evaluate('(()=>{const side=document.querySelector(".catalog-side")?.getBoundingClientRect(),active=document.querySelector(".group-nav.active")?.getBoundingClientRect();return !active||(active.top>=side.top-1&&active.bottom<=side.bottom+1)})()'),'Selected category stays visible vertically');
        assert.equal(await evaluate('getComputedStyle(document.querySelector(".service-option-grid")).animationName'),'none','Reduced motion respected');
      }
    }
  };
  await send('Runtime.enable');await send('Page.enable');
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
  for(const width of [360,390,430,900]){
    await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});
    await send('Page.navigate',{url:`http://127.0.0.1:5204/?viewport=${width}`});await pause(900);
    await evaluate('document.querySelector(".explore-grid").scrollIntoView({block:"center"})');await pause(100);
    writeFileSync(resolve(folder,`home-${width}.png`),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    if(!before){
      assert.equal(await evaluate('document.querySelectorAll(".explore-grid .user-service-art").length'),8);assert.equal(await evaluate('getComputedStyle(document.querySelector(".explore-grid")).gridTemplateColumns.split(" ").length'),4);
      const {homeHeroArtwork,firstHomeHeroArtwork}=await import('../src/features/home/homeHeroArtwork.js');
      if(width===360)assert.deepEqual([...heroRequests],[firstHomeHeroArtwork],'Only the first carousel image loads initially');
      assert.equal(await evaluate(`document.head.querySelectorAll('link[rel="preload"][as="image"][type="image/webp"]').length`),1,'Only one carousel image is preloaded');
      assert.equal(await evaluate(`new URL(document.head.querySelector('link[rel="preload"][as="image"]').href).pathname`),firstHomeHeroArtwork);
      for(const [index,slideId] of ['today','home-care','confidence','moving'].entries()){
        await evaluate(`document.querySelectorAll('.hero-dots button')[${index}].click()`);await pause(130);
        await evaluate(`document.querySelector('.hero-person img').decode()`);
        const heroLayout=await evaluate(`(()=>{const carousel=document.querySelector('.hero-carousel'),copy=document.querySelector('.hero-copy'),person=document.querySelector('.hero-person'),image=person.querySelector('img'),dots=document.querySelector('.hero-dots'),c=carousel.getBoundingClientRect(),t=copy.getBoundingClientRect(),p=person.getBoundingClientRect(),d=dots.getBoundingClientRect();return {src:new URL(image.currentSrc).pathname,natural:[image.naturalWidth,image.naturalHeight],loading:image.loading,priority:image.fetchPriority,copyFits:copy.scrollWidth<=copy.clientWidth&&copy.scrollHeight<=copy.clientHeight,personRight:p.left>=t.right-1,personInside:p.left>=c.left&&p.right<=c.right+1&&p.top>=c.top&&p.bottom<=c.bottom,indicatorClear:p.right<=d.left||p.left>=d.right||p.bottom<=d.top||p.top>=d.bottom,overflow:getComputedStyle(carousel).overflow,mask:getComputedStyle(image).maskImage}})()`);
        assert.equal(heroLayout.src,homeHeroArtwork[slideId]);assert.deepEqual(heroLayout.natural,[480,600]);assert.equal(heroLayout.loading,index===0?'eager':'lazy');assert.equal(heroLayout.priority,index===0?'high':'low');assert.ok(heroLayout.copyFits&&heroLayout.personRight&&heroLayout.personInside&&heroLayout.indicatorClear&&heroLayout.overflow==='hidden'&&heroLayout.mask!=='none','Balanced contained hero '+slideId+': '+JSON.stringify(heroLayout));
        writeFileSync(resolve(folder,`hero-${slideId}-${width}.png`),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
      }
      assert.deepEqual([...heroRequests].sort(),Object.values(homeHeroArtwork).sort(),'All four distinct carousel WebPs load after visiting the slides');
    }
    await evaluate('document.querySelector(".market-scroll").scrollIntoView({block:"center"})');await pause(100);
    writeFileSync(resolve(folder,`home-services-${width}.png`),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));
    if(!before){
      const homeCards=await evaluate(`(()=>{const grid=document.querySelector('.market-scroll'),cards=[...grid.querySelectorAll('.market-card')],images=cards.map(card=>card.querySelector('img')),g=grid.getBoundingClientRect();return {columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,inside:cards.every(card=>{const r=card.getBoundingClientRect();return r.left>=g.left-1&&r.right<=g.right+1}),images:images.map(image=>({fit:getComputedStyle(image).objectFit,position:getComputedStyle(image).objectPosition,inside:image.scrollWidth<=image.clientWidth+1&&image.scrollHeight<=image.clientHeight+1}))}})()`);
      assert.ok(homeCards.columns===2&&homeCards.inside&&homeCards.images.every(image=>image.fit==='contain'&&image.position==='50% 50%'&&image.inside),'Homepage cards are aligned, contained and fully visible: '+JSON.stringify(homeCards));
      if(width===900){const frame=await evaluate(`(()=>{const r=document.querySelector('.phone-shell').getBoundingClientRect();return {width:r.width,left:r.left,right:r.right}})()`);assert.ok(frame.width===430&&Math.abs(frame.left-(900-430)/2)<2,'Desktop uses centered 430px frame: '+JSON.stringify(frame));}
    }
    await evaluate('window.scrollTo(0,0)');
    await click('Explore');await capture('categories',width);
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".main-category-name")].map(e=>e.textContent)'),['Services','Loans','Influencers','Consultancy','Transportation','Blood Service']);
    if(!before) {
      const categoryGeometry=await evaluate(`(()=>{const cards=[...document.querySelectorAll('.main-category-card')];return cards.map(card=>{const frame=card.querySelector('.main-category-image'),image=frame.querySelector('img'),c=card.getBoundingClientRect(),f=frame.getBoundingClientRect(),i=image.getBoundingClientRect(),style=getComputedStyle(image);return {card:{width:c.width,height:c.height,scrollWidth:card.scrollWidth,clientWidth:card.clientWidth,scrollHeight:card.scrollHeight,clientHeight:card.clientHeight},frame:{width:f.width,height:f.height,clientHeight:frame.clientHeight,overflow:getComputedStyle(frame).overflow},image:{left:i.left,right:i.right,top:i.top,bottom:i.bottom,width:i.width,height:i.height,objectFit:style.objectFit,objectPosition:style.objectPosition},inside:i.left>=f.left&&i.right<=f.right&&i.top>=f.top&&i.bottom<=f.bottom,max:i.width<=f.width*.9+1&&i.height<=f.height*.9+1};})})()`);
      const heights=categoryGeometry.map(entry=>entry.card.height);
      assert.ok(categoryGeometry.length===6&&Math.max(...heights)-Math.min(...heights)<1&&categoryGeometry.every(entry=>entry.frame.clientHeight===84&&entry.frame.overflow==='hidden'&&entry.image.objectFit==='contain'&&entry.image.objectPosition==='50% 50%'&&entry.inside&&entry.max&&entry.card.scrollWidth<=entry.card.clientWidth&&entry.card.scrollHeight<=entry.card.clientHeight),'Six aligned category cards keep artwork inside the fixed image area: '+JSON.stringify(categoryGeometry));
    }
    if(!before) {
      for(const category of ['Influencers','Consultancy','Loans','Transportation','Blood Service']) {
        await click(category,'.main-category-name');await capture(category.toLowerCase().replaceAll(' ','-'),width);
        await click('All Categories','.crumb button');
      }
    }
    await evaluate('document.querySelector(".main-category-card").click()');await pause(100);await capture('groups',width);
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".group-card b")].map(e=>e.textContent)'),['Home & Property','Vehicle','Personal & Daily','Electronics','Personal Care','Wedding & Occasion','Pet Care','Other']);
    if(!before){
      assert.equal(await evaluate('document.querySelectorAll(".catalog-side").length'),0,'No duplicate sidebar on group selection');
      assert.equal(await evaluate('document.querySelectorAll(".catalog-header .eazily-name").length'),0,'No redundant text brand row');
      assert.equal(await evaluate('document.querySelectorAll("h1").length'),1,'One page heading');
      await evaluate('window.scrollTo(0,document.documentElement.scrollHeight)');await pause(80);
      assert.ok(await evaluate('document.querySelector(".group-card-grid").getBoundingClientRect().bottom<=document.querySelector(".bottom-nav").getBoundingClientRect().top'),'Group cards clear the bottom navigation');
      await evaluate('window.scrollTo(0,0)');
    }
    await click('Home & Property',before?'.group-nav span':'.group-card b');await capture('home-property',width);
    if(!before){
      await evaluate('window.scrollTo(0,200)');await pause(100);
      const sticky=await evaluate('(()=>{const side=document.querySelector(".catalog-side"),r=side.getBoundingClientRect();return {top:r.top,bottom:r.bottom,nav:document.querySelector(".bottom-nav").getBoundingClientRect().top,scroll:scrollY,parents:[...document.querySelectorAll(".phone-shell,.catalog-screen,.catalog-layout")].map(e=>({class:e.className,overflow:getComputedStyle(e).overflow,transform:getComputedStyle(e).transform}))}})()');
      assert.ok(sticky.top>=11&&sticky.top<=13&&sticky.bottom<=sticky.nav,'Sidebar remains available during page scroll: '+JSON.stringify(sticky));
      await evaluate('window.scrollTo(0,0)');
    }
    await click('Electrician','.service-option>span');assert.equal(await evaluate('new URL(location.href).searchParams.get("service")'),'Electrician');
    assert.equal(await evaluate('document.querySelectorAll("[role=dialog]").length'),0,'Service tap opens service listing');
    await capture('electrician',width);
    if(!before)await evaluate('history.back()');else await evaluate('document.querySelector("[aria-label="+JSON.stringify("Back to categories")+"]").click()');await pause(200);
    if(!before)assert.equal(await evaluate('document.querySelector(".group-nav.active").textContent'),'Home & Property','Browser Back restores selected group');
    await click('Vehicle','.group-nav span');await capture('vehicle',width);
    await click('Personal & Daily','.group-nav span');await capture('personal-daily',width);
    await click('Electronics','.group-nav span');await capture('electronics',width);
    await click('Personal Care','.group-nav span');await capture('personal-care',width);
    await click('Electronics','.group-nav span');
    if(!before){
      const missing=await evaluate('[...document.querySelectorAll(".service-option")].filter(e=>!e.querySelector(".user-service-art")).map(e=>e.textContent)');assert.deepEqual(missing,[]);
      await evaluate('window.scrollTo(0,document.documentElement.scrollHeight)');await pause(100);
      assert.ok(await evaluate('document.querySelector(".service-option-grid").getBoundingClientRect().bottom<=document.querySelector(".bottom-nav").getBoundingClientRect().top'),'Bottom navigation clearance');
      await click('Pet Care','.group-nav span');await capture('pet-care',width);
      await click('Services','.crumb button');
      assert.equal(await evaluate('document.querySelectorAll(".group-card").length'),8,'Breadcrumb returns to group selection without skipping hierarchy');
      assert.equal(await evaluate('document.querySelectorAll(".catalog-side").length'),0);
      await click('Electronics','.group-card b');
    }
    console.log('PASS user category order, navigation and '+(before?'before captures':'artwork/mobile layout')+' at '+width);
  }
  if(!before){
    const {catalog}=await import('../src/data/catalog.js');
    const {topServices}=await import('../src/data/userExperience.js');
    const {artworkFor,assetById}=await import('../src/features/user-art/artwork.js');
    await click('All Categories','.crumb button');
    for(const category of catalog){
      await click(category.label,'.main-category-name');
      const groups=category.groups||[{items:category.items}];
      for(const group of groups){
        if(group.label)await click(group.label,await evaluate('!!document.querySelector(".catalog-side")')?'.group-nav span':'.group-card b');
        assert.deepEqual(await evaluate('[...document.querySelectorAll(".service-option>span")].map(e=>e.textContent)'),group.items,'Original service list for '+(group.label||category.label));
        assert.deepEqual(await evaluate('[...document.querySelectorAll(".service-option .user-service-art")].map(e=>e.dataset.artwork)'),group.items.map(name=>artworkFor(name).join(':')),'Correct artwork per service');
        await evaluate(`Promise.all([...document.querySelectorAll('img.user-service-art')].map(img=>img.decode()))`);
        assert.ok(await evaluate(`[...document.querySelectorAll('img.user-service-art')].every(img=>img.naturalWidth>0)`),'Every catalogue image loads');
        assert.ok(await evaluate('[...document.querySelectorAll(".service-option,.group-nav,.mobile-current")].every(e=>e.scrollWidth<=e.clientWidth+1)'),'All catalogue labels fit');
      }
      await click('All Categories','.crumb button');
    }
    await click('Home');await click('Plumber','.explore-grid b');
    assert.equal(await evaluate('new URL(location.href).searchParams.get("service")'),'Plumber');
    assert.deepEqual(await evaluate('[...document.querySelectorAll(".related-card b")].map(e=>e.textContent)'),['Tap repair','Leakage repair','Basin installation','Drain cleaning']);
    await click('Tap repair','.related-card b');assert.equal(await evaluate('new URL(location.href).searchParams.get("service")'),'Plumber','Related service preserves original canonical booking destination');
    await evaluate('document.querySelector("[aria-label="+JSON.stringify("Back to categories")+"]").click()');await pause(150);
    await click('Home');await click('Packers & Movers','.explore-grid b');
    assert.equal(await evaluate('document.querySelectorAll("[role=dialog]").length'),1,'Moving still opens its original request sheet');
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});
    await send('Page.navigate',{url:'http://127.0.0.1:5204/?service=Plumber&category=manpower'});await pause(700);
    assert.equal(await evaluate('document.querySelector("h1").textContent'),'Plumber','Existing direct service link works');
    await evaluate('document.querySelector("[aria-label="+JSON.stringify("Back to categories")+"]").click()');await pause(150);
    assert.ok(await evaluate('!!document.querySelector(".main-category-grid")'),'Direct-link back destination preserved');
    console.log('PASS all six categories, every service group/list/art mapping, related Plumber routing and original moving request destination');
    await click('Services','.main-category-name');await click('Home & Property','.group-card b');
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});
    await click('Electronics','.group-nav span');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".service-option-grid")).animationDuration'),'0.18s','Gentle 180ms content transition');
    assert.equal(await evaluate('getComputedStyle(document.querySelector(".group-nav")).transitionDuration'),'0.16s, 0.16s');
    await evaluate(`(()=>{const input=document.querySelector('.catalog-header input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Plumber');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);await pause(120);
    await click('Plumber','.search-results b');
    assert.equal(await evaluate('new URL(location.href).searchParams.get("service")'),'Plumber','Search retains original service routing after header compaction');
    const visibleNames=[...catalog.flatMap(category=>[category.label,...(category.items||[]),...(category.groups||[]).flatMap(group=>[group.label,...group.items])]),...topServices.map(service=>service.requestName),'Tap repair','Leakage repair','Basin installation','Drain cleaning'];
    const visibleAssets=[...new Set(visibleNames.map(name=>assetById[artworkFor(name)[0]]))];
    assert.deepEqual(visibleAssets.filter(path=>!assetRequests.has(path)),[],'Every user-facing mapped WebP was requested by the running browser');
    assert.ok(await evaluate(`[...document.querySelectorAll('.user-service-art')].every(img=>img.tagName==='IMG'&&img.currentSrc.endsWith('.webp')&&img.complete&&img.naturalWidth===216&&img.naturalHeight===216)`),'Rendered user artwork is decoded 216px WebP, never SVG fallback');
    await send('Page.navigate',{url:'http://127.0.0.1:5204/'});await pause(700);
    const initialSlide=await evaluate(`[...document.querySelectorAll('.hero-dots button')].findIndex(button=>button.classList.contains('active'))`);
    await pause(4700);
    assert.notEqual(await evaluate(`[...document.querySelectorAll('.hero-dots button')].findIndex(button=>button.classList.contains('active'))`),initialSlide,'Carousel still advances automatically');
  }
  assert.deepEqual(errors,[],'No runtime exceptions');console.log('Screenshots: '+folder);await send('Browser.close');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{socket?.close();browser?.kill();server?.close();});
