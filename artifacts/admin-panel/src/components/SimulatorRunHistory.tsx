// artifacts/admin-panel/src/components/SimulatorRunHistory.tsx
//
// Run history and run-to-run diff for one M365 endpoint (phase 3).
//
// WHAT THIS DEPENDS ON: runs are now persisted in the real `simulator_check_runs`
// table rather than a process-local Map, so this list is genuine history — it
// survives an api-server restart, which is the whole reason the phase exists.
// Every timestamp and status rendered here is a stored value, never a
// client-side reconstruction.
//
// THE DIFF is computed server-side by re-running the REAL phase-2 engine trace
// against each run's own stored response (GET .../:runId/diff?against=...), so
// "this rule stopped firing" is the engine's own answer for both sides, not a
// second opinion assembled in the browser. Both sides are traced with the SAME
// current rule set — a flip therefore means the RESPONSES differ. The one thing
// that is legitimately per-run is each run's snapshotted mapping; when the two
// snapshots disagree the panel says so explicitly, because a value that moved
// because the mapping was edited is a different finding from one that moved
// because the tenant changed.

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, GitCompare, History, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "@/contexts/AuthContext";

// ─── API shapes (match api-server lib/simulator-run-store.ts + simulator-run-diff.ts) ───

export interface RunSummary {
  runId: string;
  batchId: string | null;
  checkKey: string;
  checkLabel: string;
  customerId: number;
  tenantId: string;
  status: "pending" | "running" | "completed" | "failed";
  statusText: string;
  progress: number;
  resultStatus: string | null;
  itemCount: number | null;
  pageCount: number | null;
  severityMatched: string | null;
  licenseFeature: string | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
  hasTrace: boolean;
  itemsOmitted: boolean;
}

interface DiffKeyChange {
  key: string;
  before: unknown;
  after: unknown;
  change: "added" | "removed" | "changed";
  origin: string;
  transformBefore?: string;
  transformAfter?: string;
  producedDifferently: boolean;
}

interface DiffRuleChange {
  ruleId: number;
  signalKey: string;
  sourceKey: string;
  ruleType: string;
  description: string | null;
  before: boolean | null;
  after: boolean | null;
  change: "started_firing" | "stopped_firing" | "appeared" | "disappeared";
  reasonBefore: string | null;
  reasonAfter: string | null;
}

interface RunDiff {
  checkKey: string;
  before: { runId: string; startedAt: string; status: string; resultStatus: string | null; itemCount: number };
  after: { runId: string; startedAt: string; status: string; resultStatus: string | null; itemCount: number };
  keyChanges: DiffKeyChange[];
  unchangedKeyCount: number;
  ruleChanges: DiffRuleChange[];
  unchangedRuleCount: number;
  mappingChanged: boolean;
  propertiesChanged: boolean;
}

function formatValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "—";
  if (typeof value === "object") {
    const json = JSON.stringify(value);
    return json.length > 60 ? `${json.slice(0, 60)}…` : json;
  }
  return String(value);
}

/** Real stored timestamps, rendered in the operator's own locale. */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const RULE_CHANGE_LABEL: Record<DiffRuleChange["change"], string> = {
  started_firing: "started firing",
  stopped_firing: "stopped firing",
  appeared: "now evaluated",
  disappeared: "no longer evaluated",
};

export function SimulatorRunHistory({
  checkKey,
  customerId,
  /** Bumped by the parent after a run finishes so the list refetches. */
  refreshToken,
  /** Loads a historical run back into the canvas (response + trace). */
  onOpenRun,
}: {
  checkKey: string;
  customerId: number | null;
  refreshToken: number;
  onOpenRun?: (runId: string) => void;
}) {
  const { fetchWithAuth } = useAuth();

  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // The two runs picked for comparison, oldest-selected first.
  const [selected, setSelected] = useState<string[]>([]);
  const [diff, setDiff] = useState<RunDiff | null>(null);
  const [diffing, setDiffing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ checkKey });
      if (customerId != null) params.set("customerId", String(customerId));
      const res = await fetchWithAuth(`/api/admin/monitor-check-runs?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to load run history");
        return;
      }
      const data = await res.json();
      setRuns((data.runs ?? []) as RunSummary[]);
    } catch (err: any) {
      toast.error(err.message || "Network error loading run history");
    } finally {
      setLoading(false);
    }
  }, [checkKey, customerId, fetchWithAuth]);

  // Reset every selection when the operator moves to a different endpoint —
  // a diff between two runs of different checks is meaningless and the server
  // refuses it, so the UI must not offer it either.
  useEffect(() => {
    setSelected([]);
    setDiff(null);
    setRuns([]);
    setExpanded(false);
  }, [checkKey]);

  useEffect(() => {
    if (expanded) void load();
  }, [expanded, refreshToken, load]);

  const toggleSelected = (runId: string) => {
    setDiff(null);
    setSelected((prev) => {
      if (prev.includes(runId)) return prev.filter((r) => r !== runId);
      // Keep the two most recent picks; a third click replaces the older one.
      return [...prev, runId].slice(-2);
    });
  };

  const runDiff = async () => {
    if (selected.length !== 2) return;
    setDiffing(true);
    try {
      const res = await fetchWithAuth(
        `/api/admin/monitor-check-runs/${selected[0]}/diff?against=${encodeURIComponent(selected[1]!)}`,
      );
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Failed to diff these runs");
        return;
      }
      setDiff(data.diff as RunDiff);
    } catch (err: any) {
      toast.error(err.message || "Network error diffing runs");
    } finally {
      setDiffing(false);
    }
  };

  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          <History className="h-3.5 w-3.5" />
          Run history
          {runs.length > 0 && <span className="tabular-nums text-muted-foreground/60">({runs.length})</span>}
        </button>
        {expanded && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => void load()}
              disabled={loading}
              className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} Refresh
            </button>
            <button
              onClick={() => void runDiff()}
              disabled={selected.length !== 2 || diffing}
              className="flex items-center gap-1 rounded bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
              title={
                selected.length === 2
                  ? "Compare the two selected runs"
                  : "Select two runs of this check to compare them"
              }
            >
              {diffing ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitCompare className="h-3 w-3" />}
              Compare ({selected.length}/2)
            </button>
          </div>
        )}
      </div>

      {!expanded ? null : loading && runs.length === 0 ? (
        <div className="flex items-center gap-2 py-4 text-[11px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading run history…
        </div>
      ) : runs.length === 0 ? (
        <p className="py-3 text-[11px] text-muted-foreground">
          No stored runs for this endpoint yet. Runs are persisted, so history here survives an api-server restart.
        </p>
      ) : (
        <div className="overflow-hidden rounded border border-border">
          {runs.map((run) => {
            const picked = selected.indexOf(run.runId);
            return (
              <div
                key={run.runId}
                onClick={() => toggleSelected(run.runId)}
                className={`flex cursor-pointer items-center gap-2 border-b border-border px-2 py-1.5 text-[11px] last:border-b-0 transition-colors hover:bg-accent ${
                  picked >= 0 ? "bg-accent/60" : ""
                }`}
              >
                <span
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border text-[9px] font-bold ${
                    picked >= 0 ? "border-primary bg-primary text-primary-foreground" : "border-border text-transparent"
                  }`}
                >
                  {picked >= 0 ? picked + 1 : "0"}
                </span>
                <span className="w-[128px] shrink-0 font-mono text-muted-foreground">{formatWhen(run.startedAt)}</span>
                <span
                  className={`w-[72px] shrink-0 font-mono ${
                    run.status === "completed"
                      ? "text-emerald-400"
                      : run.status === "failed"
                        ? "text-destructive"
                        : "text-primary"
                  }`}
                >
                  {run.status}
                </span>
                <span className="w-[96px] shrink-0 font-mono text-muted-foreground/80">
                  {run.resultStatus ?? "—"}
                </span>
                <span className="w-[64px] shrink-0 text-right font-mono tabular-nums text-muted-foreground/80">
                  {run.itemCount ?? "—"} item
                </span>
                {run.hasTrace && (
                  <span className="shrink-0 rounded-sm border border-primary/30 bg-primary/10 px-1 text-[9px] uppercase tracking-wider text-primary">
                    traced
                  </span>
                )}
                {run.itemsOmitted && (
                  <span
                    className="shrink-0 rounded-sm border border-amber-400/40 bg-amber-400/10 px-1 text-[9px] uppercase tracking-wider text-amber-400"
                    title="This run's response was too large to persist — it can't be traced or compared"
                  >
                    no response stored
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-muted-foreground/70" title={run.statusText}>
                  {run.statusText}
                </span>
                {onOpenRun && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenRun(run.runId);
                    }}
                    className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                    title="Load this run's response into the canvas"
                  >
                    Open
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {expanded && diff && <DiffView diff={diff} onClose={() => setDiff(null)} />}
    </div>
  );
}

// ─── The diff ─────────────────────────────────────────────────────────────────

function DiffView({ diff, onClose }: { diff: RunDiff; onClose: () => void }) {
  const nothingMoved = diff.keyChanges.length === 0 && diff.ruleChanges.length === 0;

  return (
    <div className="mt-3 rounded border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1.5">
        <div className="flex min-w-0 items-center gap-2 text-[11px]">
          <GitCompare className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="font-mono text-muted-foreground">{formatWhen(diff.before.startedAt)}</span>
          <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
          <span className="font-mono text-foreground">{formatWhen(diff.after.startedAt)}</span>
          <span className="ml-2 font-mono tabular-nums text-muted-foreground/70">
            {diff.before.itemCount} → {diff.after.itemCount} items
          </span>
        </div>
        <button onClick={onClose} className="shrink-0 text-muted-foreground transition-colors hover:text-foreground">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* A key that moved because the MAPPING was edited is a different finding
          from one that moved because the tenant changed. Never let the operator
          assume the first is the second. */}
      {(diff.mappingChanged || diff.propertiesChanged) && (
        <div className="border-b border-border bg-amber-400/10 px-2.5 py-1.5 text-[10px] text-amber-300">
          These two runs captured{" "}
          {diff.mappingChanged && diff.propertiesChanged
            ? "different mapping and extracted-property configs"
            : diff.mappingChanged
              ? "different mapping configs"
              : "different extracted-property configs"}
          . Some of the differences below may come from that catalog edit rather than from the tenant's data.
        </div>
      )}

      {nothingMoved ? (
        <p className="px-2.5 py-3 text-[11px] text-muted-foreground">
          Nothing changed — {diff.unchangedKeyCount} key(s) and {diff.unchangedRuleCount} rule outcome(s) are identical
          across both runs.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {/* Values */}
          <div className="px-2.5 py-2">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Profile keys
              </span>
              <span className="text-[10px] tabular-nums text-muted-foreground/60">
                {diff.keyChanges.length} changed · {diff.unchangedKeyCount} unchanged
              </span>
            </div>
            {diff.keyChanges.length === 0 ? (
              <p className="text-[11px] text-muted-foreground/70">No produced value differs between these runs.</p>
            ) : (
              <div className="space-y-1">
                {diff.keyChanges.map((k) => (
                  <div key={k.key} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[11px]">
                    <span
                      className={`rounded-sm px-1 text-[9px] font-semibold uppercase tracking-wider ${
                        k.change === "changed"
                          ? "bg-primary/15 text-primary"
                          : k.change === "added"
                            ? "bg-emerald-400/15 text-emerald-400"
                            : "bg-destructive/15 text-destructive"
                      }`}
                    >
                      {k.change}
                    </span>
                    <span className="font-mono text-foreground">{k.key}</span>
                    <span className="font-mono text-muted-foreground/70 line-through">{formatValue(k.before)}</span>
                    <ArrowRight className="h-3 w-3 self-center text-muted-foreground/50" />
                    <span className="font-mono text-foreground">{formatValue(k.after)}</span>
                    {k.producedDifferently && (
                      <span className="text-[10px] text-amber-400">
                        (transform {k.transformBefore ?? "—"} → {k.transformAfter ?? "—"})
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Rules */}
          <div className="px-2.5 py-2">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Rule outcomes
              </span>
              <span className="text-[10px] tabular-nums text-muted-foreground/60">
                {diff.ruleChanges.length} changed · {diff.unchangedRuleCount} unchanged
              </span>
            </div>
            {diff.ruleChanges.length === 0 ? (
              <p className="text-[11px] text-muted-foreground/70">
                Every rule reading this check's keys evaluates the same way on both runs.
              </p>
            ) : (
              <div className="space-y-1.5">
                {diff.ruleChanges.map((r) => (
                  <div key={r.ruleId} className="text-[11px]">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span
                        className={`rounded-sm px-1 text-[9px] font-semibold uppercase tracking-wider ${
                          r.change === "started_firing"
                            ? "bg-destructive/15 text-destructive"
                            : r.change === "stopped_firing"
                              ? "bg-emerald-400/15 text-emerald-400"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {RULE_CHANGE_LABEL[r.change]}
                      </span>
                      <span className="font-mono text-foreground">{r.signalKey}</span>
                      <span className="font-mono text-muted-foreground/70">
                        {r.ruleType} on {r.sourceKey}
                      </span>
                    </div>
                    {/* evaluateRule's own reason string on each side — verbatim. */}
                    <div className="ml-1 mt-0.5 space-y-px font-mono text-[10px] text-muted-foreground/70">
                      <div>before: {r.reasonBefore ?? "not evaluated (key not produced)"}</div>
                      <div>after: {r.reasonAfter ?? "not evaluated (key not produced)"}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
