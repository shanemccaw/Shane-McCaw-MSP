/**
 * portal-pii-governance.ts — the CUSTOMER-scoped PII / data-governance read.
 *
 *   GET /api/portal/pii-governance — this customer's real label/DLP signals
 *
 * ── Why a new route, and why it takes no customer input ─────────────────────
 * The four backing checks (compliance:missing-labels / label-errors /
 * weak-dlp-policies / dlp-incidents) live in tenant_monitor_profiles, the
 * platform's unscoped monitoring surface keyed by the M365 tenant identifier.
 * Reading it for a customer page has the same cross-tenant hazard
 * portal-risk-register.ts and portal-change-control.ts were built to avoid: the
 * customer must never be able to name the tenant it reads. So there is no
 * `req.query` here at all — the tenant is resolved purely from the JWT:
 *
 *     JWT customerId → tenants row → tenants.tenantId (the M365 identifier)
 *
 * via the shared `resolveTenantScope`, which fails closed on a missing row, a
 * missing mspId, or a BLANK tenantId (an empty-string match would read every
 * tenant whose identifier is also blank). The check rows are then filtered on
 * that resolved tenantId inside `computePiiGovernance`.
 *
 * ── Role floor: CustomerUser ────────────────────────────────────────────────
 * Matches its Governance sibling portal-risk-register.ts rather than the
 * Assessment floor used by change-control / remediation-tracker. This page names
 * the tenant's personal-data exposure and links straight into the risk /
 * change / policy surfaces that act on it, so it sits with the register, not with
 * the free Assessment tier. The floor gates the TIER; the scoping above is what
 * prevents a cross-tenant read, and it is identical either way. TEST_PORTAL_EMAIL
 * is a real CustomerUser (verified in portal-risk-register.ts's header against
 * the users/tenants join), so the harness reaches this floor.
 *
 * ── What this route deliberately does NOT serve ─────────────────────────────
 * The design fixture's per-document findings, named sources, matched patterns,
 * access matrix and drift feed have no collected backing (there is no
 * content-inspection PII discovery scan) — see portal-pii-governance.ts (the
 * lib) for the full accounting. This route serves only what is real: the four
 * aggregate compliance signals as `findings` when they genuinely fired, and a
 * `coverage` block naming every backing check's real status so the page can say
 * WHY it is empty (today, for the testbed tenant, all four report a Security &
 * Compliance session error — a true, honest not-collected state).
 *
 * An unresolvable scope answers 200 with an empty-but-shaped payload, never 403:
 * a customer whose tenant row carries no M365 identifier genuinely has no
 * collected signals, which is a true statement the page renders correctly. 403
 * would read as "you may not see your own governance", a different, wrong claim.
 */

import { Router, type IRouter, type Request, type Response } from "express";

import { requireRole } from "../middlewares/requireAuth";
import { resolveCustomerId, resolveTenantScope } from "../lib/portal-customer-scope";
import { requireTierFeature, PORTAL_TIER_MODULE_KEYS } from "../lib/portal-tier-features";
import { PII_GOVERNANCE_CHECKS } from "../lib/portal-pii-governance";
import { computePiiGovernance } from "../lib/portal-pii-governance-query";
import { apiError, ApiErrorCode } from "../lib/api-helpers";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

/** The empty-but-shaped payload for a tenant with no resolvable M365 identifier. */
function emptyPayload() {
  return {
    status: "Not collected" as const,
    scanned: null,
    cadence: "Daily",
    findings: [],
    coverage: PII_GOVERNANCE_CHECKS.map((c) => ({
      key: c.key,
      label: c.label,
      kind: c.kind,
      status: "not_collected" as const,
      reason: "This tenant has no resolvable Microsoft 365 identifier, so no governance signals have been collected.",
      count: null,
      collectedAt: null,
    })),
  };
}

router.get(
  "/portal/pii-governance",
  requireRole("CustomerUser"),
  // #1168: the underlying compliance signals collect unconditionally; only
  // this READ checks the tier bundles PII Governance.
  requireTierFeature(PORTAL_TIER_MODULE_KEYS.piiGovernance),
  async (req: Request, res: Response) => {
    try {
      const customerId = resolveCustomerId(req);
      if (customerId === null) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "Customer context required");
        return;
      }
      const scope = await resolveTenantScope(customerId);
      if (!scope) {
        log.info({ customerId }, "pii-governance requested with no resolvable tenant scope — serving empty");
        res.json(emptyPayload());
        return;
      }

      const payload = await computePiiGovernance(scope.tenantId);
      res.json(payload);
    } catch (err: unknown) {
      log.error({ err }, "GET /portal/pii-governance failed");
      apiError(res, 500, ApiErrorCode.INTERNAL, err instanceof Error ? err.message : String(err));
    }
  },
);

export default router;
