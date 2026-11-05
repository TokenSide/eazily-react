begin;
create table public.seller_reward_config (id boolean primary key default true check(id),enabled boolean not null default false,points_per_100_rupees integer check(points_per_100_rupees>=0),expiry_days integer check(expiry_days>0));
insert into seller_reward_config(id) values(true);
create table public.seller_rewards_catalog (id uuid primary key default gen_random_uuid(),name text not null,category text not null,points integer not null check(points>0),enabled boolean not null default false,terms text not null,expires_at timestamptz);
create table public.seller_reward_ledger (id bigint generated always as identity primary key,partner_id uuid not null references partner_applications(id),order_id uuid references partner_orders(id),points integer not null,event_key text unique not null,expires_at timestamptz,created_at timestamptz not null default now());
create table public.seller_redemptions (id uuid primary key default gen_random_uuid(),partner_id uuid not null references partner_applications(id),reward_id uuid not null references seller_rewards_catalog(id),points integer not null,status text not null default 'requested' check(status in('requested','processing','fulfilled','failed','reversed')),request_key uuid unique not null,created_at timestamptz not null default now());
alter table seller_reward_config enable row level security;alter table seller_rewards_catalog enable row level security;alter table seller_reward_ledger enable row level security;alter table seller_redemptions enable row level security;
create policy "Read reward rules" on seller_reward_config for select using(true);
create policy "Admin reward rules" on seller_reward_config for all using(is_admin()) with check(is_admin());
create policy "Read available rewards" on seller_rewards_catalog for select using(enabled or is_admin());
create policy "Admin rewards" on seller_rewards_catalog for all using(is_admin()) with check(is_admin());
create policy "Own reward ledger" on seller_reward_ledger for select using(exists(select 1 from partner_applications where id=partner_id and customer_id=auth.uid()) or is_admin());
create policy "Own redemptions" on seller_redemptions for select using(exists(select 1 from partner_applications where id=partner_id and customer_id=auth.uid()) or is_admin());
revoke all on seller_reward_config,seller_rewards_catalog,seller_reward_ledger,seller_redemptions from anon,authenticated;
grant select on seller_reward_config,seller_rewards_catalog,seller_reward_ledger,seller_redemptions to authenticated;
grant update on seller_reward_config to authenticated;grant insert,update on seller_rewards_catalog to authenticated;
create function eazily_private.award_seller_points() returns trigger language plpgsql security definer set search_path=public,eazily_private as $$
declare cfg seller_reward_config; o partner_orders; q eazily_private.quotes; points_value integer;
begin
 if new.kind<>'paid' then return new; end if;
 select * into cfg from seller_reward_config;
 if not cfg.enabled or cfg.points_per_100_rupees is null then return new; end if;
 select qs.* into q from eazily_private.quotes qs join eazily_private.payment_requests r on r.quote_id=qs.id where r.id=new.request_id;
 select * into o from partner_orders where id=q.order_id;
 points_value:=floor((q.calculation->>'sellerPayablePaise')::numeric*cfg.points_per_100_rupees/10000);
 insert into seller_reward_ledger(partner_id,order_id,points,event_key,expires_at) values(o.partner_id,o.id,points_value,'payment:'||new.request_id,case when cfg.expiry_days is not null then now()+make_interval(days=>cfg.expiry_days) end) on conflict(event_key) do nothing;
 return new;
end $$;
create trigger award_seller_points after insert on eazily_private.payment_events for each row execute function eazily_private.award_seller_points();
create function public.redeem_seller_reward(p_partner uuid,p_reward uuid,p_key uuid) returns seller_redemptions language plpgsql security definer set search_path=public as $$
declare reward seller_rewards_catalog; result seller_redemptions; balance bigint;
begin
 perform 1 from partner_applications where id=p_partner and customer_id=auth.uid() for update;
 if not found then raise exception 'Workspace access required'; end if;
 select * into result from seller_redemptions where request_key=p_key;
 if result.id is not null then if result.partner_id<>p_partner or result.reward_id<>p_reward then raise exception 'Redemption reference mismatch'; end if;return result;end if;
 if not(select enabled from seller_reward_config) then raise exception 'Rewards are not enabled'; end if;
 select * into reward from seller_rewards_catalog where id=p_reward and enabled and (expires_at is null or expires_at>now());
 if reward.id is null then raise exception 'Reward is unavailable'; end if;
 select coalesce(sum(points),0) into balance from seller_reward_ledger where partner_id=p_partner and (points<0 or expires_at is null or expires_at>now());
 if balance<reward.points then raise exception 'Insufficient reward points'; end if;
 insert into seller_redemptions(partner_id,reward_id,points,request_key) values(p_partner,p_reward,reward.points,p_key) returning * into result;
 insert into seller_reward_ledger(partner_id,points,event_key) values(p_partner,-reward.points,'redemption:'||result.id);
 return result;
end $$;
create table eazily_private.refunds (id uuid primary key default gen_random_uuid(),request_id uuid not null references eazily_private.payment_requests(id),amount_paise bigint not null check(amount_paise>0),reason text not null,status text not null default 'requested' check(status in('requested','processing','failed','confirmed')),provider_event text unique,created_at timestamptz not null default now());
create function public.request_seller_refund(p_order uuid,p_reason text) returns jsonb language plpgsql security definer set search_path=public,eazily_private as $$
declare q eazily_private.quotes;r eazily_private.payment_requests;f eazily_private.refunds;
begin
 perform 1 from partner_orders where id=p_order and customer_id=auth.uid() for update;
 if not found then raise exception 'Booking customer required';end if;
 if length(trim(p_reason))<3 then raise exception 'Describe the refund issue';end if;
 select * into q from eazily_private.quotes where order_id=p_order and status='paid' order by version desc limit 1;
 select * into r from eazily_private.payment_requests where quote_id=q.id and status in('paid','partially_refunded');
 if r.id is null then raise exception 'A confirmed payment is required';end if;
 select * into f from eazily_private.refunds where request_id=r.id and status in('requested','processing') limit 1;
 if f.id is null then insert into eazily_private.refunds(request_id,amount_paise,reason) values(r.id,(q.calculation->>'totalPaise')::bigint-coalesce((select sum(amount_paise) from eazily_private.refunds where request_id=r.id and status='confirmed'),0),p_reason) returning * into f;end if;
 update partner_orders set status='disputed' where id=p_order;
 insert into seller_order_events(order_id,actor_id,kind,notes) values(p_order,auth.uid(),'refund_requested',p_reason);
 return jsonb_build_object('id',f.id,'status',f.status,'amountPaise',f.amount_paise);
end $$;
create function public.record_verified_seller_refund(p_refund uuid,p_event text,p_amount bigint) returns void language plpgsql security definer set search_path=public,eazily_private as $$
declare f eazily_private.refunds;r eazily_private.payment_requests;q eazily_private.quotes;o partner_orders;refunded bigint;effect bigint;points_value integer;
begin
 select * into f from eazily_private.refunds where id=p_refund for update;
 if f.id is null or f.amount_paise<>p_amount then raise exception 'Refund amount mismatch';end if;
 if f.status='confirmed' and f.provider_event=p_event then return;end if;
 if f.status not in('requested','processing','failed') then raise exception 'Refund is not pending';end if;
 select * into r from eazily_private.payment_requests where id=f.request_id for update;
 select * into q from eazily_private.quotes where id=r.quote_id;
 select * into o from partner_orders where id=q.order_id;
 select coalesce(sum(amount_paise),0) into refunded from eazily_private.refunds where request_id=r.id and status='confirmed';
 if refunded+p_amount>(q.calculation->>'totalPaise')::bigint then raise exception 'Refund exceeds original payment';end if;
 effect:=round((q.calculation->>'sellerPayablePaise')::numeric*(refunded+p_amount)/(q.calculation->>'totalPaise')::numeric);
 update eazily_private.refunds set status='confirmed',provider_event=p_event where id=f.id;
 insert into eazily_private.payment_events(provider_event,request_id,kind,amount_paise) values(p_event,r.id,'refund',p_amount);
 update eazily_private.payment_requests set status=case when refunded+p_amount=(q.calculation->>'totalPaise')::bigint then 'refunded' else 'partially_refunded' end where id=r.id;
 insert into partner_earnings(partner_id,order_id,role,state,amount,provider_reference) values(o.partner_id,o.id,o.role,'reversed',effect::numeric/100,p_event) on conflict(order_id,state) do update set amount=excluded.amount;
 select round(coalesce(sum(points),0)::numeric*p_amount/(q.calculation->>'totalPaise')::numeric) into points_value from seller_reward_ledger where event_key='payment:'||r.id;
 insert into seller_reward_ledger(partner_id,order_id,points,event_key) values(o.partner_id,o.id,-points_value,'refund:'||f.id) on conflict do nothing;
 insert into seller_order_events(order_id,kind) values(o.id,'refund_confirmed');
end $$;
revoke all on function eazily_private.award_seller_points(),redeem_seller_reward(uuid,uuid,uuid),request_seller_refund(uuid,text),record_verified_seller_refund(uuid,text,bigint) from public,anon,authenticated;
grant execute on function redeem_seller_reward(uuid,uuid,uuid),request_seller_refund(uuid,text) to authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function record_verified_seller_refund(uuid,text,bigint) to service_role;end if;end$$;
commit;
