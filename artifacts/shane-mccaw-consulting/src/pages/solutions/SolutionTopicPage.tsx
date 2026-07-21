import { useEffect, useMemo } from "react";
import { Link, useRoute } from "wouter";
import { ArrowRight, CheckCircle2, AlertTriangle } from "lucide-react";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";
import { StatPanel } from "@/components/design-system/StatPanel";
import { getSolutionTopic, HEALTH_PILLAR_LABELS, topicMatchesKeywordText } from "@/data/solutionsTopics";
import { PersonalizedContent } from "@/components/PersonalizedContent";
import { usePersonalizationState } from "@/hooks/usePersonalizationState";
import { useHealthPillars, useLatestPresentation, usePortalUrl, useQuizOfferData } from "@/hooks/usePersonalizationData";
import { trackEvent } from "@/lib/analytics";
import NotFound from "@/pages/not-found";

/**
 * Solutions/Topic page (website-rebuild-reference-v2.md §3/§5). One route per topic slug,
 * all sharing this template. Cold-visitor structure is Stage 2; Stage 4b wires the
 * personalization layer (real per-pillar score for Assessment-verified visitors, an
 * inferred-signal nudge for quiz-tier visitors) on top of it.
 */
export default function SolutionTopicPage() {
  const [, params] = useRoute("/solutions/:slug");
  const topic = params?.slug ? getSolutionTopic(params.slug) : undefined;

  const { tier } = usePersonalizationState();
  const { leadOffer } = useQuizOfferData();
  const { score: overallHealthScore, pillars } = useHealthPillars();
  const { presentation } = useLatestPresentation();
  const { portalUrl } = usePortalUrl();

  // Composite topic (m365-health) shows the full 7-pillar breakdown; every other topic
  // shows its worst (lowest) matched pillar — real per-domain score, no fabricated single
  // number (health-engine.ts HEALTH_PILLARS; useHealthPillars, Stage 4b).
  const isCompositeTopic = topic?.slug === "m365-health";
  const relevantPillars = useMemo(
    () => (topic ? pillars.filter((p) => topic.healthPillarKeys.includes(p.pillar)) : []),
    [topic, pillars],
  );
  const worstRelevantPillar = useMemo(
    () => (relevantPillars.length ? [...relevantPillars].sort((a, b) => a.score - b.score)[0] : null),
    [relevantPillars],
  );
  const domainScore = isCompositeTopic ? overallHealthScore : (worstRelevantPillar?.score ?? null);

  // Cross-topic quiz nudge: only fires when the Lead Offer Engine actually inferred a
  // signal relevant to THIS topic — falls back to cold content otherwise, per §3 ("do not
  // force an irrelevant nudge onto every page for every quiz taker").
  const relevantQuizSignal = useMemo(
    () =>
      topic ? (leadOffer?.inferredSignals ?? []).find((s) => topicMatchesKeywordText(topic.slug, s.signalKey)) : undefined,
    [topic, leadOffer],
  );

  useEffect(() => {
    if (!topic) return;
    if (tier === "assessment" && relevantPillars.length > 0) {
      trackEvent("personalization_shown", { tier: "assessment", surface: "topic_page", topic: topic.slug });
    } else if (tier === "quiz" && relevantQuizSignal) {
      trackEvent("personalization_shown", { tier: "quiz", surface: "topic_page", topic: topic.slug });
    }
  }, [topic, tier, relevantPillars.length, relevantQuizSignal]);

  if (!topic) return <NotFound />;

  // Standard SaaS 8-section structure (PLATFORM_BUILD.md "Copilot & AI Topic Page" task) —
  // scoped to the topic that has the extra content fields populated, so the other 7
  // Solutions/Topic pages keep rendering the original template below, unchanged.
  const useExpandedStructure = Boolean(topic.productOverview);

  const Icon = topic.icon;

  const coldHeadline = (
    <>
      {topic.headlinePrefix}
      <GradientText>{topic.headlineSuffix}</GradientText>
    </>
  );

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
            <PersonalizedContent
              cold={coldHeadline}
              quiz={
                relevantQuizSignal ? (
                  <>
                    Your {topic.shortLabel} Readiness — <GradientText>tailored to what you told us</GradientText>
                  </>
                ) : (
                  coldHeadline
                )
              }
              assessment={
                domainScore !== null ? (
                  <>
                    Your real {topic.shortLabel} score: <GradientText>{Math.round(domainScore)}</GradientText>
                  </>
                ) : (
                  coldHeadline
                )
              }
            />
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

          {/* Personalization slot (website-rebuild-reference-v2.md §3, Stage 4b): cold visitors see
              the generic Stage 2 stat panels; a quiz-tier visitor with a relevant inferred signal
              sees a softened "based on what you told us" nudge; an Assessment-verified visitor sees
              their real Architecture Health Engine pillar score(s) for this domain, stated as fact. */}
          <PersonalizedContent
            cold={
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
                {topic.stats.map((s) => (
                  <StatPanel key={s.label} label={s.label} value={s.value} />
                ))}
              </div>
            }
            quiz={
              relevantQuizSignal ? (
                <div className="max-w-2xl mx-auto">
                  <GlassPanel className="p-6 text-left">
                    <p className="text-text-secondary leading-relaxed">
                      Your quiz answers point to a real gap in {topic.title.toLowerCase()}. A free
                      Assessment scans your actual tenant against the real Graph API to confirm it.
                    </p>
                  </GlassPanel>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
                  {topic.stats.map((s) => (
                    <StatPanel key={s.label} label={s.label} value={s.value} />
                  ))}
                </div>
              )
            }
            assessment={
              domainScore !== null ? (
                <div className="max-w-2xl mx-auto">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {(isCompositeTopic ? pillars : relevantPillars).map((p) => (
                      <StatPanel
                        key={p.pillar}
                        label={HEALTH_PILLAR_LABELS[p.pillar] ?? p.pillar}
                        value={Math.round(p.score)}
                      />
                    ))}
                  </div>
                  {presentation && portalUrl && (
                    <a
                      href={`${portalUrl}/customer-sow/${presentation.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-6 inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-white transition-opacity hover:opacity-90"
                      style={{ background: "linear-gradient(90deg, var(--accent-blue), var(--accent-violet))" }}
                      data-track="cta"
                      onClick={() =>
                        trackEvent("personalization_nudge_click", {
                          tier: "assessment",
                          surface: "topic_page",
                          topic: topic.slug,
                          destination: "presentation",
                        })
                      }
                    >
                      View your priced project plan <ArrowRight className="w-4 h-4" />
                    </a>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
                  {topic.stats.map((s) => (
                    <StatPanel key={s.label} label={s.label} value={s.value} />
                  ))}
                </div>
              )
            }
          />
        </div>
      </section>

      {useExpandedStructure ? (
        <>
          {/* What This Product Actually Does */}
          <section className="py-16 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2 className="font-display text-2xl font-bold text-text-primary mb-5">
                What This Product Actually Does
              </h2>
              <p className="text-text-secondary leading-relaxed">{topic.productOverview}</p>
            </div>
          </section>

          {/* Built by the Microsoft 365 Architect for NASA */}
          <section className="py-16 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <GlassPanel className="p-8 sm:p-10">
                <h2 className="font-display text-2xl font-bold text-text-primary mb-4">
                  Built by the <GradientText>Microsoft 365 Architect</GradientText> for NASA
                </h2>
                <p className="text-text-secondary leading-relaxed">{topic.credibilityBody}</p>
              </GlassPanel>
            </div>
          </section>

          {/* Why This Product Matters */}
          <section className="py-16 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2 className="font-display text-2xl font-bold text-text-primary mb-5">
                Why This Product Matters
              </h2>
              <p className="text-text-secondary leading-relaxed mb-6">{topic.whyItMattersIntro}</p>
              <ul className="space-y-3">
                {topic.risks.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-accent-violet shrink-0 mt-0.5" />
                    <span className="text-text-secondary leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* How This Product Works */}
          <section className="py-16 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2 className="font-display text-2xl font-bold text-text-primary mb-5">
                How This Product Works
              </h2>
              <ol className="space-y-5">
                {(topic.howItWorks ?? []).map((step, i) => (
                  <li key={step.title} className="flex items-start gap-4">
                    <span className="shrink-0 w-8 h-8 rounded-full glass-panel flex items-center justify-center text-accent-blue text-sm font-semibold font-numeric">
                      {i + 1}
                    </span>
                    <div>
                      <p className="text-text-primary font-semibold mb-1">{step.title}</p>
                      <p className="text-text-secondary leading-relaxed">{step.description}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          {/* What You Get */}
          <section className="py-16 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2 className="font-display text-2xl font-bold text-text-primary mb-5">
                What You Get
              </h2>
              <ul className="space-y-3">
                {(topic.whatYouGet ?? []).map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-accent-blue shrink-0 mt-0.5" />
                    <span className="text-text-secondary leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* Product Modules / Features */}
          <section className="py-16 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2 className="font-display text-2xl font-bold text-text-primary mb-5">
                Product Modules & Features
              </h2>
              <p className="text-text-secondary leading-relaxed mb-6">{topic.modulesIntro}</p>
              <ul className="space-y-3">
                {topic.coverage.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <CheckCircle2 className="w-5 h-5 text-accent-blue shrink-0 mt-0.5" />
                    <span className="text-text-secondary leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          {/* Begin Mission Readiness */}
          <section className="py-20 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto text-center">
              <h2 className="font-display text-3xl font-bold text-text-primary mb-4">
                Begin <GradientText>Mission Readiness</GradientText>
              </h2>
              <p className="text-text-secondary mb-8 max-w-xl mx-auto">{topic.finalCtaBody}</p>
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
        </>
      ) : (
        <>
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
        </>
      )}
    </Layout>
  );
}
