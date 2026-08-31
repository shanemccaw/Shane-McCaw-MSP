/**
 * Shared presentational pieces for the configuration report pages (#1798). Dark-canvas,
 * per `docs/design-system.md` — see `./theme.ts` for the extracted values. Kept separate
 * from the existing findings/pillar report components on purpose: this renders a
 * different document (what configuration IS), not a restyle of what is wrong with it.
 */
import type { ReactNode } from "react";
import { HelpCircle } from "lucide-react";
import {
  CANVAS, HAIRLINE_BORDER, GLASS_FILL, INK, TEAL,
  SEVERITY_COLOR, SEVERITY_LABEL, severityForPct, pctOrNull,
  type Severity,
} from "./theme";

export function ReportShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="space-y-6 p-6 rounded-lg"
      style={{ background: CANVAS, color: INK.body, fontFamily: "'Inter', sans-serif" }}
    >
      {children}
    </div>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-lg p-4 ${className}`}
      style={{ border: `1px solid ${HAIRLINE_BORDER}`, background: GLASS_FILL }}
    >
      {children}
    </div>
  );
}

export function Heading({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold" style={{ color: INK.heading }}>{children}</h1>
      {sub && <p className="text-sm mt-1 leading-relaxed" style={{ color: INK.body }}>{sub}</p>}
    </div>
  );
}

/** A missing value renders as unavailable — never as zero, never as red. */
export function SeverityBadge({ pct, label }: { pct: number | null; label: string }) {
  const sev = severityForPct(pct);
  if (sev === null) {
    return (
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
        style={{ border: `1px solid ${HAIRLINE_BORDER}`, color: INK.micro }}
      >
        <HelpCircle className="h-3.5 w-3.5" />
        {label}: unavailable
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ border: `1px solid ${SEVERITY_COLOR[sev]}59`, color: SEVERITY_COLOR[sev] }}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: SEVERITY_COLOR[sev] }} />
      {label}: {pct}% — {SEVERITY_LABEL[sev]}
    </span>
  );
}

export function SeverityDot({ severity }: { severity: Severity | null }) {
  return (
    <span
      className="inline-block h-2 w-2 rounded-full flex-shrink-0"
      style={{ background: severity ? SEVERITY_COLOR[severity] : INK.deEmphasised }}
      title={severity ? SEVERITY_LABEL[severity] : "unavailable"}
    />
  );
}

export function StatTile({ label, value, sub, tone }: {
  label: string; value: number | string; sub?: string; tone?: Severity | "delta";
}) {
  const color = tone === "delta" ? TEAL : tone ? SEVERITY_COLOR[tone] : INK.heading;
  return (
    <Panel>
      <div className="text-xs uppercase tracking-wide" style={{ color: INK.micro }}>{label}</div>
      <div className="text-2xl font-semibold mt-1" style={{ color }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      {sub && <div className="text-xs mt-1" style={{ color: INK.body }}>{sub}</div>}
    </Panel>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div
      className="rounded-lg p-8 text-center text-sm"
      style={{ border: `1px dashed ${HAIRLINE_BORDER}`, color: INK.body }}
    >
      {children}
    </div>
  );
}

export { pctOrNull, severityForPct, SEVERITY_COLOR, SEVERITY_LABEL, INK, HAIRLINE_BORDER, TEAL };
export type { Severity };
