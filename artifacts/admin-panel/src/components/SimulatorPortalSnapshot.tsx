import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useTestbedContext } from "@/contexts/TestbedContext";
import { toast } from "sonner";
import {
  RefreshCw,
  ExternalLink,
  Loader2,
  AlertTriangle,
  Gauge,
} from "lucide-react";

interface EngineSnapshot {
  engineKey: string;
  score: number | null;
  capturedAt: string | null;
  findings: string[];
}

interface PortalSnapshot {
  customer: { id: number; name: string; domain: string | null };
  hasPortalUser: boolean;
  compositeScore: number | null;
  engines: EngineSnapshot[];
  capturedAt: string | null;
}

function scoreColor(score: number | null): string {
  if (score === null) return "text-muted-foreground";
  if (score >= 80) return "text-emerald-400";
  if (score >= 60) return "text-amber-400";
  return "text-destructive";
}

/**
 * Replaces the retired live-iframe Customer Portal Mirror. The iframe approach
 * was structurally unreliable (single-use impersonation token dies on any frame
 * remount, the portal's root redirect races the token exchange, and the panel
 * required a hand-typed cross-deployment URL). Instead: a static snapshot of
 * the same engine-snapshot state the portal dashboard renders, fetched via the
 * admin API, plus a fresh-token "open portal in new tab" action.
 */
export function SimulatorPortalSnapshot() {
  const { fetchWithAuth } = useAuth();
  const { selectedCustomerId } = useTestbedContext();
  const [snapshot, setSnapshot] = useState<PortalSnapshot | null>(null);
  const [fetchedAt, setFetchedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  // Monotonic request id — a slow response for a previously-selected testbed
  // must not overwrite the snapshot of the currently-selected one.
  const requestSeq = useRef(0);

  const loadSnapshot = useCallback(
    async (id: number) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      try {
        const res = await fetchWithAuth(`/api/admin/simulator/testbeds/${id}/portal-snapshot`);
        const data = await res.json();
        if (seq !== requestSeq.current) return;
        if (!res.ok) throw new Error(data.error ?? "Failed to load portal snapshot");
        setSnapshot(data);
        setFetchedAt(new Date());
      } catch (err: any) {
        if (seq !== requestSeq.current) return;
        toast.error(err.message ?? "Failed to load portal snapshot");
        setSnapshot(null);
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [fetchWithAuth],
  );

  useEffect(() => {
    if (selectedCustomerId == null) {
      setSnapshot(null);
      return;
    }
    loadSnapshot(selectedCustomerId);
  }, [selectedCustomerId, loadSnapshot]);

  // Fresh single-use token per click — tokens are consumed on first exchange,
  // so re-using one across opens can never work. Same-host path routing means
  // the portal is always at /portal on this origin (see .replit-artifact
  // manifests) — no hand-typed base URL.
  const openPortal = async () => {
    if (selectedCustomerId == null) return;
    setOpening(true);
    // Open the tab synchronously inside the click gesture — popup blockers
    // reject window.open calls that happen after an await.
    const tab = window.open("", "_blank");
    try {
      const res = await fetchWithAuth(`/api/admin/simulator/testbeds/${selectedCustomerId}/portal-mirror-token`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to issue portal token");
      const url = `/portal/?impersonation_token=${encodeURIComponent(data.token)}`;
      if (tab) tab.location.href = url;
      else window.open(url, "_blank");
    } catch (err: any) {
      tab?.close();
      toast.error(err.message ?? "Failed to open portal");
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-xs">
      <div className="shrink-0 space-y-2 border-b border-border p-2.5">
        <div className="flex gap-1.5">
          <button
            onClick={() => selectedCustomerId != null && loadSnapshot(selectedCustomerId)}
            disabled={selectedCustomerId == null || loading}
            className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded border border-border bg-card text-foreground transition-colors hover:bg-accent disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Refresh
          </button>
          <button
            onClick={openPortal}
            disabled={selectedCustomerId == null || opening || (snapshot !== null && !snapshot.hasPortalUser)}
            title="Issues a fresh single-use impersonation token and opens the customer portal in a new tab"
            className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {opening ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
            Open Portal
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">
        {selectedCustomerId == null ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <Gauge className="h-6 w-6 opacity-40" />
            <p className="max-w-[220px] leading-relaxed">
              Select a testbed customer in the header to see a snapshot of the state their portal dashboard renders.
            </p>
          </div>
        ) : loading && !snapshot ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : snapshot ? (
          <div className="space-y-3">
            <div>
              <div className="text-sm font-semibold text-foreground">{snapshot.customer.name}</div>
              <div className="font-mono text-[11px] text-muted-foreground">
                {snapshot.customer.domain ?? "no domain"} · customer #{snapshot.customer.id}
              </div>
              {fetchedAt && (
                <div className="mt-0.5 text-[10px] text-muted-foreground/70">
                  snapshot fetched {fetchedAt.toLocaleTimeString()}
                </div>
              )}
            </div>

            {!snapshot.hasPortalUser && (
              <div className="flex items-start gap-2 rounded border border-amber-400/30 bg-amber-400/10 p-2 text-amber-400">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="leading-relaxed">
                  No active portal user for this customer — "Open Portal" needs one to impersonate.
                </span>
              </div>
            )}

            <div className="flex items-baseline gap-2 rounded border border-border bg-card p-2.5">
              <span className={`font-mono text-2xl font-semibold tabular-nums ${scoreColor(snapshot.compositeScore)}`}>
                {snapshot.compositeScore ?? "—"}
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Composite score
              </span>
            </div>

            {snapshot.engines.length === 0 ? (
              <div className="rounded border border-dashed border-border p-3 text-center leading-relaxed text-muted-foreground">
                No engine snapshots yet — run engines from the Run Engines tab to populate the portal dashboard.
              </div>
            ) : (
              <div className="divide-y divide-border overflow-hidden rounded border border-border">
                {snapshot.engines.map((eng) => (
                  <div key={eng.engineKey} className="bg-card p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-[11px] text-foreground">{eng.engineKey}</span>
                      <span className={`font-mono text-sm font-semibold tabular-nums ${scoreColor(eng.score)}`}>
                        {eng.score ?? "—"}
                      </span>
                    </div>
                    {eng.capturedAt && (
                      <div className="text-[10px] text-muted-foreground/70">
                        captured {new Date(eng.capturedAt).toLocaleString()}
                      </div>
                    )}
                    {eng.findings.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {eng.findings.map((f, i) => (
                          <li key={i} className="truncate text-[11px] leading-snug text-muted-foreground" title={f}>
                            · {f}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
