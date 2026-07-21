import { createContext, useContext } from "react";

/**
 * Site-wide personalization foundation (website-rebuild-reference-v2.md §3). Resolves
 * every visitor to exactly one of three confidence tiers:
 *
 * - "assessment": a real authenticated session exists. Assessment (free or paid) always
 *   requires an account, so this is checked via the platform's real auth mechanism — the
 *   same POST /api/auth/refresh (httpOnly refresh-token cookie) + Authorization: Bearer
 *   pattern LandingPage.tsx already uses to detect a logged-in visitor from the public
 *   site. Not a workaround — the actual session check.
 * - "quiz": no account, but the durable smc_sid cookie (Stage 1's analytics.ts) resolves
 *   to a lead with quiz history via GET /api/public/personalization/state.
 * - "cold": neither of the above.
 *
 * The resolution logic that populates this state lives in the PersonalizationProvider
 * component (PersonalizationProvider.tsx). This module holds only the shared context,
 * types, and read hook so that editing either side does not break the other's React Fast
 * Refresh boundary (the two used to live in one mixed component+hook file, which poisoned
 * every page's HMR — see FORCED_REFRESH_INVESTIGATION.md).
 *
 * This layer only resolves WHICH tier a visitor is in and the minimal identity each tier
 * needs to fetch its own data (see usePersonalizationData.ts) — it does not fetch quiz
 * offers or assessment results itself.
 */

export type PersonalizationTier = "cold" | "quiz" | "assessment";

export interface AssessmentIdentity {
  accessToken: string;
  customerId: number;
  mspId: number | null;
  mspRole: string | null;
  name: string | null;
  email: string;
}

export interface QuizIdentity {
  leadId: number;
  quizType: string;
  resendToken: string;
}

export interface PersonalizationState {
  tier: PersonalizationTier;
  /** True until the initial assessment/quiz resolution has finished at least once. */
  loading: boolean;
  assessment: AssessmentIdentity | null;
  quiz: QuizIdentity | null;
}

export const INITIAL_STATE: PersonalizationState = {
  tier: "cold",
  loading: true,
  assessment: null,
  quiz: null,
};

export const PersonalizationContext = createContext<PersonalizationState>(INITIAL_STATE);

export function usePersonalizationState(): PersonalizationState {
  return useContext(PersonalizationContext);
}
