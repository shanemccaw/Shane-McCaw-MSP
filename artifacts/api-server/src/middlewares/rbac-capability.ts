/**
 * The decision source for a NON-ladder capability (#2460, part of #1696).
 *
 * `./rbac-ladder.ts` answers the seven `ladder.*` rungs behind `requireCapability` —
 * one platform-scoped snapshot, cached, because 631 route gates ask it. This module
 * answers everything else: the real, per-principal capabilities that used to be
 * `users.can_approve_purchases` and `users.can_manage_team`.
 *
 * #2460's contract is to retire those two columns "once nothing reads them". A column
 * cannot simply be dropped — the reads have to move somewhere that answers the same
 * question, and #2457 already put the answers in the database as rows: every user
 * carrying `can_approve_purchases` holds the `cap.purchases.approve` role, every user
 * carrying `can_manage_team` holds `cap.team.manage`, and the `msp:purchases.approve`
 * / `customer:team.manage` mapping rows reproduce the live rules exactly, asymmetries
 * included (see legacy-ladder.ts's transcription and its tests). This is the reader
 * for those rows. All row access is in ./rbac-capability-source.ts; nothing here
 * touches the database directly.
 *
 * ── How the principal's roles are resolved, and why it is NOT a plain load ──
 *
 * The obvious implementation is `loadRbacContext`, which reads every role a user
 * holds out of `msp_user_roles` / `customer_user_roles`. That would be wrong today,
 * and quietly so.
 *
 * When this was written, those tables had exactly two writers: #2457's one-time seed
 * and the AdminV2 admin CRUD (`routes/admin-rbac.ts`, #2461). Nothing wrote a rung row
 * when a user was created or re-roled, so deciding the RUNG half from them would have
 * silently denied every new user.
 *
 * #3408 fixed the maintenance: triggers on `users` now keep the rung rows in step with
 * `role`/`msp_role` (2026-09-10-rbac-user-roles-maintained-3408.sql). The rung is STILL
 * taken from the claim here, deliberately, for two reasons that outlive that fix. An
 * environment the #3408 migration has not reached yet (Replit/Staging until release,
 * #1630) still holds the stale snapshot. And moving from the claim to live rows changes
 * when a demotion or promotion takes effect, which is a decision #2458's header leaves
 * to the claim's retirement, not to a maintenance fix.
 *
 * So the two halves are resolved from two different places, deliberately, and this is
 * exactly the split #2458 already made for the ladder:
 *
 *  - **The rung** comes from the verified JWT claim, through `effectiveLegacyRole`
 *    (the same `role === "admin"` → top-rung promotion the gate has always applied),
 *    and is turned into a role id by looking that rung's key up in `<system>_roles`.
 *    Identical to how `requireCapability` identifies a principal.
 *  - **The extra grants** — the `cap.*` roles carrying what the two columns carried —
 *    come from a LIVE read of `<system>_user_roles`, every request. That is the
 *    property the columns had and the reason they were never cached in the JWT:
 *    *"Checked live in the route handler, NOT cached in the JWT (Git #1142)"*, so a
 *    revoke takes effect immediately rather than at the next token refresh.
 *
 * Live-held role rows whose key is a rung are deliberately ignored: honouring one
 * could only ever widen the decision beyond what the claim says the caller is, which
 * on an authorization path is the wrong direction to be wrong in.
 *
 * The stale-rung-row problem itself was filed as #3408 and fixed in the model's
 * maintenance (the `users` triggers above), not papered over here.
 *
 * ── Failing closed ─────────────────────────────────────────────────────────
 *
 * Same three-way outcome as the ladder, for the same reason: an environment where
 * #2457's seed has not run must report `unavailable` (503, logged, naming the
 * migration), never `deny`. A permission denial and an unseeded model look identical
 * from the outside otherwise, and that is what makes a cutover undiagnosable.
 */

import { evaluateCapability, type RbacFeatureMapping } from "@workspace/db/rbac/evaluate";
import { isKnownCapability, type RbacSystem } from "@workspace/db/rbac/capabilities";
import {
  LEGACY_ROLE_ORDER,
  effectiveLegacyRole,
  isLegacyRole,
  type LegacyRole,
} from "@workspace/db/rbac/legacy-ladder";
import {
  readHeldRoles,
  readMappings,
  readMembersAmong,
  readPlatformRoleId,
  readRoleKeys,
  readRoleMembers,
  readUsersWithRung,
  writeMembership,
  type RoleRow,
} from "./rbac-capability-source.ts";
import type { AuthUser } from "./requireAuth.ts";
import type { NextFunction, Request, Response } from "express";
import { apiError, ApiErrorCode } from "../lib/api-helpers.ts";

/** The migration an unseeded environment is missing. Named in every such log line. */
const SEED_MIGRATION = "lib/db/migrations/manual/2026-09-09-rbac-seed-current-model-2457.sql";

/** Lazy, swallowed logging — an authorization decision never fails because a log did. */
async function emit(level: "warn" | "error", fields: Record<string, unknown>, msg: string): Promise<void> {
  try {
    const { logger } = await import("../lib/logger.ts");
    logger.child({ channel: "auth" })[level](fields, msg);
  } catch {
    // Deliberately silent.
  }
}
const log = {
  warn: (f: Record<string, unknown>, m: string): void => void emit("warn", f, m),
  error: (f: Record<string, unknown>, m: string): void => void emit("error", f, m),
};

export type CapabilityOutcome =
  | { readonly kind: "allow" }
  | { readonly kind: "deny" }
  /** The model could not be consulted. NOT a denial — see the header. */
  | { readonly kind: "unavailable"; readonly reason: string };

/**
 * The org a decision is made inside: `msps.id` for the MSP system, `tenants.id` for
 * the customer system.
 *
 * Null is legitimate and common — every role and mapping #2457 seeded is
 * platform-scoped, and a PlatformAdmin has no org at all. An org id only ever adds
 * that org's own rows on top of the platform defaults, which is the point of the
 * redesign; it can never remove a platform grant.
 */
function orgIdFor(system: RbacSystem, user: Pick<AuthUser, "mspId" | "customerId">): number | null {
  return (system === "msp" ? user.mspId : user.customerId) ?? null;
}

/** The claim's rung role, plus every live-held role that is NOT itself a rung. */
function combine(rungRoleId: string | null, held: readonly RoleRow[]): string[] {
  const ids = new Set<string>();
  if (rungRoleId) ids.add(rungRoleId);
  for (const row of held) {
    if (isLegacyRole(row.key)) continue; // see the header — the claim decides the rung
    ids.add(row.id);
  }
  return [...ids];
}

/** Every role id this principal should be evaluated as holding. See the header. */
async function resolveRoleIds(
  system: RbacSystem,
  user: Pick<AuthUser, "id" | "role" | "mspRole">,
  orgId: number | null,
): Promise<string[]> {
  const rung = effectiveLegacyRole({ role: user.role, mspRole: user.mspRole ?? null });
  const [rungRoleId, held] = await Promise.all([
    rung ? readPlatformRoleId(system, rung) : Promise.resolve(null),
    readHeldRoles(system, user.id, orgId),
  ]);
  return combine(rungRoleId, held);
}

/** Union the allow sets, subtract every deny — #1696's settled question 1, deny wins. */
function allowedRoleIds(mappings: readonly RbacFeatureMapping[]): string[] {
  const allow = new Set<string>();
  const deny = new Set<string>();
  for (const mapping of mappings) {
    for (const id of mapping.allow) allow.add(id);
    for (const id of mapping.deny) deny.add(id);
  }
  for (const id of deny) allow.delete(id);
  return [...allow];
}

/**
 * Does this authenticated caller hold `capability` in `system`?
 *
 * Read live, every call. Callers that ask twice in one request accept two reads; this
 * replaces two columns that were themselves read live per handler, so it is not a new
 * round trip so much as the same one asking a better question. The ladder's snapshot
 * cache is deliberately NOT reused here — it exists because 631 gates share seven
 * platform rows, whereas these decisions are per-principal and caching them is exactly
 * how a revoke stops taking effect.
 */
export async function userHasCapability(
  user: Pick<AuthUser, "id" | "role" | "mspRole" | "mspId" | "customerId">,
  system: RbacSystem,
  capability: string,
): Promise<CapabilityOutcome> {
  if (!isKnownCapability(system, capability)) {
    log.error({ system, capability }, "userHasCapability was asked about an uncatalogued capability — failing closed");
    return { kind: "unavailable", reason: `unknown capability "${system}:${capability}"` };
  }

  const orgId = orgIdFor(system, user);

  let roleIds: string[];
  let mappings: RbacFeatureMapping[];
  try {
    [roleIds, mappings] = await Promise.all([
      resolveRoleIds(system, user, orgId),
      readMappings(system, capability, orgId),
    ]);
  } catch (err) {
    log.error({ err, system, capability }, "RBAC model unreadable on a capability check — failing closed");
    return { kind: "unavailable", reason: "rbac_model_unreadable" };
  }

  if (mappings.length === 0) {
    // No row at all for a capability the catalog knows about. That is an unseeded
    // environment, not "nobody has this" — answering deny here would report a missing
    // migration as a permission decision.
    log.error(
      { system, capability, migration: SEED_MIGRATION },
      "RBAC capability has no feature→role mapping row — #2457's seed migration has not been run against this database",
    );
    return { kind: "unavailable", reason: "rbac_model_unseeded" };
  }

  const decision = evaluateCapability({ system, capability, roleIds, mappings, orgId });
  return decision.allowed ? { kind: "allow" } : { kind: "deny" };
}

/**
 * Route gate for a CUSTOMER-system capability (#3465, part of #1696).
 *
 * `requireCapability` (./requireAuth.ts) decides the seven `ladder.*` rungs and
 * nothing else — `requireCapability-keys.test.ts` pins that. A route whose requirement
 * is a real customer-side capability mounts this instead, and this asks
 * `userHasCapability`, so the decision is exactly the one portal-team.ts's gate makes:
 * the claim's rung plus the live `cap.*` grants, deny wins, read every request.
 *
 * Mount it AFTER `requireAuth`. The three outcomes answer the way `requireCapability`
 * answers them — allow → `next()`, deny → 403, and an unreadable or unseeded model →
 * 503, never 403, because a missing migration must not read as a permission decision.
 * Every path writes a response or calls `next()`; nothing rejects out of it.
 */
export function requireCustomerCapability(capability: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = req.user;
    if (!user) {
      apiError(res, 401, ApiErrorCode.AUTH, "Authentication required");
      return;
    }

    let outcome: CapabilityOutcome;
    try {
      outcome = await userHasCapability(user, "customer", capability);
    } catch (err) {
      // Unreachable by design — userHasCapability catches its own reads — but an
      // authorization path does not get to throw.
      outcome = { kind: "unavailable", reason: "capability_check_threw" };
      log.error({ err, system: "customer", capability }, "requireCustomerCapability threw unexpectedly — failing closed");
    }

    if (outcome.kind === "allow") {
      next();
      return;
    }
    if (outcome.kind === "unavailable") {
      req.log?.error(
        { capability: `customer:${capability}`, reason: outcome.reason },
        "requireCustomerCapability could not consult the RBAC model — failing closed",
      );
      apiError(res, 503, ApiErrorCode.INTERNAL, "Authorization is temporarily unavailable");
      return;
    }
    apiError(res, 403, ApiErrorCode.FORBIDDEN, "Insufficient privileges");
  };
}

/**
 * Which users hold `capability` — the recipient-list question.
 *
 * Several real call sites need "who should be notified about a purchase approval",
 * which was `mspRole = 'MSPAdmin' OR can_approve_purchases` as a SQL predicate. That
 * predicate cannot survive the column being dropped, and rewriting it against the
 * mapping row is the honest replacement: the recipients become whoever the model says
 * holds the capability, so a re-grant changes who gets notified without a code change.
 *
 * The allowed roles are split the same way `resolveRoleIds` splits a principal's, and
 * for the same reason. A RUNG in the allow set means "everyone whose `users.msp_role`
 * is that rung", resolved from the column — the column is the rung's source of truth,
 * and in an environment #3408's sync migration has not reached, reading rung membership
 * from `*_user_roles` would silently omit every user created since the seed. A NON-rung
 * role is resolved from the live grant rows, which is where those grants actually live.
 *
 * Returns null — NOT an empty list — when the model cannot be read, so a caller can
 * tell "nobody qualifies" apart from "the question could not be asked". The two are
 * very different when the answer decides whether an approval request reaches a human.
 */
export async function usersHoldingCapability(
  system: RbacSystem,
  capability: string,
  orgId: number | null,
): Promise<number[] | null> {
  if (!isKnownCapability(system, capability)) {
    log.error({ system, capability }, "usersHoldingCapability was asked about an uncatalogued capability");
    return null;
  }

  try {
    const mappings = await readMappings(system, capability, orgId);
    if (mappings.length === 0) {
      log.error({ system, capability, migration: SEED_MIGRATION }, "RBAC capability has no mapping row — cannot resolve its holders");
      return null;
    }

    const roleIds = allowedRoleIds(mappings);
    if (roleIds.length === 0) return [];

    const roleRows = await readRoleKeys(system, roleIds);
    const rungKeys: LegacyRole[] = [];
    const grantRoleIds: string[] = [];
    for (const row of roleRows) {
      if (isLegacyRole(row.key)) rungKeys.push(row.key);
      else grantRoleIds.push(row.id);
    }

    const [byRung, byGrant] = await Promise.all([
      readUsersWithRung(rungKeys),
      readRoleMembers(system, grantRoleIds),
    ]);
    return [...new Set([...byRung, ...byGrant])];
  } catch (err) {
    log.error({ err, system, capability }, "RBAC model unreadable while resolving capability holders");
    return null;
  }
}

/**
 * Who may approve a purchase charge for one MSP — the notification-recipient question.
 *
 * Four real call sites asked this as a SQL predicate against the retired column
 * (workflow-executor's approval-gate fan-out, support-chat's escalation routing, and
 * the notify lists in portal-customer-requests and reinstatement-ticket).
 *
 * **This is a small, deliberate behaviour change, stated rather than hidden.** The old
 * predicate honoured the column for ANY role, while the authorization rule it stood in
 * for (msp-v1.ts's decide route) only ever honoured it on the MSPOperator branch — so
 * it was possible to be notified about an approval you could not perform. The
 * capability holders are the people who can actually decide. Zero users carry the
 * column in the live database, so nobody's notifications move today; the fix is to the
 * rule, not to anyone's inbox.
 */
export async function purchaseApproverUserIds(mspId: number | null): Promise<number[] | null> {
  return usersHoldingCapability("msp", "purchases.approve", mspId);
}

// ── The grant surface ────────────────────────────────────────────────────────
//
// A capability column was granted by an UPDATE on `users`. Its replacement is a
// membership row in `<system>_user_roles` pointing at the `cap.*` role #2457 created
// for that column. These two functions are that read and that write.
//
// Note what is deliberately NOT here: "can this user approve purchases". A grant and a
// capability are different questions and the MSP settings UI wants the former — an
// MSPAdmin can approve without ever being granted anything, and rendering their toggle
// as ON would tell an admin they had granted something they had not. Ask
// `userHasCapability` for the capability; ask these for the grant.

/**
 * Which of these users currently hold a given `cap.*` role.
 *
 * Returns null when the role does not exist — an unseeded model, which a caller
 * rendering a toggle must not display as "granted to nobody".
 */
export async function usersHoldingGrantRole(
  system: RbacSystem,
  roleKey: string,
  userIds: readonly number[],
): Promise<Set<number> | null> {
  try {
    const roleId = await readPlatformRoleId(system, roleKey);
    if (!roleId) {
      log.error({ system, roleKey, migration: SEED_MIGRATION }, "capability grant role is missing — #2457's seed has not been run against this database");
      return null;
    }
    return new Set(await readMembersAmong(system, roleId, userIds));
  } catch (err) {
    log.error({ err, system, roleKey }, "could not read capability grant memberships");
    return null;
  }
}

/**
 * Grant or revoke a `cap.*` role for one user.
 *
 * Replaces `UPDATE users SET can_* = $1`. Idempotent in both directions, so a
 * double-grant is not an error and a revoke of something never granted is a no-op —
 * matching the column's own semantics, where setting a boolean twice did nothing.
 *
 * Returns `{ ok: false }` rather than throwing when the model is not seeded, so the
 * route answers a diagnosable 503 instead of a 500 with a Drizzle stack in it.
 */
export async function setGrantRole(
  system: RbacSystem,
  userId: number,
  roleKey: string,
  granted: boolean,
  grantedByUserId: number | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const roleId = await readPlatformRoleId(system, roleKey);
  if (!roleId) {
    log.error({ system, roleKey, migration: SEED_MIGRATION }, "capability grant role is missing — cannot record a grant");
    return { ok: false, error: "rbac_model_unseeded" };
  }
  await writeMembership(system, userId, roleId, granted, grantedByUserId);
  return { ok: true };
}

/** Exported for the tests that enumerate the rungs this module deliberately ignores. */
export const RUNG_KEYS: readonly string[] = LEGACY_ROLE_ORDER;
