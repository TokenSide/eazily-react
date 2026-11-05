# seed/ — reference data for local and staging

Browsable catalogue, professionals and reviews, so the customer app has something to
show before any real partner has registered. Intended for **local development and
staging only**.

```
001_catalogue.sql            services a customer can browse and search
002_service_professionals.sql  discoverable professionals (profiles + vendors)
003_reviews.sql              published reviews, so ratings aggregate
verify-seed.sql              read-only proof the seed worked, with assertions
test-seed.cjs                local rehearsal: replays everything in PGlite and asserts
```

## Verify before you apply

```powershell
npm run test:seed
```

This replays all 48 manifest migrations plus these files into a throwaway local
PGlite database, then asserts the directory views return usable rows, that a second
run changes nothing, that an anonymous visitor can read but not write, and that the
financial tables stay empty. It touches no network and no remote project.

## Apply

Run as the `postgres` role, in numeric order, one file per `psql` run:

```powershell
psql "$env:EAZILY_DATABASE_URL" -v ON_ERROR_STOP=1 -f seed/001_catalogue.sql
psql "$env:EAZILY_DATABASE_URL" -v ON_ERROR_STOP=1 -f seed/002_service_professionals.sql
psql "$env:EAZILY_DATABASE_URL" -v ON_ERROR_STOP=1 -f seed/003_reviews.sql
psql "$env:EAZILY_DATABASE_URL" -v ON_ERROR_STOP=1 -f seed/verify-seed.sql
```

`ON_ERROR_STOP=1` matters: without it psql reports success after a failed statement.
Never put the connection string in a committed file — see `docs/staging/ENVIRONMENT.md`.
After applying, confirm the linked project is the intended one:

```powershell
node scripts/hosted-recon.cjs
```

All four files are idempotent: deterministic ids plus `ON CONFLICT`, so a rerun
refreshes rows in place rather than duplicating them.

## Why professionals are seeded into the legacy `vendors` table

The modern partner path **cannot** be seeded, and that is deliberate.

`public.enforce_current_service_partner_registration()` runs the full six-step
registration validator on every insert of a `professional` application in status
`submitted`, `under_review` or `approved`. `validate_service_partner_registration()`
requires genuine uploaded identity documents, confirmed in private storage:

```sql
if not exists(select 1 from storage.objects
              where bucket_id='partner-media' and name=item->>'path')
then raise exception 'A document upload was not confirmed by private storage';
```

So an approved partner means a real Aadhaar, PAN and Gumasta upload. Producing those
artificially, or disabling the trigger to skip the check, would fabricate verified
identities. **This seed does neither**, and `test-seed.cjs` asserts the trigger is
still armed afterwards.

`public.vendors` is the supported legacy catalogue: no KYC guard, and already read by
the frontend. `src/services/marketplace.js` merges `vendor_directory` with
`customer_professional_directory`, dedupes them, and runs both through the same
eligibility filter in `customerProfessionalEligibility.js`. A published, verified
vendor row is therefore discoverable through exactly the same code path as a modern
partner. Fields are written to satisfy that filter: `published`, `verification_status`,
`service_names`, `coverage`, `prices`, `available_now`.

## Honest limitations

Read this before treating seeded data as a demo of the real flow.

- **The professionals cannot receive a booking.** They have no verified session and no
  payment method. They render in search, on profile pages and in the booking form, but
  submitting a booking against one will not complete. Exercising the full booking path
  needs a partner who registers through the app with real documents.
- **`auth.users` rows are placeholders.** They exist to satisfy the foreign keys from
  `profiles.id` and `vendors.owner_id`. No password or OTP is configured, so they
  cannot sign in. Prefer the Supabase Admin API if you ever need a real login.
- **Reviews are not attached to orders.** `reviews.booking_id` is left null on purpose.
- **No money is created.** `partner_earnings`, `finance_transactions`, `wallet_lots`,
  `customer_payments`, `service_requests` and `partner_orders` stay empty. A seeded
  rupee would appear in admin finance views as revenue. The test asserts this.
- **Prices are plausible, not real.** They exist so the sort-by-price and estimate
  screens have something to order.

## Removing it

Everything the seed writes uses ids in the `11111111…`/`22222222…`/`33333333…`/
`44444444…`/`55555555…`/`66666666…`/`77777777…`/`88888888…` ranges, so removal is
scoped and reviewable. Dry-run the selects first, then delete children before parents.

```sql
begin;
-- Order matters: reviews reference vendors, vendors reference profiles,
-- and profiles cascade from auth.users.
delete from public.reviews   where id::text like '77777777-7777-4777-8777-%';
delete from public.vendors  where id::text like '88888888-8888-4888-8888-%';
delete from public.profiles where id::text like '33333333-3333-4333-8333-%';
delete from public.services where id::text between
  '22222222-2222-4222-8222-000000000000' and '22222222-2222-4222-8222-000000000999';
-- auth.users rows only if nothing else references those profiles.
-- delete from auth.users where id::text like '33333333-3333-4333-8333-%';
commit;
```

`001_catalogue.sql` does not delete its category on rollback: `manpower` was created by
`staging_prelaunch_foundations.sql`, not by this seed. If you added services under
another category, remove those explicitly.

## Not the same as a migration

These files are deliberately **not** in `supabase/migration-manifest.json`. The manifest
is the authoritative, checksummed deployment record for `ahwbgmnfmzsaiwjglbkb`, and
`scripts/staging-migrate.ps1` refuses to replay it. Demo content does not belong in a
deployment ledger. Keep the manifest for schema; keep this folder for data.