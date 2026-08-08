/**
 * LiveReportShell.tsx — the chrome and the three extra block kinds every
 * live-rendered report shares (#409, extracted in #343).
 *
 * WHAT IS SHARED, AND WHY IT HAS TO BE
 * ------------------------------------
 * The header, the verdict card, the section loop, the closing block and the
 * provenance line. A report of a customer's real numbers has to look like the
 * report the design signed off — not a second-class variant of it — and two
 * reports that render the same structure from two copies of the same JSX drift
 * apart one padding value at a time. So the chrome is one component and each
 * report supplies its own content.
 *
 * The three block kinds below (`narrative`, `unavailable`, `upgradeOpportunity`)
 * are the ones `ReportBlocks.tsx` does not know about, because the design's own
 * fixtures can never produce them — they exist only where real data can be
 * absent. Everything else delegates to `ReportBlocks.tsx`, so a `keyValues` row
 * looks identical whichever report drew it.
 *
 * WHAT IS NOT SHARED
 * ------------------
 * The figures. Each report resolves figure names against its own data — the
 * preview path against `PREVIEW_FIGURES`, a live report against the tenant's own
 * `JourneyView` — and that boundary is the only route by which a fixture number
 * could reach a real customer's report. This file imports neither.
 */

import { Loader2 } from "lucide-react";

import { INK, PILLARS, SEVERITY_ON_DARK, hexAlpha, reportAccent } from "./journeyTokens.ts";
import { BODY, Block, EYEBROW, H2, type FigureRenderer } from "./ReportBlocks";
import {
  checkDomainLabel,
  unavailableReasonText,
  type LiveReportBlock,
  type LiveReportSection,
  type LiveReportVerdict,
  type UpgradeOpportunity,
  type UpgradeOpportunityCallToAction,
  type VerdictSeverity,
} from "./liveReportBlocks.ts";

/**
 * The verdict card's colour, keyed by real severity rather than pillar
 * identity (#575). `unmeasured` — a pillar the scan never evaluated — takes a
 * neutral slate rather than any of the three severity colours, since nothing
 * has been claimed either way yet.
 */
const VERDICT_COLOUR: Readonly<Record<VerdictSeverity, string>> = {
  critical: SEVERITY_ON_DARK.critical,
  attention: SEVERITY_ON_DARK.attention,
  healthy: SEVERITY_ON_DARK.healthy,
  unmeasured: INK.bodyDark,
};

/** Built the same way `journeyTokens.ts`'s own `PILLAR_GLOWS` are — closest-side, fading to nothing. */
function verdictGlow(colour: string): string {
  return `radial-gradient(closest-side, ${hexAlpha(colour, 0.3)}, rgba(2,6,23,0) 100%)`;
}

/* ------------------------------------------------------------------ *
 * The three blocks the shared renderer does not know about
 * ------------------------------------------------------------------ */

/**
 * One AI-written section.
 *
 * The HTML is sanitised server-side by the same `sanitizeNarrativeHtml` every
 * sibling Anthropic call site uses (script/style/iframe/on* stripped), and it
 * is model output constrained to p/strong/em/ul/li — never customer- or
 * user-authored input. `.cj-doc-body` carries the reading measure and rhythm,
 * the same class `LiveBody` uses for platform-generated document HTML.
 */
export function NarrativeBlock({ html }: { readonly html: string }) {
  return <div className="cj-doc-body" dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * The honest empty state. Deliberately styled as a quiet note, NOT as a finding
 * row: an uncollected check is a gap in coverage, and colouring it with a
 * severity would turn our own missing data into a verdict about the tenant.
 *
 * `checks` may be empty — a gap the platform cannot name a check key for at all
 * is still declared, in `detail`'s own words, rather than silently dropped
 * (#343's Conditional Access gap is the case that forced it).
 */
export function UnavailableBlock({
  detail,
  checks,
}: {
  readonly detail: string;
  readonly checks: readonly { readonly checkKey: string; readonly reason: string }[];
}) {
  return (
    <div
      style={{
        border: `1px dashed ${INK.hairlineDark}`,
        borderRadius: 10,
        padding: "13px 15px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <p style={{ ...BODY, fontSize: 13.5, lineHeight: 1.6, color: INK.bodyDark }}>{detail}</p>
      {checks.length > 0 ? (
        <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
          {checks.map((c) => (
            <li key={`${c.checkKey}:${c.reason}`} style={{ fontSize: 12.5, fontWeight: 500, lineHeight: 1.5, color: INK.micro }}>
              <code style={{ fontFamily: "ui-monospace, monospace", color: INK.bodyDark }}>{checkDomainLabel(c.checkKey)}</code>
              {` — ${unavailableReasonText(c.reason)}`}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * The Upgrade Opportunity category (#451).
 *
 * ── WHY IT LOOKS LIKE THIS AND NOT LIKE ANYTHING ELSE IN THE REPORT ──────────
 * It has to be unmistakably not a finding. Three things separate it:
 *
 *   • Colour. The Licensing pillar's own teal (`PILLARS.licensing.primary`),
 *     because that is what this is — a licensing fact. Never `severityColor()`:
 *     red or amber here would read as risk, and "you are not licensed to
 *     measure X" is not a risk finding, it is an unmeasured quantity. The
 *     pillar identity colours exist precisely to say *what a thing is* while
 *     severity says *how bad it is*, and this row asserts the first only.
 *   • Shape. A solid 3px left rule and a filled tint, against the
 *     `UnavailableBlock`'s dashed hairline and the `keyValues` rows' plain
 *     table. A reader scanning the page can tell the three apart without
 *     reading a word of any of them.
 *   • A named eyebrow, so the category announces itself rather than relying on
 *     the section heading two lines up.
 */
export function UpgradeOpportunityBlock({
  detail,
  items,
  callToAction,
}: {
  readonly detail: string;
  readonly items: readonly UpgradeOpportunity[];
  readonly callToAction?: UpgradeOpportunityCallToAction | null;
}) {
  const teal = PILLARS.licensing.primary;
  return (
    <div
      style={{
        borderLeft: `3px solid ${teal}`,
        borderTop: `1px solid ${hexAlpha(teal, 0.22)}`,
        borderRight: `1px solid ${hexAlpha(teal, 0.22)}`,
        borderBottom: `1px solid ${hexAlpha(teal, 0.22)}`,
        borderRadius: 10,
        background: hexAlpha(teal, 0.06),
        padding: "15px 17px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <span style={{ ...EYEBROW, color: teal }}>Upgrade opportunity</span>
      <p style={{ ...BODY, fontSize: 13.5, lineHeight: 1.6, color: INK.bodyDarkStrong }}>{detail}</p>
      <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 11 }}>
        {items.map((item) => (
          <li
            key={item.checkKey}
            style={{ display: "flex", flexDirection: "column", gap: 3, paddingTop: 11, borderTop: `1px solid ${hexAlpha(teal, 0.16)}` }}
          >
            <code style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: teal }}>
              {checkDomainLabel(item.checkKey)}
            </code>
            <p style={{ ...BODY, fontSize: 13.5, lineHeight: 1.6, color: INK.bodyDark }}>
              {item.disclosure}
            </p>
            {/* The add-on that answers THIS check, at tier 1/2 only. Absent at
                tier 3, where one E7 link on the block replaces all three. */}
            {item.link ? (
              <a
                href={item.link.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{ ...BODY, fontSize: 13, fontWeight: 600, color: teal, textDecoration: "underline" }}
              >
                {item.link.skuName}
              </a>
            ) : null}
          </li>
        ))}
      </ul>
      {callToAction ? <UpgradeCallToAction accent={teal} callToAction={callToAction} /> : null}
    </div>
  );
}

/**
 * The block's closing recommendation (#489).
 *
 * Set apart from the rows by a full-width rule rather than another tinted
 * panel: the rows are observations and this is the one thing being asked of the
 * reader, and a reader who has scrolled six disclosures should be able to find
 * it without reading them again.
 *
 * Every link opens in a new tab with `rel="noopener noreferrer"` — these are
 * outbound links to microsoft.com from a page the customer is signed into, and
 * a bare `target="_blank"` hands the opener reference to the destination.
 */
function UpgradeCallToAction({
  accent,
  callToAction,
}: {
  readonly accent: string;
  readonly callToAction: UpgradeOpportunityCallToAction;
}) {
  return (
    <div
      style={{
        borderTop: `1px solid ${hexAlpha(accent, 0.28)}`,
        paddingTop: 12,
        display: "flex",
        flexDirection: "column",
        gap: 9,
      }}
    >
      <p style={{ ...BODY, fontSize: 13.5, lineHeight: 1.6, color: INK.bodyDarkStrong }}>
        {callToAction.text}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 9 }}>
        {callToAction.links.map((link) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              ...BODY,
              fontSize: 13,
              fontWeight: 600,
              color: accent,
              border: `1px solid ${hexAlpha(accent, 0.45)}`,
              borderRadius: 7,
              padding: "6px 12px",
              textDecoration: "none",
            }}
          >
            {link.skuName}
          </a>
        ))}
      </div>
    </div>
  );
}

/**
 * A prose section whose fetch has not settled. A spinner, not a blank: the
 * pure-data sections around it are already on screen, so an unexplained gap
 * between them would read as a section that has nothing to say.
 */
export function NarrativePending({ heading }: { readonly heading: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 0", color: INK.micro }}>
      <Loader2 className="size-4 animate-spin" />
      <span style={{ fontSize: 13.5, fontWeight: 500 }}>{`Writing ${heading.toLowerCase()} from your scan…`}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The shell
 * ------------------------------------------------------------------ */

export interface LiveReportShellProps {
  readonly kicker: string;
  readonly headline: string;
  readonly standfirst: string;
  readonly verdict: LiveReportVerdict;
  readonly sections: readonly LiveReportSection[];
  readonly closing: readonly string[];
  readonly provenance: string;
  /** Appended to the kicker only when the platform actually has a scan date. */
  readonly scannedOn: string | null;
  /**
   * The pillar whose identity colour bands this report, or null for a roll-up
   * that belongs to no single pillar (which takes the journey's own blue→teal).
   */
  readonly accentPillar: Parameters<typeof reportAccent>[0];
  /** The heading over the closing paragraphs. Each report names its own. */
  readonly closingHeading: string;
  readonly renderFigure: FigureRenderer;
}

export function LiveReportShell({
  kicker,
  headline,
  standfirst,
  verdict,
  sections,
  closing,
  provenance,
  scannedOn,
  accentPillar,
  closingHeading,
  renderFigure,
}: LiveReportShellProps) {
  const accent = reportAccent(accentPillar);

  const renderBlock = (block: LiveReportBlock, key: string) => {
    if (block.kind === "narrative") return <NarrativeBlock key={key} html={block.html} />;
    if (block.kind === "unavailable") {
      return <UnavailableBlock key={key} detail={block.detail} checks={block.checks} />;
    }
    if (block.kind === "upgradeOpportunity") {
      return (
        <UpgradeOpportunityBlock
          key={key}
          detail={block.detail}
          items={block.items}
          callToAction={block.callToAction}
        />
      );
    }
    // Everything else is the shared vocabulary — one renderer, one appearance.
    // `Block` directly rather than `Section`, because the heading is drawn by
    // `renderSection` below; wrapping each block in its own Section would emit
    // an empty <h2> before every one of them.
    return <Block key={key} block={block} renderFigure={renderFigure} />;
  };

  const renderSection = (section: LiveReportSection) => (
    <div key={section.heading} style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      <h2 style={H2}>{section.heading}</h2>
      {section.blocks.length === 0 ? (
        <NarrativePending heading={section.heading} />
      ) : (
        section.blocks.map((b, i) => renderBlock(b, `${section.heading}-${i}`))
      )}
    </div>
  );

  const verdictColour = VERDICT_COLOUR[verdict.severity];

  return (
    // The pillar's persistent identity cue (#575 Part B). The verdict card
    // below carries zero pillar colour now — it exists to say how bad things
    // are, not which pillar it is — so the document needs its own, more
    // prominent home for "which pillar am I reading": a wash that reads as
    // this pillar's colour no matter how far down the page you have scrolled
    // (not just a fade at the top, which is what this replaces) and a bold
    // border around the whole thing. Same `accent.colour` source the verdict
    // card used to borrow.
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        border: `2px solid ${hexAlpha(accent.colour, 0.45)}`,
        borderRadius: 14,
        padding: "20px 22px",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          // Never fully fades: `.05` alpha at 100% height keeps the pillar's
          // colour legible at the bottom of even a long report, with a
          // stronger tint near the top for depth.
          background: `linear-gradient(180deg,${hexAlpha(accent.colour, 0.16)} 0%,${hexAlpha(accent.colour, 0.05)} 42%,${hexAlpha(accent.colour, 0.05)} 100%)`,
          pointerEvents: "none",
        }}
      />
      <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 24 }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 14,
            borderBottom: `1px solid ${INK.hairlineDark}`,
            paddingBottom: 26,
          }}
        >
          <span style={{ ...EYEBROW, color: accent.colour, display: "flex", alignItems: "center", gap: 8 }}>
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke={accent.colour}
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flex: "none" }}
              aria-hidden="true"
            >
              <path d={accent.icon} />
            </svg>
            {/* The scan date is appended only when the platform has one — the
                preview's eyebrow always has a fixture date to show; a real tenant
                that has never completed a scan does not. */}
            {scannedOn ? `${kicker} · ${scannedOn}` : kicker}
          </span>
          <h1
            style={{
              margin: 0,
              fontSize: "clamp(26px,3vw,34px)",
              fontWeight: 800,
              letterSpacing: "-0.025em",
              lineHeight: 1.18,
              color: INK.headingDark,
              textWrap: "pretty",
            }}
          >
            {headline}
          </h1>
          <p style={{ ...BODY, fontSize: 16, lineHeight: 1.62 }}>{standfirst}</p>
        </div>

        {/* The verdict card (#575 Part A). Coloured entirely off real severity
            — critical/warning findings, or a genuinely clean scored result —
            never off the pillar's own brand colour, which carries no severity
            meaning at all. A calm pillar colour used to be able to sit around a
            critical result; it no longer can, because the pillar colour has
            been removed from this card completely. */}
        <div
          style={{
            position: "relative",
            overflow: "hidden",
            border: `1px solid ${hexAlpha(verdictColour, 0.33)}`,
            borderRadius: 12,
            background: `linear-gradient(135deg,${hexAlpha(verdictColour, 0.1)},rgba(2,6,23,.45))`,
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
              background: verdictGlow(verdictColour),
              pointerEvents: "none",
            }}
          />
          <span
            style={{
              position: "relative",
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: ".2em",
              textTransform: "uppercase",
              color: verdictColour,
            }}
          >
            {verdict.eyebrow}
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
            {verdict.headline}
          </span>
          <span style={{ position: "relative", fontSize: 14.5, fontWeight: 500, lineHeight: 1.55, color: INK.bodyDarkStrong }}>
            {verdict.sub}
          </span>
        </div>

        {sections.map(renderSection)}

        <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
          <h2 style={H2}>{closingHeading}</h2>
          {closing.map((p) => (
            <p key={p.slice(0, 40)} style={{ ...BODY, margin: "-6px 0", padding: "6px 0" }}>
              {p}
            </p>
          ))}
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
          {provenance}
        </p>
      </div>
    </div>
  );
}
