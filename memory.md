# MEMORY.md

Persistent project memory. Read this first at the start of every session before touching code.
Update it whenever facts change. Do NOT put change history here — that belongs in `history.md`.

Last verified: 2026-10-03 (end of session 1)

---

## 0. Resume Here

Nothing is committed-but-uncommitted; the tree is clean at `01bac09`.

**Do these two things next, both of them need only your dashboard and your DB password.**
Full steps in `docs/staging/AUTH-ENABLEMENT.md`.

1. Enable Google OAuth in Supabase -> Authentication -> Providers, and set Site URL +
   redirect URLs (`http://localhost:5173`, `http://localhost:5173/**`). Phone OTP also
   needs Twilio credentials and a verified sender, so Google alone is the fast path.
   Then run `node scripts/hosted-recon.cjs` and paste back the phone/google/providers line.
2. Apply the seed so discovery has content (see section 9 and `seed/README.md`):
   ```powershell
   psql "$env:EAZILY_DATABASE_URL" -v ON_ERROR_STOP=1 -f seed/001_catalogue.sql  # then 002, 003, verify-seed
   ```

**Then run `npm run test:connected`.** It is the single command that proves the app talks
to `ahwbgmnfmzsaiwjglbkb`. It is self-contained: it builds in staging mode, boots the real
bundle in headless Edge, and asserts RLS. It cannot do an OTP or Google round trip, because
that needs a real SMS-capable number or a real Google session.

**Optional but valuable:** `supabase link --project-ref ahwbgmnfmzsaiwjglbkb` (run it in
your own terminal; it prompts for the DB password) unlocks
`scripts/staging-migrate.ps1 -Verify`, which is the only way to audit real per-table RLS
and grants on the hosted project.

**Known open items, in priority order:** authenticated-JWT RLS matrix, the two unlisted
`*_legal_drafts` SQL files, `npm run test:smoke` failing at `scripts/smoke.cjs:72`
independently of any of this, and the 601 KB `eazily-partner-logo.png`.

---

## 1. Project Identity

| Field | Value |
| --- | --- |
| Name | `eazily-react` (private, v1.0.0) |
| Root | `E:\Satyam\AMAZON_ML\eazily-react\eazily-react` |
| Description | Multi-sided marketplace (customer / seller / service partner / consultant / influencer / admin) converted from a legacy HTML/CSS/JS prototype to modular React. Runs in demo mode without a backend. |
| VCS | **Git repo initialised 2026-10-03** on branch `main`, baseline commit `c41d5b5`. `.gitattributes` normalises LF and marks binaries. |
| Shell | Windows / PowerShell 5.1. Use `npm.cmd` in scripts. |

## 2. Stack

- Vite `^7.1.4` (observed running 7.3.6), `@vitejs/plugin-react` ^5.0.2
- React / React-DOM `^19.1.1` — **plain JS + JSX, no TypeScript in `src/`**
- Capacitor `^8.5.2` (`@capacitor/android`, `@capacitor/app`) for the Android shell
- Supabase (`src/lib/supabase.js`) — auth, Postgres, storage, realtime
- ESLint 9 flat config (`eslint.config.js`) + `eslint-plugin-react-hooks`, `react-refresh`
- `@electric-sql/pglite` devDep (local Postgres for tests)
- Node.js 24 LTS / npm 11+ required

## 3. Layout

```text
src/
  App.jsx          onboarding + app-mode controller
  main.jsx         entry
  styles.css       full visual system
  auth/            auth policy helpers
  components/      shared UI + inline SVG Icon set
  data/            catalogue + demo seed data
  features/        account, admin, bulk-orders, chat, home, legal, partners,
                   requests, services, user-art, user-motion, videos
  lib/             supabase, translate (29 KB), pricing, subscriptions,
                   realtime, workspace, nativeShell, influencerFollowers, account
  pages/           UserApp, SellerApp, PartnerApp, AdminApp,
                   ConsultantArea, InfluencerArea, ServicePartnerArea
  services/        DB-facing functions (marketplace, partners, chat,
                   paymentCheckout, experience, consumerConsent, ...)
supabase/          55+ SQL migrations + migration-manifest.json + 7 edge functions
scripts/           69 files — mostly *.cjs verification harnesses + *.jsx fixtures
docs/              11 markdown docs, incl. staging/ runbook + audit
```

## 4. Key Commands

```powershell
npm run dev            # vite dev server -> http://localhost:5173
npm run build          # vite build -> dist/
npm run build:staging  # staging-mode build
npm run preview        # serve dist/
npm run lint           # eslint .   (currently 0 errors, 1 warning)
npm run android:sync   # build + cap sync android
npm run android:debug  # sync + gradlew assembleDebug
npm run analyze:bundle # build + bundle-report.cjs
```

Test commands are per-domain `.cjs` harnesses, not a unit-test runner:
`test:auth`, `test:database`, `test:seller`, `test:legal-assessment`,
`test:consultant-legal`, `test:consumer-legal`, `test:service-registration`,
`test:service-posting`, `test:partner-registration-flow`, `test:realtime`,
`test:chat`, `test:automation`, `test:staging`, `staging:preflight`,
`test:smoke`, `test:catalog`, `test:mobile-prototype`, `test:error-boundary`, plus `:browser` variants
(`test:partner-navigation:browser`, `test:professional-discovery*`).

Browser harnesses use **no test framework**: headless Edge over raw CDP
(`--remote-debugging-port`) with a hand-rolled `send/evaluate/waitFor/click` helper, `esbuild` bundling a
`scripts/*-fixture.jsx` into `.tmp/fixture.js`, and a local `node:http` server. Follow this shape for any new
browser test. Every fixture must default-export a component or ESLint's `react-refresh` rule warns.

## 4b. Crash Handling

`src/components/ErrorBoundary.jsx` (default-exported class, `getDerivedStateFromError` + optional `onError`
prop, `label` prop naming the failed area). Mounted twice: around `<App/>` in `main.jsx`, and around the
`Suspense` content inside `App.jsx` so one workspace crash cannot take down the shell. Styles in the
`/* Error boundary fallback */` block at the end of `src/styles.css`. Verified by `npm run test:error-boundary`.

## 4c. Supabase: sample mode vs connected mode

Two build modes, chosen by `scripts/build-policy.mjs` from `EAZILY_TARGET_ENV`:

| Mode | Trigger | `src/lib/supabase.js` resolves to | Result |
| --- | --- | --- | --- |
| sample (default) | no target declared, or `production` | `src/lib/supabase.sample.js` (null stub) | 126 modules, no client/endpoint/key in `dist`; every `if (!supabase)` demo guard holds |
| connected | `EAZILY_TARGET_ENV` = `staging` \| `development` \| `local` | the real module | client and `.supabase.co` inlined from `.env.staging.local` |

Key mechanics, easy to break:
- The real `src/lib/supabase.js` imports the SDK **statically**, so tree-shaking cannot remove it from a
  sample bundle. The plugin's `resolveId` hook (`enforce:'pre'`) swaps the whole module for the stub instead.
- `SUPABASE_ENTRY=/(^|[/\\])supabase\.js$/` must stay broad enough to catch the sibling import
  `'./supabase.js'` in `src/lib/realtime.jsx`, not just `'../lib/supabase.js'`.
- `build:staging` **without** `EAZILY_TARGET_ENV` fails by design.
- Credentials live in `.env.staging.local` (`VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`).
  Vite's dev server reads `.env.development.local` by default, so use `--mode staging` to develop connected.
- Never put a service-role or other server secret in any `VITE_` variable. `privilegedJwt` in the policy
  decodes bundled JWTs and fails the build on any role other than `anon`.
- `npm run dev` with no credentials keeps the local OTP bypass (`VITE_ENABLE_LOCAL_OTP=true`, code `0000`);
  with a real client the dev runtime disables itself automatically via `DEVELOPMENT_OTP_ENABLED && !supabase`.

Read-only recon: `node scripts/hosted-recon.cjs` (journey relations) or `--all` (every relation found in
`supabase/*.sql`). GET only, prints no credentials.

## 4d. Auth wiring (added 2026-10-03 — read this before touching auth)

`src/auth/` is 33 KB across 9 files and is now live. The shape:

- `src/App.jsx` mounts `useAuth()` **once** and owns everything. `useAuth.js` keeps a module-level
  `sharedController` so `usePhoneVerification()` in `ServicePartnerOnboarding.jsx` reaches the same
  controller instead of creating a second Supabase auth listener. Never mount the controller twice.
- `useAuth()` returns `{...snapshot, controller}`. Pass that whole object to `<AuthScreen auth={...} />`;
  `AuthScreen` reads `auth.controller`, `auth.status`, `auth.developmentOtp`, `auth.otpLength`,
  `auth.resendAt`, `auth.contactType`, `auth.contact`, `auth.phone`, `auth.error`.
- Controller statuses: `initialising`, `configuration_required`, `signed_out`, `otp_sending`, `otp_sent`,
  `verifying`, `profile_required`, `authenticated`, `blocked`, `suspended`, `session_expired`, `error`.
  `configuration_required` means **no Supabase client**, i.e. sample mode. That is not the same as phone
  being disabled server-side.
- Sign-in is **on demand**. Pages call `requestSignIn()` (`src/lib/account.js`) when a guest touches
  something needing an account; `App.jsx` listens for `eazily-sign-in` and opens `AuthScreen`. Browsing
  stays public. `UserApp.jsx:31` gates on `PARTNER_DEMO_ENABLED && !isSupabaseConfigured && !account?.user`.
- Partner workspace entry goes through `routeAccess(account, role)` from `src/auth/policy.js`, which
  encodes the whole role state machine (`signed_out`, `profile_required`, `registration`,
  `approval_pending`, `assessment_required`, `rejected`, `suspended`, `blocked`, `allowed`).
  `partnerAccessMessage()` in `App.jsx` maps each outcome to its own message.
- Sample mode is the fallback, not removed: `isSupabaseConfigured` selects the real session vs `guest`,
  and `requestAuth` keeps the old demo toast when there is no client.

## 9. Hosted Project Status (verified 2026-10-03)

Project `ahwbgmnfmzsaiwjglbkb` / `eazily-staging`, ap-south-1, PG 17.6, GoTrue v2.197.

### The database is fully deployed. Nothing needs applying.

- `.tmp/staging-migrations/ahwbgmnfmzsaiwjglbkb.ledger.json` records **all 48 migrations `applied`,
  exitCode 0**, run by operator `ajayk` from `2026-09-27T15:49Z` to `2026-09-29T06:39Z`.
- `scripts/staging-migrate.ps1` (dry-run) reports `Plan: 48 recorded as applied, 0 to apply`.
- A read-only PostgREST probe agrees: 88 of 100 relations answer `401` to the browser role, meaning they
  exist and are correctly not granted to `anon`.
- `docs/staging/REPORT.md` (2026-09-18) claiming "0 applied" is **stale** — it predates the deploy by 9 days.
- Never replay the manifest. The manifest is not generally idempotent and later files replace earlier
  function definitions.

### What actually blocks a working login-to-discovery flow

1. **Auth providers are disabled.** `phone` is absent (phone OTP off), `google` is `false`,
   `uri_sites_allowed` is empty. `sms_provider` is `twilio` but its credentials cannot be verified from
   outside the dashboard. Dashboard work, not code.
2. **No content data.** `categories`, `app_configuration`, `partner_public_config`, `referral_config` are
   populated; vendors, services, profiles and all public views are empty, so discovery returns nothing.

### Tooling gaps found

- `consultant_legal_drafts_2026_09_20.sql` and `consumer_legal_drafts_2026_09_20.sql` (41 KB each) are
  **not in the 48-file manifest**, so `staging-migrate.ps1` will never apply them. Confirm whether that is
  deliberate (drafts awaiting legal sign-off, per `docs/CONSULTANT-LEGAL-HANDOFF.md`) or an omission.
- `staging-migrate.ps1 -Verify` cannot run yet: the pinned image
  `public.ecr.aws/supabase/postgres:17.6.1.171` is not pulled locally (the runner never pulls), and
  `PGSERVICE` / `PGSERVICEFILE` / `PGPASSFILE` are unconfigured.

### Seed data (`seed/`, added 2026-10-03)

`001_catalogue.sql` (13 services under the existing `manpower` category), `002_service_professionals.sql`
(auth.users + profiles + 6 vendors), `003_reviews.sql` (8 published reviews), `verify-seed.sql` (read-only
assertions), `test-seed.cjs` (`npm run test:seed`, rehearses everything in PGlite). Deliberately **not** in
the migration manifest: it is data, not schema.

**The modern partner path cannot be seeded.** `enforce_current_service_partner_registration()` runs the
six-step validator on every insert of a `professional` application in status
submitted/under_review/approved, and it demands real Aadhaar/PAN/Gumasta uploads confirmed in
`storage.objects`. Fabricating those, or disabling the trigger, is refused. So professionals are seeded
into the legacy `public.vendors` table instead — no KYC guard, and `src/services/marketplace.js` already
merges `vendor_directory` with `customer_professional_directory` under one eligibility filter
(`customerProfessionalEligibility.js`: needs `published`, `verification_status='verified'`, matching
`service_names`, `coverage`, and `prices` for `starting_price`).

Other guards worth remembering when writing SQL that touches these tables:
- `guard_account_write()` only restricts when `auth.uid() IS NOT NULL`, so a JWT-less `postgres` session
  keeps full insert rights. That is why the seed must run as `postgres`.
- `guard_published_post()` requires, for a published professional offering: approved application with a
  matching role, `details.category` byte-identical to the application's, `details.service` present in the
  application's `services` array, no media unless `storage.objects` rows exist, and
  `post_price()` yielding `totalPaise` (so `serviceCharge` must parse as a number).
- `categories.slug` is unique and already holds `manpower`, `loans`, `influencers`, `consultancy`,
  `transportation`, `blood-bank` from `staging_prelaunch_foundations.sql`. Do not re-add those.
- `services` is unique on `(category_id, slug)`, not `slug` alone.

### Staging runner (`scripts/staging-migrate.ps1`) — prefer it over ad-hoc psql

Modes: default (local dry-run), `-Verify` (read-only target check), `-Apply` (needs `-ConfirmProjectRef`).
- psql runs from the pinned Supabase Postgres Docker image with `--pull never`, so no client install.
- Credentials live outside the repo in a libpq service file plus `PGPASSFILE`. `PGPASSWORD` is never read or
  passed. Only names, sequences, hashes, exit codes, SQLSTATEs and object names are printed.
- Refuses to run if `.temp/project-ref` is not `ahwbgmnfmzsaiwjglbkb`, if any SHA-256 drifts, if the lock
  file exists, or if `supabase_migrations.schema_migrations` / `eazily_private.staging_migration_history`
  hold rows. Per-file postconditions, stops at the first failure.

### Schema verification tooling added 2026-10-03

- `scripts/introspect-remote.sql` — one read-only SELECT emitting `object_kind | object_name | detail`
  across all application schemas. Covers relations, RLS-disabled tables, functions (incl.
  `SECURITY DEFINER` + pinned `search_path`), policies, triggers, anon/authenticated grants, realtime
  publications, and any migration ledger. Asserted non-mutating by `test:introspect`.
- `scripts/compare-manifest.cjs` — diffs that output against `supabase/migration-manifest.json`. Object-level
  and manifest-driven, so it answers *which* declared object is absent, which `-Verify` cannot (it compares
  against the local ledger, not the manifest).
- `scripts/hosted-recon.cjs` — GET-only PostgREST probe, no DB password needed.
- Two parsing traps both tools hit: the manifest's `objects` mix object names with **prose**
  (`explicit profile/category SELECT grants`), and functions live outside `public`
  (`eazily_public_read_internal.read_*`), so a `public`-only function query misses them.

## 5. Conventions Observed

- Thin `src/services/*.js` layer wraps Supabase; components never query directly.
- RPC-first for writes: `rpc('submit_request', {...})`, `book_partner_offering`, etc.
- `experience.js` exports `readRows`, `rpc`, `canonicalService`, `serviceNamesForLookup`.
- Graceful degradation is idiomatic: `.catch(() => [])` on optional reads, `if (!supabase) return []`.
- Idempotency keys on every mutating call (`p_key`).
- Signed media URLs via `supabase.storage.from('partner-media').createSignedUrl(path, 900, transform)`.
- Money via `src/lib/pricing.js`; i18n via `src/lib/translate.js`; no emoji in UI (inline SVG icons instead).
- Naming: PascalCase `.jsx` components, camelCase `.js` services, `service_partner_*.sql` migrations dated `*_YYYY_MM_DD.sql`.
- No comments convention is not enforced here — existing files are sparsely commented.

## 6. Hard Rules / Security Posture (from README + docs)

1. Anon key is frontend-only and **only** safe with RLS on. Never ship the service-role key to the client or into any `VITE_` var.
2. Financial docs, PAN/KYC, bank statements, admin approvals → protected buckets + server-side authorization.
3. Demo admin login must be replaced with Supabase Auth + admin role check before production.
4. Apply migrations in `supabase/migration-manifest.json` order; **never** deploy base `schema.sql` alone.
5. `.gitignore` covers `.env*` except `.env.example` — keep it that way. `.env.development.local`, `.env.local`, `.env.staging.local` exist on disk.

## 7. Known Health Snapshot (2026-10-03)

- `src`: 107 files / ~7,923 lines.
- Lint: 1 warning — `scripts/service-partner-verify-mobile-fixture.jsx:39` `react-refresh/only-export-components`.
- Zero `console.log`/`debugger`, zero `TODO`/`FIXME`, zero `any`, zero `dangerouslySetInnerHTML` in `src/`.
- Largest modules: `PartnerOnboarding.jsx` (44 KB), `ServicePartnerOnboarding.jsx` (41 KB), `translate.js` (29 KB), `PartnerApp.jsx` (29 KB).
- Weak spots: no unit-test runner or CI (`.github` holds only `modernize/` hooks), oversized single-purpose feature files, demo Unsplash remote images still referenced.

## 8. Improvement Backlog (ranked, 2026-10-03)

| # | Item | Effort | State |
| --- | --- | --- | --- |
| 1 | `git init` + baseline commit | 30 min | **done** `c41d5b5` |
| 2 | Error boundary at app shell | 1–2 h | **done** `3f620d5` + `test:error-boundary` |
| 3 | Vitest unit tests for pure logic (`customerProfessionalEligibility`, `pricing`, `canonicalService`/`serviceNamesForLookup`) | ~1 day | pending |
| 4 | Split `PartnerOnboarding.jsx` / `ServicePartnerOnboarding.jsx`; fix suppressed hook deps at `ServicePartnerOnboarding.jsx:251,317` | 2–3 days | pending |
| 5 | CI workflow | 1 h | **done** `0e719e0` — `verify` gating, `browser` advisory |
| 6 | Pre-launch: replace 7 Unsplash URLs, `.env` documentation, convert the 601 KB partner logo | 1–2 days | pending |
| 7 | Supabase client reachable only for non-production targets | 1 h | **done** `36da111` |
| 8 | Determine which migrations are actually applied | 30 min | **done** — all 48, per the local ledger |
| 9 | Schema introspection + manifest comparator | 2 h | **done** `9db19be` + `test:introspect` |
| 10 | Seed data for the customer directory | 3 h | **done** `0233fed` + `test:seed` |
| 11 | Wire `App.jsx` to the real auth controller | 2 h | **done** `01bac09` + `test:connected` |
| 12 | Enable phone OTP / Google in the dashboard | 10 min | **blocked on you** — see `docs/staging/AUTH-ENABLEMENT.md` |
| 13 | Authenticated-JWT RLS matrix on staging | 1 day | pending, needs a real signed-in session |
| 14 | Split the two 40 KB onboarding files | 2–3 days | pending |

`scripts/build-policy.mjs` already blocks privileged `VITE_` vars and scans build output for leaked credentials —
it runs automatically on every `npm run build` because `vite.config.js` registers it as a plugin.

## 10. Known Pre-existing Failures (do not assume your change caused these)

- `npm run test:smoke` fails on the baseline commit at `scripts/smoke.cjs:72` —
  `Cannot read properties of null (reading 'getBoundingClientRect')` while asserting `.phone-shell` at 1280 px.
  Reproduced on `c41d5b5` with all my `src/` changes reverted, so it is independent of the error boundary.
  Likely the launch-splash timing or the missing setup screen at desktop width. Untriaged.
- `scripts/bundle-report.cjs:8` used to reject every `.png`/`.jpg` in `dist`, contradicting the deliberate
  copies in `build-policy.mjs` `writeBundle`, so `npm run analyze:bundle` failed on a clean checkout.
  Fixed 2026-10-03 by scoping the exception to the two brand logos and `assets/demo/professional/*`
  (see `sanctionedMedia`); any other raster asset still fails, by name.