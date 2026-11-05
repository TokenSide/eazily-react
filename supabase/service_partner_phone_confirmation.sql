-- Require a confirmed Auth phone for every Service Partner submission path.
-- Existing drafts, submitted applications, consent, and documents are untouched.
begin;

create function public.require_confirmed_service_partner_phone(p_owner uuid,p_claimed_phone text)
returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare auth_phone text; confirmed_at timestamptz;
begin
  select u.phone,u.phone_confirmed_at into auth_phone,confirmed_at
    from auth.users u where u.id=p_owner;
  if nullif(btrim(auth_phone),'') is null or confirmed_at is null then
    raise exception 'Complete mobile OTP verification before submitting';
  end if;
  if nullif(btrim(p_claimed_phone),'') is null
     or regexp_replace(btrim(p_claimed_phone),'^\+','')
        is distinct from regexp_replace(btrim(auth_phone),'^\+','') then
    raise exception 'Verified mobile number must match the confirmed account phone';
  end if;
  return auth_phone;
end $$;
revoke all on function public.require_confirmed_service_partner_phone(uuid,text)
  from public,anon,authenticated;

-- Keep the earlier catalogue/location validator intact behind the new gate.
create or replace function public.validate_service_partner_registration(p_details jsonb,p_owner uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare checked_details jsonb:=p_details;
begin
  perform public.require_confirmed_service_partner_phone(p_owner,p_details->>'verifiedPhone');
  if p_details->>'servicePlace'='At the customer’s location' then
    checked_details:=jsonb_set(p_details,'{servicePlace}',
      to_jsonb('At the customer' || U&'\00E2\20AC\2122' || 's location'),true);
  end if;
  perform public.validate_service_partner_registration_catalog_2026_09_20(checked_details,p_owner);
end $$;
revoke all on function public.validate_service_partner_registration(jsonb,uuid)
  from public,anon,authenticated;

-- Rename, revoke, and wrap the two callable submit paths so their existing
-- consent, document, and six-step rules continue to execute unchanged.
alter function public.submit_service_partner_application(jsonb)
  rename to submit_service_partner_application_before_phone_gate;
revoke all on function public.submit_service_partner_application_before_phone_gate(jsonb)
  from public,anon,authenticated;
create function public.submit_service_partner_application(p_details jsonb)
returns public.partner_applications language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.require_confirmed_service_partner_phone(auth.uid(),p_details->>'verifiedPhone');
  return public.submit_service_partner_application_before_phone_gate(p_details);
end $$;
revoke all on function public.submit_service_partner_application(jsonb) from public,anon;
grant execute on function public.submit_service_partner_application(jsonb) to authenticated;

alter function public.save_partner_application(text,jsonb,boolean)
  rename to save_partner_application_before_phone_gate;
revoke all on function public.save_partner_application_before_phone_gate(text,jsonb,boolean)
  from public,anon,authenticated;
create function public.save_partner_application(p_role text,p_details jsonb,p_submit boolean default false)
returns public.partner_applications language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_role='professional' and p_submit then
    perform public.require_confirmed_service_partner_phone(auth.uid(),p_details->>'verifiedPhone');
  end if;
  return public.save_partner_application_before_phone_gate(p_role,p_details,p_submit);
end $$;
revoke all on function public.save_partner_application(text,jsonb,boolean) from public,anon;
grant execute on function public.save_partner_application(text,jsonb,boolean) to authenticated;

commit;
