/**
 * MSP Request Observability Middleware
 *
 * Attaches structured fields to every request that passes through the
 * /api/msp/v1/ router:
 *
 *   traceId   — UUID generated per request (or forwarded X-Trace-Id header)
 *   requestId — alias for traceId used by downstream code
 *   mspId     — numeric MSP tenant ID from the authenticated JWT (if any)
 *   actor     — { id, role } from the JWT (if any)
 *
 * Fields are attached to `res.locals` so any route handler downstream can
 * read them, and injected into every pino-http log line via the child logger
 * stored on `req.log`.
 *
 * The traceId is also echoed back in the X-Trace-Id response header so
 * clients can correlate requests with server log entries.
 */

import { randomUUID } from "crypto";
import type { Request, Response, NextFunction } from "express";
import type { AuthUser } from "./requireAuth";
import { getRequestContext } from "../lib/request-context.ts";

export interface MspRequestContext {
  traceId: string;
  requestId: string;
  mspId: number | null;
  actor: { id: number | string; role: string } | null;
}

/**
 * Middleware — must be the first middleware on the /api/msp/v1/ router.
 */
export function mspRequestLog(req: Request, res: Response, next: NextFunction): void {
  const traceId = getRequestContext()?.traceId ?? randomUUID();
  const user = req.user as AuthUser | undefined;

  const mspId = user?.mspId ?? null;
  const customerId = (user as (AuthUser & { customerId?: number | null }) | undefined)?.customerId ?? null;
  const actor = user ? { id: user.id, role: user.mspRole ?? user.role } : null;

  res.locals["traceId"] = traceId;
  res.locals["requestId"] = traceId;
  res.locals["mspId"] = mspId;
  res.locals["customerId"] = customerId;
  res.locals["actor"] = actor;

  // Echo the traceId so the caller can find their logs
  res.setHeader("X-Trace-Id", traceId);

  // Augment the pino logger bound to this request with MSP context fields.
  // pino-http attaches a child logger as req.log — we rebind it here.
  const reqAny = req as Request & { log?: { child?: (bindings: Record<string, unknown>) => unknown } };
  if (reqAny.log?.child) {
    reqAny.log = reqAny.log.child({ traceId, mspId, customerId, actor }) as typeof reqAny.log;
  }

  next();
}
