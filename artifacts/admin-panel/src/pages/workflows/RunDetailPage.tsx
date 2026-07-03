import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { format } from "date-fns";
import RunDetailContent, { WfRunDetail, STATUS_STYLES, fmtDuration } from "./RunDetailContent";

// ── Main component ────────────────────────────────────────────────────────────

export default function RunDetailPage({ runId }: { runId: number }) {
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const { data: run, isLoading } = useQuery<WfRunDetail>({
    queryKey: ["wf-run", runId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/runs/${runId}`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "pending" ? 3000 : false;
    },
  });

  const cancelMut = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/runs/${runId}/cancel`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to cancel");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wf-run", runId] }),
  });

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!run) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-[#7D8590]">Run not found</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-6 py-4 border-b border-[#30363D] flex items-center gap-4">
        <button
          onClick={() => navigate("/workflows/runs")}
          className="text-[#7D8590] hover:text-[#E6EDF3] transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-[#E6EDF3]">Run #{run.id}</span>
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${STATUS_STYLES[run.status] ?? ""}`}>
              {run.status}
            </span>
            {run.triggerRef === "draft_test" && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 uppercase tracking-wider">
                Draft Run
              </span>
            )}
          </div>
          <p className="text-sm text-[#7D8590] mt-0.5 truncate">
            {run.definitionName ?? "Unknown workflow"} · {run.versionLabel ?? ""} · {run.triggerType}
            {run.startedAt && ` · ${format(new Date(run.startedAt), "MMM d, HH:mm:ss")}`}
            {run.durationMs !== null && ` · ${fmtDuration(run.durationMs)}`}
          </p>
        </div>

        {(run.status === "running" || run.status === "pending") && (
          <button
            onClick={() => cancelMut.mutate()}
            disabled={cancelMut.isPending}
            className="px-3 py-1.5 bg-red-600/80 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
          >
            Cancel Run
          </button>
        )}
      </div>

      {/* Tab content — RunDetailContent handles its own tabs, polling, error banner */}
      <div className="flex-1 overflow-hidden">
        <RunDetailContent runId={runId} />
      </div>
    </div>
  );
}
