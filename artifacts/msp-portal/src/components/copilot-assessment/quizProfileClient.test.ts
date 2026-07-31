/**
 * quizProfileClient.test.ts — #237 (Copilot Assessment epic #183).
 *
 * Client half of the completed-quiz persistence. The server round-trip itself
 * is covered by api-server's copilot-assessment-quiz-profile.test.ts; what this
 * file pins down is the wizard-side consequence Shane actually asked for — a
 * customer who completed the quiz, left, and logged back in is carried PAST the
 * quiz step instead of being shown it again.
 *
 * Run with Node's own test runner (msp-portal has no vitest — see the
 * "test" script in its package.json):
 *   pnpm --filter @workspace/msp-portal test
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchSavedQuizProfile,
  saveQuizProfile,
  shouldAwaitQuizRestore,
  shouldAwaitPersonasRestore,
  shouldSkipQuizStep,
  type QuizProfileRestoreStatus,
} from './quizProfileClient.ts';

// ── A stand-in for the real endpoint, holding exactly what the server holds ────
// Deliberately NOT a canned response: session 2 has to read back what session 1
// wrote, or "survives a fresh login" would be asserting nothing.
function makeFakeBackend() {
  let stored: unknown = null;
  const calls: string[] = [];

  const fetchWithAuth = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push(`${method} ${String(input)}`);
    if (method === 'PUT') {
      stored = JSON.parse(String(init?.body)).quizProfile;
      return new Response(JSON.stringify({ saved: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ quizProfile: stored, completedAt: null }), { status: 200 });
  };

  return { fetchWithAuth, calls, peek: () => stored };
}

const COMPLETED_PROFILE = {
  role: 'Operations Director',
  department: 'Operations',
  industry: 'Healthcare',
  collaboration: ['internal' as const, 'external' as const],
  sensitivity: ['PHI', 'PII'],
  workflowStyle: 'structured' as const,
  outcomePriorities: ['reduce-admin-time'],
  draftingLoad: 0.8,
  researchLoad: 0.4,
  communicationLoad: 0.6,
  repetitiveLoad: 0.9,
  toolUsage: ['Teams', 'SharePoint'],
  aiComfort: 'medium' as const,
};

/**
 * The wizard state the two helpers read, reduced to the three fields that
 * decide what the quiz step does. Mirrors copilot-assessment.tsx's own wiring:
 * the restore fetch sets restoreStatus, handleCompleteQuiz/handleReset move it,
 * and the skip effect applies it once.
 */
type WizardState = {
  currentStep: 'home' | 'quiz' | 'telemetry' | 'personas';
  quizProfile: typeof COMPLETED_PROFILE | null;
  restoreStatus: QuizProfileRestoreStatus;
  location: string;
};

/** The one-shot skip effect from copilot-assessment.tsx, run against `state`. */
function runSkipEffect(state: WizardState): void {
  if (!shouldSkipQuizStep({ currentStep: state.currentStep, quizProfile: state.quizProfile, restoreStatus: state.restoreStatus })) return;
  state.restoreStatus = 'applied';
  state.location = '/copilot-assessment/telemetry';
  state.currentStep = 'telemetry';
}

describe('completed quiz survives a fresh login (#237)', () => {
  it('session 1 saves the profile; session 2 restores it and skips the quiz step', async () => {
    const backend = makeFakeBackend();

    // ── Session 1 — the customer finishes the quiz. handleCompleteQuiz persists
    // it and moves on to telemetry under its own navigation.
    const saved = await saveQuizProfile(backend.fetchWithAuth, COMPLETED_PROFILE);
    assert.equal(saved, true);
    assert.deepEqual(backend.peek(), COMPLETED_PROFILE);

    // ── [gap: logout, a two-hour meeting, log back in] ──
    // Session 2 starts from a clean wizard state — nothing survives in React.
    const state: WizardState = {
      currentStep: 'quiz',
      quizProfile: null,
      restoreStatus: 'idle',
      location: '/copilot-assessment/quiz',
    };

    // While the lookup is outstanding the quiz must be held back, not rendered.
    assert.equal(
      shouldAwaitQuizRestore({ currentStep: state.currentStep, quizProfile: state.quizProfile, restoreStatus: state.restoreStatus }),
      true,
      'quiz step must not render before the saved-profile lookup answers',
    );

    // The mount-time restore effect.
    const restored = await fetchSavedQuizProfile(backend.fetchWithAuth);
    assert.deepEqual(restored, COMPLETED_PROFILE, 'the whole profile comes back, not just a completion flag');
    state.quizProfile = restored;
    state.restoreStatus = 'restored';

    // …and the customer is carried past the quiz without ever seeing it.
    runSkipEffect(state);
    assert.equal(state.location, '/copilot-assessment/telemetry');
    assert.equal(state.currentStep, 'telemetry');
    assert.equal(state.restoreStatus, 'applied');
  });

  it('a first-time customer still gets the quiz', async () => {
    const backend = makeFakeBackend(); // nothing ever saved

    const restored = await fetchSavedQuizProfile(backend.fetchWithAuth);
    assert.equal(restored, null);

    const state: WizardState = { currentStep: 'quiz', quizProfile: null, restoreStatus: 'absent', location: '/copilot-assessment/quiz' };
    assert.equal(shouldAwaitQuizRestore({ ...state }), false, 'nothing to wait for once the lookup has answered');
    runSkipEffect(state);
    assert.equal(state.currentStep, 'quiz', 'first-time customer stays on the quiz');
  });
});

describe('the skip does not fight the customer (#237)', () => {
  it('is one-shot — Back from telemetry reaches the quiz again', () => {
    const state: WizardState = { currentStep: 'quiz', quizProfile: COMPLETED_PROFILE, restoreStatus: 'restored', location: '/copilot-assessment/quiz' };
    runSkipEffect(state);
    assert.equal(state.currentStep, 'telemetry');

    // Browser Back.
    state.currentStep = 'quiz';
    state.location = '/copilot-assessment/quiz';
    runSkipEffect(state);
    assert.equal(state.currentStep, 'quiz', 'a deliberate Back must not be thrown forward again');
    assert.equal(shouldAwaitQuizRestore({ ...state }), false, 'and the quiz actually renders, prefilled');
  });

  it('Reset gives the quiz back', () => {
    const state: WizardState = { currentStep: 'quiz', quizProfile: COMPLETED_PROFILE, restoreStatus: 'restored', location: '/copilot-assessment/quiz' };

    // handleReset: clear the profile and stand the restore down.
    state.quizProfile = null;
    state.restoreStatus = 'absent';

    runSkipEffect(state);
    assert.equal(state.currentStep, 'quiz');
    assert.equal(shouldAwaitQuizRestore({ ...state }), false);
  });

  it('a profile completed in this session does not trigger a second skip', () => {
    // handleCompleteQuiz sets 'applied' precisely so its own navigation is the
    // only one that happens.
    const state: WizardState = { currentStep: 'quiz', quizProfile: COMPLETED_PROFILE, restoreStatus: 'applied', location: '/copilot-assessment/quiz' };
    runSkipEffect(state);
    assert.equal(state.location, '/copilot-assessment/quiz');
  });

  it('only the quiz step is ever skipped', () => {
    for (const step of ['home', 'telemetry'] as const) {
      assert.equal(shouldSkipQuizStep({ currentStep: step, quizProfile: COMPLETED_PROFILE, restoreStatus: 'restored' }), false);
      assert.equal(shouldAwaitQuizRestore({ currentStep: step, quizProfile: null, restoreStatus: 'idle' }), false);
    }
  });
});

describe('Personas does not spin forever on the restore race (#256)', () => {
  it('rapid navigation to Personas right after page load is held back, not spun forever', async () => {
    // Reproduces the exact race from #256: a customer with a REAL saved
    // profile lands on Personas (e.g. the #253 debug skip button, or a
    // direct/bookmarked link) before the mount-time restore fetch has
    // resolved. quizProfile is still null and restoreStatus is still 'idle'
    // at that instant -- indistinguishable, without the guard, from a
    // customer who never completed the quiz at all.
    const backend = makeFakeBackend();
    await saveQuizProfile(backend.fetchWithAuth, COMPLETED_PROFILE); // a real profile IS saved server-side

    const state: WizardState = {
      currentStep: 'personas',
      quizProfile: null,
      restoreStatus: 'idle',
      location: '/copilot-assessment/personas',
    };

    // The instant navigation lands, before the restore promise has settled.
    assert.equal(
      shouldAwaitPersonasRestore({ currentStep: state.currentStep, quizProfile: state.quizProfile, restoreStatus: state.restoreStatus }),
      true,
      'Personas must be held back -- a null quizProfile here is ambiguous, not evidence of "no profile"',
    );

    // The restore promise (already in flight since page mount) resolves.
    const restored = await fetchSavedQuizProfile(backend.fetchWithAuth);
    assert.deepEqual(restored, COMPLETED_PROFILE);
    state.quizProfile = restored;
    state.restoreStatus = 'restored';

    // Personas can now render for real instead of waiting forever.
    assert.equal(
      shouldAwaitPersonasRestore({ currentStep: state.currentStep, quizProfile: state.quizProfile, restoreStatus: state.restoreStatus }),
      false,
      'once the restore answers with a real profile, Personas must stop waiting and generate',
    );
  });

  it('a genuinely first-time customer is not held back once the lookup answers "absent"', async () => {
    const backend = makeFakeBackend(); // nothing ever saved
    const restored = await fetchSavedQuizProfile(backend.fetchWithAuth);
    assert.equal(restored, null);

    const state: WizardState = {
      currentStep: 'personas',
      quizProfile: null,
      restoreStatus: 'absent',
      location: '/copilot-assessment/personas',
    };
    assert.equal(
      shouldAwaitPersonasRestore({ ...state }),
      false,
      'restoreStatus has left idle -- null quizProfile is now real, Personas shows "complete the quiz first" instead of waiting',
    );
  });

  it('normal quiz-completion navigation never hits the race -- handleCompleteQuiz sets quizProfile before it navigates', () => {
    // Mirrors handleCompleteQuiz in copilot-assessment.tsx: quizProfile and
    // restoreStatus='applied' are both set synchronously in the same state
    // update that precedes the navigation call, so Personas (reached later,
    // via telemetry's real onContinue) never sees a null quizProfile for a
    // customer who just finished the quiz in this session.
    const state: WizardState = {
      currentStep: 'personas',
      quizProfile: COMPLETED_PROFILE,
      restoreStatus: 'applied',
      location: '/copilot-assessment/personas',
    };
    assert.equal(shouldAwaitPersonasRestore({ ...state }), false);
  });

  it('only the personas step is ever held back by this guard', () => {
    for (const step of ['home', 'quiz', 'telemetry'] as const) {
      assert.equal(shouldAwaitPersonasRestore({ currentStep: step, quizProfile: null, restoreStatus: 'idle' }), false);
    }
  });
});

describe('a persistence failure never blocks the assessment (#237)', () => {
  it('a failed restore falls back to the quiz instead of stranding the customer', async () => {
    const throwing = async (): Promise<Response> => { throw new Error('network down'); };
    assert.equal(await fetchSavedQuizProfile(throwing), null);

    const errored = async (): Promise<Response> => new Response('boom', { status: 500 });
    assert.equal(await fetchSavedQuizProfile(errored), null);
  });

  it('a failed save reports false rather than throwing out of handleCompleteQuiz', async () => {
    const throwing = async (): Promise<Response> => { throw new Error('network down'); };
    assert.equal(await saveQuizProfile(throwing, COMPLETED_PROFILE), false);

    const errored = async (): Promise<Response> => new Response('boom', { status: 500 });
    assert.equal(await saveQuizProfile(errored, COMPLETED_PROFILE), false);
  });
});
