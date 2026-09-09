/**
 * Download triggers for the Remediation Tracker's export routes (§1g,
 * `docs/portal/remediation-tracking-contract-pack.md`):
 *
 *   GET /portal/remediation-tracker/export.csv
 *   GET /portal/remediation-tracker/export.pdf
 *   GET /portal/remediation-tracker/evidence-pack.pdf
 *
 * All three stream a real file (`Content-Disposition: attachment`) built live
 * off the customer's own stored tracker rows — no client-side generation, no
 * fixture. This module just fetches the blob and hands the browser its own
 * `Content-Disposition` filename back rather than inventing one.
 */
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import type { ApiErrorBody } from "@/lib/risk-register-types";

export type RemediationExportKind = "csv" | "pdf" | "evidence-pack";

const EXPORT_PATHS: Record<RemediationExportKind, string> = {
  csv: "/api/portal/remediation-tracker/export.csv",
  pdf: "/api/portal/remediation-tracker/export.pdf",
  "evidence-pack": "/api/portal/remediation-tracker/evidence-pack.pdf",
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

/** Fires the browser's own save-file flow for a blob, then releases the object URL. */
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

/**
 * `useRemediationExport("csv" | "pdf" | "evidence-pack")` — call `.mutate()`
 * (or `.mutateAsync()`) from a click handler; the file downloads on success.
 * A failed export (e.g. no rows to export server-side) surfaces via the
 * mutation's own `isError`/`error` — never a silently-empty file.
 */
export function useRemediationExport(kind: RemediationExportKind) {
  const { fetchWithAuth } = useAuth();
  return useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth(EXPORT_PATHS[kind], undefined, { silent: true });
      if (!res.ok) {
        let message = `Export failed (${res.status})`;
        try {
          const body = (await res.clone().json()) as ApiErrorBody;
          if (body?.error?.message) message = body.error.message;
        } catch {
          // non-JSON error body (the export routes error as JSON, but don't assume) — keep the generic message
        }
        const err = new Error(message) as Error & { status?: number };
        err.status = res.status;
        throw err;
      }
      const blob = await res.blob();
      const filename = filenameFromContentDisposition(
        res.headers.get("Content-Disposition"),
        FALLBACK_FILENAMES[kind],
      );
      saveBlob(blob, filename);
    },
  });
}
