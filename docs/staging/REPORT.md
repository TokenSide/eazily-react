# Staging readiness report — 2026-09-18

**Staging deployment was not performed.**

| Category | Actual result |
| --- | --- |
| Locally prepared | Canonical manifest, forward security repair, offline fail-closed preflight, inspection queries, environment/backup/deployment/incident checklists |
| Locally tested | Full SQL sequence in PGlite fixtures, existing backend suites, lint, production build, local mobile browser suites, smoke, disabled financial handler guards |
| Remotely deployed | Nothing |
| Remotely verified | Nothing |
| Blocked | No detected project reference, linked project, staging credentials, Supabase/PostgreSQL/Docker tools, identity evidence, backup or real Auth fixture accounts |

## Files created

- `supabase/migration-manifest.json` — single authoritative sequence, objects, cumulative dependencies, clean/existing suitability, manual actions and SHA-256 hashes.
- `supabase/staging_security.sql` — forward repair at step 23.
- `supabase/functions/.env.example` — safe server-only variable example.
- `scripts/staging-preflight.cjs` — offline checks, no remote contact or deployment mode; expected exit 1 while gates remain unverified.
- `scripts/staging-inspect.sql` — read-only hosted catalog/flags inspection, to run only after non-production identification.
- `scripts/staging-test.cjs` — full SQL sequence plus security/default/privacy regressions in local PostgreSQL.
- `scripts/staging-edge-test.cjs` — disabled financial-handler branch tests; not hosted Deno execution.
- `docs/staging/RUNBOOK.md`, `ENVIRONMENT.md`, `BACKUP-RECOVERY.md`, `AUDIT.md`, `SECURITY-INVENTORY.md`, `REPORT.md`.

## Files modified

- `.gitignore`, `.env.example`, `package.json`.
- `README.md`, `IMPLEMENTATION.md`, `REALTIME.md`, `CHAT-MESSAGING.md`, `BACKGROUND-AUTOMATION.md`: point to the authoritative staging workflow and new final step.
- Five Edge handlers: `seller-create-payment/index.ts`, `cashfree-create-collaboration/index.ts`, `cashfree-release-split/index.ts`, `cashfree-release-hold/index.ts`, `cashfree-webhook/index.ts` under `supabase/functions/`: disabled-by-default server financial guard.

No React application/layout/routing files were changed. No real `.env` file was overwritten. Local build output was regenerated under ignored `dist/`; logs, generated catalog and browser fixtures/screenshots are under ignored `.tmp/`. The extracted workspace has no `.git`; Git status was unavailable, so no claim of a clean Git diff is made. No files were committed.

## Final migration order and remote outcomes

The original documented order is correct. All 22 originals are preserved, with a forward security repair appended. The manifest is authoritative; this table records this run's outcomes only. Every file applied successfully to the **local fixture**; every remote application is **blocked**.

| # | File | Remote status |
| --- | --- | --- |
| 1 | schema.sql | blocked |
| 2 | experience.sql | blocked |
| 3 | wallet.sql | blocked |
| 4 | partners.sql | blocked |
| 5 | operations.sql | blocked |
| 6 | storage.sql | blocked |
| 7 | seller_subscriptions.sql | blocked |
| 8 | seller_pricing.sql | blocked |
| 9 | seller_posting.sql | blocked |
| 10 | seller_workspace.sql | blocked |
| 11 | seller_finance_extensions.sql | blocked |
| 12 | seller_hardening.sql | blocked |
| 13 | seller_gateway.sql | blocked |
| 14 | seller_subscriptions_v2.sql | blocked |
| 15 | influencer_legal_2026_09_12.sql | blocked |
| 16 | consultant_assessments.sql | blocked |
| 17 | service_partner_registration.sql | blocked |
| 18 | service_partner_posting.sql | blocked |
| 19 | partner_dashboard_banners.sql | blocked |
| 20 | realtime_events.sql | blocked |
| 21 | chat_messaging.sql | blocked |
| 22 | background_automation.sql | blocked |
| 23 | staging_security.sql | blocked |

Remote totals: **0 applied, 0 skipped, 0 failed, 23 blocked**. No automatic ledger/history was fabricated. Edge Functions deployed: **none**, including the unchanged automation worker.

## SQL and security findings

See [AUDIT.md](AUDIT.md) for dependency/replay details. Corrections: owner/Admin authorization on subscription timelines; trusted schemas before explicit `pg_temp`; browser CREATE/trigger-execute revocations; unused legacy message writes denied; financial Edge handlers gated before effects. Original migrations are not generally idempotent; their data backfills and function replacements need existing-database review. Publication registration can be missing despite successful SQL exit. No reordering or duplicate migration copies were introduced.

| Area | Local evidence | Hosted status |
| --- | --- | --- |
| Auth | Ownership/role checks via fixture `auth.uid`; no profile role escalation; backend rejects testing markers | Real login/JWT/role resolution unverified; SMS and recovery pending |
| RLS/grants | All public application tables have RLS; private schema denied to browser roles; existing role-isolation suites pass; new timeline and legacy-write tests pass | Per-table/per-operation real-JWT matrix pending |
| SECURITY DEFINER | Paths inspected; temp shadow regression; trigger execute revoked; existing scoped RPC tests pass | Managed database ownership/grants still require inspection |
| Storage | All three buckets private with MIME/size configuration; owner list and outsider denial in fixture; existing attachment/registration tests pass | Actual upload validation, owner metadata, signed URL expiry/download and policy behavior pending |
| Realtime | Safe envelopes and routing/RLS tests; local UI does not claim Live without connection | Publication membership and live WebSocket/reconnect/logout behavior unverified |
| Chat | Three roles, participant isolation, retry IDs, support permission/audit, attachments covered locally | Real two-session transport and hosted URLs pending |
| Automation | Claims/retries/leases/stale guards/idempotency/scoped control tested; all master/provider defaults false | Worker Deno runtime, server secrets, scheduler and providers unverified; no scheduler configured |

These are local fixture/static/browser results, **not successful staging verification**. The security inventory lists every application table and definer function for the pending hosted matrix. No live financial, notification, workbook or Storage deletion action occurred.

## Preflight and authorization

`npm.cmd run staging:preflight` exits **1 (expected blocked)**. Reference: **none detected**. No `.temp/project-ref` link exists. Supabase CLI, `psql`, `pg_dump`, `pg_restore`, Docker and Git are unavailable on PATH. Required operator/public Supabase variables are missing. Existing environment files contain only a demo setting; actual staging demo flags must be explicitly disabled before building. Local manifest inventory/checksums pass and no parallel timestamped path exists.

Explicit remote confirmation: **not requested and not received**, because there is no detected non-production reference to present. Remote credentials and identity may not be guessed. No Supabase project, database, Auth, Storage or payment/delivery provider was contacted. Backup: **not created**. Backup syntax was researched from official docs; executable/permissions/restore validation remain blocked.

## Test command log

| Command actually run | Result |
| --- | --- |
| `npm.cmd run lint` | PASS |
| `npm.cmd run build` | Initial sandbox attempt failed `spawn EPERM`; authorized local retry PASS; existing >500 kB chunk warning |
| `node scripts/database-test.cjs` | PASS |
| `node scripts/seller-test.cjs` | PASS |
| `node scripts/subscription-correction-test.cjs` | PASS |
| `node scripts/legal-assessment-test.cjs` | PASS |
| `node scripts/service-registration-test.cjs` | PASS |
| `node scripts/service-posting-test.cjs` | PASS |
| `node scripts/realtime-test.cjs` | PASS |
| `node scripts/chat-test.cjs` | PASS |
| `node scripts/automation-test.cjs` | PASS |
| `node scripts/staging-test.cjs` and `npm.cmd run test:staging` | Final PASS; during development the new path allowlist initially omitted trusted `storage`, then the new fixture omitted required trial timestamps; both corrected before final run |
| `node scripts/staging-edge-test.cjs` | PASS; five disabled handler guards tested without network calls |
| `node scripts/service-registration-browser-test.cjs` | First attempt failed to find initial English control during startup; warmed-server retry PASS, 360/390/430 and desktop |
| `node scripts/service-posting-browser-test.cjs` | PASS, 360/390/430 |
| `node scripts/legal-assessment-browser-test.cjs` | PASS, local legal/assessment workflow |
| `node scripts/realtime-browser-test.cjs` | PASS, 360/390/430 and desktop; local offline state only |
| `node scripts/chat-browser-test.cjs` | PASS, 360/390/430 and desktop |
| `node scripts/smoke.cjs` | PASS, explicitly credentials-free local demo fixture including local `0000`; not staging authentication |
| `node scripts/staging-preflight.cjs` and `npm.cmd run staging:preflight` | Expected BLOCKED, exit 1; no remote contact |

Supporting `npm.cmd run dev -- --host 127.0.0.1` initially failed sandbox `spawn EPERM`, then started successfully with local subprocess permission for the browser checks and was stopped afterward. No approval-review rejection occurred. Purely artwork/demo suites unrelated to backend changes were not rerun. Deno/hosted Edge tests, actual Supabase RLS/JWT/Storage tests and backup restore were not run because prerequisites are absent. No destructive suite targeted staging or production.

## Remaining blockers and next actions

1. Install the missing local tools and create/identify a separate staging project. Supply its reference and non-production ownership/purpose; securely configure variables from [ENVIRONMENT.md](ENVIRONMENT.md). Do not send secret values in chat.
2. Follow [RUNBOOK.md](RUNBOOK.md): link the verified target, inspect real history/schema/permissions, display the reference, and obtain explicit user approval before writes. Unknown history/drift or identity blocks deployment.
3. Complete and rehearse the timestamped backup procedure. Then apply only the reviewed missing files in order, stop on failure, record outcomes, and deploy only the required paused worker with server-only secrets.
4. Verify real Auth fixture accounts, complete the table/role matrix, inspect Storage/publication and test two-session chat/realtime. Approved legal content and Consultant question banks are separate prerequisites for complete registration journeys.
5. Leave providers/scheduler/billing off. Missing external adapters, workbooks, notifications, scanning, retention and delivery integrations are listed in the audit/runbook and remain unavailable.

**Production was untouched.** Clean-database automation, billing, payment, refund, payout, workbook and notification-delivery defaults remain disabled; financial Edge guards now default disabled too. No remote switch was changed or inspected, so its actual state is unknown. No live integration was enabled by this work.
