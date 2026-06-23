import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { cn } from "@/lib/utils";
import { CheckCircle, Loader2, AlertTriangle, ArrowRight, Link2, Check } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────
interface CategoryConfig { key: string; label: string; }

interface QuizResultsData {
  name: string;
  totalScore: number;
  tier: string;
  quizType: string;
  categoryScores: Record<string, number>;
  categoryConfig: CategoryConfig[];
  recommendedService: string | null;
  reportName: string;
  whatThisMeans: string;
  whyThisFits: string;
  roiProjection: string;
  createdAt: string;
}

// ─── Tier colours ─────────────────────────────────────────────────────────────
const TIER_COLOURS: Record<string, string> = {
  Beginner: "bg-red-500",
  Developing: "bg-orange-500",
  Emerging: "bg-yellow-500",
  Advanced: "bg-blue-500",
  Ready: "bg-teal-500",
};

// ─── Score bar ────────────────────────────────────────────────────────────────
function ScoreBar({ score, label }: { score: number; label: string }) {
  const pct = (score / 10) * 100;
  const colour = score >= 7 ? "bg-teal-400" : score >= 4 ? "bg-[#0078D4]" : "bg-red-400";
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span className="text-white/80">{label}</span>
        <span className="text-white font-semibold">{score}/10</span>
      </div>
      <div className="h-2 bg-white/10 rounded-full overflow-hidden">
        <div className={cn("h-full rounded-full transition-all duration-700", colour)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function QuizResultsPage() {
  const params = useParams<{ leadId: string }>();
  const leadId = params.leadId;
  const token = new URLSearchParams(window.location.search).get("token") ?? "";

  const [data, setData] = useState<QuizResultsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!leadId || !token) {
      setError("This link is missing required parameters.");
      setLoading(false);
      return;
    }
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    fetch(`${base}/api/quiz/results/${leadId}?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          if (res.status === 403) throw new Error("This link has expired or is invalid. Quiz result links are valid for 7 days.");
          if (res.status === 404) throw new Error("Results not found. The quiz record may have been removed.");
          throw new Error(body.error ?? "Failed to load results.");
        }
        return res.json() as Promise<QuizResultsData>;
      })
      .then((d) => setData(d))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load results."))
      .finally(() => setLoading(false));
  }, [leadId, token]);

  function copyLink() {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = url;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  const tierColour = data ? (TIER_COLOURS[data.tier] ?? "bg-blue-500") : "bg-blue-500";

  return (
    <Layout>
      <SEOMeta
        title={data ? `${data.name}'s ${data.reportName} | Shane McCaw Consulting` : "Quiz Results | Shane McCaw Consulting"}
        description="View your Microsoft 365 maturity assessment results from Shane McCaw Consulting."
      />

      <div className="min-h-screen bg-[#0A2540] pt-24 pb-16">
        <div className="max-w-2xl mx-auto px-4 sm:px-6">

          {/* Loading */}
          {loading && (
            <div className="flex flex-col items-center justify-center py-24 space-y-4">
              <Loader2 className="w-10 h-10 text-[#0078D4] animate-spin" />
              <p className="text-white/60 text-sm">Loading your results…</p>
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div className="flex flex-col items-center justify-center py-24 space-y-4 text-center">
              <AlertTriangle className="w-10 h-10 text-red-400" />
              <h1 className="text-white font-bold text-xl">Results Unavailable</h1>
              <p className="text-white/60 text-sm max-w-md">{error}</p>
              <a
                href="/contact"
                className="mt-4 px-5 py-2.5 bg-[#0078D4] hover:bg-[#0078D4]/90 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                Contact Shane
              </a>
            </div>
          )}

          {/* Results */}
          {!loading && data && (
            <div className="space-y-6">

              {/* Header */}
              <div className="text-center space-y-2">
                <CheckCircle className="w-10 h-10 text-teal-400 mx-auto" />
                <h1 className="text-2xl font-bold text-white">{data.reportName}</h1>
                <p className="text-white/50 text-sm">
                  Results for <span className="text-white font-medium">{data.name}</span>
                  {data.createdAt && (
                    <> &middot; {new Date(data.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</>
                  )}
                </p>
              </div>

              {/* Share / copy link */}
              <div className="flex justify-center">
                <button
                  onClick={copyLink}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all border",
                    copied
                      ? "bg-teal-500/10 border-teal-500/30 text-teal-400"
                      : "bg-white/5 border-white/20 text-white/70 hover:bg-white/10 hover:text-white"
                  )}
                >
                  {copied ? <Check className="w-4 h-4" /> : <Link2 className="w-4 h-4" />}
                  {copied ? "Link copied!" : "Copy share link"}
                </button>
              </div>

              {/* Score overview */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-1">Total Score</p>
                    <p className="text-white font-bold text-3xl">
                      {data.totalScore}<span className="text-white/40 text-lg font-normal">/50</span>
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-1">Maturity Tier</p>
                    <span className={cn("inline-block text-white text-sm font-bold px-3 py-1.5 rounded-full", tierColour)}>
                      {data.tier}
                    </span>
                  </div>
                </div>
                <div className="space-y-3 pt-3 border-t border-white/10">
                  {data.categoryConfig.map((cat) => (
                    <ScoreBar
                      key={cat.key}
                      label={cat.label}
                      score={data.categoryScores[cat.key] ?? 0}
                    />
                  ))}
                </div>
              </div>

              {/* What this means */}
              {data.whatThisMeans && (
                <div className="bg-white/5 border border-white/10 rounded-2xl p-6 space-y-2">
                  <p className="text-white/50 text-xs font-semibold uppercase tracking-wider">What This Means For You</p>
                  <p className="text-white/80 text-sm leading-relaxed">{data.whatThisMeans}</p>
                </div>
              )}

              {/* Recommended service / why it fits */}
              {data.recommendedService && (
                <div className="bg-[#0078D4]/10 border border-[#0078D4]/30 rounded-2xl p-6 space-y-3">
                  <p className="text-[#0078D4] text-xs font-bold uppercase tracking-wider">Recommended Next Step</p>
                  <p className="text-white font-bold text-base">{data.recommendedService}</p>
                  {data.whyThisFits && (
                    <p className="text-white/70 text-sm leading-relaxed">{data.whyThisFits}</p>
                  )}
                  <div className="flex flex-col sm:flex-row gap-2 pt-1">
                    <a
                      href="/contact"
                      className="flex-1 py-2.5 px-4 bg-[#0078D4] hover:bg-[#0078D4]/90 text-white font-semibold rounded-lg text-sm transition-colors flex items-center justify-center gap-1.5"
                    >
                      Discuss My Results <ArrowRight className="w-3.5 h-3.5" />
                    </a>
                    <a
                      href="/book"
                      className="flex-1 py-2.5 px-4 border border-white/20 hover:border-white/40 text-white/80 hover:text-white font-semibold rounded-lg text-sm transition-colors flex items-center justify-center gap-1.5"
                    >
                      Book a Free Call
                    </a>
                  </div>
                </div>
              )}

              {/* ROI projection */}
              {data.roiProjection && (
                <div className="bg-white/5 border border-white/10 rounded-2xl p-6">
                  <p className="text-white/50 text-xs font-semibold uppercase tracking-wider mb-2">ROI Projection</p>
                  <p className="text-white/80 text-sm leading-relaxed">{data.roiProjection}</p>
                </div>
              )}

              {/* Footer attribution */}
              <p className="text-center text-white/30 text-xs pt-2">
                Powered by{" "}
                <a href="/" className="text-white/50 hover:text-white transition-colors underline underline-offset-2">
                  Shane McCaw Consulting
                </a>{" "}
                &middot; Report link expires after 7 days
              </p>

            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
