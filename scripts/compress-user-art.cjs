// Compress the completed draft assets only. Does not integrate an incomplete set into the app.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process');
const assert=require('node:assert/strict');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
let server,browser,socket;
(async()=>{
 const input=path.resolve('.tmp/realistic-art-optimized'),output=path.resolve('docs/realistic-artwork/staged');fs.mkdirSync(output,{recursive:true});
 const files=fs.readdirSync(input).filter(f=>f.endsWith('.png'));
 server=http.createServer((req,res)=>{if(req.url.startsWith('/source/')){const file=path.basename(req.url);res.setHeader('Content-Type','image/png');return res.end(fs.readFileSync(path.join(input,file)));}res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Draft asset review</title><body></body>');});
 await new Promise(r=>server.listen(5214,'127.0.0.1',r));
 const profile=path.resolve('.tmp','art-compression-'+Date.now());fs.mkdirSync(profile,{recursive:true});
 browser=spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--disable-gpu','--disable-background-networking','--no-first-run','--remote-debugging-port=9354',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
 let tab;for(let i=0;i<50;i++){try{tab=await(await fetch('http://127.0.0.1:9354/json/new?http://127.0.0.1:5214/',{method:'PUT'})).json();break;}catch{await pause(200);}}
 assert.ok(tab);socket=new WebSocket(tab.webSocketDebuggerUrl);await new Promise(r=>socket.addEventListener('open',r,{once:true}));
 let id=0;const pending=new Map();socket.addEventListener('message',({data})=>{const e=JSON.parse(data);if(e.id){const p=pending.get(e.id);pending.delete(e.id);e.error?p.reject(e.error):p.resolve(e.result);}});
 const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;};
 await send('Page.enable');await pause(500);
 const results=[];
 for(const file of files){
   const encoded=await evaluate(`(async()=>{const img=new Image();img.src='/source/${file}';await img.decode();const canvas=document.createElement('canvas');canvas.width=216;canvas.height=216;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,216,216);const pixels=ctx.getImageData(0,0,216,216).data;let transparent=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]===0)transparent++;return {url:canvas.toDataURL('image/webp',.86),transparent};})()`);
   assert.ok(encoded.transparent>100,'Genuine alpha '+file);assert.ok(encoded.url.startsWith('data:image/webp;base64,'));
   const bytes=Buffer.from(encoded.url.split(',')[1],'base64'),name=file.replace('.png','.webp');fs.writeFileSync(path.join(output,name),bytes);
   results.push({id:path.basename(file,'.png'),file:name,bytes:bytes.length,width:216,height:216,transparentPixels:encoded.transparent});
 }
 const total=results.reduce((sum,r)=>sum+r.bytes,0);assert.ok(total<5*1024*1024);
 fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify({status:'Complete optimized source set; installed under public/assets/user-services',quality:.86,totalBytes:total,assets:results},null,2));
 const cards=results.map(r=>`<article><div><img src="${r.file}"><img src="${r.file}"><img class="sidebar" src="${r.file}"></div><b>${r.id}</b><small>${(r.bytes/1024).toFixed(1)} KB</small></article>`).join('');
 const style='<style>body{font:13px system-ui;background:#faf8ff;color:#302340;margin:16px}h1{font-size:20px}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}article{background:white;padding:10px 4px;border:1px solid #e6dff0;border-radius:12px;text-align:center}article div{display:flex;flex-wrap:wrap;justify-content:center;gap:2px}img{width:48px;height:48px;object-fit:contain}img+img{background:#f1e8ff}.sidebar{width:32px;height:32px}b,small{display:block;overflow-wrap:anywhere;margin-top:5px}small{color:#70657b}</style>';
 const html='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+style+'<h1>Realistic artwork preview</h1><p>Final local WebP assets on white / purple backgrounds at 48px; sidebar at 32px.</p><main>'+cards+'</main>';
 fs.writeFileSync(path.join(output,'index.html'),html);
 let inline=html;for(const r of results)inline=inline.replaceAll('src="'+r.file+'"','src="data:image/webp;base64,'+fs.readFileSync(path.join(output,r.file)).toString('base64')+'"');
 await evaluate('document.open();document.write('+JSON.stringify(inline)+');document.close()');await evaluate('Promise.all([...document.images].map(img=>img.decode()))');
 for(const width of [360,390,430]){await send('Emulation.setDeviceMetricsOverride',{width,height:844,deviceScaleFactor:1,mobile:true});await pause(100);fs.writeFileSync(path.join(output,`preview-${width}.png`),Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'));}
 console.log(`${results.length} WebP assets: ${total} bytes (${(total/1024).toFixed(1)} KiB), range ${Math.min(...results.map(r=>r.bytes))}–${Math.max(...results.map(r=>r.bytes))} bytes. ${output}`);
 await send('Browser.close');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>{socket?.close();browser?.kill();server?.close();});
