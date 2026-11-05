// Local PostgreSQL only. No network client, URL, token or remote database is used.
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const manifest = require('../supabase/migration-manifest.json');

(async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key,phone text,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select current_user::text$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,metadata jsonb,created_at timestamptz default now());
      create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
      alter table storage.objects enable row level security;
      grant usage on schema auth,public,storage to anon,authenticated,service_role;
      grant all on storage.buckets,storage.objects to authenticated,service_role;
      alter default privileges in schema public grant all on tables to authenticated,anon;
      alter default privileges in schema public grant all on sequences to authenticated,anon;`);
    // Hosted Supabase ships this reviewed definer helper before any app migration runs.
    const RLS_AUTO_ENABLE_SHA = '2782e98b348aca7d6f6f73c420fd78d2e094957dd7a52b0483d4c34f29d2a7a1';
    const rlsAutoEnable = readFileSync('scripts/fixtures/supabase-rls-auto-enable.sql', 'utf8');
    await db.exec(rlsAutoEnable);
    const platformHelper = async () => (await db.query(`select encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') as sha,p.proconfig as config,
      pg_get_userbyid(p.proowner) as owner,p.prosecdef as definer from pg_proc p where p.oid='public.rls_auto_enable()'::regprocedure`)).rows[0];
    assert.equal((await platformHelper()).sha, RLS_AUTO_ENABLE_SHA, 'Fixture reproduces the reviewed hosted helper exactly');
    const applied = new Set();
    for (const entry of manifest.migrations) {
      assert.equal(entry.sequence, applied.size + 1, 'Manifest sequence must be contiguous');
      for (const dependency of entry.requiredPredecessors) assert.ok(applied.has(dependency), `${entry.file} requires ${dependency} first`);
      const sql = readFileSync(`supabase/${entry.file}`, 'utf8');
      assert.equal(createHash('sha256').update(sql).digest('hex'), entry.sha256, `${entry.file} checksum`);
      if (entry.file === 'staging_prelaunch_foundations.sql') {
        // Simulate projects without optional automatic table grants.
        await db.exec('revoke select on public.profiles, public.categories from anon, authenticated');
      }
      await db.exec(sql);
      applied.add(entry.file);
      console.log(`LOCAL applied ${entry.sequence}: ${entry.file}`);
    }
    for (const file of ['auth_account_security.sql','customer_professional_discovery_2026_09_21.sql','service_booking_intake.sql'])
      assert.ok(applied.has(file), `${file} must load in canonical order`);
    const grants=(await db.query(`select has_table_privilege('authenticated','public.profiles','select') as profile_read,
      has_table_privilege('authenticated','public.categories','select') as member_category_read,
      has_table_privilege('anon','public.categories','select') as public_category_read,
      has_table_privilege('anon','public.profiles','select') as public_profile_read`)).rows[0];
    assert.deepEqual(Object.values(grants),[true,true,true,false], 'Only required profile/category reads are granted');
    const seeded=(await db.query('select slug,name from public.categories order by sort_order')).rows;
    assert.deepEqual(seeded.map(row=>row.slug),['manpower','loans','influencers','consultancy','transportation','blood-bank']);
    assert.equal((await db.query("select count(*)::int as count from legal_documents where document_key like 'eazily-influencer-provider-%' and published and content like '%[UNRESOLVED%'")).rows[0].count,0);
    await assert.rejects(db.exec("update legal_documents set published=true where document_key='eazily-influencer-provider-terms'"),/unresolved approved wording/);
    assert.equal((await db.query('select auto_publish_enabled from service_post_approval_config')).rows[0].auto_publish_enabled,false);
    for (const signature of ['public.account_is_active()','public.customer_can_read_partner_media(text)','public.get_service_booking_intake(uuid)'])
      assert.ok((await db.query('select to_regprocedure($1) as fn',[signature])).rows[0].fn,`${signature} must exist`);
    const tables = (await db.query(`select n.nspname as schema,c.relname as name,c.relrowsecurity as rls
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in ('public','eazily_private') and c.relkind='r' order by 1,2`)).rows;
    const functions = (await db.query(`select n.nspname as schema,p.proname as name,
      pg_get_function_identity_arguments(p.oid) as args,p.proconfig as config,
      has_function_privilege('anon',p.oid,'execute') as anon,
      has_function_privilege('authenticated',p.oid,'execute') as authenticated,
      pg_get_function_result(p.oid) as result
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where p.prosecdef and n.nspname in ('public','eazily_private') order by 1,2`)).rows;
    mkdirSync('.tmp', { recursive:true });
    writeFileSync('.tmp/staging-catalog.json', JSON.stringify({ tables, functions }, null, 2));
    assert.deepEqual(tables.filter(t => t.schema === 'public' && !t.rls), [], 'Every public table requires RLS');
    assert.deepEqual(functions.filter(f => !f.config?.some(c => c.startsWith('search_path='))), [], 'Definers have explicit search paths');
    assert.deepEqual(await platformHelper(), { sha: RLS_AUTO_ENABLE_SHA, config: ['search_path=pg_catalog'], owner: 'postgres', definer: true }, 'Migrations leave the reviewed platform helper untouched');
    const isPlatformHelper = f => f.schema === 'public' && f.name === 'rls_auto_enable' && f.args === '';
    assert.ok(functions.every(f => isPlatformHelper(f) || f.config.some(c => /pg_temp$/.test(c))), 'Temp schema follows trusted schemas');
    assert.deepEqual(functions.filter(f => f.result === 'trigger' && (f.anon || f.authenticated)), [], 'Trigger functions are not browser RPCs');
    const owner='11111111-1111-4111-8111-111111111111', outsider='22222222-2222-4222-8222-222222222222', partner='33333333-3333-4333-8333-333333333333';
    await db.query('insert into auth.users(id) values($1),($2)',[owner,outsider]);
    await db.query("insert into partner_applications(id,customer_id,role,status) values($1,$2,'influencer','draft')",[partner,owner]);
    await db.query("insert into seller_subscriptions(partner_id,status,trial_started_at,trial_ends_at) values($1,'trial',now(),now()+interval '60 days')",[partner]);
    const asUser=async id=>{await db.exec('reset role');await db.query("select set_config('test.uid',$1,false)",[id]);await db.exec('set role authenticated');};
    await asUser(owner);
    await assert.rejects(db.query("select accept_influencer_terms($1,'eazily-influencer-provider-terms','2026-09-12')",[partner]),/not published/);
    assert.equal((await db.query("select count(*)::int as count from consent_events where partner_application_id=$1",[partner])).rows[0].count,0);
    assert.ok((await db.query('select seller_subscription_timeline($1) as value',[partner])).rows[0].value);
    await db.query("insert into storage.objects(bucket_id,name,owner_id) values('partner-media',$1,$2)",[`${owner}/influencer/documents/fixture.pdf`,owner]);
    assert.equal((await db.query('select count(*)::int as count from storage.objects')).rows[0].count,1,'Owner reads private file metadata');
    await asUser(outsider);
    assert.equal((await db.query('select seller_subscription_timeline($1) as value',[partner])).rows[0].value,null,'Unrelated account cannot read billing timeline');
    assert.equal((await db.query('select count(*)::int as count from storage.objects')).rows[0].count,0,'Unrelated account cannot list private objects');
    await assert.rejects(db.query("insert into storage.objects(bucket_id,name,owner_id) values('partner-media',$1,$2)",[`${owner}/spoof.pdf`,outsider]),/row-level security/);
    await db.exec('create temp table profiles(id uuid,role public.user_role)');
    await db.query("insert into pg_temp.profiles values($1,'admin')",[outsider]);
    assert.equal((await db.query('select public.is_admin() as allowed')).rows[0].allowed,false,'Temp table cannot shadow definer authorization');
    await db.exec('drop table pg_temp.profiles');
    await assert.rejects(db.exec('create table public.attacker(id int)'),/permission denied/);
    await assert.rejects(db.exec("select * from claim_background_jobs('browser',1,now())"),/permission denied/);
    await assert.rejects(db.query("insert into messages(request_id,sender_id,body) values($1,$2,'unauthorized legacy write')",[partner,outsider]),/permission denied/);
    assert.equal((await db.query("select has_schema_privilege('authenticated','eazily_private','USAGE') as allowed")).rows[0].allowed,false);
    await db.exec('reset role');
    await db.query("update profiles set role='admin' where id=$1",[outsider]);
    await asUser(outsider);
    assert.ok((await db.query('select seller_subscription_timeline($1) as value',[partner])).rows[0].value,'Authorized Admin retains access');
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query('select seller_subscription_timeline($1)',[partner]),/permission denied/);
    await db.exec('reset role');
    const buckets = (await db.query('select id,public,file_size_limit,allowed_mime_types from storage.buckets order by id')).rows;
    assert.deepEqual(buckets.map(b => b.id), ['chat-attachments','partner-media','profile-media']);
    assert.ok(buckets.every(b => !b.public && b.file_size_limit > 0 && b.allowed_mime_types.length));
    const config = (await db.query('select * from automation_configuration')).rows[0];
    for (const key of ['enabled','notification_delivery_enabled','workbook_loan_enabled','workbook_logistics_enabled','payment_reconciliation_enabled','refund_submission_enabled','payout_submission_enabled']) assert.equal(config[key], false, key);
    assert.equal((await db.query('select cashfree_enabled from partner_config')).rows[0].cashfree_enabled, false);
    const subscriptions = (await db.query('select enabled,rollout_enabled,payment_checkout_enabled from seller_subscription_config')).rows[0];
    assert.ok(Object.values(subscriptions).every(v => v === false));
    // Step 24: idempotent profile repair and revoked-account enforcement.
    const repairUser='44444444-4444-4444-8444-444444444444';
    await db.query('insert into auth.users(id) values($1)',[repairUser]);
    await db.query('delete from profiles where id=$1',[repairUser]);
    await asUser(repairUser);
    const repaired=(await db.query('select (ensure_my_profile()).id as id')).rows[0].id;
    assert.equal(repaired,repairUser);
    assert.equal((await db.query('select (ensure_my_profile()).id as id')).rows[0].id,repairUser);
    assert.equal((await db.query('select count(*)::int as count from profiles')).rows[0].count,1);
    await assert.rejects(db.exec("update profiles set role='admin'"),/permission denied/);
    await assert.rejects(db.exec("update profiles set account_status='active'"),/permission denied/);
    await db.exec('reset role');
    await db.query("select set_config('test.uid','',false)");
    await db.query("update profiles set account_status='blocked' where id=$1",[repairUser]);
    await asUser(repairUser);
    assert.equal((await db.query('select account_status from profiles')).rows[0].account_status,'blocked','Restricted user can see own restriction');
    await assert.rejects(db.exec("select get_referral_code()"),/Account access restricted/);
    await assert.rejects(db.exec("update profiles set full_name='Changed'"),/Account access restricted/);
    await assert.rejects(db.query("insert into storage.objects(bucket_id,name,owner_id) values('profile-media',$1,$2)",[`${repairUser}/avatar.png`,repairUser]),/row-level security/);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.exec('select ensure_my_profile()'),/permission denied/);
    await db.exec('reset role');
    // The staging_security.sql exception is exact: altered or other unknown definers still fail closed.
    const stagingSecurity = readFileSync('supabase/staging_security.sql', 'utf8');
    const expectGuardRejects = async (setup, name) => {
      await db.exec(setup);
      await assert.rejects(db.exec(stagingSecurity), new RegExp(`Unreviewed definer search_path for ${name.replace('.', '\\.')}`));
      await db.exec('rollback');
    };
    await expectGuardRejects(`create or replace function public.rls_auto_enable() returns event_trigger language plpgsql
      security definer set search_path=pg_catalog as $$ begin null; end $$`, 'public.rls_auto_enable');
    await db.exec(rlsAutoEnable);
    await expectGuardRejects('alter function public.rls_auto_enable() set search_path=pg_catalog, public', 'public.rls_auto_enable');
    await db.exec(rlsAutoEnable);
    await db.exec('alter function public.rls_auto_enable() set search_path=pg_catalog');
    await expectGuardRejects(`create function public.unknown_platform_helper() returns event_trigger language plpgsql
      security definer set search_path=pg_catalog as $$ begin null; end $$`, 'public.unknown_platform_helper');
    await db.exec('drop function public.unknown_platform_helper()');
    assert.equal((await platformHelper()).sha, RLS_AUTO_ENABLE_SHA);
    console.log('PASS: complete canonical SQL order including Storage; RLS catalog, definer paths, exact platform RLS helper exception, private buckets and disabled switches (local fixtures only).');
  } finally { await db.close(); }
})().catch(error => { console.error(error.message); process.exitCode=1; });
