-- 002_service_professionals.sql — discoverable service professionals.
--
-- WHY THE LEGACY `vendors` TABLE AND NOT partner_applications
-- ------------------------------------------------------------
-- The modern path cannot be seeded. public.enforce_current_service_partner_registration()
-- runs the full six-step registration validator on every INSERT of a `professional`
-- application in status submitted/under_review/approved, and
-- validate_service_partner_registration() requires real uploaded Aadhaar, PAN and
-- Gumasta documents confirmed in private storage:
--
--   if not exists(select 1 from storage.objects
--                 where bucket_id='partner-media' and name=item->>'path')
--   then raise exception 'A document upload was not confirmed by private storage';
--
-- Producing approved partners therefore means fabricating identity documents, or
-- disabling the KYC trigger. Neither is done here, and neither should be.
--
-- public.vendors is the supported legacy catalogue. It carries no KYC guard, and the
-- frontend already reads it: src/services/marketplace.js merges vendor_directory with
-- customer_professional_directory, dedupes them, and applies the same eligibility
-- check. So a published, verified vendor row here is discoverable through exactly the
-- same code path a modern partner is.
--
-- WHAT THIS IS NOT: real accounts. Seeded vendors exist so the directory has content.
-- They hold no verified session and no payment method, so a booking aimed at one will
-- not complete. See "Honest limitations" in seed/README.md.
--
-- Safe to run repeatedly: deterministic ids and ON CONFLICT (id).
-- Run as the `postgres` role. eazily_private.guard_account_write() only restricts
-- writes when auth.uid() IS NOT NULL, so a JWT-less server session keeps insert rights.

begin;

-- ---------------------------------------------------------------- identities --
-- auth.users is managed by GoTrue and normally unreachable. These rows exist only to
-- satisfy profiles.id and vendors.owner_id. created_at and updated_at are set so
-- nothing treats them as brand new; no password or OTP is configured, so they cannot
-- sign in.
insert into auth.users (id, phone, phone_confirmed_at, raw_user_meta_data, created_at, updated_at)
values
  ('33333333-3333-4333-8333-000000000001', '+919800000001', now(), '{"full_name":"Ramesh Kumar"}'::jsonb,  now(), now()),
  ('33333333-3333-4333-8333-000000000002', '+919800000002', now(), '{"full_name":"Sunita Sharma"}'::jsonb, now(), now()),
  ('33333333-3333-4333-8333-000000000003', '+919800000003', now(), '{"full_name":"Arjun Mehta"}'::jsonb,   now(), now()),
  ('33333333-3333-4333-8333-000000000004', '+919800000004', now(), '{"full_name":"Priya Nair"}'::jsonb,    now(), now()),
  ('33333333-3333-4333-8333-000000000005', '+919800000005', now(), '{"full_name":"Vikram Singh"}'::jsonb,  now(), now()),
  ('33333333-3333-4333-8333-000000000006', '+919800000006', now(), '{"full_name":"Neha Gupta"}'::jsonb,    now(), now())
on conflict (id) do nothing;

-- ------------------------------------------------------------------ profiles --
insert into public.profiles (id, role, full_name, phone, city, account_status) values
  ('33333333-3333-4333-8333-000000000001', 'customer', 'Ramesh Kumar',  '+919800000001', 'Bhopal', 'active'),
  ('33333333-3333-4333-8333-000000000002', 'customer', 'Sunita Sharma', '+919800000002', 'Bhopal', 'active'),
  ('33333333-3333-4333-8333-000000000003', 'customer', 'Arjun Mehta',   '+919800000003', 'Indore', 'active'),
  ('33333333-3333-4333-8333-000000000004', 'customer', 'Priya Nair',    '+919800000004', 'Bhopal', 'active'),
  ('33333333-3333-4333-8333-000000000005', 'customer', 'Vikram Singh',  '+919800000005', 'Jaipur', 'active'),
  ('33333333-3333-4333-8333-000000000006', 'customer', 'Neha Gupta',    '+919800000006', 'Indore', 'active')
on conflict (id) do update set
  full_name = excluded.full_name,
  phone = excluded.phone,
  city = excluded.city,
  account_status = excluded.account_status;

-- ------------------------------------------------------------------- vendors --
-- Field-by-field, this is what src/services/customerProfessionalEligibility.js and
-- vendor_directory require:
--   published          = true   -> read_vendor_directory() filters on it
--   verification_status= verified -> eligibility rejects anything else
--   service_names      -> matched against the requested service by canonical name
--   coverage/city      -> matched against the customer's location
--   prices             -> starting_price is the minimum numeric value in this map
--   available_now      -> true for those advertising availability
insert into public.vendors (id, owner_id, business_name, display_name, description, verification_status,
                            rating, city, experience_years, service_names, category_id, languages,
                            coverage, prices, portfolio, availability, available_now, published)
values
  ('88888888-8888-4888-8888-000000000001', '33333333-3333-4333-8333-000000000001',
   'Kumar Plumbing Works', 'Ramesh Kumar',
   'Leak detection, pipe replacement and bathroom fitting. Twelve years on the job across Bhopal.',
   'verified', 4.7, 'Bhopal', 12,
   array['Plumber','Cleaner'], 'manpower', array['Hindi','English'],
   array['Bhopal','MP Nagar','Kolar'], '{"Plumber":499,"Cleaner":899}'::jsonb, '{}'::text[],
   'Available today', true, true),
  ('88888888-8888-4888-8888-000000000002', '33333333-3333-4333-8333-000000000002',
   'Sharma Electrical', 'Sunita Sharma',
   'House wiring, switchboard replacement and fan fitting, with fault finding included.',
   'verified', 4.5, 'Bhopal', 8,
   array['Electrician','AC Service'], 'manpower', array['Hindi'],
   array['Bhopal','Kolar','MP Nagar'], '{"Electrician":599,"AC Service":799}'::jsonb, '{}'::text[],
   'Available today', true, true),
  ('88888888-8888-4888-8888-000000000003', '33333333-3333-4333-8333-000000000003',
   'Mehta Car Care', 'Arjun Mehta',
   'Periodic car service, brakes and suspension, always with a written estimate first.',
   'verified', 4.3, 'Indore', 15,
   array['Car Mechanic','Car Wash'], 'manpower', array['Hindi','English'],
   array['Indore','Vijay Nagar'], '{"Car Mechanic":1200,"Car Wash":699}'::jsonb, '{}'::text[],
   'By appointment', false, true),
  ('88888888-8888-4888-8888-000000000004', '33333333-3333-4333-8333-000000000004',
   'Nair Home Services', 'Priya Nair',
   'Deep cleaning for kitchen, bathroom and bedrooms using eco-friendly products.',
   'verified', 5.0, 'Bhopal', 6,
   array['Deep Cleaning','Cleaner'], 'manpower', array['Malayalam','Hindi','English'],
   array['Bhopal','Arera'], '{"Deep Cleaning":2499,"Cleaner":999}'::jsonb, '{}'::text[],
   'Weekdays', true, true),
  ('88888888-8888-4888-8888-000000000005', '33333333-3333-4333-8333-000000000005',
   'Singh Carpentry', 'Vikram Singh',
   'Custom furniture, modular shelves and door repair. Measured on site before quoting.',
   'verified', 4.2, 'Jaipur', 20,
   array['Carpenter','Painter'], 'manpower', array['Hindi','Rajasthani'],
   array['Jaipur','Malviya Nagar'], '{"Carpenter":1500,"Painter":18}'::jsonb, '{}'::text[],
   'By appointment', false, true),
  ('88888888-8888-4888-8888-000000000006', '33333333-3333-4333-8333-000000000006',
   'Gupta Appliance Care', 'Neha Gupta',
   'AC servicing and gas refilling, plus refrigerator and washing machine repair.',
   'verified', 4.8, 'Indore', 9,
   array['AC Service','Refrigerator'], 'manpower', array['Hindi','English'],
   array['Indore','Rau'], '{"AC Service":999,"Refrigerator":749}'::jsonb, '{}'::text[],
   'Available today', true, true)
on conflict (id) do update set
  owner_id = excluded.owner_id,
  business_name = excluded.business_name,
  display_name = excluded.display_name,
  description = excluded.description,
  verification_status = excluded.verification_status,
  city = excluded.city,
  experience_years = excluded.experience_years,
  service_names = excluded.service_names,
  category_id = excluded.category_id,
  languages = excluded.languages,
  coverage = excluded.coverage,
  prices = excluded.prices,
  availability = excluded.availability,
  available_now = excluded.available_now,
  published = excluded.published;

commit;