-- Forward-only repair for a trigger introduced after staging_security.sql.
-- PostgreSQL trigger execution does not require browser EXECUTE grants.
begin;
revoke all on function public.guard_service_issue_order() from public,anon,authenticated;
commit;
