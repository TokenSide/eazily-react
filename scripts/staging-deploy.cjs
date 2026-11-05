// Manually ordered staging SQL only. Never use this against a different project.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const REF = 'ahwbgmnfmzsaiwjglbkb';
const manifest = require(path.join(ROOT, 'supabase/migration-manifest.json')).migrations;
const mode = process.argv[2];
const cli = process.env.EAZILY_SUPABASE_CLI || 'supabase';
const reportPath = path.join(ROOT, '.tmp/staging-deploy-result.json');
const report = {
  projectRef: REF, remoteState: 'unverified', applied: [], skipped: [], pending: [], hostedChecks: [],
  excludedSql: ['consumer_legal_drafts_2026_09_20.sql', 'consultant_legal_drafts_2026_09_20.sql'],
  failed: null, remoteVerified: false
};
let currentMigration = null;

function save() {
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
}
function stop(message) {
  report.failed = message;
  save();
  console.error(`STOP: ${message}`);
  console.error(`Applied this run: ${report.applied.length}; remaining manifest entries: ${report.pending.length}; remote state: ${report.remoteState}. Report: ${reportPath}`);
  process.exit(1);
}
function localCheck() {
  const linked = fs.readFileSync(path.join(ROOT, 'supabase/.temp/project-ref'), 'utf8').trim();
  if (linked !== REF || (process.env.SUPABASE_PROJECT_REF && process.env.SUPABASE_PROJECT_REF !== REF)) stop('Linked project reference differs from approved staging reference.');
  if (manifest.length !== 45) stop('Manifest length changed; review before applying.');
  const seen = new Set();
  for (let i = 0; i < manifest.length; i++) {
    const m = manifest[i];
    if (m.sequence !== i + 1 || !/^[a-z0-9_]+\.sql$/.test(m.file) || seen.has(m.file)) stop(`Invalid manifest entry ${i + 1}.`);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'supabase', m.file))).digest('hex');
    if (hash !== m.sha256) stop(`Local checksum mismatch: ${m.file}.`);
    if (!Array.isArray(m.requiredPredecessors) || m.requiredPredecessors.some(file => !seen.has(file))) stop(`Dependency order mismatch: ${m.file}.`);
    seen.add(m.file);
  }
  // Legal source-text drafts are maintained separately; this runner deploys only the 45 reviewed entries.
  const excludedDrafts = new Set(['consumer_legal_drafts_2026_09_20.sql', 'consultant_legal_drafts_2026_09_20.sql']);
  const diskFiles = fs.readdirSync(path.join(ROOT, 'supabase')).filter(file => file.endsWith('.sql'));
  if (diskFiles.some(file => !seen.has(file) && !excludedDrafts.has(file))) stop('Unexpected SQL file outside manifest.');
  report.pending = manifest.map(({ sequence, file, sha256 }) => ({ sequence, file, sha256 }));
  save();
  console.log(`Local check passed: ${manifest.length} ordered files, hashes and dependencies; linked ${REF}. Two legal draft-content SQL files are outside the manifest and will not be applied.`);
}
function command(args) {
  const r = spawnSync(cli, args, { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
  if (r.error || r.status !== 0) {
    if (currentMigration) report.remoteState = `unknown during ${currentMigration}; inspect before retrying`;
    throw new Error(`Supabase CLI failed at ${args.slice(0, 2).join(' ')}; inspect remote state before retrying. No CLI output or credentials were logged.`);
  }
  return r.stdout || '';
}
function query(sql) {
  if (fs.readFileSync(path.join(ROOT, 'supabase/.temp/project-ref'), 'utf8').trim() !== REF) stop('Linked project changed during deployment.');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'eazily-staging-'));
  const file = path.join(folder, 'query.sql');
  try {
    fs.writeFileSync(file, sql, { mode: 0o600 });
    return command(['db', 'query', '--linked', '--file', file]);
  } finally {
    fs.unlinkSync(file);
    fs.rmdirSync(folder);
  }
}
function checkErrorStop() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'eazily-staging-'));
  const file = path.join(folder, 'probe.sql');
  try {
    fs.writeFileSync(file, "select 1/0; select 'EAZILY_UNSAFE_CONTINUE';\n", { mode: 0o600 });
    const r = spawnSync(cli, ['db', 'query', '--linked', '--file', file],
      { cwd: ROOT, encoding: 'utf8', windowsHide: true, timeout: 30000 });
    if (r.error || r.status === 0 || (r.stdout || '').includes('EAZILY_UNSAFE_CONTINUE'))
      throw new Error('CLI did not prove stop-on-first-SQL-error behavior; no migration was attempted.');
  } finally {
    fs.unlinkSync(file);
    fs.rmdirSync(folder);
  }
}
function marker(output, name) {
  const match = output.match(new RegExp(`EAZILY_${name}:([^\\r\\n|]+)`));
  if (!match) stop(`Could not parse ${name} query result; remote state needs manual inspection.`);
  return match[1].trim();
}
function ledger() {
  const rows = query("select 'EAZILY_LEDGER:' || sequence || ',' || filename || ',' || sha256 from eazily_deploy.migration_history order by sequence;");
  const found = [...rows.matchAll(/EAZILY_LEDGER:(\d+),([a-z0-9_]+\.sql),([a-f0-9]{64})/g)].map(m => ({ sequence: Number(m[1]), file: m[2], sha256: m[3] }));
  if (new Set(found.map(row => row.sequence)).size !== found.length) stop('Duplicate ledger rows detected.');
  for (let i = 0; i < found.length; i++) {
    const expected = manifest[i];
    if (!expected || found[i].sequence !== expected.sequence || found[i].file !== expected.file || found[i].sha256 !== expected.sha256) stop(`Remote ledger is not an exact manifest prefix at entry ${i + 1}.`);
  }
  return found;
}
function status() {
  const found = ledger();
  report.remoteState = `verified ledger prefix ${found.length}/45`;
  report.skipped = found;
  report.pending = manifest.slice(found.length).map(({ sequence, file, sha256 }) => ({ sequence, file, sha256 }));
  save();
  return found;
}
function verifyHosted() {
  const sql = `select 'EAZILY_CHECK:' || name || ':' || ok::text from (values
    ('history', (select count(*) = 45 from eazily_deploy.migration_history)),
    ('private_ledger', not has_schema_privilege('anon','eazily_deploy','USAGE')
      and not has_schema_privilege('authenticated','eazily_deploy','USAGE')),
    ('rls', (select count(*) = 0 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p') and not c.relrowsecurity)),
    ('grants', has_table_privilege('authenticated','public.profiles','SELECT')
      and has_table_privilege('anon','public.categories','SELECT')
      and has_table_privilege('authenticated','public.categories','SELECT')),
    ('category_seeds', (select count(*) = 6 from public.categories
      where slug in ('manpower','loans','influencers','consultancy','transportation','blood-bank'))),
    ('legal_drafts', (select count(*) = 0 from public.legal_documents where published and (
      document_key in ('eazily-influencer-provider-terms','eazily-influencer-provider-privacy-policy',
        'eazily-service-partner-terms','eazily-service-partner-privacy-policy',
        'eazily-consultant-provider-terms','eazily-consultant-provider-privacy-policy',
        'eazily-consumer-terms','eazily-consumer-privacy-policy') or content like '%[UNRESOLVED%'))),
    ('draft_rows', (select count(*) = 6 from public.legal_documents where not published and document_key in
      ('eazily-influencer-provider-terms','eazily-influencer-provider-privacy-policy',
       'eazily-consultant-provider-terms','eazily-consultant-provider-privacy-policy',
       'eazily-consumer-terms','eazily-consumer-privacy-policy'))),
    ('private_storage', (select count(*) = 3 and bool_and(not public) from storage.buckets
      where id in ('partner-media','profile-media','chat-attachments'))),
    ('automation_off', (select not (enabled or notification_delivery_enabled or workbook_loan_enabled
      or workbook_logistics_enabled or payment_reconciliation_enabled or refund_submission_enabled
      or payout_submission_enabled or booking_attention_enabled or urgent_ticket_attention_enabled)
      from public.automation_configuration where id=true)),
    ('subscriptions_off', (select not (enabled or rollout_enabled or payment_checkout_enabled)
      from public.seller_subscription_config where id=true)),
    ('pricing_off', (select count(*) = 0 from public.seller_pricing_rules where enabled)),
    ('plans_off', (select count(*) = 0 from public.seller_plans where enabled)),
    ('rewards_off', (select not enabled from public.seller_reward_config where id=true)),
    ('cashfree_off', (select not cashfree_enabled from public.partner_config where id=true)),
    ('auto_publish_off', (select not auto_publish_enabled from public.service_post_approval_config where id=true))
  ) checks(name,ok);`;
  const output = query(sql);
  const names = ['history','private_ledger','rls','grants','category_seeds','legal_drafts','draft_rows',
    'private_storage','automation_off','subscriptions_off','pricing_off','plans_off','rewards_off',
    'cashfree_off','auto_publish_off'];
  report.hostedChecks = names.map(name => {
    const value = output.match(new RegExp(`EAZILY_CHECK:${name}:(true|false)`));
    return { name, passed: value?.[1] === 'true' };
  });
  report.remoteVerified = report.hostedChecks.every(check => check.passed);
  save();
  for (const check of report.hostedChecks) console.log(`${check.passed ? 'PASS' : 'FAIL'}: ${check.name}`);
  if (!report.remoteVerified) stop('One or more hosted read-only checks failed or returned no row.');
}
try {
  if (!['--check-local', '--apply'].includes(mode)) stop('Use --check-local or --apply.');
  localCheck();
  if (mode === '--check-local') process.exit(0);
  const version = command(['--version']);
  if (!version.trim()) stop('Supabase CLI version unavailable.');
  const help = command(['db', 'query', '--help']);
  if (!help.includes('--linked') || !help.includes('--file')) stop('CLI does not support linked file queries.');
  const projectResult = JSON.parse(command(['projects', 'list', '--output', 'json']));
  const projects = Array.isArray(projectResult) ? projectResult : projectResult.projects;
  if (!Array.isArray(projects)) stop('Project list format not recognized.');
  const project = projects.find(p => (p.id || p.ref) === REF);
  if (!project || !/staging/i.test(project.name || '')) stop('Approved staging project identity not present in CLI project list.');
  checkErrorStop(); // Read-only failing query; never run migrations if the CLI continues after an error.
  const preflight = query(`select 'EAZILY_PREFLIGHT:' ||
    (to_regclass('auth.users') is not null)::text || ',' ||
    (to_regclass('storage.objects') is not null)::text || ',' ||
    (to_regclass('public.profiles') is not null)::text || ',' ||
    (to_regclass('public.categories') is not null)::text || ',' ||
    (to_regclass('eazily_deploy.migration_history') is not null)::text || ',' ||
    (to_regclass('supabase_migrations.schema_migrations') is not null)::text || ',' ||
    (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relkind in ('r','p') and c.relname <> 'spatial_ref_sys')::text;
  `);
  const [auth, storage, profiles, categories, history, cliHistory, publicTables] = marker(preflight, 'PREFLIGHT').split(',');
  if (auth !== 'true' || storage !== 'true') stop('Managed Auth/Storage schema missing.');
  if (cliHistory === 'true') {
    const count = marker(query("select 'EAZILY_COUNT:' || count(*) from supabase_migrations.schema_migrations;"), 'COUNT');
    if (count !== '0') stop('CLI migration history is nonempty; manual reconciliation required.');
  }
  if (history !== 'true' && (profiles === 'true' || categories === 'true' || publicTables !== '0'))
    stop('Public tables exist without deployment ledger; manual reconciliation required.');
  if (process.env.EAZILY_STAGING_BACKUP_VERIFIED !== 'true' || process.env.EAZILY_STAGING_RESTORE_VERIFIED !== 'true')
    stop('Staging backup and isolated restore evidence are required before the first remote write.');
  if (history !== 'true') {
    query(`create schema eazily_deploy;
      revoke all on schema eazily_deploy from public, anon, authenticated;
      create table eazily_deploy.migration_history (
        sequence integer primary key, filename text not null unique, sha256 text not null,
        project_ref text not null check (project_ref = '${REF}'),
        applied_at timestamptz not null default clock_timestamp()
      );
      alter table eazily_deploy.migration_history enable row level security;
      revoke all on eazily_deploy.migration_history from public, anon, authenticated;
    `);
  }
  let found = status();
  if (found.length && (profiles !== 'true' || categories !== 'true')) stop('Remote ledger exists but base schema is missing.');
  for (const m of manifest.slice(found.length)) {
    found = status(); // Read remote ledger again before every file.
    if (found.length !== m.sequence - 1 || m.requiredPredecessors.some(file => !found.some(row => row.file === file))) stop(`Dependency/history mismatch before ${m.file}.`);
    const source = fs.readFileSync(path.join(ROOT, 'supabase', m.file), 'utf8');
    const hash = crypto.createHash('sha256').update(source).digest('hex');
    if (hash !== m.sha256) stop(`Checksum changed immediately before ${m.file}.`);
    // The ledger write follows the original SQL. A failed/post-COMMIT script is never retried automatically.
    currentMigration = m.file;
    query(`${source}\ninsert into eazily_deploy.migration_history(sequence,filename,sha256,project_ref) values (${m.sequence},'${m.file}','${m.sha256}','${REF}');\n`);
    currentMigration = null;
    const after = status();
    if (after.length !== m.sequence) stop(`Migration ${m.file} may have applied without a ledger record; inspect before retrying.`);
    report.applied.push({ sequence: m.sequence, file: m.file, sha256: m.sha256 });
    save();
    console.log(`Applied ${m.sequence}/45 ${m.file} ${m.sha256}`);
  }
  verifyHosted();
  console.log('All 45 migrations recorded and targeted hosted checks passed. Account-level security remains unverified.');
} catch (error) {
  stop(error.message?.startsWith('Supabase CLI failed') || error.message?.startsWith('CLI did not prove')
    ? error.message : `Unexpected preflight/deploy error: ${error.code || error.name || 'unknown'}; inspect remote state before retrying.`);
}
