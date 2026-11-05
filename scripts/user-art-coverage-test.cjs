const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { createHash } = require('node:crypto');
const { build } = require('esbuild');
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const Module = require('node:module');
(async()=>{
  const { catalog } = await import('../src/data/catalog.js');
  const { topServices } = await import('../src/data/userExperience.js');
  const { artwork, artworkFor, assetById } = await import('../src/features/user-art/artwork.js');
  const names = [...new Set([...catalog.flatMap(c=>[c.label,...(c.items||[]),...(c.groups||[]).flatMap(g=>[g.label,...g.items])]),...topServices.map(s=>s.requestName), 'Tap repair','Leakage repair','Basin installation','Drain cleaning'])];
  for(const name of names)assert.ok(Object.hasOwn(artwork,name),'Explicit artwork for '+name);
  for(const [a,b] of [['AC Repair','AC Service'],['Beauty & Salon','Salon at Home'],['Electrician','Electrician Visit'],['Painter','Painting Service']])assert.deepEqual(artworkFor(a),artworkFor(b));
  assert.notDeepEqual(artworkFor('Home Cleaning'),artworkFor('Deep Cleaning'),'Dedicated extraction machine');
  for(const category of catalog.filter(c=>['consultancy','influencers'].includes(c.id)))assert.equal(new Set(category.items.map(name=>artworkFor(name)[0])).size,category.items.length,'Distinct assets for '+category.label);
  const files=readdirSync('public/assets/user-services').filter(name=>/\.(webp|svg)$/.test(name));
  for(const url of Object.values(assetById))assert.ok(files.includes(url.split('/').at(-1)),'Referenced local artwork exists: '+url);
  let bytes=0;const hashes=new Set();
  for(const [id,url] of Object.entries(assetById)){
    const asset=readFileSync('public'+url);bytes+=asset.length;
    if(url.endsWith('.webp')){
      assert.equal(asset.subarray(0,4).toString(),'RIFF');assert.equal(asset.subarray(8,12).toString(),'WEBP');assert.ok(asset.includes(Buffer.from('ALPH')),'Transparent WebP '+id);
    } else {
      assert.match(asset.toString(),/^<svg\b/);assert.doesNotMatch(asset.toString(),/<image\b|\bhref=/i,'Self-contained SVG '+id);
    }
    assert.ok(asset.length<150000,'Small asset '+id);
    const hash=createHash('sha256').update(asset).digest('hex');assert.ok(!hashes.has(hash),'No duplicated file '+id);hashes.add(hash);
  }
  const bundle=await build({entryPoints:['src/features/user-art/ServiceIllustration.jsx'],bundle:true,write:false,format:'cjs',jsx:'automatic',loader:{'.css':'empty'},external:['react','react/jsx-runtime']});
  const mod=new Module('user-art-fixture',module);mod.paths=module.paths;mod._compile(bundle.outputFiles[0].text,__filename);
  names.forEach(name=>{
    const img=renderToStaticMarkup(createElement(mod.exports.default,{name}));
    assert.match(img,/aria-hidden="true"/);assert.match(img,/<img /);assert.match(img,/alt=""/);assert.doesNotMatch(img,/<svg|https?:/);
  });
  assert.ok(bytes < 5 * 1024 * 1024,'Total artwork stays below 5 MiB');
  console.log(`PASS ${names.length} mappings, ${Object.keys(assetById).length} distinct local referenced images, ${bytes} bytes (${(bytes/1048576).toFixed(2)} MiB).`);
})().catch(e=>{console.error(e);process.exitCode=1;});
