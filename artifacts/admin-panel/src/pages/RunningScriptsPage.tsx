import { useState, useEffect, useCallback, useRef } from "react";
import { useSearch } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Trash2 } from "lucide-react";
import DevSeedPanel from "@/components/DevSeedPanel";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ScriptRunRow {
  id: number;
  status: "running" | "completed" | "failed" | "awaiting_upload";
  executionSource: "manual" | "automated" | "customer_upload";
  jobId: string | null;
  createdAt: string;
  completedAt: string | null;
  customerId: number | null;
  customerName: string | null;
  libraryScriptId: string | null;
  scriptTitle: string | null;
  kanbanTaskId: number | null;
}

interface ScriptRunDetail extends ScriptRunRow {
  rawOutput: Record<string, unknown>;
  parsedFindings: string[];
  recommendations: string[];
  scoreImpact: Record<string, number>;
  profileUpdates: Record<string, unknown>;
}

interface CustomerOption {
  id: number;
  name: string | null;
}

interface OutputLine {
  sequence: number;
  text: string;
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CFG: Record<string, { cls: string; label: string }> = {
  running:         { cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25",  label: "Running"         },
  completed:       { cls: "bg-green-500/15 text-green-400 border-green-500/25",     label: "Completed"       },
  failed:          { cls: "bg-red-500/15 text-red-400 border-red-500/25",           label: "Failed"          },
  awaiting_upload: { cls: "bg-amber-500/15 text-amber-400 border-amber-500/25",     label: "Awaiting Upload" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? { cls: "bg-[#30363D] text-[#7D8590] border-[#30363D]", label: status };
  return (
    <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${cfg.cls}`}>
      {status === "running" && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
      {cfg.label}
    </span>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function formatDuration(start: string, end: string | null): string {
  if (!end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return "—";
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return remSecs > 0 ? `${mins}m ${remSecs}s` : `${mins}m`;
}

// ─── Detail Sheet ─────────────────────────────────────────────────────────────

function DetailSheet({
  runId,
  onClose,
  fetchWithAuth,
}: {
  runId: number;
  onClose: () => void;
  fetchWithAuth: (url: string, opts?: RequestInit) => Promise<Response>;
}) {
  const [detail, setDetail] = useState<ScriptRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [liveLines, setLiveLines] = useState<string[]>([]);
  const terminalRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSeqRef = useRef(-1);

  const fetchDetail = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`/api/admin/script-runs/${runId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as ScriptRunDetail;
      setDetail(data);
      setLoading(false);

      // If output is already in rawOutput, use it
      const rawText = (data.rawOutput as { text?: string })?.text;
      if (rawText) {
        setLiveLines(rawText.split("\n"));
      }

      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load detail");
      setLoading(false);
      return null;
    }
  }, [runId, fetchWithAuth]);

  const pollOutput = useCallback(async (jobId: string) => {
    try {
      const res = await fetchWithAuth(
        `/api/admin/runbook-jobs/output?jobId=${encodeURIComponent(jobId)}&since=${lastSeqRef.current}`
      );
      if (!res.ok) return;
      const data = await res.json() as {
        status: string;
        terminal: boolean;
        lines: OutputLine[];
      };

      if (data.lines.length > 0) {
        const maxSeq = Math.max(...data.lines.map(l => l.sequence));
        lastSeqRef.current = maxSeq;
        setLiveLines(prev => {
          const newTexts = data.lines.map(l => l.text);
          return [...prev, ...newTexts];
        });
      }

      if (data.terminal) {
        if (pollRef.current) clearInterval(pollRef.current);
        // Refresh detail to get final status
        void fetchDetail();
      }
    } catch {
      // ignore transient poll failures
    }
  }, [fetchWithAuth, fetchDetail]);

  const analysisPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    void (async () => {
      const data = await fetchDetail();
      if (data?.status === "running" && data.jobId) {
        pollRef.current = setInterval(() => void pollOutput(data.jobId!), 3000);
      }
      // Start analysis polling for customer_upload runs awaiting AI findings
      if (
        data?.status === "completed" &&
        data.executionSource === "customer_upload" &&
        (data.parsedFindings?.length ?? 0) === 0
      ) {
        analysisPollRef.current = setInterval(() => void fetchDetail(), 4000);
      }
    })();

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (analysisPollRef.current) clearInterval(analysisPollRef.current);
    };
  }, [fetchDetail, pollOutput]);

  // Stop analysis polling once findings arrive
  useEffect(() => {
    if (!detail) return;
    if ((detail.parsedFindings?.length ?? 0) > 0 && analysisPollRef.current) {
      clearInterval(analysisPollRef.current);
      analysisPollRef.current = null;
    }
  }, [detail]);

  // Auto-scroll terminal
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [liveLines]);

  const renderRawOutput = () => {
    if (liveLines.length > 0) return liveLines;
    if (!detail) return [];
    const raw = detail.rawOutput as { text?: string; output?: string };
    const body = raw?.text ?? raw?.output;
    if (body) return body.split("\n");
    return [];
  };

  const outputLines = renderRawOutput();
  const hasFindings = (detail?.parsedFindings?.length ?? 0) > 0;
  const hasRecs = (detail?.recommendations?.length ?? 0) > 0;
  const hasScoreImpact = Object.keys(detail?.scoreImpact ?? {}).length > 0;

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent
        className="bg-[#0D1117] border-l border-[#30363D] text-[#E6EDF3] w-full sm:max-w-2xl flex flex-col p-0"
        side="right"
      >
        {/* Header */}
        <SheetHeader className="px-5 py-4 border-b border-[#21262D] flex-shrink-0">
          <SheetTitle className="text-sm font-semibold text-[#E6EDF3] text-left">Script Run Detail</SheetTitle>
          {detail && (
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <StatusBadge status={detail.status} />
              <span className="text-xs text-[#7D8590]">
                {detail.executionSource === "manual" ? "Manual run" : detail.executionSource === "customer_upload" ? "Customer upload" : "Automated run"}
              </span>
              {detail.jobId && (
                <span className="text-xs text-[#484F58] font-mono">
                  {detail.jobId.slice(0, 8)}…
                </span>
              )}
            </div>
          )}
        </SheetHeader>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {error && !loading && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3">
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}

          {detail && !loading && (
            <>
              {/* Metadata grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#161B22] border border-[#21262D] rounded-lg p-3">
                  <p className="text-[10px] font-semibold text-[#7D8590] uppercase tracking-wider mb-1">Script</p>
                  <p className="text-sm text-[#E6EDF3] font-medium">{detail.scriptTitle ?? "Unknown Script"}</p>
                </div>
                <div className="bg-[#161B22] border border-[#21262D] rounded-lg p-3">
                  <p className="text-[10px] font-semibold text-[#7D8590] uppercase tracking-wider mb-1">Customer</p>
                  <p className="text-sm text-[#E6EDF3] font-medium">{detail.customerName ?? "No customer"}</p>
                </div>
                <div className="bg-[#161B22] border border-[#21262D] rounded-lg p-3">
                  <p className="text-[10px] font-semibold text-[#7D8590] uppercase tracking-wider mb-1">Started</p>
                  <p className="text-xs text-[#C9D1D9]">{formatDateTime(detail.createdAt)}</p>
                </div>
                <div className="bg-[#161B22] border border-[#21262D] rounded-lg p-3">
                  <p className="text-[10px] font-semibold text-[#7D8590] uppercase tracking-wider mb-1">Duration</p>
                  <p className="text-xs text-[#C9D1D9]">{formatDuration(detail.createdAt, detail.completedAt)}</p>
                </div>
              </div>

              {/* Terminal output */}
              <div>
                <p className="text-xs font-semibold text-[#7D8590] uppercase tracking-wider mb-2 flex items-center gap-2">
                  Terminal Output
                  {detail.status === "running" && (
                    <span className="text-[10px] text-yellow-400 font-normal normal-case tracking-normal flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
                      Live
                    </span>
                  )}
                </p>
                <div
                  ref={terminalRef}
                  className="bg-[#0D1117] border border-[#21262D] rounded-lg p-4 font-mono text-xs overflow-y-auto"
                  style={{ height: 220, maxHeight: 220 }}
                >
                  {outputLines.length === 0 ? (
                    <span className="text-[#484F58]">
                      {detail.status === "running" ? "Waiting for output…" : "No output recorded."}
                    </span>
                  ) : (
                    outputLines.map((line, i) => (
                      <div key={i} className="text-[#E6EDF3] leading-relaxed whitespace-pre-wrap break-all">{line}</div>
                    ))
                  )}
                </div>
              </div>

              {/* AI analysis in progress indicator */}
              {detail.status === "completed" &&
               detail.executionSource === "customer_upload" &&
               !hasFindings && !hasRecs && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-[#0078D4]/10 border border-[#0078D4]/25">
                    <span className="flex h-2 w-2 rounded-full bg-[#0078D4] animate-pulse flex-shrink-0" />
                    <p className="text-xs font-medium text-[#58A6FF]">AI analyzing results…</p>
                  </div>
                  <div className="space-y-2 animate-pulse">
                    {[75, 60, 85, 50].map((w, i) => (
                      <div key={i} className="h-9 bg-[#161B22] border border-[#21262D] rounded-lg" style={{ width: `${w}%` }} />
                    ))}
                  </div>
                </div>
              )}

              {/* AI Findings */}
              {hasFindings && (
                <div>
                  <p className="text-xs font-semibold text-[#7D8590] uppercase tracking-wider mb-2">AI Findings</p>
                  <div className="space-y-2">
                    {detail.parsedFindings.map((f, i) => (
                      <div key={i} className="flex items-start gap-2.5 bg-[#161B22] border border-[#21262D] rounded-lg px-3 py-2.5">
                        <span className="text-blue-400 flex-shrink-0 mt-0.5">•</span>
                        <span className="text-xs text-[#C9D1D9] leading-relaxed">{f}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {hasRecs && (
                <div>
                  <p className="text-xs font-semibold text-[#7D8590] uppercase tracking-wider mb-2">Recommendations</p>
                  <div className="space-y-2">
                    {detail.recommendations.map((r, i) => (
                      <div key={i} className="flex items-start gap-2.5 bg-[#161B22] border border-[#21262D] rounded-lg px-3 py-2.5">
                        <span className="text-green-400 flex-shrink-0 mt-0.5">→</span>
                        <span className="text-xs text-[#C9D1D9] leading-relaxed">{r}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Score Impact */}
              {hasScoreImpact && (
                <div>
                  <p className="text-xs font-semibold text-[#7D8590] uppercase tracking-wider mb-2">Score Impact</p>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(detail.scoreImpact).map(([key, val]) => (
                      <div key={key} className="bg-[#161B22] border border-[#21262D] rounded-lg px-3 py-2 flex items-center justify-between">
                        <span className="text-xs text-[#8B949E] capitalize">{key.replace(/_/g, " ")}</span>
                        <span className={`text-xs font-bold ${val > 0 ? "text-green-400" : val < 0 ? "text-red-400" : "text-[#7D8590]"}`}>
                          {val > 0 ? "+" : ""}{val}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!hasFindings && !hasRecs && detail.status !== "running" &&
               !(detail.status === "completed" && detail.executionSource === "customer_upload") && (
                <p className="text-xs text-[#484F58] italic">No AI findings were generated for this run.</p>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Sort types ───────────────────────────────────────────────────────────────

type SortKey = "createdAt" | "customerName";
type SortDir = "asc" | "desc";

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function RunningScriptsPage() {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const search = useSearch();

  const [rows, setRows] = useState<ScriptRunRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);

  // Filters — pre-populate customerId from URL search param (e.g. ?customerId=42)
  const [filterCustomerId, setFilterCustomerId] = useState<string>(() => {
    const params = new URLSearchParams(search);
    return params.get("customerId") ?? "";
  });
  const [filterStatus, setFilterStatus] = useState<string>("");

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Detail panel
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);

  // Delete tracking
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());

  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleDelete = useCallback(async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (deletingIds.has(id)) return;
    setDeletingIds(prev => new Set(prev).add(id));
    try {
      const res = await fetchWithAuth(`/api/admin/script-runs/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setRows(prev => prev.filter(r => r.id !== id));
      if (selectedRunId === id) setSelectedRunId(null);
      toast({ title: "Script result deleted" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Delete failed", variant: "destructive" });
    } finally {
      setDeletingIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    }
  }, [deletingIds, fetchWithAuth, selectedRunId, toast]);

  const fetchRuns = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterCustomerId) params.set("customerId", filterCustomerId);
      if (filterStatus) params.set("status", filterStatus);
      const res = await fetchWithAuth(`/api/admin/script-runs?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as ScriptRunRow[];
      setRows(data);

      // Populate customer dropdown from unique customers in results
      const seen = new Map<number, string | null>();
      for (const r of data) {
        if (r.customerId && !seen.has(r.customerId)) {
          seen.set(r.customerId, r.customerName);
        }
      }
      setCustomers(Array.from(seen.entries()).map(([id, name]) => ({ id, name })));
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Failed to load runs", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, toast, filterCustomerId, filterStatus]);

  // Initial + filter-driven load
  useEffect(() => {
    setLoading(true);
    void fetchRuns();
  }, [fetchRuns]);

  // Auto-poll when any row is running
  useEffect(() => {
    const hasRunning = rows.some(r => r.status === "running");
    if (hasRunning) {
      if (!pollTimerRef.current) {
        pollTimerRef.current = setInterval(() => void fetchRuns(), 5000);
      }
    } else {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    }
    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [rows, fetchRuns]);

  // Sorting
  const sorted = [...rows].sort((a, b) => {
    if (sortKey === "createdAt") {
      const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return sortDir === "asc" ? diff : -diff;
    }
    if (sortKey === "customerName") {
      const nameA = (a.customerName ?? "").toLowerCase();
      const nameB = (b.customerName ?? "").toLowerCase();
      const cmp = nameA.localeCompare(nameB);
      return sortDir === "asc" ? cmp : -cmp;
    }
    return 0;
  });

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) {
      return (
        <svg className="w-3 h-3 text-[#484F58]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      );
    }
    return sortDir === "asc" ? (
      <svg className="w-3 h-3 text-[#58A6FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
      </svg>
    ) : (
      <svg className="w-3 h-3 text-[#58A6FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      </svg>
    );
  }

  const hasRunning = rows.some(r => r.status === "running");

  return (
    <div className="p-6 space-y-5">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-[#E6EDF3]">Script Run History</h3>
          <p className="text-xs text-[#7D8590] mt-0.5">All PowerShell executions — click any row to view full output and AI analysis</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {hasRunning && (
            <span className="text-xs text-yellow-400 font-medium flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
              Live — refreshing every 5s
            </span>
          )}
          <button
            onClick={() => { setLoading(true); void fetchRuns(); }}
            className="flex items-center gap-1.5 text-xs font-medium text-[#7D8590] hover:text-[#E6EDF3] px-3 py-1.5 border border-[#30363D] rounded-lg hover:bg-[#1C2128] transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>
      </div>

      {/* Dev Seed Panel — only visible in development */}
      {import.meta.env.DEV && (
        <DevSeedPanel onSeeded={() => { setLoading(true); void fetchRuns(); }} />
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-1.5 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/50 transition-colors"
        >
          <option value="">All statuses</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="awaiting_upload">Awaiting Upload</option>
        </select>

        <select
          value={filterCustomerId}
          onChange={e => setFilterCustomerId(e.target.value)}
          className="bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-1.5 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/50 transition-colors"
        >
          <option value="">All customers</option>
          {customers.map(c => (
            <option key={c.id} value={String(c.id)}>{c.name ?? `Customer #${c.id}`}</option>
          ))}
        </select>

        {(filterStatus || filterCustomerId) && (
          <button
            onClick={() => { setFilterStatus(""); setFilterCustomerId(""); }}
            className="text-xs text-[#7D8590] hover:text-[#E6EDF3] transition-colors"
          >
            Clear filters
          </button>
        )}

        <span className="ml-auto text-xs text-[#484F58]">
          {loading ? "Loading…" : `${sorted.length} run${sorted.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="w-6 h-6 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <svg className="w-10 h-10 text-[#30363D] mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <p className="text-sm font-medium text-[#7D8590]">No script runs found</p>
          <p className="text-xs text-[#484F58] mt-1">Run a script from M365 Scripts to see history here.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-[#21262D] overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-[#161B22] border-b border-[#21262D]">
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#7D8590] uppercase tracking-wider">
                  Script Name
                </th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#7D8590] uppercase tracking-wider">
                  <button
                    onClick={() => toggleSort("customerName")}
                    className="flex items-center gap-1.5 hover:text-[#E6EDF3] transition-colors"
                  >
                    Customer <SortIcon col="customerName" />
                  </button>
                </th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#7D8590] uppercase tracking-wider">
                  Status
                </th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#7D8590] uppercase tracking-wider">
                  Source
                </th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#7D8590] uppercase tracking-wider">
                  <button
                    onClick={() => toggleSort("createdAt")}
                    className="flex items-center gap-1.5 hover:text-[#E6EDF3] transition-colors"
                  >
                    Started At <SortIcon col="createdAt" />
                  </button>
                </th>
                <th className="text-left px-4 py-2.5 text-[10px] font-semibold text-[#7D8590] uppercase tracking-wider">
                  Duration
                </th>
                <th className="px-4 py-2.5 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#21262D]">
              {sorted.map(run => (
                <tr
                  key={run.id}
                  onClick={() => setSelectedRunId(run.id)}
                  className="bg-[#0D1117] hover:bg-[#161B22] cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <span className="font-medium text-[#E6EDF3]">
                      {run.scriptTitle ?? <span className="text-[#484F58] italic">Unknown script</span>}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#8B949E]">
                    {run.customerName ?? <span className="text-[#484F58]">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="px-4 py-3">
                    {run.executionSource === "automated" ? (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border bg-purple-500/10 text-purple-400 border-purple-500/20">
                        Automated
                      </span>
                    ) : run.executionSource === "customer_upload" ? (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border bg-teal-500/10 text-teal-400 border-teal-500/20">
                        Customer Script
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full border bg-[#1C2128] text-[#7D8590] border-[#30363D]">
                        Manual
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[#8B949E] whitespace-nowrap">
                    {formatDateTime(run.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-[#8B949E]">
                    {formatDuration(run.createdAt, run.completedAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={e => void handleDelete(e, run.id)}
                      disabled={deletingIds.has(run.id)}
                      title="Delete this result"
                      className="p-1.5 rounded text-[#484F58] hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail sheet */}
      {selectedRunId !== null && (
        <DetailSheet
          runId={selectedRunId}
          onClose={() => setSelectedRunId(null)}
          fetchWithAuth={fetchWithAuth}
        />
      )}
    </div>
  );
}
