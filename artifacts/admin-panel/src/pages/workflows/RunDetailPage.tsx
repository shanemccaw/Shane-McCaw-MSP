import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useLocation } from "wouter";
import { format } from "date-fns";
import RunDetailContent, { WfRunDetail, STATUS_STYLES, fmtDuration } from "./RunDetailContent";

const EVENT_CATALOG: Array<{ category: string; name: string }> = [
  { category: "CRM",        name: "lead.created" },
  { category: "CRM",        name: "lead.qualified" },
  { category: "CRM",        name: "opportunity.created" },
  { category: "CRM",        name: "client.created" },
  { category: "CRM",        name: "project.created" },
  { category: "CRM",        name: "project.phase_changed" },
  { category: "CRM",        name: "onboarding.complete" },
  { category: "CRM",        name: "sow.scope_reduced" },
  { category: "CRM",        name: "contract.signed" },
  { category: "Payments",   name: "payment.received" },
  { category: "Payments",   name: "agreement_signed" },
  { category: "Payments",   name: "phase_completed" },
  { category: "Scheduling", name: "phase.delivery_date_changed" },
  { category: "Scheduling", name: "milestone.delivery_date_changed" },
  { category: "M365",       name: "m365.health_check_complete" },
  { category: "M365",       name: "m365.diagnostic_failed" },
  { category: "M365",       name: "quiz.lead_submitted" },
  { category: "M365",       name: "customer.script_result" },
];

type EventCategory = "CRM" | "Payments" | "Scheduling" | "M365";

const CATEGORY_STYLES: Record<EventCategory, string> = {
  CRM:        "bg-blue-500/20 text-blue-300 border-blue-500/30",
  Payments:   "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  Scheduling: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  M365:       "bg-violet-500/20 text-violet-300 border-violet-500/30",
};

function getEventCategory(eventName: string): EventCategory | null {
  return (EVENT_CATALOG.find(e => e.name === eventName)?.category as EventCategory) ?? null;
}

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
  const [showRerunDialog, setShowRerunDialog] = useState(false);

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

  const rerunMut = useMutation({
    mutationFn: async () => {
      const res = await fetchWithAuth(`/api/admin/workflows/runs/${runId}/rerun`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Failed to re-run");
      }
      return res.json() as Promise<{ runId: number }>;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["wf-runs"] });
      navigate(`/workflows/runs/${data.runId}`);
    },
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
            {run.retriggeredFromRunId != null && (
              <button
                onClick={() => navigate(`/workflows/runs/${run.retriggeredFromRunId}`)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-violet-500/15 border border-violet-500/30 text-violet-300 hover:bg-violet-500/25 transition-colors"
              >
                ↩ Re-run of #{run.retriggeredFromRunId}
              </button>
            )}
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${STATUS_STYLES[run.status] ?? ""}`}>
              {run.status === "awaiting_approval" ? "⏸ awaiting approval" : run.status}
            </span>
            {run.triggerRef === "draft_test" && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 border border-amber-500/30 uppercase tracking-wider">
                Draft Run
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
            <span className="text-sm text-[#7D8590] truncate">
              {run.definitionName ?? "Unknown workflow"}
              {run.versionLabel ? ` · ${run.versionLabel}` : ""}
              {" · "}
            </span>
            {run.triggerType === "event" && run.triggerRef && run.triggerRef !== "draft_test" ? (
              <>
                <span className="text-sm mr-0.5">📡</span>
                <span className="text-sm text-[#E6EDF3] font-mono">{run.triggerRef}</span>
                {(() => {
                  const cat = getEventCategory(run.triggerRef);
                  return cat ? (
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold border ${CATEGORY_STYLES[cat]}`}>
                      {cat}
                    </span>
                  ) : null;
                })()}
              </>
            ) : (
              <span className="text-sm text-[#7D8590] capitalize">
                {run.triggerType === "event" ? "📡 Event" :
                 run.triggerType === "manual" ? "🖱 Manual" :
                 run.triggerType === "schedule" ? "📅 Schedule" :
                 run.triggerType === "webhook" ? "🔗 Webhook" :
                 run.triggerType}
              </span>
            )}
            {run.startedAt && (
              <span className="text-sm text-[#7D8590]">· {format(new Date(run.startedAt), "MMM d, HH:mm:ss")}</span>
            )}
            {run.durationMs !== null && (
              <span className="text-sm text-[#7D8590]">· {fmtDuration(run.durationMs)}</span>
            )}
          </div>
        </div>

        {(run.status === "failed" || run.status === "cancelled" || run.status === "completed") && (
          <button
            onClick={() => run.definitionName ? setShowRerunDialog(true) : undefined}
            disabled={rerunMut.isPending || !run.definitionName}
            title={run.definitionName ? "Re-run with the same original payload" : "Workflow definition no longer exists"}
            className="px-3 py-1.5 bg-[#0078D4]/80 hover:bg-[#0078D4] disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Re-run
          </button>
        )}
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

      {/* Re-run Confirmation Dialog */}
      {showRerunDialog && run && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-[#161B22] border border-[#30363D] rounded-xl p-6 w-full max-w-lg space-y-4">
            <h2 className="text-base font-bold text-[#E6EDF3]">Re-run Workflow</h2>
            <p className="text-sm text-[#7D8590]">
              A new run will be created for <span className="text-[#E6EDF3] font-medium">{run.definitionName}</span> using
              the exact same payload and version as Run #{run.id}.
            </p>
            {Object.keys(run.payload).length > 0 ? (
              <div>
                <p className="text-xs font-semibold text-[#7D8590] uppercase tracking-wider mb-1.5">Original payload</p>
                <pre className="bg-[#0D1117] border border-[#30363D] rounded-lg p-3 text-[11px] font-mono text-[#E6EDF3] overflow-auto max-h-48 whitespace-pre-wrap">
                  {JSON.stringify(run.payload, null, 2)}
                </pre>
              </div>
            ) : (
              <p className="text-xs text-[#484F58] italic">No payload (empty trigger)</p>
            )}
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowRerunDialog(false)}
                className="px-4 py-2 bg-[#1C2128] hover:bg-[#30363D] text-[#E6EDF3] text-sm rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => { setShowRerunDialog(false); rerunMut.mutate(); }}
                disabled={rerunMut.isPending}
                className="px-4 py-2 bg-[#0078D4]/90 hover:bg-[#0078D4] disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Confirm Re-run
              </button>
            </div>
          </div>
        </div>
      )}

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
