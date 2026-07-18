import type { Response } from "express";

// Generic channel + scope keyed SSE registry, modeled on sse-broadcast.ts's
// existing per-map pattern but unified into one map.
//
// Key format: "<channel>:<scopeKey>" — scopeKey is a stringified mspId,
// customerId, or "*" for global/unscoped channels (e.g. system.core).
type ClientMap = Map<string, Set<Response>>;

const clients: ClientMap = new Map();

// In-memory cache of the last broadcast event per key, populated only by
// broadcastToHubWithReplay. Enables "late-join" replay: a client that connects
// AFTER an event already fired still receives the latest cached state. Used by
// the presentation phase-gen and diagnostics-run channels (see sse-channels.ts),
// which fire progress events milliseconds after a workflow starts — often before
// the browser has opened its SSE connection.
const lastStateCache = new Map<string, Record<string, unknown>>();

function keyFor(channel: string, scopeKey: string | number | null): string {
  return `${channel}:${scopeKey ?? "*"}`;
}

export function registerHubClient(
  channel: string,
  scopeKey: string | number | null,
  res: Response,
  onClose: () => void,
  replayOnConnect = false,
): void {
  const key = keyFor(channel, scopeKey);
  if (replayOnConnect) {
    const cached = lastStateCache.get(key);
    if (cached) { try { res.write(`data: ${JSON.stringify(cached)}\n\n`); } catch {} }
  }
  if (!clients.has(key)) clients.set(key, new Set());
  const set = clients.get(key)!;
  set.add(res);
  res.on("close", () => {
    set.delete(res);
    if (set.size === 0) clients.delete(key);
    onClose();
  });
}

export function broadcastToHub(
  channel: string,
  scopeKey: string | number | null,
  event: Record<string, unknown>,
): void {
  const key = keyFor(channel, scopeKey);
  const set = clients.get(key);
  if (!set?.size) return;
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of set) {
    try { res.write(line); } catch {}
  }
}

export function getHubClientCount(channel: string, scopeKey: string | number | null): number {
  return clients.get(keyFor(channel, scopeKey))?.size ?? 0;
}

/**
 * Like broadcastToHub, but also caches the event so a client that connects
 * AFTER this fires still receives it via registerHubClient's replayOnConnect
 * param (or replayHubState).
 */
export function broadcastToHubWithReplay(
  channel: string,
  scopeKey: string | number | null,
  event: Record<string, unknown>,
): void {
  const key = keyFor(channel, scopeKey);
  lastStateCache.set(key, event);
  broadcastToHub(channel, scopeKey, event);
}

/** Drop the cached replay state for a key (e.g. when a run finishes). */
export function clearHubReplayState(channel: string, scopeKey: string | number | null): void {
  lastStateCache.delete(keyFor(channel, scopeKey));
}

/**
 * Replay the last cached event for a key to a single already-connected client,
 * if any. Supports the standalone replay pattern (register, then replay) that
 * the presentation phase-gen channel uses, where the register call itself must
 * NOT replay because it is shared with non-replaying scope-change subscribers.
 */
export function replayHubState(
  channel: string,
  scopeKey: string | number | null,
  res: Response,
): void {
  const cached = lastStateCache.get(keyFor(channel, scopeKey));
  if (!cached) return;
  try { res.write(`data: ${JSON.stringify(cached)}\n\n`); } catch {}
}
