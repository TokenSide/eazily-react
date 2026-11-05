<#
  Eazily staging migration runner (Windows PowerShell 5.1+).

  Modes:
    (default)  DRY-RUN: local checks only. No database connection, no ledger writes.
    -Verify    Dry-run checks + READ-ONLY target check (identity, hosted migration
               history, schema state vs. local ledger). No writes anywhere.
               Bounded: connect_timeout 10s per address, lock_timeout 5s,
               statement_timeout 20s, whole Docker/psql run -VerifyTimeoutSeconds
               (default 60); a timeout stops the container and reports BLOCKED.
    -Apply     -Verify first, then each manifest file in its own psql run, in
               manifest order, stopping at the first error. After a failed or
               interrupted file the runner refuses to continue until an operator
               reconciles it manually (docs/staging/RUNBOOK.md).

  psql runs from the already-downloaded Supabase PostgreSQL Docker image
  (--pull never), so no separate client install is needed.

  Credentials stay outside the repository in a libpq connection-service file
  (PGSERVICE/PGSERVICEFILE) plus a password file (PGPASSFILE). PGPASSWORD is
  never read or passed. Only file names, sequence numbers, hash results, exit
  codes, SQLSTATE codes and schema object names are printed - never secrets,
  connection details, SQL text or psql output.
#>
[CmdletBinding()]
param(
  [switch]$Apply,
  [switch]$Verify,
  [string]$ConfirmProjectRef = '',
  [ValidateRange(1, 1000)][int]$Through = 1000,
  [string]$Service = $env:PGSERVICE,
  [string]$ServiceFile = $env:PGSERVICEFILE,
  [string]$PassFile = $env:PGPASSFILE,
  [string]$DockerImage = 'public.ecr.aws/supabase/postgres:17.6.1.171',
  [string]$DockerNetwork = 'bridge',
  # Rehearsal only: a named local database target instead of the hosted project.
  [ValidatePattern('^$|^[a-z0-9-]+$')][string]$LocalTarget = '',
  # Hard limit for the whole read-only verification (Docker start, connect, queries).
  [ValidateRange(20, 600)][int]$VerifyTimeoutSeconds = 60
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

$ExpectedRef = 'ahwbgmnfmzsaiwjglbkb'
$ExpectedCount = 48
# Supabase platform definer helpers reviewed read-only; must match exactly. Keep in sync with
# the exceptions in staging_security.sql and auth_account_security.sql.
$PlatformDefiners = @{
  'public.rls_auto_enable' = @{ args = '0'; returns = 'event_trigger'; language = 'plpgsql'; owner = 'postgres'; config = '{search_path=pg_catalog}'; sha256 = '2782e98b348aca7d6f6f73c420fd78d2e094957dd7a52b0483d4c34f29d2a7a1' }
}
$Root = Split-Path -Parent $PSScriptRoot
$Supabase = Join-Path $Root 'supabase'
$IsLocal = [bool]$LocalTarget
$TargetKey = $ExpectedRef
if ($IsLocal) { $TargetKey = "local-$LocalTarget" }
$LedgerDir = Join-Path $Root '.tmp\staging-migrations'
$LedgerPath = Join-Path $LedgerDir "$TargetKey.ledger.json"
$LockPath = Join-Path $LedgerDir "$TargetKey.lock"
if (-not $ServiceFile) { $ServiceFile = Join-Path $env:APPDATA 'postgresql\.pg_service.conf' }
if (-not $PassFile) { $PassFile = Join-Path $env:APPDATA 'postgresql\pgpass.conf' }
$Connects = $Verify -or $Apply

$script:Blocked = 0
function Pass($name, $detail) { Write-Host "PASS: $name - $detail" }
function Block($name, $detail) { $script:Blocked++; Write-Host "BLOCKED: $name - $detail" -ForegroundColor Red }
function Warn($name, $detail) { Write-Host "WARN: $name - $detail" -ForegroundColor Yellow }
# Connection prerequisites only block when the run will connect.
function Need($ok, $name, $okDetail, $failDetail) { if ($ok) { Pass $name $okDetail } elseif ($Connects) { Block $name $failDetail } else { Warn $name $failDetail } }
function Sha256($path) { (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Test-OutsideRepo($path) { -not ([IO.Path]::GetFullPath($path)).StartsWith($Root + '\', [StringComparison]::OrdinalIgnoreCase) }
# libpq connect_timeout per address; passed in the conninfo so a service-file value cannot override it.
$ConnectTimeoutSeconds = 10
$DockerCliTimeoutSeconds = 30
function Quote-Arg([string]$s) {
  if ($s -and $s -notmatch '[\s"]') { return $s }
  $r = '"'; $bs = 0
  foreach ($ch in $s.ToCharArray()) {
    if ($ch -eq '\') { $bs++ }
    elseif ($ch -eq '"') { $r += ('\' * ($bs * 2 + 1)) + '"'; $bs = 0 }
    else { $r += ('\' * $bs) + $ch; $bs = 0 }
  }
  return $r + ('\' * ($bs * 2)) + '"'
}
# Short Docker CLI calls (inspect/kill) with a hard limit; -1 means it did not answer in time.
function Invoke-DockerCli([string[]]$cliArgs, [int]$seconds = $DockerCliTimeoutSeconds) {
  $cli = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $cli) { return -2 }
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $cli.Source; $psi.Arguments = ($cliArgs | ForEach-Object { Quote-Arg $_ }) -join ' '
  $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
  $p = [Diagnostics.Process]::Start($psi)
  $null = $p.StandardOutput.ReadToEndAsync(); $null = $p.StandardError.ReadToEndAsync()
  if (-not $p.WaitForExit($seconds * 1000)) { try { $p.Kill() } catch { }; return -1 }
  return $p.ExitCode
}

$mode = 'DRY-RUN (no database connection, no ledger writes)'
if ($Verify) { $mode = 'VERIFY (read-only database check, no writes)' }
if ($Apply) { $mode = 'APPLY' }
Write-Host "Eazily staging migration runner - mode: $mode - target: $TargetKey"

# 1. Linked project identity (local CLI link files; no remote call).
if ($IsLocal) {
  Warn 'Target' "local rehearsal target '$LocalTarget'; hosted project identity checks skipped"
} else {
  $refFile = Join-Path $Supabase '.temp\project-ref'
  $linked = ''
  if (Test-Path -LiteralPath $refFile) { $linked = (Get-Content -LiteralPath $refFile -Raw).Trim() }
  if ($linked -eq $ExpectedRef) { Pass 'Linked project ref' $ExpectedRef } else { Block 'Linked project ref' "supabase/.temp/project-ref must equal $ExpectedRef" }
  $linkedJson = Join-Path $Supabase '.temp\linked-project.json'
  $jsonRef = ''
  if (Test-Path -LiteralPath $linkedJson) { try { $jsonRef = [string](Get-Content -LiteralPath $linkedJson -Raw | ConvertFrom-Json).ref } catch { $jsonRef = '' } }
  if ($jsonRef -eq $ExpectedRef) { Pass 'linked-project.json ref' 'matches' } else { Block 'linked-project.json ref' 'missing or different' }
  if ($env:SUPABASE_PROJECT_REF -and $env:SUPABASE_PROJECT_REF -ne $ExpectedRef) { Block 'SUPABASE_PROJECT_REF' 'set but differs from expected ref' }
  if ($env:VITE_SUPABASE_URL) {
    $urlHost = ''
    try { $urlHost = ([Uri]$env:VITE_SUPABASE_URL).Host } catch { $urlHost = '' }
    if ($urlHost -ne "$ExpectedRef.supabase.co") { Block 'VITE_SUPABASE_URL' 'set but host does not belong to expected ref' }
  }
}

# 2. Manifest order, files, hashes and dependencies.
$manifest = Get-Content -LiteralPath (Join-Path $Supabase 'migration-manifest.json') -Raw | ConvertFrom-Json
$migrations = @($manifest.migrations | Sort-Object { [int]$_.sequence })
if ($migrations.Count -eq $ExpectedCount) { Pass 'Manifest size' "$ExpectedCount files" } else { Block 'Manifest size' "expected $ExpectedCount, found $($migrations.Count)" }
$seqOf = @{}
for ($i = 0; $i -lt $migrations.Count; $i++) {
  $m = $migrations[$i]
  if ([int]$m.sequence -ne $i + 1) { Block 'Manifest sequence' "gap or duplicate at position $($i + 1)" }
  if ($seqOf.ContainsKey($m.file)) { Block 'Manifest files' "duplicate entry $($m.file)" }
  $seqOf[$m.file] = [int]$m.sequence
}
$hashFailures = 0; $depFailures = 0
foreach ($m in $migrations) {
  $path = Join-Path $Supabase $m.file
  if (-not (Test-Path -LiteralPath $path)) { Block 'Migration file' "$($m.sequence) $($m.file) missing"; $hashFailures++; continue }
  if ((Sha256 $path) -ne ([string]$m.sha256).ToLowerInvariant()) { Block 'SHA-256' "$($m.sequence) $($m.file) does not match manifest"; $hashFailures++ }
  foreach ($p in @($m.requiredPredecessors)) {
    if (-not $seqOf.ContainsKey($p) -or $seqOf[$p] -ge [int]$m.sequence) { Block 'Dependency' "$($m.sequence) $($m.file) -> $p is not an earlier manifest entry"; $depFailures++ }
  }
}
if ($hashFailures -eq 0) { Pass 'SHA-256' "all $($migrations.Count) files match manifest" }
if ($depFailures -eq 0) { Pass 'Dependencies' 'every predecessor is an earlier manifest entry' }
$unlisted = @(Get-ChildItem -LiteralPath $Supabase -Filter *.sql -File | Where-Object { -not $seqOf.ContainsKey($_.Name) } | ForEach-Object Name)
foreach ($u in $unlisted) { Warn 'Not in manifest' "$u will never be applied by this runner" }
# Named app objects, attributed to the first manifest file that introduces them.
$introducedBy = @{}
foreach ($m in $migrations) { foreach ($o in @($m.objects)) { if ($o -match '^(public|eazily_private)\.[a-z0-9_]+$' -and -not $introducedBy.ContainsKey($o)) { $introducedBy[$o] = $m.file } } }

# 3. Local ledger: blocks automatic rerun after partial failure or interruption.
$ledger = @()
if (Test-Path -LiteralPath $LedgerPath) { $ledger = @((Get-Content -LiteralPath $LedgerPath -Raw | ConvertFrom-Json) | ForEach-Object { $_ }) }
$applied = @{}
foreach ($e in $ledger) {
  if ($e.status -eq 'applied') {
    $applied[$e.file] = $true
    $m = $migrations | Where-Object { $_.file -eq $e.file }
    if (-not $m -or $m.sha256 -ne $e.sha256) { Block 'Ledger' "$($e.file) was applied with a different hash; reconcile before continuing" }
  } else {
    Block 'Ledger' "$($e.sequence) $($e.file) is '$($e.status)'. No automatic rerun: inspect the target per RUNBOOK, then record the resolution manually"
  }
}
if (Test-Path -LiteralPath $LockPath) { Block 'Lock' 'a previous run is active or was interrupted; inspect the target before removing the lock file manually' }

# 4. Plan.
$plan = @($migrations | Where-Object { [int]$_.sequence -le $Through -and -not $applied.ContainsKey($_.file) })
foreach ($m in $plan) {
  foreach ($p in @($m.requiredPredecessors)) {
    if (-not $applied.ContainsKey($p) -and -not ($plan | Where-Object { $_.file -eq $p })) { Block 'Plan dependency' "$($m.file) needs $p, which is neither applied nor planned" }
  }
}
Write-Host "Plan: $($applied.Count) recorded as applied, $($plan.Count) to apply (through sequence $([Math]::Min($Through, $migrations.Count)))"
foreach ($m in $plan) { Write-Host ("  {0,2}  {1}" -f $m.sequence, $m.file) }

# 5. Connection configuration (values never printed).
$svc = @{}
$serviceOk = [bool]$Service -and $Service -match '^[A-Za-z0-9_.-]+$'
Need $serviceOk 'PGSERVICE' 'service name set' 'set PGSERVICE (or -Service) to the connection-service name'
$sfOk = (Test-Path -LiteralPath $ServiceFile) -and (Test-OutsideRepo $ServiceFile)
Need $sfOk 'PGSERVICEFILE' 'present outside the repository' 'service file missing or inside the repository'
$pfOk = (Test-Path -LiteralPath $PassFile) -and (Test-OutsideRepo $PassFile)
Need $pfOk 'PGPASSFILE' 'present outside the repository' 'password file missing or inside the repository'
if ($env:PGPASSWORD) { Warn 'PGPASSWORD' 'is set in this shell but is ignored and never passed to psql' }
if ($serviceOk -and $sfOk) {
  $section = ''
  foreach ($line in Get-Content -LiteralPath $ServiceFile) {
    $t = $line.Trim()
    if ($t -match '^\[(.+)\]$') { $section = $Matches[1]; continue }
    if ($section -eq $Service -and $t -match '^([a-z_]+)\s*=\s*(.*)$') { $svc[$Matches[1]] = $Matches[2].Trim() }
  }
  $hostName = ''; $port = '5432'; $user = ''; $db = ''; $ssl = ''
  if ($svc.ContainsKey('host')) { $hostName = $svc['host'] }
  if ($svc.ContainsKey('port')) { $port = $svc['port'] }
  if ($svc.ContainsKey('user')) { $user = $svc['user'] }
  if ($svc.ContainsKey('dbname')) { $db = $svc['dbname'] }
  if ($svc.ContainsKey('sslmode')) { $ssl = $svc['sslmode'] }
  Need ($svc.Count -gt 0 -and $hostName -and $user -and $db) 'Service section' 'host/user/dbname defined' "section [$Service] missing host, user or dbname"
  Need (-not $svc.ContainsKey('password')) 'Service password' 'no password in service file' 'remove password= from the service file; keep it in PGPASSFILE'
  if ($IsLocal) {
    Need ($hostName -notmatch 'supabase\.(co|com)$') 'Local target host' 'not a hosted Supabase host' 'local rehearsal must not point at a hosted Supabase host'
  } else {
    $direct = $hostName -eq "db.$ExpectedRef.supabase.co" -and $user -eq 'postgres'
    $pooler = $hostName -like '*.pooler.supabase.com' -and $user -eq "postgres.$ExpectedRef"
    Need ($direct -or $pooler) 'Target identity (config)' "host/user belong to $ExpectedRef" "host/user do not belong to $ExpectedRef"
    Need ($port -ne '6543') 'Pooler mode' 'not the transaction pooler' 'use session mode (5432), not transaction pooler port 6543'
    Need ($ssl -in @('require', 'verify-ca', 'verify-full')) 'TLS' "sslmode=$ssl" 'set sslmode=require (or verify-full) for the hosted target'
  }
  if ($pfOk) {
    $passBytes = [IO.File]::ReadAllBytes($PassFile)
    $hasBom = $passBytes.Length -ge 3 -and $passBytes[0] -eq 239 -and $passBytes[1] -eq 187 -and $passBytes[2] -eq 191
    Need (-not $hasBom -and $passBytes -notcontains 0) 'Password file encoding' 'UTF-8-compatible, no BOM or NUL bytes' 'password file has a BOM or NUL bytes; use UTF-8 without BOM'
    $entries = @(Get-Content -LiteralPath $PassFile | Where-Object { $_ -and -not $_.StartsWith('#') } | Where-Object {
      $f = $_.Split(':')
      $f.Count -ge 5 -and $f[4].Length -gt 0 -and ($f[0] -in @('*', $hostName)) -and ($f[1] -in @('*', $port)) -and ($f[2] -in @('*', $db)) -and ($f[3] -in @('*', $user))
    })
    Need ($entries.Count -gt 0) 'Password entry' 'nonempty matching PGPASSFILE entry found' 'no nonempty PGPASSFILE line matches host:port:dbname:user of the service'
    if ($entries.Count) {
      # libpq uses the first matching line; a template value there always fails authentication.
      $pwField = $entries[0].Split(':', 5)[4]
      $placeholder = $pwField -match '(?i)^<.*>$|PLACEHOLDER|YOUR[_ -]?(DB[_ -]?)?PASSWORD|REPLACE[_ -]?ME|CHANGE[_ -]?ME'
      Need (-not $placeholder) 'Password value' 'not a template placeholder' 'the matching PGPASSFILE line still holds a template placeholder; paste the current database password (escape : and \ as \: and \\)'
    }
  }
}

# 6. psql from the local Docker image (never pulled).
$docker = Get-Command docker -ErrorAction SilentlyContinue
$dockerOk = $false
if ($docker) {
  $imageRc = Invoke-DockerCli @('image', 'inspect', $DockerImage)
  $netRc = -3
  if ($imageRc -ne -1) { $netRc = Invoke-DockerCli @('network', 'inspect', $DockerNetwork) }
  $noAnswer = "Docker did not answer within ${DockerCliTimeoutSeconds}s (Docker Desktop stopped, starting or paused?)"
  if ($imageRc -eq -1) { Need $false 'psql image' '' $noAnswer } else { Need ($imageRc -eq 0) 'psql image' "$DockerImage present locally" "$DockerImage not present locally (not pulled automatically)" }
  if ($netRc -eq -1) { Need $false 'Docker network' '' $noAnswer } elseif ($netRc -ne -3) { Need ($netRc -eq 0) 'Docker network' $DockerNetwork "network $DockerNetwork not found" }
  $dockerOk = $imageRc -eq 0 -and $netRc -eq 0
} else { Need $false 'Docker' '' 'docker not found; start Docker Desktop' }

if ($Apply -and $ConfirmProjectRef -ne $TargetKey) { Block 'Confirmation' "-ConfirmProjectRef $TargetKey is required for apply" }
if ($script:Blocked -gt 0) { Write-Host "RESULT: BLOCKED ($($script:Blocked) check(s)). Nothing was applied." -ForegroundColor Red; exit 1 }
if (-not $Connects) { Write-Host 'RESULT: DRY-RUN OK. No database connection or change was made.' -ForegroundColor Green; exit 0 }

# ---- Database access (Verify / Apply) ----
# Classify failures from psql/libpq stderr without echoing any server text, host or user.
function Get-FailureClass([string]$err, [int]$exit) {
  # 124 (coreutils) or 143/137 (BusyBox TERM/KILL) from the in-container timeout; psql itself exits 0-3.
  if ($exit -in @(124, 137, 143)) { return 'timeout' }
  $codes =@([regex]::Matches($err, '(?:ERROR|FATAL):\s+([0-9A-Z]{5})\b') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
  if ($codes.Count) { return $codes -join ',' }
  $classes = [ordered]@{
    'no password supplied' = 'credential-not-selected'; 'password authentication failed' = 'credential-rejected'
    'timeout expired' = 'connect-timeout'; 'could not translate host name' = 'dns-failure'
    'Tenant or user not found' = 'pooler-tenant-not-found'; 'Circuit breaker|too many' = 'pooler-or-connection-limit'
    'Connection refused' = 'connection-refused'; 'Network is unreachable' = 'network-unreachable'
    'server closed the connection' = 'server-closed'; 'SSL' = 'tls-error'
  }
  foreach ($k in $classes.Keys) { if ($err -match $k) { return $classes[$k] } }
  if ($exit -eq 125) { return 'docker-error' }
  if ($exit -eq 2) { return 'connection' }
  return ''
}
# TimeoutSeconds > 0 bounds the whole Docker/psql run (Verify). 0 keeps a migration file
# running to completion (Apply): killing a file mid-way would leave partial state.
function Invoke-Psql([string[]]$psqlArgs, [string]$stdin = '', [int]$TimeoutSeconds = 0) {
  $name = 'eazily-psql-' + [guid]::NewGuid().ToString('N').Substring(0, 12)
  $inner = 0
  if ($TimeoutSeconds -gt 0) { $inner = [Math]::Max(10, $TimeoutSeconds - 5) }
  # Windows bind mounts can have Unix-incompatible permissions and CRLF endings.
  # Keep normalized copies private inside this short-lived container only.
  $boot = 'umask 077 && tr -d ''\r'' < /run/eazily-pg/pgpass.src > /tmp/eazily-pgpass && chmod 600 /tmp/eazily-pgpass && tr -d ''\r'' < /run/eazily-pg/pg_service.conf > /tmp/eazily-pg_service.conf && chmod 600 /tmp/eazily-pg_service.conf && export PGPASSFILE=/tmp/eazily-pgpass PGSERVICEFILE=/tmp/eazily-pg_service.conf && echo EAZILY-PHASE container >&2 && if [ "${EAZILY_PSQL_TIMEOUT:-0}" -gt 0 ]; then timeout -s TERM -k 5 "$EAZILY_PSQL_TIMEOUT" psql "$@"; exit $?; else exec psql "$@"; fi'
  # Not exec'd on purpose: as container PID 1, psql would ignore the (BusyBox) timeout signals.
  $conninfo = "service=$Service connect_timeout=$ConnectTimeoutSeconds keepalives=1 keepalives_idle=10 keepalives_interval=5 keepalives_count=3"
  $dockerArgs = @('run', '--rm', '-i', '--pull', 'never', '--name', $name, '--network', $DockerNetwork,
    '--mount', "type=bind,source=$([IO.Path]::GetFullPath($ServiceFile)),target=/run/eazily-pg/pg_service.conf,readonly",
    '--mount', "type=bind,source=$([IO.Path]::GetFullPath($PassFile)),target=/run/eazily-pg/pgpass.src,readonly",
    '--mount', "type=bind,source=$Supabase,target=/work/supabase,readonly",
    '-e', "PGSERVICE=$Service", '-e', 'PGAPPNAME=eazily-staging-migrate', '-e', "PGCONNECT_TIMEOUT=$ConnectTimeoutSeconds", '-e', "EAZILY_PSQL_TIMEOUT=$inner",
    '--entrypoint', '/bin/sh', $DockerImage, '-c', $boot, 'psql',
    '-X', '--no-password', '-d', $conninfo, '-q', '-A', '-t', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-v', 'SHOW_CONTEXT=never') + $psqlArgs
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $docker.Source
  $psi.Arguments = ($dockerArgs | ForEach-Object { Quote-Arg $_ }) -join ' '
  $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true
  $psi.RedirectStandardInput = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true
  [void]$psi.EnvironmentVariables.Remove('PGPASSWORD')
  $proc = [Diagnostics.Process]::Start($psi)
  $outTask = $proc.StandardOutput.ReadToEndAsync(); $errTask = $proc.StandardError.ReadToEndAsync()
  $deadline = [DateTime]::MaxValue
  if ($TimeoutSeconds -gt 0) { $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds) }
  $timedOut = $false
  try {
    # Write stdin asynchronously: a synchronous write blocks forever if docker never reads it.
    $bytes = [Text.Encoding]::UTF8.GetBytes($stdin)
    $writeTask = $proc.StandardInput.BaseStream.WriteAsync($bytes, 0, $bytes.Length)
    while (-not $writeTask.IsCompleted -and -not $proc.HasExited -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
    if ($writeTask.IsCompleted) { try { $proc.StandardInput.Close() } catch { } }
    # Short waits keep Ctrl+C responsive; the finally block then stops the container.
    while (-not $proc.WaitForExit(250)) { if ([DateTime]::UtcNow -ge $deadline) { $timedOut = $true; break } }
  } finally {
    if ($TimeoutSeconds -gt 0 -and -not $proc.HasExited) {
      # Killing docker.exe alone would orphan the container and its database session.
      $null = Invoke-DockerCli @('kill', $name) 15
      try { $proc.Kill() } catch { }
      $null = $proc.WaitForExit(5000)
    }
  }
  $null = $outTask.Wait(5000); $null = $errTask.Wait(5000)
  $err = ''; $out = ''
  if ($errTask.IsCompleted -and -not $errTask.IsFaulted) { $err = $errTask.Result }
  if ($outTask.IsCompleted -and -not $outTask.IsFaulted) { $out = $outTask.Result }
  $phase = 'docker-start'
  $marks = [regex]::Matches($err, 'EAZILY-PHASE (\w+)')
  if ($marks.Count) { $phase = $marks[$marks.Count - 1].Groups[1].Value }
  $exit = -1
  if ($proc.HasExited) { $exit = $proc.ExitCode }
  $state = Get-FailureClass $err $exit
  if ($timedOut) { $state = 'timeout' }
  # Only marker lines emitted by this runner are parsed; all other output is discarded.
  $rows = @($out -split "`r?`n" | Where-Object { $_.StartsWith('EAZILY|') } | ForEach-Object { , ($_.Split('|')) })
  return @{ Exit = $exit; SqlState = $state; Rows = $rows; TimedOut = ($timedOut -or $state -eq 'timeout'); Phase = $phase }
}
function Get-ObjectCheckSql([string[]]$names) {
  if (-not $names -or $names.Count -eq 0) { return '' }
  $values = ($names | ForEach-Object { "('$_')" }) -join ','
  return "SELECT 'EAZILY','obj',o.n,(EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace WHERE s.nspname=split_part(o.n,'.',1) AND c.relname=split_part(o.n,'.',2)) OR EXISTS(SELECT 1 FROM pg_type t JOIN pg_namespace s ON s.oid=t.typnamespace WHERE s.nspname=split_part(o.n,'.',1) AND t.typname=split_part(o.n,'.',2)) OR EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace WHERE s.nspname=split_part(o.n,'.',1) AND p.proname=split_part(o.n,'.',2)))::text FROM (VALUES $values) o(n);"
}
function Invoke-TargetVerification {
  $count = { param($rel) "CASE WHEN to_regclass('$rel') IS NULL THEN '-1' ELSE (xpath('/row/c/text()', query_to_xml('SELECT count(*) AS c FROM $rel', false, true, '')))[1]::text END" }
  # \warn markers go to unbuffered stderr, so a timeout can report how far the run got.
  # SET LOCAL limits bound lock waits and slow statements inside this read-only transaction.
  $sql = @"
\warn EAZILY-PHASE connected
BEGIN READ ONLY;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '30s';
SELECT 'EAZILY','identity',current_user,current_database(),pg_is_in_recovery()::text,(to_regclass('auth.users') IS NOT NULL)::text,(to_regclass('storage.objects') IS NOT NULL)::text,current_setting('server_version_num');
\warn EAZILY-PHASE history
SELECT 'EAZILY','cli_history',$(& $count 'supabase_migrations.schema_migrations');
SELECT 'EAZILY','manual_ledger',$(& $count 'eazily_private.staging_migration_history');
\warn EAZILY-PHASE catalog
SELECT 'EAZILY','public_relations',count(*)::text FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace WHERE s.nspname='public' AND c.relkind IN ('r','p','v','m','S','f');
SELECT 'EAZILY','definer',s.nspname||'.'||p.proname,coalesce((SELECT substr(c,13) FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%' LIMIT 1),''),p.pronargs::text,p.prorettype::regtype::text,l.lanname,pg_get_userbyid(p.proowner),coalesce(p.proconfig::text,''),encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang WHERE p.prosecdef AND s.nspname IN ('public','eazily_private');
SELECT 'EAZILY','evt',e.evtname,e.evtevent,e.evtenabled::text,coalesce(array_to_string(e.evttags,','),''),s.nspname||'.'||p.proname FROM pg_event_trigger e JOIN pg_proc p ON p.oid=e.evtfoid JOIN pg_namespace s ON s.oid=p.pronamespace WHERE s.nspname IN ('public','eazily_private');
$(Get-ObjectCheckSql @($introducedBy.Keys))
\warn EAZILY-PHASE done
COMMIT;
"@
  Write-Host "INFO: connecting read-only (connect timeout ${ConnectTimeoutSeconds}s per address, hard limit ${VerifyTimeoutSeconds}s)..."
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $r = Invoke-Psql @('-f', '-') $sql $VerifyTimeoutSeconds
  $took = [int]$sw.Elapsed.TotalSeconds
  $where = @{ 'docker-start' = 'starting the psql container'; 'container' = 'connecting (DNS/TCP/TLS/auth or pooler queue)'; 'connected' = 'opening the read-only transaction'; 'history' = 'reading migration history'; 'catalog' = 'reading the catalog'; 'done' = 'committing' }[$r.Phase]
  if ($r.TimedOut) { Block 'Target verification' "timed out after ${took}s while $where; psql container stopped, nothing was applied"; return }
  if ($r.Exit -ne 0) {
    $hint = ''
    if ($r.SqlState -match '55P03') { $hint = ' (lock wait: another session holds a conflicting lock, e.g. a restore/migration in progress)' }
    elseif ($r.SqlState -match '57014') { $hint = ' (statement timeout)' }
    elseif ($r.SqlState -eq 'credential-rejected') { $hint = ' (the PGPASSFILE password is not the current database password)' }
    Block 'Target verification' "read-only check failed after ${took}s while $where (exit $($r.Exit), $($r.SqlState))$hint; nothing was applied"; return
  }
  Pass 'Target connection' "read-only check completed in ${took}s"
  $identity = $r.Rows | Where-Object { $_[1] -eq 'identity' } | Select-Object -First 1
  $value = { param($k) ($r.Rows | Where-Object { $_[1] -eq $k } | Select-Object -First 1)[2] }
  if (-not $identity) { Block 'Target verification' 'no identity row returned'; return }
  $exists = @{}; foreach ($row in $r.Rows | Where-Object { $_[1] -eq 'obj' }) { $exists[$row[2]] = $row[3] -eq 'true' }
  if ($identity[4] -eq 'false') { Pass 'Target role' 'primary (not a read replica)' } else { Block 'Target role' 'target is in recovery / read-only replica' }
  if ($identity[5] -eq 'true' -and $identity[6] -eq 'true') { Pass 'Managed schemas' 'auth.users and storage.objects present' } else { Block 'Managed schemas' 'auth.users or storage.objects missing; not a Supabase target' }
  if ($IsLocal -or $identity[2] -eq 'postgres') { Pass 'Session identity' "connected as $($identity[2]) to $($identity[3]), server $($identity[7])" } else { Block 'Session identity' 'hosted migrations must run as postgres' }
  $cli = [int](& $value 'cli_history'); $manual = [int](& $value 'manual_ledger'); $rels = [int](& $value 'public_relations')
  if ($cli -gt 0) { Block 'Hosted CLI history' "supabase_migrations.schema_migrations has $cli row(s); this layout never uses db push - reconcile first" } else { Pass 'Hosted CLI history' 'empty or absent (empty history does not prove an empty database)' }
  if ($manual -gt 0) { Block 'Manual ledger' "eazily_private.staging_migration_history has $manual row(s); reconcile with the local ledger first" } elseif ($manual -eq 0) { Warn 'Manual ledger' 'table exists but is empty' } else { Pass 'Manual ledger' 'absent' }
  $missing = @($introducedBy.Keys | Where-Object { $applied.ContainsKey($introducedBy[$_]) -and -not $exists[$_] })
  $unexpected = @($introducedBy.Keys | Where-Object { -not $applied.ContainsKey($introducedBy[$_]) -and $exists[$_] })
  if ($applied.Count -eq 0 -and $rels -gt 0) { Block 'Schema state' "public has $rels relation(s) but the local ledger is empty: populated database needs reviewed baselining, never replay" }
  if ($missing.Count) { Block 'Schema state' "$($missing.Count) object(s) from ledger-applied files missing, e.g. $(($missing | Select-Object -First 5) -join ', ')" }
  if ($unexpected.Count) { Block 'Schema state' "$($unexpected.Count) object(s) from not-yet-applied files already exist, e.g. $(($unexpected | Select-Object -First 5) -join ', ')" }
  if (-not $missing.Count -and -not $unexpected.Count -and -not ($applied.Count -eq 0 -and $rels -gt 0)) { Pass 'Schema state' "matches local ledger ($($applied.Count) applied, $($introducedBy.Count) tracked objects)" }
  # staging_security.sql rejects any definer function with an unreviewed search_path. Catch
  # functions no manifest file defines (e.g. platform-added helpers) before anything is applied.
  $manifestSql = ($migrations | ForEach-Object { Get-Content -LiteralPath (Join-Path $Supabase $_.file) -Raw }) -join "`n"
  foreach ($row in @($r.Rows | Where-Object { $_[1] -eq 'definer' -and $PlatformDefiners.ContainsKey($_[2]) })) {
    $want = $PlatformDefiners[$row[2]]
    $got = @{ args = $row[4]; returns = $row[5]; language = $row[6]; owner = $row[7]; config = $row[8]; sha256 = $row[9] }
    $diff = @($want.Keys | Where-Object { $got[$_] -ne $want[$_] } | Sort-Object)
    if ($diff.Count -and $plan.Count) { Block 'Platform definer' "$($row[2]) differs from the verified fingerprint ($($diff -join ', ')); body sha256 $($row[9]). Staging SQL will reject it" }
    elseif ($diff.Count) { Warn 'Platform definer' "$($row[2]) differs from the verified fingerprint ($($diff -join ', '))" }
    else { Pass 'Platform definer' "$($row[2]) matches the verified Supabase RLS auto-enable fingerprint (narrow exception)" }
  }
  foreach ($row in @($r.Rows | Where-Object { $_[1] -eq 'evt' })) { Warn 'Event trigger' "$($row[2]) on $($row[3]) (enabled=$($row[4]), tags=$($row[5])) calls $($row[6]); fires during migrations" }
  $foreign = @($r.Rows | Where-Object { $_[1] -eq 'definer' -and -not $PlatformDefiners.ContainsKey($_[2]) -and $_[3] -notmatch '^(public|eazily_private)(, ?(public|eazily_private|storage))*(, ?pg_temp)?$' } |
    Where-Object { $manifestSql -notmatch ('\b' + [regex]::Escape($_[2].Split('.')[1]) + '\b') } | ForEach-Object { $_[2] })
  if ($foreign.Count -and $plan.Count) { Block 'Definer functions' "$($foreign -join ', ') not defined by the manifest and has an unreviewed search_path; staging_security.sql will reject it. Review it with the project owner first (not changed automatically)" }
  else { Pass 'Definer functions' 'no foreign SECURITY DEFINER function with an unreviewed search_path' }
}

if ($Verify -and -not $Apply) {
  Invoke-TargetVerification
  if ($script:Blocked -gt 0) { Write-Host "RESULT: BLOCKED ($($script:Blocked) check(s)). Read-only; nothing was changed." -ForegroundColor Red; exit 1 }
  Write-Host 'RESULT: VERIFY OK. Read-only; nothing was changed.' -ForegroundColor Green; exit 0
}
if ($plan.Count -eq 0) { Write-Host 'RESULT: nothing to apply.'; exit 0 }

# ---- Apply ----
function Save-Ledger {
  $tmp = "$LedgerPath.tmp"
  [IO.File]::WriteAllText($tmp, (ConvertTo-Json -InputObject @($script:ledger) -Depth 4), (New-Object Text.UTF8Encoding $false))
  Move-Item -LiteralPath $tmp -Destination $LedgerPath -Force
}
New-Item -ItemType Directory -Force -Path $LedgerDir | Out-Null
$lock = [IO.File]::Open($LockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
$script:ledger = [Collections.ArrayList]@($ledger)
$failed = $false
try {
  Invoke-TargetVerification
  if ($script:Blocked -gt 0) { Write-Host "RESULT: BLOCKED ($($script:Blocked) check(s)). Nothing was applied." -ForegroundColor Red; exit 1 }
  foreach ($m in $plan) {
    $path = Join-Path $Supabase $m.file
    if ((Sha256 $path) -ne $m.sha256) { Write-Host "BLOCKED: $($m.file) changed after checks; stopping." -ForegroundColor Red; $failed = $true; break }
    $post = @($introducedBy.Keys | Where-Object { $introducedBy[$_] -eq $m.file })
    $entry = [pscustomobject]@{ target = $TargetKey; sequence = [int]$m.sequence; file = $m.file; sha256 = $m.sha256; status = 'in_progress'; startedUtc = [DateTime]::UtcNow.ToString('o'); finishedUtc = $null; operator = $env:USERNAME; exitCode = $null; sqlstate = $null }
    [void]$script:ledger.Add($entry); Save-Ledger
    Write-Host ("APPLYING {0,2} {1}" -f $m.sequence, $m.file)
    $psqlArgs = @('-f', "/work/supabase/$($m.file)")
    $check = Get-ObjectCheckSql $post
    if ($check) { $psqlArgs += @('-c', $check) }
    $r = Invoke-Psql $psqlArgs
    $entry.finishedUtc = [DateTime]::UtcNow.ToString('o'); $entry.exitCode = $r.Exit; $entry.sqlstate = $r.SqlState
    $absent = @($r.Rows | Where-Object { $_[1] -eq 'obj' -and $_[3] -ne 'true' } | ForEach-Object { $_[2] })
    $seen = @($r.Rows | Where-Object { $_[1] -eq 'obj' }).Count
    if ($r.Exit -eq 0 -and $seen -eq $post.Count -and $absent.Count -eq 0) { $entry.status = 'applied'; Save-Ledger; Write-Host "  applied (postconditions: $($post.Count) object(s) present)" }
    elseif ($r.Exit -eq 0) { $entry.status = 'failed_postcondition'; Save-Ledger; Write-Host "  FAILED POSTCONDITION: missing $($absent -join ', '). Stopped; reconcile per RUNBOOK before any rerun." -ForegroundColor Red; $failed = $true; break }
    else { $entry.status = 'failed'; Save-Ledger; Write-Host "  FAILED (exit $($r.Exit), SQLSTATE $($r.SqlState)). Stopped; later files blocked. Reconcile partial state per RUNBOOK before any rerun." -ForegroundColor Red; $failed = $true; break }
  }
} finally {
  $lock.Dispose()
  # Keep the lock after a failure so an unattended rerun cannot start.
  if (-not $failed) { Remove-Item -LiteralPath $LockPath -Force }
}
if ($failed) { exit 2 }
Write-Host 'RESULT: all planned files applied. Verify remaining RUNBOOK postconditions before recording deployment evidence.' -ForegroundColor Green
exit 0
