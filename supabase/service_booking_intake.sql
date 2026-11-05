-- Apply after service_partner_smart_match.sql. Keep address outside public.partner_orders.
begin;

create table eazily_private.service_booking_intake (
  order_id uuid primary key references public.partner_orders(id) on delete cascade,
  address text not null check (length(trim(address)) between 5 and 500),
  requirement text not null check (length(trim(requirement)) between 5 and 1000),
  created_at timestamptz not null default clock_timestamp()
);
revoke all on eazily_private.service_booking_intake from public, anon, authenticated;

-- The existing booking RPC still performs consent, eligibility, Smart Match and
-- idempotency checks. Intake insertion shares its transaction: no orphan booking
-- is committed if the private details cannot be saved.
create function public.request_professional_booking_with_intake(
  p_post uuid, p_slot timestamptz, p_key uuid, p_backup boolean, p_city text,
  p_address text, p_requirement text
) returns public.partner_orders language plpgsql security definer
set search_path=public,eazily_private,pg_temp as $$
declare booking public.partner_orders; saved eazily_private.service_booking_intake;
begin
  if length(trim(coalesce(p_address,''))) not between 5 and 500 then
    raise exception 'Enter a service address (5–500 characters)';
  end if;
  if length(trim(coalesce(p_requirement,''))) not between 5 and 1000 then
    raise exception 'Describe the work in 5–1000 characters';
  end if;
  booking := public.request_professional_booking(p_post,p_slot,p_key,p_backup,p_city);
  insert into eazily_private.service_booking_intake(order_id,address,requirement)
    values(booking.id,trim(p_address),trim(p_requirement))
    on conflict(order_id) do nothing;
  select * into saved from eazily_private.service_booking_intake where order_id=booking.id;
  if saved.address is distinct from trim(p_address) or saved.requirement is distinct from trim(p_requirement) then
    raise exception 'Booking reference belongs to different service details';
  end if;
  return booking;
end $$;
revoke all on function public.request_professional_booking_with_intake(uuid,timestamptz,uuid,boolean,text,text,text)
  from public,anon,authenticated;
grant execute on function public.request_professional_booking_with_intake(uuid,timestamptz,uuid,boolean,text,text,text)
  to authenticated;

-- A customer-selected replacement creates a new order. Carry the same work
-- brief and address into its private record without putting them on the order.
alter function public.request_selected_alternative_booking(uuid,uuid,timestamptz,uuid,jsonb)
  rename to service_intake_legacy_selected_alternative_booking;
revoke all on function public.service_intake_legacy_selected_alternative_booking(uuid,uuid,timestamptz,uuid,jsonb)
  from public,anon,authenticated;
create function public.request_selected_alternative_booking(
  p_original uuid,p_post uuid,p_slot timestamptz,p_key uuid,p_approved_estimate jsonb
) returns public.partner_orders language plpgsql security definer
set search_path=public,eazily_private,pg_temp as $$
declare booking public.partner_orders; source eazily_private.service_booking_intake;
begin
  booking := public.service_intake_legacy_selected_alternative_booking(
    p_original,p_post,p_slot,p_key,p_approved_estimate);
  select * into source from eazily_private.service_booking_intake where order_id=p_original;
  if source.order_id is not null then
    insert into eazily_private.service_booking_intake(order_id,address,requirement)
      values(booking.id,source.address,source.requirement) on conflict(order_id) do nothing;
  end if;
  return booking;
end $$;
revoke all on function public.request_selected_alternative_booking(uuid,uuid,timestamptz,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.request_selected_alternative_booking(uuid,uuid,timestamptz,uuid,jsonb)
  to authenticated;

-- Current offer holders can read the brief. A full address is released only
-- after confirmation to the customer, the assigned partner and order staff.
create function public.get_service_booking_intake(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path=public,eazily_private,pg_temp as $$
declare booking public.partner_orders; intake eazily_private.service_booking_intake;
  owner_access boolean; staff_access boolean; offered_access boolean; assigned_access boolean;
begin
  if auth.uid() is null then raise exception 'Sign in to view booking details'; end if;
  select * into booking from public.partner_orders where id=p_order and role='professional';
  if booking.id is null then return null; end if;
  owner_access := booking.customer_id=auth.uid();
  staff_access := public.is_admin() or public.has_staff_permission('orders.view');
  select exists(
    select 1 from public.service_booking_offers offer
    join public.partner_applications partner on partner.id=offer.partner_id
    where offer.order_id=p_order and offer.status in ('offered','accepted')
      and partner.customer_id=auth.uid()
      and offer.partner_id=booking.partner_id
  ) into offered_access;
  select exists(
    select 1 from public.partner_applications partner
    where partner.id=booking.partner_id and partner.customer_id=auth.uid()
      and booking.status in ('accepted','active','awaiting_acceptance','completed','disputed')
  ) into assigned_access;
  if not (owner_access or staff_access or offered_access or assigned_access) then
    raise exception 'Booking details are not available to this account';
  end if;
  select * into intake from eazily_private.service_booking_intake where order_id=p_order;
  if intake.order_id is null then return null; end if;
  if owner_access or staff_access or assigned_access then
    return jsonb_build_object('requirement',intake.requirement,'address',intake.address);
  end if;
  return jsonb_build_object('requirement',intake.requirement);
end $$;
revoke all on function public.get_service_booking_intake(uuid) from public,anon,authenticated;
grant execute on function public.get_service_booking_intake(uuid) to authenticated;

commit;
