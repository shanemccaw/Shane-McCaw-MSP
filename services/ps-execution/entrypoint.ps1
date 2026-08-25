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
        [hashtable]$Extra = @{},
        # Defaults to this service's own operational channel. Write-cmdlet
        # audit entries (see the CmdletCatalog's IsWrite handling below) pass
        # "audit" instead — CLAUDE.md's locked channel taxonomy reserves
        # "audit" platform-wide for exactly this kind of action record, and
        # it's a distinct channel (not just a distinct message) so it can be
        # filtered/shipped independently of routine request-handling noise.
        [string]$Channel = "integration.ps-execution"
    )
    $entry = @{
        channel   = $Channel
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

# #1253: MicrosoftTeams module, for the new "teams" session type
# (Get-CsOnlineUser / Get-CsTeamsMeetingPolicy) — baked into the image at
# build time (see Dockerfile), same "never a live PSGallery install" posture
# as ExchangeOnlineManagement above.
try {
    Import-Module MicrosoftTeams -MinimumVersion 5.0.0 -ErrorAction Stop
    Write-Log -Level "info" -Message "startup: MicrosoftTeams module imported"
}
catch {
    Write-Log -Level "error" -Message "startup: failed to import MicrosoftTeams" -Extra @{ error = $_.Exception.Message }
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
# get-connection-info: trivial, read-only placeholder that still exercises
# the full path (connect, invoke, capture, disconnect) end to end —
# Get-ConnectionInformation lists the current process's own open EXO/IPPS
# sessions, no tenant mail or compliance data involved. #210/#211 verified
# this live.
#
# The four #212 entries below are the real DLP/Label checks. Two catalog
# entry fields beyond Cmdlet/AllowedParams exist ONLY because these real
# cmdlets need them (get-connection-info needed neither):
#   - ResultProperty: some cmdlets don't return the item collection
#     directly — their result is a wrapper object with the real data
#     JSON-encoded inside one property. When set, the dispatcher reads
#     $result.<ResultProperty> and, if it's a string, ConvertFrom-Json's it
#     before anything downstream sees it.
#   - PostFilter: a code-owned (never DB/request-driven) predicate
#     scriptblock run over the item collection before the response is
#     built. This exists because monitor-executor.ts's applyMapping()
#     unconditionally sets `_itemCount = items.length` — there is no
#     post-fetch filtering stage on the api-server side for PS-backed
#     checks the way Graph checks get `$filter` via filterParams — so a
#     check whose whole point is "count of policies/labels IN A BAD STATE"
#     has to arrive pre-filtered, and filtering here (code) rather than via
#     a request param keeps the #209 what-code-runs-stays-code-owned
#     boundary intact: PostFilter is picked by cmdletKey, never by
#     anything in the request body.
$script:CmdletCatalog = @{
    "get-connection-info" = @{
        Cmdlet         = "Get-ConnectionInformation"
        AllowedParams  = @()
    }

    # #212: weak / non-enforcing DLP policies.
    # Get-DlpCompliancePolicy is the current, non-retired cmdlet per
    # Microsoft Learn (learn.microsoft.com/powershell/module/
    # exchangepowershell/get-dlpcompliancepolicy, checked 2026-07-31) — the
    # issue text raised a possible "Get-DlpCompliancePolicyV2"; no such
    # cmdlet exists in current docs, so it's not used. No parameters are
    # required to list every policy in the org.
    #
    # "Weak" is this session's product-level read, not a Microsoft-defined
    # term: a policy not in Mode=Enable (i.e. still TestWithNotifications /
    # TestWithoutNotifications / PendingDeletion) or explicitly disabled is
    # doing detection/audit work at best, not actually blocking anything.
    # Flagged for Shane to correct the bar if this doesn't match his intent
    # for compliance:weak-dlp-policies.
    "get-dlp-policies" = @{
        Cmdlet         = "Get-DlpCompliancePolicy"
        AllowedParams  = @()
        PostFilter     = { $_.Mode -ne "Enable" -or $_.Enabled -eq $false }
    }

    # #1301: ALL DLP policies (raw tenant-wide count, NO PostFilter).
    # Same cmdlet as get-dlp-policies above, but deliberately UNFILTERED so
    # _itemCount is the TOTAL number of DLP policies in the tenant, not the
    # weak/non-enforcing subset. This is the one thing compliance:weak-dlp-
    # policies structurally cannot report: when a tenant has ZERO DLP policies
    # at all, the weak-subset PostFilter has nothing to count and produces
    # _itemCount == 0 — indistinguishable from a healthy tenant whose policies
    # are all actively enforcing. Backs compliance:zero-dlp-policies, whose
    # `dlpPoliciesCount == 0` critical rule mirrors identity:ca-policy-count's
    # existing `caPolicyCount == 0` rule exactly (raw count -> eq-0 -> critical).
    # No PostFilter follows the same convention as get-antispam-policies /
    # get-shared-mailboxes above (a "count" check wants the full set). An
    # errored/unavailable cmdlet still surfaces as status="error" (no
    # extracted_properties, no severity match) — never a false "0 policies".
    "get-all-dlp-policies" = @{
        Cmdlet         = "Get-DlpCompliancePolicy"
        AllowedParams  = @()
    }

    # #212: DLP incidents.
    # Get-DlpIncidentDetailReport ("will be retired") and Get-DlpDetailReport
    # ("This cmdlet is retired") are both explicitly superseded on Microsoft
    # Learn by Export-ActivityExplorerData as of 2026 — confirmed against the
    # live docs pages, not assumed. There is no other PowerShell-reachable
    # DLP-incident source; #180's Graph-coverage concern is real (Graph has
    # no DLP incident endpoint either), so this genuinely requires the PS
    # path.
    #
    # StartTime/EndTime/OutputFormat are mandatory on the real cmdlet.
    # OutputFormat is fixed to "Json" here (never request-driven) because
    # ResultProperty's unwrap below only makes sense for the Json shape.
    # StartTime/EndTime are supplied per-check via psParams using the
    # {NDaysAgo} placeholder monitor-executor.ts's resolvePsParamsPlaceholders
    # now resolves (#212 addition, mirrors the existing Graph-endpoint
    # {NDaysAgo} token) — Activity Explorer only retains 30 days regardless.
    # Filter1 scopes the export to DLP-specific Activity values
    # (DLPRuleMatch/DLPRuleEnforce/DLPInfo/DlpClassification) rather than
    # every Activity Explorer event type; supplied via psParams as a fill
    # value, never chosen by this container.
    #
    # Export-ActivityExplorerData's real return shape (confirmed against
    # multiple independent real-world usage reports, since Microsoft Learn's
    # own page doesn't document the object's shape) is a wrapper:
    # { ResultData: "<JSON-encoded string>", LastPage: bool, Watermark: string }
    # — ResultData is a STRING containing the JSON-encoded item array, not
    # the array itself. ResultProperty tells the dispatcher to unwrap it.
    "get-dlp-incidents" = @{
        Cmdlet         = "Export-ActivityExplorerData"
        AllowedParams  = @("StartTime", "EndTime", "OutputFormat", "Filter1", "PageSize")
        ResultProperty = "ResultData"
    }

    # #212: sensitivity label taxonomy / coverage gap.
    # Get-Label lists LABEL DEFINITIONS in the org, not per-document/
    # per-site label application — there is no Connect-IPPSSession-reachable
    # cmdlet that reports "documents missing a label" short of Content/
    # Activity Explorer (and Export-ActivityExplorerData, above, doesn't
    # cover label-application coverage either). No parameters are required
    # to list every label.
    #
    # PostFilter narrows to Disabled=$true labels: label definitions that
    # exist in the org's taxonomy but are not currently active, i.e.
    # protecting nothing right now — the closest honest "missing" proxy
    # this cmdlet can produce. Flagged explicitly: this is NOT literally
    # "items missing sensitivity labels" (copilot-readiness.ts's own
    # docstring language for compliance:missing-labels) — it's the nearest
    # real signal available from Get-Label. A truer per-item coverage
    # metric would need a different data source; Shane should confirm this
    # proxy is acceptable or flag a follow-up.
    "get-labels" = @{
        Cmdlet         = "Get-Label"
        AllowedParams  = @()
        PostFilter     = { $_.Disabled -eq $true }
    }

    # #212: label policy distribution/publish errors.
    # Get-LabelPolicy's Name/Mode/DistributionStatus output fields
    # (confirmed via real-world usage reports — the Microsoft Learn
    # parameter page doesn't enumerate output properties, only parameters)
    # surface publish/distribution failures. No parameters are required to
    # list every policy.
    #
    # PostFilter narrows to policies whose DistributionStatus is present and
    # not "Success" — the compliance:label-errors count.
    "get-label-policies" = @{
        Cmdlet         = "Get-LabelPolicy"
        AllowedParams  = @()
        PostFilter     = { $_.DistributionStatus -and $_.DistributionStatus -ne "Success" }
    }

    # #247 (#246 chunk A): first WRITE cmdlet in this catalog — every entry
    # above is read-only per #209's design. Adds a member (an Entra
    # security/mail-enabled group or user) to a Security & Compliance role
    # group — #246's actual driver is landing mt-app's own service
    # principal, via an Entra security group, into a Purview DLP role group
    # so app-only Get-DlpCompliancePolicy/etc. calls stop failing with
    # "not recognized" for tenants onboarded after this ships.
    #
    # AllowedParams is Identity/Member — Add-RoleGroupMember's real,
    # splattable parameter names (learn.microsoft.com/powershell/module/
    # exchangepowershell/add-rolegroupmember, checked 2026-07-31: Identity
    # is the role-group target, Member the principal to add; no parameter
    # named "RoleGroup" exists). The issue text described the intended scope
    # as "RoleGroup and Member" — read as the two concepts being locked
    # down, not a literal parameter-name instruction: every other catalog
    # entry's AllowedParams are the cmdlet's actual PowerShell parameter
    # names because they're splatted directly via `& $Cmdlet @cmdletParams`
    # below, and "RoleGroup" isn't one here. Flagged for Shane: whichever
    # future caller (#246 chunk C's consent.ts orchestration) builds
    # psParams for this cmdletKey needs to send Identity, not RoleGroup.
    #
    # Idempotency (investigated, not assumed): Microsoft Learn's own
    # Add-RoleGroupMember page (checked 2026-07-31) documents parameters and
    # permissions but does not state what happens on a duplicate add. The
    # closest confirmed real-world behavior is Add-DistributionGroupMember —
    # same "Add-*Member" Exchange cmdlet family, same underlying
    # group-membership-write mechanism, role groups included — which throws
    # a MemberAlreadyExistsException on a repeat add rather than silently
    # no-op'ing (widely reported; not itself a Microsoft Learn statement
    # either, so treated as a strong inference, not a certainty). Given
    # this write cmdlet's entire purpose (#246) is onboarding-time
    # provisioning that legitimately needs to be re-runnable — retries, and
    # Shane's own confirmed "admin-panel manual re-trigger for backfill/
    # troubleshooting" design in #246 — the dispatcher below (see IsWrite
    # handling) treats a caught "already a member"/"AlreadyExists" error as
    # a successful no-op, not a script_error, so a caller re-running this
    # against an already-provisioned tenant sees success rather than having
    # to special-case a specific exception string itself.
    #
    # Logging/audit (investigated, not assumed): runPowerShellCheck's
    # existing logging shape was built for scheduled reads and deliberately
    # never logs request params (no existing entry's AllowedParams held
    # anything worth logging). A write action's audit value IS the specific
    # params (which role group, which member) and the outcome
    # (succeeded/no-op/failed) — those need to land in the log record
    # itself, on the platform's dedicated "audit" channel (CLAUDE.md's
    # locked taxonomy), not buried in "integration.ps-execution" alongside
    # startup/routing noise. This container has no DB access (CLAUDE.md) so
    # it cannot call the Node-side createAuditLog()/auditLogsTable directly
    # the way write-action-safety.ts's Graph-write engine does — the
    # audit-channel stdout entries emitted below are the input Shane's
    # future consent.ts orchestration (#246 chunk C) reads and forwards
    # into that real audit log, not a substitute for it. IsWrite is the flag
    # the dispatcher below keys this treatment off of — code-owned, per
    # cmdletKey, never request-driven, matching every other catalog field's
    # security posture.
    "add-role-group-member" = @{
        Cmdlet         = "Add-RoleGroupMember"
        AllowedParams  = @("Identity", "Member")
        IsWrite        = $true
    }

    # #491: 11 Exchange checks that had a literal `exchange-online://Get-X`
    # pseudo-URI as their `endpoint` — never intercepted, so it went straight
    # to Graph and 400'd. `Session = "exchange"` on every entry below is the
    # key difference from every catalog entry above: Get-Mailbox,
    # Get-TransportRule, Get-InboundConnector, Get-HostedContentFilterPolicy,
    # Get-HostedOutboundSpamFilterPolicy, Get-DkimSigningConfig and
    # Get-MailboxStatistics are Exchange Online Management cmdlets, NOT
    # Security & Compliance cmdlets — confirmed against Microsoft Learn's
    # Connect-ExchangeOnline vs Connect-IPPSSession docs (checked 2026-08-06):
    # an IPPSSession (what every entry above connects with) simply does not
    # expose them. Adding them to the catalog without also branching the
    # connect step to Connect-ExchangeOnline would have hit the exact same
    # `cmdlet_unavailable`/CommandNotFoundException path #250 built for the
    # Purview case — see the connect block below for the `Session`-keyed
    # branch and Resolve-CmdletInvocation/the dispatch block for `Script`
    # support (added for get-mailbox-quota-utilization, the one check that
    # needs two composed cmdlets, not one).
    #
    # Prerequisite this session could NOT configure or verify (no Azure/
    # Graph/DB reachability here): the same app-only cert already loaded at
    # startup (reused, not a new registration, mirroring the Purview
    # role-group precedent add-role-group-member exists for) must ALSO be
    # granted the Exchange.ManageAsApp API permission and have its service
    # principal added to an Exchange RBAC role group (e.g. "View-Only
    # Organization Management") via Entra/Exchange admin center. Until
    # that's done, every entry below will surface as `cmdlet_unavailable` —
    # an honest, already-handled failure, not silently wrong data — flagged
    # for Shane to confirm/configure.
    #
    # No PostFilter is a raw tenant-wide count/list (the check's own name —
    # "X Count", "X Review" — reads as wanting the full set). A PostFilter
    # narrows to a "gap"/"risk" subset, matching the compliance:missing-labels
    # /weak-dlp-policies precedent above, and is this session's own product
    # read of what each check's name implies — flagged per-entry for Shane to
    # correct the bar if it doesn't match his intent, exactly like that
    # precedent. `mapping`/`properties`/`severity_rules` on the DB rows
    # themselves were deliberately left untouched by #491's migration (no DB
    # read access to confirm the field names/thresholds already configured
    # against — see the migration file's own header).

    # exchange:antispam-policy-coverage. No params needed to list every
    # custom anti-spam (HostedContentFilter) policy in the org; "coverage" is
    # read as "how many custom policies exist" — no PostFilter, a policy-level
    # list has no obvious single-cmdlet "gap" proxy the way a per-mailbox
    # check does.
    "get-antispam-policies" = @{
        Cmdlet         = "Get-HostedContentFilterPolicy"
        AllowedParams  = @()
        Session        = "exchange"
    }

    # exchange:shared-mailbox-licensing (raw count — the check's own name
    # says "Count") and exchange:mail-flow-rule-review/transport-rule-count's
    # sibling use of Get-Mailbox for a different recipient type. ResultSize
    # must be forced to Unlimited — EXO defaults Get-Mailbox to a 1000-row
    # cap otherwise — and RecipientTypeDetails to SharedMailbox, both fixed
    # via ps_params (code/DB-owned, never client-driven, same posture as
    # DLP's Filter1/OutputFormat above). FLAGGED: the "Licensing" half of
    # this check's name isn't answerable from Get-Mailbox alone — whether a
    # shared mailbox has a paid license assigned is an Entra
    # assignedLicenses property, not an Exchange mailbox property, so it
    # would need a Graph cross-reference per mailbox UPN. Out of this
    # session's scope; this returns the raw shared-mailbox count only.
    "get-shared-mailboxes" = @{
        Cmdlet         = "Get-Mailbox"
        AllowedParams  = @("ResultSize", "RecipientTypeDetails")
        Session        = "exchange"
    }

    # exchange:litigation-hold-coverage. PostFilter narrows to mailboxes
    # WITHOUT litigation hold enabled — the coverage GAP, same proxy shape as
    # compliance:missing-labels above (a "coverage" name paired with a raw
    # _itemCount of ALL mailboxes would be meaningless: a healthy and an
    # unhealthy tenant with the same headcount would score identically).
    "get-litigation-hold-gap" = @{
        Cmdlet         = "Get-Mailbox"
        AllowedParams  = @("ResultSize")
        PostFilter     = { -not $_.LitigationHoldEnabled }
        Session        = "exchange"
    }

    # exchange:archive-mailbox-rate. Same "rate" reasoning as the litigation
    # hold gap above — PostFilter narrows to mailboxes whose archive is NOT
    # active (defined-but-inactive archives are treated the same as never
    # enabled, matching Get-Mailbox's own ArchiveStatus enum, which has no
    # separate "was on now off" state worth distinguishing here).
    "get-archive-mailbox-gap" = @{
        Cmdlet         = "Get-Mailbox"
        AllowedParams  = @("ResultSize")
        PostFilter     = { $_.ArchiveStatus -ne "Active" }
        Session        = "exchange"
    }

    # exchange:transport-rule-count (raw count) and exchange:mail-flow-rule-review
    # (raw list "to review") share this ONE catalog entry across two separate
    # monitor_checks rows/cmdletKey references — same pattern as this file's
    # existing DLP entries being distinct per-check where compliance:dlp-incidents
    # and compliance:weak-dlp-policies are NOT shared (different cmdlets) but
    # mirrors add-role-group-member's single-entry-multiple-callers shape.
    # No PostFilter: "review" reads as "here is the full list to look at",
    # not a pre-filtered risk subset this session has no basis to define.
    "get-transport-rules" = @{
        Cmdlet         = "Get-TransportRule"
        AllowedParams  = @()
        Session        = "exchange"
    }

    # exchange:connector-health. PostFilter narrows to inbound connectors
    # that do NOT require TLS — RequireTls=$false is Microsoft's own
    # documented Exchange Online connector security-baseline flag, the
    # closest honest single-property "health" signal Get-InboundConnector
    # exposes (vs. e.g. Enabled=$false, which is often an intentional,
    # non-risky state, not a health problem).
    "get-inbound-connector-tls-gap" = @{
        Cmdlet         = "Get-InboundConnector"
        AllowedParams  = @()
        PostFilter     = { -not $_.RequireTls }
        Session        = "exchange"
    }

    # exchange:auto-forwarding-rules. Deliberately NOT Get-InboxRule, despite
    # that being the literal pseudo-URI the original (broken) endpoint named
    # — confirmed via Microsoft Learn that Get-InboxRule has no tenant-wide
    # form (Identity/Mailbox is mandatory in EXO, same limitation Microsoft
    # Graph's own /users/{id}/mailFolders/inbox/messageRules equivalent has),
    # so it cannot answer this check in one call the way every other entry
    # here does, and doing it per-mailbox would need a NEW fan-out mechanism
    # this container doesn't have (runFanOutCheck, the closest analog, is
    # Graph-only — see monitor-executor.ts). Rerouted instead to
    # Get-HostedOutboundSpamFilterPolicy's AutoForwardingMode — the real,
    # tenant-wide, single-call EXO security-baseline control that governs
    # whether auto-forwarding to external recipients is even possible, and
    # the mechanism Microsoft's own Defender documentation names for exactly
    # this risk. PostFilter narrows to policies where external auto-forwarding
    # is allowed (AutoForwardingMode -eq "On"; "Automatic" now behaves as
    # "Off" per Microsoft Learn, so only "On" is the risk state). FLAGGED:
    # this check's PRE-EXISTING severity_rules/mapping (untouched by #491's
    # migration) were presumably authored against a per-mailbox-rule-count
    # assumption that never actually ran — Shane should confirm the
    # thresholds still read sensibly against this policy-level _itemCount
    # (0 or 1 in almost every tenant, not a per-mailbox count).
    "get-auto-forward-risk-policies" = @{
        Cmdlet         = "Get-HostedOutboundSpamFilterPolicy"
        AllowedParams  = @()
        PostFilter     = { $_.AutoForwardingMode -eq "On" }
        Session        = "exchange"
    }

    # exchange:dkim-spf-dmarc-status. Get-DkimSigningConfig only covers the
    # DKIM third of this check's name — SPF and DMARC are public DNS TXT
    # records, not Exchange or Graph configuration state, and reading them
    # would need an actual DNS query against each accepted domain (a
    # different execution class entirely, no cmdlet or Graph endpoint
    # involved). FLAGGED, not built here: out of #491's wiring-fix scope: a
    # true SPF/DMARC check needs a DNS-lookup capability this container
    # doesn't have. PostFilter narrows to domains where DKIM signing is NOT
    # enabled — the same missing-control-gap shape as every other narrowed
    # entry above.
    "get-dkim-disabled-domains" = @{
        Cmdlet         = "Get-DkimSigningConfig"
        AllowedParams  = @()
        PostFilter     = { -not $_.Enabled }
        Session        = "exchange"
    }

    # exchange:mailbox-quota-utilization. No single EXO cmdlet answers this:
    # quota thresholds live on Get-Mailbox (ProhibitSendQuota), actual usage
    # only on Get-MailboxStatistics, and Get-MailboxStatistics has no
    # tenant-wide form in EXO (Identity is mandatory — confirmed against
    # Microsoft Learn, same class of limitation as Get-InboxRule above) — the
    # standard, Microsoft-documented pattern for a tenant-wide report is
    # exactly the composition below (Get-Mailbox piped per-mailbox into
    # Get-MailboxStatistics). `Script` is a NEW catalog field (see
    # Resolve-CmdletInvocation/the dispatch block) for the one check that
    # genuinely needs more than one splatted cmdlet call — every other entry
    # in this file, including every #491 entry above, still fits the
    # existing single-Cmdlet shape and deliberately does NOT use it.
    # ProhibitSendQuota/TotalItemSize are Exchange's ByteQuantifiedSize type;
    # .Value.ToBytes() is its documented conversion method. Unlimited-quota
    # mailboxes (ProhibitSendQuota has no numeric value) get
    # UtilizationPercent = $null and are excluded by the PostFilter's null
    # check, not miscounted as 0% or over-quota. PostFilter narrows to
    # mailboxes at or above 90% utilization — this session's own threshold
    # pick (flagged, same as the DLP "weak" bar above) for what counts as
    # "near quota", not a Microsoft-defined cutoff.
    "get-mailbox-quota-utilization" = @{
        Script = {
            Get-Mailbox -ResultSize Unlimited -RecipientTypeDetails UserMailbox, SharedMailbox |
                ForEach-Object {
                    $mbx = $_
                    $prohibitBytes = $null
                    if ($mbx.ProhibitSendQuota -and $mbx.ProhibitSendQuota.ToString() -ne "Unlimited") {
                        $prohibitBytes = $mbx.ProhibitSendQuota.Value.ToBytes()
                    }
                    $stats = Get-MailboxStatistics -Identity $mbx.Identity -ErrorAction SilentlyContinue
                    $usedBytes = $null
                    if ($stats -and $stats.TotalItemSize) {
                        $usedBytes = $stats.TotalItemSize.Value.ToBytes()
                    }
                    $utilizationPercent = $null
                    if ($prohibitBytes -and $usedBytes) {
                        $utilizationPercent = [math]::Round(($usedBytes / $prohibitBytes) * 100, 1)
                    }
                    [PSCustomObject]@{
                        PrimarySmtpAddress = $mbx.PrimarySmtpAddress
                        DisplayName        = $mbx.DisplayName
                        ProhibitSendQuotaBytes = $prohibitBytes
                        TotalItemSizeBytes = $usedBytes
                        UtilizationPercent = $utilizationPercent
                    }
                }
        }
        PostFilter = { $null -ne $_.UtilizationPercent -and $_.UtilizationPercent -ge 90 }
        Session    = "exchange"
    }

    # #754: compliance:audit-log-retention. Get-UnifiedAuditLogRetentionPolicy
    # is the current, non-retired Security & Compliance cmdlet for reading
    # EXPLICITLY configured unified audit log retention policies (Microsoft
    # Learn, checked 2026-08-14: module ExchangeOnlineManagement,
    # Connect-IPPSSession/Purview session — no Graph REST equivalent exists,
    # same class of gap #212's DLP/label checks were built for). No parameters
    # are required to list every policy in the org; default Session
    # ("compliance") applies, matching every entry above #491.
    #
    # Deliberately NO PostFilter here (unlike get-dlp-policies/get-labels
    # above): this cmdlet only reports policies an admin explicitly created.
    # A tenant with ZERO custom policies is not necessarily non-compliant —
    # Microsoft applies its own built-in default retention (1 year with
    # Purview Audit (Premium)/E5, 90 days without it), which this cmdlet
    # cannot reveal (no per-tenant licensing signal comes back with it). So
    # the "below 90 days" judgment is left to the check's own severity_rules
    # (see the 2026-08-14-audit-log-retention-check-754.sql migration) reading
    # RetentionDuration off the returned policy objects, rather than filtered
    # away here — the container stays a thin, honest data fetch for this
    # check, the same posture #506/#491's "no PostFilter = raw tenant-wide
    # list" precedent already established for checks where a container-side
    # gap proxy would be guessing.
    "get-audit-retention-policy" = @{
        Cmdlet        = "Get-UnifiedAuditLogRetentionPolicy"
        AllowedParams = @()
    }

    # #1253: adoption:teams-phone-provisioning. Get-CsOnlineUser is a
    # MicrosoftTeams module cmdlet, NOT reachable over either the
    # Connect-IPPSSession (default, "compliance") or Connect-ExchangeOnline
    # ("exchange") sessions above — a THIRD `Session = "teams"` value is added
    # below (Connect-MicrosoftTeams) specifically for this and the entry after
    # it. PostFilter narrows to users actually provisioned for Teams Phone —
    # EnterpriseVoiceEnabled -eq $true AND a non-empty LineURI — the literal
    # "is this user provisioned" signal the monitor_checks row's own mapping
    # reads (see the #1253 migration), matching the litigation-hold/archive
    # gap-proxy precedent above (filter in the container, not via a DB-side
    # countWhere, since the raw per-user Get-CsOnlineUser output has no
    # `{value: [...]}` envelope for the condition grammar to walk the way a
    # Graph or CSV-report response does).
    "get-cs-online-user" = @{
        Cmdlet        = "Get-CsOnlineUser"
        AllowedParams = @()
        PostFilter    = { $_.EnterpriseVoiceEnabled -eq $true -and $_.LineURI }
        Session       = "teams"
    }

    # #1253: added to the allowlist per the issue's exact endpoint list
    # (Get-CsTeamsMeetingPolicy), so it is available for the next monitor_check
    # that needs it. NOT wired to a monitor_checks row by this issue — a
    # Teams meeting policy's fields (recording, lobby bypass, presenter
    # rights, ...) don't cleanly answer "phone provisioning" without a
    # specific product decision on which field is the real signal; flagged
    # for Shane to pick one, same posture as this file's other "flagged"
    # catalog entries. No parameters are required to list every custom
    # meeting policy in the org.
    "get-cs-teams-meeting-policy" = @{
        Cmdlet        = "Get-CsTeamsMeetingPolicy"
        AllowedParams = @()
        Session       = "teams"
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
# (api-server side) discriminates on: "bad_request" and "unknown_cmdlet" are
# both request-shape problems (never reach Connect-IPPSSession), "auth_failed"
# is a Connect-IPPSSession failure, "script_error" is the resolved cmdlet
# itself throwing for any other reason, "cmdlet_unavailable" (#250) is the
# resolved cmdlet throwing a real CommandNotFoundException — see the
# CommandNotFoundException-detection comment below for what that means and
# doesn't mean.
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

    # #491: get-mailbox-quota-utilization's Script entry — a composed,
    # code-owned scriptblock (no single EXO cmdlet answers that check; see
    # its catalog comment) rather than one splatted cmdlet. Never
    # request-driven, same as every other field on a catalog entry — Params
    # stays empty because the script takes none.
    if ($catalogEntry.Script) {
        return @{
            Cmdlet   = "<script:$CmdletKey>"
            Params   = @{}
            IsScript = $true
        }
    }

    $cmdletParams = @{}
    foreach ($allowedName in $catalogEntry.AllowedParams) {
        if ($RequestParams.ContainsKey($allowedName)) {
            $cmdletParams[$allowedName] = $RequestParams[$allowedName]
        }
    }

    return @{
        Cmdlet   = $catalogEntry.Cmdlet
        Params   = $cmdletParams
        IsScript = $false
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
        $catalogEntry = $script:CmdletCatalog[$cmdletKey]

        # #491: catalog entries default to "compliance" (Connect-IPPSSession,
        # every entry present before #491) unless they declare
        # `Session = "exchange"` (Connect-ExchangeOnline) — see the #491
        # catalog block's own comment for why Get-Mailbox/Get-TransportRule/
        # etc. need the latter and cannot run over an IPPSSession. #1253 adds
        # a third value, `Session = "teams"` (Connect-MicrosoftTeams), for the
        # get-cs-online-user / get-cs-teams-meeting-policy catalog entries —
        # neither is reachable over either of the other two session types.
        $sessionType = if ($catalogEntry.Session) { $catalogEntry.Session } else { "compliance" }
        try {
            if ($sessionType -eq "exchange") {
                Connect-ExchangeOnline -Organization $organization -AppId $mtAppClientId -Certificate $script:appOnlyCertificate -ShowBanner:$false -ErrorAction Stop | Out-Null
            }
            elseif ($sessionType -eq "teams") {
                # Connect-MicrosoftTeams' certificate-based app-only auth
                # (-Certificate accepting an X509Certificate2 object directly,
                # same shape Connect-ExchangeOnline already uses above) is
                # this session's best-effort read of the MicrosoftTeams module
                # docs — NOT independently verified against a live Teams
                # session from this environment (no live Graph/Teams
                # reachability here, same class of gap #198's own comment
                # already documents for this file). If the installed module
                # version only accepts -CertificateThumbprint (a cert-store
                # lookup, not an in-memory X509Certificate2), this call fails
                # closed with "auth_failed" below — an honest, already-handled
                # failure, not silently wrong data — flagged for Shane to
                # confirm/adjust once this runs against a real container.
                Connect-MicrosoftTeams -TenantId $organization -ApplicationId $mtAppClientId -Certificate $script:appOnlyCertificate -ErrorAction Stop | Out-Null
            }
            else {
                Connect-IPPSSession -Organization $organization -AppId $mtAppClientId -Certificate $script:appOnlyCertificate -ErrorAction Stop | Out-Null
            }
        }
        catch {
            Write-Log -Level "error" -Message "Connect-$sessionType session failed" -Extra @{ cmdletKey = $cmdletKey; organization = $organization; error = $_.Exception.Message }
            $sessionLabel = if ($sessionType -eq "exchange") { "an Exchange Online" } elseif ($sessionType -eq "teams") { "a Microsoft Teams" } else { "a Security & Compliance" }
            Send-ErrorResponse -Response $response -StatusCode 502 -Kind "auth_failed" -Message "Could not establish $sessionLabel session for the target tenant."
            continue
        }

        # See the "add-role-group-member" catalog entry's own comment for
        # why write cmdlets get this distinct treatment: audit-channel
        # logging of the actual target params (never done for reads, none
        # of which have any worth logging) plus idempotent handling of a
        # duplicate add.
        if ($catalogEntry.IsWrite) {
            Write-Log -Level "info" -Channel "audit" -Message "write action attempted" -Extra @{ cmdletKey = $cmdletKey; cmdlet = $invocation.Cmdlet; organization = $organization; identity = $invocation.Params["Identity"]; member = $invocation.Params["Member"] }
        }

        $writeOutcome = $null
        try {
            # #491: Script entries (get-mailbox-quota-utilization) run their
            # composed scriptblock directly — no cmdlet name to splat params
            # onto, and IsScript entries always carry empty Params (see
            # Resolve-CmdletInvocation).
            if ($invocation.IsScript) {
                $result = & $catalogEntry.Script
            }
            else {
                $cmdletParams = $invocation.Params
                $result = & $invocation.Cmdlet @cmdletParams
            }

            if ($catalogEntry.IsWrite) {
                # Add-RoleGroupMember has no meaningful success payload to
                # preserve (unlike the read cmdlets above) — normalize to an
                # explicit status object so a caller doesn't have to
                # distinguish "[]" (empty read result) from "write succeeded".
                $writeOutcome = "succeeded"
                $result = @{ status = $writeOutcome }
            }

            # ResultProperty: some cmdlets (Export-ActivityExplorerData) return
            # a wrapper object with the real item collection JSON-encoded
            # inside one property rather than as the collection itself — see
            # the catalog entry's own comment for why. Unwrap+parse before
            # anything downstream (PostFilter, the response serializer) sees it.
            if ($catalogEntry.ResultProperty -and $null -ne $result) {
                $raw = $result.$($catalogEntry.ResultProperty)
                if ($raw -is [string]) {
                    $result = if ([string]::IsNullOrWhiteSpace($raw)) { @() } else { $raw | ConvertFrom-Json }
                }
                else {
                    $result = $raw
                }
            }

            # PostFilter: a code-owned predicate (never DB/request-driven, see
            # the catalog's own comment) narrowing the item collection before
            # `_itemCount` is derived from it on the api-server side.
            if ($catalogEntry.PostFilter -and $null -ne $result) {
                $result = @($result) | Where-Object $catalogEntry.PostFilter
            }
        }
        catch {
            # See the catalog entry's "Idempotency" comment: a duplicate add
            # is treated as a successful no-op, not a script_error, since
            # this cmdlet's whole purpose is re-runnable onboarding-time
            # provisioning.
            if ($catalogEntry.IsWrite -and $_.Exception.Message -match "(?i)already a member|AlreadyExists") {
                $writeOutcome = "already_member"
                $result = @{ status = $writeOutcome }
            }
            else {
                # #250: distinguish "this cmdlet was never registered into THIS
                # session" from a genuine script/runtime error. Detected two
                # ways, deliberately not just a message-text guess:
                #   1. The .NET exception TYPE is CommandNotFoundException —
                #      the stable, locale-independent signal PowerShell throws
                #      for exactly this condition (verified against real-world
                #      reports before relying on it — this exception type is
                #      raised ONLY for command-resolution failures, never for
                #      a cmdlet's own internal/runtime errors, so it cannot be
                #      confused with an unrelated genuine script error).
                #   2. Message-text fallback, in case some PS host surfaces
                #      this as a different wrapping exception type: the exact
                #      "is not recognized as a/the name of a cmdlet, function,
                #      script file, or executable program" phrase is
                #      PowerShell's fixed CommandNotFoundException wording and
                #      not reused for any other error class.
                # Every cmdlet name here comes from $script:CmdletCatalog — a
                # fixed, code-owned literal already confirmed correct (it
                # works for other tenants) — so this can only mean the tenant's
                # Security & Compliance (or, #491, Exchange Online) session
                # never got this cmdlet dynamically registered into it. That
                # happens for EITHER of two separate causes this container
                # cannot distinguish from here: the tenant lacks the
                # underlying license/add-on, or the connecting app-only
                # identity isn't a member of the role group that grants it
                # (Purview role group for compliance-session entries, see
                # dlp-role-group-provisioning.ts; an Exchange RBAC role group
                # e.g. "View-Only Organization Management" plus the
                # Exchange.ManageAsApp permission for #491's exchange-session
                # entries) — so the message below names both possibilities
                # rather than asserting either one.
                $isCmdletNotFound = ($_.Exception -is [System.Management.Automation.CommandNotFoundException]) -or
                    ($_.Exception.Message -match "(?i)is not recognized as (a|the) name of a cmdlet, function, script file, or executable program")

                if ($isCmdletNotFound) {
                    $sessionLabel = if ($sessionType -eq "exchange") { "Exchange Online" } elseif ($sessionType -eq "teams") { "Microsoft Teams" } else { "Security & Compliance" }
                    $roleHint = if ($sessionType -eq "exchange") { "missing Exchange Online license/add-on, or the connecting app isn't yet granted Exchange.ManageAsApp and assigned the required Exchange RBAC role" } elseif ($sessionType -eq "teams") { "missing Teams Phone/calling plan licensing, or the connecting app isn't yet assigned a Teams administrative role" } else { "missing Purview license/add-on, or the connecting app isn't yet assigned the required Purview role" }
                    Write-Log -Level "warn" -Message "cmdlet not available in this tenant's session (license or role-group provisioning gap)" -Extra @{ cmdletKey = $cmdletKey; cmdlet = $invocation.Cmdlet; session = $sessionType; error = $_.Exception.Message }
                    Send-ErrorResponse -Response $response -StatusCode 500 -Kind "cmdlet_unavailable" -Message "The '$($invocation.Cmdlet)' cmdlet is not available in this tenant's $sessionLabel session ($roleHint)."
                    continue
                }

                Write-Log -Level "error" -Message "cmdlet execution failed" -Extra @{ cmdletKey = $cmdletKey; cmdlet = $invocation.Cmdlet; error = $_.Exception.Message }
                if ($catalogEntry.IsWrite) {
                    Write-Log -Level "error" -Channel "audit" -Message "write action failed" -Extra @{ cmdletKey = $cmdletKey; cmdlet = $invocation.Cmdlet; organization = $organization; identity = $invocation.Params["Identity"]; member = $invocation.Params["Member"]; error = $_.Exception.Message }
                }
                Send-ErrorResponse -Response $response -StatusCode 500 -Kind "script_error" -Message "The resolved cmdlet raised an error during execution."
                continue
            }
        }
        finally {
            # Disconnect-ExchangeOnline tears down BOTH a Connect-ExchangeOnline
            # and a Connect-IPPSSession session (same underlying module session
            # stack) — it does not touch a Connect-MicrosoftTeams session
            # (#1253, separate module), so that one needs its own explicit
            # disconnect or it leaks across requests in this long-running
            # container.
            if ($sessionType -eq "teams") {
                Disconnect-MicrosoftTeams -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
            }
            else {
                Disconnect-ExchangeOnline -Confirm:$false -ErrorAction SilentlyContinue | Out-Null
            }
        }

        if ($catalogEntry.IsWrite -and $writeOutcome) {
            Write-Log -Level "info" -Channel "audit" -Message "write action $writeOutcome" -Extra @{ cmdletKey = $cmdletKey; cmdlet = $invocation.Cmdlet; organization = $organization; identity = $invocation.Params["Identity"]; member = $invocation.Params["Member"] }
        }

        # One synchronous response: whatever Write-Output produced (after any
        # ResultProperty unwrap / PostFilter above). Multiple items assign to
        # $result as an array (serializes as a JSON array); a single item
        # assigns directly (serializes as a JSON object) — this is
        # PowerShell's own pipeline-assignment behavior, not special-cased
        # here. No items -> an empty JSON array.
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
