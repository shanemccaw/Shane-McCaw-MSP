/**
 * React Query hooks + real fetch actions for the customer-facing, authenticated
 * Documents surface (#4003, Feature #1658), wired against 6 of the 8 real,
 * live endpoints in `artifacts/api-server/src/routes/portal-documents.ts`:
 *
 *   GET  /api/portal/reports
 *   GET  /api/portal/insights-documents
 *   GET  /api/portal/insights-documents/:id/view
 *   GET  /api/portal/insights-documents/:id/pdf
 *   POST /api/portal/documents/:id/share
 *   GET  /api/portal/reports/:id/download
 *
 * The remaining 2 — the public, unauthenticated
 * `GET/POST /api/public/documents/:shareToken[/doc-views]` pair — are wired
 * by `shared-document-public.tsx` / `lib/public-share-api.ts` (#4001, Feature
 * #1663), not here.
 *
 * No fixture module, no fallback data. Empty lists are real (`[]` from the
 * route, not a placeholder).
 */
import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import type {
  ApiErrorBody,
  WireDocumentView,
  WireInsightDocument,
  WireReport,
  WireShareResult,
} from "@/lib/documents-types";

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
  reports: ["portal", "documents", "reports"] as const,
  insightsDocuments: ["portal", "documents", "insights"] as const,
};

export function useReports() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: QK.reports,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/reports", undefined, { silent: true });
      return parseJsonOrThrow<WireReport[]>(res);
    },
  });
}

export function useInsightsDocuments() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: QK.insightsDocuments,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/insights-documents", undefined, { silent: true });
      return parseJsonOrThrow<WireInsightDocument[]>(res);
    },
  });
}

async function triggerBlobDownload(blob: Blob, filename: string): Promise<void> {
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(blobUrl);
}

function sanitizeFilenameStem(title: string): string {
  return (title || "document").replace(/[^a-zA-Z0-9 _-]/g, "").replace(/\s+/g, "-").slice(0, 80);
}

/** Fetches a generated document's stored HTML for the in-page viewer. */
export function useFetchDocumentView() {
  const { fetchWithAuth } = useAuth();
  return useCallback(
    async (documentId: number): Promise<WireDocumentView> => {
      const res = await fetchWithAuth(`/api/portal/insights-documents/${documentId}/view`, undefined, { silent: true });
      return parseJsonOrThrow<WireDocumentView>(res);
    },
    [fetchWithAuth],
  );
}

/** Downloads a generated document's PDF as a real browser file-save. */
export function useDownloadDocumentPdf() {
  const { fetchWithAuth } = useAuth();
  return useCallback(
    async (documentId: number, title: string): Promise<string | null> => {
      try {
        const res = await fetchWithAuth(`/api/portal/insights-documents/${documentId}/pdf`, undefined, { silent: true });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
          return body?.error ?? `Could not download the PDF (${res.status})`;
        }
        const blob = await res.blob();
        await triggerBlobDownload(blob, `${sanitizeFilenameStem(title)}.pdf`);
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    },
    [fetchWithAuth],
  );
}

/** Downloads an uploaded report file exactly as it was filed. */
export function useDownloadReportFile() {
  const { fetchWithAuth } = useAuth();
  return useCallback(
    async (reportId: number, filename: string): Promise<string | null> => {
      try {
        const res = await fetchWithAuth(`/api/portal/reports/${reportId}/download`, undefined, { silent: true });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
          return body?.error ?? `Could not download this report (${res.status})`;
        }
        const blob = await res.blob();
        await triggerBlobDownload(blob, filename);
        return null;
      } catch (err) {
        return err instanceof Error ? err.message : String(err);
      }
    },
    [fetchWithAuth],
  );
}

/** Mints a real 30-day share link for a document. */
export function useShareDocument() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (documentId: number) => {
      const res = await fetchWithAuth(`/api/portal/documents/${documentId}/share`, { method: "POST" }, { silent: true });
      return parseJsonOrThrow<WireShareResult>(res);
    },
    onSuccess: () => {
      // Re-sharing revokes any prior link for this same document server-side;
      // no field on the list changes, but keep the list query fresh anyway.
      void queryClient.invalidateQueries({ queryKey: QK.insightsDocuments });
    },
  });
}

// The public (unauthenticated) share-viewer read/dwell pair
// (`GET/POST /api/public/documents/:shareToken[/doc-views]`) is wired by
// `shared-document-public.tsx` / `lib/public-share-api.ts` (#4001, Feature
// #1663) — not duplicated here.
