/**
 * portal-security-plan.ts — the CUSTOMER-scoped Security Plan (plan of record).
 *
 *   GET /api/portal/security-plan — this customer's Security Plan: `assembledPlan`,
 *                                   the settled #1561 pipeline's last SIGNED version.
 *
 * ── Why this route exists at all ───────────────────────────────────────────
 * Nothing backed `/portal-v2/security-plan` before it. The page was built from
 * `securityPlanData.ts` (SECURITY_PLAN) — a transcription of the design's own
 * Halden Materials plan — and there was NO plan-of-record table of any name,
 * customer-side or MSP-side.
 *
 * ── One model now (#2576, retired #2829) ────────────────────────────────────
 * #2576 found this route's original legacy `portal_security_plans` table
 * (`plan`, hand-authored, zero rows ever) and the real, tested, MSP-side
 * assembled/versioned/signed pipeline (`msp-security-plan.ts`,
 * `security-plan-assembly.ts` + siblings, #1561-#1567) were two live,
 * completely disconnected representations of "the Security Plan," with
 * nothing bridging them. #1561's own settled architecture comment
 * (2026-08-28, closed) already decided the assembled pipeline is the real one
 * ("not a tenth module... owns almost no data of its own") — #2576 bridged
 * `assembledPlan` onto this route as an addition alongside the legacy `plan`
 * field, deliberately leaving the legacy table in place since dropping it was
 * a destructive schema change out of scope for that route-level build. #2829
 * is the scheduled follow-up: with no live consumer of `plan` ever having
 * existed (confirmed zero rows in all four `portal_security_plan*` tables,
 * both at #2576 and again here), `plan` and the legacy read path are gone
 * from this route entirely. The tables themselves are dropped by
 * `lib/db/migrations/manual/2026-09-04-drop-legacy-portal-security-plans.sql`
 * — destructive DDL, so per CLAUDE.md's Database section that file is Shane's
 * to run, not self-executed here; this route no longer references those
 * tables either way.
 * `assembledPlan` is the only model this route serves now: the caller's
 * tenant resolved via `resolveTenantScope` (read-only lookup, no MSP session
 * required) and the last **signed** `msp_security_plan_versions` row for it,
 * if any. Only ever the *signed* version — an unsigned draft/current version
 * is an MSP-internal work product (freeze → author prose → seal is an
 * authoring sequence, not a publication one) and is never surfaced here.
 *
 * ── ADMIN-AUTHORED, READ-ONLY (and why there is no POST) ────────────────────
 * A Security Plan is the plan of record the MSP (Shane's team) writes and signs
 * FOR a tenant; the customer reads it, they do not edit it. So this route is
 * GET-only — the same read-only stance `portal-ownership.ts` took, for the same
 * PRODUCT reason rather than a security one. `assembledPlan` is authored through
 * `msp-security-plan.ts`'s freeze/prose/seal/sign sequence. If a
 * customer-editable plan is ever wanted, that is a new table decision and its own
 * piece of work — it is deliberately not faked here.
 *
 * ── Scoping ─────────────────────────────────────────────────────────────────
 * `resolveCustomerId` — `tenants.id`, straight off the JWT's `customerId` claim.
 * `assembledPlan` resolves `resolveTenantScope(customerId)` to get the `mspId`
 * the MSP-era `msp_security_plan_versions` table is keyed on (same
 * two-scoping-shapes split `portal-customer-scope.ts`'s own header documents)
 * — read-only, fails closed to `null` on any resolution error.
 *
 * ── Role floor ─────────────────────────────────────────────────────────────
 * `requireRole("CustomerUser")`, matching `portal-ownership.ts`: a security plan
 * is a thing a paying tenant's team reads, not something a free assessment lead
 * is shown. The cross-tenant guard is the `customerId`-from-JWT scoping below.
 *
 * ── The derived numbers are NOT computed here ──────────────────────────────
 * `assembledPlan.content` is served as the full, self-contained signed snapshot
 * with no server-side re-derivation (matching `msp-security-plan.ts`'s own
 * "no rolled-up score" rule, §6.3 of the Security Plan contract pack).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireRole } from "../middlewares/requireAuth";
import { resolveCustomerId, resolveTenantScope } from "../lib/portal-customer-scope";
import { requireTierFeature, PORTAL_TIER_MODULE_KEYS } from "../lib/portal-tier-features";
import { getLastSignedSecurityPlanVersion } from "../lib/security-plan-versioning";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

/**
 * The #1561 assembled/versioned/signed pipeline's last SIGNED version — the
 * only model this route serves (see file header "One model now").
 * `content` is `SecurityPlanContent` (`security-plan-assembly.ts`'s module rows,
 * the #1563 scope and the #1565 filter footprint, plus authored prose) and
 * `signedBy` is `ClientApprover` — both left as `unknown` here exactly as
 * `msp-security-plan.ts`'s own `WireSecurityPlanVersion` does, since neither
 * type is exported for cross-module reuse and this route does not need to
 * inspect their shape, only pass it through.
 */
export interface WireAssembledSecurityPlan {
  readonly versionNumber: number;
  readonly content: unknown;
  /** Mirrored out of `content.footprint.scope.statement` — see #1564. */
  readonly scopeStatement: string;
  readonly signedAt: string;
  readonly signedBy: unknown;
}

export interface WireSecurityPlanPayload {
  /** The settled #1561 pipeline's last signed version, or null when nothing
   * has ever been signed for this customer. */
  readonly assembledPlan: WireAssembledSecurityPlan | null;
}

/**
 * Resolves `assembledPlan`. Fails closed to `null` on any error.
 */
async function resolveAssembledPlan(customerId: number): Promise<WireAssembledSecurityPlan | null> {
  try {
    const tenantScope = await resolveTenantScope(customerId);
    if (!tenantScope) return null;

    const lastSigned = await getLastSignedSecurityPlanVersion(tenantScope.mspId, customerId);
    if (!lastSigned || !lastSigned.signedAt) return null;

    return {
      versionNumber: lastSigned.versionNumber,
      content: lastSigned.content,
      scopeStatement: lastSigned.content.footprint.scope.statement,
      signedAt: lastSigned.signedAt.toISOString(),
      signedBy: lastSigned.signedBy,
    };
  } catch (err) {
    log.error(
      { customerId, err: err instanceof Error ? err.message : String(err) },
      "portal security plan: assembledPlan lookup failed",
    );
    return null;
  }
}

router.get(
  "/portal/security-plan",
  requireRole("CustomerUser"),
  // #1168: authoring the plan (msp-security-plan.ts) is unconditional; only
  // this customer-facing READ checks the tier bundles Security Plan.
  requireTierFeature(PORTAL_TIER_MODULE_KEYS.securityPlan),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const assembledPlan = await resolveAssembledPlan(customerId);

      log.info(
        { customerId, hasAssembledPlan: assembledPlan !== null },
        "portal security plan served",
      );

      res.json({ assembledPlan } satisfies WireSecurityPlanPayload);
    } catch (err) {
      log.error(
        { customerId, err: err instanceof Error ? err.message : String(err) },
        "portal security plan failed",
      );
      res.status(500).json({ error: "Your security plan could not be loaded." });
    }
  },
);

export default router;
