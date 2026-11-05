-- Secure customer/partner messaging. Apply once, after realtime_events.sql.
-- This migration extends seller_messages instead of creating a competing message store.
begin;

create table public.chat_configuration (
 id boolean primary key default true check(id), max_text_length integer not null default 4000 check(max_text_length between 100 and 10000),
 attachment_max_bytes bigint not null default 10485760 check(attachment_max_bytes between 1048576 and 26214400),
 signed_url_seconds integer not null default 300 check(signed_url_seconds between 60 and 900),
 messages_per_minute integer not null default 20 check(messages_per_minute between 1 and 120),
 retention_days integer, abandoned_attachment_hours integer not null default 24 check(abandoned_attachment_hours between 1 and 168),
 malware_scanning_enabled boolean not null default false, updated_at timestamptz not null default now()
);
insert into public.chat_configuration(id) values(true);

create table public.chat_conversations (
 id uuid primary key default gen_random_uuid(),
 conversation_type text not null check(conversation_type in('service','influencer','consultant','support')),
 customer_id uuid not null references public.profiles(id),
 partner_account_id uuid not null references public.profiles(id),
 partner_role text not null check(partner_role in('professional','influencer','consultant')),
 partner_application_id uuid references public.partner_applications(id),
 provider_post_id uuid references public.partner_posts(id),
 service_request_id uuid references public.service_requests(id),
 partner_order_id uuid references public.partner_orders(id),
 status text not null default 'active' check(status in('active','closed','blocked','reported','archived')),
 blocked_by uuid references public.profiles(id),
 initiated_by uuid not null references public.profiles(id),
 idempotency_key uuid not null unique,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), last_message_at timestamptz,
 check(customer_id<>partner_account_id)
);
create unique index chat_conversation_order on public.chat_conversations(partner_order_id) where partner_order_id is not null;
create unique index chat_conversation_request on public.chat_conversations(service_request_id) where service_request_id is not null;
create unique index chat_conversation_post on public.chat_conversations(customer_id,provider_post_id) where provider_post_id is not null and partner_order_id is null;
create index chat_conversation_customer_activity on public.chat_conversations(customer_id,last_message_at desc nulls last,updated_at desc);
create index chat_conversation_partner_activity on public.chat_conversations(partner_account_id,partner_role,last_message_at desc nulls last,updated_at desc);

create table public.chat_participant_state (
 conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
 account_id uuid not null references public.profiles(id) on delete cascade,
 last_read_message_id uuid,
 last_read_at timestamptz,
 archived boolean not null default false,
 muted boolean not null default false,
 last_activity_at timestamptz not null default now(),
 primary key(conversation_id,account_id)
);
create index chat_participant_account_activity on public.chat_participant_state(account_id,archived,last_activity_at desc);

create table public.chat_attachments (
 id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
 owner_id uuid not null references public.profiles(id), storage_path text not null unique, original_name text not null,
 mime_type text not null check(mime_type in('image/jpeg','image/png','image/webp','application/pdf')),
 size_bytes bigint not null check(size_bytes>0 and size_bytes<=10485760),
 status text not null default 'ready' check(status in('uploading','ready','failed','abandoned')),
 operation_key uuid not null unique, created_at timestamptz not null default now()
);

alter table public.seller_messages alter column order_id drop not null;
alter table public.seller_messages alter column sender_id drop not null;
alter table public.seller_messages alter column body drop not null;
alter table public.seller_messages drop constraint if exists seller_messages_body_check;
alter table public.seller_messages add column conversation_id uuid references public.chat_conversations(id),
 add column message_type text not null default 'text' check(message_type in('text','image','document','system','safety')),
 add column reply_to_id uuid references public.seller_messages(id),
 add column attachment_id uuid references public.chat_attachments(id),
 add column accepted_at timestamptz not null default now(),
 add column moderation_status text not null default 'visible' check(moderation_status in('visible','removed','restricted'));
alter table public.seller_messages add constraint chat_message_body_length check(body is null or length(body) between 1 and 4000);
alter table public.chat_attachments add column message_id uuid unique references public.seller_messages(id);

create table public.chat_reports (
 id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.chat_conversations(id),
 message_id uuid references public.seller_messages(id), reporter_id uuid not null references public.profiles(id),
 reported_account_id uuid not null references public.profiles(id),
 reason text not null check(reason in('spam','harassment','unsafe_request','payment_request','privacy','other')),
 details text check(details is null or length(details)<=2000),
 status text not null default 'pending' check(status in('pending','reviewing','resolved','dismissed')),
 created_at timestamptz not null default now(), reviewed_at timestamptz
);
create index chat_reports_queue on public.chat_reports(status,created_at);

create table public.chat_staff_access (
 id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.chat_conversations(id),
 report_id uuid not null references public.chat_reports(id), staff_id uuid not null references public.profiles(id),
 reason text not null check(length(trim(reason)) between 10 and 1000), granted_by uuid not null references public.profiles(id),
 granted_at timestamptz not null default now(), expires_at timestamptz not null, active boolean not null default true
);
create index chat_staff_active_access on public.chat_staff_access(staff_id,conversation_id,expires_at) where active;
create table public.chat_staff_audit (
 id bigint generated always as identity primary key, staff_id uuid not null references public.profiles(id),
 conversation_id uuid not null references public.chat_conversations(id), report_id uuid references public.chat_reports(id),
 action text not null check(action in('access_granted','conversation_viewed','attachment_viewed')),
 reason text not null, occurred_at timestamptz not null default now()
);

create or replace function public.chat_can_access(p_conversation uuid,p_account uuid default auth.uid()) returns boolean
language sql stable security definer set search_path=public as $$
 select p_account is not null and p_account=auth.uid() and (
  exists(select 1 from chat_conversations c where c.id=p_conversation and p_account in(c.customer_id,c.partner_account_id))
  or (p_account=auth.uid() and has_staff_permission('chat.review') and exists(
   select 1 from chat_staff_access x where x.conversation_id=p_conversation and x.staff_id=p_account and x.active and x.expires_at>now()
  ))
 )
$$;
revoke all on function public.chat_can_access(uuid,uuid) from public,anon;
grant execute on function public.chat_can_access(uuid,uuid) to authenticated;

alter table public.chat_configuration enable row level security;
alter table public.chat_conversations enable row level security;
alter table public.chat_participant_state enable row level security;
alter table public.chat_attachments enable row level security;
alter table public.chat_reports enable row level security;
alter table public.chat_staff_access enable row level security;
alter table public.chat_staff_audit enable row level security;

create policy "Read safe chat configuration" on public.chat_configuration for select using(true);
create policy "Authorised conversation access" on public.chat_conversations for select using(chat_can_access(id));
create policy "Own chat participant state" on public.chat_participant_state for select using(account_id=auth.uid());
create policy "Authorised chat attachments" on public.chat_attachments for select using(chat_can_access(conversation_id));
create policy "Own or scoped chat reports" on public.chat_reports for select using(reporter_id=auth.uid() or has_staff_permission('chat.review'));
create policy "Scoped staff chat grants" on public.chat_staff_access for select using(staff_id=auth.uid() and has_staff_permission('chat.review'));
create policy "Own staff chat audit" on public.chat_staff_audit for select using(staff_id=auth.uid() and has_staff_permission('chat.review'));
drop policy if exists "Participants read messages" on public.seller_messages;
create policy "Authorised participants read messages" on public.seller_messages for select using(conversation_id is not null and chat_can_access(conversation_id));

revoke all on public.chat_configuration,public.chat_conversations,public.chat_participant_state,public.chat_attachments,public.chat_reports,public.chat_staff_access,public.chat_staff_audit from anon,authenticated;
grant select on public.chat_configuration,public.chat_conversations,public.chat_participant_state,public.chat_attachments,public.chat_reports,public.chat_staff_access,public.chat_staff_audit to authenticated;

insert into public.chat_conversations(conversation_type,customer_id,partner_account_id,partner_role,partner_application_id,provider_post_id,partner_order_id,initiated_by,idempotency_key,created_at,updated_at,last_message_at)
select case o.role when 'professional' then 'service' else o.role end,o.customer_id,a.customer_id,o.role,o.partner_id,o.post_id,o.id,o.customer_id,gen_random_uuid(),o.created_at,o.created_at,max(m.created_at)
from partner_orders o join partner_applications a on a.id=o.partner_id left join seller_messages m on m.order_id=o.id
group by o.id,a.customer_id
on conflict(partner_order_id) where partner_order_id is not null do nothing;
update seller_messages m set conversation_id=c.id from chat_conversations c where c.partner_order_id=m.order_id and m.conversation_id is null;
insert into chat_participant_state(conversation_id,account_id,last_read_at,last_activity_at)
select id,customer_id,null,coalesce(last_message_at,created_at) from chat_conversations on conflict do nothing;
insert into chat_participant_state(conversation_id,account_id,last_read_at,last_activity_at)
select id,partner_account_id,null,coalesce(last_message_at,created_at) from chat_conversations on conflict do nothing;
alter table public.seller_messages alter column conversation_id set not null;
create index chat_messages_conversation_order on public.seller_messages(conversation_id,created_at desc,id desc);
create index chat_messages_sender_rate on public.seller_messages(sender_id,created_at desc) where sender_id is not null;

create or replace function public.ensure_order_chat(p_order uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare o partner_orders; a partner_applications; result chat_conversations;
begin
 select * into o from partner_orders where id=p_order; select * into a from partner_applications where id=o.partner_id;
 if o.id is null or a.id is null then raise exception 'Booking context required'; end if;
 select * into result from chat_conversations where partner_order_id=o.id;
 if result.id is null then
  insert into chat_conversations(conversation_type,customer_id,partner_account_id,partner_role,partner_application_id,provider_post_id,partner_order_id,initiated_by,idempotency_key)
  values(case o.role when 'professional' then 'service' else o.role end,o.customer_id,a.customer_id,o.role,a.id,o.post_id,o.id,o.customer_id,gen_random_uuid())
  on conflict(partner_order_id) where partner_order_id is not null do nothing;
  select * into result from chat_conversations where partner_order_id=o.id;
 end if;
 insert into chat_participant_state(conversation_id,account_id) values(result.id,result.customer_id),(result.id,result.partner_account_id) on conflict do nothing;
 return result.id;
end $$;
revoke all on function public.ensure_order_chat(uuid) from public,anon,authenticated;

create or replace function public.create_order_chat() returns trigger language plpgsql security definer set search_path=public as $$
begin perform ensure_order_chat(new.id); return new; end $$;
create trigger chat_after_partner_order after insert on public.partner_orders for each row execute function public.create_order_chat();

create or replace function public.start_chat(p_post uuid default null,p_order uuid default null,p_request uuid default null,p_key uuid default gen_random_uuid()) returns chat_conversations
language plpgsql security definer set search_path=public as $$
declare post_row partner_posts; app partner_applications; order_row partner_orders; request_row service_requests; vendor_row vendors; result chat_conversations; selected_count integer;
begin
 if auth.uid() is null then raise exception 'Sign in to message a provider'; end if;
 selected_count:=(p_post is not null)::integer+(p_order is not null)::integer+(p_request is not null)::integer;
 if selected_count<>1 then raise exception 'Choose one authorised conversation context'; end if;
 if p_order is not null then
  select * into order_row from partner_orders where id=p_order; select * into app from partner_applications where id=order_row.partner_id;
  if order_row.id is null or auth.uid() not in(order_row.customer_id,app.customer_id) then raise exception 'Booking conversation access required'; end if;
  perform ensure_order_chat(order_row.id); select * into result from chat_conversations where partner_order_id=order_row.id;
 elsif p_post is not null then
  select p.* into post_row from partner_posts p join partner_applications a on a.id=p.partner_id where p.id=p_post and p.status='published' and a.status='approved';
  select * into app from partner_applications where id=post_row.partner_id;
  if post_row.id is null or app.customer_id=auth.uid() then raise exception 'Choose an eligible published provider'; end if;
  select * into result from chat_conversations where customer_id=auth.uid() and provider_post_id=post_row.id and partner_order_id is null;
  if result.id is null then
   insert into chat_conversations(conversation_type,customer_id,partner_account_id,partner_role,partner_application_id,provider_post_id,initiated_by,idempotency_key)
   values(case app.role when 'professional' then 'service' else app.role end,auth.uid(),app.customer_id,app.role,app.id,post_row.id,auth.uid(),p_key)
   on conflict(customer_id,provider_post_id) where provider_post_id is not null and partner_order_id is null do nothing;
   select * into result from chat_conversations where customer_id=auth.uid() and provider_post_id=post_row.id and partner_order_id is null;
  end if;
 else
  select * into request_row from service_requests where id=p_request; select * into vendor_row from vendors where id=request_row.assigned_vendor_id;
  if request_row.id is null or vendor_row.id is null or auth.uid() not in(request_row.customer_id,vendor_row.owner_id) then raise exception 'Service request conversation access required'; end if;
  select * into result from chat_conversations where service_request_id=request_row.id;
  if result.id is null then
   insert into chat_conversations(conversation_type,customer_id,partner_account_id,partner_role,service_request_id,initiated_by,idempotency_key)
   values('service',request_row.customer_id,vendor_row.owner_id,'professional',request_row.id,auth.uid(),p_key)
   on conflict(service_request_id) where service_request_id is not null do nothing;
   select * into result from chat_conversations where service_request_id=request_row.id;
  end if;
 end if;
 insert into chat_participant_state(conversation_id,account_id,archived) values(result.id,result.customer_id,false),(result.id,result.partner_account_id,false)
 on conflict(conversation_id,account_id) do update set archived=false,last_activity_at=now();
 return result;
end $$;

create or replace function public.list_chat_conversations(p_role text default null,p_before timestamptz default null,p_limit integer default 30) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 if auth.uid() is null then raise exception 'Sign in to view messages'; end if;
 if p_role is not null and not exists(select 1 from partner_applications where customer_id=auth.uid() and role=p_role) then raise exception 'Partner workspace access required'; end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.last_activity_at desc) from (
  select c.id,c.conversation_type,c.partner_role,c.status,c.blocked_by,c.partner_order_id,c.service_request_id,c.provider_post_id,
   case when auth.uid()=c.customer_id then coalesce(a.details->>'businessName',a.details->>'creatorName',a.details->>'name','Eazily Partner') else coalesce(p.full_name,'Customer') end other_name,
   case when c.partner_order_id is not null then coalesce(o.title,'Booking conversation') when c.provider_post_id is not null then coalesce(pp.details->>'title',pp.details->>'service',pp.details->>'category','Provider enquiry') else coalesce(sr.service_name,'Service request') end context_label,
   case when c.partner_order_id is not null then 'EAZ-'||upper(left(c.partner_order_id::text,8)) when c.service_request_id is not null then 'EAZ-'||upper(left(c.service_request_id::text,8)) else null end reference,
   case when lm.moderation_status='removed' then 'Message removed' when lm.message_type in('image','document') then coalesce(lm.body,'Attachment') else left(coalesce(lm.body,''),120) end last_preview,
   coalesce(c.last_message_at,c.updated_at) last_activity_at,s.archived,s.muted,
   (select count(*) from seller_messages m where m.conversation_id=c.id and m.sender_id is distinct from auth.uid() and m.created_at>coalesce(s.last_read_at,'epoch'::timestamptz)) unread_count
  from chat_conversations c join chat_participant_state s on s.conversation_id=c.id and s.account_id=auth.uid()
  left join partner_applications a on a.id=c.partner_application_id left join profiles p on p.id=c.customer_id
  left join partner_orders o on o.id=c.partner_order_id left join partner_posts pp on pp.id=c.provider_post_id left join service_requests sr on sr.id=c.service_request_id
  left join lateral(select * from seller_messages m where m.conversation_id=c.id order by m.created_at desc,m.id desc limit 1) lm on true
  where auth.uid() in(c.customer_id,c.partner_account_id) and (p_role is null or (c.partner_account_id=auth.uid() and c.partner_role=p_role))
   and (p_before is null or coalesce(c.last_message_at,c.updated_at)<p_before) and (not s.archived or exists(select 1 from seller_messages m where m.conversation_id=c.id and m.created_at>coalesce(s.last_activity_at,'epoch')))
  order by coalesce(c.last_message_at,c.updated_at) desc limit least(greatest(p_limit,1),50)
 ) x),'[]'::jsonb);
end $$;

create or replace function public.get_chat_messages(p_conversation uuid,p_before timestamptz default null,p_limit integer default 40) returns jsonb
language plpgsql stable security definer set search_path=public as $$
begin
 if not chat_can_access(p_conversation) then raise exception 'Conversation access required'; end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from (
  select m.id,m.conversation_id,m.sender_id,m.body,m.message_type,m.reply_to_id,m.accepted_at,m.created_at,m.moderation_status,
   case when m.sender_id=auth.uid() then 'you' when m.sender_id is null then 'system' else 'other' end sender_kind,
   case when m.sender_id=auth.uid() then coalesce(other_state.last_read_at>=m.created_at,false) else false end read,
   case when att.id is null then null else jsonb_build_object('id',att.id,'name',att.original_name,'mimeType',att.mime_type,'sizeBytes',att.size_bytes,'path',att.storage_path) end attachment
  from seller_messages m left join chat_attachments att on att.id=m.attachment_id
  left join chat_conversations c on c.id=m.conversation_id
  left join chat_participant_state other_state on other_state.conversation_id=c.id and other_state.account_id=case when auth.uid()=c.customer_id then c.partner_account_id else c.customer_id end
  where m.conversation_id=p_conversation and (p_before is null or m.created_at<p_before)
  order by m.created_at desc,m.id desc limit least(greatest(p_limit,1),100)
 ) x),'[]'::jsonb);
end $$;

create or replace function public.send_chat_message(p_conversation uuid,p_body text,p_type text,p_attachment uuid default null,p_reply_to uuid default null,p_key uuid default gen_random_uuid()) returns seller_messages
language plpgsql security definer set search_path=public as $$
declare c chat_conversations; cfg chat_configuration; cleaned text; result seller_messages; attachment chat_attachments;
begin
 select * into c from chat_conversations where id=p_conversation for update;
 if c.id is null or auth.uid() not in(c.customer_id,c.partner_account_id) then raise exception 'Conversation access required'; end if;
 if c.status not in('active','reported') or c.blocked_by is not null then raise exception 'This conversation is not open for new messages'; end if;
 if p_type not in('text','image','document') then raise exception 'Unsupported message type'; end if;
 select * into cfg from chat_configuration;
 cleaned:=nullif(regexp_replace(trim(coalesce(p_body,'')),'[[:cntrl:]]+',' ','g'),'');
 if p_type='text' and cleaned is null then raise exception 'Enter a message'; end if;
 if cleaned is not null and length(cleaned)>cfg.max_text_length then raise exception 'Message is too long'; end if;
 if p_reply_to is not null and not exists(select 1 from seller_messages where id=p_reply_to and conversation_id=c.id) then raise exception 'Reply target is not in this conversation'; end if;
 if (select count(*) from seller_messages where sender_id=auth.uid() and created_at>now()-interval '1 minute')>=cfg.messages_per_minute then raise exception 'Please wait before sending more messages'; end if;
 if p_attachment is not null then
  select * into attachment from chat_attachments where id=p_attachment and conversation_id=c.id and owner_id=auth.uid() and status='ready' and message_id is null for update;
  if attachment.id is null then raise exception 'Ready attachment required'; end if;
  if p_type='image' and attachment.mime_type not like 'image/%' then raise exception 'Image attachment required'; end if;
  if p_type='document' and attachment.mime_type<>'application/pdf' then raise exception 'PDF attachment required'; end if;
 elsif p_type<>'text' then raise exception 'Attachment required'; end if;
 insert into seller_messages(conversation_id,order_id,sender_id,body,client_key,message_type,reply_to_id,attachment_id)
 values(c.id,c.partner_order_id,auth.uid(),coalesce(cleaned,case when p_type='image' then 'Image' else 'Document' end),p_key,p_type,p_reply_to,p_attachment)
 on conflict(client_key) do nothing;
 select * into result from seller_messages where client_key=p_key and conversation_id=c.id and sender_id=auth.uid();
 if result.id is null then raise exception 'Message reference mismatch'; end if;
 if attachment.id is not null then update chat_attachments set message_id=result.id where id=attachment.id and message_id is null; end if;
 update chat_conversations set last_message_at=result.created_at,updated_at=result.created_at where id=c.id;
 update chat_participant_state set archived=false,last_activity_at=result.created_at where conversation_id=c.id;
 return result;
end $$;

create or replace function public.mark_chat_read(p_conversation uuid,p_message uuid) returns void
language plpgsql security definer set search_path=public as $$
declare message_row seller_messages;
begin
 if not exists(select 1 from chat_conversations where id=p_conversation and auth.uid() in(customer_id,partner_account_id)) then raise exception 'Conversation access required'; end if;
 select * into message_row from seller_messages where id=p_message and conversation_id=p_conversation;
 if message_row.id is null then raise exception 'Displayed message required'; end if;
 update chat_participant_state set last_read_at=message_row.created_at,last_read_message_id=message_row.id,last_activity_at=now()
 where conversation_id=p_conversation and account_id=auth.uid() and (last_read_at is null or last_read_at<message_row.created_at);
end $$;

create or replace function public.get_chat_unread_total(p_role text default null) returns bigint
language sql stable security definer set search_path=public as $$
 select count(*) from seller_messages m join chat_conversations c on c.id=m.conversation_id join chat_participant_state s on s.conversation_id=c.id and s.account_id=auth.uid()
 where auth.uid() in(c.customer_id,c.partner_account_id) and m.sender_id is distinct from auth.uid() and m.created_at>coalesce(s.last_read_at,'epoch')
 and (p_role is null or (c.partner_account_id=auth.uid() and c.partner_role=p_role))
$$;

create or replace function public.update_chat_preferences(p_conversation uuid,p_archived boolean default null,p_muted boolean default null) returns chat_participant_state
language plpgsql security definer set search_path=public as $$
declare result chat_participant_state;
begin
 update chat_participant_state set archived=coalesce(p_archived,archived),muted=coalesce(p_muted,muted),last_activity_at=now()
 where conversation_id=p_conversation and account_id=auth.uid() returning * into result;
 if result.conversation_id is null then raise exception 'Conversation access required'; end if; return result;
end $$;

create or replace function public.set_chat_block(p_conversation uuid,p_blocked boolean) returns chat_conversations
language plpgsql security definer set search_path=public as $$
declare result chat_conversations; next_status text;
begin
 select * into result from chat_conversations where id=p_conversation and auth.uid() in(customer_id,partner_account_id) for update;
 if result.id is null then raise exception 'Conversation access required'; end if;
 if p_blocked then update chat_conversations set status='blocked',blocked_by=auth.uid(),updated_at=now() where id=result.id returning * into result;
 else
  if result.blocked_by<>auth.uid() then raise exception 'Only the participant who blocked this conversation can unblock it'; end if;
  next_status:=case when exists(select 1 from chat_reports where conversation_id=result.id and status in('pending','reviewing')) then 'reported' else 'active' end;
  update chat_conversations set status=next_status,blocked_by=null,updated_at=now() where id=result.id returning * into result;
 end if;
 insert into seller_messages(conversation_id,order_id,sender_id,body,client_key,message_type) values(result.id,result.partner_order_id,null,case when p_blocked then 'Conversation blocked' else 'Conversation unblocked' end,gen_random_uuid(),'system');
 update chat_conversations set last_message_at=now() where id=result.id;
 return result;
end $$;

create or replace function public.report_chat(p_conversation uuid,p_message uuid,p_reason text,p_details text default null) returns chat_reports
language plpgsql security definer set search_path=public as $$
declare c chat_conversations; result chat_reports; reported uuid;
begin
 select * into c from chat_conversations where id=p_conversation and auth.uid() in(customer_id,partner_account_id) for update;
 if c.id is null then raise exception 'Conversation access required'; end if;
 if p_message is not null and not exists(select 1 from seller_messages where id=p_message and conversation_id=c.id) then raise exception 'Reported message is not in this conversation'; end if;
 if p_reason not in('spam','harassment','unsafe_request','payment_request','privacy','other') then raise exception 'Choose a report reason'; end if;
 reported:=case when auth.uid()=c.customer_id then c.partner_account_id else c.customer_id end;
 insert into chat_reports(conversation_id,message_id,reporter_id,reported_account_id,reason,details) values(c.id,p_message,auth.uid(),reported,p_reason,nullif(trim(p_details),'')) returning * into result;
 update chat_conversations set status=case when status='blocked' then status else 'reported' end,updated_at=now() where id=c.id;
 return result;
end $$;

create or replace function public.register_chat_attachment(p_conversation uuid,p_path text,p_name text,p_mime text,p_size bigint,p_key uuid) returns chat_attachments
language plpgsql security definer set search_path=public,storage as $$
declare cfg chat_configuration; result chat_attachments; extension text;
begin
 if not exists(select 1 from chat_conversations where id=p_conversation and auth.uid() in(customer_id,partner_account_id) and status in('active','reported')) then raise exception 'Open conversation required'; end if;
 if p_path !~ ('^'||p_conversation::text||'/'||auth.uid()::text||'/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|pdf)$') then raise exception 'Invalid private attachment path'; end if;
 select * into cfg from chat_configuration; extension:=lower(substring(p_path from '\.([^.]+)$'));
 if p_mime not in('image/jpeg','image/png','image/webp','application/pdf') or extension not in('jpg','jpeg','png','webp','pdf') or (p_mime='application/pdf')<>(extension='pdf') then raise exception 'Unsupported attachment type'; end if;
 if p_size<=0 or p_size>cfg.attachment_max_bytes then raise exception 'Attachment exceeds the configured size limit'; end if;
 if not exists(select 1 from storage.objects where bucket_id='chat-attachments' and name=p_path and owner_id=auth.uid()::text) then raise exception 'Private upload was not confirmed'; end if;
 insert into chat_attachments(conversation_id,owner_id,storage_path,original_name,mime_type,size_bytes,operation_key)
 values(p_conversation,auth.uid(),p_path,left(regexp_replace(p_name,'[[:cntrl:]/\\]+','','g'),180),p_mime,p_size,p_key)
 on conflict(operation_key) do nothing;
 select * into result from chat_attachments where operation_key=p_key and owner_id=auth.uid() and conversation_id=p_conversation;
 if result.id is null then raise exception 'Attachment reference mismatch'; end if; return result;
end $$;

create or replace function public.open_reported_chat(p_report uuid,p_reason text) returns uuid
language plpgsql security definer set search_path=public as $$
declare report_row chat_reports;
begin
 if not has_staff_permission('chat.review') then raise exception 'Chat review permission required'; end if;
 if length(trim(p_reason))<10 then raise exception 'Record a clear access reason'; end if;
 select * into report_row from chat_reports where id=p_report and status in('pending','reviewing') for update;
 if report_row.id is null then raise exception 'Open report required'; end if;
 insert into chat_staff_access(conversation_id,report_id,staff_id,reason,granted_by,expires_at) values(report_row.conversation_id,report_row.id,auth.uid(),trim(p_reason),auth.uid(),now()+interval '2 hours');
 insert into chat_staff_audit(staff_id,conversation_id,report_id,action,reason) values(auth.uid(),report_row.conversation_id,report_row.id,'access_granted',trim(p_reason));
 update chat_reports set status='reviewing' where id=report_row.id;
 return report_row.conversation_id;
end $$;

create or replace function public.record_chat_staff_view(p_conversation uuid,p_reason text) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not chat_can_access(p_conversation) or not has_staff_permission('chat.review') or length(trim(p_reason))<10 then raise exception 'Active chat review access and reason required'; end if;
 insert into chat_staff_audit(staff_id,conversation_id,report_id,action,reason)
 select auth.uid(),p_conversation,x.report_id,'conversation_viewed',trim(p_reason) from chat_staff_access x where x.conversation_id=p_conversation and x.staff_id=auth.uid() and x.active and x.expires_at>now() order by x.granted_at desc limit 1;
end $$;

create or replace function public.send_seller_message(p_order uuid,p_body text,p_key uuid) returns seller_messages
language plpgsql security definer set search_path=public as $$
declare conversation_key uuid; order_customer uuid; order_partner uuid;
begin
 select o.customer_id,a.customer_id into order_customer,order_partner from partner_orders o join partner_applications a on a.id=o.partner_id where o.id=p_order;
 if order_customer is null or auth.uid() not in(order_customer,order_partner) then raise exception 'Order access required'; end if;
 conversation_key:=ensure_order_chat(p_order);
 return send_chat_message(conversation_key,p_body,'text',null,null,p_key);
end $$;

create or replace function public.emit_chat_event() returns trigger language plpgsql security definer set search_path=public as $$
declare conversation_key uuid; c chat_conversations; entity_key text; row_data jsonb;
begin
 row_data:=to_jsonb(new);
 conversation_key:=coalesce((row_data->>'conversation_id')::uuid,(row_data->>'id')::uuid);
 select * into c from chat_conversations where id=conversation_key;
 if c.id is null then return new; end if;
 entity_key:=conversation_key::text;
 perform emit_realtime_event('account',c.customer_id::text,'messages','chat_conversations',entity_key);
 perform emit_realtime_event('account',c.partner_account_id::text,'messages','chat_conversations',entity_key);
 return new;
end $$;
drop trigger if exists realtime_seller_messages on public.seller_messages;
create trigger realtime_chat_messages after insert on public.seller_messages for each row execute function public.emit_chat_event();
create trigger realtime_chat_conversations after update of status,blocked_by on public.chat_conversations for each row execute function public.emit_chat_event();

create or replace function public.emit_chat_state_event() returns trigger language plpgsql security definer set search_path=public as $$
begin
 perform emit_realtime_event('account',new.account_id::text,'messages','chat_conversations',new.conversation_id::text);
 return new;
end $$;
create trigger realtime_chat_participant_state after update on public.chat_participant_state for each row execute function public.emit_chat_state_event();

create or replace function public.emit_chat_report_event() returns trigger language plpgsql security definer set search_path=public as $$
begin perform emit_realtime_event('admin','admin','chat_reports','chat_reports',new.id::text); return new; end $$;
create trigger realtime_chat_reports after insert or update on public.chat_reports for each row execute function public.emit_chat_report_event();

create or replace function public.chat_order_system_message() returns trigger language plpgsql security definer set search_path=public as $$
declare conversation_key uuid;
begin
 if new.status is distinct from old.status then
  conversation_key:=ensure_order_chat(new.id);
  insert into seller_messages(conversation_id,order_id,sender_id,body,client_key,message_type) values(conversation_key,new.id,null,'Booking status updated: '||replace(new.status,'_',' '),gen_random_uuid(),'system');
  update chat_conversations set last_message_at=now(),updated_at=now() where id=conversation_key;
 end if; return new;
end $$;
create trigger chat_partner_order_status after update of status on public.partner_orders for each row execute function public.chat_order_system_message();

create or replace function public.chat_order_event_system_message() returns trigger language plpgsql security definer set search_path=public as $$
declare conversation_key uuid; label text;
begin
 label:=case new.kind when 'quote_created' then 'A final quote was sent' when 'quote_approved' then 'The quote was approved' when 'quote_disputed' then 'A quote correction was requested' when 'payment_confirmed' then 'Payment was confirmed by the payment system' when 'refund_requested' then 'A refund review was requested' when 'refund_confirmed' then 'The refund was confirmed' when 'arrival_verified' then 'Arrival was verified' else null end;
 if label is not null then conversation_key:=ensure_order_chat(new.order_id); insert into seller_messages(conversation_id,order_id,sender_id,body,client_key,message_type) values(conversation_key,new.order_id,null,label,gen_random_uuid(),'system'); update chat_conversations set last_message_at=now(),updated_at=now() where id=conversation_key; end if;
 return new;
end $$;
create trigger chat_seller_order_events after insert on public.seller_order_events for each row execute function public.chat_order_event_system_message();

-- A trusted scheduled job may mark unfinished uploads after the configured grace
-- period, then remove those objects through the Supabase Storage API. Browsers
-- cannot run this routine or delete registered attachments.
create or replace function public.mark_abandoned_chat_attachments() returns integer
language plpgsql security definer set search_path=public as $$
declare changed integer; wait_hours integer;
begin
 if auth.role()<>'service_role' and not has_staff_permission('chat.manage') then raise exception 'Chat maintenance permission required'; end if;
 select abandoned_attachment_hours into wait_hours from chat_configuration where id=true;
 update chat_attachments set status='abandoned'
 where message_id is null and status in('uploading','ready') and created_at<now()-make_interval(hours=>wait_hours);
 get diagnostics changed=row_count;
 return changed;
end $$;
revoke all on function public.mark_abandoned_chat_attachments() from public,anon,authenticated;
grant execute on function public.mark_abandoned_chat_attachments() to service_role;

drop policy if exists "Authorised admin realtime events" on public.realtime_events;
create policy "Authorised admin realtime events" on public.realtime_events for select using(audience_kind='admin' and audience_key='admin' and (
 public.is_admin() and scope<>'chat_reports'
 or public.has_staff_permission('realtime.read')
 or (scope in('applications','assessment','legal') and (public.has_staff_permission('partners.view') or public.has_staff_permission('partner.approve')))
 or (scope='posts' and (public.has_staff_permission('partners.view') or public.has_staff_permission('post.moderate')))
 or (scope in('payments','earnings','subscriptions') and (public.has_staff_permission('finance.view') or public.has_staff_permission('finance.manage')))
 or (scope='refunds' and (public.has_staff_permission('refund.view') or public.has_staff_permission('finance.view')))
 or (scope='payouts' and (public.has_staff_permission('payout.view') or public.has_staff_permission('payout.manage')))
 or (scope in('orders','availability') and public.has_staff_permission('orders.view'))
 or (scope='support' and public.has_staff_permission('support.manage'))
 or (scope='chat_reports' and public.has_staff_permission('chat.review'))
));

revoke all on function public.start_chat(uuid,uuid,uuid,uuid),public.list_chat_conversations(text,timestamptz,integer),public.get_chat_messages(uuid,timestamptz,integer),public.send_chat_message(uuid,text,text,uuid,uuid,uuid),public.mark_chat_read(uuid,uuid),public.get_chat_unread_total(text),public.update_chat_preferences(uuid,boolean,boolean),public.set_chat_block(uuid,boolean),public.report_chat(uuid,uuid,text,text),public.register_chat_attachment(uuid,text,text,text,bigint,uuid),public.open_reported_chat(uuid,text),public.record_chat_staff_view(uuid,text) from public,anon;
grant execute on function public.start_chat(uuid,uuid,uuid,uuid),public.list_chat_conversations(text,timestamptz,integer),public.get_chat_messages(uuid,timestamptz,integer),public.send_chat_message(uuid,text,text,uuid,uuid,uuid),public.mark_chat_read(uuid,uuid),public.get_chat_unread_total(text),public.update_chat_preferences(uuid,boolean,boolean),public.set_chat_block(uuid,boolean),public.report_chat(uuid,uuid,text,text),public.register_chat_attachment(uuid,text,text,text,bigint,uuid),public.open_reported_chat(uuid,text),public.record_chat_staff_view(uuid,text) to authenticated;
revoke all on function public.send_seller_message(uuid,text,uuid) from public,anon;
grant execute on function public.send_seller_message(uuid,text,uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('chat-attachments','chat-attachments',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy "Chat participants upload own attachments" on storage.objects for insert to authenticated with check(
 bucket_id='chat-attachments' and (storage.foldername(name))[2]=auth.uid()::text
 and exists(select 1 from chat_conversations c where c.id::text=(storage.foldername(name))[1] and auth.uid() in(c.customer_id,c.partner_account_id))
);
create policy "Chat participants read private attachments" on storage.objects for select to authenticated using(
 bucket_id='chat-attachments' and exists(select 1 from chat_conversations c where c.id::text=(storage.foldername(name))[1] and chat_can_access(c.id))
);
create policy "Owners remove unsent chat attachments" on storage.objects for delete to authenticated using(
 bucket_id='chat-attachments' and owner_id=auth.uid()::text and not exists(select 1 from chat_attachments a where a.storage_path=name and a.message_id is not null)
);

commit;
