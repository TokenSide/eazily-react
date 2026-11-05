-- Apply after operations.sql. Proposed catalogue; billing starts disabled.
begin;
grant execute on function public.is_admin() to authenticated;
create table public.seller_subscription_config (
 id boolean primary key default true check(id), enabled boolean not null default false,
 trial_days integer not null default 60 check(trial_days>=0), launch_at timestamptz,
 founder_months integer not null default 6 check(founder_months>0),
 restrict_new_bookings boolean not null default false
);
insert into seller_subscription_config(id) values(true);
create table public.seller_plans (
 id text primary key, name text not null, standard_paise bigint not null check(standard_paise>0),
 founder_paise bigint not null check(founder_paise>0), monthly_leads integer not null,
 monthly_reels integer not null, benefits jsonb not null default '[]', enabled boolean not null default false
);
insert into seller_plans values
 ('pre','PRE',300000,29900,12,2,'["Featured seller profile","Analytics","Marketing support"]',false),
 ('pro','PRO',500000,49900,20,5,'["Priority placement","Analytics","Priority support"]',false),
 ('legend','LEGEND',700000,69900,33,10,'["Homepage placement","Marketing suggestions","Social promotion","Dedicated support"]',false);
create table public.seller_subscriptions (
 partner_id uuid primary key references partner_applications(id), plan_id text references seller_plans(id),
 trial_started_at timestamptz not null, trial_ends_at timestamptz not null,
 status text not null default 'trial' check(status in('trial','active','expired','cancelled','past_due')),
 current_period_end timestamptz, provider_reference text unique, updated_at timestamptz not null default now()
);
create table public.seller_subscription_requests (
 id uuid primary key default gen_random_uuid(), partner_id uuid not null references partner_applications(id),
 plan_id text not null references seller_plans(id), price_paise bigint not null,
 status text not null default 'requested' check(status in('requested','pending','paid','failed','cancelled')),
 idempotency_key uuid not null unique, created_at timestamptz not null default now()
);
alter table seller_subscription_config enable row level security;
alter table seller_plans enable row level security;
alter table seller_subscriptions enable row level security;
alter table seller_subscription_requests enable row level security;
create policy "Read subscription config" on seller_subscription_config for select using(true);
create policy "Read enabled plans" on seller_plans for select using(enabled or is_admin());
create policy "Manage subscription config" on seller_subscription_config for all using(is_admin()) with check(is_admin());
create policy "Manage plans" on seller_plans for all using(is_admin()) with check(is_admin());
create policy "Own subscription" on seller_subscriptions for select using(is_admin() or exists(select 1 from partner_applications a where a.id=partner_id and a.customer_id=auth.uid()));
create policy "Own subscription request" on seller_subscription_requests for select using(is_admin() or exists(select 1 from partner_applications a where a.id=partner_id and a.customer_id=auth.uid()));
revoke all on seller_subscriptions,seller_subscription_requests from anon,authenticated;
grant select on seller_subscriptions,seller_subscription_requests to authenticated;
grant select on seller_subscription_config,seller_plans to authenticated;
grant update on seller_subscription_config,seller_plans to authenticated;

create function public.start_seller_trial() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.submitted_at is not null then
  insert into seller_subscriptions(partner_id,trial_started_at,trial_ends_at)
  select new.id,new.submitted_at,new.submitted_at+make_interval(days=>trial_days) from seller_subscription_config
  on conflict(partner_id) do nothing;
 end if;
 return new;
end $$;
create trigger seller_trial_after_registration after insert or update of submitted_at on partner_applications for each row execute function start_seller_trial();
insert into seller_subscriptions(partner_id,trial_started_at,trial_ends_at)
select a.id,a.submitted_at,a.submitted_at+make_interval(days=>c.trial_days) from partner_applications a cross join seller_subscription_config c where a.submitted_at is not null on conflict do nothing;

create function public.seller_can_receive_booking(p_partner uuid) returns boolean language sql stable security definer set search_path=public as $$
 select not c.enabled or not c.restrict_new_bookings or exists(select 1 from seller_subscriptions s where s.partner_id=p_partner and (s.trial_ends_at>now() or s.status='active' and s.current_period_end>now())) from seller_subscription_config c
$$;
create function public.request_seller_subscription(p_partner uuid,p_plan text,p_key uuid) returns seller_subscription_requests language plpgsql security definer set search_path=public as $$
declare cfg seller_subscription_config; plan seller_plans; result seller_subscription_requests; amount bigint;
begin
 if not exists(select 1 from partner_applications where id=p_partner and customer_id=auth.uid()) then raise exception 'Workspace access required'; end if;
 select * into cfg from seller_subscription_config;
 if not cfg.enabled then raise exception 'Subscription billing is not available yet'; end if;
 select * into plan from seller_plans where id=p_plan and enabled;
 if plan.id is null then raise exception 'Plan is unavailable'; end if;
 amount:=case when cfg.launch_at is not null and now()>=cfg.launch_at and now()<cfg.launch_at+make_interval(months=>cfg.founder_months) then plan.founder_paise else plan.standard_paise end;
 insert into seller_subscription_requests(partner_id,plan_id,price_paise,idempotency_key) values(p_partner,p_plan,amount,p_key) on conflict(idempotency_key) do nothing;
 select * into result from seller_subscription_requests where idempotency_key=p_key and partner_id=p_partner and plan_id=p_plan;
 if result.id is null then raise exception 'Request reference does not match'; end if;
 return result;
end $$;
revoke all on function start_seller_trial(),seller_can_receive_booking(uuid),request_seller_subscription(uuid,text,uuid) from public,anon;
grant execute on function request_seller_subscription(uuid,text,uuid) to authenticated;
commit;
