import { useEffect, useState } from "react";
import { useParams } from "wouter";

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

interface SharedData {
  scoresSnapshot: Partial<Record<string, number>>;
  latestDate: string | null;
  expiresAt: string;
}

export default function SharedResultsPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<SharedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setError("Invalid link"); setLoading(false); return; }
    fetch(`/api/portal/quick-win/shared/${encodeURIComponent(token)}`)
      .then(r => {
        if (r.status === 410) throw new Error("expired");
        if (!r.ok) throw new Error("not_found");
        return r.json() as Promise<SharedData>;
      })
      .then(d => setData(d))
      .catch(e => setError(e instanceof Error ? e.message : "error"))
      .finally(() => setLoading(false));
  }, [token]);

  const scores = data?.scoresSnapshot ?? {};
  const cats = Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>;
  const scoredCats = cats.filter(k => scores[k] !== undefined);
  const overallScore = scoredCats.length > 0
    ? Math.round(scoredCats.reduce((acc, k) => acc + (scores[k] ?? 0), 0) / scoredCats.length)
    : 0;

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

  if (error || !data) {
    const isExpired = error === "expired";
    return (
      <div className="min-h-screen bg-[#0A2540] flex flex-col items-center justify-center px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center mb-6">
          <svg className="w-8 h-8 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <h1 className="text-2xl font-extrabold text-white mb-2">
          {isExpired ? "Link Expired" : "Link Not Found"}
        </h1>
        <p className="text-sm text-white/60 mb-8 max-w-sm leading-relaxed">
          {isExpired
            ? "This share link is only valid for 30 days. Ask your colleague to generate a new one from their portal."
            : "This link doesn't exist or has been removed."}
        </p>
        <a
          href="https://shanemccawconsulting.com"
          className="inline-flex items-center gap-2 bg-[#0078D4] text-white font-semibold px-6 py-3 rounded-xl text-sm hover:bg-[#0053a0] transition-colors"
        >
          Visit Shane McCaw Consulting
        </a>
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
            <p className="text-[10px] text-white/40">Microsoft 365 Diagnostic</p>
          </div>
        </div>
        <div className="inline-flex items-center gap-1.5 bg-white/5 border border-white/10 text-white/50 text-[10px] font-semibold uppercase tracking-widest px-3 py-1 rounded-full">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
          Read only
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 sm:py-12 space-y-8">

          {/* Hero score section */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
              <OverallRing score={overallScore} />
              <div className="text-center sm:text-left">
                <div className="inline-flex items-center gap-1.5 bg-[#0078D4]/20 text-[#00B4D8] text-[10px] font-bold uppercase tracking-widest px-3 py-1 rounded-full border border-[#0078D4]/30 mb-3">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                  Diagnostic Results
                </div>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-white mb-2 leading-tight">
                  M365 Security Score: {overallScore}/100
                </h1>
                <p className="text-sm text-white/60 leading-relaxed max-w-lg">
                  {`We scanned ${scoredCats.length} critical areas of this Microsoft 365 tenant. ${criticalCats.length > 0 ? `${criticalCats.length} area${criticalCats.length > 1 ? "s" : ""} require immediate attention.` : attentionCats.length > 0 ? `${attentionCats.length} area${attentionCats.length > 1 ? "s" : ""} need improvement.` : "The environment is in good shape."}`}
                </p>
                {data.latestDate && (
                  <p className="text-[11px] text-white/30 mt-2">
                    Scanned {new Date(data.latestDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                  </p>
                )}
                <p className="text-[11px] text-white/20 mt-1">
                  Link expires {new Date(data.expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                </p>
              </div>
            </div>

            {/* Category score bars */}
            {scoredCats.length > 0 && (
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

          {/* Risks section */}
          {risksToShow.length > 0 && (
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

          {/* CTA */}
          <div className="bg-gradient-to-br from-[#0078D4] to-[#0053a0] rounded-2xl p-7 text-center">
            <h2 className="text-xl font-extrabold text-white mb-2">Need expert help fixing these findings?</h2>
            <p className="text-sm text-white/70 mb-6 max-w-md mx-auto leading-relaxed">
              Shane McCaw is a 30-year Microsoft 365 veteran and Lead Architect. He can remediate every finding and get your tenant secure within one business day.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <a
                href="/book"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 bg-white text-[#0078D4] font-bold px-8 py-3 rounded-xl hover:bg-white/90 transition-colors text-sm w-full sm:w-auto"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Book a Strategy Call
              </a>
              <a
                href="/"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 text-white font-semibold px-6 py-3 rounded-xl transition-colors text-sm border border-white/20 w-full sm:w-auto"
              >
                Learn More
              </a>
            </div>
          </div>

          {/* Footer */}
          <p className="text-center text-xs text-white/30 pb-4">
            Prepared by{" "}
            <a href="/" target="_blank" rel="noopener noreferrer" className="text-white/50 hover:text-white/70 underline transition-colors">
              Shane McCaw Consulting
            </a>
            {" "}· Questions?{" "}
            <a href="mailto:shane@shanemccawconsulting.com" className="text-white/50 hover:text-white/70 underline transition-colors">
              shane@shanemccawconsulting.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
