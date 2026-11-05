/* In-memory database only. Uses the real migrations and is_admin() authorization. */
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');

(async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth;
      create table auth.users(id uuid primary key,phone text,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      grant usage on schema auth,public to anon,authenticated;
      alter default privileges in schema public grant all on tables to authenticated,anon;
      alter default privileges in schema public grant all on sequences to authenticated,anon;`);
    for (const name of ['schema', 'experience', 'wallet', 'partners', 'operations', 'seller_subscriptions', 'seller_pricing', 'seller_posting', 'seller_workspace', 'seller_finance_extensions', 'seller_hardening', 'seller_gateway']) {
      await db.exec(readFileSync(`supabase/${name}.sql`, 'utf8'));
    }
    const admin = randomUUID(), seller = randomUUID(), outsider = randomUUID();
    for (const id of [admin, seller, outsider]) await db.query('insert into auth.users(id,phone) values($1,$2)', [id, id]);
    await db.query("update profiles set role='admin' where id=$1", [admin]);
    const partner = randomUUID(), otherPartner = randomUUID();
    for (const [id, owner] of [[partner, seller], [otherPartner, outsider]]) {
      await db.query(`insert into partner_applications(id,customer_id,role,status,submitted_at,reviewed_at,details)
        values($1,$2,'professional','approved','2026-01-01T00:00:00Z','2026-01-02T00:00:00Z','{"name":"Local regression fixture"}')`, [id, owner]);
    }
    await db.query(`update seller_subscriptions set status='past_due',plan_id='pro',provider_reference='local-test-reference',current_period_end='2026-05-01T00:00:00Z' where partner_id=$1`, [partner]);
    await db.exec(readFileSync('supabase/seller_subscriptions_v2.sql', 'utf8'));
    await db.query('update seller_subscriptions set cancel_at_period_end=true where partner_id=$1', [partner]);
    const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
    const subscription = id => scalar('select to_jsonb(s) from seller_subscriptions s where partner_id=$1', [id]);
    const audit = () => scalar("select count(*)::int from partner_audit_log where action='correct_subscription_timeline'");
    const user = async id => { await db.exec('reset role'); await db.query("select set_config('test.uid',$1,false)", [id]); await db.exec('set role authenticated'); };
    const correct = (id, date, status = null) => scalar('select to_jsonb(s) from admin_correct_seller_subscription($1,$2,$3) s', [id, date, status]);
    const date = '2026-01-15T10:30:00.000Z';
    const original = await subscription(partner), otherOriginal = await subscription(otherPartner);
    const applications = await db.query('select * from partner_applications order by id');
    const config = await scalar('select to_jsonb(c) from seller_subscription_config c');
    const plans = await db.query('select * from seller_plans order by id');
    assert.equal(original.approval_date_missing, true, 'Existing legacy row starts with an untrusted date');

    for (const id of [seller, outsider]) {
      await user(id);
      await assert.rejects(correct(partner, date), /Admin access required/);
    }
    await db.exec('reset role; set role anon');
    await assert.rejects(correct(partner, date), /permission denied/);
    await user(admin);
    assert.equal(await scalar('select is_admin()'), true, 'Use the actual profile-based authorization');
    await assert.rejects(correct(partner, null), /Approval timestamp is required/);
    await assert.rejects(correct(randomUUID(), date), /Subscription record not found/);
    await db.exec('reset role');
    assert.deepEqual(await subscription(partner), original, 'Rejected requests leave the row unchanged');
    assert.equal(await audit(), 0, 'Rejected requests create no correction audit');

    await user(admin);
    const result = await correct(partner, date);
    assert.equal(result.partner_id, partner);
    for (const field of ['approval_started_at', 'trial_started_at']) assert.equal(new Date(result[field]).toISOString(), date);
    assert.equal(new Date(result.trial_ends_at).toISOString(), '2026-03-16T10:30:00.000Z', 'Keep configured 60-day trial');
    assert.equal(new Date(result.founder_ends_at).toISOString(), '2026-09-16T10:30:00.000Z', 'Keep six calendar months after trial');
    assert.equal(result.approval_date_missing, false);
    for (const field of ['status', 'plan_id', 'provider_reference', 'current_period_end', 'cancel_at_period_end']) assert.equal(result[field], original[field], 'Preserve '+field);
    await db.exec('reset role');
    assert.deepEqual(await subscription(partner), result, 'Corrected row was saved');
    assert.deepEqual(await subscription(otherPartner), otherOriginal, 'Only the requested partner is corrected');
    const logs = (await db.query("select * from partner_audit_log where action='correct_subscription_timeline' order by id")).rows;
    assert.equal(logs.length, 1);
    assert.equal(logs[0].actor_id, admin);
    assert.equal(logs[0].entity_type, 'seller_subscription');
    assert.equal(logs[0].entity_id, partner);
    assert.deepEqual(logs[0].after_data, result, 'Audit records the complete corrected row');

    await user(admin);
    await assert.rejects(correct(partner, date, 'invalid-status'), /check constraint/);
    const changedStatus = await correct(partner, date, 'expired');
    assert.equal(changedStatus.status, 'expired', 'Preserve existing explicit status correction behavior');
    await db.exec('reset role');
    assert.equal(await audit(), 2, 'Invalid status does not create an audit entry');
    assert.deepEqual(await db.query('select * from partner_applications order by id'), applications, 'Registration rows are untouched');
    assert.deepEqual(await scalar('select to_jsonb(c) from seller_subscription_config c'), config, 'Configuration is unchanged');
    assert.deepEqual(await db.query('select * from seller_plans order by id'), plans, 'Plan rules are unchanged');
    assert.equal(config.enabled, false);
    assert.equal(config.rollout_enabled, false);
    assert.equal(config.payment_checkout_enabled, false);
    console.log('PASS: admin correction, correct partner identifier, authorization, missing/null inputs, trial/founder dates, preserved fields, audit logging, explicit status and disabled billing.');
  } finally {
    await db.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
