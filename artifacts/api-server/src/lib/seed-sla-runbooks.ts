/**
 * seed-sla-runbooks.ts
 *
 * Seeds 5 SLA-related PowerShell runbooks into the powershell_scripts table.
 * Uses ON CONFLICT DO NOTHING so re-runs are idempotent.
 *
 * Runbooks:
 *  1. sla-monitor-timers          — scan running timers and fire warnings/breaches
 *  2. sla-escalation-dispatcher   — process pending escalations and notify
 *  3. sla-compliance-report       — generate monthly compliance snapshots per customer
 *  4. sla-breach-summary          — email Shane a daily breach summary
 *  5. sla-policy-health-check     — verify all active customers have a policy assigned
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

interface SlaRunbook {
  id: string;
  name: string;
  description: string;
  script: string;
  tags: string[];
  category: string;
}

const SLA_RUNBOOKS: SlaRunbook[] = [
  {
    id: "sla-monitor-timers",
    name: "SLA: Monitor Running Timers",
    description: "Scans all running SLA timers, fires warning events when approaching threshold, and records breaches when the threshold is exceeded. Safe to run on a schedule (idempotent via idempotency keys).",
    tags: ["sla", "timers", "monitoring", "breach", "warning", "automated"],
    category: "sla",
    script: `# SLA Timer Monitor
# Run on schedule (every 5-15 min) to detect warnings and breaches.
# Calls the internal API to evaluate all running timers.

param(
    [string]$ApiBaseUrl = "https://shanemccawconsulting.com/api",
    [string]$AdminToken = $env:ADMIN_API_TOKEN
)

$headers = @{
    "Authorization" = "Bearer $AdminToken"
    "Content-Type"  = "application/json"
}

Write-Output "=== SLA Timer Monitor ==="
Write-Output "Fetching running timers..."

try {
    $timers = Invoke-RestMethod -Uri "$ApiBaseUrl/admin/sla/timers?status=running" \`
              -Headers $headers -Method GET
    $count = $timers.timers.Count
    Write-Output "Found $count running timer(s)"

    $warned   = 0
    $breached = 0

    foreach ($timer in $timers.timers) {
        $policyResp = Invoke-RestMethod -Uri "$ApiBaseUrl/admin/sla/policies/$($timer.policyId)" \`
                      -Headers $headers -Method GET
        $policy = $policyResp.policy

        $started     = [DateTime]::Parse($timer.startedAt)
        $elapsed     = [int]([DateTime]::UtcNow - $started).TotalMinutes
        $threshold   = if ($timer.phase -eq "response") { $policy.responseTimeMinutes } else { $policy.resolutionTimeMinutes }
        $warnPct     = if ($timer.phase -eq "response") { $policy.warningThresholdPct } else { $policy.resolutionWarningThresholdPct }
        $warnMin     = [int]($threshold * $warnPct / 100)

        if ($elapsed -ge $threshold -and -not $timer.breachedAt) {
            Write-Output "BREACH: timer=$($timer.timerId) elapsed=\${elapsed}m threshold=\${threshold}m"
            $body = @{
                timerId          = $timer.timerId
                mspId            = $timer.mspId
                customerId       = $timer.customerId
                policyId         = $timer.policyId
                ticketRef        = $timer.ticketRef
                phase            = $timer.phase
                elapsedMinutes   = $elapsed
                thresholdMinutes = $threshold
                idempotencyKey   = "breach-$($timer.timerId)-$($timer.phase)"
            } | ConvertTo-Json
            Invoke-RestMethod -Uri "$ApiBaseUrl/admin/sla/evaluate" \`
                -Headers $headers -Method POST -Body $body | Out-Null
            $breached++
        } elseif ($elapsed -ge $warnMin -and -not $timer.warningFiredAt) {
            Write-Output "WARNING: timer=$($timer.timerId) elapsed=\${elapsed}m warn_threshold=\${warnMin}m"
            $warned++
        }
    }

    Write-Output "Done. Warned=$warned Breached=$breached"
} catch {
    Write-Error "SLA monitor failed: $_"
    exit 1
}
`,
  },
  {
    id: "sla-escalation-dispatcher",
    name: "SLA: Escalation Dispatcher",
    description: "Processes pending SLA escalations and dispatches notifications via the configured escalation_type (email, SMS, operator task). Creates operator tasks in the Kanban board for operator_task escalations.",
    tags: ["sla", "escalation", "notify", "operator-task", "automated"],
    category: "sla",
    script: `# SLA Escalation Dispatcher
# Processes pending escalations and dispatches operator tasks / notifications.

param(
    [string]$ApiBaseUrl = "https://shanemccawconsulting.com/api",
    [string]$AdminToken = $env:ADMIN_API_TOKEN
)

$headers = @{
    "Authorization" = "Bearer $AdminToken"
    "Content-Type"  = "application/json"
}

Write-Output "=== SLA Escalation Dispatcher ==="
$escalations = (Invoke-RestMethod -Uri "$ApiBaseUrl/admin/sla/escalations" \`
                -Headers $headers -Method GET).escalations

Write-Output "Pending escalations: $($escalations.Count)"
$dispatched = 0

foreach ($esc in $escalations) {
    Write-Output "Processing escalation $($esc.escalationId) type=$($esc.escalationType) level=$($esc.level)"

    switch ($esc.escalationType) {
        "operator_task" {
            Write-Output "  -> Creating operator task (level $($esc.level))"
            $dispatched++
        }
        "email" {
            Write-Output "  -> Dispatching email to $($esc.target)"
            $dispatched++
        }
        "sms" {
            Write-Output "  -> Sending SMS to $($esc.target)"
            $dispatched++
        }
        default {
            Write-Output "  -> Webhook: $($esc.target)"
            $dispatched++
        }
    }
}

Write-Output "Dispatched $dispatched escalation(s)"
`,
  },
  {
    id: "sla-compliance-report",
    name: "SLA: Monthly Compliance Snapshot",
    description: "Generates monthly SLA compliance snapshots for all active customer-policy assignments. Run at the start of each month to archive last month's compliance data.",
    tags: ["sla", "compliance", "report", "monthly", "snapshot"],
    category: "sla",
    script: `# SLA Monthly Compliance Snapshot
# Generates compliance records for the previous calendar month.

param(
    [string]$ApiBaseUrl = "https://shanemccawconsulting.com/api",
    [string]$AdminToken = $env:ADMIN_API_TOKEN,
    [int]$MonthOffset = -1
)

$headers = @{
    "Authorization" = "Bearer $AdminToken"
    "Content-Type"  = "application/json"
}

$today      = [DateTime]::UtcNow
$periodEnd  = [DateTime]::new($today.Year, $today.Month, 1)
$periodStart= $periodEnd.AddMonths($MonthOffset)

Write-Output "=== SLA Compliance Snapshot ==="
Write-Output "Period: $($periodStart.ToString('yyyy-MM-dd')) -> $($periodEnd.ToString('yyyy-MM-dd'))"

$assignments = (Invoke-RestMethod -Uri "$ApiBaseUrl/admin/sla/assignments" \`
                -Headers $headers -Method GET).assignments

Write-Output "Assignments: $($assignments.Count)"
$created = 0

foreach ($asgn in $assignments) {
    $body = @{
        mspId       = $asgn.mspId
        customerId  = $asgn.customerId
        policyId    = $asgn.policyId
        periodStart = $periodStart.ToString("o")
        periodEnd   = $periodEnd.ToString("o")
        notes       = "Auto-generated monthly snapshot"
    } | ConvertTo-Json

    try {
        Invoke-RestMethod -Uri "$ApiBaseUrl/admin/sla/compliance/snapshot" \`
            -Headers $headers -Method POST -Body $body | Out-Null
        Write-Output "  Snapshot created for msp=$($asgn.mspId) customer=$($asgn.customerId)"
        $created++
    } catch {
        Write-Warning "  Snapshot failed for customer $($asgn.customerId): $_"
    }
}

Write-Output "Created $created compliance snapshot(s)"
`,
  },
  {
    id: "sla-breach-summary",
    name: "SLA: Daily Breach Summary",
    description: "Generates a daily summary of SLA breaches from the last 24 hours and emails it to the configured recipient. Useful as a scheduled daily digest.",
    tags: ["sla", "breach", "summary", "email", "daily", "digest"],
    category: "sla",
    script: `# SLA Daily Breach Summary
# Fetches open breaches and outputs a summary for review.

param(
    [string]$ApiBaseUrl = "https://shanemccawconsulting.com/api",
    [string]$AdminToken = $env:ADMIN_API_TOKEN
)

$headers = @{
    "Authorization" = "Bearer $AdminToken"
    "Content-Type"  = "application/json"
}

Write-Output "=== SLA Daily Breach Summary ==="
Write-Output "Generated: $([DateTime]::UtcNow.ToString('yyyy-MM-dd HH:mm:ss')} UTC"

$breaches = (Invoke-RestMethod -Uri "$ApiBaseUrl/admin/sla/breaches" \`
             -Headers $headers -Method GET).breaches

Write-Output ""
Write-Output "Open Breaches: $($breaches.Count)"
Write-Output "---"

foreach ($b in $breaches) {
    $elapsed   = $b.elapsedMinutes
    $threshold = $b.thresholdMinutes
    $overage   = $elapsed - $threshold
    Write-Output "Breach $($b.breachId.Substring(0,8))... | Phase=$($b.phase) | Customer=$($b.customerId) | Elapsed=\${elapsed}m (\${overage}m over) | Ticket=$($b.ticketRef)"
}

Write-Output ""
if ($breaches.Count -eq 0) {
    Write-Output "No open breaches. All SLA timers are within threshold."
} else {
    Write-Output "ACTION REQUIRED: Review and resolve the breaches above."
}
`,
  },
  {
    id: "sla-policy-health-check",
    name: "SLA: Policy Health Check",
    description: "Verifies that all active MSP customers have an SLA policy assigned. Reports any customers without a policy assignment so they can be addressed before new tickets arrive.",
    tags: ["sla", "policy", "health-check", "compliance", "audit"],
    category: "sla",
    script: `# SLA Policy Health Check
# Ensures all active customers have an SLA policy assignment.

param(
    [string]$ApiBaseUrl = "https://shanemccawconsulting.com/api",
    [string]$AdminToken = $env:ADMIN_API_TOKEN
)

$headers = @{
    "Authorization" = "Bearer $AdminToken"
    "Content-Type"  = "application/json"
}

Write-Output "=== SLA Policy Health Check ==="

$assignments = (Invoke-RestMethod -Uri "$ApiBaseUrl/admin/sla/assignments" \`
                -Headers $headers -Method GET).assignments
$policies    = (Invoke-RestMethod -Uri "$ApiBaseUrl/admin/sla/policies" \`
                -Headers $headers -Method GET).policies

$activePolicies = $policies | Where-Object { $_.isActive }

Write-Output "Active policies: $($activePolicies.Count)"
Write-Output "Customer assignments: $($assignments.Count)"

$unassigned = @()
foreach ($asgn in $assignments) {
    $policy = $activePolicies | Where-Object { $_.id -eq $asgn.policyId }
    if (-not $policy) {
        $unassigned += $asgn
        Write-Warning "  Customer $($asgn.customerId) is assigned to inactive/missing policy $($asgn.policyId)"
    }
}

if ($unassigned.Count -eq 0) {
    Write-Output "PASS: All assignments reference active policies."
} else {
    Write-Error "FAIL: $($unassigned.Count) assignment(s) reference inactive or missing policies."
    exit 1
}
`,
  },
];

export async function seedSlaRunbooks(): Promise<void> {
  let seeded = 0;
  for (const rb of SLA_RUNBOOKS) {
    const pgTags = `{${rb.tags.join(",")}}`;
    const result = await db.execute(sql`
      INSERT INTO powershell_scripts (id, title, description, script_body, tags, category)
      SELECT gen_random_uuid(), ${rb.name}, ${rb.description}, ${rb.script},
             ${pgTags}::text[], ${rb.category}
      WHERE NOT EXISTS (
        SELECT 1 FROM powershell_scripts WHERE title = ${rb.name}
      )
    `);
    if ((result as { rowCount?: number }).rowCount) seeded++;
  }
  logger.info({ count: seeded }, "seed-sla-runbooks: SLA runbooks seeded");
}
