/**
 * Content Studio body — Phase A scaffolding (Git #681, epic #601). Phase B
 * (Git #682) landed the `post` peek Compose opens; this panel body stays an
 * empty state until Phase C lands the real Queue gallery.
 */

import { TEXT } from "../../theme";

/** A stated empty state. Never an empty box — SHELL.md section 6. */
function Stated({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "18px 20px", fontSize: 12.5, lineHeight: 1.6, color: TEXT.faint, textWrap: "pretty" }}>{children}</div>;
}

export function ContentStudioBody() {
  return (
    <Stated>
      Content Studio is scaffolded — Compose opens the real post peek to write and schedule, but the Queue gallery
      button has nothing behind it yet and this panel stays empty. A real queue lands in Phase C of #601.
    </Stated>
  );
}
