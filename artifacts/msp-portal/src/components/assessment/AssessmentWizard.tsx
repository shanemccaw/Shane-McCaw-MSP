/**
 * ⚠️ TEMPORARY DEBUG CODE — DELETE BEFORE PRODUCTION ⚠️
 * This file renders a testbed-only debug scan trigger button (see the "scan"
 * case in renderStepContent, guarded by `status.isTestbed`) that exists only so
 * scan progress can be watched live during development. It calls
 * POST /portal/assessment/debug-trigger-scan, which is hard-gated server-side to
 * isTestbed=true customers — this client-side check is only a second layer, not
 * the real safeguard. Must be fully removed before this flow reaches real
 * customers. See backlog: [Shane to add ticket].
 *
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
import { ScoreRing, type ScoreRingColor } from "@/components/ui/score-ring";
import { AssessmentMfaEnrollment } from "./AssessmentMfaEnrollment";
import { AssessmentDocumentViewer } from "./AssessmentDocumentViewer";
import { AssessmentSowSelector } from "./AssessmentSowSelector";
import { AssessmentPaymentPlan } from "./AssessmentPaymentPlan";
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
  AlertTriangle,
  XCircle,
} from "lucide-react";

// ⚠️ TEMPORARY TESTING BYPASS — REMOVE BEFORE PRODUCTION ⚠️
// Mandatory MFA enrollment is a real security requirement — this flag only
// skips it for active testing. Must be removed/set to false before any real
// customer reaches this flow. See backlog: [Shane to add ticket].
const SKIP_MFA_GATE_FOR_TESTING = true;

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
    // Live doc-generation workflow run: run ID for the progress SSE stream, and
    // its status as the reliable terminal signal (failed/cancelled → failure UI).
    workflowRunId: number | null;
    workflowStatus: string | null;
  };
  mfa: { enrolled: boolean };
  // ⚠️ TEMPORARY DEBUG CODE — DELETE BEFORE PRODUCTION ⚠️ (see file header note)
  isTestbed: boolean;
}

// Live diagnostics SSE events (same discriminated union as Mission Control).
type DiagnosticsSSEEvent =
  | { type: "diagnostics_progress"; checkKey: string; checkLabel: string; status: string; index: number; total: number }
  | { type: "diagnostics_complete"; status: string; checksTotal: number; checksOk: number; checksError: number; findings: number }
  | { type: "diagnostics_error"; message: string };

// Live document-generation workflow run SSE events (run-ID-scoped stream).
type DocWorkflowSSEEvent =
  | { type: "workflow_run_progress"; message: string; step?: number; total?: number; nodeId?: string }
  | { type: "workflow_run_complete"; presentationId?: number | string }
  | { type: "workflow_run_error"; message: string };

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
  { key: "sow", title: "Statement of work", subtitle: "Tailor your scope", icon: FileSignature },
  { key: "payment", title: "Choose a plan", subtitle: "Sign & pay", icon: CreditCard },
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
  const [scanLog, setScanLog] = useState<{ checkKey: string; label: string; status: string }[]>([]);
  const [scanJustFinished, setScanJustFinished] = useState(false);
  const [docProgress, setDocProgress] = useState<{ message: string; step?: number; total?: number } | null>(null);

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

  // ⚠️ TEMPORARY DEBUG CODE — DELETE BEFORE PRODUCTION ⚠️ (see file header note)
  const [debugTriggering, setDebugTriggering] = useState(false);
  const debugTriggerScan = useCallback(async () => {
    setDebugTriggering(true);
    try {
      await fetchWithAuth("/api/portal/assessment/debug-trigger-scan", { method: "POST" });
      await loadStatus();
    } finally {
      setDebugTriggering(false);
    }
  }, [fetchWithAuth, loadStatus]);

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
  // A "failed" run is neither active nor a real completion — without this
  // exclusion it would render as "scan complete" with a hollow 0-of-0 result
  // and silently never unlock reports (which need real check data to generate
  // from), leaving the customer stuck with no honest explanation why.
  const scanFailed = Boolean(
    status?.scan.everScanned && !status.scan.active && status.scan.status === "failed",
  );
  const scanComplete = Boolean(
    status?.scan.everScanned && !status.scan.active && status.scan.status !== "failed",
  );
  const reportsComplete = Boolean(status?.documents.allReady);
  // The interactive SOW step unlocks once the consolidated SOW has finished
  // generating (it's the last document produced by the same generation run).
  const sowReady = Boolean(
    status?.documents.items.some(
      (d) => d.docType === "consolidated_sow" && (d.status === "approved" || d.status === "delivered"),
    ),
  );

  // Document generation failed if the workflow run terminated unsuccessfully or a
  // document row is marked failed. Poll-derived (reliable) — the SSE stream only
  // makes it feel instant. A failed run must never leave the wizard spinning.
  const reportsFailed =
    !reportsComplete &&
    ((status?.documents.failed ?? 0) > 0 ||
      status?.documents.workflowStatus === "failed" ||
      status?.documents.workflowStatus === "cancelled");

  // How long after a scan finishes this still counts as a fresh completion,
  // for deciding whether to hold the customer on the scan step's completion
  // reveal instead of auto-advancing them to the reports wait state. Report
  // generation is genuinely slow (LLM-driven, can run several minutes) — the
  // scan itself finishes in under a second, so without this window the "scan
  // complete" reveal (the first real screen a paying customer sees) would be
  // swapped out for the plainer "generating your reports" screen before the
  // customer had any real chance to see it.
  const SCAN_REVEAL_WINDOW_MS = 15 * 60 * 1000;
  const scanFinishedRecently = Boolean(
    status?.scan.lastScanAt &&
      Date.now() - new Date(status.scan.lastScanAt).getTime() < SCAN_REVEAL_WINDOW_MS,
  );

  // The first incomplete, unlocked step — the flow's "current" position. While
  // reports are still generating shortly after a fresh scan, stay on the scan
  // step so its completion reveal is what the customer actually lands on.
  const currentIndex = !scanComplete ? 1 : !reportsComplete ? (scanFinishedRecently ? 1 : 2) : 3;

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
    setScanLog([]);
    setScanJustFinished(false);
    es.onmessage = (event) => {
      const parsed = JSON.parse(event.data) as DiagnosticsSSEEvent;
      if (parsed.type === "diagnostics_progress") {
        setScanProgress({ index: parsed.index, total: parsed.total, label: parsed.checkLabel });
        setScanLog((prev) => [...prev, { checkKey: parsed.checkKey, label: parsed.checkLabel, status: parsed.status }]);
      } else if (parsed.type === "diagnostics_complete") {
        es.close();
        setScanProgress(null);
        // The completion landing needs the poll's authoritative status before it
        // can render (real checksOk/checksTotal, real document state) — this flag
        // only bridges the ~800ms gap so the UI reads as "wrapping up" instead of
        // falling back to a stale "scan in progress" message right after finishing.
        setScanJustFinished(true);
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

  // ── Live document-generation progress via the workflow run-ID SSE stream ────
  // Keyed on the workflow run ID (the only stable handle before the presentation
  // exists). Live progress only — completion/failure are authoritatively detected
  // by the status poll (workflowStatus / allReady / failed), so a dropped stream
  // never strands the wizard. Subscribes only while docs are still generating.
  const docWorkflowRunId = status?.documents.workflowRunId ?? null;
  const docGenActive = docWorkflowRunId != null && !reportsComplete && !reportsFailed;
  useEffect(() => {
    if (!docGenActive || docWorkflowRunId == null || !accessToken) return;
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const es = new EventSource(
      `${base}/api/portal/assessment/doc-workflow/${docWorkflowRunId}/sse?jwt=${encodeURIComponent(accessToken)}`,
    );
    es.onmessage = (event) => {
      const parsed = JSON.parse(event.data) as DocWorkflowSSEEvent;
      if (parsed.type === "workflow_run_progress") {
        setDocProgress({ message: parsed.message, step: parsed.step, total: parsed.total });
      } else if (parsed.type === "workflow_run_complete") {
        es.close();
        setDocProgress(null);
        setTimeout(() => void loadStatus(), 600);
      } else if (parsed.type === "workflow_run_error") {
        es.close();
        setDocProgress(null);
        setTimeout(() => void loadStatus(), 600);
      }
    };
    es.onerror = () => es.close();
    return () => {
      es.close();
      setDocProgress(null);
    };
  }, [docGenActive, docWorkflowRunId, accessToken, loadStatus]);

  // ── Mandatory MFA gate ─────────────────────────────────────────────────────
  // Block the entire flow until the customer enrolls a portal-login second factor.
  if (!SKIP_MFA_GATE_FOR_TESTING && loaded && status && !status.mfa.enrolled && !mfaJustEnrolled) {
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
    if (index === 4) return reportsComplete && sowReady ? "current" : "locked";
    // Payment unlocks alongside the SOW step — the customer settles their scope
    // there, then chooses a plan and signs here.
    if (index === 5) return reportsComplete && sowReady ? "current" : "locked";
    return "locked";
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
          scanLog={scanLog}
          scanJustFinished={scanJustFinished}
          docProgress={docProgress}
          scanComplete={scanComplete}
          scanFailed={scanFailed}
          reportsComplete={reportsComplete}
          reportsFailed={reportsFailed}
          sowReady={sowReady}
          fetchWithAuth={fetchWithAuth}
          onGoToReports={() => isUnlocked(2) && setSelected(2)}
          onGoToReview={() => isUnlocked(3) && setSelected(3)}
          onGoToSow={() => isUnlocked(4) && setSelected(4)}
          onGoToPayment={() => isUnlocked(5) && setSelected(5)}
          debugTriggerScan={debugTriggerScan}
          debugTriggering={debugTriggering}
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

/** Icon for a document's real docType, used in the "generating for you" tease. */
function docTypeIcon(docType: string) {
  return docType === "consolidated_sow" ? (
    <FileSignature className="size-3.5 shrink-0 text-primary" />
  ) : (
    <FileText className="size-3.5 shrink-0 text-primary" />
  );
}

function StepPanel({
  stepKey,
  status,
  scanProgress,
  scanLog,
  scanJustFinished,
  docProgress,
  scanComplete,
  scanFailed,
  reportsComplete,
  reportsFailed,
  sowReady,
  fetchWithAuth,
  onGoToReports,
  onGoToReview,
  onGoToSow,
  onGoToPayment,
  debugTriggerScan,
  debugTriggering,
}: {
  stepKey: StepKey;
  status: AssessmentStatus | null;
  scanProgress: { index: number; total: number; label: string } | null;
  scanLog: { checkKey: string; label: string; status: string }[];
  scanJustFinished: boolean;
  docProgress: { message: string; step?: number; total?: number } | null;
  scanComplete: boolean;
  scanFailed: boolean;
  reportsComplete: boolean;
  reportsFailed: boolean;
  sowReady: boolean;
  fetchWithAuth: ReturnType<typeof useAuth>["fetchWithAuth"];
  onGoToReports: () => void;
  onGoToReview: () => void;
  onGoToSow: () => void;
  onGoToPayment: () => void;
  // ⚠️ TEMPORARY DEBUG CODE — DELETE BEFORE PRODUCTION ⚠️ (see file header note)
  debugTriggerScan: () => Promise<void>;
  debugTriggering: boolean;
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
      // Honest failure — a failed run is never a completion, and there's no
      // self-serve retry for a real customer. Never leave them reading a "0 of 0
      // checks passed" success message for a scan that didn't actually finish.
      if (scanFailed) {
        return (
          <PanelShell icon={AlertTriangle} tone="muted" title="We hit a snag scanning your tenant">
            <p className="text-sm text-muted-foreground">
              Something went wrong while reading your Microsoft&nbsp;365 environment, and we
              couldn't finish the scan automatically. This is on us — nothing you did caused it.
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              Our team has been notified automatically and will get this sorted. This page keeps
              checking, so you can leave it open — it'll update the moment your scan finishes.
            </p>
          </PanelShell>
        );
      }

      if (scanComplete) {
        const total = status.scan.checksTotal ?? 0;
        const ok = status.scan.checksOk ?? 0;
        const pct = total > 0 ? Math.round((ok / total) * 100) : 0;
        const needsAttention = Math.max(0, total - ok);
        const ringColor: ScoreRingColor = total === 0 ? "blue" : pct >= 85 ? "green" : pct >= 60 ? "amber" : "red";
        const docs = status.documents.items;

        return (
          <div className="space-y-5">
            <PanelShell icon={Radar} tone="emerald" title="Deep scan complete">
              {/* ── The reveal — real score as the visual anchor ── */}
              <div className="flex flex-col items-center gap-5 rounded-2xl border border-border bg-gradient-to-b from-primary/10 via-primary/5 to-transparent p-6 text-center animate-in fade-in zoom-in-95 duration-500 motion-reduce:animate-none sm:flex-row sm:text-left">
                <ScoreRing value={pct} color={ringColor} size={116} strokeWidth={9} className="shrink-0" />
                <div className="min-w-0 space-y-1.5">
                  <p className="text-base font-semibold text-foreground sm:text-lg">
                    We finished reading your Microsoft&nbsp;365 environment
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {total > 0 ? (
                      <>
                        <span className="font-mono font-semibold bg-gradient-to-r from-blue-500 to-violet-500 bg-clip-text text-transparent">
                          {ok}/{total}
                        </span>{" "}
                        checks passed
                        {needsAttention > 0 ? (
                          <>
                            {" "}— <span className="font-mono font-semibold text-foreground">{needsAttention}</span>{" "}
                            item{needsAttention === 1 ? "" : "s"} need your attention
                          </>
                        ) : (
                          ", with nothing urgent found"
                        )}
                        .
                      </>
                    ) : (
                      "Your results are being finalized."
                    )}
                  </p>
                </div>
              </div>

              {/* ── The value tease — what's coming next, so this reads as a real
                   product reveal rather than a bare stat ── */}
              <div
                className="mt-5 grid gap-3 sm:grid-cols-2 animate-in fade-in slide-in-from-bottom-2 duration-500 motion-reduce:animate-none"
                style={{ animationDelay: "150ms" }}
              >
                <div className="rounded-xl border border-border bg-card/60 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Generating for you
                  </p>
                  <ul className="mt-3 space-y-2.5">
                    {docs.length > 0 ? (
                      docs.map((d) => (
                        <li key={d.id} className="flex items-center gap-2 text-sm">
                          {docTypeIcon(d.docType)}
                          <span className="min-w-0 flex-1 truncate text-foreground">{d.title}</span>
                          {d.status === "generating" ? (
                            <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                          ) : (
                            <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                          )}
                        </li>
                      ))
                    ) : (
                      <li className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="size-3.5 shrink-0 animate-spin" />
                        Your findings reports and tailored Statement of Work are queued to
                        generate next.
                      </li>
                    )}
                  </ul>
                </div>
                <div className="rounded-xl border border-border bg-card/60 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    What's next
                  </p>
                  <ol className="mt-3 space-y-2.5 text-sm text-muted-foreground">
                    <li className="flex items-center gap-2">
                      <ScrollText className="size-3.5 shrink-0 text-primary" />
                      Review the findings that matter most
                    </li>
                    <li className="flex items-center gap-2">
                      <FileSignature className="size-3.5 shrink-0 text-primary" />
                      Tailor your scope in an interactive Statement of Work — priced from
                      your real scan
                    </li>
                    <li className="flex items-center gap-2">
                      <CreditCard className="size-3.5 shrink-0 text-primary" />
                      Choose a plan and sign
                    </li>
                  </ol>
                </div>
              </div>

              <Button
                className="mt-5 animate-in fade-in slide-in-from-bottom-2 duration-500 motion-reduce:animate-none"
                style={{ animationDelay: "250ms" }}
                onClick={onGoToReports}
              >
                See what's next <ChevronRight className="ml-1 size-4" />
              </Button>

              {/* ⚠️ TEMPORARY DEBUG CODE — DELETE BEFORE PRODUCTION ⚠️ testbed-only re-trigger button, see file header note */}
              {status.isTestbed ? (
                <Button
                  className="mt-4"
                  variant="outline"
                  onClick={() => void debugTriggerScan()}
                  disabled={debugTriggering}
                >
                  {debugTriggering ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
                  [DEBUG] Re-trigger scan
                </Button>
              ) : null}
            </PanelShell>
          </div>
        );
      }

      return (
        <PanelShell icon={Radar} title={scanJustFinished ? "Wrapping up your results…" : "Scanning your tenant"}>
          <p className="text-sm text-muted-foreground">
            {scanJustFinished
              ? "Your scan just finished — we're finalizing your results now."
              : "We're reading your Microsoft 365 configuration and security posture in real time. This usually takes well under a minute."}
          </p>
          {/* ⚠️ TEMPORARY DEBUG CODE — DELETE BEFORE PRODUCTION ⚠️ testbed-only trigger button, see file header note */}
          {status.isTestbed && !status.scan.active ? (
            <Button
              className="mt-4"
              variant="outline"
              onClick={() => void debugTriggerScan()}
              disabled={debugTriggering}
            >
              {debugTriggering ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
              [DEBUG] Trigger scan
            </Button>
          ) : null}
          {scanProgress ? (
            <div className="mt-6 space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span className="truncate pr-2">{scanProgress.label}</span>
                  <span className="shrink-0 tabular-nums font-mono">
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
              {scanLog.length > 0 && (
                <div className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border bg-muted/30 p-3">
                  {scanLog.map((entry, i) => (
                    <div key={`${entry.checkKey}-${i}`} className="flex items-center gap-2 text-xs">
                      {entry.status === "ok" ? (
                        <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                      ) : (
                        <XCircle className="size-3.5 shrink-0 text-red-500" />
                      )}
                      <span className="truncate text-muted-foreground">{entry.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {scanJustFinished
                ? "Finalizing…"
                : status.scan.everScanned
                  ? "Scan in progress…"
                  : "Starting your scan…"}
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
        const readyCount = status.documents.ready;
        return (
          <PanelShell icon={FileText} tone="emerald" title="Your assessment is ready">
            <p className="text-sm text-muted-foreground">
              We've finished generating your assessment{" "}
              {readyCount > 0 ? (
                <>
                  — <span className="font-medium text-foreground">{readyCount} document{readyCount === 1 ? "" : "s"}</span>{" "}
                  including your tailored Statement of Work.
                </>
              ) : (
                "documents, including your tailored Statement of Work."
              )}{" "}
              Review the findings that matter most, then tailor your scope and choose a plan.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button onClick={onGoToReview}>
                Review findings <ChevronRight className="ml-1 size-4" />
              </Button>
              {sowReady && (
                <Button variant="outline" onClick={onGoToSow}>
                  View statement of work
                </Button>
              )}
            </div>
          </PanelShell>
        );
      }
      // Honest failure screen — never leave the customer on a perpetual spinner.
      if (reportsFailed) {
        return (
          <PanelShell icon={AlertTriangle} tone="muted" title="We hit a snag generating your reports">
            <p className="text-sm text-muted-foreground">
              Something went wrong while preparing your assessment documents, and we couldn't
              finish them automatically. This is on us — nothing you did caused it, and your
              scan data is safe.
            </p>
            <p className="mt-3 text-sm text-muted-foreground">
              Our team has been notified automatically and will get your reports sorted. This
              page keeps checking, so you can leave it open — it'll update the moment your
              documents are ready.
            </p>
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
            {docProgress?.message
              ? docProgress.message
              : status.documents.generating > 0
                ? `Generating ${status.documents.generating} report${status.documents.generating === 1 ? "" : "s"}…`
                : "Preparing your reports…"}
          </div>
          {docProgress?.total != null && docProgress.total > 0 && (
            <Progress
              className="mt-4"
              value={Math.min(100, Math.round(((docProgress.step ?? 0) / docProgress.total) * 100))}
            />
          )}
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
      // The SOW is surfaced interactively in its own dedicated step below — keep it
      // out of the read-only findings viewer so it isn't shown twice.
      const findingsDocs = status.documents.items.filter((d) => d.docType !== "consolidated_sow");
      return (
        <PanelShell icon={ScrollText} tone="emerald" title="Review findings">
          <p className="text-sm text-muted-foreground">
            Your reports are ready. Each opens with the findings that matter most, followed
            by the full report.
          </p>
          <div className="mt-5">
            <AssessmentDocumentViewer documents={findingsDocs} fetchWithAuth={fetchWithAuth} />
          </div>
          {sowReady && (
            <Button className="mt-6" onClick={onGoToSow}>
              Continue to your statement of work <ChevronRight className="ml-1 size-4" />
            </Button>
          )}
        </PanelShell>
      );
    }

    case "sow": {
      if (!(reportsComplete && sowReady)) {
        return (
          <PanelShell icon={FileSignature} tone="muted" title="Statement of work">
            <p className="text-sm text-muted-foreground">
              Once your reports finish generating, you'll see a tailored statement of work
              here — with the flexibility to adjust its scope before you proceed.
            </p>
          </PanelShell>
        );
      }
      return (
        <PanelShell icon={FileSignature} tone="primary" title="Your statement of work">
          <p className="text-sm text-muted-foreground">
            Here's the plan we recommend, tailored to what we found. Fine-tune the scope to fit
            your priorities — the price updates as you go.
          </p>
          <div className="mt-5">
            <AssessmentSowSelector fetchWithAuth={fetchWithAuth} />
          </div>
          <a
            href="/assessment/compare"
            className="mt-3 inline-block text-xs font-medium text-primary underline-offset-2 hover:underline"
          >
            Compare this scope with a previous version
          </a>
          <Button className="mt-6" onClick={onGoToPayment}>
            Continue to choose a plan <ChevronRight className="ml-1 size-4" />
          </Button>
        </PanelShell>
      );
    }

    case "payment": {
      if (!(reportsComplete && sowReady)) {
        return (
          <PanelShell icon={CreditCard} tone="muted" title="Choose a plan">
            <p className="text-sm text-muted-foreground">
              Once your statement of work is ready, you'll choose how to pay — in full or phase by
              phase — and sign here.
            </p>
          </PanelShell>
        );
      }
      return (
        <PanelShell icon={CreditCard} tone="primary" title="Choose a plan">
          <p className="text-sm text-muted-foreground">
            You've settled your scope — now choose how you'd like to proceed and sign to confirm.
          </p>
          <div className="mt-5">
            <AssessmentPaymentPlan fetchWithAuth={fetchWithAuth} />
          </div>
        </PanelShell>
      );
    }

    default:
      return null;
  }
}
