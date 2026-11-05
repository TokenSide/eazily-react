const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const { readFileSync } = require('node:fs');
const { randomUUID, createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const manifest = require('../supabase/migration-manifest.json');

(async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
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
    for (const entry of manifest.migrations) {
      const content = readFileSync(`supabase/${entry.file}`);
      if (entry.file === 'customer_professional_discovery_2026_09_21.sql') assert.equal(createHash('sha256').update(content).digest('hex'), entry.sha256, `${entry.file} manifest hash`);
      await db.exec(content.toString('utf8'));
    }
    const owner = randomUUID(), customer = randomUUID(), partner = randomUUID(), post = randomUUID(), unpublished = randomUUID(), unrelated = randomUUID(), order = randomUUID(), media = `${owner}/professional/work/example.jpg`, privateMedia = `${owner}/professional/documents/id.jpg`;
    await db.query('insert into auth.users(id) values($1),($2)', [owner, customer]);
    await db.query('insert into partner_applications(id,customer_id,role,status,details) values($1,$2,$3,$4,$5)', [partner, owner, 'professional', 'draft', { name: 'Real Professional', businessName: 'Real AC Care', city: 'Bhopal', category: 'Home & Property', services: ['AC Service'], experienceYears: 7, language: 'Hindi, English', qualificationName: 'Technical certificate', ownerShopMedia: [{ path: privateMedia, type: 'image/jpeg' }] }]);
    await db.exec(`alter table partner_applications disable trigger enforce_current_service_partner_registration; alter table partner_applications disable trigger enforce_service_partner_policy_records;`);
    await db.query("update partner_applications set status='approved',reviewed_at=now() where id=$1", [partner]);
    await db.exec(`alter table partner_applications enable trigger enforce_current_service_partner_registration; alter table partner_applications enable trigger enforce_service_partner_policy_records;`);
    await db.exec("update seller_pricing_rules set enabled=true,seller_tax_bps=0,customer_tax_bps=0,fee_tax_bps=0,separate_fee_paise=0,include_visiting=false,include_additional=false,below_100_bps=0,lower_markup_bps=0,upper_markup_bps=0 where role='professional'");
    await db.query("insert into storage.objects(bucket_id,name,owner_id,metadata) values('partner-media',$1,$2,$5),('partner-media',$3,$2,$5),('partner-media',$4,$2,$5)", [media, owner, privateMedia, `${owner}/professional/work/other.jpg`, { size: 12000, mimetype: 'image/jpeg' }]);
    await db.query('insert into partner_posts(id,partner_id,role,status,details) values($1,$2,$3,$4,$5)', [post, partner, 'professional', 'published', { postType: 'offering', service: 'AC Service', category: 'Home & Property', serviceCharge: '499', visitingCharge: '199', pricingType: 'Starting Price', description: 'Real posted AC work', media: [{ path: media, type: 'image/jpeg' }] }]);
    await db.query('insert into partner_posts(id,partner_id,role,status,details) values($1,$2,$3,$4,$5)', [unpublished, partner, 'professional', 'draft', { postType: 'offering', service: 'Painter', media: [{ path: `${owner}/professional/draft.jpg`, type: 'image/jpeg' }] }]);
    await db.query('insert into partner_posts(id,partner_id,role,status,details) values($1,$2,$3,$4,$5)', [unrelated, partner, 'professional', 'published', { postType: 'photo', category: 'Home & Property', service: 'AC Service', media: [{ path: `${owner}/professional/work/other.jpg`, type: 'image/jpeg' }] }]);
    const list = (await db.query('select * from customer_professional_directory')).rows;
    assert.equal(list.length, 1, 'Only approved published offering appears');
    assert.deepEqual(list[0].service_names, ['AC Service']);
    assert.equal(list[0].review_count, 0);
    assert.equal(list[0].completed_jobs, 0);
    assert.equal(list[0].rating, null);
    assert.equal(list[0].expected_response_minutes, null);
    assert.equal(list[0].starting_price, '499');
    assert.equal(list[0].visiting_charge, '199');
    assert.equal(list[0].portfolio_media.length, 2, 'Published offering and photo post are included');
    assert.equal((await db.query('select customer_can_read_partner_media($1) as allowed', [media])).rows[0].allowed, true);
    assert.equal((await db.query('select customer_can_read_partner_media($1) as allowed', [privateMedia])).rows[0].allowed, false, 'Identity documents never become public photos');
    assert.equal((await db.query('select customer_can_read_partner_media($1) as allowed', [`${owner}/professional/draft.jpg`])).rows[0].allowed, false, 'Draft photos stay private');
    await db.query('insert into partner_orders(id,partner_id,customer_id,role,title,status,details) values($1,$2,$3,$4,$5,$6,$7)', [order, partner, customer, 'professional', 'AC Service', 'completed', { service: 'AC Service' }]);
    await db.query('insert into seller_reviews(order_id,partner_id,customer_id,rating,body,published) values($1,$2,$3,5,$4,true)', [order, partner, customer, 'Genuine completed service']);
    const afterReview = (await db.query('select review_count,completed_jobs,rating from customer_professional_directory')).rows[0];
    assert.equal(afterReview.review_count, 1);
    assert.equal(afterReview.completed_jobs, 1);
    assert.equal(Number(afterReview.rating), 5);
    assert.equal((await db.query('select count(*)::int as count from customer_professional_reviews')).rows[0].count, 1);
    await db.query("update profiles set account_status='suspended' where id=$1", [owner]);
    assert.equal((await db.query('select count(*)::int as count from customer_professional_directory')).rows[0].count, 0, 'Suspended owner is excluded');
    assert.equal((await db.query('select count(*)::int as count from customer_professional_reviews')).rows[0].count, 0, 'Suspended owner reviews are not exposed by customer discovery');
    assert.equal((await db.query('select customer_can_read_partner_media($1) as allowed', [media])).rows[0].allowed, false, 'Suspended owner photos are not accessible');
    console.log('PASS: complete SQL manifest, live approved offering, real completed review/jobs, moderated portfolio, private draft media and suspended-account exclusion.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
