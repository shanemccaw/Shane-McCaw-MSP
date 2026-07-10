// In-memory ring buffer capturing structured debug info for SOW generation runs
// triggered from the Admin Panel's SOW Generation Debug page. Not persisted —
// entries are lost on server restart, which is fine since this is a live debug tool.

export type SowDebugLogLevel = "debug" | "info" | "warn" | "error";

export interface SowDebugLogEntry {
  ts: string;
  level: SowDebugLogLevel;
  message: string;
  meta?: Record<string, unknown>;
}

export interface SowDebugSignalSnapshot {
  firedSignals?: string[];
  firedAdjSignalKeys?: string[];
  includedProjectTitles?: string[];
  excludedProjectTitles?: string[];
  signalFilterMeta?: {
    clean: boolean;
    conflictCount: number;
    conflicts?: Array<{ ruleIds: number[]; description: string }>;
  };
  usedOverride?: boolean;
}

export interface SowDebugRun {
  correlationId: string;
  createdAt: string;
  clientUserId: number;
  projectId: number | null;
  logs: SowDebugLogEntry[];
  signals: SowDebugSignalSnapshot;
  status: "running" | "success" | "failed";
  error?: string;
}

const MAX_RUNS = 30;
const runs = new Map<string, SowDebugRun>();

export function startSowDebugRun(correlationId: string, clientUserId: number, projectId: number | null): void {
  runs.set(correlationId, {
    correlationId,
    createdAt: new Date().toISOString(),
    clientUserId,
    projectId,
    logs: [],
    signals: {},
    status: "running",
  });
  // Evict oldest entries beyond the cap.
  if (runs.size > MAX_RUNS) {
    const oldestKey = runs.keys().next().value;
    if (oldestKey) runs.delete(oldestKey);
  }
}

export function pushSowDebugLog(
  correlationId: string | undefined,
  level: SowDebugLogLevel,
  message: string,
  meta?: Record<string, unknown>,
): void {
  if (!correlationId) return;
  const run = runs.get(correlationId);
  if (!run) return;
  run.logs.push({ ts: new Date().toISOString(), level, message, meta });
}

export function setSowDebugSignals(correlationId: string | undefined, signals: SowDebugSignalSnapshot): void {
  if (!correlationId) return;
  const run = runs.get(correlationId);
  if (!run) return;
  run.signals = { ...run.signals, ...signals };
}

export function finishSowDebugRun(correlationId: string | undefined, status: "success" | "failed", error?: string): void {
  if (!correlationId) return;
  const run = runs.get(correlationId);
  if (!run) return;
  run.status = status;
  if (error) run.error = error;
}

export function getSowDebugRun(correlationId: string): SowDebugRun | undefined {
  return runs.get(correlationId);
}

export function listSowDebugRuns(): SowDebugRun[] {
  return [...runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
