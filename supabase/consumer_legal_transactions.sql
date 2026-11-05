-- Apply after consumer_legal.sql and all existing transaction migrations.
-- Preserve existing implementations and authentication/ownership checks.
begin;

alter function public.submit_request(text,text,text,jsonb,uuid,uuid) rename to consumer_legacy_submit_request;
revoke all on function public.consumer_legacy_submit_request(text,text,text,jsonb,uuid,uuid) from public,anon,authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then revoke all on function public.consumer_legacy_submit_request(text,text,text,jsonb,uuid,uuid) from service_role; end if; end$$;
create function public.submit_request(p_category text,p_service text,p_kind text,p_details jsonb,p_key uuid,p_vendor uuid default null) returns service_requests language plpgsql security definer set search_path=public,eazily_private,pg_temp as $$
begin
 if auth.uid() is not null then perform require_consumer_policies(auth.uid()); end if;
 return public.consumer_legacy_submit_request(p_category,p_service,p_kind,p_details,p_key,p_vendor);
end $$;
revoke all on function public.submit_request(text,text,text,jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.submit_request(text,text,text,jsonb,uuid,uuid) to authenticated;

alter function public.book_partner_offering(uuid,timestamptz,uuid) rename to consumer_legacy_book_partner_offering;
revoke all on function public.consumer_legacy_book_partner_offering(uuid,timestamptz,uuid) from public,anon,authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then revoke all on function public.consumer_legacy_book_partner_offering(uuid,timestamptz,uuid) from service_role; end if; end$$;
create function public.book_partner_offering(p_post uuid,p_slot timestamptz,p_key uuid) returns partner_orders language plpgsql security definer set search_path=public,eazily_private,pg_temp as $$
begin
 if auth.uid() is not null then perform require_consumer_policies(auth.uid()); end if;
 return public.consumer_legacy_book_partner_offering(p_post,p_slot,p_key);
end $$;
revoke all on function public.book_partner_offering(uuid,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.book_partner_offering(uuid,timestamptz,uuid) to authenticated;

alter function public.book_free_introduction(uuid,timestamptz) rename to consumer_legacy_book_free_introduction;
revoke all on function public.consumer_legacy_book_free_introduction(uuid,timestamptz) from public,anon,authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then revoke all on function public.consumer_legacy_book_free_introduction(uuid,timestamptz) from service_role; end if; end$$;
create function public.book_free_introduction(p_post_id uuid,p_slot timestamptz) returns partner_orders language plpgsql security definer set search_path=public,eazily_private,pg_temp as $$
begin
 if auth.uid() is not null then perform require_consumer_policies(auth.uid()); end if;
 return public.consumer_legacy_book_free_introduction(p_post_id,p_slot);
end $$;
revoke all on function public.book_free_introduction(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.book_free_introduction(uuid,timestamptz) to authenticated;

alter function public.reserve_wallet(uuid) rename to consumer_legacy_reserve_wallet;
revoke all on function public.consumer_legacy_reserve_wallet(uuid) from public,anon,authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then revoke all on function public.consumer_legacy_reserve_wallet(uuid) from service_role; end if; end$$;
create function public.reserve_wallet(p_booking uuid) returns jsonb language plpgsql security definer set search_path=public,eazily_private,pg_temp as $$
begin
 if auth.uid() is not null then perform require_consumer_policies(auth.uid()); end if;
 return public.consumer_legacy_reserve_wallet(p_booking);
end $$;
revoke all on function public.reserve_wallet(uuid) from public,anon,authenticated;
grant execute on function public.reserve_wallet(uuid) to authenticated;

alter function public.request_official_payment(uuid,uuid) rename to consumer_legacy_request_official_payment;
revoke all on function public.consumer_legacy_request_official_payment(uuid,uuid) from public,anon,authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then revoke all on function public.consumer_legacy_request_official_payment(uuid,uuid) from service_role; end if; end$$;
create function public.request_official_payment(p_order uuid,p_quote uuid) returns jsonb language plpgsql security definer set search_path=public,eazily_private,pg_temp as $$
begin
 if auth.uid() is not null then perform require_consumer_policies(auth.uid()); end if;
 return public.consumer_legacy_request_official_payment(p_order,p_quote);
end $$;
revoke all on function public.request_official_payment(uuid,uuid) from public,anon,authenticated;
grant execute on function public.request_official_payment(uuid,uuid) to authenticated;

alter function public.respond_to_quote(uuid,uuid,boolean,text) rename to consumer_legacy_respond_to_quote;
revoke all on function public.consumer_legacy_respond_to_quote(uuid,uuid,boolean,text) from public,anon,authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then revoke all on function public.consumer_legacy_respond_to_quote(uuid,uuid,boolean,text) from service_role; end if; end$$;
create function public.respond_to_quote(p_order uuid,p_quote uuid,p_approve boolean,p_reason text default '') returns jsonb language plpgsql security definer set search_path=public,eazily_private,pg_temp as $$
begin
 if p_approve is true and auth.uid() is not null then perform require_consumer_policies(auth.uid()); end if;
 return public.consumer_legacy_respond_to_quote(p_order,p_quote,p_approve,p_reason);
end $$;
revoke all on function public.respond_to_quote(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.respond_to_quote(uuid,uuid,boolean,text) to authenticated;

alter function public.claim_referral(text) rename to consumer_legacy_claim_referral;
revoke all on function public.consumer_legacy_claim_referral(text) from public,anon,authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then revoke all on function public.consumer_legacy_claim_referral(text) from service_role; end if; end$$;
create function public.claim_referral(p_code text) returns void language plpgsql security definer set search_path=public,eazily_private,pg_temp as $$
begin
 if auth.uid() is not null then perform require_consumer_policies(auth.uid()); end if;
 perform public.consumer_legacy_claim_referral(p_code);
end $$;
revoke all on function public.claim_referral(text) from public,anon,authenticated;
grant execute on function public.claim_referral(text) to authenticated;

alter function public.prepare_seller_gateway(uuid,uuid) rename to consumer_legacy_prepare_seller_gateway;
revoke all on function public.consumer_legacy_prepare_seller_gateway(uuid,uuid) from public,anon,authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then revoke all on function public.consumer_legacy_prepare_seller_gateway(uuid,uuid) from service_role; end if; end$$;
create function public.prepare_seller_gateway(p_request uuid,p_customer uuid) returns jsonb language plpgsql security definer set search_path=public,eazily_private,pg_temp as $$
begin
 if true then perform require_consumer_policies(p_customer); end if;
 return public.consumer_legacy_prepare_seller_gateway(p_request,p_customer);
end $$;
revoke all on function public.prepare_seller_gateway(uuid,uuid) from public,anon,authenticated;
do $$begin if exists(select 1 from pg_roles where rolname='service_role') then grant execute on function public.prepare_seller_gateway(uuid,uuid) to service_role; end if; end$$;
commit;
