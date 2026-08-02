/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `qaOpen`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import React from "react";
import { css, Txt, Hov } from "../runtime";

export function QaPanel({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div style={css(`position:fixed;bottom:104px;left:50%;transform:translateX(-50%);width:min(600px,92vw);z-index:130;border-radius:18px;overflow:hidden;border:1px solid rgba(103,232,249,.34);background:linear-gradient(160deg,rgba(15,23,42,.96),rgba(2,6,23,.94));backdrop-filter:blur(18px);box-shadow:0 24px 64px rgba(2,6,23,.8),0 0 56px rgba(0,120,212,.2);animation:wr-rise 340ms cubic-bezier(.22,1,.36,1)`)}>
      {" "}
      <div style={css(`display:flex;align-items:center;gap:8px;padding:10px 13px;border-bottom:1px solid rgba(30,41,59,.9)`)}>
        <span style={css(`width:6px;height:6px;border-radius:99px;background:#22d3ee;animation:wr-blink 1.4s ease-in-out infinite`)} />
        <span style={css(`flex:1;font-size:9.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#7dd3fc`)}>
          {"Briefing held · you have the floor"}
        </span>
        <span style={css(`font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#475569`)}>
          <Txt v={v.qa?.topic} />
        </span>
        <Hov as="button" onClick={v.onQAClose} style={css(`flex:none;width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;border:1px solid rgba(51,65,85,.8);background:rgba(2,6,23,.6);color:#94a3b8`)} hoverStyle={css(`color:#e2e8f0`)}>
          <svg width={"11"} height={"11"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} strokeLinecap={"round"}>
            <path d={"M18 6 6 18"} />
            <path d={"m6 6 12 12"} />
          </svg>
        </Hov>
      </div>
      {" "}
      <div style={css(`padding:12px 14px 14px;display:flex;flex-direction:column;gap:11px;max-height:min(420px,52vh);overflow-y:auto;overflow-x:hidden`)}>
        <div style={css(`align-self:flex-end;max-width:82%;padding:9px 13px;border-radius:14px;border-bottom-right-radius:4px;font-size:12.5px;line-height:1.45;color:#f1f5f9;border:1px solid rgba(103,232,249,.35);background:rgba(0,120,212,.16)`)}>
          <Txt v={v.qa?.q} />
        </div>
        <div style={css(`display:flex;gap:10px`)}>
          <span style={css(`flex:none;width:30px;height:30px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:#fff;background:${v.qa?.tile}`)}>
            <Txt v={v.qa?.initials} />
          </span>
          <div style={css(`flex:1;min-width:0`)}>
            {" "}
            <div style={css(`display:flex;align-items:baseline;gap:7px;margin-bottom:4px`)}>
              <span style={css(`font-size:11px;font-weight:800;color:${v.qa?.roleColor}`)}>
                <Txt v={v.qa?.name} />
              </span>
              <span style={css(`font-size:9px;font-weight:600;color:#475569`)}>
                <Txt v={v.qa?.role} />
              </span>
            </div>
            {" "}
            {v.qa?.thinking && (
              <>
                {" "}
                <div style={css(`display:flex;align-items:center;gap:7px;padding:9px 12px;border-radius:12px;border-bottom-left-radius:4px;border:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.6)`)}>
                  <span style={css(`width:6px;height:6px;border-radius:99px;background:#64748b;animation:wr-blink 1s ease-in-out infinite`)} />
                  <span style={css(`width:6px;height:6px;border-radius:99px;background:#64748b;animation:wr-blink 1s ease-in-out .2s infinite`)} />
                  <span style={css(`width:6px;height:6px;border-radius:99px;background:#64748b;animation:wr-blink 1s ease-in-out .4s infinite`)} />
                  <span style={css(`font-size:10px;color:#64748b;margin-left:4px`)}>
                    {"pulling your numbers…"}
                  </span>
                </div>
                {" "}
              </>
            )}
            {" "}
            {v.qa?.hasAnswer && (
              <>
                {" "}
                <div style={css(`padding:10px 13px;border-radius:12px;border-bottom-left-radius:4px;font-size:12.5px;line-height:1.5;color:#e2e8f0;border:1px solid rgba(30,41,59,.9);background:rgba(2,6,23,.6);text-wrap:pretty;animation:wr-rise 260ms cubic-bezier(.22,1,.36,1)`)}>
                  <Txt v={v.qa?.answer} />
                </div>
                {" "}
              </>
            )}
            {" "}
          </div>
        </div>
        {v.qa?.hasAnswer && (
          <>
            {" "}
            <div style={css(`display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:9px;padding:11px 13px;border-radius:12px;border:1px solid rgba(103,232,249,.22);background:rgba(0,120,212,.07);animation:wr-rise 320ms cubic-bezier(.22,1,.36,1)`)}>
              {(v.qa?.metrics || []).map((m, mIdx) => (
                <React.Fragment key={mIdx}>
                  {" "}
                  <div>
                    {" "}
                    <div style={css(`font-size:17px;font-weight:800;letter-spacing:-.02em;color:${m?.color};font-variant-numeric:tabular-nums`)}>
                      <Txt v={m?.value} />
                    </div>
                    {" "}
                    <div style={css(`font-size:9px;line-height:1.3;color:#94a3b8`)}>
                      <Txt v={m?.label} />
                    </div>
                    {" "}
                  </div>
                  {" "}
                </React.Fragment>
              ))}
            </div>
            {" "}
            <div style={css(`display:flex;flex-wrap:wrap;gap:6px`)}>
              {(v.qa?.follow || []).map((f, fIdx) => (
                <React.Fragment key={fIdx}>
                  {" "}
                  <Hov as="button" onClick={f?.onClick} style={css(`display:flex;align-items:center;gap:6px;height:28px;padding:0 11px;border-radius:999px;cursor:pointer;font-family:inherit;font-size:11px;font-weight:600;color:#7dd3fc;border:1px solid rgba(103,232,249,.3);background:rgba(103,232,249,.08)`)} hoverStyle={css(`border-color:rgba(103,232,249,.7);color:#e0f2fe`)}>
                    <Txt v={f?.label} />
                    <span style={css(`font-size:9px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#475569`)}>
                      <Txt v={f?.who} />
                    </span>
                  </Hov>
                  {" "}
                </React.Fragment>
              ))}
            </div>
            {" "}
            <div style={css(`display:flex;align-items:center;gap:9px;padding-top:2px`)}>
              <span style={css(`flex:1;font-size:10.5px;color:#64748b`)}>
                {"Anything else before we carry on? Type below and the room stays with you."}
              </span>
              <Hov as="button" onClick={v.onQAResume} style={css(`flex:none;height:32px;padding:0 15px;border-radius:9px;border:none;cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:700;color:#fff;background:#0078D4;box-shadow:0 8px 22px rgba(0,120,212,.35)`)} hoverStyle={css(`background:#2563eb`)}>
                {"That answers it — continue"}
              </Hov>
            </div>
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
