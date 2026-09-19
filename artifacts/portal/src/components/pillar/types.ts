/**
 * Wire types for the pillar page (#1749, Feature #1621), mirroring
 * `GET /api/portal/pillars` — `PillarSummaryPayload` / `PillarSummaryCard` in
 * `artifacts/api-server/src/lib/pillar-summary-stats.ts`. Minimal client-side
 * mirror only; apps in this monorepo don't share types across the
 * `artifacts/*` boundary (see CLAUDE.md, "Workspace / monorepo"), same
 * convention `usePillarSummary.ts` and `overview/types.ts` already follow.
 *
 * Git #4578 added the SIGNALS grid (`signals`), the CONFIG DRIFT BASELINE panel
 * (`drift`) and the Licensing SKU ledger (`licenseSkuLedger`). The click-a-finding
 * drill-down and the remediation offer remain out of this shape — #1621 leaves
 * them as open architecture questions.
 */

export type PillarSummaryKey =
  | "governance"
  | "licensing"
  | "adoption"
  | "compliance"
  | "health"
  | "security"
  | "copilot";

export type PillarEvaluationStatus = "scored" | "insufficient_data" | "not_evaluated";

export interface PillarEvaluationWire {
  status: PillarEvaluationStatus;
  score: number | null;
  evaluableSignalCount: number;
  minRequiredSignals: number;
  theoreticalMax: number;
  reason: string;
}

export type PillarStatUnit = "count" | "percent" | "currency";

export interface PillarStatWire {
  id: string;
  label: string;
  unit: PillarStatUnit;
  value: number | null;
  unavailableReason?: string;
  licenseFeature?: string;
  /**
   * The tile's real sub-caption (Git #4560) — the design's own copy with the
   * tenant's real denominator already substituted server-side (e.g. "of 18
   * teams"). Absent when the check produced no denominator: a caption is
   * dropped rather than rendered with a blank in it.
   */
  sub?: string;
  checkKey: string | null;
  source: string;
}

/**
 * One segment of the "what feeds this score" coverage bar (Git #4560),
 * mirroring `PillarCoverageSegment` in
 * `artifacts/api-server/src/lib/pillar-check-observations.ts`.
 */
export type PillarCoverageSegmentKind = "ok" | "gap" | "blocked" | "queued";

export interface PillarCoverageSegmentWire {
  kind: PillarCoverageSegmentKind;
  count: number;
}

export interface PillarCoverageWire {
  total: number;
  segments: PillarCoverageSegmentWire[];
  blockedCheckKeys: string[];
  licenseGappedCheckKeys: string[];
  licenseGapFeatures: { feature: string; checkCount: number }[];
  blockedServices: string[];
}

export type PillarFindingSeverity = "critical" | "warning";

export interface PillarFindingWire {
  severity: PillarFindingSeverity;
  checkKey: string;
  title: string;
  rankWeight: number;
  description?: string | null;
  obligation?: string | null;
  whyItMatters?: string | null;
  evidence?: Record<string, unknown> | null;
}

export interface PillarUpgradeLinkWire {
  skuKey: string;
  skuName: string;
  url: string;
  checkKeys: string[];
}

// ── Licensing SKU ledger (Git #4578) ─────────────────────────────────────────

/**
 * Mirrors `LicenseSkuLedger` (license-waste-source.ts, Git #1230) as it
 * serialises on `GET /api/portal/pillars`. Only SKUs with a real price on
 * file are `rows`; everything else is listed in `excluded` with why.
 */
export interface LicenseSkuLedgerRowWire {
  skuPartNumber: string;
  displayName: string;
  purchased: number;
  assigned: number;
  unassigned: number;
  unitMonthlyPriceCents: number;
  monthlyWasteCents: number;
  annualWasteCents: number;
}

export type LicenseSkuExcludedReason = "no_price_on_file" | "zero_price";

export interface LicenseSkuLedgerWire {
  rows: LicenseSkuLedgerRowWire[];
  totalPurchased: number;
  totalAssigned: number;
  totalUnassigned: number;
  totalMonthlyWasteCents: number;
  totalAnnualWasteCents: number;
  excluded: { skuPartNumber: string; purchased: number; reason: LicenseSkuExcludedReason }[];
  checkKey: string;
  collectedAt: string | null;
}

// ── SIGNALS grid (Git #4578) ─────────────────────────────────────────────────

/**
 * The design's four card tiers plus one it does not have: `ungraded` is a
 * check that was measured but that no severity rule judges (68 of the 155
 * checks the grid shows carry no rules at all), so calling it good or bad
 * would be inventing a verdict.
 */
export type PillarSignalTier = "good" | "meh" | "bad" | "na" | "ungraded";

export type PillarSignalFormat = "count" | "percent" | "flag" | "text";

export interface PillarSignalCardWire {
  checkKey: string;
  label: string;
  /** Key into the design's icon set (`SICON`), resolved to a path client-side. */
  icon: string;
  /** Column span out of 12, the design's own. */
  span: number;
  tier: PillarSignalTier;
  format: PillarSignalFormat;
  /** The real number, or null when the check has none to give. Never a zero standing in for missing. */
  value: number | null;
  /** The real text for a `flag` / `text` card ("on", "OK", a policy name…). */
  text: string | null;
  /** Value now minus value on the previous stored observation. Null without two real values. */
  delta: number | null;
  /** How many stored observations exist for this check, capped at 5 — the design's history bars. */
  history: number;
  sub?: string;
  /** The real fired-rule label (`tenant_monitor_profiles.severity_label`) behind a non-good tier. */
  ruleLabel?: string;
  /** Why `value` / `text` are both null — same vocabulary as `PillarStatWire.unavailableReason`. */
  unavailableReason?: string;
  licenseFeature?: string;
  serviceName?: string;
  collectedAt: string | null;
}

export interface PillarSignalGroupWire {
  title: string;
  cards: PillarSignalCardWire[];
}

export interface PillarSignalsWire {
  groups: PillarSignalGroupWire[];
  cardCount: number;
  /** ISO time of the newest observation behind any card, or null when none has ever run. */
  latestObservedAt: string | null;
  /** This pillar's catalog checks that are NOT on the grid — the design's "+ N more checks feed…". */
  uncardedCheckCount: number;
}

// ── CONFIG DRIFT BASELINE (Git #4578) ────────────────────────────────────────

export type PillarDriftState = "tracked" | "not_comparable" | "error";

export interface PillarDriftDomainWire {
  domainKey: string;
  state: PillarDriftState;
  /** The collector's own recorded reason for `not_comparable` / `error`. */
  reason: string | null;
  baselineCapturedAt: string | null;
  /** Real drift events detected since that baseline. */
  deviationCount: number;
}

export interface PillarSummaryCardWire {
  pillar: PillarSummaryKey;
  enginePillar: string;
  score: number | null;
  evaluation: PillarEvaluationWire;
  rawRiskScore: number;
  stats: PillarStatWire[];
  findings: PillarFindingWire[];
  findingCounts: { critical: number; warning: number };
  trend: { series: number[]; window: string } | null;
  licenseGapUpgrades: PillarUpgradeLinkWire[];
  /** Git #4560 — null only for a customer with no M365 tenant to observe. */
  coverage: PillarCoverageWire | null;
  /** Git #4578 — null only for a customer with no M365 tenant to observe. */
  signals: PillarSignalsWire | null;
  /** Git #4578 — one entry per drift domain this pillar's checks own; empty when it has none. */
  drift: PillarDriftDomainWire[];
}

export interface PillarSummaryPayloadWire {
  pillars: PillarSummaryCardWire[];
  /** Git #4578 — the Licensing pillar's per-SKU ledger; null when no /subscribedSkus page is stored. */
  licenseSkuLedger: LicenseSkuLedgerWire | null;
  findingsRunId: string | null;
  findingsRunStatus: string | null;
  activeRunId: string | null;
  scannedPackageKeys: string[];
  scannedCheckCount: number;
  scannedCheckKeys: string[];
  checkKeyPillars: Record<string, PillarSummaryKey>;
  generatedAt: string;
}
