/**
 * MSP Console — Launch Control module API client (Git #2615, Feature #2494).
 * Mounts into the shell's `ScreenSlot` at `/tenants/:id/lc`
 * (`Design/MSP_Console/design_handoff_msp_console/Launch Control.dc.html`,
 * README screen 19). Wired against the real operator backend
 * (`artifacts/api-server/src/routes/msp-launch-control.ts`):
 *
 *   GET  /api/msp/:mspId/launch-control/actions?customerId=
 *   GET  /api/msp/:mspId/launch-control/history?customerId=
 *   POST /api/msp/:mspId/launch-control/execute
 *   POST /api/msp/:mspId/launch-control/rollback/:auditLogId
 *
 * `availability` and `licenseRequirement` are computed on the server from a
 * live `/subscribedSkus` read (license-gate.ts) — this client only renders
 * them, and execute re-validates every one of them server-side regardless of
 * what the screen showed. No fixture module, no fabricated row.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export type LaunchControlAvailability = "included" | "billable_upsell" | "a_la_carte" | "license_required";

export interface LicenseRequirement {
  skus: string[];
  satisfied: boolean;
  description: string;
}

export interface LaunchControlAction {
  id: number;
  domain: string;
  actionName: string;
  surface: string;
  requiredPermission: string | null;
  safeOrGated: "safe" | "gated" | null;
  minBundledTier: string | null;
  snapshotNotes: string | null;
  /** write_action_catalog.status — execution_ready / endpoint_design_pending / metadata_pending / blocked_no_workaround. */
  status: string;
  blockedReason: string | null;
  sortOrder: number;
  templateId: string | null;
  availability: LaunchControlAvailability;
  licenseRequirement: LicenseRequirement | null;
  requiredVariables: string[];
  templateLabel: string | null;
  templateDescription: string | null;
  reversible: boolean;
}

export interface LaunchControlActionsResponse {
  actions: LaunchControlAction[];
  customerTier: string | null;
  tenant: { customerId: number; name: string | null; isTestbed: boolean; connected: boolean };
  writeBack: { mspEnabled: boolean; consentStatus: string | null };
  licenseRead: { error: string | null };
}

export interface LaunchControlHistoryRow {
  id: number;
  /** baseline_action_template_audit_log.action — "executed" or "failed". */
  outcome: string;
  templateId: string | null;
  actionName: string | null;
  templateLabel: string | null;
  endpoint: string | null;
  method: string | null;
  status: number | null;
  errorType: string | null;
  licenseFeature: string | null;
  source: string | null;
  createdAt: string;
  reversible: boolean;
}

export interface LaunchControlExecuteResponse {
  result: {
    success: boolean;
    status: number;
    errorType?: string | null;
    endpoint: string;
    method: string;
    label: string;
    auditLogId?: number;
    missingVariables?: string[];
    reversible: boolean;
  };
  tenant: { customerId: number; name: string | null };
  changeRequest: { id: number; code: string };
}

export interface LaunchControlRollbackResponse {
  result: {
    success: boolean;
    status: number;
    errorType?: string | null;
    endpoint: string;
    method: string;
    rollbackAuditLogId?: number;
  };
}

export type LaunchControlError = Error & { status?: number; errorType?: string };

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let errorType: string | undefined;
    try {
      const body = (await res.clone().json()) as { error?: string; message?: string; errorType?: string };
      if (body?.error) message = body.error;
      else if (body?.message) message = body.message;
      errorType = body?.errorType;
    } catch {
      // non-JSON error body — keep the generic message
    }
    const err = new Error(message) as LaunchControlError;
    err.status = res.status;
    err.errorType = errorType;
    throw err;
  }
  return (await res.json()) as T;
}

const base = (mspId: number) => `/api/msp/${mspId}/launch-control`;
const actionsKey = (mspId: number, customerId: number) => ["msp", "launch-control", mspId, customerId, "actions"] as const;
const historyKey = (mspId: number, customerId: number) => ["msp", "launch-control", mspId, customerId, "history"] as const;

export function useLaunchControlActions(mspId: number, customerId: number) {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery<LaunchControlActionsResponse, LaunchControlError>({
    queryKey: actionsKey(mspId, customerId),
    queryFn: async () => {
      const res = await fetchWithAuth(`${base(mspId)}/actions?customerId=${customerId}`);
      return parseJsonOrThrow<LaunchControlActionsResponse>(res);
    },
    enabled: !isLoading && !!accessToken,
  });
}

export function useLaunchControlHistory(mspId: number, customerId: number) {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery<{ history: LaunchControlHistoryRow[] }, LaunchControlError>({
    queryKey: historyKey(mspId, customerId),
    queryFn: async () => {
      const res = await fetchWithAuth(`${base(mspId)}/history?customerId=${customerId}`);
      return parseJsonOrThrow<{ history: LaunchControlHistoryRow[] }>(res);
    },
    enabled: !isLoading && !!accessToken,
  });
}

export function useExecuteLaunchControlAction(mspId: number, customerId: number) {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation<LaunchControlExecuteResponse, LaunchControlError, { catalogActionId: number; variables: Record<string, string> }>({
    mutationFn: async ({ catalogActionId, variables }) => {
      const res = await fetchWithAuth(`${base(mspId)}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ catalogActionId, customerId, variables }),
      });
      return parseJsonOrThrow<LaunchControlExecuteResponse>(res);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: historyKey(mspId, customerId) });
      void qc.invalidateQueries({ queryKey: actionsKey(mspId, customerId) });
    },
  });
}

export function useRollbackLaunchControlExecution(mspId: number, customerId: number) {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation<LaunchControlRollbackResponse, LaunchControlError, number>({
    mutationFn: async (auditLogId) => {
      const res = await fetchWithAuth(`${base(mspId)}/rollback/${auditLogId}`, { method: "POST" });
      return parseJsonOrThrow<LaunchControlRollbackResponse>(res);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: historyKey(mspId, customerId) });
    },
  });
}
