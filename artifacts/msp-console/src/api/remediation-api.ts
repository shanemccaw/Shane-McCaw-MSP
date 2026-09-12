/**
 * React Query hooks for the MSP Console's Remediation module (Git #2588,
 * Feature #1684) — the operator-side mirror of the customer portal's own
 * Remediation Tracker/Checklist hooks
 * (`artifacts/portal/src/lib/remediation-tracker-api.ts` /
 * `remediation-checklist-api.ts`), resolved against `:customerId` under the
 * MSP-scoped routes instead of the caller's own JWT `customerId` claim:
 *
 *   GET  /api/msp/customers/:customerId/remediation-tracker/catalogue
 *   PUT  /api/msp/customers/:customerId/remediation-tracker/steps/:stepId
 *   PUT  /api/msp/customers/:customerId/remediation-tracker/steps/:stepId/note
 *   POST /api/msp/customers/:customerId/remediation-tracker/steps/:stepId/verify
 *   GET  /api/msp/customers/:customerId/remediation-tracker/steps/:stepId/verification-guide
 *   POST /api/msp/customers/:customerId/remediation-tracker/steps/:stepId/evidence
 *   GET  /api/msp/customers/:customerId/remediation-tracker/steps/:stepId/evidence
 *   GET  /api/msp/customers/:customerId/remediation-tracker/pillar-scores
 *   GET  /api/msp/customers/:customerId/remediation-tracker/export.csv|.pdf
 *   GET  /api/msp/customers/:customerId/remediation-tracker/evidence-pack.pdf
 *   GET  /api/msp/customers/:customerId/remediation/checklist
 *   PUT  /api/msp/customers/:customerId/remediation/checklist/:checkKey
 *   POST /api/msp/customers/:customerId/remediation/checklist/:checkKey/raise-change
 *   GET  /api/msp/customers/:customerId/remediation/fix-routes
 *   POST /api/msp/customers/:customerId/remediation/fix-routes/:checkKey/reveal
 *   GET  /api/msp/customers/:customerId/remediation/bypass-resolutions
 *
 * No fixture module, no fallback data — every read either resolves to a real
 * server response or surfaces as a failed/loading state the module renders
 * honestly.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import type {
  ApiErrorBody,
  BypassResolution,
  CatalogueResponse,
  ChecklistItemWriteResult,
  ChecklistResult,
  FixRoutesResult,
  PillarScoresResponse,
  RaiseChangeResult,
  RemediationTrackerStepStatus,
  RevealOutcome,
  RevealedFix,
  StepWriteResult,
  VerificationGuideResponse,
  VerifyResponse,
  WireEvidenceAttachment,
} from "./remediation-types";

function errorMessage(body: ApiErrorBody, status: number): string {
  if (typeof body?.error === "string" && body.error) return body.error;
  if (body?.error && typeof body.error === "object" && body.error.message) return body.error.message;
  return `Request failed (${status})`;
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as ApiErrorBody;
      message = errorMessage(body, res.status);
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

const trackerKey = (customerId: number) => ["msp", "remediation-tracker", customerId] as const;
const checklistKey = (customerId: number) => ["msp", "remediation", "checklist", customerId] as const;
const fixRoutesKey = (customerId: number) => ["msp", "remediation", "fix-routes", customerId] as const;
const bypassKey = (customerId: number) => ["msp", "remediation", "bypass-resolutions", customerId] as const;
const pillarScoresKey = (customerId: number) => ["msp", "remediation-tracker", "pillar-scores", customerId] as const;
const stepEvidenceKey = (customerId: number, stepId: string) =>
  ["msp", "remediation-tracker", customerId, stepId, "evidence"] as const;

// ── Tracker catalogue ─────────────────────────────────────────────────────────

export function useRemediationCatalogue(customerId: number) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: trackerKey(customerId),
    queryFn: async () => {
      const res = await fetchWithAuth(`${base(customerId)}/remediation-tracker/catalogue`);
      return parseJsonOrThrow<CatalogueResponse>(res);
    },
  });
}

export function useSetTrackerStep(customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ stepId, status }: { stepId: string; status: RemediationTrackerStepStatus }) => {
      const res = await fetchWithAuth(`${base(customerId)}/remediation-tracker/steps/${encodeURIComponent(stepId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      return parseJsonOrThrow<{ step: StepWriteResult }>(res);
    },
    onSettled: () => {
      // The write resets verification server-side — refetch rather than patch
      // so the badge never shows a verdict about a claim that just changed.
      void queryClient.invalidateQueries({ queryKey: trackerKey(customerId) });
      void queryClient.invalidateQueries({ queryKey: pillarScoresKey(customerId) });
    },
  });
}

export function useSetTrackerStepNote(customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ stepId, note }: { stepId: string; note: string | null }) => {
      const res = await fetchWithAuth(
        `${base(customerId)}/remediation-tracker/steps/${encodeURIComponent(stepId)}/note`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note }),
        },
      );
      return parseJsonOrThrow<{ step: StepWriteResult | null }>(res);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: trackerKey(customerId) }),
  });
}

export function useVerifyTrackerStep(customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (stepId: string) => {
      const res = await fetchWithAuth(
        `${base(customerId)}/remediation-tracker/steps/${encodeURIComponent(stepId)}/verify`,
        { method: "POST" },
      );
      return parseJsonOrThrow<VerifyResponse>(res);
    },
    // The route fires a fire-and-forget workflow run (`remediation.verify_requested`)
    // and the verdict lands on the tracker row asynchronously — there is nothing
    // new to read the instant this 202s. The caller schedules one bounded re-fetch
    // rather than polling indefinitely (see Remediation.tsx).
  });
}

export function useVerificationGuide(customerId: number, stepId: string | null) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["msp", "remediation-tracker", "verification-guide", customerId, stepId],
    queryFn: async () => {
      const res = await fetchWithAuth(
        `${base(customerId)}/remediation-tracker/steps/${encodeURIComponent(stepId as string)}/verification-guide`,
      );
      return parseJsonOrThrow<VerificationGuideResponse>(res);
    },
    enabled: stepId !== null,
    retry: false,
  });
}

// ── Evidence attachments (#3503) ─────────────────────────────────────────────

export function useStepEvidence(customerId: number, stepId: string | null) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: stepEvidenceKey(customerId, stepId ?? ""),
    queryFn: async () => {
      const res = await fetchWithAuth(
        `${base(customerId)}/remediation-tracker/steps/${encodeURIComponent(stepId as string)}/evidence`,
      );
      return parseJsonOrThrow<{ attachments: WireEvidenceAttachment[] }>(res);
    },
    enabled: stepId !== null,
  });
}

export function useAttachStepEvidence(customerId: number, stepId: string | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, caption }: { file: File; caption: string }) => {
      const form = new FormData();
      form.append("file", file);
      if (caption.trim()) form.append("caption", caption.trim());
      const res = await fetchWithAuth(
        `${base(customerId)}/remediation-tracker/steps/${encodeURIComponent(stepId as string)}/evidence`,
        { method: "POST", body: form },
      );
      return parseJsonOrThrow<{ attachment: WireEvidenceAttachment }>(res);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: stepEvidenceKey(customerId, stepId ?? "") }),
  });
}

/** Fetches an evidence file as a blob and opens it — the file route is bearer-only, so a plain `<img>`/`<a>` cannot authenticate. */
export function useOpenEvidenceFile() {
  const { fetchWithAuth } = useAuth();
  return useMutation({
    mutationFn: async (attachment: WireEvidenceAttachment) => {
      const res = await fetchWithAuth(attachment.url);
      if (!res.ok) throw new Error(`Failed to load evidence file (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
  });
}

// ── Findings-derived checklist ────────────────────────────────────────────────

export function useRemediationChecklist(customerId: number) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: checklistKey(customerId),
    queryFn: async () => {
      const res = await fetchWithAuth(`${base(customerId)}/remediation/checklist`);
      return parseJsonOrThrow<ChecklistResult>(res);
    },
  });
}

export function useUpdateChecklistItem(customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ checkKey, status }: { checkKey: string; status: RemediationTrackerStepStatus }) => {
      const res = await fetchWithAuth(`${base(customerId)}/remediation/checklist/${encodeURIComponent(checkKey)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      return parseJsonOrThrow<{ item: ChecklistItemWriteResult }>(res);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: checklistKey(customerId) });
      void queryClient.invalidateQueries({ queryKey: pillarScoresKey(customerId) });
    },
  });
}

export function useRaiseChangeFromChecklistItem(customerId: number) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (checkKey: string) => {
      const res = await fetchWithAuth(
        `${base(customerId)}/remediation/checklist/${encodeURIComponent(checkKey)}/raise-change`,
        { method: "POST" },
      );
      return parseJsonOrThrow<RaiseChangeResult>(res);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: checklistKey(customerId) }),
  });
}

// ── Fix routes + reveal ───────────────────────────────────────────────────────

export function useFixRoutes(customerId: number) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: fixRoutesKey(customerId),
    queryFn: async () => {
      const res = await fetchWithAuth(`${base(customerId)}/remediation/fix-routes`);
      return parseJsonOrThrow<FixRoutesResult>(res);
    },
  });
}

/** 403 (no/pending CR), 404 (approved, no content) and 409 (no connected tenant) are real, expected outcomes — not exceptions. */
export function useRevealFix(customerId: number) {
  const { fetchWithAuth } = useAuth();
  return useMutation({
    mutationFn: async (checkKey: string): Promise<RevealOutcome> => {
      const res = await fetchWithAuth(
        `${base(customerId)}/remediation/fix-routes/${encodeURIComponent(checkKey)}/reveal`,
        { method: "POST" },
      );
      if (res.status === 403 || res.status === 404 || res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
        return { status: res.status, error: errorMessage(body, res.status) };
      }
      const data = await parseJsonOrThrow<RevealedFix>(res);
      return { status: 200, data };
    },
  });
}

// ── Bypass resolutions (observational) ───────────────────────────────────────

export function useBypassResolutions(customerId: number) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: bypassKey(customerId),
    queryFn: async () => {
      const res = await fetchWithAuth(`${base(customerId)}/remediation/bypass-resolutions`);
      const data = await parseJsonOrThrow<{ items: BypassResolution[] }>(res);
      return data.items;
    },
  });
}

// ── Pillar scores ─────────────────────────────────────────────────────────────

export function usePillarScores(customerId: number) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: pillarScoresKey(customerId),
    queryFn: async () => {
      const res = await fetchWithAuth(`${base(customerId)}/remediation-tracker/pillar-scores`);
      return parseJsonOrThrow<PillarScoresResponse>(res);
    },
  });
}

// ── Exports ───────────────────────────────────────────────────────────────────

export type RemediationExportKind = "csv" | "pdf" | "evidence-pack";

const EXPORT_PATHS: Record<RemediationExportKind, string> = {
  csv: "remediation-tracker/export.csv",
  pdf: "remediation-tracker/export.pdf",
  "evidence-pack": "remediation-tracker/evidence-pack.pdf",
};

const FALLBACK_FILENAMES: Record<RemediationExportKind, string> = {
  csv: "remediation-tracker.csv",
  pdf: "remediation-tracker.pdf",
  "evidence-pack": "remediation-evidence-pack.pdf",
};

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

/** Real file streamed from `msp-remediation-tracker-export.ts` — nothing generated client-side. */
export function useRemediationExport(customerId: number, kind: RemediationExportKind) {
  const { fetchWithAuth } = useAuth();
  return useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth(`${base(customerId)}/${EXPORT_PATHS[kind]}`);
      if (!res.ok) {
        let message = `Export failed (${res.status})`;
        try {
          const body = (await res.clone().json()) as ApiErrorBody;
          message = errorMessage(body, res.status);
        } catch {
          // non-JSON error body — keep the generic message
        }
        const err = new Error(message) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }
      const blob = await res.blob();
      const filename = filenameFromContentDisposition(res.headers.get("Content-Disposition"), FALLBACK_FILENAMES[kind]);
      saveBlob(blob, filename);
    },
  });
}
