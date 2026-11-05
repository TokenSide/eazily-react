/* Read-only reconnaissance against a hosted Supabase project.
 *
 * Contacts the project over HTTPS using only the publishable/anon key. It performs
 * GET requests exclusively: no table, row, function or setting is ever written.
 *
 * Use it to answer one question before applying migrations: does the target already
 * have this schema, and is it readable by the browser role?
 *
 *   node scripts/hosted-recon.cjs
 *   EAZILY_ENV_FILE=.env.staging.local node scripts/hosted-recon.cjs
 *
 * Credentials are read from the env file and never printed.
 */
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const envFile = resolve(process.env.EAZILY_ENV_FILE || '.env.staging.local');
if (!existsSync(envFile)) {
  console.error(`Missing ${envFile}. Copy .env.example to .env.staging.local and fill in VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.`);
  process.exit(1);
}

const env = {};
for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const match = /^\s*([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.*)$/.exec(line);
  if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
}
const url = (env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY || '';
if (!url || !key) {
  console.error('VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY (or VITE_SUPABASE_ANON_KEY) are required.');
  process.exit(1);
}

// The project reference is public information and safe to display; it identifies the
// target so a human can confirm they are probing the intended database.
const ref = (url.match(/\/\/([a-z0-9]{20})\./i) || [])[1] || '(unrecognised ref)';

// Order matches the shape of the user journey so the report reads top to bottom.
const JOURNEY_RELATIONS = [
  'profiles', 'categories', 'services', 'vendors', 'vendor_directory',
  'customer_professional_directory', 'customer_professional_reviews', 'customer_reviews',
  'customer_service_verification', 'service_requests', 'partners', 'partner_directory',
  'saved_vendor_directory', 'saved_partner_directory', 'messages', 'conversations',
  'categories_public', 'wallet_ledger', 'subscriptions', 'service_partner_posts',
  'service_bookings', 'partner_applications', 'support_tickets', 'automation_jobs',
];

const state = async (relation) => {
  const response = await fetch(`${url}/rest/v1/${relation}?select=*&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
  });
  const body = await response.text();
  if (/PGRST205|Could not find the table|does not exist/i.test(body)) return ['missing', 'not in the schema cache'];
  if (response.status === 401) return ['no-grant', 'browser role has no privilege'];
  if (response.status === 403) return ['denied', 'permission denied'];
  if (!response.ok) return ['error', `${response.status} ${body.slice(0, 90)}`];
  let rows;
  try { rows = JSON.parse(body); } catch { return ['error', 'unreadable body']; }
  return ['present', Array.isArray(rows) && rows.length ? 'readable, has rows' : 'readable, currently empty'];
};

// Exhaustive mode derives the relation list from the SQL itself, so a drifted or
// hand-edited schema still shows up instead of only the relations we remembered.
const exhaustive = process.argv.includes('--all');
const relationsFromSql = () => {
  const dir = resolve('supabase');
  if (!existsSync(dir)) return [];
  const { readdirSync } = require('node:fs');
  const names = new Set();
  for (const file of readdirSync(dir).filter(f => f.endsWith('.sql'))) {
    const text = readFileSync(resolve(dir, file), 'utf8');
    for (const match of text.matchAll(/create\s+(?:or\s+replace\s+)?(?:table|view)\s+(?:if\s+not\s+exists\s+)?(?:public\.)?([a-z_][a-z_0-9]*)/gi)) {
      if (!/^(auth|storage|pg_|information_schema|public_[a-z]*)$/.test(match[1])) names.add(match[1].toLowerCase());
    }
  }
  return [...names].sort();
};
const RELATIONS = exhaustive ? relationsFromSql() : JOURNEY_RELATIONS;

(async () => {
  console.log(`Target project : ${ref}`);
  console.log(`REST endpoint  : ${url}/rest/v1`);
  console.log(`Env file       : ${envFile}`);
  console.log('Method         : GET only. No writes.\n');

  const auth = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } });
  let authSummary = `HTTP ${auth.status}`;
  if (auth.ok) {
    const s = await auth.json().catch(() => null);
    if (s) {
      const providers = [s.external?.phone ? 'phone' : null, s.external?.google ? 'google' : null,
        ...Object.keys(s.external || {}).filter(p => !['phone', 'google'].includes(p)).map(p => `${p}(ext)`)].filter(Boolean);
      authSummary = `phone=${s.phone?.enabled ?? '?'} sms_autofill=${s.sms_provider ?? '?'} ` +
        `providers=[${providers.join(', ') || 'none'}] sites=${JSON.stringify(s.uri_sites_allowed || [])}`;
    }
  }
  console.log('--- Auth settings (drives the login plan) ---');
  console.log(`  ${authSummary}\n`);

  console.log('--- Relation catalog ---');
  console.log('  STATE       ROWS/ACCESS        RELATION');
  let missing = 0, present = 0;
  for (const relation of RELATIONS) {
    const [status, note] = await state(relation);
    if (status === 'present') present += 1; else missing += 1;
    console.log(`  ${status.padEnd(10)} ${note.padEnd(18)} ${relation}`);
  }
  console.log(`\n  ${present} present, ${missing} absent or unreadable.`);
  console.log(present === 0
    ? '  => The schema is not deployed. Apply supabase/migration-manifest.json in order.'
    : '  => Objects already exist. Do NOT replay the manifest; inspect and back up first.');
})().catch(error => { console.error('Recon failed:', error.message); process.exitCode = 1; });