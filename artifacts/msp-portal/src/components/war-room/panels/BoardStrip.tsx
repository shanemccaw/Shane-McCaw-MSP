/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `showBoard`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import React from "react";
import { css, Txt } from "../runtime";

export function BoardStrip({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div style={css(`flex:none;border-radius:16px;border:1px solid rgba(248,113,113,.28);background:linear-gradient(160deg,rgba(30,10,14,.7),rgba(2,6,23,.7));backdrop-filter:blur(12px);box-shadow:0 0 46px rgba(248,113,113,.14);padding:13px 15px;animation:wr-rise 420ms cubic-bezier(.22,1,.36,1)`)}>
      {" "}
      <div style={css(`display:flex;align-items:center;gap:7px;margin-bottom:10px`)}>
        <span style={css(`width:6px;height:6px;border-radius:99px;background:#f87171;animation:wr-blink 1.6s ease-in-out infinite`)} />
        <span style={css(`font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#fca5a5`)}>
          {"Live whiteboard"}
        </span>
      </div>
      {" "}
      <div style={css(`display:flex;flex-direction:column;gap:0`)}>
        {(v.board || []).map((b, bIdx) => (
          <React.Fragment key={bIdx}>
            {" "}
            <div style={css(`display:flex;gap:9px;animation:wr-rise 380ms cubic-bezier(.22,1,.36,1)`)}>
              <div style={css(`display:flex;flex-direction:column;align-items:center;flex:none;padding-top:4px`)}>
                <span style={css(`width:7px;height:7px;border-radius:99px;background:#f87171;box-shadow:0 0 10px #f87171`)} />
                <span style={css(`width:1px;flex:1;min-height:14px;background:linear-gradient(180deg,rgba(248,113,113,.7),rgba(248,113,113,.1))`)} />
              </div>
              <div style={css(`padding-bottom:9px;font-size:11.5px;line-height:1.4;color:#fecaca;text-wrap:pretty`)}>
                <Txt v={b?.text} />
              </div>
            </div>
            {" "}
          </React.Fragment>
        ))}
      </div>
      {" "}
    </div>
    {" "}
    </>
  );
}
