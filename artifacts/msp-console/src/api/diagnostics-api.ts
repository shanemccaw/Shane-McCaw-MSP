/**
 * React Query hooks for the MSP Console's Diagnostics and Scripts module
 * (Git #2653, Feature #2571) — wired against the real, current routes in
 * `artifacts/api-server/src/routes/msp-diagnostics.ts`:
 *
 *   GET  /api/msp/monitoring-packages
 *   GET  /api/msp/customers/:customerId/monitoring-package
 *   POST /api/msp/customers/:customerId/diagnostics/run
 *   GET  /api/msp/customers/:customerId/diagnostics/runs
 *   GET  /api/msp/customers/:customerId/diagnostics/runs/:runId
 *   GET  /api/msp/customers/:customerId/scripts
 *   GET  /api/msp/customers/:customerId/scripts/:checkKey/download
 *
 * Per-item acknowledge (Git #3399/#3366) is NOT a diagnostics-runs route — the
 * only mutation that mechanism has is the cross-tenant Alerts feed's own
 * `POST /api/msp/alerts/:alertId/acknowledge`, addressed by the composite id
 * `finding-<findingId>` (see `msp-alerts.ts`). `msp_diagnostic_findings` itself
 * has no other resolution route — that's the real, confirmed shape #3399 shipped
 * (its own schema comment on `acknowledgedAt` explains why), not a gap in this
 * client.
 *
 * No fixture module, no fallback data — every read either resolves to a real
 * server response or surfaces as a failed/loading state the module renders
 * honestly.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

// ── Wire types (mirrors msp-diagnostics.ts's own response shapes) ────────────

export type DiagnosticFindingSeverity = "ok" | "info" | "warning" | "critical";

export interface MonitoringPackage {
  key: string;
  label: string;
  checkCount: number;
}

export interface MonitoringPackagesResponse {
  packages: MonitoringPackage[];
}

export interface ResolvedMonitoringPackage {
  packageKey: string | null;
  serviceId: number | null;
  serviceName: string | null;
}

export interface DiagnosticRun {
  id: number;
  runId: string;
  mspId: number;
  customerId: number;
  tenantId: string | null;
  packageKey: string;
  status: "pending" | "running" | "completed" | "partial" | "failed";
  checksOk: number | null;
  checksLicenseGap: number | null;
  checksError: number | null;
  checksTotal: number;
  triggeredByUserId: number | null;
  cioNarrativeStatus: string;
  createdAt: string;
  completedAt: string | null;
}

export interface FailureClassification {
  category: string;
  label: string;
  isFault: boolean;
}

export interface DiagnosticFinding {
  id: number;
  findingId: string;
  runId: string;
  mspId: number;
  customerId: number | null;
  checkKey: string;
  checkLabel: string;
  severity: DiagnosticFindingSeverity;
  title: string;
  description: string | null;
  checkStatus: string | null;
  findingSource: "baseline" | "policy";
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgedByUserId: number | null;
  classification: FailureClassification | null;
}

export interface DiagnosticRunDetail {
  run: DiagnosticRun;
  findings: DiagnosticFinding[];
}

export interface DiagnosticScript {
  findingId: string;
  checkKey: string;
  checkLabel: string;
  severity: DiagnosticFindingSeverity;
  title: string;
  createdAt: string;
  scriptPackageId: string | null;
  filename: string | null;
  available: boolean;
}

export interface DiagnosticScriptsResponse {
  runId: string | null;
  scripts: DiagnosticScript[];
}

interface ApiErrorBody {
  error?: string;
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as ApiErrorBody;
      if (typeof body?.error === "string" && body.error) message = body.error;
    } catch {
      // non-JSON error body — keep the generic message
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

const base = (customerId: number) => `/api/msp/customers/${customerId}`;

const runsKey = (customerId: number) => ["msp", "diagnostics", "runs", customerId] as const;
const runDetailKey = (customerId: number, runId: string) => ["msp", "diagnostics", "run", customerId, runId] as const;
const scriptsKey = (customerId: number) => ["msp", "diagnostics", "scripts", customerId] as const;
const monitoringPackageKey = (customerId: number) => ["msp", "monitoring-package", customerId] as const;
const monitoringPackagesKey = ["msp", "monitoring-packages"] as const;

// ── Monitoring packages (the run-trigger picker) ─────────────────────────────

export function useMonitoringPackages() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: monitoringPackagesKey,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/msp/monitoring-packages");
      return parseJsonOrThrow<MonitoringPackagesResponse>(res);
    },
    staleTime: 60_000,
  });
}

export function useResolvedMonitoringPackage(customerId: number) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: monitoringPackageKey(customerId),
    queryFn: async () => {
      const res = await fetchWithAuth(`${base(customerId)}/monitoring-package`);
      return parseJsonOrThrow<ResolvedMonitoringPackage>(res);
    },
  });
}

// ── Runs ──────────────────────────────────────────────────────────────────────

export function useDiagnosticRuns(customerId: number, opts?: { refetchIntervalMs?: number }) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: runsKey(customerId),
    queryFn: async () => {
      const res = await fetchWithAuth(`${base(customerId)}/diagnostics/runs`);
      return parseJsonOrThrow<DiagnosticRun[]>(res);
    },
    refetchInterval: opts?.refetchIntervalMs,
  });
}

export function useDiagnosticRunDetail(customerId: number, runId: string | null) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: runDetailKey(customerId, runId ?? ""),
    queryFn: async () => {
      const res = await fetchWithAuth(`${base(customerId)}/diagnostics/runs/${encodeURIComponent(runId!)}`);
      return parseJsonOrThrow<DiagnosticRunDetail>(res);
    },
    enabled: runId !== null,
  });
}

export function useTriggerDiagnosticsRun(customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (packageKey: string | undefined) => {
      const res = await fetchWithAuth(`${base(customerId)}/diagnostics/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(packageKey ? { packageKey } : {}),
      });
      return parseJsonOrThrow<{ runId: string; status: string; message: string }>(res);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: runsKey(customerId) });
    },
  });
}

// ── Scripts hand-off ──────────────────────────────────────────────────────────

export function useDiagnosticScripts(customerId: number) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: scriptsKey(customerId),
    queryFn: async () => {
      const res = await fetchWithAuth(`${base(customerId)}/scripts`);
      return parseJsonOrThrow<DiagnosticScriptsResponse>(res);
    },
  });
}

function filenameFromContentDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const match = /filename="?([^";]+)"?/i.exec(header);
  return match?.[1] ?? fallback;
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Real file streamed from msp-diagnostics.ts's script-download route — nothing generated client-side. */
export function useDownloadScript(customerId: number) {
  const { fetchWithAuth } = useAuth();
  return useMutation({
    mutationFn: async (checkKey: string) => {
      const res = await fetchWithAuth(`${base(customerId)}/scripts/${encodeURIComponent(checkKey)}/download`);
      if (!res.ok) {
        let message = `Download failed (${res.status})`;
        try {
          const body = (await res.clone().json()) as ApiErrorBody;
          if (typeof body?.error === "string" && body.error) message = body.error;
        } catch {
          // non-JSON error body — keep the generic message
        }
        throw new Error(message);
      }
      const blob = await res.blob();
      const filename = filenameFromContentDisposition(res.headers.get("Content-Disposition"), `${checkKey}.ps1`);
      saveBlob(blob, filename);
    },
  });
}

// ── Per-item acknowledge (Git #3399/#3366) ───────────────────────────────────
// Composite alert id, exactly as GET /api/msp/alerts builds it — no customerId
// in the path because the acknowledge route resolves ownership from the
// finding row itself + the caller's own mspId claim.

export function useAcknowledgeFinding(customerId: number, runId: string | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (findingId: string) => {
      const res = await fetchWithAuth(`/api/msp/alerts/finding-${findingId}/acknowledge`, { method: "POST" });
      return parseJsonOrThrow<{ id: string; status: string; acknowledgedAt: string | null }>(res);
    },
    onSuccess: () => {
      if (runId) void queryClient.invalidateQueries({ queryKey: runDetailKey(customerId, runId) });
      void queryClient.invalidateQueries({ queryKey: ["msp", "alerts", "feed"] });
    },
  });
}
