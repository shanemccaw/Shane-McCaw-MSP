/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `boardOpen`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import React from "react";
import { css, Txt, Hov } from "../runtime";

export function BoardPanel({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div data-board={"true"} style={css(`flex:none;--wr-ry:-6deg;position:relative;border-radius:18px;border:1px solid rgba(148,163,184,.28);background:linear-gradient(165deg,rgba(15,23,42,.94),rgba(2,6,23,.92));backdrop-filter:blur(14px);box-shadow:0 18px 60px rgba(2,6,23,.7),inset 0 0 60px rgba(148,163,184,.05);padding:13px 14px;display:flex;flex-direction:column;gap:12px`)}>
      <div style={css(`display:flex;align-items:center;gap:8px`)}>
        <span style={css(`width:6px;height:6px;border-radius:99px;background:#94a3b8;box-shadow:0 0 10px #94a3b8`)} />
        <span style={css(`flex:1;font-size:10px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#cbd5e1`)}>
          {"The board"}
        </span>
        <span style={css(`font-size:9px;font-weight:700;letter-spacing:.1em;color:#64748b;font-family:ui-monospace,Menlo,monospace`)}>
          {"LIVE"}
        </span>
      </div>
      <div style={css(`display:flex;flex-direction:column;gap:7px`)}>
        <div style={css(`display:flex;align-items:center;gap:8px`)}>
          <span style={css(`flex:1;font-size:9px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#6ee7b7`)}>
            {"Use cases"}
          </span>
          <span style={css(`font-size:9px;font-weight:800;letter-spacing:.1em;font-family:ui-monospace,Menlo,monospace;color:#052e16;background:#34d399;padding:2px 8px;border-radius:999px`)}>
            <Txt v={v.boardCount} />
          </span>
        </div>
        <div style={css(`display:flex;flex-direction:column;gap:6px;padding-left:9px;border-left:2px solid rgba(52,211,153,.45)`)}>
          {(v.boardItems || []).map((u, uIdx) => (
            <React.Fragment key={uIdx}>
              {" "}
              <div style={css(`display:flex;gap:9px;padding:8px 10px;border-radius:10px;border:1px solid ${u?.border};background:${u?.bg};transition:all 420ms cubic-bezier(.22,1,.36,1);animation:wr-rise 420ms cubic-bezier(.22,1,.36,1)`)}>
                <span style={css(`flex:none;margin-top:1px;width:14px;height:14px;border-radius:5px;display:flex;align-items:center;justify-content:center;border:1.5px solid ${u?.boxBorder};background:${u?.boxBg};transition:all 300ms ease`)}>
                  <svg width={"9"} height={"9"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#052e16"} strokeWidth={"3.5"} strokeLinecap={"round"} strokeLinejoin={"round"} style={css(`opacity:${u?.tick};transition:opacity 300ms ease`)}>
                    <path d={"M20 6L9 17l-5-5"} />
                  </svg>
                </span>
                <div style={css(`flex:1;min-width:0;display:flex;flex-direction:column;gap:2px`)}>
                  <span style={css(`font-size:10.5px;font-weight:600;line-height:1.35;color:${u?.titleColor};text-wrap:pretty`)}>
                    <Txt v={u?.title} />
                  </span>
                  <div style={css(`display:flex;align-items:center;gap:7px`)}>
                    <span style={css(`font-size:8.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${u?.color}`)}>
                      <Txt v={u?.who} />
                    </span>
                    <span style={css(`font-size:9px;font-weight:600;color:#64748b;font-family:ui-monospace,Menlo,monospace`)}>
                      <Txt v={u?.value} />
                    </span>
                  </div>
                </div>
              </div>
              {" "}
            </React.Fragment>
          ))}
          {v.useCasesEmpty && (
            <>
              {" "}
              <span style={css(`font-size:10px;line-height:1.45;color:#475569;text-wrap:pretty`)}>
                {"Nothing yet — use cases land here as your people say what they would use Copilot for."}
              </span>
              {" "}
            </>
          )}
        </div>
      </div>
      {(v.lanes || []).map((ln, lnIdx) => (
        <React.Fragment key={lnIdx}>
          {" "}
          <div style={css(`display:flex;flex-direction:column;gap:7px`)}>
            <div style={css(`display:flex;align-items:center;gap:8px`)}>
              <span style={css(`flex:1;font-size:9px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:${ln?.accent}`)}>
                <Txt v={ln?.label} />
              </span>
              <span style={css(`font-size:9px;font-weight:800;letter-spacing:.1em;font-family:ui-monospace,Menlo,monospace;color:${ln?.accent};background:${ln?.accent}22;padding:2px 8px;border-radius:999px`)}>
                <Txt v={ln?.count} />
              </span>
            </div>
            <div style={css(`display:flex;flex-direction:column;gap:6px;padding-left:9px;border-left:2px solid ${ln?.accent}55`)}>
              {(ln?.rows || []).map((r, rIdx) => (
                <React.Fragment key={rIdx}>
                  {" "}
                  <div style={css(`display:flex;flex-direction:column;gap:2px;padding:8px 10px;border-radius:10px;border:1px solid rgba(30,41,59,.9);border-left:2px solid ${r?.color};background:rgba(2,6,23,.55);animation:wr-rise 420ms cubic-bezier(.22,1,.36,1)`)}>
                    <span style={css(`font-size:10.5px;font-weight:600;line-height:1.35;color:#e2e8f0;text-wrap:pretty`)}>
                      <Txt v={r?.t} />
                    </span>
                    <div style={css(`display:flex;align-items:baseline;gap:7px`)}>
                      <span style={css(`font-size:8.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${r?.color}`)}>
                        <Txt v={r?.pillar} />
                      </span>
                      <span style={css(`flex:1;min-width:0;font-size:9px;color:#64748b;font-family:ui-monospace,Menlo,monospace;text-wrap:pretty`)}>
                        <Txt v={r?.m} />
                      </span>
                    </div>
                  </div>
                  {" "}
                </React.Fragment>
              ))}
              {ln?.isEmpty && (
                <>
                  {" "}
                  <span style={css(`font-size:10px;line-height:1.45;color:#475569;text-wrap:pretty`)}>
                    <Txt v={ln?.empty} />
                  </span>
                  {" "}
                </>
              )}
            </div>
          </div>
          {" "}
        </React.Fragment>
      ))}
      {v.findingsOpen && (
        <>
          {" "}
          <div style={css(`padding:11px 12px;border-radius:12px;border:1px solid rgba(103,232,249,.34);background:linear-gradient(160deg,rgba(0,120,212,.14),rgba(2,6,23,.6));display:flex;flex-direction:column;gap:8px`)}>
            <div style={css(`display:flex;align-items:center;gap:8px`)}>
              <svg width={"13"} height={"13"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#7dd3fc"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                <path d={"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"} />
                <path d={"M14 2v6h6M9 15h6"} />
              </svg>
              <span style={css(`flex:1;font-size:9px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#7dd3fc`)}>
                {"Statement of work"}
              </span>
              <span style={css(`font-size:9px;font-weight:800;font-family:ui-monospace,Menlo,monospace;color:#7dd3fc`)}>
                <Txt v={v.sowTotal} />{" findings"}
              </span>
            </div>
            {(v.sowPhases || []).map((p, pIdx) => (
              <React.Fragment key={pIdx}>
                {" "}
                <div style={css(`display:flex;align-items:center;gap:8px`)}>
                  <span style={css(`flex:none;width:5px;height:5px;border-radius:99px;background:#7dd3fc`)} />
                  <span style={css(`flex:1;min-width:0;font-size:10.5px;font-weight:600;color:#cbd5e1;text-wrap:pretty`)}>
                    <Txt v={p?.name} />
                  </span>
                  <span style={css(`flex:none;font-size:9px;font-weight:800;color:#7dd3fc;font-family:ui-monospace,Menlo,monospace`)}>
                    <Txt v={p?.count} />
                  </span>
                </div>
                {" "}
              </React.Fragment>
            ))}
            {v.sowReady && (
              <>
                {" "}
                <Hov as="button" onClick={v.onOpenCopilotDoc} style={css(`margin-top:2px;height:30px;border-radius:9px;border:none;cursor:pointer;font-family:inherit;font-size:11px;font-weight:800;color:#04283a;background:#67E8F9`)} hoverStyle={css(`background:#22d3ee`)}>
                  {"Review the statement of work"}
                </Hov>
                {" "}
              </>
            )}
          </div>
          {" "}
        </>
      )}
    </div>
    {" "}
    </>
  );
}
