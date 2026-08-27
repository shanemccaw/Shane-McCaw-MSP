/**
 * remediationScores.ts — the client-side shape of the REAL per-pillar score API
 * (Git #1381), and the honest-null helpers the derivation reads it through.
 *
 * This is the seam that replaces the tracker's hardcoded `RT_PILLAR_BASE` /
 * `RT_PILLAR_TARGET` fixture. It carries, per tracker pillar, the customer's real
 * numbers straight off `GET /api/portal/remediation-tracker/pillar-scores`
 * (api-server/.../portal-remediation-tracker-scores.ts):
 *
 *   • before  — the PREVIOUS scan's real score (rolling; null on a first scan).
 *   • now      — the CURRENT scan's real score.
 *   • dayOne   — the tenant's VERY FIRST real score per pillar, kept forever, for
 *                the long-arc "day 1 you were at 28, now you're at 84" narrative.
 *   • status   — scored (≥2 scans) / single_scan (one scan) / insufficient_data.
 *
 * plus the real Copilot gate (`computeCopilotGate`) and per-step point weights
 * derived from each task's real underlying finding severity.
 *
 * Deliberately a pure module (no React) so `remediationModel.ts` — itself pure —
 * can read these types without pulling a hook in. The hook that fetches this lives
 * in `useRemediationPillarScores.ts`.
 */

import type { RtPillarKey } from "./remediationData";

export type RtPillarScoreStatus = "scored" | "single_scan" | "insufficient_data";

/** One pillar's real rolling before/now + permanent day-one baseline. */
export interface RtPillarScore {
  readonly before: number | null;
  readonly now: number | null;
  readonly dayOne: number | null;
  readonly delta: number | null;
  readonly status: RtPillarScoreStatus;
  readonly capturedAt: string | null;
  readonly scanCount: number;
}

/** The real Copilot gate — `computeCopilotGate`'s shape, only the fields the UI reads. */
export interface RtCopilotGate {
  readonly score: number | null;
  readonly threshold: number;
  readonly status: "go" | "no_go" | null;
  readonly evaluation: { readonly status: string; readonly reason: string } | null;
}

/** One step's real finding-severity point weight (critical 3 / warning 2 / info 1 / ok 0). */
export interface RtTaskPoint {
  readonly severity: string;
  readonly weight: number;
}

/** The whole payload, plus whether it has resolved yet. */
export interface RtLiveScores {
  readonly pillars: Partial<Record<RtPillarKey, RtPillarScore>>;
  readonly copilotGate: RtCopilotGate | null;
  readonly taskPoints: Readonly<Record<string, RtTaskPoint>>;
  /** True once a payload (success OR failure) has resolved. Understates until then. */
  readonly loaded: boolean;
}

/**
 * No scores yet — and what every pillar reads as before the first payload lands.
 * Understates (insufficient_data everywhere) rather than over-claims, exactly like
 * `RT_LIVE_EMPTY` does for the tracker's status maps.
 */
export const RT_SCORES_EMPTY: RtLiveScores = {
  pillars: {},
  copilotGate: null,
  taskPoints: {},
  loaded: false,
};
