// 'pending' = real waiting state (document not started yet); 'failed' widens
// the original mock union to carry the real backend document status value —
// a failed generation must render honestly, never as a perpetual "pending".
export type AssessmentStageStatus = 'done' | 'in_progress' | 'pending' | 'failed';

export interface PipelineDocumentData {
  severity: 'red' | 'yellow' | 'green';
  omgHeroTitle: string;
  omgHeroStat: string;
  omgHeroHighlight: string;
  omgHeroBadge: string;
  executiveSummaryText: string;
  annualWasteCost?: string;
  monthlyWasteCost?: string;
  affectedItemsCount?: number;
  keyFindings: {
    title: string;
    riskLevel: 'CRITICAL' | 'WARNING' | 'INFO';
    detail: string;
    impact: string;
  }[];
  recommendedActions: string[];
  powershellSnippet?: string;
}

export interface AssessmentStage {
  id: string;
  title: string;
  status: AssessmentStageStatus;
  completedAt?: string;
  description?: string;
  documentData?: PipelineDocumentData;
}

// Widened for real data (same real-data-first discipline as /overview-test's
// types reconstruction): `score`/`title` are the only fields the real pillar
// data (status.radar.pillars) actually provides. Benchmark/trend/velocity have
// no real backend source yet, so they are optional and simply not rendered for
// real gauges — never fabricated. `notCovered` is the honest state for a
// pillar the customer's scanned package genuinely doesn't cover.
export interface MetricGauge {
  id: string;
  title: string;
  score: number; // 0 to 100
  color?: string;
  scanDelay?: string;
  description?: string;
  benchmark?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  /** True when the scanned package doesn't cover this pillar — renders an
   * honest "not covered by this scan" state instead of a fabricated score. */
  notCovered?: boolean;
}

export interface TelemetryItem {
  id: string;
  type: 'security' | 'groups' | 'licenses' | 'copilot' | 'identity';
  title: string;
  description: string;
  icon: string;
  iconColor: 'green' | 'amber' | 'blue' | 'red';
  architectSays: string;
  architectStatus?: 'success' | 'warning' | 'error' | 'info';
  affectedCount?: number;
  remediationStep?: string;
  powershellSnippet?: string;
  /** How the finding was determined — the real platform check/signal family
   * that produces this class of finding (rendered as its own modal section,
   * distinct from the narrative quote and the remediation content). */
  determinedBy?: {
    /** The real monitor-check key(s) behind the finding, e.g. "identity:mfa-registration". */
    source: string;
    /** Plain-language description of how that check collects/derives the number. */
    method: string;
  };
}

/** A real recommended offer from the Sales Offer Engine
 * (GET /api/portal/assessment/recommended-offers — real catalog service,
 * real engine-adjusted price, real destination link). */
export interface RecommendedOffer {
  serviceId: number;
  serviceName: string;
  title: string;
  rationale: string | null;
  priceCents: number;
  /** Health pillars of the signals that fired this offer — used to attach the
   * offer to the matching telemetry finding category. */
  pillars: string[];
  link: string;
}

/** One axis of the real tenant-health radar. `score: null` is the honest
 * "not covered by this scan" state — that pillar renders no fabricated axis. */
export interface RadarPillarEntry {
  key: string;
  label: string;
  score: number | null;
}

export interface SecurityCoverageData {
  mfaActivePercentage: number;
  conditionalAccessEnforced: number;
  legacyAuthBlocked: number;
  totalUsers: number;
}

export interface GroupLifecycleData {
  activeCount: number;
  staleCount: number;
  orphanCount: number;
  totalGroups: number;
}

/** Real license-waste summary (status.stats.licenseWaste) — the Cost Engine's
 * seat-count × sku_price_reference breakdown behind licenseWasteMonthlyCents. */
export interface LicenseWasteSummary {
  monthlyCents: number;
  annualCents: number;
  seatCount: number;
  skuCount: number;
  topSku: { displayName: string; count: number; monthlyCents: number } | null;
}

/** Real Copilot-readiness block (status.copilotReadiness) — mirrors the
 * backend's copilot-readiness.ts result. Every score is real or null (honest
 * "no data"); `basis` distinguishes a true ratio from a risk-band score so the
 * UI never presents a band score as a coverage percentage. */
export interface CopilotReadinessIndicator {
  score: number | null;
  basis: 'ratio' | 'risk_bands' | null;
}

export interface CopilotReadinessLive {
  sharePointTeams: CopilotReadinessIndicator & {
    oversharedSites: number | null;
    totalSites: number | null;
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
    score: number | null;
    weights: { sharePointTeams: number; sensitivityLabels: number; dlp: number };
    coveredIndicators: string[];
  };
}
