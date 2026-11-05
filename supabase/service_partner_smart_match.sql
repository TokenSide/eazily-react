-- Apply after consumer_legal_transactions.sql, background_automation.sql and seller_pricing.sql.
-- Existing orders and the Influencer/Consultant booking functions are unchanged.
begin;

create table public.service_match_config (
  id boolean primary key default true check (id),
  response_seconds integer not null default 60 check (response_seconds between 15 and 3600),
  max_offers integer not null default 3 check (max_offers between 1 and 10)
);
insert into public.service_match_config(id) values (true) on conflict do nothing;
alter table public.service_match_config enable row level security;
create policy "Admin manages service matching" on public.service_match_config for all
  using (is_admin() or has_staff_permission('automation.manage'))
  with check (is_admin() or has_staff_permission('automation.manage'));
revoke all on public.service_match_config from public,anon,authenticated;
grant select,update on public.service_match_config to authenticated;

alter table public.partner_orders
  add column if not exists backup_opt_in boolean not null default false,
  add column if not exists match_mode text not null default 'direct' check (match_mode in ('direct','find_professional')),
  add column if not exists match_city text,
  add column if not exists match_service text,
  add column if not exists match_category text,
  add column if not exists response_due_at timestamptz,
  add column if not exists backup_price_approval_pending boolean not null default false,
  add column if not exists journey_status text check (journey_status in ('on_the_way'));
create unique index if not exists service_one_active_alternative
  on public.partner_orders(customer_id,(details->>'alternativeFor'))
  where role='professional' and details ? 'alternativeFor' and status not in ('cancelled','completed');

create table public.service_booking_offers (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.partner_orders(id) on delete cascade,
  partner_id uuid not null references public.partner_applications(id),
  post_id uuid not null references public.partner_posts(id),
  sequence integer not null check (sequence > 0),
  status text not null check (status in ('offered','accepted','declined','expired')),
  offered_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  unique(order_id,partner_id), unique(order_id,sequence)
);
create unique index service_booking_one_open_offer on public.service_booking_offers(order_id) where status='offered';
create index service_booking_offer_due on public.service_booking_offers(expires_at) where status='offered';
alter table public.service_booking_offers enable row level security;
create policy "Booking participants read offers" on public.service_booking_offers for select using (
  is_admin() or has_staff_permission('orders.view') or
  exists(select 1 from public.partner_orders o where o.id=order_id and o.customer_id=auth.uid()) or
  exists(select 1 from public.partner_applications a where a.id=partner_id and a.customer_id=auth.uid())
);
revoke all on public.service_booking_offers from public,anon,authenticated;
grant select on public.service_booking_offers to authenticated;

-- Approval alone is not evidence that identity documents were checked.
create table public.service_document_verifications (
  partner_id uuid primary key references public.partner_applications(id),
  verified_at timestamptz not null,
  verified_by uuid not null references public.profiles(id),
  review_reference text not null check(length(trim(review_reference)) >= 8)
);
create policy "Authorized staff read submitted Service Partner documents" on storage.objects for select to authenticated using (
  bucket_id='partner-media' and (is_admin() or has_staff_permission('partner.approve')) and
  exists(select 1 from public.partner_applications a,
    lateral jsonb_array_elements(
      coalesce(a.details->'aadhaar','[]'::jsonb)||coalesce(a.details->'pan','[]'::jsonb)||
      coalesce(a.details->'gumasta','[]'::jsonb)||coalesce(a.details->'udyam','[]'::jsonb)||
      coalesce(a.details->'ownerShopMedia','[]'::jsonb)) document
    where a.role='professional' and a.customer_id::text=(storage.foldername(name))[1]
      and document->>'path'=name)
);
alter table public.service_document_verifications enable row level security;
create policy "Read approved verification result" on public.service_document_verifications for select using (
  is_admin() or has_staff_permission('partner.approve') or
  exists(select 1 from public.partner_applications a where a.id=partner_id and a.customer_id=auth.uid())
);
revoke all on public.service_document_verifications from public,anon,authenticated;
grant select on public.service_document_verifications to authenticated;

create function public.admin_verify_service_documents(p_partner uuid,p_review_reference text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare application partner_applications;
begin
  if not (is_admin() or has_staff_permission('partner.approve')) then raise exception 'Admin verification required'; end if;
  if length(trim(coalesce(p_review_reference,''))) < 8 then raise exception 'Record the document review reference'; end if;
  select * into application from partner_applications where id=p_partner and role='professional' and status='approved';
  if application.id is null then raise exception 'Approved Service Partner required'; end if;
  if jsonb_array_length(coalesce(application.details->'aadhaar','[]'::jsonb))=0 or
     jsonb_array_length(coalesce(application.details->'pan','[]'::jsonb))=0 or
     (coalesce((application.details->>'gumastaHelp')::boolean,false)=false and
      jsonb_array_length(coalesce(application.details->'gumasta','[]'::jsonb))=0) then
    raise exception 'Required private documents are missing';
  end if;
  insert into service_document_verifications(partner_id,verified_at,verified_by,review_reference)
  values(p_partner,clock_timestamp(),auth.uid(),trim(p_review_reference))
  on conflict(partner_id) do update set verified_at=excluded.verified_at,verified_by=excluded.verified_by,review_reference=excluded.review_reference;
  insert into partner_audit_log(actor_id,action,entity_type,entity_id,after_data)
    values(auth.uid(),'verify_service_documents','partner_application',p_partner::text,
      jsonb_build_object('reviewReference',trim(p_review_reference)));
end $$;
revoke all on function public.admin_verify_service_documents(uuid,text) from public,anon,authenticated;
grant execute on function public.admin_verify_service_documents(uuid,text) to authenticated;

create view public.customer_service_verification as
select a.id as partner_id,v.verified_at,
  case when jsonb_typeof(a.details->'skills')='array' then a.details->'skills' else '[]'::jsonb end as reported_skills
from public.partner_applications a
left join public.service_document_verifications v on v.partner_id=a.id
where a.status='approved' and a.role='professional';
revoke all on public.customer_service_verification from public;
grant select on public.customer_service_verification to anon,authenticated;

-- A price is final before booking only for a fixed-price published post with a complete active pricing rule.
create function public.service_booking_estimate(p_post uuid) returns jsonb
language plpgsql security definer set search_path=public,eazily_private,pg_temp as $$
declare p partner_posts; price numeric; visit numeric; quantity integer; calculation jsonb;
begin
  select * into p from partner_posts where id=p_post and role='professional' and status='published';
  if p.id is null or not exists(select 1 from partner_applications a where a.id=p.partner_id and a.status='approved') then
    raise exception 'Published Service Partner offering required';
  end if;
  if coalesce(p.details->>'serviceCharge','') !~ '^\d+(\.\d{1,2})?$' or
     coalesce(p.details->>'visitingCharge','') !~ '^\d+(\.\d{1,2})?$' or
     coalesce(p.details->>'quantity','1') !~ '^\d{1,4}$' or
     coalesce(p.details->>'taxInclusive','false') <> 'false' or
     coalesce(p.details->>'pricingType','') not in ('Fixed Price','fixed','fixed_price') then
    return jsonb_build_object('available',false,'reason','Final payable is confirmed after the service quote.');
  end if;
  price := (p.details->>'serviceCharge')::numeric;
  visit := (p.details->>'visitingCharge')::numeric;
  quantity := greatest(1,least(10000,coalesce(nullif(p.details->>'quantity','')::integer,1)));
  begin
    calculation := eazily_private.calculate('professional',jsonb_build_object(
      'servicePaise',(price*100)::bigint,'visitingPaise',(visit*100)::bigint,
      'additionalPaise',0,'quantity',quantity,'taxInclusive',coalesce((p.details->>'taxInclusive')::boolean,false)));
  exception when others then
    return jsonb_build_object('available',false,'reason','Platform charges and tax are not configured for a final estimate.');
  end;
  return jsonb_build_object('available',true,'servicePaise',(price*quantity*100)::bigint,
    'visitingPaise',(visit*100)::bigint,'feePaise',calculation->'feePaise',
    'platformPaise',(calculation->>'markupPaise')::bigint+(calculation->>'feePaise')::bigint,
    'taxPaise',calculation->'taxPaise','totalPaise',calculation->'totalPaise',
    'pricingRuleVersion',calculation->'version');
end $$;
revoke all on function public.service_booking_estimate(uuid) from public,anon,authenticated;
grant execute on function public.service_booking_estimate(uuid) to anon,authenticated;

create function public.service_match_capabilities() returns jsonb
language sql security definer set search_path=public,pg_temp as $$
  select jsonb_build_object('backupAvailable',coalesce(a.enabled,false)
      and a.scheduler_expected_seconds<=m.response_seconds and exists(
      select 1 from automation_worker_runs run where run.status in('succeeded','partial')
        and run.finished_at>clock_timestamp()-make_interval(secs=>greatest(120,a.scheduler_expected_seconds*2))),
    'responseSeconds',m.response_seconds,'maxOffers',m.max_offers)
  from service_match_config m cross join automation_configuration a where m.id=true and a.id=true
$$;
revoke all on function public.service_match_capabilities() from public,anon,authenticated;
grant execute on function public.service_match_capabilities() to anon,authenticated;

create function public.request_professional_booking(p_post uuid,p_slot timestamptz,p_key uuid,p_backup boolean,p_city text)
returns partner_orders language plpgsql security definer set search_path=public,eazily_private,pg_temp as $$
declare o partner_orders; p partner_posts; a partner_applications; cfg service_match_config; city text; estimate jsonb;
begin
  if coalesce(p_backup,false) and not coalesce((public.service_match_capabilities()->>'backupAvailable')::boolean,false) then
    raise exception 'Backup matching requires a healthy response-time worker';
  end if;
  select * into p from partner_posts where id=p_post and role='professional' and status='published';
  select * into a from partner_applications where id=p.partner_id and role='professional' and status='approved';
  if a.id is null then raise exception 'Choose an approved Service Partner'; end if;
  city := trim(coalesce(p_city,''));
  if length(city) < 2 or length(city)>100 then raise exception 'Choose a service city'; end if;
  select * into cfg from service_match_config where id=true;
  -- The existing public RPC enforces customer legal consent, ownership and idempotency.
  o := public.book_partner_offering(p_post,p_slot,p_key);
  select * into o from partner_orders where id=o.id for update;
  if o.role<>'professional' or o.customer_id<>auth.uid() then raise exception 'Customer Service Partner booking required'; end if;
  if exists(select 1 from service_booking_offers where order_id=o.id) then
    if o.backup_opt_in is distinct from coalesce(p_backup,false) or o.match_city is distinct from city then
      raise exception 'Booking reference belongs to a different backup choice or city';
    end if;
    return o;
  end if;
  estimate := public.service_booking_estimate(p_post);
  update partner_orders set backup_opt_in=coalesce(p_backup,false),match_mode='direct',match_city=city,
    match_service=p.details->>'service',match_category=p.details->>'category',
    response_due_at=clock_timestamp()+make_interval(secs=>cfg.response_seconds),
    details=details||jsonb_build_object('initialEstimate',estimate),status='requested'
  where id=o.id returning * into o;
  insert into service_booking_offers(order_id,partner_id,post_id,sequence,status,expires_at)
  values(o.id,a.id,p.id,1,'offered',o.response_due_at);
  insert into seller_notifications(account_id,role,order_id,title)
  values(a.customer_id,'professional',o.id,'New booking request');
  return o;
end $$;
revoke all on function public.request_professional_booking(uuid,timestamptz,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.request_professional_booking(uuid,timestamptz,uuid,boolean,text) to authenticated;

-- Separate discovery entry point. No customer-selected profile is automatically reassigned.
create function public.request_find_professional_booking(p_service text,p_city text,p_slot timestamptz,p_key uuid)
returns partner_orders language plpgsql security definer set search_path=public,pg_temp as $$
declare chosen_post uuid; result partner_orders;
begin
  select * into result from partner_orders where request_key=p_key and customer_id=auth.uid();
  if result.id is not null then
    if result.match_mode='find_professional' then return result; end if;
    raise exception 'Booking reference already used';
  end if;
  if length(trim(coalesce(p_service,'')))<2 or length(trim(coalesce(p_city,'')))<2 then
    raise exception 'Choose a service and city';
  end if;
  if not coalesce((public.service_match_capabilities()->>'backupAvailable')::boolean,false) then
    raise exception 'Find a professional is unavailable until response-time automation is enabled';
  end if;
  select p.id into chosen_post from partner_posts p
  join partner_applications a on a.id=p.partner_id and a.role='professional' and a.status='approved'
  join profiles profile on profile.id=a.customer_id and profile.account_status='active'
  join partner_availability av on av.partner_id=a.id and av.online and av.available_until>clock_timestamp()
  where p.role='professional' and p.status='published'
    and coalesce(p.details->>'postType','offering')='offering'
    and lower(trim(p.details->>'service'))=lower(trim(p_service))
    and lower(trim(a.details->>'city'))=lower(trim(p_city))
    and a.customer_id<>auth.uid() and seller_can_receive_booking(a.id)
  order by av.confirmed_at desc nulls last,p.updated_at desc,p.id limit 1;
  if chosen_post is null then raise exception 'No available professional for this service and city'; end if;
  result := public.request_professional_booking(chosen_post,p_slot,p_key,false,p_city);
  update partner_orders set match_mode='find_professional',backup_opt_in=true where id=result.id returning * into result;
  return result;
end $$;
revoke all on function public.request_find_professional_booking(text,text,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.request_find_professional_booking(text,text,timestamptz,uuid) to authenticated;

-- A declined direct request stays cancelled. A customer-approved alternative is a new order.
create function public.request_selected_alternative_booking(
  p_original uuid,p_post uuid,p_slot timestamptz,p_key uuid,p_approved_estimate jsonb)
returns partner_orders language plpgsql security definer set search_path=public,pg_temp as $$
declare original_order partner_orders; p partner_posts; a partner_applications; current_estimate jsonb; result partner_orders;
begin
  select * into original_order from partner_orders where id=p_original and customer_id=auth.uid()
    and role='professional' and status='cancelled' and match_mode='direct';
  if original_order.id is null then raise exception 'Cancelled direct booking required'; end if;
  select * into result from partner_orders where request_key=p_key and customer_id=auth.uid();
  if result.id is not null then
    if result.post_id=p_post and result.details->>'alternativeFor'=p_original::text then return result; end if;
    raise exception 'Booking reference already used';
  end if;
  select * into p from partner_posts where id=p_post and role='professional' and status='published';
  select * into a from partner_applications where id=p.partner_id and role='professional' and status='approved';
  if a.id is null or a.id=original_order.partner_id or
    lower(trim(p.details->>'service')) is distinct from lower(trim(original_order.match_service)) or
    lower(trim(a.details->>'city')) is distinct from lower(trim(original_order.match_city)) or
    not exists(select 1 from partner_availability av where av.partner_id=a.id and av.online and av.available_until>clock_timestamp()) or
    not seller_can_receive_booking(a.id) then
    raise exception 'This alternative is no longer available for the same service and city';
  end if;
  current_estimate := public.service_booking_estimate(p_post);
  if not coalesce((current_estimate->>'available')::boolean,false) or current_estimate is distinct from p_approved_estimate then
    raise exception 'The alternative price changed or is unavailable. Review it again before requesting';
  end if;
  result := public.request_professional_booking(p_post,p_slot,p_key,false,original_order.match_city);
  update partner_orders set details=details||jsonb_build_object('alternativeFor',p_original,'approvedEstimate',current_estimate)
    where id=result.id returning * into result;
  return result;
end $$;
revoke all on function public.request_selected_alternative_booking(uuid,uuid,timestamptz,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.request_selected_alternative_booking(uuid,uuid,timestamptz,uuid,jsonb) to authenticated;

commit;

begin;

alter table public.support_tickets add column if not exists partner_order_id uuid references public.partner_orders(id);
create index if not exists support_tickets_partner_order on public.support_tickets(partner_order_id) where partner_order_id is not null;
create policy "Support staff read follow-up actions" on public.support_ticket_replies for select using (
  (is_admin() or has_staff_permission('support.manage')) and
  exists(select 1 from public.support_tickets t where t.id=ticket_id)
);
create function public.guard_service_issue_order() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if new.partner_order_id is not null and not exists (
    select 1 from partner_orders o where o.id=new.partner_order_id and o.customer_id=new.customer_id
      and o.role='professional' and o.status='completed') then
    raise exception 'Completed customer Service Partner booking required';
  end if;
  if tg_op='UPDATE' and new.partner_order_id is distinct from old.partner_order_id then
    raise exception 'Issue booking link cannot be changed';
  end if;
  return new;
end $$;
create trigger guard_service_issue_order before insert or update of partner_order_id on public.support_tickets
  for each row execute function public.guard_service_issue_order();

create function public.report_service_booking_issue(p_order uuid,p_description text) returns support_tickets
language plpgsql security definer set search_path=public,pg_temp as $$
declare o partner_orders; result support_tickets;
begin
  select * into o from partner_orders where id=p_order and customer_id=auth.uid()
    and role='professional' and status='completed';
  if o.id is null then raise exception 'Completed customer Service Partner booking required'; end if;
  if length(trim(coalesce(p_description,''))) not between 10 and 5000 then raise exception 'Describe the issue in 10–5000 characters'; end if;
  insert into support_tickets(customer_id,partner_order_id,category,description)
    values(auth.uid(),o.id,'Booking',trim(p_description)) returning * into result;
  return result;
end $$;
revoke all on function public.report_service_booking_issue(uuid,text) from public,anon,authenticated;
grant execute on function public.report_service_booking_issue(uuid,text) to authenticated;

create function public.admin_follow_up_service_issue(p_ticket uuid,p_status text,p_note text) returns support_tickets
language plpgsql security definer set search_path=public,pg_temp as $$
declare result support_tickets;
begin
  if not (is_admin() or has_staff_permission('support.manage')) then raise exception 'Support permission required'; end if;
  if p_status not in ('open','in_progress','waiting_customer','resolved','closed') then raise exception 'Invalid issue status'; end if;
  if length(trim(coalesce(p_note,''))) not between 3 and 2000 then raise exception 'Record a follow-up action'; end if;
  update support_tickets set status=p_status,updated_at=clock_timestamp()
    where id=p_ticket and partner_order_id is not null returning * into result;
  if result.id is null then raise exception 'Linked Service Partner issue required'; end if;
  insert into support_ticket_replies(ticket_id,author_id,body) values(result.id,auth.uid(),trim(p_note));
  return result;
end $$;
revoke all on function public.admin_follow_up_service_issue(uuid,text,text) from public,anon,authenticated;
grant execute on function public.admin_follow_up_service_issue(uuid,text,text) to authenticated;

commit;

begin;

create function eazily_private.advance_professional_match(p_order uuid,p_reason text,p_now timestamptz)
returns partner_orders language plpgsql security definer set search_path=public,eazily_private,pg_temp as $$
declare o partner_orders; current_offer service_booking_offers; cfg service_match_config; candidate record; candidate_estimate jsonb; candidate_found boolean := false; next_sequence integer; owner uuid;
begin
  select * into o from partner_orders where id=p_order for update;
  if o.id is null or o.role<>'professional' or o.status<>'requested' then return o; end if;
  select * into current_offer from service_booking_offers where order_id=o.id and status='offered' for update;
  if current_offer.id is null then return o; end if;
  if p_reason='timeout' and current_offer.expires_at>p_now then return o; end if;
  if p_reason not in ('timeout','declined') then raise exception 'Unsupported matching decision'; end if;
  update service_booking_offers set status=case when p_reason='timeout' then 'expired' else 'declined' end,
    responded_at=p_now where id=current_offer.id;
  insert into seller_order_events(order_id,kind,notes) values(o.id,'match_'||p_reason,'Offer '||current_offer.sequence);
  select * into cfg from service_match_config where id=true;
  next_sequence := current_offer.sequence+1;
  if o.backup_opt_in and next_sequence<=cfg.max_offers then
    for candidate in select p.id as post_id,a.id as partner_id,p.details as post_details,a.customer_id as owner_id
    from partner_posts p
    join partner_applications a on a.id=p.partner_id and a.role='professional' and a.status='approved'
    join profiles profile on profile.id=a.customer_id and profile.account_status='active'
    join partner_availability av on av.partner_id=a.id and av.online and av.available_until>p_now
    left join seller_subscriptions subscription on subscription.partner_id=a.id
    left join seller_plans plan on plan.id=subscription.plan_id and plan.enabled
    cross join seller_subscription_config subscription_config
    where p.role='professional' and p.status='published'
      and coalesce(p.details->>'postType','offering')='offering'
      and lower(trim(p.details->>'service'))=lower(trim(o.match_service))
      and lower(trim(p.details->>'category'))=lower(trim(o.match_category))
      and lower(trim(a.details->>'city'))=lower(trim(o.match_city))
      and a.customer_id<>o.customer_id
      and seller_can_receive_booking(a.id)
      and not exists(select 1 from service_booking_offers previous where previous.order_id=o.id and previous.partner_id=a.id)
      and subscription_config.id=true
    order by case when subscription_config.enabled and subscription.status='active'
        and subscription.current_period_end>p_now then
          case plan.id when 'legend' then 3 when 'pro' then 2 when 'pre' then 1 else 0 end
        else 0 end desc,
      av.confirmed_at desc nulls last,p.updated_at desc,p.id
    loop
      candidate_estimate := service_booking_estimate(candidate.post_id);
      if coalesce((candidate_estimate->>'available')::boolean,false) then
        candidate_found := true;
        exit;
      end if;
    end loop;
  end if;
  if not candidate_found then
    update partner_orders set status='cancelled',response_due_at=null,
      details=details||jsonb_build_object('matchResult',case when o.backup_opt_in then 'No eligible backup available' else 'Selected professional did not accept' end) where id=o.id returning * into o;
    update seller_leads set status='lost',close_reason=p_reason,updated_at=p_now where order_id=o.id;
    insert into seller_notifications(account_id,role,order_id,title)
      values(o.customer_id,'professional',o.id,case when o.backup_opt_in then 'Booking request ended; no eligible backup was available' else 'Selected professional did not accept' end);
    return o;
  end if;
  update partner_orders set partner_id=candidate.partner_id,post_id=candidate.post_id,
    title=candidate.post_details->>'title',status='requested',
    response_due_at=p_now+make_interval(secs=>cfg.response_seconds),
    details=details||jsonb_build_object('backupEstimate',candidate_estimate,
      'matchResult','Backup professional offered')
  where id=o.id returning * into o;
  update seller_leads set partner_id=candidate.partner_id,status='new',close_reason=null,updated_at=p_now where order_id=o.id;
  insert into service_booking_offers(order_id,partner_id,post_id,sequence,status,offered_at,expires_at)
    values(o.id,candidate.partner_id,candidate.post_id,next_sequence,'offered',p_now,o.response_due_at);
  insert into seller_order_events(order_id,kind,notes) values(o.id,'backup_offered','Offer '||next_sequence);
  insert into seller_notifications(account_id,role,order_id,title)
    values(candidate.owner_id,'professional',o.id,'New booking request'),
          (o.customer_id,'professional',o.id,'Your request was offered to a backup professional');
  return o;
end $$;
revoke all on function eazily_private.advance_professional_match(uuid,text,timestamptz) from public,anon,authenticated;

alter function public.change_seller_order(uuid,text,text) rename to service_match_legacy_change_seller_order;
revoke all on function public.service_match_legacy_change_seller_order(uuid,text,text) from public,anon,authenticated;
create function public.change_seller_order(p_order uuid,p_action text,p_reason text default '')
returns partner_orders language plpgsql security definer set search_path=public,eazily_private,pg_temp as $$
declare o partner_orders; offer service_booking_offers; owner uuid; result partner_orders; current_estimate jsonb;
begin
  select * into o from partner_orders where id=p_order for update;
  if o.id is null then raise exception 'Booking not found'; end if;
  if o.role<>'professional' then return service_match_legacy_change_seller_order(p_order,p_action,p_reason); end if;
  if o.backup_price_approval_pending and p_action in ('accept','reject') then
    raise exception 'Backup price is awaiting customer approval';
  end if;
  if p_action='on_the_way' then
    select customer_id into owner from partner_applications where id=o.partner_id and status='approved';
    if auth.uid() is null or auth.uid()<>owner or o.status<>'accepted' then raise exception 'Accepted Service Partner booking required'; end if;
    if o.journey_status='on_the_way' then return o; end if;
    update partner_orders set journey_status='on_the_way' where id=o.id returning * into result;
    insert into seller_order_events(order_id,actor_id,kind) values(o.id,auth.uid(),'on_the_way');
    return result;
  end if;
  select * into offer from service_booking_offers where order_id=o.id and status='offered' for update;
  if offer.id is null or p_action not in ('accept','reject') then
    return service_match_legacy_change_seller_order(p_order,p_action,p_reason);
  end if;
  select customer_id into owner from partner_applications where id=offer.partner_id and status='approved';
  if auth.uid() is null or auth.uid()<>owner or offer.partner_id<>o.partner_id or o.status<>'requested' then
    raise exception 'Current approved Service Partner offer required';
  end if;
  if offer.expires_at<=clock_timestamp() then
    raise exception 'Offer expired; this professional cannot accept or decline it';
  end if;
  if p_action='reject' then
    if length(trim(coalesce(p_reason,'')))<3 then raise exception 'Give a rejection reason'; end if;
    return eazily_private.advance_professional_match(o.id,'declined',clock_timestamp());
  end if;
  if not exists(select 1 from partner_availability where partner_id=o.partner_id and online and available_until>clock_timestamp()) then
    raise exception 'Go online before accepting this request';
  end if;
  if offer.sequence>1 then
    current_estimate := service_booking_estimate(o.post_id);
    if not coalesce((current_estimate->>'available')::boolean,false) or
       current_estimate is distinct from o.details->'initialEstimate' then
      update service_booking_offers set status='accepted',responded_at=clock_timestamp() where id=offer.id;
      update partner_orders set backup_price_approval_pending=true,response_due_at=null,
        details=details||jsonb_build_object('backupEstimate',current_estimate,
          'matchResult','Backup accepted; customer price approval required')
        where id=o.id returning * into result;
      insert into seller_order_events(order_id,actor_id,kind) values(o.id,auth.uid(),'backup_price_approval_requested');
      insert into seller_notifications(account_id,role,order_id,title)
        values(o.customer_id,'professional',o.id,'Review backup professional price');
      return result;
    end if;
  end if;
  result := service_match_legacy_change_seller_order(p_order,p_action,p_reason);
  update service_booking_offers set status='accepted',responded_at=clock_timestamp() where id=offer.id;
  update partner_orders set response_due_at=null where id=o.id returning * into result;
  return result;
end $$;
revoke all on function public.change_seller_order(uuid,text,text) from public,anon,authenticated;
grant execute on function public.change_seller_order(uuid,text,text) to authenticated;

create function public.customer_respond_backup_price(p_order uuid,p_approve boolean,p_estimate jsonb)
returns partner_orders language plpgsql security definer set search_path=public,pg_temp as $$
declare o partner_orders; result partner_orders;
begin
  select * into o from partner_orders where id=p_order for update;
  if o.id is null or o.role<>'professional' or o.customer_id<>auth.uid() or
    o.status<>'requested' or not o.backup_price_approval_pending or
    not exists(select 1 from service_booking_offers offer where offer.order_id=o.id
      and offer.partner_id=o.partner_id and offer.status='accepted' and offer.sequence>1) then
    raise exception 'Customer backup-price approval required';
  end if;
  if coalesce(p_approve,false) then
    if p_estimate is distinct from o.details->'backupEstimate' or
       not coalesce((p_estimate->>'available')::boolean,false) then
      raise exception 'Review the current backup price before approving';
    end if;
    update partner_orders set status='accepted',backup_price_approval_pending=false,
      details=details||jsonb_build_object('matchResult','Customer approved backup price','approvedEstimate',p_estimate)
      where id=o.id returning * into result;
    update seller_leads set status='active',updated_at=clock_timestamp() where order_id=o.id;
    insert into seller_order_events(order_id,actor_id,kind) values(o.id,auth.uid(),'backup_price_approved');
  else
    update partner_orders set status='cancelled',backup_price_approval_pending=false,
      details=details||jsonb_build_object('matchResult','Customer declined backup price')
      where id=o.id returning * into result;
    update seller_leads set status='lost',close_reason='customer_declined_backup_price',updated_at=clock_timestamp() where order_id=o.id;
    insert into seller_order_events(order_id,actor_id,kind) values(o.id,auth.uid(),'backup_price_declined');
  end if;
  insert into seller_notifications(account_id,role,order_id,title)
    select a.customer_id,'professional',o.id,case when p_approve then 'Backup price approved' else 'Backup price declined' end
    from partner_applications a where a.id=o.partner_id;
  return result;
end $$;
revoke all on function public.customer_respond_backup_price(uuid,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.customer_respond_backup_price(uuid,boolean,jsonb) to authenticated;

-- Existing booking automation is reused; only Service Partner offers use their own response deadline.
-- Maintenance also calls this function when it recreates missing expiry jobs.
-- Keep legacy orders on their original deadline, but never recreate an expiry while
-- a customer is deciding whether to approve an accepted backup's new price.
create or replace function public.enqueue_background_job(
  p_job_type text,p_entity_type text,p_entity_id text,p_scheduled_at timestamptz,p_deduplication_key text,
  p_entity_version bigint default null,p_payload jsonb default '{}'::jsonb,p_max_attempts integer default null
) returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare result uuid; configured_attempts integer; booking partner_orders;
begin
  if not automation_payload_is_safe(p_payload) then raise exception 'Unsafe background job payload'; end if;
  if p_job_type='partner_order_expiry' and p_entity_type='partner_orders' then
    select * into booking from partner_orders where id=p_entity_id::uuid;
    if booking.role='professional' then
      if booking.backup_price_approval_pending then return null; end if;
      if booking.response_due_at is not null then
        p_scheduled_at := booking.response_due_at;
      elsif exists(select 1 from service_booking_offers where order_id=booking.id) then
        -- A Smart Match booking with no open deadline must not fall back to 30 minutes.
        return null;
      end if;
    end if;
  end if;
  select default_max_attempts into configured_attempts from automation_configuration where id=true;
  insert into background_jobs(job_type,related_entity_type,related_entity_id,payload,scheduled_at,max_attempts,deduplication_key,entity_version)
  values(left(p_job_type,80),left(p_entity_type,80),left(p_entity_id,100),coalesce(p_payload,'{}'),p_scheduled_at,coalesce(p_max_attempts,configured_attempts),left(p_deduplication_key,220),p_entity_version)
  on conflict(deduplication_key) do update set
    scheduled_at=excluded.scheduled_at, entity_version=excluded.entity_version, payload=excluded.payload,
    status=case when background_jobs.status in('succeeded','running') then background_jobs.status else 'pending' end,
    next_retry_at=null, updated_at=clock_timestamp()
  returning id into result;
  return result;
end $$;

create or replace function public.schedule_partner_order_automation() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare cfg automation_configuration; leads integer[]; lead integer; key text;
begin
  select * into cfg from automation_configuration where id=true;
  perform cancel_obsolete_jobs('partner_orders',new.id::text,array['partner_order_expiry','partner_order_reminder']);
  if new.status='requested' and not new.backup_price_approval_pending then
    perform enqueue_background_job('partner_order_expiry','partner_orders',new.id::text,
      coalesce(new.response_due_at,new.created_at+make_interval(mins=>cfg.request_response_minutes)),
      'order:'||new.id||':expiry:v'||new.automation_version,new.automation_version);
  elsif new.status in('accepted','active','awaiting_acceptance') and new.deadline is not null then
    leads:=case new.role when 'consultant' then cfg.consultation_reminder_minutes when 'influencer' then cfg.influencer_reminder_minutes else cfg.booking_reminder_minutes end;
    foreach lead in array leads loop
      if new.deadline-make_interval(mins=>lead)>clock_timestamp() then
        key:='order:'||new.id||':reminder:'||lead||':v'||new.automation_version;
        perform enqueue_background_job('partner_order_reminder','partner_orders',new.id::text,new.deadline-make_interval(mins=>lead),key,new.automation_version,jsonb_build_object('lead_minutes',lead));
      end if;
    end loop;
  elsif new.status='completed' then
    perform enqueue_background_job('review_invitation','partner_orders',new.id::text,clock_timestamp(),'order:'||new.id||':review',new.automation_version);
  end if;
  return new;
end $$;
drop trigger schedule_partner_order_automation on public.partner_orders;
create trigger schedule_partner_order_automation
  after insert or update of status,deadline,response_due_at,backup_price_approval_pending
  on public.partner_orders for each row execute function public.schedule_partner_order_automation();

alter function public.execute_background_job(uuid,text,jsonb,timestamptz) rename to service_match_legacy_execute_background_job;
revoke all on function public.service_match_legacy_execute_background_job(uuid,text,jsonb,timestamptz) from public,anon,authenticated;
create function public.execute_background_job(p_job uuid,p_worker text,p_external_result jsonb default null,p_now timestamptz default clock_timestamp())
returns text language plpgsql security definer set search_path=public,eazily_private,pg_temp as $$
declare j background_jobs; o partner_orders;
begin
  if not automation_is_worker() then raise exception 'Trusted worker required'; end if;
  select * into j from background_jobs where id=p_job and status='running' and lock_owner=p_worker;
  if j.job_type='partner_order_expiry' then
    select * into o from partner_orders where id=j.related_entity_id::uuid for update;
    if o.role='professional' and (o.backup_price_approval_pending or
      (o.response_due_at is null and exists(select 1 from service_booking_offers where order_id=o.id))) then
      perform fail_background_job(j.id,p_worker,'obsolete','no_open_offer','No professional response is pending',p_now);
      return 'cancelled';
    end if;
    if o.role='professional' and exists(select 1 from service_booking_offers where order_id=o.id and status='offered') then
      if not (select enabled from automation_configuration where id=true) then
        perform fail_background_job(j.id,p_worker,'obsolete','automation_paused','Automation was paused',p_now); return 'cancelled';
      end if;
      if o.status<>'requested' or o.automation_version<>j.entity_version or o.response_due_at>p_now then
        perform fail_background_job(j.id,p_worker,'obsolete','stale_order','Offer is no longer due',p_now); return 'cancelled';
      end if;
      perform eazily_private.advance_professional_match(o.id,'timeout',p_now);
      perform complete_background_job(j.id,p_worker,p_now);
      return 'succeeded';
    end if;
  end if;
  return service_match_legacy_execute_background_job(p_job,p_worker,p_external_result,p_now);
end $$;
revoke all on function public.execute_background_job(uuid,text,jsonb,timestamptz) from public,anon,authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then
  grant execute on function public.execute_background_job(uuid,text,jsonb,timestamptz) to service_role;
end if; end$$;

commit;
