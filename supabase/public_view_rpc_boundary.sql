-- Migration 48. The Data API must expose public, not this dedicated internal schema.
-- Keep these exact EXECUTE grants: security_invoker public views call the helpers as the reader.
begin;

create schema eazily_public_read_internal;
revoke all on schema eazily_public_read_internal from public, anon, authenticated;
grant usage on schema eazily_public_read_internal to anon, authenticated;

alter function public.read_customer_reviews() set schema eazily_public_read_internal;
alter function public.read_vendor_directory() set schema eazily_public_read_internal;
alter function public.read_partner_directory() set schema eazily_public_read_internal;
alter function public.read_partner_public_config() set schema eazily_public_read_internal;
alter function public.read_customer_professional_directory() set schema eazily_public_read_internal;
alter function public.read_customer_professional_reviews() set schema eazily_public_read_internal;
alter function public.read_customer_service_verification() set schema eazily_public_read_internal;

-- The old shallow pick returned the entire caller-supplied packageSnapshot object.
-- Retain only the public, scalar package fields used by the existing offering flow.
create or replace function eazily_public_read_internal.read_partner_directory()
returns setof public.partner_directory
language sql stable security definer
set search_path = pg_catalog, public, eazily_private, pg_temp
as $public_view$
select p.id,p.partner_id,p.role as partner_role,
 eazily_private.pick(p.details,array['postType','title','description','category','service','caption','area','availability','hashtags','linkedPostId','packageId','deliverables','deliverableCount','timeline','revisions','usageRights','advertisingPermissions','audience','mode','duration','offerBenefit','offerStarts','offerEnds','offerTerms']) ||
 case when jsonb_typeof(p.details->'packageSnapshot')='object' then
   jsonb_build_object('packageSnapshot',
     (select coalesce(jsonb_object_agg(item.key,item.value),'{}'::jsonb)
      from jsonb_each(p.details->'packageSnapshot') item
      where (item.key=any(array['id','title','category','deliverables','usageRights','advertisingPermissions','area'])
             and jsonb_typeof(item.value)='string')
         or (item.key=any(array['deliverableCount','packagePrice','timeline','revisions'])
             and jsonb_typeof(item.value) in ('string','number')
             and length(item.value #>> '{}') <= 32)))
 else '{}'::jsonb end || eazily_private.post_price(p) as details,
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
from public.partner_posts p join public.partner_applications a on a.id=p.partner_id
left join public.partner_availability av on av.partner_id=a.id
where p.status='published' and a.status='approved' and (auth.uid() is null or a.customer_id<>auth.uid())
$public_view$;

-- ALTER FUNCTION SET SCHEMA retains ACLs; assert the intended least-privilege ACLs.
revoke all on function
 eazily_public_read_internal.read_customer_reviews(),
 eazily_public_read_internal.read_vendor_directory(),
 eazily_public_read_internal.read_partner_directory(),
 eazily_public_read_internal.read_partner_public_config(),
 eazily_public_read_internal.read_customer_professional_directory(),
 eazily_public_read_internal.read_customer_professional_reviews(),
 eazily_public_read_internal.read_customer_service_verification()
from public, anon, authenticated;
grant execute on function
 eazily_public_read_internal.read_customer_reviews(),
 eazily_public_read_internal.read_vendor_directory(),
 eazily_public_read_internal.read_partner_directory(),
 eazily_public_read_internal.read_partner_public_config(),
 eazily_public_read_internal.read_customer_professional_directory(),
 eazily_public_read_internal.read_customer_professional_reviews(),
 eazily_public_read_internal.read_customer_service_verification()
to anon, authenticated;

commit;
