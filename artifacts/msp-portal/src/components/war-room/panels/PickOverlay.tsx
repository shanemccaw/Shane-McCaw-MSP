/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `pickShow`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import React from "react";
import { css, Txt, Hov, ImageSlot } from "../runtime";

export function PickOverlay({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div style={css(`position:absolute;left:50%;bottom:4.5%;transform:translateX(-50%);width:min(720px,92%);z-index:112;display:flex;flex-direction:column;gap:11px;padding:15px 17px;border-radius:20px;border:1px solid rgba(103,232,249,.34);background:linear-gradient(160deg,rgba(15,23,42,.97),rgba(2,6,23,.95));backdrop-filter:blur(18px);box-shadow:0 26px 66px rgba(2,6,23,.85),0 0 54px rgba(0,120,212,.18);animation:wr-rise 420ms cubic-bezier(.22,1,.36,1)`)}>
      <div style={css(`display:flex;align-items:baseline;gap:10px`)}>
        <span style={css(`flex:1;font-size:13.5px;font-weight:800;letter-spacing:-.01em;color:#dbe3ee`)}>
          {"Who do you want to hear from first?"}
        </span>
        <span style={css(`flex:none;font-size:9px;font-weight:800;letter-spacing:.14em;color:#475569;font-family:ui-monospace,Menlo,monospace`)}>
          <Txt v={v.pickHeard} />{" / "}<Txt v={v.pickTotal} />{" MET"}
        </span>
      </div>
      <div style={css(`display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:9px`)}>
        {(v.pickCards || []).map((pc, pcIdx) => (
          <React.Fragment key={pcIdx}>
            {" "}
            <Hov as="div" onClick={pc?.onClick} style={css(`display:flex;flex-direction:column;gap:7px;padding:11px 12px;border-radius:14px;cursor:pointer;border:1px solid ${pc?.border};background:${pc?.bg};transition:all 220ms cubic-bezier(.22,1,.36,1)`)} hoverStyle={css(`border-color:${pc?.color};background:rgba(0,120,212,.14)`)}>
              <div style={css(`display:flex;align-items:center;gap:9px`)}>
                <span style={css(`flex:none;width:34px;height:34px;border-radius:11px;overflow:hidden;border:1.5px solid ${pc?.color}88`)}>
                  {" "}
                  <ImageSlot id={pc?.slot} shape={"rounded"} radius={"10"} src={pc?.photo} placeholder={""} style={css(`width:100%;height:100%;position:relative;color:transparent`)} />
                  {" "}
                </span>
                <div style={css(`flex:1;min-width:0;display:flex;flex-direction:column`)}>
                  <span style={css(`font-size:11.5px;font-weight:800;color:#c3cddc;white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>
                    <Txt v={pc?.name} />
                  </span>
                  <span style={css(`font-size:8.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${pc?.color};white-space:nowrap;overflow:hidden;text-overflow:ellipsis`)}>
                    <Txt v={pc?.role} />
                  </span>
                </div>
                <span style={css(`flex:none;font-size:8px;font-weight:800;letter-spacing:.14em;color:#6ee7b7;font-family:ui-monospace,Menlo,monospace`)}>
                  <Txt v={pc?.tag} />
                </span>
              </div>
              <span style={css(`font-size:10px;line-height:1.45;color:#8b98ad;text-wrap:pretty`)}>
                <Txt v={pc?.hook} />
              </span>
            </Hov>
            {" "}
          </React.Fragment>
        ))}
      </div>
      <div style={css(`display:flex;align-items:center;gap:9px`)}>
        <span style={css(`flex:1;font-size:10px;color:#64748b`)}>
          {"Two more will join later — when what they care about comes up."}
        </span>
        <Hov as="button" onClick={v.onPickSkip} style={css(`flex:none;height:32px;padding:0 15px;border-radius:9px;border:none;cursor:pointer;font-family:inherit;font-size:11.5px;font-weight:800;color:#fff;background:#0078D4;box-shadow:0 8px 22px rgba(0,120,212,.35)`)} hoverStyle={css(`background:#2563eb`)}>
          {"Start the briefing"}
        </Hov>
      </div>
    </div>
    {" "}
    </>
  );
}
