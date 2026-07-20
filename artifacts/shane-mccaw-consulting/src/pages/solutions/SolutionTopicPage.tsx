import { Link, useRoute } from "wouter";
import { ArrowRight, CheckCircle2, AlertTriangle } from "lucide-react";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";
import { StatPanel } from "@/components/design-system/StatPanel";
import { getSolutionTopic } from "@/data/solutionsTopics";
import NotFound from "@/pages/not-found";

/**
 * Cold-visitor structure for a Solutions/Topic page (website-rebuild-reference-v2.md §3/§5).
 * One route per topic slug, all sharing this template. Personalization (real score display for
 * a recognized visitor) is Stage 4 — this stays generic-marketing content, structured so the
 * personalization layer can slot in later without a rebuild.
 */
export default function SolutionTopicPage() {
  const [, params] = useRoute("/solutions/:slug");
  const topic = params?.slug ? getSolutionTopic(params.slug) : undefined;

  if (!topic) return <NotFound />;

  const Icon = topic.icon;

  return (
    <Layout>
      <SEOMeta
        title={`${topic.title} | Shane McCaw Consulting`}
        description={topic.subhead}
      />

      {/* Hero */}
      <section className="relative pt-32 sm:pt-40 pb-20 px-4 sm:px-6 lg:px-8 overflow-hidden">
        <div className="max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full glass-panel text-accent-blue text-xs font-semibold uppercase tracking-wider mb-6">
            <Icon className="w-4 h-4" />
            {topic.pillar}
          </div>

          <h1 className="font-display text-4xl sm:text-5xl font-bold text-text-primary tracking-tight leading-tight mb-6">
            {topic.headlinePrefix}
            <GradientText>{topic.headlineSuffix}</GradientText>
          </h1>

          <p className="text-lg text-text-secondary max-w-2xl mx-auto leading-relaxed mb-10">
            {topic.subhead}
          </p>

          <div className="flex flex-col sm:flex-row justify-center items-center gap-4 mb-14">
            <Link
              href="/assessment"
              className="w-full sm:w-auto px-7 py-3.5 rounded-xl font-semibold text-white transition-opacity hover:opacity-90 flex items-center justify-center gap-2"
              style={{ background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" }}
              data-track="cta"
            >
              <span>Start a Free Assessment</span>
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              href={topic.quizHref}
              className="w-full sm:w-auto px-7 py-3.5 rounded-xl font-medium text-text-secondary hover:text-text-primary border border-white/[0.12] hover:border-white/[0.2] transition-colors text-center"
              data-track="cta"
            >
              Take the {topic.shortLabel} Quiz
            </Link>
          </div>

          {/* Personalization slot — cold-visitor placeholder only. A recognized (Assessment-verified
              or quiz-inferred) visitor's real pillar score renders here in Stage 4; until then this
              is generic, not a fabricated number (website-rebuild-reference-v2.md §3 confidence tiers). */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
            {topic.stats.map((s) => (
              <StatPanel key={s.label} label={s.label} value={s.value} />
            ))}
          </div>
        </div>
      </section>

      {/* What we look at */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-10">
          <div>
            <h2 className="font-display text-2xl font-bold text-text-primary mb-5">
              What this covers
            </h2>
            <ul className="space-y-3">
              {topic.coverage.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-accent-blue shrink-0 mt-0.5" />
                  <span className="text-text-secondary leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="font-display text-2xl font-bold text-text-primary mb-5">
              What's actually at risk
            </h2>
            <ul className="space-y-3">
              {topic.risks.map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-accent-violet shrink-0 mt-0.5" />
                  <span className="text-text-secondary leading-relaxed">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Related engine */}
      <section className="py-16 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto">
          <GlassPanel className="p-8 sm:p-10">
            <p className="text-xs uppercase tracking-widest text-text-tertiary mb-3">
              Watched continuously by
            </p>
            <h3 className="font-display text-2xl font-bold text-text-primary mb-3">
              {topic.relatedEngine.name}
            </h3>
            <p className="text-text-secondary leading-relaxed">
              {topic.relatedEngine.description}
            </p>
          </GlassPanel>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="py-20 px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-display text-3xl font-bold text-text-primary mb-4">
            See where <GradientText>{topic.title}</GradientText> stands in your tenant
          </h2>
          <p className="text-text-secondary mb-8 max-w-xl mx-auto">
            A free assessment scans against the real Graph API — not a questionnaire. Or start with
            the {topic.shortLabel.toLowerCase()} quiz for a faster, self-reported read.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <Link
              href="/assessment"
              className="px-7 py-3.5 rounded-xl font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" }}
              data-track="cta"
            >
              Start an Assessment
            </Link>
            <Link
              href="/monitoring"
              className="px-7 py-3.5 rounded-xl font-medium text-text-secondary hover:text-text-primary border border-white/[0.12] hover:border-white/[0.2] transition-colors"
              data-track="cta"
            >
              See Monitoring Pricing
            </Link>
          </div>
        </div>
      </section>
    </Layout>
  );
}
