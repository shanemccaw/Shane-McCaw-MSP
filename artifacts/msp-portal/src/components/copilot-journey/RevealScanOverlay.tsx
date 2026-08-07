/**
 * RevealScanOverlay.tsx — Scene 0. The live tenant scan.
 *
 * A full-bleed overlay on `#020617` that owns the viewport for the 1–2 minutes
 * the real diagnostics run takes, then gets out of the way the instant it
 * finishes. It is the first half of the handoff's two-phase wait: the reveal
 * fires when the SCAN completes and is never gated on document GENERATION,
 * which runs for minutes afterwards behind Scene 9.
 *
 * SCROLL LOCK
 * -----------
 * The overlay sets `document.body.style.overflow = "hidden"` while it is open
 * and restores the *previous* value both when the scan completes and on unmount.
 * A component that leaves the body locked has broken the whole app, not just
 * this page, so the restore is in the effect's cleanup rather than in a
 * completion handler that a failed run could skip.
 *
 * WHAT DRIVES THE WEDGES — read this before "fixing" the fill maths
 * ----------------------------------------------------------------
 * The handoff wants each wedge driven by that pillar's own completion count,
 * with several pillars in flight at once. `useCopilotJourney()` exposes only the
 * run-wide counters (`progress` / `checksDone` / `checksTotal`) — grouping the
 * scan plan by pillar is left client-side and no per-pillar mapping reaches this
 * component — so each wedge is derived from overall progress with the design's
 * own per-pillar stagger. It is a plausible fill order, NOT per-pillar truth.
 * See `wedgeFill()` below.
 */

import { useEffect, useState } from "react";

import type { JourneyPillarView } from "./journeyModel.ts";
import { BRAND, INK, PILLARS, PILLAR_KEYS, TABULAR } from "./journeyTokens.ts";
import {
  RADAR_INNER_R,
  RADAR_OUTER_R,
  clampWindow,
  polar,
  radarChipOpacity,
  radarStageScale,
  radarWedgeBackdropPath,
  radarWedgeOpacity,
  radarWedgePath,
} from "./revealMath.ts";
import { FindingChip, PillarGlyph } from "./JourneyPrimitives";

/** The design's 1000×700 stage. Everything below is positioned inside it. */
const STAGE_W = 1000;
const STAGE_H = 700;
const STAGE_CX = 500;
const STAGE_CY = 350;

/** How long the overlay stays mounted after `open` goes false, for the fade. */
const FADE_MS = 700;

/**
 * Where each pillar's chip cluster sits on the stage, in the design's own
 * absolute coordinates — outside its wedge, reading outward from the radar.
 * Index matches `PILLAR_KEYS`.
 */
const CHIP_ANCHORS: readonly { readonly left: number; readonly top: number }[] = [
  { left: 500, top: 92 }, // governance — 12 o'clock
  { left: 723, top: 221 }, // security
  { left: 723, top: 479 }, // compliance
  { left: 500, top: 608 }, // licensing — 6 o'clock
  { left: 277, top: 479 }, // adoption
  { left: 277, top: 221 }, // health
];

/** The sheen's leading arc — 64°, swept once every 9s. */
const SHEEN_ARC_DEG = 64;

/**
 * A wedge's fill from run-wide progress.
 *
 * The stagger (`k × 0.05` start, 0.74 span) is the design's own: it puts several
 * pillars in flight simultaneously and lets each finish at a different moment,
 * which is what a real multi-pillar package executor looks like. It is derived,
 * not measured — do not present it anywhere as a per-pillar completion count.
 */
function wedgeFill(progress: number, index: number): number {
  return clampWindow(progress, index * 0.05, index * 0.05 + 0.74);
}

function WedgeGradient({ index, color }: { index: number; color: string }) {
  // The four-stop radial is what gives the radar depth. A flat fill at varying
  // opacity was explicitly rejected in review: white at the inner lip, the pillar
  // colour at full a hair further out, then a long fade to the rim.
  return (
    <radialGradient
      id={`cjWedge${index}`}
      gradientUnits="userSpaceOnUse"
      cx="0"
      cy="0"
      r={RADAR_OUTER_R}
    >
      <stop offset="0.47" stopColor="#ffffff" stopOpacity="0.55" />
      <stop offset="0.56" stopColor={color} stopOpacity="1" />
      <stop offset="0.78" stopColor={color} stopOpacity="0.42" />
      <stop offset="1" stopColor={color} stopOpacity="0.06" />
    </radialGradient>
  );
}

export function RevealScanOverlay({
  open,
  tenantLabel,
  pillars,
  progress,
  checksDone,
  checksTotal,
  currentCheckLabel,
  vw,
  vh,
  reduced,
  isTestbed,
}: {
  /** True while a scan is genuinely in flight. False releases the scroll lock. */
  open: boolean;
  /** "Halden Materials · 1,240 seats", already formatted by `tenantStrip()`. */
  tenantLabel: string;
  pillars: readonly JourneyPillarView[];
  /** 0 → 1 across the whole run. */
  progress: number;
  checksDone: number;
  /** 0 when the run has not yet reported a total. */
  checksTotal: number;
  currentCheckLabel: string | null;
  vw: number;
  vh: number;
  reduced: boolean;
  /** Gates the debug-only Pause/Resume control below. Defaults to false so every
   *  non-testbed caller stays unaffected. */
  isTestbed?: boolean;
}) {
  // Kept mounted through the fade-out so the overlay does not vanish on the
  // frame the scan completes.
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return undefined;
    }
    if (!mounted) return undefined;
    const timer = setTimeout(() => setMounted(false), FADE_MS);
    return () => clearTimeout(timer);
  }, [open, mounted]);

  // The scroll lock. Cleanup restores whatever the body had before, so an early
  // unmount (route change, error boundary) can never strand the page unscrollable.
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // Testbed-only render freeze (#411). Purely client-side: the real scan keeps
  // running server-side regardless of `paused` — this only decides whether the
  // component keeps copying incoming props into what it renders. `frozen` is the
  // last-copied snapshot; while paused the effect below skips the copy, so the
  // snapshot — and everything derived from it — stays exactly as it was at the
  // moment Pause was clicked. Resume flips `paused` back to false, which is
  // itself a dependency of the effect, so the very next run catches the
  // snapshot up to whatever the live props already are — no replay, no restart.
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState(() => ({
    pillars,
    progress,
    checksDone,
    checksTotal,
    currentCheckLabel,
  }));
  useEffect(() => {
    if (paused) return;
    setFrozen({ pillars, progress, checksDone, checksTotal, currentCheckLabel });
  }, [paused, pillars, progress, checksDone, checksTotal, currentCheckLabel]);

  if (!mounted) return null;

  const scale = radarStageScale(vw, vh);
  const complete = frozen.progress >= 1;

  // The counter says what the run actually reported. When the total has not
  // arrived yet the phrase drops the denominator rather than asserting a
  // catalogue size the run has not confirmed.
  const totalLabel = frozen.checksTotal > 0 ? `of ${frozen.checksTotal} signals` : "signals evaluated";
  const footerCount =
    frozen.checksTotal > 0
      ? `${frozen.checksDone} of ${frozen.checksTotal} signals evaluated`
      : `${frozen.checksDone} signals evaluated`;
  const streamingLabel = complete
    ? "Acquisition complete — compiling readiness signal"
    : frozen.currentCheckLabel ?? "Acquiring tenant telemetry";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: BRAND.canvas,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: "min(4vh,34px)",
        padding: "5vh 5vw",
        boxSizing: "border-box",
        transition: `opacity ${FADE_MS}ms ease`,
        opacity: open ? 1 : 0,
        pointerEvents: open ? "auto" : "none",
      }}
    >
      {/* Tenant identity strip — the same one the Document Viewer's sidebar reuses. */}
      <div
        style={{
          width: "100%",
          maxWidth: STAGE_W,
          margin: "0 auto",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 24,
          borderBottom: `1px solid ${INK.hairlineDark}`,
          paddingBottom: 16,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: ".22em",
              textTransform: "uppercase",
              color: INK.link,
            }}
          >
            Telemetry acquisition — live
          </span>
          <span
            style={{
              fontSize: "clamp(20px,2.4vw,26px)",
              fontWeight: 800,
              letterSpacing: "-0.02em",
              color: "#f1f5f9",
            }}
          >
            {tenantLabel}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {isTestbed ? (
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              style={{
                padding: "4px 10px",
                fontSize: 11,
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.2)",
                background: paused ? "rgba(34,211,238,0.18)" : "rgba(0,0,0,0.6)",
                color: paused ? "#e0f7ff" : "rgba(255,255,255,0.7)",
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {paused ? "[DEBUG] Resume" : "[DEBUG] Pause"}
            </button>
          ) : null}
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: ".06em",
              color: INK.micro,
              whiteSpace: "nowrap",
            }}
          >
            Microsoft Graph API · read-only
          </span>
        </div>
      </div>

      <div
        style={{
          flex: "1 1 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: 0,
        }}
      >
        <div
          style={{
            position: "relative",
            width: STAGE_W,
            height: STAGE_H,
            flex: "none",
            transform: `scale(${scale})`,
          }}
        >
          <svg
            viewBox={`-260 -260 520 520`}
            width={520}
            height={520}
            style={{
              position: "absolute",
              left: STAGE_CX,
              top: STAGE_CY,
              transform: "translate(-50%,-50%)",
              overflow: "visible",
            }}
            aria-hidden="true"
          >
            <defs>
              {PILLAR_KEYS.map((key, i) => (
                <WedgeGradient key={key} index={i} color={PILLARS[key].primary} />
              ))}
              {/* The hub. Drawn UNDER the wedges so the centre reads as light
                  coming through them rather than a disc sitting on top. */}
              <radialGradient id="cjHubGlow" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="122">
                <stop offset="0" stopColor="#ffffff" stopOpacity="0.30" />
                <stop offset="0.34" stopColor="#22D3EE" stopOpacity="0.26" />
                <stop offset="0.72" stopColor="#3B82F6" stopOpacity="0.16" />
                <stop offset="1" stopColor={BRAND.canvas} stopOpacity="0" />
              </radialGradient>
              <radialGradient
                id="cjRadarSheen"
                gradientUnits="userSpaceOnUse"
                cx="0"
                cy="0"
                r={RADAR_OUTER_R}
              >
                <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.22" />
                <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
              </radialGradient>
            </defs>

            <circle cx="0" cy="0" r="122" fill="url(#cjHubGlow)" />

            {/* Guide rings — near-ambient, deliberately not schematic. */}
            <circle
              cx="0"
              cy="0"
              r={RADAR_OUTER_R}
              fill="none"
              stroke="rgba(148,163,184,.16)"
              strokeWidth="1"
            />
            <circle
              cx="0"
              cy="0"
              r={RADAR_INNER_R}
              fill="none"
              stroke="rgba(148,163,184,.14)"
              strokeWidth="1"
            />

            {PILLAR_KEYS.map((key, i) => {
              const fill = wedgeFill(frozen.progress, i);
              const path = radarWedgePath(i, fill);
              return (
                <g key={key}>
                  {/* The un-filled sector at 5%, so the six are legible as a
                      shape before any of them have started. */}
                  <path d={radarWedgeBackdropPath(i)} style={{ fill: PILLARS[key].primary, opacity: 0.05 }} />
                  {path ? (
                    <path d={path} fill={`url(#cjWedge${i})`} style={{ opacity: radarWedgeOpacity(fill) }} />
                  ) : null}
                </g>
              );
            })}

            {/* Spokes. Canvas-coloured rather than a light stroke — they read as
                gaps between wedges, not as an overlaid grid. */}
            {PILLAR_KEYS.map((key, i) => {
              const angle = i * 60 - 30;
              const [x1, y1] = polar(RADAR_INNER_R, angle).split(" ");
              const [x2, y2] = polar(RADAR_OUTER_R, angle).split(" ");
              return (
                <line
                  key={`spoke-${key}`}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="rgba(2,6,23,.55)"
                  strokeWidth="1.5"
                />
              );
            })}

            {/* Sheen. Decorative — dropped entirely under reduced motion rather
                than left parked at 0°, where it reads as a stray bright wedge. */}
            {reduced ? null : (
              <g>
                <path
                  d={
                    `M ${polar(RADAR_OUTER_R, 0)} A ${RADAR_OUTER_R} ${RADAR_OUTER_R} 0 0 1 ${polar(RADAR_OUTER_R, SHEEN_ARC_DEG)}` +
                    ` L ${polar(RADAR_INNER_R, SHEEN_ARC_DEG)} A ${RADAR_INNER_R} ${RADAR_INNER_R} 0 0 0 ${polar(RADAR_INNER_R, 0)} Z`
                  }
                  fill="url(#cjRadarSheen)"
                />
                <line
                  x1="0"
                  y1={-RADAR_INNER_R}
                  x2="0"
                  y2={-RADAR_OUTER_R}
                  stroke="#e0f7ff"
                  strokeWidth="1"
                  strokeOpacity=".5"
                />
                <animateTransform
                  attributeName="transform"
                  attributeType="XML"
                  type="rotate"
                  from="0 0 0"
                  to="360 0 0"
                  dur="9s"
                  repeatCount="indefinite"
                />
              </g>
            )}
          </svg>

          {/* Centre counter. */}
          <div
            style={{
              position: "absolute",
              left: STAGE_CX,
              top: STAGE_CY,
              transform: "translate(-50%,-50%)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
              textAlign: "center",
              width: 180,
            }}
          >
            <span
              style={{
                fontSize: 52,
                fontWeight: 800,
                letterSpacing: "-0.04em",
                lineHeight: 1,
                color: "#f1f5f9",
                ...TABULAR,
              }}
            >
              {frozen.checksDone}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: ".2em",
                textTransform: "uppercase",
                color: INK.micro,
              }}
            >
              {totalLabel}
            </span>
          </div>

          {/* Curated findings, one cluster per wedge. Every chip here reappears
              in that pillar's reveal scene — that is what makes the scan read as
              the same assessment rather than a loading animation. */}
          {PILLAR_KEYS.map((key, i) => {
            const anchor = CHIP_ANCHORS[i];
            const identity = PILLARS[key];
            const pillar = frozen.pillars.find((p) => p.key === key);
            const chips = pillar?.chips ?? [];
            const fill = wedgeFill(frozen.progress, i);
            return (
              <div
                key={`chips-${key}`}
                style={{
                  position: "absolute",
                  left: anchor.left,
                  top: anchor.top,
                  transform: "translate(-50%,-50%)",
                  width: 236,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    color: identity.primary,
                    marginBottom: 2,
                  }}
                >
                  <PillarGlyph pillar={key} size={15} color="currentColor" />
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: ".2em",
                      textTransform: "uppercase",
                    }}
                  >
                    {identity.label}
                  </span>
                </div>
                {chips.map((chip, chipIndex) => (
                  <FindingChip
                    key={chip}
                    color={identity.primary}
                    text={chip}
                    opacity={radarChipOpacity(fill, chipIndex)}
                  />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* The streaming check name. This is the trust mechanic — a named Graph
          read, not a spinner. */}
      <div
        style={{
          width: "100%",
          maxWidth: STAGE_W,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 24,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: BRAND.teal,
              flex: "none",
              animation: "cj-pulse-dot 1100ms ease-in-out infinite",
            }}
          />
          <span
            style={{
              fontSize: 15,
              fontWeight: 500,
              color: INK.bodyDarkStrong,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {streamingLabel}
          </span>
        </div>
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: ".08em",
            color: INK.micro,
            whiteSpace: "nowrap",
            ...TABULAR,
          }}
        >
          {footerCount}
        </span>
      </div>
    </div>
  );
}
