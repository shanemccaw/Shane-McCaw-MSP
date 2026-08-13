/* eslint-disable */
// @ts-nocheck
/* ---------------------------------------------------------------------------
 * PORTED FROM DESIGN SOURCE - do not hand-edit casually.
 *
 * Source: warroom/project/M365 War Room.dc.html (template - gated on `gov.staged.show`)
 * This is a mechanical port of the Claude Design prototype. It is kept as close
 * to the original as possible so it can be re-diffed against the design when the
 * design changes; that is also why it opts out of typechecking rather than being
 * rewritten into idiomatic typed React.
 * ------------------------------------------------------------------------- */
import { css } from "../runtime";

export function StagedChangesPanel({ v }: { v: any }) {
  return (
    <>
    {" "}
    <div style={css(`margin:9px 13px 0;display:grid;grid-template-columns:minmax(0,1fr) 54px 12px 54px;gap:4px 8px;align-items:baseline;padding:0 2px`)}>
      <span />
      <span style={css(`font-size:8px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#64748b;text-align:right`)}>
        {"Now"}
      </span>
      <span />
      <span style={css(`font-size:8px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#6ee7b7;text-align:right`)}>
        {"After"}
      </span>
    </div>
    {" "}
    </>
  );
}
