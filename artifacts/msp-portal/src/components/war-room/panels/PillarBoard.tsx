/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `pillarBoard.show`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import React from "react";
import { css, Txt, Hov } from "../runtime";

export function PillarBoard({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div style={css(`flex:none;position:relative;border-radius:18px;border:1px solid ${v.pillarBoard?.color}66;background:linear-gradient(165deg,rgba(15,23,42,.96),rgba(2,6,23,.94));backdrop-filter:blur(14px);box-shadow:0 18px 60px rgba(2,6,23,.7),0 0 40px ${v.pillarBoard?.color}26;padding:13px 14px;display:flex;flex-direction:column;gap:11px;animation:wr-rise 340ms cubic-bezier(.22,1,.36,1)`)}>
      <div style={css(`display:flex;align-items:center;gap:8px`)}>
        <span style={css(`width:6px;height:6px;border-radius:99px;background:${v.pillarBoard?.color};box-shadow:0 0 10px ${v.pillarBoard?.color};animation:wr-blink 1.6s ease-in-out infinite`)} />
        <span style={css(`flex:1;font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#e2e8f0`)}>
          <Txt v={v.pillarBoard?.title} />
        </span>
        <span style={css(`font-size:9px;font-weight:800;letter-spacing:.1em;font-family:ui-monospace,Menlo,monospace;color:${v.pillarBoard?.color}`)}>
          <Txt v={v.pillarBoard?.count} />
        </span>
      </div>
      <div style={css(`display:flex;flex-direction:column;gap:6px`)}>
        {(v.pillarBoard?.items || []).map((fi, fiIdx) => (
          <React.Fragment key={fiIdx}>
            {" "}
            <Hov as="div" data-tip={fi?.tip} data-tip-title={fi?.short} data-tip-value={fi?.badge} data-tip-tone={v.pillarBoard?.color} data-tip-change={fi?.change} onClick={fi?.onClick} style={css(`display:flex;gap:9px;padding:8px 10px;border-radius:10px;cursor:pointer;border:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.55);transition:all 220ms cubic-bezier(.22,1,.36,1);animation:wr-rise 420ms cubic-bezier(.22,1,.36,1)`)} hoverStyle={css(`border-color:${v.pillarBoard?.color};background:rgba(2,6,23,.85)`)}>
              <span style={css(`flex:none;margin-top:4px;width:6px;height:6px;border-radius:99px;background:${v.pillarBoard?.color}`)} />
              <div style={css(`flex:1;min-width:0;display:flex;flex-direction:column;gap:2px`)}>
                <span style={css(`font-size:10.5px;font-weight:700;line-height:1.35;color:#e2e8f0;text-wrap:pretty`)}>
                  <Txt v={fi?.t} />
                </span>
                <span style={css(`font-size:9px;line-height:1.4;color:#94a3b8;text-wrap:pretty`)}>
                  <Txt v={fi?.m} />
                </span>
                <span style={css(`font-size:8.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${v.pillarBoard?.color}`)}>
                  <Txt v={fi?.sow} />
                </span>
              </div>
            </Hov>
            {" "}
          </React.Fragment>
        ))}
      </div>
      <span style={css(`font-size:9px;line-height:1.45;color:#64748b;text-wrap:pretty`)}>
        <Txt v={v.pillarBoard?.note} />
      </span>
    </div>
    {" "}
    </>
  );
}
