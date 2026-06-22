import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { CTAButton } from "@/components/CTAButton";
import {
  CheckCircle,
  ArrowRight,
  RotateCcw,
  BarChart3,
  CalendarDays,
  Loader2,
  AlertCircle,
  TrendingUp,
  Star,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type QuizSlug =
  | "tenant-health-audit"
  | "power-platform-quick-start"
  | "governance-foundations"
  | "migration-readiness-assessment"
  | "copilot-readiness-assessment"
  | "m365-training-enablement";

interface Recommendation {
  rank: number;
  slug: string;
  score: number;
  name: string | null;
  tagline: string | null;
  price: string | null;
  pageHref: string | null;
  description: string | null;
}

interface QuizResult {
  id: number;
  answers: Record<string, number>;
  scores: Record<string, number>;
  rankedSlugs: string[];
  recommendations: Recommendation[];
  createdAt: string;
}

// ── Static fallback metadata (display only — names/hrefs when DB record is absent) ──

const SLUG_LABELS: Record<QuizSlug, string> = {
  "tenant-health-audit": "M365 Tenant Health Audit",
  "power-platform-quick-start": "Power Platform Quick-Start",
  "governance-foundations": "Governance Foundations Package",
  "migration-readiness-assessment": "Migration Readiness Assessment",
  "copilot-readiness-assessment": "Copilot for M365 Readiness Assessment",
  "m365-training-enablement": "Microsoft 365 Training & Enablement",
};

// ── Dimension labels for readiness profile ────────────────────────────────────

const DIMENSION_LABELS: Record<QuizSlug, string> = {
  "tenant-health-audit": "M365 Tenant Health",
  "power-platform-quick-start": "Power Platform Automation",
  "governance-foundations": "Governance",
  "migration-readiness-assessment": "Migration Readiness",
  "copilot-readiness-assessment": "AI & Copilot Readiness",
  "m365-training-enablement": "Training & Enablement",
};

const ALL_SLUGS: QuizSlug[] = [
  "tenant-health-audit",
  "power-platform-quick-start",
  "governance-foundations",
  "migration-readiness-assessment",
  "copilot-readiness-assessment",
  "m365-training-enablement",
];

// Max possible score per dimension across all 10 questions
const MAX_SCORE = 12;

function getScorePct(slug: string, scores: Record<string, number>): number {
  const raw = scores[slug] ?? 0;
  return Math.min(100, Math.round((raw / MAX_SCORE) * 100));
}

function getPackageName(rec: Recommendation): string {
  return rec.name ?? SLUG_LABELS[rec.slug as QuizSlug] ?? rec.slug;
}

function getPackageHref(rec: Recommendation): string {
  return rec.pageHref ?? `/micro-offers/${rec.slug}`;
}

// ── Dynamic narrative from scores ─────────────────────────────────────────────

function buildPersonalisedSummary(
  recommendations: Recommendation[],
  scores: Record<string, number>
): string {
  if (recommendations.length === 0) return "";

  const top = recommendations[0];
  const second = recommendations[1];
  const topName = getPackageName(top);
  const topPct = getScorePct(top.slug, scores);
  const topLabel = DIMENSION_LABELS[top.slug as QuizSlug] ?? top.slug;

  let strength: string;
  if (topPct >= 67) {
    strength = "a strong, clear signal";
  } else if (topPct >= 42) {
    strength = "a consistent signal";
  } else {
    strength = "an emerging signal";
  }

  let summary = `Your answers point to ${strength} in ${topLabel} (${topPct}% of the maximum score in that area). **${topName}** is the fastest path to measurable improvement in your environment.`;

  if (second) {
    const secondLabel = DIMENSION_LABELS[second.slug as QuizSlug] ?? second.slug;
    const secondName = getPackageName(second);
    const gap = top.score - second.score;
    if (gap <= 1) {
      summary += ` ${secondLabel} (${secondName}) scored almost as high — both areas deserve attention.`;
    } else {
      summary += ` ${secondLabel} is a secondary area to watch once your primary quick win is complete.`;
    }
  }

  return summary;
}

function getReadingIndicator(
  slug: QuizSlug,
  scores: Record<string, number>,
  recommendations: Recommendation[]
): string {
  const pct = getScorePct(slug, scores);
  const isPrimary = recommendations[0]?.slug === slug;
  const isSecondary = recommendations[1]?.slug === slug;

  if (isPrimary) return "Highest priority";
  if (isSecondary) return "Worth considering next";
  if (pct >= 30) return "Moderate signal";
  return "Low signal at this time";
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function QuickWinResultsPage() {
  const params = useParams<{ resultId: string }>();
  const resultId = params.resultId;

  const [result, setResult] = useState<QuizResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!resultId) {
      setError(true);
      setLoading(false);
      return;
    }

    fetch(`/api/quiz/quick-win/results/${resultId}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json() as Promise<QuizResult>;
      })
      .then((data) => {
        setResult(data);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [resultId]);

  if (loading) {
    return (
      <Layout>
        <SEOMeta
          title="Your Quick Win Results | Shane McCaw Consulting"
          description="Personalised Microsoft 365 Quick Win recommendations based on your quiz answers."
        />
        <section className="bg-[#0A2540] pt-32 pb-20">
          <div className="max-w-[1200px] mx-auto px-6 text-center">
            <Loader2 className="w-10 h-10 text-[#0078D4] animate-spin mx-auto" />
          </div>
        </section>
      </Layout>
    );
  }

  if (error || !result) {
    return (
      <Layout>
        <SEOMeta title="Results Not Found | Shane McCaw Consulting" description="" />
        <section className="bg-[#0A2540] pt-32 pb-20">
          <div className="max-w-[1200px] mx-auto px-6 text-center">
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
            <h1 className="text-2xl font-extrabold text-white mb-3">Results not found</h1>
            <p className="text-white/60 mb-8">This results link may have expired or is invalid.</p>
            <CTAButton href="/quick-win-quiz">Retake the Quiz</CTAButton>
          </div>
        </section>
      </Layout>
    );
  }

  const { scores, recommendations } = result;

  const topRecs = recommendations.filter((r) => r.score > 0);
  const primary = topRecs[0] ?? null;
  const secondaryRecs = topRecs.slice(1, 3);

  const summary = primary ? buildPersonalisedSummary(recommendations, scores) : "";

  // Split on **...** for bold rendering
  const summaryParts = summary.split(/\*\*(.+?)\*\*/g);

  return (
    <Layout>
      <SEOMeta
        title="Your M365 Quick Win Results | Shane McCaw Consulting"
        description="Personalised Microsoft 365 Quick Win recommendations based on your quiz answers."
      />

      {/* ── Hero ──────────────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] pt-32 pb-20 relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 800px 400px at 60% 0%, rgba(0,120,212,0.14) 0%, transparent 70%)",
          }}
        />
        <div className="max-w-[1200px] mx-auto px-6 relative text-center">
          <div className="inline-flex items-center gap-2 bg-[#0078D4]/20 text-[#60B4FF] px-4 py-1.5 rounded-full text-sm font-semibold mb-6">
            <CheckCircle className="w-4 h-4" />
            Quiz complete — results ready
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold text-white leading-tight max-w-3xl mx-auto">
            Your Personalised Quick Win Recommendations
          </h1>
          <p className="text-white/70 text-lg mt-5 max-w-xl mx-auto leading-relaxed">
            Based on your 10 answers, here's the fastest way to get measurable value from your
            Microsoft 365 environment.
          </p>
        </div>
      </section>

      {/* ── Personalised Summary ─────────────────────────────────────────────── */}
      {primary && (
        <section className="bg-white border-b border-border py-14">
          <div className="max-w-[760px] mx-auto px-6">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center">
                <Star className="w-5 h-5 text-[#0078D4]" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-[#0078D4] mb-2">
                  What your answers tell us
                </p>
                <p className="text-[#0A2540] text-base leading-relaxed">
                  {summaryParts.map((part, i) =>
                    i % 2 === 1 ? (
                      <strong key={i}>{part}</strong>
                    ) : (
                      <span key={i}>{part}</span>
                    )
                  )}
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── Primary Recommendation ────────────────────────────────────────────── */}
      {primary && (
        <section className="bg-[#F7F9FC] py-16">
          <div className="max-w-[900px] mx-auto px-6">
            <p className="text-xs font-bold uppercase tracking-widest text-[#0078D4] mb-5 text-center">
              Best Match
            </p>
            <div className="bg-white rounded-2xl border border-[#0078D4]/30 ring-2 ring-[#0078D4]/10 shadow-md p-8">
              <div className="flex flex-col md:flex-row md:items-start gap-6">
                <div className="flex-shrink-0 w-14 h-14 rounded-2xl bg-[#0A2540] flex items-center justify-center">
                  <span className="text-white font-extrabold text-xl">1</span>
                </div>
                <div className="flex-1 min-w-0">
                  <span className="inline-block text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-[#0078D4]/10 text-[#0078D4] border border-[#0078D4]/20 mb-3">
                    Primary Recommendation
                  </span>
                  <h2 className="text-xl font-extrabold text-[#0A2540] mb-2 leading-snug">
                    {getPackageName(primary)}
                  </h2>
                  {primary.tagline && (
                    <p className="text-muted-foreground text-sm leading-relaxed mb-6">
                      {primary.tagline}
                    </p>
                  )}
                  <div className="flex flex-col sm:flex-row gap-3">
                    <CTAButton
                      href={getPackageHref(primary)}
                      className="px-6 py-2.5 text-sm"
                    >
                      Start This Quick Win
                    </CTAButton>
                    <CTAButton
                      href="/book"
                      className="px-6 py-2.5 text-sm !bg-[#0A2540] hover:!bg-[#0A2540]/90"
                    >
                      Book a Free Call First
                    </CTAButton>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── Secondary Recommendations ─────────────────────────────────────────── */}
      {secondaryRecs.length > 0 && (
        <section className="bg-[#F7F9FC] pb-16">
          <div className="max-w-[900px] mx-auto px-6">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-5">
              Also Worth Considering
            </p>
            <div className="space-y-4">
              {secondaryRecs.map((rec) => (
                <div
                  key={rec.slug}
                  className="bg-white rounded-2xl border border-border shadow-sm p-6 flex flex-col sm:flex-row sm:items-start gap-5"
                >
                  <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-[#F7F9FC] border border-border flex items-center justify-center">
                    <span className="text-[#0A2540] font-extrabold text-sm">{rec.rank}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-extrabold text-[#0A2540] text-base mb-1 leading-snug">
                      {getPackageName(rec)}
                    </h3>
                    {rec.tagline && (
                      <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                        {rec.tagline}
                      </p>
                    )}
                    <Link
                      href={getPackageHref(rec)}
                      className="inline-flex items-center gap-1.5 text-[#0078D4] font-semibold text-sm hover:underline"
                    >
                      View package details <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Readiness Profile — all 6 dimensions ─────────────────────────────── */}
      <section className="bg-white border-t border-border py-16">
        <div className="max-w-[760px] mx-auto px-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-9 h-9 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
              <BarChart3 className="w-4 h-4 text-[#0078D4]" />
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[#0078D4]">
                Your Readiness Profile
              </p>
              <p className="text-sm text-muted-foreground mt-0.5">
                How each area scored across all 10 questions
              </p>
            </div>
          </div>
          {primary && (
            <p className="text-sm text-muted-foreground mb-7 pl-12">
              Strongest area: <strong className="text-[#0A2540]">{DIMENSION_LABELS[primary.slug as QuizSlug] ?? primary.slug}</strong> at{" "}
              {getScorePct(primary.slug, scores)}%. Lowest-scoring areas represent either strengths or lower priorities given your current situation.
            </p>
          )}
          <div className="space-y-4">
            {ALL_SLUGS.map((slug) => {
              const pct = getScorePct(slug, scores);
              const label = DIMENSION_LABELS[slug];
              const indicator = getReadingIndicator(slug, scores, recommendations);
              const isPrimary = primary?.slug === slug;
              return (
                <div key={slug}>
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`text-sm font-semibold ${isPrimary ? "text-[#0078D4]" : "text-[#0A2540]"}`}
                    >
                      {label}
                    </span>
                    <span className="text-xs text-muted-foreground">{indicator}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${pct}%`,
                        background:
                          isPrimary
                            ? "#0078D4"
                            : pct >= 40
                            ? "#00B4D8"
                            : "#e2e8f0",
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 text-right">{pct}%</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Next Steps — dynamic from ranked results ──────────────────────────── */}
      <section className="bg-[#F7F9FC] border-t border-border py-16">
        <div className="max-w-[760px] mx-auto px-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-9 h-9 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
              <TrendingUp className="w-4 h-4 text-[#0078D4]" />
            </div>
            <p className="text-xs font-bold uppercase tracking-widest text-[#0078D4]">
              Recommended Next Steps
            </p>
          </div>
          <div className="space-y-4">
            {/* Step 1: start the top Quick Win */}
            {primary && (
              <div className="bg-white rounded-2xl border border-border p-6 flex gap-5">
                <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-[#0078D4]/10 flex items-center justify-center">
                  <span className="text-[#0078D4] font-extrabold text-sm">1</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[#0A2540] text-sm mb-1">
                    Review {getPackageName(primary)}
                  </p>
                  <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                    This is your highest-scoring area. See exactly what's included, the timeline,
                    and what your environment will look like when we're done.
                  </p>
                  <Link
                    href={getPackageHref(primary)}
                    className="inline-flex items-center gap-1.5 text-[#0078D4] font-semibold text-sm hover:underline"
                  >
                    View package details <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            )}

            {/* Step 2: book a call */}
            <div className="bg-white rounded-2xl border border-border p-6 flex gap-5">
              <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-[#0078D4]/10 flex items-center justify-center">
                <CalendarDays className="w-4 h-4 text-[#0078D4]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-[#0A2540] text-sm mb-1">
                  Book a free 30-minute discovery call
                </p>
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                  Talk through your results with Shane directly. No commitment — a focused
                  conversation about what would move the needle fastest in your environment.
                </p>
                <Link
                  href="/book"
                  className="inline-flex items-center gap-1.5 text-[#0078D4] font-semibold text-sm hover:underline"
                >
                  Book a call <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>

            {/* Step 3: secondary quick wins if they scored */}
            {secondaryRecs.length > 0 && (
              <div className="bg-white rounded-2xl border border-border p-6 flex gap-5">
                <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-[#0078D4]/10 flex items-center justify-center">
                  <span className="text-[#0078D4] font-extrabold text-sm">3</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[#0A2540] text-sm mb-1">
                    Plan for your secondary priorities
                  </p>
                  <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                    Your answers also signalled need in{" "}
                    {secondaryRecs.map((r, i) => (
                      <span key={r.slug}>
                        {i > 0 && " and "}
                        <strong>{getPackageName(r)}</strong>
                      </span>
                    ))}
                    . These are natural follow-ons once your primary quick win is delivered.
                  </p>
                  <Link
                    href="/micro-offers"
                    className="inline-flex items-center gap-1.5 text-[#0078D4] font-semibold text-sm hover:underline"
                  >
                    Browse all quick wins <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] py-20">
        <div className="max-w-[760px] mx-auto px-6 text-center">
          <h2 className="text-2xl md:text-3xl font-extrabold text-white mb-4 leading-tight">
            Ready to turn your results into action?
          </h2>
          <p className="text-white/70 text-base leading-relaxed mb-8 max-w-lg mx-auto">
            Every Quick Win is scoped, priced, and delivered by Shane personally — no juniors, no
            subcontractors.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {primary && (
              <CTAButton href={getPackageHref(primary)} className="px-8 py-3.5 text-sm">
                Start This Quick Win
              </CTAButton>
            )}
            <CTAButton href="/book" className="px-8 py-3.5 text-sm !bg-white !text-[#0A2540] hover:!bg-[#F7F9FC]">
              Book a Free Call
            </CTAButton>
          </div>
          <div className="mt-8 text-center">
            <Link
              href="/quick-win-quiz"
              className="inline-flex items-center gap-2 text-white/40 hover:text-white/70 text-sm transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Retake the quiz
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}
