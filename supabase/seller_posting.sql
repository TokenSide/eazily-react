begin;
alter table partner_posts drop constraint partner_posts_status_check;
alter table partner_posts add constraint partner_posts_status_check check(status in('draft','pending_review','published','changes_required','rejected','paused','archived'));
drop policy "Published posts readable" on partner_posts;
-- Public discovery must not expose raw post inputs or application documents.
create function eazily_private.pick(p_value jsonb,p_keys text[]) returns jsonb language sql immutable as $$
 select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(p_value) where key=any(p_keys)
$$;
revoke all on function eazily_private.pick(jsonb,text[]) from public,anon,authenticated;

create or replace function public.save_partner_post(p_role text,p_details jsonb,p_action text,p_post_id uuid default null) returns partner_posts language plpgsql security definer set search_path=public,eazily_private as $$
declare app partner_applications; result partner_posts; kind text; next_status text; id_value uuid; allowed text[]; assigned consultant_rates;
begin
 select * into app from partner_applications where customer_id=auth.uid() and role=p_role;
 if app.id is null then raise exception 'Complete role onboarding first'; end if;
 if p_action not in('draft','submit','pause','archive') then raise exception 'Invalid post action'; end if;
 if p_action='submit' and app.status<>'approved' then raise exception 'Role approval is required to submit posts'; end if;
 if p_post_id is not null then
  select * into result from partner_posts where id=p_post_id for update;
  if result.id is not null and (result.partner_id<>app.id or result.role<>p_role) then raise exception 'Post not found in this workspace'; end if;
 end if;
 if p_action in('pause','archive') then
  if result.id is null then raise exception 'Post not found in this workspace'; end if;
  update partner_posts set status=case when p_action='archive' then 'archived' else 'paused' end,updated_at=now() where id=result.id returning * into result;
  return result;
 end if;
 kind:=coalesce(p_details->>'postType','offering');
 if kind not in('offering','photo','video','portfolio','offer','knowledge') then raise exception 'Invalid post type'; end if;
 allowed:=array['postType','category','service','title','description','caption','area','availability','media','hashtags','linkedPostId','packageId','packageSnapshot','platform','serviceArea','serviceCharge','visitingCharge','visitTreatment','pricingType','taxInclusive','quantity','inclusions','exclusions','materials','packagePrice','deliverables','deliverableCount','timeline','revisions','usageRights','advertisingPermissions','packageTermsConfirmed','audience','mode','duration','offlineLocation','offerBenefit','offerStarts','offerEnds','offerTerms'];
 if exists(select 1 from jsonb_object_keys(p_details) k where k<>all(allowed)) then raise exception 'Post contains unsupported or protected fields'; end if;
 if p_details ? 'category' and nullif(p_details->>'category','') is not null and p_details->>'category' is distinct from app.details->>'category' then raise exception 'Choose a registered category'; end if;
 if p_role='professional' and nullif(p_details->>'service','') is not null and not coalesce(app.details->'services','[]') ? (p_details->>'service') then raise exception 'Choose a registered service'; end if;
 if p_role='consultant' and p_details ?| array['serviceCharge','visitingCharge','packagePrice'] then raise exception 'Consultant prices are platform managed'; end if;
 if p_details ? 'linkedPostId' and nullif(p_details->>'linkedPostId','') is not null and not exists(select 1 from partner_posts where id=(p_details->>'linkedPostId')::uuid and partner_id=app.id and status='published' and coalesce(details->>'postType','offering')='offering') then raise exception 'Choose your own published offering'; end if;
 if jsonb_typeof(coalesce(p_details->'media','[]'))<>'array' or jsonb_array_length(coalesce(p_details->'media','[]'))>10 then raise exception 'Maximum ten media items'; end if;
 if exists(select 1 from jsonb_array_elements(coalesce(p_details->'media','[]')) m where coalesce(m->>'path','') not like auth.uid()::text||'/'||p_role||'/%') then raise exception 'Media must belong to this workspace'; end if;
 if p_action='submit' then
  if length(trim(coalesce(p_details->>'title','')))<3 or length(trim(coalesce(p_details->>'description','')))<3 or coalesce(p_details->>'category','')='' then raise exception 'Add a title, description and registered category'; end if;
  if kind in('photo','video','portfolio') and jsonb_array_length(coalesce(p_details->'media','[]'))=0 then raise exception 'Upload media before submitting'; end if;
  if kind='offer' then
   if p_role='consultant' then raise exception 'Consultation promotions require platform approval and pricing'; end if;
   if coalesce(p_details->>'linkedPostId','')='' or coalesce(p_details->>'offerBenefit','')='' or coalesce(p_details->>'offerTerms','')='' or (p_details->>'offerEnds')::timestamptz<=now() or (p_details->>'offerEnds')::timestamptz<=(p_details->>'offerStarts')::timestamptz then raise exception 'Complete the offering, benefit, valid dates and conditions'; end if;
  end if;
  if kind='offering' then
   if p_role='professional' and (coalesce(p_details->>'service','')='' or coalesce((p_details->>'serviceCharge')::numeric,-1)<0 or coalesce((p_details->>'visitingCharge')::numeric,-1)<0 or coalesce(p_details->>'pricingType','') not in('Fixed Price','Starting Price','Inspection-Based Quote')) then raise exception 'Complete service and visiting prices'; end if;
   if p_role='influencer' then
    if coalesce((select max((x->>'count')::bigint) from jsonb_array_elements(coalesce(app.details->'platforms','[]')) x),0)<(select influencer_threshold from partner_config) then raise exception 'Correct and verify your qualifying platform audience first'; end if;
    if coalesce((p_details->>'packagePrice')::numeric,0)<=0 or coalesce(p_details->>'deliverables','')='' or coalesce(p_details->>'usageRights','')='' then raise exception 'Paid package, deliverables and usage rights are required'; end if;
   end if;
   if p_role='consultant' then
    select * into assigned from consultant_rates where active and category=p_details->>'category' and duration=(p_details->>'duration')::integer and (partner_id=app.id or partner_id is null) order by partner_id nulls last limit 1;
    if assigned.id is null then raise exception 'Eazily must assign a rate before submission'; end if;
   end if;
  end if;
 end if;
 next_status:=case when p_action='submit' then 'pending_review' else 'draft' end;
 id_value:=coalesce(p_post_id,gen_random_uuid());
 insert into partner_posts(id,partner_id,role,status,details) values(id_value,app.id,p_role,next_status,p_details)
 on conflict(id) do update set details=excluded.details,status=excluded.status,review_notes=null,updated_at=now() where partner_posts.partner_id=app.id and partner_posts.role=p_role returning * into result;
 if result.id is null then raise exception 'Post not found in this workspace'; end if;
 insert into partner_audit_log(actor_id,action,entity_type,entity_id) values(auth.uid(),p_action,'partner_post',result.id::text);
 return result;
end $$;

create function eazily_private.post_price(p partner_posts) returns jsonb language plpgsql security definer set search_path=public,eazily_private as $$
declare amount numeric; input jsonb; calc jsonb;
begin
 if coalesce(p.details->>'postType','offering')<>'offering' then return '{}'::jsonb; end if;
 if p.role='consultant' then select price into amount from consultant_rates where active and category=p.details->>'category' and duration=(p.details->>'duration')::integer and (partner_id=p.partner_id or partner_id is null) order by partner_id nulls last limit 1;
 else amount:=case when p.role='professional' then (p.details->>'serviceCharge')::numeric else (p.details->>'packagePrice')::numeric end; end if;
 if amount is null then return '{}'::jsonb; end if;
 input:=jsonb_build_object('servicePaise',round(amount*100),'quantity',coalesce((p.details->>'quantity')::integer,1),'visitingPaise',case when p.role='professional' and p.details->>'visitTreatment'='Additional' then round(coalesce((p.details->>'visitingCharge')::numeric,0)*100) else 0 end,'additionalPaise',0,'taxInclusive',coalesce((p.details->>'taxInclusive')::boolean,false));
 calc:=eazily_private.calculate(p.role,input);
 return eazily_private.pick(calc,array['servicePaise','feePaise','taxPaise','totalPaise']);
exception when others then return '{}'::jsonb;
end $$;
revoke all on function eazily_private.post_price(partner_posts) from public,anon,authenticated;
-- View expressions require EXECUTE, but the private schema is not exposed to API callers.
grant execute on function eazily_private.pick(jsonb,text[]),eazily_private.post_price(partner_posts) to anon,authenticated;
create or replace view public.partner_directory as
select p.id,p.partner_id,p.role as partner_role,
 eazily_private.pick(p.details,array['postType','title','description','category','service','caption','area','availability','hashtags','linkedPostId','packageId','packageSnapshot','deliverables','deliverableCount','timeline','revisions','usageRights','advertisingPermissions','audience','mode','duration','offerBenefit','offerStarts','offerEnds','offerTerms']) || eazily_private.post_price(p) as details,
 eazily_private.pick(a.details,array['creatorName','name','businessName','city','category','services','specialisation','experience','qualificationName','language']) as profile_details,
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
-- Raw legacy collaboration records include both parties' private amounts.
revoke select on cashfree_collaborations from authenticated,anon;
-- Raw pricing configuration is no longer sent to seller forms.
drop policy "Active consultant rates readable" on consultant_rates;
create policy "Admin consultant rates" on consultant_rates for select using(is_admin());
commit;
