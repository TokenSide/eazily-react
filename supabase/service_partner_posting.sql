-- Simple, role-scoped Service Partner posting and management.
-- Apply after service_partner_registration.sql, seller_posting.sql,
-- seller_workspace.sql, seller_subscriptions_v2.sql, and seller_hardening.sql.
-- This file is intentionally not deployed by the local application.
begin;

create table if not exists eazily_private.service_post_operations(
  operation_key uuid primary key,
  account_id uuid not null,
  action text not null check(action in ('duplicate')),
  source_post_id uuid not null references public.partner_posts(id),
  result_post_id uuid not null references public.partner_posts(id),
  created_at timestamptz not null default now()
);

create table if not exists eazily_private.service_post_publication_state(
  post_id uuid primary key references public.partner_posts(id) on delete cascade,
  was_published boolean not null default false,
  last_published_at timestamptz
);

insert into eazily_private.service_post_publication_state(post_id,was_published,last_published_at)
select id,true,case when status='published' then updated_at else null end
from public.partner_posts
where role='professional' and coalesce(details->>'postType','offering')='offering' and status in('published','paused')
on conflict(post_id) do update set was_published=true,last_published_at=coalesce(excluded.last_published_at,eazily_private.service_post_publication_state.last_published_at);

create or replace function eazily_private.remember_service_publication() returns trigger
language plpgsql security definer set search_path=public,eazily_private as $$
begin
  if new.role='professional' and coalesce(new.details->>'postType','offering')='offering' then
    insert into eazily_private.service_post_publication_state(post_id,was_published,last_published_at)
    values(new.id,new.status='published',case when new.status='published' then now() end)
    on conflict(post_id) do update set
      was_published=eazily_private.service_post_publication_state.was_published or excluded.was_published,
      last_published_at=coalesce(excluded.last_published_at,eazily_private.service_post_publication_state.last_published_at);
  end if;
  return new;
end $$;
drop trigger if exists remember_service_post_publication on public.partner_posts;
create trigger remember_service_post_publication after insert or update of status on public.partner_posts
for each row execute function eazily_private.remember_service_publication();

create or replace function public.save_service_partner_post(
  p_details jsonb,
  p_action text default 'draft',
  p_post_id uuid default null,
  p_operation_key uuid default null
) returns partner_posts language plpgsql security definer set search_path=public,eazily_private as $$
declare
  app partner_applications;
  current_post partner_posts;
  result partner_posts;
  selection jsonb;
  clean jsonb;
  media jsonb;
  next_status text;
  id_value uuid;
  amount numeric;
  visit numeric;
  customer_location boolean;
  prior_operation eazily_private.service_post_operations;
begin
  if auth.uid() is null then raise exception 'Sign in to manage services'; end if;
  select * into app from partner_applications where customer_id=auth.uid() and role='professional';
  if app.id is null then raise exception 'Complete Service Partner registration first'; end if;
  if p_action not in('draft','submit','pause','resume','archive','duplicate') then raise exception 'Invalid service action'; end if;

  if p_post_id is not null then
    select * into current_post from partner_posts where id=p_post_id for update;
    if current_post.id is not null and (current_post.partner_id<>app.id or current_post.role<>'professional') then raise exception 'Service not found in this workspace'; end if;
    if current_post.id is not null and coalesce(current_post.details->>'postType','offering')<>'offering' then raise exception 'Use the original editor for this post'; end if;
  end if;

  if p_action='duplicate' then
    if current_post.id is null then raise exception 'Choose a service to duplicate'; end if;
    if p_operation_key is null then raise exception 'A duplicate request reference is required'; end if;
    select * into prior_operation from eazily_private.service_post_operations where operation_key=p_operation_key;
    if prior_operation.operation_key is not null then
      if prior_operation.account_id<>auth.uid() or prior_operation.source_post_id<>current_post.id then raise exception 'Duplicate request reference mismatch'; end if;
      select * into result from partner_posts where id=prior_operation.result_post_id;
      return result;
    end if;
    id_value:=gen_random_uuid();
    clean:=current_post.details || jsonb_build_object('title','Copy of '||coalesce(current_post.details->>'title',current_post.details->>'service','Service'));
    insert into partner_posts(id,partner_id,role,status,details) values(id_value,app.id,'professional','draft',clean) returning * into result;
    insert into eazily_private.service_post_operations(operation_key,account_id,action,source_post_id,result_post_id) values(p_operation_key,auth.uid(),'duplicate',current_post.id,result.id);
    insert into partner_audit_log(actor_id,action,entity_type,entity_id) values(auth.uid(),'duplicate','partner_post',result.id::text);
    return result;
  end if;

  if p_action in('pause','resume','archive') then
    if current_post.id is null then raise exception 'Choose a service first'; end if;
    if p_action='pause' and current_post.status<>'published' then raise exception 'Only a live service can be paused'; end if;
    if p_action='resume' then
      if current_post.status<>'paused' or not exists(select 1 from eazily_private.service_post_publication_state where post_id=current_post.id and was_published) then raise exception 'Only a previously live service can be resumed'; end if;
      if app.status<>'approved' then raise exception 'Partner approval is required to resume a service'; end if;
    end if;
    update partner_posts set status=case p_action when 'pause' then 'paused' when 'resume' then 'published' else 'archived' end,updated_at=now()
    where id=current_post.id returning * into result;
    insert into partner_audit_log(actor_id,action,entity_type,entity_id) values(auth.uid(),p_action,'partner_post',result.id::text);
    return result;
  end if;

  if jsonb_typeof(coalesce(p_details->'media','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_details->'media','[]'::jsonb))>10 then raise exception 'Maximum ten media items'; end if;
  for media in select value from jsonb_array_elements(coalesce(p_details->'media','[]'::jsonb)) loop
    if coalesce(media->>'path','') not like auth.uid()::text||'/professional/%' or media->>'path' like '%/documents/%' then raise exception 'Media must belong to this Service Partner workspace'; end if;
  end loop;

  if jsonb_typeof(app.details->'serviceSelections')='array' then
    select value into selection from jsonb_array_elements(app.details->'serviceSelections')
    where value->>'categoryId'=p_details->>'categoryId' and value->>'serviceId'=p_details->>'serviceId' limit 1;
  end if;
  if selection is null and coalesce(app.details->'services','[]'::jsonb) ? (p_details->>'service') and p_details->>'category'=app.details->>'category' then
    selection:=jsonb_build_object('categoryId',coalesce(p_details->>'categoryId',app.details->>'category'),'categoryLabel',app.details->>'category','serviceId',p_details->>'service','serviceName',p_details->>'service');
  end if;
  if selection is null and p_action='submit' then raise exception 'Choose one of your registered services'; end if;

  amount:=case when coalesce(p_details->>'serviceCharge','') ~ '^\d+(\.\d{1,2})?$' then (p_details->>'serviceCharge')::numeric end;
  visit:=case when coalesce(p_details->>'visitingCharge','') ~ '^\d+(\.\d{1,2})?$' then (p_details->>'visitingCharge')::numeric end;
  customer_location:=app.details->>'servicePlace' in ('At the customer’s location','Both');
  if p_action='submit' then
    if length(trim(coalesce(p_details->>'title','')))<3 then raise exception 'Add a service title'; end if;
    if coalesce(p_details->>'pricingType','') not in('Fixed Price','Starting Price','Inspection-Based Quote') then raise exception 'Choose a supported pricing type'; end if;
    if amount is null or amount<0 or (p_details->>'pricingType'<>'Inspection-Based Quote' and amount<=0) then raise exception 'Enter a valid service charge'; end if;
    if customer_location and (visit is null or visit<0) then raise exception 'Enter a valid visiting charge'; end if;
  end if;
  amount:=coalesce(amount,0); visit:=case when customer_location then coalesce(visit,0) else 0 end;

  clean:=jsonb_build_object(
    'postType','offering','categoryId',coalesce(selection->>'categoryId',''),'category',coalesce(selection->>'categoryLabel',''),
    'serviceId',coalesce(selection->>'serviceId',''),'service',coalesce(selection->>'serviceName',''),
    'title',left(trim(coalesce(nullif(p_details->>'title',''),selection->>'serviceName','')),120),
    'description',left(trim(coalesce(p_details->>'description','')),500),
    'pricingType',coalesce(nullif(p_details->>'pricingType',''),'Fixed Price'),
    'serviceCharge',amount,'visitingCharge',visit,
    'visitTreatment',case when customer_location and p_details->>'visitTreatment'='Included' then 'Included' else 'Additional' end,
    'servicePlace',app.details->>'servicePlace','area',coalesce(nullif(app.details->>'serviceAreas',''),app.details->>'locality',app.details->>'city'),
    'availability',coalesce(app.details->'workingDays','[]'::jsonb),'quantity',1,'taxInclusive',false,
    'media',coalesce(p_details->'media','[]'::jsonb)
  );
  next_status:=case when p_action='submit' and app.status='approved' then 'pending_review' else 'draft' end;
  id_value:=coalesce(p_post_id,gen_random_uuid());
  insert into partner_posts(id,partner_id,role,status,details) values(id_value,app.id,'professional',next_status,clean)
  on conflict(id) do update set details=excluded.details,status=excluded.status,review_notes=null,updated_at=now()
  where partner_posts.partner_id=app.id and partner_posts.role='professional' returning * into result;
  if result.id is null then raise exception 'Service not found in this workspace'; end if;
  insert into partner_audit_log(actor_id,action,entity_type,entity_id) values(auth.uid(),case when p_action='submit' and app.status<>'approved' then 'save_unverified_draft' else p_action end,'partner_post',result.id::text);
  return result;
end $$;

-- New registrations support several category/service pairs. Keep legacy profiles valid.
create or replace function eazily_private.guard_published_post() returns trigger language plpgsql security definer set search_path=public,eazily_private as $$
declare a partner_applications; media jsonb; valid boolean; kind text; registered boolean;
begin
 if new.status not in('published','pending_review') then return new; end if;
 select * into a from partner_applications where id=new.partner_id;
 if a.status<>'approved' or a.role<>new.role then raise exception 'Approved matching partner role required';end if;
 if new.role='professional' and coalesce(new.details->>'postType','offering')='offering' then
  registered:=exists(select 1 from jsonb_array_elements(coalesce(a.details->'serviceSelections','[]'::jsonb)) item where item->>'categoryId'=new.details->>'categoryId' and item->>'serviceId'=new.details->>'serviceId' and item->>'categoryLabel'=new.details->>'category' and item->>'serviceName'=new.details->>'service')
    or (new.details->>'category'=a.details->>'category' and coalesce(a.details->'services','[]'::jsonb) ? (new.details->>'service'));
  if not registered then raise exception 'Registered category and service required';end if;
 elsif new.details->>'category' is distinct from a.details->>'category' then raise exception 'Registered category required';end if;
 for media in select value from jsonb_array_elements(coalesce(new.details->'media','[]'::jsonb)) loop
  if media->>'path' like '%/documents/%' or media->>'path' not like a.customer_id::text||'/'||a.role||'/%' or media->>'type' not in('image/jpeg','image/png','image/webp','video/mp4','video/webm') then raise exception 'Only your public work media can be attached';end if;
  if to_regclass('storage.objects') is null then raise exception 'Media storage validation is not available';end if;
  execute 'select exists(select 1 from storage.objects where bucket_id=''partner-media'' and name=$1 and owner_id=$2 and (metadata->>''size'')::bigint between 1 and 52428800 and metadata->>''mimetype''=$3)' into valid using media->>'path',a.customer_id::text,media->>'type';
  if not valid then raise exception 'Upload must finish before submission';end if;
 end loop;
 kind:=coalesce(new.details->>'postType','offering');
 if new.status='published' and kind='offering' and not eazily_private.post_price(new) ? 'totalPaise' then raise exception 'Configure complete customer pricing before publishing';end if;
 return new;
end $$;

revoke all on table eazily_private.service_post_operations,eazily_private.service_post_publication_state from public,anon,authenticated;
revoke all on function public.save_service_partner_post(jsonb,text,uuid,uuid),eazily_private.remember_service_publication() from public,anon;
grant execute on function public.save_service_partner_post(jsonb,text,uuid,uuid) to authenticated;
commit;
