import { useCallback, useState } from "react";
import { useAuth } from "@/lib/auth-context";

/**
 * Live wiring for the standalone Data Rights and Privacy page (#4005, part of
 * #1652 — Shane's 2026-09-14 reversal: this gets its own page rather than
 * folding into Account Security). Calls the same two real endpoints Account
 * Security's "Your data" section already wires (`useAccountSecurityLive.ts`,
 * #2996) — a deliberate overlap per the design's own §5 ("one deletion path,
 * two doors") and the contract pack's §5 ("if both end up live, they must
 * call the same two endpoints and never diverge in copy").
 *
 * Wire contract: `docs/data-rights-and-privacy-contract-pack.md` (#2549),
 * citing `artifacts/api-server/src/routes/portal-privacy.ts`.
 */

const DATA_EXPORT_URL = "/api/portal/data-export";
const DELETION_REQUEST_URL = "/api/portal/deletion-request";

export type ExportState = "idle" | "loading" | "done" | "error";
export type DeletionState = "idle" | "loading" | "done" | "error";

export interface DataRightsPrivacyLiveState {
  readonly exportState: ExportState;
  readonly exportFilename: string | null;
  readonly exportError: string | null;
  readonly startExport: () => Promise<void>;
  readonly resetExport: () => void;

  readonly deletionState: DeletionState;
  readonly deletionMessage: string | null;
  readonly deletionError: string | null;
  readonly submitDeletion: () => Promise<void>;
  readonly resetDeletion: () => void;
}

/** `POST /api/portal/deletion-request`'s own 404/500 error shapes (`portal-privacy.ts:287`, `:305`) — shown verbatim, never paraphrased. */
const GENERIC_FAILURE = "Something went wrong. Please try again.";

export function useDataRightsPrivacyLive(): DataRightsPrivacyLiveState {
  const { fetchWithAuth } = useAuth();

  const [exportState, setExportState] = useState<ExportState>("idle");
  const [exportFilename, setExportFilename] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const [deletionState, setDeletionState] = useState<DeletionState>("idle");
  const [deletionMessage, setDeletionMessage] = useState<string | null>(null);
  const [deletionError, setDeletionError] = useState<string | null>(null);

  const startExport = useCallback(async () => {
    setExportState("loading");
    setExportError(null);
    try {
      const res = await fetchWithAuth(DATA_EXPORT_URL, undefined, { silent: true });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setExportError(body.error ?? GENERIC_FAILURE);
        setExportState("error");
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const filename = match?.[1] ?? `data-export-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportFilename(filename);
      setExportState("done");
    } catch (err) {
      setExportError(err instanceof Error ? err.message : GENERIC_FAILURE);
      setExportState("error");
    }
  }, [fetchWithAuth]);

  const resetExport = useCallback(() => {
    setExportState("idle");
    setExportFilename(null);
    setExportError(null);
  }, []);

  const submitDeletion = useCallback(async () => {
    setDeletionState("loading");
    setDeletionError(null);
    try {
      const res = await fetchWithAuth(DELETION_REQUEST_URL, { method: "POST" }, { silent: true });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
      if (!res.ok || !body.ok) {
        setDeletionError(body.error ?? GENERIC_FAILURE);
        setDeletionState("error");
        return;
      }
      setDeletionMessage(body.message ?? null);
      setDeletionState("done");
    } catch (err) {
      setDeletionError(err instanceof Error ? err.message : GENERIC_FAILURE);
      setDeletionState("error");
    }
  }, [fetchWithAuth]);

  const resetDeletion = useCallback(() => {
    setDeletionState("idle");
    setDeletionMessage(null);
    setDeletionError(null);
  }, []);

  return {
    exportState,
    exportFilename,
    exportError,
    startExport,
    resetExport,
    deletionState,
    deletionMessage,
    deletionError,
    submitDeletion,
    resetDeletion,
  };
}
