import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { format, formatDistanceToNow } from "date-fns";

interface WfRun {
  id: number;
  definitionId: number;
  definitionName: string | null;
  isSystem: boolean;
  versionLabel: string | null;
  triggerType: string;
  triggerRef: string | null;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  durationMs: number | null;
  startedAt: string | null;
  createdAt: string;
}

const STATUS_STYLES: Record<string, string> = {
  completed: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  running:   "bg-blue-500/20 text-blue-300 border-blue-500/30",
  failed:    "bg-red-500/20 text-red-400 border-red-500/30",
  pending:   "bg-amber-500/20 text-amber-400 border-amber-500/30",
  cancelled: "bg-[#30363D] text-[#7D8590] border-[#30363D]",
};

const TRIGGER_ICONS: Record<string, string> = {
  manual:   "🖱",
  schedule: "📅",
  webhook:  "🔗",
  event:    "📡",
};

function StatusChip({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${STATUS_STYLES[status] ?? "bg-[#1C2128] text-[#7D8590] border-[#30363D]"}`}>
      {status}
    </span>
  );
}

function fmtDuration(ms: number | null): string {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

const GRID = "grid grid-cols-[2rem_1fr_8rem_7rem_6rem_6rem_5rem] gap-4";

function RunRow({ run, onClick }: { run: WfRun; onClick: () => void }) {
  return (
    <div
      className={`${GRID} px-4 py-3 border-b border-[#30363D]/50 hover:bg-[#1C2128] transition-colors cursor-pointer items-center`}
      onClick={onClick}
    >
      <span className="text-xs text-[#484F58] font-mono">{run.id}</span>

      <div className="min-w-0">
        <p className="text-sm font-medium text-[#E6EDF3] truncate">{run.definitionName ?? "—"}</p>
        {run.versionLabel && (
          <p className="text-[10px] text-[#484F58] truncate">{run.versionLabel}</p>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-sm">
          <span className="mr-1">{TRIGGER_ICONS[run.triggerType] ?? "•"}</span>
          <span className="text-xs text-[#7D8590] capitalize">{run.triggerType}</span>
        </span>
        {run.triggerRef === "draft_test" && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 uppercase tracking-wider">Draft</span>
        )}
      </div>

      <StatusChip status={run.status} />

      <span className="text-xs text-[#7D8590]">
        {run.startedAt ? formatDistanceToNow(new Date(run.startedAt), { addSuffix: true }) : format(new Date(run.createdAt), "MMM d HH:mm")}
      </span>

      <span className="text-xs text-[#7D8590] font-mono">{fmtDuration(run.durationMs)}</span>

      <svg className="w-4 h-4 text-[#484F58]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </div>
  );
}

export default function RunHistoryPage({ initialDefinitionId }: { initialDefinitionId?: number }) {
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const [defIdFilter, setDefIdFilter] = useState(initialDefinitionId ?? 0);
  const [statusFilter, setStatusFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [offset, setOffset] = useState(0);
  const [systemExpanded, setSystemExpanded] = useState(false);
  const limit = 30;

  const params = new URLSearchParams();
  if (defIdFilter) params.set("definitionId", String(defIdFilter));
  if (statusFilter) params.set("status", statusFilter);
  if (fromDate) params.set("from", fromDate);
  if (toDate)   params.set("to",   toDate);
  params.set("limit", String(limit));
  params.set("offset", String(offset));

  const { data, isLoading } = useQuery<{ runs: WfRun[]; total: number }>({
    queryKey: ["wf-runs", defIdFilter, statusFilter, fromDate, toDate, offset],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/runs?${params}`);
      if (!res.ok) throw new Error("Failed to load runs");
      return res.json();
    },
  });

  const { data: defs = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ["wf-definitions"],
    queryFn: async () => {
      const res = await fetchWithAuth("/api/admin/workflows/definitions");
      return res.json();
    },
  });

  const allRuns = data?.runs ?? [];
  const total = data?.total ?? 0;

  const userRuns = allRuns.filter(r => !r.isSystem);
  const systemRuns = allRuns.filter(r => r.isSystem);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto space-y-6">

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#E6EDF3]">Run History</h1>
            <p className="text-sm text-[#7D8590] mt-0.5">{total} total runs</p>
          </div>
          <button
            onClick={() => navigate("/workflows/list")}
            className="text-xs text-[#7D8590] hover:text-[#E6EDF3] flex items-center gap-1.5 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            All Workflows
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={defIdFilter}
            onChange={e => { setDefIdFilter(Number(e.target.value)); setOffset(0); }}
            className="bg-[#161B22] border border-[#30363D] rounded-lg px-3 py-1.5 text-sm text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
          >
            <option value={0}>All Workflows</option>
            {defs.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setOffset(0); }}
            className="bg-[#161B22] border border-[#30363D] rounded-lg px-3 py-1.5 text-sm text-[#E6EDF3] outline-none focus:border-[#0078D4]/60"
          >
            <option value="">All Statuses</option>
            <option value="completed">Completed</option>
            <option value="running">Running</option>
            <option value="failed">Failed</option>
            <option value="pending">Pending</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[#484F58]">From</span>
            <input
              type="date"
              value={fromDate}
              onChange={e => { setFromDate(e.target.value); setOffset(0); }}
              className="bg-[#161B22] border border-[#30363D] rounded-lg px-2 py-1.5 text-sm text-[#E6EDF3] outline-none focus:border-[#0078D4]/60 [color-scheme:dark]"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-[#484F58]">To</span>
            <input
              type="date"
              value={toDate}
              onChange={e => { setToDate(e.target.value); setOffset(0); }}
              className="bg-[#161B22] border border-[#30363D] rounded-lg px-2 py-1.5 text-sm text-[#E6EDF3] outline-none focus:border-[#0078D4]/60 [color-scheme:dark]"
            />
          </div>
          {(fromDate || toDate) && (
            <button
              onClick={() => { setFromDate(""); setToDate(""); setOffset(0); }}
              className="text-xs text-[#484F58] hover:text-[#E6EDF3] transition-colors"
            >
              Clear dates
            </button>
          )}
        </div>

        {/* Table header */}
        <div className="bg-[#161B22] border border-[#30363D] rounded-xl overflow-hidden">
          <div className={`${GRID} px-4 py-2.5 border-b border-[#30363D] text-xs font-semibold text-[#484F58] uppercase tracking-wider`}>
            <span>#</span>
            <span>Workflow</span>
            <span>Trigger</span>
            <span>Status</span>
            <span>Started</span>
            <span>Duration</span>
            <span></span>
          </div>

          {isLoading ? (
            <div className="space-y-px">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-12 bg-[#0D1117]/40 animate-pulse" />
              ))}
            </div>
          ) : allRuns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <p className="text-[#7D8590] font-medium">No runs yet</p>
              <p className="text-sm text-[#484F58] mt-1">Trigger a workflow manually or via a schedule.</p>
            </div>
          ) : (
            <>
              {/* User workflow runs */}
              {userRuns.map(run => (
                <RunRow key={run.id} run={run} onClick={() => navigate(`/workflows/runs/${run.id}`)} />
              ))}

              {/* System runs — collapsed by default */}
              {systemRuns.length > 0 && (
                <>
                  <button
                    onClick={() => setSystemExpanded(v => !v)}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 border-b border-[#30363D]/50 hover:bg-[#1C2128] transition-colors text-left"
                  >
                    <svg
                      className={`w-3 h-3 text-[#484F58] transition-transform flex-shrink-0 ${systemExpanded ? "rotate-90" : ""}`}
                      fill="none" stroke="currentColor" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    <svg className="w-3.5 h-3.5 text-violet-400/70 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span className="text-xs font-semibold text-[#484F58]">System runs</span>
                    <span className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#21262D] border border-[#30363D] text-[10px] font-bold text-[#7D8590]">
                      {systemRuns.length}
                    </span>
                  </button>

                  {systemExpanded && systemRuns.map(run => (
                    <RunRow key={run.id} run={run} onClick={() => navigate(`/workflows/runs/${run.id}`)} />
                  ))}
                </>
              )}
            </>
          )}
        </div>

        {/* Pagination */}
        {total > limit && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#7D8590]">
              Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setOffset(o => Math.max(0, o - limit))}
                disabled={offset === 0}
                className="px-3 py-1.5 text-xs bg-[#161B22] border border-[#30363D] text-[#7D8590] disabled:opacity-40 rounded-lg hover:text-[#E6EDF3] transition-colors"
              >
                Previous
              </button>
              <button
                onClick={() => setOffset(o => o + limit)}
                disabled={offset + limit >= total}
                className="px-3 py-1.5 text-xs bg-[#161B22] border border-[#30363D] text-[#7D8590] disabled:opacity-40 rounded-lg hover:text-[#E6EDF3] transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
