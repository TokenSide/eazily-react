-- 003_reviews.sql — published reviews for the seeded vendors.
--
-- vendor_directory derives rating and review_count from public.reviews where
-- published, so without this every seeded professional looks brand new and unrated.
-- The profile page and the discovery card both read those two columns.
--
-- reviews.customer_display_name is what the customer sees, so it is a display label
-- only. No booking_id is set: reviews are not attached to a fabricated order.
--
-- Money hygiene: nothing here creates a service_request, invoice or payment record.
-- A seeded rupee would surface in admin finance views as revenue and is not real, so
-- the financial tables are deliberately left empty and the seed test asserts it.
--
-- Safe to run repeatedly: deterministic ids and ON CONFLICT (id).
-- Run as the `postgres` role. See seed/README.md.

begin;

insert into public.reviews (id, customer_id, vendor_id, service_name, customer_display_name,
                           rating, review_text, published, created_at) values
  ('77777777-7777-4777-8777-000000000001', '33333333-3333-4333-8333-000000000004', '88888888-8888-4888-8888-000000000001', 'Plumber',
   'Anita S.', 5, 'Found the leak quickly and explained the fix before starting anything. Left everything clean afterwards.', true, now() - interval '3 days'),
  ('77777777-7777-4777-8777-000000000002', '33333333-3333-4333-8333-000000000003', '88888888-8888-4888-8888-000000000001', 'Cleaner',
   'Rahul M.', 4, 'Good work overall, though he arrived about an hour later than agreed.', true, now() - interval '9 days'),
  ('77777777-7777-4777-8777-000000000003', '33333333-3333-4333-8333-000000000003', '88888888-8888-4888-8888-000000000002', 'Electrician',
   'Rahul M.', 5, 'Replaced the whole switchboard and tested every point before leaving. Very tidy job.', true, now() - interval '6 days'),
  ('77777777-7777-4777-8777-000000000004', '33333333-3333-4333-8333-000000000004', '88888888-8888-4888-8888-000000000002', 'AC Service',
   'Anita S.', 4, 'Cooling is noticeably better but the outdoor unit was not washed.', true, now() - interval '14 days'),
  ('77777777-7777-4777-8777-000000000005', '33333333-3333-4333-8333-000000000003', '88888888-8888-4888-8888-000000000004', 'Deep Cleaning',
   'Rahul M.', 5, 'Took a full day and the result is excellent. Would book again.', true, now() - interval '11 days'),
  ('77777777-7777-4777-8777-000000000006', '33333333-3333-4333-8333-000000000004', '88888888-8888-4888-8888-000000000006', 'Refrigerator',
   'Anita S.', 5, 'Diagnosed a failing thermostat instead of selling me a whole new part. Very fair price.', true, now() - interval '4 days'),
  ('77777777-7777-4777-8777-000000000007', '33333333-3333-4333-8333-000000000004', '88888888-8888-4888-8888-000000000003', 'Car Mechanic',
   'Anita S.', 4, 'Brake pads and fluid done properly and the estimate matched the final bill.', true, now() - interval '18 days'),
  ('77777777-7777-4777-8777-000000000008', '33333333-3333-4333-8333-000000000003', '88888888-8888-4888-8888-000000000005', 'Carpenter',
   'Rahul M.', 4, 'Measured properly before quoting and the shelves fit exactly.', true, now() - interval '21 days')
on conflict (id) do update set
  rating = excluded.rating,
  review_text = excluded.review_text,
  service_name = excluded.service_name,
  customer_display_name = excluded.customer_display_name,
  published = excluded.published;

commit;