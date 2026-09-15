/**
 * `requireAccess(capability, tierModuleKey?)` — the ONE route gate composing RBAC and
 * tier entitlement (#4192, leaf 2 of #1704), built on #4191's `evaluateAccess()`.
 *
 * ── Where it is mounted ──────────────────────────────────────────────────────
 *
 * #4193 (leaf 3) migrated the first batch of dual-gated READ routes onto it — the
 * seven Risk Register, POA&Ms and Ownership reads that carried BOTH
 * `requireCapability("ladder.customer-user")` and `requireTierFeature(...)`. The
 * remaining `requireTierFeature` routes are #1698's sweep. Mount it AFTER
 * `requireAuth` (`requireCapability` ran `requireAuth` internally; this does not),
 * the same convention as `requireCustomerCapability`:
 *
 *   router.get("/portal/runbooks", requireAuth,
 *     requireAccess("ladder.customer", PORTAL_TIER_MODULE_KEYS.runbooks), handler);
 *
 * ── Naming the capability ───────────────────────────────────────────────────
 *
 * A catalog key alone is not unique (`team.manage` exists in both systems, #2455), so
 * a non-ladder capability is named by its catalog id, `<system>:<key>` —
 * `customer:billing.view`, `msp:purchases.approve`. A bare `ladder.*` key is accepted
 * too, because only the MSP system has those and every existing `requireCapability`
 * call site already names them that way (`LADDER.*`). Anything else is a coding error
 * on an authorization path and answers 503 `unavailable`, never an allow.
 *
 * The principal is resolved exactly as the existing gates resolve it, through the
 * same functions they now call: `ladderEvaluationInput` (the claim's rung against the
 * platform `ladder.*` snapshot, `requireCapability`'s source) and
 * `capabilityEvaluationInput` (the claim's rung plus live `cap.*` grants, read every
 * request, `requireCustomerCapability`'s source).
 *
 * ── The order, and why the tier is loaded second ────────────────────────────
 *
 * `evaluateAccess()` never READS the tier input on an RBAC denial. This gate goes one
 * step further and never LOADS it: RBAC is decided first with `tier: null`, and only
 * an RBAC allow on a tier-gated route reads the customer's subscription and the tier
 * catalog. So a person who may not act costs no tier query, and a tier read failure can
 * never turn their 403 into a 503. The second call re-runs the (pure, cheap) RBAC half
 * so the final decision still comes out of the one decision function.
 *
 * ── The three answers ───────────────────────────────────────────────────────
 *
 *   basis "rbac"         → 403, `requireCapability`'s own `denialMessage()` wording.
 *   basis "entitlement"  → 402, `requireTierFeature`'s `TIER_UPGRADE_REQUIRED` body,
 *                          plus `basis`, `requiredTier` and `upgradePath` so the portal
 *                          can open the upgrade panel (#1135) instead of a dead end.
 *   model unreadable     → 503 `unavailable`, logged, never read as a denial.
 *
 * ── Every real denial is logged ─────────────────────────────────────────────
 *
 * This is the audit gap #4191 found: neither `requireCapability` nor
 * `requireCustomerCapability` logs a real deny today — only their `unavailable` path
 * does. Shane's #1704 decision requires *"both denials audited with their reason
 * (`logger.child({ channel: "auth" })`)"*. Every denial below writes one `warn` line on
 * that channel carrying `basis`, `evaluateAccess()`'s human-readable `reason`, the
 * capability, the deciding role ids, and — for an entitlement denial — the module,
 * `requiredTier` and `currentTier`. Allows are not logged (the request log already
 * records them, and 1,600 routes of allow lines would bury the denials).
 */

import type { NextFunction, Request, Response } from "express";
import { evaluateAccess, type AccessDenied, type TierEvaluationInput } from "@workspace/db/rbac/access";
import { RBAC_SYSTEMS, type RbacSystem } from "@workspace/db/rbac/capabilities";
import type { RbacEvaluationInput } from "@workspace/db/rbac/evaluate";
import { effectiveLegacyRole, ladderCapabilityRole } from "@workspace/db/rbac/legacy-ladder";
import type { PortalTierModuleKey } from "@workspace/db/rbac/tier-modules";
import { apiError, ApiErrorCode } from "../lib/api-helpers.ts";
import { logger } from "../lib/logger.ts";
import {
  readMonitoringTierCatalog,
  resolveCustomerTierEntitlement,
  tierUpgradeRequiredBody,
} from "../lib/portal-tier-features.ts";
import { resolveCustomerId } from "../lib/portal-customer-scope.ts";
import { capabilityEvaluationInput } from "./rbac-capability.ts";
import { ladderEvaluationInput } from "./rbac-ladder.ts";
import { denialMessage, type AuthUser } from "./requireAuth.ts";

const log = logger.child({ channel: "auth" });

type Prepared =
  | { readonly kind: "ready"; readonly input: RbacEvaluationInput }
  | { readonly kind: "unavailable"; readonly reason: string };

/** `<system>:<key>`, or a bare `ladder.*` key. `null` when the string names neither. */
export function parseAccessCapability(capability: string): { system: RbacSystem; key: string; ladder: boolean } | null {
  if (ladderCapabilityRole(capability)) return { system: "msp", key: capability, ladder: true };
  const colon = capability.indexOf(":");
  if (colon <= 0) return null;
  const system = capability.slice(0, colon);
  const key = capability.slice(colon + 1);
  if (!(RBAC_SYSTEMS as readonly string[]).includes(system) || key.length === 0) return null;
  // `msp:ladder.customer` is the same rung check as `ladder.customer` — route it to the
  // ladder source, which is the one that holds those rows.
  const ladder = system === "msp" && ladderCapabilityRole(key) !== undefined;
  return { system: system as RbacSystem, key, ladder };
}

async function prepareRbac(user: AuthUser, capability: string): Promise<Prepared> {
  const parsed = parseAccessCapability(capability);
  if (!parsed) {
    log.error({ capability }, "requireAccess was given a capability that is neither <system>:<key> nor a ladder.* key — failing closed");
    return { kind: "unavailable", reason: `unparseable capability "${capability}"` };
  }
  return parsed.ladder
    ? ladderEvaluationInput(effectiveRung(user), parsed.key)
    : capabilityEvaluationInput(user, parsed.system, parsed.key);
}

/** The `role === "admin"` → PlatformAdmin promotion, through the same shim `userClearsLadderCapability` uses. */
function effectiveRung(user: AuthUser): string | null {
  return effectiveLegacyRole({ role: user.role, mspRole: user.mspRole ?? null }) ?? null;
}

/** Who asked, for the audit line. Never the token, never the email. */
function principalFields(req: Request, user: AuthUser): Record<string, unknown> {
  return {
    userId: user.id,
    mspId: user.mspId ?? null,
    customerId: user.customerId ?? null,
    impersonatedBy: user.impersonatedBy ?? null,
    method: req.method,
    path: req.originalUrl ?? req.url,
  };
}

function logDenial(req: Request, user: AuthUser, capability: string, denial: AccessDenied): void {
  const fields: Record<string, unknown> = {
    ...principalFields(req, user),
    basis: denial.basis,
    reason: denial.reason,
    capability,
    effect: denial.rbac.effect,
    decidedBy: denial.rbac.decidedBy,
  };
  if (denial.basis === "entitlement") {
    fields.moduleKey = denial.moduleKey;
    fields.requiredTier = denial.requiredTier;
    fields.currentTier = denial.currentTier;
  }
  try {
    log.warn(fields, `requireAccess denied (${denial.basis})`);
  } catch {
    // An authorization decision never fails because a log line did.
  }
}

function unavailable(req: Request, res: Response, fields: Record<string, unknown>, msg: string): void {
  try {
    log.error({ ...fields, method: req.method, path: req.originalUrl ?? req.url }, msg);
  } catch {
    // As above.
  }
  apiError(res, 503, ApiErrorCode.INTERNAL, "Authorization is temporarily unavailable");
}

/**
 * Route gate: the caller must hold `capability` (RBAC) and, when `tierModuleKey` is
 * given, their organisation's active Monitoring tier must bundle it (entitlement).
 * Every path writes a response or calls `next()`; nothing rejects out of it.
 */
export function requireAccess(capability: string, tierModuleKey?: PortalTierModuleKey) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const user = req.user;
    if (!user) {
      apiError(res, 401, ApiErrorCode.AUTH, "Authentication required");
      return;
    }

    try {
      // ── RBAC, alone ──────────────────────────────────────────────────────
      const prepared = await prepareRbac(user, capability);
      if (prepared.kind === "unavailable") {
        unavailable(req, res, { ...principalFields(req, user), capability, reason: prepared.reason },
          "requireAccess could not consult the RBAC model — failing closed");
        return;
      }

      const rbacOnly = evaluateAccess({ rbac: prepared.input, tier: null });
      if (!rbacOnly.allowed) {
        logDenial(req, user, capability, rbacOnly);
        apiError(res, 403, ApiErrorCode.FORBIDDEN, denialMessage(prepared.input.capability), {
          basis: "rbac",
          capability,
        });
        return;
      }

      if (tierModuleKey === undefined) {
        next();
        return;
      }

      // ── Entitlement, only after an RBAC allow ────────────────────────────
      const customerId = resolveCustomerId(req);
      if (customerId === null) {
        // Same answer `requireTierFeature` gives: a caller with no organisation on the
        // token has no tier to upgrade, so this is not an upsell moment.
        try {
          log.warn(
            { ...principalFields(req, user), basis: "entitlement", reason: "No customer identity on token; no Monitoring tier to evaluate.", capability, moduleKey: tierModuleKey },
            "requireAccess denied (entitlement)",
          );
        } catch {
          // As above.
        }
        res.status(403).json({ error: "No customer identity on token" });
        return;
      }

      let tier: TierEvaluationInput;
      try {
        const [entitlement, catalog] = await Promise.all([
          resolveCustomerTierEntitlement(customerId),
          readMonitoringTierCatalog(),
        ]);
        tier = { moduleKey: tierModuleKey, includedFeatures: entitlement.includedFeatures, currentTier: entitlement.currentTier, catalog };
      } catch (err) {
        unavailable(req, res, { err, ...principalFields(req, user), capability, moduleKey: tierModuleKey, reason: "tier_model_unreadable" },
          "requireAccess could not read the customer's Monitoring tier — failing closed");
        return;
      }

      const decision = evaluateAccess({ rbac: prepared.input, tier });
      if (decision.allowed) {
        next();
        return;
      }

      logDenial(req, user, capability, decision);
      if (decision.basis === "rbac") {
        // Unreachable — the same pure RBAC input allowed above — but the type allows it.
        apiError(res, 403, ApiErrorCode.FORBIDDEN, denialMessage(prepared.input.capability), { basis: "rbac", capability });
        return;
      }
      res.status(402).json({
        ...tierUpgradeRequiredBody(decision.moduleKey),
        basis: "entitlement",
        requiredTier: decision.requiredTier,
        upgradePath: decision.upgradePath,
      });
    } catch (err) {
      // Unreachable by design — every read above catches its own errors — but an
      // authorization path does not get to throw.
      unavailable(req, res, { err, capability, moduleKey: tierModuleKey ?? null, reason: "access_check_threw" },
        "requireAccess threw unexpectedly — failing closed");
    }
  };
}
