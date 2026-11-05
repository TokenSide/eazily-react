-- Durable background automation. Apply once, after chat_messaging.sql.
-- Execution is disabled by default. No provider or financial adapter is enabled here.
begin;

create table public.automation_configuration (
 id boolean primary key default true check(id), enabled boolean not null default false,
 batch_size integer not null default 25 check(batch_size between 1 and 100),
 lease_seconds integer not null default 120 check(lease_seconds between 30 and 900),
 retry_base_seconds integer not null default 60 check(retry_base_seconds between 5 and 3600),
 retry_max_seconds integer not null default 21600 check(retry_max_seconds between 60 and 86400),
 default_max_attempts integer not null default 6 check(default_max_attempts between 1 and 20),
 request_response_minutes integer not null default 30 check(request_response_minutes between 5 and 10080),
 payment_reconciliation_minutes integer not null default 15 check(payment_reconciliation_minutes between 5 and 1440),
 operational_escalation_hours integer not null default 24 check(operational_escalation_hours between 1 and 720),
 scheduler_expected_seconds integer not null default 180 check(scheduler_expected_seconds between 60 and 3600),
 realtime_retention_days integer not null default 7 check(realtime_retention_days between 1 and 90),
 booking_reminder_minutes integer[] not null default array[1440,120],
 consultation_reminder_minutes integer[] not null default array[1440,60],
 influencer_reminder_minutes integer[] not null default array[4320,1440],
 trial_reminder_days integer[] not null default array[7,1],
 subscription_reminder_days integer[] not null default array[7,1],
 notification_delivery_enabled boolean not null default false,
 workbook_loan_enabled boolean not null default false,
 workbook_logistics_enabled boolean not null default false,
 payment_reconciliation_enabled boolean not null default false,
 refund_submission_enabled boolean not null default false,
 payout_submission_enabled boolean not null default false,
 realtime_cleanup_enabled boolean not null default true,
 updated_at timestamptz not null default clock_timestamp()
);
insert into public.automation_configuration(id) values(true);

create table public.background_jobs (
 id uuid primary key default gen_random_uuid(), job_type text not null,
 related_entity_type text not null, related_entity_id text not null,
 payload jsonb not null default '{}'::jsonb,
 scheduled_at timestamptz not null, status text not null default 'pending'
  check(status in('pending','running','retry_scheduled','succeeded','cancelled','dead_letter')),
 attempt_count integer not null default 0 check(attempt_count>=0), max_attempts integer not null check(max_attempts between 1 and 20),
 next_retry_at timestamptz, lock_owner text, lock_expires_at timestamptz,
 deduplication_key text not null unique, entity_version bigint,
 last_error_code text, last_error_message text,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 started_at timestamptz, completed_at timestamptz, cancelled_at timestamptz, dead_lettered_at timestamptz,
 check(octet_length(payload::text)<=4096)
);
create index background_jobs_due on public.background_jobs(status,coalesce(next_retry_at,scheduled_at),scheduled_at);
create index background_jobs_lock on public.background_jobs(lock_expires_at) where status='running';
create index background_jobs_entity on public.background_jobs(related_entity_type,related_entity_id,created_at desc);
create index background_jobs_type_status on public.background_jobs(job_type,status,created_at desc);

create table public.automation_job_audit (
 id bigint generated always as identity primary key, job_id uuid references public.background_jobs(id),
 event_type text not null, worker_id text, safe_code text, safe_message text,
 actor_id uuid references public.profiles(id), occurred_at timestamptz not null default clock_timestamp()
);
create index automation_job_audit_job on public.automation_job_audit(job_id,occurred_at);

create table public.automation_worker_runs (
 id uuid primary key default gen_random_uuid(), worker_id text not null, started_at timestamptz not null default clock_timestamp(),
 finished_at timestamptz, claimed_count integer not null default 0, succeeded_count integer not null default 0,
 retry_count integer not null default 0, dead_letter_count integer not null default 0, status text not null default 'running'
  check(status in('running','succeeded','partial','failed')), safe_error text
);

create table public.notification_outbox (
 id uuid primary key default gen_random_uuid(), recipient_account_id uuid not null references public.profiles(id),
 notification_type text not null, related_entity_type text not null, related_entity_id text not null,
 template_key text not null, language text not null default 'English', scheduled_at timestamptz not null default clock_timestamp(),
 deduplication_key text not null unique, channels text[] not null default array['in_app'],
 delivery_state text not null default 'requested' check(delivery_state in('requested','queued','submitted','delivered','failed','cancelled')),
 attempt_count integer not null default 0, last_error_code text, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create index notification_outbox_queue on public.notification_outbox(delivery_state,scheduled_at);

create table public.operational_review_tasks (
 id uuid primary key default gen_random_uuid(), task_type text not null, related_entity_type text not null,
 related_entity_id text not null, required_permission text not null, status text not null default 'pending'
  check(status in('pending','in_review','resolved','cancelled')),
 deduplication_key text not null unique, due_at timestamptz, escalation_at timestamptz, escalated_at timestamptz,
 assigned_to uuid references public.profiles(id), resolution_note text,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create index operational_review_queue on public.operational_review_tasks(status,task_type,due_at);
create index operational_review_escalation on public.operational_review_tasks(status,escalation_at) where escalated_at is null;

create table public.review_invitations (
 id uuid primary key default gen_random_uuid(), customer_id uuid not null references public.profiles(id),
 partner_order_id uuid unique references public.partner_orders(id), service_request_id uuid unique references public.service_requests(id),
 status text not null default 'available' check(status in('available','used','expired','cancelled')),
 created_at timestamptz not null default clock_timestamp(),
 check((partner_order_id is null)<>(service_request_id is null))
);

create table public.automation_financial_cases (
 id uuid primary key default gen_random_uuid(), case_type text not null check(case_type in('payment','refund','payout')),
 related_entity_type text not null, related_entity_id text not null, safe_reason_code text not null,
 status text not null default 'needs_review' check(status in('needs_review','in_review','resolved')),
 deduplication_key text not null unique, created_at timestamptz not null default clock_timestamp(), resolved_at timestamptz
);

create table public.automation_provider_events (
 provider_event_id text primary key, event_kind text not null check(event_kind in('payment','refund','payout')),
 related_entity_id uuid not null, amount_paise bigint not null check(amount_paise>0), currency text not null,
 reference_digest text not null, verified_at timestamptz not null default clock_timestamp()
);

create table public.workbook_delivery_confirmations (
 destination text not null check(destination in('loan','logistics')), lead_id uuid not null references public.service_requests(id),
 external_row_key text not null, confirmed_at timestamptz not null default clock_timestamp(),
 primary key(destination,lead_id), unique(destination,external_row_key)
);

alter table public.excel_lead_outbox drop constraint if exists excel_lead_outbox_status_check;
alter table public.excel_lead_outbox add constraint excel_lead_outbox_status_check
 check(status in('pending_configuration','pending','processing','synced','retry','attention_required','cancelled'));
alter table public.excel_lead_outbox add column if not exists lock_owner text,
 add column if not exists lock_expires_at timestamptz, add column if not exists external_row_key text;
create index if not exists excel_lead_outbox_due on public.excel_lead_outbox(status,next_attempt_at);

alter table public.partner_orders add column if not exists automation_version bigint not null default 1,
 add column if not exists updated_at timestamptz not null default clock_timestamp();
alter table public.service_requests add column if not exists automation_version bigint not null default 1;
alter table public.partner_availability add column if not exists automation_version bigint not null default 1;
alter table public.seller_subscriptions add column if not exists automation_version bigint not null default 1;
alter table public.seller_notifications add column if not exists automation_key text unique;

create or replace function public.automation_payload_is_safe(p_payload jsonb) returns boolean
language plpgsql immutable set search_path=public as $$
declare rendered text:=lower(coalesce(p_payload,'{}'::jsonb)::text);
begin
 return octet_length(rendered)<=4096 and rendered !~ '(^|[^a-z])(password|passcode|otp|token|secret|bank|account_number|ifsc|kyc|aadhaar|pan_number|phone|email|address|message_body|raw_provider)([^a-z]|$)';
end $$;

create or replace function public.automation_safe_error(p_message text) returns text
language sql immutable set search_path=public as $$
 select case
  when p_message is null then 'Background operation failed'
  when lower(p_message) ~ '(password|passcode|otp|token|secret|bank|account number|ifsc|kyc|aadhaar|provider payload)'
    or p_message ~ '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
    or p_message ~ '(^|[^0-9])[0-9]{10,}([^0-9]|$)'
   then 'Sensitive provider detail removed; inspect the restricted provider system'
  else left(regexp_replace(p_message,'[\r\n\t]+',' ','g'),240) end
$$;

alter table public.background_jobs add constraint background_jobs_safe_payload check(public.automation_payload_is_safe(payload));

create or replace function public.automation_is_worker() returns boolean
language sql stable set search_path=public as $$ select current_user in('service_role','postgres') $$;

create or replace function public.enqueue_background_job(
 p_job_type text,p_entity_type text,p_entity_id text,p_scheduled_at timestamptz,p_deduplication_key text,
 p_entity_version bigint default null,p_payload jsonb default '{}'::jsonb,p_max_attempts integer default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare result uuid; configured_attempts integer;
begin
 if not automation_payload_is_safe(p_payload) then raise exception 'Unsafe background job payload'; end if;
 select default_max_attempts into configured_attempts from automation_configuration where id=true;
 insert into background_jobs(job_type,related_entity_type,related_entity_id,payload,scheduled_at,max_attempts,deduplication_key,entity_version)
 values(left(p_job_type,80),left(p_entity_type,80),left(p_entity_id,100),coalesce(p_payload,'{}'),p_scheduled_at,coalesce(p_max_attempts,configured_attempts),left(p_deduplication_key,220),p_entity_version)
 on conflict(deduplication_key) do update set
  scheduled_at=excluded.scheduled_at, entity_version=excluded.entity_version, payload=excluded.payload,
  status=case when background_jobs.status in('succeeded','running') then background_jobs.status else 'pending' end,
  next_retry_at=null, updated_at=clock_timestamp()
 returning id into result;
 return result;
end $$;

create or replace function public.cancel_obsolete_jobs(p_entity_type text,p_entity_id text,p_job_types text[],p_except_key text default null)
returns integer language plpgsql security definer set search_path=public as $$
declare changed integer;
begin
 update background_jobs set status='cancelled',cancelled_at=clock_timestamp(),updated_at=clock_timestamp(),lock_owner=null,lock_expires_at=null
 where related_entity_type=p_entity_type and related_entity_id=p_entity_id and job_type=any(p_job_types)
 and status in('pending','retry_scheduled') and (p_except_key is null or deduplication_key<>p_except_key);
 get diagnostics changed=row_count; return changed;
end $$;

create or replace function public.bump_automation_version() returns trigger
language plpgsql set search_path=public as $$
begin
 new.automation_version=old.automation_version+1;
 if tg_table_name in('partner_orders','partner_availability') then new.updated_at=clock_timestamp(); end if;
 return new;
end $$;
create trigger automation_partner_order_version before update of status,deadline,details on public.partner_orders for each row execute function public.bump_automation_version();
create trigger automation_service_request_version before update of status,assigned_vendor_id,details on public.service_requests for each row execute function public.bump_automation_version();
create trigger automation_availability_version before update of online,available_until on public.partner_availability for each row execute function public.bump_automation_version();
create trigger automation_subscription_version before update of status,trial_ends_at,current_period_end,approval_date_missing on public.seller_subscriptions for each row execute function public.bump_automation_version();

create or replace function public.queue_automation_notification(p_account uuid,p_type text,p_entity_type text,p_entity_id text,p_template text,p_key text)
returns uuid language plpgsql security definer set search_path=public as $$
declare result uuid;
begin
 insert into notification_outbox(recipient_account_id,notification_type,related_entity_type,related_entity_id,template_key,deduplication_key)
 values(p_account,p_type,p_entity_type,p_entity_id,p_template,left(p_key,220)) on conflict(deduplication_key) do nothing returning id into result;
 if result is null then select id into result from notification_outbox where deduplication_key=left(p_key,220); end if;
 perform enqueue_background_job('notification_queue','notification_outbox',result::text,clock_timestamp(),'notification:'||result);
 return result;
end $$;

create or replace function public.schedule_partner_order_automation() returns trigger
language plpgsql security definer set search_path=public as $$
declare cfg automation_configuration; leads integer[]; lead integer; key text;
begin
 select * into cfg from automation_configuration where id=true;
 perform cancel_obsolete_jobs('partner_orders',new.id::text,array['partner_order_expiry','partner_order_reminder']);
 if new.status='requested' then
  perform enqueue_background_job('partner_order_expiry','partner_orders',new.id::text,new.created_at+make_interval(mins=>cfg.request_response_minutes),'order:'||new.id||':expiry:v'||new.automation_version,new.automation_version);
 elsif new.status in('accepted','active','awaiting_acceptance') and new.deadline is not null then
  leads:=case new.role when 'consultant' then cfg.consultation_reminder_minutes when 'influencer' then cfg.influencer_reminder_minutes else cfg.booking_reminder_minutes end;
  foreach lead in array leads loop
   if new.deadline-make_interval(mins=>lead)>clock_timestamp() then
    key:='order:'||new.id||':reminder:'||lead||':v'||new.automation_version;
    perform enqueue_background_job('partner_order_reminder','partner_orders',new.id::text,new.deadline-make_interval(mins=>lead),key,new.automation_version,jsonb_build_object('lead_minutes',lead));
   end if;
  end loop;
 elsif new.status='completed' then
  perform enqueue_background_job('review_invitation','partner_orders',new.id::text,clock_timestamp(),'order:'||new.id||':review',new.automation_version);
 end if;
 return new;
end $$;
create trigger schedule_partner_order_automation after insert or update of status,deadline on public.partner_orders for each row execute function public.schedule_partner_order_automation();

create or replace function public.schedule_service_request_automation() returns trigger
language plpgsql security definer set search_path=public as $$
declare minutes integer;
begin
 select request_response_minutes into minutes from automation_configuration where id=true;
 perform cancel_obsolete_jobs('service_requests',new.id::text,array['service_request_expiry']);
 if new.request_type='service' and new.assigned_vendor_id is not null and new.status='pending' then
  perform enqueue_background_job('service_request_expiry','service_requests',new.id::text,new.created_at+make_interval(mins=>minutes),'service-request:'||new.id||':expiry:v'||new.automation_version,new.automation_version);
 elsif new.status='completed' then
  perform enqueue_background_job('review_invitation','service_requests',new.id::text,clock_timestamp(),'service-request:'||new.id||':review',new.automation_version);
 end if;
 return new;
end $$;
create trigger schedule_service_request_automation after insert or update of status,assigned_vendor_id on public.service_requests for each row execute function public.schedule_service_request_automation();

create or replace function public.schedule_availability_expiry() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 perform cancel_obsolete_jobs('partner_availability',new.partner_id::text,array['availability_expiry']);
 if new.online and new.available_until is not null then
  perform enqueue_background_job('availability_expiry','partner_availability',new.partner_id::text,new.available_until,'availability:'||new.partner_id||':v'||new.automation_version,new.automation_version);
 end if; return new;
end $$;
create trigger schedule_availability_expiry after insert or update of online,available_until on public.partner_availability for each row execute function public.schedule_availability_expiry();

create or replace function public.schedule_subscription_automation() returns trigger
language plpgsql security definer set search_path=public as $$
declare cfg automation_configuration; days integer; finish timestamptz;
begin
 select * into cfg from automation_configuration where id=true;
 perform cancel_obsolete_jobs('seller_subscriptions',new.partner_id::text,array['subscription_reminder','subscription_evaluation']);
 if new.approval_date_missing then
  insert into operational_review_tasks(task_type,related_entity_type,related_entity_id,required_permission,deduplication_key)
  values('subscription_approval_date','seller_subscriptions',new.partner_id::text,'partners.view','subscription-approval-date:'||new.partner_id) on conflict do nothing;
  return new;
 end if;
 finish:=case when new.status='active' then new.current_period_end else new.trial_ends_at end;
 if finish is not null and new.status in('trial','active') then
  foreach days in array (case when new.status='trial' then cfg.trial_reminder_days else cfg.subscription_reminder_days end) loop
   if finish-make_interval(days=>days)>clock_timestamp() then
    perform enqueue_background_job('subscription_reminder','seller_subscriptions',new.partner_id::text,finish-make_interval(days=>days),'subscription:'||new.partner_id||':reminder:'||days||':v'||new.automation_version,new.automation_version,jsonb_build_object('lead_days',days));
   end if;
  end loop;
  perform enqueue_background_job('subscription_evaluation','seller_subscriptions',new.partner_id::text,finish,'subscription:'||new.partner_id||':evaluate:v'||new.automation_version,new.automation_version);
 end if; return new;
end $$;
create trigger schedule_subscription_automation after insert or update of status,trial_ends_at,current_period_end,approval_date_missing on public.seller_subscriptions for each row execute function public.schedule_subscription_automation();

create or replace function public.create_operational_review_task() returns trigger
language plpgsql security definer set search_path=public as $$
declare row_data jsonb:=to_jsonb(new); state text; kind text; permission text; escalation_hours integer;
begin
 state:=coalesce(row_data->>'status','');
 if tg_table_name='partner_applications' and state in('submitted','under_review') then kind:='partner_application'; permission:='partner.approve';
 elsif tg_table_name='partner_posts' and state='pending_review' then kind:='partner_post'; permission:='post.moderate';
 elsif tg_table_name='chat_reports' and state in('pending','reviewing') then kind:='reported_conversation'; permission:='chat.review';
 elsif tg_table_name='consultant_assessment_banks' and coalesce((row_data->>'approved')::boolean,false)=false then kind:='assessment_content'; permission:='partner.approve';
 elsif tg_table_name='seller_reviews' and coalesce((row_data->>'published')::boolean,false)=false then kind:='customer_review'; permission:='ratings.view';
 elsif tg_table_name='platform_ratings' and coalesce(row_data->>'moderation_status','included')<>'included' then kind:='customer_review'; permission:='ratings.view';
 else return new; end if;
 select operational_escalation_hours into escalation_hours from automation_configuration where id=true;
 insert into operational_review_tasks(task_type,related_entity_type,related_entity_id,required_permission,deduplication_key,due_at,escalation_at)
 values(kind,tg_table_name,row_data->>'id',permission,'review:'||tg_table_name||':'||(row_data->>'id'),clock_timestamp(),clock_timestamp()+make_interval(hours=>escalation_hours)) on conflict do nothing;
 return new;
end $$;
create trigger queue_partner_application_review after insert or update of status on public.partner_applications for each row execute function public.create_operational_review_task();
create trigger queue_partner_post_review after insert or update of status on public.partner_posts for each row execute function public.create_operational_review_task();
create trigger queue_chat_report_review after insert or update of status on public.chat_reports for each row execute function public.create_operational_review_task();
create trigger queue_consultant_assessment_review after insert or update of approved on public.consultant_assessment_banks for each row execute function public.create_operational_review_task();
create trigger queue_seller_review_moderation after insert on public.seller_reviews for each row execute function public.create_operational_review_task();
create trigger queue_platform_review_moderation after insert on public.platform_ratings for each row execute function public.create_operational_review_task();

create or replace function public.schedule_financial_automation() returns trigger
language plpgsql security definer set search_path=public as $$
declare row_data jsonb:=to_jsonb(new); entity_id text:=row_data->>'id'; state text:=row_data->>'status'; when_due timestamptz; cfg automation_configuration;
begin
 select * into cfg from automation_configuration where id=true;
 if tg_table_name='customer_payments' and state in('pending','authorized') and cfg.payment_reconciliation_enabled then
  when_due:=coalesce((row_data->>'created_at')::timestamptz,clock_timestamp())+make_interval(mins=>cfg.payment_reconciliation_minutes);
  perform enqueue_background_job('payment_reconciliation','customer_payments',entity_id,when_due,'payment-reconciliation:'||entity_id);
 elsif tg_table_name='customer_refunds' and state in('requested','under_review') then
  insert into operational_review_tasks(task_type,related_entity_type,related_entity_id,required_permission,deduplication_key,due_at,escalation_at)
  values('refund_review','customer_refunds',entity_id,'refund.view','refund-review:'||entity_id,clock_timestamp(),clock_timestamp()+make_interval(hours=>cfg.operational_escalation_hours)) on conflict do nothing;
 elsif tg_table_name='customer_refunds' and state in('approved','processing') and cfg.refund_submission_enabled then
  perform enqueue_background_job('refund_submission','customer_refunds',entity_id,clock_timestamp(),'refund-submission:'||entity_id);
 elsif tg_table_name='partner_payouts' and state in('scheduled','failed','uncertain') and cfg.payout_submission_enabled then
  when_due:=greatest(coalesce((row_data->>'due_at')::timestamptz,clock_timestamp()),clock_timestamp());
  perform enqueue_background_job('payout_submission','partner_payouts',entity_id,when_due,'payout-submission:'||entity_id);
 end if;
 return new;
end $$;
create trigger schedule_payment_reconciliation after insert or update of status on public.customer_payments for each row execute function public.schedule_financial_automation();
create trigger schedule_refund_automation after insert or update of status on public.customer_refunds for each row execute function public.schedule_financial_automation();
create trigger schedule_payout_automation after insert or update of status on public.partner_payouts for each row execute function public.schedule_financial_automation();

create or replace function public.claim_background_jobs(p_worker_id text,p_limit integer default null,p_now timestamptz default clock_timestamp())
returns setof public.background_jobs language plpgsql security definer set search_path=public as $$
declare cfg automation_configuration; take_count integer;
begin
 if not automation_is_worker() then raise exception 'Trusted worker required'; end if;
 select * into cfg from automation_configuration where id=true;
 if not cfg.enabled then return; end if;
 take_count:=least(coalesce(p_limit,cfg.batch_size),cfg.batch_size);
 return query with due as (
  select id from background_jobs where
   ((status in('pending','retry_scheduled') and coalesce(next_retry_at,scheduled_at)<=p_now) or (status='running' and lock_expires_at<=p_now))
  order by coalesce(next_retry_at,scheduled_at),created_at for update skip locked limit take_count
 ) update background_jobs j set status='running',attempt_count=j.attempt_count+1,lock_owner=left(p_worker_id,120),
  lock_expires_at=p_now+make_interval(secs=>cfg.lease_seconds),started_at=coalesce(j.started_at,p_now),updated_at=p_now
 from due where j.id=due.id returning j.*;
end $$;

create or replace function public.complete_background_job(p_job uuid,p_worker text,p_now timestamptz default clock_timestamp())
returns void language plpgsql security definer set search_path=public as $$
begin
 if not automation_is_worker() then raise exception 'Trusted worker required'; end if;
 update background_jobs set status='succeeded',completed_at=p_now,updated_at=p_now,lock_owner=null,lock_expires_at=null,last_error_code=null,last_error_message=null
 where id=p_job and status='running' and lock_owner=p_worker;
 if not found then raise exception 'Active job lease required'; end if;
 insert into automation_job_audit(job_id,event_type,worker_id,occurred_at) values(p_job,'succeeded',left(p_worker,120),p_now);
end $$;

create or replace function public.fail_background_job(p_job uuid,p_worker text,p_failure_class text,p_code text,p_safe_message text,p_now timestamptz default clock_timestamp())
returns text language plpgsql security definer set search_path=public as $$
declare j background_jobs; cfg automation_configuration; delay_seconds integer; next_state text;
begin
 if not automation_is_worker() then raise exception 'Trusted worker required'; end if;
 select * into j from background_jobs where id=p_job and status='running' and lock_owner=p_worker for update;
 if j.id is null then raise exception 'Active job lease required'; end if;
 select * into cfg from automation_configuration where id=true;
 if p_failure_class='obsolete' then next_state:='cancelled';
 elsif p_failure_class='permanent' or j.attempt_count>=j.max_attempts then next_state:='dead_letter';
 else next_state:='retry_scheduled'; end if;
 delay_seconds:=least(cfg.retry_max_seconds,(cfg.retry_base_seconds*power(2,greatest(j.attempt_count-1,0)))::integer)
  + mod(abs(hashtext(j.id::text||':'||j.attempt_count)),greatest(cfg.retry_base_seconds/4,1));
 update background_jobs set status=next_state,next_retry_at=case when next_state='retry_scheduled' then p_now+make_interval(secs=>delay_seconds) end,
  lock_owner=null,lock_expires_at=null,last_error_code=left(coalesce(p_code,'unspecified'),80),
  last_error_message=automation_safe_error(p_safe_message),
  cancelled_at=case when next_state='cancelled' then p_now end,dead_lettered_at=case when next_state='dead_letter' then p_now end,updated_at=p_now
 where id=j.id;
 insert into automation_job_audit(job_id,event_type,worker_id,safe_code,safe_message,occurred_at)
 values(j.id,next_state,left(p_worker,120),left(p_code,80),automation_safe_error(p_safe_message),p_now);
 if next_state='dead_letter' then
  insert into operational_review_tasks(task_type,related_entity_type,related_entity_id,required_permission,deduplication_key)
  values('automation_dead_letter','background_jobs',j.id::text,'automation.manage','dead-letter:'||j.id) on conflict do nothing;
 end if;
 return next_state;
end $$;

create or replace function public.execute_background_job(p_job uuid,p_worker text,p_external_result jsonb default null,p_now timestamptz default clock_timestamp())
returns text language plpgsql security definer set search_path=public,eazily_private as $$
declare j background_jobs; o partner_orders; r service_requests; a partner_availability; s seller_subscriptions; owner uuid; cfg automation_configuration; outbox excel_lead_outbox; review_task operational_review_tasks;
begin
 if not automation_is_worker() then raise exception 'Trusted worker required'; end if;
 select * into j from background_jobs where id=p_job and status='running' and lock_owner=p_worker for update;
 if j.id is null then raise exception 'Active job lease required'; end if;
 select * into cfg from automation_configuration where id=true;
 if not cfg.enabled then perform fail_background_job(j.id,p_worker,'obsolete','automation_paused','Automation was paused',p_now); return 'cancelled'; end if;

 if j.job_type='partner_order_expiry' then
  select * into o from partner_orders where id=j.related_entity_id::uuid for update;
  if o.id is null or o.status<>'requested' or o.automation_version<>j.entity_version then perform fail_background_job(j.id,p_worker,'obsolete','stale_order','Order no longer awaits response',p_now); return 'cancelled'; end if;
  update partner_orders set status='cancelled',details=details||jsonb_build_object('automationState','expired','expiredAt',p_now) where id=o.id;
  select customer_id into owner from partner_applications where id=o.partner_id;
  perform queue_automation_notification(o.customer_id,'request_expired','partner_orders',o.id::text,'partner-request-expired','order:'||o.id||':expired:customer');
  perform queue_automation_notification(owner,'request_expired','partner_orders',o.id::text,'partner-request-expired','order:'||o.id||':expired:partner');
 elsif j.job_type='service_request_expiry' then
  select * into r from service_requests where id=j.related_entity_id::uuid for update;
  if r.id is null or r.status<>'pending' or r.automation_version<>j.entity_version then perform fail_background_job(j.id,p_worker,'obsolete','stale_request','Request no longer awaits response',p_now); return 'cancelled'; end if;
  update service_requests set status='cancelled',details=details||jsonb_build_object('automationState','expired','expiredAt',p_now),updated_at=p_now where id=r.id;
  perform queue_automation_notification(r.customer_id,'request_expired','service_requests',r.id::text,'service-request-expired','service-request:'||r.id||':expired:customer');
 elsif j.job_type='partner_order_reminder' then
  select * into o from partner_orders where id=j.related_entity_id::uuid for update;
  if o.id is null or o.status not in('accepted','active','awaiting_acceptance') or o.automation_version<>j.entity_version or o.deadline is null then perform fail_background_job(j.id,p_worker,'obsolete','stale_reminder','Reminder is no longer current',p_now); return 'cancelled'; end if;
  select customer_id into owner from partner_applications where id=o.partner_id;
  perform queue_automation_notification(o.customer_id,'booking_reminder','partner_orders',o.id::text,o.role||'-booking-reminder',j.deduplication_key||':customer');
  perform queue_automation_notification(owner,'booking_reminder','partner_orders',o.id::text,o.role||'-booking-reminder',j.deduplication_key||':partner');
 elsif j.job_type='availability_expiry' then
  select * into a from partner_availability where partner_id=j.related_entity_id::uuid for update;
  if a.partner_id is null or not a.online or a.automation_version<>j.entity_version or a.available_until>p_now then perform fail_background_job(j.id,p_worker,'obsolete','stale_availability','Availability is already offline or was extended',p_now); return 'cancelled'; end if;
  update partner_availability set online=false where partner_id=a.partner_id;
 elsif j.job_type='subscription_reminder' then
  select * into s from seller_subscriptions where partner_id=j.related_entity_id::uuid for update;
  if s.partner_id is null or s.approval_date_missing or s.automation_version<>j.entity_version or s.status not in('trial','active') then perform fail_background_job(j.id,p_worker,'obsolete','stale_subscription','Subscription reminder is obsolete',p_now); return 'cancelled'; end if;
  select customer_id into owner from partner_applications where id=s.partner_id;
  perform queue_automation_notification(owner,'subscription_reminder','seller_subscriptions',s.partner_id::text,'seller-subscription-reminder',j.deduplication_key||':partner');
 elsif j.job_type='subscription_evaluation' then
  select * into s from seller_subscriptions where partner_id=j.related_entity_id::uuid for update;
  if s.partner_id is null or s.approval_date_missing or s.automation_version<>j.entity_version then perform fail_background_job(j.id,p_worker,'obsolete','stale_subscription','Subscription evaluation is obsolete',p_now); return 'cancelled'; end if;
  if (s.status='trial' and s.trial_ends_at<=p_now) or (s.status='active' and s.current_period_end is not null and s.current_period_end<=p_now) then update seller_subscriptions set status='expired',updated_at=p_now where partner_id=s.partner_id; else perform fail_background_job(j.id,p_worker,'obsolete','subscription_not_due','Subscription is not due',p_now); return 'cancelled'; end if;
 elsif j.job_type='review_invitation' then
  if j.related_entity_type='partner_orders' then
   select * into o from partner_orders where id=j.related_entity_id::uuid for update;
   if o.id is null or o.status<>'completed' then perform fail_background_job(j.id,p_worker,'obsolete','booking_not_completed','Review invitation is not eligible',p_now); return 'cancelled'; end if;
   insert into review_invitations(customer_id,partner_order_id) values(o.customer_id,o.id) on conflict(partner_order_id) do nothing;
   perform queue_automation_notification(o.customer_id,'review_invitation','partner_orders',o.id::text,'booking-review-invitation','order:'||o.id||':review-invitation');
  else
   select * into r from service_requests where id=j.related_entity_id::uuid for update;
   if r.id is null or r.status<>'completed' then perform fail_background_job(j.id,p_worker,'obsolete','request_not_completed','Review invitation is not eligible',p_now); return 'cancelled'; end if;
   insert into review_invitations(customer_id,service_request_id) values(r.customer_id,r.id) on conflict(service_request_id) do nothing;
   perform queue_automation_notification(r.customer_id,'review_invitation','service_requests',r.id::text,'booking-review-invitation','service-request:'||r.id||':review-invitation');
  end if;
 elsif j.job_type='notification_queue' then
  update notification_outbox set delivery_state='queued',attempt_count=attempt_count+1,updated_at=p_now where id=j.related_entity_id::uuid and delivery_state='requested';
 elsif j.job_type='operational_task_escalation' then
  select * into review_task from operational_review_tasks where id=j.related_entity_id::uuid for update;
  if review_task.id is null or review_task.status not in('pending','in_review') or review_task.escalated_at is not null or review_task.escalation_at>p_now then
   perform fail_background_job(j.id,p_worker,'obsolete','review_task_not_due','Operational review task no longer needs escalation',p_now); return 'cancelled';
  end if;
  update operational_review_tasks set escalated_at=p_now,updated_at=p_now where id=review_task.id;
  perform emit_realtime_event('admin','admin','automation','operational_review_tasks',review_task.id::text);
 elsif j.job_type='excel_delivery' then
  select * into outbox from excel_lead_outbox where lead_id=j.related_entity_id::uuid for update;
  if outbox.lead_id is null or outbox.status='synced' then perform fail_background_job(j.id,p_worker,'obsolete','lead_already_synced','Lead is already confirmed or missing',p_now); return 'cancelled'; end if;
  if (outbox.destination='loan' and not cfg.workbook_loan_enabled) or (outbox.destination='logistics' and not cfg.workbook_logistics_enabled) then
   update excel_lead_outbox set status='pending_configuration',last_error='Destination is not configured' where lead_id=outbox.lead_id;
   perform fail_background_job(j.id,p_worker,'permanent','workbook_not_configured','Workbook destination is not configured',p_now); return 'dead_letter';
  end if;
  if coalesce(p_external_result->>'state','')='confirmed' and nullif(p_external_result->>'external_row_key','') is not null then
   insert into workbook_delivery_confirmations(destination,lead_id,external_row_key) values(outbox.destination,outbox.lead_id,p_external_result->>'external_row_key') on conflict(destination,lead_id) do nothing;
   update excel_lead_outbox set status='synced',synced_at=p_now,external_row_key=p_external_result->>'external_row_key',last_error=null,lock_owner=null,lock_expires_at=null where lead_id=outbox.lead_id;
  elsif coalesce(p_external_result->>'state','') in('transient_failure','uncertain') then
   update excel_lead_outbox set status='retry',attempts=attempts+1,last_error='Destination confirmation is pending' where lead_id=outbox.lead_id;
   perform fail_background_job(j.id,p_worker,'transient','workbook_unconfirmed','Destination did not confirm the Lead ID',p_now); return 'retry_scheduled';
  else
   perform fail_background_job(j.id,p_worker,'permanent','workbook_result_invalid','Verified destination result required',p_now); return 'dead_letter';
  end if;
 elsif j.job_type in('payment_reconciliation','refund_submission','payout_submission') then
  if (j.job_type='payment_reconciliation' and not cfg.payment_reconciliation_enabled)
    or (j.job_type='refund_submission' and not cfg.refund_submission_enabled)
    or (j.job_type='payout_submission' and not cfg.payout_submission_enabled) then
   perform fail_background_job(j.id,p_worker,'obsolete','financial_automation_disabled','This financial automation is disabled',p_now);
   return 'cancelled';
  else
   perform fail_background_job(j.id,p_worker,'permanent','provider_not_configured','External financial provider adapter is not configured',p_now);
  end if;
  insert into automation_financial_cases(case_type,related_entity_type,related_entity_id,safe_reason_code,deduplication_key)
  values(case when j.job_type='payment_reconciliation' then 'payment' when j.job_type='refund_submission' then 'refund' else 'payout' end,
   j.related_entity_type,j.related_entity_id,'provider_not_configured','financial-job:'||j.id) on conflict do nothing;
  return 'dead_letter';
 elsif j.job_type='cleanup_realtime_events' then
  if cfg.realtime_cleanup_enabled then delete from realtime_events where occurred_at<p_now-make_interval(days=>cfg.realtime_retention_days); end if;
 elsif j.job_type='cleanup_chat_attachments' then
  update chat_attachments set status='abandoned' where message_id is null and status in('uploading','ready')
   and created_at<p_now-make_interval(hours=>(select abandoned_attachment_hours from chat_configuration where id=true));
 else
  perform fail_background_job(j.id,p_worker,'permanent','unsupported_job_type','Unsupported background job type',p_now); return 'dead_letter';
 end if;
 perform complete_background_job(j.id,p_worker,p_now); return 'succeeded';
end $$;

create or replace function public.enqueue_due_maintenance(p_now timestamptz default clock_timestamp()) returns integer
language plpgsql security definer set search_path=public as $$
declare count_jobs integer:=0; row_data record; cfg automation_configuration; leads integer[]; lead integer; finish timestamptz;
 bucket text:=to_char(date_trunc('hour',p_now),'YYYYMMDDHH24'); job_key text;
begin
 if not automation_is_worker() then raise exception 'Trusted worker required'; end if;
 select * into cfg from automation_configuration where id=true;

 -- Reconcile records that existed before this migration or whose original trigger transaction failed.
 for row_data in select a.* from partner_availability a where a.online and a.available_until is not null
  and not exists(select 1 from background_jobs j where j.deduplication_key='availability:'||a.partner_id||':v'||a.automation_version)
  order by a.available_until limit 100 loop
  perform enqueue_background_job('availability_expiry','partner_availability',row_data.partner_id::text,row_data.available_until,'availability:'||row_data.partner_id||':v'||row_data.automation_version,row_data.automation_version); count_jobs:=count_jobs+1;
 end loop;

 for row_data in select o.* from partner_orders o where o.status='requested'
  and not exists(select 1 from background_jobs j where j.deduplication_key='order:'||o.id||':expiry:v'||o.automation_version)
  order by o.created_at limit 100 loop
  perform enqueue_background_job('partner_order_expiry','partner_orders',row_data.id::text,row_data.created_at+make_interval(mins=>cfg.request_response_minutes),'order:'||row_data.id||':expiry:v'||row_data.automation_version,row_data.automation_version); count_jobs:=count_jobs+1;
 end loop;

 for row_data in select r.* from service_requests r where r.request_type='service' and r.assigned_vendor_id is not null and r.status='pending'
  and not exists(select 1 from background_jobs j where j.deduplication_key='service-request:'||r.id||':expiry:v'||r.automation_version)
  order by r.created_at limit 100 loop
  perform enqueue_background_job('service_request_expiry','service_requests',row_data.id::text,row_data.created_at+make_interval(mins=>cfg.request_response_minutes),'service-request:'||row_data.id||':expiry:v'||row_data.automation_version,row_data.automation_version); count_jobs:=count_jobs+1;
 end loop;

 for row_data in select o.* from partner_orders o where o.status in('accepted','active','awaiting_acceptance') and o.deadline>p_now order by o.deadline limit 100 loop
  leads:=case row_data.role when 'consultant' then cfg.consultation_reminder_minutes when 'influencer' then cfg.influencer_reminder_minutes else cfg.booking_reminder_minutes end;
  foreach lead in array leads loop
   job_key:='order:'||row_data.id||':reminder:'||lead||':v'||row_data.automation_version;
   if not exists(select 1 from background_jobs j where j.deduplication_key=job_key) then
    perform enqueue_background_job('partner_order_reminder','partner_orders',row_data.id::text,greatest(row_data.deadline-make_interval(mins=>lead),p_now),job_key,row_data.automation_version,jsonb_build_object('lead_minutes',lead)); count_jobs:=count_jobs+1;
   end if;
  end loop;
 end loop;

 for row_data in select s.* from seller_subscriptions s where s.status in('trial','active') order by coalesce(s.current_period_end,s.trial_ends_at) limit 100 loop
  if row_data.approval_date_missing then
   insert into operational_review_tasks(task_type,related_entity_type,related_entity_id,required_permission,deduplication_key,due_at,escalation_at)
   values('subscription_approval_date','seller_subscriptions',row_data.partner_id::text,'partners.view','subscription-approval-date:'||row_data.partner_id,p_now,p_now+make_interval(hours=>cfg.operational_escalation_hours)) on conflict do nothing;
  else
   finish:=case when row_data.status='active' then row_data.current_period_end else row_data.trial_ends_at end;
   if finish is not null then
    job_key:='subscription:'||row_data.partner_id||':evaluate:v'||row_data.automation_version;
    if not exists(select 1 from background_jobs j where j.deduplication_key=job_key) then
     perform enqueue_background_job('subscription_evaluation','seller_subscriptions',row_data.partner_id::text,finish,job_key,row_data.automation_version); count_jobs:=count_jobs+1;
    end if;
    leads:=case when row_data.status='trial' then cfg.trial_reminder_days else cfg.subscription_reminder_days end;
    foreach lead in array leads loop
     job_key:='subscription:'||row_data.partner_id||':reminder:'||lead||':v'||row_data.automation_version;
     if finish>p_now and not exists(select 1 from background_jobs j where j.deduplication_key=job_key) then
      perform enqueue_background_job('subscription_reminder','seller_subscriptions',row_data.partner_id::text,greatest(finish-make_interval(days=>lead),p_now),job_key,row_data.automation_version,jsonb_build_object('lead_days',lead)); count_jobs:=count_jobs+1;
     end if;
    end loop;
   end if;
  end if;
 end loop;

 if cfg.payment_reconciliation_enabled then
  for row_data in select p.* from customer_payments p where p.status in('pending','authorized')
   and not exists(select 1 from background_jobs j where j.deduplication_key='payment-reconciliation:'||p.id)
   order by p.created_at limit 100 loop
   perform enqueue_background_job('payment_reconciliation','customer_payments',row_data.id::text,row_data.created_at+make_interval(mins=>cfg.payment_reconciliation_minutes),'payment-reconciliation:'||row_data.id); count_jobs:=count_jobs+1;
  end loop;
 end if;
 if cfg.refund_submission_enabled then
  for row_data in select r.* from customer_refunds r where r.status in('approved','processing')
   and not exists(select 1 from background_jobs j where j.deduplication_key='refund-submission:'||r.id)
   order by r.requested_at limit 100 loop
   perform enqueue_background_job('refund_submission','customer_refunds',row_data.id::text,p_now,'refund-submission:'||row_data.id); count_jobs:=count_jobs+1;
  end loop;
 end if;
 if cfg.payout_submission_enabled then
  for row_data in select p.* from partner_payouts p where p.status in('scheduled','failed','uncertain')
   and not exists(select 1 from background_jobs j where j.deduplication_key='payout-submission:'||p.id)
   order by coalesce(p.due_at,p.created_at) limit 100 loop
   perform enqueue_background_job('payout_submission','partner_payouts',row_data.id::text,greatest(coalesce(row_data.due_at,p_now),p_now),'payout-submission:'||row_data.id); count_jobs:=count_jobs+1;
  end loop;
 end if;

 insert into operational_review_tasks(task_type,related_entity_type,related_entity_id,required_permission,deduplication_key,due_at,escalation_at)
 select 'partner_application','partner_applications',a.id::text,'partner.approve','review:partner_applications:'||a.id,p_now,p_now+make_interval(hours=>cfg.operational_escalation_hours)
 from partner_applications a where a.status in('submitted','under_review') and not exists(select 1 from operational_review_tasks t where t.deduplication_key='review:partner_applications:'||a.id) order by a.created_at limit 100;
 insert into operational_review_tasks(task_type,related_entity_type,related_entity_id,required_permission,deduplication_key,due_at,escalation_at)
 select 'partner_post','partner_posts',p.id::text,'post.moderate','review:partner_posts:'||p.id,p_now,p_now+make_interval(hours=>cfg.operational_escalation_hours)
 from partner_posts p where p.status='pending_review' and not exists(select 1 from operational_review_tasks t where t.deduplication_key='review:partner_posts:'||p.id) order by p.created_at limit 100;
 insert into operational_review_tasks(task_type,related_entity_type,related_entity_id,required_permission,deduplication_key,due_at,escalation_at)
 select 'reported_conversation','chat_reports',r.id::text,'chat.review','review:chat_reports:'||r.id,p_now,p_now+make_interval(hours=>cfg.operational_escalation_hours)
 from chat_reports r where r.status in('pending','reviewing') and not exists(select 1 from operational_review_tasks t where t.deduplication_key='review:chat_reports:'||r.id) order by r.created_at limit 100;
 insert into operational_review_tasks(task_type,related_entity_type,related_entity_id,required_permission,deduplication_key,due_at,escalation_at)
 select 'assessment_content','consultant_assessment_banks',b.id::text,'partner.approve','review:consultant_assessment_banks:'||b.id,p_now,p_now+make_interval(hours=>cfg.operational_escalation_hours)
 from consultant_assessment_banks b where not b.approved and not exists(select 1 from operational_review_tasks t where t.deduplication_key='review:consultant_assessment_banks:'||b.id) order by b.created_at limit 100;
 insert into operational_review_tasks(task_type,related_entity_type,related_entity_id,required_permission,deduplication_key,due_at,escalation_at)
 select 'customer_review','seller_reviews',r.id::text,'ratings.view','review:seller_reviews:'||r.id,p_now,p_now+make_interval(hours=>cfg.operational_escalation_hours)
 from seller_reviews r where not r.published and not exists(select 1 from operational_review_tasks t where t.deduplication_key='review:seller_reviews:'||r.id) order by r.created_at limit 100;
 insert into operational_review_tasks(task_type,related_entity_type,related_entity_id,required_permission,deduplication_key,due_at,escalation_at)
 select 'customer_review','platform_ratings',r.id::text,'ratings.view','review:platform_ratings:'||r.id,p_now,p_now+make_interval(hours=>cfg.operational_escalation_hours)
 from platform_ratings r where r.moderation_status<>'included' and not exists(select 1 from operational_review_tasks t where t.deduplication_key='review:platform_ratings:'||r.id) order by r.created_at limit 100;
 insert into operational_review_tasks(task_type,related_entity_type,related_entity_id,required_permission,deduplication_key,due_at,escalation_at)
 select 'refund_review','customer_refunds',r.id::text,'refund.view','refund-review:'||r.id,p_now,p_now+make_interval(hours=>cfg.operational_escalation_hours)
 from customer_refunds r where r.status in('requested','under_review') and not exists(select 1 from operational_review_tasks t where t.deduplication_key='refund-review:'||r.id) order by r.requested_at limit 100;

 for row_data in select t.* from operational_review_tasks t where t.status in('pending','in_review') and t.escalated_at is null and t.escalation_at<=p_now
  and not exists(select 1 from background_jobs j where j.deduplication_key='operational-task:'||t.id||':escalation') order by t.escalation_at limit 100 loop
  perform enqueue_background_job('operational_task_escalation','operational_review_tasks',row_data.id::text,p_now,'operational-task:'||row_data.id||':escalation'); count_jobs:=count_jobs+1;
 end loop;

 for row_data in select o.id,o.customer_id,o.automation_version from partner_orders o where o.status='completed'
  and not exists(select 1 from review_invitations i where i.partner_order_id=o.id)
  and not exists(select 1 from background_jobs j where j.deduplication_key='order:'||o.id||':review') order by o.created_at limit 100 loop
  perform enqueue_background_job('review_invitation','partner_orders',row_data.id::text,p_now,'order:'||row_data.id||':review',row_data.automation_version); count_jobs:=count_jobs+1;
 end loop;
 for row_data in select r.id,r.customer_id,r.automation_version from service_requests r where r.status='completed'
  and not exists(select 1 from review_invitations i where i.service_request_id=r.id)
  and not exists(select 1 from background_jobs j where j.deduplication_key='service-request:'||r.id||':review') order by r.created_at limit 100 loop
  perform enqueue_background_job('review_invitation','service_requests',row_data.id::text,p_now,'service-request:'||row_data.id||':review',row_data.automation_version); count_jobs:=count_jobs+1;
 end loop;

 for row_data in select e.* from excel_lead_outbox e where e.status in('pending','retry') and e.next_attempt_at<=p_now
  and not exists(select 1 from background_jobs j where j.deduplication_key='excel:'||e.destination||':'||e.lead_id)
  order by e.next_attempt_at limit 100 loop
  perform enqueue_background_job('excel_delivery','excel_lead_outbox',row_data.lead_id::text,p_now,'excel:'||row_data.destination||':'||row_data.lead_id,null,jsonb_build_object('destination',row_data.destination)); count_jobs:=count_jobs+1;
 end loop;
 perform enqueue_background_job('cleanup_realtime_events','realtime_events','retention',p_now,'cleanup:realtime:'||bucket);
 perform enqueue_background_job('cleanup_chat_attachments','chat_attachments','abandoned',p_now,'cleanup:chat:'||bucket);
 return count_jobs+2;
end $$;

create or replace function public.record_automation_payment_confirmation(p_event_id text,p_payment uuid,p_amount bigint,p_currency text,p_reference text)
returns text language plpgsql security definer set search_path=public as $$
declare pay customer_payments; cfg automation_configuration; digest text; transaction_key uuid;
begin
 if not automation_is_worker() then raise exception 'Trusted worker required'; end if;
 select * into cfg from automation_configuration where id=true;
 if not cfg.payment_reconciliation_enabled then raise exception 'Payment reconciliation is disabled'; end if;
 select * into pay from customer_payments where id=p_payment for update;
 digest:=encode(digest(coalesce(p_reference,''),'sha256'),'hex');
 if pay.id is null or p_amount<>pay.amount_paise or p_currency<>pay.currency or (pay.provider_reference is not null and pay.provider_reference<>p_reference) then
  insert into automation_financial_cases(case_type,related_entity_type,related_entity_id,safe_reason_code,deduplication_key)
  values('payment','customer_payments',p_payment::text,'payment_mismatch','payment-mismatch:'||p_event_id) on conflict do nothing;
  return 'needs_review';
 end if;
 if exists(select 1 from automation_provider_events where provider_event_id=p_event_id) then return 'duplicate'; end if;
 if pay.status='paid' then
  insert into automation_provider_events(provider_event_id,event_kind,related_entity_id,amount_paise,currency,reference_digest)
  values(p_event_id,'payment',p_payment,p_amount,p_currency,digest);
  return 'already_confirmed';
 end if;
 insert into automation_provider_events(provider_event_id,event_kind,related_entity_id,amount_paise,currency,reference_digest)
 values(p_event_id,'payment',p_payment,p_amount,p_currency,digest);
 update customer_payments set status='paid',paid_at=coalesce(paid_at,clock_timestamp()),provider_reference=coalesce(provider_reference,p_reference) where id=p_payment and status in('pending','authorized','unpaid');
 insert into finance_transactions(source_type,source_id,idempotency_key,currency,event_time,status)
 values('customer_payment',p_payment::text,'automation-payment:'||p_event_id,p_currency,clock_timestamp(),'posted')
 on conflict(idempotency_key) do nothing returning id into transaction_key;
 if transaction_key is not null then
  insert into finance_entries(transaction_id,account_code,direction,amount_paise,category)
  values(transaction_key,'cash_clearing','debit',p_amount,'payment'),(transaction_key,'customer_payments','credit',p_amount,'payment');
 end if;
 return 'confirmed';
end $$;

create or replace function public.record_automation_refund_confirmation(p_event_id text,p_refund uuid,p_amount bigint,p_currency text,p_reference text)
returns text language plpgsql security definer set search_path=public as $$
declare ref customer_refunds; pay customer_payments; cfg automation_configuration; digest text; total_refunded bigint; transaction_key uuid;
begin
 if not automation_is_worker() then raise exception 'Trusted worker required'; end if;
 select * into cfg from automation_configuration where id=true;
 if not cfg.refund_submission_enabled then raise exception 'Refund submission is disabled'; end if;
 select * into ref from customer_refunds where id=p_refund for update; select * into pay from customer_payments where id=ref.payment_id for update;
 if ref.id is null or ref.status not in('approved','processing','completed','partially_completed') or p_amount<>ref.approved_paise or p_amount>pay.amount_paise or p_currency<>pay.currency or (ref.provider_reference is not null and ref.provider_reference<>p_reference) then
  insert into automation_financial_cases(case_type,related_entity_type,related_entity_id,safe_reason_code,deduplication_key)
  values('refund','customer_refunds',p_refund::text,'refund_mismatch','refund-mismatch:'||p_event_id) on conflict do nothing; return 'needs_review';
 end if;
 if exists(select 1 from automation_provider_events where provider_event_id=p_event_id) then return 'duplicate'; end if;
 digest:=encode(digest(coalesce(p_reference,''),'sha256'),'hex');
 if ref.status in('completed','partially_completed') then
  insert into automation_provider_events values(p_event_id,'refund',p_refund,p_amount,p_currency,digest,clock_timestamp());
  return 'already_confirmed';
 end if;
 insert into automation_provider_events values(p_event_id,'refund',p_refund,p_amount,p_currency,digest,clock_timestamp());
 update customer_refunds set status='completed',provider_reference=coalesce(provider_reference,p_reference),processed_at=clock_timestamp() where id=p_refund;
 select coalesce(sum(approved_paise),0) into total_refunded from customer_refunds where payment_id=pay.id and status in('completed','partially_completed');
 update customer_payments set status=case when total_refunded>=amount_paise then 'fully_refunded' else 'partially_refunded' end where id=pay.id;
 insert into finance_transactions(source_type,source_id,idempotency_key,currency,event_time,status)
 values('customer_refund',p_refund::text,'automation-refund:'||p_event_id,p_currency,clock_timestamp(),'posted')
 on conflict(idempotency_key) do nothing returning id into transaction_key;
 if transaction_key is not null then
  insert into finance_entries(transaction_id,account_code,direction,amount_paise,category)
  values(transaction_key,'customer_refunds','debit',p_amount,'refund'),(transaction_key,'cash_clearing','credit',p_amount,'refund');
 end if;
 return 'confirmed';
end $$;

create or replace function public.record_automation_payout_confirmation(p_event_id text,p_payout uuid,p_amount bigint,p_currency text,p_reference text)
returns text language plpgsql security definer set search_path=public as $$
declare payout partner_payouts; ord partner_orders; cfg automation_configuration; digest text; transaction_key uuid;
begin
 if not automation_is_worker() then raise exception 'Trusted worker required'; end if;
 select * into cfg from automation_configuration where id=true;
 if not cfg.payout_submission_enabled then raise exception 'Payout submission is disabled'; end if;
 select * into payout from partner_payouts where id=p_payout for update; select * into ord from partner_orders where id=payout.order_id;
 if payout.id is null or payout.status not in('processing','paid') or p_amount<>payout.amount_paise or p_currency<>payout.currency or ord.status in('disputed','cancelled') or (payout.provider_reference is not null and payout.provider_reference<>p_reference) then
  insert into automation_financial_cases(case_type,related_entity_type,related_entity_id,safe_reason_code,deduplication_key)
  values('payout','partner_payouts',p_payout::text,'payout_not_eligible','payout-mismatch:'||p_event_id) on conflict do nothing; return 'needs_review';
 end if;
 if exists(select 1 from automation_provider_events where provider_event_id=p_event_id) then return 'duplicate'; end if;
 digest:=encode(digest(coalesce(p_reference,''),'sha256'),'hex');
 if payout.status='paid' then
  insert into automation_provider_events values(p_event_id,'payout',p_payout,p_amount,p_currency,digest,clock_timestamp());
  return 'already_confirmed';
 end if;
 insert into automation_provider_events values(p_event_id,'payout',p_payout,p_amount,p_currency,digest,clock_timestamp());
 update partner_payouts set status='paid',provider_reference=coalesce(provider_reference,p_reference),paid_at=coalesce(paid_at,clock_timestamp()) where id=p_payout;
 insert into finance_transactions(source_type,source_id,idempotency_key,currency,event_time,status)
 values('partner_payout',p_payout::text,'automation-payout:'||p_event_id,p_currency,clock_timestamp(),'posted')
 on conflict(idempotency_key) do nothing returning id into transaction_key;
 if transaction_key is not null then
  insert into finance_entries(transaction_id,account_code,direction,amount_paise,category)
  values(transaction_key,'partner_payable','debit',p_amount,'payout'),(transaction_key,'cash_clearing','credit',p_amount,'payout');
 end if;
 return 'confirmed';
end $$;

create or replace function public.automation_health_summary() returns jsonb
language plpgsql security definer set search_path=public as $$
declare cfg automation_configuration; latest_start timestamptz; oldest_pending timestamptz;
begin
 if not (is_admin() or has_staff_permission('automation.view')) then raise exception 'Automation visibility permission required'; end if;
 select * into cfg from automation_configuration where id=true;
 select max(started_at) into latest_start from automation_worker_runs;
 select min(coalesce(next_retry_at,scheduled_at)) into oldest_pending from background_jobs where status in('pending','retry_scheduled');
 return jsonb_build_object(
  'enabled',cfg.enabled,
  'schedulerStatus',case when not cfg.enabled then 'paused' when latest_start is null then 'never_run' when latest_start>=clock_timestamp()-make_interval(secs=>cfg.scheduler_expected_seconds) then 'healthy' else 'stale' end,
  'schedulerExpectedSeconds',cfg.scheduler_expected_seconds,
  'pendingJobs',(select count(*) from background_jobs where status='pending'),
  'retryingJobs',(select count(*) from background_jobs where status='retry_scheduled'),
  'runningJobs',(select count(*) from background_jobs where status='running'),
  'expiredLeases',(select count(*) from background_jobs where status='running' and lock_expires_at<=clock_timestamp()),
  'deadLetterJobs',(select count(*) from background_jobs where status='dead_letter'),
  'oldestPendingAt',oldest_pending,
  'oldestPendingSeconds',case when oldest_pending is null then 0 else greatest(0,extract(epoch from clock_timestamp()-oldest_pending)::bigint) end,
  'jobsByType',(select coalesce(jsonb_object_agg(job_type,total),'{}') from (select job_type,count(*) total from background_jobs where status in('pending','retry_scheduled','running','dead_letter') group by job_type) x),
  'lastWorkerRun',(select max(finished_at) from automation_worker_runs where status in('succeeded','partial')),
  'notificationRequested',(select count(*) from notification_outbox where delivery_state in('requested','queued','submitted')),
  'notificationByState',(select coalesce(jsonb_object_agg(delivery_state,total),'{}') from (select delivery_state,count(*) total from notification_outbox group by delivery_state) x),
  'excelPending',(select count(*) from excel_lead_outbox where status not in('synced','cancelled')),
  'excelByState',(select coalesce(jsonb_object_agg(status,total),'{}') from (select status,count(*) total from excel_lead_outbox group by status) x),
  'financialCases',(select count(*) from automation_financial_cases where status<>'resolved'),
  'reviewTasksDue',(select count(*) from operational_review_tasks where status in('pending','in_review') and due_at<=clock_timestamp()),
  'reviewTasksOverdue',(select count(*) from operational_review_tasks where status in('pending','in_review') and escalation_at<=clock_timestamp() and escalated_at is null)
 );
end $$;

create or replace function public.admin_retry_automation_job(p_job uuid,p_reason text) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not has_staff_permission('automation.manage') then raise exception 'Automation management permission required'; end if;
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'A reason is required'; end if;
 update background_jobs set status='pending',scheduled_at=clock_timestamp(),next_retry_at=null,lock_owner=null,lock_expires_at=null,updated_at=clock_timestamp() where id=p_job and status in('dead_letter','cancelled','retry_scheduled');
 if not found then raise exception 'Job is not eligible for retry'; end if;
 insert into admin_audit_events(actor_id,action,entity_type,entity_id,reason) values(auth.uid(),'automation_job_retry','background_jobs',p_job::text,left(p_reason,1000));
 insert into automation_job_audit(job_id,event_type,actor_id,safe_message) values(p_job,'admin_retry',auth.uid(),left(p_reason,240));
end $$;

create or replace function public.admin_cancel_automation_job(p_job uuid,p_reason text) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not has_staff_permission('automation.manage') then raise exception 'Automation management permission required'; end if;
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'A reason is required'; end if;
 update background_jobs set status='cancelled',cancelled_at=clock_timestamp(),lock_owner=null,lock_expires_at=null,updated_at=clock_timestamp() where id=p_job and status in('pending','retry_scheduled');
 if not found then raise exception 'Only pending or retrying jobs can be cancelled'; end if;
 insert into admin_audit_events(actor_id,action,entity_type,entity_id,reason) values(auth.uid(),'automation_job_cancel','background_jobs',p_job::text,left(p_reason,1000));
 insert into automation_job_audit(job_id,event_type,actor_id,safe_message) values(p_job,'admin_cancel',auth.uid(),left(p_reason,240));
end $$;

create or replace function public.emit_automation_attention_event() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.status='dead_letter' and (tg_op='INSERT' or old.status is distinct from new.status) then
  perform emit_realtime_event('admin','admin','automation','background_jobs',new.id::text);
 end if;
 return new;
end $$;
create trigger realtime_automation_attention after insert or update of status on public.background_jobs for each row execute function public.emit_automation_attention_event();

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
 or (scope='automation' and public.has_staff_permission('automation.view'))
));

alter table public.automation_configuration enable row level security;
alter table public.background_jobs enable row level security;
alter table public.automation_job_audit enable row level security;
alter table public.automation_worker_runs enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.operational_review_tasks enable row level security;
alter table public.review_invitations enable row level security;
alter table public.automation_financial_cases enable row level security;
alter table public.automation_provider_events enable row level security;
alter table public.workbook_delivery_confirmations enable row level security;

create policy "Scoped staff read automation config" on public.automation_configuration for select using(is_admin() or has_staff_permission('automation.view'));
create policy "Scoped staff read background jobs" on public.background_jobs for select using(is_admin() or has_staff_permission('automation.view'));
create policy "Scoped staff read automation audit" on public.automation_job_audit for select using(is_admin() or has_staff_permission('automation.view'));
create policy "Scoped staff read worker runs" on public.automation_worker_runs for select using(is_admin() or has_staff_permission('automation.view'));
create policy "Scoped staff read notification outbox" on public.notification_outbox for select using(is_admin() or has_staff_permission('automation.view'));
create policy "Scoped staff read review tasks" on public.operational_review_tasks for select using(is_admin() or has_staff_permission(required_permission) or has_staff_permission('automation.view'));
create policy "Customer reads own review invitations" on public.review_invitations for select using(customer_id=auth.uid());
create policy "Scoped staff read financial cases" on public.automation_financial_cases for select using(is_admin() or has_staff_permission('finance.view'));

revoke all on public.automation_configuration,public.background_jobs,public.automation_job_audit,public.automation_worker_runs,public.notification_outbox,
 public.operational_review_tasks,public.review_invitations,public.automation_financial_cases,public.automation_provider_events,public.workbook_delivery_confirmations from public,anon,authenticated;
grant select on public.automation_configuration,public.background_jobs,public.automation_job_audit,public.automation_worker_runs,public.notification_outbox,public.operational_review_tasks,public.automation_financial_cases to authenticated;
grant select on public.review_invitations to authenticated;

revoke all on function public.automation_payload_is_safe(jsonb),public.automation_safe_error(text),public.automation_is_worker(),
 public.enqueue_background_job(text,text,text,timestamptz,text,bigint,jsonb,integer),public.cancel_obsolete_jobs(text,text,text[],text),
 public.queue_automation_notification(uuid,text,text,text,text,text),public.claim_background_jobs(text,integer,timestamptz),
 public.complete_background_job(uuid,text,timestamptz),public.fail_background_job(uuid,text,text,text,text,timestamptz),
 public.execute_background_job(uuid,text,jsonb,timestamptz),public.enqueue_due_maintenance(timestamptz),
 public.record_automation_payment_confirmation(text,uuid,bigint,text,text),public.record_automation_refund_confirmation(text,uuid,bigint,text,text),
 public.record_automation_payout_confirmation(text,uuid,bigint,text,text) from public,anon,authenticated;
revoke all on function public.automation_health_summary(),public.admin_retry_automation_job(uuid,text),public.admin_cancel_automation_job(uuid,text) from public,anon;
grant execute on function public.automation_health_summary(),public.admin_retry_automation_job(uuid,text),public.admin_cancel_automation_job(uuid,text) to authenticated;

do $$ begin if exists(select 1 from pg_roles where rolname='service_role') then
 grant select,insert,update on public.automation_configuration,public.background_jobs,public.automation_job_audit,public.automation_worker_runs,public.notification_outbox,public.operational_review_tasks,public.review_invitations,public.automation_financial_cases,public.automation_provider_events,public.workbook_delivery_confirmations to service_role;
 grant execute on function public.claim_background_jobs(text,integer,timestamptz),public.execute_background_job(uuid,text,jsonb,timestamptz),public.enqueue_due_maintenance(timestamptz),public.fail_background_job(uuid,text,text,text,text,timestamptz),public.complete_background_job(uuid,text,timestamptz),public.record_automation_payment_confirmation(text,uuid,bigint,text,text),public.record_automation_refund_confirmation(text,uuid,bigint,text,text),public.record_automation_payout_confirmation(text,uuid,bigint,text,text) to service_role;
end if; end $$;

commit;
