/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `pillarGhost.show`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import { css, Txt } from "../runtime";

export function PillarGhost({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div style={css(`position:absolute;left:50%;top:5%;transform:translateX(-50%);pointer-events:none;z-index:1;font-size:clamp(46px,7.6vw,116px);font-weight:800;letter-spacing:.22em;line-height:1;white-space:nowrap;color:${v.pillarGhost?.color}2e;-webkit-text-stroke:2.5px ${v.pillarGhost?.color};text-shadow:0 0 26px ${v.pillarGhost?.color},0 0 90px ${v.pillarGhost?.color};animation:wr-ghost 7s ease-in-out infinite`)}>
      <Txt v={v.pillarGhost?.label} />
    </div>
    {" "}
    </>
  );
}
