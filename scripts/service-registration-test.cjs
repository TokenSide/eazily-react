/* In-memory only: validates the real Service Partner migration without deployment. */
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');

(async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
  const asUser = async id => {
    await db.exec('reset role');
    await db.query("select set_config('test.uid',$1,false)", [id]);
    await db.exec('set role authenticated');
  };
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth;
      create table auth.users(id uuid primary key,phone text,phone_confirmed_at timestamptz,raw_user_meta_data jsonb default '{}');
      create schema storage;
      create table storage.objects(bucket_id text not null,name text not null,primary key(bucket_id,name));
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      grant usage on schema auth,public to anon,authenticated;
      alter default privileges in schema public grant all on tables to authenticated,anon;
      alter default privileges in schema public grant all on sequences to authenticated,anon;`);
    const files = [
      'schema', 'experience', 'wallet', 'partners', 'operations',
      'seller_subscriptions', 'seller_pricing', 'seller_posting', 'seller_workspace',
      'seller_finance_extensions', 'seller_hardening', 'seller_gateway', 'seller_subscriptions_v2',
      'influencer_legal_2026_09_12', 'consultant_assessments', 'service_partner_registration',
      'service_catalog_2026_09_20',
    ];
    for (const file of files) await db.exec(readFileSync(`supabase/${file}.sql`, 'utf8'));

    const userId = randomUUID();
    await db.query("insert into auth.users(id,phone) values($1,'+919999000001')", [userId]);
    await db.exec(`insert into legal_documents(kind,language,version,title,content,published,effective_at,document_key,last_updated_at) values
      ('terms','English','test-service-v1','Service Partner Terms test fixture','Test-only policy fixture',true,'2026-09-14T00:00:00Z','eazily-service-partner-terms','2026-09-14T00:00:00Z'),
      ('privacy_policy','English','test-service-v1','Service Partner Privacy test fixture','Test-only policy fixture',true,'2026-09-14T00:00:00Z','eazily-service-partner-privacy-policy','2026-09-14T00:00:00Z')`);
    const privateDocument = name => ({ path: `${userId}/professional/documents/${name}.png`, name: `${name}.png`, type: 'image/png' });
    for (const name of ['aadhaar', 'pan', 'gumasta']) await db.query("insert into storage.objects(bucket_id,name) values('partner-media',$1)", [`${userId}/professional/documents/${name}.png`]);
    await asUser(userId);
    const details = {
      serviceRegistrationVersion: 'service-registration-2026-09-14', language: 'English', stage: 5,
      name: 'Fictional Shopkeeper', verifiedPhone: '+910000000000', dateOfBirth: '1990-01-02', email: 'shop@example.invalid',
      businessName: 'Fictional Bhopal Repairs', shopOwnership: 'Rented', address: 'Sample Market', locality: 'MP Nagar', city: 'Bhopal', state: 'Madhya Pradesh', pinCode: '462011',
      serviceSelections: [
        { categoryId: 'home-property', categoryLabel: 'Home & Property', serviceId: 'Electrician', serviceName: 'Electrician' },
        { categoryId: 'electronics', categoryLabel: 'Electronics', serviceId: 'AC Service', serviceName: 'AC Service' },
      ],
      category: 'Home & Property', services: ['Electrician', 'AC Service'], experience: '4 years 3 months', experienceYears: '4', experienceMonths: '3', workerCount: 0, workStyle: 'Alone',
      skills: ['Wiring', 'AC Cleaning'], bio: 'Fictional Shopkeeper provides Home & Property and Electronics services.',
      servicePlace: 'At the customer’s location', serviceAreas: 'MP Nagar, Arera Colony', workingDays: ['Monday', 'Saturday'], sameTiming: true, openingTime: '09:00', closingTime: '18:00', dailyTimings: {},
      accountHolder: 'Fictional Shopkeeper', accountNumber: '0012345678', accountConfirmation: '0012345678', ifsc: 'SBIN0001234', bankName: 'Sample Bank',
      aadhaar: [privateDocument('aadhaar')], pan: [privateDocument('pan')], gumasta: [privateDocument('gumasta')], gumastaHelp: false, ownerShopMedia: [], udyam: [],
      consent: {
        termsAccepted: true, informationAccurate: true,
        terms: { documentId: 'eazily-service-partner-terms', version: 'test-service-v1' },
        privacy: { documentId: 'eazily-service-partner-privacy-policy', version: 'test-service-v1' },
      },
    };

    await assert.rejects(db.query('select submit_service_partner_application($1)', [details]), /Choose where services are provided/, 'The existing catalogue validator rejects the form value');
    await db.exec('reset role');
    await db.exec(readFileSync('supabase/service_partner_location_value_fix.sql', 'utf8'));
    await db.exec(readFileSync('supabase/service_partner_phone_confirmation.sql', 'utf8'));
    await asUser(userId);

    await assert.rejects(db.query('select submit_service_partner_application($1)', [details]), /Complete mobile OTP verification/, 'A phone value and forged verifiedPhone do not prove OTP confirmation');
    await assert.rejects(db.query('select submit_service_partner_application($1)', [{ ...details, verifiedPhone: '+919999000001' }]), /Complete mobile OTP verification/, 'Even a matching phone is rejected until Auth confirms it');
    await assert.rejects(db.query("select save_partner_application('professional',$1,true)", [details]), /Complete mobile OTP verification/, 'Legacy direct submit cannot bypass phone confirmation');
    await db.query("select save_partner_application('professional',$1,false)", [details]);
    assert.equal(await scalar("select status from partner_applications where customer_id=$1 and role='professional'", [userId]), 'draft', 'Unconfirmed account can retain a draft');
    await assert.rejects(db.query('select submit_service_partner_application_before_phone_gate($1)', [details]), /permission denied/, 'Authenticated clients cannot invoke the renamed legacy submit function');
    await assert.rejects(db.query("select save_partner_application_before_phone_gate('professional',$1,true)", [details]), /permission denied/, 'Authenticated clients cannot invoke the renamed legacy save function');
    await db.exec('reset role');
    await assert.rejects(db.query('select validate_service_partner_registration($1,$2)', [details,userId]), /Complete mobile OTP verification/, 'The server validator also rejects an unconfirmed Auth phone');
    await db.query('update auth.users set phone=null,phone_confirmed_at=clock_timestamp() where id=$1', [userId]);
    await asUser(userId);
    await assert.rejects(db.query('select submit_service_partner_application($1)', [details]), /Complete mobile OTP verification/, 'A confirmation timestamp without an Auth phone is insufficient');
    await db.exec('reset role');
    await db.query("update auth.users set phone='+919999000001',phone_confirmed_at=clock_timestamp() where id=$1", [userId]);
    await asUser(userId);
    await assert.rejects(db.query('select submit_service_partner_application($1)', [details]), /must match the confirmed account phone/, 'A confirmed account cannot submit a different client-supplied phone');
    await assert.rejects(db.query("select save_partner_application('professional',$1,true)", [details]), /must match the confirmed account phone/, 'Legacy submit cannot use a mismatched phone');
    details.verifiedPhone = '+919999000001';
    await assert.rejects(db.query('select submit_service_partner_application($1)', [{ ...details, verifiedPhone: '' }]), /must match the confirmed account phone/, 'Omitting the claimed phone does not bypass matching');
    await db.exec('reset role');
    await db.query('select validate_service_partner_registration($1,$2)', [{ ...details, servicePlace: 'Both' }, userId]);
    await db.query('select validate_service_partner_registration($1,$2)', [{ ...details, servicePlace: 'At the customerâ€™s location' }, userId]);
    await asUser(userId);

    const badService = structuredClone(details);
    badService.serviceSelections[0].serviceId = 'Unrelated Service';
    badService.serviceSelections[0].serviceName = 'Unrelated Service';
    await assert.rejects(db.query('select submit_service_partner_application($1)', [badService]), /approved catalogue/);
    const badBank = { ...details, ifsc: 'INVALID' };
    await assert.rejects(db.query('select submit_service_partner_application($1)', [badBank]), /valid IFSC/);
    const badPath = structuredClone(details);
    badPath.aadhaar[0].path = `${randomUUID()}/professional/documents/aadhaar.png`;
    await assert.rejects(db.query('select submit_service_partner_application($1)', [badPath]), /private document reference/);
    const missingObject = structuredClone(details);
    missingObject.pan[0].path = `${userId}/professional/documents/missing.png`;
    await assert.rejects(db.query('select submit_service_partner_application($1)', [missingObject]), /not confirmed by private storage/);
    await db.exec('reset role');
    await db.exec("update legal_documents set published=false where document_key='eazily-service-partner-privacy-policy'");
    await asUser(userId);
    await assert.rejects(db.query('select submit_service_partner_application($1)', [details]), /Published Service Partner Terms and Privacy Policy are required/, 'A missing published Privacy Policy blocks submission');
    await db.exec('reset role');
    await db.exec("update legal_documents set published=true where document_key='eazily-service-partner-privacy-policy'");
    await asUser(userId);
    const badConsent = structuredClone(details);
    badConsent.consent.terms.version = 'wrong-version';
    await assert.rejects(db.query('select submit_service_partner_application($1)', [badConsent]), /current Service Partner policies/);

    const legacyAttempt = structuredClone(details);
    legacyAttempt.consent.version = 'legacy-client-consent';
    legacyAttempt.consent.acceptedAt = '2000-01-01T00:00:00Z';
    await db.query("select save_partner_application('professional',$1,false)", [legacyAttempt]);
    await assert.rejects(db.query("select save_partner_application('professional',$1,true)", [legacyAttempt]), /Server-recorded Service Partner policy consent/);
    assert.equal(await scalar("select status from partner_applications where customer_id=$1 and role='professional'", [userId]), 'draft');

    const before = Date.now();
    const application = await scalar('select to_jsonb(submit_service_partner_application($1))', [details]);
    assert.equal(application.status, 'submitted');
    assert.equal(application.details.verifiedPhone, '+919999000001', 'Server replaces client phone with the Auth phone');
    assert.equal(application.details.accountNumber, '0012345678', 'Leading zeroes remain intact');
    assert.equal(application.details.servicePlace, 'At the customer’s location', 'Canonical form value is saved without legacy encoding');
    assert.equal(application.details.serviceAreas, 'MP Nagar, Arera Colony', 'Travel service areas remain saved');
    assert.deepEqual(application.details.services, ['AC Service', 'Electrician'], 'Server derives canonical services from validated selections');
    assert.deepEqual(application.details.skills, ['Wiring', 'AC Cleaning'], 'Only partner-confirmed skills are stored separately from services');
    assert.equal(application.details.bio, details.bio, 'Editable bio is preserved during submission');
    assert.deepEqual(application.details.serviceCategories, ['electronics', 'home-property'], 'Server derives category IDs from validated selections');
    assert.equal(Number(await scalar("select count(*) from partner_applications where customer_id=$1 and role='professional'", [userId])), 1);
    assert.equal(Number(await scalar('select count(*) from seller_subscriptions where partner_id=$1', [application.id])), 0, 'Submission does not start the approval-based trial');
    const consents = (await db.query('select account_id,partner_application_id,consent_type,version,recorded_at from consent_events where partner_application_id=$1 order by consent_type', [application.id])).rows;
    assert.equal(consents.length, 2);
    assert.ok(consents.every(row => Date.parse(row.recorded_at) >= before - 1000), 'Consent times come from the server');
    assert.ok(consents.every(row => row.account_id === userId && row.partner_application_id === application.id && row.version === 'test-service-v1'), 'Both consent records retain the authenticated account, application and document version');
    assert.deepEqual(consents.map(row => row.consent_type), ['eazily-service-partner-privacy-policy', 'eazily-service-partner-terms']);

    const retried = await scalar('select to_jsonb(submit_service_partner_application($1))', [details]);
    assert.equal(retried.id, application.id, 'A retry reuses the existing role application');
    assert.equal(Number(await scalar('select count(*) from consent_events where partner_application_id=$1', [application.id])), 2, 'A retry does not duplicate consent');
    await db.exec('reset role');
    assert.equal(Number(await scalar('select count(*) from partner_audit_log where entity_id=$1 and action=$2', [application.id, 'submit_service_partner_registration'])), 2, 'Each confirmed submission attempt is audited');

    const adminId = randomUUID();
    await db.query("insert into auth.users(id,phone) values($1,'+919999000002')", [adminId]);
    await db.query("update profiles set role='admin' where id=$1", [adminId]);
    await asUser(adminId);
    const approved = await scalar("select to_jsonb(admin_review_partner($1,'approved','Documents reviewed in local fixture'))", [application.id]);
    assert.equal(approved.status, 'approved');
    const trial = await scalar('select to_jsonb(s) from seller_subscriptions s where partner_id=$1', [application.id]);
    assert.equal(Date.parse(trial.trial_started_at), Date.parse(approved.reviewed_at), 'Trial starts from actual approval time');
    assert.equal((Date.parse(trial.trial_ends_at) - Date.parse(trial.trial_started_at)) / 86400000, 60, 'Existing 60-day trial rule remains unchanged');
    await db.exec('reset role');
    const reviewAudit = await scalar("select to_jsonb(l) from partner_audit_log l where action='review_partner' and entity_id=$1 order by id desc limit 1", [application.id]);
    for (const key of ['verifiedPhone', 'dateOfBirth', 'email', 'address', 'accountNumber', 'ifsc', 'aadhaar', 'pan', 'gumasta', 'consent']) {
      assert.equal(Object.hasOwn(reviewAudit.after_data.details, key), false, `Admin review audit redacts ${key}`);
    }

    console.log('PASS: reproduced the garbled location rejection, then submitted and saved the canonical customer-location value; Both and historical values still validate; catalogue IDs, consent, idempotency, private documents and approval-based trial remain intact.');
  } finally {
    await db.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
