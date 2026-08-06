/**
 * CopilotReadinessReportBody.tsx — the real Copilot Readiness, Safety &
 * Enablement Report, rendered for an actual customer (#409).
 *
 * Until this shipped, the design's approved structure for this report existed
 * only behind `?preview=design`, filled with Halden Materials' worked example,
 * and a real customer got `LiveBody`'s server-generated HTML instead. This is
 * the same structure on the customer's own data.
 *
 * WHAT IS SHARED WITH THE PREVIEW, AND WHAT IS NOT
 * ------------------------------------------------
 * Shared: the block loop and every block's styling (`ReportBlocks.tsx`), the
 * header, the verdict card and the provenance line's placement — because a
 * report of real numbers has to look like the report the design signed off, not
 * a second-class variant of it. Since #343 all of that chrome lives in
 * `LiveReportShell.tsx`, shared with the other live-rendered reports rather
 * than written out per report.
 *
 * NOT shared: the figures. `PreviewReportBody` resolves figure names against
 * `PREVIEW_FIGURES` and `journeyPreviewFixture.ts`; this file resolves them
 * against the tenant's own `JourneyView`. That boundary is the only route by
 * which a fixture number could reach a real customer's report, and this file
 * never crosses it — it imports neither module.
 *
 * THE TWO FIGURES THAT ARE DELIBERATELY NOT THE DESIGN'S
 * ------------------------------------------------------
 *   • `scoreSummary` — the design shows "Readiness today" beside "After
 *     remediation" and the gain between them. There is no real post-remediation
 *     projection on this path: the Document Viewer passes no `projectedByPillar`
 *     (those come from a SOW's own phase deltas, and a customer reading their
 *     reports may have no scope quoted yet), so `view.remediatedScore` is just
 *     the mean of the current pillar scores — a different quantity entirely, and
 *     printing it under "After remediation" would promise an improvement nobody
 *     has quoted. The real version shows the score against the Gate and the real
 *     gap, and claims no projection.
 *   • `pillarTable` — the design's fourth column is that same projection, so the
 *     real table is three columns. Its "material finding" is the pillar's own
 *     real `headline`, which is either a real finding title (#408's
 *     `severity_rules` label), `CLEAN_PILLAR_HEADLINE` for a pillar genuinely
 *     evaluated clean (#399), or null for a pillar nothing scored — rendered as
 *     an honest "Not evaluated" rather than a dash that reads as "nothing found".
 */

import {
  COPILOT_GATE_TARGET,
  INK,
  PILLARS,
  PILLAR_ORDER,
  TABULAR,
  gateLabel,
  severityColor,
} from "./journeyTokens.ts";
import { PillarSwatch } from "./JourneyPrimitives";
import { BODY, EYEBROW, type FigureRenderer } from "./ReportBlocks";
import { ReadinessRadar } from "./ReportFigures";
import { LiveReportShell } from "./LiveReportShell";
import type { JourneyView } from "./journeyModel.ts";
import type { ReportFigure } from "./previewDocumentBodies.ts";
import {
  buildCopilotReadinessReport,
  type WireNarrativePayload,
} from "./copilotReadinessReport.ts";

/* ------------------------------------------------------------------ *
 * The two derived figures, on real data
 * ------------------------------------------------------------------ */

const EXEC_GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(140px,1.1fr) 62px minmax(200px,2.6fr)",
  gap: 16,
};

function ScoreNumeral({ label, score, verdict }: { label: string; score: number; verdict: string }) {
  const colour = severityColor(score);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ ...EYEBROW, fontSize: 10, letterSpacing: ".2em", color: INK.bodyDark }}>{label}</span>
      <span style={{ fontSize: 58, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1, color: colour, ...TABULAR }}>
        {score}
      </span>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: colour }}>
        {verdict}
      </span>
    </div>
  );
}

/**
 * Readiness today against the Gate. No projection — see the file header for why
 * the design's second numeral has no real source on this path.
 */
function RealScoreSummary({ view }: { readonly view: JourneyView }) {
  const score = view.readinessScore;
  if (score === null) {
    return (
      <p style={{ ...BODY, fontSize: 13.5, lineHeight: 1.6, color: INK.bodyDark }}>
        {`No evaluable rule fed this tenant's Copilot pillar on the last scan, so there is no readiness score to show against the Gate of ${COPILOT_GATE_TARGET}. The pillar detail below is what the scan did measure.`}
      </p>
    );
  }
  const gap = COPILOT_GATE_TARGET - score;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "28px 44px", alignItems: "flex-end" }}>
      <ScoreNumeral label="Readiness today" score={score} verdict={gateLabel(score)} />
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ ...EYEBROW, fontSize: 10, letterSpacing: ".2em", color: INK.bodyDark }}>The Copilot Gate</span>
        <span
          style={{
            fontSize: 58,
            fontWeight: 800,
            letterSpacing: "-0.04em",
            lineHeight: 1,
            color: INK.deemphasised,
            ...TABULAR,
          }}
        >
          {COPILOT_GATE_TARGET}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".14em", textTransform: "uppercase", color: INK.micro }}>
          {gap > 0 ? `${gap} points away` : "Cleared"}
        </span>
      </div>
      <p style={{ ...BODY, fontSize: 13.5, lineHeight: 1.6, color: INK.bodyDark, flex: "1 1 240px" }}>
        {gap > 0
          ? "Every point of that gap maps to a specific, named finding in the reports alongside this one. No estimates, no benchmarks — your tenant, read directly through the Graph API."
          : "No estimates, no benchmarks — your tenant, read directly through the Graph API. What follows is what holds the score there."}
      </p>
    </div>
  );
}

/**
 * Pillar, score, material finding. Three columns, not the design's four — see
 * the file header on the missing projection.
 */
function RealPillarTable({ view }: { readonly view: JourneyView }) {
  const byKey = new Map(view.pillars.map((p) => [p.key, p]));
  return (
    <div style={{ display: "flex", flexDirection: "column", borderTop: `1px solid ${INK.hairlineDark}` }}>
      <div style={{ ...EXEC_GRID, padding: "12px 0", borderBottom: `1px solid ${INK.hairlineDark}` }}>
        {["Pillar", "Score", "Material finding"].map((h) => (
          <span
            key={h}
            style={{
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: ".16em",
              textTransform: "uppercase",
              color: INK.bodyDark,
            }}
          >
            {h}
          </span>
        ))}
      </div>
      {PILLAR_ORDER.map((identity) => {
        const pillar = byKey.get(identity.key);
        const score = pillar?.score ?? null;
        return (
          <div
            key={identity.key}
            style={{
              ...EXEC_GRID,
              padding: "14px 10px",
              borderBottom: `1px solid ${INK.hairlineDark}`,
              alignItems: "baseline",
            }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 600, color: INK.headingDark }}>
              <PillarSwatch pillar={identity.key} />
              {PILLARS[identity.key].label}
            </span>
            {/* An em dash rather than a 0: printing 0 for "nothing fed this"
                is the one reading that turns an absence into a verdict. */}
            <span
              style={{
                fontSize: 19,
                fontWeight: 800,
                color: score === null ? INK.micro : severityColor(score),
                ...TABULAR,
              }}
            >
              {score ?? "—"}
            </span>
            <span
              style={{
                fontSize: 13.5,
                fontWeight: 500,
                lineHeight: 1.5,
                color: pillar?.headline ? INK.bodyDarkStrong : INK.micro,
              }}
            >
              {pillar?.headline ?? "Not evaluated — no rule fed this pillar"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The report
 * ------------------------------------------------------------------ */

export function CopilotReadinessReportBody({
  view,
  narrative,
  narrativeSettled,
  scannedCheckCount,
}: {
  readonly view: JourneyView;
  readonly narrative: WireNarrativePayload | null;
  /** True once the narrative fetch has settled, success or failure. */
  readonly narrativeSettled: boolean;
  readonly scannedCheckCount: number;
}) {
  const report = buildCopilotReadinessReport({ view, narrative, narrativeSettled, scannedCheckCount });

  const renderFigure: FigureRenderer = (figure: ReportFigure) => {
    switch (figure) {
      case "readinessRadar":
        return (
          <ReadinessRadar
            scores={PILLAR_ORDER.map((p) => view.pillars.find((v) => v.key === p.key)?.score ?? null)}
            scannedOn={view.tenant.scannedOn ?? ""}
            note={report.radarNote}
          />
        );
      case "scoreSummary":
        return <RealScoreSummary view={view} />;
      case "pillarTable":
        return <RealPillarTable view={view} />;
      // Every other figure name in the shared vocabulary belongs to a pillar
      // report whose real data this issue does not cover, and all of them are
      // backed only by `PREVIEW_FIGURES`. Rendering nothing is the honest
      // outcome; the real report never asks for one.
      default:
        return null;
    }
  };

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
      // The roll-up report belongs to no single pillar, so it takes the
      // journey's own blue→teal — the same accent the preview's executive
      // report takes.
      accentPillar={null}
      closingHeading="Executive Summary"
      renderFigure={renderFigure}
    />
  );
}
