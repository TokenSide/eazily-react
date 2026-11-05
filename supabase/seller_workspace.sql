begin;
alter table partner_orders add column post_id uuid references partner_posts(id), add column request_key uuid unique;
create table public.seller_leads (
 id uuid primary key default gen_random_uuid(), partner_id uuid not null references partner_applications(id),
 order_id uuid unique references partner_orders(id), status text not null default 'new' check(status in('new','active','follow_up','won','lost')),
 notes text not null default '', follow_up_at timestamptz, close_reason text, updated_at timestamptz not null default now()
);
create table public.seller_messages (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references partner_orders(id), sender_id uuid not null references profiles(id),
 body text not null check(length(body) between 1 and 4000), client_key uuid not null unique, read_at timestamptz, created_at timestamptz not null default now()
);
create table public.seller_notifications (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references profiles(id), role text not null,
 order_id uuid references partner_orders(id), title text not null, read_at timestamptz, created_at timestamptz not null default now()
);
create table public.seller_training (
 id text primary key, title text not null, content text not null, content_hi text not null, enabled boolean not null default true
);
insert into seller_training values
 ('conduct','Professional conduct','Arrive sober, avoid tobacco, wear clean workwear, speak politely and update the customer if delayed.','नशे और तंबाकू से दूर रहें, साफ कपड़े पहनें, विनम्र रहें और देरी की जानकारी दें।',true),
 ('quotes','Clear quotes and official payments','Agree on extra work before starting it. Use official Eazily payments. Never ask for a bank PIN or payment OTP.','अतिरिक्त काम से पहले मूल्य की सहमति लें। आधिकारिक Eazily भुगतान इस्तेमाल करें। बैंक पिन या भुगतान OTP न माँगें।',true),
 ('privacy','Privacy and safe work','Protect customer property and privacy. Ask before taking photos. Work safely and clean the area afterwards.','ग्राहक की संपत्ति और गोपनीयता का ध्यान रखें। फोटो से पहले अनुमति लें। सुरक्षित काम करें और सफाई करें।',true);
create table public.seller_training_progress (partner_id uuid references partner_applications(id), module_id text references seller_training(id), completed_at timestamptz not null default now(), primary key(partner_id,module_id));
create table public.seller_reviews (id uuid primary key default gen_random_uuid(), order_id uuid unique not null references partner_orders(id), partner_id uuid not null references partner_applications(id), customer_id uuid not null references profiles(id), rating integer not null check(rating between 1 and 5), body text not null, reply text, published boolean not null default false, created_at timestamptz not null default now());
alter table seller_leads enable row level security; alter table seller_messages enable row level security; alter table seller_notifications enable row level security; alter table seller_training enable row level security; alter table seller_training_progress enable row level security; alter table seller_reviews enable row level security;
create policy "Seller lead owner" on seller_leads for all using(exists(select 1 from partner_applications where id=partner_id and customer_id=auth.uid())) with check(exists(select 1 from partner_applications where id=partner_id and customer_id=auth.uid()));
create policy "Participants read messages" on seller_messages for select using(exists(select 1 from partner_orders o join partner_applications a on a.id=o.partner_id where o.id=order_id and (o.customer_id=auth.uid() or a.customer_id=auth.uid())));
create policy "Own seller notifications" on seller_notifications for select using(account_id=auth.uid());
create policy "Read training" on seller_training for select using(enabled);
create policy "Own training progress" on seller_training_progress for all using(exists(select 1 from partner_applications where id=partner_id and customer_id=auth.uid())) with check(exists(select 1 from partner_applications where id=partner_id and customer_id=auth.uid()));
create policy "Read seller reviews" on seller_reviews for select using(published or customer_id=auth.uid() or exists(select 1 from partner_applications where id=partner_id and customer_id=auth.uid()) or is_admin());
revoke all on seller_leads,seller_messages,seller_notifications,seller_training_progress,seller_reviews from anon,authenticated;
grant select on seller_leads,seller_messages,seller_notifications,seller_training_progress,seller_reviews,seller_training to authenticated;
grant update(status,notes,follow_up_at,close_reason,updated_at) on seller_leads to authenticated;
grant insert on seller_training_progress to authenticated;

create function public.send_seller_message(p_order uuid,p_body text,p_key uuid) returns seller_messages language plpgsql security definer set search_path=public as $$
declare result seller_messages; o partner_orders; owner_id uuid;
begin
 select * into o from partner_orders where id=p_order; select customer_id into owner_id from partner_applications where id=o.partner_id;
 if auth.uid() is null or auth.uid() not in(o.customer_id,owner_id) then raise exception 'Conversation access required'; end if;
 insert into seller_messages(order_id,sender_id,body,client_key) values(p_order,auth.uid(),trim(p_body),p_key) on conflict(client_key) do nothing;
 select * into result from seller_messages where client_key=p_key and order_id=p_order and sender_id=auth.uid();
 if result.id is null then raise exception 'Message reference mismatch'; end if;
 return result;
end $$;
create function public.mark_seller_notifications_read(p_id uuid) returns void language sql security definer set search_path=public as $$update seller_notifications set read_at=now() where id=p_id and account_id=auth.uid()$$;
create function public.change_seller_order(p_order uuid,p_action text,p_reason text default '') returns partner_orders language plpgsql security definer set search_path=public,eazily_private as $$
declare o partner_orders; a partner_applications; next_status text;
begin
 select * into o from partner_orders where id=p_order for update; select * into a from partner_applications where id=o.partner_id;
 if auth.uid() is null or auth.uid() not in(o.customer_id,a.customer_id) then raise exception 'Order access required'; end if;
 if p_action='complete' then
  if auth.uid()<>o.customer_id or o.status<>'awaiting_acceptance' then raise exception 'Customer confirmation required'; end if;
  next_status:='completed';
 elsif p_action='correct_quote' then
  if auth.uid()<>a.customer_id or o.status<>'disputed' then raise exception 'Assigned seller and disputed quote required'; end if; next_status:='awaiting_acceptance';
 elsif p_action in('accept','reject') then
  if auth.uid()<>a.customer_id or a.status<>'approved' then raise exception 'Assigned approved seller required'; end if;
  next_status:=case when p_action='accept' then 'accepted' else 'cancelled' end;
  if o.status=next_status then return o; end if;
  if o.status<>'requested' then raise exception 'This enquiry has already been handled'; end if;
  if p_action='reject' and length(trim(p_reason))<3 then raise exception 'Give a rejection reason'; end if;
  if p_action='accept' then
   perform 1 from partner_applications where id=a.id for update;
   if o.deadline is not null and exists(select 1 from partner_orders where partner_id=a.id and id<>p_order and status in('accepted','active') and abs(extract(epoch from deadline-o.deadline))<3600) then raise exception 'This time overlaps an accepted appointment'; end if;
  end if;
 else raise exception 'Unsupported order action'; end if;
 update partner_orders set status=next_status where id=p_order returning * into o;
 update seller_leads set status=case when next_status='cancelled' then 'lost' when next_status='completed' then 'won' else 'active' end,close_reason=nullif(p_reason,''),updated_at=now() where order_id=p_order;
 insert into seller_order_events(order_id,actor_id,kind,notes) values(p_order,auth.uid(),p_action,p_reason);
 insert into seller_notifications(account_id,role,order_id,title) values(case when auth.uid()=o.customer_id then a.customer_id else o.customer_id end,o.role,p_order,'Booking updated');
 return o;
end $$;
create function public.book_partner_offering(p_post uuid,p_slot timestamptz,p_key uuid) returns partner_orders language plpgsql security definer set search_path=public,eazily_private as $$
declare p partner_posts; a partner_applications; result partner_orders;
begin
 if auth.uid() is null then raise exception 'Sign in to book'; end if;
 select * into p from partner_posts where id=p_post and status='published'; select * into a from partner_applications where id=p.partner_id and status='approved';
 if a.id is null or a.customer_id=auth.uid() or coalesce(p.details->>'postType','offering')<>'offering' then raise exception 'Choose an eligible published offering'; end if;
 if not seller_can_receive_booking(a.id) then raise exception 'This seller is not accepting new bookings'; end if;
 if p_slot is null or p_slot<=now() then raise exception 'Choose a future appointment'; end if;
 insert into partner_orders(partner_id,customer_id,role,title,status,details,deadline,post_id,request_key)
 values(a.id,auth.uid(),a.role,p.details->>'title','requested',eazily_private.pick(p.details,array['title','service','category','description','caption','mode','duration','deliverables','deliverableCount','packagePrice','timeline','revisions','usageRights','advertisingPermissions','packageSnapshot']),p_slot,p.id,p_key) on conflict(request_key) do nothing;
 select * into result from partner_orders where request_key=p_key and customer_id=auth.uid() and post_id=p_post;
 if result.id is null then raise exception 'Booking reference mismatch'; end if;
 insert into seller_leads(partner_id,order_id) values(a.id,result.id) on conflict(order_id) do nothing;
 return result;
end $$;
create function public.reply_seller_review(p_review uuid,p_reply text) returns void language sql security definer set search_path=public as $$update seller_reviews set reply=left(p_reply,2000) where id=p_review and exists(select 1 from partner_applications where id=partner_id and customer_id=auth.uid())$$;
create function public.review_seller_order(p_order uuid,p_rating integer,p_body text) returns void language plpgsql security definer set search_path=public as $$
declare o partner_orders;
begin
 select * into o from partner_orders where id=p_order and customer_id=auth.uid() and status='completed';
 if o.id is null then raise exception 'Completed customer booking required'; end if;
 insert into seller_reviews(order_id,partner_id,customer_id,rating,body) values(o.id,o.partner_id,auth.uid(),p_rating,left(p_body,4000)) on conflict(order_id) do nothing;
end $$;
revoke all on function send_seller_message(uuid,text,uuid),mark_seller_notifications_read(uuid),change_seller_order(uuid,text,text),book_partner_offering(uuid,timestamptz,uuid),reply_seller_review(uuid,text),review_seller_order(uuid,integer,text) from public,anon;
grant execute on function send_seller_message(uuid,text,uuid),mark_seller_notifications_read(uuid),change_seller_order(uuid,text,text),book_partner_offering(uuid,timestamptz,uuid),reply_seller_review(uuid,text),review_seller_order(uuid,integer,text) to authenticated;
commit;
