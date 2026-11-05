# Eazily durable background automation

This implementation adds a server-owned queue for work that must continue after every Eazily browser is closed. The queue is deliberately paused after installation. It does not deploy a scheduler, enable billing, contact a payment provider, append to a workbook, or send push, SMS, or email.

## Migration and dependencies

Use [migration-manifest.json](supabase/migration-manifest.json) as the authoritative sequence. Automation is step 22; the forward security repair `staging_security.sql` follows at step 23. [The staging runbook](docs/staging/RUNBOOK.md) keeps all switches and the scheduler disabled.

Apply `supabase/background_automation.sql` once as database step **22**, after `supabase/chat_messaging.sql`. It depends on the completed profile, partner, order, pricing, finance, subscription, realtime, and chat schemas. `pgcrypto` is already required by `schema.sql`; no additional extension is required.

For a new database the final sequence is:

1. `schema.sql`
2. `experience.sql`
3. `wallet.sql`
4. `partners.sql`
5. `operations.sql`
6. `storage.sql`
7. `seller_subscriptions.sql`
8. `seller_pricing.sql`
9. `seller_posting.sql`
10. `seller_workspace.sql`
11. `seller_finance_extensions.sql`
12. `seller_hardening.sql`
13. `seller_gateway.sql`
14. `seller_subscriptions_v2.sql`
15. `influencer_legal_2026_09_12.sql`
16. `consultant_assessments.sql`
17. `service_partner_registration.sql`
18. `service_partner_posting.sql`
19. `partner_dashboard_banners.sql`
20. `realtime_events.sql`
21. `chat_messaging.sql`
22. `background_automation.sql`

For an existing database, inspect its migration history and back it up. Apply only the missing migration. Older scripts are not universally repeatable and must not be rerun to change their order.

## Execution model

`background_jobs` provides UTC scheduling, a unique deduplication key, entity version, attempt count, bounded retry count, atomic `FOR UPDATE SKIP LOCKED` claims, expiring worker leases, safe crash recovery, deterministic exponential backoff with jitter, cancellation, and dead-letter state. Handlers lock and reread the business row before every effect. A cancelled, accepted, rescheduled, completed, already-synced, or version-changed record makes obsolete work cancel safely. Each worker pass also performs bounded reconciliation scans so eligible availability, requests, reminders, subscriptions, finance work, review invitations, moderation tasks, and workbook rows that existed before the migration can receive their missing deduplicated jobs.

`supabase/functions/automation-worker/index.ts` is the protected batch runner. It authenticates `x-eazily-scheduler-secret`, creates its own Supabase service-role client on the server, seeds bounded maintenance work, claims at most the configured batch size, invokes the same database handlers used by local tests, and records a worker run. No privileged key is included in React.

Recommended production schedule: invoke the function once per minute. Keep Supabase JWT verification enabled and send both a server-held service-role bearer token and `x-eazily-scheduler-secret`. Store this additional secret only as `AUTOMATION_SCHEDULER_SECRET` in the Edge Function environment. Do not place it in a `VITE_` variable. Deploy the database migration first, then the Edge Function, then configure the scheduler, and only then enable the master switch after operational review.

The queue is paused safely with:

```sql
update public.automation_configuration set enabled=false, updated_at=clock_timestamp() where id=true;
```

Queued rows remain intact. Running handlers recheck the switch before changing business data. Resume only through a trusted Admin/database process by setting `enabled=true`. Financial switches are independent and remain false by default. A disabled financial feature does not schedule reconciliation/submission work; any older queued item for that feature is cancelled without creating a false provider incident:

- `payment_reconciliation_enabled`
- `refund_submission_enabled`
- `payout_submission_enabled`

Workbook switches (`workbook_loan_enabled` and `workbook_logistics_enabled`) also remain false until each real destination and its lookup-before-append adapter are configured.

## Covered operations

- Direct partner-order response expiry, reminders, rescheduling, cancellation cleanup, and review invitations.
- Direct legacy service-request expiry and review invitations without automatic partner reassignment.
- Partner availability expiry while preserving accepted bookings.
- Trial and subscription reminders/evaluation based on the stored trusted approval timeline; missing approval dates create a human review task.
- Notification requests in a metadata-only outbox. In-app requests may reach `queued`; external delivery never becomes `delivered` without provider confirmation.
- Moderation and verification tasks for submitted partner applications, pending posts, Consultant assessment content, reported conversations, refunds requiring review, and reviews. Overdue tasks receive one durable escalation event; the automation never approves or resolves them.
- Payment, refund, and payout reconciliation queues and verified-confirmation RPCs with event idempotency, amount/currency/current-state checks, safe mismatch cases, and one financial transaction key. Each queue is gated by its separate disabled-by-default flag. Refund approval remains human. Payout confirmation rejects disputed or cancelled orders.
- Loan and Logistics work through the existing `excel_lead_outbox`, separated by destination. Success requires a confirmed destination row key stored once in `workbook_delivery_confirmations`.
- Seven-day cleanup of payload-free realtime invalidations and marking abandoned unlinked chat uploads. The Storage object still requires a trusted Storage API deletion pass. Financial, consent, audit, booking, and dispute records are never deleted.

Supported job types are `partner_order_expiry`, `service_request_expiry`, `partner_order_reminder`, `availability_expiry`, `subscription_reminder`, `subscription_evaluation`, `review_invitation`, `notification_queue`, `operational_task_escalation`, `excel_delivery`, `payment_reconciliation`, `refund_submission`, `payout_submission`, `cleanup_realtime_events`, and `cleanup_chat_attachments`.

The default retry policy is six attempts, starting at 60 seconds and doubling up to six hours with bounded jitter. Permanent configuration/state failures go directly to dead letter and create an `automation.manage` review task. Obsolete work and work behind a disabled feature flag are cancelled and are not reported as operational failures. Retry values, reminder lead times, the 15-minute stuck-payment threshold, 24-hour operational escalation, three-minute scheduler-health threshold, and seven-day realtime retention are configuration rows rather than browser timers.

All queue timestamps and comparisons use PostgreSQL `timestamptz` and trusted server time. The existing `partner_orders.deadline` stores an absolute instant but does not store a separate appointment timezone, so there is no timezone name for automation to reinterpret. Current Admin copy and several existing displays still assume Asia/Kolkata; international scheduling needs an explicit saved IANA timezone in a future schema change. This worker does not infer a timezone from Bhopal or from a device clock.

## Security and operations

Queue, provider-event, workbook-confirmation, and worker mutations are unavailable to anonymous and authenticated browser roles. Worker functions require the trusted server role. Job payloads are limited to 4 KB and reject keys or values associated with credentials, tokens, bank/KYC fields, contact details, message bodies, and raw provider data. Errors are reduced to safe codes and sanitized messages.

The Admin **Automation** screen reads the health RPC and the newest safe job metadata. It shows execution and scheduler state, oldest queue age, pending/retrying/running/dead-letter totals, expired leases, review-task deadlines, jobs grouped by type, notification states, workbook states, finance cases, and the last successful run. Visibility needs a verified Admin role or `automation.view`; retry and cancel require `automation.manage`, a written reason, and create both Admin and job audit rows. Raw provider payloads and secrets are never shown.

`notification_outbox` stores only recipient ID, type, authorised entity reference, template key, language, requested channels, timestamps, and state. `automation_provider_events` stores a reference digest instead of provider payloads. Existing private payment evidence remains in its restricted schema.

## External configuration still missing

- Push, SMS, and email providers, templates, credentials, delivery callbacks, and language delivery adapters.
- The exact Loan workbook ID, worksheet/table name, service-account/OAuth method, and a lookup/append/recheck adapter.
- The exact Logistics workbook ID, worksheet/table name, service-account/OAuth method, and a separate lookup/append/recheck adapter.
- Provider-specific payment status lookup and signed-event adapter beyond the existing Cashfree webhook.
- Refund-submission and payout-submission provider adapters and provider confirmation callbacks.
- A verified payout-account source suitable for automated pre-submission eligibility. Until it exists, payout submission must remain disabled.
- A Storage API deletion pass and approved retention/legal-hold policy for abandoned files. The database only marks safe candidates.
- Final data-retention periods for completed job metadata, notification history, and operational tasks. No unapproved archival or deletion period was invented.

## Local verification

Run `npm run test:automation`. It uses PGlite and the real migration/business functions without production credentials. It covers future scheduling, pre-migration record reconciliation, overdue human-task escalation, scheduler-health and queue breakdowns, disabled-by-default financial safeguards, competing claims, lease recovery, retries, maximum attempts, dead letters, cancelled and rescheduled reminders, accepted-request stale protection, availability expiry, trusted subscription timing, payment/refund/payout idempotency and mismatches, dispute holds, workbook retry/confirmation, review invitation replay, cleanup preservation, realtime invalidation, RLS, scoped Admin actions, and prohibited payloads.

PGlite cannot verify a hosted Supabase scheduler, Edge runtime secrets, network failures, actual workbook lookup/append behavior, provider signatures, provider settlement, push/SMS/email delivery, or Storage deletion. Those require authorised sandbox integrations. The current repository configuration performs no remote deployment.

## Disable or remove

Disable the master switch first and stop the scheduler. Keep queued/audit/financial evidence while deciding retention. The isolated integration points are the migration, Edge Function, `AutomationOperations.jsx`, one Admin route/import, the related CSS rules, the test, this document, and the package script. Removing the UI and worker does not affect registration, posting, pricing, chat, or real account data. Do not drop automation tables until operations/legal owners approve disposition of job and audit history.
