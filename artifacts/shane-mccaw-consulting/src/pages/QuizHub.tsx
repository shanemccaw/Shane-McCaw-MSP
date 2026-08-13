import { Link } from "wouter";
import { ArrowRight, Sparkles } from "lucide-react";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";

/**
 * Quiz hub — demoted from nav-primary to a recovery/SEO-feeder role (website-rebuild-reference-v2.md
 * §1/§5): free, self-report, no account required. Links to the quick-win quiz flow. The per-topic
 * legacy quizzes and the retainer quiz were unhooked (Git #607) for the Copilot-Assessment-only release.
 */
const OTHER_QUIZZES = [
  {
    title: "Quick-Win Finder",
    description: "Find the fastest fixed-price pack for the problem you actually have right now.",
    href: "/quick-win-quiz",
  },
];

export default function QuizHub() {
  return (
    <Layout>
      <SEOMeta
        title="Free Readiness Quiz | Shane McCaw Consulting"
        description="A quick, self-reported readiness quiz — free, no account required."
      />

      <section className="pt-32 sm:pt-40 pb-16 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-panel text-accent-blue text-xs font-semibold uppercase tracking-wider mb-6">
            <Sparkles className="w-4 h-4" />
            Free · 5 questions · No account required
          </div>
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-text-primary tracking-tight leading-tight mb-6">
            A quick, <GradientText>self-reported</GradientText> read before you commit to a scan
          </h1>
          <p className="text-lg text-text-secondary leading-relaxed">
            Not ready for a full Graph-based Assessment yet? This quiz gives a fast,
            confidence-tiered read based on what you tell us — a starting point, not a verified
            score.
          </p>
        </div>
      </section>

      <section className="pb-24 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-2 gap-6">
          {OTHER_QUIZZES.map((q) => (
            <Link key={q.href} href={q.href} data-track="cta">
              <GlassPanel className="p-7 h-full hover:bg-white/[0.09] transition-colors group">
                <h2 className="font-display font-semibold text-lg text-text-primary mb-2">
                  {q.title}
                </h2>
                <p className="text-sm text-text-secondary leading-relaxed mb-4">{q.description}</p>
                <span className="flex items-center gap-1.5 text-sm font-medium text-accent-blue group-hover:gap-2.5 transition-all">
                  Get started <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </GlassPanel>
            </Link>
          ))}
        </div>
      </section>

      <section className="pb-24 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-2xl mx-auto">
          <p className="text-text-secondary mb-6">
            Ready to skip straight to a real, Graph-based scan of your actual tenant?
          </p>
          <Link
            href="/assessments?tab=free"
            className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" }}
            data-track="cta"
          >
            Start a Free Assessment <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </section>
    </Layout>
  );
}
