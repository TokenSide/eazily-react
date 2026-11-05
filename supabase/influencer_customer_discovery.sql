-- Expose only public, self-reported platform audience for approved published influencer posts.
-- Private platform URLs and registration fields remain outside the directory projection.
begin;
create or replace view public.partner_directory as
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
where p.status='published' and a.status='approved' and (auth.uid() is null or a.customer_id<>auth.uid());
commit;
