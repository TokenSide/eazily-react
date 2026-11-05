/* Compare a hosted project's live schema against supabase/migration-manifest.json.
 *
 * Input is the CSV produced by scripts/introspect-remote.sql:
 *
 *   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --csv -f scripts/introspect-remote.sql \
 *     > .tmp/remote-schema.csv
 *
 * Usage:
 *   node scripts/compare-manifest.cjs .tmp/remote-schema.csv
 *
 * Read-only. It reports which declared objects are absent so you know what is
 * still pending; it never decides to apply anything.
 */
const { readFileSync, existsSync } = require('node:fs');
const { resolve } = require('node:path');

const csvPath = resolve(process.argv[2] || '.tmp/remote-schema.csv');
const manifestPath = resolve('supabase/migration-manifest.json');

if (!existsSync(csvPath)) {
  console.error(`Missing ${csvPath}. See the header of this file for the psql command that produces it.`);
  process.exit(1);
}

// Minimal RFC4180 row splitter; psql --csv quotes fields containing commas.
const parseCsv = text => {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell !== ''));
};

const rows = parseCsv(readFileSync(csvPath, 'utf8'));
const header = rows.shift().map(h => h.trim().toLowerCase());
const col = name => header.indexOf(name);
const [k, n, d] = [col('object_kind'), col('object_name'), col('detail')];
if ([k, n, d].some(i => i < 0)) {
  console.error(`Unexpected CSV header: ${header.join(', ')}. Expected object_kind, object_name, detail.`);
  process.exit(1);
}

const live = rows.map(r => ({ kind: r[k].trim(), name: r[n].trim(), detail: (r[d] || '').trim() }));
const liveNames = new Set(live.map(o => o.name));

const byKind = kind => live.filter(o => o.kind === kind);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

// The manifest lists objects as "schema.name"; PostgREST and pg_class report the
// bare name, so compare on the trailing identifier.
// The manifest's objects field mixes three shapes, and only two are comparable:
//   public.user_role                                    -> schema-qualified object
//   eazily_public_read_internal.read_customer_reviews   -> object in a private schema
//   public.enqueue_background_job Smart Match guard     -> object plus a description
//   seller_subscription_timeline                        -> bare object name
//   explicit profile/category SELECT grants              -> prose, not an object
// Anything with whitespace before a dot, or whitespace in the first token, is
// prose describing a change rather than a name, so it is counted, never compared.
const SCHEMA_QUALIFIED = /^([a-z_][a-z_0-9]*)\.([a-z_][a-z_0-9]*)/;
const BARE_NAME = /^([a-z_][a-z_0-9]*)$/;

const declared = new Map();
let prose = 0;
for (const migration of manifest.migrations) {
  for (const object of migration.objects || []) {
    const entry = String(object).trim();
    const qualified = SCHEMA_QUALIFIED.exec(entry);
    const bare = BARE_NAME.exec(entry);
    const name = qualified ? qualified[2] : bare ? bare[1] : null;
    if (!name) { prose += 1; continue; }
    if (!declared.has(name)) declared.set(name, { object: entry, sequence: migration.sequence, file: migration.file });
  }
}

const missing = [...declared.entries()].filter(([name]) => !liveNames.has(name));
const undeclared = live
  .filter(o => ['relation', 'function', 'policy', 'enum', 'trigger'].includes(o.kind) && !declared.has(o.name))
  .map(o => o.name);

const line = (label, items, render) => {
  console.log(`\n${label} (${items.length})`);
  items.slice(0, 40).forEach(item => console.log('  ' + render(item)));
  if (items.length > 40) console.log(`  ... and ${items.length - 40} more`);
};

console.log('Live schema');
console.log(`  relations           : ${byKind('relation').length}`);
console.log(`  functions           : ${byKind('function').length}`);
console.log(`  policies            : ${byKind('policy').length}`);
console.log(`  triggers            : ${byKind('trigger').length}`);
console.log(`  enums               : ${byKind('enum').length}`);
console.log(`  anon/authed grants  : ${live.filter(o => o.kind.startsWith('grant:') || o.kind.startsWith('function_grant:')).length}`);

const rlsOff = byKind('rls_disabled');
console.log(`\nTables WITHOUT Row Level Security (${rlsOff.length})`);
rlsOff.forEach(o => console.log('  ' + o.name));
if (!rlsOff.length) console.log('  none - every public table has RLS enabled');

// SECURITY DEFINER functions are the escalation surface; a missing
// search_path on one is a real finding.
const riskyDefiner = byKind('function').filter(o => o.detail.includes('SECURITY DEFINER') && o.detail.includes('config=(none)'));
console.log(`\nSECURITY DEFINER without a pinned search_path (${riskyDefiner.length})`);
riskyDefiner.forEach(o => console.log(`  ${o.name}  ${o.detail}`));
if (!riskyDefiner.length) console.log('  none - every definer function pins its search_path');

const anonRpcs = byKind('function_grant:anon');
console.log(`\nFunctions executable by anon (${anonRpcs.length})`);
anonRpcs.forEach(o => console.log(`  ${o.name}  ${o.detail}`));

const anonTables = byKind('grant:anon');
console.log(`\nTables granted to anon (${anonTables.length})`);
anonTables.forEach(o => console.log(`  ${o.name}  ${o.detail}`));

line('Declared in the manifest but ABSENT from the live schema', missing,
  ([name, meta]) => `${name}  (manifest #${meta.sequence} ${meta.file})`);
line('Present live but not named in the manifest', undeclared, name => name);

console.log(`\nVerdict: ${missing.length === 0
  ? 'every object the manifest declares is present. Do not replay the manifest.'
  : `${missing.length} declared object(s) missing - the manifest is only partially applied. Apply the missing files in order, never the whole manifest.`}`);
console.log(`Manifest entries skipped as prose: ${prose}`);
console.log(`Ledger: ${byKind('ledger').length ? byKind('ledger').map(o => o.name).join(', ') : 'none found - the applied set is reconstructed by this diff, not by a ledger.'}`);