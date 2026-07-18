import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";

type LeadStatus = "new" | "contacted" | "qualified" | "converted" | "archived";
type LeadSource = "contact_form" | "lead_magnet" | "ai_recommended";
type Tier = "Beginner" | "Developing" | "Emerging" | "Advanced" | "Ready";

interface Lead {
  id: number;
  name: string;
  email: string;
  company: string | null;
  companySize: string | null;
  serviceArea: string | null;
  message: string | null;
  notes: string | null;
  source: LeadSource;
  status: LeadStatus;
  howFound: string | null;
  createdAt: string;
  updatedAt: string;
  // Qualification engine fields
  score: number;
  previousScore: number;
  stage: string | null;
  lastQualifiedAt: string | null;
  industry: string | null;
  employeeCount: number | null;
  licenseTier: string | null;
  tenantAge: number | null;
  itTeamSize: number | null;
  painPoints: string[];
  maturityIndicators: string[];
  engagementSignals: string[];
  urgencySignals: string[];
}

interface QuizAnalysisText {
  whatThisMeans: string;
  whyThisFits: string;
  roiProjection: string;
}

interface QuizMatch {
  id: number;
  name: string;
  email: string;
  company: string | null;
  totalScore: number;
  tier: string;
  recommendedService: string | null;
  categoryScores: Record<string, number>;
  analysisText: QuizAnalysisText | null;
  conversation: { role: "user" | "assistant"; content: string }[];
  quizType: string;
  createdAt: string;
  contactedAt: string | null;
}

interface LinkedEmail {
  id: number;
  subject: string | null;
  senderAddress: string;
  rawFrom: string | null;
  receivedAt: string;
  bodyPreview?: string | null;
}

interface OutreachEmail {
  id: number;
  subject: string | null;
  recipient: string | null;
  sentAt: string;
  campaignId: number | null;
}

interface LeadQualification {
  id: number;
  leadId: number;
  newScore: number;
  previousScore: number;
  stage: "Warm" | "Hot";
  recommendedNextStep: string | null;
  workflowType: string | null;
  evidence: string[];
  scoreFit: number;
  scorePain: number;
  scoreMaturity: number;
  scoreIntent: number;
  scoreUrgency: number;
  status: "pending" | "approved" | "rejected" | "snoozed";
  createdAt: string;
}

const STATUS_COLORS: Record<LeadStatus, string> = {
  new: "bg-blue-500/15 text-blue-400",
  contacted: "bg-yellow-500/15 text-yellow-400",
  qualified: "bg-purple-500/15 text-purple-400",
  converted: "bg-green-500/15 text-green-400",
  archived: "bg-border/50 text-muted-foreground",
};

const SOURCE_COLORS: Record<LeadSource, string> = {
  contact_form: "bg-primary/10 text-primary",
  lead_magnet: "bg-teal-500/15 text-teal-400",
  ai_recommended: "bg-violet-500/15 text-violet-400",
};

const SOURCE_LABELS: Record<LeadSource, string> = {
  contact_form: "Contact Form",
  lead_magnet: "Lead Magnet",
  ai_recommended: "AI Recommended",
};

function parseAiNote(notes: string | null): { whyFit: string; recommendedService: string; confidence: string } | null {
  if (!notes) return null;
  const firstSegment = notes.split("--- AI Outreach Draft ---")[0] ?? notes;
  const parts = firstSegment.split("|").map(s => s.trim());
  const whyFitRaw = parts.find(p => p.toLowerCase().startsWith("why fit:"));
  const serviceRaw = parts.find(p => p.toLowerCase().startsWith("recommended service:"));
  const confRaw = parts.find(p => p.toLowerCase().startsWith("confidence:"));
  if (!whyFitRaw && !serviceRaw) return null;
  return {
    whyFit: whyFitRaw ? whyFitRaw.replace(/^why fit:\s*/i, "") : "",
    recommendedService: serviceRaw ? serviceRaw.replace(/^recommended service:\s*/i, "") : "",
    confidence: confRaw ? confRaw.replace(/^confidence:\s*/i, "") : "",
  };
}

const TIER_COLORS: Record<string, string> = {
  Beginner: "bg-red-500/15 text-red-400",
  Developing: "bg-orange-500/15 text-orange-400",
  Emerging: "bg-yellow-500/15 text-yellow-400",
  Advanced: "bg-blue-500/15 text-blue-400",
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

const STATUS_MILESTONES: { status: LeadStatus; label: string }[] = [
  { status: "new", label: "Submitted" },
  { status: "contacted", label: "Contacted" },
  { status: "qualified", label: "Qualified" },
  { status: "converted", label: "Converted" },
];

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
      <div className="flex-1 h-2 bg-accent rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-semibold text-foreground w-6 text-right">{score}</span>
    </div>
  );
}

function CategoryChip({ label, score, max = 10 }: { label: string; score: number; max?: number }) {
  const pct = Math.round((score / max) * 100);
  const cls = pct >= 70
    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
    : pct >= 40
      ? "bg-amber-500/10 text-amber-400 border-amber-500/25"
      : "bg-red-500/10 text-red-400 border-red-500/25";
  return (
    <div className={`flex items-center justify-between gap-1 rounded-lg border px-2 py-1.5 ${cls}`}>
      <span className="text-[10px] font-medium truncate leading-tight">{label}</span>
      <span className="text-[10px] font-bold flex-shrink-0 tabular-nums">{score}<span className="font-normal opacity-60">/{max}</span></span>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border bg-accent">
        <h2 className="text-sm font-bold text-foreground">{title}</h2>
      </div>
      <div className="px-5 py-5">{children}</div>
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">{label}</p>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

function QuizCard({ quiz }: { quiz: QuizMatch }) {
  const [expanded, setExpanded] = useState(false);
  const categoryKeys = Object.keys(quiz.categoryScores);
  const totalMax = categoryKeys.length * 10;
  const hasAnalysis = quiz.analysisText && (
    quiz.analysisText.whatThisMeans ||
    quiz.analysisText.whyThisFits ||
    quiz.analysisText.roiProjection
  );

  return (
    <div className="bg-accent border border-border rounded-xl p-4 space-y-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="space-y-1.5">
          <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-primary/10 text-primary">
            {QUIZ_TYPE_LABELS[quiz.quizType] ?? quiz.quizType}
          </span>
          <div className="flex items-center gap-2 flex-wrap mt-1.5">
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${TIER_COLORS[quiz.tier] ?? "bg-border/50 text-muted-foreground"}`}>
              {quiz.tier}
            </span>
            <span className="text-sm font-bold text-foreground">{quiz.totalScore} <span className="text-xs font-normal text-muted-foreground">/ {totalMax}</span></span>
          </div>
        </div>
        <p className="text-xs text-muted-foreground flex-shrink-0">{new Date(quiz.createdAt).toLocaleDateString()}</p>
      </div>

      {quiz.recommendedService && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Recommended</p>
          <p className="text-xs text-foreground font-medium">{quiz.recommendedService}</p>
        </div>
      )}

      {categoryKeys.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Category Scores</p>
          <div className="grid grid-cols-2 gap-1.5">
            {categoryKeys.map((key) => (
              <CategoryChip
                key={key}
                label={formatCategoryKey(key)}
                score={quiz.categoryScores[key] ?? 0}
              />
            ))}
          </div>
        </div>
      )}

      {hasAnalysis && (
        <div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1.5 text-xs text-primary font-semibold hover:underline"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-90" : ""}`}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
            {expanded ? "Hide" : "Show"} AI Analysis
          </button>
          {expanded && quiz.analysisText && (
            <div className="mt-3 space-y-3">
              {quiz.analysisText.whatThisMeans && (
                <div className="bg-card rounded-lg p-3">
                  <p className="text-[10px] font-bold text-primary uppercase tracking-wider mb-1">What This Means</p>
                  <p className="text-xs text-foreground leading-relaxed">{quiz.analysisText.whatThisMeans}</p>
                </div>
              )}
              {quiz.analysisText.whyThisFits && (
                <div className="bg-card rounded-lg p-3">
                  <p className="text-[10px] font-bold text-primary uppercase tracking-wider mb-1">Why This Fits</p>
                  <p className="text-xs text-foreground leading-relaxed">{quiz.analysisText.whyThisFits}</p>
                </div>
              )}
              {quiz.analysisText.roiProjection && (
                <div className="bg-card rounded-lg p-3">
                  <p className="text-[10px] font-bold text-primary uppercase tracking-wider mb-1">ROI Projection</p>
                  <p className="text-xs text-foreground leading-relaxed">{quiz.analysisText.roiProjection}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-accent px-4 py-8 text-center">
      <div className="w-10 h-10 mx-auto text-muted-foreground/30 mb-2">{icon}</div>
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      <p className="text-xs text-muted-foreground/60 mt-0.5">{subtitle}</p>
    </div>
  );
}

const STAGE_COLORS: Record<string, string> = {
  Hot:  "bg-purple-500/20 text-purple-300 border-purple-500/30",
  Warm: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  Cold: "bg-accent text-muted-foreground border-border",
  Junk: "bg-red-500/10 text-red-400 border-red-500/20",
};

const STATUS_BADGE: Record<string, string> = {
  approved: "bg-green-500/20 text-green-300",
  rejected: "bg-red-500/20 text-red-300",
  snoozed: "bg-yellow-500/20 text-yellow-300",
  pending: "bg-border text-muted-foreground",
};

function ScoreHistoryChart({ history }: { history: LeadQualification[] }) {
  if (history.length === 0) {
    return (
      <EmptyState
        icon={
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-10 h-10">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
          </svg>
        }
        title="No scoring events yet"
        subtitle="Save the qualification profile to generate the first score."
      />
    );
  }

  // Chart data: oldest first so the line goes left→right chronologically
  const chartData: { date: string; score: number; stage: string }[] = [...history].reverse().map(q => ({
    date: new Date(q.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    score: q.newScore,
    stage: q.stage,
  }));

  // Add a synthetic "start" point at previousScore of the earliest record
  const earliest = history[history.length - 1];
  if (earliest.previousScore > 0) {
    chartData.unshift({ date: "Start", score: earliest.previousScore, stage: "" });
  }

  return (
    <div className="space-y-5">
      {/* Sparkline chart */}
      <div className="h-36">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#2F6FED" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#2F6FED" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#232A36" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: "#8B94A3", fontSize: 10 }} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} tick={{ fill: "#8B94A3", fontSize: 10 }} axisLine={false} tickLine={false} />
            <RechartsTooltip
              contentStyle={{ background: "#171C26", border: "1px solid #232A36", borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: "#E6EDF3", fontWeight: 700 }}
              itemStyle={{ color: "#2F6FED" }}
              formatter={(value: number) => [`${value}/100`, "Score"]}
            />
            <ReferenceLine y={60} stroke="#3B82F6" strokeDasharray="4 2" label={{ value: "Warm", fill: "#3B82F6", fontSize: 9, position: "right" }} />
            <ReferenceLine y={75} stroke="#A855F7" strokeDasharray="4 2" label={{ value: "Hot", fill: "#A855F7", fontSize: 9, position: "right" }} />
            <Area type="monotone" dataKey="score" stroke="#2F6FED" strokeWidth={2} fill="url(#scoreGrad)" dot={{ fill: "#2F6FED", r: 3, strokeWidth: 0 }} activeDot={{ r: 5 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Event list — newest first */}
      <div className="space-y-2">
        {history.map((q, i) => {
          const delta = q.newScore - q.previousScore;
          const isFirst = i === history.length - 1;
          return (
            <div key={q.id} className={`relative pl-7 ${!isFirst ? "pb-2" : ""}`}>
              {i < history.length - 1 && (
                <div className="absolute left-3 top-6 bottom-0 w-px bg-border" />
              )}
              <div className={`absolute left-1.5 top-1.5 w-3 h-3 rounded-full border-2 ${
                q.stage === "Hot"  ? "bg-purple-500 border-purple-400" :
                q.stage === "Warm" ? "bg-blue-500 border-blue-400" :
                "bg-primary border-[#005A9E]"
              }`} />
              <div className="bg-accent border border-border rounded-lg px-3.5 py-2.5 space-y-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-bold text-foreground">{q.previousScore} → {q.newScore}<span className="text-xs font-normal text-muted-foreground">/100</span></span>
                    {delta !== 0 && (
                      <span className={`text-xs font-semibold ${delta > 0 ? "text-green-400" : "text-red-400"}`}>
                        {delta > 0 ? `+${delta}` : delta}
                      </span>
                    )}
                    <span className={`text-[10px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded border ${STAGE_COLORS[q.stage] ?? "bg-border text-muted-foreground border-border"}`}>
                      {q.stage}
                    </span>
                    <span className={`text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded ${STATUS_BADGE[q.status] ?? STATUS_BADGE.pending}`}>
                      {q.status}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    {new Date(q.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>

                {/* Sub-scores */}
                <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                  {([
                    ["Fit", q.scoreFit],
                    ["Pain", q.scorePain],
                    ["Maturity", q.scoreMaturity],
                    ["Intent", q.scoreIntent],
                    ["Urgency", q.scoreUrgency],
                  ] as [string, number][]).map(([label, val]) => (
                    <span key={label} className="text-[10px] text-muted-foreground">
                      {label} <span className="text-foreground font-semibold">{val}</span>
                    </span>
                  ))}
                </div>

                {q.recommendedNextStep && (
                  <p className="text-xs text-muted-foreground leading-snug">
                    <span className="text-primary font-semibold">Next: </span>{q.recommendedNextStep}
                  </p>
                )}

                {Array.isArray(q.evidence) && q.evidence.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {q.evidence.map((e, ei) => (
                      <span key={ei} className="text-[10px] bg-card border border-border rounded px-1.5 py-0.5 text-muted-foreground">{e}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const PAIN_POINT_OPTIONS = [
  "Governance", "Compliance", "Security", "Migration", "Copilot", "AI Readiness",
  "SharePoint", "Power Platform", "Teams", "Training", "Adoption", "Licensing", "Cost Optimization",
];

const MATURITY_OPTIONS = [
  "Has existing M365", "Dedicated IT team", "Previous consultant", "Documented processes",
  "Data governance policy", "Active SharePoint usage", "Teams adoption", "Power Platform usage",
];

const ENGAGEMENT_OPTIONS = [
  "Requested demo", "Downloaded resource", "Completed quiz", "Visited pricing page",
  "Multiple visits", "Referral", "Contact form", "LinkedIn outreach", "Replied to email",
];

const URGENCY_OPTIONS = [
  "Audit deadline", "Compliance deadline", "Board mandate", "Budget approved",
  "Project kickoff scheduled", "Urgent", "ASAP", "This quarter",
];

function TagInput({
  label, options, selected, onChange, provenance,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  provenance?: Record<string, string>;
}) {
  const toggle = (opt: string) => {
    onChange(selected.includes(opt) ? selected.filter(s => s !== opt) : [...selected, opt]);
  };
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map(opt => {
          const reason = provenance?.[opt];
          const isSelected = selected.includes(opt);
          return (
            <div key={opt} className="relative group/tag">
              <button
                type="button"
                onClick={() => toggle(opt)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors font-medium flex items-center gap-1 ${
                  isSelected
                    ? "bg-primary/20 border-primary/60 text-primary"
                    : "bg-accent border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                }`}
              >
                {opt}
                {reason && isSelected && (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3 h-3 opacity-60 flex-shrink-0">
                    <circle cx="12" cy="12" r="10" />
                    <path strokeLinecap="round" d="M12 16v-4M12 8h.01" />
                  </svg>
                )}
              </button>
              {reason && isSelected && (
                <div className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50 opacity-0 group-hover/tag:opacity-100 transition-opacity duration-150">
                  <div className="bg-background border border-border text-foreground text-[10px] leading-relaxed px-2.5 py-1.5 rounded-lg shadow-xl whitespace-nowrap max-w-[220px] text-center">
                    {reason}
                  </div>
                  <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-border" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface DerivedSignals {
  painPoints: string[];
  maturityIndicators: string[];
  engagementSignals: string[];
  urgencySignals: string[];
  provenance: Record<string, string>;
}

export default function LeadDetailPage({ params }: { params: { id: string } }) {
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const leadId = parseInt(params.id, 10);

  const [lead, setLead] = useState<Lead | null>(null);
  const [quizMatches, setQuizMatches] = useState<QuizMatch[]>([]);
  const [emails, setEmails] = useState<LinkedEmail[]>([]);
  const [outreachEmails, setOutreachEmails] = useState<OutreachEmail[]>([]);
  const [qualHistory, setQualHistory] = useState<LeadQualification[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [status, setStatus] = useState<LeadStatus>("new");
  const [saving, setSaving] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  // Qualification profile state
  const [qualSaving, setQualSaving] = useState(false);
  const [qualSaved, setQualSaved] = useState(false);
  const [autoFillBannerVisible, setAutoFillBannerVisible] = useState(false);
  const [reimportFlash, setReimportFlash] = useState(false);
  const [autoFillProvenance, setAutoFillProvenance] = useState<Record<string, string>>({});
  const autoFillAppliedRef = useRef(false);
  const [qualProfile, setQualProfile] = useState({
    industry: "",
    employeeCount: "",
    licenseTier: "",
    tenantAge: "",
    itTeamSize: "",
    painPoints: [] as string[],
    maturityIndicators: [] as string[],
    engagementSignals: [] as string[],
    urgencySignals: [] as string[],
  });

  const loadLead = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`/api/leads/${leadId}`);
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      if (!res.ok) return;
      const data = await res.json() as Lead;
      setLead(data);
      setStatus(data.status);
      setQualProfile({
        industry: data.industry ?? "",
        employeeCount: data.employeeCount != null ? String(data.employeeCount) : "",
        licenseTier: data.licenseTier ?? "",
        tenantAge: data.tenantAge != null ? String(data.tenantAge) : "",
        itTeamSize: data.itTeamSize != null ? String(data.itTeamSize) : "",
        painPoints: Array.isArray(data.painPoints) ? data.painPoints as string[] : [],
        maturityIndicators: Array.isArray(data.maturityIndicators) ? data.maturityIndicators as string[] : [],
        engagementSignals: Array.isArray(data.engagementSignals) ? data.engagementSignals as string[] : [],
        urgencySignals: Array.isArray(data.urgencySignals) ? data.urgencySignals as string[] : [],
      });
    } catch {
      setNotFound(true);
    }
  }, [leadId, fetchWithAuth]);

  useEffect(() => {
    if (isNaN(leadId)) {
      setNotFound(true);
      return;
    }

    setLoading(true);
    void Promise.all([
      loadLead(),
      fetchWithAuth(`/api/leads/${leadId}/quiz-matches`)
        .then(r => r.ok ? r.json() as Promise<QuizMatch[]> : [])
        .then(data => setQuizMatches(data))
        .catch(() => setQuizMatches([])),
      fetchWithAuth(`/api/leads/${leadId}/emails`)
        .then(r => r.ok ? r.json() as Promise<LinkedEmail[]> : [])
        .then(data => setEmails(data))
        .catch(() => setEmails([])),
      fetchWithAuth(`/api/admin/marketing/leads/${leadId}/emails`)
        .then(r => r.ok ? r.json() as Promise<OutreachEmail[]> : [])
        .then(data => setOutreachEmails(data))
        .catch(() => setOutreachEmails([])),
      fetchWithAuth(`/api/leads/${leadId}/qualifications`)
        .then(r => r.ok ? r.json() as Promise<LeadQualification[]> : [])
        .then(data => setQualHistory(data))
        .catch(() => setQualHistory([])),
    ]).finally(() => setLoading(false));
  }, [leadId, loadLead, fetchWithAuth]);

  // Auto-fill qualification signals from quiz data on first load.
  // Calls the server-side derive-signals endpoint so the same config
  // (stored in the DB) is used everywhere.
  useEffect(() => {
    if (loading) return;
    if (autoFillAppliedRef.current) return;
    if (!lead || quizMatches.length === 0) return;

    autoFillAppliedRef.current = true;

    const hasExistingSignals =
      lead.painPoints.length > 0 ||
      lead.maturityIndicators.length > 0 ||
      lead.engagementSignals.length > 0 ||
      lead.urgencySignals.length > 0;

    if (!hasExistingSignals) {
      void fetchWithAuth(`/api/leads/${leadId}/derive-signals`)
        .then(r => r.ok ? r.json() as Promise<DerivedSignals> : null)
        .then(derived => {
          if (!derived) return;
          const hasAnyDerived =
            derived.painPoints.length > 0 ||
            derived.maturityIndicators.length > 0 ||
            derived.engagementSignals.length > 0 ||
            derived.urgencySignals.length > 0;
          if (hasAnyDerived) {
            setQualProfile(p => ({
              ...p,
              painPoints: derived.painPoints,
              maturityIndicators: derived.maturityIndicators,
              engagementSignals: derived.engagementSignals,
              urgencySignals: derived.urgencySignals,
            }));
            setAutoFillProvenance(derived.provenance);
            setAutoFillBannerVisible(true);
          }
        })
        .catch(() => {});
    }
  }, [loading, lead, quizMatches, leadId, fetchWithAuth]);

  const reimportFromQuiz = async () => {
    if (!lead || quizMatches.length === 0) return;
    try {
      const r = await fetchWithAuth(`/api/leads/${leadId}/derive-signals`);
      if (!r.ok) return;
      const derived = await r.json() as DerivedSignals;
      setQualProfile(p => ({
        ...p,
        painPoints: [...new Set([...p.painPoints, ...derived.painPoints])],
        maturityIndicators: [...new Set([...p.maturityIndicators, ...derived.maturityIndicators])],
        engagementSignals: [...new Set([...p.engagementSignals, ...derived.engagementSignals])],
        urgencySignals: [...new Set([...p.urgencySignals, ...derived.urgencySignals])],
      }));
      setAutoFillProvenance(prev => ({ ...prev, ...derived.provenance }));
    } catch {
      // silently skip if the API call fails
    }
    setReimportFlash(true);
    setTimeout(() => setReimportFlash(false), 2500);
  };

  const saveStatus = async (newStatus: LeadStatus) => {
    if (!lead || newStatus === lead.status) return;
    setSaving(true);
    try {
      const res = await fetchWithAuth(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        const updated = await res.json() as Lead;
        setLead(updated);
        setStatus(updated.status);
      }
    } finally {
      setSaving(false);
    }
  };

  const markContacted = async () => {
    if (!lead || lead.status !== "new") return;
    await saveStatus("contacted");
  };

  const saveQualProfile = async () => {
    if (!lead) return;
    setQualSaving(true);
    try {
      const payload = {
        industry: qualProfile.industry || null,
        employeeCount: qualProfile.employeeCount ? parseInt(qualProfile.employeeCount, 10) : null,
        licenseTier: qualProfile.licenseTier || null,
        tenantAge: qualProfile.tenantAge ? parseInt(qualProfile.tenantAge, 10) : null,
        itTeamSize: qualProfile.itTeamSize ? parseInt(qualProfile.itTeamSize, 10) : null,
        painPoints: qualProfile.painPoints,
        maturityIndicators: qualProfile.maturityIndicators,
        engagementSignals: qualProfile.engagementSignals,
        urgencySignals: qualProfile.urgencySignals,
      };
      const res = await fetchWithAuth(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const updated = await res.json() as Lead & { qualificationPending?: boolean };
        setLead(updated);
        setQualSaved(true);
        setAutoFillBannerVisible(false);
        setAutoFillProvenance({});
        setTimeout(() => setQualSaved(false), 2500);
        if (updated.qualificationPending) {
          // Small delay to let the DB settle, then navigate to leads page
          setTimeout(() => navigate("/crm/leads"), 800);
        }
      }
    } finally {
      setQualSaving(false);
    }
  };

  const copyEmail = async () => {
    if (!lead) return;
    await navigator.clipboard.writeText(lead.email);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (notFound || !lead) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Lead not found.</p>
        <button onClick={() => navigate("/crm/leads")} className="mt-4 text-sm text-primary hover:underline">
          ← Back to Leads
        </button>
      </div>
    );
  }

  const milestoneReached = (s: LeadStatus) => {
    const order: LeadStatus[] = ["new", "contacted", "qualified", "converted"];
    return order.indexOf(lead.status) >= order.indexOf(s);
  };

  return (
    <div className="p-4 sm:p-6 max-w-[900px] space-y-6">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 px-4 sm:px-6 pt-5 pb-4 bg-background border-b border-border">
        <div className="flex items-start gap-4 flex-wrap">
          <button
            onClick={() => navigate("/crm/leads")}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mt-0.5"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            Leads
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-lg font-bold text-foreground truncate">{lead.name}</h1>
              {lead.company && <span className="text-sm text-muted-foreground truncate">{lead.company}</span>}
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full capitalize ${STATUS_COLORS[lead.status]}`}>
                {lead.status}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
            <a
              href={`mailto:${lead.email}`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-primary/90 transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
              </svg>
              Send Email
            </a>

            {lead.status === "new" && (
              <button
                onClick={() => void markContacted()}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-500/15 text-yellow-400 text-xs font-semibold hover:bg-yellow-500/25 transition-colors disabled:opacity-40"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Mark Contacted
              </button>
            )}

            <button
              onClick={() => void copyEmail()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-semibold text-muted-foreground hover:bg-accent transition-colors"
            >
              {copySuccess ? (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5 text-green-400">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-green-400">Copied!</span>
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy Email
                </>
              )}
            </button>

            <select
              value={status}
              onChange={e => {
                const s = e.target.value as LeadStatus;
                setStatus(s);
                void saveStatus(s);
              }}
              disabled={saving}
              className="border border-border rounded-lg px-3 py-1.5 text-xs font-medium bg-card focus:outline-none focus:ring-2 focus:ring-primary text-foreground disabled:opacity-40"
            >
              <option value="new">New</option>
              <option value="contacted">Contacted</option>
              <option value="qualified">Qualified</option>
              <option value="converted">Converted</option>
              <option value="archived">Archived</option>
            </select>
          </div>
        </div>
      </div>

      {/* Contact Info */}
      <SectionCard title="Contact Info">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <InfoRow label="Name">{lead.name}</InfoRow>
          <InfoRow label="Email">
            <a href={`mailto:${lead.email}`} className="text-primary hover:underline">{lead.email}</a>
          </InfoRow>
          {lead.company && (
            <InfoRow label="Company">
              {lead.company}{lead.companySize ? ` (${lead.companySize})` : ""}
            </InfoRow>
          )}
          {lead.serviceArea && <InfoRow label="Service Area">{lead.serviceArea}</InfoRow>}
          {lead.howFound && <InfoRow label="How They Found Shane">{lead.howFound}</InfoRow>}
          <InfoRow label="Source">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${SOURCE_COLORS[lead.source] ?? "bg-border/50 text-muted-foreground"}`}>
                {lead.source === "ai_recommended" && (
                  <span className="mr-1">✦</span>
                )}
                {SOURCE_LABELS[lead.source] ?? lead.source}
              </span>
            </div>
          </InfoRow>
          <InfoRow label="Submitted">
            {new Date(lead.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
          </InfoRow>
        </div>
      </SectionCard>

      {/* Message */}
      {lead.message && (
        <SectionCard title="Message">
          <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{lead.message}</p>
        </SectionCard>
      )}

      {/* AI Context — shown only for AI-recommended leads */}
      {lead.source === "ai_recommended" && (() => {
        const parsed = parseAiNote(lead.notes);
        if (!parsed && !lead.notes) return null;
        return (
          <div className="bg-card border border-violet-500/30 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-violet-500/20 bg-violet-500/10 flex items-center gap-2">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-4 h-4 text-violet-400 flex-shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
              </svg>
              <h2 className="text-sm font-bold text-violet-300">AI Recommendation Context</h2>
              {parsed?.confidence && (
                <span className="ml-auto text-xs font-semibold px-2 py-0.5 rounded-full bg-violet-500/20 text-violet-300">
                  {parsed.confidence} confidence
                </span>
              )}
            </div>
            <div className="px-5 py-5 space-y-4">
              {parsed ? (
                <>
                  {parsed.whyFit && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Why This Lead Fits</p>
                      <p className="text-sm text-foreground leading-relaxed">{parsed.whyFit}</p>
                    </div>
                  )}
                  {parsed.recommendedService && (
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Recommended Service</p>
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-primary/10 text-primary">
                        {parsed.recommendedService}
                      </span>
                    </div>
                  )}
                </>
              ) : (
                lead.notes && (
                  <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">{lead.notes}</p>
                )
              )}
            </div>
          </div>
        );
      })()}

      {/* Qualification Profile */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border bg-accent flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <h2 className="text-sm font-bold text-foreground">Qualification Profile</h2>
            {lead.score > 0 && (
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded border ${
                  lead.stage === "Hot"
                    ? "bg-purple-500/20 text-purple-300 border-purple-500/30"
                    : lead.stage === "Warm"
                      ? "bg-blue-500/20 text-blue-300 border-blue-500/30"
                      : "bg-border text-muted-foreground border-border"
                }`}>
                  {lead.stage ?? "Cold"}
                </span>
                <span className="text-sm font-bold text-foreground">{lead.score}<span className="text-xs font-normal text-muted-foreground">/100</span></span>
              </div>
            )}
            {quizMatches.length > 0 && (lead.painPoints.length > 0 || lead.maturityIndicators.length > 0 || lead.engagementSignals.length > 0 || lead.urgencySignals.length > 0) && (
              <button
                type="button"
                onClick={reimportFromQuiz}
                className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border border-primary/40 text-primary hover:bg-primary/10 transition-colors"
              >
                {reimportFlash ? (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3.5 h-3.5 text-green-400">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="text-green-400">Merged!</span>
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Re-import from quiz
                  </>
                )}
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Saved changes trigger automatic scoring</p>
        </div>
        <div className="px-5 py-5 space-y-6">
          {/* Quiz Score Summary — compact chip grid above form fields */}
          {quizMatches.length > 0 && (() => {
            const best = [...quizMatches].sort((a, b) => b.totalScore - a.totalScore)[0];
            const entries = Object.entries(best.categoryScores);
            if (entries.length === 0) return null;
            const totalMax = entries.length * 10;
            return (
              <div className="p-3 bg-accent rounded-xl border border-border">
                <div className="flex items-center gap-2 flex-wrap mb-2.5">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                    Quiz Scores
                  </p>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                    {QUIZ_TYPE_LABELS[best.quizType] ?? best.quizType}
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${TIER_COLORS[best.tier] ?? "bg-border/50 text-muted-foreground"}`}>
                    {best.tier}
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {best.totalScore}/{totalMax} total
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-1.5">
                  {entries.map(([key, score]) => (
                    <CategoryChip key={key} label={formatCategoryKey(key)} score={score} />
                  ))}
                </div>
              </div>
            );
          })()}
          {/* Firmographic */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Industry</label>
              <input
                type="text"
                value={qualProfile.industry}
                onChange={e => setQualProfile(p => ({ ...p, industry: e.target.value }))}
                placeholder="e.g. Technology, Healthcare"
                className="w-full bg-accent border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Employee Count</label>
              <input
                type="number"
                value={qualProfile.employeeCount}
                onChange={e => setQualProfile(p => ({ ...p, employeeCount: e.target.value }))}
                placeholder="e.g. 250"
                min={1}
                className="w-full bg-accent border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">License Tier</label>
              <select
                value={qualProfile.licenseTier}
                onChange={e => setQualProfile(p => ({ ...p, licenseTier: e.target.value }))}
                className="w-full bg-accent border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Not Known</option>
                <option value="E5">Microsoft 365 E5</option>
                <option value="E3">Microsoft 365 E3</option>
                <option value="Business Premium">Business Premium</option>
                <option value="Business Standard">Business Standard</option>
                <option value="Business Basic">Business Basic</option>
                <option value="F3">F3 (Frontline)</option>
                <option value="F1">F1 (Frontline)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">Tenant Age (years)</label>
              <input
                type="number"
                value={qualProfile.tenantAge}
                onChange={e => setQualProfile(p => ({ ...p, tenantAge: e.target.value }))}
                placeholder="e.g. 3"
                min={0}
                className="w-full bg-accent border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">IT Team Size</label>
              <input
                type="number"
                value={qualProfile.itTeamSize}
                onChange={e => setQualProfile(p => ({ ...p, itTeamSize: e.target.value }))}
                placeholder="e.g. 5"
                min={0}
                className="w-full bg-accent border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
          </div>

          {/* Auto-fill banner */}
          {autoFillBannerVisible && (
            <div className="flex items-start gap-3 rounded-lg border border-primary/30 bg-primary/10 px-4 py-3">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-primary flex-shrink-0 mt-0.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <p className="text-xs text-foreground flex-1 leading-relaxed">
                <span className="font-semibold text-primary">Auto-filled from quiz answers</span> — review and save to apply.
              </p>
              <button
                type="button"
                onClick={() => setAutoFillBannerVisible(false)}
                className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Dismiss"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* Tags */}
          <div className="space-y-5">
            <TagInput
              label="Pain Points"
              options={PAIN_POINT_OPTIONS}
              selected={qualProfile.painPoints}
              onChange={v => setQualProfile(p => ({ ...p, painPoints: v }))}
              provenance={autoFillProvenance}
            />
            <TagInput
              label="Maturity Indicators"
              options={MATURITY_OPTIONS}
              selected={qualProfile.maturityIndicators}
              onChange={v => setQualProfile(p => ({ ...p, maturityIndicators: v }))}
              provenance={autoFillProvenance}
            />
            <TagInput
              label="Engagement Signals"
              options={ENGAGEMENT_OPTIONS}
              selected={qualProfile.engagementSignals}
              onChange={v => setQualProfile(p => ({ ...p, engagementSignals: v }))}
              provenance={autoFillProvenance}
            />
            <TagInput
              label="Urgency Signals"
              options={URGENCY_OPTIONS}
              selected={qualProfile.urgencySignals}
              onChange={v => setQualProfile(p => ({ ...p, urgencySignals: v }))}
              provenance={autoFillProvenance}
            />
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => void saveQualProfile()}
              disabled={qualSaving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-white text-xs font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {qualSaving ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                  Scoring…
                </>
              ) : qualSaved ? (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-3.5 h-3.5 text-green-400">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-green-400">Saved!</span>
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-3.5 h-3.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Save & Score Lead
                </>
              )}
            </button>
            <p className="text-xs text-muted-foreground">
              {lead.score > 0
                ? `Current score: ${lead.score}/100${lead.lastQualifiedAt ? ` · Last scored ${new Date(lead.lastQualifiedAt).toLocaleDateString()}` : ""}`
                : "Score will be computed when you save."}
            </p>
          </div>
        </div>
      </div>

      {/* Score History */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border bg-accent flex items-center justify-between">
          <h2 className="text-sm font-bold text-foreground">Score History</h2>
          <span className="text-xs text-muted-foreground">{qualHistory.length} event{qualHistory.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="px-5 py-5">
          <ScoreHistoryChart history={qualHistory} />
        </div>
      </div>

      {/* Quiz Submissions */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border bg-accent flex items-center justify-between">
          <h2 className="text-sm font-bold text-foreground">Quiz Submissions</h2>
          <span className="text-xs text-muted-foreground">{quizMatches.length} match{quizMatches.length !== 1 ? "es" : ""}</span>
        </div>
        <div className="px-5 py-5">
          {quizMatches.length === 0 ? (
            <EmptyState
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-10 h-10"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>}
              title="No quiz submissions found"
              subtitle="No quiz has been completed with this email address."
            />
          ) : (
            <div className="space-y-4">
              {quizMatches.map(q => <QuizCard key={q.id} quiz={q} />)}
            </div>
          )}
        </div>
      </div>

      {/* Outreach Sent */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border bg-accent flex items-center justify-between">
          <h2 className="text-sm font-bold text-foreground">Outreach Sent</h2>
          <span className="text-xs text-muted-foreground">{outreachEmails.length} email{outreachEmails.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="px-5 py-5">
          {outreachEmails.length === 0 ? (
            <EmptyState
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-10 h-10"><path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" /></svg>}
              title="No outreach emails yet"
              subtitle="Emails sent via the Marketing tab will appear here."
            />
          ) : (
            <div className="space-y-0">
              {outreachEmails.map((email, i) => (
                <div key={email.id} className="relative pl-7">
                  {i < outreachEmails.length - 1 && (
                    <div className="absolute left-3 top-8 bottom-0 w-px bg-border" />
                  )}
                  <div className="absolute left-1.5 top-3 w-3 h-3 rounded-full border-2 border-[#00B4D8] bg-card" />
                  <div className="pb-4">
                    <div className="bg-accent border border-border rounded-xl px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{email.subject ?? "(no subject)"}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">To: {email.recipient ?? "—"}</p>
                        </div>
                        <p className="text-xs text-muted-foreground/70 flex-shrink-0 whitespace-nowrap">
                          {new Date(email.sentAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Email History */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border bg-accent flex items-center justify-between">
          <h2 className="text-sm font-bold text-foreground">Email History</h2>
          <a href="/admin-panel/email-activity" className="text-xs text-primary hover:underline font-medium">
            Open Inbox →
          </a>
        </div>
        <div className="px-5 py-5">
          {emails.length === 0 ? (
            <EmptyState
              icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-10 h-10"><path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>}
              title="No emails linked"
              subtitle="Pin emails from the inbox to link them to this lead."
            />
          ) : (
            <div className="space-y-0">
              {emails.map((email, i) => (
                <div key={email.id} className="relative pl-7">
                  {/* Timeline line */}
                  {i < emails.length - 1 && (
                    <div className="absolute left-3 top-8 bottom-0 w-px bg-border" />
                  )}
                  {/* Timeline dot */}
                  <div className="absolute left-1.5 top-3 w-3 h-3 rounded-full border-2 border-primary bg-card" />

                  <div className="pb-4">
                    <div className="bg-accent border border-border rounded-xl px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-foreground truncate">{email.subject ?? "(no subject)"}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{email.rawFrom ?? email.senderAddress}</p>
                          {email.bodyPreview && (
                            <p className="text-xs text-muted-foreground/70 mt-1.5 line-clamp-2">{email.bodyPreview}</p>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground/70 flex-shrink-0">
                          {new Date(email.receivedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Activity Timeline */}
      <SectionCard title="Activity Timeline">
        <div className="space-y-0">
          {/* Created milestone */}
          <div className="relative pl-7 pb-4">
            <div className="absolute left-1.5 top-1.5 w-3 h-3 rounded-full bg-primary" />
            <div className="absolute left-3 top-5 bottom-0 w-px bg-border" />
            <p className="text-sm font-medium text-foreground">Lead Submitted</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {new Date(lead.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
            </p>
          </div>

          {STATUS_MILESTONES.filter(m => m.status !== "new").map((milestone, i, arr) => {
            const reached = milestoneReached(milestone.status);
            const isLast = i === arr.length - 1;

            return (
              <div key={milestone.status} className={`relative pl-7 ${isLast ? "" : "pb-4"}`}>
                {!isLast && <div className="absolute left-3 top-5 bottom-0 w-px bg-border" />}
                <div className={`absolute left-1.5 top-1.5 w-3 h-3 rounded-full border-2 ${reached ? "bg-primary border-primary" : "bg-card border-border"}`} />
                <p className={`text-sm font-medium ${reached ? "text-foreground" : "text-muted-foreground/50"}`}>
                  {milestone.label}
                </p>
                {reached && lead.status === milestone.status && lead.updatedAt !== lead.createdAt && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {new Date(lead.updatedAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
                  </p>
                )}
                {!reached && (
                  <p className="text-xs text-muted-foreground/40 mt-0.5">Not yet reached</p>
                )}
              </div>
            );
          })}
        </div>
      </SectionCard>
    </div>
  );
}
