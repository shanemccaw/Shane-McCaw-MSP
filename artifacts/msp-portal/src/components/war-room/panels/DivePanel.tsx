/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `diveOpen`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import React from "react";
import { css, Txt, Hov } from "../runtime";

export function DivePanel({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div style={css(`position:absolute;inset:8px;z-index:120;display:flex;flex-direction:column;border-radius:20px;overflow:hidden;border:1px solid ${v.dive?.color}66;background:linear-gradient(160deg,rgba(15,23,42,.98),rgba(2,6,23,.97));backdrop-filter:blur(18px);box-shadow:0 30px 80px rgba(2,6,23,.85);animation:wr-rise 340ms cubic-bezier(.22,1,.36,1)`)}>
      <div style={css(`display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid rgba(30,41,59,.9)`)}>
        <span style={css(`flex:none;width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;background:${v.dive?.color}`)}>
          <svg width={"16"} height={"16"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#fff"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
            <path d={v.dive?.icon} />
          </svg>
        </span>
        <div style={css(`flex:1;min-width:0`)}>
          {" "}
          <div style={css(`font-size:9.5px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:${v.dive?.accent}`)}>
            <Txt v={v.dive?.kicker} />
          </div>
          {" "}
          <div style={css(`font-size:15px;font-weight:800;letter-spacing:-.02em;color:#f1f5f9`)}>
            <Txt v={v.dive?.title} />
          </div>
          {" "}
        </div>
        <span style={css(`flex:none;font-size:10px;font-weight:700;letter-spacing:.14em;padding:5px 11px;border-radius:999px;color:${v.dive?.gateColor};border:1px solid ${v.dive?.gateColor}55;background:${v.dive?.gateColor}1a;font-family:ui-monospace,Menlo,monospace`)}>
          <Txt v={v.dive?.gate} />
        </span>
        {v.dive?.hasDoc && (
          <>
            {" "}
            <button onClick={v.dive?.onOpenDoc} style={css(`flex:none;display:flex;align-items:center;gap:7px;height:30px;padding:0 13px;border-radius:9px;cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:700;color:${v.dive?.accent};border:1px solid ${v.dive?.color}8c;background:${v.dive?.color}1f`)}>
              <svg width={"13"} height={"13"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                <path d={"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"} />
                <path d={"M14 2v6h6"} />
              </svg>
              {"Open report "}
            </button>
            {" "}
          </>
        )}
        <Hov as="button" onClick={v.dive?.onClose} style={css(`flex:none;height:30px;padding:0 14px;border-radius:9px;border:none;cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:700;color:#fff;background:#0078D4`)} hoverStyle={css(`background:#2563eb`)}>
          {"Resume briefing"}
        </Hov>
      </div>
      <div style={css(`flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.15fr)`)}>
        <div style={css(`min-height:0;overflow-y:auto;overflow-x:clip;padding:14px 16px;display:flex;flex-direction:column;gap:12px;border-right:1px solid rgba(30,41,59,.9)`)}>
          <div style={css(`display:flex;align-items:flex-end;gap:12px`)}>
            <div>
              {" "}
              <div style={css(`font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#64748b`)}>
                {"Pillar score"}
              </div>
              {" "}
              <div style={css(`display:flex;align-items:baseline;gap:9px`)}>
                <span style={css(`font-size:46px;font-weight:800;letter-spacing:-.04em;line-height:1;color:${v.dive?.scoreColor};font-variant-numeric:tabular-nums`)}>
                  <Txt v={v.dive?.score} />
                </span>
                {v.dive?.deltaShow && (
                  <>
                    {" "}
                    <span style={css(`font-size:13px;font-weight:700;color:#34d399`)}>
                      <Txt v={v.dive?.delta} />
                    </span>
                    {" "}
                  </>
                )}
              </div>
              {" "}
            </div>
            <span style={css(`flex:1`)} />
            <span style={css(`font-size:10px;color:#64748b`)}>
              <Txt v={v.dive?.effort} />
            </span>
          </div>
          {(v.dive?.metrics || []).map((m, mIdx) => (
            <React.Fragment key={mIdx}>
              {" "}
              <div style={css(`display:flex;align-items:center;gap:12px;padding:11px 13px;border-radius:12px;border:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.5)`)}>
                <span style={css(`flex:1;min-width:120px;font-size:11.5px;line-height:1.35;color:#cbd5e1;text-wrap:pretty`)}>
                  <Txt v={m?.label} />
                </span>
                <span style={css(`flex:none;font-size:13px;font-weight:700;color:#64748b;text-decoration:line-through;font-variant-numeric:tabular-nums`)}>
                  <Txt v={m?.base} />
                </span>
                <svg width={"14"} height={"14"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#475569"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
                  <path d={"M5 12h14M13 6l6 6-6 6"} />
                </svg>
                <span style={css(`flex:none;min-width:62px;text-align:right;font-size:17px;font-weight:800;color:${m?.color};font-variant-numeric:tabular-nums`)}>
                  <Txt v={m?.now} />
                </span>
              </div>
              {" "}
            </React.Fragment>
          ))}
          <div style={css(`padding:11px 13px;border-radius:12px;border:1px solid ${v.dive?.color}44;background:${v.dive?.color}14;font-size:11px;line-height:1.5;color:${v.dive?.accent};text-wrap:pretty`)}>
            {"Read from your tenant this morning — read-only. Toggle a lever to model the change before anyone commits to it."}
          </div>
          {v.dive?.hasInv && (
            <>
              {" "}
              <div style={css(`display:flex;flex-direction:column;gap:9px`)}>
                <div style={css(`height:1px;background:rgba(30,41,59,.9)`)} />
                <div style={css(`font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#64748b`)}>
                  <Txt v={v.dive?.inv?.title} />
                </div>
                <div style={css(`display:flex;gap:6px;flex-wrap:wrap`)}>
                  {(v.dive?.inv?.tabs || []).map((t, tIdx) => (
                    <React.Fragment key={tIdx}>
                      {" "}
                      <button onClick={t?.onClick} style={css(`flex:1;min-width:74px;height:28px;border-radius:9px;cursor:pointer;font-family:inherit;font-size:10px;font-weight:700;color:${t?.color};border:1px solid ${t?.border};background:${t?.bg};transition:all 200ms cubic-bezier(.22,1,.36,1)`)}>
                        <Txt v={t?.label} />
                      </button>
                      {" "}
                    </React.Fragment>
                  ))}
                </div>
                <div style={css(`display:flex;gap:7px`)}>
                  <button onClick={v.dive?.inv?.onRun} style={css(`flex:1;height:32px;border-radius:9px;border:none;cursor:pointer;font-family:inherit;font-size:11px;font-weight:700;color:${v.dive?.inv?.btnColor};background:${v.dive?.inv?.btnBg};transition:all 240ms cubic-bezier(.22,1,.36,1)`)}>
                    <Txt v={v.dive?.inv?.btnLabel} />
                  </button>
                </div>
                {v.dive?.inv?.outOpen && (
                  <>
                    {" "}
                    <div style={css(`display:flex;flex-direction:column;gap:7px;padding:11px 12px;border-radius:12px;border:1px solid rgba(103,232,249,.3);background:rgba(0,120,212,.08);animation:wr-rise 300ms cubic-bezier(.22,1,.36,1)`)}>
                      <div style={css(`display:flex;align-items:center;gap:8px`)}>
                        <span style={css(`width:6px;height:6px;border-radius:99px;background:#34d399;animation:wr-blink 1.4s ease-in-out infinite`)} />
                        <span style={css(`font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#7dd3fc`)}>
                          {"AI analysis · your tenant"}
                        </span>
                      </div>
                      {(v.dive?.inv?.out || []).map((o, oIdx) => (
                        <React.Fragment key={oIdx}>
                          {" "}
                          <div style={css(`font-size:11.5px;line-height:1.5;color:#e2e8f0;text-wrap:pretty;padding-left:10px;border-left:2px solid rgba(103,232,249,.5)`)}>
                            <Txt v={o?.t} />
                          </div>
                          {" "}
                        </React.Fragment>
                      ))}
                    </div>
                    {" "}
                  </>
                )}
                {(v.dive?.inv?.rows || []).map((r, rIdx) => (
                  <React.Fragment key={rIdx}>
                    {" "}
                    <div style={css(`display:flex;flex-direction:column;gap:3px;padding:10px 12px;border-radius:11px;border:1px solid ${r?.border};background:${r?.bg};transition:all 280ms cubic-bezier(.22,1,.36,1)`)}>
                      <div style={css(`display:flex;align-items:baseline;gap:8px`)}>
                        <span style={css(`flex:1;min-width:0;font-size:11.5px;font-weight:700;color:#e2e8f0;text-wrap:pretty`)}>
                          <Txt v={r?.name} />
                        </span>
                        <span style={css(`flex:none;white-space:nowrap;font-size:9px;font-weight:700;padding:2px 7px;border-radius:6px;color:${r?.tagColor};background:${r?.chipBg};font-family:ui-monospace,Menlo,monospace`)}>
                          <Txt v={r?.tag} />
                        </span>
                      </div>
                      <span style={css(`font-size:10.5px;line-height:1.45;color:#94a3b8;text-wrap:pretty`)}>
                        <Txt v={r?.note} />
                      </span>
                    </div>
                    {" "}
                  </React.Fragment>
                ))}
                <div onClick={v.dive?.inv?.onToggle} style={css(`display:flex;align-items:flex-start;gap:11px;padding:11px 13px;border-radius:12px;cursor:pointer;border:1px solid ${v.dive?.color}55;background:${v.dive?.color}14`)}>
                  <span style={css(`flex:none;margin-top:2px;width:36px;height:20px;border-radius:999px;position:relative;background:${v.dive?.inv?.knobBg};transition:background 260ms ease`)}>
                    {" "}
                    <span style={css(`position:absolute;top:2px;left:${v.dive?.inv?.knobX};width:16px;height:16px;border-radius:50%;background:#fff;transition:left 260ms cubic-bezier(.22,1,.36,1)`)} />
                    {" "}
                  </span>
                  <span style={css(`flex:1;display:flex;flex-direction:column;gap:2px`)}>
                    <span style={css(`font-size:12px;font-weight:700;color:#e2e8f0`)}>
                      <Txt v={v.dive?.inv?.toggleLabel} />
                    </span>
                    <span style={css(`font-size:10.5px;line-height:1.4;color:#94a3b8;text-wrap:pretty`)}>
                      <Txt v={v.dive?.inv?.toggleNote} />
                    </span>
                  </span>
                </div>
              </div>
              {" "}
            </>
          )}
        </div>
        <div style={css(`min-height:0;overflow-y:auto;overflow-x:clip;padding:14px 16px;display:flex;flex-direction:column;gap:9px`)}>
          <div style={css(`display:flex;align-items:center;gap:10px`)}>
            <span style={css(`flex:1;font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#64748b`)}>
              {"Levers — toggle to model the change"}
            </span>
            <Hov as="button" onClick={v.dive?.onReset} style={css(`height:24px;padding:0 10px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:10px;font-weight:700;color:#94a3b8;border:1px solid rgba(51,65,85,.85);background:rgba(2,6,23,.6)`)} hoverStyle={css(`color:#e2e8f0`)}>
              {"Reset"}
            </Hov>
          </div>
          {(v.dive?.levers || []).map((l, lIdx) => (
            <React.Fragment key={lIdx}>
              {" "}
              <div onClick={l?.onToggle} style={css(`display:flex;gap:11px;padding:11px 13px;border-radius:12px;cursor:pointer;border:1px solid ${l?.border};background:${l?.bg};transition:all 260ms cubic-bezier(.22,1,.36,1)`)}>
                <span style={css(`flex:none;margin-top:2px;width:36px;height:20px;border-radius:999px;position:relative;background:${l?.knobBg};transition:background 260ms ease`)}>
                  {" "}
                  <span style={css(`position:absolute;top:2px;left:${l?.knobX};width:16px;height:16px;border-radius:50%;background:#fff;transition:left 260ms cubic-bezier(.22,1,.36,1)`)} />
                  {" "}
                </span>
                <div style={css(`flex:1;min-width:0;display:flex;flex-direction:column;gap:3px`)}>
                  <div style={css(`display:flex;align-items:baseline;gap:8px`)}>
                    <span style={css(`flex:1;font-size:12.5px;font-weight:700;color:${l?.titleColor};text-wrap:pretty`)}>
                      <Txt v={l?.title} />
                    </span>
                    <span style={css(`flex:none;white-space:nowrap;font-size:10px;font-weight:700;color:#6ee7b7;font-family:ui-monospace,Menlo,monospace`)}>
                      <Txt v={l?.gain} />
                    </span>
                  </div>
                  <span style={css(`font-size:11px;line-height:1.4;color:#94a3b8;text-wrap:pretty`)}>
                    <Txt v={l?.detail} />
                  </span>
                  <div style={css(`display:flex;gap:8px;flex-wrap:wrap;margin-top:2px`)}>
                    <span style={css(`font-size:9.5px;font-weight:600;padding:2px 8px;border-radius:999px;color:#cbd5e1;border:1px solid rgba(51,65,85,.85)`)}>
                      <Txt v={l?.owner} />
                    </span>
                    <span style={css(`font-size:9.5px;font-weight:600;padding:2px 8px;border-radius:999px;color:#cbd5e1;border:1px solid rgba(51,65,85,.85)`)}>
                      <Txt v={l?.effort} />
                    </span>
                    <span style={css(`font-size:9.5px;font-weight:600;padding:2px 8px;border-radius:999px;color:#94a3b8;border:1px solid rgba(51,65,85,.85)`)}>
                      <Txt v={l?.risk} />
                    </span>
                  </div>
                </div>
              </div>
              {" "}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
    {" "}
    </>
  );
}
