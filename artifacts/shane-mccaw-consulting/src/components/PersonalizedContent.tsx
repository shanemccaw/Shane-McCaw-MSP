import type { ReactNode } from "react";
import {
  usePersonalizationState,
  type AssessmentIdentity,
  type QuizIdentity,
} from "@/hooks/usePersonalizationState";

/**
 * Shared tier-rendering contract for personalized page sections
 * (website-rebuild-reference-v2.md §3). Stage 4b pages pass content for each tier;
 * this component picks the right one and structurally enforces the confidence-tier
 * tone rule so individual pages don't have to remember it:
 *
 * - cold: generic marketing, rendered as-is.
 * - quiz: self-reported/inferred — always wrapped in a visible "based on what you
 *   told us" frame. Never presented with assessment-tier certainty.
 * - assessment: real Graph-based scan, logged in — rendered as-is, stated as fact,
 *   no hedging wrapper.
 *
 * While the tier is still resolving, the cold slot renders (never a blank page).
 */

type SlotContent<TIdentity> = ReactNode | ((identity: TIdentity) => ReactNode);

interface PersonalizedContentProps {
  cold: ReactNode;
  quiz: SlotContent<QuizIdentity>;
  assessment: SlotContent<AssessmentIdentity>;
}

function resolveSlot<TIdentity>(slot: SlotContent<TIdentity>, identity: TIdentity): ReactNode {
  return typeof slot === "function" ? (slot as (identity: TIdentity) => ReactNode)(identity) : slot;
}

function QuizToneFrame({ children }: { children: ReactNode }) {
  return (
    <div data-personalization-tier="quiz">
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-tertiary mb-2">
        Based on what you told us
      </span>
      <div>{children}</div>
    </div>
  );
}

export function PersonalizedContent({ cold, quiz, assessment }: PersonalizedContentProps) {
  const state = usePersonalizationState();

  if (!state.loading && state.tier === "assessment" && state.assessment) {
    return <div data-personalization-tier="assessment">{resolveSlot(assessment, state.assessment)}</div>;
  }

  if (!state.loading && state.tier === "quiz" && state.quiz) {
    return <QuizToneFrame>{resolveSlot(quiz, state.quiz)}</QuizToneFrame>;
  }

  return <div data-personalization-tier="cold">{cold}</div>;
}
