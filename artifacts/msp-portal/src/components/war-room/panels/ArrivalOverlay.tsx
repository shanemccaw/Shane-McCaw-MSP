/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `arrivalShow`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import { css, Txt, ImageSlot } from "../runtime";

export function ArrivalOverlay({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div style={css(`position:absolute;left:50%;bottom:5%;transform:translateX(-50%);width:min(560px,84%);z-index:112;display:flex;align-items:flex-start;gap:13px;padding:14px 17px;border-radius:18px;border:1px solid ${v.arrival?.color}55;background:linear-gradient(160deg,rgba(15,23,42,.96),rgba(2,6,23,.94));backdrop-filter:blur(16px);box-shadow:0 24px 60px rgba(2,6,23,.8),0 0 44px ${v.arrival?.color}33;animation:wr-rise 460ms cubic-bezier(.22,1,.36,1)`)}>
      <span style={css(`flex:none;width:46px;height:46px;border-radius:14px;overflow:hidden;border:2px solid ${v.arrival?.color};box-shadow:0 0 24px ${v.arrival?.color}66;background:${v.arrival?.tile}`)}>
        {" "}
        <ImageSlot id={v.arrival?.slot} shape={"rounded"} radius={"12"} src={v.arrival?.photo} placeholder={""} style={css(`width:100%;height:100%;position:relative;color:transparent`)} />
        {" "}
      </span>
      <div style={css(`flex:1;min-width:0;display:flex;flex-direction:column;gap:4px`)}>
        <div style={css(`display:flex;align-items:baseline;gap:9px;flex-wrap:wrap`)}>
          <span style={css(`font-size:13.5px;font-weight:800;letter-spacing:-.01em;color:#dbe3ee`)}>
            <Txt v={v.arrival?.name} />
          </span>
          <span style={css(`font-size:9.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${v.arrival?.color}`)}>
            <Txt v={v.arrival?.role} />
          </span>
          <span style={css(`margin-left:auto;font-size:8.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#475569;font-family:ui-monospace,Menlo,monospace`)}>
            {"joining · "}<Txt v={v.arrival?.pillar} />
          </span>
        </div>
        <span style={css(`font-size:12.5px;line-height:1.55;color:#b3bfd2;text-wrap:pretty`)}>
          <Txt v={v.arrival?.line} />
        </span>
      </div>
    </div>
    {" "}
    </>
  );
}
