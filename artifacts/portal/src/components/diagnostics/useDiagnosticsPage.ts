import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import type { DiagnosticsLatestWire, HealthBenchmarkWire } from "./types";

const LATEST_URL = "/api/portal/diagnostics/latest";
const BENCHMARK_URL = "/api/portal/health-benchmark";

export interface DiagnosticsPageState {
  readonly latest: DiagnosticsLatestWire | null;
  readonly benchmark: HealthBenchmarkWire | null;
  readonly loading: boolean;
  /** True once both reads have resolved (success or failure) at least once. */
  readonly loaded: boolean;
  /** True only on a genuine read failure — never set for an honest-empty payload. */
  readonly error: boolean;
}

/**
 * The real `GET /api/portal/diagnostics/latest` + `GET /api/portal/
 * health-benchmark` reads backing the Diagnostics and Scripts page (#3999,
 * Feature #1660). Scan-in-progress state is deliberately NOT read here — the
 * shell's own `useScanState()` (components/shell/useScanState.ts) already
 * polls the same `msp_diagnostic_runs` data via `/api/portal/scan-status`
 * for the Tenant Status card, and this page reuses that single source rather
 * than opening a second, disagreeing poll of the same table.
 *
 * Same no-fixture-fallback discipline as `usePillarPage` / `useOverviewDashboard`:
 * a failed read renders the honest error state, a genuinely never-scanned or
 * no-customer-context tenant renders its own honest empty payload (both reads
 * return `{ run: null, findings: [] }` / `{ pillars: [], asOfDate: null }`
 * rather than 403ing — see contract pack §1a/§1d), never a fabricated card.
 */
export function useDiagnosticsPage(): DiagnosticsPageState {
  const { fetchWithAuth, user } = useAuth();
  const [latest, setLatest] = useState<DiagnosticsLatestWire | null>(null);
  const [benchmark, setBenchmark] = useState<HealthBenchmarkWire | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);

    void Promise.all([
      fetchWithAuth(LATEST_URL, undefined, { silent: true }).then(async (res) => {
        if (!res.ok) throw new Error(`diagnostics/latest ${res.status}`);
        return (await res.json()) as DiagnosticsLatestWire;
      }),
      fetchWithAuth(BENCHMARK_URL, undefined, { silent: true }).then(async (res) => {
        if (!res.ok) throw new Error(`health-benchmark ${res.status}`);
        return (await res.json()) as HealthBenchmarkWire;
      }),
    ])
      .then(([latestBody, benchmarkBody]) => {
        if (cancelled) return;
        setLatest(latestBody);
        setBenchmark(benchmarkBody);
        setError(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [user, fetchWithAuth]);

  return { latest, benchmark, loading, loaded, error };
}

export interface ScriptDownloadState {
  readonly downloading: string | null;
  readonly download: (checkKey: string, filenameFallback: string) => Promise<void>;
}

/**
 * `GET /api/portal/scripts/:checkKey/download` (§1c) — not JSON, streams the
 * raw script file. Only reachable for a checkKey the caller's own latest scan
 * actually surfaced as `requires_script` (server-enforced, §1c step 2). A
 * non-2xx here already surfaces via `fetchWithAuth`'s own global error toast
 * (auth-context.tsx), so this hook only tracks which key is in flight.
 */
export function useScriptDownload(): ScriptDownloadState {
  const { fetchWithAuth } = useAuth();
  const [downloading, setDownloading] = useState<string | null>(null);

  const download = useCallback(
    async (checkKey: string, filenameFallback: string) => {
      setDownloading(checkKey);
      try {
        const res = await fetchWithAuth(`/api/portal/scripts/${encodeURIComponent(checkKey)}/download`);
        if (!res.ok) return;
        const disposition = res.headers.get("Content-Disposition") ?? "";
        const match = /filename="([^"]+)"/.exec(disposition);
        const filename = match?.[1] ?? filenameFallback;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } finally {
        setDownloading(null);
      }
    },
    [fetchWithAuth],
  );

  return { downloading, download };
}
