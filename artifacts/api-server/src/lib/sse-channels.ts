import type { Response } from "express";
import {
  registerHubClient,
  broadcastToHub,
  broadcastToHubWithReplay,
  clearHubReplayState,
  replayHubState,
  getHubClientCount,
} from "./sse-hub.ts";

// ── Typed channel adapter ─────────────────────────────────────────────────────
// One named, signature-identical replacement for every function currently
// exported from sse-broadcast.ts, backed by the generic SSE hub. Phase 2b-2 is a
// pure import-swap: consumers keep calling these exact names with the exact same
// arguments and receive byte-identical JSON payloads; only the import path moves
// from ./sse-broadcast.ts to ./sse-channels.ts.
//
// Payload envelopes ({ type: "...", ... }) are reproduced verbatim from the
// original file — the frontend EventSource consumers parse these shapes.
//
// Channel/scope taxonomy is documented per group below.

// ── Per-user notification SSE ── channel "notification", scope = userId ─────────
// Positive userId for admin/client users; -(mspUserId) for MSP users (negative
// convention avoids collision since both serials start at 1).

export function registerNotificationSSEClient(key: number, res: Response, onClose: () => void): void {
  registerHubClient("notification", key, res, onClose);
}

export function broadcastNotification(key: number, notification: Record<string, unknown>): void {
  broadcastToHub("notification", key, { type: "notification", notification });
}

export function broadcastUnreadCount(key: number, unreadCount: number): void {
  broadcastToHub("notification", key, { type: "unread_count", unreadCount });
}

// ── Kanban project SSE ── channel "workflow.run", scope = projectId ─────────────

export function registerSSEClient(projectId: number, res: Response, onClose: () => void): void {
  registerHubClient("workflow.run", projectId, res, onClose);
}

export function broadcastKanbanChange(projectId: number, payload: { action: string; task: unknown }): void {
  broadcastToHub("workflow.run", projectId, payload);
}

export function broadcastProjectEvent(projectId: number, event: Record<string, unknown>): void {
  broadcastToHub("workflow.run", projectId, event);
}

// ── Presentation scope SSE ── channel "workflow.doc-pipeline", scope = presentationId ──
// Register does NOT replay: it is shared with the phase-gen replay cache below,
// but scope/docs/project-ready events are non-replaying (matches old behavior
// where only phase_gen state was cached in lastPhaseGenState).

export function registerPresentationSSEClient(presentationId: number, res: Response, onClose: () => void): void {
  registerHubClient("workflow.doc-pipeline", presentationId, res, onClose);
}

export function broadcastPresentationScopeChange(presentationId: number, sowVersion: string): void {
  broadcastToHub("workflow.doc-pipeline", presentationId, { type: "scope_changed", sowVersion });
}

export function broadcastPresentationDocsChange(presentationId: number): void {
  broadcastToHub("workflow.doc-pipeline", presentationId, { type: "docs_changed" });
}

export function getPresentationSSEClientCount(presentationId: number): number {
  return getHubClientCount("workflow.doc-pipeline", presentationId);
}

export function broadcastPresentationProjectReady(presentationId: number, projectId: number): void {
  broadcastToHub("workflow.doc-pipeline", presentationId, { type: "project_ready", projectId });
}

export function broadcastPresentationEvent(presentationId: number, event: Record<string, unknown>): void {
  broadcastToHub("workflow.doc-pipeline", presentationId, event);
}

// ── Presentation phase-generation SSE (late-join replay) ────────────────────────
// channel "workflow.doc-pipeline", scope = presentationId.
// Emit nodes fire within milliseconds of workflow start — often before the
// browser opens its SSE connection. Every broadcast caches its state; the route
// calls replayPhaseGenState(id, res) right after connecting to replay it.

export interface PhaseGenPhase {
  id: string;
  title: string;
  description: string;
  price: number;
  subtasks: string[];
}

export function broadcastPresentationPhaseGenProgress(
  presentationId: number,
  data: { message: string; current: number; total: number },
): void {
  broadcastToHubWithReplay("workflow.doc-pipeline", presentationId, { type: "phase_gen_progress", ...data });
}

export function broadcastPresentationPhaseGenComplete(
  presentationId: number,
  phases: PhaseGenPhase[],
): void {
  broadcastToHubWithReplay("workflow.doc-pipeline", presentationId, { type: "phase_gen_complete", phases });
}

export function broadcastPresentationPhaseGenError(
  presentationId: number,
  message: string,
): void {
  broadcastToHubWithReplay("workflow.doc-pipeline", presentationId, { type: "phase_gen_error", message });
}

/** Replay the last known phase_gen state to a freshly connected client, if any. */
export function replayPhaseGenState(presentationId: number, res: Response): void {
  replayHubState("workflow.doc-pipeline", presentationId, res);
}

// ── Admin-global workflow events SSE ── channel "workflow.run", scope = null ────
// Global (unscoped) — distinct from kanban's projectId-scoped use of the same
// channel, since scope null keys to "workflow.run:*".

export function registerAdminWorkflowEventClient(res: Response, onClose: () => void): void {
  registerHubClient("workflow.run", null, res, onClose);
}

export function broadcastAdminWorkflowEvent(event: Record<string, unknown>): void {
  broadcastToHub("workflow.run", null, event);
}

export function getAdminWorkflowEventClientCount(): number {
  return getHubClientCount("workflow.run", null);
}

// ── MSP Engine Events SSE ── channel "engine.alert", scope = mspId ──────────────

export function registerMspEngineEventClient(mspId: number, res: Response, onClose: () => void): void {
  registerHubClient("engine.alert", mspId, res, onClose);
}

export function broadcastMspEngineEvent(mspId: number, event: Record<string, unknown>): void {
  broadcastToHub("engine.alert", mspId, event);
}

export function getMspEngineEventClientCount(mspId: number): number {
  return getHubClientCount("engine.alert", mspId);
}

// ── Diagnostics Run SSE (late-join replay) ── channel "engine.monitor", scope = runId ──
// runId is a UUID string. Register replays on connect; every broadcast caches;
// clearDiagnosticsRunSSEState drops the cache when the run is finalized.

export function registerDiagnosticsRunSSEClient(runId: string, res: Response, onClose: () => void): void {
  registerHubClient("engine.monitor", runId, res, onClose, true);
}

export function broadcastDiagnosticsRunProgress(runId: string, data: {
  checkKey: string;
  checkLabel: string;
  status: string;
  index: number;
  total: number;
  requiresCustomerScript: boolean;
  errorMessage?: string;
}): void {
  broadcastToHubWithReplay("engine.monitor", runId, { type: "diagnostics_progress", ...data });
}

export function broadcastDiagnosticsRunComplete(runId: string, data: {
  status: string;
  checksTotal: number;
  checksOk: number;
  checksError: number;
  requiresScript: number;
  findings: number;
}): void {
  broadcastToHubWithReplay("engine.monitor", runId, { type: "diagnostics_complete", ...data });
}

export function broadcastDiagnosticsRunError(runId: string, message: string): void {
  broadcastToHubWithReplay("engine.monitor", runId, { type: "diagnostics_error", message });
}

export function clearDiagnosticsRunSSEState(runId: string): void {
  clearHubReplayState("engine.monitor", runId);
}

// ── Workflow Run progress SSE (late-join replay) ── channel "workflow.run-progress", scope = workflow run ID ──
// Mirrors the diagnostics run stream exactly, but keyed on the WORKFLOW run ID
// (wf_runs.id, stringified) — the only stable handle available from the very
// first node of an event-fired workflow. Used by the Assessment Document
// Generation workflow so the customer sees live step/total progress while
// documents generate, before any client_presentations row exists. Register
// replays the last cached event on connect (progress fires ms after the run
// starts, usually before the browser subscribes). Completion/failure remain
// authoritatively detected via status polling — these events are a live-UX
// enhancement layered on top, never the source of truth.

export function registerWorkflowRunSSEClient(runId: string, res: Response, onClose: () => void): void {
  registerHubClient("workflow.run-progress", runId, res, onClose, true);
}

export function broadcastWorkflowRunProgress(runId: string, data: {
  message: string;
  step?: number;
  total?: number;
  nodeId?: string;
}): void {
  broadcastToHubWithReplay("workflow.run-progress", runId, { type: "workflow_run_progress", ...data });
}

export function broadcastWorkflowRunComplete(runId: string, data: Record<string, unknown>): void {
  broadcastToHubWithReplay("workflow.run-progress", runId, { type: "workflow_run_complete", ...data });
}

export function broadcastWorkflowRunError(runId: string, message: string): void {
  broadcastToHubWithReplay("workflow.run-progress", runId, { type: "workflow_run_error", message });
}

export function clearWorkflowRunSSEState(runId: string): void {
  clearHubReplayState("workflow.run-progress", runId);
}

// ── Offer pipeline SSE ── channel "engine.offer" ───────────────────────────────
// Two sub-channels share the taxonomy channel but MUST stay isolated: mspId and
// customerId are both serials starting at 1, so a raw shared numeric scope would
// cross-talk (an MSP offer event leaking to a customer with the same id). The
// old code kept two separate maps; we preserve that isolation by namespacing the
// customer scope key ("customer:<id>") so it can never collide with an mspId.
// Consumers still pass plain mspId / customerId — the disambiguation is internal.

export function registerMspOfferSSEClient(mspId: number, res: Response, onClose: () => void): void {
  registerHubClient("engine.offer", mspId, res, onClose);
}

export function broadcastMspOfferChange(mspId: number, event: Record<string, unknown>): void {
  broadcastToHub("engine.offer", mspId, { type: "offer_changed", ...event });
}

export function registerCustomerOfferSSEClient(customerId: number, res: Response, onClose: () => void): void {
  registerHubClient("engine.offer", `customer:${customerId}`, res, onClose);
}

export function broadcastCustomerOfferChange(customerId: number, event: Record<string, unknown>): void {
  broadcastToHub("engine.offer", `customer:${customerId}`, { type: "offer_changed", ...event });
}
