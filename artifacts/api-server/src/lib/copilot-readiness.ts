/**
 * copilot-readiness.ts
 *
 * Computes the Assessment page's three real Copilot-readiness sub-indicators
 * plus one weighted overall score, exclusively from checks the platform has
 * genuinely collected for the tenant (tenant_monitor_profiles rows read via
 * latestCheckProps — the exact same real-data path the status endpoint's
 * license-waste stat already uses). A sub-indicator whose backing check has
 * never been collected for this tenant scores `null` — the honest "no real
 * data" state — never a fabricated number.
 *
 * ── The three sub-indicators and their real backing checks ──────────────────
 *  1. SharePoint/Teams readiness (data sprawl / "Everyone except external
 *     users"-style exposure):
 *       compliance:overshared-sites  (count of overshared sites — numerator)
 *       compliance:sharepoint-sites  (total site count — the registry's own
 *         sanctioned denominator: compliance.oversharedSiteCount declares
 *         denominatorMetric: "compliance.sharePointSiteCount")
 *       copilot:overshare-exposure   (context count, shown alongside)
 *     Score: 100 × (1 − overshared/total) — a real ratio, both sides real.
 *  2. Sensitivity labels (document/site classification coverage):
 *       compliance:missing-labels    (items missing sensitivity labels)
 *       compliance:label-errors      (context count)
 *  3. DLP (data-loss-prevention coverage):
 *       compliance:weak-dlp-policies (policies in weak/audit-only state)
 *       compliance:dlp-incidents     (context count)
 *
 * ── Why indicators 2 and 3 are band-scored, not percentage-scored ───────────
 * The platform collects missing-label and weak-DLP-policy COUNTS with no real
 * denominator (the metric registry declares none for either), so a "coverage
 * %" cannot be honestly computed. Rather than fabricate one, those counts are
 * scored against the SAME risk bands the metric registry itself declares for
 * these exact metrics (smartDefaultTarget 0 + RISK_COUNT_BANDS — read live via
 * getMetric(), not copied): at-target = 100, then piecewise-linear through the
 * registry's own acceptable/needsImprovement/critical thresholds. The mapping
 * anchors (100/85/60/35, −2/item beyond critical, floor 10) are this module's
 * one product decision, documented here and surfaced to the UI via `basis`.
 *
 * ── Overall weighting (real product decision — see PLATFORM_BUILD.md) ───────
 *   SharePoint/Teams 50% — Copilot grounds responses in everything a user can
 *     already reach, so over-permissioned sites are the single largest instant
 *     exposure; Microsoft's own Copilot deployment guidance leads with
 *     oversharing remediation, and it is the slowest of the three to fix.
 *   Sensitivity labels 30% — labels are the durable classification layer that
 *     both constrains Copilot processing and gives DLP its strongest signals;
 *     without them protection is reactive-only.
 *   DLP 20% — the enforcement backstop; weak policies matter, but DLP guards
 *     residual risk after access and classification are right, and its
 *     effectiveness partially depends on the label layer above it.
 * The overall score renormalizes weights across the sub-indicators that have
 * real data (e.g. only SP/Teams + DLP covered → 50/20 → 71.4%/28.6%), and is
 * null when none do — the weights never launder a missing indicator into an
 * implied 100 or 0.
 */

import { getMetric } from "@workspace/dashboard-registry";
import { latestCheckProps } from "./dashboard-resolvers";
import { logger } from "./logger";

const log = logger.child({ channel: "engine.dashboard" });

/** Fixed weights — the documented product decision above. */
export const COPILOT_READINESS_WEIGHTS = {
  sharePointTeams: 0.5,
  sensitivityLabels: 0.3,
  dlp: 0.2,
} as const;

export interface CopilotReadinessIndicator {
  /** 0–100, or null when the backing check has no collected data (honest). */
  score: number | null;
  /** How the score was derived — the UI must not present a band score as a coverage %. */
  basis: "ratio" | "risk_bands" | null;
}

export interface CopilotReadinessResult {
  sharePointTeams: CopilotReadinessIndicator & {
    oversharedSites: number | null;
    totalSites: number | null;
    /** copilot:overshare-exposure context count (items Copilot could surface). */
    overshareExposureItems: number | null;
  };
  sensitivityLabels: CopilotReadinessIndicator & {
    unlabeledItems: number | null;
    labelErrors: number | null;
  };
  dlp: CopilotReadinessIndicator & {
    weakPolicies: number | null;
    dlpIncidents: number | null;
  };
  overall: {
    /** Weighted over covered sub-indicators only; null when none are covered. */
    score: number | null;
    weights: typeof COPILOT_READINESS_WEIGHTS;
    /** Which sub-indicators actually contributed (real-data provenance). */
    coveredIndicators: string[];
  };
}

/**
 * Pull the collected item count out of a check's extractedProperties via the
 * schema-stable `_itemCount` auto-key — the same per-check value convention
 * priority-engine.ts and dashboard-resolvers.ts's checkNumericValue use.
 * Rows collected in an error state count as no-data, not zero.
 */
function collectedCount(props: Record<string, unknown> | null): number | null {
  if (!props) return null;
  if (props["__status"] === "error") return null;
  const n = Number(props["_itemCount"]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Score a lower-is-better risk count against the metric registry's OWN bands
 * for that metric (never a locally-invented threshold set). Piecewise-linear
 * anchors: target(0)=100, acceptable=85, needsImprovement=60, critical=35,
 * then −2 per item beyond critical, floored at 10.
 */
function bandCountScore(count: number, metricKey: string): number | null {
  const def = getMetric(metricKey);
  const bands = def?.smartBands;
  const target = def?.smartDefaultTarget;
  if (!bands || target == null) {
    // Registry no longer declares bands for this metric — don't invent them.
    log.warn({ metricKey }, "copilot-readiness: metric has no smart bands — indicator left unscored");
    return null;
  }
  const interp = (x: number, x0: number, x1: number, y0: number, y1: number) =>
    y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  if (count <= target) return 100;
  if (count <= bands.acceptable) return 85;
  if (count <= bands.needsImprovement) return Math.round(interp(count, bands.acceptable, bands.needsImprovement, 85, 60));
  if (count <= bands.critical) return Math.round(interp(count, bands.needsImprovement, bands.critical, 60, 35));
  return Math.max(10, Math.round(35 - 2 * (count - bands.critical)));
}

export async function computeCopilotReadiness(tenantId: string): Promise<CopilotReadinessResult> {
  const [oversharedProps, totalSitesProps, exposureProps, missingLabelsProps, labelErrorsProps, weakDlpProps, dlpIncidentsProps] =
    await Promise.all([
      latestCheckProps(tenantId, "compliance:overshared-sites"),
      latestCheckProps(tenantId, "compliance:sharepoint-sites"),
      latestCheckProps(tenantId, "copilot:overshare-exposure"),
      latestCheckProps(tenantId, "compliance:missing-labels"),
      latestCheckProps(tenantId, "compliance:label-errors"),
      latestCheckProps(tenantId, "compliance:weak-dlp-policies"),
      latestCheckProps(tenantId, "compliance:dlp-incidents"),
    ]);

  const oversharedSites = collectedCount(oversharedProps);
  const totalSites = collectedCount(totalSitesProps);
  const overshareExposureItems = collectedCount(exposureProps);
  const unlabeledItems = collectedCount(missingLabelsProps);
  const labelErrors = collectedCount(labelErrorsProps);
  const weakPolicies = collectedCount(weakDlpProps);
  const dlpIncidents = collectedCount(dlpIncidentsProps);

  // 1. SharePoint/Teams — real overshared/total ratio (registry-sanctioned pair).
  const spScore =
    oversharedSites != null && totalSites != null && totalSites > 0
      ? Math.min(100, Math.max(0, Math.round(100 * (1 - oversharedSites / totalSites))))
      : null;

  // 2 & 3. Band-scored counts (no real denominator exists — see file header).
  const labelScore = unlabeledItems != null ? bandCountScore(unlabeledItems, "compliance.missingLabelCount") : null;
  const dlpScore = weakPolicies != null ? bandCountScore(weakPolicies, "compliance.weakDlpPolicyCount") : null;

  // Overall — weights renormalized across covered sub-indicators only.
  const parts: Array<{ key: keyof typeof COPILOT_READINESS_WEIGHTS; score: number | null }> = [
    { key: "sharePointTeams", score: spScore },
    { key: "sensitivityLabels", score: labelScore },
    { key: "dlp", score: dlpScore },
  ];
  const covered = parts.filter((p): p is { key: keyof typeof COPILOT_READINESS_WEIGHTS; score: number } => p.score != null);
  const weightSum = covered.reduce((s, p) => s + COPILOT_READINESS_WEIGHTS[p.key], 0);
  const overallScore =
    covered.length > 0 && weightSum > 0
      ? Math.round(covered.reduce((s, p) => s + p.score * COPILOT_READINESS_WEIGHTS[p.key], 0) / weightSum)
      : null;

  return {
    sharePointTeams: {
      score: spScore,
      basis: spScore != null ? "ratio" : null,
      oversharedSites,
      totalSites,
      overshareExposureItems,
    },
    sensitivityLabels: {
      score: labelScore,
      basis: labelScore != null ? "risk_bands" : null,
      unlabeledItems,
      labelErrors,
    },
    dlp: {
      score: dlpScore,
      basis: dlpScore != null ? "risk_bands" : null,
      weakPolicies,
      dlpIncidents,
    },
    overall: {
      score: overallScore,
      weights: COPILOT_READINESS_WEIGHTS,
      coveredIndicators: covered.map((p) => p.key),
    },
  };
}
