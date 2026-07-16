import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { startSlaTimer } from "./sla-engine";

/**
 * Flat default stabilization window, applied uniformly to all signals.
 * NOT time-normalized per signal check frequency — that requires a
 * signal-to-monitor-check frequency mapping that doesn't exist yet
 * (tracked separately). This is a deliberate, accepted approximation.
 */
const STABILIZATION_WINDOW_HOURS = 4;

// ─── Signal enabled/disabled state ────────────────────────────────────────────
//
// Shared lookup used by every computeTenantSignals call site (admin routes,
// workflow-executor, consolidated-sow-generator, portal pricing adjustments)
// so disabled signals are gated consistently everywhere signals are evaluated.
// A missing row means "enabled" — existing signals are unaffected until an
// admin explicitly disables one.
export async function getDisabledSignalKeys(): Promise<Set<string>> {
  const rows = await db.execute(sql`
    SELECT signal_key AS "signalKey" FROM signal_enabled_state WHERE enabled = false
  `);
  return new Set((rows.rows as Array<{ signalKey: string }>).map(r => r.signalKey));
}

// ─── Tenant health block vars (used by email templates) ──────────────────────
//
// Single source of truth for turning a client's latest per-category health
// scores into the string vars consumed by the `tenant-health-block` email
// template. Category keys match `clientHealthHistoryTable.category` /
// `ALL_CATEGORY_LABELS` in admin-clients.ts: security, compliance, copilot,
// governance, productivity (used here as "adoption").
export interface TenantHealthVars {
  tenantScore: string;
  tenantScoreBand: string;
  complianceScore: string;
  securityScore: string;
  governanceScore: string;
  adoptionScore: string;
  copilotScore: string;
  tenantHealthIsZero: string;
  tenantHealthIsLow: string;
  tenantHealthIsHigh: string;
}

/**
 * Pure computation — takes the client's latest score per category (as
 * produced by a DB lookup) and returns the vars for the tenant-health-block
 * template. Returns `null` when there is no usable score data at all, so
 * callers can skip rendering the block entirely rather than showing zeros.
 */
export function computeTenantHealthVars(
  categoryScores: Partial<Record<"security" | "compliance" | "copilot" | "governance" | "productivity", number>> | null | undefined,
): TenantHealthVars | null {
  if (!categoryScores) return null;

  const entries = Object.entries(categoryScores).filter(
    (e): e is [string, number] => typeof e[1] === "number" && !isNaN(e[1]),
  );
  if (entries.length === 0) return null;

  const scoreOf = (key: string): number | null => {
    const val = categoryScores[key as keyof typeof categoryScores];
    return typeof val === "number" && !isNaN(val) ? val : null;
  };

  const overall = Math.round(entries.reduce((sum, [, v]) => sum + v, 0) / entries.length);
  const band = overall === 0 ? "zero" : overall < 60 ? "low" : overall >= 80 ? "high" : "medium";

  const fmt = (v: number | null): string => (v === null ? "" : String(v));

  return {
    tenantScore: String(overall),
    tenantScoreBand: band,
    complianceScore: fmt(scoreOf("compliance")),
    securityScore: fmt(scoreOf("security")),
    governanceScore: fmt(scoreOf("governance")),
    adoptionScore: fmt(scoreOf("productivity")),
    copilotScore: fmt(scoreOf("copilot")),
    tenantHealthIsZero: band === "zero" ? "true" : "",
    tenantHealthIsLow: band === "low" ? "true" : "",
    tenantHealthIsHigh: band === "high" ? "true" : "",
  };
}

export interface RecommendedRule {
  ruleType: string;
  sourceKey: string;
  compareValue?: string;
  rationale: string;
}

export interface TenantSignal {
  key: string;
  label: string;
  description: string;
  expectedImpact: string;
  recommendedRules: RecommendedRule[];
  exampleProfileKey?: string;
  exampleFindingKeyword?: string;
}

export const TENANT_SIGNALS: TenantSignal[] = [
  {
    key: "hasExchangeOnPrem",
    label: "Exchange On-Premises",
    description: "Detects on-premises Exchange mailboxes that require migration to Exchange Online.",
    expectedImpact:
      "Unlocks the M365 Migration package in the SOW. When this signal fires, the client has on-premises mailboxes that need a full migration workstream — including cutover planning, coexistence configuration, and post-migration validation. This is typically one of the highest-value workstreams and significantly increases SOW scope and pricing.",
    recommendedRules: [
      { ruleType: "findings_keyword", sourceKey: "Exchange On-Premises", rationale: "Script findings explicitly report an on-prem Exchange environment." },
      { ruleType: "findings_keyword", sourceKey: "hybrid connector", rationale: "Hybrid connectors indicate Exchange coexistence is configured — a clear on-prem signal." },
      { ruleType: "findings_keyword", sourceKey: "mailbox migration", rationale: "Finding mentions mailbox migration needs directly." },
      { ruleType: "profile_key_truthy", sourceKey: "hasExchangeOnPrem", rationale: "Script sets this boolean flag when Exchange On-Premises is detected." },
    ],
    exampleProfileKey: "hasExchangeOnPrem",
    exampleFindingKeyword: "Exchange On-Premises",
  },
  {
    key: "hasPowerPlatformUsage",
    label: "Power Platform Usage",
    description: "Detects active Power Automate flows or Power Apps usage in the tenant.",
    expectedImpact:
      "Unlocks Power Platform-related projects in the SOW. Active flows or apps indicate the client is invested in low-code automation and needs governance, ALM (Application Lifecycle Management), or modernization work. This workstream covers environment strategy, DLP policy design, and adoption governance.",
    recommendedRules: [
      { ruleType: "findings_keyword", sourceKey: "Power Automate", rationale: "Script findings report Power Automate activity." },
      { ruleType: "findings_keyword", sourceKey: "Power Apps", rationale: "Script findings report Power Apps usage." },
      { ruleType: "profile_key_truthy", sourceKey: "hasPowerPlatformUsage", rationale: "Script sets this flag when Power Platform activity is detected." },
    ],
    exampleProfileKey: "hasPowerPlatformUsage",
    exampleFindingKeyword: "Power Automate",
  },
  {
    key: "hasGovernanceGaps",
    label: "Governance Gaps",
    description: "Detects missing or immature Microsoft 365 governance policies that expose the tenant to sprawl and compliance risk.",
    expectedImpact:
      "Unlocks the Governance Remediation workstream and the Governance Complexity pricing adjustment. Critical governance gaps require a full policy framework design covering Teams lifecycle, guest access, data classification, and enforcement automation. This is often paired with the Security workstream and can substantially increase the SOW value.",
    recommendedRules: [
      { ruleType: "profile_key_lt", sourceKey: "governanceScore", compareValue: "60", rationale: "A governance score below 60 indicates material gaps requiring remediation work." },
      { ruleType: "profile_key_truthy", sourceKey: "hasGovernanceGaps", rationale: "Script explicitly flags governance gaps when critical controls are absent." },
    ],
    exampleProfileKey: "governanceScore",
  },
  {
    key: "hasSecurityGaps",
    label: "Security Gaps",
    description: "Detects exploitable security vulnerabilities including missing MFA, zero Conditional Access policies, or a low security score.",
    expectedImpact:
      "Unlocks the Security Remediation workstream and the Security/Compliance pricing adjustment. Tenants with security gaps have exploitable vulnerabilities that require Zero Trust architecture design, Conditional Access policy deployment, MFA enforcement, and Defender for Microsoft 365 configuration. This is frequently the highest-priority workstream and commands premium pricing.",
    recommendedRules: [
      { ruleType: "profile_key_falsy", sourceKey: "mfaEnforced", rationale: "MFA not enforced is a critical security gap — always include this rule." },
      { ruleType: "profile_key_eq", sourceKey: "conditionalAccessPolicyCount", compareValue: "0", rationale: "Zero Conditional Access policies means the tenant has no identity perimeter controls." },
      { ruleType: "profile_key_lt", sourceKey: "securityScore", compareValue: "60", rationale: "A security score below 60 indicates multiple exploitable gaps." },
    ],
    exampleProfileKey: "mfaEnforced",
  },
  {
    key: "hasCopilotLicenses",
    label: "Copilot Licenses",
    description: "Detects active Microsoft 365 Copilot licenses that require deployment readiness and adoption support.",
    expectedImpact:
      "Unlocks the Copilot Readiness workstream and the Copilot Readiness pricing adjustment. When the client has Copilot licenses, they need a structured deployment readiness assessment, SharePoint content architecture cleanup, sensitivity label coverage, and an adoption plan to realize ROI. This workstream is growing rapidly in demand and commands strong project pricing.",
    recommendedRules: [
      { ruleType: "profile_key_gt", sourceKey: "copilotLicenseCount", compareValue: "0", rationale: "Any Copilot license count greater than zero means readiness and adoption work is needed." },
    ],
    exampleProfileKey: "copilotLicenseCount",
  },
  {
    key: "hasSharePointIssues",
    label: "SharePoint Issues",
    description: "Detects site sprawl, oversharing, or governance gaps in SharePoint Online.",
    expectedImpact:
      "Unlocks the Information Architecture / SharePoint workstream. Large site counts or oversharing findings indicate structural redesign work is required — including metadata framework design, hub site architecture, permissions cleanup, and external sharing governance. This workstream is often bundled with Governance Remediation.",
    recommendedRules: [
      { ruleType: "profile_key_gt", sourceKey: "sharepointSiteCount", compareValue: "0", rationale: "Any SharePoint site presence warrants an IA review, especially at scale." },
      { ruleType: "findings_keyword", sourceKey: "SharePoint", rationale: "Script findings flagging SharePoint issues directly trigger this workstream." },
    ],
    exampleProfileKey: "sharepointSiteCount",
    exampleFindingKeyword: "SharePoint",
  },
  {
    key: "hasLicensingWaste",
    label: "Licensing Waste",
    description: "Detects unlicensed users, over-provisioned SKUs, or significant license optimization opportunities.",
    expectedImpact:
      "Unlocks the Licensing Optimization workstream and the Tenant Size pricing adjustment for larger tenants. License waste represents a direct cost recovery opportunity — typical engagements recover 15–35% of the annual Microsoft 365 spend through right-sizing, SKU consolidation, and inactive user cleanup. This workstream is high-value for the client and easy to justify.",
    recommendedRules: [
      { ruleType: "findings_keyword", sourceKey: "unlicensed", rationale: "Findings mentioning unlicensed users directly indicate licensing waste." },
      { ruleType: "profile_key_truthy", sourceKey: "hasLicensingWaste", rationale: "Script sets this flag when significant license optimization opportunities are detected." },
    ],
    exampleProfileKey: "hasLicensingWaste",
    exampleFindingKeyword: "unlicensed",
  },
  {
    key: "hasDLPGaps",
    label: "DLP Gaps",
    description: "Detects missing Data Loss Prevention policies or unconfigured sensitivity labels.",
    expectedImpact:
      "Unlocks the Data Protection / DLP workstream and the Security/Compliance pricing adjustment. Missing DLP policies and sensitivity labels expose the client to data exfiltration, regulatory non-compliance, and accidental oversharing. This workstream covers Microsoft Purview DLP policy design, sensitivity label taxonomy, auto-labeling configuration, and insider risk management.",
    recommendedRules: [
      { ruleType: "profile_key_eq", sourceKey: "dlpPoliciesCount", compareValue: "0", rationale: "Zero DLP policies means no data loss prevention controls are in place." },
      { ruleType: "profile_key_falsy", sourceKey: "sensitivityLabelsConfigured", rationale: "Sensitivity labels not configured means data classification is absent." },
    ],
    exampleProfileKey: "dlpPoliciesCount",
  },
  {
    key: "alwaysInclude",
    label: "Always Include",
    description: "Virtual signal — projects tagged with this always appear in every SOW regardless of tenant telemetry.",
    expectedImpact:
      "Any engagement project carrying this trigger will always be included in every SOW, regardless of tenant telemetry or other signal states. Use this for core baseline offerings that apply to every client — such as an M365 Health Assessment or a Kickoff & Discovery workstream. No rules are needed for this signal; it fires automatically on every SOW generation.",
    recommendedRules: [],
  },
];

/**
 * Adjustment signals drive which pricing adjustment rows appear in the SOW.
 * They use the `adj:` key prefix to distinguish them from project signals.
 * The signal engine evaluates them exactly the same way as project signals —
 * any rule rows in `signal_derivation_rules` with these keys are evaluated
 * automatically without any engine changes.
 */
export const ADJUSTMENT_SIGNALS: TenantSignal[] = [
  {
    key: "adj:governance-complexity",
    label: "Governance Complexity",
    description:
      "Fires when the tenant has governance gaps significant enough to warrant a Governance Complexity pricing adjustment in the SOW.",
    expectedImpact:
      "Activates the Governance Complexity line in the Pricing Adjustments table. This adjustment reflects the extra effort required when a tenant has immature lifecycle policies, guest access sprawl, or Teams/Group governance gaps that compound the remediation workstream.",
    recommendedRules: [
      { ruleType: "profile_key_lt",    sourceKey: "governanceScore",  compareValue: "60", rationale: "Governance score below 60 indicates material complexity." },
      { ruleType: "profile_key_truthy", sourceKey: "hasGovernanceGaps", rationale: "Script explicitly flags governance gaps when critical controls are absent." },
    ],
    exampleProfileKey: "governanceScore",
  },
  {
    key: "adj:tenant-size",
    label: "Tenant Size",
    description:
      "Fires when the tenant is large enough (typically 250+ users) that scale significantly increases project effort.",
    expectedImpact:
      "Activates the Tenant Size pricing adjustment. Larger tenants require more discovery, more policy rollout effort, and more stakeholder management — this adjustment accounts for that overhead.",
    recommendedRules: [
      { ruleType: "profile_key_gt", sourceKey: "totalUserCount", compareValue: "250", rationale: "Tenants with more than 250 users have materially higher project overhead." },
    ],
    exampleProfileKey: "totalUserCount",
  },
  {
    key: "adj:security-compliance",
    label: "Security/Compliance",
    description:
      "Fires when the tenant has security or compliance gaps that require additional hardening effort beyond the base Security workstream.",
    expectedImpact:
      "Activates the Security/Compliance pricing adjustment. Tenants missing MFA enforcement, Conditional Access policies, or DLP coverage require deeper remediation work — Zero Trust architecture, policy design, and Purview configuration — that commands a premium adjustment.",
    recommendedRules: [
      { ruleType: "profile_key_falsy", sourceKey: "mfaEnforced",                  rationale: "MFA not enforced is a critical gap that substantially increases security work." },
      { ruleType: "profile_key_eq",    sourceKey: "conditionalAccessPolicyCount", compareValue: "0", rationale: "Zero Conditional Access policies means no identity perimeter controls." },
      { ruleType: "profile_key_eq",    sourceKey: "dlpPoliciesCount",             compareValue: "0", rationale: "Zero DLP policies means data loss prevention is absent." },
    ],
    exampleProfileKey: "mfaEnforced",
  },
  {
    key: "adj:copilot-readiness",
    label: "Copilot Readiness",
    description:
      "Fires when the tenant has active Copilot for Microsoft 365 licenses that require readiness and deployment work.",
    expectedImpact:
      "Activates the Copilot Readiness pricing adjustment. When a tenant has Copilot licenses, delivering the Copilot workstream requires additional content architecture cleanup, sensitivity label coverage, and adoption planning that justifies this adjustment.",
    recommendedRules: [
      { ruleType: "profile_key_gt", sourceKey: "copilotLicenseCount", compareValue: "0", rationale: "Any Copilot licenses present means readiness overhead is required." },
    ],
    exampleProfileKey: "copilotLicenseCount",
  },
];

// ─── Signal intelligence fields ────────────────────────────────────────────
//
// See the taxonomy comment near `signalRuleGroupsTable` in
// `lib/db/src/schema/index.ts` for the full `category` prefix list
// (pricing:*, priority:*, governance:*, security:*, compliance:*, adoption:*,
// copilot:*, architecture:*, drift:*, forecasting:*, crm:*, msp:*, workflow:*).
// These fields are pure data — no engine in this codebase reads them yet.
// computeTenantSignals() below does not consume them; they exist so future
// engine tasks (priority/pricing/health/drift/forecasting/CRM) can sum them
// off fired signals without ever hardcoding a formula.
export const SIGNAL_TREND_DIRECTIONS = ["up", "down", "flat"] as const;
export type SignalTrendDirection = typeof SIGNAL_TREND_DIRECTIONS[number];

export const SIGNAL_SEVERITIES = ["low", "medium", "high", "critical"] as const;
export type SignalSeverity = typeof SIGNAL_SEVERITIES[number];

export const SIGNAL_CATEGORY_PREFIXES = [
  "pricing", "priority", "governance", "security", "compliance", "adoption",
  "copilot", "architecture", "drift", "forecasting", "crm", "msp", "workflow",
] as const;
export type SignalCategoryPrefix = typeof SIGNAL_CATEGORY_PREFIXES[number];

export interface SignalIntelligenceFields {
  priority: number;
  weight: number;
  pricingImpact: number;
  priorityScoreContribution: number;
  pricingValueContribution: number;
  governanceImpact: number;
  securityImpact: number;
  complianceImpact: number;
  adoptionImpact: number;
  copilotImpact: number;
  architectureImpact: number;
  trendValue: number;
  trendDirection: SignalTrendDirection;
  decayRate: number;
  ttlDays: number;
  confidence: number;
  severity: SignalSeverity;
  category: string;
  pillar: string;
  crmFitContribution: number;
  crmPainContribution: number;
  crmMaturityContribution: number;
  crmIntentContribution: number;
  crmUrgencyContribution: number;
}

export interface SignalDerivationRule extends SignalIntelligenceFields {
  id: number;
  signalKey: string;
  groupId: number | null;
  ruleType: string;
  sourceKey: string;
  compareValue: string | null;
  description: string | null;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SignalRuleGroup extends SignalIntelligenceFields {
  id: number;
  signalKey: string;
  logic: "AND" | "OR";
  label: string | null;
  sortOrder: number;
  createdAt: Date;
}

export interface RuleTraceEntry {
  signalKey: string;
  groupId: number | null;
  ruleId: number;
  result: boolean;
  reason: string;
}

export function evaluateRule(
  rule: SignalDerivationRule,
  mergedProfile: Record<string, unknown>,
  parsedFindings: string[],
): { result: boolean; reason: string } {
  const { ruleType, sourceKey, compareValue } = rule;

  switch (ruleType) {
    case "profile_key_truthy": {
      const val = mergedProfile[sourceKey];
      const result = Boolean(val) && val !== 0 && val !== "" && val !== "false";
      return { result, reason: `profile[${sourceKey}] = ${JSON.stringify(val)} → ${result ? "truthy" : "falsy"}` };
    }
    case "profile_key_falsy": {
      // Only fire when the key is explicitly present in the profile.
      // An absent key means "the script that writes this field hasn't run yet" —
      // not that the feature is unconfigured.  This keeps profile_key_falsy
      // symmetric with profile_key_truthy (which correctly does not fire when
      // the key is missing).
      if (!(sourceKey in mergedProfile)) {
        return { result: false, reason: `profile[${sourceKey}] absent — key not yet written by any script, treating as unknown (not falsy)` };
      }
      const val = mergedProfile[sourceKey];
      const result = !val || val === 0 || val === "" || val === "false" || val === false;
      return { result, reason: `profile[${sourceKey}] = ${JSON.stringify(val)} → ${result ? "falsy" : "truthy"}` };
    }
    case "profile_key_eq": {
      const val = mergedProfile[sourceKey];
      const result = String(val) === String(compareValue ?? "");
      return { result, reason: `profile[${sourceKey}] = ${JSON.stringify(val)} ${result ? "==" : "!="} ${compareValue}` };
    }
    case "profile_key_gt": {
      const val = Number(mergedProfile[sourceKey]);
      const threshold = Number(compareValue ?? 0);
      const result = !isNaN(val) && val > threshold;
      return { result, reason: `profile[${sourceKey}] = ${val} ${result ? ">" : "<="} ${threshold}` };
    }
    case "profile_key_lt": {
      const val = Number(mergedProfile[sourceKey]);
      const threshold = Number(compareValue ?? 0);
      const result = !isNaN(val) && val < threshold;
      return { result, reason: `profile[${sourceKey}] = ${val} ${result ? "<" : ">="} ${threshold}` };
    }
    case "threshold": {
      const val = Number(mergedProfile[`${sourceKey}__itemCount`] ?? 0);
      const threshold = Number(compareValue ?? 0);
      const result = !isNaN(val) && val > threshold;
      return { result, reason: `monitor[${sourceKey}].itemCount = ${val} ${result ? ">" : "<="} ${threshold}` };
    }
    case "findings_keyword": {
      const keyword = (sourceKey ?? "").toLowerCase();
      const result = parsedFindings.some(f => f.toLowerCase().includes(keyword));
      return { result, reason: `findings ${result ? "contain" : "do not contain"} keyword "${sourceKey}"` };
    }
    default:
      return { result: false, reason: `unknown ruleType: ${ruleType}` };
  }
}

export function computeTenantSignals(
  mergedProfile: Record<string, unknown>,
  parsedFindings: string[],
  rules: SignalDerivationRule[],
  groups: SignalRuleGroup[],
  disabledSignalKeys: Set<string> = new Set(),
  context?: { customerId: number; mspId: number },
): { firedSignals: Set<string>; trace: RuleTraceEntry[] } {
  const trace: RuleTraceEntry[] = [];
  const firedSignals = new Set<string>();
  if (disabledSignalKeys.has("alwaysInclude")) {
    trace.push({
      signalKey: "alwaysInclude",
      groupId: null,
      ruleId: -1,
      result: false,
      reason: "Signal is disabled by admin — skipped without evaluating rules, cannot fire",
    });
  } else {
    firedSignals.add("alwaysInclude");
  }

  const groupMap = new Map<number, SignalRuleGroup>();
  for (const g of groups) groupMap.set(g.id, g);

  const rulesByGroup = new Map<string, SignalDerivationRule[]>();
  const ungroupedRules: SignalDerivationRule[] = [];

  for (const rule of rules) {
    if (rule.groupId === null || rule.groupId === undefined) {
      ungroupedRules.push(rule);
    } else {
      const key = String(rule.groupId);
      if (!rulesByGroup.has(key)) rulesByGroup.set(key, []);
      rulesByGroup.get(key)!.push(rule);
    }
  }

  const signalKeys = [...new Set(rules.map(r => r.signalKey))];

  for (const signalKey of signalKeys) {
    if (disabledSignalKeys.has(signalKey)) {
      trace.push({
        signalKey,
        groupId: null,
        ruleId: -1,
        result: false,
        reason: "Signal is disabled by admin — skipped without evaluating rules, cannot fire",
      });
      continue;
    }

    let signalFired = false;

    const signalGroups = groups.filter(g => g.signalKey === signalKey);
    for (const group of signalGroups) {
      const groupRules = rulesByGroup.get(String(group.id)) ?? [];
      if (groupRules.length === 0) continue;

      let groupResult: boolean;
      if (group.logic === "AND") {
        groupResult = groupRules.every(rule => {
          const { result, reason } = evaluateRule(rule, mergedProfile, parsedFindings);
          trace.push({ signalKey, groupId: group.id, ruleId: rule.id, result, reason });
          return result;
        });
      } else {
        groupResult = groupRules.some(rule => {
          const { result, reason } = evaluateRule(rule, mergedProfile, parsedFindings);
          trace.push({ signalKey, groupId: group.id, ruleId: rule.id, result, reason });
          return result;
        });
      }

      if (groupResult) {
        signalFired = true;
        break;
      }
    }

    const signalUngrouped = ungroupedRules.filter(r => r.signalKey === signalKey);
    for (const rule of signalUngrouped) {
      const { result, reason } = evaluateRule(rule, mergedProfile, parsedFindings);
      trace.push({ signalKey, groupId: null, ruleId: rule.id, result, reason });
      if (result) {
        signalFired = true;
        break;
      }
    }

    if (signalFired) firedSignals.add(signalKey);
  }

  // ── Fire-and-forget: trigger SLA timers for any "sla:" signals ────────────
  if (context) {
    const slaSignalKeys = [...firedSignals].filter(k => k.startsWith("sla:"));
    if (slaSignalKeys.length > 0) {
      triggerSlaTimersForFiredSignals(context.customerId, context.mspId, slaSignalKeys)
        .catch(err => logger.warn({ err, customerId: context.customerId, mspId: context.mspId }, "computeTenantSignals: fire-and-forget SLA timer trigger failed"));
    }
  }

  if (context) {
    recordSignalTransitions(context.customerId, context.mspId, firedSignals)
      .catch(err => logger.warn({ err, customerId: context.customerId, mspId: context.mspId }, "computeTenantSignals: fire-and-forget signal transition recording failed"));
  }

  return { firedSignals, trace };
}

// ── SLA timer trigger helper (fire-and-forget, unexported) ──────────────────

async function triggerSlaTimersForFiredSignals(
  customerId: number,
  mspId: number,
  slaSignalKeys: string[],
): Promise<void> {
  for (const signalKey of slaSignalKeys) {
    try {
      const result = await db.execute(sql`
        SELECT policy_id AS "policyId" FROM sla_signal_policy_map
        WHERE signal_key = ${signalKey} AND is_active = true AND (msp_id = ${mspId} OR msp_id IS NULL)
        ORDER BY msp_id NULLS LAST LIMIT 1
      `);
      const row = result.rows[0] as { policyId: number } | undefined;
      if (!row) continue;

      const { timerId, alreadyExisted } = await startSlaTimer({
        mspId,
        customerId,
        policyId: row.policyId,
        phase: "resolution",
        ticketType: "signal_compliance",
        idempotencyKey: `sla-signal:${customerId}:${signalKey}`,
      });

      logger.info(
        { signalKey, policyId: row.policyId, timerId, alreadyExisted },
        "computeTenantSignals: SLA timer triggered for fired signal",
      );
    } catch (err) {
      logger.warn(
        { err, signalKey, customerId, mspId },
        "triggerSlaTimersForFiredSignals: failed to process signal key",
      );
    }
  }
}

async function recordSignalTransitions(
  customerId: number,
  mspId: number,
  firedSignals: Set<string>,
): Promise<void> {
  try {
    const openRows = await db.execute(sql`
      SELECT signal_key AS "signalKey" FROM tenant_signal_history
      WHERE customer_id = ${customerId} AND resolved_at IS NULL
    `);
    const openSignalKeys = new Set((openRows.rows as { signalKey: string }[]).map(r => r.signalKey));

    const newlyFired = [...firedSignals].filter(k => !openSignalKeys.has(k));
    const newlyResolved = [...openSignalKeys].filter(k => !firedSignals.has(k));

    for (const signalKey of newlyFired) {
      try {
        await db.execute(sql`
          INSERT INTO tenant_signal_history (customer_id, msp_id, signal_key, fired_at)
          VALUES (${customerId}, ${mspId}, ${signalKey}, NOW())
        `);
      } catch (err) {
        logger.warn({ err, customerId, mspId, signalKey }, "recordSignalTransitions: failed to insert newly-fired row");
      }
    }

    for (const signalKey of newlyResolved) {
      try {
        await db.execute(sql`
          UPDATE tenant_signal_history
          SET resolved_at = NOW()
          WHERE customer_id = ${customerId} AND signal_key = ${signalKey} AND resolved_at IS NULL
        `);
      } catch (err) {
        logger.warn({ err, customerId, mspId, signalKey }, "recordSignalTransitions: failed to resolve row");
      }
    }
  } catch (err) {
    logger.warn({ err, customerId, mspId }, "recordSignalTransitions: failed to fetch open signal rows");
  }
}

/**
 * Returns the subset of a customer's currently-fired signals that have
 * been continuously fired for at least STABILIZATION_WINDOW_HOURS —
 * i.e., excludes signals that only just fired and could still be
 * flapping/noise. A signal is "currently fired" if it has an open row
 * (resolved_at IS NULL) in tenant_signal_history; it's "stabilized" if
 * that row's fired_at is old enough.
 */
export async function getStabilizedSignals(customerId: number): Promise<Set<string>> {
  try {
    const rows = await db.execute(sql`
      SELECT signal_key AS "signalKey" FROM tenant_signal_history
      WHERE customer_id = ${customerId}
        AND resolved_at IS NULL
        AND fired_at <= NOW() - INTERVAL '1 hour' * ${STABILIZATION_WINDOW_HOURS}
    `);
    return new Set((rows.rows as { signalKey: string }[]).map(r => r.signalKey));
  } catch (err) {
    logger.warn({ err, customerId }, "getStabilizedSignals: failed to query stabilized signals");
    return new Set();
  }
}

/**
 * Single source of truth for project inclusion logic — used by the SOW generator,
 * dry-run, and preview endpoints so they all agree on the same semantics.
 *
 * Rules (applied in order):
 * 1. No triggeredBy values → EXCLUDED. Every project must declare at least one
 *    canonical signal key. Use "alwaysInclude" for projects that should appear in
 *    every SOW regardless of signals.
 * 2. All triggeredBy values are unrecognized legacy strings (old plan names) →
 *    excluded; migrate to canonical signal keys to re-enable.
 * 3. At least one recognized signal key present → include only if ≥1 of those
 *    recognized keys appears in firedSignals
 */
export function projectMatchesSignals(
  project: { title: string; triggeredBy: string[] },
  knownSignalKeys: Set<string>,
  firedSignals: Set<string>,
): { included: boolean; legacyFallback: boolean; reason?: string } {
  const triggers = Array.isArray(project.triggeredBy) ? project.triggeredBy : [];

  if (triggers.length === 0) {
    return {
      included: false,
      legacyFallback: false,
      reason: "No triggeredBy signal keys — excluded until at least one canonical key is set (use 'alwaysInclude' to always include)",
    };
  }

  const recognizedTriggers = triggers.filter(t => knownSignalKeys.has(t));
  if (recognizedTriggers.length === 0) {
    // All triggeredBy strings are unrecognized (old plan-name style or typos).
    // EXCLUDE deterministically rather than silently including — the SOW
    // should only contain projects whose signal gate has been satisfied.
    // Migrate trigger strings to canonical signal keys to re-enable the project.
    return {
      included: false,
      legacyFallback: false,
      reason: `Unrecognized trigger(s): ${triggers.join(", ")} — excluded until migrated to canonical signal keys`,
    };
  }

  const matched = recognizedTriggers.find(t => firedSignals.has(t));
  if (matched) {
    return { included: true, legacyFallback: false };
  }
  return {
    included: false,
    legacyFallback: false,
    reason: `Requires signal(s): ${recognizedTriggers.join(", ")} — none fired for this tenant`,
  };
}

/**
 * resolveSignalsOverride
 *
 * Pure extraction of the signalsOverride resolution path used by the
 * `generate_document(consolidated_sow)` executor node.
 *
 * When a workflow chains `get_tenant_signals → generate_document`, the
 * generate_document node config carries `signalsOverride: "{{signals}}"`.
 * At runtime the executor interpolates that template against the current
 * payload, producing a JSON-serialised string such as
 * `'["alwaysInclude","hasGovernanceGaps"]'`.  This function handles the
 * parse + fallback steps so they can be tested independently of the DB
 * and Claude dependencies of the executor.
 *
 * Resolution order:
 *  1. Interpolate `field` via `interpFn` → parse as JSON array → return Set
 *  2. Fallback: use `payload.signals` directly when interp doesn't yield a JSON array
 *  3. Return `undefined` when field is empty/absent
 *
 * @param field      The raw template string from `node.data.signalsOverride`
 *                   (e.g. `"{{signals}}"` or a literal JSON array).
 * @param payload    The live workflow payload (contains `signals` from a
 *                   prior `get_tenant_signals` node output).
 * @param interpFn   Template interpolator — matches the executor's `interp`
 *                   signature; in tests pass a simple mock.
 */
export function resolveSignalsOverride(
  field: string | undefined,
  payload: Record<string, unknown>,
  interpFn: (template: string, payload: Record<string, unknown>) => string | undefined,
): Set<string> | undefined {
  const overrideField = field?.trim();
  if (!overrideField) return undefined;
  try {
    const resolved = interpFn(overrideField, payload);
    if (resolved) {
      const parsed = JSON.parse(resolved) as unknown;
      if (Array.isArray(parsed)) return new Set<string>(parsed as string[]);
    }
  } catch { /* not a valid JSON array — fall through to payload.signals */ }
  if (Array.isArray(payload.signals)) return new Set<string>(payload.signals as string[]);
  return undefined;
}
