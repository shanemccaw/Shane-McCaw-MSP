import { useEffect, useMemo } from "react";
import { Link, useRoute } from "wouter";
import { ArrowRight, CheckCircle2, AlertTriangle, ClipboardCheck, Sparkles, FolderKanban } from "lucide-react";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";
import { StatPanel } from "@/components/design-system/StatPanel";
import { RiskList } from "@/components/design-system/RiskList";
import { WorkflowSteps } from "@/components/design-system/WorkflowSteps";
import { DeliverablesList } from "@/components/design-system/DeliverablesList";
import { getSolutionTopic, HEALTH_PILLAR_LABELS, topicMatchesKeywordText } from "@/data/solutionsTopics";
import { PersonalizedContent } from "@/components/PersonalizedContent";
import { usePersonalizationState } from "@/hooks/usePersonalizationState";
import { useHealthPillars, useLatestPresentation, usePortalUrl, useQuizOfferData } from "@/hooks/usePersonalizationData";
import { useServices } from "@/hooks/useServices";
import { FollowOnProjects } from "@/components/FollowOnProjects";
import { trackEvent } from "@/lib/analytics";
import NotFound from "@/pages/not-found";

/**
 * One step of the Quiz → Assessment → Projects funnel explainer (Real Projects +
 * Assessments CTAs on Topic Pages task, website-rebuild-reference-v2.md §1/§2) —
 * makes the relationship between the three explicit instead of three disconnected CTAs.
 */
function FunnelStep({
  index,
  icon: Icon,
  title,
  body,
  href,
  linkLabel,
}: {
  index: number;
  icon: typeof Sparkles;
  title: string;
  body: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-charcoal-1 p-6 flex flex-col h-full">
      <div className="flex items-center gap-3 mb-4">
        <span className="shrink-0 w-8 h-8 rounded-full glass-panel flex items-center justify-center text-accent-blue text-sm font-semibold font-numeric">
          {index}
        </span>
        <Icon className="w-5 h-5 text-accent-blue" />
      </div>
      <h3 className="font-display text-base font-bold text-text-primary mb-2">{title}</h3>
      <p className="text-sm text-text-secondary leading-relaxed mb-5 flex-grow">{body}</p>
      <Link
        href={href}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent-blue hover:opacity-80 transition-opacity"
        data-track="cta"
      >
        {linkLabel} <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}

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
  const { services: assessmentServices } = useServices({ type: "assessment" });

  // Real, topic-relevant Assessment for the funnel-explainer CTA (Real Projects +
  // Assessments CTAs on Topic Pages task) — matched by the same keyword approach
  // already used for quiz-signal/article nudges (topicMatchesKeywordText), against
  // the real `services` catalog (serviceType='assessment'), never document_products.
  // Several assessments can share a keyword (e.g. "compliance"); the shortest-named
  // match is kept as the most on-topic, single real product to link — not a guess,
  // just a tiebreak among genuine matches. null when nothing in the catalog matches,
  // which the funnel section below handles by falling back to the generic Assessment CTA.
  const matchedAssessment = useMemo(() => {
    if (!topic) return null;
    const matches = assessmentServices.filter((s) => topicMatchesKeywordText(topic.slug, s.name));
    if (matches.length === 0) return null;
    return [...matches].sort((a, b) => a.name.length - b.name.length)[0] ?? null;
  }, [topic, assessmentServices]);

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
      <section className="relative pt-32 sm:pt-40 pb-12 px-4 sm:px-6 lg:px-8 overflow-hidden">
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
          <section className="py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2 className="font-display text-2xl font-bold text-text-primary mb-5">
                What This Product Actually Does
              </h2>
              <p className="text-text-secondary leading-relaxed">{topic.productOverview}</p>
            </div>
          </section>

          {/* Built by the Microsoft 365 Architect for NASA */}
          <section className="py-12 px-4 sm:px-6 lg:px-8">
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
          <section className="py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2 className="font-display text-2xl font-bold text-text-primary mb-5">
                Why This Product Matters
              </h2>
              <p className="text-text-secondary leading-relaxed mb-6">{topic.whyItMattersIntro}</p>
              <RiskList items={topic.risks} />
            </div>
          </section>

          {/* How This Product Works */}
          <section className="py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2 className="font-display text-2xl font-bold text-text-primary mb-5">
                How This Product Works
              </h2>
              <WorkflowSteps steps={topic.howItWorks ?? []} />
            </div>
          </section>

          {/* What You Get */}
          <section className="py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2 className="font-display text-2xl font-bold text-text-primary mb-5">
                What You Get
              </h2>
              <DeliverablesList items={topic.whatYouGet ?? []} />
            </div>
          </section>

          {/* Product Modules / Features */}
          <section className="py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2 className="font-display text-2xl font-bold text-text-primary mb-5">
                Product Modules & Features
              </h2>
              <p className="text-text-secondary leading-relaxed mb-6">{topic.modulesIntro}</p>
              <DeliverablesList items={topic.coverage} />
            </div>
          </section>

          {/* Begin Mission Readiness */}
          <section className="py-12 px-4 sm:px-6 lg:px-8">
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
          <section className="py-12 px-4 sm:px-6 lg:px-8">
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
          <section className="py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <GlassPanel className="p-8 sm:p-10">
                <p className="text-xs uppercase tracking-widest text-text-tertiary mb-3">
                  Powered by
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
          <section className="py-12 px-4 sm:px-6 lg:px-8">
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

      {/* Funnel explainer + real Assessment CTA (Real Projects + Assessments CTAs on
          Topic Pages task) — makes the Quiz → Assessment → Projects relationship explicit
          instead of leaving visitors with disconnected CTAs, per website-rebuild-reference-v2.md
          §1/§2. Shown on every topic page, all tiers — this is orientation, not personalization. */}
      <section className="py-12 px-4 sm:px-6 lg:px-8 border-t border-white/[0.06]">
        <div className="max-w-3xl mx-auto text-center mb-10">
          <h2 className="font-display text-2xl font-bold text-text-primary mb-4">
            How This Actually Works
          </h2>
          <p className="text-text-secondary leading-relaxed">
            Three real steps, not three separate pitches. The {topic.shortLabel} quiz is a
            self-reported read that points you in the right direction. A free or paid Assessment
            replaces the guess with a real Graph API scan of your actual tenant. And if that scan
            turns up a real gap, the fix is a scoped project — priced and agreed before any work
            starts, never an instant checkout.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-4xl mx-auto">
          <FunnelStep
            index={1}
            icon={Sparkles}
            title="Take the Quiz"
            body="Self-reported, a few questions. Tells us — and you — where to look first."
            href={topic.quizHref}
            linkLabel={`Take the ${topic.shortLabel} quiz`}
          />
          <FunnelStep
            index={2}
            icon={ClipboardCheck}
            title="Get a Real Assessment"
            body={
              matchedAssessment
                ? `${matchedAssessment.name} — a real Microsoft Graph API scan of your tenant, not a questionnaire.`
                : "A real Microsoft Graph API scan of your tenant, not a questionnaire."
            }
            href={
              matchedAssessment
                ? `/assessments/${encodeURIComponent(matchedAssessment.slug ?? String(matchedAssessment.id))}`
                : "/assessment"
            }
            linkLabel={matchedAssessment ? `Start the ${matchedAssessment.name}` : "Start a Free Assessment"}
          />
          <FunnelStep
            index={3}
            icon={FolderKanban}
            title="Scope a Project"
            body="If the scan finds a real gap here, we scope it as a priced SOW — a conversation, not a cart."
            href="/book"
            linkLabel="Request a scoped SOW"
          />
        </div>
      </section>

      {/* Real follow-on projects for this topic (engagement_projects, SOW-gated) — renders
          nothing at all when no real project's triggeredBy signal domain matches this topic,
          per this task's explicit no-empty-state rule. */}
      <FollowOnProjects topicSlug={topic.slug} />
    </Layout>
  );
}
