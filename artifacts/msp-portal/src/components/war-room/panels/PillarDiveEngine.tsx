/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `govOpen`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import React from "react";
import { css, Txt, Hov, ImageSlot } from "../runtime";
import { StagedChangesPanel } from "./StagedChangesPanel";
import { PillarDiveDocViewer } from "./PillarDiveDocViewer";

export function PillarDiveEngine({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div style={css(`position:absolute;inset:8px;z-index:120;min-width:0;display:flex;flex-direction:column;border-radius:20px;overflow:hidden;border:1px solid ${v.dcfg?.color}66;background:${v.dcfg?.shellBg};backdrop-filter:blur(18px);box-shadow:0 30px 80px rgba(2,6,23,.85),0 0 70px ${v.dcfg?.color}2e;animation:${v.diveAnim}`)}>
      <div style={css(`position:absolute;inset:0;z-index:0;pointer-events:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:min(2vw,18px);overflow:hidden`)}>
        <svg viewBox={"0 0 24 24"} fill={"none"} stroke={v.dcfg?.wmStroke} strokeWidth={"0.7"} strokeLinecap={"round"} strokeLinejoin={"round"} style={css(`width:min(30vw,340px);height:min(30vw,340px);transform:rotate(-4deg);animation:wr-wmdrift 22s ease-in-out infinite`)}>
          {" "}
          <path d={v.dcfg?.icon} />
          {" "}
        </svg>
        <span style={css(`font-size:min(9vw,124px);font-weight:800;letter-spacing:-.045em;line-height:.8;white-space:nowrap;color:transparent;-webkit-text-stroke:2.5px ${v.dcfg?.wmStroke};opacity:1;transform:rotate(-4deg);animation:wr-wmdrift 22s ease-in-out infinite`)}>
          <Txt v={v.dcfg?.word} />
        </span>
      </div>
      <div style={css(`position:absolute;inset:0;z-index:130;pointer-events:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:min(2vw,18px);overflow:hidden;mix-blend-mode:${v.dcfg?.wmBlend};opacity:${v.dcfg?.wmOpacity}`)}>
        <svg viewBox={"0 0 24 24"} fill={"none"} stroke={v.dcfg?.wmFill} strokeWidth={"0.7"} strokeLinecap={"round"} strokeLinejoin={"round"} style={css(`width:min(30vw,340px);height:min(30vw,340px);transform:rotate(-4deg);animation:wr-wmdrift 22s ease-in-out infinite`)}>
          {" "}
          <path d={v.dcfg?.icon} />
          {" "}
        </svg>
        <span style={css(`font-size:min(9vw,124px);font-weight:800;letter-spacing:-.045em;line-height:.8;white-space:nowrap;color:${v.dcfg?.wmFill};transform:rotate(-4deg);animation:wr-wmdrift 22s ease-in-out infinite`)}>
          <Txt v={v.dcfg?.word} />
        </span>
      </div>
      <div style={css(`position:relative;z-index:1;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:9px 14px;border-bottom:1px solid rgba(30,41,59,.9)`)}>
        <span style={css(`flex:none;width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:${v.dcfg?.color}`)}>
          <svg width={"14"} height={"14"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#fff"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
            <path d={v.dcfg?.icon} />
          </svg>
        </span>
        <div style={css(`flex:1 1 180px;min-width:0`)}>
          {" "}
          <div style={css(`font-size:8.5px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:${v.dcfg?.ink};white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>
            <Txt v={v.dcfg?.kicker} />
          </div>
          {" "}
          <div style={css(`font-size:14px;font-weight:800;letter-spacing:-.02em;color:#f1f5f9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>
            <Txt v={v.dcfg?.title} />
          </div>
          {" "}
        </div>
        <span style={css(`flex:none;font-size:10px;font-weight:700;letter-spacing:.14em;padding:5px 11px;border-radius:999px;color:${v.gov?.gateColor};border:1px solid ${v.gov?.gateColor}55;background:${v.gov?.gateColor}1a;font-family:ui-monospace,Menlo,monospace`)}>
          <Txt v={v.gov?.gate} />
        </span>
        <Hov as="button" onClick={v.onOpenGovDoc} style={css(`flex:none;display:flex;align-items:center;gap:7px;height:30px;padding:0 13px;border-radius:9px;cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:700;color:${v.dcfg?.soft};border:1px solid ${v.dcfg?.color}8c;background:${v.dcfg?.color}1f`)} hoverStyle={css(`color:${v.dcfg?.soft}`)}>
          <svg width={"13"} height={"13"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
            <path d={"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"} />
            <path d={"M14 2v6h6"} />
          </svg>
          {"Open report "}
        </Hov>
        <Hov as="button" onClick={v.gov?.onClose} style={css(`flex:none;height:30px;padding:0 14px;border-radius:9px;border:none;cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:800;color:${v.dcfg?.btnInk};background:${v.dcfg?.color};box-shadow:0 0 18px ${v.dcfg?.color}66`)} hoverStyle={css(`filter:brightness(1.15)`)}>
          {"Resume briefing"}
        </Hov>
      </div>
      <div style={css(`position:relative;z-index:1;flex:1;min-height:0;display:grid;grid-template-columns:${v.gov?.cols};transition:grid-template-columns 420ms cubic-bezier(.22,1,.36,1)`)}>
        <div style={css(`min-height:0;display:flex;flex-direction:column;border-right:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.55)`)}>
          {v.gov?.pinShow && (
            <>
              {" "}
              <div style={css(`flex:none;display:flex;align-items:center;gap:9px;padding:7px 12px;border-bottom:1px solid ${v.dcfg?.color}3d;background:linear-gradient(160deg,${v.dcfg?.color}24,rgba(2,6,23,.72));animation:wr-rise 320ms cubic-bezier(.22,1,.36,1)`)}>
                <span style={css(`flex:none;width:20px;height:20px;border-radius:8px;overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:8px;font-weight:800;color:#fff;background:linear-gradient(135deg,#0078D4,#67E8F9)`)}>
                  <ImageSlot id={"gov-pin-shane"} shape={"rounded"} radius={"7"} src={"avatars/shane.png"} placeholder={""} style={css(`width:100%;height:100%;position:relative;color:transparent`)} />
                </span>
                <span style={css(`flex:1;min-width:0;font-size:10.5px;line-height:1.35;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>
                  <Txt v={v.gov?.pin?.text} />
                </span>
                {v.gov?.pin?.hasBack && (
                  <>
                    {" "}
                    <Hov as="button" onClick={v.gov?.pin?.onBack} style={css(`flex:none;display:flex;align-items:center;gap:5px;height:28px;padding:0 11px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:10px;font-weight:800;white-space:nowrap;color:${v.dcfg?.soft};border:1px solid ${v.dcfg?.color}8c;background:${v.dcfg?.color}29`)} hoverStyle={css(`color:${v.dcfg?.soft};border-color:${v.dcfg?.ink}`)}>
                      <svg width={"10"} height={"10"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2.4"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                        <path d={"M9 14 4 9l5-5"} />
                        <path d={"M20 20v-7a4 4 0 0 0-4-4H4"} />
                      </svg>
                      <Txt v={v.gov?.pin?.backLabel} />{" "}
                    </Hov>
                    {" "}
                  </>
                )}
                {v.gov?.pin?.ctaShow && (
                  <>
                    {" "}
                    <Hov as="button" onClick={v.gov?.pin?.onCta} style={css(`flex:none;height:28px;padding:0 12px;border-radius:8px;border:none;cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:800;color:#fff;background:${v.dcfg?.color};white-space:nowrap`)} hoverStyle={css(`background:#7c5cff`)}>
                      <Txt v={v.gov?.pin?.cta} />
                    </Hov>
                    {" "}
                  </>
                )}
              </div>
              {" "}
            </>
          )}
          <div ref={v.gov?.setThread} style={css(`flex:1;min-height:0;overflow-y:auto;overflow-x:clip;padding:16px 18px;display:flex;flex-direction:column;gap:12px`)}>
            {(v.gov?.thread || []).map((m, mIdx) => (
              <React.Fragment key={mIdx}>
                {" "}
                <div style={css(`display:flex;flex-direction:${m?.align};gap:10px;align-items:flex-start;animation:wr-rise 320ms cubic-bezier(.22,1,.36,1)`)}>
                  <span style={css(`flex:none;width:30px;height:30px;border-radius:10px;overflow:hidden;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#fff;background:${m?.tile};box-shadow:0 0 16px ${m?.color}55`)}>
                    {m?.showPhoto && (
                      <>
                        {" "}
                        <ImageSlot id={m?.slot} shape={"rounded"} radius={"9"} src={m?.photo} placeholder={""} style={css(`width:100%;height:100%;position:relative;color:transparent`)} />
                        {" "}
                      </>
                    )}
                  </span>
                  <div style={css(`flex:1;min-width:0;max-width:100%;display:flex;flex-direction:column;gap:5px;overflow:hidden`)}>
                    <span style={css(`font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${m?.color}`)}>
                      <Txt v={m?.name} />
                    </span>
                    {m?.isText && (
                      <>
                        {" "}
                        <div style={css(`align-self:flex-start;max-width:94%;padding:11px 14px;border-radius:14px;border:1px solid ${m?.border};background:${m?.bg};font-size:12.5px;line-height:1.6;color:#e2e8f0;text-wrap:pretty`)}>
                          <Txt v={m?.text} />
                        </div>
                        {" "}
                      </>
                    )}
                    {m?.isCpl && (
                      <>
                        {" "}
                        <div style={css(`align-self:stretch;min-width:0;display:flex;flex-direction:column;gap:10px;padding:${v.gov?.cardPad};border-radius:15px;border:1px solid rgba(103,232,249,.55);background:linear-gradient(160deg,rgba(103,232,249,.13),rgba(2,6,23,.9));box-shadow:0 0 34px rgba(103,232,249,.18)`)}>
                          <div style={css(`display:flex;align-items:center;gap:8px`)}>
                            <span style={css(`flex:none;font-size:8.5px;font-weight:800;letter-spacing:.16em;padding:3px 8px;border-radius:7px;color:#042f2e;background:#67e8f9;font-family:ui-monospace,Menlo,monospace`)}>
                              {"COPILOT"}
                            </span>
                            <span style={css(`flex:1;min-width:0;font-size:12.5px;font-weight:800;color:#f1f5f9`)}>
                              <Txt v={m?.cpl?.title} />
                            </span>
                          </div>
                          <div style={css(`padding:9px 11px;border-radius:10px;background:rgba(2,6,23,.7);border:1px solid rgba(51,65,85,.9)`)}>
                            {" "}
                            <span style={css(`font-size:10.5px;line-height:1.5;color:#94a3b8;font-family:ui-monospace,Menlo,monospace;text-wrap:pretty`)}>
                              <Txt v={m?.cpl?.prompt} />
                            </span>
                            {" "}
                          </div>
                          <span style={css(`font-size:12px;line-height:1.65;color:#e2e8f0;text-wrap:pretty`)}>
                            <Txt v={m?.cpl?.answer} />
                          </span>
                          <div style={css(`display:flex;flex-direction:column;gap:4px;padding-top:7px;border-top:1px solid rgba(103,232,249,.25)`)}>
                            <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#67e8f9`)}>
                              {"References"}
                            </span>
                            {(m?.cpl?.cites || []).map((cc, ccIdx) => (
                              <React.Fragment key={ccIdx}>
                                {" "}
                                <div style={css(`display:flex;gap:8px;align-items:flex-start`)}>
                                  <span style={css(`flex:none;width:15px;height:15px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8.5px;font-weight:800;color:#042f2e;background:#67e8f9;font-family:ui-monospace,Menlo,monospace`)}>
                                    <Txt v={cc?.n} />
                                  </span>
                                  <span style={css(`flex:1;min-width:0;font-size:10px;line-height:1.45;color:#cbd5e1;font-family:ui-monospace,Menlo,monospace;overflow-wrap:anywhere`)}>
                                    <Txt v={cc?.c} />
                                  </span>
                                </div>
                                {" "}
                              </React.Fragment>
                            ))}
                          </div>
                          <div style={css(`display:grid;grid-template-columns:${v.gov?.gridStats};gap:6px`)}>
                            {(m?.cpl?.rows || []).map((cr, crIdx) => (
                              <React.Fragment key={crIdx}>
                                {" "}
                                <div style={css(`padding:7px 9px;border-radius:9px;border:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.6)`)}>
                                  {" "}
                                  <div style={css(`font-size:12.5px;font-weight:800;color:#e2e8f0;font-variant-numeric:tabular-nums`)}>
                                    <Txt v={cr?.v} />
                                  </div>
                                  {" "}
                                  <div style={css(`font-size:8.5px;line-height:1.3;color:#94a3b8`)}>
                                    <Txt v={cr?.l} />
                                  </div>
                                  {" "}
                                </div>
                                {" "}
                              </React.Fragment>
                            ))}
                          </div>
                          <div style={css(`display:flex;gap:9px;align-items:flex-start;padding:10px 11px;border-radius:11px;border:1.5px solid rgba(248,113,113,.7);background:linear-gradient(160deg,rgba(139,92,246,.26),rgba(69,10,10,.72))`)}>
                            <svg width={"13"} height={"13"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#fca5a5"} strokeWidth={"2.2"} strokeLinecap={"round"} strokeLinejoin={"round"} style={css(`flex:none;margin-top:2px`)}>
                              <path d={"m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3z"} />
                              <path d={"M12 9v4M12 17h.01"} />
                            </svg>
                            <span style={css(`flex:1;font-size:11px;line-height:1.55;color:#fecaca;text-wrap:pretty`)}>
                              <Txt v={m?.cpl?.warn} />
                            </span>
                          </div>
                        </div>
                        {" "}
                      </>
                    )}
                    {m?.isSizer && (
                      <>
                        {" "}
                        <div style={css(`align-self:stretch;min-width:0;display:flex;flex-direction:column;gap:11px;padding:${v.gov?.cardPad};border-radius:15px;border:1px solid rgba(20,184,166,.55);background:linear-gradient(160deg,rgba(20,184,166,.13),rgba(2,6,23,.88));box-shadow:0 0 34px rgba(20,184,166,.18)`)}>
                          <div style={css(`display:flex;align-items:center;gap:8px`)}>
                            <span style={css(`flex:none;font-size:8.5px;font-weight:800;letter-spacing:.16em;padding:3px 8px;border-radius:7px;color:#042f2e;background:#5eead4;font-family:ui-monospace,Menlo,monospace`)}>
                              {"RIGHT-SIZING"}
                            </span>
                            <span style={css(`flex:1;min-width:0;font-size:13px;font-weight:800;color:#f1f5f9`)}>
                              {"Purchased against measured need"}
                            </span>
                          </div>
                          <div style={css(`display:flex;flex-direction:column;gap:10px`)}>
                            {(m?.sizer?.rows || []).map((sk, skIdx) => (
                              <React.Fragment key={skIdx}>
                                {" "}
                                <div style={css(`display:flex;flex-direction:column;gap:5px;min-width:0`)}>
                                  <div style={css(`display:flex;align-items:baseline;gap:7px;min-width:0`)}>
                                    <span style={css(`flex:1;min-width:0;font-size:10.5px;font-weight:700;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>
                                      <Txt v={sk?.label} />
                                    </span>
                                    <span style={css(`flex:none;font-size:8.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:${sk?.gapColor}`)}>
                                      <Txt v={sk?.gapLabel} />
                                    </span>
                                  </div>
                                  <div style={css(`position:relative;height:16px;min-width:0`)}>
                                    {" "}
                                    <div style={css(`position:absolute;left:0;right:0;top:6px;height:4px;border-radius:99px;background:rgba(2,6,23,.9)`)} />
                                    {" "}
                                    <div style={css(`position:absolute;left:0;top:6px;height:4px;width:${sk?.barW};border-radius:99px;background:#67E8F9;box-shadow:0 0 10px rgba(103,232,249,.6);transition:width 300ms cubic-bezier(.22,1,.36,1)`)} />
                                    {" "}
                                    <div style={css(`position:absolute;left:${sk?.needW};top:1px;width:2px;height:14px;border-radius:99px;background:#34d399;box-shadow:0 0 8px #34d399`)} />
                                    {" "}
                                  </div>
                                  <input type={"range"} min={"0"} max={sk?.max} step={"1"} value={sk?.valRaw} onChange={sk?.onChange} onInput={sk?.onChange} style={css(`width:100%;accent-color:#14B8A6;cursor:pointer`)} />
                                  <div style={css(`display:flex;align-items:baseline;gap:7px;min-width:0`)}>
                                    <span style={css(`flex:none;font-size:13px;font-weight:800;color:#5eead4;font-variant-numeric:tabular-nums`)}>
                                      <Txt v={sk?.val} />
                                    </span>
                                    <span style={css(`flex:none;font-size:9px;color:#64748b`)}>
                                      {"seats · need "}<Txt v={sk?.need} />
                                    </span>
                                    <span style={css(`flex:1`)} />
                                    <span style={css(`flex:none;font-size:10.5px;font-weight:700;color:#cbd5e1;font-variant-numeric:tabular-nums`)}>
                                      <Txt v={sk?.cost} />
                                    </span>
                                    <button onClick={sk?.onMatch} style={css(`flex:none;height:20px;padding:0 8px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:8.5px;font-weight:800;color:#042f2e;border:none;background:#5eead4`)}>
                                      {"Match"}
                                    </button>
                                  </div>
                                </div>
                                {" "}
                              </React.Fragment>
                            ))}
                          </div>
                          <div style={css(`display:flex;flex-direction:column;gap:6px;padding:11px 12px;border-radius:12px;background:rgba(2,6,23,.66)`)}>
                            <div style={css(`display:flex;align-items:baseline;gap:8px`)}>
                              <span style={css(`flex:1;font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#64748b`)}>
                                {"Annual licence bill"}
                              </span>
                              <span style={css(`font-size:11px;font-weight:700;color:#64748b;font-variant-numeric:tabular-nums`)}>
                                <Txt v={m?.sizer?.nowTotal} />
                              </span>
                              <span style={css(`font-size:9px;color:#475569`)}>
                                {"&#8594;"}
                              </span>
                              <span style={css(`font-size:16px;font-weight:800;color:#5eead4;font-variant-numeric:tabular-nums`)}>
                                <Txt v={m?.sizer?.thenTotal} />
                              </span>
                            </div>
                            <div style={css(`display:flex;align-items:baseline;gap:8px`)}>
                              <span style={css(`flex:1;font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${m?.sizer?.deltaColor}`)}>
                                <Txt v={m?.sizer?.deltaLabel} />
                              </span>
                              <span style={css(`font-size:15px;font-weight:800;color:${m?.sizer?.deltaColor};font-variant-numeric:tabular-nums`)}>
                                <Txt v={m?.sizer?.delta} />
                              </span>
                            </div>
                          </div>
                          <div style={css(`display:flex;flex-wrap:wrap;gap:6px`)}>
                            <button onClick={m?.sizer?.onMatchAll} style={css(`height:26px;padding:0 12px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:10px;font-weight:800;color:#042f2e;border:none;background:#5eead4`)}>
                              {"Match every SKU to need"}
                            </button>
                            <button onClick={m?.sizer?.onReset} style={css(`height:26px;padding:0 12px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:10px;font-weight:700;color:#94a3b8;border:1px solid rgba(51,65,85,.9);background:rgba(2,6,23,.6)`)}>
                              {"Reset to purchased"}
                            </button>
                          </div>
                        </div>
                        {" "}
                      </>
                    )}
                    {m?.isWin && (
                      <>
                        {" "}
                        <div style={css(`align-self:stretch;display:flex;flex-direction:column;gap:10px;padding:13px 14px;border-radius:15px;border:1px solid ${m?.win?.tone}88;background:linear-gradient(160deg,${m?.win?.tone}1f,rgba(2,6,23,.88));box-shadow:0 0 34px ${m?.win?.tone}2b`)}>
                          <div style={css(`display:flex;align-items:center;gap:8px`)}>
                            <span style={css(`flex:none;font-size:8.5px;font-weight:800;letter-spacing:.16em;padding:3px 8px;border-radius:7px;color:${m?.win?.toneInk};background:${m?.win?.tone};font-family:ui-monospace,Menlo,monospace`)}>
                              <Txt v={m?.win?.tierLabel} />
                            </span>
                            <span style={css(`flex:1;min-width:0;font-size:13px;font-weight:800;letter-spacing:-.01em;color:#f1f5f9;text-wrap:pretty`)}>
                              <Txt v={m?.win?.title} />
                            </span>
                          </div>
                          <div style={css(`display:flex;flex-wrap:wrap;gap:6px`)}>
                            <span style={css(`font-size:9px;font-weight:700;padding:3px 9px;border-radius:999px;color:${m?.win?.tone};border:1px solid ${m?.win?.tone}66;background:${m?.win?.tone}1a;font-family:ui-monospace,Menlo,monospace`)}>
                              <Txt v={m?.win?.minutes} />
                            </span>
                            <span style={css(`font-size:9px;font-weight:700;padding:3px 9px;border-radius:999px;color:#7dd3fc;border:1px solid rgba(103,232,249,.4);background:rgba(0,120,212,.1);font-family:ui-monospace,Menlo,monospace`)}>
                              <Txt v={m?.win?.risk} />
                            </span>
                            <span style={css(`font-size:9px;font-weight:700;padding:3px 9px;border-radius:999px;color:#94a3b8;border:1px solid rgba(51,65,85,.9);background:rgba(2,6,23,.5);font-family:ui-monospace,Menlo,monospace`)}>
                              <Txt v={m?.win?.owner} />
                            </span>
                          </div>
                          <span style={css(`font-size:11px;line-height:1.6;color:#cbd5e1;text-wrap:pretty`)}>
                            <Txt v={m?.win?.why} />
                          </span>
                          {m?.win?.isUi && (
                            <>
                              {" "}
                              <div style={css(`display:flex;flex-direction:column;gap:8px`)}>
                                {(m?.win?.steps || []).map((st, stIdx) => (
                                  <React.Fragment key={stIdx}>
                                    {" "}
                                    <div style={css(`display:flex;gap:9px;align-items:flex-start`)}>
                                      <span style={css(`flex:none;width:17px;height:17px;border-radius:99px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:${m?.win?.tone};border:1px solid ${m?.win?.tone}88;font-family:ui-monospace,Menlo,monospace`)}>
                                        <Txt v={st?.n} />
                                      </span>
                                      <span style={css(`flex:1;min-width:0;display:flex;flex-direction:column;gap:5px`)}>
                                        <Hov as="span" onClick={st?.onAsk} style={css(`font-size:11px;line-height:1.55;color:#e2e8f0;text-wrap:pretty;cursor:pointer`)} hoverStyle={css(`color:#6ee7b7`)}>
                                          <Txt v={st?.t} />
                                        </Hov>
                                        {st?.hasLink && (
                                          <>
                                            {" "}
                                            <a href={st?.linkUrl} target={"_blank"} rel={"noopener"} style={css(`align-self:flex-start;display:flex;align-items:center;gap:5px;font-size:10.5px;font-weight:700;color:#7dd3fc;text-decoration:none;padding:3px 9px;border-radius:8px;border:1px solid rgba(103,232,249,.4);background:rgba(0,120,212,.1)`)}>
                                              <svg width={"10"} height={"10"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2.2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                                                <path d={"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"} />
                                                <path d={"M15 3h6v6M10 14 21 3"} />
                                              </svg>
                                              <Txt v={st?.linkLabel} />{" "}
                                            </a>
                                            {" "}
                                          </>
                                        )}
                                        {st?.hasCopy && (
                                          <>
                                            {" "}
                                            <Hov as="div" onClick={st?.onCopy} style={css(`align-self:stretch;display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:9px;cursor:pointer;border:1px solid rgba(51,65,85,.9);background:rgba(2,6,23,.8)`)} hoverStyle={css(`border-color:rgba(52,211,153,.6)`)}>
                                              <span style={css(`flex:1;min-width:0;font-size:10.5px;font-weight:600;color:#e2e8f0;font-family:ui-monospace,Menlo,monospace;overflow-wrap:anywhere`)}>
                                                <Txt v={st?.copy} />
                                              </span>
                                              <svg width={"12"} height={"12"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#6ee7b7"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                                                <rect width={"13"} height={"13"} x={"9"} y={"9"} rx={"2"} />
                                                <path d={"M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"} />
                                              </svg>
                                            </Hov>
                                            {" "}
                                          </>
                                        )}
                                      </span>
                                    </div>
                                    {" "}
                                  </React.Fragment>
                                ))}
                              </div>
                              {" "}
                            </>
                          )}
                          {m?.win?.isPs && (
                            <>
                              {" "}
                              <div style={css(`display:flex;flex-direction:column;gap:9px`)}>
                                <div style={css(`display:flex;flex-direction:column;gap:5px`)}>
                                  <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#7dd3fc`)}>
                                    {"Permissions required"}
                                  </span>
                                  {(m?.win?.perms || []).map((pm, pmIdx) => (
                                    <React.Fragment key={pmIdx}>
                                      {" "}
                                      <div style={css(`display:flex;gap:8px;align-items:flex-start`)}>
                                        <span style={css(`flex:none;margin-top:6px;width:4px;height:4px;border-radius:99px;background:#7dd3fc`)} />
                                        <Hov as="span" onClick={pm?.onAsk} style={css(`flex:1;font-size:10.5px;line-height:1.5;color:#cbd5e1;text-wrap:pretty;cursor:pointer`)} hoverStyle={css(`color:#7dd3fc`)}>
                                          <Txt v={pm?.v} />
                                        </Hov>
                                      </div>
                                      {" "}
                                    </React.Fragment>
                                  ))}
                                </div>
                                {m?.win?.hasPrereq && (
                                  <>
                                    {" "}
                                    <Hov as="div" onClick={m?.win?.onCopyPrereq} style={css(`display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:9px;cursor:pointer;border:1px solid rgba(51,65,85,.9);background:rgba(2,6,23,.85)`)} hoverStyle={css(`border-color:rgba(52,211,153,.6)`)}>
                                      <span style={css(`flex:1;min-width:0;font-size:10px;color:#e2e8f0;font-family:ui-monospace,Menlo,monospace;overflow-wrap:anywhere`)}>
                                        <Txt v={m?.win?.prereq} />
                                      </span>
                                      <svg width={"12"} height={"12"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#6ee7b7"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                                        <rect width={"13"} height={"13"} x={"9"} y={"9"} rx={"2"} />
                                        <path d={"M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"} />
                                      </svg>
                                    </Hov>
                                    {" "}
                                  </>
                                )}
                                <div style={css(`position:relative;border-radius:11px;border:1px solid rgba(30,41,59,.95);background:#020617;overflow:hidden`)}>
                                  {" "}
                                  <div style={css(`display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid rgba(30,41,59,.9)`)}>
                                    <span style={css(`flex:1;font-size:8.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${m?.win?.tone}`)}>
                                      {"PowerShell · "}<Txt v={m?.win?.tierLabel} />
                                    </span>
                                    <button onClick={m?.win?.onCopyScript} style={css(`height:22px;padding:0 10px;border-radius:7px;cursor:pointer;font-family:inherit;font-size:9.5px;font-weight:800;color:${m?.win?.toneInk};border:none;background:${m?.win?.tone}`)}>
                                      {"Copy script"}
                                    </button>
                                  </div>
                                  {" "}
                                  <pre style={css(`margin:0;padding:11px 12px;max-height:230px;overflow:auto;font-size:10px;line-height:1.6;color:#cbd5e1;font-family:ui-monospace,Menlo,monospace;white-space:pre`)}>
                                    <Txt v={m?.win?.script} />
                                  </pre>
                                  {" "}
                                </div>
                              </div>
                              {" "}
                            </>
                          )}
                          <div style={css(`display:flex;flex-direction:column;gap:5px;padding:10px 11px;border-radius:11px;background:rgba(2,6,23,.62)`)}>
                            <span style={css(`font-size:10.5px;line-height:1.5;color:#cbd5e1;text-wrap:pretty`)}>
                              <strong style={css(`color:#6ee7b7;font-weight:800`)}>
                                {"Verify:"}
                              </strong>
                              {" "}<Txt v={m?.win?.verify} />
                            </span>
                            <span style={css(`font-size:10.5px;line-height:1.5;color:#cbd5e1;text-wrap:pretty`)}>
                              <strong style={css(`color:#fbbf24;font-weight:800`)}>
                                {"Undo:"}
                              </strong>
                              {" "}<Txt v={m?.win?.undo} />
                            </span>
                          </div>
                          <div style={css(`display:flex;flex-wrap:wrap;gap:6px`)}>
                            {(m?.win?.qs || []).map((qq, qqIdx) => (
                              <React.Fragment key={qqIdx}>
                                {" "}
                                <Hov as="button" onClick={qq?.onClick} style={css(`height:25px;padding:0 11px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:10px;font-weight:700;color:#cbd5e1;border:1px solid rgba(51,65,85,.9);background:rgba(2,6,23,.6)`)} hoverStyle={css(`color:#f1f5f9;border-color:rgba(52,211,153,.6)`)}>
                                  <Txt v={qq?.l} />
                                </Hov>
                                {" "}
                              </React.Fragment>
                            ))}
                          </div>
                        </div>
                        {" "}
                      </>
                    )}
                    {m?.isWalk && (
                      <>
                        {" "}
                        <div style={css(`align-self:stretch;min-width:0;display:flex;flex-direction:column;gap:11px;padding:${v.gov?.cardPad};border-radius:15px;border:1px solid ${v.dcfg?.color}80;background:linear-gradient(160deg,${v.dcfg?.color}24,rgba(2,6,23,.86));box-shadow:0 0 36px ${v.dcfg?.color}33`)}>
                          {m?.walk?.isGate && (
                            <>
                              {" "}
                              <div style={css(`position:relative;overflow:hidden;display:flex;flex-direction:column;gap:10px;padding:13px 14px;margin:-13px -14px 0;border-radius:15px 15px 0 0;border-bottom:1px solid ${m?.walk?.gateEdge};background:linear-gradient(165deg,${m?.walk?.gateWash},rgba(2,6,23,.9))`)}>
                                <div style={css(`position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(255,255,255,.035) 0px,rgba(255,255,255,.035) 1px,transparent 1px,transparent 5px)`)} />
                                <div style={css(`position:relative;display:flex;align-items:center;gap:9px`)}>
                                  <span style={css(`flex:none;width:26px;height:26px;border-radius:99px;display:flex;align-items:center;justify-content:center;border:1.5px solid ${m?.walk?.gateColor};background:${m?.walk?.gateColor}22;box-shadow:0 0 18px ${m?.walk?.gateColor}66;animation:wr-blink 1.8s ease-in-out infinite`)}>
                                    <svg width={"13"} height={"13"} viewBox={"0 0 24 24"} fill={"none"} stroke={m?.walk?.gateColor} strokeWidth={"2.6"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                                      <path d={m?.walk?.gateIcon} />
                                    </svg>
                                  </span>
                                  <span style={css(`flex:1;min-width:0;display:flex;flex-direction:column;gap:1px`)}>
                                    <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.2em;text-transform:uppercase;color:#94a3b8`)}>
                                      {"Copilot deployment gate"}
                                    </span>
                                    <span style={css(`font-size:16px;font-weight:800;letter-spacing:-.02em;color:${m?.walk?.gateColor}`)}>
                                      <Txt v={m?.walk?.gateVerdict} />
                                    </span>
                                  </span>
                                </div>
                                <div style={css(`position:relative;display:flex;flex-direction:column;gap:6px`)}>
                                  <div style={css(`position:relative;height:30px`)}>
                                    {" "}
                                    <div style={css(`position:absolute;left:0;right:0;top:13px;height:4px;border-radius:99px;background:rgba(2,6,23,.9);border:1px solid rgba(30,41,59,.95)`)} />
                                    {" "}
                                    <div style={css(`position:absolute;left:0;top:13px;height:4px;width:${m?.walk?.gateNowW};border-radius:99px;background:#f87171;box-shadow:0 0 10px rgba(248,113,113,.7)`)} />
                                    {" "}
                                    <div style={css(`position:absolute;left:${m?.walk?.gateNowW};top:13px;height:4px;width:${m?.walk?.gateGapW};border-radius:99px;background:linear-gradient(90deg,rgba(248,113,113,.5),${m?.walk?.gateColor});box-shadow:0 0 12px ${m?.walk?.gateColor}88;transition:all 700ms cubic-bezier(.22,1,.36,1)`)} />
                                    {" "}
                                    <div style={css(`position:absolute;left:${m?.walk?.gateThenW};top:8px;transform:translateX(-50%);width:3px;height:14px;border-radius:99px;background:${m?.walk?.gateColor};box-shadow:0 0 12px ${m?.walk?.gateColor};transition:left 700ms cubic-bezier(.22,1,.36,1)`)} />
                                    {" "}
                                    <div style={css(`position:absolute;left:75%;top:2px;bottom:2px;width:2px;transform:translateX(-50%);background:repeating-linear-gradient(180deg,#e2e8f0 0 3px,transparent 3px 6px);opacity:.75`)} />
                                    {" "}
                                    <span style={css(`position:absolute;left:75%;top:-2px;transform:translateX(-50%) translateY(-100%);font-size:7.5px;font-weight:800;letter-spacing:.12em;color:#cbd5e1;white-space:nowrap;font-family:ui-monospace,Menlo,monospace`)}>
                                      {"GATE 75"}
                                    </span>
                                    {" "}
                                  </div>
                                  <div style={css(`display:flex;align-items:baseline;gap:7px`)}>
                                    <span style={css(`flex:none;font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#f87171`)}>
                                      {"Now "}<Txt v={m?.walk?.gateNow} />
                                    </span>
                                    <span style={css(`flex:1;height:1px;background:linear-gradient(90deg,rgba(248,113,113,.4),${m?.walk?.gateColor}88)`)} />
                                    <span style={css(`flex:none;font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:${m?.walk?.gateColor}`)}>
                                      {"With changes "}<Txt v={m?.walk?.gateThen} />
                                    </span>
                                  </div>
                                </div>
                                <div style={css(`position:relative;display:flex;flex-direction:column;gap:5px`)}>
                                  <span style={css(`font-size:8px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#94a3b8`)}>
                                    <Txt v={m?.walk?.gateBlockLabel} />
                                  </span>
                                  {(m?.walk?.gateBlockers || []).map((gb, gbIdx) => (
                                    <React.Fragment key={gbIdx}>
                                      {" "}
                                      <div style={css(`display:flex;align-items:center;gap:7px`)}>
                                        <span style={css(`flex:none;width:14px;height:14px;border-radius:99px;display:flex;align-items:center;justify-content:center;border:1px solid ${gb?.c};background:${gb?.c}1f`)}>
                                          <svg width={"8"} height={"8"} viewBox={"0 0 24 24"} fill={"none"} stroke={gb?.c} strokeWidth={"3.4"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                                            <path d={gb?.icon} />
                                          </svg>
                                        </span>
                                        <span style={css(`flex:1;min-width:0;font-size:10.5px;line-height:1.4;color:${gb?.ink};text-wrap:pretty`)}>
                                          <Txt v={gb?.t} />
                                        </span>
                                      </div>
                                      {" "}
                                    </React.Fragment>
                                  ))}
                                </div>
                                <span style={css(`position:relative;font-size:10px;line-height:1.5;color:#cbd5e1;text-wrap:pretty`)}>
                                  <Txt v={m?.walk?.gateNote} />
                                </span>
                              </div>
                              {" "}
                            </>
                          )}
                          {m?.walk?.hasLead && (
                            <>
                              {" "}
                              <span style={css(`font-size:12px;line-height:1.6;color:#e2e8f0;text-wrap:pretty`)}>
                                <Txt v={m?.walk?.lead} />
                              </span>
                              {" "}
                            </>
                          )}
                          <div style={css(`display:flex;align-items:center;gap:9px`)}>
                            <span style={css(`flex:none;font-size:9px;font-weight:800;letter-spacing:.14em;padding:3px 8px;border-radius:7px;color:${v.dcfg?.soft};border:1px solid ${v.dcfg?.color}80;background:${v.dcfg?.color}29;font-family:ui-monospace,Menlo,monospace`)}>
                              <Txt v={m?.walk?.n} />
                            </span>
                            <Hov as="span" data-tip={m?.walk?.titleTip} onClick={m?.walk?.onTitle} style={css(`flex:1;min-width:0;font-size:13.5px;font-weight:800;letter-spacing:-.01em;color:#f1f5f9;cursor:pointer`)} hoverStyle={css(`color:${v.dcfg?.soft}`)}>
                              <Txt v={m?.walk?.title} />
                            </Hov>
                          </div>
                          <Hov as="div" data-tip={m?.walk?.headTip} data-tip-title={m?.walk?.title} data-tip-value={m?.walk?.headV} data-tip-tone={m?.walk?.headTone} data-tip-spark={m?.walk?.spark} data-tip-stats={m?.walk?.stats} data-tip-change={m?.walk?.change} onClick={m?.walk?.onHead} style={css(`display:flex;align-items:baseline;gap:10px;padding:11px 13px;border-radius:12px;cursor:pointer;background:rgba(2,6,23,.66);border:1px solid ${m?.walk?.headTone}44;transition:all 200ms ease`)} hoverStyle={css(`border-color:${m?.walk?.headTone};background:rgba(2,6,23,.9)`)}>
                            <span style={css(`flex:none;font-size:${v.gov?.headSize};font-weight:800;letter-spacing:-.04em;line-height:1;color:${m?.walk?.headTone};font-variant-numeric:tabular-nums`)}>
                              <Txt v={m?.walk?.headV} />
                            </span>
                            <span style={css(`flex:1;min-width:0;display:flex;flex-direction:column;gap:2px`)}>
                              <span style={css(`font-size:11px;font-weight:700;color:#e2e8f0;text-wrap:pretty`)}>
                                <Txt v={m?.walk?.headL} />
                              </span>
                              <span style={css(`font-size:9.5px;color:#94a3b8;text-wrap:pretty`)}>
                                <Txt v={m?.walk?.headNote} />
                              </span>
                            </span>
                          </Hov>
                          <div style={css(`display:flex;flex-direction:column;gap:8px`)}>
                            <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#64748b`)}>
                              <Txt v={m?.walk?.chartTitle} />
                            </span>
                            {m?.walk?.isBars && (
                              <>
                                {" "}
                                <div style={css(`display:flex;flex-direction:column;gap:7px`)}>
                                  {(m?.walk?.bars || []).map((b, bIdx) => (
                                    <React.Fragment key={bIdx}>
                                      {" "}
                                      <Hov as="div" data-tip={b?.tip} data-tip-title={b?.l} data-tip-value={b?.v} data-tip-tone={b?.c} data-tip-spark={b?.spark} data-tip-stats={b?.stats} data-tip-change={b?.change} onClick={b?.onClick} style={css(`display:flex;flex-direction:column;gap:3px;min-width:0;cursor:pointer;padding:3px 5px;margin:0 -5px;border-radius:8px;transition:background 200ms ease`)} hoverStyle={css(`background:${v.dcfg?.color}24`)}>
                                        <div style={css(`display:flex;align-items:baseline;gap:8px`)}>
                                          <span style={css(`flex:1;min-width:0;font-size:10.5px;font-weight:600;color:#cbd5e1;text-wrap:pretty`)}>
                                            <Txt v={b?.l} />
                                          </span>
                                          <span style={css(`flex:none;font-size:11px;font-weight:800;color:${b?.c};font-variant-numeric:tabular-nums`)}>
                                            <Txt v={b?.v} />
                                          </span>
                                          <span style={css(`flex:none;font-size:8.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${b?.c};opacity:.8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:40%`)}>
                                            <Txt v={b?.flag} />
                                          </span>
                                        </div>
                                        <div style={css(`height:7px;border-radius:99px;background:rgba(2,6,23,.8);overflow:hidden`)}>
                                          {" "}
                                          <div style={css(`height:100%;width:${b?.w};border-radius:99px;background:${b?.c};box-shadow:0 0 12px ${b?.c}77;transition:width 700ms cubic-bezier(.22,1,.36,1)`)} />
                                          {" "}
                                        </div>
                                      </Hov>
                                      {" "}
                                    </React.Fragment>
                                  ))}
                                </div>
                                {" "}
                              </>
                            )}
                            {m?.walk?.isHeat && (
                              <>
                                {" "}
                                <div style={css(`display:grid;grid-template-columns:${v.gov?.gridStats};gap:7px`)}>
                                  {(m?.walk?.heat || []).map((h, hIdx) => (
                                    <React.Fragment key={hIdx}>
                                      {" "}
                                      <Hov as="div" data-tip={h?.tip} data-tip-title={h?.l} data-tip-value={h?.v} data-tip-tone={h?.c} data-tip-stats={h?.stats} data-tip-change={h?.change} onClick={h?.onClick} style={css(`display:flex;flex-direction:column;gap:2px;padding:9px 10px;border-radius:11px;cursor:pointer;border:1px solid ${h?.bd};background:${h?.bg};transition:all 200ms ease`)} hoverStyle={css(`border-color:${v.dcfg?.ink}`)}>
                                        <span style={css(`font-size:10px;font-weight:700;color:#e2e8f0;text-wrap:pretty`)}>
                                          <Txt v={h?.l} />
                                        </span>
                                        <span style={css(`font-size:12px;font-weight:800;color:${h?.c};font-variant-numeric:tabular-nums`)}>
                                          <Txt v={h?.v} />
                                        </span>
                                        <span style={css(`font-size:9px;color:#94a3b8;text-wrap:pretty`)}>
                                          <Txt v={h?.sub} />
                                        </span>
                                      </Hov>
                                      {" "}
                                    </React.Fragment>
                                  ))}
                                </div>
                                {" "}
                              </>
                            )}
                          </div>
                          <div style={css(`display:flex;flex-direction:column;gap:6px;padding:11px 12px;border-radius:12px;border:1px solid rgba(248,113,113,.34);background:rgba(248,113,113,.07)`)}>
                            <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#fca5a5`)}>
                              {"What's wrong"}
                            </span>
                            {(m?.walk?.wrong || []).map((w, wIdx) => (
                              <React.Fragment key={wIdx}>
                                {" "}
                                <Hov as="div" data-tip={w?.tip} onClick={w?.onClick} style={css(`display:flex;gap:8px;align-items:flex-start;cursor:pointer;padding:3px 5px;margin:0 -5px;border-radius:8px;transition:background 200ms ease`)} hoverStyle={css(`background:rgba(248,113,113,.14)`)}>
                                  <span style={css(`flex:none;margin-top:6px;width:5px;height:5px;border-radius:99px;background:#f87171`)} />
                                  <span style={css(`flex:1;font-size:10.5px;line-height:1.55;color:#e2e8f0;text-wrap:pretty`)}>
                                    <Txt v={w?.v} />
                                  </span>
                                </Hov>
                                {" "}
                              </React.Fragment>
                            ))}
                          </div>
                          <div style={css(`display:flex;flex-direction:column;gap:6px;padding:11px 12px;border-radius:12px;border:1px solid rgba(52,211,153,.34);background:rgba(16,185,129,.07)`)}>
                            <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#6ee7b7`)}>
                              {"Resolution"}
                            </span>
                            {(m?.walk?.fix || []).map((fx, fxIdx) => (
                              <React.Fragment key={fxIdx}>
                                {" "}
                                <Hov as="div" data-tip={fx?.tip} onClick={fx?.onClick} style={css(`display:flex;gap:9px;align-items:flex-start;cursor:pointer;padding:3px 5px;margin:0 -5px;border-radius:8px;transition:background 200ms ease`)} hoverStyle={css(`background:rgba(16,185,129,.14)`)}>
                                  <span style={css(`flex:none;width:16px;height:16px;border-radius:99px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#6ee7b7;border:1px solid rgba(52,211,153,.5);font-family:ui-monospace,Menlo,monospace`)}>
                                    <Txt v={fx?.n} />
                                  </span>
                                  <span style={css(`flex:1;font-size:10.5px;line-height:1.55;color:#cbd5e1;text-wrap:pretty`)}>
                                    <Txt v={fx?.v} />
                                  </span>
                                </Hov>
                                {" "}
                              </React.Fragment>
                            ))}
                          </div>
                          {m?.walk?.hasTimeline && (
                            <>
                              {" "}
                              <div style={css(`display:flex;flex-direction:column;gap:9px;padding:12px 12px;border-radius:13px;border:1px solid rgba(0,180,216,.32);background:rgba(2,6,23,.6)`)}>
                                <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#7dd3fc`)}>
                                  {"Gantt · 12-week critical path"}
                                </span>
                                <div style={css(`display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:0`)}>
                                  {(m?.walk?.ganttScale || []).map((gs, gsIdx) => (
                                    <React.Fragment key={gsIdx}>
                                      {" "}
                                      <span style={css(`font-size:7.5px;font-weight:700;text-align:center;color:#475569;font-family:ui-monospace,Menlo,monospace;border-left:1px solid rgba(30,41,59,.9)`)}>
                                        <Txt v={gs?.n} />
                                      </span>
                                      {" "}
                                    </React.Fragment>
                                  ))}
                                </div>
                                <div style={css(`display:flex;flex-direction:column;gap:5px`)}>
                                  {(m?.walk?.gantt || []).map((gb, gbIdx) => (
                                    <React.Fragment key={gbIdx}>
                                      {" "}
                                      <div style={css(`display:flex;flex-direction:column;gap:2px`)}>
                                        <div style={css(`display:flex;align-items:baseline;gap:7px`)}>
                                          <span style={css(`flex:1;min-width:0;font-size:9.5px;font-weight:700;color:#cbd5e1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>
                                            <Txt v={gb?.l} />
                                          </span>
                                          <span style={css(`flex:none;font-size:8px;font-weight:700;color:${gb?.c};font-family:ui-monospace,Menlo,monospace`)}>
                                            <Txt v={gb?.span} />
                                          </span>
                                          <span style={css(`flex:none;font-size:8px;color:#64748b`)}>
                                            <Txt v={gb?.own} />
                                          </span>
                                        </div>
                                        <div style={css(`position:relative;height:9px;border-radius:4px;background:rgba(2,6,23,.85);overflow:hidden`)}>
                                          {" "}
                                          <div style={css(`position:absolute;top:0;bottom:0;left:${gb?.left};width:${gb?.width};border-radius:4px;background:${gb?.c};opacity:.82;box-shadow:0 0 10px ${gb?.c}66`)} />
                                          {" "}
                                        </div>
                                      </div>
                                      {" "}
                                    </React.Fragment>
                                  ))}
                                </div>
                              </div>
                              {" "}
                              <div style={css(`display:flex;flex-direction:column;gap:8px;padding:12px 12px;border-radius:13px;border:1px solid rgba(52,211,153,.32);background:rgba(2,6,23,.6)`)}>
                                <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#6ee7b7`)}>
                                  {"Readiness burn-up"}
                                </span>
                                <div style={css(`display:flex;align-items:flex-end;gap:4px;height:74px`)}>
                                  {(m?.walk?.burnup || []).map((bu, buIdx) => (
                                    <React.Fragment key={buIdx}>
                                      {" "}
                                      <div style={css(`flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;height:100%;justify-content:flex-end`)}>
                                        <span style={css(`font-size:7.5px;font-weight:800;color:${bu?.c};font-family:ui-monospace,Menlo,monospace`)}>
                                          <Txt v={bu?.v} />
                                        </span>
                                        <div style={css(`width:100%;height:${bu?.h};border-radius:3px 3px 0 0;background:${bu?.c};opacity:.75`)} />
                                        <span style={css(`font-size:7px;color:#475569;font-family:ui-monospace,Menlo,monospace`)}>
                                          <Txt v={bu?.n} />
                                        </span>
                                      </div>
                                      {" "}
                                    </React.Fragment>
                                  ))}
                                </div>
                              </div>
                              {" "}
                              <div style={css(`display:flex;flex-direction:column;gap:6px;padding:12px 12px;border-radius:13px;border:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.55)`)}>
                                <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#94a3b8`)}>
                                  {"Milestones"}
                                </span>
                                {(m?.walk?.milestones || []).map((ms, msIdx) => (
                                  <React.Fragment key={msIdx}>
                                    {" "}
                                    <div style={css(`display:flex;align-items:center;gap:9px`)}>
                                      <span style={css(`flex:none;width:30px;font-size:9px;font-weight:800;color:${ms?.c};font-family:ui-monospace,Menlo,monospace`)}>
                                        <Txt v={ms?.w} />
                                      </span>
                                      <span style={css(`flex:none;width:7px;height:7px;border-radius:99px;background:${ms?.c};box-shadow:0 0 9px ${ms?.c}`)} />
                                      <span style={css(`flex:1;min-width:0;font-size:10px;color:#cbd5e1;text-wrap:pretty`)}>
                                        <Txt v={ms?.l} />
                                      </span>
                                      <span style={css(`flex:none;font-size:9px;font-weight:800;color:#6ee7b7;font-family:ui-monospace,Menlo,monospace`)}>
                                        <Txt v={ms?.r} />
                                      </span>
                                    </div>
                                    {" "}
                                  </React.Fragment>
                                ))}
                              </div>
                              {" "}
                              <div style={css(`display:flex;flex-direction:column;gap:0`)}>
                                {(m?.walk?.weeks || []).map((wk, wkIdx) => (
                                  <React.Fragment key={wkIdx}>
                                    {" "}
                                    <div style={css(`display:flex;gap:11px;min-width:0`)}>
                                      <div style={css(`flex:none;width:26px;display:flex;flex-direction:column;align-items:center`)}>
                                        <span style={css(`flex:none;width:22px;height:22px;border-radius:99px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#fff;background:${wk?.color};box-shadow:0 0 12px ${wk?.color}88;font-family:ui-monospace,Menlo,monospace`)}>
                                          <Txt v={wk?.n} />
                                        </span>
                                        <span style={css(`flex:1;width:2px;background:linear-gradient(180deg,${wk?.color}66,rgba(30,41,59,.5));min-height:12px`)} />
                                      </div>
                                      <div style={css(`flex:1;min-width:0;padding-bottom:14px;display:flex;flex-direction:column;gap:5px`)}>
                                        <div style={css(`display:flex;align-items:baseline;gap:8px;min-width:0`)}>
                                          <span style={css(`flex:none;font-size:8.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${wk?.color};font-family:ui-monospace,Menlo,monospace`)}>
                                            <Txt v={wk?.w} />
                                          </span>
                                          <span style={css(`flex:1;min-width:0;font-size:11.5px;font-weight:800;color:#f1f5f9;text-wrap:pretty`)}>
                                            <Txt v={wk?.title} />
                                          </span>
                                        </div>
                                        {(wk?.items || []).map((wi, wiIdx) => (
                                          <React.Fragment key={wiIdx}>
                                            {" "}
                                            <div style={css(`display:flex;gap:7px;align-items:flex-start`)}>
                                              <span style={css(`flex:none;margin-top:5px;width:4px;height:4px;border-radius:99px;background:${wk?.color}`)} />
                                              <span style={css(`flex:1;font-size:10px;line-height:1.5;color:#cbd5e1;text-wrap:pretty`)}>
                                                <Txt v={wi?.v} />
                                              </span>
                                            </div>
                                            {" "}
                                          </React.Fragment>
                                        ))}
                                      </div>
                                    </div>
                                    {" "}
                                  </React.Fragment>
                                ))}
                              </div>
                              {" "}
                            </>
                          )}
                          {m?.walk?.hasLibrary && (
                            <>
                              {" "}
                              <div style={css(`display:flex;flex-direction:column;gap:8px`)}>
                                <div style={css(`display:flex;align-items:center;gap:9px;padding:10px 12px;border-radius:12px;border:1px solid rgba(0,180,216,.42);background:linear-gradient(160deg,rgba(0,120,212,.16),rgba(2,6,23,.8))`)}>
                                  <span style={css(`flex:none;width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:rgba(0,180,216,.2)`)}>
                                    <svg width={"14"} height={"14"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#7dd3fc"} strokeWidth={"2.2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                                      <path d={"M12 3v12M7 11l5 5 5-5M5 21h14"} />
                                    </svg>
                                  </span>
                                  <span style={css(`flex:1;min-width:0;display:flex;flex-direction:column;gap:1px`)}>
                                    <span style={css(`font-size:11px;font-weight:800;color:#e0f2fe`)}>
                                      <Txt v={m?.walk?.dlAllTitle} />
                                    </span>
                                    <span style={css(`font-size:9px;color:#94a3b8;font-family:ui-monospace,Menlo,monospace`)}>
                                      <Txt v={m?.walk?.dlAllMeta} />
                                    </span>
                                  </span>
                                  <Hov as="button" onClick={m?.walk?.onDownloadAll} style={css(`flex:none;height:28px;padding:0 13px;border-radius:8px;border:none;cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:800;color:#04121f;background:#7dd3fc`)} hoverStyle={css(`background:#bae6fd`)}>
                                    {"Download all"}
                                  </Hov>
                                </div>
                                {(m?.walk?.library || []).map((dl, dlIdx) => (
                                  <React.Fragment key={dlIdx}>
                                    {" "}
                                    <Hov as="div" onClick={dl?.onOpen} style={css(`display:flex;flex-direction:column;gap:6px;padding:11px 12px;border-radius:12px;cursor:pointer;border:1px solid ${dl?.color}59;background:linear-gradient(160deg,${dl?.color}14,rgba(2,6,23,.72));transition:all 220ms cubic-bezier(.22,1,.36,1)`)} hoverStyle={css(`border-color:${dl?.color};background:linear-gradient(160deg,${dl?.color}29,rgba(2,6,23,.85))`)}>
                                      <div style={css(`display:flex;align-items:center;gap:8px;min-width:0`)}>
                                        <span style={css(`flex:none;font-size:8.5px;font-weight:800;letter-spacing:.14em;padding:2px 7px;border-radius:6px;color:#fff;background:${dl?.color};font-family:ui-monospace,Menlo,monospace`)}>
                                          <Txt v={dl?.n} />
                                        </span>
                                        <span style={css(`flex:1;min-width:0;font-size:11.5px;font-weight:800;color:#f1f5f9;text-wrap:pretty`)}>
                                          <Txt v={dl?.title} />
                                        </span>
                                        <svg width={"12"} height={"12"} viewBox={"0 0 24 24"} fill={"none"} stroke={dl?.color} strokeWidth={"2.4"} strokeLinecap={"round"} strokeLinejoin={"round"} style={css(`flex:none`)}>
                                          <path d={"M5 12h14M13 6l6 6-6 6"} />
                                        </svg>
                                      </div>
                                      <span style={css(`font-size:10.5px;line-height:1.55;color:#cbd5e1;text-wrap:pretty`)}>
                                        <Txt v={dl?.summary} />
                                      </span>
                                      <div style={css(`display:flex;gap:7px;align-items:center;padding:6px 8px;border-radius:8px;background:rgba(2,6,23,.6)`)}>
                                        <span style={css(`flex:none;width:13px;height:13px;border-radius:99px;display:flex;align-items:center;justify-content:center;background:${dl?.color}33`)}>
                                          <svg width={"8"} height={"8"} viewBox={"0 0 24 24"} fill={"none"} stroke={dl?.color} strokeWidth={"3"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                                            <path d={"M12 3v3M12 18v3M3 12h3M18 12h3"} />
                                          </svg>
                                        </span>
                                        <span style={css(`flex:1;min-width:0;font-size:9.5px;line-height:1.45;color:#94a3b8;text-wrap:pretty`)}>
                                          <Txt v={dl?.ai} />
                                        </span>
                                      </div>
                                      <div style={css(`display:flex;align-items:center;gap:8px`)}>
                                        <span style={css(`flex:1;min-width:0;font-size:9px;font-weight:700;color:#64748b;font-family:ui-monospace,Menlo,monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>
                                          <Txt v={dl?.meta} />
                                        </span>
                                        <span style={css(`flex:none;font-size:8.5px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:${dl?.color}`)}>
                                          <Txt v={dl?.findings} />
                                        </span>
                                      </div>
                                      <div style={css(`display:flex;align-items:center;gap:6px;padding-top:7px;border-top:1px solid rgba(30,41,59,.85)`)}>
                                        <span style={css(`flex:1;min-width:0;font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${dl?.stateInk}`)}>
                                          <Txt v={dl?.state} />
                                        </span>
                                        <Hov as="button" onClick={dl?.onPdf} style={css(`flex:none;height:24px;padding:0 10px;border-radius:7px;cursor:pointer;font-family:inherit;font-size:9.5px;font-weight:800;color:${dl?.color};border:1px solid ${dl?.color}66;background:${dl?.color}1a;display:flex;align-items:center;gap:5px`)} hoverStyle={css(`color:#fff;border-color:${dl?.color}`)}>
                                          <svg width={"10"} height={"10"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2.4"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                                            <path d={"M12 3v12M7 11l5 5 5-5M5 21h14"} />
                                          </svg>
                                          {"PDF "}
                                        </Hov>
                                        <Hov as="button" onClick={dl?.onDocx} style={css(`flex:none;height:24px;padding:0 10px;border-radius:7px;cursor:pointer;font-family:inherit;font-size:9.5px;font-weight:800;color:#94a3b8;border:1px solid rgba(51,65,85,.95);background:rgba(2,6,23,.6)`)} hoverStyle={css(`color:#e2e8f0`)}>
                                          {"DOCX"}
                                        </Hov>
                                      </div>
                                    </Hov>
                                    {" "}
                                  </React.Fragment>
                                ))}
                              </div>
                              {" "}
                            </>
                          )}
                          {m?.walk?.hasScoping && (
                            <>
                              {" "}
                              <div style={css(`display:flex;flex-direction:column;gap:9px`)}>
                                {(m?.walk?.phases || []).map((ph, phIdx) => (
                                  <React.Fragment key={phIdx}>
                                    {" "}
                                    <div style={css(`display:flex;flex-direction:column;gap:6px;padding:11px 12px;border-radius:12px;border:1px solid ${ph?.border};background:${ph?.bg};opacity:${ph?.opacity};transition:all 300ms cubic-bezier(.22,1,.36,1)`)}>
                                      <div style={css(`display:flex;align-items:baseline;gap:8px;min-width:0`)}>
                                        <span style={css(`flex:none;font-size:8.5px;font-weight:800;letter-spacing:.12em;color:${ph?.ink};font-family:ui-monospace,Menlo,monospace`)}>
                                          <Txt v={ph?.n} />
                                        </span>
                                        <span style={css(`flex:1;min-width:0;font-size:11.5px;font-weight:800;color:#f1f5f9;text-wrap:pretty`)}>
                                          <Txt v={ph?.title} />
                                        </span>
                                        <span style={css(`flex:none;font-size:8px;font-weight:800;letter-spacing:.12em;padding:2px 7px;border-radius:999px;color:${ph?.ink};border:1px solid ${ph?.border}`)}>
                                          <Txt v={ph?.state} />
                                        </span>
                                      </div>
                                      <span style={css(`font-size:10.5px;line-height:1.55;color:#cbd5e1;text-wrap:pretty`)}>
                                        <Txt v={ph?.detail} />
                                      </span>
                                      <div style={css(`display:flex;flex-direction:column;gap:3px`)}>
                                        {(ph?.items || []).map((pi, piIdx) => (
                                          <React.Fragment key={piIdx}>
                                            {" "}
                                            <div style={css(`display:flex;gap:7px;align-items:flex-start`)}>
                                              <span style={css(`flex:none;margin-top:5px;width:4px;height:4px;border-radius:99px;background:${ph?.ink}`)} />
                                              <span style={css(`flex:1;font-size:9.5px;line-height:1.45;color:#94a3b8;text-wrap:pretty`)}>
                                                <Txt v={pi?.v} />
                                              </span>
                                            </div>
                                            {" "}
                                          </React.Fragment>
                                        ))}
                                      </div>
                                      <div style={css(`display:flex;align-items:center;gap:8px;flex-wrap:wrap`)}>
                                        <span style={css(`flex:none;font-size:13px;font-weight:800;color:${ph?.ink};font-variant-numeric:tabular-nums`)}>
                                          <Txt v={ph?.price} />
                                        </span>
                                        <span style={css(`flex:none;font-size:9.5px;font-weight:700;color:#6ee7b7`)}>
                                          <Txt v={ph?.readiness} />{" readiness"}
                                        </span>
                                        <span style={css(`flex:1;min-width:0;font-size:9px;color:#64748b;text-align:right;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>
                                          <Txt v={ph?.weeks} />{" · "}<Txt v={ph?.owner} />
                                        </span>
                                      </div>
                                      {ph?.fixed && (
                                        <>
                                          {" "}
                                          <span style={css(`font-size:9px;color:#64748b`)}>
                                            {"Required — this is the free work you run yourselves."}
                                          </span>
                                          {" "}
                                        </>
                                      )}
                                      {ph?.scopable && (
                                        <>
                                          {" "}
                                          <Hov as="button" onClick={ph?.onToggle} style={css(`align-self:flex-start;height:24px;padding:0 11px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:9.5px;font-weight:700;color:${ph?.btnColor};border:1px solid rgba(51,65,85,.9);background:rgba(2,6,23,.6)`)} hoverStyle={css(`color:#f1f5f9`)}>
                                            <Txt v={ph?.btnLabel} />
                                          </Hov>
                                          {" "}
                                        </>
                                      )}
                                    </div>
                                    {" "}
                                  </React.Fragment>
                                ))}
                                <div style={css(`display:flex;flex-direction:column;gap:8px;padding:12px 13px;border-radius:13px;border:1px solid rgba(0,120,212,.5);background:linear-gradient(160deg,rgba(0,120,212,.14),rgba(2,6,23,.86))`)}>
                                  <div style={css(`display:flex;align-items:baseline;gap:8px;flex-wrap:wrap`)}>
                                    <span style={css(`flex:1;min-width:0;font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#7dd3fc`)}>
                                      {"Scoped total"}
                                    </span>
                                    <span style={css(`flex:none;font-size:9px;font-weight:700;color:#64748b`)}>
                                      <Txt v={m?.walk?.totals?.removed} />
                                    </span>
                                  </div>
                                  <div style={css(`display:flex;align-items:baseline;gap:9px;flex-wrap:wrap`)}>
                                    <span style={css(`font-size:22px;font-weight:800;letter-spacing:-.03em;color:#7dd3fc;font-variant-numeric:tabular-nums`)}>
                                      <Txt v={m?.walk?.totals?.price} />
                                    </span>
                                    <span style={css(`font-size:10px;color:#94a3b8`)}>
                                      {"professional services"}
                                    </span>
                                    <span style={css(`flex:1`)} />
                                    <span style={css(`font-size:11px;font-weight:700;color:#bae6fd;font-variant-numeric:tabular-nums`)}>
                                      <Txt v={m?.walk?.totals?.monthly} />
                                    </span>
                                  </div>
                                  <div style={css(`display:flex;flex-direction:column;gap:4px`)}>
                                    <div style={css(`display:flex;align-items:baseline;gap:8px`)}>
                                      <span style={css(`flex:1;font-size:9.5px;font-weight:700;color:#94a3b8`)}>
                                        {"Copilot readiness on completion"}
                                      </span>
                                      <span style={css(`font-size:17px;font-weight:800;color:${m?.walk?.totals?.readinessColor};font-variant-numeric:tabular-nums`)}>
                                        <Txt v={m?.walk?.totals?.readiness} />
                                      </span>
                                    </div>
                                    <div style={css(`position:relative;height:5px;border-radius:99px;background:rgba(2,6,23,.9);overflow:hidden`)}>
                                      {" "}
                                      <div style={css(`position:absolute;left:0;top:0;bottom:0;width:${m?.walk?.totals?.barW};border-radius:99px;background:${m?.walk?.totals?.readinessColor};transition:width 500ms cubic-bezier(.22,1,.36,1)`)} />
                                      {" "}
                                      <div style={css(`position:absolute;left:75%;top:-2px;bottom:-2px;width:2px;background:#e2e8f0;opacity:.8`)} />
                                      {" "}
                                    </div>
                                    <span style={css(`font-size:9.5px;font-weight:800;color:${m?.walk?.totals?.gateColor}`)}>
                                      <Txt v={m?.walk?.totals?.gate} />
                                    </span>
                                  </div>
                                </div>
                              </div>
                              {" "}
                            </>
                          )}
                          {m?.walk?.hasConsole && (
                            <>
                              {" "}
                              <div style={css(`display:flex;flex-direction:column;gap:9px;padding:12px 13px;border-radius:13px;border:1px solid rgba(103,232,249,.5);background:linear-gradient(160deg,rgba(103,232,249,.12),rgba(2,6,23,.88))`)}>
                                <div style={css(`display:flex;align-items:center;gap:8px`)}>
                                  <span style={css(`width:6px;height:6px;border-radius:99px;background:#67e8f9;animation:wr-blink 1.5s ease-in-out infinite`)} />
                                  <span style={css(`flex:1;font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#67e8f9`)}>
                                    {"Live Copilot · your tenant"}
                                  </span>
                                  <span style={css(`font-size:8.5px;font-weight:700;color:#64748b;font-family:ui-monospace,Menlo,monospace`)}>
                                    {"test identity"}
                                  </span>
                                </div>
                                <div style={css(`display:flex;flex-wrap:wrap;gap:5px`)}>
                                  {(m?.walk?.presets || []).map((pp, ppIdx) => (
                                    <React.Fragment key={ppIdx}>
                                      {" "}
                                      <Hov as="button" onClick={pp?.onClick} style={css(`height:24px;padding:0 10px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:9.5px;font-weight:700;color:#a5f3fc;border:1px solid rgba(103,232,249,.45);background:rgba(103,232,249,.1)`)} hoverStyle={css(`color:#cffafe;border-color:#67e8f9`)}>
                                        <Txt v={pp?.l} />
                                      </Hov>
                                      {" "}
                                    </React.Fragment>
                                  ))}
                                </div>
                                <div style={css(`display:flex;align-items:center;gap:7px`)}>
                                  <Hov as="input" value={m?.walk?.draft} onChange={m?.walk?.onDraft} onKeyDown={m?.walk?.onKey} placeholder={"Ask Copilot anything about your tenant…"} style={css(`flex:1;min-width:0;height:34px;padding:0 12px;border-radius:9px;font-family:inherit;font-size:11.5px;color:#e2e8f0;border:1px solid rgba(103,232,249,.4);background:rgba(2,6,23,.85);outline:none`)} focusStyle={css(`border-color:#67e8f9`)} />
                                  <button onClick={m?.walk?.onRun} style={css(`flex:none;height:34px;padding:0 15px;border-radius:9px;border:none;cursor:pointer;font-family:inherit;font-size:11px;font-weight:800;color:#042f2e;background:#67e8f9`)}>
                                    <Txt v={m?.walk?.runLabel} />
                                  </button>
                                </div>
                                <span style={css(`font-size:9.5px;line-height:1.5;color:#94a3b8;text-wrap:pretty`)}>
                                  {"Runs against the scan output with an unprivileged identity. Nothing is written to your tenant."}
                                </span>
                              </div>
                              {" "}
                            </>
                          )}
                          {m?.walk?.hasSwitches && (
                            <>
                              {" "}
                              <div style={css(`display:flex;flex-direction:column;gap:7px;padding:11px 12px;border-radius:12px;border:1px solid rgba(52,211,153,.4);background:rgba(16,185,129,.07)`)}>
                                <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#6ee7b7`)}>
                                  {"Change these settings"}
                                </span>
                                {(m?.walk?.switches || []).map((sw, swIdx) => (
                                  <React.Fragment key={swIdx}>
                                    {" "}
                                    <div style={css(`display:flex;align-items:center;gap:10px`)}>
                                      <span style={css(`flex:1;min-width:0;display:flex;flex-direction:column;gap:2px`)}>
                                        <span style={css(`font-size:10.5px;font-weight:700;color:${sw?.ink};text-wrap:pretty`)}>
                                          <Txt v={sw?.label} />
                                        </span>
                                        <span style={css(`font-size:9.5px;line-height:1.4;color:#94a3b8;text-wrap:pretty`)}>
                                          <Txt v={sw?.note} />
                                        </span>
                                      </span>
                                      <button onClick={sw?.onToggle} style={css(`flex:none;width:40px;height:21px;border-radius:999px;border:none;cursor:pointer;padding:2px;display:flex;justify-content:${sw?.justify};background:${sw?.track};transition:all 260ms cubic-bezier(.22,1,.36,1)`)}>
                                        <span style={css(`width:17px;height:17px;border-radius:99px;background:#fff;box-shadow:0 1px 4px rgba(2,6,23,.6)`)} />
                                      </button>
                                    </div>
                                    {" "}
                                  </React.Fragment>
                                ))}
                              </div>
                              {" "}
                            </>
                          )}
                          <div style={css(`display:grid;grid-template-columns:${v.gov?.gridDelta};gap:5px 8px;align-items:baseline;padding:10px 11px;border-radius:11px;background:rgba(2,6,23,.62)`)}>
                            <span style={css(`font-size:8px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#64748b`)}>
                              {"Signal"}
                            </span>
                            <span style={css(`font-size:8px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#64748b;text-align:right`)}>
                              {"Now"}
                            </span>
                            <span />
                            <span style={css(`font-size:8px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#6ee7b7;text-align:right`)}>
                              {"Resolved"}
                            </span>
                            {(m?.walk?.delta || []).map((d, dIdx) => (
                              <React.Fragment key={dIdx}>
                                {" "}
                                <span style={css(`font-size:10px;line-height:1.4;color:#cbd5e1;text-wrap:pretty`)}>
                                  <Txt v={d?.l} />
                                </span>
                                {" "}
                                <span style={css(`font-size:11px;font-weight:700;color:#94a3b8;text-align:right;font-variant-numeric:tabular-nums`)}>
                                  <Txt v={d?.before} />
                                </span>
                                {" "}
                                <span style={css(`font-size:9.5px;color:#475569;text-align:center`)}>
                                  {"&#8594;"}
                                </span>
                                {" "}
                                <span style={css(`font-size:11.5px;font-weight:800;color:#6ee7b7;text-align:right;font-variant-numeric:tabular-nums`)}>
                                  <Txt v={d?.after} />
                                </span>
                                {" "}
                              </React.Fragment>
                            ))}
                          </div>
                        </div>
                        {" "}
                      </>
                    )}
                    {m?.backShow && (
                      <>
                        {" "}
                        <Hov as="button" onClick={m?.onBack} style={css(`align-self:flex-start;display:flex;align-items:center;gap:6px;height:25px;padding:0 11px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:10px;font-weight:800;color:${v.dcfg?.soft};border:1px solid ${v.dcfg?.color}80;background:${v.dcfg?.color}24`)} hoverStyle={css(`color:${v.dcfg?.soft};border-color:${v.dcfg?.ink}`)}>
                          <svg width={"11"} height={"11"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2.2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                            <path d={"M9 14 4 9l5-5"} />
                            <path d={"M20 20v-7a4 4 0 0 0-4-4H4"} />
                          </svg>
                          <Txt v={m?.backLabel} />{" "}
                        </Hov>
                        {" "}
                      </>
                    )}
                    {m?.isHelp && (
                      <>
                        {" "}
                        <div style={css(`align-self:stretch;min-width:0;display:flex;flex-direction:column;gap:9px;padding:${v.gov?.cardPad};border-radius:14px;border:1px solid ${v.dcfg?.color}73;background:linear-gradient(160deg,${v.dcfg?.color}1f,rgba(2,6,23,.82));box-shadow:0 0 30px ${v.dcfg?.color}29`)}>
                          <span style={css(`font-size:9px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:${v.dcfg?.soft}`)}>
                            <Txt v={m?.help?.title} />
                          </span>
                          <span style={css(`font-size:12px;line-height:1.6;color:#e2e8f0;text-wrap:pretty`)}>
                            <Txt v={m?.help?.what} />
                          </span>
                          {m?.help?.whyPlain && (
                            <>
                              {" "}
                              <span style={css(`font-size:11.5px;line-height:1.6;color:#cbd5e1;text-wrap:pretty;padding-left:10px;border-left:2px solid ${v.dcfg?.color}80`)}>
                                <Txt v={m?.help?.why} />
                              </span>
                              {" "}
                            </>
                          )}
                          {m?.help?.whyWarn && (
                            <>
                              {" "}
                              <div style={css(`display:flex;gap:9px;align-items:flex-start;padding:11px 12px;border-radius:11px;border:1.5px solid rgba(248,113,113,.7);background:linear-gradient(160deg,rgba(139,92,246,.26),rgba(69,10,10,.72));box-shadow:0 0 26px rgba(139,92,246,.24),inset 0 0 30px rgba(139,92,246,.1)`)}>
                                <svg width={"13"} height={"13"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#fca5a5"} strokeWidth={"2.2"} strokeLinecap={"round"} strokeLinejoin={"round"} style={css(`flex:none;margin-top:2px`)}>
                                  <path d={"m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3z"} />
                                  <path d={"M12 9v4M12 17h.01"} />
                                </svg>
                                <span style={css(`flex:1;font-size:11.5px;line-height:1.6;color:#fecaca;text-wrap:pretty`)}>
                                  <Txt v={m?.help?.why} />
                                </span>
                              </div>
                              {" "}
                            </>
                          )}
                          <div style={css(`display:grid;grid-template-columns:${v.gov?.gridDelta};gap:6px 8px;align-items:baseline;padding:10px 11px;border-radius:11px;background:rgba(2,6,23,.62)`)}>
                            <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#64748b`)}>
                              {"Signal"}
                            </span>
                            <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#64748b;text-align:right`)}>
                              {"Now"}
                            </span>
                            <span />
                            <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#6ee7b7;text-align:right`)}>
                              {"After"}
                            </span>
                            {(m?.help?.pairs || []).map((hp, hpIdx) => (
                              <React.Fragment key={hpIdx}>
                                {" "}
                                <span style={css(`font-size:${v.gov?.deltaLabel};line-height:1.35;color:#cbd5e1;text-wrap:pretty`)}>
                                  <Txt v={hp?.l} />
                                </span>
                                {" "}
                                <span style={css(`font-size:${v.gov?.deltaNow};font-weight:700;color:#94a3b8;text-align:right;font-variant-numeric:tabular-nums;overflow-wrap:normal;word-break:normal;hyphens:none;line-height:1.3`)}>
                                  <Txt v={hp?.before} />
                                </span>
                                {" "}
                                <span style={css(`font-size:10px;color:#475569;text-align:center`)}>
                                  {"&#8594;"}
                                </span>
                                {" "}
                                <span style={css(`font-size:${v.gov?.deltaAfter};font-weight:800;color:#6ee7b7;text-align:right;font-variant-numeric:tabular-nums;overflow-wrap:normal;word-break:normal;hyphens:none;line-height:1.3`)}>
                                  <Txt v={hp?.after} />
                                </span>
                                {" "}
                              </React.Fragment>
                            ))}
                          </div>
                          <span style={css(`font-size:10.5px;line-height:1.5;color:#94a3b8;text-wrap:pretty`)}>
                            <Txt v={m?.help?.note} />
                          </span>
                          {m?.help?.hasSim && (
                            <>
                              {" "}
                              <div style={css(`display:flex;flex-direction:column;gap:8px;padding:10px 11px;border-radius:11px;border:1px solid ${m?.help?.simBorder};background:${m?.help?.simBg};transition:all 320ms cubic-bezier(.22,1,.36,1)`)}>
                                <div style={css(`display:flex;align-items:center;gap:9px`)}>
                                  <span style={css(`flex:1;min-width:0;font-size:10.5px;font-weight:700;color:#e2e8f0;text-wrap:pretty`)}>
                                    <Txt v={m?.help?.sim?.label} />
                                  </span>
                                  <button onClick={m?.help?.sim?.onToggle} style={css(`flex:none;width:40px;height:21px;border-radius:999px;border:none;cursor:pointer;padding:2px;display:flex;justify-content:${m?.help?.sim?.justify};background:${m?.help?.sim?.track};transition:all 260ms cubic-bezier(.22,1,.36,1)`)}>
                                    <span style={css(`width:17px;height:17px;border-radius:99px;background:#fff;box-shadow:0 1px 4px rgba(2,6,23,.6)`)} />
                                  </button>
                                </div>
                                <span style={css(`font-size:10.5px;line-height:1.55;color:${m?.help?.sim?.tone};text-wrap:pretty`)}>
                                  <Txt v={m?.help?.sim?.effect} />
                                </span>
                              </div>
                              {" "}
                            </>
                          )}
                          {m?.hasJson && (
                            <>
                              {" "}
                              <div style={css(`display:flex;flex-direction:column;gap:7px`)}>
                                <div style={css(`display:flex;flex-direction:column;gap:4px`)}>
                                  <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#94a3b8`)}>
                                    {"Tenant configuration — now"}
                                  </span>
                                  <pre style={css(`margin:0;padding:9px 11px;border-radius:10px;border:1px solid rgba(248,113,113,.34);background:#020617;font-size:9.5px;line-height:1.55;color:#fca5a5;font-family:ui-monospace,Menlo,monospace;white-space:pre;overflow-x:auto`)}>
                                    <Txt v={m?.jsonBefore} />
                                  </pre>
                                </div>
                                <div style={css(`display:flex;flex-direction:column;gap:4px`)}>
                                  <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#6ee7b7`)}>
                                    {"Tenant configuration — after"}
                                  </span>
                                  <pre style={css(`margin:0;padding:9px 11px;border-radius:10px;border:1px solid rgba(52,211,153,.34);background:#020617;font-size:9.5px;line-height:1.55;color:#6ee7b7;font-family:ui-monospace,Menlo,monospace;white-space:pre;overflow-x:auto`)}>
                                    <Txt v={m?.jsonAfter} />
                                  </pre>
                                </div>
                                {(m?.scores || []).map((sc, scIdx) => (
                                  <React.Fragment key={scIdx}>
                                    {" "}
                                    <div style={css(`display:flex;align-items:baseline;gap:9px;padding:8px 11px;border-radius:10px;background:rgba(2,6,23,.7)`)}>
                                      <span style={css(`flex:1;min-width:0;font-size:10.5px;font-weight:700;color:#cbd5e1;text-wrap:pretty`)}>
                                        <Txt v={sc?.l} />
                                      </span>
                                      <span style={css(`font-size:13px;font-weight:800;color:#94a3b8;font-variant-numeric:tabular-nums`)}>
                                        <Txt v={sc?.a} />
                                      </span>
                                      <span style={css(`font-size:10px;color:#475569`)}>
                                        {"&#8594;"}
                                      </span>
                                      <span style={css(`font-size:15px;font-weight:800;color:#6ee7b7;font-variant-numeric:tabular-nums`)}>
                                        <Txt v={sc?.b} />
                                      </span>
                                    </div>
                                    {" "}
                                  </React.Fragment>
                                ))}
                              </div>
                              {" "}
                            </>
                          )}
                          {m?.hasLedger && (
                            <>
                              {" "}
                              <div style={css(`display:flex;flex-direction:column;gap:7px`)}>
                                <div style={css(`display:flex;flex-direction:column;gap:5px;padding:10px 11px;border-radius:11px;border:1px solid rgba(52,211,153,.34);background:rgba(16,185,129,.07)`)}>
                                  <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#6ee7b7`)}>
                                    {"What gets better"}
                                  </span>
                                  {(m?.pos || []).map((pp, ppIdx) => (
                                    <React.Fragment key={ppIdx}>
                                      {" "}
                                      <div style={css(`display:flex;gap:8px;align-items:flex-start`)}>
                                        <span style={css(`flex:none;margin-top:6px;width:5px;height:5px;border-radius:99px;background:#34d399`)} />
                                        <span style={css(`flex:1;font-size:10.5px;line-height:1.55;color:#e2e8f0;text-wrap:pretty`)}>
                                          <Txt v={pp?.v} />
                                        </span>
                                      </div>
                                      {" "}
                                    </React.Fragment>
                                  ))}
                                </div>
                                <div style={css(`display:flex;flex-direction:column;gap:5px;padding:10px 11px;border-radius:11px;border:1px solid rgba(251,191,36,.34);background:rgba(251,191,36,.07)`)}>
                                  <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#fbbf24`)}>
                                    {"What gets harder"}
                                  </span>
                                  {(m?.neg || []).map((nn, nnIdx) => (
                                    <React.Fragment key={nnIdx}>
                                      {" "}
                                      <div style={css(`display:flex;gap:8px;align-items:flex-start`)}>
                                        <span style={css(`flex:none;margin-top:6px;width:5px;height:5px;border-radius:99px;background:#fbbf24`)} />
                                        <span style={css(`flex:1;font-size:10.5px;line-height:1.55;color:#e2e8f0;text-wrap:pretty`)}>
                                          <Txt v={nn?.v} />
                                        </span>
                                      </div>
                                      {" "}
                                    </React.Fragment>
                                  ))}
                                </div>
                              </div>
                              {" "}
                            </>
                          )}
                          {m?.hasRoles && (
                            <>
                              {" "}
                              <div style={css(`display:flex;flex-direction:column;gap:5px`)}>
                                <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#7dd3fc`)}>
                                  {"Roles"}
                                </span>
                                {(m?.roles || []).map((rl, rlIdx) => (
                                  <React.Fragment key={rlIdx}>
                                    {" "}
                                    <div style={css(`display:flex;flex-direction:column;gap:2px;padding:8px 11px;border-radius:10px;border:1px solid ${rl?.border};background:${rl?.bg}`)}>
                                      <span style={css(`font-size:10.5px;font-weight:800;color:${rl?.c};font-family:ui-monospace,Menlo,monospace`)}>
                                        <Txt v={rl?.n} />
                                      </span>
                                      <span style={css(`font-size:10px;line-height:1.5;color:#cbd5e1;text-wrap:pretty`)}>
                                        <Txt v={rl?.d} />
                                      </span>
                                    </div>
                                    {" "}
                                  </React.Fragment>
                                ))}
                              </div>
                              {" "}
                            </>
                          )}
                          {m?.hasTiers && (
                            <>
                              {" "}
                              <div style={css(`display:flex;flex-direction:column;gap:7px`)}>
                                <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#94a3b8`)}>
                                  {"Who can take this on"}
                                </span>
                                {(m?.tiers || []).map((tr, trIdx) => (
                                  <React.Fragment key={trIdx}>
                                    {" "}
                                    <div style={css(`display:flex;flex-direction:column;gap:3px;padding:9px 11px;border-radius:11px;border:1px solid ${tr?.border};background:${tr?.bg}`)}>
                                      <div style={css(`display:flex;align-items:baseline;gap:8px`)}>
                                        <span style={css(`flex:none;font-size:8.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${tr?.c};font-family:ui-monospace,Menlo,monospace`)}>
                                          <Txt v={tr?.l} />
                                        </span>
                                        <span style={css(`flex:1;min-width:0;font-size:9px;font-weight:600;color:#64748b;text-align:right;text-wrap:pretty`)}>
                                          <Txt v={tr?.who} />
                                        </span>
                                      </div>
                                      <span style={css(`font-size:10.5px;line-height:1.55;color:#e2e8f0;text-wrap:pretty`)}>
                                        <Txt v={tr?.t} />
                                      </span>
                                    </div>
                                    {" "}
                                  </React.Fragment>
                                ))}
                              </div>
                              {" "}
                            </>
                          )}
                          {m?.hasFix && (
                            <>
                              {" "}
                              <div style={css(`display:flex;flex-direction:column;gap:7px;padding:11px 12px;border-radius:11px;border:1.5px solid rgba(248,113,113,.7);background:linear-gradient(160deg,rgba(139,92,246,.26),rgba(69,10,10,.72));box-shadow:0 0 26px rgba(139,92,246,.24),inset 0 0 30px rgba(139,92,246,.1)`)}>
                                <div style={css(`display:flex;align-items:center;gap:7px`)}>
                                  <svg width={"13"} height={"13"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#fca5a5"} strokeWidth={"2.2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                                    <path d={"m21.7 18-8-14a2 2 0 0 0-3.4 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3z"} />
                                    <path d={"M12 9v4M12 17h.01"} />
                                  </svg>
                                  <span style={css(`font-size:9px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#fecaca`)}>
                                    {"Blast radius if done incorrectly"}
                                  </span>
                                </div>
                                {(m?.blast || []).map((bl, blIdx) => (
                                  <React.Fragment key={blIdx}>
                                    {" "}
                                    <div style={css(`display:flex;gap:8px;align-items:flex-start`)}>
                                      <span style={css(`flex:none;margin-top:6px;width:5px;height:5px;border-radius:99px;background:#f87171`)} />
                                      <span style={css(`flex:1;font-size:10.5px;line-height:1.55;color:#e2e8f0;text-wrap:pretty`)}>
                                        <Txt v={bl?.v} />
                                      </span>
                                    </div>
                                    {" "}
                                  </React.Fragment>
                                ))}
                              </div>
                              {" "}
                              <div style={css(`display:flex;flex-wrap:wrap;gap:7px`)}>
                                <Hov as="button" onClick={m?.onFixUi} style={css(`height:28px;padding:0 13px;border-radius:9px;border:none;cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:800;color:#052e16;background:#34d399`)} hoverStyle={css(`background:#6ee7b7`)}>
                                  {"Walk me through the admin centre"}
                                </Hov>
                                <Hov as="button" onClick={m?.onFixPs} style={css(`height:28px;padding:0 13px;border-radius:9px;cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:800;color:#7dd3fc;border:1px solid rgba(103,232,249,.5);background:rgba(0,120,212,.12)`)} hoverStyle={css(`color:#e0f2fe`)}>
                                  {"Give me the PowerShell"}
                                </Hov>
                              </div>
                              {" "}
                            </>
                          )}
                          {m?.help?.hasChanges && (
                            <>
                              {" "}
                              <div style={css(`display:flex;flex-direction:column;gap:6px`)}>
                                <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#6ee7b7`)}>
                                  {"Mock the change"}
                                </span>
                                <div style={css(`display:flex;flex-wrap:wrap;gap:6px`)}>
                                  {(m?.help?.changes || []).map((cg, cgIdx) => (
                                    <React.Fragment key={cgIdx}>
                                      {" "}
                                      <Hov as="button" onClick={cg?.onClick} style={css(`height:26px;padding:0 12px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:10px;font-weight:800;color:${cg?.c};border:1px solid ${cg?.bd};background:${cg?.bg}`)} hoverStyle={css(`border-color:#6ee7b7`)}>
                                        <Txt v={cg?.l} />
                                      </Hov>
                                      {" "}
                                    </React.Fragment>
                                  ))}
                                </div>
                              </div>
                              {" "}
                            </>
                          )}
                          {m?.help?.hasAsks && (
                            <>
                              {" "}
                              <div style={css(`display:flex;flex-wrap:wrap;gap:6px`)}>
                                {(m?.help?.asks || []).map((fa, faIdx) => (
                                  <React.Fragment key={faIdx}>
                                    {" "}
                                    <Hov as="button" onClick={fa?.onClick} style={css(`height:24px;padding:0 11px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:9.5px;font-weight:700;color:#cbd5e1;border:1px solid rgba(51,65,85,.9);background:rgba(2,6,23,.6)`)} hoverStyle={css(`color:#f1f5f9;border-color:${v.dcfg?.color}b3`)}>
                                      <Txt v={fa?.l} />
                                    </Hov>
                                    {" "}
                                  </React.Fragment>
                                ))}
                              </div>
                              {" "}
                            </>
                          )}
                        </div>
                        {" "}
                      </>
                    )}
                    {m?.isDocs && (
                      <>
                        {" "}
                        <div style={css(`align-self:stretch;display:flex;flex-direction:column;gap:8px;padding:11px 13px;border-radius:14px;border:1px solid ${v.dcfg?.color}73;background:linear-gradient(160deg,${v.dcfg?.color}1f,rgba(2,6,23,.82));box-shadow:0 0 30px ${v.dcfg?.color}29`)}>
                          <div style={css(`font-size:12.5px;line-height:1.6;color:#e2e8f0;text-wrap:pretty`)}>
                            <Txt v={m?.text} />
                          </div>
                          <div style={css(`display:flex;align-items:center;gap:7px;padding-top:2px;border-top:1px solid ${v.dcfg?.color}38`)}>
                            <span style={css(`width:5px;height:5px;border-radius:99px;background:${v.dcfg?.ink};animation:wr-blink 1.5s ease-in-out infinite`)} />
                            <span style={css(`flex:1;font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:${v.dcfg?.soft}`)}>
                              {"Permission-scoped retrieval · what Copilot reaches first"}
                            </span>
                          </div>
                          {(m?.docSet?.rows || []).map((dc, dcIdx) => (
                            <React.Fragment key={dcIdx}>
                              {" "}
                              <div style={css(`display:flex;flex-direction:column;gap:2px;padding:7px 9px;border-radius:9px;background:rgba(2,6,23,.62)`)}>
                                <div style={css(`display:flex;align-items:baseline;gap:8px;flex-wrap:wrap`)}>
                                  <span style={css(`flex:1;min-width:150px;font-size:11px;font-weight:600;color:#e2e8f0;overflow-wrap:anywhere`)}>
                                    <Txt v={dc?.name} />
                                  </span>
                                  <span style={css(`font-size:9px;font-weight:700;padding:2px 7px;border-radius:6px;color:${dc?.clsColor};background:${dc?.clsColor}1f;font-family:ui-monospace,Menlo,monospace;white-space:nowrap`)}>
                                    <Txt v={dc?.cls} />
                                  </span>
                                </div>
                                <div style={css(`display:flex;align-items:baseline;gap:8px;flex-wrap:wrap`)}>
                                  <span style={css(`flex:1;min-width:0;font-size:9.5px;color:#64748b;font-family:ui-monospace,Menlo,monospace;overflow-wrap:anywhere`)}>
                                    <Txt v={dc?.where} />
                                  </span>
                                  <span style={css(`font-size:9px;color:#fca5a5;font-family:ui-monospace,Menlo,monospace;white-space:nowrap`)}>
                                    <Txt v={dc?.grant} />
                                  </span>
                                </div>
                              </div>
                              {" "}
                            </React.Fragment>
                          ))}
                          <div style={css(`display:flex;gap:8px;padding:9px 11px;border-radius:10px;border:1px solid rgba(248,113,113,.32);background:rgba(248,113,113,.09)`)}>
                            <span style={css(`flex:1;font-size:11px;line-height:1.5;color:#fca5a5;text-wrap:pretty`)}>
                              <Txt v={m?.docSet?.warn} />
                            </span>
                          </div>
                        </div>
                        {" "}
                      </>
                    )}
                    {m?.isCopilot && (
                      <>
                        {" "}
                        <div style={css(`align-self:stretch;display:flex;flex-direction:column;gap:9px`)}>
                          <div style={css(`font-size:12.5px;line-height:1.6;color:#e2e8f0;text-wrap:pretty`)}>
                            <Txt v={m?.text} />
                          </div>
                          <div style={css(`border-radius:14px;overflow:hidden;border:1px solid rgba(103,232,249,.4);background:linear-gradient(160deg,rgba(0,120,212,.14),rgba(2,6,23,.86));box-shadow:0 0 30px rgba(103,232,249,.16)`)}>
                            {" "}
                            <div style={css(`display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid rgba(103,232,249,.25)`)}>
                              <svg width={"13"} height={"13"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#7dd3fc"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                                <path d={"M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"} />
                              </svg>
                              <span style={css(`flex:1;font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#7dd3fc`)}>
                                {"Microsoft 365 Copilot · live against your tenant"}
                              </span>
                            </div>
                            {" "}
                            <div style={css(`padding:11px 12px;display:flex;flex-direction:column;gap:9px`)}>
                              <div style={css(`display:flex;gap:8px;padding:8px 10px;border-radius:10px;background:rgba(2,6,23,.7)`)}>
                                <span style={css(`flex:none;font-size:9px;font-weight:800;letter-spacing:.1em;color:#64748b;font-family:ui-monospace,Menlo,monospace;padding-top:2px`)}>
                                  {"PROMPT"}
                                </span>
                                <span style={css(`flex:1;min-width:0;font-size:11.5px;color:#cbd5e1;text-wrap:pretty`)}>
                                  <Txt v={m?.cp?.prompt} />
                                </span>
                              </div>
                              {(m?.cp?.body || []).map((cb, cbIdx) => (
                                <React.Fragment key={cbIdx}>
                                  {" "}
                                  <span style={css(`font-size:12px;line-height:1.65;color:#e2e8f0;text-wrap:pretty`)}>
                                    <Txt v={cb?.t} />
                                  </span>
                                  {" "}
                                </React.Fragment>
                              ))}
                              <div style={css(`display:flex;flex-direction:column;gap:4px;padding-top:8px;border-top:1px solid rgba(30,41,59,.9)`)}>
                                <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#64748b`)}>
                                  {"References"}
                                </span>
                                {(m?.cp?.cites || []).map((cc, ccIdx) => (
                                  <React.Fragment key={ccIdx}>
                                    {" "}
                                    <div style={css(`display:flex;gap:7px;align-items:baseline`)}>
                                      <span style={css(`flex:none;width:15px;height:15px;border-radius:4px;display:flex;align-items:center;justify-content:center;font-size:8.5px;font-weight:800;color:#7dd3fc;background:rgba(103,232,249,.16);font-family:ui-monospace,Menlo,monospace`)}>
                                        <Txt v={cc?.n} />
                                      </span>
                                      <span style={css(`flex:1;min-width:0;font-size:10.5px;color:#7dd3fc;overflow-wrap:anywhere`)}>
                                        <Txt v={cc?.c} />
                                      </span>
                                    </div>
                                    {" "}
                                  </React.Fragment>
                                ))}
                              </div>
                              <div style={css(`display:flex;gap:8px;padding:9px 11px;border-radius:10px;border:1px solid rgba(248,113,113,.34);background:rgba(248,113,113,.09)`)}>
                                <svg width={"13"} height={"13"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#fca5a5"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"} style={css(`flex:none;margin-top:1px`)}>
                                  <path d={"M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"} />
                                </svg>
                                <span style={css(`flex:1;font-size:11px;line-height:1.5;color:#fca5a5;text-wrap:pretty`)}>
                                  <Txt v={m?.cp?.warn} />
                                </span>
                              </div>
                            </div>
                            {" "}
                          </div>
                        </div>
                        {" "}
                      </>
                    )}
                    {m?.isSites && (
                      <>
                        {" "}
                        <div style={css(`align-self:stretch;display:flex;flex-direction:column;gap:8px;padding:11px 13px;border-radius:14px;border:1px solid ${v.dcfg?.color}73;background:linear-gradient(160deg,${v.dcfg?.color}1f,rgba(2,6,23,.8));box-shadow:0 0 30px ${v.dcfg?.color}29`)}>
                          <div style={css(`font-size:12.5px;line-height:1.6;color:#e2e8f0;text-wrap:pretty`)}>
                            <Txt v={m?.text} />
                          </div>
                          <div style={css(`display:flex;align-items:center;gap:7px;padding-top:2px;border-top:1px solid ${v.dcfg?.color}38`)}>
                            <span style={css(`width:5px;height:5px;border-radius:99px;background:${v.dcfg?.ink};animation:wr-blink 1.5s ease-in-out infinite`)} />
                            <span style={css(`flex:1;font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:${v.dcfg?.soft}`)}>
                              {"GET /v1.0/sites?search=* · 10 of 2,356"}
                            </span>
                          </div>
                          {(m?.siteRows || []).map((sr, srIdx) => (
                            <React.Fragment key={srIdx}>
                              {" "}
                              <div style={css(`display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;padding:6px 9px;border-radius:8px;background:rgba(2,6,23,.6)`)}>
                                <span style={css(`flex:1;min-width:150px;font-size:10.5px;color:#7dd3fc;font-family:ui-monospace,Menlo,monospace;overflow-wrap:anywhere`)}>
                                  <Txt v={sr?.url} />
                                </span>
                                <span style={css(`font-size:9px;font-weight:700;padding:2px 7px;border-radius:6px;color:#fca5a5;background:rgba(248,113,113,.16);font-family:ui-monospace,Menlo,monospace;white-space:nowrap`)}>
                                  <Txt v={sr?.grant} />
                                </span>
                                <span style={css(`font-size:9px;color:#64748b;font-family:ui-monospace,Menlo,monospace;white-space:nowrap`)}>
                                  <Txt v={sr?.files} />
                                </span>
                              </div>
                              {" "}
                            </React.Fragment>
                          ))}
                          <div style={css(`display:flex;flex-direction:column;gap:5px;padding-top:6px;border-top:1px solid ${v.dcfg?.color}38`)}>
                            {(v.gov?.path || []).map((pp, ppIdx) => (
                              <React.Fragment key={ppIdx}>
                                {" "}
                                <div style={css(`display:flex;gap:9px;align-items:flex-start`)}>
                                  <span style={css(`flex:none;width:17px;height:17px;border-radius:99px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#fca5a5;border:1px solid rgba(248,113,113,.45);font-family:ui-monospace,Menlo,monospace`)}>
                                    <Txt v={pp?.n} />
                                  </span>
                                  <span style={css(`flex:1;min-width:0;display:flex;flex-direction:column;gap:1px`)}>
                                    <span style={css(`font-size:11px;font-weight:600;color:#e2e8f0;text-wrap:pretty`)}>
                                      <Txt v={pp?.head} />
                                    </span>
                                    <span style={css(`font-size:10px;line-height:1.4;color:#94a3b8;text-wrap:pretty`)}>
                                      <Txt v={pp?.sub} />
                                    </span>
                                  </span>
                                </div>
                                {" "}
                              </React.Fragment>
                            ))}
                          </div>
                        </div>
                        {" "}
                      </>
                    )}
                    {m?.backShow && (
                      <>
                        {" "}
                        <Hov as="button" onClick={m?.onBack} style={css(`align-self:flex-start;display:flex;align-items:center;gap:6px;height:26px;padding:0 12px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:10px;font-weight:800;color:${v.dcfg?.soft};border:1px solid ${v.dcfg?.color}80;background:${v.dcfg?.color}24`)} hoverStyle={css(`color:${v.dcfg?.soft};border-color:${v.dcfg?.ink}`)}>
                          <svg width={"11"} height={"11"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2.2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                            <path d={"M9 14 4 9l5-5"} />
                            <path d={"M20 20v-7a4 4 0 0 0-4-4H4"} />
                          </svg>
                          <Txt v={m?.backLabel} />{" "}
                        </Hov>
                        {" "}
                      </>
                    )}
                    {m?.hasActions && (
                      <>
                        {" "}
                        <div style={css(`display:flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:7px;margin-top:4px`)}>
                          {(m?.actions || []).map((ac, acIdx) => (
                            <React.Fragment key={acIdx}>
                              {" "}
                              <Hov as="button" onClick={ac?.onClick} style={css(`order:${ac?.order};height:32px;padding:0 ${ac?.pad};border-radius:9px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:${ac?.weight};display:flex;align-items:center;gap:6px;color:${ac?.color};border:${ac?.borderCss};background:${ac?.bg};box-shadow:${ac?.glow};transition:all 200ms cubic-bezier(.22,1,.36,1)`)} hoverStyle={css(`filter:brightness(1.12)`)}>
                                {" "}<Txt v={ac?.label} />{" "}
                                {ac?.isPrimary && (
                                  <>
                                    {" "}
                                    <svg width={"12"} height={"12"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2.6"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                                      <path d={"M5 12h14M13 6l6 6-6 6"} />
                                    </svg>
                                    {" "}
                                  </>
                                )}
                              </Hov>
                              {" "}
                            </React.Fragment>
                          ))}
                        </div>
                        {" "}
                      </>
                    )}
                  </div>
                </div>
                {" "}
              </React.Fragment>
            ))}
            {v.gov?.typing?.show && (
              <>
                {" "}
                <div style={css(`display:flex;gap:10px;align-items:center;animation:wr-rise 240ms cubic-bezier(.22,1,.36,1)`)}>
                  <span style={css(`flex:none;width:30px;height:30px;border-radius:10px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:${v.gov?.typing?.tile};box-shadow:0 0 16px ${v.gov?.typing?.color}55`)}>
                    <ImageSlot id={v.gov?.typing?.slot} shape={"rounded"} radius={"9"} src={v.gov?.typing?.photo} placeholder={""} style={css(`width:100%;height:100%;position:relative;color:transparent`)} />
                  </span>
                  <div style={css(`display:flex;align-items:center;gap:9px;padding:9px 13px;border-radius:14px;border:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.62)`)}>
                    <span style={css(`font-size:10.5px;font-weight:600;color:${v.gov?.typing?.color}`)}>
                      <Txt v={v.gov?.typing?.name} />
                    </span>
                    <span style={css(`display:flex;gap:3px`)}>
                      <span style={css(`width:4px;height:4px;border-radius:99px;background:${v.gov?.typing?.color};animation:wr-typedot 1.2s ease-in-out infinite`)} />
                      <span style={css(`width:4px;height:4px;border-radius:99px;background:${v.gov?.typing?.color};animation:wr-typedot 1.2s ease-in-out .18s infinite`)} />
                      <span style={css(`width:4px;height:4px;border-radius:99px;background:${v.gov?.typing?.color};animation:wr-typedot 1.2s ease-in-out .36s infinite`)} />
                    </span>
                  </div>
                </div>
                {" "}
              </>
            )}
          </div>
        </div>
        <div style={css(`position:relative;min-height:0;background:rgba(2,6,23,.5)`)}>
          {" "}
          <div style={css(`position:absolute;inset:0;overflow-y:auto;overflow-x:clip;padding:16px 16px;display:flex;flex-direction:column;gap:10px`)}>
            <div style={css(`flex:0 0 auto;border-radius:15px;border:1px solid ${v.dcfg?.color}73;background:linear-gradient(160deg,${v.dcfg?.color}21,rgba(2,6,23,.78));box-shadow:0 0 34px ${v.dcfg?.color}2e`)}>
              <div style={css(`display:flex;align-items:center;gap:8px;padding:10px 13px;border-bottom:1px solid ${v.dcfg?.color}3d`)}>
                <span style={css(`width:6px;height:6px;border-radius:99px;background:${v.dcfg?.ink};animation:wr-blink 1.5s ease-in-out infinite`)} />
                <span style={css(`flex:1;font-size:9px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:${v.dcfg?.soft}`)}>
                  <Txt v={v.dcfg?.word} />{" telemetry · your tenant"}
                </span>
                <span style={css(`font-size:9px;font-weight:700;color:#64748b;font-family:ui-monospace,Menlo,monospace`)}>
                  {"01 AUG 2026"}
                </span>
              </div>
              {" "}
              <div style={css(`padding:7px 13px 0;font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#64748b`)}>
                <Txt v={v.gov?.viewKicker} />
              </div>
              {" "}
              <div style={css(`padding:10px 13px 0;display:flex;flex-direction:column;gap:9px`)}>
                {(v.gov?.viewSections || []).map((vs, vsIdx) => (
                  <React.Fragment key={vsIdx}>
                    {" "}
                    <div style={css(`display:flex;flex-direction:column;gap:4px;padding:9px 11px;border-radius:11px;border:1px solid ${vs?.border};background:${vs?.bg};box-shadow:${vs?.glow};transition:all 420ms cubic-bezier(.22,1,.36,1)`)}>
                      <div style={css(`display:flex;align-items:center;gap:7px`)}>
                        {vs?.active && (
                          <>
                            {" "}
                            <span style={css(`flex:none;width:5px;height:5px;border-radius:99px;background:${v.dcfg?.ink};box-shadow:0 0 10px ${v.dcfg?.ink};animation:wr-blink 1.4s ease-in-out infinite`)} />
                            {" "}
                          </>
                        )}
                        <Hov as="span" onClick={vs?.onOpen} data-tip={vs?.tip} style={css(`flex:1;min-width:0;font-size:9px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${vs?.ink};cursor:pointer`)} hoverStyle={css(`color:${v.dcfg?.soft}`)}>
                          <Txt v={vs?.h} />
                        </Hov>
                        {vs?.active && (
                          <>
                            {" "}
                            <span style={css(`flex:none;font-size:8px;font-weight:800;letter-spacing:.12em;padding:2px 7px;border-radius:999px;color:${v.dcfg?.soft};border:1px solid ${v.dcfg?.color}99;background:${v.dcfg?.color}3d;font-family:ui-monospace,Menlo,monospace`)}>
                              {"ON NOW"}
                            </span>
                            {" "}
                          </>
                        )}
                      </div>
                      {(vs?.rows || []).map((vr, vrIdx) => (
                        <React.Fragment key={vrIdx}>
                          {" "}
                          <Hov as="div" data-tip={vr?.tip} data-tip-title={vr?.title} data-tip-value={vr?.v} data-tip-tone={vr?.tone} data-tip-stats={vr?.stats} data-tip-change={vr?.change} onClick={vr?.onClick} style={css(`display:flex;align-items:baseline;gap:7px;padding:5px 7px;margin:0 -7px;border-radius:8px;cursor:pointer;transition:background 180ms ease`)} hoverStyle={css(`background:${v.dcfg?.color}24`)}>
                            <span style={css(`flex:none;width:5px;height:5px;border-radius:99px;background:${vr?.dot};box-shadow:0 0 8px ${vr?.dot}`)} />
                            <span style={css(`flex:1;min-width:0;font-size:10.5px;line-height:1.4;color:#cbd5e1;text-wrap:pretty`)}>
                              <Txt v={vr?.l} />
                            </span>
                            <span style={css(`flex:none;font-size:11.5px;font-weight:800;color:${vr?.nowInk};font-variant-numeric:tabular-nums;word-break:keep-all`)}>
                              <Txt v={vr?.v} />
                            </span>
                            {vr?.hasAfter && (
                              <>
                                {" "}
                                <span style={css(`flex:none;font-size:9px;color:#475569`)}>
                                  {"&#8594;"}
                                </span>
                                {" "}
                                <span style={css(`flex:none;font-size:12px;font-weight:800;color:#6ee7b7;font-variant-numeric:tabular-nums;word-break:keep-all`)}>
                                  <Txt v={vr?.after} />
                                </span>
                                {" "}
                              </>
                            )}
                          </Hov>
                          {" "}
                        </React.Fragment>
                      ))}
                    </div>
                    {" "}
                  </React.Fragment>
                ))}
              </div>
              {" "}
              {v.gov?.staged?.show && <StagedChangesPanel v={v} />}
              {" "}
              <div style={css(`padding:12px 13px;display:grid;grid-template-columns:1fr 1fr;gap:8px`)}>
                {(v.gov?.rollup || []).map((ru, ruIdx) => (
                  <React.Fragment key={ruIdx}>
                    {" "}
                    <Hov as="div" data-tip={ru?.tip} data-tip-title={ru?.l} data-tip-value={ru?.v} data-tip-tone={ru?.c} data-tip-spark={ru?.spark} data-tip-stats={ru?.stats} data-tip-change={ru?.change} onClick={ru?.onClick} style={css(`min-width:0;padding:9px 11px;border-radius:11px;cursor:pointer;border:1px solid ${ru?.border};background:${ru?.bg};transition:all 220ms cubic-bezier(.22,1,.36,1)`)} hoverStyle={css(`border-color:${v.dcfg?.color}99`)}>
                      {" "}
                      <div style={css(`display:flex;align-items:baseline;gap:5px;flex-wrap:wrap`)}>
                        <span style={css(`font-size:17px;font-weight:800;color:${ru?.c};font-variant-numeric:tabular-nums;word-break:keep-all`)}>
                          <Txt v={ru?.v} />
                        </span>
                        {ru?.hasThen && (
                          <>
                            {" "}
                            <span style={css(`font-size:10px;color:#475569`)}>
                              {"&#8594;"}
                            </span>
                            {" "}
                            <span style={css(`font-size:15px;font-weight:800;color:${ru?.thenColor};font-variant-numeric:tabular-nums;word-break:keep-all`)}>
                              <Txt v={ru?.then} />
                            </span>
                            {" "}
                          </>
                        )}
                      </div>
                      {" "}
                      <div style={css(`font-size:9px;line-height:1.3;color:#94a3b8;text-wrap:pretty`)}>
                        <Txt v={ru?.l} />
                      </div>
                      {" "}
                    </Hov>
                    {" "}
                  </React.Fragment>
                ))}
              </div>
              {" "}
              {v.gov?.detailOpen && (
                <>
                  {" "}
                  <div style={css(`margin:0 13px 12px;display:flex;flex-direction:column;gap:6px;padding:11px 12px;border-radius:11px;border:1px solid ${v.dcfg?.color}59;background:${v.dcfg?.color}14;animation:wr-rise 240ms cubic-bezier(.22,1,.36,1)`)}>
                    <span style={css(`font-size:9.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${v.dcfg?.soft}`)}>
                      <Txt v={v.gov?.detail?.title} />
                    </span>
                    {(v.gov?.detail?.rows || []).map((dr, drIdx) => (
                      <React.Fragment key={drIdx}>
                        {" "}
                        <div style={css(`display:flex;align-items:baseline;gap:8px;flex-wrap:wrap`)}>
                          <span style={css(`flex:1;min-width:120px;font-size:11px;font-weight:600;color:#e2e8f0;text-wrap:pretty`)}>
                            <Txt v={dr?.n} />
                          </span>
                          <span style={css(`font-size:9px;font-weight:700;padding:2px 7px;border-radius:6px;color:${dr?.c};background:${dr?.c}1f;font-family:ui-monospace,Menlo,monospace;white-space:nowrap`)}>
                            <Txt v={dr?.e} />
                          </span>
                          <span style={css(`font-size:9px;color:#64748b;font-family:ui-monospace,Menlo,monospace;white-space:nowrap`)}>
                            <Txt v={dr?.r} />
                          </span>
                        </div>
                        {" "}
                      </React.Fragment>
                    ))}
                    <Hov as="button" onClick={v.gov?.detail?.onAsk} style={css(`margin-top:3px;height:28px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:700;color:${v.dcfg?.soft};border:1px solid ${v.dcfg?.color}80;background:${v.dcfg?.color}1f`)} hoverStyle={css(`color:${v.dcfg?.soft}`)}>
                      {"Ask about this"}
                    </Hov>
                  </div>
                  {" "}
                </>
              )}
              {" "}
              <div style={css(`padding:0 13px 12px;display:flex;flex-direction:column;gap:10px`)}>
                {(v.gov?.gauges || []).map((g, gIdx) => (
                  <React.Fragment key={gIdx}>
                    {" "}
                    <div style={css(`display:flex;flex-direction:column;gap:4px`)}>
                      <div style={css(`display:flex;align-items:baseline;gap:9px`)}>
                        <span style={css(`flex:1;font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#64748b`)}>
                          <Txt v={g?.label} />
                        </span>
                        <span style={css(`font-size:13px;font-weight:800;color:${g?.color};font-variant-numeric:tabular-nums`)}>
                          <Txt v={g?.value} />
                        </span>
                      </div>
                      <div style={css(`height:5px;border-radius:99px;background:rgba(2,6,23,.85);overflow:hidden`)}>
                        {" "}
                        <div style={css(`height:100%;width:${g?.w};border-radius:99px;background:${g?.color};transition:width 600ms cubic-bezier(.22,1,.36,1),background 400ms ease`)} />
                        {" "}
                      </div>
                    </div>
                    {" "}
                  </React.Fragment>
                ))}
              </div>
              {" "}
              <div style={css(`padding:0 13px 12px;display:flex;flex-direction:column;gap:8px`)}>
                <div style={css(`display:flex;align-items:baseline;gap:9px`)}>
                  <span style={css(`flex:1;font-size:11px;font-weight:700;color:#e2e8f0`)}>
                    <Txt v={v.gov?.sliderLabel} />
                  </span>
                  <Hov as="button" onClick={v.gov?.help?.links} style={css(`flex:none;width:19px;height:19px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-family:inherit;font-size:10px;font-weight:800;line-height:1;color:${v.dcfg?.soft};border:1px solid ${v.dcfg?.color}80;background:${v.dcfg?.color}1f`)} hoverStyle={css(`color:${v.dcfg?.soft};border-color:rgba(59,130,246,.9)`)}>
                    {"?"}
                  </Hov>
                  <span style={css(`font-size:15px;font-weight:800;color:${v.dcfg?.soft};font-variant-numeric:tabular-nums`)}>
                    <Txt v={v.gov?.orgLinks} />
                  </span>
                </div>
                <input type={"range"} min={"0"} max={v.gov?.sliderMax} step={"1"} value={v.gov?.orgLinksVal} onChange={v.gov?.onLinks} onInput={v.gov?.onLinks} style={css(`width:100%;accent-color:${v.dcfg?.color};cursor:pointer`)} />
                <div onClick={v.gov?.onExt} style={css(`display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:10px;cursor:pointer;border:1px solid ${v.dcfg?.color}4d;background:rgba(2,6,23,.55)`)}>
                  <span style={css(`flex:none;width:32px;height:18px;border-radius:999px;position:relative;background:${v.gov?.extKnobBg};transition:background 260ms ease`)}>
                    {" "}
                    <span style={css(`position:absolute;top:2px;left:${v.gov?.extKnobX};width:14px;height:14px;border-radius:50%;background:#fff;transition:left 260ms cubic-bezier(.22,1,.36,1)`)} />
                    {" "}
                  </span>
                  <span style={css(`flex:1;font-size:11.5px;font-weight:600;color:#a8b4c8`)}>
                    <Txt v={v.gov?.extLabel} />
                  </span>
                  <Hov as="button" onClick={v.gov?.help?.ext} style={css(`flex:none;width:19px;height:19px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-family:inherit;font-size:10px;font-weight:800;line-height:1;color:${v.dcfg?.soft};border:1px solid ${v.dcfg?.color}80;background:${v.dcfg?.color}1f`)} hoverStyle={css(`color:${v.dcfg?.soft};border-color:rgba(59,130,246,.9)`)}>
                    {"?"}
                  </Hov>
                </div>
                <div onClick={v.gov?.onInh} style={css(`display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:10px;cursor:pointer;border:1px solid ${v.dcfg?.color}4d;background:rgba(2,6,23,.55)`)}>
                  <span style={css(`flex:none;width:32px;height:18px;border-radius:999px;position:relative;background:${v.gov?.inhKnobBg};transition:background 260ms ease`)}>
                    {" "}
                    <span style={css(`position:absolute;top:2px;left:${v.gov?.inhKnobX};width:14px;height:14px;border-radius:50%;background:#fff;transition:left 260ms cubic-bezier(.22,1,.36,1)`)} />
                    {" "}
                  </span>
                  <span style={css(`flex:1;font-size:11.5px;font-weight:600;color:#a8b4c8`)}>
                    <Txt v={v.gov?.inhLabel} />
                  </span>
                  <Hov as="button" onClick={v.gov?.help?.inh} style={css(`flex:none;width:19px;height:19px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;font-family:inherit;font-size:10px;font-weight:800;line-height:1;color:${v.dcfg?.soft};border:1px solid ${v.dcfg?.color}80;background:${v.dcfg?.color}1f`)} hoverStyle={css(`color:${v.dcfg?.soft};border-color:rgba(59,130,246,.9)`)}>
                    {"?"}
                  </Hov>
                </div>
              </div>
              {" "}
              <div style={css(`padding:0 13px 13px;display:flex;flex-wrap:wrap;gap:6px`)}>
                {(v.gov?.questions || []).map((qq, qqIdx) => (
                  <React.Fragment key={qqIdx}>
                    {" "}
                    <Hov as="button" onClick={qq?.onClick} style={css(`height:26px;padding:0 11px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:600;color:${v.dcfg?.soft};border:1px solid rgba(59,130,246,.42);background:${v.dcfg?.color}1a`)} hoverStyle={css(`color:${v.dcfg?.soft};border-color:${v.dcfg?.color}bf`)}>
                      <Txt v={qq?.q} />
                    </Hov>
                    {" "}
                  </React.Fragment>
                ))}
                <Hov as="button" onClick={v.gov?.onPreview} style={css(`height:26px;padding:0 11px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:700;color:#fff;border:none;background:${v.dcfg?.color}`)} hoverStyle={css(`background:#7c5cff`)}>
                  <Txt v={v.gov?.previewLabel} />
                </Hov>
                {v.gov?.hasSizer && (
                  <>
                    {" "}
                    <button onClick={v.gov?.onSizer} style={css(`height:26px;padding:0 11px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:800;color:#042f2e;border:none;background:#5eead4`)}>
                      {"Right-size the licences"}
                    </button>
                    {" "}
                  </>
                )}
                <button onClick={v.gov?.onPath} style={css(`height:26px;padding:0 11px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:700;color:${v.dcfg?.soft};border:1px solid ${v.dcfg?.color}80;background:${v.dcfg?.color}1a`)}>
                  <Txt v={v.gov?.pathLabel} />
                </button>
              </div>
              {" "}
            </div>
          </div>
          {" "}
          {v.gov?.showDoc && <PillarDiveDocViewer v={v} />}
          {" "}
        </div>
      </div>
      <div style={css(`flex:none;border-top:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.66);display:flex;align-items:center;gap:8px;padding:8px 12px`)}>
        <Hov as="input" value={v.gov?.draft} onChange={v.gov?.onDraft} onKeyDown={v.gov?.onKey} placeholder={"Ask Maya or Shane about your governance data…"} style={css(`flex:1;min-width:0;height:36px;padding:0 14px;border-radius:10px;font-family:inherit;font-size:12.5px;color:#a8b4c8;border:1px solid rgba(51,65,85,.9);background:rgba(2,6,23,.8);outline:none`)} focusStyle={css(`border-color:${v.dcfg?.color}bf`)} />
        <Hov as="button" onClick={v.gov?.onSend} style={css(`flex:none;height:36px;padding:0 16px;border-radius:10px;border:none;cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:800;color:#fff;background:${v.dcfg?.color}`)} hoverStyle={css(`background:#7c5cff`)}>
          {"Send"}
        </Hov>
      </div>
    </div>
    {" "}
    </>
  );
}
