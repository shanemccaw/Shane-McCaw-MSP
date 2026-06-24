import { useState, useCallback, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";

type Tier = "Beginner" | "Developing" | "Emerging" | "Advanced" | "Ready";

interface QuizAnalysisText {
  whatThisMeans: string;
  whyThisFits: string;
  roiProjection: string;
}

interface QuizLead {
  id: number;
  name: string;
  email: string;
  company: string | null;
  totalScore: number;
  tier: Tier;
  recommendedService: string | null;
  categoryScores: Record<string, number>;
  analysisText: QuizAnalysisText | null;
  conversation: { role: "user" | "assistant"; content: string }[];
  createdAt: string;
  contactedAt: string | null;
  quizType: string;
}

interface QuizLeadList {
  leads: QuizLead[];
  total: number;
  page: number;
  limit: number;
}

interface QuizLeadStats {
  total: number;
  contacted: number;
  newThisWeek: number;
}

interface DownloadStats {
  total: number;
  byQuizType: { quizType: string | null; total: number }[];
}

interface SelectorStats {
  total: number;
  bySlugs: { slug: string; count: number }[];
}

const TIER_COLORS: Record<Tier, string> = {
  Beginner: "bg-red-500/15 text-red-400",
  Developing: "bg-orange-500/15 text-orange-400",
  Emerging: "bg-yellow-500/15 text-yellow-400",
  Advanced: "bg-[#0078D4]/100/15 text-blue-400",
  Ready: "bg-green-500/15 text-green-400",
};

const QUIZ_TYPE_LABELS: Record<string, string> = {
  copilot: "Copilot Readiness",
  "m365-health": "M365 Health",
  sharepoint: "SharePoint",
  "power-platform": "Power Platform",
  "security-compliance": "Security & Compliance",
  teams: "Teams",
  migration: "Migration",
  governance: "Governance",
};

function formatCategoryKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function ScoreBar({ score, max = 10 }: { score: number; max?: number }) {
  const pct = Math.round((score / max) * 100);
  const color = pct >= 70 ? "bg-green-500" : pct >= 40 ? "bg-yellow-400" : "bg-red-400";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-[#1C2128] rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold text-[#E6EDF3] w-6 text-right">{score}</span>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="bg-[#161B22] border border-border rounded-xl p-5 flex items-center gap-4">
      <div className="w-11 h-11 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-2xl font-extrabold text-[#E6EDF3]">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  );
}

function ConversationTranscript({ messages }: { messages: { role: "user" | "assistant"; content: string }[] }) {
  if (messages.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Quiz Conversation</p>
      <div className="space-y-3">
        {messages.map((msg, i) =>
          msg.role === "assistant" ? (
            <div key={i} className="border-l-2 border-[#0078D4] pl-3">
              <p className="text-[10px] font-bold text-[#0078D4] uppercase tracking-wider mb-0.5">Q</p>
              <p className="text-sm text-[#E6EDF3] leading-relaxed">{msg.content}</p>
            </div>
          ) : (
            <div key={i} className="pl-4">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-0.5">A</p>
              <p className="text-sm text-[#E6EDF3] bg-[#1C2128] rounded-lg px-3 py-2 leading-relaxed">{msg.content}</p>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function SlideOver({ lead, onClose, onRefresh }: {
  lead: QuizLead;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const { fetchWithAuth } = useAuth();
  const [saving, setSaving] = useState(false);
  const [contacted, setContacted] = useState(!!lead.contactedAt);

  const toggleContacted = async () => {
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/admin/quiz-leads/${lead.id}/contacted`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contacted: !contacted }),
      });
      if (res.ok) {
        setContacted(!contacted);
        onRefresh();
      }
    } finally {
      setSaving(false);
    }
  };

  const scores = lead.categoryScores;
  const categoryKeys = Object.keys(scores);
  const totalMax = categoryKeys.length * 10;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full sm:max-w-lg bg-[#161B22] shadow-2xl flex flex-col h-full">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-[#0A2540] flex-shrink-0">
          <h2 className="text-white font-bold">Quiz Lead Details</h2>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors text-xl leading-none">×</button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-6">
          {/* Contact info */}
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Name</p>
              <p className="text-[#E6EDF3] font-semibold">{lead.name}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Email</p>
              <a href={`mailto:${lead.email}`} className="text-[#0078D4] hover:underline text-sm">{lead.email}</a>
            </div>
            {lead.company && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Company</p>
                <p className="text-[#E6EDF3] text-sm">{lead.company}</p>
              </div>
            )}
            <div className="flex gap-6 flex-wrap">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Quiz Type</p>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#0078D4]/10 text-[#0078D4]">
                  {QUIZ_TYPE_LABELS[lead.quizType] ?? lead.quizType}
                </span>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Date</p>
                <p className="text-sm text-[#E6EDF3]">{new Date(lead.createdAt).toLocaleDateString()}</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Status</p>
                {contacted ? (
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-500/15 text-green-400">Contacted</span>
                ) : (
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-yellow-500/15 text-yellow-400">Not contacted</span>
                )}
              </div>
            </div>
          </div>

          {/* Score overview */}
          <div className="bg-[#1C2128] rounded-xl p-4">
            <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Total Score</p>
              <span className="text-lg font-extrabold text-[#E6EDF3]">{lead.totalScore} <span className="text-sm font-normal text-muted-foreground">/ {totalMax}</span></span>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${TIER_COLORS[lead.tier] ?? "bg-[#30363D]/50 text-[#7D8590]"}`}>
                {lead.tier}
              </span>
              {lead.recommendedService && (
                <p className="text-xs text-muted-foreground truncate">{lead.recommendedService}</p>
              )}
            </div>
          </div>

          {/* Category breakdown — dynamic keys for all quiz types */}
          {categoryKeys.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Category Breakdown</p>
              <div className="space-y-3">
                {categoryKeys.map((key) => (
                  <div key={key}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs text-[#E6EDF3] font-medium">{formatCategoryKey(key)}</p>
                    </div>
                    <ScoreBar score={scores[key] ?? 0} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommended service */}
          {lead.recommendedService && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Recommended Service</p>
              <p className="text-sm text-[#E6EDF3] font-medium">{lead.recommendedService}</p>
            </div>
          )}

          {/* AI Analysis */}
          {lead.analysisText && (lead.analysisText.whatThisMeans || lead.analysisText.whyThisFits || lead.analysisText.roiProjection) && (
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">AI Analysis</p>
              {lead.analysisText.whatThisMeans && (
                <div className="bg-[#1C2128] rounded-xl p-4">
                  <p className="text-xs font-bold text-[#0078D4] uppercase tracking-wider mb-1.5">What This Means</p>
                  <p className="text-sm text-[#E6EDF3] leading-relaxed">{lead.analysisText.whatThisMeans}</p>
                </div>
              )}
              {lead.analysisText.whyThisFits && (
                <div className="bg-[#1C2128] rounded-xl p-4">
                  <p className="text-xs font-bold text-[#0078D4] uppercase tracking-wider mb-1.5">Why This Fits</p>
                  <p className="text-sm text-[#E6EDF3] leading-relaxed">{lead.analysisText.whyThisFits}</p>
                </div>
              )}
              {lead.analysisText.roiProjection && (
                <div className="bg-[#1C2128] rounded-xl p-4">
                  <p className="text-xs font-bold text-[#0078D4] uppercase tracking-wider mb-1.5">ROI Projection</p>
                  <p className="text-sm text-[#E6EDF3] leading-relaxed">{lead.analysisText.roiProjection}</p>
                </div>
              )}
            </div>
          )}

          {/* Conversation transcript */}
          <ConversationTranscript messages={lead.conversation} />
        </div>

        <div className="px-6 py-4 border-t border-border flex gap-3 flex-shrink-0">
          <button
            onClick={toggleContacted}
            disabled={saving}
            className={`flex-1 font-semibold rounded-lg py-2.5 text-sm transition-colors disabled:opacity-40 ${
              contacted
                ? "bg-[#1C2128] text-[#C9D1D9] hover:bg-[#30363D]"
                : "bg-[#0078D4] text-white hover:bg-[#0078D4]/90"
            }`}
          >
            {saving ? "Saving…" : contacted ? "Mark as Not Contacted" : "Mark as Contacted"}
          </button>
          <button
            onClick={onClose}
            className="px-4 border border-border rounded-lg text-sm font-medium text-muted-foreground hover:bg-[#1C2128] transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

const TIER_OPTIONS = ["all", "Beginner", "Developing", "Emerging", "Advanced", "Ready"] as const;
const QUIZ_TYPE_OPTIONS = ["all", "copilot", "m365-health", "sharepoint", "power-platform", "security-compliance", "teams", "migration", "governance"] as const;
const LIMIT = 20;

export default function QuizLeadsPage() {
  const { fetchWithAuth } = useAuth();
  const [selectedLead, setSelectedLead] = useState<QuizLead | null>(null);
  const [stats, setStats] = useState<QuizLeadStats | null>(null);
  const [downloadStats, setDownloadStats] = useState<DownloadStats | null>(null);
  const [selectorStats, setSelectorStats] = useState<SelectorStats | null>(null);
  const [leads, setLeads] = useState<QuizLead[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [tierFilter, setTierFilter] = useState("all");
  const [contactedFilter, setContactedFilter] = useState("all");
  const [quizTypeFilter, setQuizTypeFilter] = useState("all");

  const fetchStats = useCallback(async () => {
    const [statsRes, dlRes, selectorRes] = await Promise.all([
      fetchWithAuth("/api/admin/quiz-leads/stats"),
      fetchWithAuth("/api/admin/quiz-leads/download-stats"),
      fetchWithAuth("/api/admin/quiz-selector/stats"),
    ]);
    if (statsRes.ok) setStats(await statsRes.json() as QuizLeadStats);
    if (dlRes.ok) setDownloadStats(await dlRes.json() as DownloadStats);
    if (selectorRes.ok) setSelectorStats(await selectorRes.json() as SelectorStats);
  }, [fetchWithAuth]);

  const fetchLeads = useCallback(async (p = 1, tier = "all", contacted = "all", quizType = "all") => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), limit: String(LIMIT) });
      if (tier !== "all") params.set("tier", tier);
      if (contacted !== "all") params.set("contacted", contacted);
      if (quizType !== "all") params.set("quizType", quizType);
      const res = await fetchWithAuth(`/api/admin/quiz-leads?${params.toString()}`);
      if (res.ok) {
        const data = await res.json() as QuizLeadList;
        setLeads(data.leads);
        setTotal(data.total);
      }
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void Promise.all([fetchStats(), fetchLeads(1, "all", "all", "all")]);
  }, [fetchStats, fetchLeads]);

  const handleRefresh = () => {
    void Promise.all([fetchLeads(page, tierFilter, contactedFilter, quizTypeFilter), fetchStats()]);
  };

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <div className="p-4 sm:p-6 max-w-[1200px]">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[#E6EDF3]">Quiz Leads</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Prospects who completed any assessment quiz.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Total Submissions" value={stats?.total ?? 0}
          icon={<svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-[#0078D4]" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>}
        />
        <StatCard label="New This Week" value={stats?.newThisWeek ?? 0}
          icon={<svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-[#0078D4]" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
        />
        <StatCard label="Contacted" value={stats?.contacted ?? 0}
          icon={<svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-[#0078D4]" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
        />
        <StatCard label="Sample Report Downloads" value={downloadStats?.total ?? 0}
          icon={<svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 text-[#0078D4]" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>}
        />
      </div>

      {/* Download breakdown by quiz type */}
      {downloadStats && downloadStats.byQuizType.length > 0 && (
        <div className="bg-[#161B22] border border-border rounded-xl p-5 mb-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Sample Report Downloads by Quiz</p>
          <div className="flex flex-wrap gap-2">
            {downloadStats.byQuizType.map(({ quizType, total: cnt }) => (
              <span key={quizType ?? "unknown"} className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-[#0078D4]/10 text-[#0078D4]">
                {QUIZ_TYPE_LABELS[quizType ?? ""] ?? quizType ?? "Unknown"}
                <span className="font-extrabold">{cnt}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Quick Wins Selector results */}
      <div className="bg-[#161B22] border border-border rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
          <div>
            <p className="text-sm font-bold text-[#E6EDF3]">Quick Wins Selector</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Packages most frequently recommended by the micro-site quiz
              {selectorStats ? ` · ${selectorStats.total} completion${selectorStats.total !== 1 ? "s" : ""}` : ""}
            </p>
          </div>
        </div>
        {!selectorStats || selectorStats.bySlugs.length === 0 ? (
          <p className="text-xs text-muted-foreground">No completions recorded yet.</p>
        ) : (
          <div className="space-y-2.5">
            {selectorStats.bySlugs.map(({ slug, count: cnt }, i) => {
              const maxCount = selectorStats.bySlugs[0]?.count ?? 1;
              const pct = Math.round((cnt / maxCount) * 100);
              const SLUG_LABELS: Record<string, string> = {
                "tenant-health-audit": "M365 Tenant Health Audit",
                "power-platform-quick-start": "Power Platform Quick-Start",
                "governance-foundations": "Governance Foundations Package",
                "migration-readiness-assessment": "Migration Readiness Assessment",
                "copilot-readiness-assessment": "Copilot for M365 Readiness Assessment",
                "m365-training-enablement": "Microsoft 365 Training & Enablement",
              };
              return (
                <div key={slug} className="flex items-center gap-3">
                  <span className="w-5 text-xs font-bold text-muted-foreground text-right flex-shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-[#E6EDF3] truncate">
                        {SLUG_LABELS[slug] ?? slug}
                      </span>
                      <span className="text-xs font-extrabold text-[#0078D4] ml-2 flex-shrink-0">{cnt}</span>
                    </div>
                    <div className="h-1.5 bg-[#1C2128] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#0078D4] transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-[#161B22] border border-border rounded-xl overflow-hidden">
        {/* Filters */}
        <div className="px-5 pt-5 pb-4 border-b border-border space-y-3">
          {/* Tier filter */}
          <div className="flex flex-wrap gap-1.5">
            {TIER_OPTIONS.map(t => (
              <button key={t} onClick={() => { setTierFilter(t); setPage(1); void fetchLeads(1, t, contactedFilter, quizTypeFilter); }}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${tierFilter === t ? "bg-[#0078D4] text-white" : "bg-[#1C2128] text-muted-foreground hover:bg-[#0078D4]/10 hover:text-[#0078D4]"}`}>
                {t === "all" ? "All Tiers" : t}
              </button>
            ))}
          </div>
          {/* Quiz type + contacted filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <select value={quizTypeFilter}
              onChange={e => { setQuizTypeFilter(e.target.value); setPage(1); void fetchLeads(1, tierFilter, contactedFilter, e.target.value); }}
              className="border border-border rounded-lg px-3 py-1.5 text-xs font-medium bg-[#161B22] focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#1C2128] text-[#E6EDF3]">
              {QUIZ_TYPE_OPTIONS.map(q => (
                <option key={q} value={q}>{q === "all" ? "All Quiz Types" : (QUIZ_TYPE_LABELS[q] ?? q)}</option>
              ))}
            </select>
            <select value={contactedFilter}
              onChange={e => { setContactedFilter(e.target.value); setPage(1); void fetchLeads(1, tierFilter, e.target.value, quizTypeFilter); }}
              className="border border-border rounded-lg px-3 py-1.5 text-xs font-medium bg-[#161B22] focus:outline-none focus:ring-2 focus:ring-[#0078D4] bg-[#1C2128] text-[#E6EDF3]">
              <option value="all">All Statuses</option>
              <option value="no">Not Contacted</option>
              <option value="yes">Contacted</option>
            </select>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : leads.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-10 h-10 mx-auto text-muted-foreground/30 mb-3">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-sm">No quiz leads match your current filters.</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-[#1C2128]">
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Name</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Company</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Quiz</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Score</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tier</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Date</th>
                    <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Contacted</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.map(lead => (
                    <tr key={lead.id} onClick={() => setSelectedLead(lead)}
                      className="border-b border-border last:border-0 hover:bg-[#1C2128] cursor-pointer transition-colors">
                      <td className="px-5 py-3.5">
                        <p className="font-semibold text-[#E6EDF3] leading-tight">{lead.name}</p>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full mt-0.5 inline-block ${TIER_COLORS[lead.tier] ?? "bg-[#30363D]/50 text-[#7D8590]"}`}>
                          {lead.tier}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-muted-foreground">{lead.email}</td>
                      <td className="px-5 py-3.5 text-muted-foreground hidden md:table-cell">{lead.company ?? "—"}</td>
                      <td className="px-5 py-3.5 hidden lg:table-cell">
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#0078D4]/10 text-[#0078D4]">
                          {QUIZ_TYPE_LABELS[lead.quizType] ?? lead.quizType}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-semibold text-[#E6EDF3]">{lead.totalScore}</td>
                      <td className="px-5 py-3.5">
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${TIER_COLORS[lead.tier] ?? "bg-[#30363D]/50 text-[#7D8590]"}`}>
                          {lead.tier}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-muted-foreground text-xs hidden lg:table-cell">
                        {new Date(lead.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-5 py-3.5">
                        {lead.contactedAt ? (
                          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-500/15 text-green-400">Yes</span>
                        ) : (
                          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#30363D]/50 text-[#7D8590]">No</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="sm:hidden divide-y divide-border">
              {leads.map(lead => (
                <div key={lead.id} onClick={() => setSelectedLead(lead)}
                  className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-[#1C2128] transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#E6EDF3] truncate">{lead.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{lead.email}</p>
                    {lead.company && <p className="text-xs text-muted-foreground/70 truncate">{lead.company}</p>}
                    <p className="text-[10px] text-[#0078D4] font-medium mt-0.5">{QUIZ_TYPE_LABELS[lead.quizType] ?? lead.quizType}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${TIER_COLORS[lead.tier] ?? "bg-[#30363D]/50 text-[#7D8590]"}`}>{lead.tier}</span>
                    <span className="text-xs text-muted-foreground font-semibold">{lead.totalScore}</span>
                    {lead.contactedAt && <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">Contacted</span>}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between flex-wrap gap-3 px-5 py-4 border-t border-border">
            <p className="text-xs text-muted-foreground">
              Showing {(page - 1) * LIMIT + 1}–{Math.min(page * LIMIT, total)} of {total}
            </p>
            <div className="flex gap-2">
              <button disabled={page <= 1}
                onClick={() => { const p = page - 1; setPage(p); void fetchLeads(p, tierFilter, contactedFilter, quizTypeFilter); }}
                className="px-3 py-1.5 border border-border rounded-lg text-xs font-medium disabled:opacity-40 hover:bg-[#1C2128] transition-colors">
                Prev
              </button>
              <button disabled={page >= totalPages}
                onClick={() => { const p = page + 1; setPage(p); void fetchLeads(p, tierFilter, contactedFilter, quizTypeFilter); }}
                className="px-3 py-1.5 border border-border rounded-lg text-xs font-medium disabled:opacity-40 hover:bg-[#1C2128] transition-colors">
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {selectedLead && (
        <SlideOver
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onRefresh={handleRefresh}
        />
      )}
    </div>
  );
}
