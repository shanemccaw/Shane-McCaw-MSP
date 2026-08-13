/**
 * Content Studio body — Phase A scaffolding (Git #681, epic #601). Phase B
 * (Git #682) landed the `post` peek Compose opens; Phase C (Git #683) wired
 * the Queue ribbon dropdown to real per-status rows. This panel body itself
 * stays an empty state — there is no dedicated Content Studio screen doc yet,
 * only the ribbon's Compose/Queue and the peek they open.
 */

import { TEXT } from "../../theme";

/** A stated empty state. Never an empty box — SHELL.md section 6. */
function Stated({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "18px 20px", fontSize: 12.5, lineHeight: 1.6, color: TEXT.faint, textWrap: "pretty" }}>{children}</div>;
}

export function ContentStudioBody() {
  return (
    <Stated>
      Content Studio is scaffolded — Compose opens the real post peek to write and schedule, and the Queue button
      lists every post grouped by status, but there is no dedicated screen doc here yet and this panel stays empty.
    </Stated>
  );
}
