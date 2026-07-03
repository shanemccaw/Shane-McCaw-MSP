import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { format } from "date-fns";
import RunDetailContent, { WfRunDetail, STATUS_STYLES, fmtDuration } from "./RunDetailContent";

interface PendingApproval {
  id: number;
  nodeId: string;
  approverRole: string;
  timeoutSeconds: number;
  status: string;
  expiresAt: string | null;
  createdAt: string;
  context: Record<string, unknown>;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function RunDetailPage({ runId }: { runId: number }) {
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const qc = useQueryClient();

  const [rejectNote, setRejectNote] = useState("");
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [pendingDecisionId, setPendingDecisionId] = useState<number | null>(null);

  const { data: run, isLoading } = useQuery<WfRunDetail>({
    queryKey: ["wf-run", runId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/runs/${runId}`);
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "pending" || status === "awaiting_approval" ? 3000 : false;
    },
  });

  const { data: pendingApprovals = [] } = useQuery<PendingApproval[]>({
    queryKey: ["wf-run-approvals", runId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/pending-approvals`);
      if (!res.ok) return [];
      const all: PendingApproval[] = await res.json();
      return all.filter((a: PendingApproval & { runId?: number; run_id?: number }) =>
        (a as unknown as { runId: number }).runId === runId ||
        (a as unknown as { run_id: number }).run_id === runId
      );
    },
    enabled: run?.status === "awaiting_approval",
    refetchInterval: run?.status === "awaiting_approval" ? 5000 : false,
  });

  const cancelMut = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/runs/${runId}/cancel`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to cancel");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wf-run", runId] }),
  });

  const decideMut = useMutation({
    mutationFn: async ({ approvalId, decision, note }: { approvalId: number; decision: "approved" | "rejected"; note?: string }) => {
      const res = await fetchWithAuth(`/api/admin/workflows/pending-approvals/${approvalId}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note }),
      });
      if (!res.ok) throw new Error("Failed to submit decision");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wf-run", runId] });
      qc.invalidateQueries({ queryKey: ["wf-run-approvals", runId] });
      setShowRejectModal(false);
      setRejectNote("");
      setPendingDecisionId(null);
    },
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
              {run.status === "awaiting_approval" ? "⏸ awaiting approval" : run.status}
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

      {/* Awaiting Approval Banner */}
      {run.status === "awaiting_approval" && pendingApprovals.length > 0 && (
        <div className="flex-shrink-0 mx-6 mt-4 rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-yellow-300 text-lg">⏸</span>
            <div>
              <p className="text-sm font-semibold text-yellow-200">Approval Required</p>
              <p className="text-xs text-yellow-400/70">
                This run is paused and requires admin approval to continue.
                {pendingApprovals[0]?.expiresAt && (
                  <> Auto-rejects at {format(new Date(pendingApprovals[0].expiresAt), "MMM d, HH:mm:ss")}</>
                )}
              </p>
            </div>
          </div>
          {pendingApprovals.map(approval => (
            <div key={approval.id} className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-yellow-300/70 font-mono">Gate: {approval.nodeId.slice(0, 12)}…</span>
              <div className="flex gap-2">
                <button
                  onClick={() => decideMut.mutate({ approvalId: approval.id, decision: "approved" })}
                  disabled={decideMut.isPending}
                  className="px-3 py-1.5 bg-emerald-600/80 hover:bg-emerald-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
                >
                  ✓ Approve
                </button>
                <button
                  onClick={() => { setPendingDecisionId(approval.id); setShowRejectModal(true); }}
                  disabled={decideMut.isPending}
                  className="px-3 py-1.5 bg-red-600/80 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors"
                >
                  ✕ Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tab content — RunDetailContent handles its own tabs, polling, error banner */}
      <div className="flex-1 overflow-hidden">
        <RunDetailContent runId={runId} />
      </div>

      {/* Reject Modal */}
      {showRejectModal && pendingDecisionId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-6 w-full max-w-md space-y-4">
            <h2 className="text-base font-bold text-[#E6EDF3]">Reject Approval</h2>
            <p className="text-sm text-[#7D8590]">
              This will fail the workflow run. Optionally provide a reason.
            </p>
            <textarea
              value={rejectNote}
              onChange={e => setRejectNote(e.target.value)}
              placeholder="Reason for rejection (optional)"
              rows={3}
              className="w-full bg-[#0D1117] border border-[#30363D] rounded-lg px-3 py-2 text-sm text-[#E6EDF3] outline-none focus:border-red-500/60 placeholder-[#484F58] resize-none"
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setShowRejectModal(false); setRejectNote(""); setPendingDecisionId(null); }}
                className="px-4 py-2 bg-[#1C2128] hover:bg-[#30363D] text-[#E6EDF3] text-sm rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => decideMut.mutate({ approvalId: pendingDecisionId, decision: "rejected", note: rejectNote || undefined })}
                disabled={decideMut.isPending}
                className="px-4 py-2 bg-red-600/80 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                {decideMut.isPending ? "Rejecting…" : "Reject Run"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
