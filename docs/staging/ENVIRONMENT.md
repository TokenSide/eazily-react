# Staging environment inventory

Names and descriptions only. Put real values in the operator's secret manager or untracked local files; never paste them into chat, command arguments, logs, Git, screenshots or documentation. Existing environment files were not changed.

| Name | Purpose / location |
| --- | --- |
| VITE_SUPABASE_URL | Public URL of the independently confirmed staging project; required for staging builds |
| VITE_SUPABASE_ANON_KEY | Public anon key from that same project; never a service-role key |
| VITE_PARTNER_DEMO | Explicitly disable for staging |
| VITE_ENABLE_CONSULTANT_ASSESSMENT_TEST_SKIP | Explicitly disable for staging |
| VITE_ENABLE_SERVICE_REGISTRATION_TEST_SKIP | Explicitly disable for staging |
| EAZILY_TARGET_ENV | Operator's non-production environment label; not sufficient identity proof |
| SUPABASE_PROJECT_REF | Explicit staging reference; must equal link and browser URL reference |
| SUPABASE_ACCESS_TOKEN | Server/operator-only CLI login credential |
| SUPABASE_DB_PASSWORD | Server/operator-only CLI database credential |
| PGSERVICE | PostgreSQL service name for the verified staging target, configured outside the repository |
| PGSERVICEFILE | Secure PostgreSQL connection-service file location; avoid URLs/passwords in command lines |
| PGPASSFILE | Restricted PostgreSQL password file location, outside Git |
| PGSSLMODE | Require verified TLS for remote PostgreSQL connections |
| PGSSLROOTCERT | Trusted certificate location when required by PostgreSQL verification |
| EAZILY_BACKUP_DIR | Absolute, restricted, encrypted backup directory outside the project |
| SUPABASE_URL | Platform-provided server URL inside Edge Functions |
| SUPABASE_ANON_KEY | Platform-provided key used by Edge Functions to authenticate caller sessions |
| SUPABASE_SERVICE_ROLE_KEY | Platform-provided privileged Edge credential; never in Vite or browser code |
| AUTOMATION_SCHEDULER_SECRET | Additional worker authentication secret, Supabase secrets only; no scheduler activation |
| EAZILY_FINANCIAL_PROVIDERS_ENABLED | Server-only financial provider gate; keep disabled, including webhook ingestion |
| CASHFREE_CLIENT_ID | Unavailable provider credential; do not set in this staging task |
| CASHFREE_CLIENT_SECRET | Unavailable provider/signature credential; do not set |
| CASHFREE_INTERNAL_SECRET | Unavailable trusted payout workflow secret; do not set |
| CASHFREE_BASE_URL | Provider endpoint; no provider activation authorized |

No workbook, SMS, push or email credentials are required for a paused backend. Their adapters/providers remain unavailable. SMS activation and account recovery are pending, outside this task.

Preflight prints variable presence only, plus the non-secret project reference. It does not load `.env.example` as real configuration. Staging must use a production Vite build with actual public Supabase settings: the existing unconfigured app has a local `0000` demo login and must never be shipped as staging. No real staging authentication was tested here.
