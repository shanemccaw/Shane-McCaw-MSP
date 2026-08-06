/**
 * GovernancePostureReportBody.tsx — the real Microsoft 365 Governance Posture
 * Report, rendered for an actual customer (#292).
 *
 * A thin file by design, exactly like `SecurityPostureReportBody.tsx`: the
 * structure and every honesty rule are in `pillarGovernancePosture.ts` (testable
 * under `node --test`, which cannot load `.tsx`), the chrome and the three extra
 * block kinds are in `LiveReportShell.tsx`, and what is left here is the one
 * thing that genuinely has to be a component.
 *
 * ── THE DESIGN'S ONE FIGURE, AND WHY IT IS NOT DRAWN ─────────────────────────
 * `GOVERNANCE_POSTURE` asks for `exposureHeatmap` at the top of "Exposure &
 * Oversharing Risks": a five-row by four-column grid of content categories
 * (Financial, PII, PHI, Commercial, General) against exposure types (org-wide
 * links, anonymous links, public Teams, unlabelled), with a per-cell count and
 * intensity.
 *
 * Nothing in this platform produces any axis of it. #292's own data-requirement
 * comment says so outright — the heat map "needs a real per-site (or
 * per-department) structured list: site name, exposure level/category, sharing
 * type. Currently only a single aggregate count (212 sites) exists in the report
 * text." That is still true: `compliance:overshared-sites` returns a count,
 * `copilot:overshare-exposure` returns a count, and nothing classifies content
 * into those five categories at all. Drawing the grid from the real totals would
 * mean inventing twenty cells and a content taxonomy to hang them on.
 *
 * The real over-exposure count and the real site counts are stated as rows
 * instead — the same call `copilotReadinessReport.ts` and
 * `pillarSecurityPosture.ts` both made for the design's blast-radius diagram.
 *
 * `renderFigure` therefore returns null for every name. It is still passed
 * rather than dropped, so the shell's contract is uniform across reports and a
 * figure that one day HAS a real producer has an obvious place to land.
 */

import { usePillarReportNarrative } from "./usePillarReportNarrative.ts";
import { LiveReportShell } from "./LiveReportShell";
import type { JourneyView } from "./journeyModel.ts";
import {
  buildGovernancePostureReport,
  type WireGovernancePosturePayload,
} from "./pillarGovernancePosture.ts";

const NARRATIVE_URL = "/api/portal/assessment/governance-posture-narrative";

export function GovernancePostureReportBody({
  view,
  narrative,
  narrativeSettled,
  scannedCheckCount,
}: {
  readonly view: JourneyView;
  readonly narrative: WireGovernancePosturePayload | null;
  /** True once the narrative fetch has settled, success or failure. */
  readonly narrativeSettled: boolean;
  readonly scannedCheckCount: number;
}) {
  const report = buildGovernancePostureReport({ view, narrative, narrativeSettled, scannedCheckCount });

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
      // Banded with the Governance pillar's own identity colour — this report
      // belongs to one pillar, unlike the roll-up readiness report.
      accentPillar="governance"
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
export function LiveGovernancePostureReport({ view }: { readonly view: JourneyView }) {
  const { narrative, settled } = usePillarReportNarrative<WireGovernancePosturePayload>({
    url: NARRATIVE_URL,
    failureEvent: "GovernancePostureNarrativeFetchFailed",
    enabled: true,
  });
  return (
    <GovernancePostureReportBody
      view={view}
      narrative={narrative}
      narrativeSettled={settled}
      // The real curated check count behind the provenance line, from the same
      // payload the prose was grounded in. 0 until it lands, which
      // `buildProvenance` renders by omitting that clause rather than by
      // printing a zero.
      scannedCheckCount={narrative?.scannedCheckCount ?? 0}
    />
  );
}
