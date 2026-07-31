/**
 * personaGenerationClient.ts
 *
 * Client-side call to POST /api/portal/copilot-assessment/personas (#186) —
 * fetches ~5 AI-generated archetypal personas for the quiz-taker's real
 * QuizProfile. Stateless on the server; copilot-assessment.tsx owns the
 * resulting personas/personasStatus in its own wizard state (same
 * single-source-of-truth pattern the rest of the wizard already uses), so
 * this is a plain fetch wrapper, not a self-contained hook.
 */
import type { PersonaStory, QuizProfile } from './types';

type FetchWithAuth = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function fetchPersonaStories(
  fetchWithAuth: FetchWithAuth,
  quizProfile: QuizProfile,
): Promise<PersonaStory[]> {
  const res = await fetchWithAuth('/api/portal/copilot-assessment/personas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ quizProfile }),
  });

  if (!res.ok) {
    let message = `Persona generation failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* keep the generic message */
    }
    throw new Error(message);
  }

  const json = (await res.json()) as { personas?: PersonaStory[] };
  if (!Array.isArray(json.personas) || json.personas.length === 0) {
    throw new Error('Persona generation returned no personas');
  }
  return json.personas;
}
