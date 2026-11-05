// In-memory PostgreSQL fixture only. No hosted Supabase connection or data.
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const { readFileSync } = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const manifest = require('../supabase/migration-manifest.json');

const views = [
  'customer_reviews', 'vendor_directory', 'partner_directory',
  'partner_public_config', 'customer_professional_directory',
  'customer_professional_reviews', 'customer_service_verification',
];
const secret = 'PRIVATE_REGISTRATION_SENTINEL';

(async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  const rows = async (sql, params = []) => (await db.query(sql, params)).rows;
  const asRole = async (role, id = '') => {
    await db.exec('reset role');
    await db.query("select set_config('test.uid',$1,false)", [id]);
    await db.exec(`set role ${role}`);
  };
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
    await db.exec(readFileSync('scripts/fixtures/supabase-rls-auto-enable.sql', 'utf8'));
    assert.equal(manifest.migrations.at(-1).sequence, 48);
    for (const entry of manifest.migrations) {
      const sql = readFileSync(`supabase/${entry.file}`, 'utf8');
      assert.equal(createHash('sha256').update(sql).digest('hex'), entry.sha256, `${entry.file} checksum`);
      await db.exec(sql);
    }

    const owner = randomUUID(), customer = randomUUID(), hiddenOwner = randomUUID();
    for (const id of [owner, customer, hiddenOwner]) {
      await db.query('insert into auth.users(id,phone) values($1,$2)', [id, id]);
    }
    const [vendor] = await rows(`insert into vendors(owner_id,business_name,published,service_names,prices)
      values($1,'Public vendor',true,array['AC Service'],'{"AC Service":499}') returning id`, [owner]);
    await db.query(`insert into vendors(owner_id,business_name,published) values($1,'Hidden vendor',false)`, [hiddenOwner]);
    const [booking] = await rows(`insert into service_requests(customer_id,service_name,request_type,status,assigned_vendor_id,details)
      values($1,'AC Service','service','completed',$2,$3) returning id`, [customer, vendor.id, { address: secret }]);
    await db.query(`insert into reviews(customer_id,vendor_id,service_name,booking_id,customer_display_name,rating,review_text,published)
      values($1,$2,'AC Service',$3,'Customer',5,'Real review',true)`, [customer, vendor.id, booking.id]);
    await db.query(`insert into reviews(customer_id,vendor_id,service_name,customer_display_name,rating,review_text,published)
      values($1,$2,'AC Service','Customer',1,'Unpublished review',false)`, [customer, vendor.id]);

    const details = {
      name: 'Public professional', businessName: 'Public shop', city: 'Bhopal',
      category: 'AC Service', services: ['AC Service'], skills: ['Repair', { private: secret }],
      aadhaar: [{ path: secret }], phone: secret, bankAccount: secret,
      ownerShopMedia: [{ path: `${owner}/professional/shop.webp`, type: 'image/webp', private: secret }],
    };
    // Read-only view fixtures bypass submission guards; the guards are tested separately.
    await db.exec('alter table partner_applications disable trigger user');
    const [application] = await rows(`insert into partner_applications(customer_id,role,status,details)
      values($1,'professional','approved',$2) returning id`, [owner, details]);
    const [unapprovedApplication] = await rows(`insert into partner_applications(customer_id,role,status,details)
      values($1,'professional','submitted',$2) returning id`,
      [hiddenOwner, { ...details, name: 'Unapproved professional' }]);
    await db.exec('alter table partner_applications enable trigger user');
    await db.exec('alter table partner_posts disable trigger user');
    const [post] = await rows(`insert into partner_posts(partner_id,role,status,details)
      values($1,'professional','published',$2) returning id`, [application.id, {
      postType: 'offering', category: 'AC Service', service: 'AC Service', title: 'AC servicing',
      description: 'Public service', serviceCharge: '499', visitingCharge: '99',
      pricingType: 'Fixed Price', secret,
      packageSnapshot: {
        title: 'Public package', deliverables: 'Reel', deliverableCount: 2,
        packagePrice: '499', timeline: '5', usageRights: 'Public use',
        revisions: { private: secret }, private: secret, metadata: { private: secret },
      },
      media: [{ path: `${owner}/professional/work.webp`, type: 'image/webp', private: secret }],
    }]);
    await db.query(`insert into partner_posts(partner_id,role,status,details)
      values($1,'professional','draft',$2)`, [application.id, {
      postType: 'offering', category: 'AC Service', service: 'AC Service', title: 'Hidden post',
      description: secret, serviceCharge: '100', visitingCharge: '0', pricingType: 'Fixed Price',
    }]);
    await db.query(`insert into partner_posts(partner_id,role,status,details)
      values($1,'professional','published',$2)`, [unapprovedApplication.id, {
      postType: 'offering', category: 'AC Service', service: 'AC Service', title: 'Unapproved post',
      description: secret, serviceCharge: '100', visitingCharge: '0', pricingType: 'Fixed Price',
    }]);
    await db.exec('alter table partner_posts enable trigger user');
    const [order] = await rows(`insert into partner_orders(partner_id,customer_id,role,title,status,details,post_id)
      values($1,$2,'professional','AC servicing','completed',$3,$4) returning id`,
      [application.id, customer, { service: 'AC Service', address: secret }, post.id]);
    await db.query(`insert into seller_reviews(order_id,partner_id,customer_id,rating,body,published)
      values($1,$2,$3,5,'Completed booking review',true)`, [order.id, application.id, customer]);
    const [hiddenOrder] = await rows(`insert into partner_orders(partner_id,customer_id,role,title,status,details,post_id)
      values($1,$2,'professional','AC servicing','completed','{}',$3) returning id`,
      [application.id, customer, post.id]);
    await db.query(`insert into seller_reviews(order_id,partner_id,customer_id,rating,body,published)
      values($1,$2,$3,1,'Unpublished review',false)`, [hiddenOrder.id, application.id, customer]);
    await db.query(`insert into service_document_verifications(partner_id,verified_at,verified_by,review_reference)
      values($1,now(),$2,'fixture-review')`, [application.id, owner]);

    for (const [role, id] of [['anon', ''], ['authenticated', customer]]) {
      await asRole(role, id);
      const output = {};
      for (const view of views) {
        output[view] = await rows(`select * from public.${view}`);
        assert.ok(!JSON.stringify(output[view]).includes(secret), `${role}: ${view} leaked private data`);
        assert.deepEqual(await rows(`select * from eazily_public_read_internal.read_${view}()`), output[view],
          `${role}: view still calls the internal helper`);
        await assert.rejects(rows(`select * from public.read_${view}()`), /does not exist/,
          `${role}: no public-schema RPC helper remains`);
      }
      assert.equal(output.vendor_directory.length, 1, `${role}: published vendor only`);
      assert.equal(output.customer_reviews.length, 1, `${role}: published customer review only`);
      assert.equal(output.customer_reviews[0].verified_booking, true, `${role}: genuine booking verification retained`);
      assert.equal(output.partner_directory.length, 1, `${role}: approved published post only`);
      assert.equal(output.partner_directory[0].details.title, 'AC servicing');
      assert.deepEqual(output.partner_directory[0].details.packageSnapshot, {
        title: 'Public package', deliverables: 'Reel', deliverableCount: 2,
        packagePrice: '499', timeline: '5', usageRights: 'Public use',
      }, `${role}: only safe scalar package terms are public`);
      assert.equal(output.customer_professional_directory.length, 1, `${role}: published professional only`);
      assert.equal(output.customer_professional_reviews.length, 1, `${role}: completed published review only`);
      assert.equal(output.customer_service_verification.length, 1, `${role}: only published approved professional`);
      assert.deepEqual(output.customer_service_verification[0].reported_skills, ['Repair']);
      assert.ok(output.customer_service_verification[0].verified_at, `${role}: verified date retained`);
      assert.equal(output.partner_public_config.length, 1, `${role}: public config retained`);
      assert.ok(!('influencer_platform_fee_percent' in output.partner_public_config[0]), `${role}: private config omitted`);
      assert.deepEqual(Object.keys(output.customer_professional_directory[0].profile_photo_media).sort(), ['path', 'type']);
      assert.deepEqual(Object.keys(output.customer_professional_directory[0].portfolio_media[0]).sort(), ['path', 'type']);
      try {
        assert.equal((await rows('select count(*)::int as count from partner_applications')).at(0).count, 0,
          `${role}: private applications stay unreadable`);
      } catch (error) {
        assert.match(error.message, /permission denied|row-level security/i,
          `${role}: direct private-table access must fail closed`);
      }
    }
    await asRole('authenticated', owner);
    assert.equal((await rows('select count(*)::int as count from partner_directory')).at(0).count, 0,
      'Published directory still excludes the provider from their own customer listing');
    await db.exec('reset role');
    for (const view of views) {
      const [row] = await rows(`select reloptions from pg_class where oid='public.${view}'::regclass`);
      assert.ok(row.reloptions.includes('security_invoker=true'), `${view} must be an invoker view`);
      const [helper] = await rows(`select n.nspname as schema, pg_get_viewdef('public.${view}'::regclass) as definition
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname=$1`, [`read_${view}`]);
      assert.equal(helper.schema, 'eazily_public_read_internal');
      assert.match(helper.definition, new RegExp(`eazily_public_read_internal\\.read_${view}`));
    }
    assert.equal((await rows(`select count(*)::int as count from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='eazily_public_read_internal' and p.proname like 'read_%'`))[0].count, 7);
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await rows(`select has_schema_privilege($1,'eazily_public_read_internal','USAGE') as allowed`, [role]))[0].allowed, true);
      assert.equal((await rows(`select has_schema_privilege($1,'eazily_public_read_internal','CREATE') as allowed`, [role]))[0].allowed, false);
      assert.equal((await rows(`select has_schema_privilege($1,'eazily_private','USAGE') as allowed`, [role]))[0].allowed, false);
    }
    console.log('PASS: seven invoker views, private helper schema, anon/signed-in reads, published-only data and scalar package snapshot.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
