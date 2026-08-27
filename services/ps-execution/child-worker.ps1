# child-worker.ps1 — spawned fresh by entrypoint.ps1 for EVERY request
# (#1400, real fix for #1389's Microsoft.Identity.Client assembly-load
# conflict).
#
# Why a fresh process per request, not lazy import in the shared listener:
# once a .NET assembly is loaded into a process it can't be swapped for a
# different version for the rest of that process's life. ExchangeOnline-
# Management and MicrosoftTeams both depend on Microsoft.Identity.Client,
# at different versions, and Azure Container Apps can route a compliance-
# session request and a teams-session request to the SAME warm replica —
# lazy-import-at-first-use in a long-lived process only delays the
# collision to whichever session type is requested second in that
# replica's life, not eliminate it. Every request instead gets its own
# child pwsh process here, imports exactly ONE of the two modules (the one
# its session type needs), runs to completion, and exits — no process ever
# lives long enough to see a second, conflicting module.
#
# Contract with the parent (entrypoint.ps1's Invoke-ChildRequest):
#   stdin  (this process's ENTIRE stdin, read once): one JSON object —
#     { cmdletKey, params, organization, certPem, mtAppClientId }
#   stdout (exactly ONE line, emitted via Send-ChildResult below): one JSON
#     object — success: { ok: true, result: <the resolved cmdlet's output> }
#             failure: { ok: false, statusCode, kind, message } — statusCode/
#             kind/message map directly onto the same Send-ErrorResponse
#             contract the pre-#1400 single-process entrypoint.ps1 used, so
#             the api-server side (#211's PsExecutionError) sees no change.
#   stderr: structured Write-Log JSON entries only (see common.ps1's
#     $script:PsExecutionLogStream) — the parent relays these onto its own
#     stdout so nothing is lost from the container's log stream, and they
#     never collide with the stdout contract above.
# Exit code is 0 on ok:true, 1 on any ok:false path — informational for the
# parent (it decides success/failure from the JSON body, not the exit
# code), but a nonzero exit with a well-formed body is still worth having
# for anyone reading raw container/process logs.
$ErrorActionPreference = "Stop"
$script:PsExecutionLogStream = "Error"
. (Join-Path $PSScriptRoot "common.ps1")
. (Join-Path $PSScriptRoot "cmdlet-catalog.ps1")

function Send-ChildResult {
    param([hashtable]$Payload)
    $json = $Payload | ConvertTo-Json -Compress -Depth 10
    [Console]::WriteLine($json)
}

try {
    $rawRequest = [Console]::In.ReadToEnd()
    $request = $rawRequest | ConvertFrom-Json -ErrorAction Stop
}
catch {
    Send-ChildResult -Payload @{ ok = $false; statusCode = 400; kind = "bad_request"; message = "child could not parse request handed off by the parent process." }
    exit 1
}

$cmdletKey = $request.cmdletKey
$organization = $request.organization
$mtAppClientId = $request.mtAppClientId
$requestParams = ConvertTo-ParamHashtable -JsonParamsObject $request.params

$catalogEntry = $script:CmdletCatalog[$cmdletKey]
if (-not $catalogEntry) {
    # The parent already validates cmdletKey before spawning a child (see
    # entrypoint.ps1) — this is a defensive re-check, not the primary gate,
    # in case the two catalogs ever drift (they're dot-sourced from the
    # same file, so in practice they can't).
    Send-ChildResult -Payload @{ ok = $false; statusCode = 400; kind = "unknown_cmdlet"; message = "cmdletKey '$cmdletKey' is not in the approved allowlist." }
    exit 1
}

# Re-parse the PEM the PARENT already fetched from Key Vault once at
# container startup (see entrypoint.ps1) — this is a fresh
# X509Certificate2 object in THIS process's memory, not a live Key Vault
# round-trip. Never fetched here: doing so per-request would reintroduce
# the exact latency/load #1400 is designed to avoid, and defeats the
# in-memory-only-fetched-at-startup posture entrypoint.ps1's header comment
# already documents for this secret.
try {
    $appOnlyCertificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::CreateFromPem($request.certPem, $request.certPem)
}
catch {
    Write-Log -Level "error" -Message "child failed to parse app-only certificate handed off by parent" -Extra @{ error = $_.Exception.Message }
    Send-ChildResult -Payload @{ ok = $false; statusCode = 500; kind = "script_error"; message = "child failed to parse the app-only certificate." }
    exit 1
}

$sessionType = if ($catalogEntry.Session) { $catalogEntry.Session } else { "compliance" }

# Lazy, single-module import — genuinely safe here (unlike the rejected
# lazy-import-in-the-shared-listener idea #1389 investigated) because this
# process is used for exactly ONE request and then exits. There is no
# "later request in this same process" for a second module's conflicting
# MSAL version to collide with.
try {
    if ($sessionType -eq "teams") {
        Import-Module MicrosoftTeams -MinimumVersion 5.0.0 -ErrorAction Stop
    }
    else {
        # Both "compliance" (Connect-IPPSSession) and "exchange"
        # (Connect-ExchangeOnline) sessions come from the same
        # ExchangeOnlineManagement module.
        Import-Module ExchangeOnlineManagement -MinimumVersion 3.0.0 -ErrorAction Stop
    }
}
catch {
    Write-Log -Level "error" -Message "child failed to import required module" -Extra @{ cmdletKey = $cmdletKey; session = $sessionType; error = $_.Exception.Message }
    Send-ChildResult -Payload @{ ok = $false; statusCode = 500; kind = "script_error"; message = "child failed to import the module required for this cmdlet." }
    exit 1
}

$invocation = Resolve-CmdletInvocation -CmdletKey $cmdletKey -RequestParams $requestParams

try {
    if ($sessionType -eq "exchange") {
        Connect-ExchangeOnline -Organization $organization -AppId $mtAppClientId -Certificate $appOnlyCertificate -ShowBanner:$false -ErrorAction Stop | Out-Null
    }
    elseif ($sessionType -eq "teams") {
        # Connect-MicrosoftTeams' certificate-based app-only auth (-Certificate
        # accepting an X509Certificate2 object directly, same shape
        # Connect-ExchangeOnline already uses) — carried over unchanged from
        # the pre-#1400 single-process entrypoint.ps1; still not independently
        # verified against a live Teams session (same documented gap).
        Connect-MicrosoftTeams -TenantId $organization -ApplicationId $mtAppClientId -Certificate $appOnlyCertificate -ErrorAction Stop | Out-Null
    }
    else {
        Connect-IPPSSession -Organization $organization -AppId $mtAppClientId -Certificate $appOnlyCertificate -ErrorAction Stop | Out-Null
    }
}
catch {
    Write-Log -Level "error" -Message "Connect-$sessionType session failed" -Extra @{ cmdletKey = $cmdletKey; organization = $organization; error = $_.Exception.Message }
    $sessionLabel = if ($sessionType -eq "exchange") { "an Exchange Online" } elseif ($sessionType -eq "teams") { "a Microsoft Teams" } else { "a Security & Compliance" }
    Send-ChildResult -Payload @{ ok = $false; statusCode = 502; kind = "auth_failed"; message = "Could not establish $sessionLabel session for the target tenant." }
    exit 1
}

# See the "add-role-group-member" catalog entry's own comment for why write
# cmdlets get this distinct treatment: audit-channel logging of the actual
# target params (never done for reads, none of which have any worth
# logging) plus idempotent handling of a duplicate add.
if ($catalogEntry.IsWrite) {
    Write-Log -Level "info" -Channel "audit" -Message "write action attempted" -Extra @{ cmdletKey = $cmdletKey; cmdlet = $invocation.Cmdlet; organization = $organization; identity = $invocation.Params["Identity"]; member = $invocation.Params["Member"] }
}

$writeOutcome = $null
$result = $null
$failurePayload = $null

try {
    # #491: Script entries (get-mailbox-quota-utilization) run their
    # composed scriptblock directly — no cmdlet name to splat params onto,
    # and IsScript entries always carry empty Params (see
    # Resolve-CmdletInvocation).
    if ($invocation.IsScript) {
        $result = & $catalogEntry.Script
    }
    else {
        $cmdletParams = $invocation.Params
        $result = & $invocation.Cmdlet @cmdletParams
    }

    if ($catalogEntry.IsWrite) {
        # Add-RoleGroupMember has no meaningful success payload to preserve
        # (unlike the read cmdlets above) — normalize to an explicit status
        # object so a caller doesn't have to distinguish "[]" (empty read
        # result) from "write succeeded".
        $writeOutcome = "succeeded"
        $result = @{ status = $writeOutcome }
    }

    # ResultProperty: some cmdlets (Export-ActivityExplorerData) return a
    # wrapper object with the real item collection JSON-encoded inside one
    # property rather than as the collection itself — see the catalog
    # entry's own comment for why. Unwrap+parse before anything downstream
    # (PostFilter, the response serializer) sees it.
    if ($catalogEntry.ResultProperty -and $null -ne $result) {
        $raw = $result.$($catalogEntry.ResultProperty)
        if ($raw -is [string]) {
            $result = if ([string]::IsNullOrWhiteSpace($raw)) { @() } else { $raw | ConvertFrom-Json }
        }
        else {
            $result = $raw
        }
    }

    # PostFilter: a code-owned predicate (never DB/request-driven, see the
    # catalog's own comment) narrowing the item collection before
    # `_itemCount` is derived from it on the api-server side.
    if ($catalogEntry.PostFilter -and $null -ne $result) {
        $result = @($result) | Where-Object $catalogEntry.PostFilter
    }
}
catch {
    # See the catalog entry's "Idempotency" comment: a duplicate add is
    # treated as a successful no-op, not a script_error, since this
    # cmdlet's whole purpose is re-runnable onboarding-time provisioning.
    if ($catalogEntry.IsWrite -and $_.Exception.Message -match "(?i)already a member|AlreadyExists") {
        $writeOutcome = "already_member"
        $result = @{ status = $writeOutcome }
    }
    else {
        # #250: distinguish "this cmdlet was never registered into THIS
        # session" from a genuine script/runtime error. Detected two ways,
        # deliberately not just a message-text guess:
        #   1. The .NET exception TYPE is CommandNotFoundException — the
        #      stable, locale-independent signal PowerShell throws for
        #      exactly this condition (verified against real-world reports
        #      before relying on it — this exception type is raised ONLY
        #      for command-resolution failures, never for a cmdlet's own
        #      internal/runtime errors, so it cannot be confused with an
        #      unrelated genuine script error).
        #   2. Message-text fallback, in case some PS host surfaces this as
        #      a different wrapping exception type: the exact "is not
        #      recognized as a/the name of a cmdlet, function, script file,
        #      or executable program" phrase is PowerShell's fixed
        #      CommandNotFoundException wording and not reused for any
        #      other error class.
        # Every cmdlet name here comes from $script:CmdletCatalog — a
        # fixed, code-owned literal already confirmed correct (it works for
        # other tenants) — so this can only mean the tenant's Security &
        # Compliance (or, #491, Exchange Online) session never got this
        # cmdlet dynamically registered into it. That happens for EITHER of
        # two separate causes this container cannot distinguish from here:
        # the tenant lacks the underlying license/add-on, or the connecting
        # app-only identity isn't a member of the role group that grants it
        # (Purview role group for compliance-session entries, see
        # dlp-role-group-provisioning.ts; an Exchange RBAC role group e.g.
        # "View-Only Organization Management" plus the Exchange.ManageAsApp
        # permission for #491's exchange-session entries) — so the message
        # below names both possibilities rather than asserting either one.
        $isCmdletNotFound = ($_.Exception -is [System.Management.Automation.CommandNotFoundException]) -or
            ($_.Exception.Message -match "(?i)is not recognized as (a|the) name of a cmdlet, function, script file, or executable program")

        if ($isCmdletNotFound) {
            $sessionLabel = if ($sessionType -eq "exchange") { "Exchange Online" } elseif ($sessionType -eq "teams") { "Microsoft Teams" } else { "Security & Compliance" }
            $roleHint = if ($sessionType -eq "exchange") { "missing Exchange Online license/add-on, or the connecting app isn't yet granted Exchange.ManageAsApp and assigned the required Exchange RBAC role" } elseif ($sessionType -eq "teams") { "missing Teams Phone/calling plan licensing, or the connecting app isn't yet assigned a Teams administrative role" } else { "missing Purview license/add-on, or the connecting app isn't yet assigned the required Purview role" }
            Write-Log -Level "warn" -Message "cmdlet not available in this tenant's session (license or role-group provisioning gap)" -Extra @{ cmdletKey = $cmdletKey; cmdlet = $invocation.Cmdlet; session = $sessionType; error = $_.Exception.Message }
            $failurePayload = @{ ok = $false; statusCode = 500; kind = "cmdlet_unavailable"; message = "The '$($invocation.Cmdlet)' cmdlet is not available in this tenant's $sessionLabel session ($roleHint)." }
        }
        else {
            Write-Log -Level "error" -Message "cmdlet execution failed" -Extra @{ cmdletKey = $cmdletKey; cmdlet = $invocation.Cmdlet; error = $_.Exception.Message }
            if ($catalogEntry.IsWrite) {
                Write-Log -Level "error" -Channel "audit" -Message "write action failed" -Extra @{ cmdletKey = $cmdletKey; cmdlet = $invocation.Cmdlet; organization = $organization; identity = $invocation.Params["Identity"]; member = $invocation.Params["Member"]; error = $_.Exception.Message }
            }
            $failurePayload = @{ ok = $false; statusCode = 500; kind = "script_error"; message = "The resolved cmdlet raised an error during execution." }
        }
    }
}
finally {
    # Disconnect-ExchangeOnline tears down BOTH a Connect-ExchangeOnline and
    # a Connect-IPPSSession session (same underlying module session stack)
    # — it does not touch a Connect-MicrosoftTeams session (#1253, separate
    # module), so that one needs its own explicit disconnect. Belt-and-
    # suspenders here even though this process is about to exit anyway
    # (which would tear the session down regardless) — matches the
    # pre-#1400 behavior exactly and costs nothing.
    if ($sessionType -eq "teams") {
        Disconnect-MicrosoftTeams -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
    }
    else {
        Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
    }
}

if ($failurePayload) {
    Send-ChildResult -Payload $failurePayload
    exit 1
}

if ($catalogEntry.IsWrite -and $writeOutcome) {
    Write-Log -Level "info" -Channel "audit" -Message "write action $writeOutcome" -Extra @{ cmdletKey = $cmdletKey; cmdlet = $invocation.Cmdlet; organization = $organization; identity = $invocation.Params["Identity"]; member = $invocation.Params["Member"] }
}

Write-Log -Level "info" -Message "cmdlet executed" -Extra @{ cmdletKey = $cmdletKey }
Send-ChildResult -Payload @{ ok = $true; result = $result }
exit 0
