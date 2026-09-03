/**
 * Wire types for the Tenant Status card / scan log panel (Git #1824).
 *
 * Three real backends, not one — see docs/scan-progress-sse-contract-pack.md (#2520):
 *   1. GET /api/portal/scan-status   — polled snapshot of the customer's latest run
 *   2. GET /api/portal/scan-plan     — the ordered check-key plan for that run
 *   3. GET /api/msp/customers/:customerId/diagnostics/runs/:runId/sse — the live
 *      per-check progress stream (channel "engine.monitor", scoped by runId)
 *
 * Types here are hand-mirrored from the real server shapes (artifacts/api-server/
 * src/routes/portal-assessment.ts:953-1194, src/routes/msp-diagnostics.ts:534-629,
 * src/lib/monitor-executor.ts:422-448) — this monorepo doesn't share types across
 * the artifacts/* boundary (CLAUDE.md, "Workspace / monorepo").
 */

/** `CheckResult["status"]` — artifacts/api-server/src/lib/monitor-executor.ts:360 */
export type CheckStatus =
  | "ok"
  | "error"
  | "consent_revoked"
  | "requires_script"
  | "license_gap"
  | "partial"
  | "service_not_configured"
  | "azure_no_rbac"
  | "azure_no_subscriptions"
  | "power_platform_not_registered";

export interface ScanStatusActiveRun {
  readonly runId: string;
  readonly status: string;
  readonly checksOk: number;
  readonly checksError: number;
  readonly checksLicenseGap: number;
  readonly checksTotal: number;
  readonly startedAt: string;
}

export interface ScanStatusLastRunSummary {
  readonly runId: string;
  readonly status: string;
  readonly checksTotal: number;
  readonly checksOk: number;
  readonly checksError: number;
  readonly checksLicenseGap: number;
  readonly startedAt: string;
  readonly completedAt: string | null;
  /** Only populated when status === "failed" (Git #1824's own backend addition). */
  readonly errorMessage: string | null;
}

export interface ScanStatusResponse {
  readonly everScanned: boolean;
  readonly lastScanAt: string | null;
  readonly active: ScanStatusActiveRun | null;
  readonly lastRunSummary: ScanStatusLastRunSummary | null;
  readonly isTestbed: boolean;
}

export interface ScanPlanResponse {
  readonly runId: string | null;
  readonly packageKey: string | null;
  readonly checkKeys: readonly string[];
}

/** ProgressCallback payload, wrapped with `type` (SSE pack §3b). */
export interface DiagnosticsProgressEvent {
  readonly type: "diagnostics_progress";
  readonly checkKey: string;
  readonly checkLabel: string;
  readonly status: CheckStatus;
  readonly index: number;
  readonly total: number;
  readonly requiresCustomerScript: boolean;
  readonly errorMessage?: string | null;
  readonly severityMatched?: string | null;
  readonly severityLabel?: string | null;
}

/** SSE pack §3c. */
export interface DiagnosticsCompleteEvent {
  readonly type: "diagnostics_complete";
  readonly status: "completed" | "partial";
  readonly checksTotal: number;
  readonly checksOk: number;
  readonly checksError: number;
  readonly requiresScript: number;
  readonly findings: number;
}

/** SSE pack §3d. */
export interface DiagnosticsErrorEvent {
  readonly type: "diagnostics_error";
  readonly message: string;
}

export type DiagnosticsSSEEvent =
  | DiagnosticsProgressEvent
  | DiagnosticsCompleteEvent
  | DiagnosticsErrorEvent;

/**
 * The card/panel's own phase enum — README "Scan states (all eight)".
 * Two are collapsed relative to the design's raw `phase` variable is not
 * accurate; all eight are kept distinct because each has its own copy.
 */
export type ScanPhase =
  | "none"
  | "running"
  | "late-join"
  | "complete"
  | "partial"
  | "failed"
  | "disconnected"
  | "cache-cleared";

/** One reported check, accumulated from real SSE progress events this session. */
export interface ScanLogEntry {
  readonly checkKey: string;
  readonly checkLabel: string;
  readonly status: CheckStatus;
  readonly index: number;
  readonly requiresCustomerScript: boolean;
  readonly severityMatched?: string | null;
  readonly severityLabel?: string | null;
}
