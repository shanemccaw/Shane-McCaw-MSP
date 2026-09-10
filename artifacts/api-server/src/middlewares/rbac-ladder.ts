/**
 * `requireRole`'s decision source (#2458, part of #1696) — migration step 3 of 5.
 *
 * #1696's migration plan, step 3, verbatim: *"Move enforcement to the new evaluator
 * behind the old call signature, so the 480 call sites keep compiling while the
 * decision source changes underneath them."* This module is that decision source.
 * `requireAuth.ts`'s `requireRole` is now a thin HTTP wrapper over it; not one of
 * the 616 real `requireRole(...)` call sites in `src/routes` changed.
 *
 * ── What actually changed, and what deliberately did not ────────────────────
 *
 * BEFORE (`requireAuth.ts`, `ROLE_ORDER` + `roleIndex`):
 *   roleIndex(effectiveRole) < roleIndex(minimumRole) → 403
 *
 * AFTER (here):
 *   evaluateCapability({ system: "msp", capability: ladder.<minimumRole>,
 *                        roleIds: [<the effective rung's role id>], mappings: <DB rows> })
 *
 * Those are the same comparison. #2457 seeded each `ladder.<x>` mapping's allow set
 * by joining the ladder to itself on `idx >= idx`, so the allow set of
 * `ladder.msp-admin` IS `{MSPAdmin, PlatformAdmin}` — `roleIndex(held) >=
 * roleIndex(`MSPAdmin`)` enumerated as rows instead of evaluated as an array index.
 * The behaviour is identical by construction; what moved is WHERE the rule lives.
 * Changing who clears `requireCapability("ladder.msp-admin")` is now an UPDATE, not a deploy.
 *
 * **The principal is still identified from the verified JWT, exactly as before.**
 * `effectiveLegacyRole` (the transcription in `@workspace/db/rbac`) applies the same
 * `role === "admin"` → `PlatformAdmin` promotion `requireRole` has always applied —
 * see the note on that promotion below. What this module deliberately does NOT do is
 * re-resolve the principal's roles from `msp_user_roles` at request time. That would
 * be a real behaviour change on a security path whose entire contract is that nothing
 * observable changes: a session holding a stale claim would start being evaluated
 * against live rows (in both directions — a demotion would take effect mid-session,
 * and a promotion would take effect without re-login). Which of those is desirable is
 * a genuine decision, and it belongs to #2459/#2460 with the JWT claim's retirement,
 * not to a swap-under-the-hood step. Every real token issuer already writes
 * `users.msp_role` into the claim verbatim (`getMspClaims`, `auth.ts:165-199`;
 * impersonation and print-exchange tokens both carry the TARGET user's id and claims,
 * `auth.ts:969-978`, `auth.ts:1103-1112`), so claim and column agree at issue time.
 *
 * ── Why the mapping rows are read platform-scoped only ──────────────────────
 *
 * `loadRbacContext` honours an org override (a row with a non-null `msp_id`) on top
 * of the platform default, which is correct for an ordinary capability — an MSP
 * tailoring its own roles is the point of the redesign. It is NOT correct for these
 * seven rows. `ladder.*` is the transitional transcription of a PLATFORM-WIDE
 * privilege floor, and an MSP-scoped override of `ladder.platform-admin` would let one
 * MSP's own row grant its staff the top of the platform ladder. So this module reads
 * `msp_id IS NULL` rows and nothing else, and passes `orgId: null` to the evaluator so
 * a foreign row could not be honoured even if one were somehow returned. #2460 deletes
 * these rows with the role enum; until then they are not tenant-editable.
 *
 * ── Failing closed, and telling the difference between the two failures ─────
 *
 * A DB-backed authorization gate has a failure mode an array index does not: the rows
 * can be absent. That happens for one real, predictable reason — an environment where
 * #2457's seed migration has not been run (it is recorded on #1630 as a Replit/Staging
 * release-gate action, so Staging genuinely does not have these rows yet). If that
 * environment ran this code and answered 403, every `requireRole`-gated route would
 * return "Insufficient privileges" and the cause would look like a permission bug.
 *
 * So an unseeded model is NOT a denial. It is reported as `unavailable`, answered 503,
 * and logged as an error naming the migration — loud and diagnosable. A genuine denial
 * (rows present, principal holds no allowed role) keeps the exact 403 body it has
 * always had. Neither path can be reached by falling back to the old ladder: there is
 * no fallback, because a silent fallback is how a cutover ends up never actually
 * cutting over.
 */

// Deliberately the two PURE leaf modules, not the `@workspace/db/rbac` barrel. The
// barrel also re-exports `load.ts`/`admin.ts`/`sync.ts`, which pull in the whole
// Drizzle schema graph; this middleware needs the decision function and the ladder
// transcription and nothing else. Importing the leaves keeps the DB-touching half out
// of every module graph that reaches `requireRole` — which is all of them.
import { evaluateCapability, type RbacDecision, type RbacFeatureMapping } from "@workspace/db/rbac/evaluate";
import {
  LEGACY_ROLE_ORDER,
  effectiveLegacyRole,
  isLegacyRole,
  ladderCapabilityKey,
  ladderCapabilityRole,
  type LegacyRole,
} from "@workspace/db/rbac/legacy-ladder";
import { LADDER_CAPABILITY_KEY_LIST, readLadderRows } from "./rbac-ladder-source.ts";

/**
 * The platform logger, imported LAZILY and only on a path that actually logs.
 *
 * `requireAuth.ts` now depends on this module, so this module's imports become part
 * of the module graph of every consumer of `requireRole` — which is every route file.
 * `../lib/logger.ts` pulls in the log-stream DB writer and the exception tracker, and
 * a role check has no business dragging those in. Every call below is on an
 * exceptional path (unseeded model, unreadable model, stale-grace fallback, a floor
 * that is not a rung, boot priming), so the import cost is never paid by a normal
 * request, and the hot path stays free of it.
 *
 * Failures to log are swallowed on purpose: logging must never be the reason an
 * authorization decision does not get made.
 */
const log = {
  info: (fields: Record<string, unknown>, msg: string): void => void emit("info", fields, msg),
  warn: (fields: Record<string, unknown>, msg: string): void => void emit("warn", fields, msg),
  error: (fields: Record<string, unknown>, msg: string): void => void emit("error", fields, msg),
};

async function emit(level: "info" | "warn" | "error", fields: Record<string, unknown>, msg: string): Promise<void> {
  try {
    const { logger } = await import("../lib/logger.ts");
    logger.child({ channel: "auth" })[level](fields, msg);
  } catch {
    // Deliberately silent — see above.
  }
}




/**
 * How long a loaded snapshot is served without re-reading.
 *
 * This is deliberately a small, local, transitional cache and NOT an answer to
 * #1704, which holds the permissions engine's real caching/performance strategy as
 * an open decision. The scope here is seven platform rows that only #2460 is
 * expected to change, and the alternative — a DB round trip on every one of 616
 * route gates — would be a real latency regression taken silently on #1704's behalf.
 * When #1704 lands its strategy, this becomes the first thing it replaces.
 */
const SNAPSHOT_TTL_MS = 30_000;

/**
 * How long a previously-good snapshot may still be served after a refresh FAILS.
 *
 * The trade is explicit: a transient DB error on the refresh path would otherwise
 * 503 every gated route at once, even though the rows being cached had just been
 * read successfully and only #2460 is expected to change them. Serving a
 * few-minutes-stale copy of seven platform rows is a smaller risk than a total
 * authorization outage on a blip. Past this bound the grace ends and the gate fails
 * closed — stale forever is how a revoked grant keeps working.
 */
const SNAPSHOT_STALE_GRACE_MS = 5 * 60_000;

export interface LadderSnapshot {
  /** Rung name → the platform-scoped `msp_roles.id` that represents it. */
  readonly roleIdByRung: ReadonlyMap<LegacyRole, string>;
  /** The platform-scoped `ladder.*` mapping rows, decoded. */
  readonly mappings: readonly RbacFeatureMapping[];
  /** `Date.now()` at load. */
  readonly loadedAt: number;
  /**
   * What the seed is missing, or empty when the model is fully seeded. Non-empty
   * means every decision from this snapshot is `unavailable`, never a denial.
   */
  readonly missing: readonly string[];
}

let cached: LadderSnapshot | null = null;
/** In-flight load, so a burst of concurrent requests issues ONE pair of queries. */
let inFlight: Promise<LadderSnapshot> | null = null;

/** Turn the raw rows into a decision-ready snapshot. */
async function readSnapshot(): Promise<LadderSnapshot> {
  const { rungs, mappings: mappingRows } = await readLadderRows();

  const roleIdByRung = new Map<LegacyRole, string>();
  for (const row of rungs) {
    if (isLegacyRole(row.key)) roleIdByRung.set(row.key, row.id);
  }

  const mappings: RbacFeatureMapping[] = mappingRows.map((row) => ({
    system: "msp" as const,
    capabilityKey: row.capabilityKey,
    // Platform scope. The source reads `msp_id IS NULL`; restated here so the
    // evaluator's own cross-org re-check has the right value to compare against.
    orgId: null,
    allow: row.allow,
    deny: row.deny,
  }));

  const mappedKeys = new Set(mappings.map((m) => m.capabilityKey));
  const missing: string[] = [
    ...LEGACY_ROLE_ORDER.filter((role) => !roleIdByRung.has(role)).map((role) => `msp_roles.key=${role}`),
    ...LADDER_CAPABILITY_KEY_LIST.filter((key) => !mappedKeys.has(key)).map((key) => `msp_feature_role_mapping.capability_key=${key}`),
  ];

  return { roleIdByRung, mappings, loadedAt: Date.now(), missing };
}

/**
 * The current snapshot, loading or refreshing it as needed.
 *
 * Throws only when there is nothing safe to answer from: no cached snapshot, or one
 * older than the stale grace, and the read failed. Callers turn that into 503.
 */
async function getSnapshot(): Promise<LadderSnapshot> {
  const now = Date.now();
  if (cached && now - cached.loadedAt < SNAPSHOT_TTL_MS) return cached;

  if (!inFlight) {
    inFlight = readSnapshot()
      .then((snapshot) => {
        cached = snapshot;
        if (snapshot.missing.length > 0) {
          log.error(
            { missing: snapshot.missing, migration: "lib/db/migrations/manual/2026-09-09-rbac-seed-current-model-2457.sql" },
            "RBAC ladder model is NOT seeded — every requireRole-gated route will fail closed with 503 until #2457's seed migration is run against this database",
          );
        }
        return snapshot;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  try {
    return await inFlight;
  } catch (err) {
    if (cached && now - cached.loadedAt < SNAPSHOT_STALE_GRACE_MS) {
      log.warn(
        { err, ageMs: now - cached.loadedAt },
        "RBAC ladder snapshot refresh failed — serving the last good snapshot within the stale grace window",
      );
      return cached;
    }
    throw err;
  }
}

/**
 * Load the snapshot now, so an unseeded or unreachable model is discovered and
 * logged at boot rather than on the first gated request. Never throws — a boot-time
 * failure must not take down the routes that do not need this gate, and the
 * per-request path re-reports it anyway.
 */
export async function primeLadderSnapshot(): Promise<void> {
  try {
    const snapshot = await getSnapshot();
    if (snapshot.missing.length === 0) {
      log.info({ rungs: snapshot.roleIdByRung.size, mappings: snapshot.mappings.length }, "RBAC ladder enforcement ready — requireCapability decisions come from msp_feature_role_mapping (#2458)");
    }
  } catch (err) {
    log.error({ err }, "RBAC ladder snapshot could not be loaded at boot — requireRole-gated routes will fail closed with 503 until it can be read");
  }
}

/**
 * Drop the cached snapshot. Called by the admin surface that edits roles/mappings
 * so an edit is visible immediately instead of within the TTL.
 */
export function invalidateLadderSnapshot(): void {
  cached = null;
}

export type LadderOutcome =
  | { readonly kind: "allow"; readonly decision: RbacDecision }
  | { readonly kind: "deny"; readonly decision: RbacDecision }
  /** The model could not be consulted. NOT a denial — see the header. */
  | { readonly kind: "unavailable"; readonly reason: string };

/**
 * Does a principal holding exactly `heldRole` clear the `requireCapability(key)` bar?
 *
 * `heldRole` is an already-promoted effective rung (or null/undefined/unrecognised,
 * which holds no rung and therefore clears nothing — matching the -1 the retired
 * `roleIndex()` returned). `capabilityKey` must be one of the seven catalogued
 * `ladder.*` keys; anything else is a coding error on an authorization path and is
 * reported `unavailable`, never allowed.
 *
 * #2460 — this is the key-taking form. Before it the parameter was a role NAME and
 * the key was derived here. The direction is now reversed: the route gates name a
 * capability, and the rung is recovered only to build the 403 body, which stays
 * byte-identical to the one the `ROLE_ORDER` comparison produced.
 */
export async function roleClearsLadderCapability(
  heldRole: string | null | undefined,
  capabilityKey: string,
): Promise<LadderOutcome> {
  const floor = ladderCapabilityRole(capabilityKey);
  if (!floor) {
    log.error(
      { capabilityKey },
      "requireCapability was given a key that is not a known ladder capability — failing closed",
    );
    return { kind: "unavailable", reason: `unknown capability "${capabilityKey}"` };
  }

  let snapshot: LadderSnapshot;
  try {
    snapshot = await getSnapshot();
  } catch (err) {
    log.error({ err, floor }, "RBAC ladder snapshot unavailable — failing closed on a requireCapability check");
    return { kind: "unavailable", reason: "rbac_model_unreadable" };
  }

  if (snapshot.missing.length > 0) {
    return { kind: "unavailable", reason: "rbac_model_unseeded" };
  }

  // A principal that holds no recognised rung holds no role id, so the evaluator
  // returns `unset` — default deny, which is what roleIndex() === -1 produced.
  const heldRoleId = isLegacyRole(heldRole) ? snapshot.roleIdByRung.get(heldRole) : undefined;

  const decision = evaluateCapability({
    system: "msp",
    capability: capabilityKey,
    roleIds: heldRoleId ? [heldRoleId] : [],
    mappings: snapshot.mappings,
    orgId: null,
  });

  return decision.allowed ? { kind: "allow", decision } : { kind: "deny", decision };
}

/**
 * The role-NAME form, for the one caller that genuinely compares two roles as data
 * rather than gating a route: `msp-settings.ts`'s target-role assignment ceiling
 * (Git #3032), which asks "does the role I am about to assign outrank the caller's?"
 * A role being assigned is a value, not a route requirement, so it keeps a
 * role-shaped question — and asking it through these same rows is what stops the
 * ceiling from drifting away from the gate.
 */
export async function roleClearsLadderFloor(
  heldRole: string | null | undefined,
  floor: string,
): Promise<LadderOutcome> {
  if (!isLegacyRole(floor)) {
    log.error({ floor }, "roleClearsLadderFloor was given a floor that is not a known ladder rung — failing closed");
    return { kind: "unavailable", reason: `unknown floor "${floor}"` };
  }
  return roleClearsLadderCapability(heldRole, ladderCapabilityKey(floor));
}

/**
 * `requireCapability`'s decision for one authenticated request.
 *
 * The `role === "admin"` → `PlatformAdmin` promotion is applied here, through
 * `effectiveLegacyRole` — the transcription cited to `requireAuth.ts:210-212`.
 * #1696 requires that promotion be *"carried across deliberately rather than
 * inherited by accident"*: it is the one grant of the top rung that comes from a
 * column other than `msp_role`, and dropping it would lock every legacy admin
 * account out of all 35 `requireCapability("ladder.platform-admin")` routes at once.
 * `rbac-ladder.test.ts` asserts this agrees with `requireAuth.ts`'s own
 * `effectiveMspRole` for every principal shape, so the two cannot drift apart.
 */
export async function userClearsLadderCapability(
  user: { readonly role: string; readonly mspRole?: string | null },
  capabilityKey: string,
): Promise<LadderOutcome> {
  const effective = effectiveLegacyRole({ role: user.role, mspRole: user.mspRole ?? null });
  return roleClearsLadderCapability(effective, capabilityKey);
}
