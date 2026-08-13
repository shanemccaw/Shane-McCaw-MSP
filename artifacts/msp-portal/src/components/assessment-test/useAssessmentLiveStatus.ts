/**
 * useAssessmentLiveStatus.ts
 *
 * Real live-data wiring for the /assessment-test page — a direct mirror of the
 * proven data model + SSE wiring in AssessmentWizard.tsx (the currently-real
 * generating step). Deliberately NOT a new mechanism: the status payload type,
 * the polling loop, the wire-boundary normalization guards, and both SSE
 * subscriptions (diagnostics run progress + doc-generation workflow run
 * progress) are copied from the wizard's already-verified implementation, so
 * both surfaces read the exact same real backend the exact same way.
 * (The wizard itself is intentionally untouched — /assessment-test is its
 * candidate replacement, so it must not depend on the code it will replace.)
 *
 * On top of the raw status this hook derives the two presentation scalars the
 * mockup page needs:
 *   - progressPercentage — one combined 0–100 value across both real phases.
 *     Split rationale: the real flow is strictly sequential (the doc workflow
 *     only starts after the scan completes), both phases genuinely take
 *     minutes (scan = N Graph checks; docs = per-document generation), and
 *     neither duration is knowable up front — so a fixed even 50/50 split is
 *     the honest choice: monotonic, simple, and matching the wizard's own
 *     two-phase presentation. Scan maps to 0–50% (live per-check SSE
 *     index/total), documents to 50–100% (poll-authoritative ready/expected,
 *     with the workflow SSE step/total taken when it's further along).
 *   - activeStageTitle — a live status string derived from the actual current
 *     phase (never hardcoded): per-check scan labels, per-document generation
 *     titles, SOW finalization, and the honest terminal states (failed /
 *     coverage-blocked / complete).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import type { CopilotReadinessLive, LicenseWasteSummary } from "./types";

// ── Status payload (mirrors GET /api/portal/assessment/status) ────────────────
// Same shape as AssessmentWizard.tsx's AssessmentStatus — kept in lockstep.

export interface AssessmentDocument {
  id: number;
  docType: string;
  category: string;
  title: string;
  status: string; // "pending" | "generating" | "approved" | "delivered" | "failed"
}

export interface AssessmentStatus {
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
    expected: { docType: string; title: string }[];
    total: number;
    generating: number;
    ready: number;
    failed: number;
    allReady: boolean;
    workflowRunId: number | null;
    workflowStatus: string | null;
  };
  docGeneration: {
    blocked: boolean;
    band: "no_data" | "insufficient" | "sufficient";
    coveragePct: number;
    evaluableChecks: number;
    totalChecks: number;
    minRequiredPct: number;
  } | null;
  mfa: { enrolled: boolean };
  narrative: {
    status: "not_started" | "generating" | "ready" | "failed";
    html: string | null;
    generatedAt: string | null;
  };
  radar: {
    packageKey: string | null;
    pillars: { pillar: string; label: string; score: number }[];
  };
  stats: {
    genuineFindings: number | null;
    licenseWasteMonthlyCents: number | null;
    /** Cost-engine breakdown behind licenseWasteMonthlyCents (additive field —
     * this page reads it; the wizard, which shares this payload, ignores it). */
    licenseWaste: LicenseWasteSummary | null;
  };
  /** Real Copilot-readiness sub-indicators + weighted overall (additive field). */
  copilotReadiness: CopilotReadinessLive | null;
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

export interface AssessmentLiveStatus {
  status: AssessmentStatus | null;
  loaded: boolean;
  /** Live per-check scan progress from the diagnostics SSE stream. */
  scanProgress: { index: number; total: number; label: string } | null;
  /** Live doc-generation progress from the workflow-run SSE stream. */
  docProgress: { message: string; step?: number; total?: number } | null;
  // Derived milestones (same derivations as the wizard).
  scanFailed: boolean;
  scanComplete: boolean;
  reportsComplete: boolean;
  reportsFailed: boolean;
  /** Combined 0–100 progress across scan (0–50) + documents (50–100). */
  progressPercentage: number;
  /** Live, phase-derived status string — never hardcoded to one phase. */
  activeStageTitle: string;
  /** ⚠️ TEMPORARY DEBUG — testbed-gated server-side; mirrors the wizard. */
  debugTriggerScan: () => Promise<void>;
  debugTriggering: boolean;
}

export function useAssessmentLiveStatus(): AssessmentLiveStatus {
  const { user, accessToken, fetchWithAuth } = useAuth();
  const customerId = user?.customerId ?? null;

  const [status, setStatus] = useState<AssessmentStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ index: number; total: number; label: string } | null>(null);
  const [scanJustFinished, setScanJustFinished] = useState(false);
  const [docProgress, setDocProgress] = useState<{ message: string; step?: number; total?: number } | null>(null);

  // ── Load status (polled) — same normalization guards as the wizard ─────────
  const loadStatus = useCallback(async () => {
    try {
      const res = await fetchWithAuth("/api/portal/assessment/status", undefined, { silent: true });
      if (res.ok) {
        const data = (await res.json()) as AssessmentStatus;
        // Wire-boundary normalization (an older-but-still-live api-server
        // process may not send newer fields) — identical guards to the wizard.
        if (data.documents && !Array.isArray(data.documents.expected)) {
          data.documents.expected = [];
        }
        if (!data.narrative || typeof data.narrative !== "object") {
          data.narrative = { status: "not_started", html: null, generatedAt: null };
        }
        if (!data.stats || typeof data.stats !== "object") {
          data.stats = { genuineFindings: null, licenseWasteMonthlyCents: null, licenseWaste: null };
        }
        if (data.stats.licenseWaste === undefined) {
          data.stats.licenseWaste = null;
        }
        if (data.copilotReadiness === undefined) {
          data.copilotReadiness = null;
        }
        if (data.docGeneration === undefined) {
          data.docGeneration = null;
        }
        if (!data.radar || typeof data.radar !== "object" || !Array.isArray(data.radar.pillars)) {
          data.radar = { packageKey: null, pillars: [] };
        }
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

  // ⚠️ TEMPORARY DEBUG CODE — mirrors the wizard's testbed-gated trigger so a
  // real run can be started from this page for end-to-end verification. The
  // endpoint itself is hard-gated server-side to the testbed tenant.
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

  // ── Derived milestones (same derivations as the wizard) ────────────────────
  const scanFailed = Boolean(
    status?.scan.everScanned && !status.scan.active && status.scan.status === "failed",
  );
  const scanComplete = Boolean(
    status?.scan.everScanned && !status.scan.active && status.scan.status !== "failed",
  );
  const reportsComplete = Boolean(status?.documents.allReady);
  const reportsFailed =
    !reportsComplete &&
    ((status?.documents.failed ?? 0) > 0 ||
      status?.documents.workflowStatus === "failed" ||
      status?.documents.workflowStatus === "cancelled");

  // ── Live scan progress via the existing diagnostics SSE endpoint ───────────
  const scanActive = status?.scan.active ?? false;
  const scanRunId = status?.scan.runId ?? null;
  useEffect(() => {
    if (!scanActive || !scanRunId || customerId == null || !accessToken) return;
    const es = new EventSource(
      `/api/msp/customers/${customerId}/diagnostics/runs/${scanRunId}/sse?jwt=${encodeURIComponent(accessToken)}`,
    );
    setScanJustFinished(false);
    es.onmessage = (event) => {
      const parsed = JSON.parse(event.data) as DiagnosticsSSEEvent;
      if (parsed.type === "diagnostics_progress") {
        setScanProgress({ index: parsed.index, total: parsed.total, label: parsed.checkLabel });
      } else if (parsed.type === "diagnostics_complete") {
        es.close();
        setScanProgress(null);
        // Bridges the gap until the poll returns authoritative post-scan state,
        // so the status text reads "wrapping up" instead of a stale scan label.
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
  // Live progress only — completion/failure are authoritatively detected by the
  // status poll (workflowStatus / allReady / failed), so a dropped stream never
  // strands the page. Subscribes only while docs are still generating.
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

  // ── Combined progress (scan 0–50%, documents 50–100%; see file header) ─────
  const scanFraction = scanComplete
    ? 1
    : scanActive && scanProgress && scanProgress.total > 0
      ? scanProgress.index / scanProgress.total
      : 0;
  const expectedCount =
    (status?.documents.expected.length ?? 0) > 0
      ? status!.documents.expected.length
      : status?.documents.total ?? 0;
  // Poll-derived fraction is authoritative; the SSE step/total is taken when
  // it's further along (it ticks between polls). max() keeps the bar monotonic
  // across the two sources.
  const pollDocFraction = expectedCount > 0 ? (status?.documents.ready ?? 0) / expectedCount : 0;
  const sseDocFraction =
    docProgress?.total && docProgress.total > 0 ? (docProgress.step ?? 0) / docProgress.total : 0;
  const docFraction = reportsComplete ? 1 : Math.max(pollDocFraction, sseDocFraction);
  const progressPercentage = reportsComplete
    ? 100
    : Math.min(99, Math.round(scanFraction * 50 + docFraction * 50));

  // ── Live status text (deliverable 2) — real phase, never hardcoded ─────────
  const activeStageTitle = (() => {
    if (!status) return "Connecting…";
    if (scanFailed) return "Scan failed — we couldn't read your tenant";
    if (status.docGeneration?.blocked)
      return "Scan coverage too low to generate documents";
    if (reportsFailed) return "Document generation failed";
    if (reportsComplete) return "Assessment complete";
    if (status.scan.active) {
      return scanProgress
        ? `Scanning your tenant — ${scanProgress.label} (${scanProgress.index}/${scanProgress.total})`
        : "Scanning your tenant…";
    }
    if (scanComplete) {
      const generatingItem = status.documents.items.find((d) => d.status === "generating");
      if (generatingItem) {
        return generatingItem.docType === "consolidated_sow" || generatingItem.docType === "sow"
          ? "Finalizing your Statement of Work…"
          : `Generating ${generatingItem.title}…`;
      }
      if (docProgress?.message) return docProgress.message;
      if (scanJustFinished) return "Scan complete — wrapping up…";
      return "Preparing your documents…";
    }
    return "Waiting for your scan to start";
  })();

  return {
    status,
    loaded,
    scanProgress,
    docProgress,
    scanFailed,
    scanComplete,
    reportsComplete,
    reportsFailed,
    progressPercentage,
    activeStageTitle,
    debugTriggerScan,
    debugTriggering,
  };
}
