/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `gov.showDoc`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import React from "react";
import { css, Txt, Hov } from "../runtime";

export function PillarDiveDocViewer({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div style={css(`position:absolute;inset:0;z-index:5;display:flex;flex-direction:column;background:linear-gradient(168deg,rgba(15,23,42,.99),rgba(2,6,23,.99));animation:wr-rise 340ms cubic-bezier(.22,1,.36,1)`)}>
      <div style={css(`position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(103,232,249,.045) 0px,rgba(103,232,249,.045) 1px,transparent 1px,transparent 4px);opacity:.55`)} />
      <div style={css(`position:relative;flex:none;display:flex;align-items:center;gap:11px;padding:12px 15px;border-bottom:1px solid ${v.dcfg?.color}4d`)}>
        <span style={css(`flex:none;width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:${v.dcfg?.color}`)}>
          <svg width={"14"} height={"14"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#fff"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
            <path d={"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"} />
            <path d={"M14 2v6h6M9 13h6M9 17h6"} />
          </svg>
        </span>
        <div style={css(`flex:1;min-width:0`)}>
          {" "}
          <div style={css(`font-size:8.5px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:${v.dcfg?.ink}`)}>
            <Txt v={v.dcfg?.word} />{" deliverable"}
          </div>
          {" "}
          <div style={css(`font-size:13px;font-weight:800;letter-spacing:-.02em;color:#b3bfd2`)}>
            <Txt v={v.gdoc?.title} />
          </div>
          {" "}
        </div>
        <Hov as="button" onClick={v.gdoc?.onClose} style={css(`flex:none;height:28px;padding:0 12px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:700;color:${v.dcfg?.soft};border:1px solid ${v.dcfg?.color}80;background:${v.dcfg?.color}1f`)} hoverStyle={css(`color:${v.dcfg?.soft}`)}>
          {"Back to telemetry"}
        </Hov>
      </div>
      <div ref={v.gdoc?.setScroll} style={css(`position:relative;flex:1;min-height:0;overflow-y:auto;padding:16px 18px 34px;display:flex;flex-direction:column;gap:18px`)}>
        <div>
          {" "}
          <div style={css(`font-size:18px;font-weight:800;letter-spacing:-.03em;color:#b3bfd2;text-wrap:pretty`)}>
            <Txt v={v.gdoc?.title} />
          </div>
          {" "}
          <div style={css(`margin-top:3px;font-size:10px;color:#64748b;font-family:ui-monospace,Menlo,monospace`)}>
            <Txt v={v.gdoc?.sub} />
          </div>
          {" "}
          <div style={css(`margin-top:11px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px`)}>
            {(v.gdoc?.meta || []).map((m, mIdx) => (
              <React.Fragment key={mIdx}>
                {" "}
                <div style={css(`padding:8px 10px;border-radius:10px;border:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.55)`)}>
                  {" "}
                  <div style={css(`font-size:14px;font-weight:800;color:#a8b4c8;font-variant-numeric:tabular-nums`)}>
                    <Txt v={m?.v} />
                  </div>
                  {" "}
                  <div style={css(`font-size:8.5px;line-height:1.3;color:#94a3b8`)}>
                    <Txt v={m?.l} />
                  </div>
                  {" "}
                </div>
                {" "}
              </React.Fragment>
            ))}
          </div>
          {" "}
        </div>
        {(v.gdoc?.sections || []).map((sec, secIdx) => (
          <React.Fragment key={secIdx}>
            {" "}
            <Hov as="div" id={sec?.id} style={css(`display:flex;flex-direction:column;gap:10px;padding:10px 12px;margin:0 -12px;border-radius:13px;border:1px solid transparent;transition:all 240ms cubic-bezier(.22,1,.36,1)`)} hoverStyle={css(`border-color:${v.dcfg?.color}73;background:${v.dcfg?.color}12`)}>
              <div style={css(`display:flex;align-items:center;gap:10px;padding-bottom:6px;border-bottom:1px solid rgba(30,41,59,.9)`)}>
                <span style={css(`flex:1;min-width:0;font-size:13px;font-weight:800;letter-spacing:-.01em;color:${v.dcfg?.ink};text-wrap:pretty`)}>
                  <Txt v={sec?.h} />
                </span>
                <Hov as="button" onClick={sec?.onExplain} style={css(`flex:none;display:flex;align-items:center;gap:5px;height:24px;padding:0 10px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:10px;font-weight:800;white-space:nowrap;color:${v.dcfg?.soft};border:1px solid ${v.dcfg?.color}80;background:${v.dcfg?.color}24;opacity:.42;transition:opacity 200ms ease`)} hoverStyle={css(`opacity:1;color:${v.dcfg?.soft}`)}>
                  <svg width={"11"} height={"11"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2.2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                    <circle cx={"12"} cy={"12"} r={"10"} />
                    <path d={"M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"} />
                  </svg>
                  {"Explain this "}
                </Hov>
              </div>
              {(sec?.blocks || []).map((b, bIdx) => (
                <React.Fragment key={bIdx}>
                  {" "}
                  <Hov as="div" style={css(`display:flex;flex-direction:column;gap:5px;padding:6px 8px;margin:0 -8px;border-radius:11px;border:1px solid transparent;transition:all 200ms ease`)} hoverStyle={css(`border-color:${v.dcfg?.color}66;background:${v.dcfg?.color}0f`)}>
                    <Hov as="button" onClick={b?.onExplain} style={css(`align-self:flex-end;display:flex;align-items:center;gap:4px;height:20px;padding:0 8px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:9px;font-weight:800;white-space:nowrap;color:${v.dcfg?.soft};border:1px solid ${v.dcfg?.color}80;background:rgba(10,15,30,.94);opacity:.5;transition:opacity 180ms ease`)} hoverStyle={css(`opacity:1;color:${v.dcfg?.soft}`)}>
                      <svg width={"9"} height={"9"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2.4"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                        <circle cx={"12"} cy={"12"} r={"10"} />
                        <path d={"M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"} />
                      </svg>
                      {"Explain this "}
                    </Hov>
                    {b?.isP && (
                      <>
                        {" "}
                        <div style={css(`font-size:11.5px;line-height:1.65;color:#cbd5e1;text-wrap:pretty`)}>
                          <Txt v={b?.v} />
                        </div>
                        {" "}
                      </>
                    )}
                    {b?.isCallout && (
                      <>
                        {" "}
                        <div style={css(`padding:11px 13px;border-radius:11px;border:1px solid ${b?.cBorder};background:${b?.cBg};font-size:11.5px;line-height:1.6;color:${b?.cTone};text-wrap:pretty`)}>
                          <Txt v={b?.v} />
                        </div>
                        {" "}
                      </>
                    )}
                    {b?.isAi && (
                      <>
                        {" "}
                        <div style={css(`display:flex;gap:9px;padding:11px 13px;border-radius:11px;border:1px solid rgba(103,232,249,.3);background:rgba(0,120,212,.08)`)}>
                          <span style={css(`flex:none;margin-top:5px;width:6px;height:6px;border-radius:99px;background:#34d399`)} />
                          <span style={css(`flex:1;font-size:11px;line-height:1.6;color:#a8b4c8;text-wrap:pretty`)}>
                            <Txt v={b?.v} />
                          </span>
                        </div>
                        {" "}
                      </>
                    )}
                    {b?.isTable && (
                      <>
                        {" "}
                        <div style={css(`display:flex;flex-direction:column;border-radius:11px;overflow-x:clip;border:1px solid rgba(30,41,59,.9)`)}>
                          <div style={css(`display:grid;grid-template-columns:${b?.gridAsk};gap:6px;padding:8px 10px;background:rgba(2,6,23,.75)`)}>
                            {(b?.head || []).map((h, hIdx) => (
                              <React.Fragment key={hIdx}>
                                {" "}
                                <span style={css(`font-size:8.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#64748b`)}>
                                  <Txt v={h?.h} />
                                </span>
                                {" "}
                              </React.Fragment>
                            ))}
                            <span />
                          </div>
                          {(b?.rows || []).map((r, rIdx) => (
                            <React.Fragment key={rIdx}>
                              {" "}
                              <Hov as="div" style={css(`display:grid;grid-template-columns:${b?.gridAsk};gap:6px;align-items:center;padding:8px 10px;border-top:1px solid rgba(30,41,59,.75);transition:background 180ms ease`)} hoverStyle={css(`background:${v.dcfg?.color}1a`)}>
                                {(r?.cells || []).map((c, cIdx) => (
                                  <React.Fragment key={cIdx}>
                                    {" "}
                                    <span style={css(`font-size:10px;line-height:1.4;color:#cbd5e1;white-space:normal;overflow-wrap:anywhere`)}>
                                      <Txt v={c?.v} />
                                    </span>
                                    {" "}
                                  </React.Fragment>
                                ))}
                                <Hov as="button" onClick={r?.onAsk} data-tip={"Ask Shane about this row — he answers with the site, its grant, what sits behind it and what changes if you scope it."} aria-label={"Ask Shane about this row"} style={css(`justify-self:end;width:24px;height:24px;display:flex;align-items:center;justify-content:center;border-radius:999px;cursor:pointer;color:${v.dcfg?.soft};border:1px solid ${v.dcfg?.color}8c;background:rgba(10,15,30,.96);opacity:.6;transition:opacity 160ms ease`)} hoverStyle={css(`opacity:1;color:${v.dcfg?.soft}`)}>
                                  <svg width={"11"} height={"11"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2.2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                                    <path d={"M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"} />
                                  </svg>
                                </Hov>
                              </Hov>
                              {" "}
                            </React.Fragment>
                          ))}
                        </div>
                        {" "}
                      </>
                    )}
                    {b?.isKv && (
                      <>
                        {" "}
                        <div style={css(`display:flex;flex-direction:column;gap:5px`)}>
                          {(b?.rows || []).map((r, rIdx) => (
                            <React.Fragment key={rIdx}>
                              {" "}
                              <div style={css(`display:flex;align-items:baseline;gap:11px;padding:7px 11px;border-radius:9px;border:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.5)`)}>
                                <span style={css(`flex:1;font-size:10.5px;color:#cbd5e1`)}>
                                  <Txt v={r?.l} />
                                </span>
                                <span style={css(`flex:none;font-size:12px;font-weight:800;color:#a8b4c8;font-variant-numeric:tabular-nums`)}>
                                  <Txt v={r?.v} />
                                </span>
                              </div>
                              {" "}
                            </React.Fragment>
                          ))}
                        </div>
                        {" "}
                      </>
                    )}
                    {b?.isSteps && (
                      <>
                        {" "}
                        <div style={css(`display:flex;flex-direction:column;gap:6px`)}>
                          {(b?.rows || []).map((r, rIdx) => (
                            <React.Fragment key={rIdx}>
                              {" "}
                              <div style={css(`display:flex;gap:10px;align-items:flex-start`)}>
                                <span style={css(`flex:none;width:18px;height:18px;border-radius:99px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#fca5a5;border:1px solid rgba(248,113,113,.45);font-family:ui-monospace,Menlo,monospace`)}>
                                  <Txt v={r?.n} />
                                </span>
                                <span style={css(`flex:1;display:flex;flex-direction:column;gap:2px`)}>
                                  <span style={css(`font-size:11px;font-weight:700;color:#a8b4c8`)}>
                                    <Txt v={r?.head} />
                                  </span>
                                  <span style={css(`font-size:10px;line-height:1.5;color:#94a3b8;text-wrap:pretty`)}>
                                    <Txt v={r?.sub} />
                                  </span>
                                </span>
                              </div>
                              {" "}
                            </React.Fragment>
                          ))}
                        </div>
                        {" "}
                      </>
                    )}
                    {b?.isHowto && (
                      <>
                        {" "}
                        <div style={css(`display:flex;flex-direction:column;gap:7px;padding:12px 13px;border-radius:12px;border:1px solid ${v.dcfg?.color}59;background:${v.dcfg?.color}14`)}>
                          <div style={css(`display:flex;align-items:baseline;gap:9px;flex-wrap:wrap`)}>
                            <span style={css(`flex:1;min-width:130px;font-size:12px;font-weight:800;color:#b3bfd2`)}>
                              <Txt v={b?.title} />
                            </span>
                            <span style={css(`font-size:9px;font-weight:600;color:#94a3b8;font-family:ui-monospace,Menlo,monospace`)}>
                              <Txt v={b?.effort} />
                            </span>
                          </div>
                          {(b?.steps || []).map((st, stIdx) => (
                            <React.Fragment key={stIdx}>
                              {" "}
                              <div style={css(`display:flex;gap:9px;align-items:flex-start`)}>
                                <span style={css(`flex:none;width:17px;height:17px;border-radius:99px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:${v.dcfg?.ink};border:1px solid ${v.dcfg?.color}80;font-family:ui-monospace,Menlo,monospace`)}>
                                  <Txt v={st?.n} />
                                </span>
                                <span style={css(`flex:1;font-size:10.5px;line-height:1.55;color:#cbd5e1;text-wrap:pretty`)}>
                                  <Txt v={st?.v} />
                                </span>
                              </div>
                              {" "}
                            </React.Fragment>
                          ))}
                        </div>
                        {" "}
                      </>
                    )}
                  </Hov>
                  {" "}
                </React.Fragment>
              ))}
            </Hov>
            {" "}
          </React.Fragment>
        ))}
      </div>
    </div>
    {" "}
    </>
  );
}
