/**
 * useRealDocWorkflowPhases.ts
 *
 * Real backing for the Copilot Assessment telemetry page's phase 2 (Engines)
 * and phase 3 (Documents) — #235. Replaces the scripted `setInterval` walk over
 * TELEMETRY_ENGINES / TELEMETRY_DOCS in TelemetryScreen.tsx (12 invented engines
 * with invented finding counts, 6 invented deliverables, all on a 120ms timer)
 * with the real live progress of the real workflow run for this customer.
 *
 * ZERO new backend infrastructure. Both halves already exist and already run the
 * old assessment wizard live:
 *   - GET /api/portal/scan-status → `docWorkflow: { runId, status }`, the same
 *     lookup shape /portal/assessment/status has always used for `docWfRun`,
 *     added to the cheap shell-wide endpoint the same additive way
 *     `lastRunSummary` was in #228 (the page is already inside ScanStatusProvider,
 *     so this adds no second poller).
 *   - GET /api/portal/assessment/doc-workflow/:runId/sse → the run-scoped stream
 *     AssessmentWizard.tsx and assessment-test's useAssessmentLiveStatus.ts both
 *     already subscribe to, with the ownership check the route already enforces.
 *
 * ── The REAL event shape this stream emits ───────────────────────────────────
 * Traced from the code, not assumed (sse-channels.ts + workflow-executor.ts +
 * the seeded graph in seed-system-workflows.ts):
 *
 *   broadcastWorkflowRunProgress → { type: "workflow_run_progress",
 *                                    message: string, nodeId: string,
 *                                    step?: number, total?: number }
 *     Emitted ONLY by `report_progress` nodes (workflow-executor.ts, the
 *     `case "report_progress"` block). `step`/`total` are present only when that
 *     node declares them, after {{…}} interpolation against the run payload.
 *
 *   broadcastWorkflowRunComplete → { type: "workflow_run_complete", ...extraPayload }
 *     Emitted by an `emit_event` node whose eventType matches /\.(completed|complete)$/.
 *
 *   broadcastWorkflowRunError → { type: "workflow_run_error", message: string }
 *     From an `emit_event` matching /\.(failed|error)$/, and from the executor's
 *     own node-failure / run-failure paths.
 *
 * The seeded "__system__: Assessment Document Generation — Service-Mapped,
 * Sequenced SOW" graph contains exactly FOUR `report_progress` nodes, so the
 * complete real event inventory of a run of this workflow is:
 *
 *   nodeId "progress_start" · "Preparing your assessment documents…"
 *                             step 0, total {{documentCount}} (the real count of
 *                             non-SOW associated documents on the customer's
 *                             assessment service — find_object "service")
 *   nodeId "progress_doc"   · "Generating {{doc.title}}…"
 *                             step {{itemIndex}} (0-based), total {{itemsTotal}}
 *                             — one per document, inside the foreach body
 *   nodeId "progress_sow"   · "Generating your statement of work…"   (no step/total)
 *   nodeId "progress_pres"  · "Building your presentation…"          (no step/total)
 *   then workflow_run_complete (assessment.docs.completed) or
 *        workflow_run_error   (assessment.docs.failed, or an executor failure).
 *
 * ── Honest mapping, and what is NOT there ────────────────────────────────────
 * PHASE 3 (documents) maps one-to-one onto the above and is fully real: the slot
 * count is the run's real `total`, each slot's name is the real document title
 * out of the real "Generating X…" message, and the SOW + presentation slots are
 * the run's real `gen_sow` / `build_pres` stages.
 *
 * PHASE 2 (engines) does NOT have per-engine events, and this is reported rather
 * than papered over. The seeded graph has no engine node at all (no
 * `calculate_priority` / `calculate_health` / `calculate_drift` / … — the node
 * types that hit getEngineDef in workflow-executor.ts); the engine recomputation
 * this assessment depends on happens upstream, inside the monitoring-package run
 * of the diagnostics scan (monitor-executor.ts), which fires
 * `diagnostics.run_completed` and thereby triggers this workflow. So the five
 * engines share the ONE real signal this stream actually provides — how far the
 * run itself has got — and each tile says so in its own message line instead of
 * inventing a per-engine progress bar, a severity, or a finding count. If Shane
 * wants genuinely per-engine live detail here, that needs per-engine events at
 * the source; it cannot be read out of this stream today.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useScanStatus } from "@/lib/scan-status-context";

export type DocWorkflowTileStatus = "pending" | "running" | "complete" | "error";

export interface RealEngineTile {
  /** engine-registry key (engine-registry.ts) for the engine this tile names. */
  id: string;
  name: string;
  description: string;
  icon: string;
  status: DocWorkflowTileStatus;
  /** Live line — always a statement about real run state, never a script. */
  message: string;
}

export interface RealDocTile {
  id: string;
  name: string;
  description: string;
  status: DocWorkflowTileStatus;
  /** Live line for this slot, derived from the real stream only. */
  message: string;
  /** 100 when the run really finished this slot; null when no real fraction exists. */
  progress: number | null;
}

export interface RealDocWorkflowPhases {
  /** wf_runs.id of the customer's real doc-generation run, or null if none exists. */
  runId: number | null;
  /** True once the first /portal/scan-status payload has been read. */
  loaded: boolean;
  /** The five engine tiles (see the honesty note in the file header). */
  engines: RealEngineTile[];
  /** Document / SOW / presentation slots, real count and real names. */
  docs: RealDocTile[];
  /** True once the run has emitted its first progress event (docs are underway). */
  docGenStarted: boolean;
  /** True when the run really reached its success terminal. */
  docGenComplete: boolean;
  /** Non-null when the run really failed — carries the real reason. */
  docGenError: string | null;
  /**
   * True when the run's row says "completed" but this page never saw a single
   * document-progress event from it. Two real causes, indistinguishable from
   * this stream alone: the two-sided doc gate found its other condition still
   * unmet (the run took the `end_skip` branch and generated nothing), or the run
   * finished and its replay cache was lost before this page connected. Either
   * way, "completed" here is NOT proof documents were generated, so the page
   * reports the ambiguity instead of showing a finished document set.
   */
  finishedWithoutProgress: boolean;
  /** One real status line for the page's stream row. */
  streamMessage: string;
}

/** Live doc-workflow run SSE events — the exact union broadcast by sse-channels.ts. */
type DocWorkflowSSEEvent =
  | { type: "workflow_run_progress"; message: string; step?: number; total?: number; nodeId?: string }
  | { type: "workflow_run_complete"; presentationId?: number | string }
  | { type: "workflow_run_error"; message: string };

/** The four real report_progress node ids in the seeded graph. */
type ProgressNodeId = "progress_start" | "progress_doc" | "progress_sow" | "progress_pres";

interface ProgressState {
  nodeId: ProgressNodeId | null;
  message: string;
  step: number | null;
  total: number | null;
}

/**
 * The five engines this page names. Ids are real engine-registry keys; the
 * descriptions state what the engine is, and deliberately make no claim about
 * this tenant (no severity, no finding count — the run reports neither).
 */
const ENGINE_TILES: { id: string; name: string; description: string; icon: string }[] = [
  {
    id: "priority",
    name: "Priority Engine",
    description: "Ranks the tenant's findings into a remediation order.",
    icon: "Zap",
  },
  {
    id: "health",
    name: "Architecture Health Engine",
    description: "Scores the tenant's Microsoft 365 architecture health.",
    icon: "Server",
  },
  {
    id: "security",
    name: "Security Engine",
    description: "Scores the tenant's security posture from collected checks.",
    icon: "Shield",
  },
  {
    id: "drift",
    name: "Drift Engine",
    description: "Compares this scan against the tenant's previous state.",
    icon: "Sliders",
  },
  {
    id: "forecasting",
    name: "Forecasting Engine",
    description: "Projects the tenant's trajectory from its scan history.",
    icon: "Activity",
  },
];

/**
 * wf_runs.status values that mean the run really failed. Deliberately NOT
 * including "completed": this workflow's not-eligible-yet branch (`end_skip`)
 * also finishes as "completed" without generating anything, so a completed
 * status is not on its own proof of a generated document set — see
 * `finishedWithoutProgress`.
 */
const FAILED_RUN_STATUSES = ["failed", "cancelled"];

/**
 * Real document title out of a real "Generating {{doc.title}}…" message.
 * Returns null when the message isn't that shape, or when interpolation left the
 * raw {{…}} token behind — a placeholder is not a title, and inventing one here
 * is exactly the fabrication this rewrite exists to remove.
 */
function parseDocTitle(message: string): string | null {
  const m = /^Generating\s+(.+?)\s*(?:…|\.\.\.)?$/.exec(message.trim());
  const title = m?.[1]?.trim();
  if (!title || title.includes("{{")) return null;
  return title;
}

export function useRealDocWorkflowPhases(): RealDocWorkflowPhases {
  const { accessToken } = useAuth();
  const { data } = useScanStatus();

  const runId = data?.docWorkflow?.runId ?? null;
  const pollStatus = data?.docWorkflow?.status ?? null;

  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [streamComplete, setStreamComplete] = useState(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  /** itemIndex → the real document title the run reported for it. */
  const [docTitles, setDocTitles] = useState<Record<number, string>>({});
  /** Real document count, from progress_start.total / progress_doc.total. */
  const [docTotal, setDocTotal] = useState<number | null>(null);

  // A new run wipes the previous run's derived state so nothing bleeds across
  // (a re-scan fires a second doc-generation run with its own id).
  const seenRunIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (seenRunIdRef.current === runId) return;
    seenRunIdRef.current = runId;
    setProgress(null);
    setStreamComplete(false);
    setStreamError(null);
    setDocTitles({});
    setDocTotal(null);
  }, [runId]);

  // ── The existing run-scoped SSE stream ─────────────────────────────────────
  // Same subscription the wizard makes, same query-JWT auth the route requires
  // (EventSource cannot set headers). Live progress only: the run's terminal
  // state is also carried by the poll (`docWorkflow.status`), so a dropped
  // stream can never strand this page. The hub replays its last cached event on
  // connect, so a late subscriber still gets the run's current position — which
  // is why every derivation below is monotonic and index-addressed rather than
  // accumulated from a complete event history. A run the poll already calls
  // "completed" is still subscribed to for exactly that reason: the replayed
  // terminal event is what proves documents were actually generated.
  const runOver = streamComplete || streamError != null || (pollStatus != null && FAILED_RUN_STATUSES.includes(pollStatus));

  useEffect(() => {
    if (runId == null || !accessToken || runOver) return;
    const es = new EventSource(
      `/api/portal/assessment/doc-workflow/${runId}/sse?jwt=${encodeURIComponent(accessToken)}`,
    );
    es.onmessage = (event) => {
      let parsed: DocWorkflowSSEEvent;
      try {
        parsed = JSON.parse(event.data) as DocWorkflowSSEEvent;
      } catch {
        return;
      }
      if (parsed.type === "workflow_run_progress") {
        const nodeId = (parsed.nodeId ?? null) as ProgressNodeId | null;
        const step = typeof parsed.step === "number" ? parsed.step : null;
        const total = typeof parsed.total === "number" ? parsed.total : null;
        setProgress({ nodeId, message: parsed.message, step, total });
        if (total != null && total > 0) setDocTotal(total);
        if (nodeId === "progress_doc" && step != null) {
          const title = parseDocTitle(parsed.message);
          if (title) setDocTitles((prev) => (prev[step] === title ? prev : { ...prev, [step]: title }));
        }
      } else if (parsed.type === "workflow_run_complete") {
        es.close();
        setStreamComplete(true);
      } else if (parsed.type === "workflow_run_error") {
        es.close();
        setStreamError(parsed.message || "Document generation failed.");
      }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [runId, accessToken, runOver]);

  return useMemo(() => {
    const pollFailed = pollStatus != null && FAILED_RUN_STATUSES.includes(pollStatus);
    const pollComplete = pollStatus === "completed";
    const failed = streamError != null || pollFailed;
    const errorMessage = streamError ?? (pollFailed ? `The document run ended with status "${pollStatus}".` : null);
    // A progress event is the only real proof the two-sided gate passed and the
    // service's document set was resolved — the not-eligible-yet branch reaches
    // its `end_skip` terminal without emitting one, and still records the run as
    // "completed". So a completed status alone never counts as generated here.
    const sawProgress = progress != null;
    const complete = !failed && (streamComplete || (pollComplete && sawProgress));
    const finishedWithoutProgress = !failed && pollComplete && !streamComplete && !sawProgress;
    const started = !failed && (sawProgress || streamComplete);

    // ── Phase 2 — engines ────────────────────────────────────────────────────
    // One shared real signal for all five (see the file header): the stream has
    // no per-engine event, so each tile states the real thing it is derived from
    // rather than pretending to a progress of its own.
    let engineStatus: DocWorkflowTileStatus;
    let engineMessage: string;
    if (failed) {
      engineStatus = "error";
      engineMessage = errorMessage ?? "The assessment run failed.";
    } else if (started) {
      engineStatus = "complete";
      engineMessage =
        "Complete — the run reached document generation, which is downstream of every engine. " +
        "This run emits no per-engine event, so no per-engine detail is claimed.";
    } else if (finishedWithoutProgress) {
      // Not "complete": the run finished without ever reporting document work,
      // so there is nothing here to call done.
      engineStatus = "pending";
      engineMessage =
        `Assessment run #${runId} finished without reporting any document progress — ` +
        "either it was not eligible to generate yet, or it ended before this page connected.";
    } else if (runId != null) {
      engineStatus = "running";
      engineMessage = `Assessment run #${runId} is in flight — no progress event has arrived from it yet.`;
    } else {
      engineStatus = "pending";
      engineMessage =
        data == null
          ? "Reading your assessment run state…"
          : "No assessment document run exists for your account yet.";
    }
    const engines: RealEngineTile[] = ENGINE_TILES.map((e) => ({
      ...e,
      status: engineStatus,
      message: engineMessage,
    }));

    // ── Phase 3 — documents ──────────────────────────────────────────────────
    // Real slots: `docTotal` documents from the run's own count, then the run's
    // real SOW stage (gen_sow) and presentation stage (build_pres). Until the
    // run reports its count there are no document slots to show — an invented
    // placeholder list would be exactly the old fake catalog again.
    const node = progress?.nodeId ?? null;
    const stepIndex = progress?.step ?? null;

    // How far the run has really got, as a slot index into [docs…, sow, pres].
    const docCount = docTotal ?? 0;
    let activeIndex: number | null = null;
    if (node === "progress_doc" && stepIndex != null) activeIndex = stepIndex;
    else if (node === "progress_sow") activeIndex = docCount;
    else if (node === "progress_pres") activeIndex = docCount + 1;
    // progress_start means the run is prepared but no slot has begun yet.

    const slotStatus = (idx: number): DocWorkflowTileStatus => {
      if (complete) return "complete";
      if (activeIndex == null) return "pending";
      if (idx < activeIndex) return "complete";
      if (idx > activeIndex) return "pending";
      return failed ? "error" : "running";
    };

    const docs: RealDocTile[] = [];
    for (let i = 0; i < docCount; i++) {
      const status = slotStatus(i);
      const title = docTitles[i] ?? null;
      docs.push({
        id: `doc-${i}`,
        // Honest placeholder: the run only names a document when it starts
        // generating it, so earlier/later slots are identified by position.
        name: title ?? `Document ${i + 1} of ${docCount}`,
        description: title
          ? "Generated from this tenant's real scan results."
          : "This slot's title arrives with the run's own progress event.",
        status,
        message:
          status === "running"
            ? progress?.message ?? "Generating…"
            : status === "complete"
              ? title
                ? `${title} generated.`
                : "Generated."
              : status === "error"
                ? errorMessage ?? "Generation failed."
                : "Waiting for the run to reach this document.",
        progress: status === "complete" ? 100 : null,
      });
    }

    // The SOW + presentation stages are real named nodes of every eligible run,
    // so they are listed as soon as the run has really reported any document
    // work at all — including a run that then failed part-way through.
    if (docCount > 0 || sawProgress || streamComplete) {
      const sowStatus = slotStatus(docCount);
      docs.push({
        id: "doc-sow",
        name: "Statement of Work",
        description: "Consolidated SOW, generated last so it grounds against the other documents.",
        status: sowStatus,
        message:
          sowStatus === "running"
            ? progress?.message ?? "Generating your statement of work…"
            : sowStatus === "complete"
              ? "Statement of work generated."
              : sowStatus === "error"
                ? errorMessage ?? "Statement of work generation failed."
                : "Waiting for the other documents to finish first.",
        progress: sowStatus === "complete" ? 100 : null,
      });

      const presStatus = slotStatus(docCount + 1);
      docs.push({
        id: "doc-presentation",
        name: "Assessment Presentation",
        description: "Your customer-visible deliverable set, assembled from the generated documents.",
        status: presStatus,
        message:
          presStatus === "running"
            ? progress?.message ?? "Building your presentation…"
            : presStatus === "complete"
              ? "Presentation ready."
              : presStatus === "error"
                ? errorMessage ?? "Presentation build failed."
                : "Waiting for the statement of work.",
        progress: presStatus === "complete" ? 100 : null,
      });
    }

    // ── Stream row ───────────────────────────────────────────────────────────
    const streamMessage = failed
      ? errorMessage ?? "The assessment run failed."
      : complete
        ? "Assessment documents generated."
        : progress?.message
          ? progress.message
          : finishedWithoutProgress
            ? `Assessment run #${runId} finished without reporting any document progress to this page.`
            : runId != null
              ? `Assessment run #${runId} in flight — waiting for its first progress event…`
              : data == null
                ? "Reading your assessment run state…"
                : "No assessment document run has started for your account yet.";

    return {
      runId,
      loaded: data != null,
      engines,
      docs,
      docGenStarted: started,
      docGenComplete: complete,
      docGenError: failed ? errorMessage : null,
      finishedWithoutProgress,
      streamMessage,
    };
  }, [data, runId, pollStatus, progress, streamComplete, streamError, docTitles, docTotal]);
}
