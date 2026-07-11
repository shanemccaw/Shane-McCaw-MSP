/**
 * Per-mspId Rate Limiting Middleware
 *
 * Enforces per-tenant throttling so one misbehaving MSP cannot degrade service
 * for others.  Falls back to IP-based limiting for unauthenticated requests
 * (using express-rate-limit's ipKeyGenerator for correct IPv6 handling).
 *
 * Limits (configurable via environment variables):
 *   MSP_RATE_LIMIT_WINDOW_MS   — sliding window in ms (default: 60 000 = 1 min)
 *   MSP_RATE_LIMIT_MAX          — max requests per window (default: 300)
 *   MSP_RATE_LIMIT_MUTATING_MAX — separate, tighter limit for POST/PUT/PATCH/DELETE
 *                                  (default: 60 per window)
 *
 * Behaviour:
 *  - 429 response uses the standard MSP error shape.
 *  - RateLimit-* headers follow RFC 6585 / draft-ietf-httpapi-ratelimit-headers.
 *  - PlatformAdmin (role === "admin") requests are exempt.
 */

import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request, Response } from "express";
import type { AuthUser } from "./requireAuth";

const windowMs = parseInt(process.env["MSP_RATE_LIMIT_WINDOW_MS"] ?? "60000", 10);
const maxRequests = parseInt(process.env["MSP_RATE_LIMIT_MAX"] ?? "300", 10);
const maxMutating = parseInt(process.env["MSP_RATE_LIMIT_MUTATING_MAX"] ?? "60", 10);

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Derive the rate-limit bucket key from the request.
 * Authenticated MSP users are bucketed by mspId (or userId when mspId absent).
 * PlatformAdmin / legacy admin users are exempt (key prefix "exempt:").
 * Unauthenticated requests fall back to IP via ipKeyGenerator (handles IPv6).
 */
function keyGenerator(req: Request): string {
  const user = req.user as AuthUser | undefined;
  if (!user) return `ip:${ipKeyGenerator(req.ip ?? "unknown")}`;
  if (user.role === "admin") return `exempt:${user.id}`;
  if (user.mspId) return `msp:${user.mspId}`;
  return `user:${user.id}`;
}

function isExempt(req: Request): boolean {
  const user = req.user as AuthUser | undefined;
  return user?.role === "admin";
}

const sharedOptions = {
  windowMs,
  keyGenerator,
  skip: isExempt,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  handler: (_req: Request, res: Response) => {
    res.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests — please slow down and retry after the rate-limit window resets.",
      },
    });
  },
} as const;

/**
 * General read + write limiter (all HTTP methods).
 * Apply to every route in the /api/msp/v1/ router.
 */
export const mspRateLimit = rateLimit({
  ...sharedOptions,
  max: maxRequests,
});

/**
 * Tighter limiter for state-mutating endpoints (POST/PUT/PATCH/DELETE).
 * Stack after mspRateLimit on mutating routes.
 */
export const mspMutatingRateLimit = rateLimit({
  ...sharedOptions,
  max: maxMutating,
  skip: (req: Request) => isExempt(req) || !MUTATING_METHODS.has(req.method),
});
