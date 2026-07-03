import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";

interface ScorecardHistory {
  hasData: boolean;
  firstDate?: string;
  latestDate?: string;
  first?: Partial<Record<string, number>>;
  latest?: Partial<Record<string, number>>;
}

const CATEGORY_LABELS: Record<string, string> = {
  security: "Security Posture",
  compliance: "Compliance Coverage",
  copilot: "Copilot Readiness",
  governance: "Governance Maturity",
  productivity: "Adoption Score",
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  security: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  ),
  compliance: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  ),
  copilot: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
    </svg>
  ),
  governance: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  ),
  productivity: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  ),
};

function scoreColor(s: number) {
  if (s >= 70) return { ring: "#22c55e", text: "text-green-400", bar: "bg-green-500", badge: "bg-green-500/20 text-green-300 border-green-500/30", label: "Healthy" };
  if (s >= 40) return { ring: "#f59e0b", text: "text-amber-400", bar: "bg-amber-400", badge: "bg-amber-400/20 text-amber-300 border-amber-400/30", label: "Needs Work" };
  return { ring: "#ef4444", text: "text-red-400", bar: "bg-red-500", badge: "bg-red-500/20 text-red-300 border-red-500/30", label: "Critical" };
}

function OverallRing({ score }: { score: number }) {
  const size = 120;
  const r = size / 2 - 10;
  const circ = 2 * Math.PI * r;
  const cx = size / 2;
  const c = scoreColor(score);
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={cx} cy={cx} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
        <circle cx={cx} cy={cx} r={r} fill="none" stroke={c.ring} strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${(score / 100) * circ} ${circ}`}
          style={{ transition: "stroke-dasharray 1s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-black text-white leading-none">{score}</span>
        <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest mt-0.5">/ 100</span>
      </div>
    </div>
  );
}

function CategoryBar({ label, score, icon }: { label: string; score: number; icon: React.ReactNode }) {
  const c = scoreColor(score);
  return (
    <div className="flex items-center gap-3">
      <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0 text-white/60">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-semibold text-white/80 truncate">{label}</span>
          <span className={`text-xs font-bold ml-2 flex-shrink-0 ${c.text}`}>{score}%</span>
        </div>
        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div
            className={`h-1.5 rounded-full ${c.bar} transition-all duration-700`}
            style={{ width: `${score}%` }}
          />
        </div>
      </div>
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${c.badge} flex-shrink-0`}>
        {c.label}
      </span>
    </div>
  );
}

const RISK_THRESHOLDS: Array<{ key: string; label: string; risk: string; detail: string }> = [
  {
    key: "security",
    label: "Identity & Access Risks",
    risk: "Without MFA and conditional access policies enforced, accounts are vulnerable to credential-stuffing and phishing attacks.",
    detail: "A full engagement includes MFA remediation, Conditional Access baseline deployment, and privileged identity hardening.",
  },
  {
    key: "compliance",
    label: "Compliance Gaps",
    risk: "Unmanaged retention labels and incomplete DLP policies expose your organisation to data breach liability and audit failures.",
    detail: "A full project remediates retention policies, configures DLP rules, and produces audit-ready compliance documentation.",
  },
  {
    key: "copilot",
    label: "Copilot Readiness Blockers",
    risk: "Overshared SharePoint sites and missing sensitivity labels will cause Copilot to surface confidential data to the wrong users.",
    detail: "Shane's Copilot readiness engagement scopes permissions, applies sensitivity labels, and prepares your tenant for safe Copilot rollout.",
  },
  {
    key: "governance",
    label: "Governance Maturity Gaps",
    risk: "Ungoverned M365 groups and Teams sprawl increase your attack surface and create compliance risk.",
    detail: "A governance project establishes lifecycle policies, naming conventions, and automated expiry for teams and groups.",
  },
];

interface EngagementStatus {
  hasActiveEngagement: boolean;
}

interface PresentationInfo {
  id: number;
  status: "draft" | "signed" | "paid";
  totalPrice: string | null;
  createdAt: string;
}

const POLL_INTERVAL_MS = 30_000;

export default function QuickWinOnboardingResults() {
  const { fetchWithAuth, user } = useAuth();
  const [, navigate] = useLocation();

  interface ActiveShare {
    shareUrl: string;
    expiresAt: string;
    createdAt: string;
  }

  const [scorecard, setScorecard] = useState<ScorecardHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [presentation, setPresentation] = useState<PresentationInfo | null | undefined>(undefined);
  const [shareLoading, setShareLoading] = useState(false);
  const [activeShare, setActiveShare] = useState<ActiveShare | null | undefined>(undefined);
  const [shareCopied, setShareCopied] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [retrying, setRetrying] = useState(false);

  // On mount, if the client has no App Registration credentials redirect them
  // back to the wizard start so they can enter credentials before reviewing results.
  useEffect(() => {
    fetchWithAuth("/api/portal/onboarding/wizard-status")
      .then(r => r.ok ? (r.json() as Promise<{ hasCredentials?: boolean }>) : { hasCredentials: true })
      .then(data => {
        if (!data.hasCredentials) {
          sessionStorage.removeItem("onboarding-wizard-step");
          navigate("/portal/onboarding/wizard");
        }
      })
      .catch(() => { /* non-fatal — stay on page */ });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    Promise.all([
      fetchWithAuth("/api/portal/m365-scorecard-history")
        .then(r => r.ok ? (r.json() as Promise<ScorecardHistory>) : Promise.resolve({ hasData: false }))
        .catch(() => ({ hasData: false } as ScorecardHistory)),
      fetchWithAuth("/api/portal/quick-win/share-results")
        .then(r => r.ok ? (r.json() as Promise<{ share: ActiveShare | null }>) : Promise.resolve({ share: null }))
        .then(d => d.share)
        .catch(() => null),
      fetchWithAuth("/api/portal/presentations/latest")
        .then(r => r.ok ? (r.json() as Promise<{ presentation: PresentationInfo | null }>) : Promise.resolve({ presentation: null }))
        .then(d => d.presentation)
        .catch(() => null),
    ]).then(([sc, share, pres]) => {
      setScorecard(sc);
      setActiveShare(share);
      setPresentation(pres);
    }).finally(() => setLoading(false));
  }, [fetchWithAuth]);

  // Poll wizard-status every 30 s so the gate lifts automatically the moment
  // Shane activates the client's service — no manual navigation needed.
  useEffect(() => {
    let active = true;

    async function checkStatus() {
      try {
        const r = await fetchWithAuth("/api/portal/onboarding/wizard-status");
        if (!active) return;
        if (r.ok) {
          const data = await r.json() as EngagementStatus;
          if (data.hasActiveEngagement) {
            active = false;
            navigate("/portal");
          }
        }
      } catch {
        // Network error — silently ignore, retry next interval
      }
    }

    const id = setInterval(checkStatus, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(id);
    };
  }, [fetchWithAuth, navigate]);

  async function generateShareLink(isRegenerate = false) {
    if (isRegenerate) setRegenerating(true);
    else setShareLoading(true);
    setShareError(null);
    try {
      const res = await fetchWithAuth("/api/portal/quick-win/share-results", { method: "POST" });
      if (!res.ok) {
        const body = await res.json() as { error?: string };
        throw new Error(body.error ?? "Failed to generate link");
      }
      const data = await res.json() as { shareUrl: string; expiresAt: string };
      setActiveShare({ shareUrl: data.shareUrl, expiresAt: data.expiresAt, createdAt: new Date().toISOString() });
      setShareCopied(false);
    } catch (e) {
      setShareError(e instanceof Error ? e.message : "Failed to generate link");
    } finally {
      setShareLoading(false);
      setRegenerating(false);
    }
  }

  async function copyShareLink() {
    if (!activeShare?.shareUrl) return;
    try {
      await navigator.clipboard.writeText(activeShare.shareUrl);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2500);
    } catch {
      /* clipboard unavailable — show URL instead */
    }
  }

  async function handleRetryDiagnostic() {
    setRetrying(true);
    try {
      await fetchWithAuth("/api/portal/onboarding/wizard-reset", { method: "POST" });
    } catch {
      // Non-fatal — navigate anyway
    }
    sessionStorage.removeItem("onboarding-wizard-step");
    navigate("/portal/diagnostic");
  }

  const scores = scorecard?.latest ?? {};
  const cats = Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>;

  const scoredCats = cats.filter(k => scores[k] !== undefined);
  const overallScore = scoredCats.length > 0
    ? Math.round(scoredCats.reduce((acc, k) => acc + (scores[k] ?? 0), 0) / scoredCats.length)
    : 0;

  const hasData = scorecard?.hasData && scoredCats.length > 0;

  const criticalCats = scoredCats.filter(k => (scores[k] ?? 0) < 40);
  const attentionCats = scoredCats.filter(k => { const s = scores[k] ?? 0; return s >= 40 && s < 70; });

  const risksToShow = RISK_THRESHOLDS.filter(r => (scores[r.key] ?? 100) < 70).slice(0, 3);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0A2540] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#0078D4] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A2540] flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#0078D4] flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <div>
            <p className="text-xs font-bold text-white leading-tight">Shane McCaw</p>
            <p className="text-[10px] text-white/40">Consulting Portal</p>
          </div>
        </div>
        {user?.name && (
          <p className="text-xs text-white/40 hidden sm:block">Welcome back, <span className="text-white/70 font-semibold">{user.name}</span></p>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-8">

          {/* ═══════════════════════════════════════════════════════════════
              PRESENTATION HERO — the #1 CTA on this page
          ════════════════════════════════════════════════════════════════ */}
          {presentation ? (
            <div
              className="relative overflow-hidden rounded-3xl p-8 sm:p-12 text-center"
              style={{
                background: "linear-gradient(135deg, #0A2540 0%, #0f3460 40%, #0078D4 100%)",
                boxShadow: "0 0 0 1px rgba(0,180,216,0.25), 0 30px 80px -20px rgba(0,120,212,0.45)",
              }}
            >
              {/* Glow orb behind CTA button */}
              <div
                className="absolute left-1/2 -translate-x-1/2 bottom-0 pointer-events-none"
                style={{
                  width: 480,
                  height: 200,
                  background: "radial-gradient(ellipse, rgba(0,180,216,0.22) 0%, transparent 70%)",
                  filter: "blur(10px)",
                }}
              />

              {/* Badge */}
              <div className="inline-flex items-center gap-2 bg-[#00B4D8]/20 border border-[#00B4D8]/40 text-[#00B4D8] text-xs font-bold uppercase tracking-widest px-4 py-1.5 rounded-full mb-6">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Your personalised report is ready
              </div>

              {/* Heading */}
              <h2 className="text-3xl sm:text-5xl font-black text-white leading-tight mb-4 tracking-tight">
                See Your Full<br />
                <span style={{ color: "#00B4D8" }}>M365 Report</span>
              </h2>

              <p className="text-base sm:text-lg text-white/70 mb-10 max-w-lg mx-auto leading-relaxed">
                Shane has reviewed your diagnostic and built a personalised proposal — including your remediation roadmap, pricing, and everything your team needs to get started.
              </p>

              {/* Monster CTA button */}
              <button
                onClick={() => navigate(`/portal/presentation/${presentation.id}`)}
                className="group relative inline-flex items-center justify-center gap-3 px-10 py-5 rounded-2xl font-black text-lg sm:text-xl transition-all duration-200 hover:scale-105 active:scale-100"
                style={{
                  background: "linear-gradient(135deg, #00B4D8 0%, #0078D4 100%)",
                  boxShadow: "0 8px 32px rgba(0,120,212,0.5), 0 2px 8px rgba(0,0,0,0.4)",
                  color: "#fff",
                }}
              >
                <svg className="w-6 h-6 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                </svg>
                Open My Report
                <svg className="w-5 h-5 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
              </button>

              {presentation.status === "draft" && (
                <p className="mt-5 text-sm text-white/40">
                  Review your findings, select your engagement scope, and sign off — all in one place.
                </p>
              )}
              {presentation.status === "signed" && (
                <p className="mt-5 text-sm text-[#00B4D8]/80 font-semibold">
                  ✓ You've signed — view your confirmed engagement details.
                </p>
              )}
              {presentation.status === "paid" && (
                <p className="mt-5 text-sm text-green-400 font-semibold">
                  ✓ Payment confirmed — your project is underway.
                </p>
              )}
            </div>
          ) : presentation === null ? (
            /* No presentation yet — show a "coming soon" placeholder that still
               sells the idea and prompts them to book a call in the meantime. */
            <div
              className="relative overflow-hidden rounded-3xl p-8 sm:p-10 text-center"
              style={{
                background: "linear-gradient(135deg, #0A2540 0%, #0f3460 100%)",
                boxShadow: "0 0 0 1px rgba(255,255,255,0.08)",
              }}
            >
              {/* Animated pulse ring */}
              <div className="mx-auto mb-6 w-16 h-16 relative flex-shrink-0">
                <div className="absolute inset-0 rounded-full bg-[#0078D4]/20 animate-ping" />
                <div className="relative w-full h-full rounded-full bg-[#0078D4]/30 border border-[#0078D4]/50 flex items-center justify-center">
                  <svg className="w-7 h-7 text-[#00B4D8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
              </div>

              <h2 className="text-2xl sm:text-3xl font-extrabold text-white mb-3 leading-tight">
                Shane is building your personalised report
              </h2>
              <p className="text-sm text-white/60 mb-6 max-w-md mx-auto leading-relaxed">
                Based on your diagnostic results, Shane is preparing a tailored proposal with your remediation roadmap and engagement pricing. You'll be notified when it's ready.
              </p>
              <a
                href="/book"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-[#0078D4] hover:bg-[#0053a0] text-white font-bold px-7 py-3 rounded-xl transition-colors text-sm"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Book a call in the meantime
              </a>
            </div>
          ) : null /* still loading — spinner shown by outer loading gate */}

          {/* Hero score section */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
              {hasData ? (
                <OverallRing score={overallScore} />
              ) : (
                <div className="w-28 h-28 rounded-full bg-white/10 flex items-center justify-center flex-shrink-0">
                  <svg className="w-10 h-10 text-white/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                </div>
              )}
              <div className="text-center sm:text-left">
                {hasData ? (
                  <div className="inline-flex items-center gap-1.5 bg-[#0078D4]/20 text-[#00B4D8] text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full border border-[#0078D4]/30 mb-3">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                    Diagnostic Complete
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-1.5 bg-amber-500/20 text-amber-300 text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full border border-amber-500/30 mb-3">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
                    Diagnostic Incomplete
                  </div>
                )}
                <h1 className="text-2xl sm:text-3xl font-extrabold text-white mb-2 leading-tight">
                  {hasData
                    ? `Your M365 Security Score: ${overallScore}/100`
                    : "Diagnostic Didn't Complete"}
                </h1>
                <p className="text-sm text-white/60 leading-relaxed max-w-lg">
                  {hasData
                    ? `We scanned ${scoredCats.length} critical areas of your Microsoft 365 tenant. ${criticalCats.length > 0 ? `${criticalCats.length} area${criticalCats.length > 1 ? "s" : ""} require immediate attention.` : attentionCats.length > 0 ? `${attentionCats.length} area${attentionCats.length > 1 ? "s" : ""} need improvement.` : "Your environment is in good shape."}`
                    : "The diagnostic encountered an issue before it could finish — this can happen if Azure credentials aren't configured yet, or if there was a temporary network interruption. Shane has been notified and will follow up with your results."}
                </p>
                {!hasData && (
                  <button
                    onClick={() => void handleRetryDiagnostic()}
                    disabled={retrying}
                    className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0078D4] hover:bg-[#005a9e] disabled:opacity-60 text-white text-sm font-semibold transition-colors"
                  >
                    {retrying ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                        </svg>
                        Starting…
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Run diagnostic again
                      </>
                    )}
                  </button>
                )}
                {scorecard?.latestDate && (
                  <p className="text-[11px] text-white/30 mt-2">
                    Scanned {new Date(scorecard.latestDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  </p>
                )}
              </div>
            </div>

            {/* Category score bars */}
            {hasData && (
              <div className="mt-6 pt-6 border-t border-white/10 space-y-3">
                {scoredCats.map(key => (
                  <CategoryBar
                    key={key}
                    label={CATEGORY_LABELS[key]}
                    score={scores[key] ?? 0}
                    icon={CATEGORY_ICONS[key]}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Share results */}
          {hasData && (
            <div className="bg-white/5 border border-white/10 rounded-2xl p-5">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-[#0078D4]/20 flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-[#00B4D8]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                    </svg>
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white leading-tight">Share these results</p>
                    <p className="text-xs text-white/50 leading-snug">
                      {activeShare
                        ? `Link active · expires ${new Date(activeShare.expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                        : "Generate a read-only link for your IT team, manager, or board. Valid for 30 days."}
                    </p>
                  </div>
                </div>
                {!activeShare ? (
                  <button
                    onClick={() => generateShareLink(false)}
                    disabled={shareLoading || activeShare === undefined}
                    className="flex items-center justify-center gap-2 bg-[#0078D4] hover:bg-[#0053a0] disabled:opacity-60 text-white font-semibold px-5 py-2.5 rounded-xl text-xs transition-colors flex-shrink-0 w-full sm:w-auto"
                  >
                    {shareLoading ? (
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                      </svg>
                    )}
                    {shareLoading ? "Generating…" : "Generate link"}
                  </button>
                ) : (
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                    <div className="flex items-center gap-2 flex-1 sm:w-auto min-w-0">
                      <div className="flex-1 sm:w-52 min-w-0 bg-black/30 border border-white/20 rounded-lg px-3 py-2 flex items-center gap-2">
                        <span className="text-xs text-white/60 truncate flex-1 min-w-0">{activeShare.shareUrl}</span>
                      </div>
                      <button
                        onClick={copyShareLink}
                        className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white text-xs font-semibold px-3 py-2 rounded-lg border border-white/20 transition-colors flex-shrink-0"
                      >
                        {shareCopied ? (
                          <>
                            <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                            Copied!
                          </>
                        ) : (
                          <>
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                            Copy
                          </>
                        )}
                      </button>
                    </div>
                    <button
                      onClick={() => generateShareLink(true)}
                      disabled={regenerating}
                      title="Revoke this link and generate a fresh one"
                      className="flex items-center justify-center gap-1.5 bg-white/8 hover:bg-white/15 disabled:opacity-60 text-white/60 hover:text-white text-xs font-semibold px-3 py-2 rounded-lg border border-white/15 transition-colors flex-shrink-0"
                    >
                      {regenerating ? (
                        <div className="w-3.5 h-3.5 border-2 border-white/60 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      )}
                      {regenerating ? "Regenerating…" : "Regenerate"}
                    </button>
                  </div>
                )}
              </div>
              {shareError && (
                <p className="mt-3 text-xs text-red-400">{shareError}</p>
              )}
              {activeShare && !shareError && (
                <p className="mt-3 text-[11px] text-white/30">Anyone with this link can view your scores until {new Date(activeShare.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}. Regenerating immediately revokes the old link.</p>
              )}
            </div>
          )}

          {/* Risks section */}
          {hasData && risksToShow.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-bold text-white/70 uppercase tracking-wider px-1">Key Risks Identified</h2>
              {risksToShow.map(risk => (
                <div key={risk.key} className="bg-red-500/10 border border-red-500/20 rounded-xl p-5">
                  <div className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-lg bg-red-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg className="w-3.5 h-3.5 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-red-300 mb-1">{risk.label}</p>
                      <p className="text-xs text-white/50 leading-relaxed mb-2">{risk.risk}</p>
                      <p className="text-xs text-white/70 leading-relaxed">{risk.detail}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* What a full engagement includes */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h2 className="text-sm font-bold text-white/70 uppercase tracking-wider mb-4">What a Full Project Unlocks</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                { icon: "🔐", title: "Remediation roadmap", desc: "Prioritised fix list with step-by-step guidance for every finding." },
                { icon: "📊", title: "Live project dashboard", desc: "Real-time Kanban board so you always know what's happening." },
                { icon: "🤖", title: "Automated scripts", desc: "PowerShell runbooks that apply fixes directly in your tenant." },
                { icon: "📞", title: "Expert hand-off call", desc: "Shane walks you through every finding and answers your questions." },
                { icon: "📄", title: "Compliance documentation", desc: "Audit-ready policies, retention schedules, and DLP configurations." },
                { icon: "🚀", title: "Copilot readiness prep", desc: "Permissions clean-up, sensitivity labels, and safe Copilot deployment." },
              ].map(item => (
                <div key={item.title} className="flex items-start gap-3 bg-white/5 rounded-xl p-4">
                  <span className="text-xl leading-none flex-shrink-0 mt-0.5">{item.icon}</span>
                  <div>
                    <p className="text-sm font-semibold text-white mb-0.5">{item.title}</p>
                    <p className="text-xs text-white/50 leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* CTA section */}
          {hasData ? (
            <div className="bg-gradient-to-br from-[#0078D4] to-[#0053a0] rounded-2xl p-7 text-center">
              <h2 className="text-xl font-extrabold text-white mb-2">Ready to fix what the diagnostic found?</h2>
              <p className="text-sm text-white/70 mb-6 max-w-md mx-auto leading-relaxed">
                Upgrade to a full project engagement and Shane will begin remediating your M365 environment within one business day.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  onClick={() => navigate("/portal/onboarding/select")}
                  className="flex items-center justify-center gap-2 bg-white text-[#0078D4] font-bold px-8 py-3 rounded-xl hover:bg-white/90 transition-colors text-sm w-full sm:w-auto"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Upgrade to Full Project
                </button>
                <a
                  href="/book"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white font-semibold px-6 py-3 rounded-xl transition-colors text-sm border border-white/20 w-full sm:w-auto"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Book a Strategy Call
                </a>
              </div>
            </div>
          ) : (
            <div className="bg-white/5 border border-amber-500/20 rounded-2xl p-7 text-center">
              <h2 className="text-xl font-extrabold text-white mb-2">What would you like to do next?</h2>
              <p className="text-sm text-white/60 mb-6 max-w-md mx-auto leading-relaxed">
                You can re-run the diagnostic once your Azure credentials are set up, or book a call and Shane will review your environment manually.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  onClick={() => navigate("/portal/diagnostic")}
                  className="flex items-center justify-center gap-2 bg-white text-[#0078D4] font-bold px-8 py-3 rounded-xl hover:bg-white/90 transition-colors text-sm w-full sm:w-auto"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Re-run diagnostic
                </button>
                <a
                  href="/book"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white font-semibold px-6 py-3 rounded-xl transition-colors text-sm border border-white/20 w-full sm:w-auto"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Book a Strategy Call
                </a>
              </div>
            </div>
          )}

          {/* Footer note */}
          <p className="text-center text-xs text-white/30 pb-4">
            Questions? Email{" "}
            <a href="mailto:shane@shanemccawconsulting.com" className="text-white/50 hover:text-white/70 underline transition-colors">
              shane@shanemccawconsulting.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
