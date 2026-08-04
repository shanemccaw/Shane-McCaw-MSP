/**
 * PreviewReportBody.tsx — renders the design's own worked-example reports.
 *
 * Reachable ONLY behind `?preview=design`, which paints a persistent
 * `<PreviewBadge />`. On live data the viewer renders the platform's generated
 * HTML instead (`LiveBody` in `DocumentBody.tsx`); nothing in this file is ever
 * shown to a customer reading their own assessment.
 *
 * WHY IT IS A BLOCK LOOP AND NOT A FIXED TEMPLATE
 * -----------------------------------------------
 * The design's third revision gives each report seven or eight headed sections
 * that mix shapes freely — Security's posture summary is a trend sparkline, then
 * a paragraph, then a five-row table; Governance's exposure section is a heat
 * map followed by five findings. So a section is an ordered `blocks` list and
 * this file renders whatever it finds, in order. Adding a shape means adding one
 * `case` here and one member to `ReportBlock`, not restructuring seven reports.
 *
 * THE COLOUR LANGUAGE, IN ONE PLACE
 * ---------------------------------
 * The pillar's identity colour says *what a finding is* (eyebrow, swatch, radar
 * dot, trend stroke, the band across the top of the card). The severity colour
 * says *how bad it is* (score numerals, a finding's left border, a table value).
 * A Compliance score of 29 is red and a Compliance score of 90 is green;
 * Compliance's own `#F3F4F6` plays no part in that.
 */

import { Fragment } from "react";

import {
  BRAND,
  INK,
  PILLARS,
  PILLAR_ICON_PATHS,
  SEVERITY_ON_DARK,
  TABULAR,
  gateLabel,
  hexAlpha,
  reportAccent,
  severityColor,
  type PillarKey,
} from "./journeyTokens.ts";
import { PillarSwatch } from "./JourneyPrimitives";
import {
  PREVIEW_FIGURES,
  PREVIEW_MATERIAL_FINDINGS,
  type PreviewDocumentBody,
  type ReportBlock,
  type ReportFigure,
  type ReportSection,
} from "./previewDocumentBodies.ts";
import {
  PREVIEW_PILLARS,
  PREVIEW_READINESS_SCORE,
  PREVIEW_REMEDIATED_SCORE,
  PREVIEW_SIGNAL_COUNT,
  PREVIEW_TENANT,
} from "./journeyPreviewFixture.ts";
import { BarList, BlastRadius, ExposureHeatmap, ReadinessRadar, SplitBar, TrendSparkline } from "./ReportFigures";

/* ------------------------------------------------------------------ *
 * Shared dark-surface type
 * ------------------------------------------------------------------ */

const H2: React.CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 700,
  letterSpacing: "-0.015em",
  color: INK.headingDark,
};

const BODY: React.CSSProperties = {
  margin: 0,
  fontSize: 15,
  fontWeight: 500,
  lineHeight: 1.65,
  color: INK.bodyDarkStrong,
  textWrap: "pretty",
};

const EYEBROW: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: ".22em",
  textTransform: "uppercase",
};

/**
 * The bullet dot on a self-resolution list. Deliberately one fixed blue across
 * all seven reports rather than the report's own accent — these are actions the
 * customer can take today, and colouring them per pillar would read as another
 * severity axis.
 */
const BULLET_DOT = "#3B82F6";

/* ------------------------------------------------------------------ *
 * The before/after numerals and the pillar table — the executive report's
 * two derived figures. Both read the fixture rather than restating it.
 * ------------------------------------------------------------------ */

const EXEC_GRID: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(140px,1.1fr) 62px minmax(200px,2.2fr) 78px",
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

function ScoreSummary() {
  const gain = PREVIEW_REMEDIATED_SCORE - PREVIEW_READINESS_SCORE;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "28px 44px", alignItems: "flex-end" }}>
      {/* Both verdicts are DERIVED from the Gate rather than written out. The
          design hardcodes "Safe to deploy" under the after-remediation figure,
          which was true against its own 60-era assumption and is not true of the
          fixture's 68 against the real 82 Gate (#359) — the guide alongside it
          says so in as many words ("the remaining 14 points ... come from
          adoption enablement"). A worked example that contradicts its own
          remediation plan is worse than one that reads a little less triumphant. */}
      <ScoreNumeral label="Readiness today" score={PREVIEW_READINESS_SCORE} verdict={gateLabel(PREVIEW_READINESS_SCORE)} />
      <ScoreNumeral label="After remediation" score={PREVIEW_REMEDIATED_SCORE} verdict={gateLabel(PREVIEW_REMEDIATED_SCORE)} />
      <p style={{ ...BODY, fontSize: 13.5, lineHeight: 1.6, color: INK.bodyDark, flex: "1 1 240px" }}>
        {`Every point of that ${gain}-point gain maps to a specific, named finding in the reports alongside this one. No estimates, no benchmarks — your tenant, read directly through the Graph API.`}
      </p>
    </div>
  );
}

function PillarTable() {
  return (
    <div style={{ display: "flex", flexDirection: "column", borderTop: `1px solid ${INK.hairlineDark}` }}>
      <div style={{ ...EXEC_GRID, padding: "12px 0", borderBottom: `1px solid ${INK.hairlineDark}` }}>
        {["Pillar", "Score", "Material finding", "Fixed"].map((h, i) => (
          <span
            key={h}
            style={{
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: ".16em",
              textTransform: "uppercase",
              color: INK.bodyDark,
              textAlign: i === 3 ? "right" : "left",
            }}
          >
            {h}
          </span>
        ))}
      </div>
      {PREVIEW_PILLARS.map((p) => (
        <div
          key={p.key}
          style={{
            ...EXEC_GRID,
            padding: "14px 10px",
            borderBottom: `1px solid ${INK.hairlineDark}`,
            alignItems: "baseline",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13.5, fontWeight: 600, color: INK.headingDark }}>
            <PillarSwatch pillar={p.key} />
            {PILLARS[p.key].label}
          </span>
          <span style={{ fontSize: 19, fontWeight: 800, color: severityColor(p.score), ...TABULAR }}>{p.score}</span>
          <span style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.5, color: INK.bodyDarkStrong }}>
            {PREVIEW_MATERIAL_FINDINGS[p.key]}
          </span>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: severityColor(p.projected), textAlign: "right", ...TABULAR }}>
            {p.projected}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Blocks
 * ------------------------------------------------------------------ */

interface BlockContext {
  readonly pillar: PillarKey | null;
}

function FigureBlock({ figure, ctx }: { readonly figure: ReportFigure; readonly ctx: BlockContext }) {
  const accent = reportAccent(ctx.pillar);
  switch (figure) {
    case "readinessRadar":
      return (
        <ReadinessRadar
          scores={PREVIEW_PILLARS.map((p) => p.score)}
          scannedOn={PREVIEW_TENANT.scannedOn ?? ""}
        />
      );
    case "scoreSummary":
      return <ScoreSummary />;
    case "pillarTable":
      return <PillarTable />;
    case "secureScoreTrend":
      return <TrendSparkline figure={PREVIEW_FIGURES.secureScoreTrend} colour={accent.colour} id="cj-spark-secure" />;
    case "usageTrend":
      return <TrendSparkline figure={PREVIEW_FIGURES.usageTrend} colour={accent.colour} id="cj-spark-usage" />;
    case "blastRadius":
      return <BlastRadius />;
    case "exposureHeatmap":
      return <ExposureHeatmap figure={PREVIEW_FIGURES.exposureHeatmap} />;
    case "monthlyWaste":
      return <BarList figure={PREVIEW_FIGURES.monthlyWaste} wide />;
    case "departmentUsage":
      return <BarList figure={PREVIEW_FIGURES.departmentUsage} />;
    case "personaSplit":
      return <SplitBar figure={PREVIEW_FIGURES.personaSplit} />;
    default:
      return null;
  }
}

function Block({ block, ctx }: { readonly block: ReportBlock; readonly ctx: BlockContext }) {
  if (block.kind === "figure") return <FigureBlock figure={block.figure} ctx={ctx} />;

  if (block.kind === "prose") {
    return (
      <p style={{ ...BODY, margin: "-6px 0", padding: "6px 0" }}>
        {block.text}
      </p>
    );
  }

  if (block.kind === "keyValues") {
    return (
      <div style={{ display: "flex", flexDirection: "column", borderTop: `1px solid ${INK.hairlineDark}` }}>
        {block.rows.map((row) => (
          <div
            key={row.label}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(150px,1.15fr) minmax(0,1.85fr)",
              gap: 14,
              padding: "11px 10px",
              borderBottom: `1px solid ${INK.hairlineDark}`,
              alignItems: "baseline",
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: INK.headingDark }}>{row.label}</span>
            <span style={{ fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: SEVERITY_ON_DARK[row.tone] }}>
              {row.value}
            </span>
          </div>
        ))}
      </div>
    );
  }

  if (block.kind === "findings") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {block.rows.map((f) => (
          <div
            key={f.lead}
            style={{
              display: "flex",
              gap: 12,
              alignItems: "baseline",
              // Severity, not pillar identity — the revised design colours this
              // border by how bad the finding is, not by which report it is in.
              borderLeft: `2px solid ${SEVERITY_ON_DARK[f.severity]}`,
              padding: "8px 10px 8px 14px",
            }}
          >
            <p style={{ ...BODY, fontSize: 14.5, lineHeight: 1.6 }}>
              <span style={{ fontWeight: 700, color: INK.headingDark }}>{f.lead}</span> {f.rest}
            </p>
          </div>
        ))}
      </div>
    );
  }

  if (block.kind === "steps") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 11, paddingTop: 6 }}>
        {block.steps.map((step) => (
          <div key={step.when} style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: ".1em",
                textTransform: "uppercase",
                // The gate step closes the sequence, so it takes the journey's
                // teal rather than the blue the dated steps share.
                color: step.when.toLowerCase() === "gate" ? BRAND.teal : INK.link,
                flex: "none",
                width: 60,
              }}
            >
              {step.when}
            </span>
            <p style={{ ...BODY, fontSize: 14.5, lineHeight: 1.6, margin: "-6px 0", padding: "6px 0" }}>
              {step.text}
            </p>
          </div>
        ))}
      </div>
    );
  }

  // "bullets"
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      {block.items.map((item) => (
        <div key={item.slice(0, 40)} style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
          <span
            aria-hidden="true"
            style={{ width: 5, height: 5, borderRadius: "50%", background: BULLET_DOT, flex: "none", marginTop: 7 }}
          />
          <p style={{ ...BODY, fontSize: 14.5, lineHeight: 1.6, margin: "-6px 0", padding: "6px 0" }}>
            {item}
          </p>
        </div>
      ))}
    </div>
  );
}

function Section({ section, ctx }: { readonly section: ReportSection; readonly ctx: BlockContext }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      <h2 style={H2}>{section.heading}</h2>
      {section.blocks.map((b, i) => (
        <Fragment key={`${section.heading}-${i}`}>
          <Block block={b} ctx={ctx} />
        </Fragment>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The hero card under the header
 * ------------------------------------------------------------------ */

function VerdictCard({
  report,
  pillar,
}: {
  readonly report: PreviewDocumentBody;
  readonly pillar: PillarKey | null;
}) {
  const accent = reportAccent(pillar);
  const tint = pillar === null ? BRAND.teal : PILLARS[pillar].primary;
  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        border: `1px solid ${hexAlpha(tint, 0.33)}`,
        borderRadius: 12,
        background: `linear-gradient(135deg,${hexAlpha(tint, 0.1)},rgba(2,6,23,.45))`,
        padding: "22px 24px",
        display: "flex",
        flexDirection: "column",
        gap: 11,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "-6%",
          top: "-70%",
          width: "60%",
          height: "220%",
          borderRadius: "50%",
          background: accent.glow,
          pointerEvents: "none",
        }}
      />
      <span style={{ position: "relative", fontSize: 9.5, fontWeight: 700, letterSpacing: ".2em", textTransform: "uppercase", color: tint }}>
        {report.verdict.eyebrow}
      </span>
      <span
        style={{
          position: "relative",
          fontSize: "clamp(26px,3.4vw,40px)",
          fontWeight: 800,
          letterSpacing: "-0.03em",
          lineHeight: 1.08,
          color: INK.headingDark,
          textWrap: "pretty",
        }}
      >
        {report.verdict.headline}
      </span>
      <span style={{ position: "relative", fontSize: 14.5, fontWeight: 500, lineHeight: 1.55, color: INK.bodyDarkStrong }}>
        {report.verdict.sub}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The report
 * ------------------------------------------------------------------ */

export function PreviewReportBody({ report }: { readonly report: PreviewDocumentBody }) {
  const pillar = report.kind === "pillar" ? report.pillar : null;
  const accent = reportAccent(pillar);
  const fixture = pillar ? PREVIEW_PILLARS.find((p) => p.key === pillar) : undefined;
  const score = fixture?.score ?? null;
  const projected = fixture?.projected ?? null;
  const scannedOn = PREVIEW_TENANT.scannedOn ?? "";
  const ctx: BlockContext = { pillar };

  const eyebrow =
    report.kind === "executive"
      ? `${report.kicker} · ${scannedOn}`
      : score === null
        ? report.kicker
        : `${report.kicker} · pillar score ${score}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: report.kind === "executive" ? 14 : 13,
          borderBottom: `1px solid ${INK.hairlineDark}`,
          paddingBottom: report.kind === "executive" ? 26 : 24,
        }}
      >
        <span style={{ ...EYEBROW, color: accent.colour, display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={accent.colour} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }} aria-hidden="true">
            <path d={accent.icon} />
          </svg>
          {eyebrow}
        </span>
        <h1
          style={{
            margin: 0,
            fontSize: report.kind === "executive" ? "clamp(26px,3vw,34px)" : "clamp(24px,2.8vw,31px)",
            fontWeight: 800,
            letterSpacing: "-0.025em",
            lineHeight: report.kind === "executive" ? 1.18 : 1.2,
            color: INK.headingDark,
            textWrap: "pretty",
          }}
        >
          {report.headline}
        </h1>
        <p style={{ ...BODY, fontSize: report.kind === "executive" ? 16 : 15.5, lineHeight: 1.62 }}>
          {report.standfirst}
        </p>
      </div>

      <VerdictCard report={report} pillar={pillar} />

      {report.sections.map((s) => (
        <Section key={s.heading} section={s} ctx={ctx} />
      ))}

      <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
        {/* The Health report's closing paragraphs fell outside the design MCP's
            256 KiB read (see the file header), so its summary is the derived
            projected-score line alone rather than a heading over nothing. */}
        {report.closing.length > 0 ? <h2 style={H2}>Executive Summary</h2> : null}
        {report.closing.map((p) => (
          <p key={p.slice(0, 40)} style={{ ...BODY, margin: "-6px 0", padding: "6px 0" }}>
            {p}
          </p>
        ))}
        {score === null || projected === null ? null : (
          <p style={{ margin: 0, fontSize: 14, fontWeight: 600, lineHeight: 1.6, color: SEVERITY_ON_DARK.healthy, ...TABULAR }}>
            {`Projected pillar score after remediation: ${projected} (+${projected - score}).`}
          </p>
        )}
      </div>

      <p
        style={{
          margin: 0,
          paddingTop: 20,
          borderTop: `1px solid ${INK.hairlineDark}`,
          fontSize: 12.5,
          fontWeight: 500,
          lineHeight: 1.6,
          color: INK.bodyDark,
        }}
      >
        {report.provenance(scannedOn, PREVIEW_SIGNAL_COUNT)}
      </p>
    </div>
  );
}
