import { useState, useEffect, useCallback, Fragment } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { ClipboardList, ChevronDown, ChevronUp, RefreshCw, CheckCircle, Zap } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface RunResult {
  id: number;
  customerId: number | null;
  scriptId: number;
  packageId: number | null;
  jobId: string | null;
  rawOutput: Record<string, unknown>;
  parsedFindings: string[];
  recommendations: string[];
  scoreImpact: Record<string, number>;
  status: "running" | "completed" | "failed" | "awaiting_upload";
  executionSource: "automated" | "manual";
  uploadedBy: string | null;
  uploadedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  scriptName: string | null;
  clientName: string | null;
  packageName: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatRelative(d: string): string {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const STATUS_CFG: Record<string, { cls: string; label: string }> = {
  running:         { cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25",  label: "Running"         },
  completed:       { cls: "bg-green-500/15 text-green-400 border-green-500/25",     label: "Completed"       },
  failed:          { cls: "bg-red-500/15 text-red-400 border-red-500/25",           label: "Failed"          },
  awaiting_upload: { cls: "bg-amber-500/15 text-amber-400 border-amber-500/25",     label: "Awaiting Upload" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? { cls: "bg-[#30363D] text-[#7D8590] border-[#30363D]", label: status };
  return (
    <span className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${cfg.cls}`}>
      {(status === "running" || status === "awaiting_upload") && <span className="w-1 h-1 rounded-full bg-current animate-pulse" />}
      {cfg.label}
    </span>
  );
}

// ── Expanded row (compact sidebar version) ────────────────────────────────────

function ExpandedRow({ result, onMarkReviewed }: { result: RunResult; onMarkReviewed: (id: number, reviewedAt: string) => void }) {
  const { fetchWithAuth } = useAuth();
  const { toast } = useToast();
  const [applying, setApplying] = useState(false);
  const [marking, setMarking] = useState(false);
  const [subTab, setSubTab] = useState<"findings" | "json">("findings");

  const hasImpact = Object.values(result.scoreImpact).some(v => v !== 0);

  const handleApplyToClient = async () => {
    if (!result.customerId) return;
    setApplying(true);
    try {
      const res = await fetchWithAuth(`/api/admin/script-run-results/${result.id}/apply-to-client`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        toast({ title: err.error ?? "Failed to apply scores", variant: "destructive" });
        return;
      }
      const data = await res.json() as { appliedScores: number; appliedProfileFields: number };
      toast({ title: "Scores applied", description: `${data.appliedScores} score categories updated.` });
    } catch {
      toast({ title: "Failed to apply scores", variant: "destructive" });
    } finally {
      setApplying(false);
    }
  };

  const handleMarkReviewed = async () => {
    setMarking(true);
    try {
      const res = await fetchWithAuth(`/api/admin/script-run-results/${result.id}/mark-reviewed`, { method: "PATCH" });
      if (!res.ok) { toast({ title: "Failed to mark as reviewed", variant: "destructive" }); return; }
      const data = await res.json() as { reviewedAt: string };
      toast({ title: "Marked as reviewed" });
      onMarkReviewed(result.id, data.reviewedAt);
    } catch {
      toast({ title: "Failed to mark as reviewed", variant: "destructive" });
    } finally {
      setMarking(false);
    }
  };

  return (
    <div className="px-3 pb-3 pt-2 bg-[#0D1117] border-t border-[#21262D] space-y-2">
      <div className="flex gap-1">
        {(["findings", "json"] as const).map(t => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors ${
              subTab === t
                ? "bg-[#0078D4]/15 text-[#0078D4] border border-[#0078D4]/30"
                : "text-[#7D8590] hover:text-[#E6EDF3] border border-transparent"
            }`}
          >
            {t === "findings" ? "AI Findings" : "JSON"}
          </button>
        ))}
      </div>

      {subTab === "findings" && (
        <div className="space-y-1.5">
          {result.parsedFindings.length === 0 ? (
            <p className="text-[10px] text-[#484F58] italic">No findings</p>
          ) : (
            result.parsedFindings.slice(0, 5).map((f, i) => (
              <p key={i} className="text-[10px] text-[#C9D1D9] leading-relaxed flex gap-1.5">
                <span className="mt-1 w-1 h-1 rounded-full bg-[#0078D4] flex-shrink-0" />
                {f}
              </p>
            ))
          )}
          {result.parsedFindings.length > 5 && (
            <p className="text-[10px] text-[#484F58]">+{result.parsedFindings.length - 5} more</p>
          )}
        </div>
      )}

      {subTab === "json" && (
        <pre className="text-[10px] text-[#7D8590] font-mono whitespace-pre-wrap bg-[#161B22] border border-[#30363D] rounded p-2 max-h-32 overflow-y-auto">
          {JSON.stringify(result.rawOutput, null, 2) || "(no data)"}
        </pre>
      )}

      <div className="flex items-center gap-2 pt-1">
        {result.customerId && hasImpact && result.status === "completed" && (
          <button
            onClick={() => void handleApplyToClient()}
            disabled={applying}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-[#0078D4] border border-[#0078D4]/30 hover:border-[#0078D4] hover:bg-[#0078D4]/10 rounded transition-colors disabled:opacity-50"
          >
            {applying ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            Apply Scores
          </button>
        )}
        {!result.reviewedAt && (
          <button
            onClick={() => void handleMarkReviewed()}
            disabled={marking}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-green-400 border border-green-500/30 hover:border-green-500 hover:bg-green-500/10 rounded transition-colors disabled:opacity-50 ml-auto"
          >
            {marking ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
            Reviewed
          </button>
        )}
      </div>
    </div>
  );
}

// ── Run Results Sidebar Panel ─────────────────────────────────────────────────

export default function RunResultsSidebarPanel() {
  const { fetchWithAuth } = useAuth();
  const [results, setResults] = useState<RunResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState("");

  const load = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true); else setLoading(true);
    try {
      const res = await fetchWithAuth("/api/admin/script-run-results?limit=100");
      if (res.ok) setResults(await res.json() as RunResult[]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { void load(); }, [load]);

  const handleMarkReviewed = (id: number, reviewedAt: string) => {
    setResults(prev => prev.map(r => r.id === id ? { ...r, reviewedAt } : r));
  };

  const filtered = statusFilter ? results.filter(r => r.status === statusFilter) : results;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#0D1117]">
      {/* Toolbar */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-[#21262D] flex-shrink-0">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="flex-1 bg-[#161B22] border border-[#30363D] rounded px-2 py-1 text-xs text-[#E6EDF3] outline-none focus:border-[#0078D4]/50"
        >
          <option value="">All statuses</option>
          <option value="running">Running</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="awaiting_upload">Awaiting Upload</option>
        </select>
        <button
          onClick={() => void load(true)}
          disabled={refreshing}
          title="Refresh"
          className="p-1.5 text-[#484F58] hover:text-[#E6EDF3] hover:bg-[#21262D] rounded transition-colors flex-shrink-0 disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${refreshing ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="w-5 h-5 border-2 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
            <ClipboardList className="w-8 h-8 text-[#21262D] mb-2" />
            <p className="text-xs text-[#484F58]">{results.length === 0 ? "No run results yet" : "No results match filter"}</p>
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div className="divide-y divide-[#21262D]">
            {filtered.map(r => {
              const isExpanded = expandedId === r.id;
              return (
                <Fragment key={r.id}>
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : r.id)}
                    className="w-full flex items-start gap-2 px-3 py-2 hover:bg-[#161B22] transition-colors text-left group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs text-[#E6EDF3] truncate font-medium">
                          {r.clientName ?? (r.customerId ? `Client #${r.customerId}` : "No client")}
                        </span>
                        <StatusBadge status={r.status} />
                      </div>
                      <p className="text-[10px] text-[#7D8590] truncate mt-0.5">
                        {r.scriptName ?? `Script #${r.scriptId}`}
                        {r.executionSource === "manual" && <span className="ml-1 text-amber-500/70">📋 Manual</span>}
                      </p>
                      <p className="text-[9px] text-[#484F58] mt-0.5">{formatRelative(r.createdAt)}</p>
                    </div>
                    <div className="flex-shrink-0 mt-0.5">
                      {isExpanded
                        ? <ChevronUp className="w-3 h-3 text-[#7D8590]" />
                        : <ChevronDown className="w-3 h-3 text-[#484F58] group-hover:text-[#7D8590]" />
                      }
                    </div>
                  </button>
                  {isExpanded && (
                    <ExpandedRow result={r} onMarkReviewed={handleMarkReviewed} />
                  )}
                </Fragment>
              );
            })}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <p className="px-3 py-2 text-[9px] text-[#484F58] border-t border-[#21262D]">
            {filtered.length} result{filtered.length !== 1 ? "s" : ""}
          </p>
        )}
      </div>
    </div>
  );
}
