/**
 * AssessmentWizard.tsx
 *
 * The Assessment flow container — the locked, sequential step experience that
 * mounts inside the Assessment shell. This is the *flow-control* surface only
 * (task 2): it moves the customer from "assessment ordered" through "all reports
 * finished generating", gating each step on its predecessor. It renders
 * placeholders where later tasks own the real content (document views, OMG
 * cards, the SOW selector, payment) — it never renders that content itself.
 *
 * What it wires together, all reusing existing platform mechanisms:
 *   - Live scan progress via the existing diagnostics SSE stream
 *     (/api/msp/customers/:id/diagnostics/runs/:runId/sse) — the same stream the
 *     CustomerUser Mission Control scan strip uses.
 *   - Document-generation wait state via polling GET /api/portal/assessment/status
 *     (insights documents expose no per-document SSE channel; their status column
 *     flipping generating → approved/delivered is the platform's completion signal).
 *   - The mandatory first-login MFA gate (AssessmentMfaEnrollment).
 *   - The first-login provisioning trigger (POST /portal/first-login/provision).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AssessmentMfaEnrollment } from "./AssessmentMfaEnrollment";
import { AssessmentDocumentViewer } from "./AssessmentDocumentViewer";
import {
  CheckCircle2,
  ChevronRight,
  FileText,
  FileSignature,
  CreditCard,
  Loader2,
  Lock,
  Radar,
  ScrollText,
  ShieldCheck,
} from "lucide-react";

// ── Status payload (mirrors GET /api/portal/assessment/status) ────────────────

interface AssessmentDocument {
  id: number;
  docType: string;
  category: string;
  title: string;
  status: string;
}

interface AssessmentStatus {
  scan: {
    active: boolean;
    runId: string | null;
    status: string | null;
    startedAt: string | null;
    checksTotal: number | null;
    checksOk: number | null;
    checksError: number | null;
    lastScanAt: string | null;
    everScanned: boolean;
  };
  documents: {
    items: AssessmentDocument[];
    total: number;
    generating: number;
    ready: number;
    failed: number;
    allReady: boolean;
  };
  mfa: { enrolled: boolean };
}

// Live diagnostics SSE events (same discriminated union as Mission Control).
type DiagnosticsSSEEvent =
  | { type: "diagnostics_progress"; checkKey: string; checkLabel: string; status: string; index: number; total: number }
  | { type: "diagnostics_complete"; status: string; checksTotal: number; checksOk: number; checksError: number; findings: number }
  | { type: "diagnostics_error"; message: string };

const POLL_INTERVAL_MS = 4000;

// ── Step model ────────────────────────────────────────────────────────────────

type StepKey = "consent" | "scan" | "reports" | "review" | "sow" | "payment";

interface StepDef {
  key: StepKey;
  title: string;
  subtitle: string;
  icon: typeof Radar;
}

const STEPS: StepDef[] = [
  { key: "consent", title: "Consent granted", subtitle: "Access authorized", icon: ShieldCheck },
  { key: "scan", title: "Deep scan", subtitle: "Reading your tenant", icon: Radar },
  { key: "reports", title: "Reports", subtitle: "Generating findings", icon: FileText },
  { key: "review", title: "Review findings", subtitle: "Your results", icon: ScrollText },
  { key: "sow", title: "Statement of work", subtitle: "Coming up", icon: FileSignature },
  { key: "payment", title: "Choose a plan", subtitle: "Coming up", icon: CreditCard },
];

type StepState = "complete" | "current" | "locked";

export function AssessmentWizard() {
  const { user, accessToken, fetchWithAuth } = useAuth();
  const customerId = user?.customerId ?? null;

  const [status, setStatus] = useState<AssessmentStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mfaJustEnrolled, setMfaJustEnrolled] = useState(false);
  const [selected, setSelected] = useState<number>(1); // default to the scan step
  const [scanProgress, setScanProgress] = useState<{ index: number; total: number; label: string } | null>(null);

  const prevCurrentRef = useRef<number | null>(null);
  const provisionFiredRef = useRef(false);

  // ── Load status (polled) ───────────────────────────────────────────────────
  const loadStatus = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/portal/assessment/status", undefined, { silent: true });
      if (res.ok) {
        const data = (await res.json()) as AssessmentStatus;
        setStatus(data);
      }
    } catch {
      // best-effort; the next poll retries
    } finally {
      setLoaded(true);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void loadStatus();
    const t = setInterval(() => void loadStatus(), POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [loadStatus]);

  // ── First-login provisioning trigger (fire once on mount) ──────────────────
  useEffect(() => {
    if (provisionFiredRef.current) return;
    provisionFiredRef.current = true;
    void fetchWithAuth("/api/portal/first-login/provision", { method: "POST" }, { silent: true }).catch(
      () => {
        /* provisioning is best-effort and idempotent server-side */
      },
    );
  }, [fetchWithAuth]);

  // ── Derived step completion ────────────────────────────────────────────────
  const scanComplete = Boolean(status?.scan.everScanned && !status.scan.active);
  const reportsComplete = Boolean(status?.documents.allReady);

  // The first incomplete, unlocked step — the flow's "current" position.
  const currentIndex = !scanComplete ? 1 : !reportsComplete ? 2 : 3;

  // Follow the flow forward when a milestone advances it, but leave the user on
  // whatever step they clicked to between milestones.
  useEffect(() => {
    if (prevCurrentRef.current !== currentIndex) {
      setSelected(currentIndex);
      prevCurrentRef.current = currentIndex;
    }
  }, [currentIndex]);

  // ── Live scan progress via the existing diagnostics SSE endpoint ───────────
  const scanActive = status?.scan.active ?? false;
  const scanRunId = status?.scan.runId ?? null;
  useEffect(() => {
    if (!scanActive || !scanRunId || customerId == null || !accessToken) return;
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const es = new EventSource(
      `${base}/api/msp/customers/${customerId}/diagnostics/runs/${scanRunId}/sse?jwt=${encodeURIComponent(accessToken)}`,
    );
    es.onmessage = (event) => {
      const parsed = JSON.parse(event.data) as DiagnosticsSSEEvent;
      if (parsed.type === "diagnostics_progress") {
        setScanProgress({ index: parsed.index, total: parsed.total, label: parsed.checkLabel });
      } else if (parsed.type === "diagnostics_complete") {
        es.close();
        setScanProgress(null);
        setTimeout(() => void loadStatus(), 800);
      } else if (parsed.type === "diagnostics_error") {
        es.close();
        setScanProgress(null);
        setTimeout(() => void loadStatus(), 800);
      }
    };
    es.onerror = () => es.close();
    return () => {
      es.close();
      setScanProgress(null);
    };
  }, [scanActive, scanRunId, customerId, accessToken, loadStatus]);

  // ── Mandatory MFA gate ─────────────────────────────────────────────────────
  // Block the entire flow until the customer enrolls a portal-login second factor.
  if (loaded && status && !status.mfa.enrolled && !mfaJustEnrolled) {
    return (
      <AssessmentMfaEnrollment
        onEnrolled={() => {
          setMfaJustEnrolled(true);
          void loadStatus();
        }}
      />
    );
  }

  if (!loaded && !status) {
    return (
      <div className="mx-auto w-full max-w-4xl px-6 py-10">
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>
    );
  }

  const stepState = (index: number): StepState => {
    if (index === 0) return "complete"; // consent
    if (index === 1) return scanComplete ? "complete" : "current";
    if (index === 2) {
      if (!scanComplete) return "locked";
      return reportsComplete ? "complete" : "current";
    }
    if (index === 3) return reportsComplete ? "current" : "locked";
    return "locked"; // sow, payment — future tasks
  };

  const isUnlocked = (index: number): boolean => stepState(index) !== "locked";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 md:flex-row md:px-6">
      {/* ── Locked, sequential step sidebar ── */}
      <nav className="md:w-64 md:shrink-0" aria-label="Assessment steps">
        <ol className="flex gap-2 overflow-x-auto pb-2 md:flex-col md:gap-1 md:overflow-visible md:pb-0">
          {STEPS.map((step, i) => {
            const state = stepState(i);
            const unlocked = state !== "locked";
            const active = i === selected;
            const Icon = step.icon;
            return (
              <li key={step.key} className="shrink-0 md:shrink">
                <button
                  type="button"
                  disabled={!unlocked}
                  onClick={() => unlocked && setSelected(i)}
                  aria-current={active ? "step" : undefined}
                  className={[
                    "flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors",
                    active
                      ? "border-primary/40 bg-primary/5"
                      : "border-transparent hover:bg-muted/60",
                    !unlocked ? "cursor-not-allowed opacity-50" : "cursor-pointer",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "flex size-8 shrink-0 items-center justify-center rounded-full",
                      state === "complete"
                        ? "bg-emerald-500/15 text-emerald-500"
                        : state === "current"
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground",
                    ].join(" ")}
                  >
                    {state === "complete" ? (
                      <CheckCircle2 className="size-4" />
                    ) : state === "locked" ? (
                      <Lock className="size-3.5" />
                    ) : (
                      <Icon className="size-4" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">
                      {step.title}
                    </span>
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {step.subtitle}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {/* ── Step content panel ── */}
      <section className="min-w-0 flex-1">
        <StepPanel
          stepKey={STEPS[selected].key}
          status={status}
          scanProgress={scanProgress}
          scanComplete={scanComplete}
          reportsComplete={reportsComplete}
          fetchWithAuth={fetchWithAuth}
          onGoToReview={() => isUnlocked(3) && setSelected(3)}
        />
      </section>
    </div>
  );
}

// ── Per-step content ───────────────────────────────────────────────────────────

function PanelShell({
  icon: Icon,
  tone = "primary",
  title,
  children,
}: {
  icon: typeof Radar;
  tone?: "primary" | "emerald" | "muted";
  title: string;
  children: React.ReactNode;
}) {
  const toneCls =
    tone === "emerald"
      ? "bg-emerald-500/10 text-emerald-500"
      : tone === "muted"
        ? "bg-muted text-muted-foreground"
        : "bg-primary/10 text-primary";
  return (
    <div className="rounded-2xl border border-border bg-card p-6 md:p-8">
      <div className="flex items-center gap-3">
        <div className={`flex size-11 items-center justify-center rounded-2xl ${toneCls}`}>
          <Icon className="size-5" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      </div>
      <div className="mt-5">{children}</div>
    </div>
  );
}

function StepPanel({
  stepKey,
  status,
  scanProgress,
  scanComplete,
  reportsComplete,
  fetchWithAuth,
  onGoToReview,
}: {
  stepKey: StepKey;
  status: AssessmentStatus | null;
  scanProgress: { index: number; total: number; label: string } | null;
  scanComplete: boolean;
  reportsComplete: boolean;
  fetchWithAuth: ReturnType<typeof useAuth>["fetchWithAuth"];
  onGoToReview: () => void;
}) {
  if (!status) return null;

  switch (stepKey) {
    case "consent":
      return (
        <PanelShell icon={ShieldCheck} tone="emerald" title="Consent granted">
          <p className="text-sm text-muted-foreground">
            Thanks — you authorized read access to your Microsoft&nbsp;365 tenant. That's
            everything we need to begin. Your deep scan runs next; you don't have to do
            anything else.
          </p>
        </PanelShell>
      );

    case "scan": {
      if (scanComplete) {
        const total = status.scan.checksTotal ?? 0;
        const ok = status.scan.checksOk ?? 0;
        return (
          <PanelShell icon={Radar} tone="emerald" title="Deep scan complete">
            <p className="text-sm text-muted-foreground">
              We finished scanning your tenant{total > 0 ? <> — <span className="font-medium text-foreground">{ok} of {total}</span> checks passed</> : null}.
              We're now turning the findings into your reports.
            </p>
            <div className="mt-4 flex items-center gap-2 text-sm text-emerald-500">
              <CheckCircle2 className="size-4" /> Scan finished
            </div>
          </PanelShell>
        );
      }
      return (
        <PanelShell icon={Radar} title="Scanning your tenant">
          <p className="text-sm text-muted-foreground">
            We're reading your Microsoft&nbsp;365 configuration and security posture. This
            usually takes a couple of minutes — you can watch the progress below.
          </p>
          {scanProgress ? (
            <div className="mt-6 space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="truncate pr-2">{scanProgress.label}</span>
                <span className="shrink-0 tabular-nums">
                  {scanProgress.index}/{scanProgress.total}
                </span>
              </div>
              <Progress
                value={
                  scanProgress.total > 0
                    ? Math.round((scanProgress.index / scanProgress.total) * 100)
                    : 0
                }
              />
            </div>
          ) : (
            <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {status.scan.everScanned ? "Scan in progress…" : "Starting your scan…"}
            </div>
          )}
        </PanelShell>
      );
    }

    case "reports": {
      if (!scanComplete) {
        return (
          <PanelShell icon={FileText} tone="muted" title="Reports">
            <p className="text-sm text-muted-foreground">
              Your reports become available once the deep scan finishes.
            </p>
          </PanelShell>
        );
      }
      if (reportsComplete) {
        return (
          <PanelShell icon={FileText} tone="emerald" title="Your reports are ready">
            <p className="text-sm text-muted-foreground">
              We've finished generating your assessment reports. Head to{" "}
              <span className="font-medium text-foreground">Review findings</span> to read them.
            </p>
            <Button className="mt-5" onClick={onGoToReview}>
              Review findings <ChevronRight className="ml-1 size-4" />
            </Button>
          </PanelShell>
        );
      }
      return (
        <PanelShell icon={FileText} title="Generating your reports">
          <p className="text-sm text-muted-foreground">
            We're writing up what we found into clear, prioritized reports. This can take a
            few minutes — this page updates automatically, so you can keep it open.
          </p>
          <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {status.documents.generating > 0
              ? `Generating ${status.documents.generating} report${status.documents.generating === 1 ? "" : "s"}…`
              : "Preparing your reports…"}
          </div>
        </PanelShell>
      );
    }

    case "review": {
      if (!reportsComplete) {
        return (
          <PanelShell icon={ScrollText} tone="muted" title="Review findings">
            <p className="text-sm text-muted-foreground">
              This unlocks once your reports have finished generating.
            </p>
          </PanelShell>
        );
      }
      return (
        <PanelShell icon={ScrollText} tone="emerald" title="Review findings">
          <p className="text-sm text-muted-foreground">
            Your reports are ready. Each opens with the findings that matter most, followed
            by the full report.
          </p>
          <div className="mt-5">
            <AssessmentDocumentViewer
              documents={status.documents.items}
              fetchWithAuth={fetchWithAuth}
            />
          </div>
        </PanelShell>
      );
    }

    case "sow":
      return (
        <PanelShell icon={FileSignature} tone="muted" title="Statement of work">
          <p className="text-sm text-muted-foreground">
            After you review your findings, you'll see a tailored statement of work here.
            This step is coming in a later release.
          </p>
        </PanelShell>
      );

    case "payment":
      return (
        <PanelShell icon={CreditCard} tone="muted" title="Choose a plan">
          <p className="text-sm text-muted-foreground">
            The final step — choosing how you'd like to proceed — will appear here in a
            later release.
          </p>
        </PanelShell>
      );

    default:
      return null;
  }
}
