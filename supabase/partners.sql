-- Unified-account partner workspaces. Apply after experience.sql and wallet.sql.
begin;
create table public.partner_applications (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id) on delete cascade,
 role text not null check(role in('professional','influencer','consultant')),
 status text not null default 'draft' check(status in('draft','submitted','under_review','approved','changes_required','rejected')),
 details jsonb not null default '{}', review_notes text, submitted_at timestamptz, reviewed_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(customer_id,role)
);
create table public.partner_posts (
 id uuid primary key default gen_random_uuid(), partner_id uuid not null references public.partner_applications(id) on delete cascade,
 role text not null check(role in('professional','influencer','consultant')),
 status text not null default 'draft' check(status in('draft','pending_review','published','changes_required','rejected','paused')),
 details jsonb not null default '{}', review_notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.partner_availability (
 partner_id uuid primary key references public.partner_applications(id) on delete cascade,
 online boolean not null default false, confirmed_at timestamptz, available_until timestamptz, updated_at timestamptz not null default now()
);
create table public.partner_orders (
 id uuid primary key default gen_random_uuid(), partner_id uuid not null references public.partner_applications(id), customer_id uuid not null references public.profiles(id),
 role text not null check(role in('professional','influencer','consultant')), title text not null,
 status text not null default 'requested' check(status in('requested','accepted','active','awaiting_acceptance','completed','cancelled','disputed')),
 details jsonb not null default '{}', deadline timestamptz, free_intro boolean not null default false,
 created_at timestamptz not null default now()
);
create unique index one_free_intro_pair on public.partner_orders(customer_id,partner_id) where role='consultant' and free_intro;
create table public.partner_earnings (
 id uuid primary key default gen_random_uuid(), partner_id uuid not null references public.partner_applications(id), order_id uuid references public.partner_orders(id),
 role text not null, state text not null check(state in('available','pending','security_hold','paid','reversed')),
 amount numeric(12,2) not null check(amount>=0), provider_reference text, created_at timestamptz not null default now(), unique(order_id,state)
);
create table public.consultant_rates (
 id uuid primary key default gen_random_uuid(), partner_id uuid references public.partner_applications(id), category text not null,
 duration integer not null check(duration>=10), price numeric(12,2) not null check(price>0), active boolean not null default true,
 unique nulls not distinct(partner_id,category,duration)
);
create table public.partner_config (
 id boolean primary key default true check(id), influencer_threshold integer not null default 5000 check(influencer_threshold>=5000),
 influencer_platform_fee_percent numeric(5,2) not null default 10 check(influencer_platform_fee_percent between 0 and 100),
 influencer_initial_release_percent numeric(5,2) not null default 70 check(influencer_initial_release_percent between 0 and 100),
 influencer_review_window_hours integer not null default 72 check(influencer_review_window_hours>0),
 availability_minutes integer not null default 30 check(availability_minutes between 5 and 1440),
 free_intro_minutes integer not null default 5 check(free_intro_minutes between 1 and 15),
 cashfree_enabled boolean not null default false
);
insert into public.partner_config(id) values(true);
create table public.partner_audit_log (
 id bigint generated always as identity primary key, actor_id uuid references public.profiles(id), action text not null,
 entity_type text not null, entity_id text not null, before_data jsonb, after_data jsonb, created_at timestamptz not null default now()
);
create table public.cashfree_collaborations (
 order_id uuid primary key references public.partner_orders(id), cashfree_order_id text unique,
 payment_status text not null default 'not_started' check(payment_status in('not_started','pending','paid','refunded','failed')),
 customer_total numeric(12,2) not null check(customer_total>0), partner_payout numeric(12,2) not null check(partner_payout>=0),
 platform_fee numeric(12,2) not null check(platform_fee>=0), initial_release numeric(12,2) not null check(initial_release>=0),
 security_hold numeric(12,2) not null check(security_hold>=0), scope_confirmed_at timestamptz,
 cashfree_vendor_id text, initial_split_reference text, hold_release_reference text, raw_provider_state jsonb not null default '{}'
);
create table public.saved_partner_profiles (
 customer_id uuid not null references public.profiles(id) on delete cascade,
 post_id uuid not null references public.partner_posts(id) on delete cascade,
 primary key(customer_id,post_id)
);
alter table public.saved_partner_profiles enable row level security;
create policy "Own saved partner profiles" on public.saved_partner_profiles for all using(customer_id=auth.uid()) with check(customer_id=auth.uid());
create view public.partner_directory as
select p.id, p.partner_id, p.role as partner_role, p.details, a.details as profile_details,
 coalesce(a.details->>'creatorName',a.details->>'name') as display_name,
 coalesce(a.details->>'creatorName',a.details->>'name') as business_name,
 case when a.status='approved' then 'verified' else 'pending' end as verification_status,
 case when coalesce(a.details->>'experience','') ~ '^[0-9]+$' then (a.details->>'experience')::integer else 0 end as experience_years,
 array[coalesce(p.details->>'category',p.details->>'service',p.details->>'specialisation')] as service_names,
 coalesce(p.details->>'category','') as category_id,
 string_to_array(coalesce(a.details->>'languages',p.details->>'languages',''),',') as languages,
 array[coalesce(a.details->>'city',p.details->>'area',p.details->>'offlineLocation')] as coverage,
 p.details->'media' as portfolio,
 case when p.role='professional' then jsonb_build_object(p.details->>'service',p.details->>'serviceCharge') else '{}'::jsonb end as prices,
 coalesce(p.details->>'availability','By appointment') as availability,
 case when p.role='professional' then coalesce(av.online and av.available_until>now(),false) else false end as available_now, coalesce(a.details->>'city','') as city,
 0::numeric as rating, 0::bigint as review_count,
 case when p.role='influencer' then (p.details->>'packagePrice')::numeric else null end as starting_price,
 case when p.role='consultant' then p.details->>'specialisation' else p.details->>'category' end as specialisation,
 coalesce(p.details->>'description',a.details->>'bio') as description
from partner_posts p join partner_applications a on a.id=p.partner_id left join partner_availability av on av.partner_id=a.id
where p.status='published' and a.status='approved';
create view public.saved_partner_directory with (security_invoker=true) as
select d.* from public.partner_directory d join public.saved_partner_profiles s on s.post_id=d.id where s.customer_id=auth.uid();

create function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from profiles where id=auth.uid() and role='admin')$$;

alter table public.partner_applications enable row level security;
alter table public.partner_posts enable row level security;
alter table public.partner_availability enable row level security;
alter table public.partner_orders enable row level security;
alter table public.partner_earnings enable row level security;
alter table public.consultant_rates enable row level security;
alter table public.partner_config enable row level security;
alter table public.partner_audit_log enable row level security;
alter table public.cashfree_collaborations enable row level security;
create policy "Own applications" on public.partner_applications for select using(customer_id=auth.uid());
create policy "Own posts" on public.partner_posts for select using(exists(select 1 from partner_applications a where a.id=partner_id and a.customer_id=auth.uid()));
create policy "Published posts readable" on public.partner_posts for select using(status='published');
create policy "Own availability" on public.partner_availability for select using(exists(select 1 from partner_applications a where a.id=partner_id and a.customer_id=auth.uid()));
create policy "Own partner orders" on public.partner_orders for select using(customer_id=auth.uid() or exists(select 1 from partner_applications a where a.id=partner_id and a.customer_id=auth.uid()));
create policy "Own partner earnings" on public.partner_earnings for select using(exists(select 1 from partner_applications a where a.id=partner_id and a.customer_id=auth.uid()));
create policy "Active consultant rates readable" on public.consultant_rates for select using(active);
create policy "Partner configuration readable" on public.partner_config for select using(true);
create policy "Own collaboration payment state" on public.cashfree_collaborations for select using(exists(select 1 from partner_orders o join partner_applications a on a.id=o.partner_id where o.id=order_id and (o.customer_id=auth.uid() or a.customer_id=auth.uid())));
create policy "Admins manage applications" on public.partner_applications for all using(is_admin()) with check(is_admin());
create policy "Admins manage posts" on public.partner_posts for all using(is_admin()) with check(is_admin());
create policy "Admins manage consultant rates" on public.consultant_rates for all using(is_admin()) with check(is_admin());
create policy "Admins manage partner config" on public.partner_config for update using(is_admin()) with check(is_admin());
create policy "Admins read audit log" on public.partner_audit_log for select using(is_admin());

create function public.save_partner_application(p_role text,p_details jsonb,p_submit boolean default false) returns partner_applications language plpgsql security definer set search_path=public as $$
declare result partner_applications; next_status text;
begin
 if auth.uid() is null then raise exception 'Sign in to apply'; end if;
 if p_role not in('professional','influencer','consultant') then raise exception 'Invalid role'; end if;
 if p_submit and (coalesce(length(trim(p_details->>'name')),0)<2 or coalesce(p_details->>'city','')='' or coalesce(p_details->>'pinCode','')='' or coalesce(p_details->>'language','')='') then raise exception 'Complete the required shared details'; end if;
 if p_submit and (coalesce((p_details#>>'{consent,termsAccepted}')::boolean,false)=false or coalesce((p_details#>>'{consent,informationAccurate}')::boolean,false)=false or coalesce(p_details#>>'{consent,version}','')='' or coalesce(p_details#>>'{consent,acceptedAt}','')='') then raise exception 'Terms and information-accuracy consent are required'; end if;
 if p_submit and p_role='professional' and (jsonb_array_length(coalesce(p_details->'services','[]'))=0 or coalesce(p_details->>'shopOwnership','')='' or coalesce(p_details->>'experience','')='' or coalesce(p_details->>'workStyle','')='' or coalesce(p_details->>'accountHolder','')='' or coalesce(p_details->>'accountNumber','')='' or p_details->>'accountNumber'<>p_details->>'accountConfirmation' or coalesce(p_details->>'ifsc','')='' or jsonb_array_length(coalesce(p_details->'aadhaar','[]'))=0 or jsonb_array_length(coalesce(p_details->'pan','[]'))=0 or (p_details->>'shopOwnership'<>'No fixed shop' and jsonb_array_length(coalesce(p_details->'gumasta','[]'))=0 and coalesce((p_details->>'gumastaHelp')::boolean,false)=false)) then raise exception 'Complete required service-partner registration items'; end if;
 if p_submit and p_role='influencer' and (coalesce(p_details->>'creatorName','')='' or coalesce(p_details->>'email','')='' or jsonb_array_length(coalesce(p_details->'platforms','[]'))=0 or jsonb_array_length(coalesce(p_details->'insightScreenshots','[]'))=0 or jsonb_array_length(coalesce(p_details->'aadhaar','[]'))=0 or p_details->>'accountNumber'<>p_details->>'accountConfirmation') then raise exception 'Complete required creator registration items'; end if;
 if p_submit and p_role='consultant' and (coalesce(p_details->>'specialisation','')='' or coalesce(p_details->>'qualificationName','')='' or jsonb_array_length(coalesce(p_details->'qualifications','[]'))=0 or jsonb_array_length(coalesce(p_details->'aadhaar','[]'))=0 or jsonb_array_length(coalesce(p_details->'pan','[]'))=0 or jsonb_array_length(coalesce(p_details->'interviewAnswers','[]'))<5 or p_details->>'accountNumber'<>p_details->>'accountConfirmation') then raise exception 'Complete required consultant registration items'; end if;
 next_status:=case when p_submit then 'submitted' else 'draft' end;
 insert into partner_applications(customer_id,role,status,details,submitted_at) values(auth.uid(),p_role,next_status,p_details,case when p_submit then now() end)
 on conflict(customer_id,role) do update set details=excluded.details,status=case when partner_applications.status in('approved','under_review') then partner_applications.status else excluded.status end,
 submitted_at=case when excluded.status='submitted' then now() else partner_applications.submitted_at end,updated_at=now()
 returning * into result;
 if p_submit then
  insert into consent_events(account_id,partner_application_id,consent_type,version,accepted,consent_text,recorded_at)
  values(auth.uid(),result.id,'partner_registration',p_details#>>'{consent,version}',true,'Role terms accepted and supplied information confirmed accurate',(p_details#>>'{consent,acceptedAt}')::timestamptz)
  on conflict(partner_application_id,consent_type,version) where partner_application_id is not null do nothing;
 end if;
 return result;
end $$;
create function public.save_partner_post(p_role text,p_details jsonb,p_action text,p_post_id uuid default null) returns partner_posts language plpgsql security definer set search_path=public as $$
declare app partner_applications; result partner_posts; next_status text; cfg partner_config; assigned consultant_rates;
begin
 select * into app from partner_applications where customer_id=auth.uid() and role=p_role;
 if app.id is null then raise exception 'Complete role onboarding first'; end if;
 if p_action='submit' and app.status<>'approved' then raise exception 'Role approval is required to submit posts'; end if;
 if p_action='submit' and p_role='professional' and (coalesce(p_details->>'category','')='' or coalesce(p_details->>'service','')='' or coalesce(p_details->>'title','')='' or coalesce(p_details->>'description','')='' or coalesce(p_details->>'pricingType','') not in('Fixed Price','Starting Price','Inspection-Based Quote') or coalesce((p_details->>'serviceCharge')::numeric,-1)<0 or coalesce((p_details->>'visitingCharge')::numeric,-1)<0) then raise exception 'Complete all required service pricing fields'; end if;
 select * into cfg from partner_config;
 if p_action='submit' and p_role='influencer' then
  if coalesce((select max((x->>'count')::bigint) from jsonb_array_elements(coalesce(p_details->'platforms','[]')) x),0)<cfg.influencer_threshold then raise exception 'At least one platform must meet the influencer threshold'; end if;
  if coalesce((p_details->>'packagePrice')::numeric,0)<=0 or coalesce(p_details->>'deliverables','')='' or coalesce(p_details->>'usageRights','')='' then raise exception 'Paid package, deliverables and usage rights are required'; end if;
 end if;
 if p_action='submit' and p_role='consultant' then
  select * into assigned from consultant_rates where active and category=p_details->>'category' and duration=(p_details->>'duration')::integer and (partner_id=app.id or partner_id is null) order by partner_id nulls last limit 1;
  if assigned.id is null then raise exception 'Eazily must assign a rate before submission'; end if;
  p_details:=(p_details-'price'-'packagePrice')||jsonb_build_object('assignedRateId',assigned.id,'assignedPrice',assigned.price);
 end if;
 next_status:=case p_action when 'submit' then 'pending_review' when 'pause' then 'paused' else 'draft' end;
 if p_post_id is null then insert into partner_posts(partner_id,role,status,details) values(app.id,p_role,next_status,p_details) returning * into result;
 else update partner_posts set details=p_details,status=next_status,updated_at=now() where id=p_post_id and partner_id=app.id and role=p_role returning * into result;
 end if;
 if result.id is null then raise exception 'Post not found in this workspace'; end if; return result;
end $$;
create function public.set_partner_availability(p_online boolean) returns partner_availability language plpgsql security definer set search_path=public as $$
declare app partner_applications; cfg partner_config; result partner_availability;
begin
 select * into app from partner_applications where customer_id=auth.uid() and role='professional' and status='approved';
 if app.id is null then raise exception 'Approved Service Professional role required'; end if;
 select * into cfg from partner_config;
 insert into partner_availability(partner_id,online,confirmed_at,available_until) values(app.id,p_online,case when p_online then now() end,case when p_online then now()+make_interval(mins=>cfg.availability_minutes) end)
 on conflict(partner_id) do update set online=excluded.online,confirmed_at=excluded.confirmed_at,available_until=excluded.available_until,updated_at=now() returning * into result; return result;
end $$;
create function public.admin_review_partner(p_id uuid,p_status text,p_notes text default null) returns partner_applications language plpgsql security definer set search_path=public as $$
declare old partner_applications; result partner_applications;
begin
 if not (is_admin() or has_staff_permission('partner.approve')) then raise exception 'Admin access required'; end if;
 if p_status not in('under_review','approved','changes_required','rejected') then raise exception 'Invalid review status'; end if;
 select * into old from partner_applications where id=p_id for update;
 if p_status='approved' and old.role='influencer' and coalesce((select max((x->>'count')::bigint) from jsonb_array_elements(coalesce(old.details->'platforms','[]')) x),0)<(select influencer_threshold from partner_config) then raise exception 'Influencer requires 5,000 or configured threshold on one platform'; end if;
 update partner_applications set status=p_status,review_notes=p_notes,reviewed_at=now(),updated_at=now() where id=p_id returning * into result;
 if p_status='approved' and result.role='professional' then insert into partner_availability(partner_id,online) values(result.id,false) on conflict do nothing; end if;
 insert into partner_audit_log(actor_id,action,entity_type,entity_id,before_data,after_data) values(auth.uid(),'review_partner','partner_application',p_id::text,to_jsonb(old),to_jsonb(result)); return result;
end $$;
create function public.admin_review_post(p_id uuid,p_status text,p_notes text default null) returns partner_posts language plpgsql security definer set search_path=public as $$
declare old partner_posts; result partner_posts;
begin
 if not (is_admin() or has_staff_permission('post.moderate')) then raise exception 'Admin access required'; end if;
 if p_status not in('published','changes_required','rejected','paused') then raise exception 'Invalid post status'; end if;
 select * into old from partner_posts where id=p_id for update;
 update partner_posts set status=p_status,review_notes=p_notes,updated_at=now() where id=p_id returning * into result;
 insert into partner_audit_log(actor_id,action,entity_type,entity_id,before_data,after_data) values(auth.uid(),'review_post','partner_post',p_id::text,to_jsonb(old),to_jsonb(result)); return result;
end $$;
create function public.book_free_introduction(p_post_id uuid,p_slot timestamptz) returns partner_orders language plpgsql security definer set search_path=public as $$
declare post partner_posts; result partner_orders;
begin
 if auth.uid() is null then raise exception 'Sign in to reserve an introduction'; end if;
 if p_slot <= now() then raise exception 'Choose a future introduction time'; end if;
 select p.* into post from partner_posts p join partner_applications a on a.id=p.partner_id where p.id=p_post_id and p.role='consultant' and p.status='published' and a.status='approved';
 if post.id is null then raise exception 'Published consultant offering required'; end if;
 insert into partner_orders(partner_id,customer_id,role,title,status,details,deadline,free_intro)
 values(post.partner_id,auth.uid(),'consultant','Five-minute free introduction','requested',jsonb_build_object('postId',post.id,'mode',post.details->>'mode','durationMinutes',5),p_slot,true)
 returning * into result;
 return result;
exception when unique_violation then raise exception 'The free introduction has already been used or reserved for this consultant';
end $$;
-- Cashfree order creation, webhook signature verification and Easy Split calls belong in server functions.
-- Browser clients receive a payment session only after cashfree_enabled and credentials are configured.
revoke all on partner_audit_log,cashfree_collaborations from anon,authenticated;
revoke all on function is_admin(),save_partner_application(text,jsonb,boolean),save_partner_post(text,jsonb,text,uuid),set_partner_availability(boolean),admin_review_partner(uuid,text,text),admin_review_post(uuid,text,text),book_free_introduction(uuid,timestamptz) from public,anon;
grant execute on function save_partner_application(text,jsonb,boolean),save_partner_post(text,jsonb,text,uuid),set_partner_availability(boolean) to authenticated;
grant execute on function book_free_introduction(uuid,timestamptz) to authenticated;
grant execute on function admin_review_partner(uuid,text,text),admin_review_post(uuid,text,text) to authenticated;
grant select on partner_applications,partner_posts,partner_availability,partner_orders,partner_earnings,consultant_rates,partner_config,cashfree_collaborations to authenticated;
grant select on partner_posts,consultant_rates,partner_config to anon;
grant select on partner_directory to anon,authenticated;
grant select on saved_partner_directory to authenticated;
grant select,insert,delete on saved_partner_profiles to authenticated;
grant insert,update,delete on consultant_rates to authenticated;
grant update on partner_config to authenticated;
commit;
