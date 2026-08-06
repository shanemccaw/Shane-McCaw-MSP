/**
 * LicensingAlignmentReportBody.tsx — the real Copilot Licensing Alignment
 * Report, rendered for an actual customer (#292).
 *
 * A thin file by design, exactly like its siblings: the structure and every
 * honesty rule are in `pillarLicensingAlignment.ts` (testable under
 * `node --test`, which cannot load `.tsx`), the chrome and the three extra block
 * kinds are in `LiveReportShell.tsx`. The split matters more here than anywhere
 * else in the set — this is the report full of dollar figures and seat counts,
 * and the platform's no-hardcoding rule bars every one of them from a `.tsx`.
 *
 * ── THE DESIGN'S ONE FIGURE, AND WHY IT IS NOT DRAWN ─────────────────────────
 * `LICENSING_ALIGNMENT` asks for `monthlyWaste` at the top of "Cost Waste
 * Summary": a four-row bar chart splitting the waste by category (unused Copilot
 * seats, E5 assigned to ineligible users, duplicate service plans, unassigned
 * base licences) with a monthly dollar figure against each.
 *
 * #292's own data-requirement comment is explicit that this needs new structured
 * data: the chart "needs a structured breakdown by category or department, not
 * just the single total waste figure". That is exactly what the platform holds —
 * `computeSkuCostBreakdown` prices the paid, unassigned seats and returns one
 * annual total. There is no per-category attribution behind it, and three of the
 * design's four categories (Copilot-specific seats, E5 eligibility, duplicate
 * service plans) would each need a classification this platform does not make.
 * Splitting one real total into four invented shares is the fabrication this
 * report exists to refuse.
 *
 * The real annual figure is a row instead, in the section the chart would have
 * headed.
 *
 * `renderFigure` therefore returns null for every name. It is still passed
 * rather than dropped, so the shell's contract is uniform across reports and a
 * figure that one day HAS a real producer has an obvious place to land.
 */

import { usePillarReportNarrative } from "./usePillarReportNarrative.ts";
import { LiveReportShell } from "./LiveReportShell";
import type { JourneyView } from "./journeyModel.ts";
import {
  buildLicensingAlignmentReport,
  type WireLicensingAlignmentPayload,
} from "./pillarLicensingAlignment.ts";

const NARRATIVE_URL = "/api/portal/assessment/licensing-alignment-narrative";

export function LicensingAlignmentReportBody({
  view,
  narrative,
  narrativeSettled,
  scannedCheckCount,
}: {
  readonly view: JourneyView;
  readonly narrative: WireLicensingAlignmentPayload | null;
  /** True once the narrative fetch has settled, success or failure. */
  readonly narrativeSettled: boolean;
  readonly scannedCheckCount: number;
}) {
  const report = buildLicensingAlignmentReport({ view, narrative, narrativeSettled, scannedCheckCount });

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
      accentPillar="licensing"
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
export function LiveLicensingAlignmentReport({ view }: { readonly view: JourneyView }) {
  const { narrative, settled } = usePillarReportNarrative<WireLicensingAlignmentPayload>({
    url: NARRATIVE_URL,
    failureEvent: "LicensingAlignmentNarrativeFetchFailed",
    enabled: true,
  });
  return (
    <LicensingAlignmentReportBody
      view={view}
      narrative={narrative}
      narrativeSettled={settled}
      scannedCheckCount={narrative?.scannedCheckCount ?? 0}
    />
  );
}
