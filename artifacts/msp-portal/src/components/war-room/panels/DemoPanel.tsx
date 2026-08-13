/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `showDemo`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import React from "react";
import { css, Txt, Hov } from "../runtime";

export function DemoPanel({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div style={css(`position:absolute;bottom:calc(100% + 12px);left:0;width:min(392px,100%);z-index:53;border-radius:16px;overflow:hidden;border:1px solid rgba(103,232,249,.34);background:linear-gradient(160deg,rgba(15,23,42,.96),rgba(2,6,23,.93));backdrop-filter:blur(16px);box-shadow:0 22px 60px rgba(2,6,23,.78),0 0 54px rgba(0,120,212,.24);animation:wr-rise 420ms cubic-bezier(.22,1,.36,1)`)}>
      {" "}
      <div style={css(`display:flex;align-items:center;gap:8px;padding:11px 13px;border-bottom:1px solid rgba(30,41,59,.9)`)}>
        <span style={css(`width:6px;height:6px;border-radius:99px;background:#34d399;animation:wr-blink 1.4s ease-in-out infinite`)} />
        <span style={css(`flex:1;font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#7dd3fc`)}>
          {"Live Copilot · exposure scan on your tenant"}
        </span>
        <Hov as="button" onClick={v.onResume} style={css(`flex:none;width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;border:1px solid rgba(51,65,85,.8);background:rgba(2,6,23,.6);color:#94a3b8`)} hoverStyle={css(`color:#e2e8f0`)}>
          <svg width={"11"} height={"11"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} strokeLinecap={"round"}>
            <path d={"M18 6 6 18"} />
            <path d={"m6 6 12 12"} />
          </svg>
        </Hov>
      </div>
      {" "}
      <div style={css(`padding:12px 13px;display:flex;flex-direction:column;gap:10px;max-height:min(430px,62vh);overflow:auto`)}>
        <div style={css(`padding:10px 12px;border-radius:10px;border:1px solid rgba(51,65,85,.8);background:rgba(2,6,23,.6);font-size:11.5px;line-height:1.45;color:#e2e8f0`)}>
          <Txt v={v.demoPrompt} />
          <span style={css(`display:inline-block;width:7px;height:13px;margin-left:2px;vertical-align:-2px;background:#7dd3fc;opacity:${v.demoCaret};animation:wr-blink 1s steps(1) infinite`)} />
        </div>
        {v.demoAwaiting && (
          <>
            {" "}
            <div style={css(`display:flex;align-items:center;gap:9px`)}>
              <span style={css(`flex:1;font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#64748b`)}>
                {"Runs read-only against this tenant"}
              </span>
              <Hov as="button" onClick={v.onDemoSend} style={css(`flex:none;display:flex;align-items:center;gap:7px;height:32px;padding:0 15px;border-radius:9px;border:none;cursor:pointer;font-family:inherit;font-size:12px;font-weight:800;letter-spacing:.02em;color:#fff;background:#0078D4;box-shadow:0 8px 22px rgba(0,120,212,.4)`)} hoverStyle={css(`background:#2563eb`)}>
                {"Send"}
                <svg width={"13"} height={"13"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                  <path d={"m22 2-7 20-4-9-9-4Z"} />
                  <path d={"M22 2 11 13"} />
                </svg>
              </Hov>
            </div>
            {" "}
          </>
        )}
        {v.demoScanning && (
          <>
            {" "}
            <div style={css(`display:flex;flex-direction:column;gap:7px;padding:11px 12px;border-radius:10px;border:1px solid rgba(103,232,249,.28);background:rgba(0,120,212,.08)`)}>
              <div style={css(`display:flex;align-items:center;gap:8px;font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#7dd3fc`)}>
                <span style={css(`width:6px;height:6px;border-radius:99px;background:#34d399;animation:wr-blink 1s ease-in-out infinite`)} />
                <Txt v={v.demoScanLabel} />{" "}
              </div>
              <div style={css(`height:3px;border-radius:99px;background:rgba(30,41,59,.9);overflow:hidden`)}>
                <div style={css(`height:100%;width:${v.demoScanPct};border-radius:99px;background:linear-gradient(90deg,#0078D4,#67E8F9);transition:width 500ms linear`)} />
              </div>
              <div style={css(`font-size:9.5px;font-family:ui-monospace,Menlo,monospace;color:#64748b`)}>
                <Txt v={v.demoScanMeta} />
              </div>
            </div>
            {" "}
          </>
        )}
        {v.demoResults && (
          <>
            {" "}
            <div style={css(`display:flex;flex-direction:column;gap:8px`)}>
              <div style={css(`display:flex;align-items:baseline;gap:8px`)}>
                <span style={css(`font-size:15px;font-weight:800;letter-spacing:-.02em;color:#fca5a5;font-variant-numeric:tabular-nums`)}>
                  <Txt v={v.demoHitCount} />
                </span>
                <span style={css(`font-size:10.5px;font-weight:700;color:#e2e8f0`)}>
                  {"sites Copilot can ground on that should not be reachable"}
                </span>
              </div>
              <div style={css(`display:flex;flex-direction:column;gap:5px`)}>
                {(v.demoSites || []).map((s, sIdx) => (
                  <React.Fragment key={sIdx}>
                    {" "}
                    <Hov as="div" onClick={s?.onClick} style={css(`display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:9px;cursor:pointer;border:1px solid ${s?.border};background:${s?.bg};transition:all 200ms cubic-bezier(.22,1,.36,1)`)} hoverStyle={css(`border-color:rgba(103,232,249,.6)`)}>
                      <span style={css(`flex:none;width:5px;height:26px;border-radius:99px;background:${s?.risk}`)} />
                      <span style={css(`flex:none;font-size:8.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#64748b;width:52px`)}>
                        <Txt v={s?.type} />
                      </span>
                      <span style={css(`flex:1;min-width:0;font-size:11.5px;font-weight:600;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>
                        <Txt v={s?.name} />
                      </span>
                      <span style={css(`flex:none;font-size:9px;font-weight:700;padding:2px 7px;border-radius:6px;color:${s?.risk};background:${s?.chipBg};font-family:ui-monospace,Menlo,monospace`)}>
                        <Txt v={s?.exposure} />
                      </span>
                      <span style={css(`flex:none;font-size:9.5px;color:#64748b;font-variant-numeric:tabular-nums;font-family:ui-monospace,Menlo,monospace`)}>
                        <Txt v={s?.files} />
                      </span>
                    </Hov>
                    {" "}
                  </React.Fragment>
                ))}
              </div>
            </div>
            {" "}
            {v.demoSite && (
              <>
                {" "}
                <div style={css(`padding:10px 12px;border-radius:10px;border:1px solid rgba(248,113,113,.3);background:rgba(40,12,16,.5);display:flex;flex-direction:column;gap:7px`)}>
                  <div style={css(`font-size:11px;font-weight:700;color:#fecaca`)}>
                    <Txt v={v.demoSite?.name} />
                  </div>
                  <div style={css(`font-size:11px;line-height:1.5;color:#e2e8f0;text-wrap:pretty`)}>
                    <Txt v={v.demoSite?.note} />
                  </div>
                  <div style={css(`display:flex;gap:14px;padding-top:2px`)}>
                    {(v.demoSite?.stats || []).map((m, mIdx) => (
                      <React.Fragment key={mIdx}>
                        {" "}
                        <div>
                          {" "}
                          <div style={css(`font-size:13px;font-weight:800;color:#fca5a5;font-variant-numeric:tabular-nums`)}>
                            <Txt v={m?.value} />
                          </div>
                          {" "}
                          <div style={css(`font-size:9px;color:#94a3b8`)}>
                            <Txt v={m?.label} />
                          </div>
                          {" "}
                        </div>
                        {" "}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
                {" "}
              </>
            )}
            {" "}
            {(v.demoQA || []).map((q, qIdx) => (
              <React.Fragment key={qIdx}>
                {" "}
                <div style={css(`display:flex;flex-direction:column;gap:6px`)}>
                  <div style={css(`align-self:flex-end;max-width:88%;padding:7px 11px;border-radius:12px;border-bottom-right-radius:4px;font-size:11px;color:#f1f5f9;border:1px solid rgba(103,232,249,.35);background:rgba(0,120,212,.16)`)}>
                    <Txt v={q?.q} />
                  </div>
                  <div style={css(`align-self:flex-start;max-width:92%;padding:8px 11px;border-radius:12px;border-bottom-left-radius:4px;font-size:11px;line-height:1.5;color:#cbd5e1;border:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.6);text-wrap:pretty`)}>
                    <Txt v={q?.a} />
                  </div>
                </div>
                {" "}
              </React.Fragment>
            ))}
            {" "}
            <div style={css(`display:flex;flex-wrap:wrap;gap:6px`)}>
              {(v.demoSuggested || []).map((c, cIdx) => (
                <React.Fragment key={cIdx}>
                  {" "}
                  <Hov as="button" onClick={c?.onClick} style={css(`height:26px;padding:0 10px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:10.5px;font-weight:600;color:#7dd3fc;border:1px solid rgba(103,232,249,.3);background:rgba(103,232,249,.08)`)} hoverStyle={css(`border-color:rgba(103,232,249,.65);color:#e0f2fe`)}>
                    <Txt v={c?.label} />
                  </Hov>
                  {" "}
                </React.Fragment>
              ))}
            </div>
            {" "}
            <div style={css(`display:flex;gap:7px`)}>
              <input value={v.demoDraft} onChange={v.onDemoDraft} onKeyDown={v.onDemoKey} placeholder={"Ask Copilot about these sites…"} style={css(`flex:1;min-width:0;height:32px;padding:0 11px;border-radius:9px;font-family:inherit;font-size:11.5px;color:#e2e8f0;border:1px solid rgba(51,65,85,.85);background:rgba(2,6,23,.7);outline:none`)} />
              <Hov as="button" onClick={v.onDemoAsk} style={css(`flex:none;height:32px;padding:0 14px;border-radius:9px;border:none;cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:700;color:#fff;background:#0078D4`)} hoverStyle={css(`background:#2563eb`)}>
                {"Ask"}
              </Hov>
            </div>
            {" "}
            <div style={css(`font-size:9px;font-weight:700;letter-spacing:.1em;font-family:ui-monospace,Menlo,monospace;color:#475569`)}>
              <Txt v={v.demoMeta} />
            </div>
            {" "}
            <Hov as="button" onClick={v.onResume} style={css(`height:34px;border-radius:10px;border:none;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;color:#fff;background:#0078D4;box-shadow:0 8px 24px rgba(0,120,212,.35)`)} hoverStyle={css(`background:#2563eb`)}>
              {"Continue the briefing"}
            </Hov>
            {" "}
          </>
        )}
      </div>
      {" "}
    </div>
    {" "}
    </>
  );
}
