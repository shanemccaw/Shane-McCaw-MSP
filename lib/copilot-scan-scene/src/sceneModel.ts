/**
 * sceneModel.ts — the minimal view-model contract Scene 0's overlay renders
 * against, plus the one sentinel string shared between the overlay and the
 * chip-projection that feeds it.
 *
 * WHY THIS EXISTS SEPARATELY FROM msp-portal's `journeyModel.ts`
 * -------------------------------------------------------------
 * The full `JourneyView`/`JourneyPillarView` model — which maps the platform's
 * real payloads into what all four Copilot Readiness screens render — stays in
 * `artifacts/msp-portal/.../journeyModel.ts`; it is tightly coupled to
 * app-only wire shapes and belongs with the app. Scene 0's overlay
 * (`RevealScanOverlay`) reads only a small structural slice of a pillar view:
 * its key, its radar chips, and its findings' titles. Declaring that slice here
 * lets the overlay live in this cross-app package without dragging the whole
 * app model with it — `journeyModel.ts`'s `JourneyPillarView` is a structural
 * superset of `ScanScenePillarView`, so it passes straight in unchanged.
 */

import type { PillarKey } from "./journeyTokens.ts";

/** One real finding as the scan overlay reads it — a title, keyed by its check. */
export interface ScanSceneFinding {
  readonly checkKey: string;
  readonly title: string;
}

/**
 * The slice of a pillar view Scene 0's radar renders: which pillar, its curated
 * radar chips, and its full findings list (for the "+N more" expansion). A
 * structural subset of the app's `JourneyPillarView`, so a real journey pillar
 * view satisfies it with no adaptation.
 */
export interface ScanScenePillarView {
  readonly key: PillarKey;
  readonly chips: readonly string[];
  readonly findings: readonly ScanSceneFinding[];
}

/**
 * #518: what `insufficient_data` means while the scan producing this pillar's
 * signals is still running, instead of `INSUFFICIENT_PILLAR_CHIP`.
 *
 * `evaluatePillarDisplay` (server-side, #517) has no notion of an in-flight
 * run — its floor is a count of evaluable signals seen so far, so a pillar
 * whose checks simply haven't executed yet reads identically to one whose
 * completed scan genuinely stayed thin. Only the client knows a run is live
 * (`scan.running`, Scene 0's own signal), so this substitution happens in the
 * app's `journeyModel.ts`, not in `pillarEvaluation()` — the wire's
 * `insufficient_data` verdict itself is unchanged and still the honest fact
 * once the run finishes.
 *
 * #524: also shown for a `"scored"` pillar with zero findings while a scan is
 * live and no run has ever persisted findings for this tenant (see
 * `WirePillarStatsPayload.findingsRunId`). A pillar's score can become
 * computable from partial live signals well before the run completes and
 * writes its findings batch — `evaluatePillarDisplay`'s floor is about
 * SCORING coverage, not about whether findings exist yet, so `"scored"` alone
 * says nothing about that. With no fallback run to borrow a result from
 * either, an empty finding list here is not evidence of anything — showing
 * `CLEAN_PILLAR_HEADLINE` for it was this issue's confirmed live bug.
 *
 * Lives here (rather than in `journeyModel.ts`) so it is a single source of
 * truth: the app's chip projection emits this exact string and
 * `RevealScanOverlay` tests each chip against it to decide whether to pulse the
 * "actively scanning" marker. A duplicated literal on either side would
 * silently break that pulse the first time one drifted.
 */
export const SCANNING_PILLAR_CHIP = "Scan in progress — evaluating this pillar now.";
