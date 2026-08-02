/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `bubble`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 *
 * #342 departs from the design in two deliberate ways, both to stop the bubble
 * competing with the radar for the room's most valuable space:
 *
 *   1. A real collapsed/expanded state. Collapsed is the RESTING state — a
 *      one-line chip that still carries the speaker, the line and the transport
 *      controls. It expands on hover or keyboard focus (Shane's chosen trigger)
 *      and collapses again on leave/blur. This is not the ✕: `onCloseBubble`
 *      also stops playback, so it could not double as a collapse.
 *   2. A genuine overlay treatment. The design's bubble was ~90% opaque because
 *      it was positioned to sit BESIDE the radar; it now sits deliberately ON
 *      it, so the fill is dropped well below opaque and the blur raised, letting
 *      the topology read through instead of being punched out.
 *
 * The expanded branch below is otherwise the ported markup, unchanged, so it can
 * still be re-diffed against the design source.
 * ------------------------------------------------------------------------- */
import React from "react";
import { css, Txt, Hov } from "../runtime";

/** Transport controls, shared by both states so playback is never unreachable. */
function Transport({ v, compact }: { v: any; compact?: boolean }) {
  const d = compact ? 24 : 28;
  const btn = `flex:none;width:${d}px;height:${d}px;border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;pointer-events:auto;color:#94a3b8;border:1px solid rgba(51,65,85,.85);background:rgba(2,6,23,.6);transition:all 180ms cubic-bezier(.22,1,.36,1)`;
  const hov = css(`border-color:rgba(103,232,249,.6);color:#e2e8f0`);
  const gl = compact ? 11 : 12;
  return (
    <>
      <Hov as="button" onClick={v.onTogglePlay} title={"Play / pause"} style={css(btn)} hoverStyle={hov}>
        <svg width={String(gl)} height={String(gl)} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2.2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
          <path d={v.playIcon} />
        </svg>
      </Hov>
      <Hov as="button" onClick={v.onNextLine} title={"Next line"} style={css(btn)} hoverStyle={hov}>
        <svg width={String(gl)} height={String(gl)} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
          <path d={"M5 12h13"} />
          <path d={"m12 5 7 7-7 7"} />
        </svg>
      </Hov>
      {!compact && (
        <Hov as="button" onClick={v.onNextScene} title={"Skip scene"} style={css(btn)} hoverStyle={hov}>
          <svg width={"12"} height={"12"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
            <path d={"m5 4 10 8-10 8z"} />
            <path d={"M19 5v14"} />
          </svg>
        </Hov>
      )}
    </>
  );
}

export function SpeakerBubble({ v }: { v: any }) {
  const b = v.bubble || {};
  const collapsed = !!b.collapsed;

  /* Overlay fill. Both states sit over live topology, so neither is opaque; the
   * expanded one is only slightly denser because it carries a paragraph rather
   * than a single clamped line. `saturate` keeps the radar's cyans from going
   * muddy under the blur. */
  const fill = collapsed
    ? `linear-gradient(160deg,rgba(15,23,42,.66),rgba(2,6,23,.58))`
    : `linear-gradient(160deg,rgba(15,23,42,.80),rgba(2,6,23,.74))`;

  /** The speaker's line, flattened for the collapsed chip's single clamped row. */
  const oneLine = (b.lineParts || []).map((lp) => (lp && lp.v) || "").join("").replace(/\s+/g, " ").trim();

  return (
    <div
      data-bubble={"true"}
      data-bubble-state={collapsed ? "collapsed" : "expanded"}
      tabIndex={0}
      onMouseEnter={v.onBubbleOpen}
      onMouseLeave={v.onBubbleClose}
      onFocus={v.onBubbleOpen}
      onBlur={v.onBubbleClose}
      style={css(`position:absolute;left:${b.bx};top:${b.by};transform:${b.btf};width:${b.bw};z-index:70;padding:${collapsed ? "7px 9px" : "11px 13px"};border-radius:14px;overflow:hidden;pointer-events:auto;outline:none;cursor:${collapsed ? "pointer" : "default"};border:1px solid ${b.bubbleBorder};background:${fill};backdrop-filter:blur(22px) saturate(1.35);box-shadow:0 20px 48px rgba(2,6,23,.6),0 0 40px rgba(0,120,212,.14),inset 0 0 30px rgba(0,120,212,.05);animation:${b.bubbleAnim};transition:padding 220ms cubic-bezier(.22,1,.36,1),background 220ms ease`)}
    >
      <span style={css(`position:absolute;top:0;bottom:0;width:70px;pointer-events:none;background:linear-gradient(90deg,transparent,rgba(125,211,252,.07),transparent);animation:wr-shimmer 5.5s ease-in-out infinite`)} />

      {collapsed ? (
        /* COLLAPSED — one row: who is speaking, what they just said, transport. */
        <div style={css(`display:flex;align-items:center;gap:8px;min-width:0`)}>
          <span style={css(`flex:none;width:20px;height:20px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:8.5px;font-weight:800;color:#fff;background:${b.tile}`)}>
            <Txt v={b.initials} />
          </span>
          <span style={css(`flex:none;font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${b.roleColor}`)}>
            <Txt v={b.name} />
          </span>
          <span style={css(`flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;line-height:1.4;color:#cbd5e1`)}>
            <Txt v={oneLine} />
          </span>
          <Transport v={v} compact={true} />
          <svg width={"12"} height={"12"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#64748b"} strokeWidth={"2.4"} strokeLinecap={"round"} strokeLinejoin={"round"} style={css(`flex:none`)}>
            <path d={"M6 15l6-6 6 6"} />
          </svg>
        </div>
      ) : (
        /* EXPANDED — the ported design's bubble, unchanged. */
        <>
          {" "}
          <div style={css(`display:flex;align-items:center;gap:7px;margin-bottom:5px`)}>
            <span style={css(`width:20px;height:20px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:8.5px;font-weight:800;color:#fff;background:${v.bubble?.tile}`)}>
              <Txt v={v.bubble?.initials} />
            </span>
            <span style={css(`font-size:10px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${v.bubble?.roleColor}`)}>
              <Txt v={v.bubble?.name} />
            </span>
            <span style={css(`font-size:9px;font-weight:600;color:#475569`)}>
              <Txt v={v.bubble?.role} />
            </span>
            <Hov as="button" onClick={v.onCloseBubble} style={css(`margin-left:auto;flex:none;width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;pointer-events:auto;border:1px solid rgba(51,65,85,.85);background:rgba(2,6,23,.6);color:#94a3b8`)} hoverStyle={css(`color:#e2e8f0;border-color:rgba(103,232,249,.6)`)}>
              <svg width={"11"} height={"11"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} strokeLinecap={"round"}>
                <path d={"M18 6 6 18"} />
                <path d={"m6 6 12 12"} />
              </svg>
            </Hov>
          </div>
          {" "}
          <div style={css(`font-size:12.5px;line-height:1.6;color:#cbd5e1;text-wrap:pretty`)}>
            {" "}
            {(v.bubble?.lineParts || []).map((lp, lpIdx) => (
              <React.Fragment key={lpIdx}>
                {" "}
                <span style={css(`display:${lp?.display};font-size:${lp?.size};font-weight:${lp?.weight};letter-spacing:${lp?.tracking};color:${lp?.color};text-shadow:${lp?.shadow}`)}>
                  <Txt v={lp?.v} />
                </span>
                {" "}
              </React.Fragment>
            ))}
            {" "}
          </div>
          {" "}
          <div style={css(`display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:10px`)}>
            <Hov as="button" onClick={v.bubble?.onDetails} style={css(`flex:1 1 auto;min-width:0;display:flex;align-items:center;gap:6px;min-height:28px;padding:5px 11px;border-radius:8px;cursor:pointer;pointer-events:auto;font-family:inherit;font-size:11px;font-weight:700;line-height:1.25;text-align:left;color:#7dd3fc;border:1px solid rgba(103,232,249,.3);background:rgba(103,232,249,.08);transition:all 180ms cubic-bezier(.22,1,.36,1)`)} hoverStyle={css(`border-color:rgba(103,232,249,.65);color:#e0f2fe`)}>
              <svg width={"12"} height={"12"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                <circle cx={"12"} cy={"12"} r={"10"} />
                <path d={"M12 16v-4"} />
                <path d={"M12 8h.01"} />
              </svg>
              <Txt v={v.bubble?.detailsLabel} />{" "}
            </Hov>
            <Transport v={v} />
            <span style={css(`margin-left:auto;font-size:9px;font-weight:700;letter-spacing:.14em;font-family:ui-monospace,Menlo,monospace;color:#475569`)}>
              <Txt v={v.playState} />
            </span>
          </div>
          {" "}
        </>
      )}

      <div style={css(`margin-top:${collapsed ? "7px" : "10px"};height:3px;border-radius:99px;background:rgba(30,41,59,.9);overflow:hidden`)}>
        {" "}
        <div style={css(`height:100%;border-radius:99px;background:linear-gradient(90deg,#0078D4,#67E8F9);animation:${v.bubble?.progressAnim} ${v.bubble?.progressDur} linear forwards;animation-play-state:${v.bubble?.progressState}`)} />
        {" "}
      </div>
    </div>
  );
}
