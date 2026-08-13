/**
 * resolve-msp-id.ts
 *
 * Shared helper to resolve the MSP ID from an incoming request.
 *
 * Resolution order for PlatformAdmin / admin users:
 *   1. ?mspId= query param  (explicit numeric override)
 *   2. ?slug= query param   (look up MSP by slug in the DB)
 *   3. returns null / 0 depending on the variant called
 *
 * Regular MSP users:
 *   Reads mspId directly from the JWT claim.
 */

import type { Request } from "express";
import { db, mspsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Resolve the MSP ID for the calling user.
 *
 * - For admin/PlatformAdmin: tries ?mspId= first, then ?slug= (DB lookup), then returns null.
 * - For regular MSP users: returns user.mspId (throws if missing).
 *
 * Returns null (not 0) when no MSP context is resolved — callers that need a
 * hard 400 should check for null.
 */
export async function resolveMspId(req: Request): Promise<number | null> {
  const user = req.user!;

  if (user.role === "admin" || user.mspRole === "PlatformAdmin") {
    const q = req.query as Record<string, unknown>;

    // 1. Explicit numeric ?mspId=
    const rawMspId = parseInt(String(q["mspId"] ?? ""), 10);
    if (!isNaN(rawMspId)) return rawMspId;

    // 2. Slug-based lookup — ?slug=
    const slug = String(q["slug"] ?? "").trim();
    if (slug) {
      const [row] = await db
        .select({ id: mspsTable.id })
        .from(mspsTable)
        .where(eq(mspsTable.slug, slug))
        .limit(1);
      if (row) return row.id;
    }

    return null;
  }

  return user.mspId ?? null;
}

/**
 * Like resolveMspId but returns 0 (cross-platform view) instead of null when
 * the admin has no MSP context. Used in routes that treat mspId=0 as "show all".
 */
export async function resolveMspIdOrZero(req: Request): Promise<number> {
  const id = await resolveMspId(req);
  return id ?? 0;
}

/**
 * Strict, session-only MSP resolution.
 *
 * Returns the caller's own mspId straight from the authenticated session,
 * with NO ?mspId= / ?slug= query-param override — even for PlatformAdmin.
 * Use this on session-scoped /msp/... routes (no :mspId in the URL) that must
 * only ever operate on the caller's own MSP. For admin-facing cross-MSP access,
 * use a /msps/:mspId/... route with requireMspScope instead.
 *
 * Returns null when the session carries no MSP context; callers should 403.
 */
export function resolveMspIdStrict(req: Request): number | null {
  return req.user?.mspId ?? null;
}
