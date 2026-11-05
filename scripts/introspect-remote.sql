-- Read-only introspection of a linked Supabase project.
--
-- Every statement below is a SELECT against the catalog. Nothing is created,
-- altered or dropped, and no application table is written. Safe to run against
-- staging. Review before running against production.
--
-- Output is one normalized stream so scripts/compare-manifest.cjs can diff the
-- live schema against supabase/migration-manifest.json:
--   object_kind | object_name | detail
--
-- Every column is cast to text explicitly. UNION ALL branches otherwise fail to
-- resolve when a catalog column has a narrower type, for example pg_policy.polcmd.

with objects(object_kind, object_name, detail) as (

  -- Application relations and whether Row Level Security is actually on.
  select 'relation'::text, c.relname::text,
         (case c.relkind when 'r' then 'table' when 'v' then 'view'
              when 'm' then 'materialized view' else c.relkind::text end)
         || case when c.relrowsecurity then ' +rls' else ' -RLS_DISABLED' end
         || case when c.relforcerowsecurity then ' +force' else '' end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'v', 'm')
  union all

  -- Relations living outside public, which the browser must never reach directly.
  select ('relation:' || n.nspname)::text, c.relname::text, ('schema=' || n.nspname)::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname not in ('public', 'pg_catalog', 'information_schema', 'pg_toast')
    and n.nspname not like 'pg_temp%' and n.nspname not like 'pg_to%'
    and c.relkind in ('r', 'v', 'm')
  union all

  -- Named enum types, which the manifest also declares.
  select 'enum'::text, t.typname::text, 'enum'::text
  from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
  where n.nspname = 'public' and t.typtype = 'e'
  union all

  -- Every function the browser could call, in any application schema. Not just
  -- public: eazily_public_read_internal holds the read_* RPC boundary, and
  -- eazily_private holds internal helpers the browser must never reach.
  select 'function'::text, p.proname::text,
         ((n.nspname || '.') || ' function'
          || case p.prosecdef when true then ' SECURITY DEFINER' else '' end
          || ' returns ' || pg_get_function_result(p.oid)
          || ' config=' || coalesce(array_to_string(p.proconfig, ','), '(none)'))::text
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname not in ('pg_catalog', 'information_schema')
    and n.nspname not like 'pg_temp%' and n.nspname not like 'pg_to%'
  union all

  -- Policies, with the command and roles they actually cover.
  select 'policy'::text, pol.polname::text,
         (coalesce(pol.polrelid::regclass::text, '(schema)') || ' -> '
          || pol.polcmd::text || ' for '
          || coalesce(pg_get_userbyid(pol.polroles[1])::text, '?'))::text
  from pg_policy pol
  union all

  -- Triggers, including the auth.users profile trigger the README calls out.
  select 'trigger'::text, t.tgname::text,
         (t.tgrelid::regclass::text || ' type=' || t.tgtype::text
          || case when t.tgisinternal then ' (internal)' else '' end)::text
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname not in ('pg_catalog', 'information_schema')
    and n.nspname not like 'pg_temp%' and n.nspname not like 'pg_to%'
    and not t.tgisinternal
  union all

  -- Tables with RLS off. Anything listed here is readable or writable by any
  -- granted role and is the single most important thing to review.
  select 'rls_disabled'::text, c.relname::text, 'ROW LEVEL SECURITY IS NOT ENABLED'::text
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  union all

  -- Browser-facing grants. Anon access to anything unexpected is a finding.
  select ('grant:' || grantee)::text, table_name::text,
         string_agg(privilege_type, ',' order by privilege_type)::text
  from information_schema.role_table_grants
  where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC')
  group by grantee, table_name
  union all

  -- Execution grants on functions, to catch RPCs open to anonymous callers.
  select ('function_grant:' || grantee)::text, routine_name::text,
         string_agg(privilege_type, ',' order by privilege_type)::text
  from information_schema.role_routine_grants
  where routine_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC')
  group by grantee, routine_name
  union all

  -- Realtime publication membership, which REALTIME.md flags as easy to miss.
  select 'publication'::text, pubname::text, ('table=' || tablename)::text
  from pg_publication_tables
  union all

  -- Whether a migration ledger exists. Its absence is why the applied set has to
  -- be reconstructed by diffing object names against the manifest.
  select 'ledger'::text, table_name::text, 'present'::text
  from information_schema.tables
  where table_schema = 'public'
    and table_name ~ '(migration|schema_version|flyway|alembic|seq_log)'
)
select object_kind, object_name, detail from objects order by object_kind, object_name;