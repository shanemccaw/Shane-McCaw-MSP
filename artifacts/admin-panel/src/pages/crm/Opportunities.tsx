import { useState, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

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

export default function OpportunitiesPage() {
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const LIMIT = 20;

  const fetchOpportunities = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(LIMIT) });
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
    void fetchOpportunities(1);
  }, [fetchOpportunities]);

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="p-4 sm:p-6 max-w-[1200px]">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-xl font-bold text-[#E6EDF3]">Opportunities</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Qualified leads converted to opportunities with workflow tasks.</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-32">
          <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : opportunities.length === 0 ? (
        <div className="bg-[#161B22] border border-dashed border-border rounded-xl p-12 text-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3">
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
          </svg>
          <p className="text-sm font-medium text-muted-foreground">No opportunities yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Opportunities are created when you approve a lead qualification. Edit a lead's profile to trigger scoring.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {opportunities.map(op => (
            <div
              key={op.id}
              onClick={() => navigate(`/crm/opportunities/${op.id}`)}
              className="bg-[#161B22] border border-border rounded-xl p-5 cursor-pointer hover:border-[#0078D4]/50 hover:bg-[#1C2128] transition-all group"
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
                  </div>
                  {op.recommendedNextStep && (
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
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {new Date(op.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
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
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6">
          <p className="text-xs text-muted-foreground">
            Showing {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}
          </p>
          <div className="flex gap-2">
            <button disabled={page <= 1}
              onClick={() => { const p = page - 1; setPage(p); void fetchOpportunities(p); }}
              className="px-3 py-1.5 border border-border rounded-lg text-xs font-medium disabled:opacity-40 hover:bg-[#1C2128] transition-colors">
              Prev
            </button>
            <button disabled={page >= totalPages}
              onClick={() => { const p = page + 1; setPage(p); void fetchOpportunities(p); }}
              className="px-3 py-1.5 border border-border rounded-lg text-xs font-medium disabled:opacity-40 hover:bg-[#1C2128] transition-colors">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
