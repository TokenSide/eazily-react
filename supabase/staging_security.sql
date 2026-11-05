-- Step 23. Forward-only security correction after background_automation.sql.
-- Does not enable providers or change existing financial configuration/data.
begin;

revoke create on schema public from public,anon,authenticated;

-- The retired legacy table allowed a sender to insert against any request UUID.
-- Current UI uses participant-checked send_chat_message/seller_messages instead.
-- Preserve historical reads and records; close the unused direct write surface.
revoke insert,update,delete on public.messages from public,anon,authenticated;

-- Preserve the timeline response shape while binding private subscription data
-- to the owning account or the existing trusted Admin role.
create or replace function public.seller_subscription_timeline(p_partner uuid) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
select jsonb_build_object(
  'status',case
    when s.approval_date_missing then 'approval_date_missing'
    when s.status='active' and s.current_period_end>now() then 'active'
    when now()<s.trial_ends_at then 'trial'
    when now()<s.founder_ends_at then 'founder_window'
    else coalesce(s.status,'expired') end,
  'approvalStartedAt',s.approval_started_at,'trialEndsAt',s.trial_ends_at,
  'founderEndsAt',s.founder_ends_at,'currentPeriodEnd',s.current_period_end,
  'planId',s.plan_id,'cancelAtPeriodEnd',s.cancel_at_period_end,
  'approvalDateMissing',s.approval_date_missing
) from public.seller_subscriptions s
join public.partner_applications a on a.id=s.partner_id
where s.partner_id=p_partner and auth.uid() is not null
  and (a.customer_id=auth.uid() or public.is_admin())
$$;
revoke all on function public.seller_subscription_timeline(uuid) from public,anon;
grant execute on function public.seller_subscription_timeline(uuid) to authenticated;

-- Trigger execution does not require browser EXECUTE grants. Only touch the
-- application's two schemas; never alter managed Auth/Storage functions.
do $$
declare fn record; configured_path text;
begin
  for fn in
    select p.oid,n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args,
      p.prorettype,p.proconfig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where p.prosecdef and n.nspname in ('public','eazily_private')
      -- Supabase platform event-trigger helper (reviewed 2026-09-27): only enables RLS on
      -- newly created public tables, pinned to pg_catalog. Skipped only on an exact match;
      -- any other body, owner, setting or signature still fails the guard below.
      and not (n.nspname='public' and p.proname='rls_auto_enable' and p.pronargs=0
        and p.prorettype='event_trigger'::regtype
        and p.prolang=(select oid from pg_language where lanname='plpgsql')
        and pg_get_userbyid(p.proowner)='postgres' and p.proconfig='{search_path=pg_catalog}'::text[]
        and encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='2782e98b348aca7d6f6f73c420fd78d2e094957dd7a52b0483d4c34f29d2a7a1')
  loop
    select substr(setting,length('search_path=')+1) into configured_path
      from unnest(fn.proconfig) setting where setting like 'search_path=%';
    if configured_path is null or configured_path !~ '^(public|eazily_private)(, ?(public|eazily_private|storage))*(, ?pg_temp)?$' then
      raise exception 'Unreviewed definer search_path for %.%',fn.nspname,fn.proname;
    end if;
    -- pg_temp must be explicit and last, otherwise temp relations precede public.
    if configured_path not like '%pg_temp%' then
      execute format('alter function %I.%I(%s) set search_path = %s, pg_temp',fn.nspname,fn.proname,fn.args,configured_path);
    end if;
    if fn.prorettype='trigger'::regtype then
      execute format('revoke all on function %I.%I(%s) from public,anon,authenticated',fn.nspname,fn.proname,fn.args);
    end if;
  end loop;
end $$;
commit;
