/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `closing`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import { css, Hov } from "../runtime";

export function ClosingPanel({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div style={css(`position:absolute;bottom:calc(100% + 12px);left:50%;transform:translateX(-50%);width:min(560px,100%);z-index:57;border-radius:18px;padding:16px 18px;border:1px solid rgba(103,232,249,.36);background:linear-gradient(160deg,rgba(15,23,42,.96),rgba(2,6,23,.94));backdrop-filter:blur(16px);box-shadow:0 26px 70px rgba(2,6,23,.8),0 0 60px rgba(0,120,212,.22);animation:wr-rise 400ms cubic-bezier(.22,1,.36,1)`)}>
      {" "}
      <div style={css(`display:flex;align-items:center;gap:8px;margin-bottom:8px`)}>
        <span style={css(`flex:1;font-size:10px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#7dd3fc`)}>
          {"Where do you want to go next?"}
        </span>
        <Hov as="button" onClick={v.onDismissClosing} style={css(`flex:none;width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;cursor:pointer;border:1px solid rgba(51,65,85,.8);background:rgba(2,6,23,.6);color:#94a3b8`)} hoverStyle={css(`color:#e2e8f0`)}>
          <svg width={"11"} height={"11"} viewBox={"0 0 24 24"} fill={"none"} stroke={"currentColor"} strokeWidth={"2"} strokeLinecap={"round"}>
            <path d={"M18 6 6 18"} />
            <path d={"m6 6 12 12"} />
          </svg>
        </Hov>
      </div>
      {" "}
      <div style={css(`display:flex;flex-wrap:wrap;gap:9px`)}>
        <Hov as="button" onClick={v.onCloseDocs} style={css(`flex:1;min-width:200px;height:42px;border-radius:12px;cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:700;color:#e2e8f0;border:1px solid rgba(51,65,85,.9);background:rgba(2,6,23,.6);transition:all 180ms cubic-bezier(.22,1,.36,1)`)} hoverStyle={css(`border-color:rgba(103,232,249,.6)`)}>
          {"Review the documents you generated"}
        </Hov>
        <Hov as="button" onClick={v.onClosePath} style={css(`flex:1;min-width:200px;height:42px;border-radius:12px;cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:700;color:#fff;border:none;background:#0078D4;box-shadow:0 8px 24px rgba(0,120,212,.35);transition:background 180ms ease`)} hoverStyle={css(`background:#2563eb`)}>
          {"Show me the path to success"}
        </Hov>
      </div>
      {" "}
    </div>
    {" "}
    </>
  );
}
