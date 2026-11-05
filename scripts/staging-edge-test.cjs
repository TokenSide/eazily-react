// Exercises the real handlers' disabled branch in Node, not the hosted Deno runtime.
const { readFileSync, readdirSync }=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
(async()=>{
  for(const name of readdirSync('supabase/functions',{withFileTypes:true}).filter(d=>d.isDirectory()&&d.name!=='automation-worker').map(d=>d.name)) {
    const source=readFileSync(`supabase/functions/${name}/index.ts`,'utf8');
    const branch=source.match(/Deno\.serve\(async (?:req|request) => \{\s*(if \(Deno\.env\.get\('EAZILY_FINANCIAL_PROVIDERS_ENABLED'\)[^\n]+)/);
    assert.ok(branch,`${name}: guard must be first, before DB/provider/body access`);
    for(const value of [undefined,'','false','TRUE','1']) {
      const handler=vm.runInNewContext(`(async()=>{${branch[1]} throw new Error('Guard bypassed');})`,{Deno:{env:{get:()=>value}},Response});
      assert.equal((await handler()).status,503);
    }
  }
  console.log('PASS: five financial Edge handlers fail closed before any side effect (local guard test, not Deno deployment).');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
