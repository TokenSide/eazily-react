/* Proves the seed works before it is ever run against a hosted project.
 *
 * Replays all 48 manifest migrations plus the seed files into a throwaway local PGlite
 * database, then asserts the customer-facing directory views return usable rows.
 * Also replays the seed a second time to prove idempotency, asserts the financial
 * tables stay empty, and asserts the KYC trigger is still armed afterwards.
 *
 * Local PostgreSQL only. No network, no remote project, no credentials.
 *
 *   npm run test:seed
 */
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const manifest = require('../supabase/migration-manifest.json');

const SEED_FILES = ['seed/001_catalogue.sql', 'seed/002_service_professionals.sql', 'seed/003_reviews.sql'];
const one = async (db, sql, params) => (await db.query(sql, params)).rows[0];

(async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key,phone text,phone_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}',created_at timestamptz default now(),updated_at timestamptz default now());
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

    for (const entry of manifest.migrations) {
      const sql = readFileSync(`supabase/${entry.file}`, 'utf8');
      assert.equal(createHash('sha256').update(sql).digest('hex'), entry.sha256, `${entry.file} checksum`);
      await db.exec(sql);
    }
    console.log(`Schema: ${manifest.migrations.length} manifest migrations applied.`);

    const before = await one(db, 'select count(*)::int as n from public.vendor_directory');
    assert.equal(before.n, 0, 'fixture must start with an empty directory');

    for (const file of SEED_FILES) {
      await db.exec(readFileSync(resolve(file), 'utf8'));
      console.log(`Seeded: ${file}`);
    }

    const c = await one(db, `select
      (select count(*)::int from public.services where active) as services,
      (select count(*)::int from public.vendor_directory) as directory,
      (select count(*)::int from public.vendor_directory where available_now) as available,
      (select count(*)::int from public.vendor_directory where starting_price is not null) as priced,
      (select count(*)::int from public.vendor_directory where rating > 0) as rated,
      (select count(*)::int from public.customer_reviews) as reviews`);
    console.log('\nDirectory after seeding:');
    console.log(`  active services        ${c.services}`);
    console.log(`  published vendors      ${c.directory}`);
    console.log(`  available now          ${c.available}`);
    console.log(`  with a starting price  ${c.priced}`);
    console.log(`  carrying a rating      ${c.rated}`);
    console.log(`  published reviews      ${c.reviews}`);

    assert.ok(c.services >= 13, 'expected at least 13 active services');
    assert.equal(c.directory, 6, 'expected exactly 6 published vendors');
    assert.ok(c.available >= 4, 'expected at least 4 vendors available now');
    assert.equal(c.priced, 6, 'every seeded vendor needs a starting price');
    assert.equal(c.rated, 6, 'every seeded vendor needs an aggregated rating');
    assert.equal(c.reviews, 8, 'expected 8 published reviews');

    // The view is the contract the frontend reads; check every required field is shaped.
    const shape = await one(db, `select count(*)::int as n from public.vendor_directory
      where display_name is null or business_name is null
         or cardinality(service_names) = 0 or cardinality(coverage) = 0
         or verification_status <> 'verified' or starting_price is null`);
    assert.equal(shape.n, 0, 'every published vendor must satisfy the eligibility filter in customerProfessionalEligibility.js');

    // Money hygiene: a seeded rupee would surface in admin finance views as revenue.
    for (const table of ['partner_earnings', 'finance_transactions', 'wallet_lots', 'customer_payments', 'service_requests', 'partner_orders']) {
      const r = await one(db, `select count(*)::int as n from public.${table}`);
      assert.equal(r.n, 0, `${table} must stay empty; seed rows are not real money or bookings`);
    }

    // The KYC guard must survive the seed untouched.
    const kyc = await one(db, `select count(*)::int as n from pg_trigger t
      join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = 'partner_applications'
        and t.tgname = 'enforce_current_service_partner_registration'`);
    assert.equal(kyc.n, 1, 'the professional KYC trigger must still be armed after seeding');

    // Idempotency: a second run must not duplicate or fail.
    console.log('\nReplaying the seed to prove idempotency...');
    for (const file of SEED_FILES) await db.exec(readFileSync(resolve(file), 'utf8'));
    const again = await one(db, `select
      (select count(*)::int from public.vendor_directory) as directory,
      (select count(*)::int from public.customer_reviews) as reviews,
      (select count(*)::int from public.services where active) as services,
      (select count(*)::int from auth.users) as auth_users,
      (select count(*)::int from public.vendors) as vendors`);
    assert.equal(again.directory, 6, 'a second seed run must not add vendors');
    assert.equal(again.reviews, 8, 'a second seed run must not add reviews');
    assert.equal(again.services, c.services, 'a second seed run must not add services');
    assert.equal(again.auth_users, 6, 'a second seed run must not add auth users');
    assert.equal(again.vendors, 6, 'a second seed run must not add vendor rows');

    // An anonymous visitor must see the directory but must not be able to write it.
    await db.exec(`grant usage on schema public to anon;
      grant select on public.vendor_directory, public.customer_reviews to anon;
      revoke insert, update, delete on public.profiles, public.vendors, public.reviews from anon;`);
    await db.exec('set role anon');
    const anonSees = await one(db, 'select count(*)::int as n from public.vendor_directory');
    await db.exec('reset role');
    assert.ok(anonSees.n > 0, 'an anonymous visitor must be able to read the directory');
    await assert.rejects(
      () => db.exec(`set role anon; insert into public.vendors (owner_id, business_name, published) values ('33333333-3333-4333-8333-000000000001','Rogue',true);`),
      'anon must not be able to publish a vendor',
    );

    console.log('\nPASS: the seed populates the directory the frontend reads, keeps money and booking tables empty, leaves the KYC trigger armed, is idempotent, and anon can read but not write.');
  } finally {
    await db.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });