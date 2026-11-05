-- Account-scoped in-app Smart Match updates. Background push remains disabled.
begin;

create function eazily_private.notify_service_booking_offer()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare booking partner_orders; vendor_account uuid;
begin
  select * into booking from partner_orders where id=new.order_id;
  if booking.id is null or booking.role<>'professional' then return new; end if;
  select customer_id into vendor_account from partner_applications where id=new.partner_id;
  if tg_op='INSERT' and new.status='offered' and new.sequence=1 then
    insert into seller_notifications(account_id,role,order_id,title,automation_key)
      values(booking.customer_id,'professional',booking.id,'Request sent to your selected professional',
        'service-offer:'||new.id||':customer-request') on conflict(automation_key) do nothing;
  elsif tg_op='UPDATE' and old.status='offered' and new.status in ('declined','expired') then
    insert into seller_notifications(account_id,role,order_id,title,automation_key)
      values(vendor_account,'professional',booking.id,
        case when new.status='expired' then 'Your booking offer expired; it can no longer be accepted'
          else 'You declined this booking offer' end,
        'service-offer:'||new.id||':vendor-'||new.status),
        (booking.customer_id,'professional',booking.id,
        case when new.status='expired' then 'Professional did not respond before the offer expired'
          else 'Professional declined your request' end,
        'service-offer:'||new.id||':customer-'||new.status) on conflict(automation_key) do nothing;
  elsif tg_op='UPDATE' and old.status='offered' and new.status='accepted' and booking.status='accepted' then
    -- The legacy accept path already inserted a generic row in this transaction.
    update seller_notifications set title='Professional accepted your request',
      automation_key='service-offer:'||new.id||':customer-accepted'
      where id=(select id from seller_notifications where account_id=booking.customer_id
        and order_id=booking.id and title='Booking updated' and automation_key is null
        order by created_at desc limit 1);
    if not found then
      insert into seller_notifications(account_id,role,order_id,title,automation_key)
        values(booking.customer_id,'professional',booking.id,'Professional accepted your request',
          'service-offer:'||new.id||':customer-accepted') on conflict(automation_key) do nothing;
    end if;
    insert into seller_notifications(account_id,role,order_id,title,automation_key)
      values(vendor_account,'professional',booking.id,'Booking confirmed with this customer',
        'service-offer:'||new.id||':vendor-confirmed') on conflict(automation_key) do nothing;
  end if;
  return new;
end $$;

create trigger notify_service_booking_offer after insert or update of status on public.service_booking_offers
  for each row execute function eazily_private.notify_service_booking_offer();
revoke all on function eazily_private.notify_service_booking_offer() from public,anon,authenticated;

create function eazily_private.notify_service_booking_price_decision()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare accepted_offer bigint; vendor_account uuid;
begin
  if new.role<>'professional' or old.backup_price_approval_pending=new.backup_price_approval_pending then return new; end if;
  select offer.id,a.customer_id into accepted_offer,vendor_account
    from service_booking_offers offer join partner_applications a on a.id=offer.partner_id
    where offer.order_id=new.id and offer.status='accepted' and offer.sequence>1
    order by offer.sequence desc limit 1;
  if accepted_offer is null then return new; end if;
  if new.backup_price_approval_pending then
    insert into seller_notifications(account_id,role,order_id,title,automation_key)
      values(vendor_account,'professional',new.id,'Waiting for customer backup-price approval',
        'service-offer:'||accepted_offer||':vendor-price-pending')
      on conflict(automation_key) do nothing;
    return new;
  end if;
  insert into seller_notifications(account_id,role,order_id,title,automation_key)
    values(new.customer_id,'professional',new.id,
      case when new.status='accepted' then 'Backup price approved; booking confirmed'
        else 'Backup price declined; booking ended' end,
      'service-offer:'||accepted_offer||':customer-price-'||new.status)
    on conflict(automation_key) do nothing;
  return new;
end $$;

create trigger notify_service_booking_price_decision after update of backup_price_approval_pending on public.partner_orders
  for each row execute function eazily_private.notify_service_booking_price_decision();
revoke all on function eazily_private.notify_service_booking_price_decision() from public,anon,authenticated;

-- A stale notification must never reach the legacy no-open-offer accept path.
alter function public.change_seller_order(uuid,text,text) rename to service_match_notification_previous_change_seller_order;
revoke all on function public.service_match_notification_previous_change_seller_order(uuid,text,text) from public,anon,authenticated;
create function public.change_seller_order(p_order uuid,p_action text,p_reason text default '')
returns partner_orders language plpgsql security definer set search_path=public,pg_temp as $$
declare booking partner_orders; current_offer service_booking_offers;
begin
  select * into booking from partner_orders where id=p_order for update;
  if booking.role='professional' and p_action in ('accept','reject') and not booking.backup_price_approval_pending then
    select * into current_offer from service_booking_offers
      where order_id=p_order and partner_id=booking.partner_id and status='offered' for update;
    if booking.status<>'requested' or current_offer.id is null or current_offer.expires_at<=clock_timestamp() then
      raise exception 'Current unexpired Service Partner offer required';
    end if;
  end if;
  return service_match_notification_previous_change_seller_order(p_order,p_action,p_reason);
end $$;
revoke all on function public.change_seller_order(uuid,text,text) from public,anon,authenticated;
grant execute on function public.change_seller_order(uuid,text,text) to authenticated;

commit;
