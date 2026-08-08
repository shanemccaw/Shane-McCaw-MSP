/**
 * AdoptionReportBody.tsx — the real Copilot Adoption & Usage Report, rendered
 * for an actual customer.
 *
 * A thin file by design, exactly like its six siblings: the structure and every
 * honesty rule are in `pillarAdoption.ts` (testable under `node --test`, which
 * cannot load `.tsx`), the chrome and the three extra block kinds are in
 * `LiveReportShell.tsx`.
 *
 * ── THE THREE FIGURES THE DESIGN DRAWS, AND WHY NONE IS DRAWN HERE ───────────
 * `ADOPTION_READINESS` is the only pillar report in the design that carries
 * three figures, and it is the one with the least real data behind it:
 *
 *   personaSplit      Needs a persona model. No check in this catalog produces
 *                     one, and none maps a user to a role — see
 *                     `PERSONA_AND_ENABLEMENT_GAP`, which says so to the reader.
 *   departmentUsage   Needs per-department active-user counts. Nothing reads a
 *                     department, and nothing counts active users: the six real
 *                     adoption checks are Graph usage-report DETAIL endpoints,
 *                     which is exactly why `WAR_ROOM_PILLAR_STAT_SPECS.adoption`
 *                     is an empty array rather than four re-pointed stats.
 *   usageTrend        The one with a real-looking candidate, and the candidate
 *                     does not hold. `pillar-trend.ts` (#356) DOES produce a
 *                     real series, and it reaches this report as
 *                     `JourneyPillarView.trend` — but it is the ADOPTION PILLAR
 *                     SCORE over time, not usage over time, and the checks
 *                     themselves each read a single seven-day window with no
 *                     earlier one beside it (`TREND_DIRECTION_GAP`). Plotting a
 *                     score series under a usage caption is the fabricated shape
 *                     #343 refused when it declined to draw Secure Score history
 *                     from the same series, and it would be worse here because
 *                     the report's own heading invites the reading.
 *
 * `renderFigure` therefore returns null for every name. It is still passed
 * rather than dropped, so the shell's contract is uniform across all seven
 * reports and a figure that one day HAS a real producer has an obvious place to
 * land.
 */

import { usePillarReportNarrative } from "./usePillarReportNarrative.ts";
import { LiveReportShell } from "./LiveReportShell";
import type { JourneyView } from "./journeyModel.ts";
import { buildAdoptionReport, type WireAdoptionPayload } from "./pillarAdoption.ts";

const NARRATIVE_URL = "/api/portal/assessment/adoption-narrative";

export function AdoptionReportBody({
  view,
  narrative,
  narrativeSettled,
  scannedCheckCount,
}: {
  readonly view: JourneyView;
  readonly narrative: WireAdoptionPayload | null;
  /** True once the narrative fetch has settled, success or failure. */
  readonly narrativeSettled: boolean;
  readonly scannedCheckCount: number;
}) {
  const report = buildAdoptionReport({ view, narrative, narrativeSettled, scannedCheckCount });

  return (
    <LiveReportShell
      kicker={report.kicker}
      headline={report.headline}
      standfirst={report.standfirst}
      verdict={report.verdict}
      sections={report.sections}
      closing={report.closing}
      provenance={report.provenance}
      scannedOn={view.tenant.scannedOn}
      accentPillar="adoption"
      closingHeading="What this means"
      renderFigure={() => null}
    />
  );
}

/**
 * The narrative hook lives here rather than in `DocumentBody`, so the three
 * real, metered Anthropic calls it triggers only ever fire when this report is
 * genuinely the open document.
 */
export function LiveAdoptionReport({ view }: { readonly view: JourneyView }) {
  const { narrative, settled } = usePillarReportNarrative<WireAdoptionPayload>({
    url: NARRATIVE_URL,
    failureEvent: "AdoptionNarrativeFetchFailed",
    enabled: true,
  });
  return (
    <AdoptionReportBody
      view={view}
      narrative={narrative}
      narrativeSettled={settled}
      scannedCheckCount={narrative?.scannedCheckCount ?? 0}
    />
  );
}
