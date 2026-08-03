/**
 * DocumentSidebar.tsx — the Document Viewer's navy rail, and the bottom sheet it
 * becomes on a narrow viewport.
 *
 * Both surfaces render the same switcher, so a document row cannot look or
 * behave differently depending on which one the customer is looking at. The rail
 * is navy (`#0A2540`) against the light reading canvas; the sheet is white,
 * because it sits over the reading surface rather than beside it.
 *
 * The status dot is Scene 9's pattern verbatim: teal for a report that is ready
 * to read, muted and pulsing on `cj-gen-pulse` for one still generating. No row
 * is ever dead — a generating document still opens and shows its own
 * still-generating state, which is the difference between "not yet" and "broken".
 */

import type { CSSProperties } from "react";
import { useState } from "react";

import {
  BRAND,
  INK_ON_NAVY,
  MOTION,
  SEVERITY_ON_DARK,
  SEVERITY_ON_LIGHT,
  TABULAR,
} from "./journeyTokens.ts";
import type { JourneyDocumentView } from "./journeyModel.ts";
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
 * rail and the ShaneBot panel paint it.
 *
 * Shared with `ShaneBotDock`, whose panel and pill are the same navy surface.
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

function rowStatus(status: JourneyDocumentView["status"], surface: "navy" | "light"): RowStatus {
  const severity = surface === "navy" ? SEVERITY_ON_DARK : SEVERITY_ON_LIGHT;
  const idle = surface === "navy" ? "rgba(255,255,255,.34)" : "#c7d0da";
  switch (status) {
    case "ready":
      return { dot: BRAND.teal, pulse: false, meta: "Ready to read" };
    case "failed":
      // The design has no failed state — the platform does, and silently showing
      // it as "generating" forever is the one thing worse than saying so.
      return { dot: severity.critical, pulse: false, meta: "Generation failed" };
    case "pending":
      return { dot: idle, pulse: true, meta: "Queued" };
    default:
      return { dot: idle, pulse: true, meta: "Generating" };
  }
}

/* ------------------------------------------------------------------ *
 * One switcher row
 * ------------------------------------------------------------------ */

function SwitcherRow({
  doc,
  index,
  active,
  surface,
  reduceMotion,
  onSelect,
}: {
  doc: JourneyDocumentView;
  index: number;
  active: boolean;
  surface: "navy" | "light";
  reduceMotion: boolean;
  onSelect: (index: number) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const status = rowStatus(doc.status, surface);
  const navy = surface === "navy";

  const background = active
    ? navy
      ? NAVY_SURFACE.activeFill
      : BRAND.offWhite
    : hovered && navy
      ? NAVY_SURFACE.hoverFill
      : "transparent";

  return (
    <button
      type="button"
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
        padding: navy ? "10px 11px" : "12px 10px",
        border: 0,
        borderRadius: 7,
        cursor: "pointer",
        background,
        transition: "background 160ms",
        fontFamily: "inherit",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          marginTop: navy ? 6 : 7,
          flex: "none",
          background: status.dot,
          animation:
            status.pulse && !reduceMotion
              ? `cj-gen-pulse ${MOTION.genPulseMs}ms ease-in-out infinite`
              : "none",
        }}
      />
      <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span
          style={{
            fontSize: navy ? 12.5 : 13.5,
            fontWeight: active ? 700 : 500,
            lineHeight: 1.35,
            color: navy ? (active ? BRAND.white : INK_ON_NAVY.strong) : BRAND.navy,
          }}
        >
          {doc.title}
        </span>
        <span
          style={{
            fontSize: navy ? 10 : 10.5,
            fontWeight: 500,
            color: navy ? INK_ON_NAVY.muted : "#64748b",
          }}
        >
          {status.meta}
        </span>
      </span>
    </button>
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
        <span style={navy ? EYEBROW : { ...EYEBROW, color: "#64748b" }}>Your findings</span>
        <span
          style={{
            fontSize: 11.5,
            fontWeight: 700,
            color: navy ? BRAND.teal : BRAND.blue,
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
          background: navy ? "rgba(255,255,255,.12)" : "#e7ebf0",
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
}

export function DocumentSidebar({
  width = NAV_WIDTH_DEFAULT,
  tenantLine,
  documents,
  ready,
  total,
  loaded,
  activeIndex,
  onSelect,
  reduceMotion,
}: DocumentSwitcherProps & {
  /** The design's `navWidth` prop — 268 by default, clamped to 230–340. */
  readonly width?: number;
  /** "Halden Materials · 1,240 seats", already formatted by `tenantStrip()`. */
  readonly tenantLine: string;
}) {
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
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <span style={EYEBROW}>Assessed tenant</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: BRAND.white }}>{tenantLine}</span>
        </div>
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
            onSelect={onSelect}
          />
        ))}
      </div>

      <div style={{ padding: "16px 22px 20px", borderTop: `1px solid ${NAVY_SURFACE.hairline}` }}>
        <p style={{ margin: 0, fontSize: 10.5, fontWeight: 500, lineHeight: 1.55, color: INK_ON_NAVY.muted }}>
          Assessed against the M365 governance framework Shane McCaw wrote at NASA and distributed
          agency-wide.
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
          background: BRAND.white,
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
              borderBottom: "1px solid #e7ebf0",
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
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
