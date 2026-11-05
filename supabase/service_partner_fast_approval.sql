-- Apply after service_partner_posting.sql. Existing posts and live details are retained.
begin;

create table public.service_post_approval_config (
  id boolean primary key default true check (id),
  auto_publish_enabled boolean not null default false,
  min_description_length integer not null default 12 check (min_description_length between 3 and 500),
  duplicate_window_days integer not null default 90 check (duplicate_window_days between 1 and 365),
  require_review_for_new_media boolean not null default true,
  flagged_text_pattern text not null default '(upi|gpay|phonepe|paytm|whatsapp|wa[.]me|scan.{0,15}pay)',
  flagged_media_pattern text not null default '(qr|upi|payment|flagged)',
  updated_at timestamptz not null default now()
);
insert into public.service_post_approval_config(id) values(true) on conflict do nothing;
alter table public.service_post_approval_config enable row level security;
create policy "Admins manage Service Partner approval rules" on public.service_post_approval_config
  for all using (is_admin() or has_staff_permission('post.moderate'))
  with check (is_admin() or has_staff_permission('post.moderate'));
revoke all on public.service_post_approval_config from public,anon,authenticated;
grant select,update on public.service_post_approval_config to authenticated;

create table public.service_post_revisions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.partner_posts(id) on delete cascade,
  details jsonb not null,
  status text not null check(status in ('draft','pending_review','approved','rejected')),
  submitted_by uuid not null references public.profiles(id),
  submitted_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default now()
);
create unique index service_post_one_open_revision on public.service_post_revisions(post_id)
  where status in ('draft','pending_review');
alter table public.service_post_revisions enable row level security;
create policy "Partner reads own service revisions" on public.service_post_revisions for select
  using (exists(select 1 from public.partner_posts p join public.partner_applications a on a.id=p.partner_id
    where p.id=post_id and a.customer_id=auth.uid()));
create policy "Admins read service revisions" on public.service_post_revisions for select
  using (is_admin() or has_staff_permission('post.moderate'));
revoke all on public.service_post_revisions from public,anon,authenticated;
grant select on public.service_post_revisions to authenticated;

create table public.service_post_approval_decisions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.partner_posts(id) on delete cascade,
  revision_id uuid references public.service_post_revisions(id),
  decision text not null check(decision in ('review_required','auto_published','admin_published','admin_rejected','admin_hidden','admin_override')),
  reason text not null check(length(trim(reason))>0),
  decided_by uuid references public.profiles(id),
  decided_at timestamptz not null default clock_timestamp()
);
create index service_post_decisions_post_time on public.service_post_approval_decisions(post_id,decided_at desc);
alter table public.service_post_approval_decisions enable row level security;
create policy "Admins read service decisions" on public.service_post_approval_decisions for select
  using (is_admin() or has_staff_permission('post.moderate'));
revoke all on public.service_post_approval_decisions from public,anon,authenticated;
grant select on public.service_post_approval_decisions to authenticated;

-- A newly selected category cannot inherit approval from an older registration.
create or replace function eazily_private.review_changed_service_selections() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if old.role='professional' and old.status='approved' and not is_admin()
     and old.details->'serviceSelections' is distinct from new.details->'serviceSelections' then
    new.status:='submitted';
    new.review_notes:='Changed services require Admin verification.';
  end if;
  return new;
end $$;
create trigger review_changed_service_selections before update of details on public.partner_applications
  for each row execute function eazily_private.review_changed_service_selections();

-- An unknown category may enter review, but the existing publication guard still blocks it from going live.
create or replace function eazily_private.guard_published_post() returns trigger
language plpgsql security definer set search_path=public,eazily_private as $$
declare a partner_applications; media jsonb; valid boolean; kind text; registered boolean;
begin
 if new.status not in('published','pending_review') then return new; end if;
 select * into a from partner_applications where id=new.partner_id;
 if a.status<>'approved' or a.role<>new.role then raise exception 'Approved matching partner role required';end if;
 if new.role='professional' and coalesce(new.details->>'postType','offering')='offering' then
  registered:=exists(select 1 from jsonb_array_elements(coalesce(a.details->'serviceSelections','[]'::jsonb)) item
    where item->>'categoryId'=new.details->>'categoryId' and item->>'serviceId'=new.details->>'serviceId'
      and item->>'categoryLabel'=new.details->>'category' and item->>'serviceName'=new.details->>'service')
    or (new.details->>'category'=a.details->>'category' and coalesce(a.details->'services','[]'::jsonb) ? (new.details->>'service'));
  if not registered and new.status='published' then raise exception 'Registered category and service required';end if;
 elsif new.details->>'category' is distinct from a.details->>'category' then raise exception 'Registered category required';end if;
 for media in select value from jsonb_array_elements(coalesce(new.details->'media','[]'::jsonb)) loop
  if media->>'path' like '%/documents/%' or media->>'path' not like a.customer_id::text||'/'||a.role||'/%'
     or media->>'type' not in('image/jpeg','image/png','image/webp','video/mp4','video/webm') then
    raise exception 'Only your public work media can be attached';end if;
  if to_regclass('storage.objects') is null then raise exception 'Media storage validation is not available';end if;
  execute 'select exists(select 1 from storage.objects where bucket_id=''partner-media'' and name=$1 and owner_id=$2 and (metadata->>''size'')::bigint between 1 and 52428800 and metadata->>''mimetype''=$3)'
    into valid using media->>'path',a.customer_id::text,media->>'type';
  if not valid then raise exception 'Upload must finish before submission';end if;
 end loop;
 kind:=coalesce(new.details->>'postType','offering');
 if new.status='published' and kind='offering' and not eazily_private.post_price(new) ? 'totalPaise' then
   raise exception 'Configure complete customer pricing before publishing';end if;
 return new;
end $$;

create function eazily_private.unapproved_service_details(p_app public.partner_applications,p_details jsonb)
returns jsonb language plpgsql security definer set search_path=public,eazily_private as $$
declare amount numeric; visit numeric; media jsonb; customer_location boolean;
begin
  if length(trim(coalesce(p_details->>'title','')))<3 or length(trim(coalesce(p_details->>'service','')))<2
     or length(trim(coalesce(p_details->>'category','')))<2 then raise exception 'Complete the proposed service and category'; end if;
  if p_details->>'pricingType' not in ('Fixed Price','Starting Price','Inspection-Based Quote') then raise exception 'Choose a supported pricing type'; end if;
  if coalesce(p_details->>'serviceCharge','') !~ '^\d+(\.\d{1,2})?$' then raise exception 'Enter a valid service charge'; end if;
  amount:=(p_details->>'serviceCharge')::numeric;
  if amount<=0 and p_details->>'pricingType'<>'Inspection-Based Quote' then raise exception 'Enter a valid service charge'; end if;
  customer_location:=p_app.details->>'servicePlace' in ('At the customer’s location','Both');
  if customer_location and coalesce(p_details->>'visitingCharge','') !~ '^\d+(\.\d{1,2})?$' then raise exception 'Enter a valid visiting charge'; end if;
  visit:=case when customer_location then (p_details->>'visitingCharge')::numeric else 0 end;
  if jsonb_typeof(coalesce(p_details->'media','[]'::jsonb))<>'array'
     or jsonb_array_length(coalesce(p_details->'media','[]'::jsonb))>10 then raise exception 'Maximum ten media items'; end if;
  for media in select value from jsonb_array_elements(coalesce(p_details->'media','[]'::jsonb)) loop
    if coalesce(media->>'path','') not like p_app.customer_id::text||'/professional/%' or media->>'path' like '%/documents/%'
       then raise exception 'Media must belong to this Service Partner workspace'; end if;
  end loop;
  return jsonb_build_object('postType','offering','categoryId',left(coalesce(p_details->>'categoryId',''),100),
    'category',left(trim(p_details->>'category'),120),'serviceId',left(coalesce(p_details->>'serviceId',''),120),
    'service',left(trim(p_details->>'service'),120),'title',left(trim(p_details->>'title'),120),
    'description',left(trim(coalesce(p_details->>'description','')),500),
    'pricingType',p_details->>'pricingType','serviceCharge',amount,'visitingCharge',visit,
    'visitTreatment',case when customer_location and p_details->>'visitTreatment'='Included' then 'Included' else 'Additional' end,
    'servicePlace',p_app.details->>'servicePlace','area',coalesce(nullif(p_app.details->>'serviceAreas',''),p_app.details->>'locality',p_app.details->>'city'),
    'availability',coalesce(p_app.details->'workingDays','[]'::jsonb),'quantity',1,'taxInclusive',false,
    'media',coalesce(p_details->'media','[]'::jsonb));
end $$;

create function eazily_private.remove_temporary_service_post(p_post uuid) returns void
language plpgsql security definer set search_path=public,eazily_private as $$
begin
  if to_regclass('public.operational_review_tasks') is not null then
    execute 'delete from public.operational_review_tasks where related_entity_type=''partner_posts'' and related_entity_id=$1'
      using p_post::text;
  end if;
  delete from public.partner_audit_log where entity_type='partner_post' and entity_id=p_post::text
    and action in ('draft','submit');
  delete from public.partner_posts where id=p_post;
end $$;

create or replace function eazily_private.service_post_review_reasons(
  p_app public.partner_applications, p_details jsonb, p_post_id uuid
) returns text[] language plpgsql stable security definer set search_path=public,eazily_private as $$
declare cfg public.service_post_approval_config; reasons text[]:=array[]::text[]; body text;
begin
  select * into cfg from public.service_post_approval_config where id=true;
  if cfg.id is null or not cfg.auto_publish_enabled then reasons:=array_append(reasons,'Automatic approval is disabled'); end if;
  if not exists(select 1 from eazily_private.service_post_publication_state s
      join public.partner_posts p on p.id=s.post_id where p.partner_id=p_app.id and s.was_published and p.id<>p_post_id) then
    reasons:=array_append(reasons,'First Service Partner post requires Admin review');
  end if;
  if p_app.status<>'approved' then reasons:=array_append(reasons,'Partner verification is pending'); end if;
  if length(trim(coalesce(p_details->>'description','')))<coalesce(cfg.min_description_length,12) then
    reasons:=array_append(reasons,'Service description needs review');
  end if;
  if length(trim(coalesce(p_details->>'title','')))<3 or coalesce(p_details->>'service','')=''
     or coalesce(p_details->>'categoryId','')='' or coalesce(p_details->>'pricingType','')=''
     or coalesce(p_details->>'serviceCharge','')='' then
    reasons:=array_append(reasons,'Required service details are incomplete');
  end if;
  if not exists(select 1 from jsonb_array_elements(coalesce(p_app.details->'serviceSelections','[]'::jsonb)) s
      where s->>'categoryId'=p_details->>'categoryId' and s->>'serviceId'=p_details->>'serviceId')
     and not (p_app.details->>'category'=p_details->>'category'
       and coalesce(p_app.details->'services','[]'::jsonb) ? (p_details->>'service')) then
    reasons:=array_append(reasons,'Category or service is not approved');
  end if;
  if exists(select 1 from public.partner_posts p where p.partner_id=p_app.id and p.id<>p_post_id
      and p.status not in('archived','rejected') and p.created_at>now()-make_interval(days=>coalesce(cfg.duplicate_window_days,90))
      and (lower(trim(p.details->>'title'))=lower(trim(p_details->>'title'))
        or (length(trim(coalesce(p_details->>'description','')))>0
          and lower(trim(p.details->>'description'))=lower(trim(p_details->>'description'))))
      and p.details->>'service'=p_details->>'service') then
    reasons:=array_append(reasons,'Similar Service Partner post needs review');
  end if;
  body:=concat_ws(' ',p_details->>'title',p_details->>'description');
  if body ~* '(^|[^0-9])(\+?91[- ]?)?[6-9][0-9]{9}([^0-9]|$)' or body ~* '[a-z0-9._%+-]+@[a-z0-9.-]+[.][a-z]{2,}'
     or body ~* coalesce(nullif(cfg.flagged_text_pattern,''),'a^') then
    reasons:=array_append(reasons,'Contact, payment, or flagged text needs review');
  end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_details->'media','[]'::jsonb)) media
      where coalesce(media->>'path','') ~* coalesce(nullif(cfg.flagged_media_pattern,''),'a^')) then
    reasons:=array_append(reasons,'Flagged media needs review');
  elsif cfg.require_review_for_new_media and exists(
    select 1 from jsonb_array_elements(coalesce(p_details->'media','[]'::jsonb)) media
    where not exists(select 1 from public.partner_posts prior
      where prior.partner_id=p_app.id and prior.status='published' and prior.id<>p_post_id
        and prior.details->'media' @> jsonb_build_array(media))) then
    reasons:=array_append(reasons,'New photo or video needs Admin review');
  end if;
  return reasons;
end $$;

-- The former RPC remains private; the replacement controls every Service Partner submission.
alter function public.save_service_partner_post(jsonb,text,uuid,uuid) rename to service_post_save_legacy;
revoke all on function public.service_post_save_legacy(jsonb,text,uuid,uuid) from public,anon,authenticated;

create function public.save_service_partner_post(p_details jsonb,p_action text default 'draft',p_post_id uuid default null,p_operation_key uuid default null)
returns public.partner_posts language plpgsql security definer set search_path=public,eazily_private as $$
declare old_post public.partner_posts; normalized public.partner_posts; result public.partner_posts; app public.partner_applications;
  reasons text[]; revision public.service_post_revisions; stage_id uuid; unapproved boolean; clean jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in to manage services'; end if;
  select * into app from public.partner_applications where customer_id=auth.uid() and role='professional';
  if app.id is null then raise exception 'Complete Service Partner registration first'; end if;
  if p_post_id is not null then
    select * into old_post from public.partner_posts where id=p_post_id for update;
    if old_post.id is not null and (old_post.partner_id<>app.id or old_post.role<>'professional') then
      raise exception 'Service not found in this workspace';
    end if;
  end if;
  if p_action='resume' and old_post.status='paused' and (
    select decision from public.service_post_approval_decisions where post_id=old_post.id
    order by decided_at desc,id desc limit 1)='admin_hidden' then
    raise exception 'Admin hidden post requires Admin override';
  end if;
  unapproved:=p_action='submit' and app.status='approved' and not (
    exists(select 1 from jsonb_array_elements(coalesce(app.details->'serviceSelections','[]'::jsonb)) s
      where s->>'categoryId'=p_details->>'categoryId' and s->>'serviceId'=p_details->>'serviceId')
    or (app.details->>'category'=p_details->>'category' and coalesce(app.details->'services','[]'::jsonb) ? (p_details->>'service')));
  if old_post.status='published' and p_action in ('draft','submit') then
    if unapproved then
      clean:=eazily_private.unapproved_service_details(app,p_details);
    else
      -- Use the existing validator/normalizer on a temporary draft, never on the live row.
      stage_id:=gen_random_uuid();
      normalized:=public.service_post_save_legacy(p_details,'draft',stage_id,null);
      if p_action='submit' then
        normalized:=public.service_post_save_legacy(p_details,'submit',stage_id,null);
        if normalized.status<>'pending_review' then raise exception 'Partner approval required'; end if;
      end if;
      clean:=normalized.details;
      perform eazily_private.remove_temporary_service_post(stage_id);
    end if;
    if clean is not distinct from old_post.details then return old_post; end if;
    select * into revision from public.service_post_revisions
      where post_id=old_post.id and status in ('draft','pending_review') for update;
    if revision.id is null then
      insert into public.service_post_revisions(post_id,details,status,submitted_by,submitted_at)
      values(old_post.id,clean,case when p_action='submit' then 'pending_review' else 'draft' end,
        auth.uid(),case when p_action='submit' then clock_timestamp() end) returning * into revision;
    else
      update public.service_post_revisions set details=clean,
        status=case when p_action='submit' then 'pending_review' else 'draft' end,
        submitted_at=case when p_action='submit' then clock_timestamp() else null end,
        review_reason=null,reviewed_at=null,reviewed_by=null where id=revision.id returning * into revision;
    end if;
    if p_action='submit' then
      update public.partner_posts set review_notes='Updated version awaiting Admin review; approved version remains live.'
        where id=old_post.id returning * into result;
      insert into public.service_post_approval_decisions(post_id,revision_id,decision,reason,decided_by)
        values(old_post.id,revision.id,'review_required','Published post edits require Admin review',auth.uid());
    else result:=old_post; end if;
    return result;
  end if;
  if unapproved then
    clean:=eazily_private.unapproved_service_details(app,p_details);
    insert into public.partner_posts(id,partner_id,role,status,details)
      values(coalesce(p_post_id,gen_random_uuid()),app.id,'professional','pending_review',clean)
      on conflict(id) do update set status='pending_review',details=excluded.details,updated_at=now()
      where partner_posts.partner_id=app.id and partner_posts.role='professional' returning * into result;
    if result.id is null then raise exception 'Service not found in this workspace'; end if;
    insert into public.service_post_approval_decisions(post_id,decision,reason)
      values(result.id,'review_required','Proposed category or service needs Admin verification');
    return result;
  end if;
  result:=public.service_post_save_legacy(p_details,p_action,p_post_id,p_operation_key);
  if p_action<>'submit' or result.status<>'pending_review' then return result; end if;
  reasons:=eazily_private.service_post_review_reasons(app,result.details,result.id);
  if cardinality(reasons)=0 then
    update public.partner_posts set status='published',review_notes=null,updated_at=now()
      where id=result.id returning * into result;
    insert into public.service_post_approval_decisions(post_id,decision,reason)
      values(result.id,'auto_published','Trusted later post passed configured Service Partner checks');
  else
    insert into public.service_post_approval_decisions(post_id,decision,reason)
      values(result.id,'review_required',array_to_string(reasons,'; '));
  end if;
  return result;
end $$;
revoke all on function public.save_service_partner_post(jsonb,text,uuid,uuid) from public,anon;
grant execute on function public.save_service_partner_post(jsonb,text,uuid,uuid) to authenticated;

-- Older Service Partner photo/portfolio editor also keeps its approved version live.
alter function public.save_partner_post(text,jsonb,text,uuid) rename to save_partner_post_legacy;
revoke all on function public.save_partner_post_legacy(text,jsonb,text,uuid) from public,anon,authenticated;
create function public.save_partner_post(p_role text,p_details jsonb,p_action text,p_post_id uuid default null)
returns public.partner_posts language plpgsql security definer set search_path=public,eazily_private as $$
declare old_post public.partner_posts; staged public.partner_posts; revision public.service_post_revisions;
  stage_id uuid; result public.partner_posts;
begin
  if p_role<>'professional' or p_post_id is null or p_action not in ('draft','submit') then
    return public.save_partner_post_legacy(p_role,p_details,p_action,p_post_id);
  end if;
  select * into old_post from public.partner_posts where id=p_post_id for update;
  if old_post.id is null or old_post.status<>'published' then
    return public.save_partner_post_legacy(p_role,p_details,p_action,p_post_id);
  end if;
  if old_post.role<>'professional' or not exists(select 1 from public.partner_applications
      where id=old_post.partner_id and customer_id=auth.uid()) then raise exception 'Post not found in this workspace'; end if;
  stage_id:=gen_random_uuid();
  staged:=public.save_partner_post_legacy('professional',p_details,p_action,stage_id);
  perform eazily_private.remove_temporary_service_post(stage_id);
  if staged.details is not distinct from old_post.details then return old_post; end if;
  select * into revision from public.service_post_revisions
    where post_id=old_post.id and status in ('draft','pending_review') for update;
  if revision.id is null then
    insert into public.service_post_revisions(post_id,details,status,submitted_by,submitted_at)
      values(old_post.id,staged.details,case when p_action='submit' then 'pending_review' else 'draft' end,
        auth.uid(),case when p_action='submit' then clock_timestamp() end) returning * into revision;
  else
    update public.service_post_revisions set details=staged.details,
      status=case when p_action='submit' then 'pending_review' else 'draft' end,
      submitted_at=case when p_action='submit' then clock_timestamp() else null end,
      reviewed_by=null,reviewed_at=null,review_reason=null where id=revision.id returning * into revision;
  end if;
  if p_action='submit' then
    update public.partner_posts set review_notes='Updated version awaiting Admin review; approved version remains live.'
      where id=old_post.id returning * into result;
    insert into public.service_post_approval_decisions(post_id,revision_id,decision,reason,decided_by)
      values(old_post.id,revision.id,'review_required','Published post edits require Admin review',auth.uid());
  else result:=old_post; end if;
  return result;
end $$;
revoke all on function public.save_partner_post(text,jsonb,text,uuid) from public,anon;
grant execute on function public.save_partner_post(text,jsonb,text,uuid) to authenticated;

-- Existing Admin review keeps its old behaviour for Influencer and Consultant posts.
alter function public.admin_review_post(uuid,text,text) rename to admin_review_post_legacy;
revoke all on function public.admin_review_post_legacy(uuid,text,text) from public,anon,authenticated;
create function public.admin_review_post(p_id uuid,p_status text,p_notes text default null)
returns public.partner_posts language plpgsql security definer set search_path=public,eazily_private as $$
declare post public.partner_posts; result public.partner_posts; decision text;
begin
  if not (is_admin() or has_staff_permission('post.moderate')) then raise exception 'Admin access required'; end if;
  select * into post from public.partner_posts where id=p_id for update;
  if post.id is null then raise exception 'Post not found'; end if;
  if post.role<>'professional' then return public.admin_review_post_legacy(p_id,p_status,p_notes); end if;
  if p_status not in ('published','rejected','changes_required','paused') then raise exception 'Invalid post status'; end if;
  if length(trim(coalesce(p_notes,'')))<3 then raise exception 'Record a reason for this decision'; end if;
  if p_status='published' and post.status not in ('pending_review','paused','rejected','changes_required') then raise exception 'Post is not awaiting approval or hidden'; end if;
  if p_status='paused' and post.status<>'published' then raise exception 'Only a live post can be hidden'; end if;
  update public.partner_posts set status=p_status,
    review_notes=case when p_status='paused' then 'Admin hidden: '||p_notes else p_notes end,
    updated_at=now()
    where id=p_id returning * into result;
  decision:=case when p_status='published' and post.status<>'pending_review' then 'admin_override'
    when p_status='published' then 'admin_published' when p_status='paused' then 'admin_hidden' else 'admin_rejected' end;
  insert into public.service_post_approval_decisions(post_id,decision,reason,decided_by)
    values(p_id,decision,p_notes,auth.uid());
  insert into public.partner_audit_log(actor_id,action,entity_type,entity_id,before_data,after_data)
    values(auth.uid(),'review_post','partner_post',p_id::text,to_jsonb(post),to_jsonb(result));
  return result;
end $$;
revoke all on function public.admin_review_post(uuid,text,text) from public,anon;
grant execute on function public.admin_review_post(uuid,text,text) to authenticated;

create function public.review_service_post_revision(p_revision uuid,p_approve boolean,p_reason text)
returns public.partner_posts language plpgsql security definer set search_path=public,eazily_private as $$
declare revision public.service_post_revisions; post public.partner_posts; result public.partner_posts;
begin
  if not (is_admin() or has_staff_permission('post.moderate')) then raise exception 'Admin access required'; end if;
  if length(trim(coalesce(p_reason,'')))<3 then raise exception 'Record a reason for this decision'; end if;
  select * into revision from public.service_post_revisions where id=p_revision for update;
  if revision.id is null or revision.status<>'pending_review' then raise exception 'Pending revision required'; end if;
  select * into post from public.partner_posts where id=revision.post_id for update;
  if post.status<>'published' then raise exception 'Live approved post required'; end if;
  if p_approve then
    update public.partner_posts set details=revision.details,review_notes=null,updated_at=now()
      where id=post.id returning * into result;
  else
    update public.partner_posts set review_notes=p_reason where id=post.id returning * into result;
  end if;
  update public.service_post_revisions set status=case when p_approve then 'approved' else 'rejected' end,
    reviewed_by=auth.uid(),reviewed_at=clock_timestamp(),review_reason=p_reason where id=revision.id;
  insert into public.service_post_approval_decisions(post_id,revision_id,decision,reason,decided_by)
    values(post.id,revision.id,case when p_approve then 'admin_published' else 'admin_rejected' end,p_reason,auth.uid());
  insert into public.partner_audit_log(actor_id,action,entity_type,entity_id,before_data,after_data)
    values(auth.uid(),'review_service_post_revision','partner_post',post.id::text,to_jsonb(post),to_jsonb(result));
  return result;
end $$;
revoke all on function public.review_service_post_revision(uuid,boolean,text) from public,anon;
grant execute on function public.review_service_post_revision(uuid,boolean,text) to authenticated;

-- Only server RPCs can write post or moderation records, even if a client changes status.
revoke all on function eazily_private.remove_temporary_service_post(uuid),
  eazily_private.unapproved_service_details(public.partner_applications,jsonb),
  eazily_private.service_post_review_reasons(public.partner_applications,jsonb,uuid),
  eazily_private.review_changed_service_selections() from public,anon,authenticated;
revoke insert,update,delete on public.partner_posts from anon,authenticated;
revoke insert,update,delete on public.service_post_approval_decisions,public.service_post_revisions from anon,authenticated;
commit;
