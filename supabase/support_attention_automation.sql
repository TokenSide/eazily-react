-- Default-off, in-app-only support attention jobs. Apply after support_ticket_screenshots.sql.
begin;

alter table public.automation_configuration
  add column booking_attention_enabled boolean not null default false,
  add column urgent_ticket_attention_enabled boolean not null default false;

-- Use a server-maintained clock: ticket.created_at can be supplied on INSERT,
-- and an existing ticket may become urgent long after its creation.
alter table public.support_tickets add column urgent_attention_since_at timestamptz;
update public.support_tickets set urgent_attention_since_at=clock_timestamp()
  where priority='urgent' and status='open';
create function public.stamp_urgent_attention_start() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if new.priority='urgent' and new.status='open' then
    if tg_op='INSERT' or old.priority is distinct from 'urgent' or old.status is distinct from 'open' then
      new.urgent_attention_since_at:=clock_timestamp();
    else
      new.urgent_attention_since_at:=old.urgent_attention_since_at;
    end if;
  else
    new.urgent_attention_since_at:=null;
  end if;
  return new;
end $$;
create trigger stamp_urgent_attention_start before insert or update of priority,status,urgent_attention_since_at
  on public.support_tickets for each row execute function public.stamp_urgent_attention_start();

create index if not exists support_attention_bookings_due
  on public.partner_orders(deadline)
  where role='professional' and post_id is not null and status='accepted';
create index if not exists support_attention_tickets_due
  on public.support_tickets(urgent_attention_since_at)
  where priority='urgent' and status='open';

-- The existing outbox policy allows automation operators to inspect all other
-- notification types. These support alerts are readable only by their intended
-- recipient while that account still has support access.
drop policy "Scoped staff read notification outbox" on public.notification_outbox;
create policy "Scoped staff read notification outbox" on public.notification_outbox for select
using (
  case when notification_type in ('booking_attention','urgent_ticket_attention') then
    recipient_account_id=auth.uid() and (is_admin() or has_staff_permission('support.manage'))
  else is_admin() or has_staff_permission('automation.view') end
);
drop policy "Scoped staff read review tasks" on public.operational_review_tasks;
create policy "Scoped staff read review tasks" on public.operational_review_tasks for select
using (
  case when task_type in ('booking_attention','urgent_ticket_attention') then
    is_admin() or has_staff_permission('support.manage')
  else is_admin() or has_staff_permission(required_permission) or has_staff_permission('automation.view') end
);

create function public.enqueue_due_support_attention(p_now timestamptz default clock_timestamp())
returns integer language plpgsql security definer set search_path=public,eazily_private,pg_temp as $$
declare cfg public.automation_configuration; row_data record; job_key text; queued integer:=0;
begin
  if not public.automation_is_worker() then raise exception 'Trusted worker required'; end if;
  select * into cfg from public.automation_configuration where id=true;
  if not cfg.enabled then return 0; end if;

  if cfg.booking_attention_enabled then
    for row_data in
      select o.id,o.deadline,o.automation_version from public.partner_orders o
      where o.role='professional' and o.post_id is not null and o.status='accepted'
        and o.deadline is not null and o.deadline+interval '15 minutes'<=p_now
        and o.journey_status is null and not o.backup_price_approval_pending
        and not exists(select 1 from eazily_private.arrival a where a.order_id=o.id and a.verified_at is not null)
      order by o.deadline limit 100
    loop
      job_key:='booking-attention:'||row_data.id||':v'||row_data.automation_version;
      if not exists(select 1 from public.background_jobs j where j.deduplication_key=job_key) then
        perform public.enqueue_background_job('booking_attention','partner_orders',row_data.id::text,
          row_data.deadline+interval '15 minutes',job_key,row_data.automation_version);
        queued:=queued+1;
      end if;
    end loop;
  end if;

  if cfg.urgent_ticket_attention_enabled then
    for row_data in
      select t.id,t.urgent_attention_since_at from public.support_tickets t
      where t.priority='urgent' and t.status='open' and t.urgent_attention_since_at is not null
        and t.urgent_attention_since_at+interval '15 minutes'<=p_now
        and not exists(select 1 from public.support_ticket_replies r
                       where r.ticket_id=t.id and r.author_id<>t.customer_id
                         and r.created_at>=t.urgent_attention_since_at)
      order by t.urgent_attention_since_at limit 100
    loop
      job_key:='urgent-ticket-attention:'||row_data.id||':'||md5(row_data.urgent_attention_since_at::text);
      if not exists(select 1 from public.background_jobs j where j.deduplication_key=job_key) then
        perform public.enqueue_background_job('urgent_ticket_attention','support_tickets',row_data.id::text,
          row_data.urgent_attention_since_at+interval '15 minutes',job_key,null,
          jsonb_build_object('urgent_since_at',row_data.urgent_attention_since_at));
        queued:=queued+1;
      end if;
    end loop;
  end if;
  return queued;
end $$;

create function public.execute_support_attention_job(
  p_job uuid,p_worker text,p_now timestamptz default clock_timestamp()
) returns text language plpgsql security definer set search_path=public,eazily_private,pg_temp as $$
declare j public.background_jobs; cfg public.automation_configuration;
  booking public.partner_orders; ticket public.support_tickets; task_id uuid; staff_id uuid;
  task_key text; alert_type text; template text;
begin
  if not public.automation_is_worker() then raise exception 'Trusted worker required'; end if;
  select * into j from public.background_jobs where id=p_job and status='running' and lock_owner=p_worker for update;
  if j.id is null then raise exception 'Active job lease required'; end if;
  if j.job_type not in ('booking_attention','urgent_ticket_attention') then raise exception 'Unsupported support attention job'; end if;
  select * into cfg from public.automation_configuration where id=true;
  if not cfg.enabled or (j.job_type='booking_attention' and not cfg.booking_attention_enabled)
     or (j.job_type='urgent_ticket_attention' and not cfg.urgent_ticket_attention_enabled) then
    perform public.fail_background_job(j.id,p_worker,'obsolete','support_attention_disabled','Support attention is disabled',p_now);
    return 'cancelled';
  end if;

  if j.job_type='booking_attention' then
    select * into booking from public.partner_orders where id=j.related_entity_id::uuid for update;
    if booking.id is null or booking.role<>'professional' or booking.post_id is null
       or booking.status<>'accepted' or booking.deadline is null
       or booking.deadline+interval '15 minutes'>p_now or booking.journey_status is not null
       or booking.backup_price_approval_pending or booking.automation_version is distinct from j.entity_version
       or exists(select 1 from eazily_private.arrival a where a.order_id=booking.id and a.verified_at is not null) then
      perform public.fail_background_job(j.id,p_worker,'obsolete','booking_no_longer_due','Booking no longer needs support attention',p_now);
      return 'cancelled';
    end if;
    task_key:=j.deduplication_key;
    alert_type:='booking_attention'; template:='support-booking-arrival-review';
  else
    select * into ticket from public.support_tickets where id=j.related_entity_id::uuid for update;
    if ticket.id is null or ticket.priority<>'urgent' or ticket.status<>'open'
       or ticket.urgent_attention_since_at is null or ticket.urgent_attention_since_at+interval '15 minutes'>p_now
       or ticket.urgent_attention_since_at is distinct from (j.payload->>'urgent_since_at')::timestamptz
       or exists(select 1 from public.support_ticket_replies r
                 where r.ticket_id=ticket.id and r.author_id<>ticket.customer_id
                   and r.created_at>=ticket.urgent_attention_since_at) then
      perform public.fail_background_job(j.id,p_worker,'obsolete','ticket_acknowledged','Ticket no longer needs support attention',p_now);
      return 'cancelled';
    end if;
    task_key:=j.deduplication_key;
    alert_type:='urgent_ticket_attention'; template:='support-urgent-ticket-review';
  end if;

  insert into public.operational_review_tasks
    (task_type,related_entity_type,related_entity_id,required_permission,deduplication_key,due_at)
  values(alert_type,j.related_entity_type,j.related_entity_id,'support.manage',task_key,p_now)
  on conflict(deduplication_key) do nothing returning id into task_id;
  if task_id is null then
    select id into task_id from public.operational_review_tasks where deduplication_key=task_key;
  end if;

  for staff_id in
    select p.id from public.profiles p where p.account_status='active'
      and (p.role='admin' or exists (
        select 1 from public.staff_access s where s.account_id=p.id and s.active and s.revoked_at is null
          and (s.staff_role='super_admin' or 'support.manage'=any(s.permissions))
      ))
  loop
    perform public.queue_automation_notification(staff_id,alert_type,j.related_entity_type,j.related_entity_id,
      template,task_key||':staff:'||staff_id);
  end loop;
  perform public.emit_realtime_event('admin','admin','support','operational_review_tasks',task_id::text);
  perform public.complete_background_job(j.id,p_worker,p_now);
  return 'succeeded';
end $$;

revoke all on function public.enqueue_due_support_attention(timestamptz),
  public.execute_support_attention_job(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.enqueue_due_support_attention(timestamptz),
  public.execute_support_attention_job(uuid,text,timestamptz) to service_role;

commit;
