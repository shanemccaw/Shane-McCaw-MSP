/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `flight.show`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import { css, Txt } from "../runtime";

export function FlightToast({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div style={css(`position:fixed;z-index:300;pointer-events:none;left:${v.flight?.x};top:${v.flight?.y};width:${v.flight?.w};opacity:${v.flight?.opacity};transform:${v.flight?.transform};transition:${v.flight?.transition}`)}>
      {" "}
      <div style={css(`display:flex;gap:9px;padding:10px 12px;border-radius:12px;border:1.5px solid rgba(52,211,153,.75);background:linear-gradient(160deg,rgba(6,32,26,.98),rgba(2,12,20,.96));box-shadow:0 0 0 1px rgba(52,211,153,.2),0 18px 50px rgba(2,6,23,.8),0 0 46px rgba(16,185,129,.5)`)}>
        <span style={css(`flex:none;margin-top:2px;width:14px;height:14px;border-radius:5px;border:1.5px solid #34d399;background:rgba(16,185,129,.25)`)} />
        <span style={css(`flex:1;min-width:0;display:flex;flex-direction:column;gap:2px`)}>
          <span style={css(`font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#6ee7b7`)}>
            {"Use case captured"}
          </span>
          <span style={css(`font-size:11px;font-weight:600;line-height:1.35;color:#e2e8f0;text-wrap:pretty`)}>
            <Txt v={v.flight?.title} />
          </span>
        </span>
      </div>
      {" "}
    </div>
    {" "}
    </>
  );
}
