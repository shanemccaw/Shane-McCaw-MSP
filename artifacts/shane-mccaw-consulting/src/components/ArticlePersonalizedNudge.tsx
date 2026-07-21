import { useEffect, useMemo } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { findTopicByText, HEALTH_PILLAR_LABELS, topicMatchesKeywordText } from "@/data/solutionsTopics";
import { usePersonalizationState } from "@/hooks/usePersonalizationState";
import { useHealthPillars, useQuizOfferData } from "@/hooks/usePersonalizationData";
import { trackEvent } from "@/lib/analytics";

interface ArticlePersonalizedNudgeProps {
  category: string;
  title: string;
}

/**
 * Recognized-visitor nudge for an article tagged to a specific domain
 * (website-rebuild-reference-v2.md §3, Stage 4b). Cold visitors render nothing here —
 * the existing generic <ArticleAssessmentCTA> below the article body already gives every
 * visitor a topic-relevant "take the assessment" link; this is the additional, tier-aware
 * layer for a visitor we actually recognize, tied to their real (assessment) or inferred
 * (quiz) score for that domain. Renders nothing if the article doesn't match a known topic,
 * or if a quiz-tier visitor has no relevant inferred signal for it.
 */
export function ArticlePersonalizedNudge({ category, title }: ArticlePersonalizedNudgeProps) {
  const topic = useMemo(() => findTopicByText(`${category} ${title}`), [category, title]);
  const { tier } = usePersonalizationState();
  const { leadOffer } = useQuizOfferData();
  const { pillars } = useHealthPillars();

  const relevantPillars = useMemo(
    () => (topic ? pillars.filter((p) => topic.healthPillarKeys.includes(p.pillar)) : []),
    [topic, pillars],
  );
  const worstRelevantPillar = useMemo(
    () => (relevantPillars.length ? [...relevantPillars].sort((a, b) => a.score - b.score)[0] : null),
    [relevantPillars],
  );
  const relevantQuizSignal = useMemo(
    () =>
      topic ? (leadOffer?.inferredSignals ?? []).find((s) => topicMatchesKeywordText(topic.slug, s.signalKey)) : undefined,
    [topic, leadOffer],
  );

  const shown = Boolean(topic && ((tier === "assessment" && worstRelevantPillar) || (tier === "quiz" && relevantQuizSignal)));

  useEffect(() => {
    if (shown && topic) {
      trackEvent("personalization_shown", { tier, surface: "article_nudge", topic: topic.slug });
    }
  }, [shown, tier, topic]);

  if (!topic) return null;

  if (tier === "assessment" && worstRelevantPillar) {
    return (
      <div className="mt-6 mb-2 rounded-xl border-l-4 border-accent-blue bg-accent-blue/[0.08] px-6 py-6">
        <p className="text-sm font-semibold text-text-primary mb-2">
          Your real {HEALTH_PILLAR_LABELS[worstRelevantPillar.pillar] ?? worstRelevantPillar.pillar} score:{" "}
          {Math.round(worstRelevantPillar.score)}
        </p>
        <Link
          href={`/solutions/${topic.slug}`}
          className="inline-flex items-center gap-1.5 text-accent-blue font-bold hover:underline text-base"
          data-track="cta"
          onClick={() =>
            trackEvent("personalization_nudge_click", { tier: "assessment", surface: "article_nudge", topic: topic.slug })
          }
        >
          See what's driving it <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    );
  }

  if (tier === "quiz" && relevantQuizSignal) {
    return (
      <div className="mt-6 mb-2 rounded-xl border-l-4 border-accent-blue bg-accent-blue/[0.08] px-6 py-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-accent-blue mb-2">
          Based on what you told us
        </p>
        <p className="text-sm text-text-primary mb-3">
          Your quiz answers point to a gap in {topic.title.toLowerCase()} — worth confirming with a
          free, Graph-based Assessment.
        </p>
        <Link
          href={`/solutions/${topic.slug}`}
          className="inline-flex items-center gap-1.5 text-accent-blue font-bold hover:underline text-base"
          data-track="cta"
          onClick={() =>
            trackEvent("personalization_nudge_click", { tier: "quiz", surface: "article_nudge", topic: topic.slug })
          }
        >
          See your {topic.shortLabel} readiness <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    );
  }

  return null;
}
