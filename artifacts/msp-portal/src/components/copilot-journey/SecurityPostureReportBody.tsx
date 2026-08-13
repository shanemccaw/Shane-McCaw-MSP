/**
 * SecurityPostureReportBody.tsx — the real Microsoft 365 Security Posture &
 * Blast Radius Report, rendered for an actual customer (#343).
 *
 * The second document ported onto the pattern #409 established, and
 * deliberately a thin file: the structure and every honesty rule are in
 * `pillarSecurityPosture.ts` (testable under `node --test`, which cannot load
 * `.tsx`), the chrome and the three extra block kinds are in
 * `LiveReportShell.tsx`, and what is left here is the one thing that genuinely
 * has to be a component — resolving the figures.
 *
 * ── THE DESIGN'S TWO FIGURES, AND WHY NEITHER IS DRAWN ───────────────────────
 * The design's `SECURITY_POSTURE` asks for `secureScoreTrend` in the Summary
 * and `blastRadius` in the exposure section. Neither is rendered, and both
 * absences are decisions rather than omissions:
 *
 *   • `secureScoreTrend` needs Secure Score HISTORY. `security.secureScore`
 *     resolves to a single current value; the only real per-tenant history this
 *     platform holds is `tenant_monitor_profiles` replayed per PILLAR (#356),
 *     which is a different series. Drawing a trend from one point, or from the
 *     pillar's series under a Secure Score label, would be a fabricated shape.
 *     The real current figure is a row in the Summary table instead.
 *   • `blastRadius` is the design's five-ring diagram, and its ring values are
 *     Halden's — `PREVIEW_FIGURES` is their only source. Nothing computes a
 *     per-ring reachability breakdown for a real tenant. The real over-exposure
 *     count and the real site counts around it are stated as rows instead, which
 *     is the same call `copilotReadinessReport.ts` made for the same figure.
 *
 * `renderFigure` therefore returns null for every name. It is still passed
 * rather than dropped, so the shell's contract is uniform across reports and a
 * figure that one day HAS a real producer has an obvious place to land.
 */

import { useSecurityPostureNarrative } from "./useSecurityPostureNarrative.ts";
import { LiveReportShell } from "./LiveReportShell";
import type { JourneyView } from "./journeyModel.ts";
import {
  buildSecurityPostureReport,
  type WireSecurityPosturePayload,
} from "./pillarSecurityPosture.ts";

export function SecurityPostureReportBody({
  view,
  narrative,
  narrativeSettled,
  scannedCheckCount,
}: {
  readonly view: JourneyView;
  readonly narrative: WireSecurityPosturePayload | null;
  /** True once the narrative fetch has settled, success or failure. */
  readonly narrativeSettled: boolean;
  readonly scannedCheckCount: number;
}) {
  const report = buildSecurityPostureReport({ view, narrative, narrativeSettled, scannedCheckCount });

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
      // Banded with the Security pillar's own identity colour — this report
      // belongs to one pillar, unlike the roll-up readiness report.
      accentPillar="security"
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
export function LiveSecurityPostureReport({ view }: { readonly view: JourneyView }) {
  const { narrative, settled } = useSecurityPostureNarrative({ enabled: true });
  return (
    <SecurityPostureReportBody
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
