/**
 * msp-reports-api.ts — the data seam for the MSP Console's Reports module
 * (Git #3815, README screen 42), wiring the real, already-complete backend
 * in `artifacts/api-server/src/routes/msp-reports.ts` (19 routes across four
 * tables — `msp_report_definitions`, `msp_report_runs`, `msp_report_canvases`,
 * `msp_report_schedules`). See `docs/msp-console/` for the contract pack and
 * `Design/MSP_Console/design_handoff_msp_console/Reports.dc.html` for the
 * screen this file backs.
 *
 * Three load-bearing, real backend facts this file's shape is built around —
 * all confirmed against the live route/workflow code, not inferred from the
 * design mock:
 *
 * - A run whose email delivery fails is left at status `generated`, not
 *   `failed` — `report-nodes.ts`'s delivery step catches the send error and
 *   writes `{ status: "generated", errorMessage: "Email delivery failed: ..." }`.
 *   The only place that failure is visible on the wire is `errorMessage` on an
 *   otherwise-successful-looking run. This module renders that combination as
 *   an explicit warning, never plain success.
 * - `POST .../trigger` responds 202 with the run already written `pending`,
 *   before generation has even started — polling the runs list is the only
 *   way to see it progress or fail.
 * - `POST .../:runId/retry` does not exist. "Retry" in this UI is a fresh
 *   `trigger` call against the same `definitionId` — a brand-new run row,
 *   with no link back to the one that failed.
 *
 * No fixture module, no fabricated row — every value here comes from a real
 * server response.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export const REPORT_DOC_TYPES = [
  "executive_summary",
  "full_readiness_report",
  "security_posture_report",
  "governance_maturity_report",
  "data_exposure_risk_report",
  "license_optimization_report",
  "license_waste_report",
  "risk_decision_document",
] as const;
export type ReportDocType = typeof REPORT_DOC_TYPES[number];

export const REPORT_DOC_TYPE_LABELS: Record<ReportDocType, string> = {
  executive_summary: "Executive Summary",
  full_readiness_report: "Full Readiness Report",
  security_posture_report: "Security Posture",
  governance_maturity_report: "Governance Maturity",
  data_exposure_risk_report: "Data Exposure Risk",
  license_optimization_report: "License Optimization",
  license_waste_report: "License Waste Analysis Report",
  risk_decision_document: "Risk Decision Document",
};

export const REPORT_DELIVERY_METHODS = ["in_app", "email", "both"] as const;
export type ReportDeliveryMethod = typeof REPORT_DELIVERY_METHODS[number];

export const REPORT_RUN_STATUSES = ["pending", "generating", "generated", "delivering", "delivered", "failed"] as const;
export type ReportRunStatus = typeof REPORT_RUN_STATUSES[number];

export interface ReportDefinition {
  readonly id: number;
  readonly definitionId: string;
  readonly mspId: number;
  readonly customerId: number | null;
  readonly name: string;
  readonly description: string | null;
  readonly docType: ReportDocType;
  readonly deliveryMethod: ReportDeliveryMethod;
  readonly deliveryEmail: string | null;
  readonly fieldMappings: Record<string, unknown>;
  readonly scheduleConfig: Record<string, unknown>;
  readonly isActive: boolean;
  readonly createdByUserId: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ReportRun {
  readonly id: number;
  readonly runId: string;
  readonly definitionId: string;
  readonly mspId: number;
  readonly customerId: number | null;
  readonly title: string;
  readonly docType: ReportDocType;
  readonly status: ReportRunStatus;
  readonly pdfSizeBytes: number | null;
  readonly deliveredAt: string | null;
  readonly deliveryEmail: string | null;
  readonly errorMessage: string | null;
  readonly generatedAt: string | null;
  readonly createdAt: string;
}

export type CanvasWidgetType = "billing" | "open_items" | "telemetry" | "rich_text";

export interface CanvasWidget {
  readonly i: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly type: CanvasWidgetType;
  readonly properties?: Record<string, unknown>;
}

export interface ReportCanvasDeliveryConfig {
  readonly sendAsHtmlEmail: boolean;
  readonly attachPdf: boolean;
  readonly recipientType: "msp_admin" | "customer_contacts";
}

export interface ReportCanvas {
  readonly id: string;
  readonly mspId: number;
  readonly name: string;
  readonly description: string | null;
  readonly canvasLayout: { widgets?: CanvasWidget[] } & Record<string, unknown>;
  readonly deliveryConfig: ReportCanvasDeliveryConfig;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ReportScheduleCadence = "daily" | "weekly" | "monthly";

export interface ReportSchedule {
  readonly id: string;
  readonly mspId: number;
  readonly canvasId: string;
  readonly cadence: ReportScheduleCadence;
  readonly recipientEmails: string[];
  readonly enabled: boolean;
  readonly lastRunAt: string | null;
  readonly nextRunAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LicenseWaste {
  readonly totalCustomers: number;
  readonly customersWithWaste: number;
  readonly estimatedAnnualSavings: number;
  readonly estimatedAnnualSavingsFormatted: string;
  readonly totalUnusedLicenses: number;
  readonly reportsGenerated: number;
  readonly hasData: boolean;
}

export class MspReportsApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function requestJson<T>(
  fetchWithAuth: (i: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetchWithAuth(url, init);
  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === "string" && body.error.length > 0) message = body.error;
    } catch { /* body wasn't JSON — keep the generic message */ }
    throw new MspReportsApiError(res.status, message);
  }
  return (await res.json()) as T;
}

const QK = {
  definitions: ["msp", "reports", "definitions"] as const,
  runs: ["msp", "reports", "runs"] as const,
  canvases: ["msp", "reports", "canvases"] as const,
  schedules: ["msp", "reports", "schedules"] as const,
  licenseWaste: ["msp", "reports", "license-waste"] as const,
};

// ── Definitions ───────────────────────────────────────────────────────────────

export function useReportDefinitions(): UseQueryResult<ReportDefinition[], MspReportsApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: QK.definitions,
    queryFn: async () => (await requestJson<{ definitions: ReportDefinition[] }>(fetchWithAuth, "/api/msp/reports/definitions")).definitions,
    enabled: !isLoading && !!accessToken,
    staleTime: 10_000,
  });
}

export interface CreateReportDefinitionInput {
  name: string;
  description?: string;
  docType: ReportDocType;
  deliveryMethod: ReportDeliveryMethod;
  deliveryEmail?: string;
}

export function useCreateReportDefinition() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<{ definition: ReportDefinition }, MspReportsApiError, CreateReportDefinitionInput>({
    mutationFn: (body) => requestJson(fetchWithAuth, "/api/msp/reports/definitions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: QK.definitions }),
  });
}

/** PATCH is the generic edit route — used here for toggling `isActive`, same as the design's "Pause/Resume". */
export function useUpdateReportDefinition() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<{ definition: ReportDefinition }, MspReportsApiError, { definitionId: string; patch: Partial<Pick<ReportDefinition, "isActive" | "name" | "description">> }>({
    mutationFn: ({ definitionId, patch }) => requestJson(fetchWithAuth, `/api/msp/reports/definitions/${definitionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: QK.definitions }),
  });
}

/** Soft delete — flips `isActive` to false server-side (`ladder.msp-admin` only). The row keeps listing. */
export function useDeleteReportDefinition() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<{ ok: true }, MspReportsApiError, string>({
    mutationFn: (definitionId) => requestJson(fetchWithAuth, `/api/msp/reports/definitions/${definitionId}`, { method: "DELETE" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: QK.definitions }),
  });
}

export interface TriggerResult { runId: string; title: string; status: ReportRunStatus }

/** Fires the async generation workflow and returns 202 immediately with the run row already `pending`. */
export function useTriggerReport() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<TriggerResult, MspReportsApiError, string>({
    mutationFn: (definitionId) => requestJson(fetchWithAuth, `/api/msp/reports/definitions/${definitionId}/trigger`, { method: "POST" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: QK.runs }),
  });
}

// ── Runs ──────────────────────────────────────────────────────────────────────

export interface RunsListResponse { runs: ReportRun[]; total: number; hasMore: boolean }

/** limit is capped at 100 server-side; there is no offset, matching the route's own real shape. */
export function useReportRuns(limit = 50, refetchIntervalMs?: number): UseQueryResult<RunsListResponse, MspReportsApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: [...QK.runs, limit],
    queryFn: () => requestJson<RunsListResponse>(fetchWithAuth, `/api/msp/reports/runs?limit=${limit}`),
    enabled: !isLoading && !!accessToken,
    staleTime: 5_000,
    refetchInterval: refetchIntervalMs,
  });
}

function safeFilenameFromTitle(title: string): string {
  return (title || "report").replace(/[^a-zA-Z0-9\s-]/g, "").trim() || "report";
}

/** Streams the real PDF binary and triggers a browser download — same 409/422 semantics as the route
 * (not ready / generation failed) surface as thrown `MspReportsApiError`s for the caller to show. */
export function useDownloadReportRun() {
  const { fetchWithAuth } = useAuth();
  return useMutation<void, MspReportsApiError, ReportRun>({
    mutationFn: async (run) => {
      const res = await fetchWithAuth(`/api/msp/reports/runs/${run.runId}/download`);
      if (!res.ok) {
        let message = `Request failed: ${res.status}`;
        try {
          const body = (await res.json()) as { error?: string };
          if (typeof body.error === "string" && body.error.length > 0) message = body.error;
        } catch { /* non-JSON body */ }
        throw new MspReportsApiError(res.status, message);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeFilenameFromTitle(run.title)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  });
}

// ── License waste ─────────────────────────────────────────────────────────────

export function useLicenseWaste(): UseQueryResult<LicenseWaste, MspReportsApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: QK.licenseWaste,
    queryFn: () => requestJson<LicenseWaste>(fetchWithAuth, "/api/msp/reports/license-waste"),
    enabled: !isLoading && !!accessToken,
    staleTime: 30_000,
  });
}

// ── Canvases ──────────────────────────────────────────────────────────────────

export function useReportCanvases(): UseQueryResult<ReportCanvas[], MspReportsApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: QK.canvases,
    queryFn: async () => (await requestJson<{ canvases: ReportCanvas[] }>(fetchWithAuth, "/api/msp/reports/canvases")).canvases,
    enabled: !isLoading && !!accessToken,
    staleTime: 15_000,
  });
}

export interface CreateReportCanvasInput {
  name: string;
  description?: string;
  canvasLayout: { widgets: CanvasWidget[] };
  deliveryConfig: ReportCanvasDeliveryConfig;
}

export function useCreateReportCanvas() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<ReportCanvas, MspReportsApiError, CreateReportCanvasInput>({
    mutationFn: (body) => requestJson(fetchWithAuth, "/api/msp/reports/canvases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: QK.canvases }),
  });
}

/** Deletion is outright — no soft flag, no version history to restore from (design's own note). */
export function useDeleteReportCanvas() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<{ success: true }, MspReportsApiError, string>({
    mutationFn: (id) => requestJson(fetchWithAuth, `/api/msp/reports/canvases/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QK.canvases });
      void queryClient.invalidateQueries({ queryKey: QK.schedules });
    },
  });
}

/** Sends a real Exchange Online test email to the caller's own address. The canvas's own stored
 * `recipientType` is never consulted server-side — a test always goes to whoever asked for it. */
export function useSendTestCanvas() {
  const { fetchWithAuth } = useAuth();
  return useMutation<{ success: true; recipient: string; customerId: number }, MspReportsApiError, { canvasId: string }>({
    mutationFn: ({ canvasId }) => requestJson(fetchWithAuth, `/api/msp/reports/canvases/${canvasId}/send-test`, { method: "POST" }),
  });
}

// ── Schedules ─────────────────────────────────────────────────────────────────

export function useReportSchedules(): UseQueryResult<ReportSchedule[], MspReportsApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: QK.schedules,
    queryFn: async () => (await requestJson<{ schedules: ReportSchedule[] }>(fetchWithAuth, "/api/msp/reports/schedules")).schedules,
    enabled: !isLoading && !!accessToken,
    staleTime: 15_000,
  });
}

export interface CreateReportScheduleInput {
  canvasId: string;
  cadence: ReportScheduleCadence;
  recipientEmails: string[];
  enabled?: boolean;
}

export function useCreateReportSchedule() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<ReportSchedule, MspReportsApiError, CreateReportScheduleInput>({
    mutationFn: (body) => requestJson(fetchWithAuth, "/api/msp/reports/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: QK.schedules }),
  });
}

export function useUpdateReportSchedule() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<ReportSchedule, MspReportsApiError, { id: string; patch: Partial<Pick<ReportSchedule, "enabled" | "cadence" | "recipientEmails">> }>({
    mutationFn: ({ id, patch }) => requestJson(fetchWithAuth, `/api/msp/reports/schedules/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: QK.schedules }),
  });
}

export function useDeleteReportSchedule() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<{ success: true }, MspReportsApiError, string>({
    mutationFn: (id) => requestJson(fetchWithAuth, `/api/msp/reports/schedules/${id}`, { method: "DELETE" }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: QK.schedules }),
  });
}
