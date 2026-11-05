// Disposable local database only. No remote Auth, billing or production writes.
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');
const manifest = require('../supabase/migration-manifest.json');

(async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
  const user = async id => { await db.exec('reset role'); await db.query("select set_config('test.uid',$1,false)", [id || '']); await db.exec('set role authenticated'); };
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
    // This fixture exercises the upgrade from the pre-legal schema; the manifest
    // now also contains the later legal and Smart Match migrations.
    for (const entry of manifest.migrations) {
      if (['consultant_legal.sql','consumer_legal.sql','consumer_legal_transactions.sql','service_partner_smart_match.sql'].includes(entry.file)) continue;
      await db.exec(readFileSync(`supabase/${entry.file}`, 'utf8'));
    }
    for (const file of ['consultant_legal', 'consultant_legal_drafts_2026_09_20']) await db.exec(readFileSync(`supabase/${file}.sql`, 'utf8'));
    const customer = randomUUID(), other = randomUUID();
    for (const id of [customer, other]) await db.query('insert into auth.users(id,phone) values($1,$2)', [id, id]);
    const oldConsent = await scalar("insert into consent_events(account_id,consent_type,version,accepted,consent_text) values($1,'legacy-customer','old',true,'Existing record') returning id", [customer]);
    await user(customer);
    const key = randomUUID();
    const submit = (requestKey = key) => scalar("select to_jsonb(submit_request('manpower','Plumber','service','{}',$1,null))", [requestKey]);
    const existing = await submit();
    await db.exec('reset role');
    for (const file of ['consumer_legal', 'consumer_legal_transactions', 'consumer_legal_drafts_2026_09_20']) await db.exec(readFileSync(`supabase/${file}.sql`, 'utf8'));
    await db.exec(readFileSync('supabase/consumer_legal_drafts_2026_09_20.sql', 'utf8'));
    assert.equal(await scalar("select count(*)::int from legal_documents where document_key like 'eazily-consumer-%'"), 2);
    for (const kind of ['terms', 'privacy']) {
      assert.equal(await scalar('select content from legal_documents where document_key=$1', [`eazily-consumer-${kind === 'terms' ? 'terms' : 'privacy-policy'}`]), readFileSync(`src/features/legal/documents/consumer-${kind}-2026-09-20-draft.txt`, 'utf8'));
    }
    await assert.rejects(db.exec("update legal_documents set published=true where document_key='eazily-consumer-terms'"), /publication blocked/);
    assert.equal(await scalar('select count(*)::int from consent_events where id=$1', [oldConsent]), 1);
    assert.equal(await scalar('select count(*)::int from service_requests where id=$1', [existing.id]), 1);
    await user(customer);
    const status = () => scalar('select get_consumer_legal_status()');
    const accept = (docs, terms = true, privacy = true) => scalar('select accept_consumer_policies($1,$2,$3)', [docs, terms, privacy]);
    assert.equal((await status()).required, false, 'Drafts do not activate enforcement');
    assert.equal((await submit()).id, existing.id, 'Existing idempotent requests preserved while inactive');
    assert.equal(await scalar("select count(*)::int from legal_documents where document_key like 'eazily-consumer-%'"), 0, 'Drafts hidden by RLS');
    await assert.rejects(accept([]), /not available/);
    await assert.rejects(accept([], false), /Separate explicit/);
    await assert.rejects(accept([], true, null), /Separate explicit/);
    await assert.rejects(db.query("select consumer_legacy_submit_request('manpower','Plumber','service','{}',$1,null)", [randomUUID()]), /permission denied/, 'Renamed original cannot bypass the gate');
    await db.exec('reset role');
    // Complete synthetic fixtures exist ONLY in this in-memory test database.
    const publish = (kind, version, effective = '2020-01-01') => scalar("insert into legal_documents(kind,language,version,title,content,published,effective_at,document_key,consumer_complete,consumer_branding_approved,consumer_operator_verified,consumer_features_reviewed,consumer_operator_name,consumer_review_reference,consumer_approved_by,consumer_approved_at) values($1,'English',$2,'TEST ONLY','Synthetic complete fixture',true,$3,$4,true,true,true,true,'Test operator','Test approval reference',$5,now()) returning id", [kind, version, effective, `eazily-consumer-${kind === 'terms' ? 'terms' : 'privacy-policy'}`, customer]);
    const termsId = await publish('terms', 'test-v1');
    await user(customer);
    assert.equal((await status()).required, false, 'A single approved document does not activate an incomplete pair');
    await db.exec('reset role');
    await publish('privacy_policy', 'test-v1');
    await user(customer);
    const current = await status(), docs = current.documents.map(doc => ({ id: doc.id, version: doc.version }));
    assert.equal(current.required, true); assert.equal(current.accepted, false);
    await assert.rejects(submit(randomUUID()), /Consumer Terms acceptance/);
    await assert.rejects(submit(), /Consumer Terms acceptance/, 'Retrying an old request is not a version bypass');
    for (const [sql, args] of [
      ['select book_partner_offering($1,now(),$2)', [randomUUID(), randomUUID()]],
      ['select book_free_introduction($1,now())', [randomUUID()]],
      ['select reserve_wallet($1)', [existing.id]],
      ['select request_official_payment($1,$2)', [randomUUID(), randomUUID()]],
      ['select respond_to_quote($1,$2,true)', [randomUUID(), randomUUID()]],
      ["select claim_referral('FAKE')", []],
    ]) await assert.rejects(db.query(sql, args), /Consumer Terms acceptance/);
    await assert.rejects(db.query('select respond_to_quote($1,$2,false,$3)', [randomUUID(), randomUUID(), 'Dispute']), error => !/Consumer Terms acceptance/.test(error.message), 'Disputes retain the existing authorization flow');
    await assert.rejects(accept(null), /identifiers and versions/);
    await assert.rejects(accept([docs[0], docs[0]]), /policies changed/);
    await assert.rejects(accept([{ ...docs[0], version: 'old' }, docs[1]]), /policies changed/);
    await assert.rejects(db.query("insert into consent_events(account_id,consent_type,version,accepted,consent_text,legal_document_id) values($1,'eazily-consumer-terms','test-v1',true,'Forged',$2)", [customer, termsId]), /permission denied|row-level security|append-only/);
    const before = Date.now();
    const recorded = await accept(docs.map(doc => ({ ...doc, account_id: other, recorded_at: '2000-01-01' })));
    assert.equal(recorded.accepted, true); assert.equal(recorded.acceptances.length, 2);
    assert.ok(recorded.acceptances.every(row => row.account_id === customer && row.legal_document_id && Date.parse(row.recorded_at) >= before - 1000));
    assert.deepEqual((await accept(docs)).acceptances, recorded.acceptances, 'Retries keep IDs/times and create no duplicates');
    assert.equal((await submit()).id, existing.id);
    assert.ok((await submit(randomUUID())).id);
    await db.exec('reset role');
    assert.equal(await scalar("select count(*)::int from admin_audit_events where action='consumer_policy_acknowledged'"), 2);
    await assert.rejects(db.query("update legal_documents set content='changed' where id=$1", [termsId]), /immutable/);
    await assert.rejects(db.query('delete from consent_events where id=$1', [recorded.acceptances[0].id]), /append-only/);
    await assert.rejects(db.query("update consent_events set consent_type='other' where id=$1", [recorded.acceptances[0].id]), /append-only/);
    await publish('terms', 'future', '2099-01-01');
    await user(customer); assert.equal((await status()).accepted, true);
    await db.exec('reset role'); await publish('terms', 'test-v2', '2021-01-01');
    await user(customer); assert.equal((await status()).accepted, false);
    await assert.rejects(accept(docs), /policies changed/);
    // Cancellation still uses existing rules; neither policy release nor re-ack deletes history.
    await db.query('select request_booking_cancellation($1,$2,$3)', [existing.id, 'Customer cancellation', randomUUID()]);
    await accept((await status()).documents.map(doc => ({ id: doc.id, version: doc.version })));
    assert.equal((await status()).acceptances.length, 3);
    await user(other); assert.deepEqual((await status()).acceptances, []); assert.equal((await status()).accepted, false);
    assert.equal(await scalar('select count(*)::int from consent_events where account_id=$1', [customer]), 0);
    await db.exec('reset role'); await db.query("update profiles set account_status='suspended' where id=$1", [other]);
    await user(other); await assert.rejects(accept(docs), /Active customer profile/);
    await user(null); await db.exec('set role anon');
    assert.equal((await status()).documents.length, 2, 'Guests can review approved policies');
    assert.deepEqual((await status()).acceptances, []);
    await assert.rejects(accept(docs), /permission denied/);
    await db.exec('reset role');
    assert.equal(await scalar('select count(*)::int from consent_events where id=$1', [oldConsent]), 1);
    assert.equal(await scalar('select status from service_requests where id=$1', [existing.id]), 'cancelled');
    assert.equal(await scalar('select payment_checkout_enabled from seller_subscription_config'), false);
    assert.equal(await scalar("select has_function_privilege('service_role','public.consumer_legacy_prepare_seller_gateway(uuid,uuid)','execute')"), false, 'Trusted checkout has no legacy bypass');
    await db.exec('set role service_role');
    await assert.rejects(db.query('select prepare_seller_gateway($1,$2)', [randomUUID(), other]), /Consumer Terms acceptance/, 'Gateway rechecks the actual customer even for a trusted service caller');
    console.log('PASS: canonical migrations + Consumer draft fidelity, inactive draft/partial release, publication guards, auth/ownership, server times, dedup/audit, immutable history, new/future versions, booking/payment/wallet/referral gates, cancellation and prior data preserved, billing remains disabled.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
