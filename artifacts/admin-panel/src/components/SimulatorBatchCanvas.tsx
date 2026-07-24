// artifacts/admin-panel/src/components/SimulatorBatchCanvas.tsx
//
// Live summary for a bulk run — "run every check under this domain against the
// selected testbed tenant" (phase 3).
//
// The batch is started from the Explorer tree's domain folder
// (POST /api/admin/monitor-checks/bulk-run) and polled here
// (GET /api/admin/monitor-check-batches/:batchId). Every row and every count is
// read back from the persisted `simulator_check_runs` rows, so the summary is
// the same data the run-history list shows — not a client-side tally that could
// drift from it, and not lost if this tab is closed and reopened.
//
// LIFECYCLE AND OUTCOME ARE REPORTED SEPARATELY, deliberately. A license-gap
// result is a `failed` run in lifecycle terms (the run route maps every non-ok
// executor status to failed so the UI can never show green over a non-result),
// but it is NOT a broken check — it means the tenant lacks the M365 SKU. Folding
// the two together would report a healthy tenant's missing add-on as an error.

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, KeyRound, Loader2, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";
import type { RunSummary } from "./SimulatorRunHistory";

interface BatchSummary {
  batchId: string;
  total: number;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  ok: number;
  error: number;
  licenseGap: number;
  consentRevoked: number;
  requiresScript: number;
  licenseGapFeatures: string[];
  finished: boolean;
}

export interface BulkRunTarget {
  batchId: string;
  domain: string;
  customerId: number;
  total: number;
  skipped: Array<{ checkKey: string; reason: string }>;
}

const POLL_INTERVAL_MS = 1500;
// ~5 minutes. A whole domain of checks that hasn't finished by then is stuck,
// and a bounded poll is the same discipline the single-run poller uses.
const POLL_MAX_TICKS = 200;

export function SimulatorBatchCanvas({ target }: { target: BulkRunTarget }) {
  const { fetchWithAuth } = useAuth();

  const [summary, setSummary] = useState<BatchSummary | null>(null);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<number | null>(null);

  const stopPolling = () => {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const load = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetchWithAuth(`/api/admin/monitor-check-batches/${target.batchId}`);
      if (!res.ok) return false;
      const data = await res.json();
      setSummary(data.summary as BatchSummary);
      setRuns((data.runs ?? []) as RunSummary[]);
      return Boolean(data.summary?.finished);
    } catch {
      // Transient poll error — keep polling until the tick budget runs out.
      return false;
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, target.batchId]);

  useEffect(() => {
    setLoading(true);
    setSummary(null);
    setRuns([]);
    void load();

    let ticks = 0;
    let inFlight = false;
    stopPolling();
    pollRef.current = window.setInterval(async () => {
      ticks += 1;
      if (!inFlight) {
        inFlight = true;
        try {
          const finished = await load();
          if (finished) {
            stopPolling();
            return;
          }
        } finally {
          inFlight = false;
        }
      }
      if (ticks >= POLL_MAX_TICKS) {
        stopPolling();
        toast.error("Bulk run is still going after 5 minutes — stopped polling");
      }
    }, POLL_INTERVAL_MS);

    return stopPolling;
  }, [target.batchId, load]);

  const done = (summary?.completed ?? 0) + (summary?.failed ?? 0);
  const total = summary?.total ?? target.total;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background p-4">
      <div className="mb-3 flex items-start justify-between gap-4 border-b border-border pb-3">
        <div className="min-w-0">
          <h3 className="truncate font-mono text-sm font-semibold text-foreground">
            Bulk run — {target.domain}:*
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Every active check under <span className="font-mono">{target.domain}:</span>, run against customer{" "}
            <span className="font-mono">{target.customerId}</span> through the same single-run execution path.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="flex shrink-0 items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <RefreshCw className="h-3 w-3" /> Refresh
        </button>
      </div>

      {/* Progress */}
      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between text-[10px]">
          <span className="font-semibold uppercase tracking-wider text-muted-foreground">Progress</span>
          <span className="font-mono tabular-nums text-muted-foreground">
            {done}/{total} finished
            {summary?.finished ? "" : " — running…"}
          </span>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-accent">
          <div
            className={`h-full transition-all ${summary?.finished ? "bg-emerald-400" : "bg-primary"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Outcome counts — separate from lifecycle counts, on purpose. */}
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <SummaryTile
          icon={<CheckCircle2 className="h-3.5 w-3.5" />}
          label="ok"
          value={summary?.ok ?? 0}
          tone="text-emerald-400 border-emerald-400/25 bg-emerald-400/5"
        />
        <SummaryTile
          icon={<XCircle className="h-3.5 w-3.5" />}
          label="error"
          value={summary?.error ?? 0}
          tone="text-destructive border-destructive/25 bg-destructive/5"
        />
        <SummaryTile
          icon={<KeyRound className="h-3.5 w-3.5" />}
          label="license gap"
          value={summary?.licenseGap ?? 0}
          tone="text-amber-400 border-amber-400/25 bg-amber-400/5"
        />
        <SummaryTile
          icon={<AlertTriangle className="h-3.5 w-3.5" />}
          label="consent revoked"
          value={summary?.consentRevoked ?? 0}
          tone="text-amber-400 border-amber-400/25 bg-amber-400/5"
        />
      </div>

      {summary && summary.licenseGapFeatures.length > 0 && (
        <div className="mb-3 rounded border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-300">
          Missing M365 add-on{summary.licenseGapFeatures.length > 1 ? "s" : ""}:{" "}
          <span className="font-mono">{summary.licenseGapFeatures.join(", ")}</span>. These checks did not fail — the
          tenant is not licensed for the data they read.
        </div>
      )}

      {target.skipped.length > 0 && (
        <div className="mb-3 rounded border border-border bg-card px-3 py-2 text-[11px] text-muted-foreground">
          Skipped {target.skipped.length} check{target.skipped.length > 1 ? "s" : ""} that {target.skipped.length > 1 ? "have" : "has"} no
          Graph endpoint to execute:{" "}
          <span className="font-mono">{target.skipped.map((s) => s.checkKey).join(", ")}</span>
        </div>
      )}

      {/* Per-check rows */}
      <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Checks
      </label>
      {loading && runs.length === 0 ? (
        <div className="flex items-center gap-2 py-4 text-[11px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting…
        </div>
      ) : (
        <div className="overflow-hidden rounded border border-border">
          {runs.map((run) => (
            <div
              key={run.runId}
              className="flex items-center gap-2 border-b border-border px-2 py-1.5 text-[11px] last:border-b-0"
            >
              <span className="w-[52px] shrink-0">
                {run.status === "completed" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                ) : run.status === "failed" ? (
                  <XCircle className="h-3.5 w-3.5 text-destructive" />
                ) : (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                )}
              </span>
              <span className="w-[220px] shrink-0 truncate font-mono text-foreground" title={run.checkKey}>
                {run.checkKey}
              </span>
              <span className="w-[104px] shrink-0 font-mono text-muted-foreground/80">{run.resultStatus ?? run.status}</span>
              <span className="w-[64px] shrink-0 text-right font-mono tabular-nums text-muted-foreground/80">
                {run.itemCount ?? "—"} item
              </span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground/70" title={run.statusText}>
                {run.statusText}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className={`flex items-center gap-2 rounded border px-2.5 py-1.5 ${tone}`}>
      {icon}
      <span className="font-mono text-lg tabular-nums leading-none">{value}</span>
      <span className="text-[10px] uppercase tracking-wider opacity-80">{label}</span>
    </div>
  );
}
