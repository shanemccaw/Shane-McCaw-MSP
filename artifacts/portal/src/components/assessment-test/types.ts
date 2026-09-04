// #2517: AssessmentStageStatus, PipelineDocumentData, AssessmentStage, MetricGauge,
// TelemetryItem, RecommendedOffer, RadarPillarEntry, SecurityCoverageData and
// GroupLifecycleData were removed here — dead scaffolding with zero consumers anywhere
// in the app, confirmed via repo-wide grep. Their fetch endpoints
// (GET /portal/assessment/recommended-offers, GET /portal/assessment/documents/:id) were
// retired with the SOW/checkout flow in #1753 and have no replacement. The three types
// below are real and stay: they're imported by
// components/health-suite/useTopicHealthLive.ts, which itself backs 6 live "Live" hook
// consumers.

/** Real license-waste summary (status.stats.licenseWaste) — the Cost Engine's
 * seat-count × sku_price_reference breakdown behind licenseWasteMonthlyCents. */
export interface LicenseWasteSummary {
  monthlyCents: number;
  annualCents: number;
  seatCount: number;
  skuCount: number;
  /** monitor_checks.key the seat counts were actually read from. Optional —
   * absent on payloads from an api-server predating the provenance field. */
  sourceCheckKey?: string;
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
