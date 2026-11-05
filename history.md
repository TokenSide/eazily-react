# HISTORY.md

Append-only change log for this workspace. Newest entry first.
Format: `## YYYY-MM-DD HH:MM — title` then bullets. Record *what* changed and *why*, plus verification run.

---

## 2026-10-03 14:20 — Session start: inspect + run project

- Listed workspace root; confirmed `eazily-react` Vite + React 19 + Capacitor + Supabase app, **not under git**.
- Ran `npm run lint` → **0 errors, 1 warning** (`scripts/service-partner-verify-mobile-fixture.jsx:39`, `react-refresh/only-export-components`). No fix applied.
- Ran `npm run dev` → Vite 7.3.6 ready in 459 ms.
  - Local http://localhost:5173 · Network http://192.168.29.173:5173 · http://172.31.240.1:5173
  - Started detached (PID 23820) with logs at `%TEMP%\opencode\vite-dev.log` / `.err.log`.
  - A foreground `npm run dev` attempt was killed at the 60 s tool timeout — prefer the detached pattern.
- Audited code health: `src` = 107 files / 7,923 lines; zero `console.log`, `debugger`, `TODO`, `any`, `innerHTML`.
- Inventoried backend: 55+ Supabase SQL migrations + `migration-manifest.json` (74 KB) + 7 edge functions
  (automation-worker, cashfree-create-collaboration, cashfree-release-hold, cashfree-release-split,
  cashfree-webhook, seller-create-payment, youtube-feed).
- Inventoried tooling: 69 files in `scripts/`, 11 markdown docs in `docs/`.
---

## 2026-10-03 14:55 — Improvement #1: version control initialised

- `git init`, branch `main`, baseline commit `c41d5b5` — 1,114 files / 45,365 lines.
- Added `.gitattributes`: LF in-repo for text (`js/jsx/mjs/cjs/ts/json/css/html/md/txt/sql/yml/xml/gradle/properties`),
  binary for image/video/font/archive/APK assets. Silences the CRLF churn that affected ~200 files.
- Hardened `.gitignore`: `*.jks`, `*.keystore`, `local.properties`, `*.hprof`, `*.log`, `.idea/`, `.vscode/`,
  `dashboard-checkpoint-*/`, `subscription-checkpoint-*/`.
  Note: `android/.gitignore` ships with `*.jks` and `*.keystore` **commented out**, so signing material was
  unprotected before this.
- Pre-commit secret sweep over staged content: only matches were the *name* `service_role` (Postgres role),
  env-var names, and two explicit fixtures (`SUPABASE_SERVICE_ROLE_KEY: 'test-only'`,
  an `eyJ…fixture` anon key). No real credentials staged. `.env*` stayed ignored except `.env.example`.
- Excluded by existing ignores, as intended: `node_modules`, `dist`, `.tmp` (7.9 GB), `supabase/.temp/`,
  `android/*/build`, `android/.gradle`.

## 2026-10-03 15:10 — Improvement #2: error boundary

Problem: zero `ErrorBoundary` / `componentDidCatch` in the codebase, so any render throw white-screened the app.

- Added `src/components/ErrorBoundary.jsx` — default-exported class using `getDerivedStateFromError`,
  optional `onError(error, info)` hook, `label` prop naming the failed area, and a fallback with
  `role="alert"`, Try again / Reload app actions, and a `<details>` block carrying the error message for support.
  All strings pass through `translate()`.
- Mounted twice: around `<App/>` in `src/main.jsx`, and around the `Suspense` content in `src/App.jsx:53`
  so a single workspace crash cannot take down the shell or the toast layer.
- Added an `alert` icon (triangle-exclamation, 24px stroke style) to `src/components/Icon.jsx`.
  Verified against the real path set — `Icon` falls back to `paths.grid` for unknown names, so a missing
  entry would have silently rendered a grid glyph.
- Added an `/* Error boundary fallback */` block to the end of `src/styles.css`, reusing `--purple`/`--lav`/`--line`
  tokens and the existing `.btn` / `.btn-primary` / `.btn-outline` classes.
- Added `scripts/error-boundary-test.cjs` + `scripts/error-boundary-fixture.jsx` and wired
  `npm run test:error-boundary`. Follows the existing `scripts/smoke.cjs` shape: headless Edge over raw CDP,
  esbuild-bundled fixture, local http server on port 5203, no test framework.
  Asserts: subtree replaced by the alert fallback, crashed children unmounted, `onError` fires exactly once,
  clearing the fault alone does not auto-retry, retry restores children, a recovered boundary still catches the
  next crash, controls outside the boundary stay interactive, and the production build mounts without tripping it.
- Verification: `npm run lint` 0 errors / 1 pre-existing warning (unchanged baseline), `npm run build` OK
  (2.37 s), `npm run test:error-boundary` PASS, dev server on :5173 still serving and hot-reloading.
- Reverted one self-inflicted regression: the fixture initially had no exports, which added 2
  `react-refresh/only-export-components` warnings. Default-exporting the fixture component cleared them.

## 2026-10-03 15:40 — Improvement #5: CI workflow + bundle-budget contradiction fixed

Added `.github/workflows/ci.yml`:
- `verify` (ubuntu-latest, **gating**): `npm ci` → `npm run lint` → `npm run build` →
  `node scripts/bundle-report.cjs`, then uploads `.tmp/bundle-report.json`.
  Note `npm run build` is itself a security gate: `vite.config.js` registers `buildPolicy()` as a plugin,
  so every build fails on a privileged `VITE_` var, a staging-mode build, a server-only secret value
  appearing in output, a remote Supabase endpoint being bundled, or `scripts/` demo modules leaking in.
  No deploy job on purpose — `buildPolicy` throws for staging targets, this app is local-only.
- `browser` (windows-latest, `continue-on-error: true`): `test:error-boundary` then `test:smoke`.
  Advisory only — see the pre-existing failure below.
- `concurrency` cancels superseded runs; `permissions: contents: read`; `workflow_dispatch` enabled.

Fixed a contradiction that made `npm run analyze:bundle` fail on a clean checkout:
`scripts/build-policy.mjs` `writeBundle` deliberately ships `eazily-launch-logo.png`,
`eazily-partner-logo.png` and 5 demo portraits under `assets/demo/professional/`, but
`scripts/bundle-report.cjs:8` rejected *any* `.png`/`.jpg`/`.map` in the output.
- Scoped the exception via `sanctionedMedia` to exactly those two logos and `assets/demo/professional/*`.
- The check keeps its teeth: `.map`, `.mp4`, `.mov` and every other raster asset still fail, and the
  error now names the offending path. Verified by dropping a rogue PNG into `dist` (exit 1, named
  `assets/rogue-test.png`) then removing it (exit 0).
- Deliberately did **not** widen the exception to cover size, so the real problem stays visible:
  `eazily-partner-logo.png` is 601 KB and `eazily-launch-logo.png` is 177 KB, both eagerly preloaded
  in `index.html` for a 430 px-wide shell. They surface as the top entries of `report.largestAssets`.
  Converting both to WebP is the correct fix — see improvement #6.

Pre-existing failure recorded, not introduced here: `npm run test:smoke` fails on the baseline commit
at `scripts/smoke.cjs:72` (`Cannot read properties of null (reading 'getBoundingClientRect')` asserting
`.phone-shell` at 1280 px). Reproduced on `c41d5b5` with all `src/` changes reverted via
`git checkout c41d5b5 -- src/`, so it is unrelated to the error boundary. Left untriaged and the CI
browser job is advisory because of it.

Verification of the exact CI sequence locally: lint exit 0, build exit 0, bundle budget exit 0,
`test:error-boundary` PASS.

## 2026-10-03 16:20 — Connect the frontend to Supabase (non-production targets only)

Findings first. The requested work was mostly already done:
- All **64/64** RPCs the service layer calls are defined in the SQL; all **55** referenced relations exist
  (the 8 apparent gaps are views, not tables). 90 tables, 179 functions, 143 policies, 89/90 tables with RLS
  (the exception is the deliberately browser-denied `eazily_private` schema).
- `docs/staging/REPORT.md` (2026-09-18) says "0 applied", but `supabase/.temp/linked-project.json` links a
  real project and a read-only probe shows the schema deployed. **That report is stale.**

Changes:
- `npm install @supabase/supabase-js` (^2.117.2). The 4 npm audit findings all trace to `@capacitor/cli`
  (`xcode`, `uuid`, `brace-expansion`) and are pre-existing.
- `src/lib/supabase.js` now builds a real client from `VITE_SUPABASE_URL` + publishable/anon key, still
  exporting `null` when either is absent so every existing demo guard keeps working, and warning when only
  one of the pair is set instead of failing silently.
- `scripts/build-policy.mjs`: a connected build now requires `EAZILY_TARGET_ENV` in
  {staging, development, local}. Production and undeclared builds stay credential-free.
- Added the `resolveId` stub swap. The real module imports the SDK statically and cannot be tree-shaken;
  a sample build resolves `src/lib/supabase.js` to the new `src/lib/supabase.sample.js`.
  First attempt failed twice, both worth remembering:
  1. a normal-plugin `resolveId` runs *after* Vite's core resolver for relative paths — needs `enforce:'pre'`.
  2. the entry regex `[/\\]lib[/\\]supabase\.js$` silently missed `src/lib/realtime.jsx`'s sibling import
     `'./supabase.js'`, so the SDK was still bundled. Widened to `/(^|[/\\])supabase\.js$/`.
- `.env.example` documents the connected variables and the never-`VITE_` rule.
- New `scripts/hosted-recon.cjs`: GET-only probe of a hosted project's relation catalog and auth settings.
  Adds `--all` to derive relations from `supabase/*.sql` rather than a hand-kept list.

Guard behaviour verified in all directions: default build passes demo-only (118 modules, clean of the SDK);
`build:staging` with no target refuses; `EAZILY_TARGET_ENV=production` refuses; `=staging` connects
(161 modules). The one `sb_secret_` hit in the connected bundle is supabase-js's own key-format detection
string, correctly ignored by the policy's stricter `/sb_secret_[\w-]{16,}/`.

Read-only probe of `ahwbgmnfmzsaiwjglbkb` found:
- 88/100 relations return 401 to the browser role, i.e. **present and correctly not granted to `anon`**.
- 12 anon-readable; `categories`, `app_configuration`, `partner_public_config`, `referral_config` hold real rows.
- **Auth blocks login:** `phone` absent (OTP disabled), `google` false, `uri_sites_allowed` empty.
- **No content data**, so discovery returns nothing until seeded.

## 2026-10-03 16:55 — Supabase CLI, and read-only schema verification tooling

Installed `supabase` 2.119.0 globally (was not on PATH; `.temp/cli-latest` recorded 2.118.0).
`supabase link` needs the database password interactively, so it is left for the operator.

Found that `scripts/staging-migrate.ps1` already implements the staged deployment this work needed, and
more rigorously than a fresh implementation would: Docker-pinned psql with `--pull never`, credentials via
PGSERVICE + PGPASSFILE outside the repo (never `PGPASSWORD`), lock file, per-file postconditions, SHA-256 and
dependency gates, and a guard that refuses to replay into a populated database. Kept it as the primary tool
and added tooling only for what it does not answer.

**Deployment status resolved: nothing needs applying.**
`.tmp/staging-migrations/ahwbgmnfmzsaiwjglbkb.ledger.json` records all 48 migrations `applied` with
`exitCode 0`, operator `ajayk`, `2026-09-27T15:49Z` through `2026-09-29T06:39Z`. `staging-migrate.ps1`
dry-run confirms `Plan: 48 recorded as applied, 0 to apply`, with the linked ref, manifest size, all 48
SHA-256 hashes and every dependency check passing.

Added:
- `scripts/introspect-remote.sql` — read-only catalog query emitting `object_kind | object_name | detail`
  for relations, RLS-disabled tables, functions with their definer mode and `search_path`, policies,
  triggers, browser grants, realtime publications and any migration ledger.
- `scripts/compare-manifest.cjs` — diffs that output against the manifest, so a gap names the specific
  missing object. `-Verify` cannot do this because it compares the target to the local ledger, not the
  manifest.
- `scripts/introspect-tooling-test.cjs` (`npm run test:introspect`) — replays all 48 migrations into the
  local PGlite fixture, asserts the introspection query does not change the schema, and asserts the
  comparator reports a complete deployment. Two real bugs surfaced here and were fixed:
  1. the `UNION ALL` failed with SQLSTATE 42725 because `pg_policy.polcmd` is `"char"`; every column is now
     cast to `text` explicitly.
  2. the comparator reported 54 then 21 false "missing" objects: the manifest's `objects` field mixes
     object names with prose (`explicit profile/category SELECT grants`), and `public_view_rpc_boundary.sql`
     declares functions in `eazily_public_read_internal`, which a `public`-only query never sees. The
     comparator now only compares schema-qualified or bare-token entries and counts prose separately
     (11 entries), and the query covers every application schema.
- npm scripts `recon:hosted`, `recon:hosted:all`, `compare:manifest`, `test:introspect`.

Two findings for the operator, not acted on:
- `consultant_legal_drafts_2026_09_20.sql` and `consumer_legal_drafts_2026_09_20.sql` (41 KB each) are not
  in the 48-file manifest, so the runner will never apply them. `staging-migrate.ps1` warns about both.
- `staging-migrate.ps1 -Verify` cannot run yet: `public.ecr.aws/supabase/postgres:17.6.1.171` is not pulled
  locally (the runner never pulls it) and `PGSERVICE`/`PGSERVICEFILE`/`PGPASSFILE` are unconfigured.

## 2026-10-03 17:30 — Seed data in a new top-level seed/ folder

Goal: give the customer directory real content. The schema needed nothing; the data was empty.

**Key architectural finding, which changed the design.** The modern partner path cannot be seeded.
`public.enforce_current_service_partner_registration()` runs the full six-step registration validator on
every insert of a `professional` application in status submitted/under_review/approved, and
`validate_service_partner_registration()` requires genuine Aadhaar, PAN and Gumasta uploads confirmed in
private storage (`raise exception 'A document upload was not confirmed by private storage'`). So an approved
partner is only reachable with real identity documents.

Fabricating KYC, or disabling the trigger to bypass the check, was rejected. Instead professionals are seeded
into the legacy `public.vendors` table, which carries no KYC guard and is already read by the frontend:
`src/services/marketplace.js` merges `vendor_directory` with `customer_professional_directory`, dedupes, and
applies one eligibility filter. `test-seed.cjs` asserts the KYC trigger is still armed after seeding.

Added:
- `seed/001_catalogue.sql` — 13 services. Keyed on `(category_id, slug)` and resolving the category by
  subquery, because `categories.slug` is unique and already holds `manpower` from
  `staging_prelaunch_foundations.sql`. All services go under `manpower` because `marketplace.js` hardcodes
  `categoryId: 'manpower'`.
- `seed/002_service_professionals.sql` — auth.users placeholders, profiles, and 6 vendors written to satisfy
  every field `customerProfessionalEligibility.js` and `vendor_directory` require.
- `seed/003_reviews.sql` — 8 published reviews, so ratings aggregate.
- `seed/verify-seed.sql` — read-only inspection plus assertions, including that the KYC trigger survives.
- `seed/README.md` — apply order, why the legacy table, honest limitations, and scoped removal SQL.
- `seed/test-seed.cjs` (`npm run test:seed`) — rehearses all 48 migrations plus the seed in PGlite.

Two mistakes caught by the rehearsal rather than by inspection: the first draft of `001` re-added categories
that `staging_prelaunch_foundations.sql` already seeds, which collided on the `slug` unique index; and the
first draft of `002` targeted `partner_applications`, which failed on the phone-confirmation guard before
reaching the KYC check that revealed the real constraint.

Deliberate omissions, asserted by the test: `partner_earnings`, `finance_transactions`, `wallet_lots`,
`customer_payments`, `service_requests` and `partner_orders` stay empty, because a seeded rupee would appear
in admin finance views as revenue.

---

## 2026-10-03 18:40 — Session closed

Cleanup: stopped the dev server started at the beginning of the session. `Stop-Process` on the
`npm.cmd` wrapper left the child vite process holding port 5173, so the listener was located with
`Get-NetTCPConnection -LocalPort 5173` and the owning `node` process stopped directly. Port is free.
Worth remembering on Windows: killing a `.cmd` wrapper does not kill what it spawned.

State at close: working tree clean, 8 commits, HEAD `01bac09`.

| Command | Result |
| --- | --- |
| `npm run lint` | 0 errors, 1 pre-existing warning (`service-partner-verify-mobile-fixture.jsx:39`) |
| `npm run build` (sample) | 126 modules, no client/endpoint/key in `dist` |
| `node scripts/bundle-report.cjs` | exit 0 |
| `npm run test:error-boundary` | PASS |
| `npm run test:seed` | PASS |
| `npm run test:introspect` | PASS |
| `npm run test:connected` | PASS against `ahwbgmnfmzsaiwjglbkb` |

Also updated `memory.md`: added a **Resume Here** section at the top with the two operator actions
needed next, recorded the auth wiring contract in a new section 4d, corrected the sample-build module
count, and renumbered the colliding second `## 9.` heading to `## 10.`.