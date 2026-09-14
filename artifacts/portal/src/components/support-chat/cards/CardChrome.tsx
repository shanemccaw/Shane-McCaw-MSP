import type { ReactNode } from "react";
import { statusTone, formatStatusLabel } from "./card-status";

/** Shared dark card chrome for the four Active Card renderers (design pack #4114/#1741). */
export function CardShell({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <div
      data-testid={testId}
      className="flex w-full max-w-[520px] flex-col gap-[10px] rounded-[12px]"
      style={{ border: "1px solid rgba(255,255,255,.11)", background: "rgba(255,255,255,.025)", padding: "14px 16px 13px" }}
    >
      {children}
    </div>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10px] font-bold uppercase" style={{ letterSpacing: ".11em", color: "#475569" }}>
      {children}
    </span>
  );
}

export function CardRow({ children, divider = true }: { children: ReactNode; divider?: boolean }) {
  return (
    <div
      className="flex items-center gap-3"
      style={divider ? { paddingTop: 9, borderTop: "1px solid rgba(255,255,255,.06)" } : undefined}
    >
      {children}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const tone = statusTone(status);
  return (
    <span
      className="shrink-0 whitespace-nowrap rounded-full text-center text-[10px] font-semibold"
      style={{ color: tone.ink, background: tone.bg, border: `1px solid ${tone.bd}`, padding: "3px 10px" }}
    >
      {formatStatusLabel(status)}
    </span>
  );
}
