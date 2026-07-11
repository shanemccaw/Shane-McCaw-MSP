import type { Response } from "express";

// ── Per-user notification SSE ──────────────────────────────────────────────────
// Keyed by userId (usersTable) for platform_admin / customer_user recipients.
// MSP-user recipients key off mspUserId (negative convention: -(mspUserId) to
// avoid collisions with regular userIds, since both are serials starting at 1).

const notificationSSEClients = new Map<number, Set<Response>>();

/**
 * Register an SSE client for user-scoped notification updates.
 * @param key  positive userId for admin/client users; -(mspUserId) for MSP users
 */
export function registerNotificationSSEClient(key: number, res: Response, onClose: () => void): void {
  if (!notificationSSEClients.has(key)) notificationSSEClients.set(key, new Set());
  const clients = notificationSSEClients.get(key)!;
  clients.add(res);
  res.on("close", () => {
    clients.delete(res);
    if (clients.size === 0) notificationSSEClients.delete(key);
    onClose();
  });
}

/**
 * Broadcast a new-notification event to a specific user's SSE clients.
 * @param key  positive userId or -(mspUserId)
 */
export function broadcastNotification(key: number, notification: Record<string, unknown>): void {
  const clients = notificationSSEClients.get(key);
  if (!clients?.size) return;
  const line = `data: ${JSON.stringify({ type: "notification", notification })}\n\n`;
  for (const res of clients) {
    try { res.write(line); } catch { }
  }
}

/**
 * Broadcast an unread-count update to a user's SSE clients (lightweight ping).
 * @param key  positive userId or -(mspUserId)
 */
export function broadcastUnreadCount(key: number, unreadCount: number): void {
  const clients = notificationSSEClients.get(key);
  if (!clients?.size) return;
  const line = `data: ${JSON.stringify({ type: "unread_count", unreadCount })}\n\n`;
  for (const res of clients) {
    try { res.write(line); } catch { }
  }
}

const kanbanSSEClients = new Map<number, Set<Response>>();

export function registerSSEClient(projectId: number, res: Response, onClose: () => void): void {
  if (!kanbanSSEClients.has(projectId)) kanbanSSEClients.set(projectId, new Set());
  const clients = kanbanSSEClients.get(projectId)!;
  clients.add(res);
  res.on("close", () => {
    clients.delete(res);
    if (clients.size === 0) kanbanSSEClients.delete(projectId);
    onClose();
  });
}

export function broadcastKanbanChange(projectId: number, payload: { action: string; task: unknown }): void {
  const clients = kanbanSSEClients.get(projectId);
  if (!clients?.size) return;
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of clients) {
    try { res.write(line); } catch { }
  }
}

// ── Presentation scope SSE ─────────────────────────────────────────────────
// Keyed by presentation ID. Broadcasts whenever the SOW scope/pricing changes
// so open client tabs can refresh immediately without waiting for a poll cycle.

const presentationSSEClients = new Map<number, Set<Response>>();

export function registerPresentationSSEClient(presentationId: number, res: Response, onClose: () => void): void {
  if (!presentationSSEClients.has(presentationId)) presentationSSEClients.set(presentationId, new Set());
  const clients = presentationSSEClients.get(presentationId)!;
  clients.add(res);
  res.on("close", () => {
    clients.delete(res);
    if (clients.size === 0) presentationSSEClients.delete(presentationId);
    onClose();
  });
}

export function broadcastPresentationScopeChange(presentationId: number, sowVersion: string): void {
  const clients = presentationSSEClients.get(presentationId);
  if (!clients?.size) return;
  const line = `data: ${JSON.stringify({ type: "scope_changed", sowVersion })}\n\n`;
  for (const res of clients) {
    try { res.write(line); } catch { }
  }
}

export function broadcastPresentationDocsChange(presentationId: number): void {
  const clients = presentationSSEClients.get(presentationId);
  if (!clients?.size) return;
  const line = `data: ${JSON.stringify({ type: "docs_changed" })}\n\n`;
  for (const res of clients) {
    try { res.write(line); } catch { }
  }
}

export function getPresentationSSEClientCount(presentationId: number): number {
  return presentationSSEClients.get(presentationId)?.size ?? 0;
}

// ── Admin-global workflow events SSE ──────────────────────────────────────────
// Used by the play_sound workflow node (Browser target) to deliver real-time
// audio playback instructions to open admin panel tabs.

const adminWorkflowEventClients = new Set<Response>();

export function registerAdminWorkflowEventClient(res: Response, onClose: () => void): void {
  adminWorkflowEventClients.add(res);
  res.on("close", () => {
    adminWorkflowEventClients.delete(res);
    onClose();
  });
}

export function broadcastAdminWorkflowEvent(event: Record<string, unknown>): void {
  if (adminWorkflowEventClients.size === 0) return;
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of adminWorkflowEventClients) {
    try { res.write(line); } catch { }
  }
}

export function getAdminWorkflowEventClientCount(): number {
  return adminWorkflowEventClients.size;
}

// ── Presentation phase-generation SSE ─────────────────────────────────────────
// Keyed by presentationId on the same presentationSSEClients map.
// Delivers live AI phase generation progress to the client's locked screen.
//
// Late-join problem: emit nodes fire within milliseconds of workflow start.
// By the time the browser navigates to step 8 and opens the SSE connection,
// those events have already broadcast to zero clients and are lost.
// Fix: cache the latest phase_gen state per presentation and replay it
// immediately when a new client connects.

export interface PhaseGenPhase {
  id: string;
  title: string;
  description: string;
  price: number;
  subtasks: string[];
}

type PhaseGenState =
  | { type: "phase_gen_progress"; message: string; current: number; total: number }
  | { type: "phase_gen_complete"; phases: PhaseGenPhase[] }
  | { type: "phase_gen_error"; message: string };

// In-memory cache of the latest phase_gen state per presentation.
// Cleared when the run completes (complete or error) or the server restarts.
const lastPhaseGenState = new Map<number, PhaseGenState>();

export function broadcastPresentationPhaseGenProgress(
  presentationId: number,
  data: { message: string; current: number; total: number },
): void {
  const state: PhaseGenState = { type: "phase_gen_progress", ...data };
  lastPhaseGenState.set(presentationId, state);
  const clients = presentationSSEClients.get(presentationId);
  if (!clients?.size) return;
  const line = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of clients) {
    try { res.write(line); } catch { }
  }
}

export function broadcastPresentationPhaseGenComplete(
  presentationId: number,
  phases: PhaseGenPhase[],
): void {
  // Cache so late-joining clients also get the complete signal
  lastPhaseGenState.set(presentationId, { type: "phase_gen_complete", phases });
  const clients = presentationSSEClients.get(presentationId);
  if (!clients?.size) return;
  const line = `data: ${JSON.stringify({ type: "phase_gen_complete", phases })}\n\n`;
  for (const res of clients) {
    try { res.write(line); } catch { }
  }
}

export function broadcastPresentationPhaseGenError(
  presentationId: number,
  message: string,
): void {
  // Cache so late-joining clients also get the error signal
  lastPhaseGenState.set(presentationId, { type: "phase_gen_error", message });
  const clients = presentationSSEClients.get(presentationId);
  if (!clients?.size) return;
  const line = `data: ${JSON.stringify({ type: "phase_gen_error", message })}\n\n`;
  for (const res of clients) {
    try { res.write(line); } catch { }
  }
}

/** Replay the last known phase_gen state to a freshly connected client, if any. */
export function replayPhaseGenState(presentationId: number, res: Response): void {
  const state = lastPhaseGenState.get(presentationId);
  if (!state) return;
  try { res.write(`data: ${JSON.stringify(state)}\n\n`); } catch { }
}

// ── Project-ready SSE ──────────────────────────────────────────────────────────
// Fired once the engagement project has been created/linked to a presentation so
// the client's ConfirmationStep can light up the "Go to Your Project" CTA button.

/** Broadcast { type: "project_ready", projectId } on the presentation's SSE channel. */
export function broadcastPresentationProjectReady(presentationId: number, projectId: number): void {
  const clients = presentationSSEClients.get(presentationId);
  if (!clients?.size) return;
  const line = `data: ${JSON.stringify({ type: "project_ready", projectId })}\n\n`;
  for (const res of clients) {
    try { res.write(line); } catch { }
  }
}

// ── MSP Engine Events SSE ──────────────────────────────────────────────────────
// Keyed by mspId. Delivers SLA breach and scope-creep violation events to open
// MSP Portal tabs so dashboards can refresh without polling.

const mspEngineEventClients = new Map<number, Set<Response>>();

export function registerMspEngineEventClient(mspId: number, res: Response, onClose: () => void): void {
  if (!mspEngineEventClients.has(mspId)) mspEngineEventClients.set(mspId, new Set());
  const clients = mspEngineEventClients.get(mspId)!;
  clients.add(res);
  res.on("close", () => {
    clients.delete(res);
    if (clients.size === 0) mspEngineEventClients.delete(mspId);
    onClose();
  });
}

export function broadcastMspEngineEvent(mspId: number, event: Record<string, unknown>): void {
  const clients = mspEngineEventClients.get(mspId);
  if (!clients?.size) return;
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    try { res.write(line); } catch { }
  }
}

export function getMspEngineEventClientCount(mspId: number): number {
  return mspEngineEventClients.get(mspId)?.size ?? 0;
}

// ── Diagnostics Run SSE ────────────────────────────────────────────────────────
// Keyed by runId (UUID string). The progress modal subscribes on open; the
// runner broadcasts per-check progress events and a final complete/error event.
// Late-join support: cache the latest state and replay it to freshly connected
// clients so the modal works even if the connection is established after the
// run has already started.

type DiagnosticsRunState =
  | { type: "diagnostics_progress"; checkKey: string; checkLabel: string; status: string; index: number; total: number; requiresCustomerScript: boolean; errorMessage?: string }
  | { type: "diagnostics_complete"; status: string; checksTotal: number; checksOk: number; checksError: number; requiresScript: number; findings: number }
  | { type: "diagnostics_error"; message: string };

const diagnosticsRunSSEClients = new Map<string, Set<Response>>();
const lastDiagnosticsRunState = new Map<string, DiagnosticsRunState>();

export function registerDiagnosticsRunSSEClient(runId: string, res: Response, onClose: () => void): void {
  if (!diagnosticsRunSSEClients.has(runId)) diagnosticsRunSSEClients.set(runId, new Set());
  const clients = diagnosticsRunSSEClients.get(runId)!;
  clients.add(res);
  const cached = lastDiagnosticsRunState.get(runId);
  if (cached) {
    try { res.write(`data: ${JSON.stringify(cached)}\n\n`); } catch { }
  }
  res.on("close", () => {
    clients.delete(res);
    if (clients.size === 0) diagnosticsRunSSEClients.delete(runId);
    onClose();
  });
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
  const state: DiagnosticsRunState = { type: "diagnostics_progress", ...data };
  lastDiagnosticsRunState.set(runId, state);
  const clients = diagnosticsRunSSEClients.get(runId);
  if (!clients?.size) return;
  const line = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of clients) {
    try { res.write(line); } catch { }
  }
}

export function broadcastDiagnosticsRunComplete(runId: string, data: {
  status: string;
  checksTotal: number;
  checksOk: number;
  checksError: number;
  requiresScript: number;
  findings: number;
}): void {
  const state: DiagnosticsRunState = { type: "diagnostics_complete", ...data };
  lastDiagnosticsRunState.set(runId, state);
  const clients = diagnosticsRunSSEClients.get(runId);
  if (!clients?.size) return;
  const line = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of clients) {
    try { res.write(line); } catch { }
  }
}

export function broadcastDiagnosticsRunError(runId: string, message: string): void {
  const state: DiagnosticsRunState = { type: "diagnostics_error", message };
  lastDiagnosticsRunState.set(runId, state);
  const clients = diagnosticsRunSSEClients.get(runId);
  if (!clients?.size) return;
  const line = `data: ${JSON.stringify(state)}\n\n`;
  for (const res of clients) {
    try { res.write(line); } catch { }
  }
}

export function clearDiagnosticsRunSSEState(runId: string): void {
  lastDiagnosticsRunState.delete(runId);
}
