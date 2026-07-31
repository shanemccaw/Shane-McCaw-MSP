# entrypoint.ps1 — PowerShell execution container.
#
# Phase 2 (#198): Managed Identity -> Key Vault -> two secrets round-trip,
# reject any HTTP request that doesn't present the bearer token.
# Phase 3 (#210, per #209's approved design + #180's pinned architecture
# comment): real request handling. POST { cmdletKey, params } — cmdletKey
# resolves to one of a fixed, code-owned allowlist of approved cmdlet
# invocations (never an arbitrary script string from the request); params
# are static values merged into that cmdlet's parameters, fill values only,
# never control flow. Executes via Connect-IPPSSession (cert from Key
# Vault) + the resolved cmdlet, capturing the success/output stream only.
#
# Written directly in PowerShell (not Node/another runtime) because the base
# image is `mcr.microsoft.com/powershell` and pwsh already ships everything
# this phase needs (Invoke-RestMethod for IMDS + Key Vault REST,
# System.Net.HttpListener for the HTTP entrypoint) — no extra runtime or
# package install earns its build-time/image-size cost for a "small
# dedicated service, not a full app" per #198's own framing.
#
# Secrets are read into process memory once at startup and never written to
# disk, logged, or echoed back in any response body.

$ErrorActionPreference = "Stop"

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
# This phase does not call Connect-IPPSSession yet, so nothing here actually
# depends on which app the cert belongs to — recorded here per the issue's
# explicit ask to document the decision, not left implicit.
$mtAppClientId = $env:MT_APP_CLIENT_ID

# Optional: only needed if the Container App's Managed Identity is
# user-assigned rather than system-assigned.
$miClientId = $env:AZURE_MI_CLIENT_ID

$port = if ($env:PORT) { [int]$env:PORT } else { 8080 }

function Write-Log {
    param(
        [string]$Level,
        [string]$Message,
        [hashtable]$Extra = @{}
    )
    $entry = @{
        channel   = "integration.ps-execution"
        level     = $Level
        message   = $Message
        timestamp = [DateTimeOffset]::UtcNow.ToString("o")
    }
    foreach ($key in $Extra.Keys) { $entry[$key] = $Extra[$key] }
    # [Console]::WriteLine, not Write-Output: this still lands in the
    # container's stdout stream (Azure's log capture reads stdout), but
    # does NOT enter PowerShell's success output pipeline — Write-Output
    # here got silently captured as part of a caller's return value
    # whenever Write-Log was invoked inside a function whose result the
    # caller assigned (#207, caused by #206's diagnostic logging addition).
    [Console]::WriteLine(($entry | ConvertTo-Json -Compress))
}

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

function Get-HttpErrorResponseBody {
    param($ErrorRecord)

    # PowerShell 7's Invoke-RestMethod populates $_.ErrorDetails.Message with
    # the response body text on a non-2xx response — this is the correct
    # pwsh 7 pattern and works regardless of the underlying exception type.
    if ($ErrorRecord.ErrorDetails -and $ErrorRecord.ErrorDetails.Message) {
        return $ErrorRecord.ErrorDetails.Message
    }

    # Fallback for cases ErrorDetails isn't populated: pwsh 7's
    # Invoke-RestMethod throws Microsoft.PowerShell.Commands.HttpResponseException,
    # whose .Response is a System.Net.Http.HttpResponseMessage — NOT the
    # System.Net.HttpWebResponse from Windows PowerShell 5.1/.NET Framework,
    # so there's no .GetResponseStream(). Read the body via
    # Content.ReadAsStringAsync() instead.
    $httpResponse = $ErrorRecord.Exception.Response
    if ($httpResponse -and $httpResponse.Content) {
        try {
            return $httpResponse.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        }
        catch {
            return $null
        }
    }

    return $null
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

# Baked into the image at build time (see Dockerfile) — never a live
# PSGallery install. Imported once at startup so a missing/broken module
# fails fast here rather than on the first real request.
try {
    Import-Module ExchangeOnlineManagement -MinimumVersion 3.0.0 -ErrorAction Stop
    Write-Log -Level "info" -Message "startup: ExchangeOnlineManagement module imported"
}
catch {
    Write-Log -Level "error" -Message "startup: failed to import ExchangeOnlineManagement" -Extra @{ error = $_.Exception.Message }
    exit 1
}

# $certPem is the PEM-encoded certificate+key bundle from Key Vault (see
# azure-keyvault.ts's getCertificatePem doc comment on the api-server side —
# same "cert/key bundle" shape, different (Managed Identity) retrieval
# path). CreateFromPem(cert, key) with the same string for both arguments
# works for a combined bundle: it independently locates the first
# CERTIFICATE block and the first PRIVATE KEY block in whatever text it's
# given. Parsed once here (not per-request) since the secret is already
# held in memory for the life of the process.
try {
    $script:appOnlyCertificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::CreateFromPem($certPem, $certPem)
    Write-Log -Level "info" -Message "startup: app-only certificate parsed" -Extra @{ thumbprint = $script:appOnlyCertificate.Thumbprint }
}
catch {
    Write-Log -Level "error" -Message "startup: failed to parse app-only certificate from Key Vault secret" -Extra @{ error = $_.Exception.Message }
    exit 1
}

# --- Approved cmdlet allowlist -------------------------------------------------
#
# cmdletKey (from the request body) resolves ONLY to an entry here — never
# to a script string from the request itself. This is the security
# boundary #209's design calls out explicitly: a PS-backed check does not
# have the "bounded, read-only Graph REST call" ceiling a malformed Graph
# endpoint string has, so what-code-runs stays code-owned, not DB/request
# driven. `AllowedParams` is the per-cmdlet parameter-name allowlist —
# `params` in the request can only fill values for names on this list,
# never add new ones or influence which cmdlet runs.
#
# Real DLP/Label cmdlets are #212's scope. This starts with one trivial,
# read-only placeholder that still exercises the full path (connect,
# invoke, capture, disconnect) end to end: Get-ConnectionInformation lists
# the current process's own open EXO/IPPS sessions — no tenant mail or
# compliance data involved.
$script:CmdletCatalog = @{
    "get-connection-info" = @{
        Cmdlet         = "Get-ConnectionInformation"
        AllowedParams  = @()
    }
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
# (api-server side, not built yet) discriminates on: "bad_request" and
# "unknown_cmdlet" are both request-shape problems (never reach
# Connect-IPPSSession), "auth_failed" is a Connect-IPPSSession failure,
# "script_error" is the resolved cmdlet itself throwing.
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

# Resolves cmdletKey against the allowlist and merges request params into
# that cmdlet's allowed parameter set only — fill values, never control
# flow. `Organization` is treated as the reserved tenant-identity field for
# Connect-IPPSSession (not forwarded to the cmdlet itself); this field name
# is this phase's assumption, not yet confirmed against #211's real
# monitor-executor.ts caller (which doesn't exist yet) — flagged for
# Shane's review, not silently assumed permanent.
function Resolve-CmdletInvocation {
    param(
        [string]$CmdletKey,
        [hashtable]$RequestParams
    )

    $catalogEntry = $script:CmdletCatalog[$CmdletKey]
    $cmdletParams = @{}
    foreach ($allowedName in $catalogEntry.AllowedParams) {
        if ($RequestParams.ContainsKey($allowedName)) {
            $cmdletParams[$allowedName] = $RequestParams[$allowedName]
        }
    }

    return @{
        Cmdlet = $catalogEntry.Cmdlet
        Params = $cmdletParams
    }
}

function ConvertTo-ParamHashtable {
    param($JsonParamsObject)

    $result = @{}
    if ($null -eq $JsonParamsObject) { return $result }
    foreach ($prop in $JsonParamsObject.PSObject.Properties) {
        $result[$prop.Name] = $prop.Value
    }
    return $result
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

        $invocation = Resolve-CmdletInvocation -CmdletKey $cmdletKey -RequestParams $requestParams

        try {
            Connect-IPPSSession -Organization $organization -AppId $mtAppClientId -Certificate $script:appOnlyCertificate -ErrorAction Stop | Out-Null
        }
        catch {
            Write-Log -Level "error" -Message "Connect-IPPSSession failed" -Extra @{ cmdletKey = $cmdletKey; organization = $organization; error = $_.Exception.Message }
            Send-ErrorResponse -Response $response -StatusCode 502 -Kind "auth_failed" -Message "Could not establish a Security & Compliance session for the target tenant."
            continue
        }

        try {
            $cmdletParams = $invocation.Params
            $result = & $invocation.Cmdlet @cmdletParams
        }
        catch {
            Write-Log -Level "error" -Message "cmdlet execution failed" -Extra @{ cmdletKey = $cmdletKey; cmdlet = $invocation.Cmdlet; error = $_.Exception.Message }
            Send-ErrorResponse -Response $response -StatusCode 500 -Kind "script_error" -Message "The resolved cmdlet raised an error during execution."
            continue
        }
        finally {
            Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
        }

        # One synchronous response: whatever Write-Output produced. Multiple
        # items assign to $result as an array (serializes as a JSON array);
        # a single item assigns directly (serializes as a JSON object) —
        # this is PowerShell's own pipeline-assignment behavior, not
        # special-cased here. No items -> an empty JSON array.
        if ($null -eq $result) {
            $responseBody = "[]"
        }
        else {
            $responseBody = $result | ConvertTo-Json -Depth 10
        }
        Write-Log -Level "info" -Message "cmdlet executed" -Extra @{ cmdletKey = $cmdletKey }
        Send-JsonResponse -Response $response -StatusCode 200 -Body $responseBody
    }
}
finally {
    $listener.Stop()
}
