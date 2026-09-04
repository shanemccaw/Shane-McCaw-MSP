# entrypoint.ps1 — PowerShell execution container.
#
# Phase 2 (#198): Managed Identity -> Key Vault -> two secrets round-trip,
# reject any HTTP request that doesn't present the bearer token.
# Phase 3 (#210, per #209's approved design + #180's pinned architecture
# comment): real request handling. POST { cmdletKey, params } — cmdletKey
# resolves to one of a fixed, code-owned allowlist of approved cmdlet
# invocations (never an arbitrary script string from the request); params
# are static values merged into that cmdlet's parameters, fill values only,
# never control flow.
#
# #1400 (real fix for #1389's Microsoft.Identity.Client assembly-load
# conflict): this process is now a thin, long-lived DISPATCHER only. It no
# longer imports ExchangeOnlineManagement/MicrosoftTeams and never calls
# Connect-*/a resolved cmdlet itself — every request's actual connect+
# invoke+disconnect work happens in a fresh child pwsh process
# (child-worker.ps1), spawned per request by Invoke-ChildRequest below.
# See child-worker.ps1's header comment for why a fresh process (not lazy
# import in this shared process) is the real fix, and cmdlet-catalog.ps1
# for the allowlist itself (unchanged, just extracted to its own file so
# both this process and the child can dot-source it).
#
# Written directly in PowerShell (not Node/another runtime) because the base
# image is `mcr.microsoft.com/powershell` and pwsh already ships everything
# this phase needs (Invoke-RestMethod for IMDS + Key Vault REST,
# System.Net.HttpListener for the HTTP entrypoint) — no extra runtime or
# package install earns its build-time/image-size cost for a "small
# dedicated service, not a full app" per #198's own framing.
#
# Secrets are read into process memory once at startup and never written to
# disk, logged, or echoed back in any response body. The cert PEM is handed
# to each child over that child's stdin (see Invoke-ChildRequest) — also
# never written to disk — so it crosses the process boundary without ever
# touching the filesystem or a second Key Vault round-trip.

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "common.ps1")
. (Join-Path $PSScriptRoot "cmdlet-catalog.ps1")

# --- Config -----------------------------------------------------------------
#
# AZURE_KEY_VAULT_URL: same env var name/convention as the main api-server's
# artifacts/api-server/src/lib/azure-keyvault.ts — this is the SAME Key Vault
# instance, just a different (Managed Identity, not client-secret) credential
# path, per #198's explicit decision.
$vaultUrl = $env:AZURE_KEY_VAULT_URL
if (-not $vaultUrl) {
    Write-Error "AZURE_KEY_VAULT_URL must be set"
    exit 1
}
$vaultUrl = $vaultUrl.TrimEnd('/')

# Secret names in Key Vault. NOT independently confirmed against a live Key
# Vault — this sandboxed dev environment has no Azure/Managed-Identity
# reachability (same class of limitation CLAUDE.md documents for the
# database: "write it and stop, Shane verifies"). Defaults are this phase's
# best-effort naming, kept consistent with the existing
# `client-{customerId}-appreg` deterministic-name convention documented in
# docs/runbooks/key-vault-credential-rotation.md. Override via env if the
# real names in Key Vault differ.
$certSecretName = if ($env:PS_EXECUTION_CERT_SECRET_NAME) { $env:PS_EXECUTION_CERT_SECRET_NAME } else { "mt-app-cert" }
$bearerSecretName = if ($env:PS_EXECUTION_BEARER_TOKEN_SECRET_NAME) { $env:PS_EXECUTION_BEARER_TOKEN_SECRET_NAME } else { "ps-execution-bearer-token" }

# App registration that owns the cert: per #198's own "Decisions confirmed
# (2026-07-30)" text, the leading (not-yet-independently-verified) candidate
# is MT_APP_CLIENT_ID — the same multi-tenant app registration already used
# for Graph (graph.ts) and, per sharepoint-admin.README.md, already extended
# with certificate-based app-only auth for the SharePoint resource audience.
# Reusing that same app/cert for Exchange.ManageAsApp app-only auth (rather
# than registering a second app) is consistent with that existing pattern.
$mtAppClientId = $env:MT_APP_CLIENT_ID

# Optional: only needed if the Container App's Managed Identity is
# user-assigned rather than system-assigned.
$miClientId = $env:AZURE_MI_CLIENT_ID

$port = if ($env:PORT) { [int]$env:PORT } else { 8080 }

# #1400: how long to let one child process run before it's killed as hung.
# Connect-IPPSSession/Connect-ExchangeOnline's own handshake plus whatever
# the resolved cmdlet needs (e.g. get-mailbox-quota-utilization's per-mailbox
# fan-out) both count against this. 60s is a generous ceiling versus the
# ~1-3s pwsh cold start this session measured (see the build's own
# commit/PR notes for the real benchmark) plus typical EXO/Purview connect
# times reported elsewhere in this codebase's docs — override via env if a
# specific cmdlet genuinely needs longer.
$childTimeoutSeconds = if ($env:PS_EXECUTION_CHILD_TIMEOUT_SECONDS) { [int]$env:PS_EXECUTION_CHILD_TIMEOUT_SECONDS } else { 60 }

# #1277 — revision self-report. Azure Container Apps injects CONTAINER_APP_*
# env vars into every running container; CONTAINER_APP_REVISION is the exact
# revision name that is serving THIS process. Capturing it here (plus the image
# tag and this process's start time) lets an unauthenticated GET /healthz caller
# confirm WHICH revision is actually live from the running code itself — the
# authoritative answer for #1482's "did my fix actually deploy, or did I verify
# against a stale revision?" (#1434 failure mode), independent of the Azure
# control plane's own notion of the active revision.
$script:ContainerAppRevision = if ($env:CONTAINER_APP_REVISION) { $env:CONTAINER_APP_REVISION } else { "unknown" }
$script:ContainerAppName     = if ($env:CONTAINER_APP_NAME) { $env:CONTAINER_APP_NAME } else { "unknown" }
$script:ImageTag             = if ($env:PS_EXECUTION_IMAGE) { $env:PS_EXECUTION_IMAGE } else { "unknown" }
$script:StartedAtUtc         = (Get-Date).ToUniversalTime().ToString("o")

$childWorkerPath = Join-Path $PSScriptRoot "child-worker.ps1"

# --- Managed Identity token acquisition (IMDS) -------------------------------
#
# REST-only, no Az.Accounts module — keeps the image lean (see Dockerfile's
# rationale for baking ExchangeOnlineManagement in at build time to avoid
# slow module installs; the same logic applies to not adding another module
# just to fetch one token type).
function Get-ManagedIdentityToken {
    param([string]$Resource)

    if ($env:IDENTITY_ENDPOINT) {
        # Azure Container Apps / App Service token endpoint. Per Microsoft's
        # docs, the raw VM-style IMDS (169.254.169.254) is NOT reachable from
        # Container Apps — this platform instead exposes a local token
        # service via IDENTITY_ENDPOINT/IDENTITY_HEADER (#203).
        $identityUriBuilder = [System.UriBuilder]::new($env:IDENTITY_ENDPOINT)
        $identityQuery = [System.Web.HttpUtility]::ParseQueryString("")
        $identityQuery["api-version"] = "2019-08-01"
        $identityQuery["resource"] = $Resource
        if ($miClientId) {
            $identityQuery["client_id"] = $miClientId
        }
        $identityUriBuilder.Query = $identityQuery.ToString()
        $identityUrl = $identityUriBuilder.Uri.AbsoluteUri

        Write-Log -Level "info" -Message "requesting Managed Identity token from IDENTITY_ENDPOINT" -Extra @{ url = $identityUrl }
        $response = Invoke-RestMethod -Method Get -Uri $identityUrl -Headers @{ "X-IDENTITY-HEADER" = $env:IDENTITY_HEADER } -TimeoutSec 10
        return $response.access_token
    }

    # Fallback: VM-style IMDS, for any future non-Container-Apps hosting target.
    $imdsUriBuilder = [System.UriBuilder]::new("http://169.254.169.254/metadata/identity/oauth2/token")
    $imdsQuery = [System.Web.HttpUtility]::ParseQueryString("")
    $imdsQuery["api-version"] = "2019-08-01"
    $imdsQuery["resource"] = $Resource
    if ($miClientId) {
        $imdsQuery["client_id"] = $miClientId
    }
    $imdsUriBuilder.Query = $imdsQuery.ToString()
    $imdsUrl = $imdsUriBuilder.Uri.AbsoluteUri

    Write-Log -Level "info" -Message "requesting Managed Identity token from IMDS" -Extra @{ url = $imdsUrl }
    $response = Invoke-RestMethod -Method Get -Uri $imdsUrl -Headers @{ Metadata = "true" } -TimeoutSec 10
    return $response.access_token
}

function Get-KeyVaultSecret {
    param([string]$SecretName, [string]$AccessToken)

    $secretUriBuilder = [System.UriBuilder]::new("$vaultUrl/secrets/$SecretName")
    $secretQuery = [System.Web.HttpUtility]::ParseQueryString("")
    $secretQuery["api-version"] = "7.4"
    $secretUriBuilder.Query = $secretQuery.ToString()
    $secretUrl = $secretUriBuilder.Uri.AbsoluteUri

    Write-Log -Level "info" -Message "requesting secret from Key Vault" -Extra @{ url = $secretUrl }
    $response = Invoke-RestMethod -Method Get -Uri $secretUrl -Headers @{ Authorization = "Bearer $AccessToken" } -TimeoutSec 10
    return $response.value
}

Write-Log -Level "info" -Message "startup: acquiring Managed Identity token for Key Vault"

try {
    $vaultToken = Get-ManagedIdentityToken -Resource "https://vault.azure.net"
}
catch {
    Write-Log -Level "error" -Message "startup: failed to acquire Managed Identity token from IMDS" -Extra @{ error = $_.Exception.Message }
    exit 1
}

try {
    $script:certPem = Get-KeyVaultSecret -SecretName $certSecretName -AccessToken $vaultToken
    Write-Log -Level "info" -Message "startup: cert secret retrieved" -Extra @{ secretName = $certSecretName; mtAppClientId = $mtAppClientId }
}
catch {
    $responseBody = Get-HttpErrorResponseBody -ErrorRecord $_
    Write-Log -Level "error" -Message "startup: failed to retrieve cert secret from Key Vault" -Extra @{ secretName = $certSecretName; error = $_.Exception.Message; responseBody = $responseBody }
    exit 1
}

try {
    $script:bearerToken = Get-KeyVaultSecret -SecretName $bearerSecretName -AccessToken $vaultToken
    Write-Log -Level "info" -Message "startup: bearer token secret retrieved" -Extra @{ secretName = $bearerSecretName }
}
catch {
    $responseBody = Get-HttpErrorResponseBody -ErrorRecord $_
    Write-Log -Level "error" -Message "startup: failed to retrieve bearer token secret from Key Vault" -Extra @{ secretName = $bearerSecretName; error = $_.Exception.Message; responseBody = $responseBody }
    exit 1
}

if (-not $certPem -or -not $bearerToken) {
    Write-Log -Level "error" -Message "startup: one or more secrets came back empty"
    exit 1
}

# Parsed once here purely to log the thumbprint at startup (useful for
# confirming which cert is live without exposing the PEM itself) — #1400:
# this parent process no longer calls Connect-*/any cmdlet itself, so
# nothing downstream in THIS process actually consumes the X509Certificate2
# object. The raw PEM string ($script:certPem) is what gets handed to each
# child (see Invoke-ChildRequest) — an in-memory X509Certificate2 cannot
# cross a process boundary directly, so the child re-parses the same PEM
# itself rather than this object being (re)serialized somehow.
try {
    $parsedCert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::CreateFromPem($certPem, $certPem)
    Write-Log -Level "info" -Message "startup: app-only certificate parsed" -Extra @{ thumbprint = $parsedCert.Thumbprint }
}
catch {
    Write-Log -Level "error" -Message "startup: failed to parse app-only certificate from Key Vault secret" -Extra @{ error = $_.Exception.Message }
    exit 1
}

# --- Bearer-token check -------------------------------------------------------
#
# Fixed-time comparison so response timing can't be used to brute-force the
# token byte-by-byte.
function Test-BearerToken {
    param([string]$Presented)

    if (-not $Presented) { return $false }
    $expectedBytes = [Text.Encoding]::UTF8.GetBytes($bearerToken)
    $presentedBytes = [Text.Encoding]::UTF8.GetBytes($Presented)
    return [Security.Cryptography.CryptographicOperations]::FixedTimeEquals($expectedBytes, $presentedBytes)
}

# --- Request handling -----------------------------------------------------------
#
# Structured error responses, never a raw PowerShell exception message or
# stack trace in the body. `kind` is the field #211's PsExecutionError
# (api-server side) discriminates on: "bad_request" and "unknown_cmdlet" are
# both request-shape problems (never reach a child/Connect-IPPSSession),
# "auth_failed" is a Connect-IPPSSession/Connect-ExchangeOnline/
# Connect-MicrosoftTeams failure inside the child, "script_error" is the
# resolved cmdlet itself throwing for any other reason (or the child process
# crashing/timing out — #1400 adds that failure mode, mapped onto the same
# existing kind so the api-server contract is unchanged), "cmdlet_unavailable"
# (#250) is the resolved cmdlet throwing a real CommandNotFoundException.
function Send-JsonResponse {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [int]$StatusCode,
        [string]$Body
    )
    $bytes = [Text.Encoding]::UTF8.GetBytes($Body)
    $Response.StatusCode = $StatusCode
    $Response.ContentType = "application/json"
    $Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $Response.Close()
}

function Send-ErrorResponse {
    param(
        [System.Net.HttpListenerResponse]$Response,
        [int]$StatusCode,
        [string]$Kind,
        [string]$Message
    )
    $payload = @{ error = $Kind; message = $Message } | ConvertTo-Json -Compress
    Send-JsonResponse -Response $Response -StatusCode $StatusCode -Body $payload
}

# #1400: spawns child-worker.ps1 as a fresh process, hands it this request's
# cmdletKey/params/organization plus the cert PEM and mtAppClientId over its
# stdin (never argv, never env, never a temp file — see child-worker.ps1's
# header comment for the full contract), waits up to $TimeoutSeconds for it
# to finish, and returns a hashtable the caller can turn straight into
# either a 200 (ok:true) or the appropriate error response (ok:false).
#
# Concurrency: this container has a modest 0.5 CPU / 1Gi allocation (per
# #1400's own text) and ExchangeOnlineManagement/MicrosoftTeams module
# imports are not cheap in memory once loaded. This function is called from
# the main HTTP loop below, which — unchanged from before #1400 — handles
# exactly one request at a time (blocks on $listener.GetContext() until the
# current request's response has been sent before reading the next one off
# the queue). That means at most ONE child process ever runs at a time by
# construction, with zero added complexity (no semaphore needed to enforce
# a limit the architecture already guarantees) — the safest possible answer
# to "how much concurrency can 0.5 CPU/1Gi safely support" is exactly the
# non-concurrent behavior this service already had. If Shane wants genuine
# concurrent request handling later, that needs the listener loop itself
# rewritten to dispatch asynchronously (a bigger, separate change) with an
# explicit concurrency cap added at that point — not built speculatively
# here.
function Invoke-ChildRequest {
    param(
        [string]$CmdletKey,
        [hashtable]$RequestParams,
        [string]$Organization,
        [int]$TimeoutSeconds
    )

    $childRequestJson = @{
        cmdletKey     = $CmdletKey
        params        = $RequestParams
        organization  = $Organization
        certPem       = $script:certPem
        mtAppClientId = $mtAppClientId
    } | ConvertTo-Json -Compress -Depth 10

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "pwsh"
    [void]$psi.ArgumentList.Add("-NoLogo")
    [void]$psi.ArgumentList.Add("-NonInteractive")
    [void]$psi.ArgumentList.Add("-File")
    [void]$psi.ArgumentList.Add($childWorkerPath)
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi

    # #1400's own acceptance criterion #1 asks for a REAL measured child
    # cold-start/turnaround number, not the 0.5-2s given to Shane as an
    # estimate. This session measured a bare `pwsh -NoLogo -NonInteractive
    # -Command "exit 0"` locally on Windows at ~2.2-2.9s — NOT the real
    # number, since this container runs Linux on a 0.5 CPU/1Gi tier and
    # `az containerapp exec` (the only in-session way to reach that tier
    # directly) only offers an interactive session this harness can't
    # script. Rather than leave the real number a guess, every child spawn
    # is timed here and logged (`childElapsedMs` below) — the true
    # container-hardware number will appear in this service's own logs the
    # first time a real request runs against a deployed revision, without
    # needing a separate manual benchmark step.
    $childStopwatch = [System.Diagnostics.Stopwatch]::StartNew()

    try {
        [void]$proc.Start()
    }
    catch {
        Write-Log -Level "error" -Message "failed to spawn child worker process" -Extra @{ cmdletKey = $CmdletKey; error = $_.Exception.Message }
        return @{ ok = $false; statusCode = 500; kind = "script_error"; message = "Failed to start the request-handling child process." }
    }

    # Task-based async reads (StandardOutput/StandardError's own
    # ReadToEndAsync), NOT the Process class's event-based
    # OutputDataReceived/ErrorDataReceived pattern: those events fire on a
    # bare .NET ThreadPool thread with no PowerShell Runspace attached, so
    # a PowerShell scriptblock handler throws "There is no Runspace
    # available to run scripts in this thread" the first time output
    # arrives (confirmed while building this — see the throwaway test
    # harness this session ran before this fix). Plain Task objects have no
    # such requirement.
    $stdoutTask = $proc.StandardOutput.ReadToEndAsync()
    $stderrTask = $proc.StandardError.ReadToEndAsync()
    $proc.StandardInput.Write($childRequestJson)
    $proc.StandardInput.Close()

    $exited = $proc.WaitForExit($TimeoutSeconds * 1000)
    $childStopwatch.Stop()

    if (-not $exited) {
        Write-Log -Level "error" -Message "child worker process timed out; killing" -Extra @{ cmdletKey = $CmdletKey; timeoutSeconds = $TimeoutSeconds; childElapsedMs = $childStopwatch.ElapsedMilliseconds }
        try {
            # Kill($true): kills the entire process tree, not just the
            # child pwsh process itself — Connect-ExchangeOnline/
            # Connect-IPPSSession can spawn their own child processes for
            # the underlying REST/remoting session, and a bare Kill() would
            # leave those orphaned.
            $proc.Kill($true)
        }
        catch {
            Write-Log -Level "warn" -Message "failed to kill timed-out child worker process" -Extra @{ cmdletKey = $CmdletKey; error = $_.Exception.Message }
        }
        # Killing the process closes its streams, which lets the pending
        # ReadToEndAsync tasks complete (with whatever partial output the
        # child had already flushed) — wait briefly for that so any last
        # log lines it wrote before being killed still get relayed below,
        # capped short so a genuinely stuck stream can't re-introduce the
        # hang the timeout was meant to prevent.
        [System.Threading.Tasks.Task]::WaitAll(@($stdoutTask, $stderrTask), 5000) | Out-Null
        if ($stderrTask.IsCompletedSuccessfully -and $stderrTask.Result) {
            foreach ($line in ($stderrTask.Result -split "`n")) { if ($line.Trim()) { [Console]::WriteLine($line.Trim()) } }
        }
        return @{ ok = $false; statusCode = 500; kind = "script_error"; message = "Request timed out after ${TimeoutSeconds}s." }
    }

    [System.Threading.Tasks.Task]::WaitAll(@($stdoutTask, $stderrTask), 5000) | Out-Null

    # Relay the child's structured (JSON, one entry per line) log output
    # onto this process's own stdout — the container's real log stream —
    # so nothing the child logged is lost.
    if ($stderrTask.IsCompletedSuccessfully -and $stderrTask.Result) {
        foreach ($line in ($stderrTask.Result -split "`n")) { if ($line.Trim()) { [Console]::WriteLine($line.Trim()) } }
    }

    $stdoutRaw = if ($stdoutTask.IsCompletedSuccessfully) { $stdoutTask.Result } else { "" }
    $stdout = $stdoutRaw.Trim()
    if (-not $stdout) {
        Write-Log -Level "error" -Message "child worker process produced no output" -Extra @{ cmdletKey = $CmdletKey; exitCode = $proc.ExitCode }
        return @{ ok = $false; statusCode = 500; kind = "script_error"; message = "The request-handling child process produced no output (exit code $($proc.ExitCode))." }
    }

    try {
        # -AsHashtable (#2851): a PSCustomObject can't represent an object with
        # both "value" and "Value" keys — PSCustomObject property names are
        # case-INsensitive, so ConvertFrom-Json throws
        # ("...contains keys with different casing...") the moment real
        # Graph/EXO output (Get-OrganizationConfig, Get-MailboxPlan, etc.)
        # carries such a pair, even though the child wrote perfectly valid
        # JSON. -AsHashtable is case-sensitive-key-tolerant and parses it
        # cleanly; downstream property-style access ($parsed.ok etc.) and the
        # ConvertTo-Json re-serialization at :558 both work unchanged against
        # a hashtable.
        $parsed = $stdout | ConvertFrom-Json -AsHashtable -ErrorAction Stop
    }
    catch {
        # #1482 diagnostic: the child wrote SOMETHING to stdout but it did not
        # parse as JSON — stdout contamination. entrypoint.ps1 historically
        # logged only the parse exception, never the bytes it failed on, which
        # is why this stayed opaque. Capture the real contaminating output here
        # (raw, truncated to a sane cap) plus its byte length, a hex preview of
        # the leading bytes (to expose a BOM / control chars an eyeball would
        # miss), and the child exit code — observed, never inferred.
        $rawBytes = [Text.Encoding]::UTF8.GetBytes($stdoutRaw)
        $previewLen = [Math]::Min(2000, $stdout.Length)
        $hexCount = [Math]::Min(64, $rawBytes.Length)
        $hexPreview = ($rawBytes[0..([Math]::Max(0, $hexCount - 1))] | ForEach-Object { $_.ToString("x2") }) -join " "
        Write-Log -Level "error" -Message "child worker process produced unparseable output" -Extra @{
            cmdletKey       = $CmdletKey
            error           = $_.Exception.Message
            exitCode        = $proc.ExitCode
            stdoutByteLen   = $rawBytes.Length
            stdoutCharLen   = $stdout.Length
            stdoutRawPrefix = $stdout.Substring(0, $previewLen)
            stdoutHexPrefix = $hexPreview
        }

        # Safety net (#1482), NOT the fix: the child-worker's own [Console]::SetOut
        # diversion is what actually keeps stray module output off stdout at the
        # source. This is a last-ditch recovery for anything that could still slip
        # past it (e.g. a write straight to the OS stdout file descriptor, which an
        # in-process SetOut can't intercept). The child's contract is that its
        # result is ONE JSON object emitted last, so recover it by taking the LAST
        # non-empty line that parses as JSON. If this ever fires, the stray bytes
        # logged above show exactly what leaked so the source can be fixed too.
        $recovered = $null
        foreach ($line in ($stdout -split "`n")) {
            $candidateText = $line.Trim()
            if (-not $candidateText) { continue }
            try { $recovered = $candidateText | ConvertFrom-Json -AsHashtable -ErrorAction Stop } catch { }
        }
        if ($null -ne $recovered) {
            Write-Log -Level "warn" -Message "recovered child result from the last JSON line after stdout contamination" -Extra @{ cmdletKey = $CmdletKey; ok = [bool]$recovered.ok }
            $parsed = $recovered
        }
        else {
            return @{ ok = $false; statusCode = 500; kind = "script_error"; message = "The request-handling child process produced malformed output." }
        }
    }

    Write-Log -Level "info" -Message "child worker process completed" -Extra @{ cmdletKey = $CmdletKey; childElapsedMs = $childStopwatch.ElapsedMilliseconds; ok = [bool]$parsed.ok }

    $childResult = @{
        ok         = [bool]$parsed.ok
        statusCode = $parsed.statusCode
        kind       = $parsed.kind
        message    = $parsed.message
        result     = $parsed.result
    }
    return $childResult
}

# --- HTTP entrypoint -----------------------------------------------------------
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://+:$port/")
$listener.Start()
Write-Log -Level "info" -Message "listening" -Extra @{ port = $port }

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        # #1277 — unauthenticated revision self-report. Handled BEFORE the bearer
        # gate on purpose: /healthz returns only deployment metadata (revision
        # name, image tag, start time) — never tenant data and never anything the
        # bearer token protects — so a caller can confirm which revision is live
        # without holding the shared secret. Any HTTP method is accepted for it.
        $absPath = $request.Url.AbsolutePath
        if ($absPath -eq "/healthz" -or $absPath -eq "/__revision") {
            $healthBody = @{
                revision      = $script:ContainerAppRevision
                containerApp  = $script:ContainerAppName
                image         = $script:ImageTag
                startedAtUtc  = $script:StartedAtUtc
                port          = $port
            } | ConvertTo-Json -Compress
            Write-Log -Level "info" -Message "healthz revision self-report" -Extra @{ revision = $script:ContainerAppRevision; path = $absPath }
            Send-JsonResponse -Response $response -StatusCode 200 -Body $healthBody
            continue
        }

        $authHeader = $request.Headers["Authorization"]
        $presentedToken = $null
        if ($authHeader -and $authHeader.StartsWith("Bearer ")) {
            $presentedToken = $authHeader.Substring(7)
        }

        if (-not (Test-BearerToken -Presented $presentedToken)) {
            Write-Log -Level "warn" -Message "request rejected: missing or invalid bearer token" -Extra @{ path = $request.Url.AbsolutePath }
            $response.StatusCode = 401
            $body = [Text.Encoding]::UTF8.GetBytes('{"error":"unauthorized"}')
            $response.ContentType = "application/json"
            $response.OutputStream.Write($body, 0, $body.Length)
            $response.Close()
            continue
        }

        Write-Log -Level "info" -Message "request authorized" -Extra @{ path = $request.Url.AbsolutePath; method = $request.HttpMethod }

        if ($request.HttpMethod -ne "POST") {
            Send-ErrorResponse -Response $response -StatusCode 405 -Kind "method_not_allowed" -Message "Only POST is supported."
            continue
        }

        try {
            $streamReader = New-Object System.IO.StreamReader($request.InputStream, $request.ContentEncoding)
            $rawBody = $streamReader.ReadToEnd()
            $streamReader.Close()
            $requestBody = $rawBody | ConvertFrom-Json -ErrorAction Stop
        }
        catch {
            Write-Log -Level "warn" -Message "request rejected: malformed JSON body" -Extra @{ error = $_.Exception.Message }
            Send-ErrorResponse -Response $response -StatusCode 400 -Kind "bad_request" -Message "Request body must be valid JSON."
            continue
        }

        $cmdletKey = $requestBody.cmdletKey
        if (-not $cmdletKey -or -not $script:CmdletCatalog.ContainsKey($cmdletKey)) {
            Write-Log -Level "warn" -Message "request rejected: unknown cmdletKey" -Extra @{ cmdletKey = $cmdletKey }
            Send-ErrorResponse -Response $response -StatusCode 400 -Kind "unknown_cmdlet" -Message "cmdletKey '$cmdletKey' is not in the approved allowlist."
            continue
        }

        $requestParams = ConvertTo-ParamHashtable -JsonParamsObject $requestBody.params
        $organization = $requestParams["Organization"]
        if (-not $organization) {
            Send-ErrorResponse -Response $response -StatusCode 400 -Kind "bad_request" -Message "params.Organization is required to identify the target tenant."
            continue
        }

        $childResult = Invoke-ChildRequest -CmdletKey $cmdletKey -RequestParams $requestParams -Organization $organization -TimeoutSeconds $childTimeoutSeconds

        if (-not $childResult.ok) {
            $statusCode = if ($childResult.statusCode) { [int]$childResult.statusCode } else { 500 }
            $kind = if ($childResult.kind) { $childResult.kind } else { "script_error" }
            $message = if ($childResult.message) { $childResult.message } else { "The request-handling child process failed." }
            Send-ErrorResponse -Response $response -StatusCode $statusCode -Kind $kind -Message $message
            continue
        }

        # One synchronous response: whatever the child's resolved cmdlet
        # produced (after any ResultProperty unwrap / PostFilter inside the
        # child). Multiple items serialize as a JSON array; a single item
        # serializes as a JSON object — matches the pre-#1400 behavior
        # exactly (PowerShell's own pipeline-assignment semantics, carried
        # through the child's own ConvertTo-Json and this re-serialization
        # unchanged). No items -> an empty JSON array.
        if ($null -eq $childResult.result) {
            $responseBody = "[]"
        }
        else {
            $responseBody = $childResult.result | ConvertTo-Json -Depth 10
        }
        Write-Log -Level "info" -Message "cmdlet executed" -Extra @{ cmdletKey = $cmdletKey }
        Send-JsonResponse -Response $response -StatusCode 200 -Body $responseBody
    }
}
finally {
    $listener.Stop()
}
