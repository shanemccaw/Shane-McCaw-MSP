/**
 * Live Scan's data helpers — shared by `LiveScanBody` (which fetches the real
 * cross-tenant snapshot) and this screen's `tenant` peek resolver (which reads
 * it back out).
 *
 * `GET /api/admin/monitor-checks/profiles` is the only cross-tenant read that
 * already exists for `tenant_monitor_profiles` (admin-monitor-checks.ts) — it
 * returns the most recent rows across every tenant, each enriched with
 * `clientName`/`clientCompany`. Caching the last page fetched here, keyed by
 * tenantId, is what lets the peek resolver answer without a second endpoint:
 * a screen's `peeks` resolver is a synchronous function (`registry/types.ts`),
 * so it can only ever read state that was already fetched.
 */

export type MonitorProfileStatus =
  | "ok"
  | "error"
  | "consent_revoked"
  | "requires_script"
  | "license_gap"
  | "partial";

export type MonitorSeverity = "critical" | "warning" | "info" | null;

/** One row of `GET /api/admin/monitor-checks/profiles`'s `profiles` array. */
export interface ScanProfileRow {
  id: number;
  tenantId: string;
  checkKey: string;
  status: MonitorProfileStatus;
  severityMatched: MonitorSeverity;
  severityLabel: string | null;
  errorMessage: string | null;
  itemCount: number | null;
  collectedAt: string;
  clientName: string;
  clientCompany: string;
}

let lastProfiles: ScanProfileRow[] = [];

/** Called by `LiveScanBody` after every successful fetch. */
export function setLastProfiles(rows: ScanProfileRow[]): void {
  lastProfiles = rows;
}

export function getLastProfiles(): ScanProfileRow[] {
  return lastProfiles;
}

/** Rows for one tenant, most-recent-first (the API already orders this way). */
export function profilesForTenant(tenantId: string): ScanProfileRow[] {
  return lastProfiles.filter((p) => p.tenantId === tenantId);
}

/** Test seam. Not used by the app. */
export function resetLiveScanData(): void {
  lastProfiles = [];
}

/**
 * The colour a row's status/severity should read as. Severity (what the check
 * actually found) wins over status (how the check executed) when both are
 * present — a check can complete "ok" and still match a critical rule.
 */
export function toneForRow(status: MonitorProfileStatus, severity: MonitorSeverity): string {
  if (severity === "critical") return "#e57a7a";
  if (severity === "warning") return "#f2ca63";
  if (severity === "info") return "#7fb4d8";
  if (status === "error" || status === "consent_revoked") return "#e57a7a";
  if (status === "requires_script" || status === "license_gap" || status === "partial") return "#f2ca63";
  return "#7fae91";
}

/** Short uppercase mark for a peek list row or table cell. */
export function markForRow(status: MonitorProfileStatus, severity: MonitorSeverity): string {
  if (severity) return severity.toUpperCase();
  if (status === "ok") return "CLEAN";
  return status.replace(/_/g, " ").toUpperCase();
}

/** "3m ago" / "2h ago" / "5d ago", falling back to a locale date past a week. */
export function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}

/** Fields worth pulling out of a log frame's `meta` and showing inline. */
const HIGHLIGHT_FIELDS = ["checkKey", "tenantId", "packageKey", "itemCount", "feature", "cmdletKey"] as const;

export function extractHighlightFields(meta: Record<string, unknown> | null | undefined): string {
  if (!meta) return "";
  const found = HIGHLIGHT_FIELDS.filter((k) => meta[k] != null).map((k) => `${k}=${meta[k]}`);
  return found.length ? ` [${found.join(", ")}]` : "";
}
