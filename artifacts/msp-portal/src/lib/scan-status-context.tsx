/**
 * scan-status-context.tsx
 *
 * Single shared source of truth for the shell-wide monitoring scan status,
 * polled from GET /api/portal/scan-status. Both ScanStatusIndicator (the
 * always-visible shell display) and ScanTriggerButton (the testbed-only
 * manual trigger) consume this same context so a click on the trigger
 * button visibly drives the real indicator instead of the two components
 * running independent, disconnected fetches.
 *
 * Polls every 45s while idle; switches to a fast 3s cadence while a scan is
 * active (or immediately after a trigger, before the run row has even been
 * picked up yet) so the progress bar actually looks live.
 *
 * #243 — the poll is NOT how a freshly triggered run gets streamed. The trigger
 * POST inserts the run row and returns its real runId in its own 202 body, so
 * callers hand that id straight to reportTriggerStarted() and the run's SSE
 * stream opens on the spot. Waiting for the poll to observe `active.runId`
 * instead meant a run that started AND finished inside one poll interval was
 * never once seen as active, so the stream for it never opened at all: no
 * progress-bar restart, no live check text — just one finished run's numbers
 * replaced by the next finished run's. The poll remains the fallback and the
 * steady-state source: it still discovers runs started anywhere else (another
 * tab, a scheduled run), and it is what releases a triggered run whose stream
 * delivered nothing because the run was already over before it attached.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/lib/auth-context";

export interface ScanStatusPayload {
  everScanned: boolean;
  lastScanAt: string | null;
  active: {
    runId: string;
    status: string;
    checksOk: number;
    checksError: number;
    checksLicenseGap: number;
    checksTotal: number;
    startedAt: string;
  } | null;
  /**
   * Real summary of the customer's most recent diagnostics run, whether or not
   * it is still active (`active` above is null the moment a run finishes). Any
   * surface that reports a scan's real outcome after it completed — the Copilot
   * Assessment telemetry page's Scan step — reads this. Optional at the wire
   * boundary: an older-but-still-live api-server process won't send it.
   */
  lastRunSummary?: {
    runId: string;
    status: string;
    checksTotal: number;
    checksOk: number;
    checksError: number;
    checksLicenseGap: number;
    startedAt: string;
    completedAt: string | null;
  } | null;
  /**
   * The customer's most recent "__system__: Assessment Document Generation"
   * workflow run — the id to subscribe to the existing run-scoped SSE stream
   * (GET /api/portal/assessment/doc-workflow/:runId/sse) with, plus the
   * poll-based status that authoritatively reports its terminal state.
   *   - an object: a real run exists for this customer
   *   - null: no run has ever fired for them (the two-sided doc gate is still
   *     waiting on its other condition) — a real, reportable state
   *   - absent/undefined: an older-but-still-live api-server that doesn't send
   *     the field yet, i.e. genuinely unknown
   */
  docWorkflow?: { runId: number; status: string } | null;
  isTestbed: boolean;
  /** Real tenant_consent.consent_status for this customer's tenant, or null if no row yet. */
  consentStatus: "pending" | "granted" | "declined" | "revoked" | null;
  /** True when consentStatus is "granted" but the tenant's stored scopesGranted snapshot is missing a scope in the current REQUIRED_MT_SCOPES union — new permissions were added to the app registration since this tenant last consented. */
  scopesStale: boolean;
  /**
   * Real tenant_sharepoint_consent.consent_status for this customer's tenant.
   * SharePoint Online is a separate Azure resource from Graph, so this is
   * independent of consentStatus above and a granted Graph consent implies
   * nothing about it. Three distinct meanings:
   *   - a status string: a real row exists with that state
   *   - null: NO row — the tenant has never been through the SharePoint
   *     admin-consent flow at all (a real, reportable state)
   *   - absent/undefined: the server could not read the state (e.g. the manual
   *     migration hasn't run yet) — genuinely unknown, so the UI stays silent
   */
  sharePointConsentStatus?: "pending" | "granted" | "declined" | "revoked" | null;
  /** True when sharePointConsentStatus is "granted" but the stored permissionsGranted snapshot is missing something in REQUIRED_SHAREPOINT_APP_PERMISSIONS. */
  sharePointPermissionsStale: boolean;
}

/** Live per-check label from the real diagnostics-run SSE stream. */
export interface ScanCheckProgress {
  checkKey: string;
  checkLabel: string;
  index: number;
  total: number;
}

interface ScanStatusContextValue {
  data: ScanStatusPayload | null;
  /** Set when the trigger request itself failed — distinct from a normal poll miss. */
  triggerError: string | null;
  /**
   * Called right after a trigger POST succeeds, to start fast polling immediately.
   * Pass the `runId` from the trigger response's own body: the run's SSE stream
   * is then opened straight away rather than only if/when the shared poll happens
   * to catch the run while it is still active (#243). Callers that genuinely
   * don't have an id (an older api-server that doesn't return one) may omit it
   * and fall back to poll discovery, exactly as before.
   */
  reportTriggerStarted: (runId?: string | null) => void;
  /** Called when the trigger POST itself fails (network error, non-2xx, etc). */
  reportTriggerError: (message: string) => void;
  /**
   * Live per-check name/index/total from the real diagnostics-run SSE stream
   * (the same stream AssessmentWizard/AssessmentGeneratingScreen use) — null
   * whenever no scan is active or the stream hasn't delivered its first event
   * yet. The shell falls back to the coarse checksOk/Error/Total counts from
   * `data.active` for the progress bar itself; this only drives the status text.
   */
  scanCheckProgress: ScanCheckProgress | null;
  /**
   * The runId returned by this session's most recent successful trigger POST,
   * held from the moment the POST returns until that run is observed terminal
   * (by its own SSE stream, or by the poll as the fallback). Non-null therefore
   * means "a run this session started is genuinely still in flight", which the
   * poll alone cannot say for a run that outruns it — consumers use it to report
   * the NEW run rather than the previous one's finished counts (#243).
   */
  triggeredRunId: string | null;
}

/**
 * Real terminal statuses of msp_diagnostic_runs, per diagnostics-runner.ts
 * (`status: "completed" | "failed" | "partial"`). Anything else means the run
 * is still going, so the trigger-supplied runId stays held.
 */
const TERMINAL_RUN_STATUSES = new Set(["completed", "partial", "failed"]);

const ScanStatusContext = createContext<ScanStatusContextValue | null>(null);

const IDLE_POLL_MS = 45_000;
const ACTIVE_POLL_MS = 3_000;

// Live diagnostics SSE events — same discriminated union the assessment
// wizard/generating-screen consume from this exact endpoint.
type DiagnosticsSSEEvent =
  | { type: "diagnostics_progress"; checkKey: string; checkLabel: string; status: string; index: number; total: number }
  | { type: "diagnostics_complete"; status: string; checksTotal: number; checksOk: number; checksError: number; findings: number }
  | { type: "diagnostics_error"; message: string };

export function ScanStatusProvider({ children }: { children: ReactNode }) {
  const { user, accessToken, fetchWithAuth } = useAuth();
  const customerId = user?.customerId ?? null;
  const [data, setData] = useState<ScanStatusPayload | null>(null);
  const [triggerError, setTriggerError] = useState<string | null>(null);
  const [scanCheckProgress, setScanCheckProgress] = useState<ScanCheckProgress | null>(null);
  const [triggeredRunId, setTriggeredRunId] = useState<string | null>(null);
  const fastUntilRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<(() => Promise<void>) | null>(null);
  // Mirrors triggeredRunId for load()'s benefit. load() is deliberately NOT
  // re-created when the held id changes: it is the identity the polling effect
  // keys on, so taking the id as a dependency would tear down and restart the
  // whole poll loop on every trigger.
  const triggeredRunIdRef = useRef<string | null>(null);

  /** Release a held trigger runId, but only if it is still the one held. */
  const releaseTriggeredRun = useCallback((runId: string) => {
    if (triggeredRunIdRef.current !== runId) return;
    triggeredRunIdRef.current = null;
    setTriggeredRunId(null);
  }, []);

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const res = await fetchWithAuth("/api/portal/scan-status", undefined, { silent: true });
      if (res.ok) {
        const payload = (await res.json()) as ScanStatusPayload;
        setData(payload);
        // A real active scan clears any stale trigger-error banner and keeps
        // the poll cadence fast for as long as it stays active.
        if (payload.active) {
          setTriggerError(null);
          fastUntilRef.current = Date.now() + ACTIVE_POLL_MS * 2;
        }
        // Fallback release of a trigger-supplied runId (#243). The stream is the
        // fast path, but a run that was already over before the stream attached
        // emits nothing at all — no complete event ever arrives — so the poll is
        // what tells us it is finished. Also releases when some other run has
        // since become the active one, which supersedes ours.
        const held = triggeredRunIdRef.current;
        if (held) {
          const summary = payload.lastRunSummary;
          const finished =
            summary != null && summary.runId === held && TERMINAL_RUN_STATUSES.has(summary.status);
          const superseded = payload.active != null && payload.active.runId !== held;
          if (finished || superseded) {
            triggeredRunIdRef.current = null;
            setTriggeredRunId(null);
          }
        }
      }
    } catch {
      // best-effort — keep showing the last known state rather than clearing it
    }
  }, [accessToken, fetchWithAuth]);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      if (cancelled) return;
      await load();
      if (cancelled) return;
      const fast = Date.now() < fastUntilRef.current;
      timerRef.current = setTimeout(() => void tick(), fast ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    };
    // Exposed so reportTriggerStarted can re-enter the same self-rescheduling
    // loop instead of firing a one-off load() that would leave polling dead.
    tickRef.current = tick;

    void tick();

    return () => {
      cancelled = true;
      tickRef.current = null;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [load]);

  const reportTriggerStarted = useCallback((runId?: string | null) => {
    setTriggerError(null);
    // Hold the real runId the trigger response just handed us. The SSE effect
    // below keys on this first, so the stream opens now — not in 250ms-plus-a-
    // round-trip, and not conditionally on the run still being active by then.
    if (runId) {
      triggeredRunIdRef.current = runId;
      setTriggeredRunId(runId);
      // Any per-check text still on screen belongs to the previous run.
      setScanCheckProgress(null);
    }
    // Force fast polling right away, then poll immediately rather than
    // waiting out whatever's left of the current interval. The window is wide
    // enough to cover the fallback release above, not just the (now unnecessary)
    // race to catch the run while active; it is bounded so a run that never
    // reaches a terminal status can't leave the page polling at 3s forever.
    fastUntilRef.current = Date.now() + ACTIVE_POLL_MS * 10;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void tickRef.current?.(), 250);
  }, []);

  const reportTriggerError = useCallback((message: string) => {
    setTriggerError(message);
  }, []);

  // Live per-check status text — subscribes to the exact same real
  // diagnostics-run SSE stream the assessment wizard uses.
  //
  // Which run to stream, in priority order (#243):
  //   1. the runId the trigger POST itself returned, known the instant the run
  //      row exists — the only source that cannot be outrun by a fast run;
  //   2. `data.active.runId` from the shared poll — unchanged, and still the
  //      only way to pick up a run this tab didn't start.
  const polledActiveRunId = data?.active?.runId ?? null;
  const streamRunId = triggeredRunId ?? polledActiveRunId;
  useEffect(() => {
    if (!streamRunId || customerId == null || !accessToken) {
      setScanCheckProgress(null);
      return;
    }
    const es = new EventSource(
      `/api/msp/customers/${customerId}/diagnostics/runs/${streamRunId}/sse?jwt=${encodeURIComponent(accessToken)}`,
    );
    es.onmessage = (event) => {
      const parsed = JSON.parse(event.data) as DiagnosticsSSEEvent;
      if (parsed.type === "diagnostics_progress") {
        setScanCheckProgress({
          checkKey: parsed.checkKey,
          checkLabel: parsed.checkLabel,
          index: parsed.index,
          total: parsed.total,
        });
        // Real evidence this run is alive: keep the poll on its fast cadence
        // for as long as checks keep arriving.
        fastUntilRef.current = Date.now() + ACTIVE_POLL_MS * 2;
      } else if (parsed.type === "diagnostics_complete" || parsed.type === "diagnostics_error") {
        es.close();
        setScanCheckProgress(null);
        // Refresh the poll payload BEFORE letting go of the held id, not after:
        // released first, consumers fall back to whatever the last poll said for
        // the width of one fetch — which is still the PREVIOUS run — and briefly
        // report that run's finished counts as this one's. load() itself
        // releases the id once it sees the run terminal; the finally is the
        // backstop so a failed fetch can't leave it held forever.
        void load().finally(() => releaseTriggeredRun(streamRunId));
      }
    };
    es.onerror = () => es.close();
    return () => {
      es.close();
      setScanCheckProgress(null);
    };
  }, [streamRunId, customerId, accessToken, load, releaseTriggeredRun]);

  return (
    <ScanStatusContext.Provider
      value={{
        data,
        triggerError,
        reportTriggerStarted,
        reportTriggerError,
        scanCheckProgress,
        triggeredRunId,
      }}
    >
      {children}
    </ScanStatusContext.Provider>
  );
}

export function useScanStatus(): ScanStatusContextValue {
  const ctx = useContext(ScanStatusContext);
  if (!ctx) throw new Error("useScanStatus must be used within a ScanStatusProvider");
  return ctx;
}
