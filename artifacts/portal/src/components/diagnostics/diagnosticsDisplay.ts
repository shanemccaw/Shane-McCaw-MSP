import { CHECK_STATUS_LABEL } from "@/components/shell/useScanState";
import type { DiagnosticCheckStatus, DiagnosticFindingSeverity } from "./types";

export const SEVERITY_TOKENS: Readonly<
  Record<DiagnosticFindingSeverity, { readonly ink: string; readonly bg: string; readonly bd: string }>
> = {
  critical: { ink: "#f87171", bg: "rgba(248,113,113,.10)", bd: "rgba(248,113,113,.3)" },
  warning: { ink: "#fbbf24", bg: "rgba(251,191,36,.10)", bd: "rgba(251,191,36,.28)" },
  info: { ink: "#60a5fa", bg: "rgba(96,165,250,.10)", bd: "rgba(96,165,250,.3)" },
  ok: { ink: "#34d399", bg: "rgba(52,211,153,.10)", bd: "rgba(52,211,153,.28)" },
};

/** Per-checkStatus ink, extending the design's own 5-entry demo map
 * (which never enumerated `requires_script` or the three Azure/Power
 * Platform statuses) to cover the real 10-value vocabulary
 * `scanTypes.ts`'s `CHECK_STATUS_LABEL` already names every label for. */
export const CHECK_STATUS_INK: Readonly<Record<DiagnosticCheckStatus, string>> = {
  ok: "#64748b",
  error: "#f87171",
  consent_revoked: "#f87171",
  requires_script: "#60a5fa",
  license_gap: "#fbbf24",
  partial: "#fbbf24",
  service_not_configured: "#94a3b8",
  azure_no_rbac: "#94a3b8",
  azure_no_subscriptions: "#94a3b8",
  power_platform_not_registered: "#94a3b8",
};

export function checkStatusLabel(status: DiagnosticCheckStatus | null): string {
  if (!status) return "";
  return CHECK_STATUS_LABEL[status] ?? "Reported";
}

export function checkStatusInk(status: DiagnosticCheckStatus | null): string {
  if (!status) return "#64748b";
  return CHECK_STATUS_INK[status] ?? "#64748b";
}

export function pillarBarColor(score: number): string {
  if (score >= 80) return "#34d399";
  if (score >= 60) return "#fbbf24";
  return "#f87171";
}

export function formatScanDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) +
    ", " +
    d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
