-- Apply after service_catalog_2026_09_20.sql. Keep historical values and IDs unchanged.
-- The catalogue validator accidentally contains a double-encoded right apostrophe.
begin;
alter function public.validate_service_partner_registration(jsonb,uuid)
  rename to validate_service_partner_registration_catalog_2026_09_20;

create function public.validate_service_partner_registration(p_details jsonb,p_owner uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare checked_details jsonb := p_details;
begin
  if p_details->>'servicePlace' = 'At the customer’s location' then
    -- Match the legacy validator's exact U+00E2 U+20AC U+2122 sequence only
    -- in this temporary validation copy. The submitted value remains canonical.
    checked_details := jsonb_set(p_details,'{servicePlace}',
      to_jsonb('At the customer' || U&'\00E2\20AC\2122' || 's location'),true);
  end if;
  perform public.validate_service_partner_registration_catalog_2026_09_20(checked_details,p_owner);
end $$;
revoke all on function public.validate_service_partner_registration(jsonb,uuid) from public,anon,authenticated;
commit;
