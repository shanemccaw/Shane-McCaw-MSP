/**
 * ⚠️ TEMPORARY DEBUG CODE — DELETE BEFORE PRODUCTION ⚠️
 * This file renders a testbed-only debug scan trigger button (see the
 * "generating" case in StepPanel, guarded by `status.isTestbed`) that exists
 * only so scan progress can be watched live during development. It calls
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
import { useTheme } from "@/lib/theme-context";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AssessmentMfaEnrollment } from "./AssessmentMfaEnrollment";
import { AssessmentDocumentViewer } from "./AssessmentDocumentViewer";
import { AssessmentSowSelector } from "./AssessmentSowSelector";
import { AssessmentPaymentPlan } from "./AssessmentPaymentPlan";
// Real radar/spider chart renderer from the platform's dashboard web-part
// system — the same component real dashboards use for pillar-snapshot
// widgets (engine.pillarSnapshot). Aliased to avoid colliding with the
// lucide-react "Radar" icon already used as this step's PanelShell icon.
import { Radar as RadarChart, type DistributionWidgetData } from "@workspace/dashboard-canvas";
import {
  CheckCircle2,
  ChevronRight,
  Coins,
  FileText,
  FileSignature,
  CreditCard,
  ListChecks,
  Loader2,
  Lock,
  Quote,
  Radar,
  Route,
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
    checksLicenseGap: number | null;
    licenseGapFeatures: string[];
    lastScanAt: string | null;
    everScanned: boolean;
  };
  documents: {
    items: AssessmentDocument[];
    // Real titles of every document the assessment service will generate (from
    // the service's associated-documents mapping), present from the moment the
    // customer lands here — before any `items` row exists — so the generation
    // checklist can be rendered by real name up front, not only as rows appear.
    expected: { docType: string; title: string }[];
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
  // Document-generation coverage decision. `blocked` is the honest terminal
  // signal that the scan finished but too few checks produced a real result
  // (below minRequiredPct) to responsibly generate documents — so we say so
  // plainly instead of spinning forever. Null until a scan finishes.
  docGeneration: {
    blocked: boolean;
    band: "no_data" | "insufficient" | "sufficient";
    coveragePct: number;
    evaluableChecks: number;
    totalChecks: number;
    minRequiredPct: number;
  } | null;
  mfa: { enrolled: boolean };
  // CIO-Report Narrative — the "senior M365 Architect" narrative of this scan's
  // real, already-classified findings + real peer-benchmark data, generated by
  // cio-narrative-generator.ts as soon as the scan completes (independent of how
  // long document generation still has left). "not_started" until a completed
  // scan exists to narrate.
  narrative: {
    status: "not_started" | "generating" | "ready" | "failed";
    html: string | null;
    generatedAt: string | null;
  };
  // Real tenant-health radar — only pillars this customer's actual scanned
  // package genuinely covers (pillar-coverage.ts on the backend). Empty until
  // the package has real monitoring_package_checks rows curated for it.
  radar: {
    packageKey: string | null;
    pillars: { pillar: string; label: string; score: number }[];
  };
  // Real stat cards — every number traces to this run's own persisted summary
  // or a live cost-engine query; null means "no real data yet", never a
  // placeholder.
  stats: {
    genuineFindings: number | null;
    licenseWasteMonthlyCents: number | null;
  };
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

// "scan" and "reports" are deliberately ONE step ("generating"): the customer
// watches the deep scan, then every document, then the SOW complete on a single
// continuous screen with a live checklist — never a separate per-phase wait
// screen to click through.
type StepKey = "consent" | "generating" | "review" | "sow" | "payment";

interface StepDef {
  key: StepKey;
  title: string;
  subtitle: string;
  icon: typeof Radar;
}

const STEPS: StepDef[] = [
  { key: "consent", title: "Consent granted", subtitle: "Access authorized", icon: ShieldCheck },
  { key: "generating", title: "Generating your assessment", subtitle: "Scan, reports & SOW", icon: Radar },
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
  const [selected, setSelected] = useState<number>(1); // default to the generating step
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
        // `documents.expected` was added to this endpoint alongside this wizard's
        // continuous-generation checklist (both landed together). api-server runs
        // as its own long-lived process here and isn't guaranteed to have already
        // restarted onto the code that added this field by the moment this bundle
        // is served — the wire response is a genuine external boundary, not
        // something the TS return type actually enforces at runtime. Normalize
        // once here (not scattered at each read site) so a response from an
        // older-but-still-live process degrades to "no expected documents known
        // yet" instead of throwing.
        if (data.documents && !Array.isArray(data.documents.expected)) {
          data.documents.expected = [];
        }
        // Same "older-but-still-live backend process" boundary as `expected`
        // above — `narrative` was added alongside this feature, so a response
        // from a not-yet-restarted process degrades to "nothing to show yet"
        // instead of throwing.
        if (!data.narrative || typeof data.narrative !== "object") {
          data.narrative = { status: "not_started", html: null, generatedAt: null };
        }
        // Same "older-but-still-live backend process" boundary as `expected` and
        // `narrative` above — `stats` was added alongside the richer stat-card
        // visual pass, so a response from a not-yet-restarted process degrades to
        // "no real stat data yet" (StatCards' existing `!= null` guards mean it
        // simply renders no cards) instead of throwing.
        if (!data.stats || typeof data.stats !== "object") {
          data.stats = { genuineFindings: null, licenseWasteMonthlyCents: null };
        }
        // `docGeneration` (coverage decision) was added with this feature — an
        // older-but-still-live backend won't send it. Default to null (same
        // boundary handling as `expected`/`narrative`/`stats` above) so every
        // `status.docGeneration?.…` read degrades to "no decision yet".
        if (data.docGeneration === undefined) {
          data.docGeneration = null;
        }
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

  // The first incomplete, unlocked step — the flow's "current" position. Scan
  // and document generation are one continuous "generating" step (index 1), so
  // there is no separate wait screen to auto-advance through between them —
  // only once everything (scan + every document + the SOW) is genuinely done
  // does the customer move on to review.
  const currentIndex = !reportsComplete ? 1 : 2;

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
    const es = new EventSource(
      `/api/msp/customers/${customerId}/diagnostics/runs/${scanRunId}/sse?jwt=${encodeURIComponent(accessToken)}`,
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
    const es = new EventSource(
      `/api/portal/assessment/doc-workflow/${docWorkflowRunId}/sse?jwt=${encodeURIComponent(accessToken)}`,
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
    // "generating" — one continuous step spanning scan + every document + SOW.
    if (index === 1) return reportsComplete ? "complete" : "current";
    if (index === 2) return reportsComplete ? "current" : "locked"; // review
    if (index === 3) return reportsComplete && sowReady ? "current" : "locked"; // sow
    // Payment unlocks alongside the SOW step — the customer settles their scope
    // there, then chooses a plan and signs here.
    if (index === 4) return reportsComplete && sowReady ? "current" : "locked"; // payment
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
                        ? "bg-status-green/15 text-status-green"
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
          onGoToReview={() => isUnlocked(2) && setSelected(2)}
          onGoToSow={() => isUnlocked(3) && setSelected(3)}
          onGoToPayment={() => isUnlocked(4) && setSelected(4)}
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
      ? "bg-status-green/10 text-status-green"
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

// Small primary text (10-14px) fails WCAG AA in light mode (#1a7eef on white
// ≈ 4.0:1), so everywhere the reference uses small primary-accent type we
// deepen the same hue in light mode only. Literal class names in this const
// are what Tailwind's scanner picks up — keep them verbatim.
const PRIMARY_TEXT_AA = "text-[hsl(212_87%_42%)] dark:text-primary";

// ── Generating-step header band ─────────────────────────────────────────────
// The reference composition's opening: small-caps accent eyebrow, large bold
// title, and — right-aligned on the same row — the real "prepared by"
// identity (Shane McCaw, Lead M365 Architect — the same identity the CIO
// narrative and document generation already use) with an initials avatar (no
// headshot asset exists in this app; initials circles are the shell's real
// avatar convention). Full-width low-opacity divider beneath.
function AssessmentHeaderBand({ title, dateStr }: { title: string; dateStr: string }) {
  return (
    <header>
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${PRIMARY_TEXT_AA}`}>
            Your Microsoft 365 assessment
          </p>
          <h2 className="mt-1.5 text-2xl font-bold tracking-tight text-foreground md:text-3xl">{title}</h2>
        </div>
        <div className="flex items-center gap-3 md:shrink-0">
          <div className="min-w-0 md:text-right">
            <p className="text-sm font-medium text-foreground">Shane McCaw</p>
            <p className="text-xs text-muted-foreground">Lead M365 Architect · {dateStr}</p>
          </div>
          <span
            aria-hidden
            className={`flex size-11 shrink-0 items-center justify-center rounded-full border border-border bg-primary/15 text-sm font-semibold ${PRIMARY_TEXT_AA}`}
          >
            SM
          </span>
        </div>
      </div>
      <div aria-hidden className="mt-5 h-px w-full bg-border" />
    </header>
  );
}

// ── Generation checklist item status ────────────────────────────────────────
// Real, not simulated: derived straight from the live scan/document state the
// wizard already polls + subscribes to via SSE.
type ChecklistStatus = "complete" | "active" | "failed" | "pending";

/** Resolve a real document row's live status for a given expected docType. */
function checklistDocStatus(docType: string, items: AssessmentDocument[]): ChecklistStatus {
  const row = items.find((d) => d.docType === docType);
  if (!row) return "pending";
  if (row.status === "approved" || row.status === "delivered") return "complete";
  if (row.status === "failed") return "failed";
  return "active"; // "generating" or any other in-flight status
}

// ── Path to remediation — connected phase timeline ──────────────────────────
// The generation journey as three connected phases — deep scan, report
// generation (each real expected document as a live chip), Statement of Work —
// with glow states, status badges, and a progress connector between phases.
// Purely a richer presentation of the same real statuses derived by
// checklistDocStatus; the underlying data and derivation are untouched.
function phaseStatusLabel(status: ChecklistStatus): string {
  switch (status) {
    case "complete":
      return "Complete";
    case "active":
      return "In Progress";
    case "failed":
      return "Failed";
    default:
      return "Planned";
  }
}

interface PhaseDocItem {
  key: string;
  label: string;
  status: ChecklistStatus;
}

interface PhaseItem {
  key: string;
  title: string;
  blurb: string;
  status: ChecklistStatus;
  icon: typeof Radar;
  /** Per-document live chips (report-generation phase only). */
  docs?: PhaseDocItem[];
  /** Optional live-progress slot rendered under the phase body (e.g. the doc workflow's SSE ticker). */
  live?: React.ReactNode;
}

// Status pills beside each phase title. Primary-led like the reference
// (complete and in-progress are both accent-tinted, distinguished by
// intensity + the live dot); failed is the real red token.
function PhaseBadge({ status }: { status: ChecklistStatus }) {
  const toneCls =
    status === "complete"
      ? `border-primary/20 bg-primary/10 ${PRIMARY_TEXT_AA}`
      : status === "failed"
        ? "border-status-red/40 bg-status-red/10 text-status-red"
        : status === "active"
          ? `border-primary/40 bg-primary/20 ${PRIMARY_TEXT_AA}`
          : "border-border bg-muted/40 text-muted-foreground";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest ${toneCls}`}
    >
      {status === "active" && (
        <span aria-hidden className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary opacity-75 motion-reduce:hidden" />
          <span className="relative inline-flex size-1.5 rounded-full bg-primary" />
        </span>
      )}
      {phaseStatusLabel(status)}
    </span>
  );
}

// Circular icon badges, sized and toned to the reference: complete is a
// solid-filled accent circle with a soft glow, active is an outlined pulsing
// ring, planned is muted. Backgrounds are opaque so the connector line
// passing behind never shows through.
function PhaseNode({ status, icon: Icon }: { status: ChecklistStatus; icon: typeof Radar }) {
  if (status === "complete") {
    return (
      <span className="relative z-10 flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_0_20px_hsl(var(--primary)/0.3)]">
        <CheckCircle2 className="size-5" />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="relative z-10 flex size-12 shrink-0 items-center justify-center rounded-full border border-status-red/40 bg-card text-status-red">
        <XCircle className="size-5" />
      </span>
    );
  }
  if (status === "active") {
    return (
      <span className="relative z-10 flex size-12 shrink-0 items-center justify-center rounded-full border-2 border-primary bg-card text-primary animate-pulse motion-reduce:animate-none">
        <Icon className="size-5" />
      </span>
    );
  }
  return (
    <span className="relative z-10 flex size-12 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground">
      <Icon className="size-5" />
    </span>
  );
}

// Live per-document chips inside the report-generation phase — a uniform
// bordered-card grid like the reference, with the real live status carried by
// a shape-distinct icon (+ screen-reader text).
function DocChip({ label, status }: { label: string; status: ChecklistStatus }) {
  return (
    // title makes a clipped real document name recoverable for sighted users.
    <span
      title={label}
      className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-2 transition-colors duration-500"
    >
      {status === "complete" ? (
        <CheckCircle2 className="size-3.5 shrink-0 text-primary" />
      ) : status === "failed" ? (
        <XCircle className="size-3.5 shrink-0 text-status-red" />
      ) : status === "active" ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
      ) : (
        <span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center">
          <span className="size-1 rounded-full bg-muted-foreground opacity-60" />
        </span>
      )}
      <span className={`truncate text-xs ${status === "pending" ? "text-muted-foreground" : "text-foreground"}`}>
        {label}
      </span>
      {/* The per-document status the old flat checklist showed as visible text —
          kept in the accessibility tree; sighted users read it from the icon. */}
      <span className="sr-only">{phaseStatusLabel(status)}</span>
    </span>
  );
}

function PhaseTimeline({ phases, settled }: { phases: PhaseItem[]; settled: boolean }) {
  // Connector segments between consecutive nodes, shaded so the whole run
  // reads as the reference's single line: accent at the top, fading toward
  // what's still ahead (or staying accent once everything is settled). A
  // failed endpoint overrides the positional shading — the line must never
  // show bright "progress" flowing out of or into a failed phase.
  const segmentCls = (i: number): string => {
    const from = phases[i].status;
    const to = phases[i + 1]?.status;
    if (from === "failed") return "from-status-red/40 to-border";
    if (to === "failed") return "from-primary/60 to-status-red/40";
    const t0 = i / (phases.length - 1 || 1);
    if (settled) return t0 < 0.5 ? "from-primary to-primary/60" : "from-primary/60 to-primary/40";
    return t0 < 0.5 ? "from-primary to-primary/50" : "from-primary/50 to-border";
  };
  return (
    <ol>
      {phases.map((phase, i) => (
        <li key={phase.key} className={`relative flex gap-4 ${i < phases.length - 1 ? "pb-8" : ""}`}>
          {i < phases.length - 1 && (
            <span
              aria-hidden
              className={`absolute bottom-0 left-6 top-12 w-px -translate-x-1/2 bg-gradient-to-b ${segmentCls(i)}`}
            />
          )}
          <PhaseNode status={phase.status} icon={phase.icon} />
          <div className="min-w-0 flex-1 pt-1.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p
                className={`text-sm font-bold uppercase tracking-wide ${
                  phase.status === "active"
                    ? PRIMARY_TEXT_AA
                    : phase.status === "pending"
                      ? "text-muted-foreground"
                      : phase.status === "failed"
                        ? // Dark status-red is a hair under AA at this size on
                          // the page background — lighten it there only.
                          "text-status-red dark:text-[hsl(3_75%_65%)]"
                        : "text-foreground"
                }`}
              >
                {phase.title}
              </p>
              <PhaseBadge status={phase.status} />
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{phase.blurb}</p>
            {phase.docs && phase.docs.length > 0 && (
              // 3-up only from lg: at md the docked step sidebar leaves this
              // column ~440px — three columns there would truncate every real
              // document title.
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {phase.docs.map((d) => (
                  <DocChip key={d.key} label={d.label} status={d.status} />
                ))}
              </div>
            )}
            {phase.live && <div className="mt-3">{phase.live}</div>}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ── Live-progress primitives ────────────────────────────────────────────────

/** The shared Progress bar with a shimmer sweep while work is in flight. */
function ShimmerProgress({ value }: { value: number }) {
  return (
    <div className="relative overflow-hidden rounded-full">
      <Progress value={value} className="h-1.5" />
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-1/3 animate-shimmer-sweep bg-gradient-to-r from-transparent via-primary/25 to-transparent motion-reduce:hidden dark:via-white/25"
      />
    </div>
  );
}

/** The live per-check feed from the diagnostics SSE stream, styled as a
 *  telemetry readout: mono type, entrance per row, pinned to the newest entry. */
function ScanLogFeed({ log }: { log: { checkKey: string; label: string; status: string }[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  // Keep the newest check in view as entries stream in — but only while the
  // user is already at (or near) the bottom. Never yank the scroll position
  // away from someone reading earlier entries; scrolls only this box, never
  // the page. The threshold absorbs the row(s) just appended, since this runs
  // after the DOM update.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [log.length]);

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background/50">
      <div className="border-b border-border px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-foreground/65">Live check feed</p>
      </div>
      <div ref={boxRef} className="max-h-44 space-y-1 overflow-y-auto p-3">
        {log.map((entry, i) => (
          <div
            key={`${entry.checkKey}-${i}`}
            className="flex items-center gap-2 animate-in fade-in slide-in-from-bottom-1 duration-300 motion-reduce:animate-none"
          >
            {entry.status === "ok" ? (
              <CheckCircle2 className="size-3.5 shrink-0 text-status-green" />
            ) : (
              <XCircle className="size-3.5 shrink-0 text-status-red" />
            )}
            <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{entry.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Real stat cards ──────────────────────────────────────────────────────────
// Every number here traces to a real, already-computed source (this run's own
// persisted summary counts, or a live cost-engine query against real pricing
// data) — never a placeholder. A stat with no real data behind it (null) is
// simply omitted, not shown as zero or "—".
function StatCards({ stats }: { stats: AssessmentStatus["stats"] | null | undefined }) {
  // Defense-in-depth against the same "older-but-still-live backend process" /
  // deploy-skew boundary `loadStatus` already normalizes for (see its `stats`
  // guard above) — this component must never assume its caller's normalization
  // ran, so it degrades to "no real stat data yet" instead of throwing.
  if (!stats) return null;
  const cards: { label: string; value: string; icon: typeof Radar; iconCls: string }[] = [];
  if (stats.genuineFindings != null) {
    cards.push({
      label: stats.genuineFindings === 1 ? "Finding to review" : "Findings to review",
      value: String(stats.genuineFindings),
      icon: ListChecks,
      // Zero genuine findings is good news — let the icon say so.
      iconCls:
        stats.genuineFindings > 0
          ? "bg-status-amber/15 text-status-amber"
          : "bg-status-green/15 text-status-green",
    });
  }
  if (stats.licenseWasteMonthlyCents != null) {
    cards.push({
      label: "License waste, per month",
      value: `$${Math.round(stats.licenseWasteMonthlyCents / 100).toLocaleString()}`,
      icon: Coins,
      iconCls: "bg-status-violet/15 text-status-violet",
    });
  }
  if (cards.length === 0) return null;

  // The reference pairs each stat card with a delta/trend, a mini bar chart,
  // and a per-stat "analysis" insight card. None of those have a real data
  // source on this endpoint (no historical series, no per-stat commentary) —
  // so per the no-fabrication rule they are deliberately absent: label + real
  // number + icon only.
  return (
    <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 animate-in fade-in slide-in-from-bottom-2 duration-500 delay-100 fill-mode-backwards motion-reduce:animate-none">
      {cards.map((c) => {
        const CardIcon = c.icon;
        return (
          <div key={c.label} className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/65">{c.label}</p>
                <p className="mt-1.5 min-w-0 break-words text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                  {c.value}
                </p>
              </div>
              <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${c.iconCls}`}>
                <CardIcon className="size-4" />
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Tenant health axes — real radar, real coverage only ─────────────────────
// The same "Package-Aware Pillar Rings" concept, built as a radar instead of
// individual rings: only pillars this customer's actual scanned package
// genuinely covers (traced server-side through monitoring_package_checks →
// signal_derivation_rules pillar weights — see pillar-coverage.ts) ever appear
// as an axis. A package with real coverage for only 3 of 7 pillars renders 3
// axes, never 7 with fabricated "perfect" scores on the rest. Nivo's own Radar
// renderer already refuses to render below 3 dimensions, but we hide the
// panel entirely rather than show a near-empty/broken-looking chart.
function PillarRadarPanel({
  radar,
  scoreText,
}: {
  radar: AssessmentStatus["radar"];
  /** Real score line rendered under the chart (the reference's "Current
   *  Score" treatment) — pass null when there's no real reading to show. */
  scoreText?: string | null;
}) {
  // This app's --border/--muted-foreground CSS vars hold raw HSL triples the
  // Nivo theme can't consume as colors, and light/dark want different resolved
  // values — so the chart's grid/tick/series colors are resolved here,
  // theme-aware, and passed to the shared renderer explicitly.
  const { theme } = useTheme();
  const isDark = theme === "dark";

  if (radar.pillars.length < 3) return null;

  const data: DistributionWidgetData = {
    shape: "distribution",
    label: "This tenant",
    slices: radar.pillars.map((p) => ({ name: p.label, value: p.score })),
  };

  return (
    <div className="flex h-full flex-col rounded-xl border border-border bg-background/50 p-4 animate-in fade-in zoom-in-95 duration-700 delay-200 fill-mode-backwards motion-reduce:animate-none">
      <p className="text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground/65">
        Tenant health axes
      </p>
      <div className="mt-1 flex h-56 min-h-0 flex-1">
        <RadarChart
          data={data}
          color={isDark ? "#479ef5" : "#1a7eef"}
          gridStroke={isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)"}
          tickFill={isDark ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.55)"}
        />
      </div>
      {scoreText && (
        <p className={`mt-1 text-center text-sm font-bold ${PRIMARY_TEXT_AA}`}>{scoreText}</p>
      )}
      <p className="mt-2 text-center text-[11px] leading-relaxed text-muted-foreground">
        Real coverage from this scan's package — only pillars with real signal data are plotted.
      </p>
    </div>
  );
}

// ── CIO-Report Narrative ────────────────────────────────────────────────────
// The architect-voice narrative leads the "generating" step once the scan is
// done — real findings + real peer-benchmark data, written up by
// cio-narrative-generator.ts. The checklist below it becomes supporting
// evidence, not the main event. Renders nothing until a completed scan has
// actually started producing (or finished) a narrative.
function CioNarrativePanel({ narrative }: { narrative: AssessmentStatus["narrative"] }) {
  if (narrative.status === "not_started") return null;

  return (
    <div className="min-w-0">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Quote className="size-3.5" />
        </span>
        <div className="min-w-0">
          <p className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${PRIMARY_TEXT_AA}`}>
            Architect's perspective
          </p>
          <p className="text-xs text-muted-foreground">From Shane McCaw, your M365 architect</p>
        </div>
      </div>
      {narrative.status === "ready" && narrative.html ? (
        // The generator's real output opens with an h3 headline followed by
        // h4/p/strong/ul substructure (see cio-narrative-generator.ts) — the
        // overrides below present that real structure as the reference does:
        // the opening headline as a large italic pull-quote over a divider,
        // h4 section leads as small-caps accent labels. If a particular
        // narrative lacks those elements the overrides simply don't apply.
        <div
          className="prose prose-sm max-w-none text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-p:text-muted-foreground prose-li:text-muted-foreground [&>h3:first-of-type]:text-xl [&>h3:first-of-type]:font-semibold [&>h3:first-of-type]:italic [&>h3:first-of-type]:leading-snug [&>h3:first-of-type]:tracking-tight [&>h3:first-of-type]:border-b [&>h3:first-of-type]:border-border [&>h3:first-of-type]:pb-4 [&>h3:first-of-type]:mb-4 prose-h4:text-[11px] prose-h4:font-semibold prose-h4:uppercase prose-h4:tracking-[0.14em] prose-h4:text-[hsl(212_87%_42%)] dark:prose-h4:text-primary animate-in fade-in duration-500 motion-reduce:animate-none"
          dangerouslySetInnerHTML={{ __html: narrative.html }}
        />
      ) : narrative.status === "failed" ? (
        <p className="text-sm text-muted-foreground">
          We couldn't put together your narrative summary this time — your real findings and documents are unaffected.
        </p>
      ) : (
        <div className="space-y-2.5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-primary" />
            Shane is reviewing your results and writing up what matters most…
          </div>
          <Skeleton className="h-3.5 w-full" />
          <Skeleton className="h-3.5 w-5/6" />
          <Skeleton className="h-3.5 w-4/6" />
        </div>
      )}
    </div>
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

    // One continuous screen for the entire generation phase — scan, then every
    // real document, then the SOW — with a live checklist. The customer never
    // clicks through a separate per-phase wait screen; this step only ever
    // hands off (auto-advances to "review") once genuinely everything is done.
    case "generating": {
      const anyFailed = scanFailed || reportsFailed;
      // Honest terminal state (distinct from a crash): the scan finished but too
      // few checks produced a real result (below docGeneration.minRequiredPct) to
      // responsibly generate documents. We say so plainly and stop the generation
      // UI rather than spinning forever. Never shown once real documents exist or
      // a genuine failure is already surfaced.
      const reportsBlocked =
        Boolean(status.docGeneration?.blocked) && !reportsComplete && !anyFailed;
      const generationSettled = anyFailed || reportsBlocked;

      // The same real per-item statuses the flat checklist used, grouped for
      // presentation into three connected phases: deep scan → report generation
      // (one live chip per real expected document) → Statement of Work. The
      // underlying derivation (checklistDocStatus) is untouched — only how
      // those statuses are laid out changed.
      const docItems: PhaseDocItem[] = status.documents.expected.map((d) => ({
        key: `doc:${d.docType}`,
        label: d.title,
        status: !scanComplete ? ("pending" as ChecklistStatus) : checklistDocStatus(d.docType, status.documents.items),
      }));
      const scanPhaseStatus: ChecklistStatus = scanFailed ? "failed" : scanComplete ? "complete" : "active";
      // Phase-level rollup of those same per-document statuses (presentation
      // only), ordered so a contradiction can never render: a failed document
      // always wins over "complete" (the server's allReady deliberately
      // tolerates a failed row among ready ones, so "every ready" and "one
      // failed" can be true at once), and a run whose workflow died can't sit
      // "in progress" forever.
      const workflowDead =
        status.documents.workflowStatus === "failed" || status.documents.workflowStatus === "cancelled";
      const docsPhaseStatus: ChecklistStatus = !scanComplete
        ? "pending"
        : reportsBlocked
          ? "failed"
        : docItems.some((d) => d.status === "failed")
          ? "failed"
          : docItems.length > 0
            ? docItems.every((d) => d.status === "complete")
              ? "complete"
              : workflowDead
                ? "failed"
                : "active"
            : reportsComplete
              ? "complete"
              : workflowDead
                ? "failed"
                : "active";
      // The SOW phase reads its own real row status. A missing row is "failed"
      // only when the workflow genuinely died before producing it — never just
      // because some other document failed (reportsFailed can latch on a stale
      // failed row while the run is still alive and the SOW still on its way).
      // Once every report is done and the run is alive, the missing-row window
      // reads "active": the SOW is generated last, so that window is its turn.
      const sowDocStatus: ChecklistStatus = !scanComplete
        ? "pending"
        : checklistDocStatus("consolidated_sow", status.documents.items);
      const sowPhaseStatus: ChecklistStatus =
        sowDocStatus !== "pending"
          ? sowDocStatus
          : !scanComplete
            ? "pending"
            : reportsBlocked
              ? "failed"
            : workflowDead
              ? "failed"
              : docsPhaseStatus === "complete" && !reportsComplete
                ? "active"
                : "pending";

      // Real scan-outcome facts, shared by the completed-scan phase blurb and
      // the under-radar score line. Same counts, same license-gap honesty as
      // always — license gaps are named and explicitly not failures.
      const total = status.scan.checksTotal ?? 0;
      const ok = status.scan.checksOk ?? 0;
      const licenseGap = status.scan.checksLicenseGap ?? 0;
      const genuineError = status.scan.checksError ?? 0;
      const licenseGapFeatures = status.scan.licenseGapFeatures ?? [];
      const evaluable = ok + genuineError;
      const scanResultLead = (() => {
        const parts: string[] = [];
        if (ok > 0) parts.push(`${ok} check${ok === 1 ? "" : "s"} passed`);
        if (genuineError > 0) parts.push(`${genuineError} couldn't complete`);
        return parts.length > 0 ? `${parts.join(" · ")}.` : "Scan complete.";
      })();
      const licenseGapNote =
        licenseGap > 0
          ? ` ${licenseGap} check${licenseGap === 1 ? "" : "s"} couldn't run because your tenant doesn't have ${
              licenseGapFeatures.length > 0 ? licenseGapFeatures.join(" or ") : "certain Microsoft 365 add-ons"
            } — that's a licensing gap, not a security issue.`
          : "";

      // Live scan telemetry (SSE progress bar + per-check feed) — embedded in
      // the deep-scan phase row while it runs, the same way the report phase
      // carries its chips: phase-specific content lives under its own phase.
      const scanLive =
        !anyFailed && !scanComplete ? (
          <div className="space-y-3">
            {scanProgress ? (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                    {scanProgress.label}
                  </p>
                  <p className="shrink-0 font-mono text-[11px] font-medium tabular-nums text-foreground">
                    {scanProgress.index}/{scanProgress.total}
                  </p>
                </div>
                <ShimmerProgress
                  value={scanProgress.total > 0 ? Math.round((scanProgress.index / scanProgress.total) * 100) : 0}
                />
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                {scanJustFinished
                  ? "Finalizing…"
                  : status.scan.everScanned
                    ? "Scan in progress…"
                    : "Starting your scan…"}
              </div>
            )}
            {scanLog.length > 0 && <ScanLogFeed log={scanLog} />}
          </div>
        ) : null;

      // Live doc-generation ticker (the workflow SSE stream + poll fallback,
      // exactly the same message logic as before) — attached to whichever
      // phase is actually in progress, so it can never sit under a phase
      // badged "Complete" (in every successful run's final window the ticker's
      // "Generating 1 document…" is the SOW itself).
      const liveTicker =
        scanComplete && !generationSettled && !reportsComplete ? (
          <div className="space-y-2">
            <div className="flex items-start gap-2 font-mono text-[11px] text-muted-foreground">
              <Loader2 className="mt-px size-3.5 shrink-0 animate-spin text-primary" />
              <span className="min-w-0">
                {docProgress?.message
                  ? docProgress.message
                  : status.documents.generating > 0
                    ? `Generating ${status.documents.generating} document${status.documents.generating === 1 ? "" : "s"}…`
                    : "Preparing your documents…"}
              </span>
            </div>
            {docProgress?.total != null && docProgress.total > 0 && (
              <ShimmerProgress
                value={Math.min(100, Math.round(((docProgress.step ?? 0) / docProgress.total) * 100))}
              />
            )}
          </div>
        ) : null;

      const phases: PhaseItem[] = [
        {
          key: "scan",
          title: "Deep scan of your tenant",
          // Once the scan settles, its row describes the real outcome — the
          // same counts and named license-gap honesty as always.
          blurb: scanFailed
            ? "The scan couldn't finish automatically — our team has been notified and this page keeps checking."
            : scanComplete && total > 0
              ? `${scanResultLead}${licenseGapNote}`
              : "Reading your tenant's real configuration, security posture, and licensing.",
          status: scanPhaseStatus,
          icon: Radar,
          live: scanLive,
        },
        {
          key: "docs",
          title: "Report generation",
          blurb: reportsBlocked
            ? "On hold — too few checks could be evaluated to generate an accurate report from this scan."
            : "Each report is written from your scan's real findings.",
          status: docsPhaseStatus,
          icon: FileText,
          docs: docItems,
          live: docsPhaseStatus === "active" ? liveTicker : null,
        },
        {
          key: "sow",
          title: "Statement of Work",
          blurb: "Tailored to your results — you'll fine-tune the scope before anything is signed.",
          status: sowPhaseStatus,
          icon: FileSignature,
          live: docsPhaseStatus !== "active" && sowPhaseStatus === "active" ? liveTicker : null,
        },
      ];

      // ── Unified render, structured to the reference composition ──
      // Header band → failure callout (only when real) → "The path to
      // remediation" timeline (with per-phase live content) → narrative+radar
      // split card → stat cards → closing summary + CTA. One render path for
      // in-progress, failed, and settled — every piece is state-gated.
      const headerTitle = anyFailed
        ? "We hit a snag"
        : reportsComplete
          ? "Your assessment is ready"
          : reportsBlocked
            ? "Your scan finished — report on hold"
            : "Generating your assessment";
      // Real date context for the header band: the scan's own timestamp once
      // one exists, otherwise today (this is a live screen).
      const dateStr = new Date(status.scan.lastScanAt ?? Date.now()).toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      const readyCount = status.documents.ready;
      // The reference's "Current Score" line under the radar, with real data
      // only: checks passed over checks we could actually evaluate (license
      // gaps are excluded — they're unavailable, not failures, so they never
      // drag the result down).
      const scoreText = evaluable > 0 ? `Scan result: ${ok}/${evaluable} checks passed` : null;
      const hasNarrative = status.narrative.status !== "not_started";
      const hasRadar = status.radar.pillars.length >= 3;
      const narrativeReady = status.narrative.status === "ready" && Boolean(status.narrative.html);
      // Under a failure banner only a *finished* narrative renders — a live
      // "Shane is writing…" skeleton or the narrative-failed fallback would
      // contradict the banner. Otherwise any started narrative shows its live
      // state. Deliberately NOT gated on scanComplete: the status endpoint
      // keeps serving the last completed run's narrative/radar/stats during an
      // active re-scan (its own documented contract), and blanking real data
      // mid-re-scan would contradict the settled header and CTA that remain.
      const showNarrativeCol = anyFailed ? narrativeReady : hasNarrative;

      // The reference also has a "Critical Gaps" findings grid and per-stat
      // trend/insight layers. This endpoint exposes no per-finding severity
      // list, no historical series, and no per-stat commentary — so those
      // sections are deliberately absent rather than filled with placeholders.
      return (
        <div className="space-y-8">
          <AssessmentHeaderBand title={headerTitle} dateStr={dateStr} />

          {/* Honest failure — a failed scan or doc run is never silently hung
              or treated as success; the timeline below still shows exactly
              what did and didn't finish. */}
          {anyFailed && (
            <div className="rounded-2xl border border-status-red/30 bg-status-red/5 p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-status-red" />
                <div className="min-w-0 space-y-3">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Something went wrong while {scanFailed ? "reading your Microsoft 365 environment" : "preparing your assessment documents"}, and we couldn't finish automatically. This is on us — nothing you did caused it{scanFailed ? "" : ", and your scan data is safe"}.
                  </p>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Our team has been notified automatically and will get this sorted. This page keeps
                    checking, so you can leave it open — it'll update the moment things are ready.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Honest "report on hold" — the scan finished but too little of the
              tenant could be evaluated to responsibly generate documents. Shown
              instead of an endless spinner; strictly factual, no over-claim. */}
          {reportsBlocked && (
            <div className="rounded-2xl border border-status-amber/30 bg-status-amber/5 p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-status-amber" />
                <div className="min-w-0 space-y-3">
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    Your scan finished, but only{" "}
                    <span className="font-medium text-foreground">
                      {status.docGeneration?.evaluableChecks ?? 0} of {status.docGeneration?.totalChecks ?? 0}
                    </span>{" "}
                    checks could be evaluated — below the {status.docGeneration?.minRequiredPct ?? 50}% we need to
                    generate an accurate report. We've held off rather than write one up from too little data.
                  </p>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    This usually means a permission or connectivity issue kept us from reading parts of your
                    tenant. Re-running the scan once access is in place will unlock your report — nothing you've
                    done is lost.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── The path to remediation — connected vertical timeline. Live
              scan telemetry sits inside phase 1 while it runs; the real
              document chips and generation ticker inside phases 2/3 — each
              phase carries its own live content. ── */}
          <section aria-label="The path to remediation">
            <div className="mb-6 flex items-center gap-3">
              <Route className="size-5 text-primary" />
              <h3 className="text-lg font-semibold tracking-tight text-foreground">The path to remediation</h3>
            </div>
            <PhaseTimeline phases={phases} settled={reportsComplete} />
          </section>

          {/* ── Architect's perspective + tenant health axes — one card split
              two ways on desktop (narrative left, radar inset right); radar
              first on mobile, like the reference. ── */}
          {(showNarrativeCol || hasRadar) && (
            <section className="rounded-2xl border border-border bg-card p-6 animate-in fade-in slide-in-from-bottom-2 duration-500 motion-reduce:animate-none md:p-7">
              {showNarrativeCol && hasRadar ? (
                <div className="flex flex-col gap-6 md:flex-row md:items-stretch md:gap-8">
                  <div className="order-1 w-full md:order-2 md:w-2/5 md:shrink-0">
                    <PillarRadarPanel radar={status.radar} scoreText={scoreText} />
                  </div>
                  <div className="order-2 min-w-0 flex-1 md:order-1">
                    <CioNarrativePanel narrative={status.narrative} />
                  </div>
                </div>
              ) : showNarrativeCol ? (
                <CioNarrativePanel narrative={status.narrative} />
              ) : (
                <PillarRadarPanel radar={status.radar} scoreText={scoreText} />
              )}
            </section>
          )}

          <StatCards stats={status.stats} />

          {reportsComplete && (
            <p className="text-sm leading-relaxed text-muted-foreground">
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
          )}

          {/* ── Closing CTA — the real next action, pill-shaped and prominent
              like the reference; only rendered once genuinely unlocked. ── */}
          {reportsComplete && (
            <div className="flex flex-wrap items-center gap-3">
              <Button size="lg" className="rounded-full px-7" onClick={onGoToReview}>
                Review findings <ChevronRight className="ml-1 size-4" />
              </Button>
              {sowReady && (
                <Button size="lg" variant="outline" className="rounded-full px-6" onClick={onGoToSow}>
                  View statement of work
                </Button>
              )}
            </div>
          )}

          {/* ⚠️ TEMPORARY DEBUG CODE — DELETE BEFORE PRODUCTION ⚠️ testbed-only trigger button, see file header note.
              !reportsComplete keeps it off the settled screen, matching where it rendered before the unified layout. */}
          {!reportsComplete && status.isTestbed && !status.scan.active ? (
            <Button
              variant="outline"
              onClick={() => void debugTriggerScan()}
              disabled={debugTriggering}
            >
              {debugTriggering ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
              [DEBUG] {status.scan.everScanned ? "Re-trigger scan" : "Trigger scan"}
            </Button>
          ) : null}
        </div>
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
