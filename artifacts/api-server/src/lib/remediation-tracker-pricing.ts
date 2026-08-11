/**
 * remediation-tracker-pricing.ts — Git #734 (Phase E of Epic #647).
 *
 * The real "hire Shane for what's left" price, computed live from the
 * tracker's own DB state (#730-#732) instead of the design's local component
 * state. The formula itself is not invented — it is `Design/Remediation
 * Tracker.dc.html`'s own `PILLAR_FEE`/`PHASE_PILLARS`/`phaseReady`/`doneIn`/
 * `phaseFee`/`hire` logic (script block, ~line 3899-4322), ported onto real
 * pillar keys and the real `status`/`verificationState` columns.
 *
 * THREE PHASES, TWO PILLARS EACH, FIXED FEES
 * -------------------------------------------
 * Phase 1 = governance + security, Phase 2 = compliance + licensing, Phase 3
 * = adoption + health. `PILLAR_FEE` and the phase groupings are the design's
 * literal dollar figures (confirmed against the design file 2026-08-11, see
 * the #734 issue comment) — not re-derived from anything else.
 *
 * READY TO RE-SCAN: A PHASE-BY-PHASE GATE, NOT A FEE INPUT
 * ----------------------------------------------------------
 * The design's `phaseReady(ph)` only accepts a step whose `status` is
 * `"complete"` or `"skipped"` — nothing else counts, and a phase with any
 * step outside those two states is not ready no matter how much of it is
 * otherwise done. Two of the real six statuses map ambiguously onto that
 * binary and #734's own issue comment flagged the mapping as an open
 * question Shane had to resolve by hand (his written recommendation there
 * was the OPPOSITE of what the design's code actually does):
 *
 *   - `deferred` is the design's REASON 3, "Deferring to a later phase" —
 *     which calls `skip()`, setting `status = "skipped"`. It DOES count
 *     toward `phaseReady`.
 *   - `shane_handles` is the design's REASON 2, "Not safe yet — needs a
 *     decision" — which calls `block()`/`handToShane()`, and NEITHER of
 *     those ever sets `status` at all (it stays whatever it was, normally
 *     `"open"`). It does NOT count toward `phaseReady`; a step handed to
 *     Shane blocks its phase from going ready until he actually resolves it
 *     (i.e. it ends up `completed`, or some other resolved status).
 *
 * Shane confirmed 2026-08-11 (after being shown this exact contradiction):
 * follow the design file's literal behavior, not the issue comment's
 * recommendation. `READY_STATUSES` below reflects that call.
 *
 * WHY THE FEE FORMULA DOESN'T NEED A SEPARATE "HAS THIS PHASE BEEN
 * VERIFIED YET" FLAG
 * -------------------------------------------------------------------
 * The design's `doneIn(key)` only subtracts a step when it is BOTH
 * `status === "complete"` AND its phase's `scanned[ph]` flag is true (i.e. a
 * re-scan has actually run since the phase went ready) — ticking a box alone
 * never moves the price. Our real system has no per-phase "re-scan" button;
 * re-scans happen automatically (routine monitoring, manual re-checks, the
 * SOW-expiry sweep — anything that runs `runDiagnostics()`) and
 * `reverifyRemediationTrackerSteps()` (#732) is what actually flips a step's
 * `verificationState` to `verified`/`drift` off the back of one. So the real
 * analogue of "`complete` AND scanned" is "`status === "completed"` AND
 * `verificationState === "verified"`" — and requiring that combination has
 * the same effect as the design's `scanned[ph]` gate for free: before any
 * scan has verified anything in a phase, every pillar's outstanding count
 * equals its total, so `pillarFee` already equals `PILLAR_FEE[pillar]` flat.
 * Layering `phaseReady` on top (a phase not yet ready is FORCED flat,
 * regardless of any early per-step verification that happened before the
 * rest of the phase was resolved) reproduces the design's "stays flat until
 * ready AND verified" behavior exactly, and needs no stored state of its
 * own — every call recomputes from the tracker's live rows, so a later scan
 * flipping a `verified` step back to `drift` pushes the fee back up
 * automatically, with no separate drift-handling code path.
 */

import {
  REMEDIATION_TRACKER_CATALOGUE,
  type RemediationTrackerCatalogueStep,
} from "./remediation-tracker-catalogue";

export type RemediationTrackerPillar =
  | "governance"
  | "security"
  | "compliance"
  | "licensing"
  | "adoption"
  | "health";

export type RemediationTrackerPhaseNumber = 1 | 2 | 3;

/** The design's literal per-pillar fixed fees (`PILLAR_FEE`, line ~3900). */
export const PILLAR_FEE: Readonly<Record<RemediationTrackerPillar, number>> = {
  governance: 9800,
  security: 6400,
  compliance: 8600,
  licensing: 3200,
  adoption: 5400,
  health: 2800,
};

/** The design's literal `full` constant (line ~4306) — not derived, kept as its own figure like the design keeps it. */
export const FULL_PROGRAMME_FEE = 36200;

/** The design's literal `PHASE_PILLARS` (line ~3901). */
export const PHASE_PILLARS: Readonly<Record<RemediationTrackerPhaseNumber, readonly RemediationTrackerPillar[]>> = {
  1: ["governance", "security"],
  2: ["compliance", "licensing"],
  3: ["adoption", "health"],
};

/**
 * Step statuses that count as "resolved" for phase re-scan readiness —
 * mirrors the design's `phaseReady()`. See the header for why `deferred` is
 * in this set and `shane_handles` deliberately is not.
 */
const READY_STATUSES: ReadonlySet<string> = new Set(["completed", "already_handled", "not_applicable", "deferred"]);

/** `"$" + Math.round(n).toLocaleString("en-US")` — the design's own `money()` (line ~3902), byte-for-byte. */
function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

interface StepIdAndPillar {
  readonly id: string;
  readonly pillar: string;
}

const STEPS_BY_PILLAR: ReadonlyMap<string, readonly StepIdAndPillar[]> = (() => {
  const map = new Map<string, StepIdAndPillar[]>();
  for (const step of REMEDIATION_TRACKER_CATALOGUE as readonly RemediationTrackerCatalogueStep[]) {
    const list = map.get(step.pillar) ?? [];
    list.push({ id: step.id, pillar: step.pillar });
    map.set(step.pillar, list);
  }
  return map;
})();

/** What this file needs from one tracker row — a subset of the wire/DB shape. */
export interface RemediationTrackerStepState {
  readonly stepId: string;
  readonly status: string;
  readonly verificationState: string;
}

export interface RemediationTrackerPhasePricing {
  readonly phase: RemediationTrackerPhaseNumber;
  readonly pillars: readonly RemediationTrackerPillar[];
  /** True once every step across both of this phase's pillars is resolved (see READY_STATUSES). */
  readonly ready: boolean;
  /** Live fee for this phase — flat (sum of PILLAR_FEE) while `ready` is false, formula-derived once true. */
  readonly fee: number;
  readonly feeDisplay: string;
}

export interface RemediationTrackerHirePricing {
  readonly price: string;
  readonly was: string;
  readonly wasShow: boolean;
  readonly saved: string;
  readonly savedShow: boolean;
  readonly cta: string;
  readonly note: string;
}

export interface RemediationTrackerPricing {
  readonly phases: readonly RemediationTrackerPhasePricing[];
  readonly hire: RemediationTrackerHirePricing;
}

function stateOf(byId: ReadonlyMap<string, RemediationTrackerStepState>, stepId: string): RemediationTrackerStepState {
  return byId.get(stepId) ?? { stepId, status: "not_started", verificationState: "unverified" };
}

function totalInPillar(pillar: RemediationTrackerPillar): number {
  return STEPS_BY_PILLAR.get(pillar)?.length ?? 0;
}

function isCompleteAndVerified(state: RemediationTrackerStepState): boolean {
  return state.status === "completed" && state.verificationState === "verified";
}

function phaseReady(phase: RemediationTrackerPhaseNumber, byId: ReadonlyMap<string, RemediationTrackerStepState>): boolean {
  return PHASE_PILLARS[phase].every((pillar) =>
    (STEPS_BY_PILLAR.get(pillar) ?? []).every((step) => READY_STATUSES.has(stateOf(byId, step.id).status)),
  );
}

/**
 * `(PILLAR_FEE[pillar] / total) * outstanding` when the phase is ready,
 * else the flat `PILLAR_FEE[pillar]` — the design's `phaseFee()` (line
 * ~4161) with `doneIn`'s implicit `scanned[ph]` gate replaced by the
 * explicit `ready` check (see header).
 */
function pillarFee(pillar: RemediationTrackerPillar, ready: boolean, byId: ReadonlyMap<string, RemediationTrackerStepState>): number {
  const total = totalInPillar(pillar);
  if (total === 0) return 0;
  if (!ready) return PILLAR_FEE[pillar];

  const done = (STEPS_BY_PILLAR.get(pillar) ?? []).reduce(
    (count, step) => count + (isCompleteAndVerified(stateOf(byId, step.id)) ? 1 : 0),
    0,
  );
  const outstanding = total - done;
  return (PILLAR_FEE[pillar] / total) * outstanding;
}

function phaseFee(phase: RemediationTrackerPhaseNumber, ready: boolean, byId: ReadonlyMap<string, RemediationTrackerStepState>): number {
  return PHASE_PILLARS[phase].reduce((sum, pillar) => sum + pillarFee(pillar, ready, byId), 0);
}

/**
 * Computes the live, phase-gated remediation price for one customer from
 * their stored tracker rows. Rows for steps with no stored state (never
 * touched) are treated as `not_started`/`unverified`, same convention the
 * rest of the tracker uses.
 */
export function computeRemediationTrackerPricing(
  rows: readonly RemediationTrackerStepState[],
): RemediationTrackerPricing {
  const byId = new Map(rows.map((row) => [row.stepId, row]));

  const phases: RemediationTrackerPhasePricing[] = ([1, 2, 3] as const).map((phase) => {
    const ready = phaseReady(phase, byId);
    const fee = phaseFee(phase, ready, byId);
    return { phase, pillars: PHASE_PILLARS[phase], ready, fee, feeDisplay: money(fee) };
  });

  const left = phases.reduce((sum, p) => sum + p.fee, 0);
  const saved = FULL_PROGRAMME_FEE - left;

  const hire: RemediationTrackerHirePricing =
    left < 1
      ? {
          price: money(0),
          was: money(FULL_PROGRAMME_FEE),
          wasShow: saved > 1,
          saved: money(saved),
          savedShow: saved > 1,
          cta: "Book your gate validation",
          note: "Everything is verified. All that remains is the gate validation and signed certification.",
        }
      : saved > 1
        ? {
            price: money(left),
            was: money(FULL_PROGRAMME_FEE),
            wasShow: true,
            saved: money(saved),
            savedShow: true,
            cta: "Hire Shane for the rest",
            note: "Your quote drops as each phase re-scans clean. Skipped tasks stay in scope — they are unresolved, not done.",
          }
        : {
            price: money(left),
            was: money(FULL_PROGRAMME_FEE),
            wasShow: false,
            saved: money(saved),
            savedShow: false,
            cta: "Hire Shane McCaw",
            note: "Fixed-fee, phase by phase. Tick tasks off yourself and this number comes down.",
          };

  return { phases, hire };
}
