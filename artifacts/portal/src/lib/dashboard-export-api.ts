/**
 * React Query hooks for the Overview/Customer-Home dashboard export + share
 * surface (#4069), wired against the real, live `dashboard-export.ts` routes:
 *
 *   GET  /api/portal/dashboard/pdf
 *   GET  /api/portal/dashboard/ppt
 *   GET  /api/portal/dashboard/share
 *   POST /api/portal/dashboard/share
 *
 * Mirrors the shape of `documents-api.ts` (the Documents page's own
 * export/share pattern, which these routes' own header comment names as the
 * precedent they reuse) — same blob-download helper, same share-link
 * mutation shape.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import type { ApiErrorBody, WireDashboardShareResponse, WireDashboardShareResult } from "@/lib/dashboard-export-types";

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

function filenameFromContentDisposition(res: Response, fallback: string): string {
  const header = res.headers.get("content-disposition");
  const match = header ? /filename="([^"]+)"/.exec(header) : null;
  return match?.[1] ?? fallback;
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

const QK = {
  dashboardShare: ["portal", "dashboard", "share"] as const,
};

/** Downloads the dashboard's branded PDF snapshot as a real browser file-save. */
export function useDownloadDashboardPdf() {
  const { fetchWithAuth } = useAuth();
  return useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth("/api/portal/dashboard/pdf", undefined, { silent: true });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
        throw new Error(body?.error ?? `Could not export the dashboard as PDF (${res.status})`);
      }
      const filename = filenameFromContentDisposition(res, "dashboard.pdf");
      const blob = await res.blob();
      await triggerBlobDownload(blob, filename);
    },
  });
}

/** Downloads the dashboard's branded PPT snapshot as a real browser file-save. */
export function useDownloadDashboardPpt() {
  const { fetchWithAuth } = useAuth();
  return useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth("/api/portal/dashboard/ppt", undefined, { silent: true });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
        throw new Error(body?.error ?? `Could not export the dashboard as PPT (${res.status})`);
      }
      const filename = filenameFromContentDisposition(res, "dashboard.pptx");
      const blob = await res.blob();
      await triggerBlobDownload(blob, filename);
    },
  });
}

/** Reads the dashboard's current live share link, if one hasn't expired. */
export function useDashboardShareStatus(enabled: boolean) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: QK.dashboardShare,
    enabled,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/dashboard/share", undefined, { silent: true });
      return parseJsonOrThrow<WireDashboardShareResponse>(res);
    },
  });
}

/** Mints a real 30-day share link for the current dashboard snapshot. */
export function useCreateDashboardShare() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth("/api/portal/dashboard/share", { method: "POST" }, { silent: true });
      return parseJsonOrThrow<WireDashboardShareResult>(res);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: QK.dashboardShare });
    },
  });
}
