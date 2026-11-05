// Re-encode reviewed catalogue PNG cutouts as lightweight 216px transparent WebP assets.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const input = path.resolve('.tmp/catalog-art-sources');
const output = path.resolve('public/assets/user-services');
let server;
let browser;
let socket;

(async () => {
  const files = fs.readdirSync(input).filter(file => file.endsWith('.png')).sort();
  assert.ok(files.length, 'No catalogue source PNGs found');
  server = http.createServer((request, response) => {
    if (request.url.startsWith('/source/')) {
      response.setHeader('Content-Type', 'image/png');
      response.end(fs.readFileSync(path.join(input, path.basename(request.url))));
      return;
    }
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Catalogue artwork compression</title>');
  });
  await new Promise(resolve => server.listen(5215, '127.0.0.1', resolve));

  const profile = path.resolve('.tmp', `catalog-compression-${Date.now()}`);
  fs.mkdirSync(profile, { recursive: true });
  browser = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', [
    '--headless=new', '--disable-gpu', '--disable-background-networking', '--no-first-run',
    '--remote-debugging-port=9355', `--user-data-dir=${profile}`, 'about:blank',
  ], { windowsHide: true, stdio: 'ignore' });

  let tab;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      tab = await (await fetch('http://127.0.0.1:9355/json/new?http://127.0.0.1:5215/', { method: 'PUT' })).json();
      break;
    } catch { await pause(200); }
  }
  assert.ok(tab, 'Could not start the image compression browser');
  socket = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  let id = 0;
  const pending = new Map();
  socket.addEventListener('message', ({ data }) => {
    const event = JSON.parse(data);
    if (!event.id) return;
    const request = pending.get(event.id);
    pending.delete(event.id);
    if (event.error) request.reject(event.error); else request.resolve(event.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  await send('Page.enable');

  const assets = [];
  for (const file of files) {
    const encoded = await evaluate(`(async()=>{
      const image=new Image();image.src='/source/${file}';await image.decode();
      const source=document.createElement('canvas');source.width=image.naturalWidth;source.height=image.naturalHeight;
      const context=source.getContext('2d');context.drawImage(image,0,0);
      const pixels=context.getImageData(0,0,source.width,source.height).data;
      let left=source.width,top=source.height,right=-1,bottom=-1,transparent=0;
      for(let y=0;y<source.height;y+=1)for(let x=0;x<source.width;x+=1){const alpha=pixels[(y*source.width+x)*4+3];if(alpha===0)transparent+=1;if(alpha>16){left=Math.min(left,x);top=Math.min(top,y);right=Math.max(right,x);bottom=Math.max(bottom,y);}}
      if(right<left||transparent<100)throw new Error('Missing transparent subject');
      const width=right-left+1,height=bottom-top+1,scale=204/Math.max(width,height);
      const target=document.createElement('canvas');target.width=216;target.height=216;
      target.getContext('2d').drawImage(source,left,top,width,height,(216-width*scale)/2,(216-height*scale)/2,width*scale,height*scale);
      return {url:target.toDataURL('image/webp',.88),transparent,width:target.width,height:target.height};
    })()`);
    assert.ok(encoded.url.startsWith('data:image/webp;base64,'));
    const bytes = Buffer.from(encoded.url.split(',')[1], 'base64');
    const name = file.replace('.png', '.webp');
    fs.writeFileSync(path.join(output, name), bytes);
    assets.push({ name, bytes: bytes.length, width: encoded.width, height: encoded.height, transparentSourcePixels: encoded.transparent });
  }
  const totalBytes = assets.reduce((total, asset) => total + asset.bytes, 0);
  fs.writeFileSync(path.resolve('docs/catalog-artwork-2026-09-20.json'), JSON.stringify({ totalBytes, assets }, null, 2));
  console.log(`${assets.length} catalogue WebPs: ${totalBytes} bytes (${(totalBytes / 1024).toFixed(1)} KiB)`);
  await send('Browser.close');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  socket?.close();
  browser?.kill();
  server?.close();
});
