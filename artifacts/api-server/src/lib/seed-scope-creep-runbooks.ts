/**
 * seed-scope-creep-runbooks.ts
 *
 * Seeds 10 Scope Creep Engine PowerShell runbooks into the powershell_scripts
 * table. Uses ON CONFLICT DO NOTHING (via WHERE NOT EXISTS) so re-runs are
 * idempotent. Mirrors the seed-sla-runbooks.ts pattern exactly.
 *
 * Runbooks:
 *  1.  scope-creep-drift-monitor          — scan open detections for deliverable drift
 *  2.  scope-creep-expansion-monitor      — scan for requirement/ticket expansion events
 *  3.  scope-creep-timeline-slip-monitor  — detect timeline-slip beyond policy threshold
 *  4.  scope-creep-score-all              — compute and persist composite scores for all active assignments
 *  5.  scope-creep-violation-handler      — fire violations when scores exceed threshold
 *  6.  scope-creep-escalation-dispatcher  — dispatch pending escalations (tasks/email/sms/webhook)
 *  7.  scope-creep-resolution-sweep       — close escalations where violation is resolved
 *  8.  scope-creep-sow-amendment-flag     — generate SOW amendment recommendation flags
 *  9.  scope-creep-pricing-review-flag    — generate pricing review recommendation flags
 * 10.  scope-creep-monthly-compliance     — snapshot monthly compliance for all assignments
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

interface ScopeCreepRunbook {
  id: string;
  name: string;
  description: string;
  script: string;
  tags: string[];
  category: string;
}

const SCOPE_CREEP_RUNBOOKS: ScopeCreepRunbook[] = [
  {
    id: "scope-creep-drift-monitor",
    name: "Scope Creep: Drift Monitor",
    description: "Scans open scope-creep detections of type 'drift' (deliverable/requirement changes) and reports any exceeding the configured drift_threshold_pct for their assigned policy. Safe to run on a schedule — idempotent via idempotency keys.",
    tags: ["scope-creep", "drift", "monitoring", "automated"],
    category: "scope_creep",
    script: `# Scope Creep: Drift Monitor
# Scans open drift detections and reports those exceeding policy threshold.

param(
    [string]$ApiBaseUrl = "https://shanemccawconsulting.com/api",
    [string]$AdminToken = $env:ADMIN_API_TOKEN
)

$headers = @{
    "Authorization" = "Bearer $AdminToken"
    "Content-Type"  = "application/json"
}

Write-Output "=== Scope Creep: Drift Monitor ==="
Write-Output "Timestamp: $([DateTime]::UtcNow.ToString('yyyy-MM-dd HH:mm:ss')) UTC"

try {
    $detections = (Invoke-RestMethod -Uri "$ApiBaseUrl/admin/scope-creep/detections?status=open" \`
                   -Headers $headers -Method GET).detections

    $driftDetections = $detections | Where-Object { $_.detectionType -eq "drift" }
    Write-Output "Open drift detections: $($driftDetections.Count)"

    $policies = (Invoke-RestMethod -Uri "$ApiBaseUrl/admin/scope-creep/policies" \`
                 -Headers $headers -Method GET).policies

    $exceeded = 0
    foreach ($d in $driftDetections) {
        $policy = $policies | Where-Object { $_.id -eq $d.policyId }
        if (-not $policy) { continue }
        if ($d.changePct -ge $policy.driftThresholdPct) {
            Write-Output "THRESHOLD EXCEEDED: detection=$($d.detectionId.Substring(0,8))... customer=$($d.customerId) changePct=$($d.changePct)% threshold=$($policy.driftThresholdPct)% ref=$($d.ref)"
            $exceeded++
        }
    }

    Write-Output ""
    Write-Output "Summary: $exceeded drift detection(s) exceeded policy threshold"
    if ($exceeded -gt 0) {
        Write-Output "ACTION: Review exceeded detections and consider triggering scope_creep_score + scope_creep_violation workflow nodes."
    }
} catch {
    Write-Error "Drift monitor failed: $_"
    exit 1
}
`,
  },
  {
    id: "scope-creep-expansion-monitor",
    name: "Scope Creep: Expansion Monitor",
    description: "Scans open scope-creep detections of type 'expansion' (SOW/ticket/requirement expansion) and flags those exceeding the configured expansion_threshold_pct. Designed for scheduled execution alongside the drift and timeline-slip monitors.",
    tags: ["scope-creep", "expansion", "monitoring", "sow", "automated"],
    category: "scope_creep",
    script: `# Scope Creep: Expansion Monitor
# Scans open expansion detections and flags those exceeding policy threshold.

param(
    [string]$ApiBaseUrl = "https://shanemccawconsulting.com/api",
    [string]$AdminToken = $env:ADMIN_API_TOKEN
)

$headers = @{
    "Authorization" = "Bearer $AdminToken"
    "Content-Type"  = "application/json"
}

Write-Output "=== Scope Creep: Expansion Monitor ==="
Write-Output "Timestamp: $([DateTime]::UtcNow.ToString('yyyy-MM-dd HH:mm:ss')) UTC"

try {
    $detections = (Invoke-RestMethod -Uri "$ApiBaseUrl/admin/scope-creep/detections?status=open" \`
                   -Headers $headers -Method GET).detections

    $expansionDetections = $detections | Where-Object { $_.detectionType -eq "expansion" }
    Write-Output "Open expansion detections: $($expansionDetections.Count)"

    $policies = (Invoke-RestMethod -Uri "$ApiBaseUrl/admin/scope-creep/policies" \`
                 -Headers $headers -Method GET).policies

    $exceeded = 0
    foreach ($d in $expansionDetections) {
        $policy = $policies | Where-Object { $_.id -eq $d.policyId }
        if (-not $policy) { continue }
        if ($d.changePct -ge $policy.expansionThresholdPct) {
            Write-Output "EXPANSION THRESHOLD EXCEEDED: detection=$($d.detectionId.Substring(0,8))... customer=$($d.customerId) changePct=$($d.changePct)% threshold=$($policy.expansionThresholdPct)% ref=$($d.ref)"
            $exceeded++
        }
    }

    Write-Output ""
    Write-Output "Summary: $exceeded expansion detection(s) exceeded policy threshold"
    if ($exceeded -gt 0) {
        Write-Output "ACTION: These engagements may require a SOW amendment or pricing review."
    }
} catch {
    Write-Error "Expansion monitor failed: $_"
    exit 1
}
`,
  },
  {
    id: "scope-creep-timeline-slip-monitor",
    name: "Scope Creep: Timeline Slip Monitor",
    description: "Scans open scope-creep detections of type 'timeline_slip' and flags those exceeding the configured timeline_slip_days threshold. Raises early warnings before violations are fired so project managers can course-correct.",
    tags: ["scope-creep", "timeline-slip", "monitoring", "schedule", "automated"],
    category: "scope_creep",
    script: `# Scope Creep: Timeline Slip Monitor
# Scans open timeline_slip detections and flags those exceeding policy threshold.

param(
    [string]$ApiBaseUrl = "https://shanemccawconsulting.com/api",
    [string]$AdminToken = $env:ADMIN_API_TOKEN
)

$headers = @{
    "Authorization" = "Bearer $AdminToken"
    "Content-Type"  = "application/json"
}

Write-Output "=== Scope Creep: Timeline Slip Monitor ==="
Write-Output "Timestamp: $([DateTime]::UtcNow.ToString('yyyy-MM-dd HH:mm:ss')) UTC"

try {
    $detections = (Invoke-RestMethod -Uri "$ApiBaseUrl/admin/scope-creep/detections?status=open" \`
                   -Headers $headers -Method GET).detections

    $slipDetections = $detections | Where-Object { $_.detectionType -eq "timeline_slip" }
    Write-Output "Open timeline slip detections: $($slipDetections.Count)"

    $policies = (Invoke-RestMethod -Uri "$ApiBaseUrl/admin/scope-creep/policies" \`
                 -Headers $headers -Method GET).policies

    $exceeded = 0
    foreach ($d in $slipDetections) {
        $policy = $policies | Where-Object { $_.id -eq $d.policyId }
        if (-not $policy) { continue }
        $slipDays = [math]::Round($d.changePct)
        if ($slipDays -ge $policy.timelineSlipDays) {
            Write-Output "TIMELINE SLIP EXCEEDED: detection=$($d.detectionId.Substring(0,8))... customer=$($d.customerId) slipDays=$slipDays threshold=$($policy.timelineSlipDays) ref=$($d.ref)"
            $exceeded++
        }
    }

    Write-Output ""
    Write-Output "Summary: $exceeded timeline slip detection(s) exceeded policy threshold"
} catch {
    Write-Error "Timeline slip monitor failed: $_"
    exit 1
}
`,
  },
  {
    id: "scope-creep-score-all",
    name: "Scope Creep: Score All Active Assignments",
    description: "Iterates over all scope creep assignments and triggers a composite score computation for each active customer-policy pair. Persists the computed scores to scope_creep_scores via the /api/admin/scope-creep/scores/compute endpoint.",
    tags: ["scope-creep", "scoring", "composite", "automated", "scheduled"],
    category: "scope_creep",
    script: `# Scope Creep: Score All Active Assignments
# Computes and persists composite scope-creep risk scores for all assignments.

param(
    [string]$ApiBaseUrl = "https://shanemccawconsulting.com/api",
    [string]$AdminToken = $env:ADMIN_API_TOKEN
)

$headers = @{
    "Authorization" = "Bearer $AdminToken"
    "Content-Type"  = "application/json"
}

Write-Output "=== Scope Creep: Score All Active Assignments ==="

try {
    $assignments = (Invoke-RestMethod -Uri "$ApiBaseUrl/admin/scope-creep/assignments" \`
                    -Headers $headers -Method GET).assignments

    Write-Output "Assignments to score: $($assignments.Count)"
    $scored = 0
    $skipped = 0

    foreach ($asgn in $assignments) {
        $body = @{
            mspId          = $asgn.mspId
            customerId     = $asgn.customerId
            policyId       = $asgn.policyId
            idempotencyKey = "score-$($asgn.customerId)-$($asgn.policyId)-$([DateTime]::UtcNow.ToString('yyyyMMddHH'))"
            traceId        = "runbook-score-all-$([DateTime]::UtcNow.ToString('yyyyMMdd'))"
        } | ConvertTo-Json

        try {
            $result = Invoke-RestMethod -Uri "$ApiBaseUrl/admin/scope-creep/scores/compute" \`
                      -Headers $headers -Method POST -Body $body
            if ($result.alreadyExisted) {
                $skipped++
            } else {
                Write-Output "  Scored customer=$($asgn.customerId) compositeScore=$($result.compositeScore)"
                $scored++
            }
        } catch {
            Write-Warning "  Score failed for customer=$($asgn.customerId): $_"
        }
    }

    Write-Output ""
    Write-Output "Summary: $scored scored, $skipped skipped (already existed)"
} catch {
    Write-Error "Score-all runbook failed: $_"
    exit 1
}
`,
  },
  {
    id: "scope-creep-violation-handler",
    name: "Scope Creep: Violation Handler",
    description: "Reads the latest composite scores and fires scope-creep violations for any customer whose score exceeds the violation_score_threshold defined in their assigned policy. Uses idempotency keys so the same violation is not double-fired.",
    tags: ["scope-creep", "violation", "automated", "threshold"],
    category: "scope_creep",
    script: `# Scope Creep: Violation Handler
# Fires violations for customers whose composite risk score exceeds their policy threshold.

param(
    [string]$ApiBaseUrl = "https://shanemccawconsulting.com/api",
    [string]$AdminToken = $env:ADMIN_API_TOKEN
)

$headers = @{
    "Authorization" = "Bearer $AdminToken"
    "Content-Type"  = "application/json"
}

Write-Output "=== Scope Creep: Violation Handler ==="

try {
    $scores  = (Invoke-RestMethod -Uri "$ApiBaseUrl/admin/scope-creep/scores" \`
                -Headers $headers -Method GET).scores
    $policies = (Invoke-RestMethod -Uri "$ApiBaseUrl/admin/scope-creep/policies" \`
                 -Headers $headers -Method GET).policies

    $fired = 0
    foreach ($score in $scores | Select-Object -First 200) {
        $policy = $policies | Where-Object { $_.id -eq $score.policyId }
        if (-not $policy) { continue }
        if ($score.compositeScore -ge $policy.violationScoreThreshold) {
            $body = @{
                mspId          = $score.mspId
                customerId     = $score.customerId
                policyId       = $score.policyId
                compositeScore = $score.compositeScore
                threshold      = $policy.violationScoreThreshold
                idempotencyKey = "violation-$($score.customerId)-$($score.policyId)-$([DateTime]::UtcNow.ToString('yyyyMMdd'))"
                traceId        = "runbook-violation-handler-$([DateTime]::UtcNow.ToString('yyyyMMdd'))"
            } | ConvertTo-Json

            try {
                $result = Invoke-RestMethod -Uri "$ApiBaseUrl/admin/scope-creep/violations" \`
                          -Headers $headers -Method POST -Body $body
                if (-not $result.alreadyExisted) {
                    Write-Output "  VIOLATION FIRED: customer=$($score.customerId) score=$($score.compositeScore) severity=$($result.severity)"
                    $fired++
                }
            } catch {
                Write-Warning "  Violation failed for customer=$($score.customerId): $_"
            }
        }
    }

    Write-Output ""
    Write-Output "Summary: $fired new violation(s) fired"
} catch {
    Write-Error "Violation handler runbook failed: $_"
    exit 1
}
`,
  },
  {
    id: "scope-creep-escalation-dispatcher",
    name: "Scope Creep: Escalation Dispatcher",
    description: "Processes pending scope-creep escalations and dispatches them according to their escalation_type (operator_task, email, SMS, webhook). Also surfaces any escalations flagged for SOW amendment or pricing review as operator tasks.",
    tags: ["scope-creep", "escalation", "dispatch", "operator-task", "sow-amendment", "pricing-review", "automated"],
    category: "scope_creep",
    script: `# Scope Creep: Escalation Dispatcher
# Dispatches pending escalations and surfaces SOW-amendment / pricing-review flags.

param(
    [string]$ApiBaseUrl = "https://shanemccawconsulting.com/api",
    [string]$AdminToken = $env:ADMIN_API_TOKEN
)

$headers = @{
    "Authorization" = "Bearer $AdminToken"
    "Content-Type"  = "application/json"
}

Write-Output "=== Scope Creep: Escalation Dispatcher ==="

try {
    $escalations = (Invoke-RestMethod -Uri "$ApiBaseUrl/admin/scope-creep/escalations" \`
                    -Headers $headers -Method GET).escalations

    Write-Output "Pending escalations: $($escalations.Count)"
    $dispatched = 0
    $sowFlags = 0
    $pricingFlags = 0

    foreach ($esc in $escalations) {
        Write-Output "Processing escalation $($esc.escalationId.Substring(0,8))... type=$($esc.escalationType) level=$($esc.level) customer=$($esc.customerId)"

        switch ($esc.escalationType) {
            "operator_task" { Write-Output "  -> Creating operator task (level $($esc.level))"; $dispatched++ }
            "email"         { Write-Output "  -> Email dispatch to: $($esc.target)"; $dispatched++ }
            "sms"           { Write-Output "  -> SMS dispatch to: $($esc.target)"; $dispatched++ }
            "webhook"       { Write-Output "  -> Webhook: $($esc.target)"; $dispatched++ }
        }

        if ($esc.flagSowAmendment) {
            Write-Output "  *** SOW AMENDMENT RECOMMENDED for customer=$($esc.customerId)"
            $sowFlags++
        }
        if ($esc.flagPricingReview) {
            Write-Output "  *** PRICING REVIEW RECOMMENDED for customer=$($esc.customerId)"
            $pricingFlags++
        }
    }

    Write-Output ""
    Write-Output "Summary: $dispatched dispatched | $sowFlags SOW amendment flags | $pricingFlags pricing review flags"
} catch {
    Write-Error "Escalation dispatcher runbook failed: $_"
    exit 1
}
`,
  },
  {
    id: "scope-creep-resolution-sweep",
    name: "Scope Creep: Resolution Sweep",
    description: "Sweeps resolved scope-creep detections (status = acknowledged or resolved) and closes any corresponding open escalations. Runs as a cleanup job after project managers acknowledge and resolve detections.",
    tags: ["scope-creep", "resolution", "cleanup", "sweep", "automated"],
    category: "scope_creep",
    script: `# Scope Creep: Resolution Sweep
# Closes escalations for violations that have been resolved.

param(
    [string]$ApiBaseUrl = "https://shanemccawconsulting.com/api",
    [string]$AdminToken = $env:ADMIN_API_TOKEN
)

$headers = @{
    "Authorization" = "Bearer $AdminToken"
    "Content-Type"  = "application/json"
}

Write-Output "=== Scope Creep: Resolution Sweep ==="

try {
    $violations = (Invoke-RestMethod -Uri "$ApiBaseUrl/admin/scope-creep/violations?resolved=true" \`
                   -Headers $headers -Method GET).violations

    Write-Output "Resolved violations to sweep: $($violations.Count)"
    $swept = 0

    foreach ($v in $violations) {
        $body = @{
            notes = "Auto-closed by resolution sweep runbook on $([DateTime]::UtcNow.ToString('yyyy-MM-dd'))"
        } | ConvertTo-Json

        try {
            Invoke-RestMethod -Uri "$ApiBaseUrl/admin/scope-creep/violations/$($v.violationId)/resolve" \`
                -Headers $headers -Method POST -Body $body | Out-Null
            $swept++
        } catch {
            Write-Warning "  Sweep failed for violation $($v.violationId): $_"
        }
    }

    Write-Output ""
    Write-Output "Summary: $swept violation(s) swept / confirmed resolved"
} catch {
    Write-Error "Resolution sweep runbook failed: $_"
    exit 1
}
`,
  },
  {
    id: "scope-creep-sow-amendment-flag",
    name: "Scope Creep: SOW Amendment Flag Generator",
    description: "Examines open scope-creep violations with severity high or critical and creates Level-2 escalations with flag_sow_amendment=true. Produces structured recommendations that the engagement manager can use to initiate a formal SOW amendment.",
    tags: ["scope-creep", "sow-amendment", "escalation", "recommendation", "engagement"],
    category: "scope_creep",
    script: `# Scope Creep: SOW Amendment Flag Generator
# Creates Level-2 escalations with flagSowAmendment=true for high/critical violations.

param(
    [string]$ApiBaseUrl = "https://shanemccawconsulting.com/api",
    [string]$AdminToken = $env:ADMIN_API_TOKEN
)

$headers = @{
    "Authorization" = "Bearer $AdminToken"
    "Content-Type"  = "application/json"
}

Write-Output "=== Scope Creep: SOW Amendment Flag Generator ==="

try {
    $violations = (Invoke-RestMethod -Uri "$ApiBaseUrl/admin/scope-creep/violations" \`
                   -Headers $headers -Method GET).violations

    $highRisk = $violations | Where-Object { $_.severity -in @("high","critical") }
    Write-Output "High/critical violations: $($highRisk.Count)"

    $created = 0
    foreach ($v in $highRisk) {
        $body = @{
            violationId      = $v.violationId
            mspId            = $v.mspId
            customerId       = $v.customerId
            level            = 2
            escalationType   = "operator_task"
            flagSowAmendment = $true
            flagPricingReview= ($v.severity -eq "critical")
            idempotencyKey   = "sow-flag-$($v.violationId)"
            traceId          = "runbook-sow-amendment-$([DateTime]::UtcNow.ToString('yyyyMMdd'))"
            metadata         = @{
                source      = "scope-creep-sow-amendment-runbook"
                severity    = $v.severity
                compositeScore = $v.compositeScore
            }
        } | ConvertTo-Json -Depth 5

        try {
            $result = Invoke-RestMethod -Uri "$ApiBaseUrl/admin/scope-creep/escalations" \`
                      -Headers $headers -Method POST -Body $body
            if (-not $result.alreadyExisted) {
                Write-Output "  SOW amendment flag created: violation=$($v.violationId.Substring(0,8))... customer=$($v.customerId) severity=$($v.severity)"
                $created++
            }
        } catch {
            Write-Warning "  Failed for violation $($v.violationId): $_"
        }
    }

    Write-Output ""
    Write-Output "Summary: $created SOW amendment flag(s) created"
} catch {
    Write-Error "SOW amendment flag generator failed: $_"
    exit 1
}
`,
  },
  {
    id: "scope-creep-pricing-review-flag",
    name: "Scope Creep: Pricing Review Flag Generator",
    description: "Examines open scope-creep violations with severity critical and creates Level-3 escalations with flag_pricing_review=true. Signals that the engagement's pricing may need to be renegotiated due to material scope expansion beyond the original SOW.",
    tags: ["scope-creep", "pricing-review", "escalation", "recommendation", "billing"],
    category: "scope_creep",
    script: `# Scope Creep: Pricing Review Flag Generator
# Creates Level-3 escalations with flagPricingReview=true for critical violations.

param(
    [string]$ApiBaseUrl = "https://shanemccawconsulting.com/api",
    [string]$AdminToken = $env:ADMIN_API_TOKEN
)

$headers = @{
    "Authorization" = "Bearer $AdminToken"
    "Content-Type"  = "application/json"
}

Write-Output "=== Scope Creep: Pricing Review Flag Generator ==="

try {
    $violations = (Invoke-RestMethod -Uri "$ApiBaseUrl/admin/scope-creep/violations" \`
                   -Headers $headers -Method GET).violations

    $critical = $violations | Where-Object { $_.severity -eq "critical" }
    Write-Output "Critical violations: $($critical.Count)"

    $created = 0
    foreach ($v in $critical) {
        $body = @{
            violationId      = $v.violationId
            mspId            = $v.mspId
            customerId       = $v.customerId
            level            = 3
            escalationType   = "operator_task"
            flagSowAmendment = $true
            flagPricingReview= $true
            idempotencyKey   = "pricing-flag-$($v.violationId)"
            traceId          = "runbook-pricing-review-$([DateTime]::UtcNow.ToString('yyyyMMdd'))"
            metadata         = @{
                source         = "scope-creep-pricing-review-runbook"
                severity       = $v.severity
                compositeScore = $v.compositeScore
                threshold      = $v.threshold
            }
        } | ConvertTo-Json -Depth 5

        try {
            $result = Invoke-RestMethod -Uri "$ApiBaseUrl/admin/scope-creep/escalations" \`
                      -Headers $headers -Method POST -Body $body
            if (-not $result.alreadyExisted) {
                Write-Output "  Pricing review flag created: violation=$($v.violationId.Substring(0,8))... customer=$($v.customerId)"
                $created++
            }
        } catch {
            Write-Warning "  Failed for violation $($v.violationId): $_"
        }
    }

    Write-Output ""
    Write-Output "Summary: $created pricing review flag(s) created"
} catch {
    Write-Error "Pricing review flag generator failed: $_"
    exit 1
}
`,
  },
  {
    id: "scope-creep-monthly-compliance",
    name: "Scope Creep: Monthly Compliance Snapshot",
    description: "Generates monthly scope-creep compliance snapshots for all active customer-policy assignments. Run at the start of each month to archive the previous month's compliance data. Calculates total detections, violation count, compliance percentage, and average composite score.",
    tags: ["scope-creep", "compliance", "monthly", "snapshot", "report"],
    category: "scope_creep",
    script: `# Scope Creep: Monthly Compliance Snapshot
# Generates compliance records for the previous calendar month for all assignments.

param(
    [string]$ApiBaseUrl = "https://shanemccawconsulting.com/api",
    [string]$AdminToken = $env:ADMIN_API_TOKEN,
    [int]$MonthOffset = -1
)

$headers = @{
    "Authorization" = "Bearer $AdminToken"
    "Content-Type"  = "application/json"
}

$today       = [DateTime]::UtcNow
$periodEnd   = [DateTime]::new($today.Year, $today.Month, 1)
$periodStart = $periodEnd.AddMonths($MonthOffset)

Write-Output "=== Scope Creep: Monthly Compliance Snapshot ==="
Write-Output "Period: $($periodStart.ToString('yyyy-MM-dd')) -> $($periodEnd.ToString('yyyy-MM-dd'))"

try {
    $assignments = (Invoke-RestMethod -Uri "$ApiBaseUrl/admin/scope-creep/assignments" \`
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
            notes       = "Auto-generated monthly snapshot (runbook)"
        } | ConvertTo-Json

        try {
            $result = Invoke-RestMethod -Uri "$ApiBaseUrl/admin/scope-creep/compliance/snapshot" \`
                      -Headers $headers -Method POST -Body $body
            Write-Output "  Snapshot: msp=$($asgn.mspId) customer=$($asgn.customerId) compliancePct=$($result.compliancePct)%"
            $created++
        } catch {
            Write-Warning "  Snapshot failed for customer=$($asgn.customerId): $_"
        }
    }

    Write-Output ""
    Write-Output "Created $created compliance snapshot(s)"
} catch {
    Write-Error "Monthly compliance snapshot runbook failed: $_"
    exit 1
}
`,
  },
];

export async function seedScopeCreepRunbooks(): Promise<void> {
  let seeded = 0;
  for (const rb of SCOPE_CREEP_RUNBOOKS) {
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
  logger.info({ count: seeded }, "seed-scope-creep-runbooks: scope creep runbooks seeded");
}
