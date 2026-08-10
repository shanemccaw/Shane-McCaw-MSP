/**
 * Content Studio body — Phase A scaffolding only (Git #681, epic #601).
 * Phase B lands the `post` peek (compose/edit), Phase C the Queue gallery.
 */

import { TEXT } from "../../theme";

/** A stated empty state. Never an empty box — SHELL.md section 6. */
function Stated({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "18px 20px", fontSize: 12.5, lineHeight: 1.6, color: TEXT.faint, textWrap: "pretty" }}>{children}</div>;
}

export function ContentStudioBody() {
  return (
    <Stated>
      Content Studio is scaffolded — Compose and the Queue gallery are wired to the ribbon, but there is nothing to
      show here yet. The compose/edit peek and a real queue land in Phase B/C of #601.
    </Stated>
  );
}
