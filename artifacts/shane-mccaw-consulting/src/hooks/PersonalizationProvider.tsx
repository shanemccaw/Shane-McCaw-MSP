import { useEffect, useState, type ReactNode } from "react";
import { getAnalyticsSessionId } from "@/lib/analytics";
import {
  INITIAL_STATE,
  PersonalizationContext,
  type AssessmentIdentity,
  type PersonalizationState,
  type QuizIdentity,
} from "./usePersonalizationState";

/**
 * Resolves the site-wide personalization tier for a visitor and publishes it through
 * PersonalizationContext (see usePersonalizationState.ts for the tier model). Split out
 * from the hook/context module so this component keeps a clean React Fast Refresh
 * boundary — see FORCED_REFRESH_INVESTIGATION.md.
 */

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
