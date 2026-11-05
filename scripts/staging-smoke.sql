-- READ ONLY. Run after all 45 manifest migrations on the linked staging project.
-- One result column; no account rows, document text, credentials, or secrets are returned.
with required_tables(name) as (
  values ('profiles'),('categories'),('services'),('service_requests'),
    ('partner_applications'),('partner_posts'),('partner_orders'),
    ('legal_documents'),('consent_events'),
    ('consultant_assessment_banks'),('consultant_assessment_questions'),
    ('consultant_assessment_attempts'),('background_jobs'),('notification_outbox')
),
checks(name,ok) as (
  select 'public.' || r.name || ' RLS',
    coalesce(c.relrowsecurity,false)
  from required_tables r
  left join pg_namespace n on n.nspname='public'
  left join pg_class c on c.relnamespace=n.oid and c.relname=r.name and c.relkind in ('r','p')

  union all select 'public.categories anon SELECT',
    coalesce(has_table_privilege('anon',to_regclass('public.categories'),'SELECT'),false)
  union all select 'public.categories authenticated SELECT',
    coalesce(has_table_privilege('authenticated',to_regclass('public.categories'),'SELECT'),false)
  union all select 'public.profiles authenticated SELECT',
    coalesce(has_table_privilege('authenticated',to_regclass('public.profiles'),'SELECT'),false)
  union all select 'public.services anon SELECT',
    coalesce(has_table_privilege('anon',to_regclass('public.services'),'SELECT'),false)
  union all select 'public.service_requests authenticated SELECT',
    coalesce(has_table_privilege('authenticated',to_regclass('public.service_requests'),'SELECT'),false)
  union all select 'public.partner_posts anon SELECT',
    coalesce(has_table_privilege('anon',to_regclass('public.partner_posts'),'SELECT'),false)
  union all select 'public.partner_applications authenticated SELECT',
    coalesce(has_table_privilege('authenticated',to_regclass('public.partner_applications'),'SELECT'),false)
  union all select 'public.partner_orders authenticated SELECT',
    coalesce(has_table_privilege('authenticated',to_regclass('public.partner_orders'),'SELECT'),false)

  union all select 'public.categories/' || seed.slug,
    exists(select 1 from public.categories c where c.slug=seed.slug and c.active)
  from (values ('manpower'),('loans'),('influencers'),('consultancy'),
    ('transportation'),('blood-bank')) seed(slug)

  union all select 'public.automation_configuration OFF',
    (select count(*)=1 and bool_and(not (enabled or notification_delivery_enabled
      or workbook_loan_enabled or workbook_logistics_enabled or payment_reconciliation_enabled
      or refund_submission_enabled or payout_submission_enabled or booking_attention_enabled
      or urgent_ticket_attention_enabled))
     from public.automation_configuration where id=true)
  union all select 'public.automation_configuration.realtime_cleanup_enabled OFF',
    (select count(*)=1 and bool_and(not realtime_cleanup_enabled)
     from public.automation_configuration where id=true)
  union all select 'public.seller_subscription_config OFF',
    (select count(*)=1 and bool_and(not (enabled or rollout_enabled or payment_checkout_enabled))
     from public.seller_subscription_config where id=true)
  union all select 'public.partner_config.cashfree_enabled OFF',
    (select count(*)=1 and bool_and(not cashfree_enabled)
     from public.partner_config where id=true)
  union all select 'public.service_post_approval_config.auto_publish_enabled OFF',
    (select count(*)=1 and bool_and(not auto_publish_enabled)
     from public.service_post_approval_config where id=true)
  union all select 'public.seller_pricing_rules OFF',
    not exists(select 1 from public.seller_pricing_rules where enabled)
  union all select 'public.seller_plans OFF',
    not exists(select 1 from public.seller_plans where enabled)
  union all select 'public.seller_reward_config OFF',
    (select count(*)=1 and bool_and(not enabled)
     from public.seller_reward_config where id=true)

  union all select 'Service Partner published legal documents absent',
    not exists(select 1 from public.legal_documents where published and document_key in
      ('eazily-service-partner-terms','eazily-service-partner-privacy-policy'))
  union all select 'submit_service_partner_application legal gate',
    coalesce(position('Published Service Partner Terms and Privacy Policy are required' in
      pg_get_functiondef(to_regprocedure('public.submit_service_partner_application(jsonb)')))>0,false)
  union all select 'enforce_current_service_partner_registration trigger',
    exists(select 1 from pg_trigger where tgrelid=to_regclass('public.partner_applications')
      and tgname='enforce_current_service_partner_registration' and tgenabled in ('O','A'))
  union all select 'enforce_service_partner_policy_records trigger',
    exists(select 1 from pg_trigger where tgrelid=to_regclass('public.partner_applications')
      and tgname='enforce_service_partner_policy_records' and tgenabled in ('O','A'))

  union all select 'Influencer unresolved legal text unpublished',
    not exists(select 1 from public.legal_documents where published
      and document_key in ('eazily-influencer-provider-terms','eazily-influencer-provider-privacy-policy')
      and content like '%[UNRESOLVED%')
  union all select 'save_partner_application Influencer legal gate',
    coalesce(position('Required Influencer Terms document is not published' in
      pg_get_functiondef(to_regprocedure('public.save_partner_application(text,jsonb,boolean)')))>0,false)
  union all select 'reject_unresolved_influencer_publication trigger',
    exists(select 1 from pg_trigger where tgrelid=to_regclass('public.legal_documents')
      and tgname='reject_unresolved_influencer_publication' and tgenabled in ('O','A'))

  union all select 'Consultant published legal documents absent',
    not exists(select 1 from public.legal_documents where published and document_key in
      ('eazily-consultant-provider-terms','eazily-consultant-provider-privacy-policy'))
  union all select 'require_consultant_policies triggers',
    (select count(*)=3 from pg_trigger where tgenabled in ('O','A') and
      (tgrelid,tgname) in (
        (to_regclass('public.partner_applications'),'require_consultant_policies_application'),
        (to_regclass('public.partner_posts'),'require_consultant_policies_post'),
        (to_regclass('public.partner_orders'),'require_consultant_policies_booking')))
  union all select 'Consultant question banks inactive without approved content',
    not exists(select 1 from public.consultant_assessment_banks b where b.active and
      (not b.approved or (select count(*) from public.consultant_assessment_questions q
        where q.bank_id=b.id and q.approved)<>6
       or (select count(*) from public.consultant_assessment_questions q
        where q.bank_id=b.id and q.approved and q.difficulty='foundation')<2
       or (select count(*) from public.consultant_assessment_questions q
        where q.bank_id=b.id and q.approved and q.difficulty='standard')<3
       or (select count(*) from public.consultant_assessment_questions q
        where q.bank_id=b.id and q.approved and q.difficulty='advanced')<1))
  union all select 'Consultant assessment requires 4/6',
    coalesce(position('score>=4' in replace(pg_get_functiondef(
      to_regprocedure('public.submit_consultant_assessment(uuid)')),' ',''))>0,false)
  union all select 'Consultant assessment application/work triggers',
    (select count(*)=3 from pg_trigger where tgenabled in ('O','A') and
      (tgrelid,tgname) in (
        (to_regclass('public.partner_applications'),'enforce_consultant_assessment_on_application'),
        (to_regclass('public.partner_posts'),'enforce_consultant_assessment_on_posts'),
        (to_regclass('public.partner_orders'),'enforce_consultant_assessment_on_bookings')))
)
select case when ok is true then 'PASS ' else 'FAIL ' end || name as result
from checks order by name;
