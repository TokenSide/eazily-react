// Deliberately read-only and offline: never connects, links, migrates or deploys.
// A successful local check is NOT authorization or remote readiness.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const manifest = require('../supabase/migration-manifest.json');
const checks=[];
const record=(name,ok,detail)=>checks.push({name,status:ok?'PASS':'BLOCKED',detail});
const env={};
for(const file of ['.env','.env.local','.env.staging','.env.staging.local']) {
  if(!fs.existsSync(file))continue;
  for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)) {
    const match=line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if(match)env[match[1]]=match[2].replace(/^["']|["']$/g,'');
  }
}
Object.assign(env,process.env);
const required=['EAZILY_TARGET_ENV','SUPABASE_PROJECT_REF','SUPABASE_ACCESS_TOKEN','SUPABASE_DB_PASSWORD','VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY'];
for(const name of required)record(name,Boolean(env[name])&&!/YOUR_|REPLACE_|<|>/.test(env[name]),env[name]?'present (value hidden)':'missing');
let urlRef=null;
try {const u=new URL(env.VITE_SUPABASE_URL);if(u.protocol==='https:'&&/^[a-z0-9]{20}\.supabase\.co$/.test(u.hostname))urlRef=u.hostname.split('.')[0];} catch { /* No URLs in logs. */ }
const linkFile='supabase/.temp/project-ref';
const linked=fs.existsSync(linkFile)?fs.readFileSync(linkFile,'utf8').trim():null;
const validRef=v=>/^[a-z0-9]{20}$/.test(v||'');
const detected=validRef(linked)?linked:validRef(env.SUPABASE_PROJECT_REF)?env.SUPABASE_PROJECT_REF:urlRef;
record('Project reference',Boolean(detected),detected||'none detected');
record('Linked identity matches explicit target and browser URL',validRef(linked)&&linked===env.SUPABASE_PROJECT_REF&&linked===urlRef,linked?'compare all three references':'not linked');
record('Explicit environment label',['staging','development'].includes(env.EAZILY_TARGET_ENV),'staging/development label required; label alone is not proof');
for(const executable of ['supabase','psql','pg_dump','pg_restore','docker']) {
  const result=spawnSync(executable,['--version'],{encoding:'utf8',windowsHide:true});
  const version=(result.stdout||'').match(/\d+\.\d+(?:\.\d+)?/);
  record(executable,result.status===0,result.status===0?`available ${version?.[0]||'(version not parsed)'}`:'unavailable; no installation attempted');
}
record('No privileged Vite variables',!Object.keys(env).some(k=>/^VITE_.*(SERVICE_ROLE|SECRET|PASSWORD|ACCESS_TOKEN|PRIVATE_KEY)/.test(k)),'only public Supabase URL/key may enter the bundle');
let publicKey=false;
try { const key=env.VITE_SUPABASE_ANON_KEY||'';publicKey=key.startsWith('sb_publishable_')||JSON.parse(Buffer.from(key.split('.')[1]||'','base64url').toString()).role==='anon'; } catch { /* Never echo key or parser errors. */ }
record('Browser credential is public',publicKey,'requires publishable key or anon-role JWT; service-role and secret keys rejected');
for(const name of ['VITE_PARTNER_DEMO','VITE_ENABLE_CONSULTANT_ASSESSMENT_TEST_SKIP','VITE_ENABLE_SERVICE_REGISTRATION_TEST_SKIP','EAZILY_FINANCIAL_PROVIDERS_ENABLED'])record(`${name} disabled`,env[name]==='false','must explicitly be false for staging');
const filenames=manifest.migrations.map(m=>m.file);
record('Canonical SQL inventory',new Set(filenames).size===filenames.length&&fs.readdirSync('supabase').filter(f=>f.endsWith('.sql')).every(f=>filenames.includes(f)),'one manually ordered path; no duplicate migration copies');
record('No parallel timestamped path',!fs.existsSync('supabase/migrations')||fs.readdirSync('supabase/migrations').length===0,'do not use db push for manually ordered files');
const migrations=manifest.migrations.map(m=>({sequence:m.sequence,file:m.file,sha256:createHash('sha256').update(fs.readFileSync(path.join('supabase',m.file))).digest('hex'),status:'blocked'}));
record('Manifest checksums',migrations.every((m,i)=>m.sha256===manifest.migrations[i].sha256),'local file hashes must match reviewed manifest; this is not remote migration history');
for(const name of ['Dashboard project identity and non-production ownership evidence','Explicit user confirmation of detected reference','Remote permissions and managed Auth/Storage roles','Remote migration history and populated-database reconciliation','Schema drift comparison and row-impact review','pgcrypto extension and controlled schema privileges','Auth configuration and real fixture identities','Private buckets, Storage policies and signed URLs','Edge secrets and JWT configuration','Realtime publication membership','Disabled remote automation/billing/provider switches','Timestamped backup, checksums and successful isolated restore'])record(name,false,'not remotely verified; follow docs/staging/RUNBOOK.md');
const report={mode:'offline only',detectedProjectReference:detected,remoteContacted:false,readyToDeploy:false,checks,migrations};
fs.mkdirSync('.tmp',{recursive:true});fs.writeFileSync('.tmp/staging-preflight.json',JSON.stringify(report,null,2)+'\n');
for(const c of checks)console.log(`${c.status}: ${c.name} — ${c.detail}`);
console.log('BLOCKED: This offline preflight never authorizes deployment. No remote connection or change was made.');
process.exitCode=1;
