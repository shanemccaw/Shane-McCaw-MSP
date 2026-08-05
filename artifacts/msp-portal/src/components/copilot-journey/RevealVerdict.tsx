/**
 * RevealVerdict.tsx — Scene 1. The verdict.
 *
 * The hook. One number, one label, one sentence, and six satellites that each
 * carry a real specific FINDING — never a score. Scene 9 is where scores belong;
 * collapsing the two makes Scene 1 a duplicate of its own payoff.
 *
 * CRITICAL GEOMETRY — the zero-size arm
 * ------------------------------------
 * Each satellite hangs off a `width:0; height:0` div with `transform-origin:0 0`
 * and `rotate(Ndeg) translate(0,-satelliteRadius(N)px)`. Sizing the arm to its
 * label instead makes `rotate()` pivot on the label's own centre, which silently
 * pushes every satellite to a different radius and tilts the ring. The label is
 * a fixed 380px-WIDE box centred on the end of that arm and counter-rotated so
 * it stays upright.
 *
 * The label centres itself with `translate(-50%,-50%)`, NOT with a negative
 * margin of half `LABEL_H` (#422). Percentage translates resolve against the
 * element's own rendered box, so the label stays centred on its anchor at any
 * height; a fixed `margin-top:-26px` silently assumed every label was exactly
 * one `LABEL_H` tall and let anything taller grow inward, toward the orb. That
 * is the same thing Scene 0's chip clusters have always done
 * (`RevealScanOverlay.tsx`, `translate(-50%,-50%)` on a content-sized cluster) —
 * this scene was the one doing it differently.
 *
 * LONG FINDING TEXT (#412, #422)
 * ------------------------------
 * `satelliteFinding` is a real `severity_rules[].label` (#408) — a full
 * researched sentence, not the short placeholder this scene was built against.
 * The finding wraps within the fixed-width box instead of running past it on
 * `white-space:nowrap`; only the short pillar eyebrow (SECURITY, HEALTH, …)
 * stays single-line.
 *
 * That fixed WIDTH does NOT, on its own, keep a satellite clear of the orb —
 * the header used to claim it did, and #422 is what that claim cost. A real
 * finding renders a chip wide enough to fill the box, and at 60°/120°/240°/300°
 * the box's inner end reached 39px inside the orb. The clearance comes from the
 * ring's geometry instead: see `satelliteRadius` in `revealMath.ts`, which
 * pushes exactly those four side satellites outward.
 *
 * The ring rotates -26° → 0° once during the reveal and then settles. It never
 * spins continuously — this is a readout, not an ornament.
 */

import { useEffect, useState } from "react";

import type { JourneyPillarView } from "./journeyModel.ts";
import { verdictLabel, verdictSentence } from "./journeyModel.ts";
import {
  COPILOT_ORB_CONIC,
  INK,
  MOTION,
  TABULAR,
  severityColor,
} from "./journeyTokens.ts";
import {
  clampWindow,
  ringCounterRotation,
  ringRotation,
  satelliteRadius,
  verdictCount,
  verdictStageScale,
} from "./revealMath.ts";
import { FindingChip, JourneyUnavailable, PillarGlyph, ScrollCue } from "./JourneyPrimitives";

/**
 * The stage. Wider than it is tall on purpose: the ellipse's horizontal radius
 * (`SATELLITE_RX`) needs the room, and `verdictStageScale` is height-bound on an
 * ordinary laptop, so width is the cheap axis to spend. `STAGE_H` is unchanged
 * from the circular ring — the ellipse keeps the vertical radius it had.
 */
const STAGE_W = 1040;
const STAGE_H = 790;
/** The ring's centre inside the stage. `STAGE_W / 2` — the `left:50%` blocks below assume it. */
const CENTRE_X = 520;
const CENTRE_Y = 330;
/** The label box. Fixed width; height is a floor, not a cap — see the header. */
const LABEL_W = 380;
const LABEL_H = 52;
/** The Copilot identity mark. Constant — it never changes with the score. */
const ORB_PX = 346;

/** The count-up ticks at 40ms, matching the design's own reveal interval. */
const TICK_MS = 40;

/** Below this the ring cannot hold its 380px labels at any honest scale — stack instead. */
const WIDE_MIN_PX = 820;

/**
 * How much of the status payload is known. Same three states the pillar scenes
 * carry, and for the same reason: "the platform has no covered readiness
 * indicator for this tenant" is a finding about a payload, and it cannot be said
 * before that payload arrives or when the request for it failed.
 */
export type VerdictPayloadState = "loading" | "error" | "ready";

/** The quiet neutral placeholder. Asserts nothing — not even an em dash. */
function VerdictPending({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "26px 0" }}>
      <span
        aria-hidden="true"
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: INK.deemphasised,
          flex: "none",
          animation: "cj-pulse-dot 1100ms ease-in-out infinite",
        }}
      />
      <span style={{ fontSize: 15, fontWeight: 500, color: INK.micro }}>{label}</span>
    </div>
  );
}

/**
 * What the score slot shows in place of a number, on both the ring and the
 * stacked layouts — so the two cannot drift into saying different things about
 * the same missing figure.
 */
function VerdictScoreUnavailable({
  payloadState,
  retryAction,
  detail,
}: {
  payloadState: VerdictPayloadState;
  retryAction: React.ReactNode;
  /** The loaded-and-empty copy, which differs by layout only in length. */
  detail: string;
}) {
  if (payloadState === "loading") return <VerdictPending label="Reading your readiness score…" />;
  if (payloadState === "error") {
    return (
      <JourneyUnavailable
        eyebrow="Could not be loaded"
        title="Your readiness score did not load"
        detail="The request for this tenant's assessment status failed. Nothing is shown here rather than a figure nobody received."
        action={retryAction}
      />
    );
  }
  return <JourneyUnavailable title="No readiness score yet" detail={detail} />;
}

function OrbMark({ opacity, reduced }: { opacity: number; reduced: boolean }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: ORB_PX,
        height: ORB_PX,
        transform: "translate(-50%,-50%)",
        borderRadius: "50%",
        pointerEvents: "none",
        transition: "opacity 500ms",
        opacity,
      }}
      aria-hidden="true"
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: COPILOT_ORB_CONIC,
          // The mask turns the conic disc into a ring of light. Both prefixes:
          // Safari still needs `-webkit-mask` for a radial-gradient mask.
          WebkitMaskImage:
            "radial-gradient(circle, transparent 63%, #000 68%, #000 73%, transparent 78%)",
          maskImage:
            "radial-gradient(circle, transparent 63%, #000 68%, #000 73%, transparent 78%)",
          animation: reduced ? "none" : "cj-orb-spin 26s linear infinite",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(59,130,246,.15), rgba(139,92,246,.09) 46%, rgba(2,6,23,0) 72%)",
        }}
      />
    </div>
  );
}

/** One satellite: a pillar eyebrow over the finding it leads with. */
function Satellite({
  pillar,
  angle,
  counterRotation,
}: {
  pillar: JourneyPillarView;
  angle: number;
  counterRotation: number;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 0,
        height: 0,
        transformOrigin: "0 0",
        transform: `rotate(${angle}deg) translate(0,-${satelliteRadius(angle)}px)`,
      }}
    >
      <div
        style={{
          width: LABEL_W,
          minHeight: LABEL_H,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          // `translate(-50%,-50%)` is outermost, so it lands the box's real
          // centre — at whatever height the content gives it — on the arm's end,
          // and the rotations still pivot about that same centre. See the
          // header: a fixed negative margin here was half of #422.
          transform: `translate(-50%,-50%) rotate(${-angle}deg) rotate(${counterRotation}deg)`,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: ".2em",
            textTransform: "uppercase",
            color: pillar.primary,
            marginBottom: 7,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 5,
            whiteSpace: "nowrap",
          }}
        >
          <PillarGlyph pillar={pillar.key} size={13} color="currentColor" />
          <span>{pillar.label}</span>
        </div>
        {/* Same chip Scene 0's scan overlay uses for this exact finding (#412,
            ported #417) — dark rounded-rect pill, bullet marker, real wrapping
            bounded to the fixed LABEL_W box above. An em dash rather than an
            invented finding: the scan genuinely returned nothing quotable for
            this pillar. */}
        <FindingChip color={pillar.primary} text={pillar.satelliteFinding ?? "—"} />
      </div>
    </div>
  );
}

export function RevealVerdict({
  start,
  tenantName,
  score,
  pillars,
  vw,
  vh,
  reduced,
  payloadState,
  retryAction,
}: {
  /** Begins the 2600ms timeline — the moment Scene 0 releases the scroll. */
  start: boolean;
  tenantName: string;
  /** `null` when the platform has no covered readiness indicator. */
  score: number | null;
  pillars: readonly JourneyPillarView[];
  vw: number;
  vh: number;
  reduced: boolean;
  /** Whether the status payload has landed — see `VerdictPayloadState`. */
  payloadState: VerdictPayloadState;
  /** The retry control offered on `"error"`. Built once by the page. */
  retryAction: React.ReactNode;
}) {
  // The reveal is time-driven, not scroll-driven: Scene 1 has already been
  // earned by the scan, so it plays on arrival rather than on scroll.
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!start) return undefined;
    const began = performance.now();
    const timer = setInterval(() => {
      const next = Math.min(1, (performance.now() - began) / MOTION.verdictMs);
      setT(next);
      if (next >= 1) clearInterval(timer);
    }, TICK_MS);
    return () => clearInterval(timer);
  }, [start]);

  const wide = vw >= WIDE_MIN_PX;
  const ringOpacity = clampWindow(t, 0.42, 1);
  const rotation = ringRotation(t, reduced);
  const counterRotation = ringCounterRotation(t, reduced);
  const lineOpacity = clampWindow(t, 0.5, 0.85);
  const orbOpacity = clampWindow(t, 0.05, 0.55);

  // Count-ups survive reduced motion: they are informational, and freezing this
  // one would hide the single thing the scene exists to say.
  const shown = score === null ? null : verdictCount(score, t);
  const tone = score === null ? INK.deemphasised : severityColor(score);

  return (
    <section data-cj-scene="1" style={{ position: "relative", height: "170vh" }}>
      <div
        style={{
          position: "sticky",
          top: 0,
          height: "100vh",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            position: "absolute",
            width: 1100,
            height: 1100,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(0,120,212,.13), rgba(2,6,23,0) 62%)",
            pointerEvents: "none",
          }}
          aria-hidden="true"
        />

        {wide ? (
          <div
            style={{
              position: "relative",
              width: STAGE_W,
              height: STAGE_H,
              flex: "none",
              transform: `scale(${verdictStageScale(vw, vh)})`,
            }}
          >
            <div
              style={{
                position: "absolute",
                left: CENTRE_X,
                top: CENTRE_Y,
                width: 1,
                height: 1,
                transition: "opacity 400ms",
                opacity: ringOpacity,
                transform: `rotate(${rotation}deg)`,
              }}
            >
              <div style={{ position: "absolute", width: 1, height: 1 }}>
                {pillars.map((pillar, i) => (
                  <Satellite
                    key={pillar.key}
                    pillar={pillar}
                    angle={i * 60}
                    counterRotation={counterRotation}
                  />
                ))}
              </div>
            </div>

            <div
              style={{ position: "absolute", left: CENTRE_X, top: CENTRE_Y, width: 1, height: 1, zIndex: 1 }}
            >
              <OrbMark opacity={orbOpacity} reduced={reduced} />
            </div>

            <div
              style={{
                position: "absolute",
                left: "50%",
                top: CENTRE_Y,
                transform: "translate(-50%,-50%)",
                zIndex: 2,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                textAlign: "center",
                width: 460,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: ".22em",
                  textTransform: "uppercase",
                  color: INK.micro,
                }}
              >
                Copilot readiness score
              </span>
              {shown === null || score === null ? (
                <VerdictScoreUnavailable
                  payloadState={payloadState}
                  retryAction={retryAction}
                  detail="The platform has no covered readiness indicator for this tenant. The pillar findings below are still real — the single headline figure needs a scored check in every pillar before it means anything."
                />
              ) : (
                <>
                  <div
                    style={{
                      fontSize: 210,
                      fontWeight: 800,
                      letterSpacing: "-0.05em",
                      lineHeight: 0.94,
                      color: tone,
                      ...TABULAR,
                    }}
                  >
                    {shown}
                  </div>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: ".14em",
                      textTransform: "uppercase",
                      color: tone,
                    }}
                  >
                    {verdictLabel(score)}
                  </span>
                </>
              )}
            </div>

            <div
              style={{
                position: "absolute",
                left: "50%",
                top: 660,
                transform: "translateX(-50%)",
                width: 840,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 22,
                transition: "opacity 600ms",
                opacity: lineOpacity,
              }}
            >
              {score === null ? null : (
                <p
                  style={{
                    maxWidth: 760,
                    margin: 0,
                    textAlign: "center",
                    fontSize: 23,
                    fontWeight: 500,
                    lineHeight: 1.5,
                    color: INK.bodyDarkStrong,
                    textWrap: "pretty",
                  }}
                >
                  {verdictSentence(tenantName, score)}
                </p>
              )}
              {/* A cue, not a button — the narrative is the scroll. */}
              <ScrollCue label="Six pillars below" />
            </div>
          </div>
        ) : (
          /* Below 820px the ring cannot hold its labels at any honest radius, so
             the same six findings become a plain list. Nothing is dropped. */
          <div
            style={{
              width: "100%",
              maxWidth: 520,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "min(3.4vh,24px)",
              padding: "0 22px 0 52px",
              boxSizing: "border-box",
            }}
          >
            <div
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, textAlign: "center" }}
            >
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: ".2em",
                  textTransform: "uppercase",
                  color: INK.micro,
                }}
              >
                Copilot readiness score
              </span>
              {shown === null || score === null ? (
                <VerdictScoreUnavailable
                  payloadState={payloadState}
                  retryAction={retryAction}
                  detail="The platform has no covered readiness indicator for this tenant. The pillar findings below are still real."
                />
              ) : (
                <>
                  <div
                    style={{
                      fontSize: "clamp(84px,26vw,132px)",
                      fontWeight: 800,
                      letterSpacing: "-0.05em",
                      lineHeight: 0.95,
                      color: tone,
                      ...TABULAR,
                    }}
                  >
                    {shown}
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: ".14em",
                      textTransform: "uppercase",
                      color: tone,
                    }}
                  >
                    {verdictLabel(score)}
                  </span>
                </>
              )}
            </div>

            {score === null ? null : (
              <p
                style={{
                  margin: 0,
                  textAlign: "center",
                  fontSize: 16,
                  fontWeight: 500,
                  lineHeight: 1.5,
                  color: INK.bodyDarkStrong,
                  textWrap: "pretty",
                  transition: "opacity 500ms",
                  opacity: lineOpacity,
                }}
              >
                {verdictSentence(tenantName, score)}
              </p>
            )}

            <div
              style={{
                width: "100%",
                display: "flex",
                flexDirection: "column",
                gap: "min(1.4vh,9px)",
                transition: "opacity 500ms",
                opacity: ringOpacity,
              }}
            >
              {pillars.map((pillar) => (
                <div
                  key={pillar.key}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 14,
                    borderTop: `1px solid ${INK.hairlineDark}`,
                    paddingTop: 9,
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 600,
                      letterSpacing: ".18em",
                      textTransform: "uppercase",
                      color: pillar.primary,
                      flex: "none",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                    }}
                  >
                    <PillarGlyph pillar={pillar.key} size={12} color="currentColor" />
                    <span>{pillar.label}</span>
                  </span>
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: pillar.satelliteFinding ? "#e2e8f0" : INK.deemphasised,
                      textAlign: "right",
                    }}
                  >
                    {pillar.satelliteFinding ?? "—"}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ opacity: lineOpacity }}>
              <ScrollCue label="Six pillars below" />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
