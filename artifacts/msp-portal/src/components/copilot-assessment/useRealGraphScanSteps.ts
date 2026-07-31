/**
 * useRealGraphScanSteps.ts
 *
 * Real backing for the Copilot Assessment telemetry page's Scan step (#228).
 *
 * The four tiles the page shows (connecting / validating permissions /
 * retrieving tenant profile / pulling telemetry stream) used to be a scripted
 * timer over hardcoded strings in telemetryCatalog.ts — a fake tenant GUID,
 * invented seat counts, a canned "permissions verified" sequence — with no
 * Microsoft 365 call behind any of it. This hook keeps that four-tile visual
 * structure and drives every status and every message line from the REAL
 * diagnostics run for the signed-in customer's own tenant.
 *
 * No new data path is introduced. Everything below comes from infrastructure
 * that already exists and is already live:
 *   - ScanStatusProvider (scan-status-context.tsx) — polls the real
 *     GET /api/portal/scan-status and, while a run is active, subscribes to the
 *     real diagnostics-run SSE stream for per-check progress. It wraps the whole
 *     router, so this page is already inside it and adds no second poller.
 *   - POST /api/portal/assessment/debug-trigger-scan — the ONE existing
 *     testbed-gated manual trigger (see the ⚠️ block on triggerScan below).
 *
 * Milestone mapping — why these four, and what each one really observes.
 * A run's externally observable milestones are: accepted (row written,
 * status "pending"), started (status "running" after the runner resolved this
 * customer's tenant), first real check result (proves the app-only Graph token
 * was accepted and authorized), per-check streaming, and terminal
 * completed/partial/failed. Each tile is pinned to one of those, plus the
 * tenant's real Graph consent record for the permissions tile:
 *
 *   1. Connecting        → a real msp_diagnostic_runs row exists and the runner
 *                          moved it pending → running.
 *   2. Validating Perms  → the tenant's real Graph consent status + whether its
 *                          granted-scope snapshot still covers REQUIRED_MT_SCOPES
 *                          (server-computed `scopesStale`). This is real tenant
 *                          state rather than a run event, so it can legitimately
 *                          resolve before a run starts — that is the truth, and
 *                          it is reported as such instead of being paced to look
 *                          sequential.
 *   3. Tenant Profile    → the run's real check inventory for this tenant's
 *                          monitoring package (SSE `total`, or the finished run's
 *                          checksTotal). A completed run with zero checks is
 *                          reported as a problem, not as a green tick.
 *   4. Telemetry Stream  → live per-check label + index/total off the run's SSE
 *                          stream, then the run's real terminal counts.
 *
 * Honesty rule: a tile with no real signal behind it stays `pending`. Nothing
 * here invents a message, a count, or a completion.
 */

import { useCallback, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useScanStatus } from "@/lib/scan-status-context";
import { GRAPH_API_STEPS } from "./telemetryCatalog";

export type GraphScanStepStatus = "pending" | "running" | "complete" | "error";

export interface GraphScanStepState {
  id: string;
  title: string;
  subtitle: string;
  status: GraphScanStepStatus;
  /** Live line for this tile, derived from real run/consent state only. */
  message: string;
  /** 0–100. A real fraction only where one exists (check index/total). */
  progress: number;
}

export interface RealGraphScanState {
  /** The four tiles, in display order, with their real status + message. */
  steps: GraphScanStepState[];
  /** True once the real run reached a terminal state with real check results. */
  scanComplete: boolean;
  /** True when a real step is in a genuinely bad state and no data arrived. */
  scanFailed: boolean;
  /** True while a real run is in flight for this tenant. */
  scanActive: boolean;
  /** Single real status line for the page's stream row. */
  streamMessage: string;
  /** 0–100 across the four real steps. */
  scanProgressPct: number;
  /** True once the first real payload has been read (page can stop saying "loading"). */
  loaded: boolean;
  /** ⚠️ TEMPORARY DEBUG — server-side testbed gate; see triggerScan. */
  isTestbed: boolean;
  triggerScan: () => Promise<void>;
  triggering: boolean;
  triggerError: string | null;
}

/** Local time of a real timestamp, or null when the timestamp isn't there. */
function atTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d.toLocaleTimeString();
}

/** Short, readable handle for a real run id (full GUID is noise in a tile). */
function shortRunId(runId: string | null | undefined): string {
  return runId ? runId.slice(0, 8) : "";
}

export function useRealGraphScanSteps(): RealGraphScanState {
  const { fetchWithAuth } = useAuth();
  const { data, scanCheckProgress, triggerError, triggeredRunId, reportTriggerStarted, reportTriggerError } =
    useScanStatus();
  const [triggering, setTriggering] = useState(false);

  // ⚠️ TEMPORARY DEBUG CODE — DELETE BEFORE PRODUCTION ⚠️
  // Dev-only manual scan trigger for this page, hitting the platform's ONE
  // existing debug trigger route (POST /portal/assessment/debug-trigger-scan in
  // portal-assessment.ts). Real customers never get a self-serve scan trigger
  // (prevents AI-credit spam); that route is hard-gated server-side to
  // isTestbed=true customers — the `isTestbed` flag returned below only hides
  // the button, it is NOT the gate. Deliberately not a second trigger path:
  // same endpoint, same guard, same removal. Remove this alongside the route and
  // the button in TelemetryScreen.tsx before production.
  // See backlog: [Shane to add ticket].
  const triggerScan = useCallback(async () => {
    setTriggering(true);
    try {
      const res = await fetchWithAuth("/api/portal/assessment/debug-trigger-scan", {
        method: "POST",
      });
      if (res.ok) {
        // The 202 body carries the real runId of the row the route just
        // inserted (see debug-trigger-scan in portal-assessment.ts). Handing it
        // straight to the context opens that run's SSE stream immediately,
        // instead of hoping the shared poll catches the run while it is still
        // active — which a fast-finishing run simply never is (#243).
        let startedRunId: string | null = null;
        try {
          const body = (await res.json()) as { runId?: unknown };
          if (typeof body?.runId === "string" && body.runId) startedRunId = body.runId;
        } catch {
          // No/unreadable body (e.g. an older api-server process): fall back to
          // poll discovery, which is exactly the previous behaviour.
        }
        reportTriggerStarted(startedRunId);
      } else {
        let message = `Trigger request failed (${res.status})`;
        try {
          const body = (await res.json()) as { error?: string };
          if (body?.error) message = body.error;
        } catch {
          // non-JSON error body — keep the status-code message
        }
        reportTriggerError(message);
      }
    } catch (err) {
      reportTriggerError(err instanceof Error ? err.message : "Network error triggering scan");
    } finally {
      setTriggering(false);
    }
  }, [fetchWithAuth, reportTriggerStarted, reportTriggerError]);

  const state = useMemo(() => {
    // The latest run the POLL knows about, active or finished. lastRunSummary is
    // the authoritative source (it survives completion); `active` is the
    // wire-safety fallback for an older api-server process that doesn't send the
    // newer field yet.
    const polled =
      data?.lastRunSummary ??
      (data?.active
        ? { ...data.active, completedAt: null as string | null }
        : null);

    // #243 — a run triggered in this session that the poll hasn't caught up to
    // yet. The previous run's finished counts are NOT this run's, and reporting
    // them anyway is what pinned every tile at complete and the bar at 100%
    // through the whole of a re-triggered scan: the page went from one run's
    // completion straight to the next's, never passing through running.
    // Until the poll catches up, the only real facts about this run are its id,
    // that the server accepted it, and whatever its SSE stream has delivered.
    const triggeredRunPending = triggeredRunId != null && polled?.runId !== triggeredRunId;
    const latest = triggeredRunPending
      ? {
          runId: triggeredRunId,
          // Live check text is proof the runner really started it; before that
          // all we truly know is that the row was accepted.
          status: scanCheckProgress ? "running" : "pending",
          checksTotal: 0,
          checksOk: 0,
          checksError: 0,
          checksLicenseGap: 0,
          startedAt: null as string | null,
          completedAt: null as string | null,
        }
      : triggering
        // Trigger POST still in flight: no run id yet, and the previous run's
        // numbers are equally not ours to show.
        ? null
        : polled;
    const runActive = triggeredRunPending || data?.active != null;
    const runStatus = latest?.status ?? null;
    const runFailed = runStatus === "failed";
    const runFinished = runStatus === "completed" || runStatus === "partial";

    // Real check inventory: live from the run's SSE stream while it runs, from
    // the run row once it finished. 0 means "not known yet", never "none".
    const knownTotal = scanCheckProgress?.total ?? latest?.checksTotal ?? 0;

    // ── 1. Connecting ────────────────────────────────────────────────────────
    let s1: GraphScanStepStatus = "pending";
    let m1 = "No diagnostics run has been started for your tenant yet.";
    if (triggerError) {
      s1 = "error";
      m1 = triggerError;
    } else if (triggering) {
      s1 = "running";
      m1 = "Requesting a real diagnostics run for your tenant…";
    } else if (!latest) {
      s1 = "pending";
    } else if (runStatus === "pending") {
      s1 = "running";
      m1 = `Run ${shortRunId(latest.runId)} accepted — queued on the server.`;
    } else {
      s1 = "complete";
      const started = atTime(latest.startedAt);
      m1 = started
        ? `Run ${shortRunId(latest.runId)} started at ${started}.`
        : `Run ${shortRunId(latest.runId)} started.`;
    }

    // ── 2. Validating permissions ────────────────────────────────────────────
    // Real tenant consent state, not a run event (see the mapping note above).
    let s2: GraphScanStepStatus = "pending";
    let m2 = "Reading this tenant's Microsoft Graph consent state…";
    if (data) {
      const consent = data.consentStatus;
      if (consent === "granted" && !data.scopesStale) {
        s2 = "complete";
        m2 = "Microsoft Graph consent granted — every permission this scan needs is approved.";
      } else if (consent === "granted" && data.scopesStale) {
        s2 = "error";
        m2 =
          "Consent granted, but this tenant hasn't approved every permission the app now requires — reconsent needed.";
      } else if (consent === "pending") {
        s2 = "running";
        m2 = "Admin consent for this tenant is still pending.";
      } else if (consent === "declined" || consent === "revoked") {
        s2 = "error";
        m2 = `Microsoft Graph consent is ${consent} for this tenant — no tenant data can be read.`;
      } else {
        s2 = "error";
        m2 = "This tenant has no Microsoft Graph consent on record — nothing can be read from Microsoft 365.";
      }
    }

    // ── 3. Retrieving tenant profile ─────────────────────────────────────────
    // "Profile" here is the real thing the runner resolves before any Graph
    // call: this tenant and the monitoring package + checks mapped to it.
    let s3: GraphScanStepStatus = "pending";
    let m3 = "Waiting for a run to resolve your tenant and its monitoring package.";
    if (knownTotal > 0) {
      s3 = "complete";
      m3 = `Monitoring package resolved — ${knownTotal} checks mapped to your tenant.`;
    } else if (runActive) {
      s3 = "running";
      m3 = "Resolving your tenant and loading its monitoring package…";
    } else if (runFailed) {
      s3 = "error";
      m3 = "The run failed before any check ran — your tenant or its monitoring package couldn't be resolved.";
    } else if (runFinished) {
      // A finished run with no checks is a real, reportable condition (an empty
      // package mapping), not something to paper over with a green tick.
      s3 = "error";
      m3 = "The run finished but no checks are mapped to your monitoring package — nothing was collected.";
    }

    // ── 4. Pulling telemetry stream ──────────────────────────────────────────
    let s4: GraphScanStepStatus = "pending";
    let m4 = "Waiting for the scan to start.";
    let p4 = 0;
    if (scanCheckProgress && scanCheckProgress.total > 0) {
      s4 = "running";
      p4 = Math.min(100, Math.round((scanCheckProgress.index / scanCheckProgress.total) * 100));
      m4 = `${scanCheckProgress.checkLabel} (${scanCheckProgress.index}/${scanCheckProgress.total})`;
    } else if (runActive) {
      s4 = "running";
      m4 = "Run in flight — waiting for the first check result from Microsoft Graph…";
    } else if (runFailed) {
      s4 = "error";
      m4 = `Run ${shortRunId(latest?.runId)} ended with status failed.`;
    } else if (runFinished && latest && knownTotal > 0) {
      s4 = "complete";
      p4 = 100;
      const finishedAt = atTime(latest.completedAt);
      const gap = latest.checksLicenseGap > 0 ? ` · ${latest.checksLicenseGap} not licensed` : "";
      m4 =
        `${latest.checksOk} of ${latest.checksTotal} checks returned data · ` +
        `${latest.checksError} errored${gap}` +
        (finishedAt ? ` · finished ${finishedAt}` : "");
    }

    const statuses: GraphScanStepStatus[] = [s1, s2, s3, s4];
    const messages = [m1, m2, m3, m4];
    const progresses = [
      s1 === "complete" ? 100 : 0,
      s2 === "complete" ? 100 : 0,
      s3 === "complete" ? 100 : 0,
      p4,
    ];

    const steps: GraphScanStepState[] = GRAPH_API_STEPS.map((def, i) => ({
      id: def.id,
      title: def.title,
      subtitle: def.subtitle,
      status: statuses[i],
      message: messages[i],
      progress: progresses[i],
    }));

    // The Scan step is done when the real run reached a terminal state with real
    // results — never because the tiles "look" finished.
    const scanComplete = s4 === "complete";
    const scanFailed = !scanComplete && statuses.some((s) => s === "error");

    const completedSteps = statuses.filter((s) => s === "complete").length;
    const runningContribution = statuses.reduce(
      (acc, s, i) => (s === "running" ? acc + (progresses[i] / 100) * 25 : acc),
      0,
    );
    const scanProgressPct = scanComplete
      ? 100
      : Math.min(100, Math.round(completedSteps * 25 + runningContribution));

    // The stream row shows the step that is actually happening: the first
    // errored step if something is wrong, otherwise the running one, otherwise
    // the last thing that really happened.
    const errored = steps.find((s) => s.status === "error");
    const running = steps.find((s) => s.status === "running");
    const streamMessage = errored?.message ?? running?.message ?? steps[3].message;

    return {
      steps,
      scanComplete,
      scanFailed,
      scanActive: runActive,
      streamMessage,
      scanProgressPct,
      loaded: data != null,
      isTestbed: data?.isTestbed === true,
    };
  }, [data, scanCheckProgress, triggerError, triggering, triggeredRunId]);

  return { ...state, triggerScan, triggering, triggerError };
}
