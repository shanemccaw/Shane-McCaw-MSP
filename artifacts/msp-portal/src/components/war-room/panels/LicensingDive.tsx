/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `licOpen`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import React from "react";
import { css, Txt, Hov } from "../runtime";

export function LicensingDive({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div style={css(`position:absolute;inset:8px;z-index:120;display:flex;flex-direction:column;border-radius:20px;overflow:hidden;border:1px solid rgba(20,184,166,.45);background:linear-gradient(160deg,rgba(15,23,42,.98),rgba(2,6,23,.97));backdrop-filter:blur(18px);box-shadow:0 30px 80px rgba(2,6,23,.85),0 0 70px rgba(20,184,166,.2);animation:wr-rise 340ms cubic-bezier(.22,1,.36,1)`)}>
      <div style={css(`display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid rgba(30,41,59,.9)`)}>
        <span style={css(`flex:none;width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;background:#14B8A6`)}>
          <svg width={"16"} height={"16"} viewBox={"0 0 24 24"} fill={"none"} stroke={"#fff"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
            <path d={"M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"} />
          </svg>
        </span>
        <div style={css(`flex:1;min-width:0`)}>
          {" "}
          <div style={css(`font-size:9.5px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#5eead4`)}>
            {"Pillar deep-dive · licence position"}
          </div>
          {" "}
          <div style={css(`font-size:15px;font-weight:800;letter-spacing:-.02em;color:#f1f5f9`)}>
            {"Copilot Licensing Alignment"}
          </div>
          {" "}
          <div style={css(`font-size:10.5px;color:#94a3b8`)}>
            {"Who is eligible, who isn't, and where money is being wasted"}
          </div>
          {" "}
        </div>
        <span style={css(`flex:none;font-size:10px;font-weight:700;letter-spacing:.14em;padding:5px 11px;border-radius:999px;color:${v.lic?.deltaColor};border:1px solid ${v.lic?.deltaColor}55;background:${v.lic?.deltaColor}1a;font-family:ui-monospace,Menlo,monospace`)}>
          <Txt v={v.lic?.deltaLabel} />{" "}<Txt v={v.lic?.delta} />
        </span>
        <button onClick={v.onOpenLicDoc} style={css(`flex:none;display:flex;align-items:center;gap:7px;height:30px;padding:0 13px;border-radius:9px;cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:700;color:#5eead4;border:1px solid rgba(20,184,166,.55);background:rgba(20,184,166,.12)`)}>
          <svg width={"13"} height={"13"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} strokeLinecap={"round"} strokeLinejoin={"round"}>
            <path d={"M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"} />
            <path d={"M14 2v6h6"} />
          </svg>
          {"Open report "}
        </button>
        <Hov as="button" onClick={v.lic?.onClose} style={css(`flex:none;height:30px;padding:0 14px;border-radius:9px;border:none;cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:700;color:#fff;background:#0078D4`)} hoverStyle={css(`background:#2563eb`)}>
          {"Resume briefing"}
        </Hov>
      </div>
      <div style={css(`flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,.85fr) minmax(0,1.3fr)`)}>
        <div style={css(`min-height:0;overflow-y:auto;overflow-x:clip;padding:14px 16px;display:flex;flex-direction:column;gap:11px;border-right:1px solid rgba(30,41,59,.9)`)}>
          <div>
            {" "}
            <div style={css(`font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#64748b`)}>
              {"Licensing pillar score"}
            </div>
            {" "}
            <div style={css(`display:flex;align-items:baseline;gap:9px`)}>
              <span style={css(`font-size:46px;font-weight:800;letter-spacing:-.04em;line-height:1;color:${v.lic?.scoreColor};font-variant-numeric:tabular-nums`)}>
                <Txt v={v.lic?.score} />
              </span>
              {v.lic?.deltaShow && (
                <>
                  {" "}
                  <span style={css(`font-size:12px;font-weight:700;color:#64748b`)}>
                    <Txt v={v.lic?.scoreDelta} />
                  </span>
                  {" "}
                </>
              )}
            </div>
            {" "}
          </div>
          <div style={css(`display:grid;grid-template-columns:1fr 1fr;gap:9px`)}>
            <div style={css(`min-width:0;padding:10px 12px;border-radius:12px;border:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.5)`)}>
              {" "}
              <div style={css(`font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#64748b`)}>
                {"Current spend"}
              </div>
              {" "}
              <div style={css(`min-width:0;font-size:16px;font-weight:800;line-height:1.25;color:#e2e8f0;font-variant-numeric:tabular-nums;overflow-wrap:normal;word-break:keep-all`)}>
                <Txt v={v.lic?.spend} />
              </div>
              {" "}
            </div>
            <div style={css(`min-width:0;padding:10px 12px;border-radius:12px;border:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.5)`)}>
              {" "}
              <div style={css(`font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#64748b`)}>
                {"Paid, unassigned"}
              </div>
              {" "}
              <div style={css(`min-width:0;font-size:16px;font-weight:800;line-height:1.25;color:${v.lic?.wasteColor};font-variant-numeric:tabular-nums;overflow-wrap:normal;word-break:keep-all`)}>
                <Txt v={v.lic?.waste} />
              </div>
              {" "}
            </div>
          </div>
          <div style={css(`padding:11px 13px;border-radius:12px;border:1px solid rgba(20,184,166,.35);background:rgba(20,184,166,.08);display:flex;flex-direction:column;gap:5px`)}>
            <div style={css(`display:flex;align-items:baseline;gap:8px`)}>
              <span style={css(`flex:1;font-size:11px;font-weight:700;color:#5eead4`)}>
                {"Copilot seats licensed"}
              </span>
              <span style={css(`font-size:17px;font-weight:800;color:#e2e8f0;font-variant-numeric:tabular-nums`)}>
                <Txt v={v.lic?.copilotSeats} />
              </span>
            </div>
            <span style={css(`font-size:10.5px;color:#94a3b8`)}>
              <Txt v={v.lic?.copilotCoverage} />{" · modelled return "}<Txt v={v.lic?.returnYr} />{"/yr"}
            </span>
          </div>
          <div style={css(`padding:12px 13px;border-radius:12px;border:1px solid rgba(52,211,153,.35);background:rgba(16,185,129,.08)`)}>
            {" "}
            <div style={css(`font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#6ee7b7`)}>
              {"Net position, year one"}
            </div>
            {" "}
            <div style={css(`font-size:26px;font-weight:800;letter-spacing:-.03em;color:${v.lic?.netColor};font-variant-numeric:tabular-nums`)}>
              <Txt v={v.lic?.net} />
            </div>
            {" "}
            <div style={css(`font-size:10.5px;line-height:1.45;color:#94a3b8;text-wrap:pretty`)}>
              {"Recovered waste plus modelled Copilot return, less any added licence spend."}
            </div>
            {" "}
          </div>
          <div style={css(`height:1px;background:rgba(30,41,59,.9)`)} />
          <div style={css(`font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#64748b`)}>
            {"Seat drift — who holds what"}
          </div>
          <div style={css(`display:grid;grid-template-columns:1fr 1fr;gap:8px`)}>
            {(v.lic?.driftSummary || []).map((d, dIdx) => (
              <React.Fragment key={dIdx}>
                {" "}
                <div style={css(`padding:9px 11px;border-radius:11px;border:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.5)`)}>
                  {" "}
                  <div style={css(`font-size:16px;font-weight:800;color:${d?.c};font-variant-numeric:tabular-nums`)}>
                    <Txt v={d?.v} />
                  </div>
                  {" "}
                  <div style={css(`font-size:9.5px;line-height:1.3;color:#94a3b8;text-wrap:pretty`)}>
                    <Txt v={d?.l} />
                  </div>
                  {" "}
                </div>
                {" "}
              </React.Fragment>
            ))}
          </div>
          <div style={css(`display:flex;gap:6px`)}>
            {(v.lic?.tabs || []).map((t, tIdx) => (
              <React.Fragment key={tIdx}>
                {" "}
                <button onClick={t?.onClick} style={css(`flex:1;height:30px;border-radius:9px;cursor:pointer;font-family:inherit;font-size:10px;font-weight:700;line-height:1.15;color:${t?.color};border:1px solid ${t?.border};background:${t?.bg};transition:all 200ms cubic-bezier(.22,1,.36,1)`)}>
                  <Txt v={t?.label} />{" · "}<Txt v={t?.count} />
                </button>
                {" "}
              </React.Fragment>
            ))}
          </div>
          {(v.lic?.people || []).map((p, pIdx) => (
            <React.Fragment key={pIdx}>
              {" "}
              <div style={css(`display:flex;flex-direction:column;gap:4px;padding:10px 12px;border-radius:11px;border:1px solid ${p?.border};background:${p?.bg};transition:all 280ms cubic-bezier(.22,1,.36,1)`)}>
                <div style={css(`display:flex;align-items:baseline;gap:8px;flex-wrap:wrap`)}>
                  <span style={css(`font-size:12px;font-weight:700;color:#e2e8f0`)}>
                    <Txt v={p?.name} />
                  </span>
                  <span style={css(`flex:1;min-width:70px;font-size:10px;color:#64748b`)}>
                    <Txt v={p?.role} />
                  </span>
                  <span style={css(`white-space:nowrap;font-size:10px;font-weight:700;color:${p?.deltaColor};font-family:ui-monospace,Menlo,monospace`)}>
                    <Txt v={p?.delta} />
                  </span>
                </div>
                <div style={css(`display:flex;align-items:center;gap:7px;font-family:ui-monospace,Menlo,monospace;font-size:10px`)}>
                  <span style={css(`padding:2px 7px;border-radius:6px;color:#94a3b8;border:1px solid rgba(51,65,85,.85)`)}>
                    <Txt v={p?.held} />
                  </span>
                  <span style={css(`color:#475569`)}>
                    {"&#8594;"}
                  </span>
                  <span style={css(`padding:2px 7px;border-radius:6px;color:#5eead4;border:1px solid rgba(20,184,166,.5)`)}>
                    <Txt v={p?.should} />
                  </span>
                  <span style={css(`flex:1`)} />
                  <span style={css(`font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${p?.stateColor}`)}>
                    <Txt v={p?.state} />
                  </span>
                </div>
                <span style={css(`font-size:10.5px;line-height:1.45;color:#94a3b8;text-wrap:pretty`)}>
                  <Txt v={p?.why} />
                </span>
              </div>
              {" "}
            </React.Fragment>
          ))}
          <div onClick={v.lic?.onNormalize} style={css(`display:flex;align-items:center;gap:11px;padding:11px 13px;border-radius:12px;cursor:pointer;border:1px solid rgba(20,184,166,.4);background:rgba(20,184,166,.08)`)}>
            <span style={css(`flex:none;width:36px;height:20px;border-radius:999px;position:relative;background:${v.lic?.normKnobBg};transition:background 260ms ease`)}>
              {" "}
              <span style={css(`position:absolute;top:2px;left:${v.lic?.normKnobX};width:16px;height:16px;border-radius:50%;background:#fff;transition:left 260ms cubic-bezier(.22,1,.36,1)`)} />
              {" "}
            </span>
            <span style={css(`flex:1;display:flex;flex-direction:column;gap:2px`)}>
              <span style={css(`font-size:12px;font-weight:700;color:#e2e8f0`)}>
                {"Normalize SKUs"}
              </span>
              <span style={css(`font-size:10.5px;line-height:1.4;color:#94a3b8;text-wrap:pretty`)}>
                {"Move every mismatched user onto the SKU their actual workload needs."}
              </span>
            </span>
          </div>
          <button onClick={v.lic?.onFixAll} style={css(`height:34px;border-radius:10px;border:none;cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:700;color:${v.lic?.fixColor};background:${v.lic?.fixBg};transition:all 240ms cubic-bezier(.22,1,.36,1)`)}>
            <Txt v={v.lic?.fixLabel} />
          </button>
          <div style={css(`height:1px;background:rgba(30,41,59,.9)`)} />
          <div style={css(`display:flex;flex-direction:column;gap:10px`)}>
            {(v.lic?.licGauges || []).map((g, gIdx) => (
              <React.Fragment key={gIdx}>
                {" "}
                <div style={css(`display:flex;flex-direction:column;gap:4px`)}>
                  <div style={css(`display:flex;align-items:baseline;gap:9px`)}>
                    <span style={css(`flex:1;font-size:9.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#64748b`)}>
                      <Txt v={g?.label} />
                    </span>
                    <span style={css(`font-size:14px;font-weight:800;color:${g?.color};font-variant-numeric:tabular-nums`)}>
                      <Txt v={g?.value} />
                    </span>
                  </div>
                  <div style={css(`height:6px;border-radius:99px;background:rgba(2,6,23,.8);overflow:hidden`)}>
                    {" "}
                    <div style={css(`height:100%;width:${g?.w};border-radius:99px;background:${g?.color};transition:width 600ms cubic-bezier(.22,1,.36,1),background 400ms ease`)} />
                    {" "}
                  </div>
                </div>
                {" "}
              </React.Fragment>
            ))}
          </div>
          <div style={css(`display:flex;flex-direction:column;gap:6px;padding:11px 13px;border-radius:12px;border:1px solid rgba(20,184,166,.32);background:rgba(20,184,166,.08)`)}>
            <div style={css(`display:flex;align-items:baseline;gap:9px`)}>
              <span style={css(`flex:1;font-size:11.5px;font-weight:700;color:#e2e8f0`)}>
                {"Seat drift"}
              </span>
              <span style={css(`font-size:16px;font-weight:800;color:#5eead4;font-variant-numeric:tabular-nums`)}>
                <Txt v={v.lic?.drift} />{"%"}
              </span>
            </div>
            <input type={"range"} min={"-12"} max={"0"} step={"1"} value={v.lic?.driftVal} onChange={v.lic?.onDrift} onInput={v.lic?.onDrift} style={css(`width:100%;accent-color:#14B8A6;cursor:pointer`)} />
            <span style={css(`font-size:10px;color:#64748b;font-family:ui-monospace,Menlo,monospace`)}>
              {"−12% today · drag toward 0 to model correction"}
            </span>
          </div>
          <div onClick={v.lic?.onNormalize} style={css(`display:flex;align-items:flex-start;gap:11px;padding:11px 13px;border-radius:12px;cursor:pointer;border:1px solid rgba(20,184,166,.32);background:rgba(2,6,23,.5)`)}>
            <span style={css(`flex:none;margin-top:2px;width:36px;height:20px;border-radius:999px;position:relative;background:${v.lic?.normKnobBg};transition:background 260ms ease`)}>
              {" "}
              <span style={css(`position:absolute;top:2px;left:${v.lic?.normKnobX};width:16px;height:16px;border-radius:50%;background:#fff;transition:left 260ms cubic-bezier(.22,1,.36,1)`)} />
              {" "}
            </span>
            <span style={css(`flex:1;display:flex;flex-direction:column;gap:2px`)}>
              <span style={css(`font-size:12px;font-weight:700;color:#e2e8f0`)}>
                {"Normalize SKUs"}
              </span>
              <span style={css(`font-size:10.5px;line-height:1.4;color:#94a3b8;text-wrap:pretty`)}>
                {"Move every misassigned user onto the SKU their real workload needs."}
              </span>
            </span>
          </div>
          <div style={css(`display:flex;flex-direction:column;gap:6px;padding:11px 13px;border-radius:12px;border:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.5)`)}>
            <span style={css(`font-size:9.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#64748b`)}>
              {"Cost waste summary"}
            </span>
            {(v.lic?.wasteBreak?.rows || []).map((w, wIdx) => (
              <React.Fragment key={wIdx}>
                {" "}
                <div style={css(`display:flex;align-items:baseline;gap:10px`)}>
                  <span style={css(`flex:1;min-width:0;font-size:11px;color:#cbd5e1`)}>
                    <Txt v={w?.l} />
                  </span>
                  <span style={css(`flex:none;font-size:12px;font-weight:700;color:#e2e8f0;font-variant-numeric:tabular-nums;word-break:keep-all`)}>
                    <Txt v={w?.v} />
                  </span>
                </div>
                {" "}
              </React.Fragment>
            ))}
            <div style={css(`display:flex;align-items:baseline;gap:10px;padding-top:7px;border-top:1px solid rgba(30,41,59,.9)`)}>
              <span style={css(`flex:1;min-width:0;font-size:11px;font-weight:700;color:#94a3b8`)}>
                {"Total estimated waste"}
              </span>
              <span style={css(`flex:none;font-size:16px;font-weight:800;color:${v.lic?.wasteBreak?.totalColor};font-variant-numeric:tabular-nums;word-break:keep-all`)}>
                <Txt v={v.lic?.wasteBreak?.total} />
              </span>
            </div>
          </div>
          <button onClick={v.lic?.onSim} style={css(`height:34px;border-radius:10px;border:none;cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:800;color:${v.lic?.simColor};background:${v.lic?.simBg};transition:all 240ms cubic-bezier(.22,1,.36,1)`)}>
            <Txt v={v.lic?.simLabel} />
          </button>
          {v.lic?.simOpen && (
            <>
              {" "}
              <div style={css(`display:flex;flex-direction:column;gap:8px;padding:11px 13px;border-radius:12px;border:1px solid rgba(103,232,249,.3);background:rgba(0,120,212,.08);animation:wr-rise 300ms cubic-bezier(.22,1,.36,1)`)}>
                <div style={css(`display:flex;align-items:center;gap:8px`)}>
                  <span style={css(`width:6px;height:6px;border-radius:99px;background:#34d399;animation:wr-blink 1.4s ease-in-out infinite`)} />
                  <span style={css(`font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#7dd3fc`)}>
                    {"Eligibility simulation"}
                  </span>
                </div>
                {(v.lic?.simRows || []).map((sr, srIdx) => (
                  <React.Fragment key={srIdx}>
                    {" "}
                    <div style={css(`display:flex;align-items:baseline;gap:10px`)}>
                      <span style={css(`flex:1;min-width:0;font-size:11px;color:#cbd5e1`)}>
                        <Txt v={sr?.l} />
                      </span>
                      <span style={css(`flex:none;font-size:12.5px;font-weight:800;color:${sr?.c};font-variant-numeric:tabular-nums;word-break:keep-all`)}>
                        <Txt v={sr?.v} />
                      </span>
                    </div>
                    {" "}
                  </React.Fragment>
                ))}
                <span style={css(`font-size:11px;line-height:1.55;color:#94a3b8;text-wrap:pretty`)}>
                  <Txt v={v.lic?.simNote} />
                </span>
              </div>
              {" "}
            </>
          )}
          <div style={css(`display:flex;gap:10px;padding:11px 13px;border-radius:12px;border:1px solid ${v.lic?.marcusColor}44;background:${v.lic?.marcusColor}12`)}>
            <span style={css(`flex:none;width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#fff;background:${v.lic?.marcusTile}`)}>
              <Txt v={v.lic?.marcusInitials} />
            </span>
            <span style={css(`flex:1;display:flex;flex-direction:column;gap:3px`)}>
              <span style={css(`font-size:9.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${v.lic?.marcusColor}`)}>
                <Txt v={v.lic?.marcusName} />
              </span>
              <span style={css(`font-size:11.5px;line-height:1.55;color:#e2e8f0;text-wrap:pretty`)}>
                <Txt v={v.lic?.marcusSays} />
              </span>
            </span>
          </div>
          <Hov as="button" onClick={v.lic?.onLicHow} style={css(`display:flex;align-items:center;gap:9px;padding:10px 13px;border-radius:12px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;text-align:left;color:#e2e8f0;border:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.5)`)} hoverStyle={css(`border-color:rgba(20,184,166,.5)`)}>
            <span style={css(`flex:1`)}>
              {"How to fix this"}
            </span>
            <svg width={"13"} height={"13"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2.2"} strokeLinecap={"round"} strokeLinejoin={"round"} style={css(`transform:rotate(${v.lic?.licFixChevron});transition:transform 240ms cubic-bezier(.22,1,.36,1)`)}>
              <path d={"M6 9l6 6 6-6"} />
            </svg>
          </Hov>
          {v.lic?.licFixOpen && (
            <>
              {" "}
              <div style={css(`display:flex;flex-direction:column;gap:8px;padding:11px 13px;border-radius:12px;border:1px solid rgba(20,184,166,.3);background:rgba(20,184,166,.07);animation:wr-rise 260ms cubic-bezier(.22,1,.36,1)`)}>
                {(v.lic?.licFixSteps || []).map((fx, fxIdx) => (
                  <React.Fragment key={fxIdx}>
                    {" "}
                    <div style={css(`display:flex;flex-direction:column;gap:2px`)}>
                      <span style={css(`font-size:11.5px;font-weight:700;color:#5eead4`)}>
                        <Txt v={fx?.t} />
                      </span>
                      <span style={css(`font-size:10.5px;line-height:1.5;color:#94a3b8;text-wrap:pretty`)}>
                        <Txt v={fx?.d} />
                      </span>
                    </div>
                    {" "}
                  </React.Fragment>
                ))}
              </div>
              {" "}
            </>
          )}
        </div>
        <div style={css(`min-height:0;overflow-y:auto;overflow-x:clip;padding:14px 16px;display:flex;flex-direction:column;gap:8px`)}>
          <div style={css(`display:flex;align-items:center;gap:10px`)}>
            <span style={css(`flex:1;font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#64748b`)}>
              {"Adjust seats — the numbers move live"}
            </span>
            <Hov as="button" onClick={v.lic?.onReset} style={css(`height:24px;padding:0 10px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:10px;font-weight:700;color:#94a3b8;border:1px solid rgba(51,65,85,.85);background:rgba(2,6,23,.6)`)} hoverStyle={css(`color:#e2e8f0`)}>
              {"Reset"}
            </Hov>
          </div>
          {(v.lic?.rows || []).map((r, rIdx) => (
            <React.Fragment key={rIdx}>
              {" "}
              <div style={css(`display:flex;flex-wrap:wrap;align-items:center;gap:9px 11px;padding:10px 12px;border-radius:12px;border:1px solid ${r?.border};background:${r?.bg};transition:all 260ms cubic-bezier(.22,1,.36,1)`)}>
                <div style={css(`flex:1 1 150px;min-width:150px;display:flex;flex-direction:column;gap:3px`)}>
                  <div style={css(`display:flex;flex-wrap:wrap;align-items:baseline;gap:8px`)}>
                    <span style={css(`font-size:12.5px;font-weight:700;color:#e2e8f0;text-wrap:pretty`)}>
                      <Txt v={r?.name} />
                    </span>
                    <span style={css(`font-size:10px;color:#64748b;font-family:ui-monospace,Menlo,monospace`)}>
                      <Txt v={r?.unit} />
                    </span>
                  </div>
                  <span style={css(`font-size:10.5px;color:#94a3b8;text-wrap:pretty`)}>
                    <Txt v={r?.note} />
                  </span>
                  <span style={css(`font-size:10px;font-weight:700;color:${r?.idleColor};font-family:ui-monospace,Menlo,monospace`)}>
                    <Txt v={r?.assigned} />{" assigned · "}<Txt v={r?.idle} />
                  </span>
                </div>
                <div style={css(`flex:none;display:flex;align-items:center;gap:7px`)}>
                  <Hov as="button" onClick={r?.onMinus} style={css(`width:26px;height:26px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:15px;font-weight:700;line-height:1;color:#e2e8f0;border:1px solid rgba(51,65,85,.9);background:rgba(2,6,23,.7)`)} hoverStyle={css(`border-color:#0078D4`)}>
                    {"−"}
                  </Hov>
                  <span style={css(`min-width:56px;text-align:center;font-size:16px;font-weight:800;color:${r?.qtyColor};font-variant-numeric:tabular-nums`)}>
                    <Txt v={r?.qty} />
                  </span>
                  <Hov as="button" onClick={r?.onPlus} style={css(`width:26px;height:26px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:15px;font-weight:700;line-height:1;color:#e2e8f0;border:1px solid rgba(51,65,85,.9);background:rgba(2,6,23,.7)`)} hoverStyle={css(`border-color:#0078D4`)}>
                    {"+"}
                  </Hov>
                </div>
                <Hov as="button" onClick={r?.onFit} style={css(`flex:none;height:26px;padding:0 11px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:10px;font-weight:700;color:#cbd5e1;border:1px solid rgba(51,65,85,.9);background:rgba(2,6,23,.6)`)} hoverStyle={css(`color:#fff;border-color:#0078D4`)}>
                  {"Right-size"}
                </Hov>
                {r?.invest && (
                  <>
                    {" "}
                    <Hov as="button" onClick={r?.onFitInvest} style={css(`flex:none;height:26px;padding:0 11px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:10px;font-weight:700;color:#052e16;border:none;background:#5eead4`)} hoverStyle={css(`background:#2dd4bf`)}>
                      {"Licence 400"}
                    </Hov>
                    {" "}
                  </>
                )}
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
