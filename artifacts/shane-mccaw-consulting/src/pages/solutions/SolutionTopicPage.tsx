import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useRoute } from "wouter";
import { ArrowRight, CheckCircle2, AlertTriangle, ClipboardCheck, Sparkles, FolderKanban } from "lucide-react";
import { Layout } from "@/components/Layout";
import { SEOMeta } from "@/components/SEOMeta";
import { ChatCTA } from "@/components/ChatCTA";
import { GlassPanel } from "@/components/design-system/GlassPanel";
import { GradientText } from "@/components/design-system/GradientText";
import { StatPanel } from "@/components/design-system/StatPanel";
import { RiskList } from "@/components/design-system/RiskList";
import { WorkflowSteps } from "@/components/design-system/WorkflowSteps";
import { DeliverablesList } from "@/components/design-system/DeliverablesList";
import { PillarScoreRing } from "@/components/design-system/PillarScoreRing";
import { IllustrativeBadge } from "@/components/design-system/IllustrativeBadge";
import { HowItWorksShowcase } from "@/components/design-system/HowItWorksShowcase";
import { CategoryBreakdownGrid } from "@/components/design-system/CategoryBreakdownGrid";
import { TrendLineChart } from "@/components/design-system/TrendLineChart";
import { SurfaceRadarChart } from "@/components/design-system/SurfaceRadarChart";
import { ScatterChart } from "@/components/design-system/ScatterChart";
import { ScanSurfaceStrip } from "@/components/design-system/ScanSurfaceStrip";
import {
  getSolutionTopic,
  HEALTH_PILLAR_LABELS,
  topicMatchesKeywordText,
  type FlagshipHeading,
  type SolutionTopicFlagship,
} from "@/data/solutionsTopics";
import { PersonalizedContent } from "@/components/PersonalizedContent";
import { usePersonalizationState } from "@/hooks/usePersonalizationState";
import { useHealthPillars, useLatestPresentation, usePortalUrl, useQuizOfferData } from "@/hooks/usePersonalizationData";
import { useServices, formatPriceDisplay, type PublicService } from "@/hooks/useServices";
import { useCatalog } from "@/hooks/useCatalog";
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
  href?: string;
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
      {href ? (
        <Link
          href={href}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent-blue hover:opacity-80 transition-opacity"
          data-track="cta"
        >
          {linkLabel} <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      ) : (
        <ChatCTA
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent-blue hover:opacity-80 transition-opacity"
          data-track="cta"
        >
          {linkLabel} <ArrowRight className="w-3.5 h-3.5" />
        </ChatCTA>
      )}
    </div>
  );
}

/** One flagship section heading — plain text with an optional gradient-emphasized phrase. */
function FlagshipHeadingText({ h }: { h: FlagshipHeading }) {
  return (
    <>
      {h.pre}
      {h.gradient && <GradientText>{h.gradient}</GradientText>}
      {h.post}
    </>
  );
}

/**
 * Shared scroll-reveal used by every flagship visual panel below — each panel now
 * lives in its own content section (Contextual Visual Enrichment redistribution
 * task) rather than one shared IntersectionObserver on a single combined panel, so
 * each gets its own independent reveal-on-scroll instance. Lazy-initialized so
 * reduced-motion users are "revealed" before first paint — a post-paint setState
 * here would still play the width/dasharray transition.
 */
function useRevealOnScroll<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [revealed, setRevealed] = useState(
    () => typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    if (revealed) return;
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setRevealed(true);
          obs.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [revealed]);

  return [ref, revealed] as const;
}

/**
 * Primary score ring + 7-pillar breakdown grid — paired with the "What You Get"
 * section's real-score claim ("Your governance posture as a live score"). Rebuilt
 * on the Portal's REAL ring pattern (msp-portal score-ring.tsx geometry via
 * PillarScoreRing: SVG dasharray sweep, threshold-colored). Ring + rings sweep in
 * from zero on first scroll into view (site's established width-transition
 * pattern, QuizResultsPage.tsx); skipped for prefers-reduced-motion.
 */
function FlagshipScoreCard({ dashboard }: { dashboard: SolutionTopicFlagship["dashboard"] }) {
  const [ref, revealed] = useRevealOnScroll<HTMLDivElement>();

  return (
    <div ref={ref} className="relative rounded-2xl border border-white/[0.06] bg-charcoal-1 p-6 sm:p-8">
      <IllustrativeBadge />
      <h3 className="text-xs uppercase tracking-widest text-text-secondary mb-6 pr-28">
        {dashboard.panelLabel}
      </h3>

      <div className="flex items-center gap-6">
        <div aria-hidden="true" className="shrink-0">
          <PillarScoreRing value={dashboard.ringValue} size={112} strokeWidth={9} revealed={revealed} />
        </div>
        <div>
          <div className="text-sm font-semibold text-text-primary">{dashboard.ringLabel}</div>
          <div className="text-xs text-text-secondary mt-1">{dashboard.caption}</div>
        </div>
      </div>

      {/* No aria-hidden on this wrapper: PillarScoreRing's svg-level aria-hidden
          already keeps the illustrative values out of the accessibility tree, while
          the mini-heading and the 7 real pillar names stay readable to AT. */}
      {dashboard.pillarBreakdown && (
        <div className="mt-7">
          <div className="text-[10px] uppercase tracking-wider text-text-secondary mb-3">
            Architecture Health Engine — all 7 pillars
          </div>
          <CategoryBreakdownGrid items={dashboard.pillarBreakdown} revealed={revealed} />
        </div>
      )}
    </div>
  );
}

/**
 * Engine trend line — paired with the "What It Does" section's own drift/
 * cadence claim (e.g. Governance's "deviations are flagged on your next
 * scheduled evaluation", or Security's recurring-scan cadence), matching the
 * panel's trendNote language. The heading defaults to the Governance pilot's
 * Drift Engine label; topics re-checked by a different real engine pass their
 * own honest panelHeading instead. No scroll-reveal gating: the original
 * combined panel never gated the chart itself on `revealed` (only the ring
 * dasharray and bar widths), so this preserves that exact behavior.
 */
function FlagshipDriftPanel({
  driftTrend,
  trendNote,
}: {
  driftTrend: NonNullable<SolutionTopicFlagship["dashboard"]["driftTrend"]>;
  trendNote: string;
}) {
  return (
    <div className="relative rounded-2xl border border-white/[0.06] bg-charcoal-1 p-6 sm:p-8">
      <IllustrativeBadge />
      <div className="text-[10px] uppercase tracking-wider text-text-secondary mb-1 pr-28">
        {driftTrend.panelHeading ?? "Drift Engine — scheduled evaluations"}
      </div>
      <TrendLineChart
        data={driftTrend.points}
        seriesLabel={driftTrend.seriesLabel}
        height={140}
        className="mt-3"
      />
      <div className="mt-4 pt-4 border-t border-white/[0.06] flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
        <span className="text-xs text-text-secondary">{trendNote}</span>
      </div>
    </div>
  );
}

/**
 * License utilization scatter — the "What It Does" companion panel for a topic
 * whose section prose makes a two-measure relationship claim instead of a
 * drift/cadence one (M365 Health: "tracks license utilization and waste
 * separately from the health score"). Same panel chrome and badge/caption
 * conventions as FlagshipDriftPanel; the SKU names are real M365 license
 * concepts, the seat values illustrative under the badge.
 */
function FlagshipScatterPanel({
  scatter,
}: {
  scatter: NonNullable<SolutionTopicFlagship["dashboard"]["licenseScatter"]>;
}) {
  return (
    <div className="relative rounded-2xl border border-white/[0.06] bg-charcoal-1 p-6 sm:p-8">
      <IllustrativeBadge />
      <div className="text-[10px] uppercase tracking-wider text-text-secondary mb-1 pr-28">
        {scatter.panelHeading}
      </div>
      <ScatterChart
        points={scatter.points}
        xLabel={scatter.xLabel}
        yLabel={scatter.yLabel}
        height={200}
        className="mt-3"
      />
      <div className="mt-4 pt-4 border-t border-white/[0.06] flex items-center gap-2">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
        <span className="text-xs text-text-secondary">{scatter.caption}</span>
      </div>
    </div>
  );
}

/**
 * Real document products for a flagship topic, resolved live from the catalog by slug
 * (name, price, and description all come from the API response — never hardcoded, per
 * the no-hardcoding rule). A priced listing, deliberately with NO per-card checkout
 * link: Checkout.tsx resolves slugs against monitoring/retainer/msp/config_pack/
 * assessment tiers only (useCatalog) — document_product is NOT among them, so a
 * /checkout/<doc-product-slug> link would dead-end at its not-found step. Renders
 * nothing while loading or when no listed slug resolves to a
 * live catalog row: no empty state, no fabricated products.
 */
function FlagshipDocProducts({ slugs, heading }: { slugs: string[]; heading: FlagshipHeading }) {
  const { services, loading } = useServices({ type: "document_product" });
  const matched = slugs
    .map((slug) => services.find((s) => s.slug === slug))
    .filter((s): s is PublicService => Boolean(s));

  if (loading || matched.length === 0) return null;

  return (
    <div className="mt-12">
      <h3 className="font-display text-xl font-bold text-text-primary mb-6">
        <FlagshipHeadingText h={heading} />
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {matched.map((p) => (
          <div
            key={p.id}
            className="p-6 rounded-2xl bg-charcoal-1 border border-white/[0.06] flex flex-col"
          >
            <div className="flex items-start justify-between gap-4 mb-2">
              <h4 className="font-display font-semibold text-text-primary">{p.name}</h4>
              <span className="font-numeric text-lg text-text-primary shrink-0">
                {formatPriceDisplay(p)}
              </span>
            </div>
            {p.description && (
              <p className="text-sm text-text-secondary leading-relaxed flex-grow">
                {p.description}
              </p>
            )}
          </div>
        ))}
      </div>
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
  // Source assessments from the canonical public catalog (/api/catalog/assessments,
  // filtered on isPublic=true) — the SAME source the Assessments page and the
  // /assessments/:slug detail page (AssessmentDetail) resolve against. The generic
  // /api/services?type=assessment feed used previously filters on a DIFFERENT column
  // (visibility='public', independent of isPublic), so when those diverge it returned
  // no assessment rows here, leaving matchedAssessment null and dead-ending the topic's
  // "Get a Real Assessment" CTA on the generic /assessment list instead of the specific
  // assessment page it links to.
  const { assessmentOffers: assessmentServices } = useCatalog();

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

  // Flagship pilot layer (currently governance only — see SolutionTopic.flagship):
  // hook-quality heading overrides + Portal-preview visuals on top of the expanded
  // structure. Topics without it keep the standard expanded headings unchanged.
  const flagship = topic.flagship;

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
          {/* What This Product Actually Does — flagship pairs the prose with the visual
              matching this section's OWN claim: an engine trend chart where the prose
              makes a drift/cadence claim ("deviations are flagged on your next scheduled
              evaluation"), a license-utilization scatter where it makes a two-measure
              relationship claim (M365 Health's waste-tracked-separately), or no side
              panel at all when the prose claims neither; the scan-surface strip still
              runs full-width below, reinforcing the surface enumeration either way. */}
          <section className="py-12 px-4 sm:px-6 lg:px-8">
            {flagship?.dashboard.driftTrend || flagship?.dashboard.licenseScatter ? (
              <div className="max-w-5xl mx-auto">
                <h2 className="font-display text-2xl font-bold text-text-primary mb-5">
                  <FlagshipHeadingText h={flagship.headings.whatItDoes} />
                </h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-12 items-start">
                  <div>
                    <p className="text-text-secondary leading-relaxed">{topic.productOverview}</p>
                  </div>
                  {flagship.dashboard.driftTrend ? (
                    <FlagshipDriftPanel
                      driftTrend={flagship.dashboard.driftTrend}
                      trendNote={flagship.dashboard.trendNote}
                    />
                  ) : (
                    <FlagshipScatterPanel scatter={flagship.dashboard.licenseScatter!} />
                  )}
                </div>
                {flagship.scanSurfaces && <ScanSurfaceStrip items={flagship.scanSurfaces} className="mt-10" />}
              </div>
            ) : (
              <div className="max-w-3xl mx-auto">
                <h2 className="font-display text-2xl font-bold text-text-primary mb-5">
                  {flagship ? <FlagshipHeadingText h={flagship.headings.whatItDoes} /> : "What This Solution Actually Does"}
                </h2>
                <p className="text-text-secondary leading-relaxed">{topic.productOverview}</p>
                {flagship?.scanSurfaces && <ScanSurfaceStrip items={flagship.scanSurfaces} className="mt-8" />}
              </div>
            )}
          </section>

          {/* Built by the Microsoft 365 Architect for NASA */}
          <section className="py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <GlassPanel className="p-8 sm:p-10">
                <h2 className="font-display text-2xl font-bold text-text-primary mb-4">
                  {flagship ? (
                    <FlagshipHeadingText h={flagship.headings.credibility} />
                  ) : (
                    <>
                      Built by the <GradientText>Microsoft 365 Architect</GradientText> for NASA
                    </>
                  )}
                </h2>
                <p className="text-text-secondary leading-relaxed">{topic.credibilityBody}</p>
              </GlassPanel>
            </div>
          </section>

          {/* Why This Product Matters */}
          <section className="py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto">
              <h2 className="font-display text-2xl font-bold text-text-primary mb-5">
                {flagship ? <FlagshipHeadingText h={flagship.headings.whyItMatters} /> : "Why This Solution Matters"}
              </h2>
              <p className="text-text-secondary leading-relaxed mb-6">{topic.whyItMattersIntro}</p>
              <RiskList items={topic.risks} details={flagship?.riskDetails} />
            </div>
          </section>

          {/* How This Product Works — flagship pairs the 5 real steps with an
              animated per-step visual sequence (HowItWorksShowcase: auto-advancing,
              hover/click-synced; the Findings stage carries the real metric bars
              that used to be this section's single static panel, the Score and
              Remediate stages the established illustrative pillar ring). Heading
              stays hoisted above the grid per the Header Span fix (105a3310). */}
          <section className="py-12 px-4 sm:px-6 lg:px-8">
            {flagship ? (
              <div className="max-w-5xl mx-auto">
                <h2 className="font-display text-2xl font-bold text-text-primary mb-5">
                  <FlagshipHeadingText h={flagship.headings.howItWorks} />
                </h2>
                <HowItWorksShowcase
                  steps={topic.howItWorks ?? []}
                  dashboard={flagship.dashboard}
                  scanSurfaces={flagship.scanSurfaces ?? []}
                  stages={flagship.showcaseStages}
                />
              </div>
            ) : (
              <div className="max-w-3xl mx-auto">
                <h2 className="font-display text-2xl font-bold text-text-primary mb-5">
                  How This Solution Works
                </h2>
                <WorkflowSteps steps={topic.howItWorks ?? []} />
              </div>
            )}
          </section>

          {flagship ? (
            /* What You Get + Product Modules / Features — flagship layout, redistributed
               into two independent paired sections (Contextual Visual Enrichment
               redistribution task) instead of one combined cluster: "What You Get" pairs
               its checklist with the score ring + 7-pillar breakdown (the section's own
               "live score" claim), and "Modules" pairs its checklist with the radar chart
               (the section's own "four real surfaces on one web" claim) — each visual now
               sits beside the specific claim it illustrates, not bundled together in one
               panel ahead of both checklists. */
            <>
              <section className="py-12 px-4 sm:px-6 lg:px-8">
                <div className="max-w-5xl mx-auto">
                  <h2 className="font-display text-2xl font-bold text-text-primary mb-5">
                    <FlagshipHeadingText h={flagship.headings.whatYouGet} />
                  </h2>
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-12 items-start">
                    <div>
                      <DeliverablesList items={topic.whatYouGet ?? []} />
                    </div>
                    <FlagshipScoreCard dashboard={flagship.dashboard} />
                  </div>
                </div>
              </section>

              <section className="py-12 px-4 sm:px-6 lg:px-8">
                <div className={`${flagship.surfaceRadar ? "max-w-5xl" : "max-w-3xl"} mx-auto`}>
                  <h2 className="font-display text-2xl font-bold text-text-primary mb-5">
                    <FlagshipHeadingText h={flagship.headings.modules} />
                  </h2>
                  <p className="text-text-secondary leading-relaxed mb-6">{topic.modulesIntro}</p>
                  {/* The modules claim ("four real surfaces, one accountable baseline") as
                      one web — a radar of the same coverage surfaces, paired directly
                      beside the checklist it illustrates. Sub-scores are illustrative,
                      badged with the same convention as the score card above. Topics
                      whose modules AREN'T parallel dimensions scored in relation (e.g.
                      Migration's sequential gates, or M365 Health where the score card
                      already carries the 7-pillar grid) omit the radar and keep the
                      checklist at prose width instead of a half-empty grid. */}
                  {flagship.surfaceRadar ? (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-12 items-start">
                      <div>
                        <DeliverablesList items={topic.coverage} />
                      </div>
                      <div className="relative rounded-2xl border border-white/[0.06] bg-charcoal-1 p-6 sm:p-8">
                        <IllustrativeBadge />
                        <div aria-hidden="true">
                          <SurfaceRadarChart
                            axes={flagship.surfaceRadar.axes}
                            seriesLabel="Illustrative sub-score"
                            height={240}
                          />
                        </div>
                        <p className="text-xs text-text-secondary text-center mt-3">
                          {flagship.surfaceRadar.caption}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <DeliverablesList items={topic.coverage} />
                  )}
                  <FlagshipDocProducts
                    slugs={flagship.docProductSlugs}
                    heading={flagship.headings.docProducts}
                  />
                </div>
              </section>
            </>
          ) : (
            <>
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
                    What's Included
                  </h2>
                  <p className="text-text-secondary leading-relaxed mb-6">{topic.modulesIntro}</p>
                  <DeliverablesList items={topic.coverage} />
                </div>
              </section>
            </>
          )}

          {/* Begin Mission Readiness */}
          <section className="py-12 px-4 sm:px-6 lg:px-8">
            <div className="max-w-3xl mx-auto text-center">
              <h2 className="font-display text-3xl font-bold text-text-primary mb-4">
                {flagship ? (
                  <FlagshipHeadingText h={flagship.headings.finalCta} />
                ) : (
                  <>
                    Begin <GradientText>Mission Readiness</GradientText>
                  </>
                )}
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
                <p className="text-xs uppercase tracking-widest text-text-secondary mb-3">
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
