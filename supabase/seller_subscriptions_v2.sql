-- Subscription timeline hardening. Apply after seller_subscriptions.sql and seller_gateway.sql.
-- Existing rows are never assigned an invented approval date.
begin;

alter table public.seller_subscription_config
  add column if not exists rollout_enabled boolean not null default false,
  add column if not exists payment_checkout_enabled boolean not null default false;

alter table public.seller_subscriptions
  add column if not exists approval_started_at timestamptz,
  add column if not exists founder_ends_at timestamptz,
  add column if not exists approval_date_missing boolean not null default false,
  add column if not exists cancel_at_period_end boolean not null default false;

alter table public.seller_subscription_requests
  add column if not exists provider_payment_reference text,
  add column if not exists paid_at timestamptz;

update public.seller_plans set monthly_leads=0, monthly_reels=0,
  benefits='["Posting and new bookings","Messaging and work management","Basic performance summary","PRE membership badge","Standard support"]'::jsonb
  where id='pre';
update public.seller_plans set monthly_leads=0, monthly_reels=0,
  benefits='["All PRE benefits","Detailed analytics where available","Eligibility for labelled promoted discovery","Priority support queue","PRO membership badge"]'::jsonb
  where id='pro';
update public.seller_plans set monthly_leads=0, monthly_reels=0,
  benefits='["All PRO benefits","Higher weighting in eligible promoted rotation","Eligibility for rotating homepage/category features","Highest support queue priority","LEGEND membership badge"]'::jsonb
  where id='legend';

-- Existing submitted_at-derived rows are retained but explicitly untrusted for launch.
update public.seller_subscriptions
set approval_date_missing=true, approval_started_at=null, founder_ends_at=null
where approval_started_at is null;

create or replace function public.sync_seller_subscription_on_approval() returns trigger
language plpgsql security definer set search_path=public as $$
declare cfg seller_subscription_config;
begin
  if new.status='approved' and (tg_op='INSERT' or old.status is distinct from new.status) then
    select * into cfg from seller_subscription_config where id=true;
    insert into seller_subscriptions(partner_id,trial_started_at,trial_ends_at,approval_started_at,founder_ends_at,approval_date_missing,status)
    values(new.id,new.reviewed_at,new.reviewed_at+make_interval(days=>cfg.trial_days),new.reviewed_at,new.reviewed_at+make_interval(days=>cfg.trial_days + 0) + make_interval(months=>cfg.founder_months),false,'trial')
    on conflict(partner_id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists seller_trial_after_registration on public.partner_applications;
create trigger seller_subscription_after_approval
after insert or update of status,reviewed_at on public.partner_applications
for each row execute function public.sync_seller_subscription_on_approval();

create or replace function public.seller_subscription_timeline(p_partner uuid) returns jsonb
language sql stable security definer set search_path=public as $$
select jsonb_build_object(
  'status', case
    when s.approval_date_missing then 'approval_date_missing'
    when s.status='active' and s.current_period_end>now() then 'active'
    when now()<s.trial_ends_at then 'trial'
    when now()<s.founder_ends_at then 'founder_window'
    else coalesce(s.status,'expired') end,
  'approvalStartedAt',s.approval_started_at,
  'trialEndsAt',s.trial_ends_at,
  'founderEndsAt',s.founder_ends_at,
  'currentPeriodEnd',s.current_period_end,
  'planId',s.plan_id,
  'cancelAtPeriodEnd',s.cancel_at_period_end,
  'approvalDateMissing',s.approval_date_missing
) from seller_subscriptions s where s.partner_id=p_partner
$$;

create or replace function public.seller_can_receive_booking(p_partner uuid) returns boolean
language sql stable security definer set search_path=public as $$
select not c.rollout_enabled or not c.restrict_new_bookings or exists(
  select 1 from seller_subscriptions s where s.partner_id=p_partner and s.approval_date_missing=false and (
    now()<s.trial_ends_at or (s.status='active' and s.current_period_end>now())
  )
) from seller_subscription_config c where c.id=true
$$;

create or replace function public.seller_can_publish_post(p_partner uuid) returns boolean
language sql stable security definer set search_path=public as $$
select not c.rollout_enabled or exists(
  select 1 from seller_subscriptions s where s.partner_id=p_partner and s.approval_date_missing=false and (
    now()<s.trial_ends_at or (s.status='active' and s.current_period_end>now())
  )
) from seller_subscription_config c where c.id=true
$$;

create or replace function public.guard_subscription_post_access() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.status in('pending_review','published') and not seller_can_publish_post(new.partner_id) then
    raise exception 'An active trial or subscription is required to publish new posts';
  end if;
  return new;
end $$;

drop trigger if exists guard_subscription_post_access on public.partner_posts;
create trigger guard_subscription_post_access
before insert or update of status on public.partner_posts
for each row execute function public.guard_subscription_post_access();

create or replace function public.request_seller_subscription(p_partner uuid,p_plan text,p_key uuid) returns seller_subscription_requests
language plpgsql security definer set search_path=public as $$
declare cfg seller_subscription_config; plan seller_plans; result seller_subscription_requests; timeline seller_subscriptions; amount bigint;
begin
 if not exists(select 1 from partner_applications where id=p_partner and customer_id=auth.uid()) then raise exception 'Workspace access required'; end if;
 select * into cfg from seller_subscription_config where id=true;
 if not cfg.rollout_enabled or not cfg.payment_checkout_enabled then raise exception 'Official subscription checkout is not enabled'; end if;
 select * into plan from seller_plans where id=p_plan and enabled;
 if plan.id is null then raise exception 'Plan is unavailable'; end if;
 select * into timeline from seller_subscriptions where partner_id=p_partner;
 if timeline.approval_date_missing then raise exception 'Approval date requires admin resolution before subscription purchase'; end if;
 amount:=case when now()<timeline.founder_ends_at then plan.founder_paise else plan.standard_paise end;
 insert into seller_subscription_requests(partner_id,plan_id,price_paise,idempotency_key) values(p_partner,p_plan,amount,p_key)
 on conflict(idempotency_key) do nothing;
 select * into result from seller_subscription_requests where idempotency_key=p_key and partner_id=p_partner and plan_id=p_plan;
 if result.id is null then raise exception 'Request reference does not match'; end if;
 return result;
end $$;

create or replace function public.admin_correct_seller_subscription(p_partner uuid,p_approval_started_at timestamptz,p_status text default null) returns seller_subscriptions
language plpgsql security definer set search_path=public as $$
declare result seller_subscriptions; cfg seller_subscription_config;
begin
 if not is_admin() then raise exception 'Admin access required'; end if;
 if p_approval_started_at is null then raise exception 'Approval timestamp is required'; end if;
 select * into cfg from seller_subscription_config where id=true;
 update seller_subscriptions set approval_started_at=p_approval_started_at, trial_started_at=p_approval_started_at,
 trial_ends_at=p_approval_started_at+make_interval(days=>cfg.trial_days), founder_ends_at=p_approval_started_at+make_interval(days=>cfg.trial_days)+make_interval(months=>cfg.founder_months), approval_date_missing=false,
 status=coalesce(p_status,status), updated_at=now() where partner_id=p_partner returning * into result;
 if result.partner_id is null then raise exception 'Subscription record not found'; end if;
 insert into partner_audit_log(actor_id,action,entity_type,entity_id,after_data) values(auth.uid(),'correct_subscription_timeline','seller_subscription',p_partner::text,to_jsonb(result));
 return result;
end $$;

revoke all on function seller_subscription_timeline(uuid),seller_can_publish_post(uuid),admin_correct_seller_subscription(uuid,timestamptz,text) from public,anon;
grant execute on function seller_subscription_timeline(uuid) to authenticated;
grant execute on function admin_correct_seller_subscription(uuid,timestamptz,text) to authenticated;
commit;
