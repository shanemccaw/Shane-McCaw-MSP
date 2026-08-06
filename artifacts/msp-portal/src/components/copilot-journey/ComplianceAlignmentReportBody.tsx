/**
 * ComplianceAlignmentReportBody.tsx — the real Microsoft 365 Compliance &
 * Regulatory Alignment Report, rendered for an actual customer (#292).
 *
 * A thin file by design, exactly like its siblings: the structure and every
 * honesty rule are in `pillarComplianceAlignment.ts` (testable under
 * `node --test`, which cannot load `.tsx`), the chrome and the three extra block
 * kinds are in `LiveReportShell.tsx`.
 *
 * ── NO FIGURE TO DRAW ────────────────────────────────────────────────────────
 * `COMPLIANCE_ALIGNMENT` is the one report in the design's set that asks for no
 * data visual at all — every one of its sections is prose, a `keyValues` table
 * or a findings list. So `renderFigure` has nothing to decline rather than
 * something it must decline, and it returns null uniformly for the same reason
 * every sibling's does: the shell's contract stays the same across reports, and
 * a figure that one day HAS a real producer has an obvious place to land.
 */

import { usePillarReportNarrative } from "./usePillarReportNarrative.ts";
import { LiveReportShell } from "./LiveReportShell";
import type { JourneyView } from "./journeyModel.ts";
import {
  buildComplianceAlignmentReport,
  type WireComplianceAlignmentPayload,
} from "./pillarComplianceAlignment.ts";

const NARRATIVE_URL = "/api/portal/assessment/compliance-alignment-narrative";

export function ComplianceAlignmentReportBody({
  view,
  narrative,
  narrativeSettled,
  scannedCheckCount,
}: {
  readonly view: JourneyView;
  readonly narrative: WireComplianceAlignmentPayload | null;
  /** True once the narrative fetch has settled, success or failure. */
  readonly narrativeSettled: boolean;
  readonly scannedCheckCount: number;
}) {
  const report = buildComplianceAlignmentReport({ view, narrative, narrativeSettled, scannedCheckCount });

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
      accentPillar="compliance"
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
export function LiveComplianceAlignmentReport({ view }: { readonly view: JourneyView }) {
  const { narrative, settled } = usePillarReportNarrative<WireComplianceAlignmentPayload>({
    url: NARRATIVE_URL,
    failureEvent: "ComplianceAlignmentNarrativeFetchFailed",
    enabled: true,
  });
  return (
    <ComplianceAlignmentReportBody
      view={view}
      narrative={narrative}
      narrativeSettled={settled}
      scannedCheckCount={narrative?.scannedCheckCount ?? 0}
    />
  );
}
