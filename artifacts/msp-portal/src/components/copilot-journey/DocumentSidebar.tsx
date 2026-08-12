/**
 * DocumentSidebar.tsx — the Document Viewer's navy rail, and the bottom sheet it
 * becomes on a narrow viewport.
 *
 * Both surfaces render the same switcher, so a document row cannot look or
 * behave differently depending on which one the customer is looking at. Both
 * are dark now that the reading pane is too: the rail is navy (`#0A2540`), the
 * sheet a slightly lighter near-black (`#0f172a`), because it floats over the
 * reading surface rather than sitting beside it — the `"navy" | "light"`
 * surface prop names below is a holdover from when the sheet sat over a light
 * reading pane; it now means "the rail's navy" vs. "the sheet's own dark
 * shade", not literally light.
 *
 * The status dot is Scene 9's pattern verbatim: teal for a report that is ready
 * to read, muted and pulsing on `cj-gen-pulse` for one still generating. No row
 * is ever dead — a generating document still opens and shows its own
 * still-generating state, which is the difference between "not yet" and "broken".
 */

import type { CSSProperties } from "react";
import { useState } from "react";

import { useVersionInfo } from "@/hooks/useVersionInfo";
import {
  BRAND,
  COPILOT_GATE_TARGET,
  INK,
  INK_ON_NAVY,
  MOTION,
  SEVERITY_ON_DARK,
  TABULAR,
  gateLabel,
  hexAlpha,
  reportAccent,
  severityColor,
} from "./journeyTokens.ts";
import type { JourneyDocumentView, JourneyTenant } from "./journeyModel.ts";
import { documentPillar } from "./journeyModel.ts";
import { generationView } from "./revealMath.ts";
import { BrandMark } from "./JourneyPrimitives";

/* ------------------------------------------------------------------ *
 * Rail width — the design's `navWidth` prop.
 * ------------------------------------------------------------------ */
export const NAV_WIDTH_DEFAULT = 268;
export const NAV_WIDTH_MIN = 230;
export const NAV_WIDTH_MAX = 340;

/** Below this the rail collapses entirely and the sheet takes over. */
export const NAV_COLLAPSE_PX = 940;

export function clampNavWidth(px: number): number {
  if (!Number.isFinite(px)) return NAV_WIDTH_DEFAULT;
  return Math.max(NAV_WIDTH_MIN, Math.min(NAV_WIDTH_MAX, Math.round(px)));
}

/**
 * The fills the navy surface draws with — the hairline between sections and the
 * two row states.
 *
 * The *ink* ramp that used to live here has moved to `journeyTokens.INK_ON_NAVY`,
 * which resolves the design's five `color-mix(in oklab, hsl(var(--sidebar-
 * foreground)) N%, var(--brand-navy))` percentages once for the whole journey.
 * What is left here is surface, not text, and it stays local because only this
 * rail paints it.
 */
export const NAVY_SURFACE = {
  /** The hairline the design draws between navy sections. */
  hairline: "rgba(255,255,255,.09)",
  /** Row hover / active fills. */
  hoverFill: "rgba(255,255,255,.06)",
  activeFill: "rgba(255,255,255,.11)",
} as const;

const EYEBROW: CSSProperties = {
  fontSize: 9.5,
  fontWeight: 600,
  letterSpacing: ".2em",
  textTransform: "uppercase",
  color: INK_ON_NAVY.muted,
};

/* ------------------------------------------------------------------ *
 * Row status → dot, meta line
 * ------------------------------------------------------------------ */

interface RowStatus {
  readonly dot: string;
  readonly pulse: boolean;
  readonly meta: string;
}

// Both surfaces are dark now, so the status dot and severity colour are the
// same regardless of which one a row renders in — no surface param needed.
function rowStatus(status: JourneyDocumentView["status"]): RowStatus {
  const idle = "rgba(255,255,255,.34)";
  switch (status) {
    case "ready":
      return { dot: BRAND.teal, pulse: false, meta: "Ready to read" };
    case "failed":
      // The design has no failed state — the platform does, and silently showing
      // it as "generating" forever is the one thing worse than saying so.
      return { dot: SEVERITY_ON_DARK.critical, pulse: false, meta: "Generation failed" };
    case "pending":
      return { dot: idle, pulse: true, meta: "Queued" };
    default:
      return { dot: idle, pulse: true, meta: "Generating" };
  }
}

/* ------------------------------------------------------------------ *
 * One switcher row
 * ------------------------------------------------------------------ */

/**
 * How far through this report the customer has read, as the design's own
 * two-part strip: a filled bar and a label.
 *
 * Only drawn once they have actually moved — a bar sitting at 0% on every
 * unopened report is noise, and a "0% read" label states something the row's
 * own status already says better.
 */
function ReadProgress({ progress, accent }: { progress: number; accent: string }) {
  if (progress <= 0.01) return null;
  const done = progress >= 0.98;
  const colour = done ? BRAND.teal : accent;
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 3 }}>
      <span
        aria-hidden="true"
        style={{
          flex: "1 1 auto",
          height: 2,
          borderRadius: 2,
          background: "rgba(255,255,255,.12)",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            display: "block",
            height: "100%",
            borderRadius: 2,
            background: colour,
            transition: "width 300ms ease",
            width: `${Math.round(progress * 100)}%`,
          }}
        />
      </span>
      <span
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: ".1em",
          textTransform: "uppercase",
          color: colour,
          whiteSpace: "nowrap",
          flex: "none",
        }}
      >
        {done ? "Read" : `${Math.round(progress * 100)}%`}
      </span>
    </span>
  );
}

function SwitcherRow({
  doc,
  index,
  active,
  surface,
  reduceMotion,
  progress,
  onSelect,
}: {
  doc: JourneyDocumentView;
  index: number;
  active: boolean;
  surface: "navy" | "light";
  reduceMotion: boolean;
  /** 0–1 of this report scrolled, or 0 for one never opened. */
  progress: number;
  onSelect: (index: number) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const status = rowStatus(doc.status);
  const navy = surface === "navy";
  const accent = reportAccent(documentPillar(doc));

  // The sheet's own active fill reads one shade lighter than the rail's
  // (`.07` vs `.11`) — the design's own two constants, not a derived value.
  const background = active
    ? navy
      ? NAVY_SURFACE.activeFill
      : "rgba(255,255,255,.07)"
    : hovered && navy
      ? NAVY_SURFACE.hoverFill
      : "transparent";

  return (
    <button
      type="button"
      data-testid={`document-row-${index}`}
      onClick={() => onSelect(index)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-current={active ? "page" : undefined}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        width: "100%",
        textAlign: "left",
        padding: navy ? "10px 11px 10px 9px" : "12px 10px",
        border: 0,
        borderRadius: 7,
        cursor: "pointer",
        background,
        transition: "background 160ms",
        fontFamily: "inherit",
      }}
    >
      {/* The report's own pillar colour, full-height — it is what makes the rail
          readable as six subjects rather than eight similar titles, and it is
          the same accent the reading card's top band carries. */}
      <span
        aria-hidden="true"
        style={{
          width: 2,
          alignSelf: "stretch",
          borderRadius: 2,
          flex: "none",
          background: accent.colour,
          opacity: active ? 1 : 0.42,
        }}
      />
      <span aria-hidden="true" style={{ marginTop: 2, opacity: active ? 1 : 0.62, flex: "none" }}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke={active ? accent.colour : INK_ON_NAVY.strong}
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={accent.icon} />
        </svg>
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: "1 1 auto" }}>
        <span
          style={{
            fontSize: navy ? 12.5 : 13.5,
            fontWeight: active ? 700 : 500,
            lineHeight: 1.35,
            // The rail varies title colour by active state (white vs. muted);
            // the sheet's own row template does not — every title in it is the
            // same heading colour regardless of which one is selected.
            color: navy ? (active ? BRAND.white : INK_ON_NAVY.strong) : INK.headingDark,
          }}
        >
          {doc.title}
        </span>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: navy ? 10 : 10.5,
            fontWeight: 500,
            color: navy ? INK_ON_NAVY.muted : INK.bodyDark,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 5,
              height: 5,
              borderRadius: "50%",
              flex: "none",
              background: status.dot,
              animation:
                status.pulse && !reduceMotion
                  ? `cj-gen-pulse ${MOTION.genPulseMs}ms ease-in-out infinite`
                  : "none",
            }}
          />
          {status.meta}
        </span>
        <ReadProgress progress={progress} accent={accent.colour} />
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * The Copilot Gate block
 * ------------------------------------------------------------------ */

/**
 * The rail's headline: the tenant's score against the gate it has to clear.
 *
 * Drawn only when there IS a score. A tenant whose scan produced no covered
 * indicator gets the identity line alone rather than a red 0 out of 100, which
 * would be a verdict nothing measured.
 */
function GateBlock({ tenant, score }: { tenant: JourneyTenant; score: number | null }) {
  const identity =
    tenant.scannedOn === null ? tenant.name : `${tenant.name} · assessed ${tenant.scannedOn}`;

  if (score === null) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={EYEBROW}>Assessed tenant</span>
        <span style={{ fontSize: 14, fontWeight: 600, color: BRAND.white }}>{identity}</span>
      </div>
    );
  }

  const colour = severityColor(score);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={EYEBROW}>Copilot Gate</span>
      <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
        <span
          style={{ fontSize: 38, fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1, color: colour, ...TABULAR }}
        >
          {score}
        </span>
        <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: INK_ON_NAVY.faint }}>/ 100</span>
          <span
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: ".1em",
              textTransform: "uppercase",
              color: colour,
              whiteSpace: "nowrap",
            }}
          >
            {`${COPILOT_GATE_TARGET} is safe to deploy`}
          </span>
        </span>
      </div>
      <span
        style={{
          display: "inline-flex",
          alignSelf: "flex-start",
          alignItems: "center",
          gap: 6,
          padding: "3px 9px",
          borderRadius: 999,
          border: `1px solid ${hexAlpha(colour, 0.35)}`,
          background: hexAlpha(colour, 0.1),
        }}
      >
        <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: "50%", background: colour, flex: "none" }} />
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: ".14em",
            textTransform: "uppercase",
            color: colour,
          }}
        >
          {gateLabel(score)}
        </span>
      </span>
      <span style={{ fontSize: 11.5, fontWeight: 500, color: INK_ON_NAVY.muted, paddingTop: 2 }}>{identity}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * The "N of N ready" counter + progress bar
 * ------------------------------------------------------------------ */

/**
 * Whether the counter can honestly be drawn at all.
 *
 * `generationView()` reports `known: false` when the platform has not told us
 * what this tenant's document set is — a failed status fetch, or a tenant with
 * no assessment service. A counter and a progress bar are a claim that a
 * generation run is under way, so in that case the whole block is omitted
 * rather than rendered at "0 of 0". Before the payload lands the block still
 * shows, holding an em dash, because "we are still asking" is true.
 *
 * Unlike `DocumentBody`'s per-document gate (#409, #416, generalised in #343),
 * this needs no new-pattern exemption and gets none: `total` is
 * `documents.length` — the size of the whole expected/generated set — so it is
 * only ever 0 when NO document, old-pattern or new, is known at all. Any
 * resolvable live-rendered report already makes `total >= 1` and this counter
 * true, on its own, with no special-casing. That is why this rail is untouched
 * by the #343 registry: it is already general, and registering another document
 * in `JOURNEY_LIVE_DOCUMENTS` changes nothing here but the count it draws.
 *
 * Since #424 that is not a hypothetical: the viewer builds its list through
 * `withLiveDocuments`, so every live-rendered report is one of the rows
 * this rail draws and `total` is never 0 on a landed payload. The counter and
 * the rows therefore agree by construction — which is also why the page passes
 * that list's own `ready`/`total` here rather than the status payload's.
 */
export function showReadyCounter(loaded: boolean, total: number): boolean {
  return !loaded || generationView(0, total).known;
}

function ReadyCounter({
  ready,
  total,
  loaded,
  surface,
}: {
  ready: number;
  total: number;
  loaded: boolean;
  surface: "navy" | "light";
}) {
  const gen = generationView(ready, total);
  const navy = surface === "navy";
  if (loaded && !gen.known) return null;
  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <span style={navy ? EYEBROW : { ...EYEBROW, color: INK.micro }}>Your findings</span>
        <span
          data-testid="documents-ready-counter"
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            // Teal on both surfaces now — the sheet's own counter matches the
            // rail's, not the old light theme's blue.
            color: BRAND.teal,
            ...TABULAR,
          }}
        >
          {/* An em dash until the status payload has actually landed — a count
              the platform has not confirmed is a claim, not a placeholder. */}
          {loaded ? gen.status : "—"}
        </span>
      </div>
      <div
        style={{
          height: 3,
          background: "rgba(255,255,255,.12)",
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            borderRadius: 999,
            background: `linear-gradient(90deg,${BRAND.blue},${BRAND.teal})`,
            transition: "width 500ms ease",
            width: loaded ? gen.pct : "0%",
          }}
        />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * The rail
 * ------------------------------------------------------------------ */

export interface DocumentSwitcherProps {
  readonly documents: readonly JourneyDocumentView[];
  readonly ready: number;
  readonly total: number;
  /** False until the generation payload has arrived, so the counter can say so. */
  readonly loaded: boolean;
  readonly activeIndex: number;
  readonly onSelect: (index: number) => void;
  readonly reduceMotion: boolean;
  /** 0–1 of each report scrolled, keyed by title. Absent means never opened. */
  readonly readProgress: Readonly<Record<string, number>>;
}

export function DocumentSidebar({
  width = NAV_WIDTH_DEFAULT,
  tenant,
  score,
  documents,
  ready,
  total,
  loaded,
  activeIndex,
  onSelect,
  reduceMotion,
  readProgress,
}: DocumentSwitcherProps & {
  /** The design's `navWidth` prop — 268 by default, clamped to 230–340. */
  readonly width?: number;
  readonly tenant: JourneyTenant;
  /** The readiness score behind the gate block, or null if nothing scored it. */
  readonly score: number | null;
}) {
  const versionInfo = useVersionInfo();
  return (
    <nav
      aria-label="Your assessment reports"
      style={{
        width: clampNavWidth(width),
        flex: "none",
        background: BRAND.navy,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "22px 22px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
          borderBottom: `1px solid ${NAVY_SURFACE.hairline}`,
        }}
      >
        <BrandMark wordmark="Shane McCaw Consulting" />
        <GateBlock tenant={tenant} score={score} />
      </div>

      {showReadyCounter(loaded, total) ? (
        <div
          style={{
            padding: "18px 22px",
            display: "flex",
            flexDirection: "column",
            gap: 9,
            borderBottom: `1px solid ${NAVY_SURFACE.hairline}`,
          }}
        >
          <ReadyCounter ready={ready} total={total} loaded={loaded} surface="navy" />
        </div>
      ) : null}

      <div
        style={{
          flex: "1 1 auto",
          overflowY: "auto",
          padding: "14px 12px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        {documents.map((doc, i) => (
          <SwitcherRow
            key={`${doc.title}-${i}`}
            doc={doc}
            index={i}
            active={i === activeIndex}
            surface="navy"
            reduceMotion={reduceMotion}
            progress={readProgress[doc.title] ?? 0}
            onSelect={onSelect}
          />
        ))}
      </div>

      <div style={{ padding: "16px 22px 20px", borderTop: `1px solid ${NAVY_SURFACE.hairline}` }}>
        <p style={{ margin: 0, fontSize: 10.5, fontWeight: 500, lineHeight: 1.55, color: INK_ON_NAVY.muted }}>
          Assessed against the M365 governance framework Shane McCaw wrote at NASA and distributed
          agency-wide.
        </p>
        <p style={{ margin: "8px 0 0", fontSize: 9.5, fontWeight: 500, color: INK_ON_NAVY.faint }}>
          v{versionInfo.display}
        </p>
      </div>
    </nav>
  );
}

/* ------------------------------------------------------------------ *
 * The bottom sheet — what the rail becomes below 940px
 * ------------------------------------------------------------------ */

export function DocumentSheet({
  documents,
  ready,
  total,
  loaded,
  activeIndex,
  onSelect,
  onDismiss,
  reduceMotion,
  readProgress,
}: DocumentSwitcherProps & { readonly onDismiss: () => void }) {
  return (
    <div
      onClick={onDismiss}
      role="presentation"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 40,
        background: "rgba(10,37,64,.45)",
        display: "flex",
        alignItems: "flex-end",
      }}
    >
      {/* The sheet itself swallows the click so choosing a document is the only
          thing that closes it from the inside. */}
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Your assessment reports"
        style={{
          width: "100%",
          maxHeight: "76vh",
          overflowY: "auto",
          background: "#0f172a",
          borderRadius: "14px 14px 0 0",
          padding: "18px 16px 26px",
        }}
      >
        {showReadyCounter(loaded, total) ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 9,
              padding: "0 6px 14px",
              borderBottom: `1px solid ${INK.hairlineDark}`,
            }}
          >
            <ReadyCounter ready={ready} total={total} loaded={loaded} surface="light" />
          </div>
        ) : null}
        <div style={{ display: "flex", flexDirection: "column", gap: 2, paddingTop: 8 }}>
          {documents.map((doc, i) => (
            <SwitcherRow
              key={`${doc.title}-${i}`}
              doc={doc}
              index={i}
              active={i === activeIndex}
              surface="light"
              reduceMotion={reduceMotion}
              progress={readProgress[doc.title] ?? 0}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
