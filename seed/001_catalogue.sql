-- 001_catalogue.sql — the services a customer can browse and search.
--
-- Safe to run repeatedly. Categories already exist from
-- staging_prelaunch_foundations.sql (manpower, loans, influencers, consultancy,
-- transportation, blood-bank) and are keyed by a unique slug, so this file adds
-- nothing it does not need to and never renames an existing category.
--
-- Run as the `postgres` role (see seed/README.md). Nothing here is reachable for
-- writes from the browser: anon/authenticated hold SELECT only on categories.

begin;

-- Referenced by every service below. Already seeded; this only guarantees the row is
-- present and browsable if it was removed or deactivated. name is left alone because
-- an operator may have renamed it deliberately.
insert into public.categories (name, slug, icon, sort_order, active) values
  ('Services', 'manpower', 'workers', 0, true)
on conflict (slug) do update set active = true;

-- All services live under the existing 'manpower' category on purpose:
-- src/services/marketplace.js hardcodes categoryId 'manpower' and derives
-- catalogueCategory from the slug, so a service under any other category would be
-- unreachable from the customer catalogue.
--
-- services is unique on (category_id, slug), not slug alone, so the conflict target
-- is the pair and category_id is resolved by subquery rather than hardcoded.
insert into public.services (category_id, name, slug, active)
select c.id, v.name, v.slug, true
from (values
  ('Plumber',        'plumber'),
  ('Electrician',    'electrician'),
  ('Carpenter',      'carpenter'),
  ('Painter',        'painter'),
  ('Cleaner',        'cleaner'),
  ('Pest Control',   'pest-control'),
  ('AC Service',     'ac-service'),
  ('Refrigerator',   'refrigerator'),
  ('Deep Cleaning',  'deep-cleaning'),
  ('Car Wash',       'car-wash'),
  ('Car Mechanic',   'car-mechanic'),
  ('Salon at Home',  'salon-at-home'),
  ('Event Staff',    'event-staff')
) as v(name, slug)
join public.categories c on c.slug = 'manpower'
on conflict (category_id, slug) do update set
  name = excluded.name,
  active = true;

commit;

-- Verification: this is the exact shape src/services/marketplace.js getCategories()
-- selects, and every service must sit under the manpower category.
--   select v.name, c.slug from public.services v
--     join public.categories c on c.id = v.category_id
--    where v.active order by v.name;