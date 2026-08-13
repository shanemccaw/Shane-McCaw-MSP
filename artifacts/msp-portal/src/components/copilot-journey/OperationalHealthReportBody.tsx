/**
 * OperationalHealthReportBody.tsx — the real Microsoft 365 Operational Health &
 * Service Integrity Report, rendered for an actual customer (#292).
 *
 * A thin file by design, exactly like its siblings: the structure and every
 * honesty rule are in `pillarOperationalHealth.ts` (testable under
 * `node --test`, which cannot load `.tsx`), the chrome and the three extra block
 * kinds are in `LiveReportShell.tsx`.
 *
 * ── THE FIGURE #292 LEFT OPEN, ANSWERED ──────────────────────────────────────
 * `OPERATIONAL_HEALTH` draws no figure of its own, but #292's data-requirement
 * comment holds this report's sparkline open pending confirmation: "only
 * buildable if real time-series health/drift data is confirmed to exist (open
 * question, not yet confirmed)", with the standing instruction that "the honest
 * fallback is no sparkline for this pillar".
 *
 * It was confirmed for this issue, and the answer is no — twice over:
 *
 *   • There is no availability time series at all. `serviceHealth.uptimeStatus`
 *     is the only registry metric in the area and its sourceKey is
 *     `not_collected:service-health-overview`, a key naming nothing;
 *     `m365:service-health` is read live for Shane's own tenant by the public
 *     status page and never aggregated per-customer. See
 *     `SERVICE_AVAILABILITY_GAP` in `pillarOperationalHealth.ts` for the full
 *     audit, which is written down there so it is not repeated.
 *   • There IS a real per-pillar series — `pillar-trend.ts` (#356) replays
 *     `tenant_monitor_profiles` history through the same per-check → pillar
 *     resolution the live score uses, and it reaches this report as
 *     `JourneyPillarView.trend`. It is deliberately not drawn under a health or
 *     drift label: it is the HEALTH PILLAR SCORE over time, which is a different
 *     quantity from workload availability and from configuration drift, and
 *     plotting it beneath either caption would be the fabricated shape #343
 *     refused when it declined to draw Secure Score history from the same
 *     series.
 *
 * `renderFigure` therefore returns null for every name. It is still passed
 * rather than dropped, so the shell's contract is uniform across reports and a
 * figure that one day HAS a real producer has an obvious place to land.
 */

import { usePillarReportNarrative } from "./usePillarReportNarrative.ts";
import { LiveReportShell } from "./LiveReportShell";
import type { JourneyView } from "./journeyModel.ts";
import {
  buildOperationalHealthReport,
  type WireOperationalHealthPayload,
} from "./pillarOperationalHealth.ts";

const NARRATIVE_URL = "/api/portal/assessment/operational-health-narrative";

export function OperationalHealthReportBody({
  view,
  narrative,
  narrativeSettled,
  scannedCheckCount,
}: {
  readonly view: JourneyView;
  readonly narrative: WireOperationalHealthPayload | null;
  /** True once the narrative fetch has settled, success or failure. */
  readonly narrativeSettled: boolean;
  readonly scannedCheckCount: number;
}) {
  const report = buildOperationalHealthReport({ view, narrative, narrativeSettled, scannedCheckCount });

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
      accentPillar="health"
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
export function LiveOperationalHealthReport({ view }: { readonly view: JourneyView }) {
  const { narrative, settled } = usePillarReportNarrative<WireOperationalHealthPayload>({
    url: NARRATIVE_URL,
    failureEvent: "OperationalHealthNarrativeFetchFailed",
    enabled: true,
  });
  return (
    <OperationalHealthReportBody
      view={view}
      narrative={narrative}
      narrativeSettled={settled}
      scannedCheckCount={narrative?.scannedCheckCount ?? 0}
    />
  );
}
