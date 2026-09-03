import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import type {
  CheckStatus,
  DiagnosticsSSEEvent,
  ScanLogEntry,
  ScanPhase,
  ScanPlanResponse,
  ScanStatusResponse,
} from "./scanTypes";

const IDLE_POLL_MS = 45_000;
const ACTIVE_POLL_MS = 3_000; // design-system.md's own "every 3s while a run is live"

/** CST — README's per-check status label/ink, extended with the real statuses
 * monitor-executor.ts actually emits that the design's four-entry table didn't
 * enumerate (license_gap, partial, service_not_configured, azure_*,
 * power_platform_not_registered). Unmapped real statuses fall back to a plain
 * "Reported" label rather than a guessed one. */
export const CHECK_STATUS_LABEL: Readonly<Record<CheckStatus, string>> = {
  ok: "Passed",
  error: "Finding",
  requires_script: "Needs a script you run",
  consent_revoked: "Consent revoked — not checked",
  license_gap: "License gap",
  partial: "Partially checked",
  service_not_configured: "Service not configured",
  azure_no_rbac: "No Azure RBAC access",
  azure_no_subscriptions: "No Azure subscriptions",
  power_platform_not_registered: "Power Platform not registered",
};

export const SEVERITY_INK: Readonly<Record<string, string>> = {
  critical: "#f87171",
  warning: "#c2a63d",
  info: "#60a5fa",
};

export interface ScanState {
  readonly phase: ScanPhase;
  readonly loaded: boolean;
  readonly isTestbed: boolean;
  readonly everScanned: boolean;
  readonly runId: string | null;
  /** Real check index/total. Falls back to the scan-plan's checkKeys length
   * before the first live progress event arrives. */
  readonly index: number;
  readonly total: number;
  readonly checksOk: number;
  readonly checksError: number;
  readonly checksLicenseGap: number;
  /** Persisted findings count — only real once observed via a live
   * `diagnostics_complete` event this session (see useScanState's own doc). */
  readonly findings: number | null;
  readonly lastFinding: ScanLogEntry | null;
  readonly log: readonly ScanLogEntry[];
  readonly errorMessage: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly lastScanAt: string | null;
  readonly triggering: boolean;
  readonly triggerError: string | null;
  readonly triggerScan: () => Promise<void>;
}

const EMPTY: Omit<ScanState, "triggerScan" | "triggering" | "triggerError"> = {
  phase: "none",
  loaded: false,
  isTestbed: false,
  everScanned: false,
  runId: null,
  index: 0,
  total: 0,
  checksOk: 0,
  checksError: 0,
  checksLicenseGap: 0,
  findings: null,
  lastFinding: null,
  log: [],
  errorMessage: null,
  startedAt: null,
  completedAt: null,
  lastScanAt: null,
};

/**
 * The real, combined scan-status source for the Tenant Status card and the
 * scan log panel (Git #1824). Combines three real backends per
 * docs/scan-progress-sse-contract-pack.md §4's own rule — "the live stream
 * and the two polling endpoints work together, not as alternatives":
 *
 *   - poll /portal/scan-status (adaptive 3s/45s) supplies the runId to watch
 *     and the persisted terminal summary once the run is over
 *   - poll /portal/scan-plan (once per runId) supplies total check count
 *     before any live event arrives
 *   - the run-scoped SSE stream supplies live per-check progress while a run
 *     is active, and this session's own witnessed terminal event
 *
 * Never a wall-clock timer — every number here traces to one of the three.
 */
export function useScanState(): ScanState {
  const { user, accessToken, fetchWithAuth } = useAuth();
  const [status, setStatus] = useState<ScanStatusResponse | null>(null);
  const [plan, setPlan] = useState<ScanPlanResponse | null>(null);
  const [log, setLog] = useState<ScanLogEntry[]>([]);
  // Terminal event this session actually witnessed live for the CURRENT
  // watched runId — undefined until one arrives, cleared whenever the
  // watched runId changes. This is what tells "complete" (witnessed) apart
  // from "cache-cleared" (poll says finished, but this tab never saw it).
  const [witnessedTerminal, setWitnessedTerminal] = useState<
    { runId: string; kind: "complete"; status: "completed" | "partial"; findings: number } |
    { runId: string; kind: "error"; message: string } |
    null
  >(null);
  const [sseState, setSseState] = useState<"idle" | "open" | "disconnected">("idle");
  const [lateJoin, setLateJoin] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  const esRef = useRef<EventSource | null>(null);
  const esRunIdRef = useRef<string | null>(null);
  const receivedAnyRef = useRef(false);

  const fetchStatus = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetchWithAuth("/api/portal/scan-status", undefined, { silent: true });
      if (res.ok) setStatus((await res.json()) as ScanStatusResponse);
    } catch {
      // Leave prior status — an unreachable poll doesn't erase a known state.
    } finally {
      setLoaded(true);
    }
  }, [user, fetchWithAuth]);

  // Adaptive poll — 3s while a run is active, 45s otherwise (README's own
  // "polled every 30-60s from app-shell.tsx... every 3s while a run is live").
  useEffect(() => {
    void fetchStatus();
    const active = status?.active != null;
    const interval = setInterval(() => void fetchStatus(), active ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchStatus, status?.active != null]);

  const watchedRunId = status?.active?.runId ?? status?.lastRunSummary?.runId ?? null;

  // The plan never changes for a given run (README: "read once per run").
  useEffect(() => {
    if (!user || !watchedRunId) return;
    if (plan?.runId === watchedRunId) return;
    void (async () => {
      try {
        const res = await fetchWithAuth("/api/portal/scan-plan", undefined, { silent: true });
        if (res.ok) {
          const data = (await res.json()) as ScanPlanResponse;
          if (data.runId === watchedRunId) setPlan(data);
        }
      } catch {
        // scan-plan is a nice-to-have (total-before-first-event) — a failed
        // fetch just leaves `total` derived from live events instead.
      }
    })();
  }, [user, watchedRunId, plan?.runId, fetchWithAuth]);

  // Live SSE — only opened for a run that's actually still active. A
  // finished run's replay cache is cleared the instant it terminates (SSE
  // pack §1f), so there is nothing to gain by opening a stream for one.
  useEffect(() => {
    const runId = status?.active?.runId ?? null;
    const customerId = user?.customerId;

    if (!runId || !customerId || !accessToken) {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
        esRunIdRef.current = null;
      }
      return;
    }

    if (esRunIdRef.current === runId && esRef.current) return; // already watching this run

    esRef.current?.close();
    setLog([]);
    setWitnessedTerminal(null);
    setLateJoin(false);
    setSseState("idle");
    receivedAnyRef.current = false;
    esRunIdRef.current = runId;

    const es = new EventSource(
      `/api/msp/customers/${customerId}/diagnostics/runs/${runId}/sse?jwt=${encodeURIComponent(accessToken)}`,
    );
    esRef.current = es;

    es.onmessage = (event) => {
      let parsed: DiagnosticsSSEEvent;
      try {
        parsed = JSON.parse(event.data) as DiagnosticsSSEEvent;
      } catch {
        return;
      }
      setSseState("open");

      if (parsed.type === "diagnostics_progress") {
        if (!receivedAnyRef.current) {
          receivedAnyRef.current = true;
          // Late join (SSE pack §1e): the single most-recently cached event
          // replays on connect. If it isn't check 1, everything before it
          // was never delivered to this tab.
          if (parsed.index > 1) setLateJoin(true);
        }
        const entry: ScanLogEntry = {
          checkKey: parsed.checkKey,
          checkLabel: parsed.checkLabel,
          status: parsed.status,
          index: parsed.index,
          requiresCustomerScript: parsed.requiresCustomerScript,
          severityMatched: parsed.severityMatched,
          severityLabel: parsed.severityLabel,
        };
        setLog((prev) => {
          const next = prev.filter((e) => e.checkKey !== entry.checkKey);
          next.push(entry);
          return next;
        });
      } else if (parsed.type === "diagnostics_complete") {
        setWitnessedTerminal({ runId, kind: "complete", status: parsed.status, findings: parsed.findings });
        es.close();
      } else if (parsed.type === "diagnostics_error") {
        setWitnessedTerminal({ runId, kind: "error", message: parsed.message });
        es.close();
      }
    };

    es.onerror = () => {
      // README's own rule: a raw connection drop is rendered identically to
      // a reported failure, but ONLY if the run hadn't already reached a
      // terminal state — the phase-derivation switch below already checks
      // `witnessedTerminal` before consulting `sseState`, so setting this
      // unconditionally here is safe: a drop after a real success/failure
      // never overwrites it, it's just ignored.
      setSseState("disconnected");
    };

    return () => {
      es.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.active?.runId, user?.customerId, accessToken]);

  const triggerScan = useCallback(async () => {
    setTriggering(true);
    setTriggerError(null);
    try {
      const res = await fetchWithAuth("/api/portal/diagnostics/debug-trigger-scan", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setTriggerError(body?.error ?? "Failed to start scan");
      } else {
        await fetchStatus();
      }
    } catch {
      setTriggerError("Failed to start scan");
    } finally {
      setTriggering(false);
    }
  }, [fetchWithAuth, fetchStatus]);

  // ── Derive phase + display fields ────────────────────────────────────────
  if (!status) {
    return { ...EMPTY, loaded, triggering, triggerError, triggerScan };
  }

  const total = plan?.runId === watchedRunId && plan.checkKeys.length > 0 ? plan.checkKeys.length : (status.active?.checksTotal ?? status.lastRunSummary?.checksTotal ?? 0);
  const lastFinding = [...log].reverse().find((e) => e.severityMatched) ?? null;

  if (status.active) {
    const runId = status.active.runId;
    const index = log.length > 0 ? Math.max(...log.map((e) => e.index)) : Math.max(1, status.active.checksOk + status.active.checksError + status.active.checksLicenseGap);
    const disconnected = sseState === "disconnected" && !(witnessedTerminal?.runId === runId);
    const phase: ScanPhase = disconnected ? "disconnected" : lateJoin ? "late-join" : "running";
    return {
      phase,
      loaded,
      isTestbed: status.isTestbed,
      everScanned: status.everScanned,
      runId,
      index: Math.min(Math.max(index, 1), total || index),
      total,
      checksOk: status.active.checksOk,
      checksError: status.active.checksError,
      checksLicenseGap: status.active.checksLicenseGap,
      findings: null,
      lastFinding,
      log,
      errorMessage: null,
      startedAt: status.active.startedAt,
      completedAt: null,
      lastScanAt: status.lastScanAt,
      triggering,
      triggerError,
      triggerScan,
    };
  }

  if (status.lastRunSummary) {
    const s = status.lastRunSummary;
    const witnessed = witnessedTerminal?.runId === s.runId ? witnessedTerminal : null;

    if (s.status === "failed") {
      return {
        phase: "failed",
        loaded,
        isTestbed: status.isTestbed,
        everScanned: status.everScanned,
        runId: s.runId,
        index: total,
        total,
        checksOk: s.checksOk,
        checksError: s.checksError,
        checksLicenseGap: s.checksLicenseGap,
        findings: null,
        lastFinding: null,
        log: witnessed ? log : [],
        errorMessage: (witnessed && witnessed.kind === "error" ? witnessed.message : null) ?? s.errorMessage,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        lastScanAt: status.lastScanAt,
        triggering,
        triggerError,
        triggerScan,
      };
    }

    if (s.status === "completed" || s.status === "partial") {
      if (witnessed && witnessed.kind === "complete") {
        return {
          phase: witnessed.status === "completed" ? "complete" : "partial",
          loaded,
          isTestbed: status.isTestbed,
          everScanned: status.everScanned,
          runId: s.runId,
          index: total,
          total,
          checksOk: s.checksOk,
          checksError: s.checksError,
          checksLicenseGap: s.checksLicenseGap,
          findings: witnessed.findings,
          lastFinding: null,
          log,
          errorMessage: null,
          startedAt: s.startedAt,
          completedAt: s.completedAt,
          lastScanAt: status.lastScanAt,
          triggering,
          triggerError,
          triggerScan,
        };
      }
      // This tab never watched the run live — its SSE replay cache is
      // already gone (SSE pack §1f). Real, honest "cache-cleared": the
      // stored summary's counts, no findings tally, no per-check log.
      return {
        phase: "cache-cleared",
        loaded,
        isTestbed: status.isTestbed,
        everScanned: status.everScanned,
        runId: s.runId,
        index: total,
        total,
        checksOk: s.checksOk,
        checksError: s.checksError,
        checksLicenseGap: s.checksLicenseGap,
        findings: null,
        lastFinding: null,
        log: [],
        errorMessage: null,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        lastScanAt: status.lastScanAt,
        triggering,
        triggerError,
        triggerScan,
      };
    }
  }

  return {
    ...EMPTY,
    loaded,
    isTestbed: status.isTestbed,
    everScanned: status.everScanned,
    lastScanAt: status.lastScanAt,
    triggering,
    triggerError,
    triggerScan,
  };
}
