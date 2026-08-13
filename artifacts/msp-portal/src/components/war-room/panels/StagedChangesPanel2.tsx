/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `gov.staged.show`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import React from "react";
import { css, Txt, Hov } from "../runtime";

export function StagedChangesPanel2({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div style={css(`flex:none;min-width:0;position:relative;z-index:1;border-radius:16px;overflow:hidden;border:1px solid rgba(52,211,153,.4);background:linear-gradient(168deg,rgba(6,32,26,.95),rgba(2,6,23,.95));box-shadow:0 14px 40px rgba(2,6,23,.66),0 0 26px rgba(16,185,129,.14);animation:wr-rise 340ms cubic-bezier(.22,1,.36,1)`)}>
      {" "}
      <div style={css(`position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(52,211,153,.05) 0px,rgba(52,211,153,.05) 1px,transparent 1px,transparent 5px);opacity:.7`)} />
      {" "}
      <div style={css(`height:2px;background:linear-gradient(90deg,transparent,#34d399,transparent);background-size:200% 100%;animation:wr-tipsheen 3.4s linear infinite`)} />
      {" "}
      <div style={css(`position:relative;padding:11px 12px 12px;display:flex;flex-direction:column;gap:11px;min-width:0`)}>
        <div style={css(`display:flex;align-items:center;gap:6px;min-width:0`)}>
          <span style={css(`flex:none;width:5px;height:5px;border-radius:99px;background:#34d399;box-shadow:0 0 8px #34d399;animation:wr-blink 1.6s ease-in-out infinite`)} />
          <span style={css(`flex:1;min-width:0;font-size:8px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#6ee7b7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>
            <Txt v={v.gov?.staged?.heading} />
          </span>
          <Hov as="button" onClick={v.gov?.staged?.onClear} style={css(`flex:none;height:17px;padding:0 7px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:8px;font-weight:700;color:#475569;border:none;background:transparent`)} hoverStyle={css(`color:#94a3b8`)}>
            {"Reset"}
          </Hov>
        </div>
        {(v.gov?.staged?.rows || []).map((sr, srIdx) => (
          <React.Fragment key={srIdx}>
            {" "}
            <div style={css(`display:flex;flex-direction:column;gap:5px;min-width:0`)}>
              <span style={css(`font-size:8px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>
                <Txt v={sr?.l} />
              </span>
              <div style={css(`position:relative;height:22px;min-width:0`)}>
                {" "}
                <div style={css(`position:absolute;left:0;right:0;top:10px;height:2px;border-radius:99px;background:rgba(30,41,59,.95)`)} />
                {" "}
                <div style={css(`position:absolute;left:${sr?.nowW};width:${sr?.gapW};top:9px;height:4px;border-radius:99px;background:linear-gradient(90deg,rgba(71,85,105,.6),${sr?.c});box-shadow:0 0 10px ${sr?.c}88;transition:all 700ms cubic-bezier(.22,1,.36,1)`)} />
                {" "}
                <div style={css(`position:absolute;left:${sr?.nowW};top:5px;transform:translateX(-50%);width:7px;height:12px;border-radius:2px;background:rgba(100,116,139,.85)`)} />
                {" "}
                <div style={css(`position:absolute;left:${sr?.thenW};top:2px;transform:translateX(-50%);width:3px;height:18px;border-radius:99px;background:${sr?.c};box-shadow:0 0 12px ${sr?.c};transition:left 700ms cubic-bezier(.22,1,.36,1)`)} />
                {" "}
              </div>
              <div style={css(`display:flex;align-items:baseline;gap:6px;min-width:0`)}>
                <span style={css(`flex:none;font-size:11px;font-weight:700;color:#475569;font-variant-numeric:tabular-nums`)}>
                  <Txt v={sr?.now} />
                </span>
                <span style={css(`flex:1;height:1px;background:linear-gradient(90deg,rgba(71,85,105,.5),transparent)`)} />
                <span style={css(`flex:none;font-size:19px;font-weight:800;letter-spacing:-.03em;line-height:1;color:${sr?.c};font-variant-numeric:tabular-nums`)}>
                  <Txt v={sr?.then} />
                </span>
              </div>
            </div>
            {" "}
          </React.Fragment>
        ))}
        {v.gov?.staged?.money?.show && (
          <>
            {" "}
            <div style={css(`display:flex;flex-direction:column;gap:7px;padding:10px 11px;border-radius:12px;border:1px solid rgba(52,211,153,.28);background:rgba(2,6,23,.6);min-width:0`)}>
              <div style={css(`display:flex;align-items:baseline;gap:7px;min-width:0`)}>
                <span style={css(`flex:1;min-width:0;font-size:8px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>
                  <Txt v={v.gov?.staged?.money?.netLabel} />
                </span>
                <span style={css(`flex:none;font-size:17px;font-weight:800;letter-spacing:-.03em;line-height:1;color:${v.gov?.staged?.money?.netColor};font-variant-numeric:tabular-nums`)}>
                  <Txt v={v.gov?.staged?.money?.net} />
                </span>
              </div>
              <div style={css(`display:flex;flex-direction:column;gap:3px;min-width:0`)}>
                <div style={css(`display:flex;align-items:center;gap:6px;min-width:0`)}>
                  <span style={css(`flex:none;width:34px;font-size:8px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#6ee7b7`)}>
                    {"In"}
                  </span>
                  <div style={css(`flex:1;min-width:0;height:5px;border-radius:99px;background:rgba(2,6,23,.9);overflow:hidden`)}>
                    {" "}
                    <div style={css(`height:100%;width:${v.gov?.staged?.money?.inW};border-radius:99px;background:#34d399;box-shadow:0 0 10px rgba(52,211,153,.6);transition:width 700ms cubic-bezier(.22,1,.36,1)`)} />
                    {" "}
                  </div>
                  <span style={css(`flex:none;font-size:10px;font-weight:700;color:#6ee7b7;font-variant-numeric:tabular-nums`)}>
                    <Txt v={v.gov?.staged?.money?.inV} />
                  </span>
                </div>
                <div style={css(`display:flex;align-items:center;gap:6px;min-width:0`)}>
                  <span style={css(`flex:none;width:34px;font-size:8px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#fbbf24`)}>
                    {"Out"}
                  </span>
                  <div style={css(`flex:1;min-width:0;height:5px;border-radius:99px;background:rgba(2,6,23,.9);overflow:hidden`)}>
                    {" "}
                    <div style={css(`height:100%;width:${v.gov?.staged?.money?.outW};border-radius:99px;background:#fbbf24;box-shadow:0 0 10px rgba(251,191,36,.5);transition:width 700ms cubic-bezier(.22,1,.36,1)`)} />
                    {" "}
                  </div>
                  <span style={css(`flex:none;font-size:10px;font-weight:700;color:#fbbf24;font-variant-numeric:tabular-nums`)}>
                    <Txt v={v.gov?.staged?.money?.outV} />
                  </span>
                </div>
              </div>
            </div>
            {" "}
          </>
        )}
        <div style={css(`display:flex;flex-direction:column;gap:4px;padding-top:9px;border-top:1px solid rgba(52,211,153,.2);min-width:0`)}>
          {(v.gov?.staged?.items || []).map((si, siIdx) => (
            <React.Fragment key={siIdx}>
              {" "}
              <div style={css(`display:flex;align-items:center;gap:6px;min-width:0`)}>
                <svg width={"9"} height={"9"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#34d399"} strokeWidth={"3.4"} strokeLinecap={"round"} strokeLinejoin={"round"} style={css(`flex:none`)}>
                  <path d={"m5 12 5 5L20 7"} />
                </svg>
                <span style={css(`flex:1;min-width:0;font-size:9px;line-height:1.4;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>
                  <Txt v={si?.l} />
                </span>
              </div>
              {" "}
            </React.Fragment>
          ))}
        </div>
      </div>
      {" "}
    </div>
    {" "}
    </>
  );
}
