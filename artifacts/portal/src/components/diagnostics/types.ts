/**
 * Wire types for the Diagnostics and Scripts page (#3999, Feature #1660),
 * mirroring `GET /api/portal/diagnostics/latest` and
 * `GET /api/portal/health-benchmark` — `artifacts/api-server/src/routes/
 * msp-diagnostics.ts:917-976,1057-1122`. Minimal client-side mirror only; this
 * monorepo doesn't share types across the `artifacts/*` boundary (CLAUDE.md,
 * "Workspace / monorepo"). Field-for-field per
 * `docs/portal/diagnostics-and-scripts-contract-pack.md` §1a/§1d/§2/§3.
 */

/** `MspDiagnosticRunStatus` (lib/db/src/schema/msp.ts) — only "completed" and
 * "partial" rows are ever returned by /diagnostics/latest (its own query
 * filters to those two statuses). */
export type DiagnosticRunStatus = "pending" | "running" | "completed" | "failed" | "partial";

/** The full `msp_diagnostic_runs` row, as `SELECT *` returns it. Only the
 * fields this page actually reads are typed; the rest (cioNarrative*,
 * documentId, ...) belong to the CIO-Report Feature and are ignored here. */
export interface DiagnosticRunWire {
  readonly runId: string;
  readonly packageKey: string;
  readonly status: DiagnosticRunStatus;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly checksTotal: number;
  readonly checksOk: number;
  readonly checksError: number;
  readonly checksRequiresScript: number;
  readonly checksLicenseGap: number;
  readonly createdAt: string;
}

export type DiagnosticFindingSeverity = "ok" | "info" | "warning" | "critical";

/** `msp-diagnostics.ts`'s real closed vocabulary (monitor-executor.ts's
 * `CheckResult["status"]`) — same set `scanTypes.ts`'s `CheckStatus` already
 * names for the shell's scan log; kept as its own type here since this page
 * imports the shell's label map directly rather than re-deriving it. */
export type DiagnosticCheckStatus =
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

/** `FindingSummary` — deliberately narrower than the full findings row; no
 * `extractedProperties` or `recommendation` reach the customer (§1a). */
export interface DiagnosticFindingWire {
  readonly findingId: string;
  readonly checkKey: string;
  readonly checkLabel: string;
  readonly severity: DiagnosticFindingSeverity;
  readonly title: string;
  readonly description: string | null;
  readonly checkStatus: DiagnosticCheckStatus | null;
  readonly createdAt: string;
}

export interface DiagnosticsLatestWire {
  readonly run: DiagnosticRunWire | null;
  readonly findings: readonly DiagnosticFindingWire[];
}

/** The health-engine's own 6-pillar architecture-health taxonomy
 * (`health-engine.ts`'s `HEALTH_PILLARS`) — a DIFFERENT vocabulary than the
 * 7-key `PILLAR_SUMMARY_KEYS` the six `/pillars/:pillar` landing pages use.
 * `security` is scored by a separate engine and is not one of these six. */
export type HealthPillarKey = "governance" | "compliance" | "adoption" | "copilot" | "architecture" | "licensing";

export const HEALTH_PILLAR_LABELS: Readonly<Record<HealthPillarKey, string>> = {
  governance: "Governance & audit",
  compliance: "Compliance",
  adoption: "Adoption",
  copilot: "Copilot readiness",
  architecture: "Architecture & devices",
  licensing: "Licensing",
};

export interface PillarBenchmarkWire {
  readonly pillar: HealthPillarKey;
  /** Null when the pillar has too few evaluable signals to score yet —
   * never a fabricated 0 standing in for "not measured" (health-display.ts). */
  readonly displayScore: number | null;
  readonly industryAvgPct: number | null;
  readonly msExcellencePct: number | null;
  readonly source: string | null;
  readonly asOfDate: string | null;
}

export interface HealthBenchmarkWire {
  readonly pillars: readonly PillarBenchmarkWire[];
  readonly asOfDate: string | null;
}
