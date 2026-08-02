/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `bangOpen`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import React from "react";
import { css, Txt, Hov } from "../runtime";

export function ReadinessPanel({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div style={css(`position:absolute;inset:8px;z-index:130;display:flex;flex-direction:column;border-radius:20px;overflow:hidden;border:1.5px solid rgba(103,232,249,.6);background:radial-gradient(120% 90% at 50% 0%,rgba(0,60,110,.6),rgba(2,6,23,.98));backdrop-filter:blur(18px);box-shadow:0 30px 90px rgba(2,6,23,.9),0 0 90px rgba(103,232,249,.3);animation:wr-rise 420ms cubic-bezier(.22,1,.36,1)`)}>
      <div style={css(`display:flex;align-items:center;gap:12px;padding:13px 18px;border-bottom:1px solid rgba(30,41,59,.9)`)}>
        <span style={css(`flex:none;width:32px;height:32px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,#0078D4,#67E8F9);box-shadow:0 0 24px rgba(103,232,249,.6)`)}>
          <svg width={"17"} height={"17"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#fff"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
            <path d={"M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"} />
          </svg>
        </span>
        <div style={css(`flex:1;min-width:0`)}>
          {" "}
          <div style={css(`font-size:9.5px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#7dd3fc`)}>
            {"The whole tenant, recalculated"}
          </div>
          {" "}
          <div style={css(`font-size:16px;font-weight:800;letter-spacing:-.02em;color:#f1f5f9`)}>
            {"Copilot readiness — everything you just decided, in one number"}
          </div>
          {" "}
        </div>
        <span style={css(`flex:none;font-size:11px;font-weight:800;letter-spacing:.14em;padding:6px 13px;border-radius:999px;color:${v.bang?.verdictColor};border:1.5px solid ${v.bang?.verdictColor};background:${v.bang?.verdictColor}1a;font-family:ui-monospace,Menlo,monospace`)}>
          <Txt v={v.bang?.verdict} />
        </span>
        <button onClick={v.onOpenCopilotDoc} style={css(`flex:none;display:flex;align-items:center;gap:7px;height:30px;padding:0 13px;border-radius:9px;cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:700;color:#67e8f9;border:1px solid rgba(103,232,249,.55);background:rgba(103,232,249,.14)`)}>
          <svg width={"13"} height={"13"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
            <path d={"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"} />
            <path d={"M14 2v6h6"} />
          </svg>
          {"Open report "}
        </button>
        <Hov as="button" onClick={v.bang?.onClose} style={css(`flex:none;height:30px;padding:0 14px;border-radius:9px;border:none;cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:700;color:#fff;background:#0078D4`)} hoverStyle={css(`background:#2563eb`)}>
          {"Resume briefing"}
        </Hov>
      </div>
      <div style={css(`flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr)`)}>
        <div style={css(`min-height:0;overflow-y:auto;overflow-x:clip;padding:16px 18px;display:flex;flex-direction:column;gap:14px;border-right:1px solid rgba(30,41,59,.9)`)}>
          <div style={css(`display:flex;align-items:flex-end;gap:16px`)}>
            <div>
              {" "}
              <div style={css(`font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#64748b`)}>
                {"This morning"}
              </div>
              {" "}
              <div style={css(`font-size:38px;font-weight:800;line-height:1;color:#64748b;font-variant-numeric:tabular-nums`)}>
                <Txt v={v.bang?.before} />
              </div>
              {" "}
            </div>
            <svg width={"26"} height={"26"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#475569"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"} style={css(`margin-bottom:6px`)}>
              <path d={"M5 12h14M13 6l6 6-6 6"} />
            </svg>
            <div>
              {" "}
              <div style={css(`font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#7dd3fc`)}>
                {"With your decisions"}
              </div>
              {" "}
              <div style={css(`font-size:64px;font-weight:800;line-height:1;letter-spacing:-.04em;color:${v.bang?.afterColor};font-variant-numeric:tabular-nums;text-shadow:0 0 40px currentColor`)}>
                <Txt v={v.bang?.after} />
              </div>
              {" "}
            </div>
          </div>
          <div style={css(`display:grid;grid-template-columns:1fr 1fr;gap:10px`)}>
            <div style={css(`padding:11px 13px;border-radius:12px;border:1px solid rgba(52,211,153,.35);background:rgba(16,185,129,.08)`)}>
              {" "}
              <div style={css(`font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#6ee7b7`)}>
                {"Value, year one"}
              </div>
              {" "}
              <div style={css(`font-size:22px;font-weight:800;color:#34d399;font-variant-numeric:tabular-nums`)}>
                <Txt v={v.bang?.value} />
              </div>
              {" "}
              <div style={css(`font-size:10px;color:#94a3b8`)}>
                <Txt v={v.bang?.recovered} />{" recovered · "}<Txt v={v.bang?.ret} />{" modelled return"}
              </div>
              {" "}
            </div>
            <div style={css(`padding:11px 13px;border-radius:12px;border:1px solid rgba(103,232,249,.35);background:rgba(0,120,212,.1)`)}>
              {" "}
              <div style={css(`font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#7dd3fc`)}>
                {"Copilot seats"}
              </div>
              {" "}
              <div style={css(`font-size:22px;font-weight:800;color:#e2e8f0;font-variant-numeric:tabular-nums`)}>
                <Txt v={v.bang?.seats} />
              </div>
              {" "}
              <div style={css(`font-size:10px;color:#94a3b8`)}>
                <Txt v={v.bang?.covered} />{" use cases covered"}
              </div>
              {" "}
            </div>
          </div>
          <div style={css(`padding:12px 14px;border-radius:12px;border:1px solid rgba(103,232,249,.3);background:rgba(0,120,212,.08);font-size:11.5px;line-height:1.55;color:#bae6fd;text-wrap:pretty`)}>
            {"Nothing here is a projection from a benchmark. Every number moved because of a decision made in this room, against telemetry read from your tenant this morning."}
          </div>
        </div>
        <div style={css(`min-height:0;overflow-y:auto;overflow-x:clip;padding:16px 18px;display:flex;flex-direction:column;gap:11px`)}>
          <span style={css(`font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#64748b`)}>
            {"Blockers"}
          </span>
          {(v.bang?.blockers || []).map((b, bIdx) => (
            <React.Fragment key={bIdx}>
              {" "}
              <div style={css(`display:flex;align-items:flex-start;gap:9px;padding:9px 11px;border-radius:11px;border:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.5)`)}>
                <span style={css(`flex:none;margin-top:1px;font-size:8.5px;font-weight:700;padding:2px 7px;border-radius:6px;color:${b?.tone};background:${b?.tone}1f;font-family:ui-monospace,Menlo,monospace`)}>
                  <Txt v={b?.tag} />
                </span>
                <span style={css(`flex:1;font-size:11px;line-height:1.45;color:#cbd5e1;text-wrap:pretty`)}>
                  <Txt v={b?.t} />
                </span>
              </div>
              {" "}
            </React.Fragment>
          ))}
          <span style={css(`font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#64748b`)}>
            {"Persona readiness"}
          </span>
          {(v.bang?.personaReady || []).map((p, pIdx) => (
            <React.Fragment key={pIdx}>
              {" "}
              <div style={css(`display:flex;align-items:center;gap:9px;padding:8px 11px;border-radius:11px;border:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.5)`)}>
                <span style={css(`flex:1;font-size:11px;font-weight:600;color:#cbd5e1`)}>
                  <Txt v={p?.name} />
                </span>
                <span style={css(`flex:none;font-size:9px;font-weight:700;padding:2px 7px;border-radius:6px;color:${p?.color};background:${p?.chipBg};font-family:ui-monospace,Menlo,monospace`)}>
                  <Txt v={p?.tag} />
                </span>
              </div>
              {" "}
            </React.Fragment>
          ))}
          <div style={css(`display:flex;flex-direction:column;gap:6px;padding:11px 13px;border-radius:12px;border:1px solid rgba(103,232,249,.35);background:rgba(0,120,212,.08)`)}>
            <div style={css(`display:flex;align-items:baseline;gap:9px`)}>
              <span style={css(`flex:1;font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#7dd3fc`)}>
                {"Deployment confidence"}
              </span>
              <span style={css(`font-size:20px;font-weight:800;color:${v.bang?.confidence?.color};font-variant-numeric:tabular-nums`)}>
                <Txt v={v.bang?.confidence?.pct} />
              </span>
            </div>
            <div style={css(`height:7px;border-radius:99px;background:rgba(2,6,23,.75);overflow:hidden`)}>
              {" "}
              <div style={css(`height:100%;width:${v.bang?.confidence?.width};border-radius:99px;background:${v.bang?.confidence?.color};transition:width 700ms cubic-bezier(.22,1,.36,1)`)} />
              {" "}
            </div>
            <span style={css(`font-size:10.5px;line-height:1.45;color:#94a3b8;text-wrap:pretty`)}>
              <Txt v={v.bang?.confidence?.note} />
            </span>
          </div>
          <div onClick={v.bang?.onPreview} style={css(`display:flex;align-items:flex-start;gap:11px;padding:11px 13px;border-radius:12px;cursor:pointer;border:1px solid rgba(103,232,249,.4);background:rgba(0,120,212,.08)`)}>
            <span style={css(`flex:none;margin-top:2px;width:36px;height:20px;border-radius:999px;position:relative;background:${v.bang?.previewKnobBg};transition:background 260ms ease`)}>
              {" "}
              <span style={css(`position:absolute;top:2px;left:${v.bang?.previewKnobX};width:16px;height:16px;border-radius:50%;background:#fff;transition:left 260ms cubic-bezier(.22,1,.36,1)`)} />
              {" "}
            </span>
            <span style={css(`flex:1;display:flex;flex-direction:column;gap:2px`)}>
              <span style={css(`font-size:12px;font-weight:700;color:#e2e8f0`)}>
                {"Enable preview mode"}
              </span>
              <span style={css(`font-size:10.5px;line-height:1.4;color:#94a3b8;text-wrap:pretty`)}>
                {"Show citations and sensitivity labels with every grounded answer, and log each retrieval for legal."}
              </span>
            </span>
          </div>
          <button onClick={v.bang?.onRollout} style={css(`height:36px;border-radius:10px;border:none;cursor:pointer;font-family:inherit;font-size:12px;font-weight:800;color:${v.bang?.rolloutColor};background:${v.bang?.rolloutBg};transition:all 240ms cubic-bezier(.22,1,.36,1)`)}>
            <Txt v={v.bang?.rolloutLabel} />
          </button>
          {v.bang?.rolloutOpen && (
            <>
              {" "}
              <div style={css(`display:flex;flex-direction:column;gap:7px;padding:11px 13px;border-radius:12px;border:1px solid rgba(103,232,249,.32);background:rgba(0,120,212,.08);animation:wr-rise 300ms cubic-bezier(.22,1,.36,1)`)}>
                <div style={css(`display:flex;align-items:center;gap:8px`)}>
                  <span style={css(`width:6px;height:6px;border-radius:99px;background:#34d399;animation:wr-blink 1.4s ease-in-out infinite`)} />
                  <span style={css(`font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#7dd3fc`)}>
                    {"Rollout simulation"}
                  </span>
                </div>
                {(v.bang?.rolloutOut || []).map((o, oIdx) => (
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
          <div style={css(`height:1px;background:rgba(30,41,59,.9)`)} />
          <span style={css(`font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#64748b`)}>
            {"Pillar by pillar"}
          </span>
          {(v.bang?.pillars || []).map((p, pIdx) => (
            <React.Fragment key={pIdx}>
              {" "}
              <div style={css(`display:flex;flex-direction:column;gap:5px`)}>
                <div style={css(`display:flex;align-items:baseline;gap:9px`)}>
                  <span style={css(`flex:1;font-size:12px;font-weight:700;color:#e2e8f0`)}>
                    <Txt v={p?.name} />
                  </span>
                  <span style={css(`font-size:11px;font-weight:700;color:#64748b;font-variant-numeric:tabular-nums`)}>
                    <Txt v={p?.base} />
                  </span>
                  <span style={css(`font-size:15px;font-weight:800;color:#e2e8f0;font-variant-numeric:tabular-nums`)}>
                    <Txt v={p?.now} />
                  </span>
                  <span style={css(`min-width:34px;text-align:right;font-size:11px;font-weight:700;color:${p?.gainColor};font-family:ui-monospace,Menlo,monospace`)}>
                    <Txt v={p?.gain} />
                  </span>
                </div>
                <div style={css(`position:relative;height:8px;border-radius:99px;background:rgba(30,41,59,.9);overflow:hidden`)}>
                  {" "}
                  <span style={css(`position:absolute;left:0;top:0;bottom:0;width:${p?.barNow};border-radius:99px;background:${p?.color};box-shadow:0 0 16px ${p?.color};transition:width 700ms cubic-bezier(.22,1,.36,1)`)} />
                  {" "}
                  <span style={css(`position:absolute;left:${p?.barBase};top:-2px;bottom:-2px;width:2px;background:rgba(226,232,240,.65)`)} />
                  {" "}
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
