import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

interface OpportunityTask {
  id: number;
  opportunityId: number;
  title: string;
  description: string | null;
  dueDate: string | null;
  assignedTo: string;
  status: "todo" | "in_progress" | "done";
  kanbanTaskId: number | null;
  createdAt: string;
}

type OpportunityState = "new" | "contacted" | "qualified" | "converted" | "archived";

const STATE_OPTIONS: { value: OpportunityState; label: string; color: string }[] = [
  { value: "new",       label: "New",       color: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
  { value: "contacted", label: "Contacted", color: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  { value: "qualified", label: "Qualified", color: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  { value: "converted", label: "Converted", color: "bg-purple-500/15 text-purple-400 border-purple-500/30" },
  { value: "archived",  label: "Archived",  color: "bg-[#30363D] text-[#7D8590] border-[#30363D]" },
];

interface OpportunityDetail {
  id: number;
  leadId: number;
  scoreSnapshot: number;
  scoreFit: number;
  scorePain: number;
  scoreMaturity: number;
  scoreIntent: number;
  scoreUrgency: number;
  evidence: string[];
  recommendedNextStep: string | null;
  workflowType: string | null;
  state: OpportunityState;
  createdAt: string;
  lead: {
    id: number;
    name: string;
    email: string;
    company: string | null;
    stage: string;
  } | null;
  tasks: OpportunityTask[];
}

const STATUS_CONFIG = {
  todo: { label: "To Do", color: "bg-[#30363D] text-[#7D8590]" },
  in_progress: { label: "In Progress", color: "bg-blue-500/15 text-blue-400" },
  done: { label: "Done", color: "bg-green-500/15 text-green-400" },
};

const WORKFLOW_LABELS: Record<string, string> = {
  DiscoveryCall: "Discovery Call",
  GovernanceAssessment: "Governance Assessment",
  CopilotReadiness: "Copilot Readiness",
  ComplianceReview: "Compliance Review",
  TenantHealth: "Tenant Health Audit",
  ProposalPrep: "Proposal Preparation",
};

function SubScoreBar({ label, score, max, color }: { label: string; score: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((score / max) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-[#C9D1D9]">{label}</span>
        <span className="text-xs font-bold text-[#E6EDF3]">{score}<span className="text-[#7D8590] font-normal">/{max}</span></span>
      </div>
      <div className="h-2 bg-[#30363D] rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function OpportunityDetailPage({ params }: { params: { id: string } }) {
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const oppId = parseInt(params.id, 10);

  const [opportunity, setOpportunity] = useState<OpportunityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [updatingTask, setUpdatingTask] = useState<number | null>(null);
  const [updatingState, setUpdatingState] = useState(false);

  const loadOpportunity = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`/api/opportunities/${oppId}`);
      if (res.status === 404) { setNotFound(true); return; }
      if (!res.ok) return;
      const data = await res.json() as OpportunityDetail;
      setOpportunity(data);
    } catch {
      setNotFound(true);
    }
  }, [oppId, fetchWithAuth]);

  useEffect(() => {
    if (isNaN(oppId)) { setNotFound(true); return; }
    setLoading(true);
    void loadOpportunity().finally(() => setLoading(false));
  }, [oppId, loadOpportunity]);

  const updateOpportunityState = async (state: OpportunityState) => {
    if (!opportunity || updatingState) return;
    setUpdatingState(true);
    try {
      const res = await fetchWithAuth(`/api/opportunities/${oppId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      });
      if (res.ok) {
        setOpportunity(prev => prev ? { ...prev, state } : prev);
      }
    } finally {
      setUpdatingState(false);
    }
  };

  const updateTaskStatus = async (taskId: number, status: "todo" | "in_progress" | "done") => {
    if (!opportunity) return;
    setUpdatingTask(taskId);
    try {
      const res = await fetchWithAuth(`/api/opportunities/${oppId}/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        const updated = await res.json() as OpportunityTask;
        setOpportunity(prev => prev ? {
          ...prev,
          tasks: prev.tasks.map(t => t.id === taskId ? updated : t),
        } : prev);
      }
    } finally {
      setUpdatingTask(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !opportunity) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Opportunity not found.</p>
        <button onClick={() => navigate("/crm/opportunities")} className="mt-4 text-sm text-[#0078D4] hover:underline">
          ← Back to Opportunities
        </button>
      </div>
    );
  }

  const scoreColor = opportunity.scoreSnapshot >= 75 ? "text-purple-400" : "text-[#0078D4]";
  const stageLabel = opportunity.scoreSnapshot >= 75 ? "SQL" : "AQL";
  const stageBg = opportunity.scoreSnapshot >= 75 ? "bg-purple-500/20 text-purple-300 border-purple-500/30" : "bg-blue-500/20 text-blue-300 border-blue-500/30";

  const doneTasks = opportunity.tasks.filter(t => t.status === "done").length;
  const totalTasks = opportunity.tasks.length;

  return (
    <div className="p-4 sm:p-6 max-w-[1000px] space-y-6">
      {/* Header */}
      <div className="sticky top-0 z-10 -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 px-4 sm:px-6 pt-5 pb-4 bg-[#0D1117] border-b border-border">
        <div className="flex items-start gap-4 flex-wrap">
          <button
            onClick={() => navigate("/crm/opportunities")}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-[#E6EDF3] transition-colors mt-0.5"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Opportunities
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded border ${stageBg}`}>{stageLabel}</span>
              <h1 className="text-lg font-bold text-[#E6EDF3] truncate">
                {opportunity.lead?.name ?? `Lead #${opportunity.leadId}`}
              </h1>
              {opportunity.lead?.company && (
                <span className="text-sm text-muted-foreground">{opportunity.lead.company}</span>
              )}
            </div>
            {opportunity.lead && (
              <button
                onClick={() => navigate(`/crm/leads/${opportunity.lead!.id}`)}
                className="text-xs text-[#0078D4] hover:underline mt-0.5"
              >
                View Lead Profile →
              </button>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0 flex-wrap">
            {/* State button group */}
            <div className="flex items-center gap-1 flex-wrap">
              {STATE_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => void updateOpportunityState(opt.value)}
                  disabled={updatingState}
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded border transition-all disabled:opacity-50 ${
                    opportunity.state === opt.value
                      ? opt.color
                      : "bg-transparent text-[#7D8590] border-[#30363D] hover:border-[#58A6FF]/50 hover:text-[#E6EDF3]"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <span className={`text-2xl font-black ${scoreColor}`}>
              {opportunity.scoreSnapshot}<span className="text-sm font-normal text-muted-foreground">/100</span>
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: score + evidence */}
        <div className="space-y-6">
          {/* Score breakdown */}
          <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border bg-[#1C2128]">
              <h2 className="text-sm font-bold text-[#E6EDF3]">Score Snapshot</h2>
            </div>
            <div className="px-5 py-5 space-y-4">
              <SubScoreBar label="Fit" score={opportunity.scoreFit} max={25} color="bg-sky-500" />
              <SubScoreBar label="Pain" score={opportunity.scorePain} max={30} color="bg-orange-500" />
              <SubScoreBar label="Maturity" score={opportunity.scoreMaturity} max={20} color="bg-emerald-500" />
              <SubScoreBar label="Intent" score={opportunity.scoreIntent} max={15} color="bg-violet-500" />
              <SubScoreBar label="Urgency" score={opportunity.scoreUrgency} max={10} color="bg-rose-500" />
            </div>
          </div>

          {/* Evidence log */}
          {opportunity.evidence.length > 0 && (
            <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
              <div className="px-5 py-3.5 border-b border-border bg-[#1C2128]">
                <h2 className="text-sm font-bold text-[#E6EDF3]">Evidence Log</h2>
              </div>
              <div className="px-5 py-5">
                <ul className="space-y-2">
                  {opportunity.evidence.map((item, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#0078D4] mt-1.5 shrink-0" />
                      <span className="text-sm text-[#C9D1D9]">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Meta */}
          <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border bg-[#1C2128]">
              <h2 className="text-sm font-bold text-[#E6EDF3]">Details</h2>
            </div>
            <div className="px-5 py-5 space-y-3">
              {opportunity.recommendedNextStep && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Recommended Next Step</p>
                  <div className="flex items-center gap-1.5">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5 text-[#0078D4] shrink-0">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span className="text-sm font-semibold text-[#0078D4]">{opportunity.recommendedNextStep}</span>
                  </div>
                </div>
              )}
              {opportunity.workflowType && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Workflow Template</p>
                  <p className="text-sm text-[#E6EDF3]">{WORKFLOW_LABELS[opportunity.workflowType] ?? opportunity.workflowType}</p>
                </div>
              )}
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Created</p>
                <p className="text-sm text-[#E6EDF3]">
                  {new Date(opportunity.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right column: tasks */}
        <div className="lg:col-span-2">
          <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border bg-[#1C2128] flex items-center justify-between">
              <h2 className="text-sm font-bold text-[#E6EDF3]">Workflow Tasks</h2>
              <span className="text-xs text-muted-foreground">
                {doneTasks}/{totalTasks} done
              </span>
            </div>

            {/* Progress bar */}
            {totalTasks > 0 && (
              <div className="h-1.5 bg-[#30363D]">
                <div
                  className="h-full bg-green-500 transition-all"
                  style={{ width: `${Math.round((doneTasks / totalTasks) * 100)}%` }}
                />
              </div>
            )}

            <div className="divide-y divide-border">
              {opportunity.tasks.length === 0 ? (
                <div className="px-5 py-10 text-center text-muted-foreground">
                  <p className="text-sm">No tasks generated yet.</p>
                </div>
              ) : (
                opportunity.tasks.map((task) => (
                  <div key={task.id} className={`px-5 py-4 ${task.status === "done" ? "opacity-60" : ""}`}>
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 shrink-0">
                        <button
                          onClick={() => void updateTaskStatus(task.id, task.status === "done" ? "todo" : "done")}
                          disabled={updatingTask === task.id}
                          className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                            task.status === "done"
                              ? "bg-green-500 border-green-500"
                              : "border-[#30363D] hover:border-[#0078D4]"
                          } disabled:opacity-40`}
                        >
                          {task.status === "done" && (
                            <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={3} className="w-3 h-3">
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </button>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <p className={`text-sm font-semibold ${task.status === "done" ? "line-through text-muted-foreground" : "text-[#E6EDF3]"}`}>
                            {task.title}
                          </p>
                          <div className="flex items-center gap-2 shrink-0">
                            <select
                              value={task.status}
                              onChange={e => void updateTaskStatus(task.id, e.target.value as "todo" | "in_progress" | "done")}
                              disabled={updatingTask === task.id}
                              className="text-xs border border-border rounded-lg px-2 py-1 bg-[#1C2128] text-[#E6EDF3] focus:outline-none focus:ring-1 focus:ring-[#0078D4] disabled:opacity-40"
                            >
                              <option value="todo">To Do</option>
                              <option value="in_progress">In Progress</option>
                              <option value="done">Done</option>
                            </select>
                          </div>
                        </div>

                        {task.description && (
                          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{task.description}</p>
                        )}

                        <div className="flex items-center gap-3 mt-2 flex-wrap">
                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${STATUS_CONFIG[task.status].color}`}>
                            {STATUS_CONFIG[task.status].label}
                          </span>
                          {task.dueDate && (
                            <span className="text-[10px] text-muted-foreground">
                              Due {new Date(task.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                            </span>
                          )}
                          <span className="text-[10px] text-muted-foreground">
                            {task.assignedTo}
                          </span>
                          {task.kanbanTaskId && (
                            <a
                              href="/admin-panel/kanban"
                              className="text-[10px] text-[#0078D4] hover:underline"
                              onClick={e => { e.stopPropagation(); }}
                            >
                              View on Kanban →
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
