/**
 * offboardingLive.ts — the Offboarding ("Leaving") page's real data (Git
 * #4002, contract pack `docs/offboarding-contract-pack.md` §5/§6).
 *
 *   GET  /api/portal/customer/export    — export preview + the real download
 *   POST /api/portal/customer/offboard  — end services (`mspId === 1` only)
 *
 * `GET /api/portal/dashboard`'s `customerStatus`/`mspName` fields (already
 * fetched by `useOverviewDashboard`, contract pack §1/§10) drive the scene
 * switch; `useAuth().user.mspId` — the same JWT claim `/portal/customer/
 * offboard` itself gates on — decides "brokered" synchronously, with no
 * fetch to wait on.
 *
 * served by `artifacts/api-server/src/routes/portal-customer-engines.ts`.
 */

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useOverviewDashboard } from "./overview/useOverviewDashboard";
import { toAffectedServices, toExportBlocks, type AffectedServiceRow, type ExportBlock, type WireExportPayload } from "./offboardingWire";

const EXPORT_URL = "/api/portal/customer/export";
const OFFBOARD_URL = "/api/portal/customer/offboard";

export type OffboardingScene = "active" | "brokered" | "inactive";

export type ExportButtonState = "idle" | "loading" | "done" | "error";

export interface OffboardingLiveState {
  /** True until the dashboard read (for customerStatus/mspName) has resolved once. */
  readonly loading: boolean;
  readonly scene: OffboardingScene;
  readonly mspName: string | null;

  readonly previewLoading: boolean;
  readonly previewError: boolean;
  readonly exportBlocks: readonly ExportBlock[];
  readonly affectedServices: readonly AffectedServiceRow[];

  readonly exportState: ExportButtonState;
  readonly exportFilename: string | null;
  readonly exportError: string | null;
  readonly startExport: () => void;

  readonly ending: boolean;
  readonly ended: boolean;
  readonly endError: string | null;
  readonly endServices: () => Promise<void>;
}

/** Real filename stamp — same "yyyy-mm-dd" shape the design's own mock
 *  filename uses, built off the actual download moment, not a fixture. */
function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export function useOffboardingLive(): OffboardingLiveState {
  const { fetchWithAuth, user } = useAuth();
  const dashboard = useOverviewDashboard();

  const [previewData, setPreviewData] = useState<WireExportPayload | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState(false);

  const [exportState, setExportState] = useState<ExportButtonState>("idle");
  const [exportFilename, setExportFilename] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const [ending, setEnding] = useState(false);
  const [ended, setEnded] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPreviewLoading(true);
    void fetchWithAuth(EXPORT_URL, undefined, { silent: true })
      .then(async (res) => {
        if (!res.ok) throw new Error(`export ${res.status}`);
        return (await res.json()) as WireExportPayload;
      })
      .then((body) => {
        if (cancelled) return;
        setPreviewData(body);
        setPreviewError(false);
      })
      .catch(() => {
        if (cancelled) return;
        setPreviewError(true);
      })
      .finally(() => {
        if (cancelled) return;
        setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  const startExport = useCallback(() => {
    setExportState("loading");
    setExportError(null);
    void fetchWithAuth(EXPORT_URL, undefined, { silent: true })
      .then(async (res) => {
        if (!res.ok) throw new Error(`export ${res.status}`);
        return (await res.json()) as WireExportPayload;
      })
      .then((body) => {
        const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const filename = `customer-data-export-${todayStamp()}.json`;
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setExportFilename(filename);
        setExportState("done");
      })
      .catch((err: unknown) => {
        setExportError(err instanceof Error ? err.message : String(err));
        setExportState("error");
      });
  }, [fetchWithAuth]);

  const endServices = useCallback(async (): Promise<void> => {
    setEnding(true);
    setEndError(null);
    try {
      const res = await fetchWithAuth(
        OFFBOARD_URL,
        { method: "POST", headers: { "Content-Type": "application/json" } },
        { silent: true },
      );
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !body?.ok) {
        setEndError(body?.error ?? `Could not end services (${res.status})`);
        return;
      }
      setEnded(true);
    } catch (err: unknown) {
      setEndError(err instanceof Error ? err.message : String(err));
    } finally {
      setEnding(false);
    }
  }, [fetchWithAuth]);

  const dashboardData = dashboard.data;
  const customerStatus = dashboardData?.customerStatus ?? null;
  const isInactiveStatus = customerStatus === "inactive" || customerStatus === "archived";
  const isBrokered = (user?.mspId ?? null) !== 1;
  const scene: OffboardingScene = isBrokered ? "brokered" : ended || isInactiveStatus ? "inactive" : "active";

  return {
    loading: dashboard.loading,
    scene,
    mspName: dashboardData?.mspName ?? null,

    previewLoading,
    previewError,
    exportBlocks: toExportBlocks(previewData),
    affectedServices: toAffectedServices(previewData),

    exportState,
    exportFilename,
    exportError,
    startExport,

    ending,
    ended,
    endError,
    endServices,
  };
}
