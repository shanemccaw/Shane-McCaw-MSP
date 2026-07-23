import { useEffect, useState } from "react";
import { usePersonalizationState } from "./usePersonalizationState";
import { getAnalyticsSessionId } from "@/lib/analytics";

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
  // null when the backing run's real evaluable-check coverage is below the
  // graded doc-gate bar (see doc-gate-coverage.ts) — never a fabricated number.
  score: number | null;
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

// ─── Assessment tier — Architecture Health Engine pillar breakdown ─────────────

export interface HealthPillarScore {
  pillar: string;
  score: number;
}

interface HealthPillarsResult {
  loading: boolean;
  error: string | null;
  score: number | null;
  pillars: HealthPillarScore[];
}

/**
 * Fetches the real Architecture Health Engine composite score + 7-pillar breakdown
 * (governance, compliance, adoption, copilot, architecture, licensing, security —
 * health-engine.ts HEALTH_PILLARS plus the security-engine pillar appended by
 * calculateArchitectureHealthScore) via the existing GET /portal/mission-control/engines
 * route (portal-mission-control.ts) — the same data msp-portal's Mission Control reads.
 * NOT the same source as useAssessmentResultsData: that route is keyed by
 * msp_diagnostic_runs.packageKey, and every Assessment order today runs the single
 * universal "core:security-baseline" package (productTypeConfig.ts) — there is no
 * per-topic packageKey, so it cannot supply a per-domain score. The pillar breakdown
 * is the only real per-domain score source that exists. No-ops outside "assessment" tier.
 */
export function useHealthPillars(): HealthPillarsResult {
  const { tier, assessment } = usePersonalizationState();
  const [score, setScore] = useState<number | null>(null);
  const [pillars, setPillars] = useState<HealthPillarScore[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tier !== "assessment" || !assessment) {
      setScore(null);
      setPillars([]);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch("/api/portal/mission-control/engines", {
      headers: { Authorization: `Bearer ${assessment.accessToken}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load health pillars (${res.status})`);
        return (await res.json()) as { health: { score: number | null; pillars: HealthPillarScore[] } };
      })
      .then((payload) => {
        if (cancelled) return;
        setScore(payload.health.score);
        setPillars(payload.health.pillars);
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
  }, [tier, assessment]);

  return { loading, error, score, pillars };
}

// ─── Assessment tier — real priced project SOW ("presentation") ───────────────

export interface LatestPresentation {
  id: number;
  status: string;
  totalPrice: string | null;
  createdAt: string;
}

interface LatestPresentationResult {
  loading: boolean;
  presentation: LatestPresentation | null;
}

/**
 * Checks whether the current assessment-tier visitor has a real, already-generated
 * priced project SOW ("presentation") via the existing GET /portal/presentations/latest
 * route (portal.ts) — resolves by the caller's own userId, no id param needed. This is
 * the CRM-bound quick_win_presentations flow, not a true Assessment consolidated_sow
 * (PLATFORM_BUILD.md 2026-07-19 "Assessment Payment Plan Screen": phased SOW generation
 * off the CRM presentation model is still BLOCKED) — it's the only real, resolvable
 * "does this visitor have a priced deliverable" check that exists today. `presentation:
 * null` is a valid state (no presentation generated yet), not an error — callers must
 * not show a broken link in that case. No-ops outside "assessment" tier.
 */
export function useLatestPresentation(): LatestPresentationResult {
  const { tier, assessment } = usePersonalizationState();
  const [presentation, setPresentation] = useState<LatestPresentation | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (tier !== "assessment" || !assessment) {
      setPresentation(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetch("/api/portal/presentations/latest", {
      headers: { Authorization: `Bearer ${assessment.accessToken}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load presentation (${res.status})`);
        return (await res.json()) as { presentation: LatestPresentation | null };
      })
      .then((payload) => {
        if (!cancelled) setPresentation(payload.presentation);
      })
      .catch(() => {
        if (!cancelled) setPresentation(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tier, assessment]);

  return { loading, presentation };
}

// ─── Assessment tier — real cross-app Portal URL resolution ───────────────────

interface PortalUrlResult {
  loading: boolean;
  /** The visitor's real MSP-hosted portal base URL, or null if unresolvable. */
  portalUrl: string | null;
}

/**
 * Resolves the current assessment-tier visitor's real msp-portal base URL, reusing
 * the EXISTING POST /api/public/checkout/gate endpoint (msp-onboarding.ts) — the same
 * real, already-shipped mechanism Login.tsx and checkout/CheckoutGate.tsx use to hand a
 * recognized visitor off to their reseller-branded portal domain. Deliberately not a new
 * lookup: this is the only real email→portal-URL resolution mechanism in the codebase.
 * IMPORTANT, verified via code read (msp-onboarding.ts /public/checkout/gate): this only
 * resolves for customers of a reseller MSP (mspUser exists and is NOT isDirectBusiness).
 * For Shane's own direct-business customers the endpoint returns action:"proceed" with no
 * portalUrl — confirmed as a pre-existing gap, not something this hook can fix (Login.tsx's
 * own "proceed" branch already tells direct clients to use their welcome-email link instead,
 * since no generic direct-business portal URL is resolvable from the public site today).
 * Callers must treat `portalUrl: null` as "cannot build this link" and fall back honestly,
 * not assume every assessment-tier visitor gets a working cross-app link.
 */
export function usePortalUrl(): PortalUrlResult {
  const { tier, assessment } = usePersonalizationState();
  const [portalUrl, setPortalUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (tier !== "assessment" || !assessment?.email) {
      setPortalUrl(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    fetch("/api/public/checkout/gate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: assessment.email }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Gate check failed (${res.status})`);
        return (await res.json()) as { action: "proceed" | "redirect"; portalUrl?: string };
      })
      .then((data) => {
        if (!cancelled) setPortalUrl(data.action === "redirect" && data.portalUrl ? data.portalUrl : null);
      })
      .catch(() => {
        if (!cancelled) setPortalUrl(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tier, assessment]);

  return { loading, portalUrl };
}

// ─── Quiz + Assessment tier — live Engagement Offer Engine eligibility ─────────

export interface EngagementOfferService {
  id: number;
  name: string;
  slug: string | null;
  priceCents: number | null;
}

export interface EngagementOffer {
  ruleName: string;
  discountPct: number;
  services: EngagementOfferService[];
}

interface EngagementOfferResult {
  loading: boolean;
  offer: EngagementOffer | null;
}

interface EngagementOfferResponse {
  eligible: boolean;
  ruleName?: string;
  discountPct?: number;
  services?: EngagementOfferService[];
}

/**
 * Stage 4c live-query (website-rebuild-reference-v2.md §3): while a recognized quiz or
 * assessment-tier visitor is still browsing, checks whether the Engagement Offer Engine
 * (engagement-offer-engine.ts) has already fired a bundle for them via the new
 * GET /api/public/personalization/engagement-offer route — a real-time alternative to
 * waiting on the separate 1-2hr delayed-follow-up workflow (built elsewhere, not here).
 * Cold-tier visitors have no lead identity to check against, so this no-ops for them —
 * there is deliberately no cold-tier version of this feature. `offer: null` is a valid,
 * common state (not eligible yet, or the engine's leads-table bridge doesn't reach this
 * visitor — see the endpoint's own comment for that real, pre-existing gap).
 */
export function useEngagementOffer(): EngagementOfferResult {
  const { tier, loading: tierLoading, assessment } = usePersonalizationState();
  const [offer, setOffer] = useState<EngagementOffer | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (tierLoading || (tier !== "quiz" && tier !== "assessment")) {
      setOffer(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const params = new URLSearchParams({ sessionId: getAnalyticsSessionId() });
    if (tier === "assessment" && assessment?.email) {
      params.set("email", assessment.email);
    }

    fetch(`/api/public/personalization/engagement-offer?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load engagement offer (${res.status})`);
        return (await res.json()) as EngagementOfferResponse;
      })
      .then((data) => {
        if (cancelled) return;
        setOffer(
          data.eligible && data.services?.length
            ? { ruleName: data.ruleName ?? "", discountPct: data.discountPct ?? 0, services: data.services }
            : null,
        );
      })
      .catch(() => {
        if (!cancelled) setOffer(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tier, tierLoading, assessment]);

  return { loading, offer };
}
