/**
 * Wire types for the pillar page (#1749, Feature #1621), mirroring
 * `GET /api/portal/pillars` — `PillarSummaryPayload` / `PillarSummaryCard` in
 * `artifacts/api-server/src/lib/pillar-summary-stats.ts`. Minimal client-side
 * mirror only; apps in this monorepo don't share types across the
 * `artifacts/*` boundary (see CLAUDE.md, "Workspace / monorepo"), same
 * convention `usePillarSummary.ts` and `overview/types.ts` already follow.
 *
 * Scope note: this issue wires the pillar summary cards and scores. Per-check
 * breakdown "blocks" (the design's `groups` — full per-check tiers/history)
 * and the click-to-drill-down finding detail + remediation offer are
 * deliberately NOT part of this shape — #1621's own body leaves "what is a
 * block" and the remediation-vehicle choice as open architecture questions,
 * and the dispatch for this build explicitly scopes drill-down to a separate
 * follow-up.
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
  checkKey: string | null;
  source: string;
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
}

export interface PillarSummaryPayloadWire {
  pillars: PillarSummaryCardWire[];
  findingsRunId: string | null;
  findingsRunStatus: string | null;
  activeRunId: string | null;
  scannedPackageKeys: string[];
  scannedCheckCount: number;
  scannedCheckKeys: string[];
  checkKeyPillars: Record<string, PillarSummaryKey>;
  generatedAt: string;
}
