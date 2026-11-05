-- Server-owned pricing, versioned quotes, booking verification and payment ledger.
begin;
create schema if not exists eazily_private;
revoke all on schema eazily_private from public,anon,authenticated;
create table public.seller_pricing_rules (
 id uuid primary key default gen_random_uuid(), role text not null check(role in('professional','influencer','consultant')),
 version integer not null check(version>0), enabled boolean not null default false,
 lower_markup_bps integer not null default 2500, upper_markup_bps integer not null default 1200,
 below_100_bps integer, consultant_share_bps integer not null default 5000,
 seller_tax_bps integer check(seller_tax_bps between 0 and 10000), customer_tax_bps integer check(customer_tax_bps between 0 and 10000),
 fee_tax_bps integer check(fee_tax_bps between 0 and 10000), separate_fee_paise bigint check(separate_fee_paise>=0),
 include_visiting boolean, include_additional boolean,
 rounding text not null default 'half_up' check(rounding='half_up'),
 unique(role,version), check(lower_markup_bps between 0 and 10000), check(upper_markup_bps between 0 and 10000),
 check(below_100_bps between 0 and 10000), check(consultant_share_bps between 0 and 10000)
);
insert into seller_pricing_rules(role,version) values('professional',1),('influencer',1),('consultant',1);
alter table seller_pricing_rules enable row level security;
create policy "Pricing admin only" on seller_pricing_rules for all using(is_admin()) with check(is_admin());
revoke all on seller_pricing_rules from anon,authenticated;
grant select,insert,update on seller_pricing_rules to authenticated;

create function eazily_private.calculate(p_role text,p_input jsonb) returns jsonb language plpgsql security definer set search_path=public,eazily_private as $$
declare r seller_pricing_rules; service numeric; visit numeric; extra numeric; base bigint; eligible bigint; markup bigint; rate integer; seller_tax bigint; tax bigint; fee_tax bigint; payable bigint;
begin
 select * into r from seller_pricing_rules where role=p_role and enabled order by version desc limit 1;
 if r.id is null or r.seller_tax_bps is null or r.customer_tax_bps is null or r.fee_tax_bps is null or r.separate_fee_paise is null or r.include_visiting is null or r.include_additional is null then raise exception 'Pricing configuration is incomplete'; end if;
 if not p_input ?& array['servicePaise','visitingPaise','additionalPaise','quantity','taxInclusive'] then raise exception 'Complete seller price inputs'; end if;
 if exists(select 1 from jsonb_object_keys(p_input) k where k<>all(array['servicePaise','visitingPaise','additionalPaise','quantity','taxInclusive'])) then raise exception 'Protected or unsupported price input';end if;
 if jsonb_typeof(p_input->'taxInclusive')<>'boolean' or p_input->>'servicePaise' is null or p_input->>'visitingPaise' is null or p_input->>'additionalPaise' is null or p_input->>'quantity' is null then raise exception 'Complete seller price inputs';end if;
 if (p_input->>'quantity')::numeric<>trunc((p_input->>'quantity')::numeric) or (p_input->>'quantity')::integer not between 1 and 10000 then raise exception 'Invalid quantity'; end if;
 service:=(p_input->>'servicePaise')::numeric; visit:=(p_input->>'visitingPaise')::numeric; extra:=(p_input->>'additionalPaise')::numeric;
 if service<0 or visit<0 or extra<0 or service<>trunc(service) or visit<>trunc(visit) or extra<>trunc(extra) or service+visit+extra>1000000000 then raise exception 'Use nonnegative integer paise within the supported limit'; end if;
 service:=service*(p_input->>'quantity')::integer;
 if (p_input->>'taxInclusive')::boolean then
  service:=round(service*10000/(10000+r.seller_tax_bps)); visit:=round(visit*10000/(10000+r.seller_tax_bps)); extra:=round(extra*10000/(10000+r.seller_tax_bps));
 end if;
 base:=service+visit+extra;
 eligible:=service+case when r.include_visiting then visit else 0 end+case when r.include_additional then extra else 0 end;
 if p_role='professional' then
  rate:=case when eligible<10000 then r.below_100_bps when eligible<=100000 then r.lower_markup_bps else r.upper_markup_bps end;
  if rate is null then raise exception 'Below-100 pricing configuration required'; end if;
 elsif p_role='influencer' then rate:=r.lower_markup_bps;
 else rate:=0; end if;
 markup:=round(eligible::numeric*rate/10000);
 seller_tax:=round(base::numeric*r.seller_tax_bps/10000);
 tax:=round((base+markup)::numeric*r.customer_tax_bps/10000);
 fee_tax:=round(r.separate_fee_paise::numeric*r.fee_tax_bps/10000);
 payable:=case when p_role='consultant' then round(base::numeric*r.consultant_share_bps/10000) else base end;
 return jsonb_build_object('ruleId',r.id,'version',r.version,'rule',to_jsonb(r),'sellerBasePaise',base,'sellerTaxPaise',seller_tax,'sellerPayablePaise',payable+seller_tax,'markupPaise',markup,'markupBps',rate,'servicePaise',base+markup,'feePaise',r.separate_fee_paise,'taxPaise',tax+fee_tax,'totalPaise',base+markup+r.separate_fee_paise+tax+fee_tax,'platformRevenuePaise',base+markup-payable+r.separate_fee_paise);
end $$;
revoke all on function eazily_private.calculate(text,jsonb) from public,anon,authenticated;

create table eazily_private.quotes (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.partner_orders(id),
 version integer not null, input jsonb not null, calculation jsonb not null, scope text not null,
 status text not null default 'proposed' check(status in('proposed','approved','disputed','superseded','paid')),
 key uuid not null unique, approved_at timestamptz, created_at timestamptz not null default now(), unique(order_id,version)
);
create table eazily_private.arrival (
 order_id uuid primary key references public.partner_orders(id), otp_hash text not null,
 otp text not null, attempts integer not null default 0, locked_until timestamptz, verified_at timestamptz
);
create table eazily_private.payment_requests (
 id uuid primary key default gen_random_uuid(), quote_id uuid not null references eazily_private.quotes(id),
 status text not null default 'pending' check(status in('pending','paid','failed','expired','refunded','partially_refunded')),
 provider_reference text unique, created_at timestamptz not null default now(), unique(quote_id)
);
create table eazily_private.payment_events (
 provider_event text primary key, request_id uuid not null references eazily_private.payment_requests(id),
 kind text not null check(kind in('paid','refund')), amount_paise bigint not null check(amount_paise>0), created_at timestamptz not null default now()
);
create table public.seller_order_events (
 id bigint generated always as identity primary key, order_id uuid not null references partner_orders(id), actor_id uuid references profiles(id),
 kind text not null, notes text, created_at timestamptz not null default now()
);
alter table seller_order_events enable row level security;
create policy "Order participant events" on seller_order_events for select using(is_admin() or exists(select 1 from partner_orders o join partner_applications a on a.id=o.partner_id where o.id=order_id and (o.customer_id=auth.uid() or a.customer_id=auth.uid())));
revoke all on seller_order_events from anon,authenticated;
grant select on seller_order_events to authenticated;

create function public.get_order_quote(p_order uuid) returns jsonb language plpgsql security definer set search_path=public,eazily_private as $$
declare o partner_orders; a partner_applications; q eazily_private.quotes; result jsonb;
begin
 select * into o from partner_orders where id=p_order; select * into a from partner_applications where id=o.partner_id;
 if o.id is null or auth.uid() is null or not (auth.uid() in(o.customer_id,a.customer_id) or is_admin()) then raise exception 'Order access required'; end if;
 select * into q from eazily_private.quotes where order_id=p_order order by version desc limit 1;
 if q.id is null then return null; end if;
 result:=jsonb_build_object('id',q.id,'orderId',q.order_id,'version',q.version,'scope',q.scope,'status',q.status);
 if is_admin() then return result||jsonb_build_object('input',q.input,'calculation',q.calculation); end if;
 if auth.uid()=a.customer_id then return result||jsonb_build_object('sellerBasePaise',q.calculation->'sellerBasePaise','sellerTaxPaise',q.calculation->'sellerTaxPaise','sellerPayablePaise',q.calculation->'sellerPayablePaise'); end if;
 return result||jsonb_build_object('servicePaise',q.calculation->'servicePaise','feePaise',q.calculation->'feePaise','taxPaise',q.calculation->'taxPaise','totalPaise',q.calculation->'totalPaise');
end $$;
create function public.admin_seller_finance() returns jsonb language plpgsql security definer set search_path=public,eazily_private as $$
begin
 if not is_admin() then raise exception 'Admin access required'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'orderId',q.order_id,'version',q.version,'status',q.status,'calculation',q.calculation,'payment',to_jsonb(r))) from eazily_private.quotes q left join eazily_private.payment_requests r on r.quote_id=q.id),'[]');
end $$;
revoke all on function admin_seller_finance() from public,anon;
grant execute on function admin_seller_finance() to authenticated;
create function public.create_seller_quote(p_order uuid,p_input jsonb,p_scope text,p_key uuid) returns jsonb language plpgsql security definer set search_path=public,eazily_private as $$
declare o partner_orders; a partner_applications; calc jsonb; q eazily_private.quotes;
begin
 select * into o from partner_orders where id=p_order for update;
 select * into a from partner_applications where id=o.partner_id and customer_id=auth.uid();
 if a.id is null or a.status<>'approved' then raise exception 'Assigned approved seller required'; end if;
 select * into q from eazily_private.quotes where key=p_key;
 if q.id is not null then if q.order_id<>p_order then raise exception 'Quote reference mismatch'; end if; return get_order_quote(p_order); end if;
 if o.role<>'professional' then raise exception 'Prepaid offerings use booking-time quotes'; end if;
 if o.status not in('active','awaiting_acceptance') or not exists(select 1 from eazily_private.arrival where order_id=p_order and verified_at is not null) then raise exception 'Verify arrival and start work first'; end if;
 if length(trim(p_scope))<3 then raise exception 'Describe the completed work'; end if;
 if exists(select 1 from eazily_private.quotes where order_id=p_order and status='paid') then raise exception 'Paid work requires a separate approved adjustment'; end if;
 calc:=eazily_private.calculate(o.role,p_input);
 update eazily_private.payment_requests set status='expired' where quote_id in(select id from eazily_private.quotes where order_id=p_order) and status in('pending','failed');
 update eazily_private.quotes set status='superseded' where order_id=p_order and status in('proposed','approved','disputed');
 insert into eazily_private.quotes(order_id,version,input,calculation,scope,key) select p_order,coalesce(max(version),0)+1,p_input,calc,p_scope,p_key from eazily_private.quotes where order_id=p_order;
 update partner_orders set status='awaiting_acceptance' where id=p_order;
 insert into seller_order_events(order_id,actor_id,kind) values(p_order,auth.uid(),'quote_created');
 return get_order_quote(p_order);
end $$;
create function public.respond_to_quote(p_order uuid,p_quote uuid,p_approve boolean,p_reason text default '') returns jsonb language plpgsql security definer set search_path=public,eazily_private as $$
declare q eazily_private.quotes;
begin
 perform 1 from partner_orders where id=p_order and customer_id=auth.uid() for update;
 if not found then raise exception 'Booking customer required'; end if;
 select * into q from eazily_private.quotes where id=p_quote and order_id=p_order for update;
 if q.id is null or q.status not in('proposed','approved','disputed') then raise exception 'Quote is no longer current'; end if;
 if not p_approve and length(trim(p_reason))<3 then raise exception 'Describe the correction or dispute'; end if;
 if q.status='disputed' and p_approve then raise exception 'A corrected quote requires review'; end if;
 update eazily_private.quotes set status=case when p_approve then 'approved' else 'disputed' end,approved_at=case when p_approve then now() end where id=p_quote;
 if not p_approve then
  update partner_orders set status='disputed' where id=p_order;
  update eazily_private.payment_requests set status='expired' where quote_id=p_quote and status in('pending','failed');
 end if;
 insert into seller_order_events(order_id,actor_id,kind,notes) values(p_order,auth.uid(),case when p_approve then 'quote_approved' else 'quote_disputed' end,p_reason);
 return get_order_quote(p_order);
end $$;
create function public.get_booking_otp(p_order uuid) returns text language plpgsql security definer set search_path=public,eazily_private as $$
declare code text;
begin
 perform 1 from partner_orders where id=p_order and customer_id=auth.uid() and role='professional' and status='accepted' for update;
 if not found then raise exception 'An accepted service booking is required'; end if;
 if exists(select 1 from eazily_private.arrival where order_id=p_order and verified_at is not null) then raise exception 'Arrival is already verified'; end if;
 code:=lpad(floor(random()*1000000)::integer::text,6,'0');
 insert into eazily_private.arrival(order_id,otp_hash,otp) values(p_order,crypt(code,gen_salt('bf')),code) on conflict do nothing;
 select otp into code from eazily_private.arrival where order_id=p_order;
 return code;
end $$;
create function public.verify_booking_arrival(p_order uuid,p_otp text) returns jsonb language plpgsql security definer set search_path=public,eazily_private as $$
declare v eazily_private.arrival;
begin
 perform 1 from partner_orders o join partner_applications a on a.id=o.partner_id where o.id=p_order and a.customer_id=auth.uid() and a.status='approved' and o.status='accepted' for update of o;
 if not found then raise exception 'Accepted booking assigned to this seller required'; end if;
 select * into v from eazily_private.arrival where order_id=p_order for update;
 if v.order_id is null then return jsonb_build_object('verified',false,'message','Ask the customer to open their booking code'); end if;
 if v.locked_until>now() then return jsonb_build_object('verified',false,'message','Too many attempts. Try again later.'); end if;
 if p_otp is null or p_otp !~ '^[0-9]{6}$' or crypt(p_otp,v.otp_hash) is distinct from v.otp_hash then
  update eazily_private.arrival set attempts=case when v.locked_until<=now() then 1 else attempts+1 end,locked_until=case when attempts>=4 then now()+interval '15 minutes' end where order_id=p_order;
  return jsonb_build_object('verified',false,'message','Incorrect booking code');
 end if;
 update eazily_private.arrival set verified_at=now(),otp='' where order_id=p_order;
 update partner_orders set status='active' where id=p_order;
 insert into seller_order_events(order_id,actor_id,kind) values(p_order,auth.uid(),'arrival_verified');
 return jsonb_build_object('verified',true);
end $$;

create function public.request_official_payment(p_order uuid,p_quote uuid) returns jsonb language plpgsql security definer set search_path=public,eazily_private as $$
declare q eazily_private.quotes; r eazily_private.payment_requests;
begin
 perform 1 from partner_orders where id=p_order and customer_id=auth.uid() for update;
 if not found then raise exception 'Booking customer required'; end if;
 select * into q from eazily_private.quotes where id=p_quote and order_id=p_order and status='approved';
 if q.id is null then raise exception 'Approve the current quote first'; end if;
 insert into eazily_private.payment_requests(quote_id) values(p_quote) on conflict do nothing;
 select * into r from eazily_private.payment_requests where quote_id=p_quote;
 return jsonb_build_object('id',r.id,'status',r.status,'providerReady',false,'message','Official payment checkout is awaiting provider configuration');
end $$;
-- Only a trusted provider adapter may call this after signature and amount verification.
create function public.record_verified_seller_payment(p_request uuid,p_event text,p_amount bigint,p_currency text) returns void language plpgsql security definer set search_path=public,eazily_private as $$
declare r eazily_private.payment_requests; q eazily_private.quotes; o partner_orders;
begin
 select * into r from eazily_private.payment_requests where id=p_request for update;
 select * into q from eazily_private.quotes where id=r.quote_id for update;
 select * into o from partner_orders where id=q.order_id for update;
 if r.id is null or p_currency<>'INR' or p_amount<>(q.calculation->>'totalPaise')::bigint then raise exception 'Payment amount or reference mismatch'; end if;
 if exists(select 1 from eazily_private.payment_events where provider_event=p_event and request_id=p_request and amount_paise=p_amount) then return; end if;
 if r.status<>'pending' or q.status<>'approved' then raise exception 'Payment request is not active'; end if;
 insert into eazily_private.payment_events(provider_event,request_id,kind,amount_paise) values(p_event,p_request,'paid',p_amount);
 update eazily_private.payment_requests set status='paid',provider_reference=p_event where id=p_request;
 update eazily_private.quotes set status='paid' where id=q.id;
 insert into partner_earnings(partner_id,order_id,role,state,amount,provider_reference) values(o.partner_id,o.id,o.role,'pending',(q.calculation->>'sellerPayablePaise')::numeric/100,p_event) on conflict(order_id,state) do nothing;
 insert into seller_order_events(order_id,kind) values(o.id,'payment_confirmed');
end $$;
revoke all on function get_order_quote(uuid),create_seller_quote(uuid,jsonb,text,uuid),respond_to_quote(uuid,uuid,boolean,text),get_booking_otp(uuid),verify_booking_arrival(uuid,text),request_official_payment(uuid,uuid),record_verified_seller_payment(uuid,text,bigint,text) from public,anon,authenticated;
grant execute on function get_order_quote(uuid),create_seller_quote(uuid,jsonb,text,uuid),respond_to_quote(uuid,uuid,boolean,text),get_booking_otp(uuid),verify_booking_arrival(uuid,text),request_official_payment(uuid,uuid) to authenticated;
do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function record_verified_seller_payment(uuid,text,bigint,text) to service_role; end if; end $$;
commit;
