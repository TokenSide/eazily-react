-- Apply after service_booking_intake.sql. No worker or payment configuration is changed.
begin;

alter table public.partner_orders
  add column if not exists source_request_id uuid references public.service_requests(id);
create unique index if not exists partner_orders_one_source_request
  on public.partner_orders(source_request_id) where source_request_id is not null;

-- Use the existing Find a Professional Smart Match, offer, notification and
-- seller-lead path. A row lock and the unique source reference make retries safe.
create function eazily_private.try_route_general_service_request(p_request uuid)
returns uuid language plpgsql security definer set search_path=public,eazily_private,pg_temp as $$
declare source public.service_requests; existing public.partner_orders;
  booking public.partner_orders; city text; address text; requirement text;
  slot timestamptz; booking_key uuid;
begin
  select * into source from public.service_requests where id=p_request for update;
  if source.id is null or source.customer_id is distinct from auth.uid()
    or source.request_type<>'service' or source.category_id<>'manpower'
    or source.assigned_vendor_id is not null or source.status<>'pending' then return null; end if;
  select * into existing from public.partner_orders where source_request_id=source.id;
  if existing.id is not null then return existing.id; end if;
  city := trim(coalesce(source.details->>'city',''));
  address := trim(coalesce(source.details->>'location',''));
  requirement := trim(coalesce(source.details->>'description',''));
  if length(city) not between 2 and 100 or length(address) not between 5 and 500
    or length(requirement) not between 5 and 1000
    or source.details->>'preferredSlot' is null then return null; end if;
  if not coalesce((public.service_match_capabilities()->>'backupAvailable')::boolean,false) then
    return null;
  end if;
  booking_key := coalesce(source.idempotency_key,source.id);
  begin
    slot := (source.details->>'preferredSlot')::timestamptz;
    if slot<=clock_timestamp() then return null; end if;
    booking := public.request_find_professional_booking(source.service_name,city,slot,booking_key);
    if booking.id is null or booking.customer_id<>source.customer_id
      or booking.role<>'professional' or booking.match_mode<>'find_professional'
      or lower(trim(booking.match_service))<>lower(trim(source.service_name))
      or lower(trim(booking.match_city))<>lower(city) then
      raise exception 'Smart Match booking does not match the source request';
    end if;
    update public.partner_orders set source_request_id=source.id where id=booking.id
      and source_request_id is null returning * into booking;
    if booking.id is null then raise exception 'Source request is already linked'; end if;
    insert into eazily_private.service_booking_intake(order_id,address,requirement)
      values(booking.id,address,requirement) on conflict(order_id) do nothing;
    update public.service_requests
      set details=details||jsonb_build_object('partnerOrderId',booking.id),updated_at=clock_timestamp()
      where id=source.id;
    return booking.id;
  exception when others then
    -- Roll back the attempted order/offer as one subtransaction. The original
    -- request remains pending in the existing Admin queue for later review.
    raise notice 'General service routing deferred for request %', p_request;
    return null;
  end;
end $$;
revoke all on function eazily_private.try_route_general_service_request(uuid)
  from public,anon,authenticated;

-- Preserve the existing legal-consent wrapper and all non-service request flows.
alter function public.submit_request(text,text,text,jsonb,uuid,uuid)
  rename to general_routing_legacy_submit_request;
revoke all on function public.general_routing_legacy_submit_request(text,text,text,jsonb,uuid,uuid)
  from public,anon,authenticated;
create function public.submit_request(
  p_category text,p_service text,p_kind text,p_details jsonb,p_key uuid,p_vendor uuid default null
) returns public.service_requests language plpgsql security definer
set search_path=public,eazily_private,pg_temp as $$
declare result public.service_requests;
begin
  result := public.general_routing_legacy_submit_request(
    p_category,p_service,p_kind,p_details,p_key,p_vendor);
  if result.request_type='service' and result.category_id='manpower'
    and result.assigned_vendor_id is null and result.status='pending' then
    perform eazily_private.try_route_general_service_request(result.id);
  end if;
  return result;
end $$;
revoke all on function public.submit_request(text,text,text,jsonb,uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.submit_request(text,text,text,jsonb,uuid,uuid)
  to authenticated;

commit;
