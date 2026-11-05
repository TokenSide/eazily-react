# Backup and recovery gate

No backup was created in this work. CLI/PostgreSQL tools, a verified staging target, and credentials are absent. Command syntax was checked against the official [Supabase CLI reference](https://supabase.com/docs/reference/cli/supabase-db-dump) and [backup/restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore); execution and restore capability remain unverified.

Before any remote write, identify the project in Dashboard, confirm ownership and its staging/development purpose, obtain the user's explicit reference-specific approval, verify a restricted backup destination, and stop writers/schedulers. Do not connect if the environment could be production. Use a PostgreSQL service file and password file outside the repository. `PGSERVICE` must select the exact verified target (including project-specific pooler username if applicable). Never pass a private connection URI on the command line.

Schema-only and data-only CLI alternatives below require a correctly verified link and Docker. Choose one coherent backup method; neither automatically backs up Storage binaries:

```powershell
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$backup = Join-Path $env:EAZILY_BACKUP_DIR $stamp
New-Item -ItemType Directory -Path $backup -ErrorAction Stop
supabase db dump --linked --file "$backup/schema.sql"
if ($LASTEXITCODE -ne 0) { throw 'Schema backup failed' }
supabase db dump --linked --role-only --file "$backup/roles.sql"
if ($LASTEXITCODE -ne 0) { throw 'Role backup failed' }
supabase db dump --linked --data-only --use-copy --file "$backup/data.sql"
if ($LASTEXITCODE -ne 0) { throw 'Data backup failed' }
Get-FileHash "$backup/schema.sql","$backup/roles.sql","$backup/data.sql" -Algorithm SHA256
```

Use UTC when naming backups (`(Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')`). CLI defaults exclude managed schemas from schema dumps. Capture application changes to Auth/Storage (especially the Auth-user trigger and Storage policies) separately and review them against the canonical SQL. Record CLI/PostgreSQL versions, project reference, migration checksums, migration ledger, publication membership and configuration evidence without secrets. Review version-specific managed-schema exclusions using `supabase db dump --help`; if the data dump fails on a managed table, stop and follow the official guide for that server version, never silently skip application data.

Preferred complementary PostgreSQL archives (installed client must support the remote PostgreSQL version):

```powershell
pg_dump --no-password --format=custom --schema-only --file "$backup/full-schema.dump"
if ($LASTEXITCODE -ne 0) { throw 'Full schema backup failed' }
pg_dump --no-password --format=custom --file "$backup/database.dump"
if ($LASTEXITCODE -ne 0) { throw 'Database backup failed' }
pg_restore --list "$backup/database.dump" > "$backup/archive-index.txt"
if ($LASTEXITCODE -ne 0) { throw 'Archive unreadable' }
Get-FileHash "$backup/full-schema.dump","$backup/database.dump" -Algorithm SHA256
```

These use `PGSERVICE`/`PGPASSFILE`, not a command-line secret. Stop if permissions prevent any required table from being backed up. Check nonzero file sizes, archive contents, checksums, and a successful isolated restore before considering the backup usable. An archive list alone does not prove recoverability. Schema/data taken separately require a quiescent source; the custom full database archive gives a consistent database snapshot. Export Storage objects through the authenticated Storage API into encrypted restricted storage, preserving bucket/path metadata and hashes. Database backups contain Storage metadata, not object bytes. Inventory Auth settings, function code versions and secret *names* separately; secret values belong in the secret manager.

Restore rehearsal and incidents:

1. Obtain separate approval for an isolated, positively identified non-production recovery target. Never overwrite the source or production, never reset/drop/truncate a remote database.
2. Prefer a disposable local PostgreSQL/Supabase stack with compatible extensions and managed roles. Point `PGSERVICE` to that recovery target, reverify identity, then use `pg_restore --exit-on-error --no-owner --no-privileges --dbname "service=$env:PGSERVICE" "$backup/database.dump"`. A fresh managed Supabase project already has managed objects: review the archive TOC and construct an operator-reviewed restore list, rather than blindly restoring conflicting Auth/Storage objects. Restore required application ACLs and triggers from the backed-up schema after review.
3. For CLI SQL backups, use the official managed-project restore sequence; inspect roles first, then restore schema and data using `psql -X --no-password -v ON_ERROR_STOP=1 --file ...`. Do not blindly run roles SQL over managed roles. Review any session replication-role changes needed for data import; never use them on the shared source.
4. Stop at the first error. Verify row counts without logging customer content, foreign keys, grants, RLS, Auth associations, Storage bytes and policies, and the paused switches. Record checksums and rehearsal results securely.
5. A failed migration is an incident: stop following migrations, keep traffic/schedulers paused, preserve failed logs safely, determine transaction boundaries, and author a forward repair after review. Do not mark a partial script applied or rerun historical scripts wholesale. Original files contain their own commits; `--single-transaction` cannot make a multi-script batch atomic.
6. Restore into an isolated target only if a forward fix is unsuitable; cutover needs a separate decision and explicit authorization. Rotate exposed secrets, invalidate sessions/signed URLs as appropriate, retain audit evidence, and retest before any resumption. This task never authorizes provider resumption.

Backups must remain outside Git on encrypted storage with restricted operator access and an approved retention policy. `.gitignore` is defense in depth, not an encryption or access-control mechanism.
