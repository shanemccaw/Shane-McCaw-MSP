import { useEffect, useState } from "react";
import { usePersonalizationState } from "./usePersonalizationState";

/**
 * Typed data-fetching pattern for the two non-cold personalization tiers
 * (website-rebuild-reference-v2.md §3). Each hook only fetches once its tier's
 * identity is resolved by PersonalizationProvider — pages consuming these are
 * Stage 4b work, not built here.
 */

// ─── Quiz tier — Lead Offer Engine output ──────────────────────────────────────

export interface LeadOfferCandidate {
  serviceId: number;
  serviceName: string;
  title: string;
  rationale: string;
  basePriceCents: number;
  adjustedPriceCents: number;
  aiPricingReasoning: string | null;
  score: number;
  expirationDays: number;
}

export interface LeadOfferResult {
  inferredSignals: { signalKey: string; confidence: number }[];
  candidates: LeadOfferCandidate[];
  generatedAt: string;
}

export interface QuizResultsPayload {
  name: string;
  totalScore: number;
  tier: string;
  quizType: string;
  categoryScores: Record<string, number>;
  categoryConfig: unknown;
  recommendedService: string | null;
  reportName: string;
  whatThisMeans: string;
  whyThisFits: string;
  roiProjection: string;
  createdAt: string;
  detectedSeats: number | null;
  // A null leadOffer is a valid, real state (no offer was generated for this lead) —
  // callers must render their cold/no-offer fallback here, not treat it as an error.
  leadOffer: LeadOfferResult | null;
}

interface QuizOfferDataResult {
  loading: boolean;
  error: string | null;
  quizResults: QuizResultsPayload | null;
  /** Convenience accessor — mirrors quizResults.leadOffer, still null-safe. */
  leadOffer: LeadOfferResult | null;
}

/**
 * Fetches the real quiz results + Lead Offer Engine output for the current
 * quiz-tier visitor via the existing GET /api/quiz/results/:leadId route
 * (quiz.ts), using the resend token PersonalizationProvider already obtained.
 * No-ops (returns nulls) outside the "quiz" tier.
 */
export function useQuizOfferData(): QuizOfferDataResult {
  const { tier, quiz } = usePersonalizationState();
  const [quizResults, setQuizResults] = useState<QuizResultsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tier !== "quiz" || !quiz) {
      setQuizResults(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/quiz/results/${quiz.leadId}?token=${encodeURIComponent(quiz.resendToken)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load quiz results (${res.status})`);
        return (await res.json()) as QuizResultsPayload;
      })
      .then((payload) => {
        if (!cancelled) setQuizResults(payload);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tier, quiz]);

  return { loading, error, quizResults, leadOffer: quizResults?.leadOffer ?? null };
}

// ─── Assessment tier — real Graph-based scan results ───────────────────────────

export interface AssessmentFinding {
  id: string;
  title: string;
  severity: string;
  recommendation: string | null;
}

export interface AssessmentResultsPayload {
  serviceSlug: string;
  score: number;
  status: "not_evaluated" | "healthy" | "warning" | "critical" | string;
  findings: AssessmentFinding[];
  evaluatedAt: string;
}

interface AssessmentResultsDataResult {
  loading: boolean;
  error: string | null;
  results: AssessmentResultsPayload | null;
}

/**
 * Fetches the real Assessment scan results for the current assessment-tier visitor
 * via the existing GET /api/portal/assessment-results/:serviceSlug route
 * (msp-diagnostics.ts) — the same data source msp-portal's Assessment Results Viewer
 * (assessment-dashboard.tsx) already reads, reused here rather than duplicated.
 * serviceSlug is caller-supplied (Stage 4b resolves the right slug per topic page).
 * No-ops (returns nulls) outside the "assessment" tier or without a slug.
 */
export function useAssessmentResultsData(serviceSlug: string | null): AssessmentResultsDataResult {
  const { tier, assessment } = usePersonalizationState();
  const [results, setResults] = useState<AssessmentResultsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tier !== "assessment" || !assessment || !serviceSlug) {
      setResults(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/portal/assessment-results/${encodeURIComponent(serviceSlug)}`, {
      headers: { Authorization: `Bearer ${assessment.accessToken}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load assessment results (${res.status})`);
        return (await res.json()) as AssessmentResultsPayload;
      })
      .then((payload) => {
        if (!cancelled) setResults(payload);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unknown error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tier, assessment, serviceSlug]);

  return { loading, error, results };
}
