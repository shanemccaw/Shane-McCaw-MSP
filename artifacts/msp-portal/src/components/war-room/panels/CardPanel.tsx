/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `card`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import React from "react";
import { css, Txt, Hov } from "../runtime";

export function CardPanel({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div style={css(`position:absolute;bottom:calc(100% + 12px);left:0;width:290px;z-index:52;border-radius:16px;overflow:hidden;border:1px solid rgba(103,232,249,.34);background:linear-gradient(160deg,rgba(15,23,42,.94),rgba(2,6,23,.9));backdrop-filter:blur(16px);box-shadow:0 22px 60px rgba(2,6,23,.75),0 0 50px rgba(0,120,212,.22);animation:wr-rise 380ms cubic-bezier(.22,1,.36,1)`)}>
      {" "}
      <div style={css(`display:flex;align-items:center;gap:8px;padding:11px 13px;border-bottom:1px solid rgba(30,41,59,.9)`)}>
        <span style={css(`flex:none;width:26px;height:26px;border-radius:9px;display:flex;align-items:center;justify-content:center;border:1px solid rgba(103,232,249,.28);background:rgba(103,232,249,.1)`)}>
          <svg width={"14"} height={"14"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#7dd3fc"} strokeWidth={"1.9"} strokeLinecap={"round"} strokeLinejoin={"round"}>
            <path d={v.card?.icon} />
          </svg>
        </span>
        <span style={css(`flex:1;min-width:0;font-size:12.5px;font-weight:700;color:#f1f5f9`)}>
          <Txt v={v.card?.title} />
        </span>
        <Hov as="button" onClick={v.card?.onDismiss} style={css(`flex:none;width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;border:1px solid rgba(51,65,85,.8);background:rgba(2,6,23,.6);color:#94a3b8`)} hoverStyle={css(`color:#e2e8f0`)}>
          <svg width={"11"} height={"11"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} strokeLinecap={"round"}>
            <path d={"M18 6 6 18"} />
            <path d={"m6 6 12 12"} />
          </svg>
        </Hov>
      </div>
      {" "}
      <div style={css(`padding:12px 13px;display:flex;flex-direction:column;gap:11px`)}>
        <div style={css(`display:flex;align-items:center;gap:7px`)}>
          <span style={css(`width:18px;height:18px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;color:#fff;background:${v.card?.tile}`)}>
            <Txt v={v.card?.fromInitials} />
          </span>
          <span style={css(`font-size:9.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${v.card?.color}`)}>
            {"Handed over by "}<Txt v={v.card?.fromName} />
          </span>
        </div>
        <p style={css(`margin:0;font-size:11.5px;line-height:1.5;color:#94a3b8;text-wrap:pretty`)}>
          <Txt v={v.card?.blurb} />
        </p>
        <div style={css(`font-size:11.5px;font-weight:700;color:#e2e8f0;line-height:1.45`)}>
          <Txt v={v.card?.question} />
        </div>
        <div style={css(`display:flex;flex-direction:column;gap:7px`)}>
          {(v.card?.choices || []).map((c, cIdx) => (
            <React.Fragment key={cIdx}>
              {" "}
              <Hov as="button" onClick={c?.onClick} style={css(`display:flex;align-items:center;gap:8px;text-align:left;padding:9px 11px;border-radius:10px;cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:600;line-height:1.35;color:${c?.color};border:1px solid ${c?.border};background:${c?.bg};transition:all 180ms cubic-bezier(.22,1,.36,1)`)} hoverStyle={css(`border-color:rgba(103,232,249,.65);color:#e0f2fe`)}>
                <span style={css(`flex:none;width:18px;height:18px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;color:#fff;background:${c?.tile}`)}>
                  <Txt v={c?.initials} />
                </span>
                <Txt v={c?.label} />{" "}
              </Hov>
              {" "}
            </React.Fragment>
          ))}
        </div>
        <div style={css(`display:flex;align-items:center;justify-content:space-between;font-size:9px;font-weight:700;letter-spacing:.14em;font-family:ui-monospace,Menlo,monospace;color:#475569`)}>
          <span>
            {"ASSESSMENT FINDING"}
          </span>
          <span style={css(`color:${v.card?.statusColor}`)}>
            <Txt v={v.card?.statusLabel} />
          </span>
        </div>
      </div>
      {" "}
    </div>
    {" "}
    </>
  );
}
