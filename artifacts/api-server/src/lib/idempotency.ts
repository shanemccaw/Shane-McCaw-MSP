/**
 * Idempotency Store
 *
 * Deduplicates mutating API calls using caller-supplied idempotency keys.
 * A key + mspId pair maps to a cached response for the key's TTL window.
 *
 * Usage (in a route handler):
 *   const cached = await checkIdempotency(key, mspId, bodyHash);
 *   if (cached) { res.status(cached.statusCode).json(cached.responseBody); return; }
 *   // ... perform the operation ...
 *   await recordIdempotency(key, mspId, bodyHash, 200, responseBody);
 */

import crypto from "crypto";
import { db, mspIdempotencyStoreTable } from "@workspace/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import { logger } from "./logger";
const log = logger.child({ channel: "system.core" });

const DEFAULT_TTL_SECONDS = 24 * 60 * 60; // 24 hours

export interface IdempotencyCacheEntry {
  statusCode: number;
  responseBody: Record<string, unknown>;
}

/**
 * Hash a request body deterministically for storage.
 */
export function hashBody(body: unknown): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(body ?? {}))
    .digest("hex");
}

/**
 * Check if a cached response exists for this key.
 * Returns the cached entry if it exists and the requestHash matches,
 * returns null otherwise (indicating the request should proceed normally).
 */
export async function checkIdempotency(
  idempotencyKey: string,
  mspId: number | null,
  requestHash: string,
): Promise<IdempotencyCacheEntry | null> {
  try {
    const now = new Date();
    const [row] = await db
      .select()
      .from(mspIdempotencyStoreTable)
      .where(
        and(
          eq(mspIdempotencyStoreTable.idempotencyKey, idempotencyKey),
          mspId !== null
            ? eq(mspIdempotencyStoreTable.mspId, mspId)
            : isNull(mspIdempotencyStoreTable.mspId),
          gt(mspIdempotencyStoreTable.expiresAt, now),
        ),
      )
      .limit(1);

    if (!row) return null;

    if (row.requestHash !== requestHash) {
      log.warn(
        { idempotencyKey, mspId },
        "idempotency: key reused with different request body — treating as conflict",
      );
      return null;
    }

    return { statusCode: row.statusCode, responseBody: row.responseBody as Record<string, unknown> };
  } catch (err) {
    log.error({ err, idempotencyKey }, "idempotency: check failed (non-fatal, proceeding)");
    return null;
  }
}

/**
 * Record a successful response for this idempotency key.
 * Silently no-ops on error so the caller's response is unaffected.
 */
export async function recordIdempotency(
  idempotencyKey: string,
  mspId: number | null,
  requestHash: string,
  statusCode: number,
  responseBody: Record<string, unknown>,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<void> {
  try {
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    await db
      .insert(mspIdempotencyStoreTable)
      .values({
        idempotencyKey,
        mspId: mspId ?? undefined,
        requestHash,
        statusCode,
        responseBody,
        expiresAt,
      })
      .onConflictDoNothing();
  } catch (err) {
    log.error({ err, idempotencyKey }, "idempotency: record failed (non-fatal)");
  }
}

/**
 * Express middleware factory that wires idempotency checking/recording.
 *
 * Reads `Idempotency-Key` header; passes through if absent.
 * On hit:  returns the cached response immediately.
 * On miss: records the response after the route handler completes.
 *
 * Usage:
 *   router.post("/payments", withIdempotency(), async (req, res) => { ... });
 */
import type { Request, Response, NextFunction } from "express";

export function withIdempotency(ttlSeconds?: number) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = req.headers["idempotency-key"] as string | undefined;
    if (!key) { next(); return; }

    const mspId = (req.user as { mspId?: number } | undefined)?.mspId ?? null;
    const bodyHash = hashBody(req.body);

    const cached = await checkIdempotency(key, mspId, bodyHash);
    if (cached) {
      res.status(cached.statusCode).json(cached.responseBody);
      return;
    }

    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      const result = originalJson(body);
      void recordIdempotency(key, mspId, bodyHash, res.statusCode, body as Record<string, unknown>, ttlSeconds);
      return result;
    };

    next();
  };
}
