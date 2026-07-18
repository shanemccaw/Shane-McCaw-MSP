import type { Response } from "express";

// Generic channel + scope keyed SSE registry, modeled on sse-broadcast.ts's
// existing per-map pattern but unified into one map.
//
// Key format: "<channel>:<scopeKey>" — scopeKey is a stringified mspId,
// customerId, or "*" for global/unscoped channels (e.g. system.core).
type ClientMap = Map<string, Set<Response>>;

const clients: ClientMap = new Map();

function keyFor(channel: string, scopeKey: string | number | null): string {
  return `${channel}:${scopeKey ?? "*"}`;
}

export function registerHubClient(
  channel: string,
  scopeKey: string | number | null,
  res: Response,
  onClose: () => void,
): void {
  const key = keyFor(channel, scopeKey);
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
