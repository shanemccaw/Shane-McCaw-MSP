/**
 * remediation-tracker-scores-types.ts — wire types for §1f of
 * `docs/remediation-tracking-contract-pack.md`:
 *
 *   GET /api/portal/remediation-tracker/pillar-scores
 *
 * Mirrors `portal-remediation-tracker-scores.ts` / `remediation-pillar-scores.ts`
 * / `copilot-gate.ts` in `artifacts/api-server` field-for-field. No client-side
 * derivation of a score, a delta or a gate verdict — every one of those is
 * computed server-side and read verbatim.
 */

/** The tracker's six real pillar keys (contract pack §3, `RemediationTrackerPillar`). */
export const REMEDIATION_TRACKER_PILLAR_KEYS = [
  "governance",
  "security",
  "compliance",
  "licensing",
  "adoption",
  "health",
] as const;

export type RemediationTrackerPillarKey = (typeof REMEDIATION_TRACKER_PILLAR_KEYS)[number];

export const REMEDIATION_TRACKER_PILLAR_LABELS: Record<RemediationTrackerPillarKey, string> = {
  governance: "Governance",
  security: "Security",
  compliance: "Compliance",
  licensing: "Licensing",
  adoption: "Adoption",
  health: "Health",
};

export type PillarScoreStatus = "scored" | "single_scan" | "insufficient_data";

export interface PillarScore {
  readonly before: number | null;
  readonly now: number | null;
  readonly dayOne: number | null;
  readonly delta: number | null;
  readonly status: PillarScoreStatus;
  readonly capturedAt: string | null;
  readonly scanCount: number;
}

export interface TaskPoint {
  readonly severity: string;
  readonly weight: number;
}

export type CopilotGateStatus = "go" | "no_go";

export type PillarEvaluationStatus = "scored" | "not_evaluated" | string;

export interface CopilotGateEvaluation {
  readonly status: PillarEvaluationStatus;
  readonly evaluableSignalCount: number;
  readonly minRequiredSignals: number;
  readonly reason: string;
}

export interface CopilotGateResult {
  readonly score: number | null;
  readonly threshold: number;
  readonly status: CopilotGateStatus | null;
  readonly source: "health_engine:copilot";
  readonly evaluation: CopilotGateEvaluation;
}

export interface PillarScoresResponse {
  readonly pillars: Record<string, PillarScore>;
  readonly copilotGate: CopilotGateResult;
  readonly taskPoints: Record<string, TaskPoint>;
  readonly meta: {
    readonly hasAnyHistory: boolean;
    readonly latestRunId: string | null;
  };
}
