const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const manifest = require('../supabase/migration-manifest.json');

(async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  const one = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
  const root = async () => { await db.exec('reset role'); await db.query("select set_config('test.uid','',false)"); };
  const user = async id => { await root(); await db.query("select set_config('test.uid',$1,false)", [id]); await db.exec('set role authenticated'); };
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key,phone text,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select current_user::text$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,created_at timestamptz default now());
      create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
      alter table storage.objects enable row level security;
      grant usage on schema auth,public,storage to anon,authenticated,service_role;
      grant all on storage.buckets,storage.objects to authenticated,service_role;
      alter default privileges in schema public grant all on tables to authenticated,anon;
      alter default privileges in schema public grant all on sequences to authenticated,anon;`);
    for (const entry of manifest.migrations) await db.exec(readFileSync(`supabase/${entry.file}`, 'utf8'));
    const [creator, customer, outsider, admin] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    for (const id of [creator, customer, outsider, admin]) await db.query('insert into auth.users(id,phone) values($1,$2)', [id,id]);
    await db.query("update profiles set role='admin' where id=$1", [admin]);
    const app = randomUUID();
    await db.query("insert into partner_applications(id,customer_id,role,status,reviewed_at,details) values($1,$2,'influencer','approved',now(),$3)",
      [app,creator,{ creatorName:'Test Creator',city:'Bhopal',category:'Lifestyle Influencer',
        platforms:[{name:'Instagram',count:56000,url:'https://private.example/creator',verified:false}] }]);
    await db.exec("update seller_pricing_rules set enabled=true,seller_tax_bps=0,customer_tax_bps=0,fee_tax_bps=0,separate_fee_paise=0,include_visiting=true,include_additional=true where role='influencer'");
    await user(creator);
    const details = {postType:'offering',category:'Lifestyle Influencer',title:'Lifestyle reel package',
      description:'One branded reel',caption:'Lifestyle reel collaboration',deliverables:'Reel',
      deliverableCount:1,packagePrice:'5000',timeline:'5',usageRights:'Organic use',
      advertisingPermissions:'Ask before ads',packageTermsConfirmed:true,media:[]};
    const post = await one("select to_jsonb(save_partner_post('influencer',$1,'submit',$2))",[details,randomUUID()]);
    assert.equal(post.status,'pending_review');
    await user(customer);
    assert.equal(Number(await one("select count(*) from partner_directory where partner_role='influencer'")),0);
    await assert.rejects(db.query('select book_partner_offering($1,$2,$3)',
      [post.id,new Date(Date.now()+86400000).toISOString(),randomUUID()]),/eligible published offering/);
    await user(admin);
    await db.query("select admin_review_post($1,'published','Package reviewed')",[post.id]);
    const unapprovedApp = randomUUID(), unapprovedPost = randomUUID();
    await root();
    await db.query("insert into partner_applications(id,customer_id,role,status,details) values($1,$2,'influencer','submitted',$3)",
      [unapprovedApp,outsider,{creatorName:'Pending Creator',city:'Bhopal',category:'Lifestyle Influencer'}]);
    await db.query("insert into partner_posts(id,partner_id,role,status,details) values($1,$2,'influencer','draft',$3)",
      [unapprovedPost,unapprovedApp,details]);
    await user(admin);
    await assert.rejects(db.query("select admin_review_post($1,'published','Cannot bypass approval')",[unapprovedPost]),/Approved matching partner role required/);
    await user(customer);
    const publicPost = await one('select to_jsonb(d) from partner_directory d where id=$1',[post.id]);
    assert.equal(publicPost.partner_role,'influencer');
    assert.equal(Number(await one("select count(*) from partner_directory where partner_role='influencer'")),1);
    assert.equal(Number(await one("select count(*) from partner_directory where partner_role='influencer' and service_names && array['Lifestyle Influencer']")),1);
    assert.equal(publicPost.profile_details.platforms[0].count,56000);
    const { matchesFollowerFilter } = await import('../src/lib/influencerFollowers.js');
    assert.equal(matchesFollowerFilter(publicPost,'20K–100K'),true);
    assert.equal(matchesFollowerFilter(publicPost,'100K–500K'),false);
    assert.ok(!JSON.stringify(publicPost).includes('private.example'),'Private platform URL must not enter discovery');
    assert.ok(publicPost.details.totalPaise > 0);
    const slot = new Date(Date.now()+86400000).toISOString(), key = randomUUID();
    const enquiry = await one('select to_jsonb(book_partner_offering($1,$2,$3))',[post.id,slot,key]);
    assert.equal(enquiry.role,'influencer');
    assert.equal(enquiry.partner_id,app);
    assert.equal(enquiry.post_id,post.id);
    assert.equal(enquiry.status,'requested');
    assert.equal((await one('select to_jsonb(book_partner_offering($1,$2,$3))',[post.id,slot,key])).id,enquiry.id);
    assert.equal(Number(await one('select count(*) from partner_orders where id=$1',[enquiry.id])),1);
    await assert.rejects(db.query('select book_partner_offering($1,$2,$3)',[unapprovedPost,slot,randomUUID()]),/eligible published offering/);
    await user(creator);
    assert.equal(Number(await one('select count(*) from partner_orders where id=$1',[enquiry.id])),1);
    await db.query("select change_seller_order($1,'accept','')",[enquiry.id]);
    assert.equal(await one('select status from partner_orders where id=$1',[enquiry.id]),'accepted');
    await user(customer);
    assert.equal(await one('select status from partner_orders where id=$1',[enquiry.id]),'accepted');
    await user(outsider);
    assert.equal(Number(await one('select count(*) from partner_orders where id=$1',[enquiry.id])),0);
    await root();
    assert.equal(Number(await one('select count(*) from cashfree_collaborations where order_id=$1',[enquiry.id])),0);
    assert.equal(Number(await one('select count(*) from partner_earnings where order_id=$1',[enquiry.id])),0);
    console.log('PASS: approved published influencer discovery, private platform projection, correct-party idempotent enquiry, saved status/RLS, and no fake payment or earnings.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
