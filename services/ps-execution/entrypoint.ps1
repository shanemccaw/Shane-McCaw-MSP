# entrypoint.ps1 — PowerShell execution container, Phase 2 (#198, parent epic #180).
#
# Scope for this phase only: prove the Managed Identity -> Key Vault -> two
# secrets round-trip, and reject any HTTP request that doesn't present the
# bearer token. No Connect-IPPSSession, no real request/response API shape,
# no tenant connection — those are later phases of #180.
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

        # Phase 2 proof only — no real request/response API contract yet.
        # Confirms the token round-tripped and the cert secret is loaded in
        # memory, without ever echoing either back.
        Write-Log -Level "info" -Message "request authorized" -Extra @{ path = $request.Url.AbsolutePath }
        $payload = @{
            status    = "ok"
            certLoaded = [bool]$certPem
            authOk    = $true
        } | ConvertTo-Json -Compress
        $bodyBytes = [Text.Encoding]::UTF8.GetBytes($payload)
        $response.ContentType = "application/json"
        $response.StatusCode = 200
        $response.OutputStream.Write($bodyBytes, 0, $bodyBytes.Length)
        $response.Close()
    }
}
finally {
    $listener.Stop()
}
