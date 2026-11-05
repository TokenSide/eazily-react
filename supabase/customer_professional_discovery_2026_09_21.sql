begin;

-- Public customer discovery exposes only reviewed profile fields and published
-- image references. Registration documents and unmoderated application JSON stay private.
create or replace function public.customer_can_read_partner_media(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.partner_applications application
    join public.profiles owner on owner.id = application.customer_id
    where application.role = 'professional'
      and application.status = 'approved'
      and owner.account_status = 'active'
      and public.seller_can_receive_booking(application.id)
      and (
        exists (
          select 1
          from public.partner_posts post
          cross join lateral jsonb_array_elements(coalesce(post.details -> 'media', '[]'::jsonb)) media
          where post.partner_id = application.id
            and post.role = 'professional'
            and post.status = 'published'
            and coalesce(post.details ->> 'postType', 'offering') in ('offering', 'photo', 'portfolio')
            and media ->> 'path' = p_path
            and coalesce(media ->> 'type', '') like 'image/%'
            and media ->> 'path' not like '%/documents/%'
        )
        or exists (
          select 1
          from jsonb_array_elements(coalesce(application.details -> 'ownerShopMedia', '[]'::jsonb)) media
          where media ->> 'path' = p_path
            and coalesce(media ->> 'type', '') like 'image/%'
            and media ->> 'path' not like '%/documents/%'
        )
      )
  )
$$;

revoke all on function public.customer_can_read_partner_media(text) from public;
grant execute on function public.customer_can_read_partner_media(text) to anon, authenticated;

drop policy if exists "Customer published professional images" on storage.objects;
create policy "Customer published professional images"
on storage.objects for select
to anon, authenticated
using (
  bucket_id = 'partner-media'
  and public.customer_can_read_partner_media(name)
);

create or replace view public.customer_professional_directory as
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
  select media as profile_photo_media
  from jsonb_array_elements(coalesce(application.details -> 'ownerShopMedia', '[]'::jsonb)) media
  where coalesce(media ->> 'type', '') like 'image/%'
    and media ->> 'path' not like '%/documents/%'
  limit 1
) profile_media on true
left join lateral (
  select coalesce(jsonb_agg(photos.media order by photos.updated_at desc), '[]'::jsonb) as portfolio_media
  from (
    select media, published.updated_at
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
  and public.seller_can_receive_booking(application.id);

create or replace view public.customer_professional_reviews as
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
  and public.seller_can_receive_booking(application.id);

revoke all on public.customer_professional_directory, public.customer_professional_reviews from public;
grant select on public.customer_professional_directory, public.customer_professional_reviews to anon, authenticated;

commit;
