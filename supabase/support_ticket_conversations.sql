-- Allow ticket owners and authorized support staff to exchange replies.
-- Existing follow-up notes and ticket workflow stay unchanged.
begin;

create index if not exists support_ticket_replies_thread
  on public.support_ticket_replies(ticket_id,created_at,id);

create function public.stamp_support_ticket_reply() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  new.body := trim(new.body);
  if length(new.body) not between 1 and 2000 then
    raise exception 'Reply must be 1-2000 characters';
  end if;
  new.created_at := clock_timestamp();
  return new;
end $$;
create trigger stamp_support_ticket_reply before insert on public.support_ticket_replies
  for each row execute function public.stamp_support_ticket_reply();

create policy "Ticket participants send replies" on public.support_ticket_replies
  for insert with check (
    author_id=auth.uid() and
    exists (
      select 1 from public.support_tickets t
      where t.id=ticket_id and
        (t.customer_id=auth.uid() or is_admin() or has_staff_permission('support.manage'))
    )
  );
grant insert on public.support_ticket_replies to authenticated;

commit;
