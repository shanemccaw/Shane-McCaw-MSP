/**
 * quizProfileClient.ts
 *
 * Client half of the completed-quiz persistence added in #237 (Copilot
 * Assessment epic, #183): talks to GET/PUT
 * /api/portal/copilot-assessment/quiz-profile, which stores the finished
 * QuizProfile on the caller's own tenant row.
 *
 * Same plain-fetch-wrapper shape as personaGenerationClient.ts /
 * finalReportClient.ts — copilot-assessment.tsx still owns the wizard state;
 * this module only moves the profile between that state and the server.
 */
import type { AssessmentStep, QuizProfile } from './types';

type FetchWithAuth = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const QUIZ_PROFILE_URL = '/api/portal/copilot-assessment/quiz-profile';

/**
 * Where the restore has got to:
 *   'idle'     — the fetch is still outstanding; the quiz must not be rendered yet.
 *   'restored' — a saved profile came back and the customer has not yet been
 *                carried past the quiz step for it.
 *   'applied'  — that skip has happened; the quiz step behaves normally again.
 *   'absent'   — nothing saved (or the fetch failed, or the customer chose to
 *                start over) — show the quiz.
 */
export type QuizProfileRestoreStatus = 'idle' | 'restored' | 'applied' | 'absent';

/**
 * Fetch this customer's previously completed quiz profile.
 *
 * Returns null both for "never completed" and for any failure. That is
 * deliberate: the fallback for an unreadable saved profile is the quiz itself,
 * which is exactly what the customer would have got before #237 — a restore
 * problem must never be able to block someone out of the assessment.
 */
export async function fetchSavedQuizProfile(fetchWithAuth: FetchWithAuth): Promise<QuizProfile | null> {
  try {
    const res = await fetchWithAuth(QUIZ_PROFILE_URL, { credentials: 'include' });
    if (!res.ok) return null;
    const json = (await res.json()) as { quizProfile?: QuizProfile | null };
    return json?.quizProfile ?? null;
  } catch {
    return null;
  }
}

/**
 * Persist a just-completed quiz profile. Best-effort by design: the customer
 * has finished the quiz and must move on to the telemetry step whether or not
 * the save landed, so this resolves false rather than throwing. The cost of a
 * failed save is the old behaviour (a redo next session), not a broken flow.
 */
export async function saveQuizProfile(
  fetchWithAuth: FetchWithAuth,
  quizProfile: QuizProfile,
): Promise<boolean> {
  try {
    const res = await fetchWithAuth(QUIZ_PROFILE_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ quizProfile }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Should the wizard hold the quiz step back rather than render it?
 *
 * True only while the restore fetch is still outstanding AND nothing has been
 * completed in this session — without it the quiz's first question flashes up
 * for a returning customer before the restore lands, which is the very thing
 * #237 is meant to stop.
 */
export function shouldAwaitQuizRestore(args: {
  currentStep: AssessmentStep;
  quizProfile: QuizProfile | null;
  restoreStatus: QuizProfileRestoreStatus;
}): boolean {
  return args.currentStep === 'quiz' && args.quizProfile === null && args.restoreStatus === 'idle';
}

/**
 * Should the wizard move a returning customer straight past the quiz?
 *
 * True only when a profile was actually restored from the server AND is still
 * the state's current profile AND that restore has not already been acted on.
 * All three halves matter:
 *  - restoreStatus 'restored' alone is not enough — a Reset clears
 *    state.quizProfile, and the customer must then be able to retake the quiz
 *    rather than be bounced off it forever by a stale restore flag.
 *  - a quizProfile alone is not enough either — one just completed in this
 *    session is already handled by handleCompleteQuiz's own navigation.
 *  - and the skip is one-shot ('restored' -> 'applied'), so deliberately
 *    pressing Back from the telemetry step still reaches the quiz instead of
 *    being thrown forward again by a standing redirect.
 */
export function shouldSkipQuizStep(args: {
  currentStep: AssessmentStep;
  quizProfile: QuizProfile | null;
  restoreStatus: QuizProfileRestoreStatus;
}): boolean {
  return args.currentStep === 'quiz' && args.quizProfile !== null && args.restoreStatus === 'restored';
}

/**
 * Should the wizard hold the Personas step back rather than render it? (#256)
 *
 * Personas needs a quizProfile to generate anything, but a null quizProfile is
 * ambiguous on its own: it means either "genuinely nothing saved" or "the
 * restore fetch just hasn't answered yet" (the #237 race #256 was filed
 * for — reachable via the #253 debug skip button, a direct/bookmarked link to
 * this step, or a refresh while on it). Only the second case should hold the
 * step back; once restoreStatus leaves 'idle' (whether 'restored' or
 * 'absent') a null quizProfile is real and Personas can render its own
 * "complete the quiz first" state instead of waiting forever.
 */
export function shouldAwaitPersonasRestore(args: {
  currentStep: AssessmentStep;
  quizProfile: QuizProfile | null;
  restoreStatus: QuizProfileRestoreStatus;
}): boolean {
  return args.currentStep === 'personas' && args.quizProfile === null && args.restoreStatus === 'idle';
}
