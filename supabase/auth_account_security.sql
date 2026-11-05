-- Step 24: local preparation only. Requires the complete canonical sequence.
begin;
alter table public.profiles drop constraint profiles_account_status_check;
alter table public.profiles add constraint profiles_account_status_check check(account_status in('active','suspended','blocked','closed'));
alter table public.partner_applications drop constraint partner_applications_status_check;
alter table public.partner_applications add constraint partner_applications_status_check check(status in('draft','submitted','under_review','approved','changes_required','rejected','suspended','blocked'));

create or replace function public.account_is_active() returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
select exists(select 1 from public.profiles where id=auth.uid() and account_status='active')
$$;
revoke all on function public.account_is_active() from public,anon;
grant execute on function public.account_is_active() to authenticated;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and account_status='active')
$$;
create or replace function public.has_staff_permission(p_permission text) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
select public.account_is_active() and exists(select 1 from public.staff_access
where account_id=auth.uid() and active and revoked_at is null and (staff_role='super_admin' or p_permission=any(permissions)))
$$;

create or replace function public.ensure_my_profile() returns public.profiles
language plpgsql security definer set search_path=public,pg_temp as $$
declare result public.profiles;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  -- Identity is obtained only from managed Auth, never user-supplied metadata.
  insert into public.profiles(id,phone,role)
  select id,phone,'customer'::public.user_role from auth.users where id=auth.uid()
  on conflict(id) do nothing;
  select * into result from public.profiles where id=auth.uid();
  if result.id is null then raise exception 'Authenticated identity unavailable'; end if;
  return result;
end $$;
revoke all on function public.ensure_my_profile() from public,anon;
grant execute on function public.ensure_my_profile() to authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.profiles(id,full_name,phone,role)
  values(new.id,coalesce(new.raw_user_meta_data->>'full_name',''),new.phone,'customer')
  on conflict(id) do nothing;
  return new;
end $$;
revoke all on function public.handle_new_user() from public,anon,authenticated;

create or replace function eazily_private.guard_account_write() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is not null and not public.account_is_active() then
    -- Only the server Auth trigger/repair RPC may bootstrap the caller's profile.
    if tg_table_schema='public' and tg_table_name='profiles' and tg_op='INSERT' then
      if new.id=auth.uid() and new.role='customer' and new.account_status='active' then return new; end if;
    end if;
    raise exception 'Account access restricted';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function eazily_private.guard_account_write() from public,anon,authenticated;

-- Apply restrictions to every application table, including tables written through
-- definer RPCs. Service workers without a user subject retain trusted access.
do $$ declare item record;
begin
  for item in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in('public','eazily_private') and c.relkind='r'
  loop
    execute format('create trigger account_access_write before insert or update or delete on %I.%I for each row execute function eazily_private.guard_account_write()',item.nspname,item.relname);
    if item.nspname='public' and item.relname<>'profiles' then
      execute format('create policy account_access_restriction on %I.%I as restrictive for all to authenticated using(public.account_is_active()) with check(public.account_is_active())',item.nspname,item.relname);
    end if;
  end loop;
end $$;
create policy account_storage_restriction on storage.objects as restrictive for all to authenticated
using(public.account_is_active()) with check(public.account_is_active());

-- Definer RPCs bypass table RLS: enforce active-account checks before their bodies,
-- including read-only chat/finance RPCs. Trigger functions are guarded by writes.
-- Preserve signatures, grants, search paths and the existing business logic.
do $$ declare item record; definition text;
begin
  for item in select p.oid,p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
    where n.nspname in('public','eazily_private') and p.prosecdef and l.lanname='plpgsql'
      and p.prorettype<>'trigger'::regtype and p.proname<>'ensure_my_profile'
      -- Never rewrite the reviewed Supabase RLS auto-enable event-trigger helper (see staging_security.sql).
      and not (n.nspname='public' and p.proname='rls_auto_enable' and p.pronargs=0
        and p.prorettype='event_trigger'::regtype and l.lanname='plpgsql'
        and pg_get_userbyid(p.proowner)='postgres' and p.proconfig='{search_path=pg_catalog}'::text[]
        and encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='2782e98b348aca7d6f6f73c420fd78d2e094957dd7a52b0483d4c34f29d2a7a1')
  loop
    if item.prosrc !~* '\mbegin\M' then raise exception 'Unreviewed RPC body'; end if;
    definition:=pg_get_functiondef(item.oid);
    definition:=regexp_replace(definition,'\mbegin\M',
      'begin if auth.uid() is not null and not public.account_is_active() then raise exception ''Account access restricted''; end if;', 'i');
    execute definition;
  end loop;
end $$;

-- SQL-language read helpers require their own restriction gates.
do $$ declare definition text;
begin
  definition:=pg_get_functiondef('public.seller_subscription_timeline(uuid)'::regprocedure);
  if position('auth.uid() is not null' in definition)=0 then raise exception 'Unexpected timeline definition'; end if;
  execute replace(definition,'auth.uid() is not null','auth.uid() is not null and public.account_is_active()');
  definition:=pg_get_functiondef('public.chat_can_access(uuid,uuid)'::regprocedure);
  if position('p_account is not null' in definition)=0 then raise exception 'Unexpected chat access definition'; end if;
  execute replace(definition,'p_account is not null','public.account_is_active() and p_account is not null');
end $$;
commit;
