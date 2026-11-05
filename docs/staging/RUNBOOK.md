# Eazily staging deployment runbook

**Current result: Staging deployment was not performed.** No project reference or credentials were detected. No remote connection, backup, migration, function deployment or hosted verification occurred. This is not production launch approval.

## Canonical migration path

[`supabase/migration-manifest.json`](../../supabase/migration-manifest.json) is the single authoritative ordered manifest. SQL stays in its original location; there is no duplicate timestamped path. `schema.sql` creates the base enums, profiles, categories, services, vendors, requests, legacy messages, RLS and Auth-user trigger. `experience.sql` extends that base. The original 22-file order passed a clean PGlite application including `storage.sql`; step 23 is the new forward security repair. Local managed-service fixtures do not prove hosted compatibility.

Do **not** use `supabase db push` for this layout: it ignores these manually ordered root SQL files. Do not stamp an existing populated database as current, invent migration history, or use migration repair to hide differences. Timestamp conversion is unnecessary for this preparation; if later adopted, move the canonical files once, preserve order and checksums, reconcile history explicitly, and remove the manual execution path.

## Hard gates and exact setup sequence

1. Install the Supabase CLI, a PostgreSQL client compatible with the server (`psql`, `pg_dump`, `pg_restore`), and Docker if using CLI dump/diff. No tools were installed here. CLI instructions: [official installation](https://supabase.com/docs/guides/local-development/cli/getting-started).
2. In Dashboard, create or identify a **separate** project explicitly named/owned as staging or development. Record its reference and non-production purpose with the owner. Stop if uncertain. Do not list/connect to production databases. Configure secret-manager-backed operator variables from [ENVIRONMENT.md](ENVIRONMENT.md); never overwrite the existing real `.env` files.
3. Run the offline preflight. It intentionally exits nonzero until remote gates are independently checked; it has no deployment mode and cannot authorize writes:

   ```powershell
   npm.cmd run staging:preflight
   supabase --version
   psql --version
   pg_dump --version
   pg_restore --version
   docker --version
   ```

4. After non-production identity is established, use the reference already supplied through the environment, not a guessed value:

   ```powershell
   supabase login
   supabase link --project-ref "$env:SUPABASE_PROJECT_REF"
   if ($LASTEXITCODE -ne 0) { throw 'Link failed' }
   supabase migration list --linked
   if ($LASTEXITCODE -ne 0) { throw 'History unavailable' }
   ```

   `login` may be omitted when `SUPABASE_ACCESS_TOKEN` is securely supplied. Never print it. Link must match Dashboard, the PostgreSQL service connection host/user, and `VITE_SUPABASE_URL`. Supabase's CLI history may be empty because these files were manually applied; **empty history does not mean an empty database**.
5. Show the detected reference and ask: **“Confirm that Supabase project `<detected reference>` is staging/development and authorize the reviewed missing migrations and paused Edge Function deployment.”** Record the user's explicit reply. A project label, elapsed time, a local variable or a successful test is not approval. This question has not been asked yet because no reference exists here.
6. Read-only inspect with the approved PostgreSQL service connection:

   ```powershell
   psql -X --no-password -v ON_ERROR_STOP=1 --file scripts/staging-inspect.sql
   if ($LASTEXITCODE -ne 0) { throw 'Inspection incomplete; stop' }
   ```

   Before installation, missing post-install tables are expected, not proof of readiness. Verify `auth.users`, `auth.uid()`, `auth.role()`, `storage.objects` including `owner_id`/`metadata`, `storage.foldername`, managed roles, extension privileges and PostgreSQL support for `security_invoker` views. Only `pgcrypto` is required; no `pg_cron`, `pg_net` or scheduler installation is necessary.
7. Reconcile each manifest file against actual schema/function/policy definitions, grants, trigger state and data backfills. Inspect both CLI history and any existing manual ledger. Produce a reviewed plan with `missing`, `applied`, `unknown`, or `conflict`; **unknown/conflict blocks deployment**. Obtain schema-only dumps from the remote and a disposable local Supabase instance at the same applied prefix, normalize ownership/version noise, and compare. Review additional expected changes against the complete local schema. `supabase db diff --linked` is not authoritative here because there are no CLI timestamped migrations; do not mistake an empty local directory for the desired schema. Do not import customer data into local tests.
8. Complete and rehearse [BACKUP-RECOVERY.md](BACKUP-RECOVERY.md). Backup capability, verified files and restore evidence are mandatory. If any required permission, backup, identity, history or drift evidence is missing, stop.

## Controlled manual execution after approval and every gate

Use a restricted deployment ledger outside browser exposure with sequence, filename, SHA-256, UTC time, operator and outcome. Existing deployments without trustworthy history need reviewed baselining; do not run old scripts to create history. Record the baseline without changing business data, only after explicit approval. A proposed ledger can live in `eazily_private.staging_migration_history` once that schema exists, with all privileges revoked from PUBLIC/anon/authenticated. Creating or baselining that ledger is itself an approved remote change.

Apply **one reviewed missing file at a time**:

```powershell
# $migrationFile must come from the approved missing-file plan and canonical manifest.
psql -X --no-password -v ON_ERROR_STOP=1 --file "$migrationFile"
if ($LASTEXITCODE -ne 0) { throw 'Migration failed: stop all dependent work and reconcile partial state' }
```

Record `applied` only after successful exit and postconditions. Record known applied matching files `skipped`, first unsuccessful file `failed`, and all dependent files `blocked`. Do not automatically continue. Older scripts contain explicit transaction boundaries; the publication block in `realtime_events.sql` follows its commit, so a post-commit problem can leave partial progress. A process crash after commit but before ledger recording requires inspection, never blind replay. Never reset, recreate, truncate or delete the remote database.

The full migration plan must be installed with application access paused: earlier versions of replaced functions are not the final security state. Stop and reconcile if a later security migration fails.

## Edge Functions and secrets checklist

| Function | Staging action | Authentication / safety gate |
| --- | --- | --- |
| automation-worker | Deploy only after all DB checks; leave scheduler absent and master disabled | Keep platform JWT verification enabled; additionally requires server-only scheduler secret |
| seller-create-payment | Optional deploy in disabled state only | Caller JWT validated; new provider gate disabled; DB checkout switch false |
| cashfree-create-collaboration | Optional disabled deployment only | Caller JWT; provider gate disabled; Cashfree DB switch false |
| cashfree-release-split | Optional disabled deployment only | Internal workflow secret; provider gate disabled; no payout activation |
| cashfree-release-hold | Optional disabled deployment only | Internal workflow secret; provider gate disabled; no payout activation |
| cashfree-webhook | Leave disabled; no provider webhook configured | New provider gate disabled; signature path not hosted-verified; do not disable JWT verification in this task |

Only the paused worker is required for this task. Deploy individual functions, never a wildcard that silently publishes legacy provider endpoints. Review actual remote function configuration; no project `config.toml` was present. Default JWT verification must remain enabled.

```powershell
# After explicit approval only. File is private and outside Git; values never echoed.
supabase secrets set --project-ref "$env:SUPABASE_PROJECT_REF" --env-file "$privateWorkerSecretsFile"
if ($LASTEXITCODE -ne 0) { throw 'Secret installation failed' }
supabase functions deploy automation-worker --project-ref "$env:SUPABASE_PROJECT_REF"
if ($LASTEXITCODE -ne 0) { throw 'Worker deployment failed' }
```

The secrets file contains `AUTOMATION_SCHEDULER_SECRET` and disabled `EAZILY_FINANCIAL_PROVIDERS_ENABLED`; use a cryptographically random secret from the secret manager. Do not set provider credentials, enable schedules, or manually invoke business handlers. Test missing/invalid worker JWT and scheduler header using a dedicated staging harness with secret-redacted logging; valid requests must claim zero work with the master disabled. Never expose a service-role token to browsers. Hosted runtime and webhook/provider settlement remain pending.

## Auth and role checklist

- Build staging with the actual matching public Supabase URL/key and `vite build --mode staging`; turn off every demo/test-skip variable in the actual build environment. Inspect the artifact/config and verify real sessions. The current credentials-free build is a local regression artifact, **not a staging deliverable**.
- Configure only the staging site URL and exact redirect allowlist, session/JWT settings, rate limits, and approved Auth providers. Never configure static OTP `0000` in staging. Account recovery and SMS OTP activation are pending unless already legitimately configured; sending SMS/email is not authorized here.
- `profiles.role` is customer/seller/admin; partner roles come from approved `partner_applications` (`professional`, `influencer`, `consultant`). Do not assign arbitrary partner roles to the profile enum or trust browser metadata. Admin staff permissions remain server-owned.
- Provision separate synthetic fixture identities using an approved Auth mechanism without delivery. Exercise customer A/B, each approved partner role, unapproved partner, normal Admin, scoped support, and scoped automation operator. Never use the service-role client for a user-isolation assertion.
- Reject cross-account profile/role updates, application/bank/KYC reads, approval bypass, unapproved discovery/publishing, and stale testing markers. Existing backend SQL rejects preview registration/assessment shortcuts; a browser's test account is not an Auth identity.
- Missing legal Service Partner documents, unresolved Influencer legal identity fields, and approved Consultant six-question banks block those complete business journeys. Publish authorized content separately; do not invent it.

## Storage checklist

| Bucket | Privacy | Limit | Types |
| --- | --- | --- | --- |
| partner-media | Private | 50 MiB | JPEG, PNG, WebP, MP4, WebM, PDF |
| profile-media | Private | 10 MiB | JPEG, PNG |
| chat-attachments | Private | 10 MiB | JPEG, PNG, WebP, PDF |

Marketing assets currently live under `public/assets`; do not mix private documents into that tree or create a public KYC bucket. Test owner upload/read and outsider list/read/update/delete denial against real Storage, including spoofed paths and ownership changes. Verify MIME/size rejection at the Storage service and registration RPC, unapproved/draft media exclusion, and no private data in directory projections. Chat signed URLs are requested for 300 seconds; verify expiry and authorization in hosted Storage. Signed URLs are bearer capabilities for their lifetime: never persist them in public rows/logs. Inspect other signed-URL call sites too. No malware scanner is configured. Cleanup only marks abandoned attachments; Storage deletion adapter remains unavailable.

## Realtime, chat and automation checklist

- Compare `pg_publication` and `pg_publication_tables`: require only `public.realtime_events` in the shared publication; block `FOR ALL TABLES` or extra private tables. The migration adds the event table if possible but does not remove unsafe pre-existing publication members. Removal requires a reviewed change, not an automatic cleanup.
- In Dashboard Replication, enable the event table if absent; clients subscribe to INSERT only. Check WebSocket access with real user JWTs, not admin credentials. Verify no message bodies, bank/KYC data, raw provider payloads or private notes in envelopes.
- Use two real sessions to test participant isolation, unauthorized subscriptions, logout channel removal, reconnect refresh, duplicate events, retry operation keys, stale responses, and switch between partner roles. Local browser checks cover UI layouts; they do not prove hosted transport.
- Chat support access requires `chat.review`, an open report, a reason, an expiring grant, and audit rows. Verify normal Admin denial and retained audit records for authorized review. Attachment and transcript access must follow the grant scope.
- Anonymous/authenticated clients must not insert/update/delete background jobs, audits, finance cases or review queues; worker RPCs require trusted execution. Confirm stale/cancelled/version-mismatched work cannot run.
- Verify all seven automation/master/provider switches false, `partner_config.cashfree_enabled=false`, and subscription `enabled`, `rollout_enabled`, `payment_checkout_enabled` false. No billing, financial, workbook or notification delivery is enabled. Clean SQL defaults were locally verified; actual remote flags are unknown until inspected.

## Remote verification matrix and evidence

For **every** table listed in the generated [security inventory](SECURITY-INVENTORY.md), record anonymous, owner A, unrelated B, assigned partner, unapproved partner, Admin and scoped-staff outcomes. Check SELECT and each supported write separately, including denied RPC execution and protected column writes. Public catalog/config projections are deliberate exceptions; do not assert that every public-schema table is private. Use synthetic records, stable IDs and transactions where supported; do not run PGlite fixture setup or destructive suites against staging. This repository does not yet have a hosted JWT/Storage/WebSocket test harness or real accounts, so the matrix is **pending**, not passed.

Security-sensitive areas: profiles/addresses/payment methods; applications and embedded KYC/bank fields; consent/assessments; posts and availability; requests/orders/leads; quotes/payment requests/refunds/wallets/payouts/finance; support/admin/staff; conversations/messages/reports/attachments; realtime; jobs/audits/worker runs/outboxes/financial cases/review tasks. `eazily_private` relies on revoked schema usage plus trusted RPCs rather than table RLS; verify no API exposure or accidental grants. All definer functions need both controlled paths and appropriate grants/caller checks, not merely an RLS flag.

Keep raw evidence in a restricted location. Record commands, versions, expected/actual outcomes, timestamps and sanitized errors. Do not log JWTs, signed/private URLs, request bodies or customer rows. See [REPORT.md](REPORT.md) for actual local test results and remaining blockers.
