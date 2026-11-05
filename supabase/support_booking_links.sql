-- Link support tickets to an owned booking at any stage, without rewriting historical tickets.
-- Apply after service_partner_smart_match.sql.
begin;

create or replace function public.guard_service_issue_order() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' and (
    new.booking_id is distinct from old.booking_id
    or new.partner_order_id is distinct from old.partner_order_id
    or (new.customer_id is distinct from old.customer_id
        and (old.booking_id is not null or old.partner_order_id is not null))
  ) then
    raise exception 'Support ticket booking link cannot be changed';
  end if;

  if new.booking_id is not null and new.partner_order_id is not null then
    raise exception 'Choose one booking link for a support ticket';
  end if;
  if new.booking_id is not null and not exists (
    select 1 from public.service_requests r
    where r.id=new.booking_id and r.customer_id=new.customer_id
  ) then
    raise exception 'Customer service request required';
  end if;
  if new.partner_order_id is not null and not exists (
    select 1 from public.partner_orders o
    where o.id=new.partner_order_id and o.customer_id=new.customer_id
  ) then
    raise exception 'Customer partner order required';
  end if;
  return new;
end $$;

drop trigger if exists guard_service_issue_order on public.support_tickets;
create trigger guard_service_issue_order
  before insert or update of booking_id,partner_order_id,customer_id on public.support_tickets
  for each row execute function public.guard_service_issue_order();

create or replace function public.report_service_booking_issue(p_order uuid,p_description text)
returns public.support_tickets language plpgsql security definer set search_path=public,pg_temp as $$
declare o public.partner_orders; result public.support_tickets;
begin
  select * into o from public.partner_orders where id=p_order and customer_id=auth.uid()
    and role='professional';
  if o.id is null then raise exception 'Customer Service Partner booking required'; end if;
  if length(trim(coalesce(p_description,''))) not between 10 and 5000 then
    raise exception 'Describe the issue in 10-5000 characters';
  end if;
  insert into public.support_tickets(customer_id,partner_order_id,category,description)
    values(auth.uid(),o.id,'Booking',trim(p_description)) returning * into result;
  return result;
end $$;

commit;
