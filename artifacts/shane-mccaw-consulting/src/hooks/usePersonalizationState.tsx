import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getAnalyticsSessionId } from "@/lib/analytics";

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
 * This provider only resolves WHICH tier a visitor is in and the minimal identity each
 * tier needs to fetch its own data (see usePersonalizationData.ts) — it does not fetch
 * quiz offers or assessment results itself.
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

const INITIAL_STATE: PersonalizationState = {
  tier: "cold",
  loading: true,
  assessment: null,
  quiz: null,
};

const PersonalizationContext = createContext<PersonalizationState>(INITIAL_STATE);

interface RefreshResponse {
  accessToken?: string;
  user?: {
    customerId?: number;
    mspId?: number;
    mspRole?: string;
    name?: string;
    email?: string;
  };
}

interface PersonalizationStateResponse {
  tier: "cold" | "quiz";
  leadId?: number;
  quizType?: string;
  resendToken?: string;
}

async function resolveAssessmentIdentity(): Promise<AssessmentIdentity | null> {
  try {
    const res = await fetch("/api/auth/refresh", { method: "POST", credentials: "include" });
    if (!res.ok) return null;
    const data = (await res.json()) as RefreshResponse;
    if (!data.accessToken || data.user?.customerId == null) return null;
    return {
      accessToken: data.accessToken,
      customerId: data.user.customerId,
      mspId: data.user.mspId ?? null,
      mspRole: data.user.mspRole ?? null,
      name: data.user.name ?? null,
      email: data.user.email ?? "",
    };
  } catch {
    return null;
  }
}

async function resolveQuizIdentity(): Promise<QuizIdentity | null> {
  try {
    const sessionId = getAnalyticsSessionId();
    const res = await fetch(`/api/public/personalization/state?sessionId=${encodeURIComponent(sessionId)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as PersonalizationStateResponse;
    if (data.tier !== "quiz" || data.leadId == null || !data.resendToken) return null;
    return { leadId: data.leadId, quizType: data.quizType ?? "copilot", resendToken: data.resendToken };
  } catch {
    return null;
  }
}

export function PersonalizationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PersonalizationState>(INITIAL_STATE);

  useEffect(() => {
    let cancelled = false;

    async function resolve() {
      // Assessment tier takes priority — a logged-in visitor is always the highest
      // confidence tier available, even if they also have older quiz history.
      const assessment = await resolveAssessmentIdentity();
      if (cancelled) return;
      if (assessment) {
        setState({ tier: "assessment", loading: false, assessment, quiz: null });
        return;
      }

      const quiz = await resolveQuizIdentity();
      if (cancelled) return;
      if (quiz) {
        setState({ tier: "quiz", loading: false, assessment: null, quiz });
        return;
      }

      setState({ tier: "cold", loading: false, assessment: null, quiz: null });
    }

    void resolve();
    return () => {
      cancelled = true;
    };
  }, []);

  return <PersonalizationContext.Provider value={state}>{children}</PersonalizationContext.Provider>;
}

export function usePersonalizationState(): PersonalizationState {
  return useContext(PersonalizationContext);
}
