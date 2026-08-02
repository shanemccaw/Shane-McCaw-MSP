/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `userSpeaking`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import { css, Txt } from "../runtime";

export function UserSpeakingBubble({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div style={css(`position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);width:min(520px,100%);padding:12px 18px;border-radius:16px;border-bottom-right-radius:4px;border:1px solid rgba(103,232,249,.35);background:rgba(0,120,212,.14);backdrop-filter:blur(14px);animation:wr-rise 380ms cubic-bezier(.22,1,.36,1)`)}>
      {" "}
      <div style={css(`font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#22d3ee;margin-bottom:4px`)}>
        {"You"}
      </div>
      {" "}
      <div style={css(`font-size:13.5px;line-height:1.5;color:#f1f5f9`)}>
        <Txt v={v.userLine} />
      </div>
      {" "}
    </div>
    {" "}
    </>
  );
}
