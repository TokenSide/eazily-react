begin;
alter table public.seller_subscription_config add column payment_checkout_enabled boolean not null default false;
-- Service-only preparation: caller authentication happens in the Edge Function first.
create function public.prepare_seller_gateway(p_request uuid,p_customer uuid) returns jsonb language plpgsql security definer set search_path=public,eazily_private as $$
declare r eazily_private.payment_requests;q eazily_private.quotes;o partner_orders;
begin
 if not(select payment_checkout_enabled from seller_subscription_config) then raise exception 'Official payment checkout is not enabled';end if;
 select * into r from eazily_private.payment_requests where id=p_request for update;
 select * into q from eazily_private.quotes where id=r.quote_id;
 select * into o from partner_orders where id=q.order_id and customer_id=p_customer;
 if o.id is null or r.status<>'pending' or q.status<>'approved' then raise exception 'Current approved customer payment required';end if;
 return jsonb_build_object('requestId',r.id,'orderId',o.id,'amountPaise',q.calculation->'totalPaise','currency','INR');
end $$;
create function public.get_seller_gateway_status(p_order uuid) returns jsonb language plpgsql security definer set search_path=public,eazily_private as $$
declare o partner_orders;a partner_applications;r eazily_private.payment_requests;
begin
 select * into o from partner_orders where id=p_order;select * into a from partner_applications where id=o.partner_id;
 if o.id is null or auth.uid() is null or auth.uid() not in(o.customer_id,a.customer_id) then raise exception 'Order access required';end if;
 select pr.* into r from eazily_private.payment_requests pr join eazily_private.quotes q on q.id=pr.quote_id where q.order_id=p_order order by q.version desc limit 1;
 return jsonb_build_object('status',r.status,'reference',r.provider_reference);
end $$;
create or replace function public.request_official_payment(p_order uuid,p_quote uuid) returns jsonb language plpgsql security definer set search_path=public,eazily_private as $$
declare q eazily_private.quotes;r eazily_private.payment_requests;ready boolean;
begin
 perform 1 from partner_orders where id=p_order and customer_id=auth.uid() for update;
 if not found then raise exception 'Booking customer required';end if;
 select * into q from eazily_private.quotes where id=p_quote and order_id=p_order and status='approved';
 if q.id is null then raise exception 'Approve the current quote first';end if;
 insert into eazily_private.payment_requests(quote_id) values(p_quote) on conflict do nothing;
 select * into r from eazily_private.payment_requests where quote_id=p_quote;
 select payment_checkout_enabled into ready from seller_subscription_config;
 return jsonb_build_object('id',r.id,'status',r.status,'providerReady',ready,'message',case when ready then 'Opening official payment checkout' else 'Official payment checkout is awaiting provider configuration' end);
end $$;
revoke all on function prepare_seller_gateway(uuid,uuid),get_seller_gateway_status(uuid) from public,anon,authenticated;
grant execute on function get_seller_gateway_status(uuid) to authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function prepare_seller_gateway(uuid,uuid) to service_role;end if;end$$;
commit;
