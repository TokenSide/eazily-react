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
    const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const [customer, first, backup, third, outsider, admin] = ids;
    for (const id of ids) await db.query('insert into auth.users(id,phone) values($1,$2)', [id, id]);
    await db.query("update profiles set role='admin' where id=$1", [admin]);
    const apps = [randomUUID(), randomUUID(), randomUUID()];
    await db.exec('alter table partner_applications disable trigger enforce_current_service_partner_registration; alter table partner_applications disable trigger enforce_service_partner_policy_records;');
    for (let index = 0; index < 3; index++) await db.query(
      "insert into partner_applications(id,customer_id,role,status,reviewed_at,details) values($1,$2,'professional','approved',now(),$3)",
      [apps[index], ids[index + 1], { name: `Professional ${index + 1}`, city: 'Bhopal', services: ['Electrician'], ...(index === 0 ? {
        aadhaar: [{ path: `${first}/professional/documents/aadhaar.jpg` }],
        pan: [{ path: `${first}/professional/documents/pan.jpg` }],
        gumasta: [{ path: `${first}/professional/documents/shop.jpg` }],
      } : {}) }]);
    await db.exec('alter table partner_applications enable trigger enforce_current_service_partner_registration; alter table partner_applications enable trigger enforce_service_partner_policy_records;');
    await db.exec("update seller_pricing_rules set enabled=true,seller_tax_bps=0,customer_tax_bps=0,fee_tax_bps=0,separate_fee_paise=100,include_visiting=true,include_additional=true where role='professional';");
    const posts = [randomUUID(), randomUUID(), randomUUID()];
    for (let index = 0; index < 3; index++) await db.query(
      "insert into partner_posts(id,partner_id,role,status,details) values($1,$2,'professional','published',$3)",
      [posts[index], apps[index], { postType: 'offering', title: `Electrician ${index + 1}`, category: 'Home & Property', service: 'Electrician', serviceCharge: '200', visitingCharge: '50', pricingType: 'Fixed Price', quantity: 1, taxInclusive: false }]);
    for (const app of apps) await db.query('insert into partner_availability(partner_id,online,confirmed_at,available_until) values($1,true,now(),now()+interval \'2 days\') on conflict(partner_id) do update set online=true,confirmed_at=now(),available_until=now()+interval \'2 days\'', [app]);
    await db.exec("update automation_configuration set enabled=true,scheduler_expected_seconds=60 where id=true; insert into automation_worker_runs(worker_id,finished_at,status) values('fixture-worker',clock_timestamp(),'succeeded'); update seller_pricing_rules set enabled=true,seller_tax_bps=0,customer_tax_bps=0,fee_tax_bps=0,separate_fee_paise=100,include_visiting=true,include_additional=true where role='professional';");
    await db.exec('update automation_configuration set scheduler_expected_seconds=180 where id=true');
    assert.equal(await one('select notification_delivery_enabled from automation_configuration where id=true'),false,
      'Background notification delivery must remain disabled');
    assert.equal((await one('select service_match_capabilities()')).backupAvailable,false);
    await user(customer);
    const unavailableKey=randomUUID();
    await assert.rejects(db.query('select request_professional_booking($1,$2,$3,true,$4)',
      [posts[0],new Date(Date.now()+86400000).toISOString(),unavailableKey,'Bhopal']),/healthy response-time worker/);
    await root();
    assert.equal(Number(await one('select count(*) from partner_orders where request_key=$1',[unavailableKey])),0);
    await db.exec('update automation_configuration set scheduler_expected_seconds=60 where id=true');
    assert.equal(await one('select response_seconds from service_match_config where id=true'),60);
    await user(customer);
    const estimate = await one('select service_booking_estimate($1)', [posts[0]]);
    assert.equal(estimate.available, true);
    assert.equal(estimate.servicePaise + estimate.visitingPaise + estimate.platformPaise + estimate.taxPaise, estimate.totalPaise);
    const slot = new Date(Date.now() + 86400000).toISOString(), key = randomUUID();
    const direct = await one('select to_jsonb(request_professional_booking($1,$2,$3,false,$4))', [posts[0],slot,key,'Bhopal']);
    assert.equal(direct.partner_id, apps[0]);
    assert.equal(direct.match_mode, 'direct');
    assert.equal((await one('select to_jsonb(request_professional_booking($1,$2,$3,false,$4))', [posts[0],slot,key,'Bhopal'])).id, direct.id);
    assert.equal(Number(await one('select count(*) from service_booking_offers where order_id=$1', [direct.id])), 1);
    assert.equal(Number(await one("select count(*) from seller_notifications where order_id=$1 and account_id=$2 and title='Request sent to your selected professional'", [direct.id, customer])), 1);
    const ownNotification=await one("select id from seller_notifications where order_id=$1 and account_id=$2 and title='Request sent to your selected professional'",[direct.id,customer]);
    assert.equal(Number(await one('select count(*) from seller_notifications where order_id=$1 and account_id=$2', [direct.id, first])), 0,
      'A customer cannot read the offered vendor\'s notifications');
    await assert.rejects(db.query("insert into seller_notifications(account_id,role,order_id,title) values($1,'professional',$2,'Forged')", [first,direct.id]), /permission denied/);
    await assert.rejects(db.query('select request_selected_alternative_booking($1,$2,$3,$4,$5)',
      [direct.id,posts[1],slot,randomUUID(),estimate]), /Cancelled direct booking required/);
    await user(backup);
    await db.query('select mark_seller_notifications_read($1)',[ownNotification]);
    await root();
    assert.equal(await one('select read_at is null from seller_notifications where id=$1',[ownNotification]),true,
      'An unrelated account cannot mark a customer notification read');
    await user(backup);
    await assert.rejects(db.query("select change_seller_order($1,'accept','')", [direct.id]), /Current approved|access required/i);
    await assert.rejects(db.query('select request_selected_alternative_booking($1,$2,$3,$4,$5)',
      [direct.id,posts[1],slot,randomUUID(),estimate]), /Cancelled direct booking required/);
    await user(first);
    await db.query("select change_seller_order($1,'reject','Cannot attend')", [direct.id]);
    await root();
    const ended = await one('select to_jsonb(o) from partner_orders o where id=$1', [direct.id]);
    assert.equal(ended.partner_id, apps[0]);
    assert.equal(ended.status, 'cancelled');
    assert.equal(Number(await one("select count(*) from service_booking_offers where order_id=$1 and status='offered'", [direct.id])), 0);
    await user(outsider);
    await assert.rejects(db.query('select request_selected_alternative_booking($1,$2,$3,$4,$5)',
      [direct.id,posts[1],slot,randomUUID(),estimate]), /Cancelled direct booking required/);
    await user(customer);
    await assert.rejects(db.query('select request_selected_alternative_booking($1,$2,$3,$4,$5)',
      [direct.id,posts[1],slot,randomUUID(),{ ...estimate,totalPaise:1 }]), /price changed/);
    const alternative = await one('select to_jsonb(request_selected_alternative_booking($1,$2,$3,$4,$5))',
      [direct.id,posts[1],slot,randomUUID(),estimate]);
    assert.notEqual(alternative.id,direct.id);
    assert.equal(alternative.partner_id,apps[1]);
    assert.equal((await one('select status from partner_orders where id=$1',[direct.id])),'cancelled');
    await assert.rejects(db.query('select request_selected_alternative_booking($1,$2,$3,$4,$5)',
      [direct.id,posts[2],slot,randomUUID(),estimate]), /service_one_active_alternative/);
    const booked = await one('select to_jsonb(request_find_professional_booking($1,$2,$3,$4))',
      ['Electrician','Bhopal',slot,randomUUID()]);
    assert.equal(booked.match_mode,'find_professional');
    const firstSmartPartner = booked.partner_id;
    await user(ids[apps.indexOf(firstSmartPartner)+1]);
    await db.query("select change_seller_order($1,'reject','Cannot attend')", [booked.id]);
    await root();
    const reassigned = await one('select to_jsonb(o) from partner_orders o where id=$1', [booked.id]);
    assert.notEqual(reassigned.partner_id,firstSmartPartner);
    const assignedOwner = ids[apps.indexOf(reassigned.partner_id)+1];
    assert.equal(reassigned.status, 'requested');
    assert.equal(Number(await one("select count(*) from service_booking_offers where order_id=$1 and status='offered'", [booked.id])), 1);
    await user(ids[apps.indexOf(firstSmartPartner)+1]);
    await assert.rejects(db.query("select change_seller_order($1,'accept','')", [booked.id]), /Current approved|access required/i);
    await user(assignedOwner);
    const acceptAttempts = await Promise.allSettled([db.query("select change_seller_order($1,'accept','')", [booked.id]), db.query("select change_seller_order($1,'accept','')", [booked.id])]);
    assert.ok(acceptAttempts.some(result => result.status === 'fulfilled'));
    assert.ok(acceptAttempts.every(result => result.status === 'fulfilled' || /Current unexpired Service Partner offer required/.test(result.reason.message)));
    assert.equal(Number(await one("select count(*) from service_booking_offers where order_id=$1 and status='accepted'", [booked.id])), 1);
    await user(customer);
    assert.equal(Number(await one("select count(*) from seller_notifications where order_id=$1 and title='Professional accepted your request'",[booked.id])),1);
    assert.equal(Number(await one("select count(*) from seller_notifications where order_id=$1 and title='Booking updated'",[booked.id])),0,
      'The accepted event should replace the generic legacy notification');
    await user(assignedOwner);
    await db.query("select change_seller_order($1,'on_the_way','')", [booked.id]);
    assert.equal(await one('select journey_status from partner_orders where id=$1', [booked.id]), 'on_the_way');
    await user(customer);
    await assert.rejects(db.query("select change_seller_order($1,'on_the_way','')", [booked.id]), /Accepted Service Partner booking required/);
    await root();
    await db.query("update partner_posts set details=jsonb_set(details,'{serviceCharge}','\"300\"'::jsonb) where id=$1", [posts[1]]);
    await db.query("update partner_availability set confirmed_at=clock_timestamp()+interval '1 minute' where partner_id=$1", [apps[1]]);
    await user(customer);
    const optedKey = randomUUID();
    const opted = await one('select to_jsonb(request_professional_booking($1,$2,$3,true,$4))',
      [posts[0],slot,optedKey,'Bhopal']);
    assert.equal(opted.partner_id,apps[0]);
    assert.equal(opted.backup_opt_in,true);
    await assert.rejects(db.query('select request_professional_booking($1,$2,$3,false,$4)',
      [posts[0],slot,optedKey,'Bhopal']),/different backup choice/);
    assert.equal(Number(await one('select extract(epoch from (response_due_at-created_at))::integer from partner_orders where id=$1',[opted.id])),60);
    await user(first);
    await db.query("select change_seller_order($1,'reject','Cannot attend')",[opted.id]);
    await root();
    const backupOffer = await one('select to_jsonb(o) from partner_orders o where id=$1',[opted.id]);
    assert.equal(backupOffer.partner_id,apps[1]);
    assert.equal(backupOffer.status,'requested');
    assert.equal(Number(await one("select count(*) from service_booking_offers where order_id=$1 and status='offered'",[opted.id])),1);
    await user(backup);
    assert.equal(Number(await one("select count(*) from seller_notifications where order_id=$1 and account_id=$2 and title='New booking request'", [opted.id, backup])), 1);
    await db.query("select change_seller_order($1,'accept','')",[opted.id]);
    const pendingPrice = await one('select to_jsonb(o) from partner_orders o where id=$1',[opted.id]);
    assert.equal(pendingPrice.status,'requested');
    assert.equal(pendingPrice.backup_price_approval_pending,true);
    assert.equal(Number(await one("select count(*) from seller_notifications where order_id=$1 and title='Waiting for customer backup-price approval'",[opted.id])),1);
    await user(customer);
    assert.equal(Number(await one("select count(*) from seller_notifications where order_id=$1 and title='Review backup professional price'",[opted.id])),1);
    await user(backup);
    assert.notEqual(pendingPrice.details.initialEstimate.totalPaise,pendingPrice.details.backupEstimate.totalPaise);
    await assert.rejects(db.query("select change_seller_order($1,'accept','')",[opted.id]),/awaiting customer approval/);
    await root();
    await db.query('select enqueue_due_maintenance(clock_timestamp())');
    assert.equal(Number(await one("select count(*) from background_jobs where related_entity_id=$1 and job_type='partner_order_expiry' and status in ('pending','retry_scheduled','running')",[opted.id])),0,
      'Maintenance must not recreate an expiry while customer price approval is pending');
    const stalePriceJob=randomUUID();
    await db.query(`insert into background_jobs(id,job_type,related_entity_type,related_entity_id,scheduled_at,status,max_attempts,lock_owner,deduplication_key,entity_version)
      values($1,'partner_order_expiry','partner_orders',$2,clock_timestamp()-interval '31 minutes','running',6,'fixture-worker',$3,$4)`,
      [stalePriceJob,opted.id,`order:${opted.id}:stale-price-fixture`,pendingPrice.automation_version]);
    assert.equal(await one("select execute_background_job($1,'fixture-worker',null,clock_timestamp())",[stalePriceJob]),'cancelled');
    assert.equal(await one('select status from partner_orders where id=$1',[opted.id]),'requested');
    assert.equal(await one('select backup_price_approval_pending from partner_orders where id=$1',[opted.id]),true);
    await db.query('select enqueue_due_maintenance(clock_timestamp())');
    assert.equal(Number(await one("select count(*) from background_jobs where related_entity_id=$1 and job_type='partner_order_expiry' and status in ('pending','retry_scheduled','running')",[opted.id])),0);
    await user(outsider);
    assert.equal(Number(await one('select count(*) from seller_notifications where order_id=$1',[opted.id])),0,
      'Unrelated accounts must not read booking notifications');
    await assert.rejects(db.query('select customer_respond_backup_price($1,true,$2)',[opted.id,pendingPrice.details.backupEstimate]),/Customer backup-price approval required/);
    await user(customer);
    await assert.rejects(db.query('select customer_respond_backup_price($1,true,$2)',[opted.id,estimate]),/Review the current backup price/);
    await db.query('select customer_respond_backup_price($1,true,$2)',[opted.id,pendingPrice.details.backupEstimate]);
    assert.equal(await one('select status from partner_orders where id=$1',[opted.id]),'accepted');
    assert.equal(await one('select backup_price_approval_pending from partner_orders where id=$1',[opted.id]),false);
    assert.equal(Number(await one("select count(*) from seller_notifications where order_id=$1 and title='Backup price approved; booking confirmed'",[opted.id])),1);
    await root();
    const wrongCategoryPost=randomUUID();
    await db.query("insert into partner_posts(id,partner_id,role,status,details) values($1,$2,'professional','published',$3)",
      [wrongCategoryPost,apps[2],{postType:'offering',title:'Unrelated category',category:'Automobile',service:'Electrician',serviceCharge:'200',visitingCharge:'50',pricingType:'Fixed Price',quantity:1,taxInclusive:false}]);
    await user(customer);
    const directTimeout = await one('select to_jsonb(request_professional_booking($1,$2,$3,false,$4))', [posts[0],new Date(Date.now()+172800000).toISOString(),randomUUID(),'Bhopal']);
    const timeoutOrder = await one('select to_jsonb(request_professional_booking($1,$2,$3,true,$4))', [posts[0],new Date(Date.now()+172800000).toISOString(),randomUUID(),'Bhopal']);
    await root();
    for (const order of [directTimeout,timeoutOrder]) {
      await db.query("update service_booking_offers set expires_at=clock_timestamp()-interval '1 second' where order_id=$1 and status='offered'", [order.id]);
      await db.query("update partner_orders set response_due_at=clock_timestamp()-interval '1 second',status='requested' where id=$1", [order.id]);
    }
    await user(first);
    await assert.rejects(db.query("select change_seller_order($1,'accept','')",[timeoutOrder.id]),/unexpired Service Partner offer/);
    await root();
    await db.query("update service_booking_offers set status='expired' where order_id=$1 and status='offered'",[timeoutOrder.id]);
    await user(first);
    await assert.rejects(db.query("select change_seller_order($1,'accept','')",[timeoutOrder.id]),/unexpired Service Partner offer/,
      'A stale notification cannot fall back to legacy Accept after its offer closes');
    await root();
    await db.query("update service_booking_offers set status='offered' where order_id=$1 and status='expired'",[timeoutOrder.id]);
    assert.equal(await one('select partner_id from partner_orders where id=$1',[timeoutOrder.id]),apps[0]);
    await db.query("delete from background_jobs where related_entity_id=$1 and job_type='partner_order_expiry' and status='pending'",[timeoutOrder.id]);
    await db.query('select enqueue_due_maintenance(clock_timestamp())');
    const recovered = await one("select to_jsonb(j) from background_jobs j where related_entity_id=$1 and job_type='partner_order_expiry' and status='pending'",[timeoutOrder.id]);
    assert.equal(await one('select j.scheduled_at=o.response_due_at from background_jobs j join partner_orders o on o.id=j.related_entity_id::uuid where j.id=$1',[recovered.id]),true,
      'Missing offer job must use the current response deadline, not the legacy 30-minute deadline');
    await db.query('select enqueue_due_maintenance(clock_timestamp())');
    assert.equal(Number(await one("select count(*) from background_jobs where related_entity_id=$1 and job_type='partner_order_expiry' and status='pending'",[timeoutOrder.id])),1,
      'Repeated maintenance must not duplicate an offer expiry job');
    const directJob = await one("select id from background_jobs where related_entity_id=$1 and job_type='partner_order_expiry' and status='pending' order by created_at desc limit 1", [directTimeout.id]);
    await db.query("update background_jobs set status='running',lock_owner='fixture-worker' where id=$1", [directJob]);
    assert.equal(await one("select execute_background_job($1,'fixture-worker',null,clock_timestamp())", [directJob]), 'succeeded');
    const directTimed = await one('select to_jsonb(o) from partner_orders o where id=$1', [directTimeout.id]);
    assert.equal(directTimed.status,'cancelled');
    assert.equal(directTimed.partner_id,apps[0]);
    const job = await one("select id from background_jobs where related_entity_id=$1 and job_type='partner_order_expiry' and status='pending' order by created_at desc limit 1", [timeoutOrder.id]);
    await db.query("update background_jobs set status='running',lock_owner='fixture-worker' where id=$1", [job]);
    assert.equal(await one("select execute_background_job($1,'fixture-worker',null,clock_timestamp())", [job]), 'succeeded');
    const timed = await one('select to_jsonb(o) from partner_orders o where id=$1', [timeoutOrder.id]);
    assert.equal(timed.status, 'requested');
    assert.notEqual(timed.partner_id,timeoutOrder.partner_id);
    assert.equal(Number(await one("select count(*) from seller_notifications where order_id=$1 and title='Your booking offer expired; it can no longer be accepted'",[timeoutOrder.id])),1);
    assert.equal(Number(await one("select count(*) from seller_notifications where order_id=$1 and title='Your request was offered to a backup professional'",[timeoutOrder.id])),1);
    const offerCount = Number(await one('select count(*) from service_booking_offers where order_id=$1',[timeoutOrder.id]));
    const duplicateJob=randomUUID();
    await db.query(`insert into background_jobs(id,job_type,related_entity_type,related_entity_id,scheduled_at,status,max_attempts,lock_owner,deduplication_key,entity_version)
      values($1,'partner_order_expiry','partner_orders',$2,clock_timestamp()-interval '1 minute','running',6,'fixture-worker',$3,$4)`,
      [duplicateJob,timeoutOrder.id,`order:${timeoutOrder.id}:duplicate-fixture`,timeoutOrder.automation_version]);
    assert.equal(await one("select execute_background_job($1,'fixture-worker',null,clock_timestamp())",[duplicateJob]),'cancelled');
    assert.equal(Number(await one('select count(*) from service_booking_offers where order_id=$1',[timeoutOrder.id])),offerCount);
    assert.equal(Number(await one("select count(*) from service_booking_offers where order_id=$1 and status='offered'",[timeoutOrder.id])),1);
    await user(ids[apps.indexOf(timed.partner_id)+1]);
    await db.query("select change_seller_order($1,'reject','Cannot attend')",[timeoutOrder.id]);
    await root();
    const thirdOffer = await one('select to_jsonb(o) from partner_orders o where id=$1',[timeoutOrder.id]);
    assert.equal(thirdOffer.post_id,posts[2]);
    assert.equal(Number(await one('select max(sequence) from service_booking_offers where order_id=$1',[timeoutOrder.id])),3);
    await user(third);
    await db.query("select change_seller_order($1,'reject','Cannot attend')",[timeoutOrder.id]);
    assert.equal(await one('select status from partner_orders where id=$1',[timeoutOrder.id]),'cancelled');
    await root();
    await db.exec('update service_match_config set response_seconds=120 where id=true');
    await db.exec('update automation_configuration set scheduler_expected_seconds=60 where id=true');
    await user(customer);
    const configured = await one('select to_jsonb(request_professional_booking($1,$2,$3,true,$4))',
      [posts[0],new Date(Date.now()+259200000).toISOString(),randomUUID(),'Bhopal']);
    assert.ok((Date.parse(configured.response_due_at)-Date.parse(configured.created_at))/1000>=119);
    assert.ok((Date.parse(configured.response_due_at)-Date.parse(configured.created_at))/1000<=121);
    assert.notEqual(await one('select status from partner_orders where id=$1', [booked.id]), 'completed');
    await user(outsider);
    await assert.rejects(db.query('select report_service_booking_issue($1,$2)', [booked.id,'A real service issue']), /Customer Service Partner booking required/);
    await user(customer);
    const earlyIssue = await one('select to_jsonb(report_service_booking_issue($1,$2))', [booked.id,'Professional has not arrived yet']);
    assert.equal(earlyIssue.partner_order_id, booked.id, 'Pre-completion issue links to the actual order');
    const cancelledIssue = await one("insert into support_tickets(customer_id,partner_order_id,category,description) values($1,$2,'Booking','Please review my cancelled booking') returning partner_order_id", [customer,directTimeout.id]);
    assert.equal(cancelledIssue, directTimeout.id, 'Cancelled orders remain linkable for support');
    await root();
    await db.query("update partner_orders set status='completed' where id=$1", [booked.id]);
    await user(customer);
    const issue = await one('select to_jsonb(report_service_booking_issue($1,$2))', [booked.id,'Work area was not cleaned']);
    assert.equal(issue.partner_order_id, booked.id);
    await user(admin);
    await db.query("select admin_follow_up_service_issue($1,'in_progress','Called customer and requested details')", [issue.id]);
    assert.equal(await one('select status from support_tickets where id=$1', [issue.id]), 'in_progress');
    assert.equal(await one('select verified_at is null from customer_service_verification where partner_id=$1', [apps[0]]), true);
    await user(outsider);
    await assert.rejects(db.query('select admin_verify_service_documents($1,$2)', [apps[0],'review-12345']), /Admin verification required/);
    await user(admin);
    await db.query('select admin_verify_service_documents($1,$2)', [apps[0],'review-12345']);
    assert.equal(await one('select verified_at is not null from customer_service_verification where partner_id=$1', [apps[0]]), true);
    assert.equal(await one('select verified_at is null from customer_service_verification where partner_id=$1', [apps[1]]), true);
    await user(customer);
    const intakeKey=randomUUID(), intakeAddress='12 Arera Colony, Bhopal', intakeRequirement='Repair the bedroom fan switch';
    const intakeArgs=[posts[0],new Date(Date.now()+86400000).toISOString(),intakeKey,false,'Bhopal',intakeAddress,intakeRequirement];
    const intakeOrder=await one('select to_jsonb(request_professional_booking_with_intake($1,$2,$3,$4,$5,$6,$7))',intakeArgs);
    assert.equal((await one('select get_service_booking_intake($1)',[intakeOrder.id])).address,intakeAddress);
    assert.equal((await one('select to_jsonb(request_professional_booking_with_intake($1,$2,$3,$4,$5,$6,$7))',intakeArgs)).id,intakeOrder.id);
    await root();
    assert.equal(Number(await one('select count(*) from eazily_private.service_booking_intake where order_id=$1',[intakeOrder.id])),1);
    await user(customer);
    await assert.rejects(db.query('select request_professional_booking_with_intake($1,$2,$3,$4,$5,$6,$7)',[...intakeArgs.slice(0,6),'Different work requirement']),/different service details/);
    await user(outsider);
    await assert.rejects(db.query('select get_service_booking_intake($1)',[intakeOrder.id]),/not available/);
    await assert.rejects(db.query('select * from eazily_private.service_booking_intake'),/permission denied/);
    await user(backup);
    await assert.rejects(db.query('select get_service_booking_intake($1)',[intakeOrder.id]),/not available/);
    await user(first);
    assert.deepEqual(await one('select get_service_booking_intake($1)',[intakeOrder.id]),{requirement:intakeRequirement});
    await db.query("select change_seller_order($1,'accept','')",[intakeOrder.id]);
    assert.equal((await one('select get_service_booking_intake($1)',[intakeOrder.id])).address,intakeAddress);
    await user(admin);
    assert.equal((await one('select get_service_booking_intake($1)',[intakeOrder.id])).address,intakeAddress);
    await root();
    await db.query('insert into eazily_private.service_booking_intake(order_id,address,requirement) values($1,$2,$3)',
      [directTimeout.id,intakeAddress,intakeRequirement]);
    await user(customer);
    const replacementEstimate=await one('select service_booking_estimate($1)',[posts[1]]);
    const replacement=await one('select to_jsonb(request_selected_alternative_booking($1,$2,$3,$4,$5))',
      [directTimeout.id,posts[1],new Date(Date.now()+86400000).toISOString(),randomUUID(),replacementEstimate]);
    assert.equal((await one('select get_service_booking_intake($1)',[replacement.id])).address,intakeAddress);
    await user(backup);
    assert.deepEqual(await one('select get_service_booking_intake($1)',[replacement.id]),{requirement:intakeRequirement});
    await user(customer);
    const generalKey=randomUUID(), generalSlot=new Date(Date.now()+172800000).toISOString();
    const generalDetails={city:'Bhopal',location:'14 MP Nagar, Bhopal',description:'Repair two loose switches',preferredSlot:generalSlot};
    const general=await one('select to_jsonb(submit_request($1,$2,$3,$4,$5,$6))',
      ['manpower','Electrician','service',generalDetails,generalKey,null]);
    assert.equal(general.assigned_vendor_id,null,'Partner offers must not fake a legacy vendor assignment');
    const generalOrder=await one('select to_jsonb(o) from partner_orders o where o.source_request_id=$1',[general.id]);
    assert.equal(generalOrder.request_key,generalKey);
    assert.equal(generalOrder.match_mode,'find_professional');
    assert.equal(generalOrder.status,'requested');
    assert.ok(apps.includes(generalOrder.partner_id),'Only an approved matching Service Partner receives the offer');
    const requestTicket = await one("insert into support_tickets(customer_id,booking_id,category,description) values($1,$2,'Booking','Please help with my pending request') returning id", [customer,general.id]);
    const orderTicket = await one("insert into support_tickets(customer_id,partner_order_id,category,description) values($1,$2,'Booking','Please help with my requested order') returning id", [customer,generalOrder.id]);
    assert.equal(await one('select booking_id from support_tickets where id=$1', [requestTicket]), general.id);
    assert.equal(await one('select partner_order_id from support_tickets where id=$1', [orderTicket]), generalOrder.id);
    await user(outsider);
    await assert.rejects(db.query("insert into support_tickets(customer_id,booking_id,category,description) values($1,$2,'Booking','Request belongs to another customer')", [outsider,general.id]), /Customer service request required/);
    await assert.rejects(db.query("insert into support_tickets(customer_id,partner_order_id,category,description) values($1,$2,'Booking','Order belongs to another customer')", [outsider,generalOrder.id]), /Customer partner order required/);
    await assert.rejects(db.query("insert into support_tickets(customer_id,booking_id,category,description) values($1,$2,'Booking','Forged customer identity on ticket')", [customer,general.id]), /row-level security|permission denied/i);
    assert.equal(Number(await one('select count(*) from support_tickets where id in ($1,$2)', [requestTicket,orderTicket])), 0, 'Other customers cannot read linked tickets');
    await user(admin);
    assert.equal(Number(await one('select count(*) from support_tickets where id in ($1,$2)', [requestTicket,orderTicket])), 2, 'Admin queue retains both linked tickets');
    await assert.rejects(db.query('update support_tickets set partner_order_id=$1 where id=$2', [generalOrder.id,requestTicket]), /booking link cannot be changed/);
    await root();
    assert.equal(Number(await one('select count(*) from seller_leads where order_id=$1',[generalOrder.id])),1);
    await user(customer);
    assert.equal(Number(await one("select count(*) from service_booking_offers where order_id=$1 and status='offered'",[generalOrder.id])),1);
    assert.equal((await one('select get_service_booking_intake($1)',[generalOrder.id])).address,generalDetails.location);
    await db.query('select submit_request($1,$2,$3,$4,$5,$6)',
      ['manpower','Electrician','service',generalDetails,generalKey,null]);
    assert.equal(Number(await one('select count(*) from partner_orders where source_request_id=$1',[general.id])),1);
    const unmatched=await one('select to_jsonb(submit_request($1,$2,$3,$4,$5,$6))',
      ['manpower','Home Tutor','service',generalDetails,randomUUID(),null]);
    assert.equal(unmatched.status,'pending');
    assert.equal(Number(await one('select count(*) from partner_orders where source_request_id=$1',[unmatched.id])),0);
    const blood=await one('select to_jsonb(submit_request($1,$2,$3,$4,$5,$6))',
      ['blood-bank','Blood Donation','blood',generalDetails,randomUUID(),null]);
    assert.equal(Number(await one('select count(*) from partner_orders where source_request_id=$1',[blood.id])),0);
    const loan=await one('select to_jsonb(submit_request($1,$2,$3,$4,$5,$6))',
      ['loans','Personal Loan','loan',{fullName:'Customer Test',phone:'9876543210',address:'Bhopal',occupation:'Employee',income:25000,amount:100000,consent:true},randomUUID(),null]);
    assert.equal(Number(await one('select count(*) from partner_orders where source_request_id=$1',[loan.id])),0);
    const logistics=await one('select to_jsonb(submit_request($1,$2,$3,$4,$5,$6))',
      ['transportation','Packers & Movers','transportation',{fullName:'Customer Test',phone:'9876543210',address:'Bhopal',pickup:'Bhopal',drop:'Indore',shipmentSize:'1 BHK',transportMode:'Local'},randomUUID(),null]);
    assert.equal(Number(await one('select count(*) from partner_orders where source_request_id=$1',[logistics.id])),0);
    const bulk=await one('select to_jsonb(submit_request($1,$2,$3,$4,$5,$6))',
      ['bulk-orders','Electrician','service',generalDetails,randomUUID(),null]);
    assert.equal(Number(await one('select count(*) from partner_orders where source_request_id=$1',[bulk.id])),0);
    await root();
    await db.exec('update automation_configuration set scheduler_expected_seconds=180 where id=true');
    await user(customer);
    const deferred=await one('select to_jsonb(submit_request($1,$2,$3,$4,$5,$6))',
      ['manpower','Electrician','service',generalDetails,randomUUID(),null]);
    assert.equal(deferred.status,'pending');
    assert.equal(Number(await one('select count(*) from partner_orders where source_request_id=$1',[deferred.id])),0);
    assert.equal(Number(await one("select count(*) from notification_outbox where 'push'=any(channels)")),0,
      'Local Smart Match events must not queue unconfigured background push');
    await root();
    await db.exec('update automation_configuration set scheduler_expected_seconds=60 where id=true');
    await user(outsider);
    await assert.rejects(db.query('select eazily_private.try_route_general_service_request($1)',[deferred.id]),/permission denied/);
    assert.equal((await db.query('update partner_orders set source_request_id=$1 where id=$2 returning id',[deferred.id,generalOrder.id])).rows.length,0);
    console.log('PASS: Smart Match offers, expiry/recovery, price approval, plus eligible general-request routing, source-link idempotency, special-request exclusion, no-match fallback, and routing permissions.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
