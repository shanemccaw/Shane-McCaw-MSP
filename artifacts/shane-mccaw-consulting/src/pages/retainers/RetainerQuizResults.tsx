import { Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { CTAButton } from "@/components/CTAButton";
import {
  CheckCircle,
  ArrowRight,
  BarChart3,
  Star,
  TrendingUp,
  CalendarDays,
  RotateCcw,
} from "lucide-react";
import { type TierKey, TIER_CONFIG, determineTier } from "@/components/RetainerSelectorQuiz";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Props {
  scores: Record<TierKey, number>;
  onRetake: () => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_TIERS: TierKey[] = ["Essentials", "Growth", "Enterprise"];
const TOTAL_QUESTIONS = 10;

const TIER_LABELS: Record<TierKey, string> = {
  Essentials: "Architect Essentials",
  Growth: "Architect Growth",
  Enterprise: "Architect Enterprise",
};

const TIER_DESCRIPTIONS: Record<TierKey, string> = {
  Essentials: "Light-touch oversight for a stable, well-managed environment",
  Growth: "Active modernization with consistent weekly architect involvement",
  Enterprise: "Embedded leadership for complex, regulated, or high-stakes programmes",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getPct(tier: TierKey, scores: Record<TierKey, number>): number {
  return Math.round((scores[tier] / TOTAL_QUESTIONS) * 100);
}

function getRankedTiers(scores: Record<TierKey, number>): TierKey[] {
  return ALL_TIERS.slice().sort((a, b) => scores[b] - scores[a]);
}

function getIndicator(tier: TierKey, ranked: TierKey[]): string {
  const rank = ranked.indexOf(tier);
  if (rank === 0) return "Best match for your environment";
  if (rank === 1) return "Worth considering as your needs grow";
  return "Lower alignment at this time";
}

function barFillClass(tier: TierKey, recommended: TierKey, ranked: TierKey[]): string {
  if (tier === recommended) return "bg-[#0078D4]";
  if (ranked.indexOf(tier) === 1) return "bg-[#00B4D8]";
  return "bg-gray-300";
}

// ── Narrative builders ────────────────────────────────────────────────────────

function buildSummary(recommended: TierKey, scores: Record<TierKey, number>): string {
  const score = scores[recommended];
  const pct = getPct(recommended, scores);
  const config = TIER_CONFIG[recommended];

  let strength: string;
  if (pct >= 60) strength = "a strong, clear signal";
  else if (pct >= 35) strength = "a consistent signal";
  else strength = "an emerging signal";

  return `Your answers point to ${strength} toward the **${config.headline}** plan — ${score} out of ${TOTAL_QUESTIONS} questions aligned here (${pct}%). This is the tier where your environment's scope, compliance needs, and engagement cadence all converge.`;
}

function buildSecondNote(recommended: TierKey, ranked: TierKey[], scores: Record<TierKey, number>): string {
  const second = ranked[1];
  const secondPct = getPct(second, scores);
  const primaryPct = getPct(recommended, scores);
  const gap = primaryPct - secondPct;

  if (gap <= 10) {
    return `${TIER_LABELS[second]} scored almost as high (${secondPct}%) — if your environment is on the cusp, consider starting there and scaling up.`;
  }
  return `${TIER_LABELS[second]} was your second-closest match at ${secondPct}% — a natural next step if your needs grow beyond the primary recommendation.`;
}

function buildPrimaryReasoning(recommended: TierKey, scores: Record<TierKey, number>): string {
  const score = scores[recommended];
  const pct = getPct(recommended, scores);

  if (score === 0) {
    return "This tier was the closest match given the overall pattern of your answers.";
  }

  return `${score} out of ${TOTAL_QUESTIONS} of your answers pointed here (${pct}%) — the highest of all three tiers. This tells us your environment's complexity, response-time needs, and desired engagement cadence are most consistent with this plan.`;
}

// ── Bold renderer ─────────────────────────────────────────────────────────────

function renderBold(text: string) {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) =>
    i % 2 === 1 ? <strong key={i}>{part}</strong> : <span key={i}>{part}</span>
  );
}

// ── Tier icon (non-JSX-returning, for use inside JSX) ────────────────────────

function TierIcon({ tier }: { tier: TierKey }) {
  if (tier === "Essentials") return <Star className="w-6 h-6 text-[#0078D4]" />;
  if (tier === "Growth") return <TrendingUp className="w-6 h-6 text-[#0078D4]" />;
  return <CheckCircle className="w-6 h-6 text-[#0078D4]" />;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RetainerQuizResults({ scores, onRetake }: Props) {
  const recommended = determineTier(scores);
  const config = TIER_CONFIG[recommended];
  const ranked = getRankedTiers(scores);
  const summary = buildSummary(recommended, scores);
  const secondNote = buildSecondNote(recommended, ranked, scores);
  const primaryReasoning = buildPrimaryReasoning(recommended, scores);

  return (
    <Layout>
      <SEOMeta
        title="Your Retainer Plan Results | Shane McCaw Consulting"
        description="Personalised retainer plan recommendation based on your M365 environment and support needs."
      />

      {/* ── Hero ──────────────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] pt-[172px] pb-20 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none bg-[radial-gradient(ellipse_800px_400px_at_60%_0%,rgba(0,120,212,0.14)_0%,transparent_70%)]" />
        <div className="max-w-[1200px] mx-auto px-6 relative text-center">
          <div className="inline-flex items-center gap-2 bg-[#0078D4]/20 text-[#60B4FF] px-4 py-1.5 rounded-full text-sm font-semibold mb-6">
            <CheckCircle className="w-4 h-4" />
            Quiz complete — results ready
          </div>
          <h1 className="text-4xl md:text-5xl font-extrabold text-white leading-tight max-w-3xl mx-auto">
            Your Personalised Retainer Recommendation
          </h1>
          <p className="text-white/70 text-lg mt-5 max-w-xl mx-auto leading-relaxed">
            Based on your answers, here's the retainer plan that best fits your environment, support cadence, and compliance needs.
          </p>
        </div>
      </section>

      {/* ── What Your Answers Tell Us ─────────────────────────────────────────── */}
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
                {renderBold(summary)}
              </p>
            </div>
          </div>
          <div className="pl-14">
            <p className="text-sm text-muted-foreground leading-relaxed">{secondNote}</p>
          </div>
        </div>
      </section>

      {/* ── Best Match ────────────────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] py-16">
        <div className="max-w-[900px] mx-auto px-6">
          <p className="text-xs font-bold uppercase tracking-widest text-[#0078D4] mb-5 text-center">
            Best Match
          </p>
          <div className="bg-white rounded-2xl border border-[#0078D4]/30 ring-2 ring-[#0078D4]/10 shadow-md p-8">
            <div className="flex flex-col md:flex-row md:items-start gap-6">
              <div className="flex-shrink-0 w-14 h-14 rounded-2xl bg-[#0A2540] flex items-center justify-center">
                <TierIcon tier={recommended} />
              </div>
              <div className="flex-1 min-w-0">
                <span className="inline-block text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-[#0078D4]/10 text-[#0078D4] border border-[#0078D4]/20 mb-3">
                  Primary Recommendation
                </span>
                <h2 className="text-xl font-extrabold text-[#0A2540] mb-1 leading-snug">
                  {config.headline}
                </h2>
                <p className="text-sm text-muted-foreground mb-1">{config.hours}</p>
                <p className="text-[#0A2540]/80 text-sm leading-relaxed mb-4">
                  {TIER_DESCRIPTIONS[recommended]}
                </p>

                {/* Why this */}
                <p className="text-sm text-[#0A2540] bg-[#F7F9FC] rounded-xl px-4 py-3 mb-5 border border-border leading-relaxed">
                  <span className="font-semibold text-[#0078D4]">Why this?</span>{" "}
                  {primaryReasoning}
                </p>

                {/* Explanation */}
                <p className="text-sm text-[#0A2540]/80 leading-relaxed mb-6">
                  {config.explanation}
                </p>

                <p className="text-xs text-[#0A2540]/50 italic">
                  This recommendation is a snapshot based on your answers today. Your ideal plan may shift as your environment changes — monitoring it continuously keeps the picture current.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <CTAButton href="/monitoring" className="px-6 py-2.5 text-sm">
                    Keep this current — Start Monitoring
                  </CTAButton>
                  <CTAButton
                    href="/contact"
                    className="px-6 py-2.5 text-sm !bg-[#0A2540] hover:!bg-[#0A2540]/90"
                  >
                    Discuss my results
                  </CTAButton>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Also Worth Considering ────────────────────────────────────────────── */}
      {ranked.slice(1).filter((t) => scores[t] > 0).length > 0 && (
        <section className="bg-[#F7F9FC] pb-16">
          <div className="max-w-[900px] mx-auto px-6">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-5">
              Also Worth Considering
            </p>
            <div className="space-y-4">
              {ranked.slice(1).map((tier, i) => {
                const cfg = TIER_CONFIG[tier];
                return (
                  <div
                    key={tier}
                    className="bg-white rounded-2xl border border-border shadow-sm p-6 flex flex-col sm:flex-row sm:items-start gap-5"
                  >
                    <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-[#F7F9FC] border border-border flex items-center justify-center">
                      <span className="text-[#0A2540] font-extrabold text-sm">{i + 2}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-extrabold text-[#0A2540] text-base mb-1 leading-snug">
                        {cfg.headline}
                      </h3>
                      <p className="text-muted-foreground text-sm leading-relaxed mb-2">
                        {cfg.hours}
                      </p>
                      <p className="text-xs text-muted-foreground bg-[#F7F9FC] rounded-lg px-3 py-2 border border-border mb-4 leading-relaxed">
                        {i === 0
                          ? `${TIER_LABELS[tier]} scored ${getPct(tier, scores)}% — a natural next step if your environment scales up or compliance requirements increase.`
                          : `${TIER_LABELS[tier]} scored ${getPct(tier, scores)}% — lower alignment at this stage, but worth reviewing as your programme matures.`}
                      </p>
                      <Link
                        href={cfg.href}
                        className="inline-flex items-center gap-1.5 text-[#0078D4] font-semibold text-sm hover:underline"
                      >
                        View plan details <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ── Readiness Profile ─────────────────────────────────────────────────── */}
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
                How each tier scored across all 10 questions
              </p>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mb-7 pl-12">
            Strongest alignment:{" "}
            <strong className="text-[#0A2540]">{TIER_LABELS[recommended]}</strong>{" "}
            at {getPct(recommended, scores)}%. {secondNote}
          </p>
          <div className="space-y-4">
            {ranked.map((tier) => {
              const pct = getPct(tier, scores);
              const indicator = getIndicator(tier, ranked);
              const isPrimary = tier === recommended;
              return (
                <div key={tier}>
                  <div className="flex items-center justify-between mb-1">
                    <span
                      className={`text-sm font-semibold ${
                        isPrimary ? "text-[#0078D4]" : "text-[#0A2540]"
                      }`}
                    >
                      {TIER_LABELS[tier]}
                    </span>
                    <span className="text-xs text-muted-foreground">{indicator}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${barFillClass(
                        tier,
                        recommended,
                        ranked
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

      {/* ── Recommended Next Steps ────────────────────────────────────────────── */}
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
            {/* Step 1 — primary plan */}
            <div className="bg-white rounded-2xl border border-border p-6 flex gap-5">
              <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-[#0078D4]/10 flex items-center justify-center">
                <span className="text-[#0078D4] font-extrabold text-sm">1</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-[#0A2540] text-sm mb-1">
                  Review the {config.headline} plan
                </p>
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                  See exactly what's included — hours, response times, strategy sessions, and deliverables — so you can confirm it matches what your environment needs.
                </p>
                <Link
                  href={config.href}
                  className="inline-flex items-center gap-1.5 text-[#0078D4] font-semibold text-sm hover:underline"
                >
                  View plan details <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>

            {/* Step 2 — purchase / onboard */}
            <div className="bg-white rounded-2xl border border-border p-6 flex gap-5">
              <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-[#0078D4]/10 flex items-center justify-center">
                <span className="text-[#0078D4] font-extrabold text-sm">2</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-[#0A2540] text-sm mb-1">
                  Start your {config.headline} retainer
                </p>
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                  Ready to move forward? Complete onboarding in a few minutes — no commitment until you've confirmed the scope with Shane directly.
                </p>
                <Link
                  href={config.bookHref}
                  className="inline-flex items-center gap-1.5 text-[#0078D4] font-semibold text-sm hover:underline"
                >
                  Start onboarding <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>

            {/* Step 3 — discuss results */}
            <div className="bg-white rounded-2xl border border-border p-6 flex gap-5">
              <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-[#0078D4]/10 flex items-center justify-center">
                <CalendarDays className="w-4 h-4 text-[#0078D4]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-[#0A2540] text-sm mb-1">
                  Discuss my results with Shane
                </p>
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                  Talk through your results directly. No commitment — a focused conversation about your environment and which plan will move the needle fastest.
                </p>
                <Link
                  href="/contact"
                  className="inline-flex items-center gap-1.5 text-[#0078D4] font-semibold text-sm hover:underline"
                >
                  Discuss my results <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>

            {/* Step 4 — compare all tiers */}
            <div className="bg-white rounded-2xl border border-border p-6 flex gap-5">
              <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-[#0078D4]/10 flex items-center justify-center">
                <BarChart3 className="w-4 h-4 text-[#0078D4]" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-[#0A2540] text-sm mb-1">
                  Compare all retainer tiers
                </p>
                <p className="text-muted-foreground text-sm leading-relaxed mb-3">
                  See Essentials, Growth, and Enterprise side by side — hours, response times, and features in a single view.
                </p>
                <Link
                  href="/retainers"
                  className="inline-flex items-center gap-1.5 text-[#0078D4] font-semibold text-sm hover:underline"
                >
                  View all plans <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Retake ────────────────────────────────────────────────────────────── */}
      <section className="bg-white border-t border-border py-10">
        <div className="max-w-[760px] mx-auto px-6 text-center">
          <button
            onClick={onRetake}
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-[#0A2540] text-sm font-medium transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            Retake the quiz
          </button>
        </div>
      </section>
    </Layout>
  );
}
