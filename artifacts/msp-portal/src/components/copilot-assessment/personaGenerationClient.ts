/**
 * personaGenerationClient.ts
 *
 * Client-side call to POST /api/portal/copilot-assessment/personas (#186) —
 * fetches ~5 AI-generated archetypal personas for the quiz-taker's real
 * QuizProfile. Stateless on the server; copilot-assessment.tsx owns the
 * resulting personas/personasStatus in its own wizard state (same
 * single-source-of-truth pattern the rest of the wizard already uses), so
 * this is a plain fetch wrapper, not a self-contained hook.
 *
 * SSE (#283): the route streams `phase`/`progress`/`done`/`error` events
 * (same shape admin-panel's ScriptGeneratorPage.tsx already consumes from
 * admin-ps-scripts.ts) instead of one blocking JSON response, both to avoid
 * a reverse-proxy idle-connection 502 on a long non-streaming call and to
 * give PersonasScreen's loading state something real to report per update.
 */
import type { PersonaStory, QuizProfile } from './types';

type FetchWithAuth = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface PersonaGenerationProgress {
  pct: number;
  label: string;
}

export async function fetchPersonaStories(
  fetchWithAuth: FetchWithAuth,
  quizProfile: QuizProfile,
  onProgress?: (progress: PersonaGenerationProgress) => void,
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

  if (!res.body) {
    throw new Error('Persona generation returned no stream');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let lastLabel = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) throw new Error('Persona generation stream ended without completing');
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const raw = line.slice(6).trim();
      if (!raw) continue;
      let evt: Record<string, unknown>;
      try {
        evt = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        continue;
      }
      const evtType = evt.type as string | undefined;
      if (evtType === 'phase' || evtType === 'progress') {
        if (typeof evt.label === 'string') lastLabel = evt.label;
        onProgress?.({
          pct: typeof evt.pct === 'number' ? evt.pct : 0,
          label: lastLabel,
        });
      } else if (evtType === 'done') {
        const payload = evt.payload as { personas?: PersonaStory[] } | undefined;
        const personas = payload?.personas;
        if (!Array.isArray(personas) || personas.length === 0) {
          throw new Error('Persona generation returned no personas');
        }
        return personas;
      } else if (evtType === 'error') {
        throw new Error(typeof evt.message === 'string' ? evt.message : 'Persona generation failed');
      }
    }
  }
}
