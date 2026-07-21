import { Link } from "wouter";
import { ArrowRight, Sparkles } from "lucide-react";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";
import { SOLUTIONS_TOPICS } from "@/data/solutionsTopics";

/**
 * Quiz hub — demoted from nav-primary to a recovery/SEO-feeder role (website-rebuild-reference-v2.md
 * §1/§5): free, self-report, no account required. Links to the real, already-live per-topic quizzes
 * (pre-rebuild, reinstated per §5 — not rebuilt here) plus the retainer and quick-win quiz flows.
 */
const OTHER_QUIZZES = [
  {
    title: "Fractional Consulting Fit",
    description: "Not sure if a retainer or a scoped project is the right fit? Five questions in.",
    href: "/retainer-quiz",
  },
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
        title="Free Readiness Quizzes | Shane McCaw Consulting"
        description="Five-question, self-reported quizzes across Copilot, Security & Compliance, Governance, SharePoint, Power Platform, Teams, Migration, and M365 Health — free, no account required."
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
            Not ready for a full Graph-based Assessment yet? These quizzes give a fast,
            confidence-tiered read based on what you tell us — a starting point, not a verified
            score. Pick the domain closest to your concern.
          </p>
        </div>
      </section>

      <section className="pb-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {SOLUTIONS_TOPICS.map((topic) => {
            const Icon = topic.icon;
            return (
              <Link key={topic.slug} href={topic.quizHref} data-track="cta">
                <GlassPanel className="p-6 h-full flex flex-col hover:bg-white/[0.09] transition-colors group">
                  <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/[0.08] flex items-center justify-center text-accent-blue mb-4">
                    <Icon className="w-5 h-5" />
                  </div>
                  <h2 className="font-display font-semibold text-text-primary mb-2">
                    {topic.shortLabel} Quiz
                  </h2>
                  <p className="text-sm text-text-secondary leading-relaxed flex-grow mb-4">
                    A five-question read on where your {topic.shortLabel.toLowerCase()} posture
                    likely stands today.
                  </p>
                  <span className="flex items-center gap-1.5 text-sm font-medium text-accent-blue group-hover:gap-2.5 transition-all">
                    Take the quiz <ArrowRight className="w-3.5 h-3.5" />
                  </span>
                </GlassPanel>
              </Link>
            );
          })}
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
            href="/assessment"
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
