const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const root=path.resolve('dist'),files=[];
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())walk(file);else files.push({path:path.relative(root,file).replaceAll('\\','/'),bytes:fs.statSync(file).size,...(file.endsWith('.js')?{gzip:zlib.gzipSync(fs.readFileSync(file)).length}:{})});}}
walk(root);
const javascript=files.filter(f=>f.path.endsWith('.js')).sort((a,b)=>b.bytes-a.bytes);
const report={totalBytes:files.reduce((n,f)=>n+f.bytes,0),fileCount:files.length,javascriptBytes:javascript.reduce((n,f)=>n+f.bytes,0),javascript,largestAssets:files.filter(f=>!f.path.endsWith('.js')).sort((a,b)=>b.bytes-a.bytes).slice(0,15),android:{implemented:false,signedAabBytes:null,universalApkBytes:null,playDownloadBytes:null,maximumBytesWithoutApproval:90000000,plannedRangeMB:[50,90]}};
fs.mkdirSync('.tmp',{recursive:true});fs.writeFileSync('.tmp/bundle-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
// build-policy.mjs writeBundle ships the two brand logos (eager in index.html) and the
// demo professional portraits on purpose. Every other raster asset must arrive
// precompressed, and source maps are never acceptable in production output.
const sanctionedMedia=/^assets\/(eazily-launch-logo\.png|eazily-partner-logo\.png|demo\/professional\/[\w.-]+\.(png|jpg|jpeg|webp|avif))$/;
const unexpectedMedia=files.filter(f=>/\.map$|\.(mp4|mov)$/.test(f.path)||(/\.(png|jpg|jpeg)$/.test(f.path)&&!sanctionedMedia.test(f.path)));
if(unexpectedMedia.length)throw new Error('Unexpected source maps or uncompressed/media assets in production output: '+unexpectedMedia.map(f=>f.path).join(', '));
if(javascript.some(f=>f.bytes>500000))throw new Error('JavaScript chunk exceeds 500 kB review budget');
if(report.totalBytes>90000000)throw new Error('Web payload exceeds Android maximum before packaging overhead');
