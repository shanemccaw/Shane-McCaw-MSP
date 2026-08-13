/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `docOpen`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import React from "react";
import { css, Txt, Hov } from "../runtime";

export function DocViewerPanel({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div style={css(`position:fixed;inset:0;z-index:400;display:flex;align-items:center;justify-content:center;padding:16px;background:radial-gradient(120% 90% at 50% 0%,${v.dcfg?.color}24,rgba(2,6,23,.92) 62%);backdrop-filter:blur(8px);animation:wr-rise 300ms cubic-bezier(.22,1,.36,1)`)}>
      <div style={css(`position:relative;width:100%;max-width:1120px;height:100%;max-height:940px;display:flex;flex-direction:column;border-radius:22px;overflow:hidden;border:1px solid ${v.doc?.color}66;background:linear-gradient(165deg,rgba(15,23,42,.98),rgba(2,6,23,.98));box-shadow:0 40px 110px rgba(2,6,23,.9),0 0 90px ${v.doc?.color}33`)}>
        <div style={css(`position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(103,232,249,.05) 0px,rgba(103,232,249,.05) 1px,transparent 1px,transparent 4px);opacity:.5`)} />
        <div style={css(`position:relative;display:flex;align-items:center;gap:13px;padding:14px 18px;border-bottom:1px solid rgba(30,41,59,.9)`)}>
          <span style={css(`flex:none;width:32px;height:32px;border-radius:9px;display:flex;align-items:center;justify-content:center;background:${v.doc?.color}`)}>
            <svg width={"17"} height={"17"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#fff"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
              <path d={"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"} />
              <path d={"M14 2v6h6M9 13h6M9 17h6"} />
            </svg>
          </span>
          <div style={css(`flex:1;min-width:0`)}>
            {" "}
            <div style={css(`font-size:9.5px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:${v.doc?.accent}`)}>
              <Txt v={v.doc?.pillar} />{" deliverable · holographic document"}
            </div>
            {" "}
            <div style={css(`font-size:16px;font-weight:800;letter-spacing:-.02em;color:#f1f5f9`)}>
              <Txt v={v.doc?.title} />
            </div>
            {" "}
          </div>
          <Hov as="button" onClick={v.doc?.onClose} style={css(`flex:none;height:30px;padding:0 14px;border-radius:9px;border:none;cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:700;color:#fff;background:#0078D4`)} hoverStyle={css(`background:#2563eb`)}>
            {"Back to the room"}
          </Hov>
        </div>
        <div style={css(`position:relative;flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,216px) minmax(0,1fr);container-type:inline-size`)}>
          <div style={css(`min-height:0;overflow-y:auto;overflow-x:clip;padding:14px 12px;display:flex;flex-direction:column;gap:4px;border-right:1px solid rgba(30,41,59,.9)`)}>
            <div style={css(`padding:0 8px 8px;font-size:8.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#475569`)}>
              {"Contents"}
            </div>
            {(v.doc?.toc || []).map((t, tIdx) => (
              <React.Fragment key={tIdx}>
                {" "}
                <Hov as="button" onClick={t?.onClick} style={css(`display:block;width:100%;padding:7px 9px;border-radius:8px;cursor:pointer;text-align:left;font-family:inherit;font-size:11px;font-weight:600;line-height:1.35;color:${t?.color};border:none;background:${t?.bg}`)} hoverStyle={css(`color:#e2e8f0`)}>
                  <Txt v={t?.label} />
                </Hov>
                {" "}
              </React.Fragment>
            ))}
          </div>
          <div ref={v.doc?.setScroll} style={css(`position:relative;min-height:0;overflow-y:auto;padding:20px 22px 40px;display:flex;flex-direction:column;gap:20px`)}>
            <div>
              {" "}
              <div style={css(`font-size:22px;font-weight:800;letter-spacing:-.03em;color:#f1f5f9;text-wrap:pretty`)}>
                <Txt v={v.doc?.title} />
              </div>
              {" "}
              <div style={css(`margin-top:4px;font-size:11px;color:#64748b;font-family:ui-monospace,Menlo,monospace`)}>
                <Txt v={v.doc?.sub} />
              </div>
              {" "}
              <div style={css(`margin-top:12px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:9px`)}>
                {(v.doc?.meta || []).map((m, mIdx) => (
                  <React.Fragment key={mIdx}>
                    {" "}
                    <div style={css(`padding:9px 11px;border-radius:11px;border:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.55)`)}>
                      {" "}
                      <div style={css(`font-size:16px;font-weight:800;color:#e2e8f0;font-variant-numeric:tabular-nums`)}>
                        <Txt v={m?.v} />
                      </div>
                      {" "}
                      <div style={css(`font-size:9px;line-height:1.3;color:#94a3b8`)}>
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
            {(v.doc?.sections || []).map((sec, secIdx) => (
              <React.Fragment key={secIdx}>
                {" "}
                <div id={sec?.id} style={css(`display:flex;flex-direction:column;gap:11px`)}>
                  <div style={css(`font-size:14px;font-weight:800;letter-spacing:-.01em;color:${v.doc?.accent};padding-bottom:6px;border-bottom:1px solid rgba(30,41,59,.9)`)}>
                    <Txt v={sec?.h} />
                  </div>
                  {(sec?.blocks || []).map((b, bIdx) => (
                    <React.Fragment key={bIdx}>
                      {" "}
                      <div>
                        {" "}
                        {b?.isP && (
                          <>
                            {" "}
                            <div style={css(`font-size:12.5px;line-height:1.65;color:#cbd5e1;text-wrap:pretty`)}>
                              <Txt v={b?.v} />
                            </div>
                            {" "}
                          </>
                        )}
                        {" "}
                        {b?.isCallout && (
                          <>
                            {" "}
                            <div style={css(`padding:12px 14px;border-radius:12px;border:1px solid ${b?.cBorder};background:${b?.cBg};font-size:12.5px;line-height:1.6;color:${b?.cTone};text-wrap:pretty`)}>
                              <Txt v={b?.v} />
                            </div>
                            {" "}
                          </>
                        )}
                        {" "}
                        {b?.isAi && (
                          <>
                            {" "}
                            <div style={css(`display:flex;gap:10px;padding:12px 14px;border-radius:12px;border:1px solid rgba(103,232,249,.3);background:rgba(0,120,212,.08)`)}>
                              <span style={css(`flex:none;margin-top:5px;width:6px;height:6px;border-radius:99px;background:#34d399`)} />
                              <span style={css(`flex:1;font-size:12px;line-height:1.6;color:#e2e8f0;text-wrap:pretty`)}>
                                <Txt v={b?.v} />
                              </span>
                            </div>
                            {" "}
                          </>
                        )}
                        {" "}
                        {b?.isTable && (
                          <>
                            {" "}
                            <div style={css(`display:flex;flex-direction:column;border-radius:12px;overflow-x:clip;border:1px solid rgba(30,41,59,.9)`)}>
                              <div style={css(`display:grid;grid-template-columns:${b?.grid};gap:10px;padding:9px 13px;background:rgba(2,6,23,.75)`)}>
                                {(b?.head || []).map((h, hIdx) => (
                                  <React.Fragment key={hIdx}>
                                    {" "}
                                    <span style={css(`font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#64748b`)}>
                                      <Txt v={h?.h} />
                                    </span>
                                    {" "}
                                  </React.Fragment>
                                ))}
                              </div>
                              {(b?.rows || []).map((r, rIdx) => (
                                <React.Fragment key={rIdx}>
                                  {" "}
                                  <div style={css(`display:grid;grid-template-columns:${b?.grid};gap:10px;padding:9px 13px;border-top:1px solid rgba(30,41,59,.75)`)}>
                                    {(r?.cells || []).map((c, cIdx) => (
                                      <React.Fragment key={cIdx}>
                                        {" "}
                                        <span style={css(`font-size:11px;line-height:1.4;color:#cbd5e1;white-space:normal;overflow-wrap:anywhere`)}>
                                          <Txt v={c?.v} />
                                        </span>
                                        {" "}
                                      </React.Fragment>
                                    ))}
                                  </div>
                                  {" "}
                                </React.Fragment>
                              ))}
                            </div>
                            {" "}
                          </>
                        )}
                        {" "}
                        {b?.isKv && (
                          <>
                            {" "}
                            <div style={css(`display:flex;flex-direction:column;gap:6px`)}>
                              {(b?.rows || []).map((r, rIdx) => (
                                <React.Fragment key={rIdx}>
                                  {" "}
                                  <div style={css(`display:flex;align-items:baseline;gap:12px;padding:8px 12px;border-radius:10px;border:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.5)`)}>
                                    <span style={css(`flex:1;font-size:11.5px;color:#cbd5e1`)}>
                                      <Txt v={r?.l} />
                                    </span>
                                    <span style={css(`flex:none;font-size:13px;font-weight:800;color:#e2e8f0;font-variant-numeric:tabular-nums`)}>
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
                        {" "}
                        {b?.isSteps && (
                          <>
                            {" "}
                            <div style={css(`display:flex;flex-direction:column;gap:7px`)}>
                              {(b?.rows || []).map((r, rIdx) => (
                                <React.Fragment key={rIdx}>
                                  {" "}
                                  <div style={css(`display:flex;gap:11px;align-items:flex-start`)}>
                                    <span style={css(`flex:none;width:20px;height:20px;border-radius:99px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#fca5a5;border:1px solid rgba(248,113,113,.45);font-family:ui-monospace,Menlo,monospace`)}>
                                      <Txt v={r?.n} />
                                    </span>
                                    <span style={css(`flex:1;display:flex;flex-direction:column;gap:2px`)}>
                                      <span style={css(`font-size:12px;font-weight:700;color:#e2e8f0`)}>
                                        <Txt v={r?.head} />
                                      </span>
                                      <span style={css(`font-size:11px;line-height:1.5;color:#94a3b8;text-wrap:pretty`)}>
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
                        {" "}
                        {b?.isHowto && (
                          <>
                            {" "}
                            <div style={css(`display:flex;flex-direction:column;gap:8px;padding:13px 15px;border-radius:13px;border:1px solid ${v.doc?.color}44;background:${v.doc?.color}0f`)}>
                              <div style={css(`display:flex;align-items:baseline;gap:10px;flex-wrap:wrap`)}>
                                <span style={css(`flex:1;min-width:140px;font-size:13px;font-weight:800;color:#f1f5f9`)}>
                                  <Txt v={b?.title} />
                                </span>
                                <span style={css(`font-size:9.5px;font-weight:600;color:#94a3b8;font-family:ui-monospace,Menlo,monospace`)}>
                                  <Txt v={b?.effort} />
                                </span>
                              </div>
                              {(b?.steps || []).map((st, stIdx) => (
                                <React.Fragment key={stIdx}>
                                  {" "}
                                  <div style={css(`display:flex;gap:10px;align-items:flex-start`)}>
                                    <span style={css(`flex:none;width:19px;height:19px;border-radius:99px;display:flex;align-items:center;justify-content:center;font-size:9.5px;font-weight:800;color:${v.doc?.accent};border:1px solid ${v.doc?.color}66;font-family:ui-monospace,Menlo,monospace`)}>
                                      <Txt v={st?.n} />
                                    </span>
                                    <span style={css(`flex:1;font-size:11.5px;line-height:1.55;color:#cbd5e1;text-wrap:pretty`)}>
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
                        {" "}
                      </div>
                      {" "}
                    </React.Fragment>
                  ))}
                </div>
                {" "}
              </React.Fragment>
            ))}
          </div>
        </div>
      </div>
    </div>
    {" "}
    </>
  );
}
