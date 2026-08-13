/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `inspector`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import React from "react";
import { css, Txt, Hov } from "../runtime";

export function InspectorPanel({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div style={css(`position:absolute;top:0;right:0;bottom:0;width:404px;z-index:60;display:flex;flex-direction:column;border-left:1px solid rgba(30,41,59,.95);background:rgba(2,6,23,.97);backdrop-filter:blur(18px);box-shadow:-30px 0 70px rgba(2,6,23,.8);animation:wr-slide-right 420ms cubic-bezier(.22,1,.36,1)`)}>
      <div style={css(`flex:none;display:flex;align-items:flex-start;gap:12px;padding:18px 20px;border-bottom:1px solid rgba(30,41,59,.8)`)}>
        <span style={css(`margin-top:6px;width:9px;height:9px;border-radius:99px;flex:none;background:${v.inspector?.color};box-shadow:0 0 12px ${v.inspector?.color}`)} />
        <div style={css(`flex:1;min-width:0`)}>
          {" "}
          <div style={css(`font-size:16px;font-weight:700;letter-spacing:-.01em;color:#f1f5f9`)}>
            <Txt v={v.inspector?.label} />
          </div>
          {" "}
          <div style={css(`font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${v.inspector?.color};margin-top:3px`)}>
            <Txt v={v.inspector?.pillar} />{" · "}<Txt v={v.inspector?.statusLabel} />
          </div>
          {" "}
        </div>
        <Hov as="button" onClick={v.onCloseInspector} style={css(`flex:none;width:28px;height:28px;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#94a3b8;border:1px solid rgba(51,65,85,.8);background:rgba(15,23,42,.6)`)} hoverStyle={css(`color:#e2e8f0`)}>
          <svg width={"14"} height={"14"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} strokeLinecap={"round"}>
            <path d={"M18 6 6 18"} />
            <path d={"m6 6 12 12"} />
          </svg>
        </Hov>
      </div>
      <div style={css(`flex:1;min-height:0;overflow-y:auto;padding:18px 20px;display:flex;flex-direction:column;gap:18px`)}>
        <div>
          {" "}
          <div style={css(`font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#64748b;margin-bottom:10px`)}>
            {"Health breakdown"}
          </div>
          {" "}
          <div style={css(`display:flex;flex-direction:column;gap:9px`)}>
            {(v.inspector?.health || []).map((h, hIdx) => (
              <React.Fragment key={hIdx}>
                {" "}
                <div>
                  {" "}
                  <div style={css(`display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:4px`)}>
                    <span style={css(`color:#94a3b8`)}>
                      <Txt v={h?.label} />
                    </span>
                    <span style={css(`font-family:ui-monospace,Menlo,monospace;color:${h?.color}`)}>
                      <Txt v={h?.value} />
                    </span>
                  </div>
                  {" "}
                  <div style={css(`height:4px;border-radius:99px;background:rgba(30,41,59,.9);overflow:hidden`)}>
                    {" "}
                    <div style={css(`height:100%;width:${h?.width};border-radius:99px;background:${h?.color}`)} />
                    {" "}
                  </div>
                  {" "}
                </div>
                {" "}
              </React.Fragment>
            ))}
          </div>
          {" "}
        </div>
        <div>
          {" "}
          <div style={css(`display:flex;justify-content:space-between;align-items:center;margin-bottom:10px`)}>
            <span style={css(`font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#64748b`)}>
              {"Graph latency · 24h"}
            </span>
            <span style={css(`font-size:10px;font-family:ui-monospace,Menlo,monospace;color:#60a5fa`)}>
              <Txt v={v.inspector?.latency} />{"ms p95"}
            </span>
          </div>
          {" "}
          <svg viewBox={"0 0 300 64"} preserveAspectRatio={"none"} style={css(`width:100%;height:64px;border-radius:10px;border:1px solid rgba(30,41,59,.9);background:rgba(15,23,42,.5)`)}>
            {" "}
            <polyline points={v.inspector?.spark} fill={"none"} stroke={v.inspector?.color} strokeWidth={"1.6"} strokeLinejoin={"round"} />
            {" "}
          </svg>
          {" "}
        </div>
        <div>
          {" "}
          <div style={css(`font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#64748b;margin-bottom:10px`)}>
            {"Graph diagnostics"}
          </div>
          {" "}
          <div style={css(`display:flex;flex-direction:column;gap:7px`)}>
            {(v.inspector?.diagnostics || []).map((d, dIdx) => (
              <React.Fragment key={dIdx}>
                {" "}
                <div style={css(`display:flex;gap:9px;padding:9px 11px;border-radius:10px;border:1px solid rgba(30,41,59,.9);background:rgba(15,23,42,.5)`)}>
                  <span style={css(`margin-top:5px;width:6px;height:6px;border-radius:99px;flex:none;background:${d?.color}`)} />
                  <div style={css(`min-width:0`)}>
                    {" "}
                    <div style={css(`font-size:11.5px;font-weight:600;color:#e2e8f0;line-height:1.45`)}>
                      <Txt v={d?.message} />
                    </div>
                    {" "}
                    <div style={css(`font-size:10px;font-family:ui-monospace,Menlo,monospace;color:#475569;margin-top:2px;overflow:hidden;text-overflow:ellipsis`)}>
                      <Txt v={d?.endpoint} />
                    </div>
                    {" "}
                  </div>
                </div>
                {" "}
              </React.Fragment>
            ))}
          </div>
          {" "}
        </div>
        <div>
          {" "}
          <div style={css(`font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#64748b;margin-bottom:10px`)}>
            {"Recommended next steps"}
          </div>
          {" "}
          <div style={css(`display:flex;flex-direction:column;gap:8px`)}>
            {(v.inspector?.actions || []).map((a, aIdx) => (
              <React.Fragment key={aIdx}>
                {" "}
                <button onClick={a?.onClick} style={css(`display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;padding:11px 13px;border-radius:10px;cursor:pointer;text-align:left;font-family:inherit;border:1px solid ${a?.border};background:${a?.bg};transition:all 180ms ease`)}>
                  <span style={css(`font-size:12px;font-weight:600;color:${a?.color}`)}>
                    <Txt v={a?.label} />
                  </span>
                  <span style={css(`font-size:10px;font-family:ui-monospace,Menlo,monospace;color:#475569`)}>
                    <Txt v={a?.eta} />
                  </span>
                </button>
                {" "}
              </React.Fragment>
            ))}
          </div>
          {" "}
        </div>
        <div>
          {" "}
          <div style={css(`font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#64748b;margin-bottom:10px`)}>
            {"Telemetry payload"}
          </div>
          {" "}
          <pre style={css(`margin:0;padding:13px;border-radius:10px;border:1px solid rgba(30,41,59,.9);background:rgba(15,23,42,.6);font-family:ui-monospace,Menlo,monospace;font-size:10.5px;line-height:1.7;color:#94a3b8;white-space:pre-wrap;word-break:break-word`)}>
            <Txt v={v.inspector?.json} />
          </pre>
          {" "}
        </div>
      </div>
    </div>
    {" "}
    </>
  );
}
