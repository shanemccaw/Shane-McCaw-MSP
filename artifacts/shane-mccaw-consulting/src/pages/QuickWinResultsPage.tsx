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

interface ServiceData {
  name: string;
  tagline: string | null;
  description: string | null;
  price: string | null;
  turnaround: string | null;
  durationDays: number | null;
  deliverables: string[] | null;
  features: string[] | null;
  inclusions: string[] | null;
  pageHref: string | null;
  badge: string | null;
  highlighted: boolean;
}

interface Recommendation {
  rank: number;
  slug: string;
  score: number;
  service: ServiceData | null;
}

interface QuizResult {
  id: number;
  answers: Record<string, number>;
  scores: Record<string, number>;
  rankedSlugs: string[];
  recommendations: Recommendation[];
  createdAt: string;
}

// ── Static fallback labels (display-only when service record is absent) ───────

const SLUG_LABELS: Record<QuizSlug, string> = {
  "tenant-health-audit": "M365 Tenant Health Audit",
  "power-platform-quick-start": "Power Platform Quick-Start",
  "governance-foundations": "Governance Foundations Package",
  "migration-readiness-assessment": "Migration Readiness Assessment",
  "copilot-readiness-assessment": "Copilot for M365 Readiness Assessment",
  "m365-training-enablement": "Microsoft 365 Training & Enablement",
};

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

// Max possible score per dimension across all questions
const MAX_SCORE = 12;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getScorePct(slug: string, scores: Record<string, number>): number {
  return Math.min(100, Math.round(((scores[slug] ?? 0) / MAX_SCORE) * 100));
}

function getPackageName(rec: Recommendation): string {
  return rec.service?.name ?? SLUG_LABELS[rec.slug as QuizSlug] ?? rec.slug;
}

function getPackageHref(rec: Recommendation): string {
  return rec.service?.pageHref ?? `/micro-offers/${rec.slug}`;
}

// ── Dynamic narrative builders ────────────────────────────────────────────────

function buildPrimarySummary(
  primary: Recommendation,
  scores: Record<string, number>
): string {
  const topPct = getScorePct(primary.slug, scores);
  const topLabel = DIMENSION_LABELS[primary.slug as QuizSlug] ?? primary.slug;
  const topName = getPackageName(primary);

  let strength: string;
  if (topPct >= 67) {
    strength = "a strong, clear signal";
  } else if (topPct >= 42) {
    strength = "a consistent signal";
  } else {
    strength = "an emerging signal";
  }

  return `Your answers point to ${strength} in ${topLabel} (${topPct}% of the maximum score in this area). **${topName}** is the fastest path to measurable improvement in your environment.`;
}

function buildLowestDimensionNote(scores: Record<string, number>): string {
  const lowest = ALL_SLUGS.slice().sort(
    (a, b) => (scores[a] ?? 0) - (scores[b] ?? 0)
  )[0];
  const lowestLabel = DIMENSION_LABELS[lowest];
  const lowestPct = getScorePct(lowest, scores);
  if (lowestPct === 0) {
    return `${lowestLabel} scored zero across all questions — this area may already be well-managed, or it's simply not a current priority for your organisation.`;
  }
  return `Lowest signal: ${lowestLabel} at ${lowestPct}% — this may indicate a relative strength or a lower-priority area given where you are right now.`;
}

function buildPrimaryReasoning(
  primary: Recommendation,
  scores: Record<string, number>
): string {
  const topPct = getScorePct(primary.slug, scores);
  const topLabel = DIMENSION_LABELS[primary.slug as QuizSlug] ?? primary.slug;
  const rawScore = scores[primary.slug] ?? 0;

  if (rawScore === 0) {
    return `This package was your closest match given your answers.`;
  }

  return `You scored ${rawScore} out of a possible ${MAX_SCORE} in ${topLabel} (${topPct}%) — the highest of all six dimensions. This is where your environment has the most immediate, actionable gap that a time-boxed engagement can close.`;
}

function buildSecondaryReasoning(
  rec: Recommendation,
  primary: Recommendation,
  scores: Record<string, number>
): string {
  const label = DIMENSION_LABELS[rec.slug as QuizSlug] ?? rec.slug;
  const pct = getScorePct(rec.slug, scores);
  const primaryPct = getScorePct(primary.slug, scores);
  const gap = primaryPct - pct;

  if (gap <= 5) {
    return `${label} scored almost as high (${pct}%) — consider this a near-tie with your primary recommendation.`;
  }
  return `${label} scored ${pct}% — a secondary signal worth addressing once the primary quick win is delivered.`;
}

function getReadingIndicator(
  slug: QuizSlug,
  recommendations: Recommendation[]
): string {
  const rank = recommendations.findIndex((r) => r.slug === slug) + 1;
  if (rank === 1) return "Highest priority";
  if (rank === 2) return "Worth considering next";
  if (rank === 3) return "Moderate signal";
  return "Low signal at this time";
}

// ── Bar fill class — no inline style for colour ───────────────────────────────

function barFillClass(slug: string, recommendations: Recommendation[]): string {
  const isPrimary = recommendations[0]?.slug === slug;
  const pct = recommendations.find((r) => r.slug === slug)?.score ?? 0;
  if (isPrimary) return "bg-[#0078D4]";
  if (pct >= 5) return "bg-[#00B4D8]";
  return "bg-gray-300";
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

  const primarySummary = primary ? buildPrimarySummary(primary, scores) : "";
  const lowestNote = buildLowestDimensionNote(scores);

  // Split **...** for bold rendering
  function renderBold(text: string) {
    return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
      i % 2 === 1 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>
    );
  }

  return (
    <Layout>
      <SEOMeta
        title="Your M365 Quick Win Results | Shane McCaw Consulting"
        description="Personalised Microsoft 365 Quick Win recommendations based on your quiz answers."
      />

      {/* ── Hero ──────────────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] pt-32 pb-20 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_800px_400px_at_60%_0%,rgba(0,120,212,0.14)_0%,transparent_70%)]" />
        <div className="max-w-[1200px] mx-auto px-6 relative text-center">
          <div className="inline-flex items-center gap-2 bg-[#0078D4]/20 text-[#60B4FF] px-4 py-1.5 rounded-full text-sm font-semibold mb-6">
            <CheckCircle className="w-4 h-4" />
            Quiz complete — results ready
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold text-white leading-tight max-w-3xl mx-auto">
            Your Personalised Quick Win Recommendations
          </h1>
          <p className="text-white/70 text-lg mt-5 max-w-xl mx-auto leading-relaxed">
            Based on your answers, here's the fastest way to get measurable value from your
            Microsoft 365 environment.
          </p>
        </div>
      </section>

      {/* ── Personalised Summary ─────────────────────────────────────────────── */}
      {primary && (
        <section className="bg-white border-b border-border py-14">
          <div className="max-w-[760px] mx-auto px-6">
            <div className="flex items-start gap-4 mb-6">
              <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-[#0078D4]/10 flex items-center justify-center">
                <Star className="w-5 h-5 text-[#0078D4]" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-[#0078D4] mb-2">
                  What your answers tell us
                </p>
                <p className="text-[#0A2540] text-base leading-relaxed">
                  {renderBold(primarySummary)}
                </p>
              </div>
            </div>
            <div className="pl-14">
              <p className="text-sm text-muted-foreground leading-relaxed">{lowestNote}</p>
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
                  {primary.service?.tagline && (
                    <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                      {primary.service.tagline}
                    </p>
                  )}
                  {/* Why this was ranked first */}
                  <p className="text-sm text-[#0A2540] bg-[#F7F9FC] rounded-xl px-4 py-3 mb-5 border border-border leading-relaxed">
                    <span className="font-semibold text-[#0078D4]">Why this?</span>{" "}
                    {buildPrimaryReasoning(primary, scores)}
                  </p>
                  {/* Service meta */}
                  {(primary.service?.turnaround || primary.service?.durationDays) && (
                    <div className="flex flex-wrap gap-3 mb-6">
                      {primary.service.turnaround && (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-[#0A2540]/5 text-[#0A2540] px-3 py-1.5 rounded-full border border-[#0A2540]/10">
                          ⏱ {primary.service.turnaround}
                        </span>
                      )}
                      {primary.service.durationDays && (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-[#0A2540]/5 text-[#0A2540] px-3 py-1.5 rounded-full border border-[#0A2540]/10">
                          📅 {primary.service.durationDays} day{primary.service.durationDays !== 1 ? "s" : ""}
                        </span>
                      )}
                      {primary.service.price && (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold bg-[#0078D4]/10 text-[#0078D4] px-3 py-1.5 rounded-full border border-[#0078D4]/20">
                          From ${parseFloat(primary.service.price).toLocaleString()}
                        </span>
                      )}
                    </div>
                  )}
                  {/* Deliverables */}
                  {primary.service?.deliverables && primary.service.deliverables.length > 0 && (
                    <div className="mb-6">
                      <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">
                        What you get
                      </p>
                      <ul className="space-y-1.5">
                        {primary.service.deliverables.slice(0, 4).map((d, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-[#0A2540]">
                            <CheckCircle className="w-3.5 h-3.5 text-[#0078D4] flex-shrink-0 mt-0.5" />
                            {d}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="flex flex-col sm:flex-row gap-3">
                    <CTAButton href={getPackageHref(primary)} className="px-6 py-2.5 text-sm">
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
                    {rec.service?.tagline && (
                      <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                        {rec.service.tagline}
                      </p>
                    )}
                    {/* Per-secondary reasoning */}
                    {primary && (
                      <p className="text-xs text-muted-foreground bg-[#F7F9FC] rounded-lg px-3 py-2 border border-border mb-4 leading-relaxed">
                        {buildSecondaryReasoning(rec, primary, scores)}
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
                How each area scored across all questions
              </p>
            </div>
          </div>
          {primary && (
            <p className="text-sm text-muted-foreground mb-7 pl-12">
              Strongest area:{" "}
              <strong className="text-[#0A2540]">
                {DIMENSION_LABELS[primary.slug as QuizSlug] ?? primary.slug}
              </strong>{" "}
              at {getScorePct(primary.slug, scores)}%. {lowestNote}
            </p>
          )}
          <div className="space-y-4">
            {ALL_SLUGS.map((slug) => {
              const pct = getScorePct(slug, scores);
              const label = DIMENSION_LABELS[slug];
              const indicator = getReadingIndicator(slug, recommendations);
              const isPrimary = primary?.slug === slug;
              return (
                <div key={slug}>
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`text-sm font-semibold ${
                        isPrimary ? "text-[#0078D4]" : "text-[#0A2540]"
                      }`}
                    >
                      {label}
                    </span>
                    <span className="text-xs text-muted-foreground">{indicator}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${barFillClass(
                        slug,
                        recommendations
                      )}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 text-right">{pct}%</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Next Steps — fully ranked dynamic sequence from recommendations ────── */}
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
            {/* Step per ranked recommendation */}
            {topRecs.slice(0, 3).map((rec, i) => (
              <div
                key={rec.slug}
                className="bg-white rounded-2xl border border-border p-6 flex gap-5"
              >
                <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-[#0078D4]/10 flex items-center justify-center">
                  <span className="text-[#0078D4] font-extrabold text-sm">{i + 1}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[#0A2540] text-sm mb-1">
                    {i === 0 ? "Start with: " : i === 1 ? "Then consider: " : "Finally: "}
                    {getPackageName(rec)}
                  </p>
                  <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                    {i === 0
                      ? `This is your highest-scoring area. ${
                          rec.service?.turnaround
                            ? `Turnaround: ${rec.service.turnaround}.`
                            : ""
                        } See exactly what's included and what your environment will look like when we're done.`
                      : `${buildSecondaryReasoning(rec, topRecs[0], scores)} ${
                          rec.service?.turnaround
                            ? `Turnaround: ${rec.service.turnaround}.`
                            : ""
                        }`}
                  </p>
                  <Link
                    href={getPackageHref(rec)}
                    className="inline-flex items-center gap-1.5 text-[#0078D4] font-semibold text-sm hover:underline"
                  >
                    View package details <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            ))}

            {/* Final step: book discovery call */}
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
            <CTAButton
              href="/book"
              className="px-8 py-3.5 text-sm !bg-white !text-[#0A2540] hover:!bg-[#F7F9FC]"
            >
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
