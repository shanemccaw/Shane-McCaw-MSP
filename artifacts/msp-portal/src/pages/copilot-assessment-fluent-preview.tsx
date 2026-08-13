/**
 * copilot-assessment-fluent-preview.tsx
 *
 * ISOLATED PREVIEW ROUTE — #288 (parent epic #183).
 *
 * Renders PersonasScreenFluentPreview, the real-Fluent-2 restyle of the
 * Personas page, on its own URL under the existing internal-artifact prefix
 * (the same one /dev/style-guide already uses):
 *
 *     /dev/fluent-personas-preview
 *
 * Deliberately NOT part of the real wizard's `/copilot-assessment/:step`
 * routing — different first path segment, so it cannot collide with a step
 * name, cannot be reached by stepping through the flow, and cannot be
 * navigated into by the wizard's own `handleNavigate`. Not in nav; nothing in
 * the customer-facing flow links here.
 *
 * Gating: testbed accounts only, resolved from the real server-side
 * `tenants.isTestbed` flag via GET /portal/assessment/testbed-status — the same
 * gate every other debug affordance in this epic uses (#231/#253), not a client
 * heuristic. Non-testbed accounts get an explicit "not available" notice rather
 * than the preview.
 *
 * Data: REAL, and on exactly the same path the live Personas step uses —
 *   1. GET  /portal/copilot-assessment/quiz-profile   (the customer's own real
 *      saved QuizProfile, #237)
 *   2. POST /portal/copilot-assessment/personas       (the real SSE persona
 *      generation run, #186/#283)
 * There is no fixture, no seeded persona and no placeholder anywhere in this
 * route. If the account has no saved quiz profile, the preview shows the same
 * honest "complete the quiz first" state the production screen shows.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { PersonasScreenFluentPreview } from '@/components/copilot-assessment/screens/PersonasScreenFluentPreview';
import { fetchSavedQuizProfile } from '@/components/copilot-assessment/quizProfileClient';
import { fetchPersonaStories } from '@/components/copilot-assessment/personaGenerationClient';
import type {
  PersonaGenerationStatus,
  PersonaStory,
  QuizProfile,
} from '@/components/copilot-assessment/types';

type TestbedGate = 'checking' | 'allowed' | 'denied';

export default function CopilotAssessmentFluentPreviewPage() {
  const { fetchWithAuth } = useAuth();

  const [gate, setGate] = useState<TestbedGate>('checking');
  const [quizProfile, setQuizProfile] = useState<QuizProfile | null>(null);
  const [profileResolved, setProfileResolved] = useState(false);
  const [personas, setPersonas] = useState<PersonaStory[]>([]);
  const [personasStatus, setPersonasStatus] = useState<PersonaGenerationStatus>('idle');
  const [personasError, setPersonasError] = useState<string | null>(null);
  const [personasProgress, setPersonasProgress] = useState<{ pct: number; label: string } | null>(
    null,
  );

  // Real server-side testbed check — same endpoint and same discipline as the
  // wizard's own gate. Defaults to 'checking' then 'denied', so the preview is
  // genuinely absent until a testbed account is confirmed.
  useEffect(() => {
    let cancelled = false;
    fetchWithAuth('/api/portal/assessment/testbed-status', undefined, { silent: true })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setGate('denied');
          return;
        }
        const data = (await res.json()) as { isTestbed?: boolean };
        if (!cancelled) setGate(data.isTestbed === true ? 'allowed' : 'denied');
      })
      .catch(() => {
        if (!cancelled) setGate('denied');
      });
    return () => {
      cancelled = true;
    };
  }, [fetchWithAuth]);

  // Real saved QuizProfile restore (#237). `profileResolved` distinguishes
  // "nothing saved" from "the fetch hasn't answered yet" — without it a null
  // profile would flash the "complete the quiz first" state on every load, the
  // exact ambiguity #256 was filed for.
  useEffect(() => {
    if (gate !== 'allowed') return;
    let cancelled = false;
    fetchSavedQuizProfile(fetchWithAuth).then((profile) => {
      if (cancelled) return;
      setQuizProfile(profile);
      setProfileResolved(true);
    });
    return () => {
      cancelled = true;
    };
  }, [gate, fetchWithAuth]);

  // Real persona generation, same call the live Personas step makes. Fires once
  // per restored profile.
  useEffect(() => {
    if (gate !== 'allowed' || !quizProfile || personasStatus !== 'idle') return;
    let cancelled = false;
    setPersonasStatus('loading');
    setPersonasError(null);
    setPersonasProgress(null);
    fetchPersonaStories(fetchWithAuth, quizProfile, (progress) => {
      if (!cancelled) setPersonasProgress(progress);
    })
      .then((result) => {
        if (cancelled) return;
        setPersonas(result);
        setPersonasStatus('ready');
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setPersonasError(err.message);
        setPersonasStatus('error');
      });
    return () => {
      cancelled = true;
    };
    // personasStatus is intentionally excluded: this effect sets it
    // (idle -> loading) in its own body, so including it self-cancels the run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gate, quizProfile, fetchWithAuth]);

  if (gate === 'checking') {
    return <PreviewNotice title="Checking access…" detail="Resolving testbed status." />;
  }

  if (gate === 'denied') {
    return (
      <PreviewNotice
        title="Fluent 2 design preview — not available"
        detail="This route is an internal design-evaluation artifact for issue #288 and is limited to testbed accounts. It is not part of the Copilot Assessment flow."
      />
    );
  }

  // Hold the screen back while the profile restore is still outstanding, rather
  // than flashing the "complete the quiz first" state at a customer who has one.
  if (!profileResolved) {
    return <PreviewNotice title="Fluent 2 design preview" detail="Restoring your saved quiz profile…" />;
  }

  return (
    <PersonasScreenFluentPreview
      quizProfile={quizProfile}
      personas={personas}
      personasStatus={personasStatus}
      personasError={personasError}
      personasProgress={personasProgress}
      fetchWithAuth={fetchWithAuth}
    />
  );
}

/**
 * Pre-Fluent notice states. Deliberately plain and outside FluentProvider:
 * these are route-gate messages, not part of the design comparison, and
 * rendering them in Fluent would muddy what the preview is actually showing.
 */
function PreviewNotice({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="max-w-md w-full rounded-2xl border border-border bg-card/80 p-8 text-center space-y-3">
        <h1 className="text-base font-bold text-foreground">{title}</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">{detail}</p>
      </div>
    </div>
  );
}
