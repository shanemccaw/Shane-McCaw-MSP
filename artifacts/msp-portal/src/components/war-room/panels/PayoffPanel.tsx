/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `showPayoff`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import React from "react";
import { css, Txt, Hov } from "../runtime";

export function PayoffPanel({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div style={css(`position:absolute;bottom:calc(100% + 12px);right:0;width:min(330px,100%);z-index:51;border-radius:16px;padding:13px 15px;border:1px solid rgba(52,211,153,.3);background:linear-gradient(160deg,rgba(6,30,22,.72),rgba(2,6,23,.72));backdrop-filter:blur(14px);box-shadow:0 20px 54px rgba(2,6,23,.7),0 0 40px rgba(52,211,153,.14);animation:wr-rise 420ms cubic-bezier(.22,1,.36,1)`)}>
      {" "}
      <div style={css(`display:flex;align-items:center;gap:8px;margin-bottom:10px`)}>
        <span style={css(`flex:1;font-size:9.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#34d399`)}>
          {"What it returns"}
        </span>
        <Hov as="button" onClick={v.onResume} style={css(`flex:none;width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;border:1px solid rgba(51,65,85,.8);background:rgba(2,6,23,.6);color:#94a3b8`)} hoverStyle={css(`color:#e2e8f0`)}>
          <svg width={"11"} height={"11"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} strokeLinecap={"round"}>
            <path d={"M18 6 6 18"} />
            <path d={"m6 6 12 12"} />
          </svg>
        </Hov>
      </div>
      {" "}
      <div style={css(`display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px`)}>
        {(v.payoffStats || []).map((m, mIdx) => (
          <React.Fragment key={mIdx}>
            {" "}
            <div>
              {" "}
              <div style={css(`font-size:18px;font-weight:800;letter-spacing:-.02em;color:${m?.color};font-variant-numeric:tabular-nums`)}>
                <Txt v={m?.value} />
              </div>
              {" "}
              <div style={css(`font-size:9.5px;line-height:1.3;color:#94a3b8`)}>
                <Txt v={m?.label} />
              </div>
              {" "}
            </div>
            {" "}
          </React.Fragment>
        ))}
      </div>
      {" "}
    </div>
    {" "}
    </>
  );
}
