import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { ClipboardList, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";

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
  profileUpdates: Record<string, unknown>;
  status: "running" | "completed" | "failed";
  createdAt: string;
  scriptName: string | null;
  clientName: string | null;
  packageName: string | null;
}

interface FilterState {
  clientId: string;
  scriptId: string;
  status: string;
  dateFrom: string;
  dateTo: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(d: string): string {
  return new Date(d).toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

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
  running:   { cls: "bg-yellow-500/15 text-yellow-400 border-yellow-500/25",  label: "Running"   },
  completed: { cls: "bg-green-500/15 text-green-400 border-green-500/25",     label: "Completed" },
  failed:    { cls: "bg-red-500/15 text-red-400 border-red-500/25",           label: "Failed"    },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] ?? { cls: "bg-[#30363D] text-[#7D8590] border-[#30363D]", label: status };
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${cfg.cls}`}>
      {status === "running" && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />}
      {cfg.label}
    </span>
  );
}

// ── Score Impact mini chart ───────────────────────────────────────────────────

const SCORE_KEYS = ["identity", "security", "collaboration", "compliance", "copilotReadiness"] as const;
const SCORE_LABELS: Record<string, string> = {
  identity: "Identity",
  security: "Security",
  collaboration: "Collab",
  compliance: "Compliance",
  copilotReadiness: "Copilot",
};

function ScoreImpactChart({ scoreImpact }: { scoreImpact: Record<string, number> }) {
  const entries = SCORE_KEYS
    .filter(k => scoreImpact[k] !== undefined && scoreImpact[k] !== 0)
    .map(k => ({ key: k, delta: scoreImpact[k] }));

  if (entries.length === 0) {
    return <p className="text-xs text-[#484F58] italic">No score changes</p>;
  }

  return (
    <div className="space-y-2">
      {entries.map(({ key, delta }) => (
        <div key={key} className="flex items-center gap-3">
          <span className="text-[10px] text-[#7D8590] w-20 flex-shrink-0">{SCORE_LABELS[key]}</span>
          <div className="flex-1 h-2 bg-[#1C2128] rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${delta >= 0 ? "bg-green-400" : "bg-red-400"}`}
              style={{ width: `${Math.min(Math.abs(delta), 100)}%` }}
            />
          </div>
          <span className={`text-xs font-bold w-12 text-right flex-shrink-0 ${delta >= 0 ? "text-green-400" : "text-red-400"}`}>
            {delta >= 0 ? "+" : ""}{delta}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Expanded Row ──────────────────────────────────────────────────────────────

function ExpandedRow({ result }: { result: RunResult }) {
  const [subTab, setSubTab] = useState<"raw" | "findings">("findings");

  const rawOutput = typeof result.rawOutput?.output === "string"
    ? result.rawOutput.output
    : JSON.stringify(result.rawOutput, null, 2);

  const profileJson = Object.keys(result.profileUpdates).length > 0
    ? JSON.stringify(result.profileUpdates, null, 2)
    : null;

  return (
    <div className="px-4 pb-4 pt-2 bg-[#0D1117] border-t border-[#21262D]">
      {/* Sub-tabs */}
      <div className="flex gap-1 mb-4">
        {(["findings", "raw"] as const).map(t => (
          <button
            key={t}
            onClick={() => setSubTab(t)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              subTab === t
                ? "bg-[#0078D4]/15 text-[#0078D4] border border-[#0078D4]/30"
                : "text-[#7D8590] hover:text-[#E6EDF3] border border-transparent"
            }`}
          >
            {t === "findings" ? "AI Findings" : "Raw Output"}
          </button>
        ))}
      </div>

      {subTab === "raw" && (
        <pre className="text-[11px] text-[#7D8590] font-mono whitespace-pre-wrap leading-relaxed bg-[#161B22] border border-[#30363D] rounded-lg p-4 max-h-80 overflow-y-auto">
          {rawOutput || "(No output)"}
        </pre>
      )}

      {subTab === "findings" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Findings */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#7D8590] mb-2">Findings</p>
            {result.parsedFindings.length === 0 ? (
              <p className="text-xs text-[#484F58] italic">No findings recorded</p>
            ) : (
              <ul className="space-y-1.5">
                {result.parsedFindings.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-[#C9D1D9]">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#0078D4] flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Recommendations */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#7D8590] mb-2">Recommendations</p>
            {result.recommendations.length === 0 ? (
              <p className="text-xs text-[#484F58] italic">No recommendations</p>
            ) : (
              <ul className="space-y-1.5">
                {result.recommendations.map((r, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-[#C9D1D9]">
                    <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-green-400 flex-shrink-0" />
                    {r}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Score Impact */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#7D8590] mb-2">Score Impact</p>
            <ScoreImpactChart scoreImpact={result.scoreImpact} />
          </div>

          {/* Profile Updates */}
          {profileJson && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#7D8590] mb-2">Profile Updates</p>
              <pre className="text-[10px] text-[#7D8590] font-mono bg-[#161B22] border border-[#30363D] rounded-lg p-3 max-h-40 overflow-y-auto whitespace-pre-wrap">
                {profileJson}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Unique value sets for filters ─────────────────────────────────────────────

function uniqueValues<T extends RunResult, K extends keyof T>(
  rows: T[],
  key: K,
  labelKey?: keyof T,
): Array<{ value: string; label: string }> {
  const seen = new Map<string, string>();
  for (const r of rows) {
    const v = r[key];
    if (v !== null && v !== undefined) {
      const label = labelKey ? String(r[labelKey] ?? v) : String(v);
      seen.set(String(v), label);
    }
  }
  return Array.from(seen.entries()).map(([value, label]) => ({ value, label }));
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function M365RunResultsPage() {
  const { fetchWithAuth } = useAuth();
  const [results, setResults] = useState<RunResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    clientId: "",
    scriptId: "",
    status: "",
    dateFrom: "",
    dateTo: "",
  });

  const load = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    try {
      const res = await fetchWithAuth("/api/admin/script-run-results?limit=200");
      if (res.ok) {
        const data = await res.json() as RunResult[];
        setResults(data);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => { void load(); }, [load]);

  // Filtered results
  const filtered = results.filter(r => {
    if (filters.clientId && String(r.customerId) !== filters.clientId) return false;
    if (filters.scriptId && String(r.scriptId) !== filters.scriptId) return false;
    if (filters.status && r.status !== filters.status) return false;
    if (filters.dateFrom && new Date(r.createdAt) < new Date(filters.dateFrom)) return false;
    if (filters.dateTo) {
      const to = new Date(filters.dateTo);
      to.setHours(23, 59, 59, 999);
      if (new Date(r.createdAt) > to) return false;
    }
    return true;
  });

  const clientOptions = uniqueValues(results, "customerId", "clientName");
  const scriptOptions = uniqueValues(results, "scriptId", "scriptName");

  const clearFilters = () => setFilters({ clientId: "", scriptId: "", status: "", dateFrom: "", dateTo: "" });
  const hasFilters = Object.values(filters).some(Boolean);

  if (loading) return (
    <div className="p-6 max-w-5xl mx-auto space-y-4">
      <div className="h-8 bg-[#161B22] rounded w-48 animate-pulse" />
      <div className="space-y-2">
        {[1, 2, 3, 4].map(i => <div key={i} className="h-14 bg-[#161B22] rounded-lg animate-pulse" />)}
      </div>
    </div>
  );

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#E6EDF3]">Run Results</h1>
          <p className="text-sm text-[#7D8590] mt-0.5">Post-run stored results for all M365 Command Center script executions</p>
        </div>
        <button
          onClick={() => void load(true)}
          disabled={refreshing}
          className="flex items-center gap-2 text-sm font-semibold text-[#0078D4] border border-[#0078D4]/30 hover:border-[#0078D4] hover:bg-[#0078D4]/10 rounded-lg px-3 py-2 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[#7D8590] mb-1">Client</label>
            <select
              className="w-full border border-[#30363D] rounded-lg px-2.5 py-1.5 text-xs text-[#E6EDF3] bg-[#0D1117] focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40"
              value={filters.clientId}
              onChange={e => setFilters(f => ({ ...f, clientId: e.target.value }))}
            >
              <option value="">All clients</option>
              {clientOptions.map(o => (
                <option key={o.value} value={o.value}>{o.label ?? `Client ${o.value}`}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[#7D8590] mb-1">Script</label>
            <select
              className="w-full border border-[#30363D] rounded-lg px-2.5 py-1.5 text-xs text-[#E6EDF3] bg-[#0D1117] focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40"
              value={filters.scriptId}
              onChange={e => setFilters(f => ({ ...f, scriptId: e.target.value }))}
            >
              <option value="">All scripts</option>
              {scriptOptions.map(o => (
                <option key={o.value} value={o.value}>{o.label ?? `Script ${o.value}`}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[#7D8590] mb-1">Status</label>
            <select
              className="w-full border border-[#30363D] rounded-lg px-2.5 py-1.5 text-xs text-[#E6EDF3] bg-[#0D1117] focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40"
              value={filters.status}
              onChange={e => setFilters(f => ({ ...f, status: e.target.value }))}
            >
              <option value="">All statuses</option>
              <option value="running">Running</option>
              <option value="completed">Completed</option>
              <option value="failed">Failed</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[#7D8590] mb-1">From</label>
            <input
              type="date"
              className="w-full border border-[#30363D] rounded-lg px-2.5 py-1.5 text-xs text-[#E6EDF3] bg-[#0D1117] focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40"
              value={filters.dateFrom}
              onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[#7D8590] mb-1">To</label>
            <input
              type="date"
              className="w-full border border-[#30363D] rounded-lg px-2.5 py-1.5 text-xs text-[#E6EDF3] bg-[#0D1117] focus:outline-none focus:ring-2 focus:ring-[#0078D4]/40"
              value={filters.dateTo}
              onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))}
            />
          </div>
        </div>
        {hasFilters && (
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#30363D]">
            <span className="text-xs text-[#7D8590]">
              Showing {filtered.length} of {results.length} results
            </span>
            <button
              onClick={clearFilters}
              className="text-xs text-[#0078D4] hover:text-[#1A90E0] font-medium transition-colors"
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      {/* Results table */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <ClipboardList className="w-10 h-10 text-[#30363D] mx-auto mb-3" />
          <p className="text-[#7D8590] text-sm">
            {hasFilters ? "No results match your filters" : "No script runs recorded yet"}
          </p>
          <p className="text-[#484F58] text-xs mt-1">
            {hasFilters ? "Try adjusting the filters above" : "Run a package or individual script to see results here"}
          </p>
        </div>
      ) : (
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#30363D]">
                <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#7D8590]">Client</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#7D8590]">Script</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#7D8590] hidden md:table-cell">Package</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#7D8590] hidden lg:table-cell">Ran</th>
                <th className="text-left px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-[#7D8590]">Status</th>
                <th className="px-4 py-3 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#21262D]">
              {filtered.map(r => {
                const isExpanded = expandedId === r.id;
                return [
                  <tr
                    key={r.id}
                    onClick={() => setExpandedId(isExpanded ? null : r.id)}
                    className="hover:bg-[#1C2128] transition-colors cursor-pointer group"
                  >
                    <td className="px-4 py-3">
                      <span className="font-medium text-[#E6EDF3]">
                        {r.clientName ?? (r.customerId ? `Client #${r.customerId}` : <span className="text-[#484F58] italic">No client</span>)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[#C9D1D9]">{r.scriptName ?? `Script #${r.scriptId}`}</span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      <span className="text-xs text-[#7D8590]">
                        {r.packageName ?? (r.packageId ? `Package #${r.packageId}` : <span className="italic text-[#484F58]">—</span>)}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      <span className="text-xs text-[#7D8590]" title={formatDate(r.createdAt)}>
                        {formatRelative(r.createdAt)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-3">
                      {isExpanded
                        ? <ChevronUp className="w-4 h-4 text-[#7D8590]" />
                        : <ChevronDown className="w-4 h-4 text-[#484F58] group-hover:text-[#7D8590]" />
                      }
                    </td>
                  </tr>,
                  isExpanded && (
                    <tr key={`${r.id}-expanded`}>
                      <td colSpan={6} className="p-0">
                        <ExpandedRow result={r} />
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>

          <div className="px-4 py-3 border-t border-[#30363D] flex items-center justify-between">
            <span className="text-xs text-[#484F58]">
              {filtered.length} result{filtered.length !== 1 ? "s" : ""}
              {hasFilters && ` (filtered from ${results.length})`}
            </span>
            <span className="text-[10px] text-[#484F58]">Click a row to expand findings</span>
          </div>
        </div>
      )}
    </div>
  );
}
