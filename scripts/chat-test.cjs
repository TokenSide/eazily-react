const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const assert = require('node:assert/strict');

(async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  const scalar = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
  const asUser = async id => { await db.exec('reset role'); await db.query("select set_config('test.uid',$1,false)", [id]); await db.exec('set role authenticated'); };
  const root = async () => { await db.exec('reset role'); await db.query("select set_config('test.uid','',false)"); };
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
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
    const migrations = ['schema','experience','wallet','partners','operations','seller_subscriptions','seller_pricing','seller_posting','seller_workspace','seller_finance_extensions','seller_hardening','seller_gateway','seller_subscriptions_v2','influencer_legal_2026_09_12','consultant_assessments','partner_dashboard_banners','realtime_events','chat_messaging'];
    for (const file of migrations) await db.exec(readFileSync(`supabase/${file}.sql`, 'utf8'));

    const customer = randomUUID(), serviceOwner = randomUUID(), influencerOwner = randomUUID(), consultantOwner = randomUUID();
    const outsider = randomUUID(), admin = randomUUID(), reviewer = randomUUID();
    for (const [id, name] of [[customer,'Sample Customer'],[serviceOwner,'Sample Service Partner'],[influencerOwner,'Sample Creator'],[consultantOwner,'Sample Consultant'],[outsider,'Unrelated Account'],[admin,'General Admin'],[reviewer,'Safety Reviewer']]) {
      await db.query('insert into auth.users(id,phone,raw_user_meta_data) values($1,$2,$3)', [id, id, { full_name: name }]);
      await db.query('update profiles set full_name=$2 where id=$1', [id, name]);
    }
    await db.query("update profiles set role='admin' where id=$1", [admin]);
    await db.query("insert into staff_access(account_id,staff_role,permissions) values($1,'support',array['chat.review'])", [reviewer]);
    const fixtures = [
      ['professional',serviceOwner,{businessName:'Bhopal Home Care'},'Plumbing visit'],
      ['influencer',influencerOwner,{creatorName:'Sample Bhopal Creator'},'Creator collaboration'],
      ['consultant',consultantOwner,{name:'Sample Career Consultant'},'Career consultation']
    ];
    const posts = {};
    await db.exec('alter table partner_applications disable trigger user; alter table partner_posts disable trigger user');
    for (const [role, owner, details, title] of fixtures) {
      const app = randomUUID(), post = randomUUID(); posts[role] = { app, post, owner };
      await db.query("insert into partner_applications(id,customer_id,role,status,reviewed_at,details) values($1,$2,$3,'approved',now(),$4)", [app, owner, role, details]);
      await db.query("insert into partner_posts(id,partner_id,role,status,details) values($1,$2,$3,'published',$4)", [post, app, role, { title, service: title, postType: 'offering' }]);
    }
    await db.exec('alter table partner_applications enable trigger user; alter table partner_posts enable trigger user');

    const conversations = {};
    await asUser(customer);
    for (const role of Object.keys(posts)) {
      const key = randomUUID();
      conversations[role] = await scalar('select (start_chat($1,null,null,$2)).id', [posts[role].post, key]);
      const retry = await scalar('select (start_chat($1,null,null,$2)).id', [posts[role].post, key]);
      assert.equal(retry, conversations[role], `${role} profile start is idempotent`);
    }
    assert.equal((await scalar('select list_chat_conversations(null,null,30)')).length, 3, 'Customer sees all three role conversations');
    assert.equal(Number(await scalar('select count(*) from partner_orders')), 0, 'Starting profile chat does not create a booking or free introduction');

    const operation = randomUUID();
    const firstMessage = await scalar("select (send_chat_message($1,'Hello from customer','text',null,null,$2)).id", [conversations.professional, operation]);
    assert.equal(await scalar("select (send_chat_message($1,'Hello from customer','text',null,null,$2)).id", [conversations.professional, operation]), firstMessage, 'Message retry returns the same committed row');
    assert.equal(Number(await scalar('select count(*) from seller_messages where client_key=$1', [operation])), 1, 'Message idempotency key prevents duplicates');
    await asUser(serviceOwner);
    assert.equal((await scalar("select list_chat_conversations('professional',null,30)" )).length, 1, 'Service workspace sees only its own role');
    const reply = await scalar("select (send_chat_message($1,'Confirmed service reply','text',null,null,$2)).id", [conversations.professional, randomUUID()]);
    assert.equal(Number(await scalar("select get_chat_unread_total('professional')")), 1, 'Only incoming messages are unread');
    await scalar('select mark_chat_read($1,$2)', [conversations.professional, firstMessage]);
    assert.equal(Number(await scalar("select get_chat_unread_total('professional')")), 0, 'Read marker clears partner unread count');
    await asUser(customer);
    assert.equal(Number(await scalar('select get_chat_unread_total(null)')), 1, 'Customer unread count updates from partner reply');
    await scalar('select mark_chat_read($1,$2)', [conversations.professional, reply]);
    assert.equal(Number(await scalar('select get_chat_unread_total(null)')), 0);

    await scalar('select update_chat_preferences($1,true,null)', [conversations.professional]);
    assert.equal((await scalar('select list_chat_conversations(null,null,30)')).length, 2, 'Archived conversation leaves the active list');
    await asUser(serviceOwner);
    await scalar("select (send_chat_message($1,'New reply restores archived chat','text',null,null,$2)).id", [conversations.professional, randomUUID()]);
    await asUser(customer);
    assert.equal((await scalar('select list_chat_conversations(null,null,30)')).length, 3, 'A new message restores an archived conversation');

    await scalar('select set_chat_block($1,true)', [conversations.professional]);
    await asUser(serviceOwner);
    await assert.rejects(db.query("select send_chat_message($1,'Blocked send','text',null,null,$2)", [conversations.professional, randomUUID()]), /not open/, 'Blocked conversation rejects new messages');
    await asUser(customer);
    await scalar('select set_chat_block($1,false)', [conversations.professional]);

    const attachmentKey = randomUUID(), path = `${conversations.professional}/${customer}/${attachmentKey}.png`;
    await db.query("insert into storage.objects(bucket_id,name,owner_id) values('chat-attachments',$1,$2)", [path, customer]);
    const attachment = await scalar("select (register_chat_attachment($1,$2,'sample.png','image/png',12000,$3)).id", [conversations.professional, path, attachmentKey]);
    await scalar("select (send_chat_message($1,'Sample image','image',$2,null,$3)).id", [conversations.professional, attachment, randomUUID()]);
    const attachmentMessage = (await scalar('select get_chat_messages($1,null,100)', [conversations.professional])).at(-1);
    assert.equal(attachmentMessage.attachment.path, path, 'Private attachment metadata is linked to the message');

    const report = await scalar("select (report_chat($1,null,'privacy','Asked for private contact details')).id", [conversations.professional]);
    await asUser(outsider);
    assert.equal(Number(await scalar('select count(*) from seller_messages')), 0, 'Unrelated account cannot read message rows');
    assert.equal(Number(await scalar('select count(*) from storage.objects')), 0, 'Unrelated account cannot read private attachments');
    assert.equal(await scalar('select chat_can_access($1,$2)', [conversations.professional, customer]), false, 'Access predicate cannot be tricked with another account ID');
    await assert.rejects(db.query('select get_chat_messages($1,null,40)', [conversations.professional]), /access required/, 'Direct thread RPC rejects an unrelated account');
    await assert.rejects(db.query("insert into seller_messages(conversation_id,sender_id,body,client_key) values($1,$2,'Impersonation',$3)", [conversations.professional, customer, randomUUID()]), /permission denied/, 'Browser roles cannot bypass the RPC or impersonate a sender');
    await asUser(admin);
    assert.equal(Number(await scalar('select count(*) from chat_reports')), 0, 'General Admin status alone does not reveal chat reports');
    await assert.rejects(db.query('select open_reported_chat($1,$2)', [report, 'General admin review attempt']), /permission required/);
    await asUser(reviewer);
    assert.equal(Number(await scalar('select count(*) from chat_reports')), 1, 'Dedicated reviewer sees the report queue');
    await assert.rejects(db.query('select get_chat_messages($1,null,40)', [conversations.professional]), /access required/, 'Reviewer cannot read messages before recording a reason');
    assert.equal(await scalar('select open_reported_chat($1,$2)', [report, 'Investigating reported privacy concern']), conversations.professional);
    await scalar('select record_chat_staff_view($1,$2)', [conversations.professional, 'Investigating reported privacy concern']);
    assert.ok((await scalar('select get_chat_messages($1,null,40)', [conversations.professional])).length > 0, 'Time-limited audited grant allows read-only review');
    assert.equal(Number(await scalar('select count(*) from chat_staff_audit')), 2, 'Access grant and transcript view are both audited');
    await assert.rejects(db.query("select send_chat_message($1,'Staff must not send','text',null,null,$2)", [conversations.professional, randomUUID()]), /access required/, 'Support review access cannot send messages');

    await asUser(influencerOwner);
    assert.equal((await scalar("select list_chat_conversations('influencer',null,30)")).length, 1, 'Influencer inbox is role-isolated');
    await assert.rejects(db.query('select get_chat_messages($1,null,40)', [conversations.consultant]), /access required/, 'One partner type cannot open another partner thread');
    await asUser(consultantOwner);
    assert.equal((await scalar("select list_chat_conversations('consultant',null,30)")).length, 1, 'Consultant inbox is role-isolated');

    await root();
    await db.exec('set role anon');
    await assert.rejects(db.query('select count(*) from seller_messages'), /permission denied/, 'Public users cannot read messages');
    await root();
    const order = randomUUID();
    await db.query("insert into partner_orders(id,partner_id,customer_id,role,title) values($1,$2,$3,'professional','Order-linked chat')", [order, posts.professional.app, customer]);
    await db.query("update partner_orders set status='accepted' where id=$1", [order]);
    await asUser(outsider);
    await assert.rejects(db.query("select send_seller_message($1,'Legacy wrapper bypass',$2)", [order, randomUUID()]), /Order access required/, 'Legacy message wrapper checks membership before any side effect');
    await root();
    const orderConversation = await scalar('select id from chat_conversations where partner_order_id=$1', [order]);
    assert.ok(orderConversation, 'A booking automatically gets one linked conversation');
    assert.equal(Number(await scalar("select count(*) from seller_messages where conversation_id=$1 and message_type='system'", [orderConversation])), 1, 'Supported booking status emits a system message');
    assert.ok(Number(await scalar("select count(*) from realtime_events where scope='messages' and entity_id=$1", [conversations.professional])) > 0, 'Message changes emit participant invalidation envelopes');
    const envelopeColumns = (await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='realtime_events'")).rows.map(row => row.column_name);
    assert.ok(!envelopeColumns.includes('body') && !envelopeColumns.includes('payload'), 'Realtime envelope cannot contain message text or attachment data');
    assert.equal(await scalar('select retention_days from chat_configuration where id=true'), null, 'Retention remains explicitly pending rather than silently deleting messages');
    assert.equal(await scalar('select malware_scanning_enabled from chat_configuration where id=true'), false, 'Unavailable malware scanning is recorded honestly');
    console.log('PASS: three-role profile chat, order chat, idempotent sends, unread/read, archive restore, block, report, attachment privacy, support audit, role/RLS isolation, system events, and no implicit booking.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
