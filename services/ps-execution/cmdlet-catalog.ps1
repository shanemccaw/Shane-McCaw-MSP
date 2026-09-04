# cmdlet-catalog.ps1 — dot-sourced by both entrypoint.ps1 (the long-lived
# parent dispatcher, which only needs it to fail fast on an unknown
# cmdletKey before spawning a child) and child-worker.ps1 (the fresh-per-
# request child, which uses it to actually resolve and invoke the cmdlet).
# Extracted unchanged from the pre-#1400 single-process entrypoint.ps1 as
# part of #1400's subprocess-per-request restructuring — the catalog itself
# and its security posture (cmdletKey resolves ONLY to an entry here, never
# to a script string from the request) are untouched by that restructuring.
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
    # troubleshooting" design in #246 — the dispatcher treats a caught
    # "already a member"/"AlreadyExists" error as a successful no-op, not a
    # script_error, so a caller re-running this against an already-
    # provisioned tenant sees success rather than having to special-case a
    # specific exception string itself.
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
    # the dispatcher keys this treatment off of — code-owned, per
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
    # Purview case — see child-worker.ps1's connect block for the
    # `Session`-keyed branch and Resolve-CmdletInvocation/its dispatch block
    # for `Script` support (added for get-mailbox-quota-utilization, the one
    # check that needs two composed cmdlets, not one).
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
        # Git #1786: was throwing "You cannot call a method on a null-valued
        # expression" on live tenant data (confirmed via the container's own
        # Log Analytics trace, not a guess). Root cause: ProhibitSendQuota and
        # TotalItemSize are both Microsoft.Exchange.Data.Unlimited<T> — the
        # correct not-unlimited test is the type's own `.IsUnlimited` bool,
        # not a string-match against `.ToString() -ne "Unlimited"` (fragile —
        # observed to pass that string check on at least one real mailbox
        # whose `.Value` was nonetheless null). `.Value` is guarded again
        # right before `.ToBytes()` as defense in depth, so a genuinely null
        # value degrades to $null output instead of throwing.
        Script = {
            Get-Mailbox -ResultSize Unlimited -RecipientTypeDetails UserMailbox, SharedMailbox |
                ForEach-Object {
                    $mbx = $_
                    $prohibitBytes = $null
                    if ($mbx.ProhibitSendQuota -and -not $mbx.ProhibitSendQuota.IsUnlimited -and $null -ne $mbx.ProhibitSendQuota.Value) {
                        $prohibitBytes = $mbx.ProhibitSendQuota.Value.ToBytes()
                    }
                    $stats = Get-MailboxStatistics -Identity $mbx.Identity -ErrorAction SilentlyContinue
                    $usedBytes = $null
                    if ($stats -and $stats.TotalItemSize -and -not $stats.TotalItemSize.IsUnlimited -and $null -ne $stats.TotalItemSize.Value) {
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

    # ── #1793: the app-only capability survey ────────────────────────────────
    # Six Script entries — one inventory + one probe per session type — whose
    # bodies live in survey.ps1 (dot-sourced by child-worker.ps1; see that
    # file's header for the read-safety gates and why the survey is code-owned
    # rather than driven by a cmdlet name in the request).
    #
    # These are the ONLY catalog entries whose AllowedParams are consumed by a
    # Script rather than splatted onto a cmdlet, and every one of those params
    # is an INTEGER window/budget control (Skip / Take / BudgetSeconds). They
    # cannot name a command, add a parameter to a probed command, or widen the
    # eligible set — #209's what-code-runs-stays-code-owned boundary is intact:
    # a caller can only ask "survey commands 40..64 of the list YOU computed."
    #
    # Session is explicit on all six (never the "compliance" default) because
    # which session a command is reachable through is precisely the thing the
    # survey measures; leaving it implicit would make the exchange and
    # compliance results indistinguishable.
    "survey-list-commands-compliance" = @{
        Script        = { param($SurveyParams) Invoke-SurveyInventory -SessionType "compliance" -RequestParams $SurveyParams }
        AllowedParams = @()
        Session       = "compliance"
    }
    "survey-list-commands-exchange" = @{
        Script        = { param($SurveyParams) Invoke-SurveyInventory -SessionType "exchange" -RequestParams $SurveyParams }
        AllowedParams = @()
        Session       = "exchange"
    }
    "survey-list-commands-teams" = @{
        Script        = { param($SurveyParams) Invoke-SurveyInventory -SessionType "teams" -RequestParams $SurveyParams }
        AllowedParams = @()
        Session       = "teams"
    }
    "survey-probe-compliance" = @{
        Script        = { param($SurveyParams) Invoke-SurveyProbe -SessionType "compliance" -RequestParams $SurveyParams }
        AllowedParams = @("Skip", "Take", "BudgetSeconds")
        Session       = "compliance"
    }
    "survey-probe-exchange" = @{
        Script        = { param($SurveyParams) Invoke-SurveyProbe -SessionType "exchange" -RequestParams $SurveyParams }
        AllowedParams = @("Skip", "Take", "BudgetSeconds")
        Session       = "exchange"
    }
    "survey-probe-teams" = @{
        Script        = { param($SurveyParams) Invoke-SurveyProbe -SessionType "teams" -RequestParams $SurveyParams }
        AllowedParams = @("Skip", "Take", "BudgetSeconds")
        Session       = "teams"
    }

    # #2762: compliance-surface coverage gap. Ten new UNFILTERED (no
    # PostFilter) read entries backing ten `monitor_checks` rows that close
    # real `config_resources` gaps (surface='compliance',
    # availability='available_now', check_coverage_count=0). Unfiltered on
    # purpose — the scoring lives entirely in the check's own
    # mapping/severity_rules (countWhere against real observed field names),
    # so the same catalog entry is also snapshot-usable per #1961's own
    # "unfiltered, added alongside the check-shaped entries" convention,
    # not just check-usable. All ten cmdlets are confirmed working app-only
    # against the real testbed tenant by #1793's own live capability survey
    # (`ps_capability_survey_results`, session_type='compliance', multiple
    # independent runs, status='ok') — see build-journal/2762.md for the
    # exact query and observed item counts. No parameters are required to
    # list the full set for any of the ten.
    "get-retention-compliance-policies" = @{
        Cmdlet         = "Get-RetentionCompliancePolicy"
        AllowedParams  = @()
    }
    "get-retention-compliance-rules" = @{
        Cmdlet         = "Get-RetentionComplianceRule"
        AllowedParams  = @()
    }
    "get-dlp-compliance-rules" = @{
        Cmdlet         = "Get-DlpComplianceRule"
        AllowedParams  = @()
    }
    "get-device-conditional-access-policies" = @{
        Cmdlet         = "Get-DeviceConditionalAccessPolicy"
        AllowedParams  = @()
    }
    "get-device-configuration-policies" = @{
        Cmdlet         = "Get-DeviceConfigurationPolicy"
        AllowedParams  = @()
    }
    "get-dlp-sensitive-info-types" = @{
        Cmdlet         = "Get-DlpSensitiveInformationType"
        AllowedParams  = @()
    }
    "get-protection-alerts" = @{
        Cmdlet         = "Get-ProtectionAlert"
        AllowedParams  = @()
    }
    "get-compliance-role-groups" = @{
        Cmdlet         = "Get-RoleGroup"
        AllowedParams  = @()
    }
    "get-compliance-tags" = @{
        Cmdlet         = "Get-ComplianceTag"
        AllowedParams  = @()
    }
    "get-retention-event-types" = @{
        Cmdlet         = "Get-ComplianceRetentionEventType"
        AllowedParams  = @()
    }

    # #2184: security:safe-links-coverage / security:safe-attachments-coverage /
    # security:antiphishing-coverage. All three currently query
    # /security/alerts_v2 for ANY item's existence — never the actual Defender
    # for Office 365 policy objects the check's own label/key name. These are
    # ExchangeOnlineManagement (EXO V2 module) cmdlets, same "Session = exchange"
    # family as get-antispam-policies/get-transport-rules above (NOT
    # Connect-IPPSSession-reachable — confirmed against Microsoft Learn: Get-
    # SafeLinksPolicy/Get-SafeAttachmentPolicy/Get-AntiPhishPolicy pages
    # (learn.microsoft.com/powershell/module/exchangepowershell/get-{safelinks,
    # safeattachment,antiphish}policy, checked 2026-09-04) live under the same
    # ExchangePowerShell module as Get-HostedContentFilterPolicy). No parameters
    # required to list every policy in the org (built-in + custom).
    #
    # No PostFilter — raw policy list, same "count -> gap subset computed on
    # the DB side via mapping/severity_rules" posture as get-audit-retention-
    # policy above, since the real "coverage gap" signal (which EnableSafe*/
    # Enabled boolean is off) is confirmed against LIVE fields returned by this
    # container against the real testbed tenant (see build-journal/2184.md),
    # not guessed from docs alone — Microsoft Learn's cmdlet reference pages
    # document parameters, not output schema.
    "get-safe-links-policies" = @{
        Cmdlet         = "Get-SafeLinksPolicy"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-safe-attachment-policies" = @{
        Cmdlet         = "Get-SafeAttachmentPolicy"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-antiphish-policies" = @{
        Cmdlet         = "Get-AntiPhishPolicy"
        AllowedParams  = @()
        Session        = "exchange"
    }

    # ═══════════════════════════════════════════════════════════════════════
    # #1961 — UNFILTERED snapshot-shaped read entries (pass 1: Exchange
    # Online + Purview/SecurityCompliance)
    # ═══════════════════════════════════════════════════════════════════════
    #
    # WHAT GAP THIS CLOSES. #1796's snapshot collector ran live against the
    # testbed and recorded 215 registry resource types as `skipped` /
    # `no_executor`: each names a real read cmdlet that this catalog had no
    # entry for, so by #209's design — cmdletKey resolves ONLY to a code-owned
    # entry here, a caller can never name a cmdlet — they were unreachable.
    # That is the boundary working as intended, not a bug; #1961 closes the
    # gap the only way the design allows, by widening this code-owned list.
    #
    # WHY THEY ARE ALL UNFILTERED. Every entry below is deliberately
    # PostFilter-free. A snapshot's consumer is #1797's differ and the
    # Dev→Test→Prod promotion path, which need the WHOLE set of objects; a
    # check's consumer wants the bad subset. One entry cannot serve both, so
    # the check-shaped entries above are untouched and these sit alongside
    # them. See the TWINS block below for the five cmdlets that now have one
    # of each.
    #
    # SECURITY POSTURE IS UNCHANGED — this widens WHICH cmdlets may run, and
    # nothing else. Every entry is code-owned and literal here; every one is a
    # `Get-*` read; every one declares `AllowedParams = @()`, so the request
    # body cannot fill a single parameter value, let alone influence which
    # cmdlet runs; none carries `IsWrite`. `Organization`/`TenantId` remain
    # the reserved connection fields Resolve-CmdletInvocation never forwards
    # to the cmdlet.
    #
    # WHY THESE CMDLETS, AND WHY WE KNOW THEY WORK. The set is not guessed
    # from Microsoft Learn — Learn documents parameters, not app-only support
    # or output shape. Every cmdlet below was recorded `status = 'ok'` by
    # #1793's real capability survey (run 4) executing it under app-only
    # certificate auth INSIDE THIS CONTAINER against the live testbed tenant,
    # in the session named on the entry. That survey's own gates are why
    # `AllowedParams = @()` is safe here: a cmdlet is probed only if it has a
    # parameter set with ZERO mandatory parameters, so each of these genuinely
    # lists org-wide with no arguments.
    #
    # DELIBERATELY NOT IN THIS PASS, so the omission is a decision on record
    # rather than an oversight:
    #   - Teams (`Get-Cs*`, ~54 resource types). A coherent, uniform block of
    #     its own; split out to keep this pass's live verification honest and
    #     bounded rather than rushing coverage (#1961's own instruction 5).
    #   - Per-user / per-mailbox / directory enumerations — Get-Mailbox,
    #     Get-User, Get-Recipient, Get-Group, Get-DistributionGroup,
    #     Get-ManagementRoleAssignment and friends. These are tenant INVENTORY,
    #     not tenant CONFIGURATION: unbounded in size, and not what a
    #     Dev→Test→Prod promotion moves. A snapshot of them needs a paging
    #     story this container does not have yet.
    #
    # KEY NAMING. `get-` + the cmdlet's own noun in kebab-case, singular,
    # mechanically derived so a reader can map key↔cmdlet without a lookup.
    # The `get-all-` prefix is reserved for the unfiltered twin of an existing
    # check-shaped key (the #1301 `get-all-dlp-policies` precedent).

    "get-accepted-domain" = @{
        Cmdlet         = "Get-AcceptedDomain"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-active-sync-device-access-rule" = @{
        Cmdlet         = "Get-ActiveSyncDeviceAccessRule"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-address-book-policy" = @{
        Cmdlet         = "Get-AddressBookPolicy"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-admin-audit-log-config" = @{
        Cmdlet         = "Get-AdminAuditLogConfig"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-anti-phish-rule" = @{
        Cmdlet         = "Get-AntiPhishRule"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-arc-config" = @{
        Cmdlet         = "Get-ArcConfig"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-atp-built-in-protection-rule" = @{
        Cmdlet         = "Get-ATPBuiltInProtectionRule"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-atp-policy-for-o365" = @{
        Cmdlet         = "Get-AtpPolicyForO365"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-atp-protection-policy-rule" = @{
        Cmdlet         = "Get-ATPProtectionPolicyRule"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-authentication-policy" = @{
        Cmdlet         = "Get-AuthenticationPolicy"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-cas-mailbox-plan" = @{
        Cmdlet         = "Get-CASMailboxPlan"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-data-classification" = @{
        Cmdlet         = "Get-DataClassification"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-device-conditional-access-rule" = @{
        Cmdlet         = "Get-DeviceConditionalAccessRule"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-device-configuration-rule" = @{
        Cmdlet         = "Get-DeviceConfigurationRule"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-dlp-sensitive-information-type-rule-package" = @{
        Cmdlet         = "Get-DlpSensitiveInformationTypeRulePackage"
        AllowedParams  = @()
        Session        = "compliance"
    }
    "get-email-tenant-settings" = @{
        Cmdlet         = "Get-EmailTenantSettings"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-eop-protection-policy-rule" = @{
        Cmdlet         = "Get-EOPProtectionPolicyRule"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-file-plan-property-authority" = @{
        Cmdlet         = "Get-FilePlanPropertyAuthority"
        AllowedParams  = @()
        Session        = "compliance"
    }
    "get-file-plan-property-category" = @{
        Cmdlet         = "Get-FilePlanPropertyCategory"
        AllowedParams  = @()
        Session        = "compliance"
    }
    "get-file-plan-property-citation" = @{
        Cmdlet         = "Get-FilePlanPropertyCitation"
        AllowedParams  = @()
        Session        = "compliance"
    }
    "get-file-plan-property-department" = @{
        Cmdlet         = "Get-FilePlanPropertyDepartment"
        AllowedParams  = @()
        Session        = "compliance"
    }
    "get-file-plan-property-reference-id" = @{
        Cmdlet         = "Get-FilePlanPropertyReferenceId"
        AllowedParams  = @()
        Session        = "compliance"
    }
    "get-file-plan-property-sub-category" = @{
        Cmdlet         = "Get-FilePlanPropertySubCategory"
        AllowedParams  = @()
        Session        = "compliance"
    }
    "get-hosted-connection-filter-policy" = @{
        Cmdlet         = "Get-HostedConnectionFilterPolicy"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-hosted-content-filter-rule" = @{
        Cmdlet         = "Get-HostedContentFilterRule"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-hosted-outbound-spam-filter-rule" = @{
        Cmdlet         = "Get-HostedOutboundSpamFilterRule"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-intra-organization-connector" = @{
        Cmdlet         = "Get-IntraOrganizationConnector"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-irm-configuration" = @{
        Cmdlet         = "Get-IRMConfiguration"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-journal-rule" = @{
        Cmdlet         = "Get-JournalRule"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-mailbox-plan" = @{
        Cmdlet         = "Get-MailboxPlan"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-malware-filter-policy" = @{
        Cmdlet         = "Get-MalwareFilterPolicy"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-malware-filter-rule" = @{
        Cmdlet         = "Get-MalwareFilterRule"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-management-scope" = @{
        Cmdlet         = "Get-ManagementScope"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-migration-endpoint" = @{
        Cmdlet         = "Get-MigrationEndpoint"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-mobile-device-mailbox-policy" = @{
        Cmdlet         = "Get-MobileDeviceMailboxPolicy"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-on-premises-organization" = @{
        Cmdlet         = "Get-OnPremisesOrganization"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-organization-config" = @{
        Cmdlet         = "Get-OrganizationConfig"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-organization-relationship" = @{
        Cmdlet         = "Get-OrganizationRelationship"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-outbound-connector" = @{
        Cmdlet         = "Get-OutboundConnector"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-owa-mailbox-policy" = @{
        Cmdlet         = "Get-OwaMailboxPolicy"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-partner-application" = @{
        Cmdlet         = "Get-PartnerApplication"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-perimeter-config" = @{
        Cmdlet         = "Get-PerimeterConfig"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-policy-config" = @{
        Cmdlet         = "Get-PolicyConfig"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-policy-tip-config" = @{
        Cmdlet         = "Get-PolicyTipConfig"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-quarantine-policy" = @{
        Cmdlet         = "Get-QuarantinePolicy"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-remote-domain" = @{
        Cmdlet         = "Get-RemoteDomain"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-report-submission-policy" = @{
        Cmdlet         = "Get-ReportSubmissionPolicy"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-report-submission-rule" = @{
        Cmdlet         = "Get-ReportSubmissionRule"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-retention-policy" = @{
        Cmdlet         = "Get-RetentionPolicy"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-retention-policy-tag" = @{
        Cmdlet         = "Get-RetentionPolicyTag"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-role-assignment-policy" = @{
        Cmdlet         = "Get-RoleAssignmentPolicy"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-safe-attachment-rule" = @{
        Cmdlet         = "Get-SafeAttachmentRule"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-safe-links-rule" = @{
        Cmdlet         = "Get-SafeLinksRule"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-sharing-policy" = @{
        Cmdlet         = "Get-SharingPolicy"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-supervisory-review-policy-v2" = @{
        Cmdlet         = "Get-SupervisoryReviewPolicyV2"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-supervisory-review-rule" = @{
        Cmdlet         = "Get-SupervisoryReviewRule"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-tenant-allow-block-list-spoof-items" = @{
        Cmdlet         = "Get-TenantAllowBlockListSpoofItems"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-transport-config" = @{
        Cmdlet         = "Get-TransportConfig"
        AllowedParams  = @()
        Session        = "exchange"
    }

    # ── Unfiltered TWINS of five existing check-shaped entries ──────────────
    # Each of these five cmdlets already appears above, but ONLY behind a
    # PostFilter that narrows it to a check's "gap" subset. A snapshot cannot
    # use those: #1795's first constraint is full fidelity, and storing a
    # filtered subset as if it were the whole set makes #1797's differ report
    # every excluded object as DELETED on the very next run. So each gets a
    # second, genuinely unfiltered entry under its own key — added ALONGSIDE
    # the check-shaped one, never replacing it, exactly as #1961 requires and
    # exactly the precedent `get-all-dlp-policies` (#1301) already set for
    # `Get-DlpCompliancePolicy` vs `get-dlp-policies`.
    #
    #   get-all-dkim-signing-config    vs get-dkim-disabled-domains  (DKIM-disabled only)
    #   get-all-inbound-connector      vs get-inbound-connector-tls-gap (no RequireTls only)
    #   get-all-label                  vs get-labels                (disabled labels only)
    #   get-all-label-policy           vs get-label-policies        (non-Success distribution only)
    #   get-all-hosted-outbound-spam-filter-policy
    #                                  vs get-auto-forward-risk-policies (AutoForwardingMode On only)
    "get-all-dkim-signing-config" = @{
        Cmdlet         = "Get-DkimSigningConfig"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-all-inbound-connector" = @{
        Cmdlet         = "Get-InboundConnector"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-all-hosted-outbound-spam-filter-policy" = @{
        Cmdlet         = "Get-HostedOutboundSpamFilterPolicy"
        AllowedParams  = @()
        Session        = "exchange"
    }
    "get-all-label" = @{
        Cmdlet         = "Get-Label"
        AllowedParams  = @()
        Session        = "compliance"
    }
    "get-all-label-policy" = @{
        Cmdlet         = "Get-LabelPolicy"
        AllowedParams  = @()
        Session        = "compliance"
    }

    # ═══════════════════════════════════════════════════════════════════════
    # #2850 — UNFILTERED snapshot-shaped read entries (pass 2: Microsoft Teams)
    # ═══════════════════════════════════════════════════════════════════════
    #
    # The block #1961 pass 1 deliberately deferred and said so on the record in
    # its own DELIBERATELY NOT IN THIS PASS note above. Everything that note
    # says about pass 1 applies here unchanged — same shape, same posture, same
    # evidence standard — so only what is SPECIFIC to Teams is restated:
    #
    # SESSION. Every entry declares `Session = "teams"`, the third session type
    # (alongside "exchange" and "compliance") that #1253 added for
    # Get-CsTeamsMeetingPolicy. No new session type is introduced here.
    #
    # WHY THESE 57 CMDLETS. Same evidence source as pass 1, not Microsoft Learn:
    # each one is named by a real `config_snapshot_resource_types` row whose
    # `read_transport = 'powershell'`, AND was recorded `status = 'ok'` by
    # #1793's capability survey (run 4) executing it under app-only certificate
    # auth INSIDE THIS CONTAINER, in the `teams` session, against the live
    # testbed tenant. Five further Get-Cs* cmdlets the registry names are
    # deliberately absent because the survey recorded them `not_attempted` —
    # unproven, so not allowlisted on a guess:
    #   Get-CsOnlineApplicationInstance   Get-CsOnlineVoicemailUserSettings
    #   Get-CsTeamsSettingsCustomApp      Get-CsUserCallingSettings
    #   Get-CsUserPolicyAssignment
    #
    # SECURITY POSTURE IS UNCHANGED, exactly as pass 1: every entry below is
    # code-owned and literal here, is a `Get-*` read, declares
    # `AllowedParams = @()` so the request body cannot fill a single parameter
    # value, and carries no `PostFilter` / `ResultProperty` / `IsWrite`.
    #
    # ONE TWIN. `Get-CsOnlineUser` already has the check-shaped
    # `get-cs-online-user` entry above (PostFilter -> Teams Phone users only).
    # Per #1961's rule a filtered key is never reused for a snapshot, so it is
    # left untouched and an unfiltered twin `get-all-cs-online-user` is added
    # alongside it — the #1301 `get-all-dlp-policies` precedent. Note this one
    # IS a per-user enumeration, the class pass 1 otherwise defers for lack of a
    # paging story; it is included only because three real Teams resource types
    # (TeamsCallQueue, TeamsOnlineVoiceUser, TeamsOnlineVoicemailUserSettings)
    # name it as a read cmdlet and this issue explicitly directs the twin.
    #
    # Get-CsTeamsMeetingPolicy is NOT repeated here — #1253's unfiltered
    # `get-cs-teams-meeting-policy` above already serves it.

    "get-cs-call-queue" = @{
        Cmdlet         = "Get-CsCallQueue"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-group-policy-assignment" = @{
        Cmdlet         = "Get-CsGroupPolicyAssignment"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-online-dial-in-conferencing-tenant-settings" = @{
        Cmdlet         = "Get-CsOnlineDialInConferencingTenantSettings"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-online-pstn-gateway" = @{
        Cmdlet         = "Get-CsOnlinePSTNGateway"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-online-pstn-usage" = @{
        Cmdlet         = "Get-CsOnlinePstnUsage"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-all-cs-online-user" = @{
        Cmdlet         = "Get-CsOnlineUser"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-online-voicemail-policy" = @{
        Cmdlet         = "Get-CsOnlineVoicemailPolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-online-voice-route" = @{
        Cmdlet         = "Get-CsOnlineVoiceRoute"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-online-voice-routing-policy" = @{
        Cmdlet         = "Get-CsOnlineVoiceRoutingPolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-phone-number-assignment" = @{
        Cmdlet         = "Get-CsPhoneNumberAssignment"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-ai-policy" = @{
        Cmdlet         = "Get-CsTeamsAIPolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-app-permission-policy" = @{
        Cmdlet         = "Get-CsTeamsAppPermissionPolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-app-setup-policy" = @{
        Cmdlet         = "Get-CsTeamsAppSetupPolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-audio-conferencing-policy" = @{
        Cmdlet         = "Get-CsTeamsAudioConferencingPolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-call-hold-policy" = @{
        Cmdlet         = "Get-CsTeamsCallHoldPolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-calling-policy" = @{
        Cmdlet         = "Get-CsTeamsCallingPolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-call-park-policy" = @{
        Cmdlet         = "Get-CsTeamsCallParkPolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-channels-policy" = @{
        Cmdlet         = "Get-CsTeamsChannelsPolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-client-configuration" = @{
        Cmdlet         = "Get-CsTeamsClientConfiguration"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-compliance-recording-application" = @{
        Cmdlet         = "Get-CsTeamsComplianceRecordingApplication"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-compliance-recording-policy" = @{
        Cmdlet         = "Get-CsTeamsComplianceRecordingPolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-cortana-policy" = @{
        Cmdlet         = "Get-CsTeamsCortanaPolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-emergency-calling-policy" = @{
        Cmdlet         = "Get-CsTeamsEmergencyCallingPolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-emergency-call-routing-policy" = @{
        Cmdlet         = "Get-CsTeamsEmergencyCallRoutingPolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-enhanced-encryption-policy" = @{
        Cmdlet         = "Get-CsTeamsEnhancedEncryptionPolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-events-policy" = @{
        Cmdlet         = "Get-CsTeamsEventsPolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-feedback-policy" = @{
        Cmdlet         = "Get-CsTeamsFeedbackPolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-files-policy" = @{
        Cmdlet         = "Get-CsTeamsFilesPolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-guest-calling-configuration" = @{
        Cmdlet         = "Get-CsTeamsGuestCallingConfiguration"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-guest-meeting-configuration" = @{
        Cmdlet         = "Get-CsTeamsGuestMeetingConfiguration"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-guest-messaging-configuration" = @{
        Cmdlet         = "Get-CsTeamsGuestMessagingConfiguration"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-ip-phone-policy" = @{
        Cmdlet         = "Get-CsTeamsIPPhonePolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-meeting-broadcast-configuration" = @{
        Cmdlet         = "Get-CsTeamsMeetingBroadcastConfiguration"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-meeting-broadcast-policy" = @{
        Cmdlet         = "Get-CsTeamsMeetingBroadcastPolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-meeting-configuration" = @{
        Cmdlet         = "Get-CsTeamsMeetingConfiguration"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-messaging-configuration" = @{
        Cmdlet         = "Get-CsTeamsMessagingConfiguration"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-messaging-policy" = @{
        Cmdlet         = "Get-CsTeamsMessagingPolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-mobility-policy" = @{
        Cmdlet         = "Get-CsTeamsMobilityPolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-network-roaming-policy" = @{
        Cmdlet         = "Get-CsTeamsNetworkRoamingPolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-notification-and-feeds-policy" = @{
        Cmdlet         = "Get-CsTeamsNotificationAndFeedsPolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-shifts-policy" = @{
        Cmdlet         = "Get-CsTeamsShiftsPolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-targeting-policy" = @{
        Cmdlet         = "Get-CsTeamsTargetingPolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-template-permission-policy" = @{
        Cmdlet         = "Get-CsTeamsTemplatePermissionPolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-translation-rule" = @{
        Cmdlet         = "Get-CsTeamsTranslationRule"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-unassigned-number-treatment" = @{
        Cmdlet         = "Get-CsTeamsUnassignedNumberTreatment"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-update-management-policy" = @{
        Cmdlet         = "Get-CsTeamsUpdateManagementPolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-upgrade-configuration" = @{
        Cmdlet         = "Get-CsTeamsUpgradeConfiguration"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-upgrade-policy" = @{
        Cmdlet         = "Get-CsTeamsUpgradePolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-vdi-policy" = @{
        Cmdlet         = "Get-CsTeamsVdiPolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-teams-work-load-policy" = @{
        Cmdlet         = "Get-CsTeamsWorkLoadPolicy"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-team-template-list" = @{
        Cmdlet         = "Get-CsTeamTemplateList"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-tenant-dial-plan" = @{
        Cmdlet         = "Get-CsTenantDialPlan"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-tenant-federation-configuration" = @{
        Cmdlet         = "Get-CsTenantFederationConfiguration"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-tenant-network-region" = @{
        Cmdlet         = "Get-CsTenantNetworkRegion"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-tenant-network-site" = @{
        Cmdlet         = "Get-CsTenantNetworkSite"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-tenant-network-subnet" = @{
        Cmdlet         = "Get-CsTenantNetworkSubnet"
        AllowedParams  = @()
        Session        = "teams"
    }
    "get-cs-tenant-trusted-ip-address" = @{
        Cmdlet         = "Get-CsTenantTrustedIPAddress"
        AllowedParams  = @()
        Session        = "teams"
    }
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
    # request-driven, same as every other field on a catalog entry.
    #
    # #1793: Script entries now receive the SAME AllowedParams-filtered
    # hashtable a cmdlet entry gets, handed to the scriptblock as its single
    # argument (child-worker.ps1 calls `& $Script $invocation.Params`). The
    # filtering is unchanged and still absolute — a name absent from this
    # entry's own AllowedParams never reaches the script — so this widens
    # nothing: #491's entry declares no AllowedParams and therefore still
    # receives an empty hashtable, exactly as before. The survey entries use
    # it to carry their integer Skip/Take/BudgetSeconds window.
    if ($catalogEntry.Script) {
        $scriptParams = @{}
        foreach ($allowedName in $catalogEntry.AllowedParams) {
            if ($RequestParams.ContainsKey($allowedName)) {
                $scriptParams[$allowedName] = $RequestParams[$allowedName]
            }
        }
        return @{
            Cmdlet   = "<script:$CmdletKey>"
            Params   = $scriptParams
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
