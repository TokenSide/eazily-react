const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const manifest = require('../supabase/migration-manifest.json');

(async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  const one = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
  const asUser = async id => {
    await db.exec('reset role');
    await db.query("select set_config('test.uid',$1,false)", [id]);
    await db.exec('set role authenticated');
  };
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key,phone text,raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select current_user::text$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,owner_id text,created_at timestamptz default now());
      alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
      grant usage on schema auth,public,storage to anon,authenticated,service_role;
      grant all on storage.buckets,storage.objects to authenticated,service_role;
      alter default privileges in schema public grant all on tables to authenticated,anon;
      alter default privileges in schema public grant all on sequences to authenticated,anon;`);
    for (const migration of manifest.migrations) await db.exec(readFileSync(`supabase/${migration.file}`, 'utf8'));
    const [customer, outsider, staff, revokedStaff, admin] = Array.from({ length: 5 }, () => randomUUID());
    for (const id of [customer, outsider, staff, revokedStaff, admin]) await db.query('insert into auth.users(id,phone) values($1,$2)', [id,id]);
    await db.query("update profiles set role='admin' where id=$1", [admin]);
    await db.query("insert into staff_access(account_id,staff_role,permissions,active) values($1,'support',array['support.manage'],true),($2,'support',array['support.manage'],false)", [staff,revokedStaff]);
    const ticket = await one("insert into support_tickets(customer_id,category,description) values($1,'Booking','Please help with this request') returning id", [customer]);
    const screenshot = `${customer}/support/evidence.png`;
    const avatar = `${customer}/avatar.png`;
    const unlinked = `${customer}/support/unlinked.png`;
    const otherScreenshot = `${outsider}/support/other.png`;
    await db.query('update support_tickets set screenshot_path=$1 where id=$2', [screenshot,ticket]);
    for (const [name, owner] of [[screenshot,customer],[avatar,customer],[unlinked,customer],[otherScreenshot,outsider]]) {
      await db.query("insert into storage.objects(bucket_id,name,owner_id) values('profile-media',$1,$2)", [name,owner]);
    }
    await db.query("insert into support_tickets(customer_id,category,description,screenshot_path) values($1,'Other','Forged path',$2)", [customer,otherScreenshot]);
    await db.query('insert into support_ticket_replies(ticket_id,author_id,body) values($1,$2,$3)', [ticket,admin,'Earlier staff follow-up remains visible']);

    await asUser(customer);
    assert.equal(await one("select public from storage.buckets where id='profile-media'"), false);
    assert.equal(Number(await one('select count(*) from storage.objects where name=$1', [screenshot])), 1, 'Owner reads private screenshot');
    const first = await one("insert into support_ticket_replies(ticket_id,author_id,body,created_at) values($1,$2,'  Customer reply  ','2000-01-01') returning to_jsonb(support_ticket_replies)", [ticket,customer]);
    assert.equal(first.body, 'Customer reply');
    assert.ok(Date.parse(first.created_at) > Date.parse('2026-01-01'), 'Server replaces client-supplied timestamps');
    await assert.rejects(db.query("insert into support_ticket_replies(ticket_id,author_id,body) values($1,$2,'Forged staff reply')", [ticket,staff]), /row-level security|permission denied/i);
    await asUser(staff);
    assert.equal(Number(await one('select count(*) from storage.objects where name=$1', [screenshot])), 1, 'Support staff reads linked screenshot');
    for (const name of [avatar,unlinked,otherScreenshot]) {
      assert.equal(Number(await one('select count(*) from storage.objects where name=$1', [name])), 0, 'Staff cannot read other profile media or a forged cross-owner link');
    }
    assert.equal(Number(await one('select count(*) from support_ticket_replies where ticket_id=$1', [ticket])), 2);
    await db.query("insert into support_ticket_replies(ticket_id,author_id,body) values($1,$2,'We are reviewing your issue')", [ticket,staff]);
    await asUser(outsider);
    assert.equal(Number(await one('select count(*) from storage.objects where name=$1', [screenshot])), 0, 'Another customer cannot read screenshot');
    assert.equal(Number(await one('select count(*) from support_ticket_replies where ticket_id=$1', [ticket])), 0);
    await assert.rejects(db.query("insert into support_ticket_replies(ticket_id,author_id,body) values($1,$2,'Unauthorized reply')", [ticket,outsider]), /row-level security|permission denied/i);
    await asUser(revokedStaff);
    assert.equal(Number(await one('select count(*) from storage.objects where name=$1', [screenshot])), 0, 'Revoked staff cannot read screenshot');
    assert.equal(Number(await one('select count(*) from support_ticket_replies where ticket_id=$1', [ticket])), 0);
    await assert.rejects(db.query("insert into support_ticket_replies(ticket_id,author_id,body) values($1,$2,'Revoked staff reply')", [ticket,revokedStaff]), /row-level security|permission denied/i);
    await asUser(customer);
    assert.deepEqual((await db.query('select body from support_ticket_replies where ticket_id=$1 order by created_at,id', [ticket])).rows.map(row => row.body),
      ['Earlier staff follow-up remains visible', 'Customer reply', 'We are reviewing your issue']);
    await asUser(admin);
    assert.equal(Number(await one('select count(*) from storage.objects where name=$1', [screenshot])), 1, 'Admin reads linked screenshot');
    assert.equal(Number(await one('select count(*) from support_ticket_replies where ticket_id=$1', [ticket])), 3);
    assert.deepEqual(await one('select jsonb_build_object(\'status\',status,\'priority\',priority) from support_tickets where id=$1', [ticket]),
      { status: 'open', priority: 'normal' }, 'Replies do not change ticket workflow fields');
    console.log('PASS: private screenshot owner/staff access, unrelated/forged-path denial, replies and workflow preservation');
  } finally {
    await db.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
