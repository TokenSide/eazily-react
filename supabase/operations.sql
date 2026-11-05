-- Customer profile, registration consent, support, staff and finance foundations.
-- Apply after partners.sql. Monetary values use integer paise and explicit currency.
begin;
alter table public.profiles add column email text, add column email_verified boolean not null default false, add column account_status text not null default 'active' check(account_status in('active','suspended','closed'));
grant update(email) on public.profiles to authenticated;
alter table public.customer_addresses add column address_line_2 text, add column locality text, add column city text, add column pin_code text, add column landmark text, add column latitude numeric(9,6), add column longitude numeric(9,6), add column is_default boolean not null default false, add column updated_at timestamptz not null default now();
create unique index one_default_customer_address on public.customer_addresses(customer_id) where is_default;

create table public.customer_notification_preferences (
 customer_id uuid primary key references public.profiles(id) on delete cascade,
 booking_updates boolean not null default true, payment_notifications boolean not null default true,
 promotions boolean not null default false, consultation_reminders boolean not null default true,
 updated_at timestamptz not null default now()
);
create table public.customer_payments (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id), booking_id uuid references public.service_requests(id),
 provider text not null, provider_reference text unique, amount_paise bigint not null check(amount_paise>=0), currency text not null default 'INR',
 method_label text, status text not null check(status in('unpaid','pending','authorized','paid','failed','partially_refunded','fully_refunded')),
 paid_at timestamptz, created_at timestamptz not null default now(), raw_provider_state jsonb not null default '{}'
);
create table public.customer_refunds (
 id uuid primary key default gen_random_uuid(), payment_id uuid not null references public.customer_payments(id), customer_id uuid not null references public.profiles(id),
 requested_paise bigint not null check(requested_paise>0), approved_paise bigint check(approved_paise>=0), reason text not null,
 status text not null default 'requested' check(status in('requested','under_review','approved','processing','partially_completed','completed','rejected','failed')),
 idempotency_key uuid not null, provider_reference text, requested_at timestamptz not null default now(), processed_at timestamptz, unique(customer_id,idempotency_key)
);
create table public.support_tickets (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id), booking_id uuid references public.service_requests(id), payment_id uuid references public.customer_payments(id),
 category text not null, description text not null check(length(trim(description)) between 10 and 5000), screenshot_path text,
 status text not null default 'open' check(status in('open','in_progress','waiting_customer','resolved','closed')),
 priority text not null default 'normal' check(priority in('low','normal','high','urgent')), assigned_to uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.support_ticket_replies (
 id uuid primary key default gen_random_uuid(), ticket_id uuid not null references public.support_tickets(id) on delete cascade, author_id uuid not null references public.profiles(id), body text not null, created_at timestamptz not null default now()
);
create table public.app_configuration (
 id boolean primary key default true check(id), support_phone text, support_email text, support_hours text,
 public_app_link text, company_intro text, current_app_version text, updated_at timestamptz not null default now()
);
insert into public.app_configuration(id,current_app_version) values(true,'1.0.0');
create table public.legal_documents (
 id uuid primary key default gen_random_uuid(), kind text not null check(kind in('terms','privacy_policy','privacy_disclosure')),
 language text not null check(language in('English','हिन्दी')), version text not null, title text not null, content text not null,
 published boolean not null default false, effective_at timestamptz not null, unique(kind,language,version)
);
create table public.consent_events (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.profiles(id), partner_application_id uuid references public.partner_applications(id),
 consent_type text not null, version text not null, accepted boolean not null, consent_text text not null, recorded_at timestamptz not null default now()
);
create unique index consent_event_version on public.consent_events(partner_application_id,consent_type,version) where partner_application_id is not null;

create table public.staff_access (
 account_id uuid primary key references public.profiles(id), staff_role text not null check(staff_role in('super_admin','bod','finance','operations','support','hr','marketing_analyst')),
 permissions text[] not null default '{}', city_scope text[] not null default '{}', category_scope text[] not null default '{}', active boolean not null default true,
 department text, manager_id uuid references public.profiles(id), revoked_at timestamptz, updated_at timestamptz not null default now()
);
create function public.has_staff_permission(p_permission text) returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from staff_access where account_id=auth.uid() and active and revoked_at is null and (staff_role='super_admin' or p_permission=any(permissions)))
$$;
create table public.admin_audit_events (
 id uuid primary key default gen_random_uuid(), actor_id uuid not null references public.profiles(id), action text not null, entity_type text not null, entity_id text,
 reason text, before_data jsonb, after_data jsonb, occurred_at timestamptz not null default now()
);
create table public.finance_transactions (
 id uuid primary key default gen_random_uuid(), source_type text not null, source_id text not null, idempotency_key text not null unique,
 currency text not null default 'INR', event_time timestamptz not null, processing_time timestamptz not null default now(), recognition_date date,
 status text not null check(status in('draft','posted','reversed')), created_by uuid references public.profiles(id)
);
create table public.finance_entries (
 id uuid primary key default gen_random_uuid(), transaction_id uuid not null references public.finance_transactions(id), account_code text not null,
 direction text not null check(direction in('debit','credit')), amount_paise bigint not null check(amount_paise>0), category text, subcategory text, service text
);
create index finance_entries_transaction on public.finance_entries(transaction_id);
create table public.partner_payouts (
 id uuid primary key default gen_random_uuid(), partner_id uuid not null references public.partner_applications(id), order_id uuid references public.partner_orders(id),
 installment text not null, amount_paise bigint not null check(amount_paise>0), currency text not null default 'INR', due_at timestamptz,
 status text not null default 'scheduled' check(status in('scheduled','processing','paid','held','failed','uncertain','reversed')),
 idempotency_key text not null unique, provider_reference text unique, hold_reason text, created_at timestamptz not null default now(), paid_at timestamptz
);
create table public.business_expenses (
 id uuid primary key default gen_random_uuid(), expense_date date not null, category text not null, amount_paise bigint not null check(amount_paise>0), currency text not null default 'INR',
 evidence_path text, direct_cost boolean not null default false, allocation_method text, status text not null default 'draft' check(status in('draft','approved','posted','rejected')),
 created_by uuid not null references public.profiles(id), approved_by uuid references public.profiles(id), created_at timestamptz not null default now()
);
create table public.platform_ratings (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id), booking_id uuid unique references public.service_requests(id),
 score integer not null check(score between 1 and 5), review_text text, city text, category text, moderation_status text not null default 'included', moderation_reason text, created_at timestamptz not null default now()
);

alter table public.customer_notification_preferences enable row level security; alter table public.customer_payments enable row level security;
alter table public.customer_refunds enable row level security; alter table public.support_tickets enable row level security; alter table public.support_ticket_replies enable row level security;
alter table public.app_configuration enable row level security; alter table public.legal_documents enable row level security; alter table public.consent_events enable row level security;
alter table public.staff_access enable row level security; alter table public.admin_audit_events enable row level security; alter table public.finance_transactions enable row level security;
alter table public.finance_entries enable row level security; alter table public.partner_payouts enable row level security; alter table public.business_expenses enable row level security; alter table public.platform_ratings enable row level security;

create policy "Own notification preferences" on public.customer_notification_preferences for all using(customer_id=auth.uid()) with check(customer_id=auth.uid());
create policy "Own payment history" on public.customer_payments for select using(customer_id=auth.uid());
create policy "Own refunds" on public.customer_refunds for select using(customer_id=auth.uid());
create policy "Own tickets" on public.support_tickets for select using(customer_id=auth.uid());
create policy "Create own tickets" on public.support_tickets for insert with check(customer_id=auth.uid());
create policy "Own ticket replies" on public.support_ticket_replies for select using(exists(select 1 from public.support_tickets t where t.id=ticket_id and t.customer_id=auth.uid()));
create policy "Published app configuration" on public.app_configuration for select using(true);
create policy "Published legal documents" on public.legal_documents for select using(published);
create policy "Own consent history" on public.consent_events for select using(account_id=auth.uid());
create policy "Own platform ratings" on public.platform_ratings for select using(customer_id=auth.uid());
create policy "Create eligible platform rating" on public.platform_ratings for insert with check(customer_id=auth.uid() and exists(select 1 from public.service_requests r where r.id=booking_id and r.customer_id=auth.uid() and r.status='completed'));
create policy "Staff read own access" on public.staff_access for select using(account_id=auth.uid());
create policy "Authorized staff read users" on public.profiles for select using(is_admin() or has_staff_permission('users.view'));
create policy "Authorized staff read requests" on public.service_requests for select using(is_admin() or has_staff_permission('orders.view'));
create policy "Authorized staff read partner applications" on public.partner_applications for select using(is_admin() or has_staff_permission('partners.view'));
create policy "Authorized staff read partner posts" on public.partner_posts for select using(is_admin() or has_staff_permission('partners.view'));
create policy "Authorized staff read partner orders" on public.partner_orders for select using(is_admin() or has_staff_permission('orders.view'));
create policy "Authorized staff read partner earnings" on public.partner_earnings for select using(is_admin() or has_staff_permission('payout.view'));
create policy "Admins read operations" on public.customer_payments for select using(is_admin() or has_staff_permission('finance.view')); create policy "Admins read refunds" on public.customer_refunds for select using(is_admin() or has_staff_permission('refund.view'));
create policy "Admins manage tickets" on public.support_tickets for all using(is_admin() or has_staff_permission('support.manage')) with check(is_admin() or has_staff_permission('support.manage')); create policy "Admins manage staff" on public.staff_access for all using(is_admin() or has_staff_permission('staff.manage')) with check(is_admin() or has_staff_permission('staff.manage'));
create policy "Admins read audit" on public.admin_audit_events for select using(is_admin() or has_staff_permission('audit.view')); create policy "Admins manage finance transactions" on public.finance_transactions for all using(is_admin() or has_staff_permission('finance.manage')) with check(is_admin() or has_staff_permission('finance.manage'));
create policy "Admins manage finance entries" on public.finance_entries for all using(is_admin() or has_staff_permission('finance.manage')) with check(is_admin() or has_staff_permission('finance.manage')); create policy "Admins manage payouts" on public.partner_payouts for all using(is_admin() or has_staff_permission('payout.manage')) with check(is_admin() or has_staff_permission('payout.manage'));
create policy "Admins manage expenses" on public.business_expenses for all using(is_admin() or has_staff_permission('expense.manage')) with check(is_admin() or has_staff_permission('expense.manage')); create policy "Admins read ratings" on public.platform_ratings for select using(is_admin() or has_staff_permission('ratings.view'));
create policy "Admins manage configuration" on public.app_configuration for update using(is_admin()) with check(is_admin()); create policy "Admins manage legal" on public.legal_documents for all using(is_admin()) with check(is_admin());

create function public.set_default_address(p_address_id uuid) returns void language plpgsql security definer set search_path=public as $$ begin
 if not exists(select 1 from customer_addresses where id=p_address_id and customer_id=auth.uid()) then raise exception 'Address not found'; end if;
 update customer_addresses set is_default=false where customer_id=auth.uid(); update customer_addresses set is_default=true,updated_at=now() where id=p_address_id;
end $$;
create function public.request_booking_cancellation(p_booking_id uuid,p_reason text,p_idempotency_key uuid) returns service_requests language plpgsql security definer set search_path=public as $$
declare result service_requests;
begin
 if length(trim(p_reason))<3 then raise exception 'Cancellation reason is required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_booking_id::text,0));
 select * into result from service_requests where id=p_booking_id and customer_id=auth.uid() for update;
 if result.id is null then raise exception 'Booking not found'; end if; if result.status not in('pending','accepted') then raise exception 'This booking cannot be cancelled'; end if;
 update service_requests set status='cancelled',details=details||jsonb_build_object('cancellationReason',p_reason,'cancellationKey',p_idempotency_key,'cancelledAt',now()),updated_at=now() where id=p_booking_id returning * into result; return result;
end $$;
create function public.admin_dashboard_summary() returns jsonb language plpgsql security definer set search_path=public as $$ begin
 if not (is_admin() or has_staff_permission('overview.view')) then raise exception 'Admin access required'; end if;
 return jsonb_build_object('customers',(select count(*) from profiles where role='customer'),'activePartners',(select count(*) from partner_applications where status='approved'),'orders',(select count(*) from service_requests),'partnerOrders',(select count(*) from partner_orders),'paymentsCapturedPaise',(select coalesce(sum(amount_paise),0) from customer_payments where status='paid'),'refundPendingPaise',(select coalesce(sum(requested_paise),0) from customer_refunds where status in('requested','under_review','approved','processing')),'partnerPaymentsDuePaise',(select coalesce(sum(amount_paise),0) from partner_payouts where status in('scheduled','failed','uncertain')),'platformRating',(select case when count(*)=0 then null else round(avg(score),2) end from platform_ratings where moderation_status='included'),'ratingCount',(select count(*) from platform_ratings where moderation_status='included'),'updatedAt',now());
end $$;

revoke all on function has_staff_permission(text),set_default_address(uuid),request_booking_cancellation(uuid,text,uuid),admin_dashboard_summary() from public,anon;
grant execute on function has_staff_permission(text) to authenticated;
grant execute on function set_default_address(uuid),request_booking_cancellation(uuid,text,uuid) to authenticated; grant execute on function admin_dashboard_summary() to authenticated;
grant select,insert,update,delete on customer_notification_preferences,customer_addresses,support_tickets to authenticated;
grant select on customer_payments,customer_refunds,support_ticket_replies,app_configuration,legal_documents,consent_events,platform_ratings to authenticated,anon;
grant insert on platform_ratings to authenticated;
grant select,insert,update,delete on staff_access,finance_transactions,finance_entries,partner_payouts,business_expenses to authenticated;
grant select on admin_audit_events to authenticated;
commit;
