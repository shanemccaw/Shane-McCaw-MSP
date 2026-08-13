import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestContext {
  traceId: string;
  mspId: number | null;
  customerId: number | null;
  actor: { id: number | string; role: string } | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(
  ctx: RequestContext,
  fn: () => T,
): T {
  return storage.run(ctx, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

/**
 * Merge partial fields into the CURRENT context in place (e.g. once auth
 * resolves mspId/actor mid-request). Only works if called while inside an
 * active runWithRequestContext() call; no-ops otherwise.
 */
export function enrichRequestContext(patch: Partial<RequestContext>): void {
  const ctx = storage.getStore();
  if (!ctx) return;
  Object.assign(ctx, patch);
}
