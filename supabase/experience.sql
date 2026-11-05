-- Apply after schema.sql. No Excel destination or referral reward is assumed.
begin;
alter table public.vendors
  add column display_name text,
  add column photo_url text,
  add column experience_years integer check (experience_years >= 0),
  add column service_names text[] not null default '{}',
  add column category_id text not null default 'manpower',
  add column languages text[] not null default '{}',
  add column coverage text[] not null default '{}',
  add column prices jsonb not null default '{}',
  add column portfolio text[] not null default '{}',
  add column availability text,
  add column available_now boolean not null default false,
  add column published boolean not null default false;
create policy "Published vendors readable" on public.vendors for select using (published);

create table public.service_policies (
  service_name text primary key,
  fixed_price boolean not null default false,
  faq jsonb not null default '[]',
  updated_at timestamptz not null default now()
);
alter table public.service_policies enable row level security;
create policy "Published service policies" on public.service_policies for select using (true);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id),
  vendor_id uuid not null references public.vendors(id),
  service_name text not null,
  booking_id uuid unique references public.service_requests(id),
  customer_display_name text not null,
  rating integer not null check (rating between 1 and 5),
  review_text text not null check (length(review_text) between 1 and 3000),
  authorised_photos text[] not null default '{}',
  published boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.reviews enable row level security;
create policy "Read reviews" on public.reviews for select using (published or customer_id = auth.uid());
-- Publish reviews only through the moderation backend; clients cannot assert verification.
create view public.customer_reviews as
select r.id, r.vendor_id, r.service_name, r.customer_display_name, r.rating, r.review_text,
 r.authorised_photos, r.created_at,
 exists(select 1 from public.service_requests b where b.id=r.booking_id and b.customer_id=r.customer_id
   and b.assigned_vendor_id=r.vendor_id and b.service_name=r.service_name and b.status='completed') as verified_booking
from public.reviews r where r.published;
create view public.my_reviews with (security_invoker=true) as select * from public.reviews where customer_id=auth.uid();
create view public.vendor_directory as
select v.id, v.business_name, v.display_name, v.photo_url, v.description, v.verification_status,
 v.experience_years, v.service_names, v.category_id, v.languages, v.coverage, v.prices, v.portfolio,
 v.availability, v.available_now, v.city,
 coalesce((select avg(r.rating)::numeric(2,1) from public.reviews r where r.vendor_id=v.id and r.published),0) as rating,
 (select count(*) from public.reviews r where r.vendor_id=v.id and r.published) as review_count,
 (select min(value::numeric) from jsonb_each_text(v.prices) where value ~ '^[0-9]+(\.[0-9]+)?$') as starting_price
from public.vendors v where v.published;

create table public.saved_vendors (
 customer_id uuid not null references public.profiles(id) on delete cascade,
 vendor_id uuid not null references public.vendors(id) on delete cascade,
 primary key(customer_id,vendor_id)
);
alter table public.saved_vendors enable row level security;
create policy "Own saved vendors" on public.saved_vendors for all using (customer_id=auth.uid()) with check (customer_id=auth.uid());
create view public.saved_vendor_directory with (security_invoker=true) as
select v.* from public.vendor_directory v join public.saved_vendors s on s.vendor_id=v.id where s.customer_id=auth.uid();

create table public.customer_addresses (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id),
 label text not null, address text not null
);
create table public.customer_payment_methods (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id),
 brand text not null, last_four text not null check (last_four ~ '^[0-9]{4}$')
);
create table public.customer_memberships (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id),
 name text not null, status text not null, expires_at timestamptz
);
alter table public.customer_addresses enable row level security;
alter table public.customer_payment_methods enable row level security;
alter table public.customer_memberships enable row level security;
create policy "Own addresses" on public.customer_addresses for all using(customer_id=auth.uid()) with check(customer_id=auth.uid());
create policy "Own payment methods" on public.customer_payment_methods for select using(customer_id=auth.uid());
create policy "Own memberships" on public.customer_memberships for select using(customer_id=auth.uid());
create table public.customer_support_requests (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id),
 booking_id uuid references public.service_requests(id),
 message text not null check(length(trim(message)) between 10 and 3000),
 status text not null default 'pending' check(status in('pending','in_progress','resolved')),
 created_at timestamptz not null default now()
);
alter table public.customer_support_requests enable row level security;
create policy "Own support requests" on public.customer_support_requests for select using(customer_id=auth.uid());
create policy "Create own support request" on public.customer_support_requests for insert with check(
 customer_id=auth.uid() and status='pending' and (booking_id is null or exists(select 1 from public.service_requests where id=booking_id and customer_id=auth.uid()))
);
grant select,insert on public.customer_support_requests to authenticated;

create table public.referral_config (
 id boolean primary key default true check(id), enabled boolean not null default false,
 reward_amount numeric(12,2) not null default 0 check(reward_amount>=0),
 minimum_payment numeric(12,2) not null default 1 check(minimum_payment>0),
 expiry_days integer check(expiry_days>0),
 redemption_percent integer not null default 100 check(redemption_percent between 0 and 100),
 reverse_on_refund boolean not null default true,
 eligible_services text[] not null default '{}'
);
insert into public.referral_config(id) values(true);
alter table public.referral_config enable row level security;
create policy "Read referral terms" on public.referral_config for select using(true);
-- Users must never be able to promote themselves by editing profiles.role.
revoke update on public.profiles from authenticated, anon;
grant update(full_name,city,avatar_url) on public.profiles to authenticated;
create policy "Admins configure referrals" on public.referral_config for update
using(exists(select 1 from public.profiles where id=auth.uid() and role='admin'))
with check(exists(select 1 from public.profiles where id=auth.uid() and role='admin'));

create table public.referral_codes (
 customer_id uuid primary key references public.profiles(id), code text not null unique default encode(gen_random_bytes(12),'hex')
);
create table public.referrals (
 id uuid primary key default gen_random_uuid(), referrer_id uuid not null references public.profiles(id),
 referred_id uuid not null unique references public.profiles(id),
 status text not null default 'pending' check(status in ('pending','credited','reversed')),
 reward_amount numeric(12,2) not null, qualifying_booking uuid unique references public.service_requests(id),
 created_at timestamptz not null default now(), check(referrer_id<>referred_id)
);
create table public.wallet_ledger (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id),
 amount numeric(12,2) not null, kind text not null, event_key text not null unique,
 booking_id uuid references public.service_requests(id), expires_at timestamptz,
 created_at timestamptz not null default now()
);
alter table public.referral_codes enable row level security;
alter table public.referrals enable row level security;
alter table public.wallet_ledger enable row level security;
create policy "Own referral code" on public.referral_codes for select using(customer_id=auth.uid());
create policy "Own referrals" on public.referrals for select using(referrer_id=auth.uid());
create policy "Own wallet" on public.wallet_ledger for select using(customer_id=auth.uid());

create function public.get_referral_code() returns text language plpgsql security definer set search_path=public as $$
declare result text;
begin
 if auth.uid() is null then raise exception 'Sign in to refer a friend'; end if;
 if not (select enabled from referral_config) then raise exception 'Referral programme is not enabled'; end if;
 insert into referral_codes(customer_id) values(auth.uid()) on conflict do nothing;
 select code into result from referral_codes where customer_id=auth.uid(); return result;
end $$;
create function public.claim_referral(p_code text) returns void language plpgsql security definer set search_path=public as $$
declare owner uuid; cfg referral_config;
begin
 if auth.uid() is null then raise exception 'Sign in to claim referral'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text,0));
 select * into cfg from referral_config;
 if not cfg.enabled then raise exception 'Referral programme is not enabled'; end if;
 if exists(select 1 from service_requests where customer_id=auth.uid()) then raise exception 'Referral is only for new customers before their first request'; end if;
 select customer_id into owner from referral_codes where code=p_code;
 if owner is null or owner=auth.uid() then raise exception 'Invalid referral'; end if;
 insert into referrals(referrer_id,referred_id,reward_amount) values(owner,auth.uid(),cfg.reward_amount) on conflict(referred_id) do nothing;
end $$;

-- Only an authenticated payment/backend worker may set paid/completed/refunded fields.
alter table public.service_requests add column paid_amount numeric(12,2) not null default 0,
 add column payment_status text not null default 'unpaid' check(payment_status in('unpaid','paid','refunded')),
 add column wallet_used numeric(12,2) not null default 0,
  add column quoted_total numeric(12,2) check(quoted_total>=0), add column idempotency_key uuid;
create unique index request_idempotency on public.service_requests(customer_id,idempotency_key);
drop policy "Customers create requests" on public.service_requests;
-- All new requests use validated RPCs below; no direct insert/update wallet/payment permissions.

create function public.reward_completed_referral() returns trigger language plpgsql security definer set search_path=public as $$
declare ref referrals; cfg referral_config;
begin
 select * into cfg from referral_config;
 if new.payment_status='paid' and new.status='completed' and new.paid_amount>=cfg.minimum_payment and new.request_type in('service','influencer','consultancy')
 and (cardinality(cfg.eligible_services)=0 or new.service_name=any(cfg.eligible_services)) then
   select * into ref from referrals where referred_id=new.customer_id for update;
   if found and ref.status='pending' then
     perform pg_advisory_xact_lock(hashtextextended(ref.referrer_id::text,0));
     insert into wallet_ledger(customer_id,amount,kind,event_key,booking_id,expires_at)
     values(ref.referrer_id,ref.reward_amount,'referral','referral:'||ref.id,new.id,case when cfg.expiry_days is null then null else now()+make_interval(days=>cfg.expiry_days) end)
     on conflict(event_key) do nothing;
     update referrals set status='credited',qualifying_booking=new.id where id=ref.id;
   end if;
 end if;
 if new.payment_status='refunded' and cfg.reverse_on_refund then
   select * into ref from referrals where qualifying_booking=new.id for update;
   if found and ref.status='credited' then
     perform pg_advisory_xact_lock(hashtextextended(ref.referrer_id::text,0));
     insert into wallet_ledger(customer_id,amount,kind,event_key,booking_id) values(ref.referrer_id,-ref.reward_amount,'reversal','reverse:'||ref.id,new.id) on conflict(event_key) do nothing;
     update referrals set status='reversed' where id=ref.id;
   end if;
 end if;
 return new;
end $$;
create trigger referral_completion after update of status,payment_status on public.service_requests for each row execute function public.reward_completed_referral();

create table public.excel_lead_outbox (
 lead_id uuid primary key references public.service_requests(id),
 destination text not null check(destination in('loan','logistics')),
 status text not null default 'pending_configuration' check(status in('pending_configuration','pending','processing','synced','retry')),
 attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
 last_error text, synced_at timestamptz
);
alter table public.excel_lead_outbox enable row level security;
-- Outbox is server-only. Never expose lead data, credentials or workbook tokens publicly.
create function public.submit_request(p_category text,p_service text,p_kind text,p_details jsonb,p_key uuid,p_vendor uuid default null)
returns public.service_requests language plpgsql security definer set search_path=public as $$
declare result service_requests;
begin
 if auth.uid() is null then raise exception 'Sign in with a verified account to submit'; end if;
 if p_key is null or length(trim(p_service))=0 then raise exception 'Missing request details'; end if;
 if p_kind not in('loan','transportation','blood','service','influencer','consultancy') then raise exception 'Invalid request type'; end if;
 if (p_kind='loan')<>(p_category='loans') or (p_kind='transportation')<>(p_category='transportation') then raise exception 'Category does not match request type'; end if;
 if p_kind in('loan','transportation') then
   if coalesce(length(trim(p_details->>'fullName')),0)<2 or coalesce(p_details->>'phone','') !~ '^\+?[0-9 ()-]{10,16}$'
      or coalesce(length(trim(p_details->>'address')),0)=0 then raise exception 'Name, valid phone and address are required'; end if;
   if p_kind='loan' and (coalesce(p_details->>'occupation','')='' or coalesce((p_details->>'income')::numeric,0)<=0 or coalesce((p_details->>'amount')::numeric,0)<=0 or coalesce((p_details->>'consent')::boolean,false)=false) then raise exception 'Occupation, income, loan amount and consent are required'; end if;
   if p_kind='transportation' and (coalesce(p_details->>'pickup','')='' or coalesce(p_details->>'drop','')='' or coalesce(p_details->>'shipmentSize','') not in('1 BHK','2 BHK','3 BHK','4 BHK') or coalesce(p_details->>'transportMode','') not in('Local','Out-of-City')) then raise exception 'Pickup, destination, shipment size and transport mode are required'; end if;
 end if;
 if p_vendor is not null and not exists(select 1 from vendors where id=p_vendor and published and p_service=any(service_names)) then raise exception 'Vendor does not offer this service'; end if;
 insert into service_requests(category_id,service_name,request_type,details,customer_id,idempotency_key,assigned_vendor_id)
 values(p_category,p_service,p_kind,p_details,auth.uid(),p_key,p_vendor)
 on conflict(customer_id,idempotency_key) do nothing returning * into result;
 if result.id is null then select * into result from service_requests where customer_id=auth.uid() and idempotency_key=p_key; end if;
 if p_kind='service' and p_vendor is not null and exists(select 1 from service_policies where service_name=p_service and fixed_price) then
  update service_requests set quoted_total=(select (prices->>p_service)::numeric from vendors where id=p_vendor)
  where id=result.id and quoted_total is null returning * into result;
  if result.id is null then select * into result from service_requests where customer_id=auth.uid() and idempotency_key=p_key; end if;
 end if;
 if p_kind in('loan','transportation') then insert into excel_lead_outbox(lead_id,destination) values(result.id,case when p_kind='loan' then 'loan' else 'logistics' end) on conflict do nothing; end if;
 return result;
end $$;
revoke all on function public.get_referral_code(), public.claim_referral(text), public.submit_request(text,text,text,jsonb,uuid,uuid) from public,anon;
grant execute on function public.get_referral_code(), public.claim_referral(text), public.submit_request(text,text,text,jsonb,uuid,uuid) to authenticated;
grant select on public.customer_reviews,public.vendor_directory,public.service_policies,public.referral_config to anon,authenticated;
grant select on public.my_reviews,public.saved_vendor_directory,public.referrals,public.wallet_ledger,public.customer_payment_methods,public.customer_memberships to authenticated;
grant select,insert,delete on public.saved_vendors to authenticated;
grant select,insert,update,delete on public.customer_addresses to authenticated;
grant update on public.referral_config to authenticated;
commit;
