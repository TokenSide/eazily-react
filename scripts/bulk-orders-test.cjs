// Disposable in-memory database only; never connects to hosted Supabase.
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const { readFileSync } = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const manifest = require('../supabase/migration-manifest.json');

(async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
  const user = async id => {
    await db.exec('reset role');
    await db.query("select set_config('test.uid',$1,false)", [id || '']);
    await db.exec('set role authenticated');
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

    const customer = randomUUID(), other = randomUUID(), staff = randomUUID();
    for (const id of [customer, other, staff]) await db.query('insert into auth.users(id,phone) values($1,$2)', [id, id]);
    const visitDate = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
    const args = [randomUUID(), 'Society', [
      { service_id: 'ac-service', quantity: 20 }, { service_id: 'electrician', quantity: 3 },
    ], '123 Test Street, Bhopal', visitDate, 'Morning', 'Sample Society'];
    const submit = 'select submit_bulk_quote_request($1,$2,$3,$4,$5,$6,$7)';
    await user(customer);
    await assert.rejects(db.query(submit, args), /Terms and Privacy Policy acknowledgment required/,
      'Missing legal documents cannot silently authorize a bulk request');
    await db.exec('reset role');
    const publish = (kind, key) => scalar(`insert into legal_documents
      (kind,language,version,title,content,published,effective_at,document_key,
       consumer_complete,consumer_branding_approved,consumer_operator_verified,
       consumer_features_reviewed,consumer_operator_name,consumer_review_reference,
       consumer_approved_by,consumer_approved_at)
      values($1,'English','fixture-v1','Test only','Synthetic approved fixture',true,'2020-01-01',$2,
       true,true,true,true,'Test operator','Test approval',$3,now()) returning id`, [kind, key, customer]);
    await publish('terms', 'eazily-consumer-terms');
    await publish('privacy_policy', 'eazily-consumer-privacy-policy');
    await user(customer);
    await assert.rejects(db.query(submit, args), /Terms and Privacy Policy acknowledgment required/);
    const documents = (await scalar('select get_consumer_legal_status()')).documents.map(doc => ({ id: doc.id, version: doc.version }));
    await db.query('select accept_consumer_policies($1,true,true)', [documents]);
    const id = await scalar(submit, args);
    assert.equal(id, await scalar(submit, args), 'Retry returns the original ID');
    assert.equal(await scalar('select count(*)::int from bulk_quote_requests'), 1);
    const own = (await db.query('select * from bulk_quote_requests')).rows[0];
    assert.equal(own.customer_id, customer);
    assert.equal(own.customer_type, 'Society');
    assert.deepEqual(own.services, args[2]);
    assert.equal(own.status, 'requested');
    assert.equal(own.company_name, 'Sample Society');
    assert.equal(Object.keys(own).some(key => /price|payment|vendor/i.test(key)), false,
      'No estimate, approved price, payment or vendor fields are persisted');
    await assert.rejects(db.query(submit, [args[0], args[1], args[2], 'Changed address', ...args.slice(4)]), /different details/);
    await assert.rejects(db.query(submit, [randomUUID(), args[1], [{ service_id: 'ac-service', quantity: 0 }], ...args.slice(3)]), /Invalid service and quantity/);
    await assert.rejects(db.query(submit, [randomUUID(), args[1], [{ service_id: 'not-a-service', quantity: 1 }], ...args.slice(3)]), /Invalid service and quantity/);
    await assert.rejects(db.query(submit, [randomUUID(), args[1], [{ service_id: 'ac-service', quantity: 1 }, { service_id: 'ac-service', quantity: 2 }], ...args.slice(3)]), /Duplicate service/);
    await assert.rejects(db.query('insert into bulk_quote_requests(customer_id,idempotency_key,customer_type,services,address,preferred_date,preferred_time) values($1,$2,$3,$4,$5,$6,$7)', [customer, randomUUID(), ...args.slice(1, 6)]), /permission denied/);
    await assert.rejects(db.query("update bulk_quote_requests set status='requested' where id=$1", [id]), /permission denied/);
    await db.exec('reset role; set role anon');
    await assert.rejects(db.query(submit, args), /permission denied/, 'Anonymous callers cannot submit');
    await user(other);
    assert.equal(await scalar('select count(*)::int from bulk_quote_requests'), 0, 'Other customer sees no request');
    await db.exec('reset role');
    await db.query("insert into staff_access(account_id,staff_role,permissions) values($1,'operations',array['orders.view'])", [staff]);
    await user(staff);
    assert.equal(await scalar('select count(*)::int from bulk_quote_requests'), 1, 'Authorized orders staff sees request');
    await db.exec('reset role');
    assert.equal(await scalar('select count(*)::int from service_requests'), 0, 'No automatic vendor routing');
    assert.equal(await scalar('select count(*)::int from partner_orders'), 0, 'No partner booking created');
    assert.equal(await scalar('select count(*)::int from customer_payments'), 0, 'No payment created');
    console.log('PASS: migration 46, legal gate, 20+ quote, quantities, retry, validation, ownership, staff queue, no matching or payment.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
