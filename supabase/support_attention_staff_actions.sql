-- Staff lifecycle for the two support-attention task types only.
-- The existing job deduplication and default-off automation switches are unchanged.
begin;

alter table public.operational_review_tasks
  add column acknowledged_by uuid references public.profiles(id),
  add column acknowledged_at timestamptz,
  add column acknowledgement_reason text,
  add column resolved_by uuid references public.profiles(id),
  add column resolved_at timestamptz;

create function public.act_on_support_attention(p_task uuid,p_action text,p_reason text)
returns public.operational_review_tasks
language plpgsql security definer set search_path=public,pg_temp as $$
declare current_task public.operational_review_tasks; result public.operational_review_tasks;
  actor uuid:=auth.uid(); acted_at timestamptz:=clock_timestamp(); cleaned_reason text:=btrim(p_reason);
begin
  if actor is null or not (public.is_admin() or public.has_staff_permission('support.manage')) then
    raise exception 'Support permission required';
  end if;
  if p_action is null or p_action not in ('acknowledge','resolve') then raise exception 'Unsupported support attention action'; end if;
  if length(coalesce(cleaned_reason,'')) not between 3 and 1000 then
    raise exception 'Give a reason of 3-1000 characters';
  end if;
  select * into current_task from public.operational_review_tasks
    where id=p_task and task_type in ('booking_attention','urgent_ticket_attention') for update;
  if current_task.id is null then raise exception 'Support attention task not found'; end if;

  if p_action='acknowledge' then
    if current_task.status='in_review' and current_task.acknowledged_by=actor then return current_task; end if;
    if current_task.status<>'pending' then raise exception 'Support attention task cannot be acknowledged'; end if;
    update public.operational_review_tasks set status='in_review',assigned_to=actor,
      acknowledged_by=actor,acknowledged_at=acted_at,acknowledgement_reason=cleaned_reason,updated_at=acted_at
      where id=p_task returning * into result;
  else
    if current_task.status='resolved' then return current_task; end if;
    if current_task.status not in ('pending','in_review') then raise exception 'Support attention task cannot be resolved'; end if;
    update public.operational_review_tasks set status='resolved',
      assigned_to=coalesce(assigned_to,actor),resolved_by=actor,resolved_at=acted_at,
      resolution_note=cleaned_reason,updated_at=acted_at
      where id=p_task returning * into result;
  end if;

  insert into public.admin_audit_events(actor_id,action,entity_type,entity_id,reason,before_data,after_data,occurred_at)
    values(actor,'support_attention_'||case p_action when 'acknowledge' then 'acknowledged' else 'resolved' end,
      'operational_review_tasks',p_task::text,cleaned_reason,
      jsonb_build_object('status',current_task.status),jsonb_build_object('status',result.status),acted_at);
  perform public.emit_realtime_event('admin','admin','support','operational_review_tasks',p_task::text);
  return result;
end $$;

revoke all on function public.act_on_support_attention(uuid,text,text) from public,anon;
grant execute on function public.act_on_support_attention(uuid,text,text) to authenticated;

-- A manually retried job can reach the existing executor after staff have
-- resolved its task. Finish that lease without sending a fresh alert/event.
alter function public.execute_support_attention_job(uuid,text,timestamptz)
  rename to execute_support_attention_job_before_staff_actions;
revoke all on function public.execute_support_attention_job_before_staff_actions(uuid,text,timestamptz)
  from public,anon,authenticated,service_role;
create function public.execute_support_attention_job(
  p_job uuid,p_worker text,p_now timestamptz default clock_timestamp()
) returns text language plpgsql security definer set search_path=public,pg_temp as $$
declare active_job public.background_jobs; existing_task public.operational_review_tasks;
begin
  if not public.automation_is_worker() then raise exception 'Trusted worker required'; end if;
  select * into active_job from public.background_jobs
    where id=p_job and status='running' and lock_owner=p_worker for update;
  if active_job.id is null then raise exception 'Active job lease required'; end if;
  select * into existing_task from public.operational_review_tasks
    where deduplication_key=active_job.deduplication_key
      and task_type in ('booking_attention','urgent_ticket_attention') for update;
  if existing_task.id is not null and existing_task.status in ('resolved','cancelled') then
    perform public.complete_background_job(p_job,p_worker,p_now);
    return 'succeeded';
  end if;
  return public.execute_support_attention_job_before_staff_actions(p_job,p_worker,p_now);
end $$;
revoke all on function public.execute_support_attention_job(uuid,text,timestamptz)
  from public,anon,authenticated;
grant execute on function public.execute_support_attention_job(uuid,text,timestamptz)
  to service_role;

commit;
