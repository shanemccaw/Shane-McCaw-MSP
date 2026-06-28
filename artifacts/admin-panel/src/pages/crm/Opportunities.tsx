import { useState, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash2, RotateCcw, X } from "lucide-react";

type OpportunityState = "new" | "contacted" | "qualified" | "converted" | "archived" | "deleted";

interface OpportunityLead {
  id: number;
  name: string;
  email: string;
  company: string | null;
}

interface Opportunity {
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
  deletedAt: string | null;
  createdAt: string;
  lead: OpportunityLead | null;
  taskCount: number;
}

interface OpportunityList {
  opportunities: Opportunity[];
  total: number;
  page: number;
  limit: number;
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 75 ? "bg-purple-500/20 text-purple-300 border border-purple-500/30" :
    score >= 60 ? "bg-blue-500/20 text-blue-300 border border-blue-500/30" :
    "bg-[#30363D] text-[#7D8590]";
  const label = score >= 75 ? "SQL" : score >= 60 ? "AQL" : "Lead";
  return (
    <div className="flex items-center gap-2">
      <span className={`text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${color}`}>{label}</span>
      <span className="text-sm font-bold text-[#E6EDF3]">{score}</span>
    </div>
  );
}

function SubScoreMini({ label, val, max, color }: { label: string; val: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((val / max) * 100) : 0;
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-[#7D8590] w-12 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-[#30363D] rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] font-bold text-[#E6EDF3] w-4 text-right">{val}</span>
    </div>
  );
}

const WORKFLOW_LABELS: Record<string, string> = {
  DiscoveryCall: "Discovery Call",
  GovernanceAssessment: "Governance Assessment",
  CopilotReadiness: "Copilot Readiness",
  ComplianceReview: "Compliance Review",
  TenantHealth: "Tenant Health Audit",
  ProposalPrep: "Proposal Preparation",
};

const STATE_PILLS: { value: OpportunityState | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "qualified", label: "Qualified" },
  { value: "converted", label: "Converted" },
  { value: "archived", label: "Archived" },
  { value: "deleted", label: "Recently Deleted" },
];

const STATE_BADGE: Record<OpportunityState, string> = {
  new: "bg-sky-500/15 text-sky-400 border border-sky-500/20",
  contacted: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
  qualified: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  converted: "bg-purple-500/15 text-purple-400 border border-purple-500/20",
  archived: "bg-[#30363D] text-[#7D8590] border border-[#30363D]",
  deleted: "bg-rose-500/15 text-rose-400 border border-rose-500/20",
};

function daysUntilPurge(deletedAt: string | null): number | null {
  if (!deletedAt) return null;
  const deleted = new Date(deletedAt).getTime();
  const purgeAt = deleted + 30 * 24 * 60 * 60 * 1000;
  const remaining = Math.ceil((purgeAt - Date.now()) / (24 * 60 * 60 * 1000));
  return Math.max(0, remaining);
}

export default function OpportunitiesPage() {
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [filterState, setFilterState] = useState<OpportunityState | "all">("all");
  const [deleteTarget, setDeleteTarget] = useState<Opportunity | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<Opportunity | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [purging, setPurging] = useState(false);
  const [restoringId, setRestoringId] = useState<number | null>(null);
  const LIMIT = 20;

  const fetchOpportunities = useCallback(async (p = 1, state: OpportunityState | "all" = "all") => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(LIMIT) });
      if (state !== "all") params.set("state", state);
      const res = await fetchWithAuth(`/api/opportunities?${params.toString()}`);
      if (res.ok) {
        const data = await res.json() as OpportunityList;
        setOpportunities(data.opportunities);
        setTotal(data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void fetchOpportunities(1, filterState);
  }, [fetchOpportunities, filterState]);

  const handleFilterChange = (state: OpportunityState | "all") => {
    setFilterState(state);
    setPage(1);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetchWithAuth(`/api/opportunities/${deleteTarget.id}`, { method: "DELETE" });
      if (res.ok) {
        setOpportunities(prev => prev.filter(op => op.id !== deleteTarget.id));
        setTotal(prev => Math.max(0, prev - 1));
      }
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  const handleRestore = async (op: Opportunity) => {
    setRestoringId(op.id);
    try {
      const res = await fetchWithAuth(`/api/opportunities/${op.id}/restore`, { method: "POST" });
      if (res.ok) {
        setOpportunities(prev => prev.filter(o => o.id !== op.id));
        setTotal(prev => Math.max(0, prev - 1));
      }
    } finally {
      setRestoringId(null);
    }
  };

  const handlePurgeConfirm = async () => {
    if (!purgeTarget) return;
    setPurging(true);
    try {
      const res = await fetchWithAuth(`/api/opportunities/${purgeTarget.id}/purge`, { method: "DELETE" });
      if (res.ok) {
        setOpportunities(prev => prev.filter(op => op.id !== purgeTarget.id));
        setTotal(prev => Math.max(0, prev - 1));
      }
    } finally {
      setPurging(false);
      setPurgeTarget(null);
    }
  };

  const totalPages = Math.ceil(total / LIMIT);

  const isDeletedView = filterState === "deleted";

  return (
    <div className="p-4 sm:p-6 max-w-[1200px]">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[#E6EDF3]">Opportunities</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Qualified leads converted to opportunities with workflow tasks.</p>
        </div>
      </div>

      {/* State filter pills */}
      <div className="flex flex-wrap gap-2 mb-5">
        {STATE_PILLS.map(pill => (
          <button
            key={pill.value}
            onClick={() => handleFilterChange(pill.value)}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors border ${
              filterState === pill.value
                ? pill.value === "deleted"
                  ? "bg-rose-600 text-white border-rose-600"
                  : "bg-[#0078D4] text-white border-[#0078D4]"
                : pill.value === "deleted"
                  ? "bg-transparent text-rose-400/70 border-rose-500/30 hover:border-rose-500/60 hover:text-rose-300"
                  : "bg-transparent text-[#7D8590] border-[#30363D] hover:border-[#0078D4]/50 hover:text-[#E6EDF3]"
            }`}
          >
            {pill.label}
          </button>
        ))}
        {total > 0 && (
          <span className="ml-auto text-xs text-muted-foreground self-center">{total} total</span>
        )}
      </div>

      {/* Recently Deleted banner */}
      {isDeletedView && (
        <div className="mb-4 flex items-start gap-3 bg-rose-500/10 border border-rose-500/20 rounded-xl px-4 py-3">
          <Trash2 className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <p className="text-sm text-rose-300">
            Deleted opportunities are kept for <span className="font-semibold">30 days</span> before being permanently removed.
            Restore an opportunity to move it back to <span className="font-semibold">Archived</span>.
          </p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-32">
          <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : opportunities.length === 0 ? (
        <div className="bg-[#161B22] border border-dashed border-border rounded-xl p-12 text-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
          </svg>
          <p className="text-sm font-medium text-muted-foreground">
            {isDeletedView ? "No recently deleted opportunities" : filterState === "all" ? "No opportunities yet" : `No ${filterState} opportunities`}
          </p>
          <p className="text-xs text-muted-foreground/60 mt-1">
            {isDeletedView
              ? "Opportunities you delete will appear here for 30 days."
              : filterState === "all"
                ? "Opportunities are created when you approve a lead qualification. Edit a lead's profile to trigger scoring."
                : "Try selecting a different filter above."}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {opportunities.map(op => {
            const daysLeft = isDeletedView ? daysUntilPurge(op.deletedAt) : null;
            return (
              <div
                key={op.id}
                onClick={() => !isDeletedView && navigate(`/crm/opportunities/${op.id}`)}
                className={`bg-[#161B22] border border-border rounded-xl p-5 transition-all group ${
                  isDeletedView
                    ? "opacity-70 cursor-default"
                    : "cursor-pointer hover:border-[#0078D4]/50 hover:bg-[#1C2128]"
                }`}
              >
                <div className="flex items-start gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                      <ScoreBadge score={op.scoreSnapshot} />
                      <h3 className="text-base font-bold text-[#E6EDF3] group-hover:text-[#0078D4] transition-colors">
                        {op.lead?.name ?? `Lead #${op.leadId}`}
                      </h3>
                      {op.lead?.company && (
                        <span className="text-sm text-muted-foreground">{op.lead.company}</span>
                      )}
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize ${STATE_BADGE[op.state]}`}>
                        {op.state === "deleted" ? "Deleted" : op.state}
                      </span>
                      {daysLeft !== null && (
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${daysLeft <= 3 ? "bg-rose-500/20 text-rose-300" : "bg-[#30363D] text-[#7D8590]"}`}>
                          {daysLeft === 0 ? "Purges today" : `Purges in ${daysLeft}d`}
                        </span>
                      )}
                    </div>
                    {op.recommendedNextStep && !isDeletedView && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5 text-[#0078D4] shrink-0">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <span className="text-xs font-medium text-[#0078D4]">{op.recommendedNextStep}</span>
                      </div>
                    )}
                    {op.workflowType && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Workflow: {WORKFLOW_LABELS[op.workflowType] ?? op.workflowType}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 shrink-0 text-right">
                    <div className="flex items-center gap-4 justify-end">
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">Tasks</p>
                        <p className="text-lg font-black text-[#E6EDF3]">{op.taskCount}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">Score</p>
                        <p className="text-lg font-black text-[#E6EDF3]">{op.scoreSnapshot}<span className="text-xs font-normal text-muted-foreground">/100</span></p>
                      </div>

                      {isDeletedView ? (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={e => { e.stopPropagation(); void handleRestore(op); }}
                            disabled={restoringId === op.id}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 transition-colors disabled:opacity-50"
                            title="Restore opportunity"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            {restoringId === op.id ? "Restoring…" : "Restore"}
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); setPurgeTarget(op); }}
                            className="p-1.5 rounded-lg text-[#7D8590] hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                            title="Permanently delete"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={e => { e.stopPropagation(); setDeleteTarget(op); }}
                          className="p-1.5 rounded-lg text-[#7D8590] hover:text-rose-400 hover:bg-rose-500/10 transition-colors opacity-0 group-hover:opacity-100"
                          title="Move to trash"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {isDeletedView && op.deletedAt
                        ? `Deleted ${new Date(op.deletedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
                        : new Date(op.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                    </p>
                  </div>
                </div>

                {/* Sub-score mini bars */}
                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
                  <SubScoreMini label="Fit" val={op.scoreFit} max={25} color="bg-sky-500" />
                  <SubScoreMini label="Pain" val={op.scorePain} max={30} color="bg-orange-500" />
                  <SubScoreMini label="Maturity" val={op.scoreMaturity} max={20} color="bg-emerald-500" />
                  <SubScoreMini label="Intent" val={op.scoreIntent} max={15} color="bg-violet-500" />
                  <SubScoreMini label="Urgency" val={op.scoreUrgency} max={10} color="bg-rose-500" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6">
          <p className="text-xs text-muted-foreground">
            Showing {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}
          </p>
          <div className="flex gap-2">
            <button disabled={page <= 1}
              onClick={() => { const p = page - 1; setPage(p); void fetchOpportunities(p, filterState); }}
              className="px-3 py-1.5 border border-border rounded-lg text-xs font-medium disabled:opacity-40 hover:bg-[#1C2128] transition-colors">
              Prev
            </button>
            <button disabled={page >= totalPages}
              onClick={() => { const p = page + 1; setPage(p); void fetchOpportunities(p, filterState); }}
              className="px-3 py-1.5 border border-border rounded-lg text-xs font-medium disabled:opacity-40 hover:bg-[#1C2128] transition-colors">
              Next
            </button>
          </div>
        </div>
      )}

      {/* Soft-delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move to Recently Deleted?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-semibold text-foreground">
                {deleteTarget?.lead?.name ?? `Lead #${deleteTarget?.leadId}`}
              </span>{" "}
              will be moved to <span className="font-semibold text-foreground">Recently Deleted</span>. You can
              restore it within 30 days. After that it will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              disabled={deleting}
              className="bg-rose-600 hover:bg-rose-700 focus:ring-rose-600"
            >
              {deleting ? "Moving…" : "Move to Trash"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Hard purge confirmation */}
      <AlertDialog open={!!purgeTarget} onOpenChange={open => { if (!open) setPurgeTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the opportunity for{" "}
              <span className="font-semibold text-foreground">
                {purgeTarget?.lead?.name ?? `Lead #${purgeTarget?.leadId}`}
              </span>{" "}
              and all its associated tasks. <span className="font-semibold text-foreground">This cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={purging}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handlePurgeConfirm}
              disabled={purging}
              className="bg-rose-600 hover:bg-rose-700 focus:ring-rose-600"
            >
              {purging ? "Deleting…" : "Delete Forever"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
