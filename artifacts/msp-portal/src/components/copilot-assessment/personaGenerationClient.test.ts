/**
 * personaGenerationClient.test.ts — #283 (Copilot Assessment epic #183).
 *
 * Shane hit a real 502 on persona generation; the fix (see
 * api-server's copilot-assessment-personas.test.ts for the server half)
 * converted the route to SSE so the connection never sits idle. This file
 * pins down the CLIENT side of that: fetchPersonaStories must consume the
 * real SSE stream incrementally and report genuine, changing progress to its
 * caller — not just resolve once at the very end — which is what
 * PersonasScreen's loading state now displays instead of a bare spinner.
 *
 * Run with Node's own test runner (msp-portal has no vitest — see the "test"
 * script in its package.json):
 *   pnpm --filter @workspace/msp-portal test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { fetchPersonaStories, type PersonaGenerationProgress } from './personaGenerationClient.ts';
import type { QuizProfile } from './types';

const QUIZ_PROFILE = {
  role: 'Operations Director',
  department: 'Operations',
  industry: 'Healthcare',
  collaboration: ['internal'],
  sensitivity: ['PHI'],
  workflowStyle: 'structured',
  outcomePriorities: ['reduce-admin-time'],
  draftingLoad: 0.8,
  researchLoad: 0.4,
  communicationLoad: 0.6,
  repetitiveLoad: 0.9,
  toolUsage: ['Teams'],
  aiComfort: 'medium',
} as unknown as QuizProfile;

const FIVE_PERSONAS = [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B' },
  { id: 'c', name: 'C' },
  { id: 'd', name: 'D' },
  { id: 'e', name: 'E' },
];

/** SSE line for one event, in the exact wire format the real route writes. */
function sseLine(event: Record<string, unknown>): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Builds a real streaming Response, split across several separately-enqueued
 * chunks — mirroring how the real route writes one `res.write()` per SSE
 * event rather than buffering everything into one write. A client that
 * (incorrectly) waited for `res.json()`/full buffering would still pass a
 * test built on a single enqueued chunk; splitting into several exercises the
 * actual incremental-read path in fetchPersonaStories.
 */
function makeSseResponse(events: Record<string, unknown>[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const event of events) {
        controller.enqueue(encoder.encode(sseLine(event)));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

function makeFetchWithAuth(events: Record<string, unknown>[]) {
  return async (): Promise<Response> => makeSseResponse(events);
}

describe('fetchPersonaStories — SSE progress reporting (#283)', () => {
  it('reports multiple distinct progress updates before resolving, not a single all-at-once callback', async () => {
    const events = [
      { type: 'phase', label: 'Sending your profile to M365 Copilot…', pct: 5 },
      { type: 'phase', label: 'Generating your persona cohort…', pct: 15 },
      { type: 'progress', pct: 40 },
      { type: 'progress', pct: 70 },
      { type: 'phase', label: 'Finalizing personas…', pct: 95 },
      { type: 'done', payload: { personas: FIVE_PERSONAS } },
    ];

    const progressUpdates: PersonaGenerationProgress[] = [];
    const personas = await fetchPersonaStories(makeFetchWithAuth(events), QUIZ_PROFILE, (p) => {
      progressUpdates.push(p);
    });

    assert.equal(personas.length, 5);
    // The honest-progress requirement: several updates, not one static value —
    // this is the actual behaviour PersonasScreen's elapsed-time+pct display
    // depends on to look "alive" rather than a frozen spinner.
    assert.ok(
      progressUpdates.length >= 4,
      `expected several distinct progress callbacks, got ${progressUpdates.length}: ${JSON.stringify(progressUpdates)}`,
    );
    const pcts = progressUpdates.map((p) => p.pct);
    for (let i = 1; i < pcts.length; i++) {
      assert.ok(pcts[i] >= pcts[i - 1], `pct must never regress: ${JSON.stringify(pcts)}`);
    }
    // The real server-sent label text must reach the caller verbatim — never
    // a client-fabricated stage name standing in for it.
    assert.ok(progressUpdates.some((p) => p.label === 'Generating your persona cohort…'));
  });

  it('resolves with the real personas from the done event payload', async () => {
    const events = [
      { type: 'phase', label: 'Sending your profile to M365 Copilot…', pct: 5 },
      { type: 'done', payload: { personas: FIVE_PERSONAS } },
    ];
    const personas = await fetchPersonaStories(makeFetchWithAuth(events), QUIZ_PROFILE);
    assert.deepEqual(personas, FIVE_PERSONAS);
  });

  it('rejects with the real server error message from an SSE error event, not a generic failure', async () => {
    const events = [
      { type: 'phase', label: 'Sending your profile to M365 Copilot…', pct: 5 },
      { type: 'error', message: 'Persona generation is temporarily unavailable. Please try again shortly.' },
    ];
    await assert.rejects(
      () => fetchPersonaStories(makeFetchWithAuth(events), QUIZ_PROFILE),
      /Persona generation is temporarily unavailable/,
    );
  });

  it('rejects if the stream ends without ever sending a done or error event', async () => {
    const events = [{ type: 'phase', label: 'Sending your profile to M365 Copilot…', pct: 5 }];
    await assert.rejects(() => fetchPersonaStories(makeFetchWithAuth(events), QUIZ_PROFILE));
  });

  it('still rejects on a non-2xx HTTP response before ever reading the stream', async () => {
    const fetchWithAuth = async (): Promise<Response> =>
      new Response(JSON.stringify({ error: 'quizProfile is required and must match the QuizProfile shape' }), {
        status: 400,
      });
    await assert.rejects(
      () => fetchPersonaStories(fetchWithAuth, QUIZ_PROFILE),
      /quizProfile is required/,
    );
  });
});
