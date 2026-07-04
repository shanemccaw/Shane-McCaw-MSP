import type { Response } from "express";

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
