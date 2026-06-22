import { useEffect, useState } from "react";
import { useParams, Link } from "wouter";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { CTAButton } from "@/components/CTAButton";
import {
  CheckCircle,
  ArrowRight,
  RotateCcw,
  Star,
  TrendingUp,
  Loader2,
  AlertCircle,
  BarChart3,
  CalendarDays,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────────────────────

type Slug =
  | "tenant-health-audit"
  | "power-platform-quick-start"
  | "governance-foundations"
  | "migration-readiness-assessment"
  | "copilot-readiness-assessment"
  | "m365-training-enablement";

interface ServiceInfo {
  slug: string | null;
  name: string;
  tagline: string | null;
  price: string | null;
  pageHref: string | null;
}

interface QuizResult {
  id: number;
  scores: Record<string, number>;
  rankedSlugs: string[];
  createdAt: string;
  services: Record<string, ServiceInfo>;
}

// ── Static package metadata (fallback when DB has no marketing data) ─────────

const PACKAGE_META: Record<Slug, { name: string; tagline: string; href: string }> = {
  "tenant-health-audit": {
    name: "M365 Tenant Health Audit",
    tagline:
      "A deep-dive audit of your entire tenant — security posture, licensing efficiency, governance gaps, and a prioritised remediation roadmap.",
    href: "/micro-offers/tenant-health-audit",
  },
  "power-platform-quick-start": {
    name: "Power Platform Quick-Start",
    tagline:
      "Get your first Power Automate flow or Power App live in days — automating a real business process with a proven delivery framework.",
    href: "/micro-offers/power-platform-quick-start",
  },
  "governance-foundations": {
    name: "Governance Foundations Package",
    tagline:
      "Establish policies, naming conventions, lifecycle rules, and a DLP framework that keeps your tenant compliant and manageable long-term.",
    href: "/micro-offers/governance-foundations",
  },
  "migration-readiness-assessment": {
    name: "Migration Readiness Assessment",
    tagline:
      "A structured pre-migration review covering your source environment, data risks, cutover plan, and the blockers most teams miss.",
    href: "/micro-offers/migration-readiness-assessment",
  },
  "copilot-readiness-assessment": {
    name: "Copilot for M365 Readiness Assessment",
    tagline:
      "Evaluate whether your tenant's data governance, identity, and adoption practices are ready for Copilot AI deployment.",
    href: "/micro-offers/copilot-readiness-assessment",
  },
  "m365-training-enablement": {
    name: "Microsoft 365 Training & Enablement",
    tagline:
      "Targeted end-user and admin training that closes the adoption gap and unlocks the ROI already sitting inside your M365 licences.",
    href: "/micro-offers/m365-training-enablement",
  },
};

// ── Dimension labels ─────────────────────────────────────────────────────────

const DIMENSION_LABELS: Record<Slug, string> = {
  "tenant-health-audit": "M365 Tenant Health",
  "power-platform-quick-start": "Power Platform Automation",
  "governance-foundations": "Governance",
  "migration-readiness-assessment": "Migration Readiness",
  "copilot-readiness-assessment": "AI & Copilot Readiness",
  "m365-training-enablement": "Training & Enablement",
};

// Max possible score per dimension (sum of all highest-scoring answers = ~10 per slug roughly)
const MAX_SCORE = 12;

function getPackageName(slug: string, services: Record<string, ServiceInfo>): string {
  const svc = services[slug];
  if (svc?.name) return svc.name;
  return PACKAGE_META[slug as Slug]?.name ?? slug;
}

function getPackageTagline(slug: string, services: Record<string, ServiceInfo>): string {
  const svc = services[slug];
  if (svc?.tagline) return svc.tagline;
  return PACKAGE_META[slug as Slug]?.tagline ?? "";
}

function getPackageHref(slug: string, services: Record<string, ServiceInfo>): string {
  const svc = services[slug];
  if (svc?.pageHref) return svc.pageHref;
  return PACKAGE_META[slug as Slug]?.href ?? `/micro-offers/${slug}`;
}

function getScorePct(slug: string, scores: Record<string, number>): number {
  const raw = scores[slug] ?? 0;
  return Math.min(100, Math.round((raw / MAX_SCORE) * 100));
}

function getPrimaryInsight(primarySlug: Slug): string {
  const insights: Record<Slug, string> = {
    "tenant-health-audit":
      "Your answers point to a tenant that hasn't had a structured review in some time — security gaps, licence waste, and configuration drift are common in environments like yours. A Health Audit surfaces every risk with a clear prioritised roadmap.",
    "power-platform-quick-start":
      "Your organisation has manual processes that are prime candidates for automation, but Power Platform adoption hasn't taken hold yet. A guided Quick-Start gets a real workflow live in days and gives your team a proven model to build from.",
    "governance-foundations":
      "Your tenant has grown without formal governance guardrails — no consistent naming conventions, lifecycle policies, or DLP framework. The Governance Foundations Package gives you the structure that prevents costly sprawl and compliance exposure.",
    "migration-readiness-assessment":
      "With a migration on your roadmap, the biggest risk is discovering blockers mid-project. A Readiness Assessment identifies data risks, technical gaps, and cutover complexities before they become expensive problems.",
    "copilot-readiness-assessment":
      "You're interested in Copilot for M365, but deployment readiness depends on your identity, data governance, and adoption baseline. The Readiness Assessment gives you a clear go/no-go picture before you commit to licences.",
    "m365-training-enablement":
      "Your team isn't getting the most out of the M365 licences you're already paying for. Targeted training closes the adoption gap and turns underused tools into productivity multipliers — without new spend.",
  };
  return insights[primarySlug] ?? "Based on your answers, this package is the strongest match for your current situation.";
}

// ── Component ────────────────────────────────────────────────────────────────

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

  const { scores, rankedSlugs, services } = result;

  const topSlugs = rankedSlugs.slice(0, 3).filter((s) => (scores[s] ?? 0) > 0);
  const primarySlug = topSlugs[0] as Slug | undefined;
  const secondarySlugs = topSlugs.slice(1);

  const allRanked = rankedSlugs.filter((s) => (scores[s] ?? 0) > 0) as Slug[];

  return (
    <Layout>
      <SEOMeta
        title="Your M365 Quick Win Results | Shane McCaw Consulting"
        description="Personalised Microsoft 365 Quick Win recommendations based on your quiz answers."
      />

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
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
            Based on your 10 answers, here's the fastest way to get measurable value from your Microsoft 365 environment.
          </p>
        </div>
      </section>

      {/* ── Personalised Summary ─────────────────────────────────────────────── */}
      {primarySlug && (
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
                  {getPrimaryInsight(primarySlug)}
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── Primary Recommendation ───────────────────────────────────────────── */}
      {primarySlug && (
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
                  <h2 className="text-xl font-extrabold text-[#0A2540] mb-3 leading-snug">
                    {getPackageName(primarySlug, services)}
                  </h2>
                  <p className="text-muted-foreground text-sm leading-relaxed mb-6">
                    {getPackageTagline(primarySlug, services)}
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <CTAButton
                      href={getPackageHref(primarySlug, services)}
                      className="px-6 py-2.5 text-sm"
                    >
                      View Package Details
                    </CTAButton>
                    <CTAButton href="/book" className="px-6 py-2.5 text-sm !bg-[#0A2540] hover:!bg-[#0A2540]/90">
                      Book a Free Call
                    </CTAButton>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── Secondary Recommendations ─────────────────────────────────────────── */}
      {secondarySlugs.length > 0 && (
        <section className="bg-[#F7F9FC] pb-16">
          <div className="max-w-[900px] mx-auto px-6">
            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-5">
              Also Worth Considering
            </p>
            <div className="space-y-4">
              {secondarySlugs.map((slug, i) => (
                <div
                  key={slug}
                  className="bg-white rounded-2xl border border-border shadow-sm p-6 flex flex-col sm:flex-row sm:items-start gap-5"
                >
                  <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-[#F7F9FC] border border-border flex items-center justify-center">
                    <span className="text-[#0A2540] font-extrabold text-sm">{i + 2}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-extrabold text-[#0A2540] text-base mb-1 leading-snug">
                      {getPackageName(slug, services)}
                    </h3>
                    <p className="text-muted-foreground text-sm leading-relaxed mb-4">
                      {getPackageTagline(slug, services)}
                    </p>
                    <Link
                      href={getPackageHref(slug, services)}
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

      {/* ── Readiness Profile ─────────────────────────────────────────────────── */}
      {allRanked.length > 0 && (
        <section className="bg-white border-t border-border py-16">
          <div className="max-w-[760px] mx-auto px-6">
            <div className="flex items-center gap-3 mb-8">
              <div className="w-9 h-9 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
                <BarChart3 className="w-4.5 h-4.5 text-[#0078D4]" />
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-[#0078D4]">
                  Your Readiness Profile
                </p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  How each area scored based on your answers
                </p>
              </div>
            </div>
            <div className="space-y-4">
              {allRanked.map((slug) => {
                const pct = getScorePct(slug, scores);
                const label = DIMENSION_LABELS[slug] ?? slug;
                return (
                  <div key={slug}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-semibold text-[#0A2540]">{label}</span>
                      <span className="text-xs font-bold text-[#0078D4]">{pct}%</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${pct}%`,
                          background:
                            pct >= 70
                              ? "#0078D4"
                              : pct >= 40
                              ? "#00B4D8"
                              : "#94a3b8",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ── Next Steps ────────────────────────────────────────────────────────── */}
      <section className="bg-[#F7F9FC] border-t border-border py-16">
        <div className="max-w-[760px] mx-auto px-6">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-9 h-9 rounded-xl bg-[#0078D4]/10 flex items-center justify-center flex-shrink-0">
              <TrendingUp className="w-4.5 h-4.5 text-[#0078D4]" />
            </div>
            <p className="text-xs font-bold uppercase tracking-widest text-[#0078D4]">Next Steps</p>
          </div>
          <div className="space-y-5">
            {[
              {
                icon: <Star className="w-4 h-4 text-[#0078D4]" />,
                title: "Review your top recommendation",
                body: primarySlug
                  ? `Start with the ${getPackageName(primarySlug, services)} page — it covers exactly what's included, how it works, and what you'll have at the end.`
                  : "Explore the Quick Wins packages to find the right starting point.",
                href: primarySlug ? getPackageHref(primarySlug, services) : "/micro-offers",
                cta: "View package",
              },
              {
                icon: <CalendarDays className="w-4 h-4 text-[#0078D4]" />,
                title: "Book a free 30-minute discovery call",
                body: "Talk through your results with Shane directly. No commitment — just a focused conversation about what would move the needle fastest in your environment.",
                href: "/book",
                cta: "Book a call",
              },
            ].map((step, i) => (
              <div key={i} className="bg-white rounded-2xl border border-border p-6 flex gap-5">
                <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-[#0078D4]/10 flex items-center justify-center">
                  {step.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-[#0A2540] text-sm mb-1">{step.title}</p>
                  <p className="text-muted-foreground text-sm leading-relaxed mb-3">{step.body}</p>
                  <Link
                    href={step.href}
                    className="inline-flex items-center gap-1.5 text-[#0078D4] font-semibold text-sm hover:underline"
                  >
                    {step.cta} <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────────────────────── */}
      <section className="bg-[#0A2540] py-20">
        <div className="max-w-[760px] mx-auto px-6 text-center">
          <h2 className="text-2xl md:text-3xl font-extrabold text-white mb-4 leading-tight">
            Ready to turn your results into action?
          </h2>
          <p className="text-white/70 text-base leading-relaxed mb-8 max-w-lg mx-auto">
            Every Quick Win package is scoped, priced, and delivered by Shane personally — no juniors, no subcontractors.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <CTAButton href="/book" className="px-8 py-3.5 text-sm">
              Book a Free Discovery Call
            </CTAButton>
            <a
              href="/micro-offers"
              className="inline-flex items-center justify-center gap-2 text-white/80 font-semibold hover:text-white transition-colors text-sm border border-white/20 px-8 py-3.5 rounded hover:border-white/40"
            >
              Browse All Quick Wins <ArrowRight className="w-4 h-4" />
            </a>
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
