/**
 * finalReportClient.ts
 *
 * Client-side call to POST /api/portal/copilot-assessment/final-report
 * (#191) — fetches the real 6-8 sentence executive narrative plus the real
 * deterministic ROI score for the quiz-taker's QuizProfile, real generated
 * personas (#186), and real user-configured GovernanceState. Stateless on
 * the server; copilot-assessment.tsx owns the resulting narrative/status in
 * its own wizard state, same single-source-of-truth pattern as
 * personaGenerationClient.ts.
 */
import type { GovernanceState, PersonaStory, QuizProfile, RoiScoreResult } from './types';

type FetchWithAuth = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface FinalReportResult {
  narrativeHtml: string;
  roiScore: RoiScoreResult;
  useCasesConsidered: number;
}

export async function fetchFinalReportNarrative(
  fetchWithAuth: FetchWithAuth,
  quizProfile: QuizProfile,
  personas: PersonaStory[],
  governance: GovernanceState,
): Promise<FinalReportResult> {
  const res = await fetchWithAuth('/api/portal/copilot-assessment/final-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ quizProfile, personas, governance }),
  });

  if (!res.ok) {
    let message = `Final report generation failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* keep the generic message */
    }
    throw new Error(message);
  }

  const json = (await res.json()) as Partial<FinalReportResult>;
  if (!json.narrativeHtml || !json.roiScore) {
    throw new Error('Final report generation returned an incomplete response');
  }
  return json as FinalReportResult;
}
