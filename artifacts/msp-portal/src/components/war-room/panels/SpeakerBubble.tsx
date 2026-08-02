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
 * ------------------------------------------------------------------------- */
import React from "react";
import { css, Txt, Hov } from "../runtime";

export function SpeakerBubble({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div data-bubble={"true"} style={css(`position:absolute;left:${v.bubble?.bx};top:${v.bubble?.by};transform:${v.bubble?.btf};width:${v.bubble?.bw};z-index:70;padding:11px 13px;border-radius:14px;overflow:hidden;border:1px solid ${v.bubble?.bubbleBorder};background:linear-gradient(160deg,rgba(15,23,42,.9),rgba(2,6,23,.86));backdrop-filter:blur(16px);box-shadow:0 20px 48px rgba(2,6,23,.75),0 0 40px rgba(0,120,212,.16),inset 0 0 30px rgba(0,120,212,.06);animation:${v.bubble?.bubbleAnim}`)}>
      {" "}
      <span style={css(`position:absolute;top:0;bottom:0;width:70px;pointer-events:none;background:linear-gradient(90deg,transparent,rgba(125,211,252,.07),transparent);animation:wr-shimmer 5.5s ease-in-out infinite`)} />
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
        <Hov as="button" onClick={v.onTogglePlay} style={css(`flex:none;width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;pointer-events:auto;font-family:ui-monospace,Menlo,monospace;font-size:10px;font-weight:700;color:#94a3b8;border:1px solid rgba(51,65,85,.85);background:rgba(2,6,23,.6);transition:all 180ms cubic-bezier(.22,1,.36,1)`)} hoverStyle={css(`border-color:rgba(103,232,249,.6);color:#e2e8f0`)}>
          <svg width={"12"} height={"12"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2.2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
            <path d={v.playIcon} />
          </svg>
        </Hov>
        <Hov as="button" onClick={v.onNextLine} title={"Next line"} style={css(`flex:none;width:28px;height:28px;border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;pointer-events:auto;color:#94a3b8;border:1px solid rgba(51,65,85,.85);background:rgba(2,6,23,.6);transition:all 180ms cubic-bezier(.22,1,.36,1)`)} hoverStyle={css(`border-color:rgba(103,232,249,.6);color:#e2e8f0`)}>
          <svg width={"12"} height={"12"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
            <path d={"M5 12h13"} />
            <path d={"m12 5 7 7-7 7"} />
          </svg>
        </Hov>
        <Hov as="button" onClick={v.onNextScene} title={"Skip scene"} style={css(`flex:none;width:28px;height:28px;display:flex;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;pointer-events:auto;color:#94a3b8;border:1px solid rgba(51,65,85,.85);background:rgba(2,6,23,.6);transition:all 180ms cubic-bezier(.22,1,.36,1)`)} hoverStyle={css(`border-color:rgba(103,232,249,.6);color:#e2e8f0`)}>
          <svg width={"12"} height={"12"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
            <path d={"m5 4 10 8-10 8z"} />
            <path d={"M19 5v14"} />
          </svg>
        </Hov>
        <span style={css(`margin-left:auto;font-size:9px;font-weight:700;letter-spacing:.14em;font-family:ui-monospace,Menlo,monospace;color:#475569`)}>
          <Txt v={v.playState} />
        </span>
      </div>
      {" "}
      <div style={css(`margin-top:10px;height:3px;border-radius:99px;background:rgba(30,41,59,.9);overflow:hidden`)}>
        {" "}
        <div style={css(`height:100%;border-radius:99px;background:linear-gradient(90deg,#0078D4,#67E8F9);animation:${v.bubble?.progressAnim} ${v.bubble?.progressDur} linear forwards;animation-play-state:${v.bubble?.progressState}`)} />
        {" "}
      </div>
      {" "}
    </div>
    {" "}
    </>
  );
}
