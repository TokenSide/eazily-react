-- READ ONLY. Run only after the target is positively identified non-production.
-- No customer rows, document paths, secret values or function bodies are emitted.
begin read only;
select current_database(),current_user,version();
select extname,extversion from pg_extension order by extname;
select rolname,rolsuper,rolbypassrls from pg_roles
where rolname in ('postgres','anon','authenticated','service_role');
select nspname,has_schema_privilege('anon',oid,'CREATE') anon_create,
 has_schema_privilege('authenticated',oid,'CREATE') authenticated_create
from pg_namespace where nspname in ('public','eazily_private','storage');
select n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','eazily_private','storage') and c.relkind in ('r','p') order by 1,2;
select schemaname,tablename,policyname,roles,cmd,qual,with_check
from pg_policies where schemaname in ('public','eazily_private','storage') order by 1,2,3;
select table_schema,table_name,grantee,privilege_type
from information_schema.role_table_grants
where table_schema in ('public','eazily_private','storage') and grantee in ('anon','authenticated','PUBLIC') order by 1,2,3;
select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid),p.proconfig,
 has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where p.prosecdef and n.nspname in ('public','eazily_private') order by 1,2;
select pubname,puballtables,pubinsert,pubupdate,pubdelete,pubtruncate from pg_publication;
select pubname,schemaname,tablename from pg_publication_tables order by 1,2,3;
select id,public,file_size_limit,allowed_mime_types from storage.buckets order by id;
select to_regclass('supabase_migrations.schema_migrations') as cli_history,
 to_regclass('eazily_private.staging_migration_history') as manual_history;
-- Run post-install only; missing tables before install are expected and stop here.
select enabled,notification_delivery_enabled,workbook_loan_enabled,workbook_logistics_enabled,
 payment_reconciliation_enabled,refund_submission_enabled,payout_submission_enabled
from public.automation_configuration;
select enabled,rollout_enabled,payment_checkout_enabled from public.seller_subscription_config;
select cashfree_enabled from public.partner_config;
rollback;
