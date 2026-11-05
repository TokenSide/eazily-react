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
      create table auth.users(id uuid primary key,phone text,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      grant usage on schema auth,public to anon,authenticated;
      alter default privileges in schema public grant all on tables to authenticated,anon;
      alter default privileges in schema public grant all on sequences to authenticated,anon;`);
    const migrations = [
      'schema','experience','wallet','partners','operations','seller_subscriptions','seller_pricing',
      'seller_posting','seller_workspace','seller_finance_extensions','seller_hardening','seller_gateway',
      'seller_subscriptions_v2','influencer_legal_2026_09_12','consultant_assessments',
      'partner_dashboard_banners','realtime_events'
    ];
    for (const file of migrations) await db.exec(readFileSync(`supabase/${file}.sql`, 'utf8'));

    const customer = randomUUID(), serviceOwner = randomUUID(), influencerOwner = randomUUID(), outsider = randomUUID(), admin = randomUUID(), operationsStaff = randomUUID();
    for (const id of [customer, serviceOwner, influencerOwner, outsider, admin, operationsStaff]) {
      await db.query('insert into auth.users(id,phone) values($1,$2)', [id, id]);
    }
    await db.query("update profiles set role='admin' where id=$1", [admin]);
    await db.query("insert into staff_access(account_id,staff_role,permissions) values($1,'operations',array['orders.view'])", [operationsStaff]);
    const serviceApp = randomUUID(), influencerApp = randomUUID();
    await db.query("insert into partner_applications(id,customer_id,role,status,reviewed_at,details) values($1,$2,'professional','approved',now(),$3)", [serviceApp, serviceOwner, { name: 'Test Service Partner', city: 'Bhopal' }]);
    await db.query("insert into partner_applications(id,customer_id,role,status,reviewed_at,details) values($1,$2,'influencer','approved',now(),$3)", [influencerApp, influencerOwner, { creatorName: 'Test Influencer', city: 'Bhopal' }]);
    const draftApp = randomUUID();
    await db.query("insert into partner_applications(id,customer_id,role,status,details) values($1,$2,'consultant','draft',$3)", [draftApp, outsider, { name: 'Private Draft', city: 'Bhopal' }]);
    assert.equal(Number(await scalar("select count(*) from realtime_events where audience_kind='public' and entity_id=$1", [draftApp])), 0, 'Draft applications never emit public events');
    const order = randomUUID();
    await db.query("insert into partner_orders(id,partner_id,customer_id,role,title) values($1,$2,$3,'professional','Test booking')", [order, serviceApp, customer]);
    await db.query("update partner_orders set status='accepted' where id=$1", [order]);

    const guardedOrder = randomUUID();
    await db.query("insert into partner_orders(id,partner_id,customer_id,role,title) values($1,$2,$3,'professional','Ownership test')", [guardedOrder, serviceApp, customer]);
    await asUser(influencerOwner);
    await assert.rejects(db.query("select change_seller_order($1,'accept','')", [guardedOrder]), /Order access required|Assigned approved seller required/, 'Another partner cannot accept an assigned request');
    await asUser(serviceOwner);
    assert.equal((await db.query("select (change_seller_order($1,'accept','')).status", [guardedOrder])).rows[0].status, 'accepted');
    assert.equal((await db.query("select (change_seller_order($1,'accept','')).status", [guardedOrder])).rows[0].status, 'accepted', 'Repeated acceptance is idempotent');

    await db.exec('reset role');
    const quote = randomUUID(), payment = randomUUID();
    await db.query("insert into eazily_private.quotes(id,order_id,version,input,calculation,scope,key) values($1,$2,1,'{}',$3,'Test quote',$4)", [quote, order, { totalPaise: 25000, sellerPayablePaise: 20000 }, randomUUID()]);
    await db.query("insert into eazily_private.payment_requests(id,quote_id,status) values($1,$2,'pending')", [payment, quote]);
    assert.ok(Number(await scalar("select count(*) from realtime_events where audience_key=$1 and scope in('quotes','payments')", [customer])) >= 2, 'Private quote/payment changes emit payload-free participant hints');

    assert.ok(Number(await scalar("select count(*) from realtime_events where audience_kind='account' and audience_key=$1 and scope='orders'", [customer])) >= 2, 'Customer receives booking invalidation events');
    assert.ok(Number(await scalar("select count(*) from realtime_events where audience_kind='account' and audience_key=$1 and scope='orders'", [serviceOwner])) >= 2, 'Assigned partner receives booking invalidation events');
    const columns = (await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='realtime_events' order by ordinal_position")).rows.map(row => row.column_name);
    assert.deepEqual(columns, ['id','audience_kind','audience_key','scope','entity_type','entity_id','occurred_at'], 'Realtime envelope contains no business payload');

    await asUser(customer);
    assert.ok(Number(await scalar("select count(*) from realtime_events where audience_kind='account' and audience_key=$1", [customer])) > 0);
    assert.equal(Number(await scalar("select count(*) from realtime_events where audience_kind='account' and audience_key=$1", [serviceOwner])), 0, 'Customer cannot read partner-private events');
    await asUser(outsider);
    assert.equal(Number(await scalar("select count(*) from realtime_events where audience_kind='account' and audience_key<>$1", [outsider])), 0, 'Account can read only its own private events');

    await db.exec('reset role');
    await db.query("insert into partner_dashboard_banners(role,headline,supporting_line,image_alt,action_label,action_kind,starts_at,active) values('professional','Test only','Test only','Test','Open','orders',now(),true)");
    await asUser(serviceOwner);
    assert.equal(Number(await scalar("select count(*) from realtime_events where audience_kind='role' and audience_key='professional' and scope='banners'")), 1, 'Approved Service Partner receives Service Partner role events');
    await asUser(influencerOwner);
    assert.equal(Number(await scalar("select count(*) from realtime_events where audience_kind='role' and audience_key='professional'")), 0, 'Influencer cannot read Service Partner role events');

    await db.exec('reset role');
    await db.query("insert into partner_availability(partner_id,online,confirmed_at,available_until) values($1,true,now(),now()+interval '30 minutes') on conflict(partner_id) do update set online=true,confirmed_at=now(),available_until=now()+interval '30 minutes'", [serviceApp]);
    await asUser(customer);
    const publicEvents = await db.query("select * from realtime_events where audience_kind='public' and audience_key='city:bhopal' and scope='availability'");
    assert.ok(publicEvents.rows.length > 0, 'Availability emits a safe city-scoped public invalidation');
    assert.ok(!JSON.stringify(publicEvents.rows).includes('Test Service Partner'), 'Public event contains no private profile details');

    await asUser(admin);
    assert.ok(Number(await scalar("select count(*) from realtime_events where audience_kind='admin' and audience_key='admin'")) > 0, 'Verified Admin receives queue invalidations');
    await asUser(operationsStaff);
    assert.ok(Number(await scalar("select count(*) from realtime_events where audience_kind='admin' and scope='orders'")) > 0, 'Scoped operations staff receives order invalidations');
    assert.equal(Number(await scalar("select count(*) from realtime_events where audience_kind='admin' and scope='payments'")), 0, 'Operations-only staff cannot receive finance invalidations');

    await db.exec('reset role');
    const ids = (await db.query('select id from realtime_events order by id')).rows.map(row => Number(row.id));
    assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
    assert.equal(new Set(ids).size, ids.length, 'Event IDs are stable monotonic deduplication keys');
    console.log('PASS: payload-free events, monotonic IDs, customer/partner/admin delivery, public availability invalidation, and cross-account/cross-role RLS isolation.');
  } finally {
    await db.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
