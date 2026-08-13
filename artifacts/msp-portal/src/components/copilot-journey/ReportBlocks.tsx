/**
 * ReportBlocks.tsx — the ordered-block report renderer, shared by the design
 * preview and the real Copilot Readiness report.
 *
 * WHY IT WAS EXTRACTED (#409)
 * ---------------------------
 * `PreviewReportBody.tsx` owned this loop, and it is exactly the loop the real
 * report needs: a section is a heading plus an ordered `blocks` list, and the
 * renderer draws whatever it finds in whatever order the author put it. The
 * real report renders the SAME shapes from real data — a keyValues table of a
 * tenant's own numbers has to look like a keyValues table of the design's, or
 * the two are visibly different products.
 *
 * The alternative was a second copy of these five block renderers, which would
 * have drifted the first time either side gained a shape. So the loop moved
 * here VERBATIM — same JSX, same styles, same keys — and both sides call it.
 *
 * THE ONE THING THAT IS PARAMETERISED: FIGURES
 * ---------------------------------------------
 * A `figure` block names WHICH visual belongs at that point, never its data.
 * The preview resolves those names against `PREVIEW_FIGURES` and the fixture;
 * the real report resolves them against the tenant's own payload. So the caller
 * passes a `renderFigure` and nothing else about the two paths differs. That
 * boundary is deliberate: it is the only place a fixture number could reach a
 * real customer's report, and it is a function the real path never supplies.
 */

import { Fragment } from "react";

import { BRAND, INK, SEVERITY_ON_DARK } from "./journeyTokens.ts";
import type { ReportBlock, ReportFigure, ReportSection } from "./previewDocumentBodies.ts";

export const H2: React.CSSProperties = {
  margin: 0,
  fontSize: 18,
  fontWeight: 700,
  letterSpacing: "-0.015em",
  color: INK.headingDark,
};

export const BODY: React.CSSProperties = {
  margin: 0,
  fontSize: 15,
  fontWeight: 500,
  lineHeight: 1.65,
  color: INK.bodyDarkStrong,
  textWrap: "pretty",
};

export const EYEBROW: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: ".22em",
  textTransform: "uppercase",
};

/**
 * The bullet dot on a self-resolution list. Deliberately one fixed blue across
 * all reports rather than the report's own accent — these are actions the
 * customer can take today, and colouring them per pillar would read as another
 * severity axis.
 */
const BULLET_DOT = "#3B82F6";

/** Resolves a figure NAME to a rendered visual. The only per-report difference. */
export type FigureRenderer = (figure: ReportFigure) => React.ReactNode;

export function Block({
  block,
  renderFigure,
}: {
  readonly block: ReportBlock;
  readonly renderFigure: FigureRenderer;
}) {
  if (block.kind === "figure") return <>{renderFigure(block.figure)}</>;

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

export function Section({
  section,
  renderFigure,
}: {
  readonly section: ReportSection;
  readonly renderFigure: FigureRenderer;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      <h2 style={H2}>{section.heading}</h2>
      {section.blocks.map((b, i) => (
        <Fragment key={`${section.heading}-${i}`}>
          <Block block={b} renderFigure={renderFigure} />
        </Fragment>
      ))}
    </div>
  );
}
