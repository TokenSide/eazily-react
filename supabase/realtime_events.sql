-- Secure, payload-free realtime invalidation events.
-- Apply after all existing Eazily migrations. This migration is additive and must not be run against
-- production until it has been reviewed and scheduled through the normal deployment process.
begin;

create table public.realtime_events (
  id bigint generated always as identity primary key,
  audience_kind text not null check (audience_kind in ('account','role','admin','public')),
  audience_key text not null,
  scope text not null,
  entity_type text not null,
  entity_id text not null,
  occurred_at timestamptz not null default clock_timestamp()
);
create index realtime_events_audience_sequence on public.realtime_events(audience_key,id desc);
create index realtime_events_retention on public.realtime_events(occurred_at);
alter table public.realtime_events enable row level security;

create policy "Own realtime account events" on public.realtime_events for select
using (audience_kind='account' and audience_key=auth.uid()::text);
create policy "Approved realtime role events" on public.realtime_events for select
using (audience_kind='role' and exists(
  select 1 from public.partner_applications a
  where a.customer_id=auth.uid() and a.role=audience_key and a.status='approved'
));
create policy "Safe public realtime events" on public.realtime_events for select
using (audience_kind='public' and audience_key like 'city:%');
create policy "Authorised admin realtime events" on public.realtime_events for select
using (audience_kind='admin' and audience_key='admin' and (
  public.is_admin()
  or public.has_staff_permission('realtime.read')
  or (scope in ('applications','assessment','legal') and (public.has_staff_permission('partners.view') or public.has_staff_permission('partner.approve')))
  or (scope='posts' and (public.has_staff_permission('partners.view') or public.has_staff_permission('post.moderate')))
  or (scope in ('payments','earnings','subscriptions') and (public.has_staff_permission('finance.view') or public.has_staff_permission('finance.manage')))
  or (scope='refunds' and (public.has_staff_permission('refund.view') or public.has_staff_permission('finance.view')))
  or (scope='payouts' and (public.has_staff_permission('payout.view') or public.has_staff_permission('payout.manage')))
  or (scope in ('orders','availability') and public.has_staff_permission('orders.view'))
  or (scope='support' and public.has_staff_permission('support.manage'))
));

revoke all on public.realtime_events from public,anon,authenticated;
grant select on public.realtime_events to anon,authenticated;
grant usage,select on sequence public.realtime_events_id_seq to postgres,service_role;

create or replace function public.emit_realtime_event(
  p_audience_kind text,p_audience_key text,p_scope text,p_entity_type text,p_entity_id text
) returns void language plpgsql security definer set search_path=public as $$
begin
  if p_audience_key is null or trim(p_audience_key)='' then return; end if;
  insert into realtime_events(audience_kind,audience_key,scope,entity_type,entity_id)
  values(p_audience_kind,left(lower(trim(p_audience_key)),90),left(p_scope,50),left(p_entity_type,80),left(p_entity_id,100));
end $$;
revoke all on function public.emit_realtime_event(text,text,text,text,text) from public,anon,authenticated;

create or replace function public.realtime_city_key(p_city text) returns text
language sql immutable set search_path=public as $$
  select case when nullif(trim(p_city),'') is null then null else 'city:'||left(regexp_replace(lower(trim(p_city)),'[^a-z0-9_-]+','','g'),80) end
$$;
revoke all on function public.realtime_city_key(text) from public,anon,authenticated;

create or replace function public.emit_realtime_order_event() returns trigger
language plpgsql security definer set search_path=public as $$
declare row_data partner_orders; owner_id uuid;
begin
  row_data:=case when tg_op='DELETE' then old else new end;
  select customer_id into owner_id from partner_applications where id=row_data.partner_id;
  perform emit_realtime_event('account',row_data.customer_id::text,'orders','partner_orders',row_data.id::text);
  perform emit_realtime_event('account',owner_id::text,'orders','partner_orders',row_data.id::text);
  perform emit_realtime_event('admin','admin','orders','partner_orders',row_data.id::text);
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger realtime_partner_orders after insert or update or delete on public.partner_orders for each row execute function public.emit_realtime_order_event();

create or replace function public.emit_realtime_order_child_event() returns trigger
language plpgsql security definer set search_path=public as $$
declare row_json jsonb; order_key uuid; order_row partner_orders; owner_id uuid;
begin
  row_json:=to_jsonb(case when tg_op='DELETE' then old else new end);
  order_key:=nullif(row_json->>'order_id','')::uuid;
  if order_key is null then return case when tg_op='DELETE' then old else new end; end if;
  select * into order_row from partner_orders where id=order_key;
  select customer_id into owner_id from partner_applications where id=order_row.partner_id;
  perform emit_realtime_event('account',order_row.customer_id::text,tg_argv[0],tg_table_name,coalesce(row_json->>'id',order_key::text));
  perform emit_realtime_event('account',owner_id::text,tg_argv[0],tg_table_name,coalesce(row_json->>'id',order_key::text));
  perform emit_realtime_event('admin','admin',tg_argv[0],tg_table_name,coalesce(row_json->>'id',order_key::text));
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger realtime_seller_messages after insert or update or delete on public.seller_messages for each row execute function public.emit_realtime_order_child_event('messages');
create trigger realtime_seller_order_events after insert or update or delete on public.seller_order_events for each row execute function public.emit_realtime_order_child_event('orders');
create trigger realtime_partner_earnings after insert or update or delete on public.partner_earnings for each row execute function public.emit_realtime_order_child_event('earnings');

create or replace function public.emit_realtime_application_event() returns trigger
language plpgsql security definer set search_path=public as $$
declare row_data partner_applications; city_key text;
begin
  row_data:=case when tg_op='DELETE' then old else new end;
  perform emit_realtime_event('account',row_data.customer_id::text,'applications','partner_applications',row_data.id::text);
  perform emit_realtime_event('admin','admin','applications','partner_applications',row_data.id::text);
  city_key:=realtime_city_key(row_data.details->>'city');
  if city_key is not null and ((tg_op='DELETE' and old.status='approved') or (tg_op<>'DELETE' and new.status='approved') or (tg_op='UPDATE' and old.status='approved')) then
    perform emit_realtime_event('public',city_key,'public_directory','partner_applications',row_data.id::text);
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger realtime_partner_applications after insert or update or delete on public.partner_applications for each row execute function public.emit_realtime_application_event();

create or replace function public.emit_realtime_post_event() returns trigger
language plpgsql security definer set search_path=public as $$
declare row_data partner_posts; app partner_applications; city_key text;
begin
  row_data:=case when tg_op='DELETE' then old else new end;
  select * into app from partner_applications where id=row_data.partner_id;
  perform emit_realtime_event('account',app.customer_id::text,'posts','partner_posts',row_data.id::text);
  perform emit_realtime_event('admin','admin','posts','partner_posts',row_data.id::text);
  city_key:=realtime_city_key(app.details->>'city');
  if city_key is not null and app.status='approved' and ((tg_op='DELETE' and old.status='published') or (tg_op<>'DELETE' and new.status='published') or (tg_op='UPDATE' and old.status='published')) then
    perform emit_realtime_event('public',city_key,'public_directory','partner_posts',row_data.id::text);
  end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger realtime_partner_posts after insert or update or delete on public.partner_posts for each row execute function public.emit_realtime_post_event();

create or replace function public.emit_realtime_availability_event() returns trigger
language plpgsql security definer set search_path=public as $$
declare row_data partner_availability; app partner_applications; city_key text;
begin
  row_data:=case when tg_op='DELETE' then old else new end;
  select * into app from partner_applications where id=row_data.partner_id;
  perform emit_realtime_event('account',app.customer_id::text,'availability','partner_availability',row_data.partner_id::text);
  city_key:=realtime_city_key(app.details->>'city');
  if city_key is not null and app.status='approved' then perform emit_realtime_event('public',city_key,'availability','partner_availability',row_data.partner_id::text); end if;
  perform emit_realtime_event('admin','admin','availability','partner_availability',row_data.partner_id::text);
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger realtime_partner_availability after insert or update or delete on public.partner_availability for each row execute function public.emit_realtime_availability_event();

create or replace function public.emit_realtime_partner_owned_event() returns trigger
language plpgsql security definer set search_path=public as $$
declare row_json jsonb; partner_key uuid; owner_id uuid; entity_key text;
begin
  row_json:=to_jsonb(case when tg_op='DELETE' then old else new end);
  partner_key:=nullif(row_json->>'partner_id','')::uuid;
  select customer_id into owner_id from partner_applications where id=partner_key;
  entity_key:=coalesce(row_json->>'id',row_json->>'order_id',partner_key::text);
  perform emit_realtime_event('account',owner_id::text,tg_argv[0],tg_table_name,entity_key);
  if tg_argv[1]='admin' then perform emit_realtime_event('admin','admin',tg_argv[0],tg_table_name,entity_key); end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger realtime_seller_leads after insert or update or delete on public.seller_leads for each row execute function public.emit_realtime_partner_owned_event('leads','admin');
create trigger realtime_seller_subscriptions after insert or update or delete on public.seller_subscriptions for each row execute function public.emit_realtime_partner_owned_event('subscriptions','admin');
create trigger realtime_seller_subscription_requests after insert or update or delete on public.seller_subscription_requests for each row execute function public.emit_realtime_partner_owned_event('subscriptions','admin');
create trigger realtime_partner_payouts after insert or update or delete on public.partner_payouts for each row execute function public.emit_realtime_partner_owned_event('payouts','admin');
create trigger realtime_seller_reward_ledger after insert or update or delete on public.seller_reward_ledger for each row execute function public.emit_realtime_partner_owned_event('earnings','');
create trigger realtime_seller_redemptions after insert or update or delete on public.seller_redemptions for each row execute function public.emit_realtime_partner_owned_event('earnings','admin');
create trigger realtime_seller_reviews after insert or update or delete on public.seller_reviews for each row execute function public.emit_realtime_partner_owned_event('reviews','admin');

create or replace function public.emit_realtime_account_owned_event() returns trigger
language plpgsql security definer set search_path=public as $$
declare row_json jsonb; account_key text; entity_key text;
begin
  row_json:=to_jsonb(case when tg_op='DELETE' then old else new end);
  account_key:=coalesce(row_json->>'customer_id',row_json->>'account_id');
  entity_key:=coalesce(row_json->>'id',account_key);
  perform emit_realtime_event('account',account_key,tg_argv[0],tg_table_name,entity_key);
  if tg_argv[1]='admin' then perform emit_realtime_event('admin','admin',tg_argv[0],tg_table_name,entity_key); end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger realtime_service_requests after insert or update or delete on public.service_requests for each row execute function public.emit_realtime_account_owned_event('orders','admin');
create trigger realtime_customer_payments after insert or update or delete on public.customer_payments for each row execute function public.emit_realtime_account_owned_event('payments','admin');
create trigger realtime_customer_refunds after insert or update or delete on public.customer_refunds for each row execute function public.emit_realtime_account_owned_event('refunds','admin');
create trigger realtime_wallet_ledger after insert or update or delete on public.wallet_ledger for each row execute function public.emit_realtime_account_owned_event('wallet','');
create trigger realtime_support_tickets after insert or update or delete on public.support_tickets for each row execute function public.emit_realtime_account_owned_event('support','admin');
create trigger realtime_consent_events after insert or update or delete on public.consent_events for each row execute function public.emit_realtime_account_owned_event('legal','admin');
create trigger realtime_seller_notifications after insert or update or delete on public.seller_notifications for each row execute function public.emit_realtime_account_owned_event('notifications','');

create or replace function public.emit_realtime_assessment_event() returns trigger
language plpgsql security definer set search_path=public as $$
declare row_data consultant_assessment_attempts; owner_id uuid;
begin
  row_data:=case when tg_op='DELETE' then old else new end;
  select a.customer_id into owner_id from partner_applications a where a.id=row_data.application_id;
  perform emit_realtime_event('account',owner_id::text,'assessment','consultant_assessment_attempts',row_data.id::text);
  perform emit_realtime_event('admin','admin','assessment','consultant_assessment_attempts',row_data.id::text);
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger realtime_consultant_assessments after insert or update or delete on public.consultant_assessment_attempts for each row execute function public.emit_realtime_assessment_event();

create or replace function public.emit_realtime_role_event() returns trigger
language plpgsql security definer set search_path=public as $$
declare row_json jsonb; role_key text; entity_key text;
begin
  row_json:=to_jsonb(case when tg_op='DELETE' then old else new end);
  role_key:=coalesce(row_json->>'role',tg_argv[1]);
  entity_key:=coalesce(row_json->>'id',role_key);
  perform emit_realtime_event('role',role_key,tg_argv[0],tg_table_name,entity_key);
  perform emit_realtime_event('admin','admin',tg_argv[0],tg_table_name,entity_key);
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger realtime_partner_banners after insert or update or delete on public.partner_dashboard_banners for each row execute function public.emit_realtime_role_event('banners','');

create or replace function public.emit_realtime_consultant_rate_event() returns trigger
language plpgsql security definer set search_path=public as $$
declare row_data consultant_rates; owner_id uuid;
begin
  row_data:=case when tg_op='DELETE' then old else new end;
  if row_data.partner_id is null then
    perform emit_realtime_event('role','consultant','rates','consultant_rates',row_data.id::text);
  else
    select customer_id into owner_id from partner_applications where id=row_data.partner_id;
    perform emit_realtime_event('account',owner_id::text,'rates','consultant_rates',row_data.id::text);
  end if;
  perform emit_realtime_event('admin','admin','rates','consultant_rates',row_data.id::text);
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger realtime_consultant_rates after insert or update or delete on public.consultant_rates for each row execute function public.emit_realtime_consultant_rate_event();

create or replace function public.emit_realtime_private_quote_event() returns trigger
language plpgsql security definer set search_path=public,eazily_private as $$
declare row_json jsonb; order_key uuid; quote_key uuid;
begin
  row_json:=to_jsonb(case when tg_op='DELETE' then old else new end);
  if tg_table_name='quotes' then order_key:=(row_json->>'order_id')::uuid;
  else
    quote_key:=(row_json->>'quote_id')::uuid;
    select order_id into order_key from eazily_private.quotes where id=quote_key;
  end if;
  perform public.emit_realtime_order_child_event_for(order_key,tg_argv[0],tg_table_name,coalesce(row_json->>'id',order_key::text));
  return case when tg_op='DELETE' then old else new end;
end $$;

create or replace function public.emit_realtime_order_child_event_for(p_order uuid,p_scope text,p_type text,p_id text) returns void
language plpgsql security definer set search_path=public as $$
declare order_row partner_orders; owner_id uuid;
begin
  select * into order_row from partner_orders where id=p_order;
  select customer_id into owner_id from partner_applications where id=order_row.partner_id;
  perform emit_realtime_event('account',order_row.customer_id::text,p_scope,p_type,p_id);
  perform emit_realtime_event('account',owner_id::text,p_scope,p_type,p_id);
  perform emit_realtime_event('admin','admin',p_scope,p_type,p_id);
end $$;
revoke all on function public.emit_realtime_order_child_event_for(uuid,text,text,text) from public,anon,authenticated;
create trigger realtime_quotes after insert or update or delete on eazily_private.quotes for each row execute function public.emit_realtime_private_quote_event('quotes');
create trigger realtime_payment_requests after insert or update or delete on eazily_private.payment_requests for each row execute function public.emit_realtime_private_quote_event('payments');
create trigger realtime_cashfree_collaborations after insert or update or delete on public.cashfree_collaborations for each row execute function public.emit_realtime_order_child_event('payments');

create or replace function public.emit_realtime_vendor_event() returns trigger
language plpgsql security definer set search_path=public as $$
declare row_data vendors; city_key text;
begin
  row_data:=case when tg_op='DELETE' then old else new end;
  perform emit_realtime_event('account',row_data.owner_id::text,'public_directory','vendors',row_data.id::text);
  city_key:=realtime_city_key(row_data.city);
  if city_key is not null and ((tg_op='DELETE' and old.published) or (tg_op<>'DELETE' and new.published) or (tg_op='UPDATE' and old.published)) then
    perform emit_realtime_event('public',city_key,'public_directory','vendors',row_data.id::text);
  end if;
  perform emit_realtime_event('admin','admin','applications','vendors',row_data.id::text);
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger realtime_vendors after insert or update or delete on public.vendors for each row execute function public.emit_realtime_vendor_event();

create or replace function public.emit_realtime_review_event() returns trigger
language plpgsql security definer set search_path=public as $$
declare row_data reviews; vendor_row vendors; city_key text;
begin
  row_data:=case when tg_op='DELETE' then old else new end;
  perform emit_realtime_event('account',row_data.customer_id::text,'reviews','reviews',row_data.id::text);
  select * into vendor_row from vendors where id=row_data.vendor_id;
  perform emit_realtime_event('account',vendor_row.owner_id::text,'reviews','reviews',row_data.id::text);
  city_key:=realtime_city_key(vendor_row.city);
  if row_data.published and city_key is not null then perform emit_realtime_event('public',city_key,'reviews','reviews',row_data.id::text); end if;
  perform emit_realtime_event('admin','admin','posts','reviews',row_data.id::text);
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger realtime_reviews after insert or update or delete on public.reviews for each row execute function public.emit_realtime_review_event();

create or replace function public.emit_realtime_all_roles_event() returns trigger
language plpgsql security definer set search_path=public as $$
declare row_json jsonb; entity_key text; target_role text;
begin
  row_json:=to_jsonb(case when tg_op='DELETE' then old else new end);
  entity_key:=coalesce(row_json->>'id','configuration');
  foreach target_role in array array['professional','influencer','consultant'] loop
    perform emit_realtime_event('role',target_role,tg_argv[0],tg_table_name,entity_key);
  end loop;
  perform emit_realtime_event('admin','admin',tg_argv[0],tg_table_name,entity_key);
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger realtime_partner_config after insert or update or delete on public.partner_config for each row execute function public.emit_realtime_all_roles_event('subscriptions');
create trigger realtime_subscription_config after insert or update or delete on public.seller_subscription_config for each row execute function public.emit_realtime_all_roles_event('subscriptions');
create trigger realtime_seller_plans after insert or update or delete on public.seller_plans for each row execute function public.emit_realtime_all_roles_event('subscriptions');
create trigger realtime_pricing_rules after insert or update or delete on public.seller_pricing_rules for each row execute function public.emit_realtime_role_event('payments','');

create or replace function public.purge_realtime_events(p_before timestamptz default now()-interval '7 days') returns bigint
language plpgsql security definer set search_path=public as $$
declare removed bigint;
begin
  if not (is_admin() or has_staff_permission('realtime.manage')) then raise exception 'Admin access required'; end if;
  delete from realtime_events where occurred_at<p_before;
  get diagnostics removed=row_count;
  return removed;
end $$;
revoke all on function public.purge_realtime_events(timestamptz) from public,anon;
grant execute on function public.purge_realtime_events(timestamptz) to authenticated;

commit;

-- Publish only the payload-free event table. If the project owner cannot alter publications from a
-- migration, enable public.realtime_events (INSERT only) once in Database > Replication.
do $$
begin
  if exists(select 1 from pg_catalog.pg_publication where pubname='supabase_realtime')
     and not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='realtime_events') then
    alter publication supabase_realtime add table public.realtime_events;
  end if;
exception when insufficient_privilege then
  raise notice 'Enable public.realtime_events manually in Supabase Database > Replication';
end $$;
