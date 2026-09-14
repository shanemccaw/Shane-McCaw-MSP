/**
 * React Query hooks for the customer-facing Status Reports surface, #4038
 * (Feature #3435, phase 4 of 4).
 *
 * Wired to the four real, live endpoints documented in
 * `docs/portal/status-reports-portal-contract-pack.md`:
 *   GET  /api/portal/status-reports              — published-only, newest-period-first
 *   GET  /api/portal/status-reports/:id/comments  — full two-sided thread, oldest-first
 *   POST /api/portal/status-reports/:id/comments  — add a comment as this customer
 *
 * The list route already returns the full `reportToWire` shape per row (same
 * shape the pack's §2.1 documents for the by-id route), so there is no
 * separate detail fetch — the selected report is read straight out of the
 * list query's own data.
 *
 * No fixture module, no fallback data — a 403 (no customer scope), a 404
 * (foreign/draft/unknown report — one indistinguishable answer per the
 * pack's §1.2/§6.2), and a thrown/5xx read are real, distinct states the page
 * renders honestly.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import type { ApiErrorBody, WireMspStatusReport, WireMspStatusReportComment } from "@/lib/status-reports-types";

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as ApiErrorBody;
      if (body?.error) message = body.error;
    } catch {
      // non-JSON error body — keep the generic message
    }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

const QK = {
  reports: ["portal", "status-reports"] as const,
  comments: (reportId: number) => ["portal", "status-reports", reportId, "comments"] as const,
};

export function useStatusReports() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: QK.reports,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/status-reports", undefined, { silent: true });
      const data = await parseJsonOrThrow<{ reports: WireMspStatusReport[] }>(res);
      return data.reports;
    },
  });
}

export function useStatusReportComments(reportId: number | null) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: QK.comments(reportId ?? -1),
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/portal/status-reports/${reportId}/comments`, undefined, { silent: true });
      const data = await parseJsonOrThrow<{ comments: WireMspStatusReportComment[] }>(res);
      return data.comments;
    },
    enabled: reportId !== null,
  });
}

export function useAddStatusReportComment() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ reportId, body }: { reportId: number; body: string }) => {
      const res = await fetchWithAuth(`/api/portal/status-reports/${reportId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const data = await parseJsonOrThrow<{ comment: WireMspStatusReportComment }>(res);
      return data.comment;
    },
    onSuccess: (comment, variables) => {
      // Append rather than refetch — the route has no PATCH/edit, so the
      // freshly-inserted row is already the whole truth; avoids a round trip
      // just to re-read what we already have back from the 201.
      queryClient.setQueryData<WireMspStatusReportComment[]>(QK.comments(variables.reportId), (prev) =>
        prev ? [...prev, comment] : [comment],
      );
    },
  });
}
