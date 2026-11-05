const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');

(async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
  const root = async () => { await db.exec('reset role'); await db.query("select set_config('test.uid','',false)"); };
  const asRole = async role => { await root(); await db.exec(`set role ${role}`); };
  const asUser = async id => { await root(); await db.query("select set_config('test.uid',$1,false)", [id]); await db.exec('set role authenticated'); };
  const addMs = (iso, ms) => new Date(new Date(iso).getTime() + ms).toISOString();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create schema storage;
      create table auth.users(id uuid primary key,phone text,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select current_user::text$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,created_at timestamptz default now());
      create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
      alter table storage.objects enable row level security; grant usage on schema auth,public,storage to anon,authenticated,service_role;
      grant all on storage.buckets,storage.objects to authenticated,service_role;
      alter default privileges in schema public grant all on tables to authenticated,anon;
      alter default privileges in schema public grant all on sequences to authenticated,anon;`);
    const migrations = ['schema','experience','wallet','partners','operations','seller_subscriptions','seller_pricing','seller_posting','seller_workspace','seller_finance_extensions','seller_hardening','seller_gateway','seller_subscriptions_v2','influencer_legal_2026_09_12','consultant_assessments','service_partner_registration','service_partner_posting','partner_dashboard_banners','realtime_events','chat_messaging','background_automation'];
    for (const file of migrations) await db.exec(readFileSync(`supabase/${file}.sql`, 'utf8'));
    await db.exec('grant all privileges on all tables in schema public to service_role; grant all privileges on all sequences in schema public to service_role; grant usage on schema eazily_private to service_role; grant all privileges on all tables in schema eazily_private to service_role;');

    const customer = randomUUID(), owner = randomUUID(), outsider = randomUUID(), admin = randomUUID(), operator = randomUUID();
    for (const id of [customer, owner, outsider, admin, operator]) await db.query('insert into auth.users(id,phone) values($1,$2)', [id, id]);
    await db.query("update profiles set role='admin' where id=$1", [admin]);
    await db.query("insert into staff_access(account_id,staff_role,permissions) values($1,'operations',array['automation.view','automation.manage'])", [operator]);
    const partner = randomUUID(), reviewed = '2026-09-18T06:00:00.000Z';
    await db.exec('alter table partner_applications disable trigger enforce_current_service_partner_registration; alter table partner_applications disable trigger enforce_service_partner_policy_records;');
    await db.query("insert into partner_applications(id,customer_id,role,status,reviewed_at,details) values($1,$2,'professional','approved',$3,$4)", [partner, owner, reviewed, { businessName: 'Fictional Bhopal Services', city: 'Bhopal' }]);
    await db.exec('alter table partner_applications enable trigger enforce_current_service_partner_registration; alter table partner_applications enable trigger enforce_service_partner_policy_records;');
    assert.equal(new Date(await scalar('select trial_started_at from seller_subscriptions where partner_id=$1', [partner])).toISOString(), reviewed, 'Trial starts at trusted approval time');
    await root();
    const financialDefaults = (await db.query('select payment_reconciliation_enabled,refund_submission_enabled,payout_submission_enabled from automation_configuration where id=true')).rows[0];
    assert.deepEqual(financialDefaults, { payment_reconciliation_enabled: false, refund_submission_enabled: false, payout_submission_enabled: false }, 'All financial automation is disabled by default');
    await db.exec("update automation_configuration set enabled=true,lease_seconds=30,retry_base_seconds=8,retry_max_seconds=60,payment_reconciliation_enabled=true,refund_submission_enabled=true,payout_submission_enabled=true,workbook_loan_enabled=true where id=true");
    const now = new Date().toISOString(), future = addMs(now, 3600000);

    // Future work stays untouched; atomic leasing prevents two workers from owning one job.
    const futureJob = await scalar("select enqueue_background_job('test_future','test',$1,$2,$3,null,'{}',3)", [randomUUID(), future, `future:${randomUUID()}`]);
    await asRole('service_role');
    assert.equal((await db.query('select * from claim_background_jobs($1,10,$2)', ['worker-a', now])).rows.some(row => row.id === futureJob), false, 'Future job did not execute early');
    await root();
    const dueJob = await scalar("select enqueue_background_job('unknown_transient','test',$1,$2,$3,null,'{}',3)", [randomUUID(), now, `due:${randomUUID()}`]);
    await asRole('service_role');
    const firstClaim = (await db.query('select * from claim_background_jobs($1,1,$2)', ['worker-a', now])).rows;
    assert.equal(firstClaim.length, 1); assert.equal(firstClaim[0].id, dueJob);
    assert.equal((await db.query('select * from claim_background_jobs($1,10,$2)', ['worker-b', now])).rows.some(row => row.id === dueJob), false, 'Second worker cannot claim the active lease');
    assert.equal(await scalar('select fail_background_job($1,$2,$3,$4,$5,$6)', [dueJob,'worker-a','transient','temporary_network','Temporary provider timeout',now]), 'retry_scheduled');
    const retryAt = await scalar('select next_retry_at from background_jobs where id=$1', [dueJob]);
    assert.ok(new Date(retryAt) > new Date(now), 'Transient failure receives bounded backoff');

    // Expired worker lease is recoverable.
    await root();
    const crashJob = await scalar("select enqueue_background_job('test_crash','test',$1,$2,$3,null,'{}',3)", [randomUUID(), now, `crash:${randomUUID()}`]);
    await asRole('service_role');
    assert.equal((await db.query('select * from claim_background_jobs($1,1,$2)', ['crashed-worker', now])).rows[0].id, crashJob);
    const recovered = (await db.query('select * from claim_background_jobs($1,10,$2)', ['recovery-worker', addMs(now, 31000)])).rows;
    assert.ok(recovered.some(row => row.id === crashJob), 'Expired lease was recovered');
    assert.equal(await scalar('select fail_background_job($1,$2,$3,$4,$5,$6)', [crashJob,'recovery-worker','permanent','unsupported_fixture','Permanent fixture failure',addMs(now,31000)]), 'dead_letter');
    assert.equal(Number(await scalar("select count(*) from operational_review_tasks where related_entity_id=$1", [crashJob])), 1, 'Dead letter creates one Admin task');
    await root();
    const oneTry = await scalar("select enqueue_background_job('test_max','test',$1,$2,$3,null,'{}',1)", [randomUUID(), now, `max:${randomUUID()}`]);
    await asRole('service_role');
    const maxClaim = (await db.query('select * from claim_background_jobs($1,20,$2)', ['max-worker', addMs(now,60000)])).rows.find(row => row.id === oneTry);
    assert.ok(maxClaim);
    assert.equal(await scalar('select fail_background_job($1,$2,$3,$4,$5,$6)', [oneTry,'max-worker','transient','timeout','Timed out',addMs(now,60000)]), 'dead_letter', 'Maximum attempts stop retries');

    // Rescheduling cancels old reminders and creates versioned replacements.
    await root();
    const order = randomUUID(), deadline1 = addMs(now, 3 * 86400000), deadline2 = addMs(now, 4 * 86400000);
    await db.query("insert into partner_orders(id,partner_id,customer_id,role,title,status,deadline) values($1,$2,$3,'professional','Repair visit','accepted',$4)", [order,partner,customer,deadline1]);
    const oldReminderIds = (await db.query("select id from background_jobs where related_entity_id=$1 and job_type='partner_order_reminder' and status='pending'", [order])).rows.map(row => row.id);
    assert.ok(oldReminderIds.length > 0);
    await db.query('update partner_orders set deadline=$2 where id=$1', [order,deadline2]);
    assert.equal(Number(await scalar("select count(*) from background_jobs where id=any($1) and status<>'cancelled'", [oldReminderIds])), 0, 'Old schedule reminders were cancelled');
    assert.ok(Number(await scalar("select count(*) from background_jobs where related_entity_id=$1 and job_type='partner_order_reminder' and status='pending'", [order])) > 0, 'New schedule reminders were created');
    const liveReminder = await scalar("select id from background_jobs where related_entity_id=$1 and job_type='partner_order_reminder' and status='pending' order by scheduled_at limit 1", [order]);
    await db.query('update background_jobs set scheduled_at=$2 where id=$1', [liveReminder,now]);
    await asRole('service_role');
    const liveClaim = (await db.query('select * from claim_background_jobs($1,50,$2)', ['live-reminder-worker', addMs(now,90000)])).rows.find(row => row.id === liveReminder); assert.ok(liveClaim);
    assert.equal(await scalar('select execute_background_job($1,$2,null,$3)', [liveReminder,'live-reminder-worker',addMs(now,90000)]), 'succeeded');
    assert.equal(Number(await scalar("select count(*) from notification_outbox where related_entity_id=$1 and notification_type='booking_reminder'", [order])), 2, 'Current reminder queued one request per participant');
    await root();
    const currentVersion = Number(await scalar('select automation_version from partner_orders where id=$1', [order]));
    const staleReminder = await scalar("select enqueue_background_job('partner_order_reminder','partner_orders',$1,$2,$3,$4,$5,3)", [order,now,`manual-reminder:${randomUUID()}`,currentVersion,{lead_minutes:0}]);
    await asRole('service_role');
    const reminderClaim = (await db.query('select * from claim_background_jobs($1,50,$2)', ['reminder-worker', addMs(now,120000)])).rows.find(row => row.id === staleReminder);
    assert.ok(reminderClaim);
    await root(); await db.query("update partner_orders set status='cancelled' where id=$1", [order]);
    await asRole('service_role');
    assert.equal(await scalar('select execute_background_job($1,$2,null,$3)', [staleReminder,'reminder-worker',addMs(now,120000)]), 'cancelled', 'Cancelled booking prevents stale reminder');
    assert.equal(Number(await scalar("select count(*) from notification_outbox where related_entity_id=$1 and notification_type='booking_reminder'", [order])), 2, 'Cancellation did not add obsolete reminders');

    // Accepted service request cannot be expired by a job that was already leased.
    await root();
    const vendor = randomUUID(); await db.query("insert into vendors(id,owner_id,business_name,published,service_names,coverage) values($1,$2,'Fixture Vendor',true,array['Plumber'],array['Bhopal'])", [vendor,owner]);
    const request = randomUUID(); await db.query("insert into service_requests(id,customer_id,service_name,request_type,assigned_vendor_id) values($1,$2,'Plumber','service',$3)", [request,customer,vendor]);
    const requestVersion = Number(await scalar('select automation_version from service_requests where id=$1', [request]));
    const expiryJob = await scalar("select enqueue_background_job('service_request_expiry','service_requests',$1,$2,$3,$4,'{}',3)", [request,now,`manual-expiry:${randomUUID()}`,requestVersion]);
    await asRole('service_role');
    const expiryClaim = (await db.query('select * from claim_background_jobs($1,50,$2)', ['expiry-worker', addMs(now,180000)])).rows.find(row => row.id === expiryJob); assert.ok(expiryClaim);
    await root(); await db.query("update service_requests set status='accepted' where id=$1", [request]);
    await asRole('service_role');
    assert.equal(await scalar('select execute_background_job($1,$2,null,$3)', [expiryJob,'expiry-worker',addMs(now,180000)]), 'cancelled');
    assert.equal(await scalar('select status from service_requests where id=$1', [request]), 'accepted');

    // Availability expires independently while accepted work is preserved.
    await root();
    const keptOrder = randomUUID(); await db.query("insert into partner_orders(id,partner_id,customer_id,role,title,status) values($1,$2,$3,'professional','Accepted work','accepted')", [keptOrder,partner,customer]);
    await db.query("insert into partner_availability(partner_id,online,confirmed_at,available_until) values($1,true,$2,$3)", [partner,now,addMs(now,1000)]);
    const availabilityJob = await scalar("select id from background_jobs where related_entity_id=$1 and job_type='availability_expiry' and status='pending' order by created_at desc limit 1", [partner]);
    await asRole('service_role');
    const availabilityClaim = (await db.query('select * from claim_background_jobs($1,50,$2)', ['availability-worker', addMs(now,300000)])).rows.find(row => row.id === availabilityJob); assert.ok(availabilityClaim);
    assert.equal(await scalar('select execute_background_job($1,$2,null,$3)', [availabilityJob,'availability-worker',addMs(now,300000)]), 'succeeded');
    assert.equal(await scalar('select online from partner_availability where partner_id=$1', [partner]), false);
    assert.equal(await scalar('select status from partner_orders where id=$1', [keptOrder]), 'accepted');
    assert.ok(Number(await scalar("select count(*) from realtime_events where entity_id=$1 and scope='availability'", [partner])) > 0, 'Background change emitted safe realtime refresh');

    // Verified finance confirmations are idempotent; mismatches remain for review.
    await root();
    const payment = randomUUID(); await db.query("insert into customer_payments(id,customer_id,provider,provider_reference,amount_paise,currency,status) values($1,$2,'sandbox','sandbox-pay-1',12500,'INR','pending')", [payment,customer]);
    await asRole('service_role');
    assert.equal(await scalar('select record_automation_payment_confirmation($1,$2,12500,$3,$4)', ['evt-pay-1',payment,'INR','sandbox-pay-1']), 'confirmed');
    assert.equal(await scalar('select record_automation_payment_confirmation($1,$2,12500,$3,$4)', ['evt-pay-1',payment,'INR','sandbox-pay-1']), 'duplicate');
    assert.equal(await scalar('select record_automation_payment_confirmation($1,$2,12500,$3,$4)', ['evt-pay-1-redelivery',payment,'INR','sandbox-pay-1']), 'already_confirmed');
    assert.equal(Number(await scalar("select count(*) from finance_transactions where idempotency_key='automation-payment:evt-pay-1'")), 1);
    const mismatchPayment = randomUUID(); await root(); await db.query("insert into customer_payments(id,customer_id,provider,provider_reference,amount_paise,currency,status) values($1,$2,'sandbox','sandbox-pay-2',5000,'INR','pending')", [mismatchPayment,customer]);
    await asRole('service_role'); assert.equal(await scalar('select record_automation_payment_confirmation($1,$2,4999,$3,$4)', ['evt-pay-bad',mismatchPayment,'INR','sandbox-pay-2']), 'needs_review');
    assert.equal(await scalar('select status from customer_payments where id=$1', [mismatchPayment]), 'pending');

    const refund = randomUUID(); await root(); await db.query("insert into customer_refunds(id,payment_id,customer_id,requested_paise,approved_paise,reason,status,idempotency_key) values($1,$2,$3,2500,2500,'Fixture cancellation','approved',$4)", [refund,payment,customer,randomUUID()]);
    await asRole('service_role');
    assert.equal(await scalar('select record_automation_refund_confirmation($1,$2,2500,$3,$4)', ['evt-refund-1',refund,'INR','sandbox-refund-1']), 'confirmed');
    assert.equal(await scalar('select record_automation_refund_confirmation($1,$2,2500,$3,$4)', ['evt-refund-1',refund,'INR','sandbox-refund-1']), 'duplicate');
    assert.equal(await scalar('select record_automation_refund_confirmation($1,$2,2500,$3,$4)', ['evt-refund-1-redelivery',refund,'INR','sandbox-refund-1']), 'already_confirmed');
    assert.equal(Number(await scalar("select count(*) from finance_transactions where idempotency_key='automation-refund:evt-refund-1'")), 1);

    const payoutOrder = randomUUID(), payout = randomUUID(); await root();
    await db.query("insert into partner_orders(id,partner_id,customer_id,role,title,status) values($1,$2,$3,'professional','Paid work','completed')", [payoutOrder,partner,customer]);
    await db.query("insert into partner_payouts(id,partner_id,order_id,installment,amount_paise,currency,status,idempotency_key) values($1,$2,$3,'final',9000,'INR','processing',$4)", [payout,partner,payoutOrder,`payout:${payout}`]);
    await asRole('service_role');
    assert.equal(await scalar('select record_automation_payout_confirmation($1,$2,9000,$3,$4)', ['evt-payout-1',payout,'INR','sandbox-payout-1']), 'confirmed');
    assert.equal(await scalar('select record_automation_payout_confirmation($1,$2,9000,$3,$4)', ['evt-payout-1',payout,'INR','sandbox-payout-1']), 'duplicate');
    assert.equal(await scalar('select record_automation_payout_confirmation($1,$2,9000,$3,$4)', ['evt-payout-1-redelivery',payout,'INR','sandbox-payout-1']), 'already_confirmed');
    assert.equal(Number(await scalar("select count(*) from finance_transactions where idempotency_key='automation-payout:evt-payout-1'")), 1);
    const disputedOrder = randomUUID(), heldPayout = randomUUID(); await root();
    await db.query("insert into partner_orders(id,partner_id,customer_id,role,title,status) values($1,$2,$3,'professional','Disputed work','disputed')", [disputedOrder,partner,customer]);
    await db.query("insert into partner_payouts(id,partner_id,order_id,installment,amount_paise,currency,status,idempotency_key) values($1,$2,$3,'final',4000,'INR','processing',$4)", [heldPayout,partner,disputedOrder,`payout:${heldPayout}`]);
    await asRole('service_role'); assert.equal(await scalar('select record_automation_payout_confirmation($1,$2,4000,$3,$4)', ['evt-payout-held',heldPayout,'INR','sandbox-payout-held']), 'needs_review');
    assert.equal(await scalar('select status from partner_payouts where id=$1', [heldPayout]), 'processing');

    // Trial evaluation expires access state without deleting earned records.
    await root();
    await db.query("insert into partner_earnings(partner_id,order_id,role,state,amount) values($1,$2,'professional','available',10) on conflict do nothing", [partner,payoutOrder]);
    await db.query("update seller_subscriptions set trial_ends_at=$2,status='trial' where partner_id=$1", [partner,addMs(now,1000)]);
    const subscriptionJob = await scalar("select id from background_jobs where related_entity_id=$1 and job_type='subscription_evaluation' and status='pending' order by created_at desc limit 1", [partner]);
    await asRole('service_role');
    const subscriptionClaim = (await db.query('select * from claim_background_jobs($1,100,$2)', ['subscription-worker', addMs(now,360000)])).rows.find(row => row.id === subscriptionJob); assert.ok(subscriptionClaim);
    assert.equal(await scalar('select execute_background_job($1,$2,null,$3)', [subscriptionJob,'subscription-worker',addMs(now,360000)]), 'succeeded');
    assert.equal(await scalar('select status from seller_subscriptions where partner_id=$1', [partner]), 'expired');
    assert.equal(Number(await scalar('select count(*) from partner_earnings where partner_id=$1', [partner])), 1, 'Expiry preserves earnings');

    // Workbook delivery requires destination confirmation and cannot duplicate Lead IDs.
    await root();
    const lead = randomUUID(); await db.query("insert into service_requests(id,customer_id,category_id,service_name,request_type,details) values($1,$2,'loans','Home Loan','loan','{}')", [lead,customer]);
    await db.query("insert into excel_lead_outbox(lead_id,destination,status) values($1,'loan','pending')", [lead]);
    const excelJob = await scalar("select enqueue_background_job('excel_delivery','excel_lead_outbox',$1,$2,$3,null,$4,4)", [lead,now,`excel:loan:${lead}`,{destination:'loan'}]);
    await asRole('service_role');
    let claimed = (await db.query('select * from claim_background_jobs($1,100,$2)', ['excel-worker', addMs(now,420000)])).rows.find(row => row.id === excelJob); assert.ok(claimed);
    assert.equal(await scalar('select execute_background_job($1,$2,$3,$4)', [excelJob,'excel-worker',{state:'transient_failure'},addMs(now,420000)]), 'retry_scheduled');
    const excelRetry = await scalar('select next_retry_at from background_jobs where id=$1', [excelJob]);
    claimed = (await db.query('select * from claim_background_jobs($1,100,$2)', ['excel-worker-2',addMs(new Date(excelRetry).toISOString(),1000)])).rows.find(row => row.id === excelJob); assert.ok(claimed);
    assert.equal(await scalar('select execute_background_job($1,$2,$3,$4)', [excelJob,'excel-worker-2',{state:'confirmed',external_row_key:`loan:${lead}`},addMs(new Date(excelRetry).toISOString(),1000)]), 'succeeded');
    assert.equal(Number(await scalar('select count(*) from workbook_delivery_confirmations where lead_id=$1', [lead])), 1);
    await root(); await db.query("update background_jobs set status='running',lock_owner='duplicate-worker',lock_expires_at=$2 where id=$1", [excelJob,addMs(now,900000)]);
    await asRole('service_role'); assert.equal(await scalar('select execute_background_job($1,$2,null,$3)', [excelJob,'duplicate-worker',addMs(now,480000)]), 'cancelled');
    assert.equal(Number(await scalar('select count(*) from workbook_delivery_confirmations where lead_id=$1', [lead])), 1);

    // Review invitation and job replay produce one effect.
    await root();
    const reviewJob = await scalar("select id from background_jobs where related_entity_id=$1 and job_type='review_invitation' order by created_at desc limit 1", [payoutOrder]);
    await db.query("update background_jobs set status='running',lock_owner='review-worker',lock_expires_at=$2 where id=$1", [reviewJob,addMs(now,900000)]);
    await asRole('service_role'); assert.equal(await scalar('select execute_background_job($1,$2,null,$3)', [reviewJob,'review-worker',addMs(now,500000)]), 'succeeded');
    await root(); await db.query("update background_jobs set status='running',lock_owner='review-worker-2',lock_expires_at=$2 where id=$1", [reviewJob,addMs(now,900000)]);
    await asRole('service_role'); assert.equal(await scalar('select execute_background_job($1,$2,null,$3)', [reviewJob,'review-worker-2',addMs(now,510000)]), 'succeeded');
    assert.equal(Number(await scalar('select count(*) from review_invitations where partner_order_id=$1', [payoutOrder])), 1);

    // Cleanup removes only old refresh hints and retains financial and audit evidence.
    await root(); await db.query("insert into realtime_events(audience_kind,audience_key,scope,entity_type,entity_id,occurred_at) values('admin','admin','orders','fixture','old',$1)", [addMs(now,-10*86400000)]);
    const cleanup = await scalar("select enqueue_background_job('cleanup_realtime_events','realtime_events','retention',$1,$2,null,'{}',3)", [now,`cleanup-test:${randomUUID()}`]);
    await db.query("update background_jobs set status='running',lock_owner='cleanup-worker',lock_expires_at=$2 where id=$1", [cleanup,addMs(now,900000)]);
    await asRole('service_role'); assert.equal(await scalar('select execute_background_job($1,$2,null,$3)', [cleanup,'cleanup-worker',now]), 'succeeded');
    assert.equal(Number(await scalar("select count(*) from realtime_events where entity_type='fixture' and entity_id='old'")), 0);
    assert.equal(Number(await scalar('select count(*) from finance_transactions')), 3);
    assert.equal(Number(await scalar('select count(*) from finance_entries')), 6, 'Every confirmed money event has one balanced debit and credit');
    assert.ok(Number(await scalar('select count(*) from automation_job_audit')) > 0);

    // Maintenance reconciles pre-migration records and escalates overdue human review tasks.
    await root();
    await db.query('update partner_availability set online=true,available_until=$2 where partner_id=$1', [partner,addMs(now,1800000)]);
    const availabilityVersion = Number(await scalar('select automation_version from partner_availability where partner_id=$1', [partner]));
    const legacyAvailabilityKey = `availability:${partner}:v${availabilityVersion}`;
    await db.query('delete from background_jobs where deduplication_key=$1', [legacyAvailabilityKey]);
    const legacyOrder = randomUUID();
    await db.query("insert into partner_orders(id,partner_id,customer_id,role,title,status) values($1,$2,$3,'professional','Pre-migration request','requested')", [legacyOrder,partner,customer]);
    const legacyOrderVersion = Number(await scalar('select automation_version from partner_orders where id=$1', [legacyOrder]));
    const legacyOrderKey = `order:${legacyOrder}:expiry:v${legacyOrderVersion}`;
    await db.query('delete from background_jobs where deduplication_key=$1', [legacyOrderKey]);
    const reviewTask = randomUUID();
    await db.query("insert into operational_review_tasks(id,task_type,related_entity_type,related_entity_id,required_permission,deduplication_key,due_at,escalation_at) values($1,'fixture_review','fixture',$2,'automation.manage',$3,$4,$5)", [reviewTask,randomUUID(),`fixture-review:${reviewTask}`,addMs(now,-120000),addMs(now,-60000)]);
    await asRole('service_role');
    assert.ok(Number(await scalar('select enqueue_due_maintenance($1)', [now])) >= 3, 'Maintenance scheduled missing legacy and escalation work');
    assert.equal(Number(await scalar('select count(*) from background_jobs where deduplication_key=$1', [legacyAvailabilityKey])), 1, 'Existing availability was reconciled');
    assert.equal(Number(await scalar('select count(*) from background_jobs where deduplication_key=$1', [legacyOrderKey])), 1, 'Existing request was reconciled');
    const escalationJob = await scalar("select id from background_jobs where deduplication_key=$1", [`operational-task:${reviewTask}:escalation`]);
    const escalationClaim = (await db.query('select * from claim_background_jobs($1,100,$2)', ['escalation-worker',addMs(now,600000)])).rows.find(row => row.id === escalationJob); assert.ok(escalationClaim);
    assert.equal(await scalar('select execute_background_job($1,$2,null,$3)', [escalationJob,'escalation-worker',addMs(now,600000)]), 'succeeded');
    assert.ok(await scalar('select escalated_at is not null from operational_review_tasks where id=$1', [reviewTask]), 'Overdue human review task was escalated without approval');
    await root();
    await db.query("insert into automation_worker_runs(worker_id,finished_at,status) values('health-fixture',clock_timestamp(),'succeeded')");

    // A disabled financial feature neither schedules work nor raises a false provider incident.
    await db.query('update automation_configuration set payout_submission_enabled=false where id=true');
    const disabledPayoutOrder = randomUUID(), disabledPayout = randomUUID();
    await db.query("insert into partner_orders(id,partner_id,customer_id,role,title,status) values($1,$2,$3,'professional','Disabled payout fixture','completed')", [disabledPayoutOrder,partner,customer]);
    await db.query("insert into partner_payouts(id,partner_id,order_id,installment,amount_paise,currency,status,idempotency_key) values($1,$2,$3,'final',3000,'INR','scheduled',$4)", [disabledPayout,partner,disabledPayoutOrder,`payout:${disabledPayout}`]);
    assert.equal(Number(await scalar("select count(*) from background_jobs where deduplication_key=$1", [`payout-submission:${disabledPayout}`])), 0, 'Disabled payout automation does not schedule new work');
    await asRole('service_role'); await db.query('select enqueue_due_maintenance($1)', [now]);
    assert.equal(Number(await scalar("select count(*) from background_jobs where deduplication_key=$1", [`payout-submission:${disabledPayout}`])), 0, 'Maintenance leaves disabled payout automation inactive');
    await root();
    const disabledFinancialJob = await scalar("select enqueue_background_job('payout_submission','partner_payouts',$1,$2,$3,null,'{}',3)", [disabledPayout,now,`disabled-payout:${disabledPayout}`]);
    await db.query("update background_jobs set status='running',lock_owner='disabled-finance-worker',lock_expires_at=$2 where id=$1", [disabledFinancialJob,addMs(now,900000)]);
    await asRole('service_role');
    assert.equal(await scalar('select execute_background_job($1,$2,null,$3)', [disabledFinancialJob,'disabled-finance-worker',now]), 'cancelled');
    assert.equal(Number(await scalar("select count(*) from automation_financial_cases where deduplication_key=$1", [`financial-job:${disabledFinancialJob}`])), 0, 'A disabled feature does not create a provider incident');
    await root(); await db.query('update automation_configuration set payout_submission_enabled=true where id=true');

    // Queue privacy, scoped Admin controls, and payload filtering.
    await asUser(outsider);
    assert.equal(Number(await scalar('select count(*) from background_jobs')), 0, 'Normal user cannot read queue');
    await assert.rejects(db.query('select * from claim_background_jobs($1,1,$2)', ['browser',now]), /permission denied/);
    await asUser(admin);
    await assert.rejects(db.query('select admin_retry_automation_job($1,$2)', [crashJob,'General admin retry']), /permission required/, 'Admin without automation.manage cannot control queue');
    await asUser(operator);
    const health = await scalar('select automation_health_summary()');
    assert.equal(health.schedulerStatus, 'healthy');
    assert.ok(health.jobsByType && health.notificationByState && health.excelByState, 'Admin health includes queue breakdowns');
    assert.ok(Object.hasOwn(health, 'oldestPendingSeconds') && Object.hasOwn(health, 'reviewTasksOverdue'), 'Admin health includes queue age and overdue work');
    await db.query('select admin_retry_automation_job($1,$2)', [crashJob,'Reviewed local fixture for retry']);
    assert.equal(await scalar('select status from background_jobs where id=$1', [crashJob]), 'pending');
    await root();
    assert.ok(Number(await scalar("select count(*) from admin_audit_events where entity_id=$1 and action='automation_job_retry'", [crashJob])) === 1);
    await assert.rejects(db.query("select enqueue_background_job('unsafe','test','x',now(),$1,null,$2,3)", [`unsafe:${randomUUID()}`,{bank_account:'123'}]), /Unsafe background job payload|background_jobs_safe_payload/);

    console.log('PASS: durable scheduling, legacy-record reconciliation, operational escalation, scheduler health, queue breakdowns, disabled financial safeguards, atomic claims, lease recovery, bounded retry/dead-letter, stale booking guards, rescheduling, availability, trusted trial timing, idempotent payment/refund/payout/workbook/review effects, cleanup safety, realtime refresh, RLS, scoped Admin control, and safe payload validation.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
