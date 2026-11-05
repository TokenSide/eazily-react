import { readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { loadEnv } from 'vite';
const PRIVILEGED=/(SERVICE_ROLE|SECRET|PASSWORD|ACCESS_TOKEN|PRIVATE_KEY)/;
// Only these explicit targets may bundle a real backend client. Anything else,
// including a build with no target declared, stays a credential-free local sample.
const NON_PRODUCTION_TARGETS=new Set(['staging','development','local']);
// A sample build must not merely avoid calling the backend, it must not contain the
// client at all. src/lib/supabase.js imports @supabase/supabase-js statically, so a
// tree-shake cannot remove it; sample builds resolve that module to this stub instead.
const SAMPLE_STUB=resolve('src/lib/supabase.sample.js');
// Matches every import spelling of the real module, including the sibling form
// './supabase.js' used by src/lib/realtime.jsx. supabase.sample.js cannot match.
const SUPABASE_ENTRY=/(^|[/\\])supabase\.js$/;
const privilegedJwt=code=>(code.match(/eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+/g)||[]).some(jwt=>{try{return JSON.parse(Buffer.from(jwt.split('.')[1],'base64url')).role!=='anon';}catch{return false;}});
export function buildPolicy(){
  let output, secretValues=[], connected=false;
  return {
    name:'eazily-production-safety',apply:'build',enforce:'pre',
    // Runs before module resolution, which is why the target is resolved here.
    config(config){
      const mode=config.mode||'production';
      const target=String(process.env.EAZILY_TARGET_ENV||loadEnv(mode,config.envDir||process.cwd(),'').EAZILY_TARGET_ENV||'').trim().toLowerCase();
      connected=NON_PRODUCTION_TARGETS.has(target);
      if(!connected&&(target||mode==='staging'))throw new Error('A connected build requires an explicit non-production EAZILY_TARGET_ENV ('+[...NON_PRODUCTION_TARGETS].join(', ')+'). Refusing "'+(target||mode)+'": production and undeclared builds stay credential-free local samples.');
    },
    resolveId(source){
      if(!connected&&SUPABASE_ENTRY.test(source))return SAMPLE_STUB;
      return null;
    },
    configResolved(config){output=config.build.outDir;
      const allEnv={...loadEnv(config.mode,config.envDir||process.cwd(),''),...process.env};
      // Values of server-only secrets (never VITE_) must not appear anywhere in the output.
      secretValues=Object.entries(allEnv).filter(([name,value])=>PRIVILEGED.test(name)&&typeof value==='string'&&value.length>=12).map(([,value])=>value);
      for(const [name,value] of Object.entries({...config.env,...process.env})){
        if(name.startsWith('VITE_')&&/(AUTH_BYPASS|MOCK_AUTH|TEST_AUTH)/.test(name)&&value==='true')throw new Error('Authentication bypass flags are prohibited in application builds.');
        if(name.startsWith('VITE_')&&/(SERVICE_ROLE|SECRET|PASSWORD|ACCESS_TOKEN)/.test(name)&&value)throw new Error('Privileged Vite configuration is prohibited.');
      }
    },
    generateBundle(_options,bundle){
      const modules=Object.values(bundle).flatMap(asset=>Object.keys(asset.modules||{}));
      const forbidden=modules.filter(id=>{
        const path=id.replaceAll('\\','/');
return /scripts\/|data\/demo\.js|auth\/developmentOtp\.js/.test(path)||(!connected&&/node_modules\/@supabase\//.test(path));
      });
      if(forbidden.length)throw new Error('Unsafe test modules leaked into the local sample build: '+forbidden.map(id=>id.split('/').at(-1)).join(', '));
      for(const file of Object.values(bundle))if(file.type==='chunk'&&/Testing OTP|Local development login|OTP 0000|development-session-only|dev-otp-user|eazily-testing-account|AUTH_FIXTURE_ONLY/.test(file.code))throw new Error('Runtime authentication bypass found in production output.');
      for(const file of Object.values(bundle)){
        const text=file.type==='chunk'?file.code:typeof file.source==='string'?file.source:Buffer.from(file.source||'').toString('latin1');
        if(/sb_secret_[\w-]{16,}/.test(text)||privilegedJwt(text)||secretValues.some(value=>text.includes(value)))throw new Error('Privileged credential found in build output: '+file.fileName);
        if(!connected&&/supabase\/storage\/v1|\.supabase\.co|@supabase\/supabase-js/.test(text))throw new Error('Remote backend endpoint found in a local-only build: '+file.fileName);
      }
    },
    writeBundle(){
      // Only compressed application artwork is packaged. Preserve legacy sources
      // in public/ for users, but do not ship unused PNG logos or documentation.
      for(const folder of ['user-services','user-carousel']){
        const source=resolve('public/assets',folder);
        for(const name of readdirSync(source)){
          if(!/\.(webp|avif|svg)$/.test(name))continue;
          const target=resolve(output,'assets',folder,name);mkdirSync(dirname(target),{recursive:true});copyFileSync(resolve(source,name),target);
        }
      }
      const launchLogo=resolve('public/assets/eazily-launch-logo.png');
      const launchTarget=resolve(output,'assets/eazily-launch-logo.png');
      mkdirSync(dirname(launchTarget),{recursive:true});copyFileSync(launchLogo,launchTarget);
      const brandLogo=resolve('public/assets/eazily-partner-logo.png');
      copyFileSync(brandLogo,resolve(output,'assets/eazily-partner-logo.png'));
      {
        const sampleFolder=resolve('public/assets/demo/professional');
        for(const name of readdirSync(sampleFolder)){
          if(!/\.(webp|jpg|jpeg|png)$/.test(name))continue;
          const target=resolve(output,'assets/demo/professional',name);
          mkdirSync(dirname(target),{recursive:true});copyFileSync(resolve(sampleFolder,name),target);
        }
      }
    }
  };
}
