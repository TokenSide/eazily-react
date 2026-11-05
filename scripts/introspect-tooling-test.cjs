/* Validates scripts/introspect-remote.sql and scripts/compare-manifest.cjs against
 * the local PGlite fixture. Local PostgreSQL only: no network, no remote project.
 *
 * Replays the manifest into a throwaway database, runs the introspection SQL, and
 * feeds the result to the comparator so both tools are proven before either is
 * pointed at a hosted database.
 */
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const manifest = require('../supabase/migration-manifest.json');

(async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
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
    for (const entry of manifest.migrations) {
      await db.exec(readFileSync(`supabase/${entry.file}`, 'utf8'));
    }
    console.log(`Replayed ${manifest.migrations.length} manifest migrations into the local fixture.`);

    // The introspection query is a single read-only SELECT; run it verbatim.
    const introspection = readFileSync('scripts/introspect-remote.sql', 'utf8');
    const before = await db.query(`select count(*)::int as n from pg_class`);
    const result = await db.query(introspection);
    const after = await db.query(`select count(*)::int as n from pg_class`);
    assert.equal(after.rows[0].n, before.rows[0].n, 'introspection must not change the schema');

    const kinds = new Set(result.rows.map(r => r.object_kind));
    for (const required of ['relation', 'function', 'policy', 'trigger', 'grant:anon', 'function_grant:anon']) {
      assert.ok(kinds.has(required), `introspection should emit ${required}`);
    }
    assert.ok(result.rows.filter(r => r.object_kind === 'relation').length > 80, 'expected the full relation catalog');
    assert.ok(result.rows.filter(r => r.object_kind === 'function').length > 150, 'expected the full function catalog');
    assert.ok(result.rows.filter(r => r.object_kind === 'policy').length > 100, 'expected the policy catalog');

    const rlsOff = result.rows.filter(r => r.object_kind === 'rls_disabled');
    assert.equal(rlsOff.length, 0, `fixture must have RLS on every public table, found: ${rlsOff.map(r => r.object_name)}`);

    // Render to the CSV shape psql --csv emits, then run the real comparator.
    const quote = v => (/[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
    const csv = ['object_kind,object_name,detail', ...result.rows.map(r =>
      [r.object_kind, r.object_name, r.detail ?? ''].map(quote).join(','))].join('\n');
    mkdirSync('.tmp', { recursive: true });
    writeFileSync('.tmp/fixture-schema.csv', `${csv}\n`);

    const report = execFileSync(process.execPath, ['scripts/compare-manifest.cjs', '.tmp/fixture-schema.csv'], { encoding: 'utf8' });
    console.log('\n--- compare-manifest.cjs against the fully-applied fixture ---');
    console.log(report.trim());
    assert.match(report, /every object the manifest declares is present/, 'comparator should see a complete deployment');
  } finally {
    await db.close();
  }
  console.log('\nPASS: introspection is read-only, emits every catalog kind, and the comparator reads a real CSV.');
})().catch(error => { console.error(error); process.exitCode = 1; });