# survey.ps1 — the app-only capability survey (#1793), dot-sourced by
# child-worker.ps1 (and, for fail-fast key validation only, indirectly by
# entrypoint.ps1 through cmdlet-catalog.ps1).
#
# WHY THIS LIVES IN THE CONTAINER, NOT IN THE CALLER
# --------------------------------------------------
# #1793 asks "which of the several hundred cmdlets these modules export
# actually work under app-only certificate auth?" — a question that can only
# be answered by running them inside a live app-only session. The obvious
# shape (let the caller POST a cmdlet name to probe) would hand what-code-runs
# to the request body and destroy #209's security boundary, which
# cmdlet-catalog.ps1's own header states explicitly: `cmdletKey` resolves ONLY
# to a code-owned catalog entry, never to a script string from the request.
#
# So the whole survey is code-owned and lives here. The request supplies only
# a batch WINDOW (Skip/Take) and a time budget — integers — never a cmdlet
# name, never a parameter to pass to a probed cmdlet, never a predicate. Which
# commands are eligible, and how they are invoked, is decided entirely by the
# code in this file. A caller cannot widen the eligible set.
#
# READ-SAFETY — FAIL CLOSED, FROM THE COMMAND'S OWN METADATA
# ----------------------------------------------------------
# #1793's safety rule: the testbed tenant is Shane's REAL production Microsoft
# 365 tenant with write-back consent armed, so a cmdlet is executed only if its
# read-safety can be established from the cmdlet itself. Four independent gates,
# ALL of which must pass; anything failing any one of them is recorded
# `not_attempted` with the literal reason and is never invoked:
#
#   1. Verb is `Get`. `Get-` is PowerShell's own retrieve-only verb and the
#      only verb in the approved-verb list whose read-safety is establishable
#      without per-cmdlet human judgement.
#
#      `Test-*` is DELIBERATELY EXCLUDED even though #1793 names it a read
#      verb — several ExchangeOnlineManagement `Test-*` cmdlets are not reads
#      at all: `Test-Mailflow` sends a real probe message through the live
#      transport pipeline, `Test-MigrationServerAvailability` opens outbound
#      connections to a third-party host, `Test-OAuthConnectivity` performs a
#      live token exchange. The verb alone cannot distinguish those from a
#      genuine read, so the whole verb fails the "read-safety establishable
#      from the cmdlet's own metadata" bar and is recorded `not_attempted`
#      rather than guessed at, per the issue's own "fail closed on ambiguity"
#      instruction. This is the single largest deliberate unknown in the
#      survey and is reported as such.
#
#   2. The command does NOT declare SupportsShouldProcess. PowerShell exposes
#      the `WhatIf`/`Confirm` common parameters ONLY on commands that declare
#      themselves state-changing — this is the platform's own machine-readable
#      "this mutates something" marker, and it is locale-independent (unlike
#      parsing help text). A `Get-*` carrying it is treated as ambiguous.
#
#   3. At least one parameter set has ZERO mandatory parameters. A cmdlet
#      requiring an `-Identity` cannot be probed without inventing a target,
#      and inventing a target is exactly the fabricated-input failure #1793
#      forbids. Recorded `not_attempted` with its real mandatory parameter
#      names so the gap is visible rather than silent.
#
#   4. The command is not on $script:SurveyUnboundedDenyList — a code-owned
#      list of `Get-*` cmdlets that ARE reads but are unbounded/long-running
#      against a live production tenant (message trace and tracking-log
#      families, tenant-wide traffic/usage report families). Running these
#      would produce a survey that times out rather than a survey that
#      answers the question. Recorded `not_attempted` with that reason.
#
# WHAT IS CAPTURED — SHAPES, NEVER VALUES
# ---------------------------------------
# For an `ok` cmdlet the probe records the item count, the round-trip time,
# and the real PROPERTY NAMES of the returned objects. It never records a
# property VALUE. This is both what #1795's resource model actually needs and
# the only defensible posture when probing a real production tenant: the
# survey output is a schema, not an extract of Shane's tenant data.

Set-StrictMode -Off

# The modules whose exported surface each session type is surveyed against.
# Deliberately NOT a remembered/documented cmdlet list (#1793 is explicit
# about this): these are name PATTERNS matched against the modules genuinely
# loaded in this process AFTER Connect-* has run, so the dynamically
# registered EXO/IPPS session module (`tmpEXO_<random>`, which is where the
# real Exchange/Purview cmdlet surface actually lands — it is NOT exported by
# ExchangeOnlineManagement itself) is picked up as it really is.
$script:SurveySessionModulePatterns = @{
    "exchange"   = @("^tmpEXO_", "^ExchangeOnlineManagement$")
    "compliance" = @("^tmpEXO_", "^ExchangeOnlineManagement$")
    "teams"      = @("^MicrosoftTeams$", "^tmpEXO_")
}

# Gate 4 above. Regexes matched against the full command NAME. Every entry is
# a genuine read; each is excluded only because it is unbounded or
# long-running enough to consume the whole request budget on a live tenant.
$script:SurveyUnboundedDenyList = @(
    @{ Pattern = "^Get-MessageTrace";            Reason = "message-trace family: unbounded time-range query over live mail flow" }
    @{ Pattern = "^Get-MessageTrackingReport";   Reason = "message-trace family: unbounded time-range query over live mail flow" }
    @{ Pattern = "^Get-HistoricalSearch";        Reason = "message-trace family: unbounded historical search over live mail flow" }
    @{ Pattern = "^Get-Message$";                Reason = "transport queue enumeration: unbounded" }
    @{ Pattern = "^Get-Queue";                   Reason = "transport queue enumeration: unbounded" }
    @{ Pattern = "Report$";                      Reason = "tenant-wide reporting cmdlet: unbounded aggregation over live tenant history" }
    @{ Pattern = "^Get-MailDetail";              Reason = "tenant-wide reporting cmdlet: unbounded per-message detail" }
    @{ Pattern = "^Get-MailTraffic";             Reason = "tenant-wide reporting cmdlet: unbounded aggregation over live tenant history" }
    @{ Pattern = "^Get-StaleDevice";             Reason = "tenant-wide device enumeration: unbounded" }
)

function Get-SurveySessionModules {
    param([string]$SessionType)

    $patterns = $script:SurveySessionModulePatterns[$SessionType]
    if (-not $patterns) { $patterns = @("^tmpEXO_") }

    Get-Module | Where-Object {
        $name = $_.Name
        ($patterns | Where-Object { $name -match $_ }).Count -gt 0
    }
}

# Turns one CommandInfo into the flat metadata record the inventory, the
# eligibility gates and the persisted survey row all read from.
function ConvertTo-SurveyCommandRecord {
    param($Command, [string]$ModuleName)

    $name = $Command.Name

    # Min-mandatory across parameter sets: the cheapest way this command can
    # legally be invoked. A command is probe-eligible only when that minimum
    # is zero (gate 3).
    $minMandatory = $null
    $mandatoryNames = @()
    try {
        foreach ($set in $Command.ParameterSets) {
            $mandatory = @($set.Parameters | Where-Object { $_.IsMandatory } | ForEach-Object { $_.Name })
            if ($null -eq $minMandatory -or $mandatory.Count -lt $minMandatory) {
                $minMandatory = $mandatory.Count
                $mandatoryNames = $mandatory
            }
        }
    }
    catch {
        # A command whose parameter metadata cannot be read at all is treated
        # as having unknown mandatory params, which fails gate 3 closed.
        $minMandatory = $null
        $mandatoryNames = @()
    }
    if ($null -eq $minMandatory) { $minMandatory = -1 }

    $paramNames = @()
    try { $paramNames = @($Command.Parameters.Keys) } catch { $paramNames = @() }

    [PSCustomObject]@{
        Name                   = $name
        Verb                   = $Command.Verb
        Noun                   = $Command.Noun
        CommandType            = [string]$Command.CommandType
        ModuleName             = $ModuleName
        SupportsShouldProcess  = ($paramNames -contains "WhatIf") -or ($paramNames -contains "Confirm")
        MinMandatoryParamCount = $minMandatory
        MandatoryParamNames    = @($mandatoryNames)
        HasResultSizeParam     = ($paramNames -contains "ResultSize")
        ParameterCount         = $paramNames.Count
    }
}

# The real exported surface for this session type, sorted by name so Skip/Take
# windows are stable across requests (the driver depends on that: it walks the
# same list in batches across many container round trips).
function Get-SurveyCommandInventory {
    param([string]$SessionType)

    $records = @()
    foreach ($module in Get-SurveySessionModules -SessionType $SessionType) {
        $commands = @()
        try { $commands = @(Get-Command -Module $module.Name -ErrorAction Stop) }
        catch {
            Write-Log -Level "warn" -Message "survey: Get-Command failed for a loaded module" -Extra @{ module = $module.Name; error = $_.Exception.Message }
            continue
        }
        foreach ($command in $commands) {
            $records += (ConvertTo-SurveyCommandRecord -Command $command -ModuleName $module.Name)
        }
    }

    # De-duplicate by name (a command can be visible through more than one
    # loaded module) keeping the first, then sort for a stable window.
    $seen = @{}
    $unique = @()
    foreach ($record in ($records | Sort-Object Name)) {
        if ($seen.ContainsKey($record.Name)) { continue }
        $seen[$record.Name] = $true
        $unique += $record
    }
    return $unique
}

# Gates 1-4. Returns the eligibility decision plus, when ineligible, the
# literal reason recorded as the survey row's `not_attempted` reason.
function Get-SurveyEligibility {
    param($Record)

    if ($Record.Verb -ne "Get") {
        if ($Record.Verb -eq "Test") {
            return @{
                Eligible = $false
                Reason   = "Test-* verb excluded fail-closed: read-safety is not establishable from the cmdlet's own metadata (several ExchangeOnlineManagement Test-* cmdlets send real probe mail or open outbound connections rather than reading state)"
            }
        }
        $verbText = if ($Record.Verb) { "$($Record.Verb)-*" } else { "non-verb-noun command" }
        return @{ Eligible = $false; Reason = "$verbText is not a read verb (survey executes Get-* only)" }
    }

    if ($Record.SupportsShouldProcess) {
        return @{ Eligible = $false; Reason = "declares SupportsShouldProcess (exposes WhatIf/Confirm) — PowerShell's own state-changing marker, so read-safety cannot be established" }
    }

    if ($Record.MinMandatoryParamCount -lt 0) {
        return @{ Eligible = $false; Reason = "parameter metadata could not be read, so the mandatory-parameter set is unknown (fail closed)" }
    }
    if ($Record.MinMandatoryParamCount -gt 0) {
        return @{ Eligible = $false; Reason = "requires mandatory parameter(s) [$([string]::Join(', ', $Record.MandatoryParamNames))] — probing would require inventing a target value" }
    }

    foreach ($deny in $script:SurveyUnboundedDenyList) {
        if ($Record.Name -match $deny.Pattern) {
            return @{ Eligible = $false; Reason = "excluded as unbounded against a live production tenant — $($deny.Reason)" }
        }
    }

    return @{ Eligible = $true; Reason = $null }
}

# Maps a real thrown exception onto #1793's outcome vocabulary. Every branch
# keys off either the .NET exception TYPE or literal text Microsoft's own
# services return — nothing is inferred from what a cmdlet "should" do.
function Get-SurveyFailureStatus {
    param($ErrorRecord)

    $message = ""
    if ($ErrorRecord -and $ErrorRecord.Exception) { $message = [string]$ErrorRecord.Exception.Message }

    # Same locale-independent signal child-worker.ps1 already relies on (#250).
    if ($ErrorRecord.Exception -is [System.Management.Automation.CommandNotFoundException]) { return "cmdlet_unavailable" }
    if ($message -match "(?i)is not recognized as (a|the) name of a cmdlet, function, script file, or executable program") { return "cmdlet_unavailable" }

    if ($message -match "(?i)micro delay|throttl|too many requests|429|budget is exhausted|Cmdlet execution budget") { return "throttled" }

    # App-only / certificate-auth rejection. These are the literal phrasings
    # Exchange Online and Teams return when a cmdlet has no application-context
    # implementation, as distinct from a permission denial.
    if ($message -match "(?i)app-?only|application context|certificate based authentication is not supported|only supported (in|for) delegated|not supported when using a service principal|unattended") { return "not_supported_app_only" }

    if ($message -match "(?i)access denied|access is denied|insufficient (privileges|permissions)|not authorized|unauthorized|does not have permission|couldn't find object .* Make sure that you've typed it correctly|operation isn't allowed because it's out of the current user's write scope|RBAC") { return "access_denied" }

    return "error"
}

# Probes one already-eligible command inside the live session. Never receives
# anything from the request: $Record comes from the code-owned inventory.
function Invoke-SurveyCommandProbe {
    param($Record)

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

    # The ONLY parameter the survey ever passes. EXO cmdlets default to
    # ResultSize 1000; the survey needs the SHAPE, not the tenant's whole data
    # set, so a bounded page is both faster and a smaller read against real
    # production data. Recorded verbatim in `invoked_with` so no reader has to
    # guess how the row was produced.
    $invokeParams = @{}
    if ($Record.HasResultSizeParam) { $invokeParams["ResultSize"] = 5 }
    $invokedWith = if ($invokeParams.Count -gt 0) { "-ResultSize 5" } else { "(no parameters)" }

    $status = "ok"
    $errorMessage = $null
    $itemCount = 0
    $propertyNames = @()
    $typeName = $null

    try {
        $result = & $Record.Name @invokeParams -ErrorAction Stop
        $items = @($result)
        $itemCount = $items.Count
        if ($itemCount -gt 0 -and $null -ne $items[0]) {
            $first = $items[0]
            $typeName = $first.GetType().FullName
            try {
                # Property NAMES only — never values. See this file's header.
                $propertyNames = @($first.PSObject.Properties | ForEach-Object { $_.Name }) | Select-Object -First 400
            }
            catch { $propertyNames = @() }
        }
    }
    catch {
        $status = Get-SurveyFailureStatus -ErrorRecord $_
        $errorMessage = [string]$_.Exception.Message
        if ($errorMessage.Length -gt 1200) { $errorMessage = $errorMessage.Substring(0, 1200) }
    }

    $stopwatch.Stop()

    [PSCustomObject]@{
        Name          = $Record.Name
        Verb          = $Record.Verb
        Noun          = $Record.Noun
        ModuleName    = $Record.ModuleName
        Status        = $status
        ErrorMessage  = $errorMessage
        ItemCount     = $itemCount
        PropertyNames = @($propertyNames)
        TypeName      = $typeName
        ElapsedMs     = [int]$stopwatch.ElapsedMilliseconds
        InvokedWith   = $invokedWith
        Attempted     = $true
        Reason        = $null
    }
}

# The entry point the `survey-probe-*` catalog entries resolve to.
#
# $RequestParams is the ALREADY-FILTERED AllowedParams hashtable (Skip / Take /
# BudgetSeconds) — three integers. It cannot name a cmdlet, cannot add a
# parameter to one, and cannot change which commands are eligible; it only
# selects a window of the code-owned, deterministically sorted inventory.
function Invoke-SurveyProbe {
    param([string]$SessionType, [hashtable]$RequestParams = @{})

    $skip = 0
    $take = 25
    $budgetSeconds = 200
    if ($RequestParams.ContainsKey("Skip")) { $skip = [int]$RequestParams["Skip"] }
    if ($RequestParams.ContainsKey("Take")) { $take = [int]$RequestParams["Take"] }
    if ($RequestParams.ContainsKey("BudgetSeconds")) { $budgetSeconds = [int]$RequestParams["BudgetSeconds"] }

    if ($skip -lt 0) { $skip = 0 }
    if ($take -lt 1) { $take = 1 }
    if ($take -gt 200) { $take = 200 }

    # Clamp the budget against the PARENT's own kill timeout, read from the
    # same env var entrypoint.ps1 reads. The budget is only checked BETWEEN
    # cmdlets, so the real worst case is (budget + one whole cmdlet + the
    # Connect-* handshake). A budget merely *below* the timeout is therefore not
    # enough — a 150s budget under a 200s timeout was observed live to overrun
    # and get the child killed, losing an entire 60-command batch including the
    # results already collected in it.
    #
    # Half the timeout leaves a margin as large as the budget itself for that
    # last cmdlet plus the connect, and it tracks the env var rather than
    # hard-coding a number that silently becomes wrong if the timeout changes.
    $childTimeoutSeconds = if ($env:PS_EXECUTION_CHILD_TIMEOUT_SECONDS) { [int]$env:PS_EXECUTION_CHILD_TIMEOUT_SECONDS } else { 60 }
    $maxBudget = [Math]::Max(10, [Math]::Floor($childTimeoutSeconds / 2))
    if ($budgetSeconds -lt 10) { $budgetSeconds = 10 }
    if ($budgetSeconds -gt $maxBudget) { $budgetSeconds = $maxBudget }

    $inventory = Get-SurveyCommandInventory -SessionType $SessionType
    $total = $inventory.Count

    $window = @()
    if ($skip -lt $total) {
        $end = [Math]::Min($skip + $take, $total) - 1
        $window = @($inventory[$skip..$end])
    }

    $budget = [System.Diagnostics.Stopwatch]::StartNew()
    $rows = @()
    $processed = 0
    $stoppedEarly = $false

    foreach ($record in $window) {
        if ($budget.Elapsed.TotalSeconds -ge $budgetSeconds) { $stoppedEarly = $true; break }

        $eligibility = Get-SurveyEligibility -Record $record
        if (-not $eligibility.Eligible) {
            $rows += [PSCustomObject]@{
                Name          = $record.Name
                Verb          = $record.Verb
                Noun          = $record.Noun
                ModuleName    = $record.ModuleName
                Status        = "not_attempted"
                ErrorMessage  = $null
                ItemCount     = $null
                PropertyNames = @()
                TypeName      = $null
                ElapsedMs     = 0
                InvokedWith   = $null
                Attempted     = $false
                Reason        = $eligibility.Reason
            }
            $processed++
            continue
        }

        # Emitted BEFORE the cmdlet runs, on purpose. A cmdlet that hangs past
        # the parent's child timeout gets its whole process killed, so its
        # result never reaches the response — the only surviving evidence of
        # which cmdlet it was is this line in the container's log stream (the
        # parent relays child stderr onto its own stdout). Without it, a hang
        # is only identifiable by bisecting the batch from the client side,
        # which costs one full child timeout per halving.
        Write-Log -Level "info" -Message "survey probing cmdlet" -Extra @{ session = $SessionType; cmdlet = $record.Name; index = ($skip + $processed) }

        $rows += (Invoke-SurveyCommandProbe -Record $record)
        $processed++
    }

    Write-Log -Level "info" -Message "survey probe batch complete" -Extra @{
        session = $SessionType; skip = $skip; take = $take; total = $total
        processed = $processed; stoppedEarly = $stoppedEarly; budgetElapsedMs = [int]$budget.ElapsedMilliseconds
    }

    # ONE object, not a collection: the api-server normalizes a bare object to
    # a single-item `items` array, which is exactly the envelope the driver
    # reads (`items[0]`). Returning the rows as a bare array instead would
    # lose the batch-level fields the driver needs to page.
    return [PSCustomObject]@{
        SurveyKind       = "probe"
        SessionType      = $SessionType
        TotalCommands    = $total
        Skip             = $skip
        Take             = $take
        Processed        = $processed
        StoppedEarly     = $stoppedEarly
        BudgetSeconds    = $budgetSeconds
        BudgetElapsedMs  = [int]$budget.ElapsedMilliseconds
        Rows             = @($rows)
    }
}

# The entry point the `survey-list-commands-*` catalog entries resolve to:
# the raw enumerated surface, with each command's eligibility decision already
# attached, and nothing executed. This is the "enumerate the real exported
# surface" half of #1793 and is safe to run on its own.
function Invoke-SurveyInventory {
    param([string]$SessionType, [hashtable]$RequestParams = @{})

    $inventory = Get-SurveyCommandInventory -SessionType $SessionType
    $modules = @(Get-SurveySessionModules -SessionType $SessionType | ForEach-Object {
        [PSCustomObject]@{ Name = $_.Name; Version = [string]$_.Version; ModuleType = [string]$_.ModuleType }
    })

    $rows = @()
    foreach ($record in $inventory) {
        $eligibility = Get-SurveyEligibility -Record $record
        $rows += [PSCustomObject]@{
            Name                   = $record.Name
            Verb                   = $record.Verb
            Noun                   = $record.Noun
            CommandType            = $record.CommandType
            ModuleName             = $record.ModuleName
            SupportsShouldProcess  = $record.SupportsShouldProcess
            MinMandatoryParamCount = $record.MinMandatoryParamCount
            MandatoryParamNames    = @($record.MandatoryParamNames)
            ParameterCount         = $record.ParameterCount
            Eligible               = $eligibility.Eligible
            IneligibleReason       = $eligibility.Reason
        }
    }

    Write-Log -Level "info" -Message "survey inventory complete" -Extra @{
        session = $SessionType; modules = @($modules | ForEach-Object { $_.Name }) -join ","; total = $rows.Count
        eligible = @($rows | Where-Object { $_.Eligible }).Count
    }

    return [PSCustomObject]@{
        SurveyKind    = "inventory"
        SessionType   = $SessionType
        Modules       = $modules
        TotalCommands = $rows.Count
        EligibleCount = @($rows | Where-Object { $_.Eligible }).Count
        Rows          = @($rows)
    }
}
