/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `personaPanel`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import React from "react";
import { css, Txt, Hov } from "../runtime";

export function PersonaPanel({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div style={css(`position:absolute;bottom:calc(100% + 12px);left:50%;transform:translateX(-50%);width:min(620px,100%);z-index:56;border-radius:18px;overflow:hidden;border:1px solid rgba(103,232,249,.32);background:linear-gradient(160deg,rgba(15,23,42,.96),rgba(2,6,23,.94));backdrop-filter:blur(16px);box-shadow:0 26px 70px rgba(2,6,23,.8),0 0 60px rgba(0,120,212,.18);animation:wr-rise 340ms cubic-bezier(.22,1,.36,1)`)}>
      {" "}
      <div style={css(`display:flex;align-items:flex-start;gap:11px;padding:14px 16px;border-bottom:1px solid rgba(30,41,59,.9)`)}>
        <span style={css(`flex:none;width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;color:#fff;background:${v.personaPanel?.tile}`)}>
          <Txt v={v.personaPanel?.initials} />
        </span>
        <div style={css(`flex:1;min-width:0;line-height:1.35`)}>
          {" "}
          <div style={css(`font-size:14px;font-weight:700;color:#f1f5f9`)}>
            <Txt v={v.personaPanel?.name} />
          </div>
          {" "}
          <div style={css(`font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:${v.personaPanel?.color}`)}>
            <Txt v={v.personaPanel?.role} />
          </div>
          {" "}
          <div style={css(`margin-top:4px;font-size:11.5px;line-height:1.5;color:#94a3b8;text-wrap:pretty`)}>
            <Txt v={v.personaPanel?.fn} />
          </div>
          {" "}
        </div>
        <Hov as="button" onClick={v.onClosePersona} style={css(`flex:none;width:24px;height:24px;border-radius:7px;display:flex;align-items:center;justify-content:center;cursor:pointer;border:1px solid rgba(51,65,85,.8);background:rgba(2,6,23,.6);color:#94a3b8`)} hoverStyle={css(`color:#e2e8f0`)}>
          <svg width={"12"} height={"12"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} strokeLinecap={"round"}>
            <path d={"M18 6 6 18"} />
            <path d={"m6 6 12 12"} />
          </svg>
        </Hov>
      </div>
      {" "}
      <div style={css(`padding:14px 16px;display:flex;flex-direction:column;gap:14px;max-height:62vh;overflow-y:auto`)}>
        <div style={css(`display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px`)}>
          <div style={css(`padding:11px 12px;border-radius:12px;border:1px solid rgba(30,41,59,.9);background:rgba(15,23,42,.5)`)}>
            {" "}
            <div style={css(`font-size:9.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#64748b;margin-bottom:6px`)}>
              {"Cares about"}
            </div>
            {" "}
            <div style={css(`font-size:11.5px;line-height:1.5;color:#cbd5e1;text-wrap:pretty`)}>
              <Txt v={v.personaPanel?.cares} />
            </div>
            {" "}
          </div>
          <div style={css(`padding:11px 12px;border-radius:12px;border:1px solid rgba(30,41,59,.9);background:rgba(15,23,42,.5)`)}>
            {" "}
            <div style={css(`font-size:9.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#64748b;margin-bottom:6px`)}>
              {"Sees as blocking"}
            </div>
            {" "}
            <div style={css(`font-size:11.5px;line-height:1.5;color:#cbd5e1;text-wrap:pretty`)}>
              <Txt v={v.personaPanel?.blocking} />
            </div>
            {" "}
          </div>
          <div style={css(`padding:11px 12px;border-radius:12px;border:1px solid rgba(30,41,59,.9);background:rgba(15,23,42,.5)`)}>
            {" "}
            <div style={css(`font-size:9.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#64748b;margin-bottom:6px`)}>
              {"Needs fixed"}
            </div>
            {" "}
            <div style={css(`font-size:11.5px;line-height:1.5;color:#cbd5e1;text-wrap:pretty`)}>
              <Txt v={v.personaPanel?.needs} />
            </div>
            {" "}
          </div>
        </div>
        <div style={css(`display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px`)}>
          {(v.personaPanel?.columns || []).map((c, cIdx) => (
            <React.Fragment key={cIdx}>
              {" "}
              <div style={css(`padding:11px 12px;border-radius:12px;border:1px solid rgba(30,41,59,.9);background:rgba(15,23,42,.5)`)}>
                {" "}
                <div style={css(`display:flex;align-items:center;gap:6px;margin-bottom:8px`)}>
                  <span style={css(`width:6px;height:6px;border-radius:99px;background:${c?.color};box-shadow:0 0 8px ${c?.color}`)} />
                  <span style={css(`font-size:9.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${c?.color}`)}>
                    <Txt v={c?.label} />
                  </span>
                </div>
                {" "}
                <div style={css(`display:flex;flex-direction:column;gap:6px`)}>
                  {(c?.items || []).map((i, iIdx) => (
                    <React.Fragment key={iIdx}>
                      {" "}
                      <div style={css(`font-size:11px;line-height:1.45;color:#94a3b8;text-wrap:pretty`)}>
                        <Txt v={i?.text} />
                      </div>
                      {" "}
                    </React.Fragment>
                  ))}
                </div>
                {" "}
              </div>
              {" "}
            </React.Fragment>
          ))}
        </div>
        <div style={css(`padding:11px 13px;border-radius:12px;border:1px solid rgba(103,232,249,.24);background:rgba(0,120,212,.08)`)}>
          {" "}
          <div style={css(`font-size:9.5px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#7dd3fc;margin-bottom:7px`)}>
            {"Priorities"}
          </div>
          {" "}
          <div style={css(`display:flex;flex-direction:column;gap:6px`)}>
            {(v.personaPanel?.priorities || []).map((p, pIdx) => (
              <React.Fragment key={pIdx}>
                {" "}
                <div style={css(`display:flex;gap:9px;align-items:flex-start`)}>
                  <span style={css(`flex:none;width:16px;height:16px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;font-family:ui-monospace,Menlo,monospace;color:#7dd3fc;border:1px solid rgba(103,232,249,.3);background:rgba(2,6,23,.6)`)}>
                    <Txt v={p?.n} />
                  </span>
                  <span style={css(`font-size:11.5px;line-height:1.45;color:#cbd5e1;text-wrap:pretty`)}>
                    <Txt v={p?.text} />
                  </span>
                </div>
                {" "}
              </React.Fragment>
            ))}
          </div>
          {" "}
        </div>
        <div style={css(`display:flex;flex-wrap:wrap;gap:8px`)}>
          {(v.personaPanel?.actions || []).map((a, aIdx) => (
            <React.Fragment key={aIdx}>
              {" "}
              <Hov as="button" onClick={a?.onClick} style={css(`height:34px;padding:0 14px;border-radius:10px;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;color:#7dd3fc;border:1px solid rgba(103,232,249,.3);background:rgba(103,232,249,.08);transition:all 180ms cubic-bezier(.22,1,.36,1)`)} hoverStyle={css(`border-color:rgba(103,232,249,.65);color:#e0f2fe`)}>
                <Txt v={a?.label} />
              </Hov>
              {" "}
            </React.Fragment>
          ))}
        </div>
      </div>
      {" "}
    </div>
    {" "}
    </>
  );
}
