/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `sowBoard.show`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import React from "react";
import { css, Txt } from "../runtime";

export function SowBoard({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div style={css(`flex:none;position:relative;border-radius:18px;overflow:hidden;border:1px solid rgba(14,116,144,.6);background:linear-gradient(165deg,rgba(8,30,42,.97),rgba(2,6,23,.95));box-shadow:0 18px 60px rgba(2,6,23,.7),0 0 34px rgba(14,116,144,.24);animation:wr-rise 340ms cubic-bezier(.22,1,.36,1)`)}>
      {" "}
      <div style={css(`height:2px;background:linear-gradient(90deg,transparent,#67e8f9,transparent);background-size:200% 100%;animation:wr-tipsheen 3.4s linear infinite`)} />
      {" "}
      <div style={css(`padding:12px 13px;display:flex;flex-direction:column;gap:10px`)}>
        <div style={css(`display:flex;align-items:center;gap:7px;min-width:0`)}>
          <span style={css(`flex:none;width:5px;height:5px;border-radius:99px;background:#67e8f9;box-shadow:0 0 8px #67e8f9;animation:wr-blink 1.6s ease-in-out infinite`)} />
          <span style={css(`flex:1;min-width:0;font-size:9px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#67e8f9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>
            {"Scope &amp; schedule"}
          </span>
          <span style={css(`flex:none;font-size:8px;font-weight:800;font-family:ui-monospace,Menlo,monospace;color:#042f2e;background:#67e8f9;padding:1px 7px;border-radius:999px`)}>
            <Txt v={v.sowBoard?.count} />
          </span>
        </div>
        <div style={css(`display:flex;flex-direction:column;gap:5px`)}>
          <div style={css(`display:flex;gap:6px;padding-left:60px`)}>
            <span style={css(`flex:1;font-size:7.5px;font-weight:700;letter-spacing:.1em;color:#475569;font-family:ui-monospace,Menlo,monospace`)}>
              {"W1"}
            </span>
            <span style={css(`flex:1;font-size:7.5px;font-weight:700;letter-spacing:.1em;color:#475569;text-align:center;font-family:ui-monospace,Menlo,monospace`)}>
              {"W6"}
            </span>
            <span style={css(`flex:1;font-size:7.5px;font-weight:700;letter-spacing:.1em;color:#475569;text-align:right;font-family:ui-monospace,Menlo,monospace`)}>
              {"W12"}
            </span>
          </div>
          {(v.sowBoard?.phases || []).map((sp, spIdx) => (
            <React.Fragment key={spIdx}>
              {" "}
              <div onClick={sp?.onClick} style={css(`display:flex;align-items:center;gap:7px;cursor:pointer;opacity:${sp?.opacity};transition:opacity 300ms ease`)}>
                <span style={css(`flex:none;width:54px;font-size:8.5px;font-weight:800;color:${sp?.ink};font-family:ui-monospace,Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>
                  <Txt v={sp?.n} />
                </span>
                <div style={css(`flex:1;min-width:0;position:relative;height:12px;border-radius:99px;background:rgba(2,6,23,.85)`)}>
                  {" "}
                  <div style={css(`position:absolute;top:2px;bottom:2px;left:${sp?.left};width:${sp?.width};border-radius:99px;background:${sp?.color};box-shadow:0 0 10px ${sp?.color}77;transition:all 400ms cubic-bezier(.22,1,.36,1)`)} />
                  {" "}
                </div>
                <span style={css(`flex:none;width:52px;font-size:9px;font-weight:700;color:${sp?.ink};text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>
                  <Txt v={sp?.price} />
                </span>
              </div>
              {" "}
            </React.Fragment>
          ))}
        </div>
        <div style={css(`display:flex;flex-direction:column;gap:6px;padding:10px 11px;border-radius:11px;background:rgba(2,6,23,.6)`)}>
          <div style={css(`display:flex;align-items:baseline;gap:8px;flex-wrap:wrap`)}>
            <span style={css(`flex:1;min-width:0;font-size:8px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#64748b`)}>
              {"Professional services"}
            </span>
            <span style={css(`flex:none;font-size:17px;font-weight:800;color:#67e8f9;font-variant-numeric:tabular-nums`)}>
              <Txt v={v.sowBoard?.price} />
            </span>
          </div>
          <div style={css(`display:flex;align-items:baseline;gap:8px`)}>
            <span style={css(`flex:1;min-width:0;font-size:9px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>
              {"Monitoring"}
            </span>
            <span style={css(`flex:none;font-size:10px;font-weight:700;color:#a5f3fc;font-variant-numeric:tabular-nums`)}>
              <Txt v={v.sowBoard?.monthly} />
            </span>
          </div>
          <div style={css(`display:flex;align-items:center;gap:8px`)}>
            <span style={css(`flex:1;min-width:0;font-size:9px;color:#64748b`)}>
              {"Readiness on completion"}
            </span>
            <span style={css(`flex:none;font-size:14px;font-weight:800;color:${v.sowBoard?.readinessColor};font-variant-numeric:tabular-nums`)}>
              <Txt v={v.sowBoard?.readiness} />
            </span>
          </div>
          <div style={css(`position:relative;height:4px;border-radius:99px;background:rgba(2,6,23,.9);overflow:hidden`)}>
            {" "}
            <div style={css(`position:absolute;left:0;top:0;bottom:0;width:${v.sowBoard?.barW};border-radius:99px;background:${v.sowBoard?.readinessColor};transition:width 500ms cubic-bezier(.22,1,.36,1)`)} />
            {" "}
            <div style={css(`position:absolute;left:75%;top:-2px;bottom:-2px;width:2px;background:#e2e8f0;opacity:.75`)} />
            {" "}
          </div>
          <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.12em;color:${v.sowBoard?.readinessColor}`)}>
            <Txt v={v.sowBoard?.gate} />
          </span>
        </div>
      </div>
      {" "}
    </div>
    {" "}
    </>
  );
}
