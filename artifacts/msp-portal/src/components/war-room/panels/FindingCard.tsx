/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `fcard.show`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import React from "react";
import { css, Txt, Hov } from "../runtime";

export function FindingCard({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div style={css(`position:absolute;inset:8px;z-index:135;display:flex;align-items:center;justify-content:center;pointer-events:auto`)}>
      <div style={css(`position:absolute;inset:0;background:rgba(2,6,23,.72);backdrop-filter:blur(4px)`)} />
      <div style={css(`position:relative;width:min(560px,94%);max-height:86%;display:flex;flex-direction:column;border-radius:20px;overflow:hidden;border:1px solid ${v.fcard?.color}66;background:linear-gradient(162deg,rgba(15,23,42,.98),rgba(2,6,23,.98));box-shadow:0 26px 80px rgba(2,6,23,.8),0 0 46px ${v.fcard?.color}26;animation:wr-rise 320ms cubic-bezier(.22,1,.36,1)`)}>
        <span style={css(`position:absolute;left:0;right:0;top:0;height:1.5px;background:linear-gradient(90deg,transparent,${v.fcard?.color},transparent);pointer-events:none`)} />
        <div style={css(`flex:none;display:flex;align-items:flex-start;gap:11px;padding:14px 16px;border-bottom:1px solid rgba(30,41,59,.9)`)}>
          <span style={css(`flex:none;width:28px;height:28px;border-radius:9px;display:flex;align-items:center;justify-content:center;background:${v.fcard?.color}`)}>
            <svg width={"15"} height={"15"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#fff"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
              <path d={"M10.3 3.6 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z"} />
              <path d={"M12 9v4M12 17h.01"} />
            </svg>
          </span>
          <div style={css(`flex:1;min-width:0`)}>
            {" "}
            <div style={css(`font-size:8.5px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:${v.fcard?.color}`)}>
              <Txt v={v.fcard?.pillarLabel} />{" finding"}
            </div>
            {" "}
            <div style={css(`font-size:14px;font-weight:800;letter-spacing:-.02em;color:#e2e8f0;text-wrap:pretty`)}>
              <Txt v={v.fcard?.t} />
            </div>
            {" "}
          </div>
          <Hov as="button" onClick={v.fcard?.onClose} style={css(`flex:none;height:26px;padding:0 11px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:700;color:#94a3b8;border:1px solid rgba(51,65,85,.9);background:rgba(2,6,23,.6)`)} hoverStyle={css(`color:#e2e8f0`)}>
            {"Close"}
          </Hov>
        </div>
        <div style={css(`flex:1;min-height:0;overflow-y:auto;padding:14px 16px 18px;display:flex;flex-direction:column;gap:12px`)}>
          <div style={css(`display:flex;align-items:baseline;gap:10px;padding:11px 13px;border-radius:12px;border:1px solid ${v.fcard?.color}3d;background:rgba(2,6,23,.6)`)}>
            <span style={css(`flex:none;font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#64748b`)}>
              {"Measured"}
            </span>
            <span style={css(`flex:1;font-size:12.5px;font-weight:700;color:#e2e8f0;text-wrap:pretty`)}>
              <Txt v={v.fcard?.m} />
            </span>
          </div>
          <div style={css(`display:flex;flex-direction:column;gap:5px`)}>
            <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#64748b`)}>
              {"What this means"}
            </span>
            <span style={css(`font-size:11.5px;line-height:1.6;color:#cbd5e1;text-wrap:pretty`)}>
              <Txt v={v.fcard?.means} />
            </span>
          </div>
          <div style={css(`display:flex;flex-direction:column;gap:5px`)}>
            <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#fca5a5`)}>
              {"Why it blocks Copilot"}
            </span>
            <span style={css(`font-size:11.5px;line-height:1.6;color:#e2e8f0;text-wrap:pretty`)}>
              <Txt v={v.fcard?.blocks} />
            </span>
          </div>
          <div style={css(`display:flex;flex-direction:column;gap:6px;padding:12px 13px;border-radius:12px;border:1px solid rgba(52,211,153,.34);background:rgba(16,185,129,.07)`)}>
            <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#6ee7b7`)}>
              {"How it gets fixed"}
            </span>
            {(v.fcard?.steps || []).map((fs, fsIdx) => (
              <React.Fragment key={fsIdx}>
                {" "}
                <div style={css(`display:flex;gap:9px;align-items:flex-start`)}>
                  <span style={css(`flex:none;width:16px;height:16px;border-radius:99px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#6ee7b7;border:1px solid rgba(52,211,153,.5);font-family:ui-monospace,Menlo,monospace`)}>
                    <Txt v={fs?.n} />
                  </span>
                  <span style={css(`flex:1;font-size:10.5px;line-height:1.55;color:#cbd5e1;text-wrap:pretty`)}>
                    <Txt v={fs?.v} />
                  </span>
                </div>
                {" "}
              </React.Fragment>
            ))}
          </div>
          <div style={css(`display:flex;align-items:center;gap:9px;flex-wrap:wrap`)}>
            <span style={css(`font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;padding:4px 10px;border-radius:999px;color:${v.fcard?.color};border:1px solid ${v.fcard?.color}55;background:${v.fcard?.color}14`)}>
              {"SOW · "}<Txt v={v.fcard?.sow} />
            </span>
            <Hov as="button" onClick={v.fcard?.onOpenPillar} style={css(`margin-left:auto;height:29px;padding:0 14px;border-radius:9px;border:none;cursor:pointer;font-family:inherit;font-size:11px;font-weight:800;color:#04121f;background:${v.fcard?.color}`)} hoverStyle={css(`filter:brightness(1.12)`)}>
              {"Open the "}<Txt v={v.fcard?.pillarLabel} />{" dive"}
            </Hov>
          </div>
        </div>
      </div>
    </div>
    {" "}
    </>
  );
}
