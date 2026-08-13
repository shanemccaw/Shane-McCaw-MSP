import { useState, useEffect, useCallback } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

interface QualificationRecord {
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
  status: string;
  createdAt: string;
  lead: {
    id: number;
    name: string;
    email: string;
    company: string | null;
  } | null;
}

interface SubScoreBarProps {
  label: string;
  score: number;
  max: number;
  color: string;
}

function SubScoreBar({ label, score, max, color }: SubScoreBarProps) {
  const pct = max > 0 ? Math.round((score / max) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-foreground/90">{label}</span>
        <span className="text-xs font-bold text-foreground">{score}<span className="text-muted-foreground font-normal">/{max}</span></span>
      </div>
      <div className="h-2 bg-border rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function QualificationModal() {
  const { fetchWithAuth } = useAuth();
  const [, navigate] = useLocation();
  const [pending, setPending] = useState<QualificationRecord[]>([]);
  const [current, setCurrent] = useState<QualificationRecord | null>(null);
  const [acting, setActing] = useState(false);

  const fetchPending = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/leads/qualification/pending");
      if (!res.ok) return;
      const data = await res.json() as QualificationRecord[];
      setPending(data);
      if (data.length > 0 && !current) {
        setCurrent(data[0] ?? null);
      } else if (data.length === 0) {
        setCurrent(null);
      }
    } catch {
      /* swallow network errors */
    }
  }, [fetchWithAuth, current]);

  useEffect(() => {
    void fetchPending();
    const interval = setInterval(() => { void fetchPending(); }, 30000);
    const onFocus = () => { void fetchPending(); };
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(interval); window.removeEventListener("focus", onFocus); };
  }, [fetchPending]);

  if (!current) return null;

  const delta = current.newScore - current.previousScore;
  const stageColor = current.stage === "Hot"
    ? "bg-purple-500/20 text-purple-300 border-purple-500/40"
    : "bg-blue-500/20 text-blue-300 border-blue-500/40";

  const handleApprove = async () => {
    setActing(true);
    try {
      const res = await fetchWithAuth(`/api/leads/qualification/${current.id}/approve`, { method: "POST" });
      if (res.ok) {
        const data = await res.json() as { opportunityId: number };
        navigate(`/crm/opportunities/${data.opportunityId}`);
        setCurrent(null);
        void fetchPending();
      }
    } finally {
      setActing(false);
    }
  };

  const handleReject = async () => {
    setActing(true);
    try {
      const res = await fetchWithAuth(`/api/leads/qualification/${current.id}/reject`, { method: "POST" });
      if (res.ok) {
        void fetchPending();
        setCurrent(null);
      }
    } finally {
      setActing(false);
    }
  };

  const handleSnooze = async () => {
    setActing(true);
    try {
      const res = await fetchWithAuth(`/api/leads/qualification/${current.id}/snooze`, { method: "POST" });
      if (res.ok) {
        void fetchPending();
        setCurrent(null);
      }
    } finally {
      setActing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Modal */}
      <div className="relative w-full max-w-xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-5 pb-4 border-b border-border bg-background">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[10px] font-black uppercase tracking-widest px-2 py-0.5 rounded border ${stageColor}`}>
                  {current.stage}
                </span>
                <span className="text-xs text-muted-foreground">Lead Qualification</span>
              </div>
              <h2 className="text-lg font-bold text-foreground">
                {current.lead?.name ?? `Lead #${current.leadId}`}
              </h2>
              {current.lead?.company && (
                <p className="text-sm text-muted-foreground mt-0.5">{current.lead.company}</p>
              )}
            </div>
            {pending.length > 1 && (
              <span className="flex-shrink-0 text-xs font-semibold px-2 py-1 rounded-full bg-accent text-muted-foreground">
                {pending.length} pending
              </span>
            )}
          </div>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Score summary */}
          <div className="bg-background rounded-xl p-4">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Qualification Score</p>
                <div className="flex items-center gap-3">
                  <span className="text-3xl font-black text-foreground">{current.newScore}</span>
                  <span className="text-sm text-muted-foreground">/ 100</span>
                  {current.previousScore > 0 && (
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${delta >= 0 ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>
                      {delta >= 0 ? "+" : ""}{delta} from {current.previousScore}
                    </span>
                  )}
                </div>
              </div>
              <div className="w-16 h-16 relative">
                <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                  <circle cx="18" cy="18" r="15.9155" fill="none" stroke="#232A36" strokeWidth="3" />
                  <circle
                    cx="18" cy="18" r="15.9155" fill="none"
                    stroke={current.newScore >= 75 ? "#7C3AED" : "#2F6FED"}
                    strokeWidth="3"
                    strokeDasharray={`${current.newScore} ${100 - current.newScore}`}
                    strokeLinecap="round"
                  />
                </svg>
                <span className="absolute inset-0 flex items-center justify-center text-xs font-black text-foreground">
                  {current.newScore}%
                </span>
              </div>
            </div>

            <div className="space-y-3">
              <SubScoreBar label="Fit" score={current.scoreFit} max={25} color="bg-sky-500" />
              <SubScoreBar label="Pain" score={current.scorePain} max={30} color="bg-orange-500" />
              <SubScoreBar label="Maturity" score={current.scoreMaturity} max={20} color="bg-emerald-500" />
              <SubScoreBar label="Intent" score={current.scoreIntent} max={15} color="bg-violet-500" />
              <SubScoreBar label="Urgency" score={current.scoreUrgency} max={10} color="bg-rose-500" />
            </div>
          </div>

          {/* Evidence */}
          {current.evidence.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Evidence</p>
              <ul className="space-y-1.5">
                {current.evidence.map((item, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                    <span className="text-sm text-foreground/90">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Recommended next step */}
          {current.recommendedNextStep && (
            <div className="flex items-center gap-3 bg-primary/10 border border-primary/30 rounded-xl px-4 py-3">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-4 h-4 text-primary flex-shrink-0">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-primary mb-0.5">Recommended Next Step</p>
                <p className="text-sm font-semibold text-foreground">{current.recommendedNextStep}</p>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-6 pb-5 pt-4 border-t border-border space-y-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold text-center">
            Action required — this modal cannot be dismissed without a decision
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => void handleApprove()}
              disabled={acting}
              className="flex-1 bg-primary hover:bg-primary/90 disabled:opacity-50 text-white font-bold py-2.5 rounded-xl text-sm transition-colors"
            >
              {acting ? "Processing…" : "✓ Approve & Create Opportunity"}
            </button>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => void handleReject()}
              disabled={acting}
              className="flex-1 bg-red-500/15 hover:bg-red-500/25 disabled:opacity-50 text-red-400 font-semibold py-2 rounded-xl text-sm transition-colors border border-red-500/30"
            >
              ✕ Reject — Return to Nurture
            </button>
            <button
              onClick={() => void handleSnooze()}
              disabled={acting}
              className="flex-1 bg-accent hover:bg-border disabled:opacity-50 text-muted-foreground font-semibold py-2 rounded-xl text-sm transition-colors"
            >
              ⏸ Decide Later (24h)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
