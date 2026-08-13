/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `decisionsOpen`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import React from "react";
import { css, Txt, Hov } from "../runtime";

export function DecisionsBoard({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div style={css(`position:absolute;inset:8px;z-index:125;display:flex;flex-direction:column;border-radius:20px;overflow:hidden;border:1px solid rgba(52,211,153,.45);background:linear-gradient(160deg,rgba(6,25,20,.97),rgba(2,6,23,.98));backdrop-filter:blur(18px);box-shadow:0 30px 80px rgba(2,6,23,.85),0 0 70px rgba(16,185,129,.16);animation:wr-rise 340ms cubic-bezier(.22,1,.36,1)`)}>
      <span style={css(`position:absolute;left:0;right:0;top:0;height:1.5px;background:linear-gradient(90deg,transparent,#34d399,transparent);pointer-events:none`)} />
      <div style={css(`position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;pointer-events:none;overflow:hidden;animation:wr-wmdrift 22s ease-in-out infinite`)}>
        <svg width={"200"} height={"200"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#34d399"} strokeWidth={".55"} strokeLinecap={"round"} strokeLinejoin={"round"} style={css(`opacity:.14`)}>
          <path d={"M3 3v18h18"} />
          <path d={"m7 15 4-5 3 3 5-6"} />
        </svg>
        <span style={css(`font-size:clamp(48px,9vw,132px);font-weight:900;letter-spacing:.06em;line-height:.85;color:transparent;-webkit-text-stroke:1px #34d399;opacity:.12;transform:skewX(-9deg)`)}>
          {"DECISIONS"}
        </span>
      </div>
      <div style={css(`position:relative;display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:9px 14px;border-bottom:1px solid rgba(52,211,153,.24)`)}>
        <span style={css(`flex:none;width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;background:#10B981`)}>
          <svg width={"14"} height={"14"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#052e16"} strokeWidth={"2.2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
            <path d={"M3 3v18h18"} />
            <path d={"m7 15 4-5 3 3 5-6"} />
          </svg>
        </span>
        <div style={css(`flex:1 1 180px;min-width:0`)}>
          {" "}
          <div style={css(`font-size:8.5px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#6ee7b7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>
            {"Decision board · live"}
          </div>
          {" "}
          <div style={css(`font-size:14px;font-weight:800;letter-spacing:-.02em;color:#b3bfd2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>
            {"Everything this room has chosen"}
          </div>
          {" "}
        </div>
        <span style={css(`flex:none;font-size:9.5px;font-weight:800;letter-spacing:.12em;padding:4px 10px;border-radius:999px;color:#6ee7b7;border:1px solid rgba(52,211,153,.45);background:rgba(16,185,129,.12);font-family:ui-monospace,Menlo,monospace`)}>
          <Txt v={v.decisions?.count} />
        </span>
        <Hov as="button" onClick={v.decisions?.onClose} style={css(`flex:none;height:28px;padding:0 13px;border-radius:9px;border:none;cursor:pointer;font-family:inherit;font-size:11px;font-weight:800;color:#052e16;background:#34d399`)} hoverStyle={css(`background:#6ee7b7`)}>
          {"Resume briefing"}
        </Hov>
      </div>
      <div style={css(`position:relative;flex:1;min-height:0;display:grid;grid-template-columns:minmax(280px,1fr) minmax(280px,1fr)`)}>
        <div style={css(`min-height:0;overflow-y:auto;overflow-x:clip;padding:14px 15px;display:flex;flex-direction:column;gap:11px;border-right:1px solid rgba(30,41,59,.9)`)}>
          <div style={css(`flex:none;position:relative;border-radius:14px;border:1px solid rgba(52,211,153,.42);background:linear-gradient(165deg,rgba(6,25,20,.9),rgba(2,6,23,.94));box-shadow:0 12px 34px rgba(2,6,23,.6);padding:13px 14px;display:flex;flex-direction:column;gap:12px`)}>
            <span style={css(`position:absolute;left:0;right:0;top:0;height:1.5px;background:linear-gradient(90deg,transparent,#34d399,transparent)`)} />
            <div style={css(`display:flex;align-items:center;gap:8px`)}>
              <span style={css(`width:5px;height:5px;border-radius:99px;background:#34d399;box-shadow:0 0 9px #34d399;animation:wr-blink 1.7s ease-in-out infinite`)} />
              <span style={css(`flex:1;font-size:9.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#6ee7b7`)}>
                {"If you make these changes"}
              </span>
              <span style={css(`font-size:9px;font-weight:800;letter-spacing:.1em;color:${v.bang?.verdictColor};font-family:ui-monospace,Menlo,monospace`)}>
                <Txt v={v.bang?.verdict} />
              </span>
            </div>
            <div style={css(`display:flex;flex-direction:column;gap:5px`)}>
              <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#64748b`)}>
                {"Copilot readiness"}
              </span>
              <div style={css(`display:flex;align-items:center;gap:10px`)}>
                <span style={css(`flex:none;font-size:13px;font-weight:700;color:#64748b;font-variant-numeric:tabular-nums`)}>
                  <Txt v={v.bang?.before} />
                </span>
                <div style={css(`flex:1;min-width:0;position:relative;height:6px;border-radius:99px;background:rgba(2,6,23,.85)`)}>
                  {" "}
                  <span style={css(`position:absolute;left:0;top:0;bottom:0;width:${v.bang?.barBefore};border-radius:99px;background:rgba(148,163,184,.4)`)} />
                  {" "}
                  <span style={css(`position:absolute;left:${v.bang?.barBefore};top:0;bottom:0;width:${v.bang?.barDelta};border-radius:99px;background:linear-gradient(90deg,rgba(52,211,153,.35),#34d399);transition:width 800ms cubic-bezier(.22,1,.36,1)`)} />
                  {" "}
                  <span style={css(`position:absolute;left:${v.bang?.barAfter};top:-4px;bottom:-4px;width:2px;border-radius:99px;background:#6ee7b7;box-shadow:0 0 12px #34d399;transition:left 800ms cubic-bezier(.22,1,.36,1)`)} />
                  {" "}
                </div>
                <span style={css(`flex:none;font-size:26px;font-weight:800;letter-spacing:-.04em;line-height:1;color:${v.bang?.afterColor};font-variant-numeric:tabular-nums`)}>
                  <Txt v={v.bang?.after} />
                </span>
              </div>
            </div>
            <div style={css(`height:1px;background:rgba(52,211,153,.2)`)} />
            {(v.bang?.pillars || []).map((p, pIdx) => (
              <React.Fragment key={pIdx}>
                {" "}
                <div style={css(`display:flex;flex-direction:column;gap:4px`)}>
                  <div style={css(`display:flex;align-items:baseline;gap:8px`)}>
                    <span style={css(`flex:none;width:5px;height:5px;border-radius:99px;background:${p?.color}`)} />
                    <span style={css(`flex:1;min-width:0;font-size:11px;font-weight:700;color:#b3bfd2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>
                      <Txt v={p?.name} />
                    </span>
                    <span style={css(`flex:none;font-size:10px;font-weight:700;color:#64748b;font-variant-numeric:tabular-nums`)}>
                      <Txt v={p?.base} />
                    </span>
                    <span style={css(`flex:none;font-size:9px;color:#475569`)}>
                      {"&#8594;"}
                    </span>
                    <span style={css(`flex:none;font-size:13px;font-weight:800;color:#cbd5e1;font-variant-numeric:tabular-nums`)}>
                      <Txt v={p?.now} />
                    </span>
                    <span style={css(`flex:none;min-width:32px;text-align:right;font-size:9.5px;font-weight:800;color:${p?.gainColor};font-family:ui-monospace,Menlo,monospace`)}>
                      <Txt v={p?.gain} />
                    </span>
                  </div>
                  <div style={css(`position:relative;height:5px;border-radius:99px;background:rgba(2,6,23,.8);overflow:hidden`)}>
                    {" "}
                    <span style={css(`position:absolute;left:0;top:0;bottom:0;width:${p?.barNow};border-radius:99px;background:${p?.color};box-shadow:0 0 10px ${p?.color}88;transition:width 700ms cubic-bezier(.22,1,.36,1)`)} />
                    {" "}
                    <span style={css(`position:absolute;left:${p?.barBase};top:0;bottom:0;width:1.5px;background:rgba(226,232,240,.55)`)} />
                    {" "}
                  </div>
                </div>
                {" "}
              </React.Fragment>
            ))}
          </div>
        </div>
        <div style={css(`min-height:0;overflow-y:auto;overflow-x:clip;padding:14px 15px;display:flex;flex-direction:column;gap:11px`)}>
          <div style={css(`flex:none;position:relative;border-radius:18px;border:1px solid rgba(52,211,153,.4);background:linear-gradient(165deg,rgba(15,23,42,.96),rgba(2,6,23,.94));box-shadow:0 18px 60px rgba(2,6,23,.7),0 0 40px rgba(16,185,129,.12);padding:15px 16px;display:flex;flex-direction:column;gap:11px`)}>
            <div style={css(`display:flex;align-items:flex-start;gap:9px`)}>
              <span style={css(`flex:none;margin-top:4px;width:6px;height:6px;border-radius:99px;background:#34d399;box-shadow:0 0 10px #34d399;animation:wr-blink 1.6s ease-in-out infinite`)} />
              <span style={css(`flex:1;font-size:13px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;line-height:1.25;color:#b3bfd2;text-wrap:pretty`)}>
                {"Decisions taken in this room"}
              </span>
              <span style={css(`flex:none;font-size:9.5px;font-weight:800;letter-spacing:.1em;font-family:ui-monospace,Menlo,monospace;color:#6ee7b7`)}>
                <Txt v={v.bang?.value} />{" YR1"}
              </span>
            </div>
            {v.decisions?.empty && (
              <>
                {" "}
                <div style={css(`padding:14px;border-radius:12px;border:1px dashed rgba(52,211,153,.32);font-size:11px;line-height:1.5;color:#7d8ba3;text-wrap:pretty`)}>
                  {"Nothing chosen yet. Toggle a lever in any pillar deep-dive, or change a licence count, and it lands here as a Now &#8594; Then line."}
                </div>
                {" "}
              </>
            )}
            {(v.decisions?.rows || []).map((r, rIdx) => (
              <React.Fragment key={rIdx}>
                {" "}
                <div style={css(`position:relative;display:flex;gap:10px;padding:10px 12px;border-radius:12px;border:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.55);animation:wr-rise 380ms cubic-bezier(.22,1,.36,1)`)}>
                  <span style={css(`position:absolute;left:0;top:10%;bottom:10%;width:2px;border-radius:99px;background:${r?.color};box-shadow:0 0 10px ${r?.color}99`)} />
                  <div style={css(`flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;padding-left:5px`)}>
                    <span style={css(`font-size:11.5px;font-weight:700;line-height:1.35;color:#b3bfd2;text-wrap:pretty`)}>
                      <Txt v={r?.title} />
                    </span>
                    <span style={css(`font-size:10px;color:#7d8ba3;font-family:ui-monospace,Menlo,monospace;overflow-wrap:anywhere`)}>
                      <Txt v={r?.effect} />
                    </span>
                    <span style={css(`font-size:9px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:${r?.color}`)}>
                      <Txt v={r?.pillar} />
                    </span>
                  </div>
                  <svg width={"13"} height={"13"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#34d399"} strokeWidth={"2.6"} strokeLinecap={"round"} strokeLinejoin={"round"} style={css(`flex:none;margin-top:2px`)}>
                    <path d={"M20 6L9 17l-5-5"} />
                  </svg>
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
