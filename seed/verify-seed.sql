-- verify-seed.sql — read-only proof that the seed produced a browsable directory.
--
-- Run after seed/001..003. Every statement is a SELECT. The assertions at the bottom
-- should all report result = PASS.

\pset pager off

\echo '== catalogue =='
select v.name as service, c.slug as category
from public.services v
join public.categories c on c.id = v.category_id
where v.active and c.active
order by c.sort_order, v.name;

\echo ''
\echo '== vendor_directory (what search and nearby actually read) =='
select display_name,
       business_name,
       city,
       service_names,
       starting_price,
       rating,
       review_count,
       available_now
from public.vendor_directory
order by rating desc, display_name;

\echo ''
\echo '== public reviews visible to customers =='
select business_name, customer_display_name, rating, service_name
from public.customer_reviews
order by created_at desc;

\echo ''
\echo '== assertions =='
with checks(ok, expectation, actual) as (
  select count(*) >= 13, 'at least 13 active services', count(*) from public.services where active
  union all
  select count(*) = 6, 'exactly 6 seeded vendors published', count(*)
    from public.vendor_directory
  union all
  select count(*) = 6, 'every seeded vendor is verification_status verified', count(*)
    from public.vendor_directory where verification_status = 'verified'
  union all
  select count(*) = 0, 'no published vendor is unpublished or unverified', count(*)
    from public.vendors where published and verification_status <> 'verified'
  union all
  select count(*) >= 4, 'at least 4 vendors advertise availability now', count(*)
    from public.vendor_directory where available_now
  union all
  select count(*) = 0, 'every published vendor has a starting price', count(*)
    from public.vendor_directory where starting_price is null
  union all
  select count(*) >= 6, 'at least 6 vendors carry an aggregated rating', count(*)
    from public.vendor_directory where rating > 0
  union all
  select count(*) = 8, 'exactly 8 published reviews', count(*) from public.customer_reviews
  union all
  select count(*) = 0, 'every vendor covers a service area', count(*)
    from public.vendors where cardinality(coverage) = 0
  -- Money hygiene. Seeded rows must never look like real revenue or bookings.
  union all
  select count(*) = 0, 'no seeded earnings recorded', count(*) from public.partner_earnings
  union all
  select count(*) = 0, 'no seeded finance transactions', count(*) from public.finance_transactions
  union all
  select count(*) = 0, 'no seeded wallet lots', count(*) from public.wallet_lots
  union all
  select count(*) = 0, 'no seeded customer payments', count(*) from public.customer_payments
  union all
  select count(*) = 0, 'no seeded service requests or bookings', count(*) from public.service_requests
  union all
  -- The KYC integrity guard must still be armed after seeding.
  select count(*) = 1, 'professional KYC validation trigger still present', count(*)
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'partner_applications'
      and t.tgname = 'enforce_current_service_partner_registration'
)
select ok, expectation, actual, case when ok then 'PASS' else 'FAIL' end as result
from checks
order by result desc, expectation;