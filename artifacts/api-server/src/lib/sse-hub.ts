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

// ── Firehose ──────────────────────────────────────────────────────────────────
// Subscribers here receive EVERY broadcast across ALL channels/scopes, each event
// tagged with its originating channel + scope. Backs the admin live-stream
// "?channel=*" view (e.g. the Engines tab watching all engine.* activity at once).
// Kept as a separate set — rather than a magic "*" key in `clients` — so ordinary
// channel-scoped delivery and the firehose fan-out stay independent.
const firehoseClients = new Set<Response>();

// ── Per-channel firehose ────────────────────────────────────────────────────────
// A middle tier between per-scope delivery (`clients`) and the all-channels
// firehose: subscribers here receive EVERY broadcast on ONE channel, regardless
// of scope. Backs the "watch this channel across all MSPs/customers" case — e.g.
// the Engines tab omits mspId, so it wants engine.sla activity for scope 42, 7,
// … all at once, not just the (rare) null-scope broadcasts that the exact-scope
// key "engine.sla:*" would match.
const channelFirehoseClients = new Map<string, Set<Response>>();

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

/** Register a firehose client that receives every broadcast on every channel. */
export function registerFirehoseClient(res: Response, onClose: () => void): void {
  firehoseClients.add(res);
  res.on("close", () => {
    firehoseClients.delete(res);
    onClose();
  });
}

function broadcastToFirehose(
  channel: string,
  scopeKey: string | number | null,
  event: Record<string, unknown>,
): void {
  if (firehoseClients.size === 0) return;
  const line = `data: ${JSON.stringify({ channel, scope: scopeKey, ...event })}\n\n`;
  for (const res of firehoseClients) {
    try { res.write(line); } catch {}
  }
}

/** Register a client that receives every broadcast on `channel`, regardless of scope. */
export function registerChannelFirehoseClient(channel: string, res: Response, onClose: () => void): void {
  if (!channelFirehoseClients.has(channel)) channelFirehoseClients.set(channel, new Set());
  const set = channelFirehoseClients.get(channel)!;
  set.add(res);
  res.on("close", () => {
    set.delete(res);
    if (set.size === 0) channelFirehoseClients.delete(channel);
    onClose();
  });
}

function broadcastToChannelFirehose(
  channel: string,
  scopeKey: string | number | null,
  event: Record<string, unknown>,
): void {
  const set = channelFirehoseClients.get(channel);
  if (!set?.size) return;
  const line = `data: ${JSON.stringify({ scope: scopeKey, ...event })}\n\n`;
  for (const res of set) {
    try { res.write(line); } catch {}
  }
}

export function broadcastToHub(
  channel: string,
  scopeKey: string | number | null,
  event: Record<string, unknown>,
): void {
  // Firehose subscribers must see EVERY broadcast — including ones on a
  // channel:scope key with no direct subscribers — so this runs BEFORE the
  // early-return below. broadcastToHubWithReplay delegates to this function, so
  // this single call covers both broadcast entry points; adding another call in
  // broadcastToHubWithReplay would double-emit to the firehose.
  broadcastToFirehose(channel, scopeKey, event);
  broadcastToChannelFirehose(channel, scopeKey, event);
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
