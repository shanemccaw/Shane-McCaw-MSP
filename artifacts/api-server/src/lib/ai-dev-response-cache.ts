/**
 * ai-dev-response-cache.ts
 *
 * Dev-only cache of Anthropic call responses, keyed on a stable hash of that
 * call's real inputs — #185, sub-issue of #183. Net-new: confirmed via direct
 * search that no dev-time AI response caching exists anywhere in this
 * codebase before this. Blocks #183 Phases 3/4/8 (Persona Generation, Use
 * Case Generation, Final Report narrative — the platform's only 3 real
 * Anthropic call sites so far), since all three depend on this existing
 * first, so nothing burns real API cost re-hitting the same prompt while
 * iterating on it.
 *
 * HARD GATE
 * ---------
 * `isAiDevResponseCacheEnabled()` fails closed: only an affirmative
 * NODE_ENV === "development" or "test" enables it (same allow-list
 * convention as admin-active-directory.ts's assertNonProductionEnvironment()
 * — not merely `!== "production"`, so an unset or unexpected NODE_ENV value
 * blocks rather than allows). There is no override flag of any kind, so
 * there is no way to enable this in production short of a deploy actually
 * setting NODE_ENV to "development"/"test" — structurally impossible via
 * this module's own surface, not just off by default. When disabled,
 * `withAiDevResponseCache` reduces to a plain `withAiAttribution(attribution,
 * fn)` call — byte-for-byte what every other Anthropic call site in this
 * codebase already does — so importing this module carries zero behavioral
 * risk in production.
 *
 * DOES NOT TOUCH ATTRIBUTION/BILLING
 * -----------------------------------
 * A cache HIT returns the stored response without ever calling `fn`, so
 * `withAiAttribution` and the metered `anthropic` client never run — no
 * `ai_usage_events` row is written and no cost is recorded, because none was
 * incurred. A cache MISS calls `fn` through the exact same
 * `withAiAttribution()` every real call site already uses, so it is
 * billed/attributed normally through ai-usage-sink.ts, with no special case.
 * This module never wraps or replaces `withAiAttribution` — it only decides
 * whether to call it.
 */

import { createHash } from "node:crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { aiDevResponseCacheTable, db } from "@workspace/db";
import { withAiAttribution, type AiCallAttribution } from "@workspace/integrations-anthropic-ai";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "engine.ai-cost-governance" });

/** Cache entries default to a 7-day TTL — long enough to survive a day's iteration, short enough not to accumulate stale dev cruft indefinitely. */
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Fail-closed non-production check. Only "development" or "test" unlocks the
 * cache; production, unset, or any other value keeps it off.
 */
export function isAiDevResponseCacheEnabled(): boolean {
  const env = process.env.NODE_ENV;
  return env === "development" || env === "test";
}

/** JSON.stringify with object keys sorted, so key order never changes the hash. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);
  return `{${entries.join(",")}}`;
}

function hashRequest(feature: string, requestContext: Record<string, unknown>): string {
  return createHash("sha256")
    .update(feature)
    .update("\0")
    .update(stableStringify(requestContext))
    .digest("hex");
}

export interface AiDevCacheRequest {
  /** Free-form label for the call site, e.g. "persona_generation". Cached rows are looked up by this + requestContext together. */
  feature: string;
  /** The real inputs (prompt/context) that determine the response — whatever shape this call site's request takes. */
  requestContext: Record<string, unknown>;
  /** Override the default 7-day TTL. `null` means no expiry (cleared only via clearAiDevResponseCache). */
  ttlMs?: number | null;
}

/**
 * Wrap one Anthropic call site with the dev-only response cache.
 *
 * Usage mirrors every existing `withAiAttribution` call site — swap that call
 * for this one and pass the request's cache key alongside the same
 * attribution and `fn` you already have:
 *
 *   const response = await withAiDevResponseCache(
 *     { feature: "persona_generation", requestContext: { quizAnswers } },
 *     { mspId, costOwner: "msp", nodeType: "persona_generation", feature: "persona_generation" },
 *     () => anthropic.messages.create({ model, max_tokens, messages }),
 *   );
 */
export async function withAiDevResponseCache<T>(
  request: AiDevCacheRequest,
  attribution: AiCallAttribution,
  fn: () => Promise<T>,
): Promise<T> {
  if (!isAiDevResponseCacheEnabled()) {
    return withAiAttribution(attribution, fn);
  }

  const hash = hashRequest(request.feature, request.requestContext);

  const [existing] = await db
    .select()
    .from(aiDevResponseCacheTable)
    .where(
      and(
        eq(aiDevResponseCacheTable.hash, hash),
        or(isNull(aiDevResponseCacheTable.expiresAt), gt(aiDevResponseCacheTable.expiresAt, new Date())),
      ),
    )
    .limit(1);

  if (existing) {
    log.info(
      { feature: request.feature, hash },
      "ai-dev-response-cache: hit — real Anthropic call skipped, zero cost incurred",
    );
    return existing.response as T;
  }

  log.info({ feature: request.feature, hash }, "ai-dev-response-cache: miss — issuing real Anthropic call");
  const response = await withAiAttribution(attribution, fn);

  const ttlMs = request.ttlMs === undefined ? DEFAULT_TTL_MS : request.ttlMs;
  const expiresAt = ttlMs == null ? null : new Date(Date.now() + ttlMs);

  try {
    await db
      .insert(aiDevResponseCacheTable)
      .values({
        hash,
        feature: request.feature,
        requestContext: request.requestContext,
        response: response as unknown as Record<string, unknown>,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: aiDevResponseCacheTable.hash,
        set: { response: response as unknown as Record<string, unknown>, expiresAt, requestContext: request.requestContext },
      });
  } catch (err) {
    // Caching is a dev convenience, never load-bearing — a failed write must
    // not turn an already-completed (and already-billed) Anthropic call into
    // an error.
    log.warn({ feature: request.feature, hash, err }, "ai-dev-response-cache: failed to persist cache entry");
  }

  return response;
}

/**
 * Manually clear cached entries — all of them, or just one feature's. Dev-only;
 * no-ops (returns 0) outside development/test.
 */
export async function clearAiDevResponseCache(feature?: string): Promise<number> {
  if (!isAiDevResponseCacheEnabled()) return 0;
  const deleted = feature
    ? await db
        .delete(aiDevResponseCacheTable)
        .where(eq(aiDevResponseCacheTable.feature, feature))
        .returning({ id: aiDevResponseCacheTable.id })
    : await db.delete(aiDevResponseCacheTable).returning({ id: aiDevResponseCacheTable.id });
  return deleted.length;
}
