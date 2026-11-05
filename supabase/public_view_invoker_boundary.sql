-- Migration 47: keep public discovery available without SECURITY DEFINER views.
-- The underlying private tables remain protected by their existing RLS and grants.
-- Each narrowly scoped definer function returns exactly the pre-existing public view row type.
-- Functions are deliberately in the exposed schema: direct RPCs reveal no more than the views.
begin;

-- customer_reviews: published or explicitly public fields only.
create function public.read_customer_reviews() returns setof public.customer_reviews
language sql stable security definer
set search_path = pg_catalog, public, eazily_private, pg_temp
as $public_view$
select r.id, r.vendor_id, r.service_name, r.customer_display_name, r.rating, r.review_text,
 r.authorised_photos, r.created_at,
 exists(select 1 from public.service_requests b where b.id=r.booking_id and b.customer_id=r.customer_id
   and b.assigned_vendor_id=r.vendor_id and b.service_name=r.service_name and b.status='completed') as verified_booking
from public.reviews r where r.published
$public_view$;
revoke all on function public.read_customer_reviews() from public, anon, authenticated;
grant execute on function public.read_customer_reviews() to anon, authenticated;
create or replace view public.customer_reviews with (security_invoker=true) as
  select * from public.read_customer_reviews();

-- vendor_directory: published or explicitly public fields only.
create function public.read_vendor_directory() returns setof public.vendor_directory
language sql stable security definer
set search_path = pg_catalog, public, eazily_private, pg_temp
as $public_view$
select v.id, v.business_name, v.display_name, v.photo_url, v.description, v.verification_status,
 v.experience_years, v.service_names, v.category_id, v.languages, v.coverage, v.prices, v.portfolio,
 v.availability, v.available_now, v.city,
 coalesce((select avg(r.rating)::numeric(2,1) from public.reviews r where r.vendor_id=v.id and r.published),0) as rating,
 (select count(*) from public.reviews r where r.vendor_id=v.id and r.published) as review_count,
 (select min(value::numeric) from jsonb_each_text(v.prices) where value ~ '^[0-9]+(\.[0-9]+)?$') as starting_price
from public.vendors v where v.published
$public_view$;
revoke all on function public.read_vendor_directory() from public, anon, authenticated;
grant execute on function public.read_vendor_directory() to anon, authenticated;
create or replace view public.vendor_directory with (security_invoker=true) as
  select * from public.read_vendor_directory();

-- partner_directory: published or explicitly public fields only.
create function public.read_partner_directory() returns setof public.partner_directory
language sql stable security definer
set search_path = pg_catalog, public, eazily_private, pg_temp
as $public_view$
select p.id,p.partner_id,p.role as partner_role,
 eazily_private.pick(p.details,array['postType','title','description','category','service','caption','area','availability','hashtags','linkedPostId','packageId','packageSnapshot','deliverables','deliverableCount','timeline','revisions','usageRights','advertisingPermissions','audience','mode','duration','offerBenefit','offerStarts','offerEnds','offerTerms']) || eazily_private.post_price(p) as details,
 eazily_private.pick(a.details,array['creatorName','name','businessName','city','category','services','specialisation','experience','qualificationName','language']) ||
 case when p.role='influencer' then jsonb_build_object('platforms',
   (select coalesce(jsonb_agg(jsonb_build_object('name',left(coalesce(platform->>'name',''),80),
     'count',case when coalesce(platform->>'count','') ~ '^[0-9]{1,12}$' then (platform->>'count')::bigint else 0 end)),'[]'::jsonb)
    from jsonb_array_elements(case when jsonb_typeof(a.details->'platforms')='array' then a.details->'platforms' else '[]'::jsonb end) platform))
 else '{}'::jsonb end as profile_details,
 coalesce(a.details->>'creatorName',a.details->>'name') as display_name,
 coalesce(a.details->>'businessName',a.details->>'creatorName',a.details->>'name') as business_name,
 case when a.status='approved' then 'verified' else 'pending' end as verification_status,
 case when coalesce(a.details->>'experience','') ~ '^[0-9]+$' then (a.details->>'experience')::integer else 0 end as experience_years,
 array[coalesce(p.details->>'service',p.details->>'category')] as service_names,
 coalesce(p.details->>'category','') as category_id,
 string_to_array(coalesce(a.details->>'language',''),',') as languages,
 array[coalesce(p.details->>'area',a.details->>'city')] as coverage,
 '[]'::jsonb as portfolio,
 case when p.role='professional' and eazily_private.post_price(p) ? 'totalPaise' and p.details->>'service' is not null then jsonb_build_object(p.details->>'service',(eazily_private.post_price(p)->>'totalPaise')::numeric/100) else '{}'::jsonb end as prices,
 coalesce(p.details->>'availability','By appointment') as availability,
 coalesce(p.role='professional' and av.online and av.available_until>now(),false) as available_now,coalesce(a.details->>'city','') as city,
 0::numeric as rating,0::bigint as review_count,
 (eazily_private.post_price(p)->>'totalPaise')::numeric/100 as starting_price,
 case when p.role='consultant' then a.details->>'specialisation' else p.details->>'category' end as specialisation,
 p.details->>'description' as description
from partner_posts p join partner_applications a on a.id=p.partner_id left join partner_availability av on av.partner_id=a.id
where p.status='published' and a.status='approved' and (auth.uid() is null or a.customer_id<>auth.uid())
$public_view$;
revoke all on function public.read_partner_directory() from public, anon, authenticated;
grant execute on function public.read_partner_directory() to anon, authenticated;
create or replace view public.partner_directory with (security_invoker=true) as
  select * from public.read_partner_directory();

-- partner_public_config: published or explicitly public fields only.
create function public.read_partner_public_config() returns setof public.partner_public_config
language sql stable security definer
set search_path = pg_catalog, public, eazily_private, pg_temp
as $public_view$
select id,influencer_threshold,influencer_initial_release_percent,influencer_review_window_hours,availability_minutes,free_intro_minutes,cashfree_enabled from partner_config
$public_view$;
revoke all on function public.read_partner_public_config() from public, anon, authenticated;
grant execute on function public.read_partner_public_config() to anon, authenticated;
create or replace view public.partner_public_config with (security_invoker=true) as
  select * from public.read_partner_public_config();

-- customer_professional_directory: published or explicitly public fields only.
create function public.read_customer_professional_directory() returns setof public.customer_professional_directory
language sql stable security definer
set search_path = pg_catalog, public, eazily_private, pg_temp
as $public_view$
select
  post.id,
  application.id as partner_id,
  'professional'::text as partner_role,
  post.status as post_status,
  true as published,
  true as accepting_bookings,
  false as offline_only_unavailable,
  profile.account_status,
  coalesce(application.details ->> 'name', application.details ->> 'businessName', 'Professional') as display_name,
  coalesce(application.details ->> 'businessName', application.details ->> 'name', 'Professional') as business_name,
  'verified'::text as verification_status,
  post.details ->> 'service' as selected_service,
  offered.service_names,
  offered.prices,
  post.details ->> 'category' as category_id,
  case
    when coalesce(application.details ->> 'experienceYears', application.details ->> 'experience', '') ~ '^[0-9]+$'
      then coalesce(application.details ->> 'experienceYears', application.details ->> 'experience')::integer
    else null
  end as experience_years,
  case when nullif(trim(application.details ->> 'language'), '') is null then array[]::text[]
       else regexp_split_to_array(application.details ->> 'language', '\s*,\s*') end as languages,
  case when nullif(trim(application.details ->> 'qualificationName'), '') is null then array[]::text[]
       else array[application.details ->> 'qualificationName'] end as qualifications,
  coverage.coverage,
  coalesce(application.details ->> 'city', '') as city,
  post.details ->> 'availability' as availability,
  coalesce(availability.online and availability.available_until > now(), false) as available_now,
  post.details ->> 'pricingType' as pricing_type,
  case when coalesce(post.details ->> 'serviceCharge', '') ~ '^\d+(\.\d+)?$' then (post.details ->> 'serviceCharge')::numeric else null end as starting_price,
  case when coalesce(post.details ->> 'visitingCharge', '') ~ '^\d+(\.\d+)?$' then (post.details ->> 'visitingCharge')::numeric else null end as visiting_charge,
  post.details ->> 'description' as description,
  application.details ->> 'specialisation' as specialisation,
  review_stats.rating,
  review_stats.review_count,
  completed.completed_jobs,
  response_stats.expected_response_minutes,
  null::numeric as distance_km,
  profile_media.profile_photo_media,
  portfolio.portfolio_media,
  null::text as cancellation_policy
from public.partner_posts post
join public.partner_applications application on application.id = post.partner_id
join public.profiles profile on profile.id = application.customer_id
left join public.partner_availability availability on availability.partner_id = application.id
left join lateral (
  select
    array_agg(distinct published.details ->> 'service') filter (where nullif(published.details ->> 'service', '') is not null) as service_names,
    coalesce(jsonb_object_agg(published.details ->> 'service', (published.details ->> 'serviceCharge')::numeric)
      filter (where nullif(published.details ->> 'service', '') is not null and coalesce(published.details ->> 'serviceCharge', '') ~ '^\d+(\.\d+)?$'), '{}'::jsonb) as prices
  from public.partner_posts published
  where published.partner_id = application.id
    and published.role = 'professional'
    and published.status = 'published'
    and coalesce(published.details ->> 'postType', 'offering') = 'offering'
) offered on true
left join lateral (
  select array_remove(array[
    nullif(application.details ->> 'city', ''),
    nullif(application.details ->> 'locality', ''),
    nullif(post.details ->> 'area', ''),
    nullif(post.details ->> 'serviceArea', '')
  ], null) as coverage
) coverage on true
left join lateral (
  select round(avg(review.rating)::numeric, 1) as rating, count(*)::bigint as review_count
  from public.seller_reviews review
  join public.partner_orders review_order on review_order.id = review.order_id
  where review.partner_id = application.id
    and review.published
    and review_order.partner_id = application.id
    and review_order.customer_id = review.customer_id
    and review_order.status = 'completed'
) review_stats on true
left join lateral (
  select count(*)::bigint as completed_jobs
  from public.partner_orders completed_order
  where completed_order.partner_id = application.id
    and completed_order.status = 'completed'
) completed on true
left join lateral (
  select case when count(*) >= 3 then round(avg(extract(epoch from (accepted.accepted_at - response_order.created_at)) / 60))::integer end as expected_response_minutes
  from public.partner_orders response_order
  join lateral (
    select min(event.created_at) as accepted_at
    from public.seller_order_events event
    where event.order_id = response_order.id and event.kind = 'accept'
  ) accepted on accepted.accepted_at is not null
  where response_order.partner_id = application.id
) response_stats on true
left join lateral (
  select jsonb_build_object('path',media->>'path','type',media->>'type') as profile_photo_media
  from jsonb_array_elements(coalesce(application.details -> 'ownerShopMedia', '[]'::jsonb)) media
  where coalesce(media ->> 'type', '') like 'image/%'
    and media ->> 'path' not like '%/documents/%'
  limit 1
) profile_media on true
left join lateral (
  select coalesce(jsonb_agg(photos.media order by photos.updated_at desc), '[]'::jsonb) as portfolio_media
  from (
    select jsonb_build_object('path',media->>'path','type',media->>'type') as media, published.updated_at
    from public.partner_posts published
    cross join lateral jsonb_array_elements(coalesce(published.details -> 'media', '[]'::jsonb)) media
    where published.partner_id = application.id
      and published.role = 'professional'
      and published.status = 'published'
      and coalesce(published.details ->> 'postType', 'offering') in ('offering', 'photo', 'portfolio')
      and coalesce(media ->> 'type', '') like 'image/%'
      and media ->> 'path' not like '%/documents/%'
    order by published.updated_at desc
    limit 12
  ) photos
) portfolio on true
where post.role = 'professional'
  and post.status = 'published'
  and coalesce(post.details ->> 'postType', 'offering') = 'offering'
  and application.role = 'professional'
  and application.status = 'approved'
  and profile.account_status = 'active'
  and public.seller_can_receive_booking(application.id)
$public_view$;
revoke all on function public.read_customer_professional_directory() from public, anon, authenticated;
grant execute on function public.read_customer_professional_directory() to anon, authenticated;
create or replace view public.customer_professional_directory with (security_invoker=true) as
  select * from public.read_customer_professional_directory();

-- customer_professional_reviews: published or explicitly public fields only.
create function public.read_customer_professional_reviews() returns setof public.customer_professional_reviews
language sql stable security definer
set search_path = pg_catalog, public, eazily_private, pg_temp
as $public_view$
select
  review.id,
  review.partner_id,
  coalesce(review_order.details ->> 'service', post.details ->> 'service') as service_name,
  'Eazily customer'::text as customer_display_name,
  review.rating,
  review.body as review_text,
  review.reply,
  review.created_at,
  true as verified_booking
from public.seller_reviews review
join public.partner_orders review_order on review_order.id = review.order_id
join public.partner_applications application on application.id = review.partner_id
join public.profiles profile on profile.id = application.customer_id
left join public.partner_posts post on post.id = review_order.post_id
where review.published
  and review_order.status = 'completed'
  and review_order.partner_id = review.partner_id
  and review_order.customer_id = review.customer_id
  and application.role = 'professional'
  and application.status = 'approved'
  and profile.account_status = 'active'
  and public.seller_can_receive_booking(application.id)
$public_view$;
revoke all on function public.read_customer_professional_reviews() from public, anon, authenticated;
grant execute on function public.read_customer_professional_reviews() to anon, authenticated;
create or replace view public.customer_professional_reviews with (security_invoker=true) as
  select * from public.read_customer_professional_reviews();

-- customer_service_verification: published or explicitly public fields only.
create function public.read_customer_service_verification() returns setof public.customer_service_verification
language sql stable security definer
set search_path = pg_catalog, public, eazily_private, pg_temp
as $public_view$
select a.id as partner_id,v.verified_at,
  coalesce((select jsonb_agg(skill.value) from jsonb_array_elements(case when jsonb_typeof(a.details->'skills')='array' then a.details->'skills' else '[]'::jsonb end) skill where jsonb_typeof(skill.value)='string'),'[]'::jsonb) as reported_skills
from public.partner_applications a
left join public.service_document_verifications v on v.partner_id=a.id
where a.status='approved' and a.role='professional'
  and exists (select 1 from public.profiles profile where profile.id=a.customer_id and profile.account_status='active')
  and public.seller_can_receive_booking(a.id)
  and exists (select 1 from public.partner_posts post where post.partner_id=a.id and post.role='professional' and post.status='published' and coalesce(post.details->>'postType','offering')='offering')
$public_view$;
revoke all on function public.read_customer_service_verification() from public, anon, authenticated;
grant execute on function public.read_customer_service_verification() to anon, authenticated;
create or replace view public.customer_service_verification with (security_invoker=true) as
  select * from public.read_customer_service_verification();

commit;
