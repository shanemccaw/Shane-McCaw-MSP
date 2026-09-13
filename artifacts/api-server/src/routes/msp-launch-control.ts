/**
 * msp-launch-control.ts
 *
 * M365 Launch Control — an MSP-facing console where a technician executes
 * real, live M365 write actions against a customer's tenant, one action at a
 * time. Distinct from Mission Control (the existing customer monitoring
 * dashboard).
 *
 * Auth: requireCapability("ladder.msp-operator") + requireMspScope("params") (path-based
 * :mspId). Every customerId is additionally re-checked via
 * assertCustomerAccess so a staff member can never reach a customer outside
 * their own MSP, or outside their per-staff tenant scope.
 *
 * Entitlement model (independent axes, all must clear for "included"):
 *   - MSP-side: services.type_attributes.tierCapabilities, via
 *     launch_control_safe_write / launch_control_gated_write (msp-entitlement.ts).
 *   - Customer-side: the customer's purchased Monitoring tier (services.tier,
 *     resolved via tenants -> users -> client_services -> services —
 *     NOT the MSP sales-bundle path, which can't distinguish Enhanced from
 *     Premium) against a catalog action's min_bundled_tier.
 *   - Tenant-side (Git #3947): the customer's real M365 tenant actually
 *     holding one of the catalog row's required_license_skus, if any are
 *     set — independent of both axes above, since this is a genuine
 *     Microsoft licensing fact, not a platform entitlement.
 * write_action_catalog.required_capability_key is intentionally never read —
 * no add-on/capability-grant mechanism exists yet (see task history).
 *
 * TEMPORARY STAGING RESTRICTION: execute only ever runs against a customer
 * flagged isTestbed — this is a real Graph write against a real tenant, and
 * the general live-tenant restriction is a separate, later task.
 *
 * Change Control (Git #3541): execute raises a real, pre-approved `standard`
 * `msp_change_requests` row BEFORE the Graph write fires (see
 * `launch-control-change-request.ts`), and records the write as a
 * `write_action` cr_execution immediately after — no separate Console
 * attestation call, and no more `human-action` calls 404ing against a
 * changeRequestId that was never created.
 *
 * License gate (Git #3947, proactive counterpart to #3937's reactive fix):
 * a catalog row can carry `required_license_skus` (nullable jsonb array of
 * Graph skuPartNumber values, ANY ONE of which satisfies it). Both routes
 * re-check the customer's tenant against a live `/subscribedSkus` read
 * (license-gate.ts) — GET reflects it as availability `"license_required"`
 * (a real 4th state, not just the 3 above) with a `licenseRequirement`
 * reason on each action; POST re-validates it before ever raising a Change
 * Request or attempting the write, returning the same `errorType:
 * "license_gap"` shape #3937 already gave the reactive Graph-write failure.
 *
 * Routes:
 *   GET  /api/msp/:mspId/launch-control/actions?customerId=:customerId
 *   POST /api/msp/:mspId/launch-control/execute
 *   POST /api/msp/:mspId/launch-control/rollback/:auditLogId
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  writeActionCatalogTable,
  baselineActionTemplatesTable,
  baselineActionTemplateAuditLogTable,
  tenantsTable,
  clientServicesTable,
  servicesTable,
  type WriteActionCatalog,
} from "@workspace/db";
import { eq, and, asc, inArray } from "drizzle-orm";
import { requireCapability, requireMspScope, assertCustomerAccess } from "../middlewares/requireAuth.ts";
import { loadTier, tierAllowsFeature } from "../lib/msp-entitlement.ts";
import { resolveCustomerUserIds } from "../lib/tenant-signals.ts";
import { logger } from "../lib/logger.ts";
import { apiError, ApiErrorCode } from "../lib/api-helpers.ts";
import {
  raiseChangeRequestForLaunchControlExecution,
  recordLaunchControlExecutionOutcome,
} from "../lib/launch-control-change-request.ts";
import {
  getSubscribedSkuPartNumbersForTenant,
  tenantHasRequiredLicense,
  describeRequiredLicense,
} from "../lib/license-gate.ts";

const log = logger.child({ channel: "engine.launch-control" });

const router: IRouter = Router();

function p(val: string | string[] | undefined): string {
  return Array.isArray(val) ? (val[0] ?? "") : (val ?? "");
}

// Monitoring tier rank, used only to compare a customer's purchased tier
// against a catalog action's min_bundled_tier. Not independently
// re-verified against live services.tier values in this session (no DB
// access here) — Basic/Enhanced/Premium are the three names given for this
// task; an unrecognized tier name resolves to null and fails closed (see
// resolveTierRank), never silently grants coverage.
const MONITORING_TIER_RANK: Record<string, number> = {
  basic: 0,
  enhanced: 1,
  premium: 2,
};

function resolveTierRank(tierName: string | null | undefined): number | null {
  if (!tierName) return null;
  const rank = MONITORING_TIER_RANK[tierName.toLowerCase()];
  return rank ?? null;
}

/**
 * Resolve a customer's purchased Monitoring tier (services.tier) via the
 * real join chain: tenants.id -> ALL users carrying that tenantId ->
 * users.id -> client_services.clientUserId -> client_services.serviceId ->
 * services.id. Deliberately NOT the MSP sales-bundle / monitoring_packages
 * path — that path can't distinguish an Enhanced customer from a Premium one,
 * since both share the same monitoring_packages.key.
 *
 * CUSTOMER-scoped: the purchased tier is a property of the customer, so the
 * lookup spans every linked login (the old single-arbitrary-user resolution
 * missed the subscription entirely when it hung off a different sibling user).
 */
async function resolveCustomerMonitoringTier(customerId: number): Promise<string | null> {
  const customerUserIds = await resolveCustomerUserIds(customerId);
  if (customerUserIds.length === 0) return null;

  const [row] = await db
    .select({ tier: servicesTable.tier })
    .from(clientServicesTable)
    .innerJoin(servicesTable, eq(servicesTable.id, clientServicesTable.serviceId))
    .where(and(inArray(clientServicesTable.clientUserId, customerUserIds), eq(clientServicesTable.status, "active")))
    .orderBy(asc(clientServicesTable.id))
    .limit(1);

  return row?.tier ?? null;
}

type Availability = "included" | "billable_upsell" | "a_la_carte" | "license_required";

/**
 * The single source of truth for whether a write_action_catalog row is
 * usable by this MSP for this customer right now. Used by both the GET
 * listing (informational) and POST execute (the actual re-validation gate —
 * never trusts a client-supplied availability label).
 *
 * Git #3947 — `hasRequiredLicense` is the real, live-checked answer to
 * "does the customer's tenant actually hold one of this row's
 * required_license_skus" (see license-gate.ts). It is deliberately the LAST
 * gate, not the first: an MSP/customer that isn't even entitled to the
 * action yet (a_la_carte/billable_upsell) needs to clear that first — a
 * missing M365 license on top of a missing entitlement is still just "not
 * available," not a distinct state worth surfacing before entitlement is
 * even resolved.
 */
function computeAvailability(
  row: Pick<WriteActionCatalog, "safeOrGated" | "minBundledTier">,
  tier: Awaited<ReturnType<typeof loadTier>>,
  customerTierRank: number | null,
  hasRequiredLicense: boolean,
): Availability {
  // safeOrGated is null for the catalog's `blocked_no_workaround` rows (no
  // safe/gated classification exists for an action with no real write path).
  // Never fall through to the "safe" capability check for those — require
  // the stricter gated capability so an unclassified row can't be treated
  // as more permissive than a real gated action.
  if (row.safeOrGated === null) return "a_la_carte";
  const capabilityKey = row.safeOrGated === "gated" ? "launch_control_gated_write" : "launch_control_safe_write";
  if (!tierAllowsFeature(tier, capabilityKey)) return "a_la_carte";

  const requiredRank = resolveTierRank(row.minBundledTier);
  const entitled = requiredRank === null || (customerTierRank !== null && customerTierRank >= requiredRank);
  if (!entitled) return "billable_upsell";

  // Entitlement alone doesn't mean the Graph write can succeed — a tenant
  // genuinely missing the M365 license this action requires (e.g. Entra ID
  // P1/P2 for Conditional Access, #3937) fails the write regardless of
  // MSP-side plan/tier. Never trust a client-supplied license state either;
  // this is recomputed here from a live read the same as everything else in
  // this function.
  if (!hasRequiredLicense) return "license_required";
  return "included";
}

// ── GET /msp/:mspId/launch-control/actions ────────────────────────────────────

router.get(
  "/msp/:mspId/launch-control/actions",
  requireCapability("ladder.msp-operator"),
  requireMspScope("params"),
  async (req: Request, res: Response): Promise<void> => {
    const mspId = parseInt(p(req.params["mspId"]), 10);
    if (isNaN(mspId)) { res.status(400).json({ error: "mspId must be a number" }); return; }

    const customerId = parseInt(p(req.query["customerId"] as string | string[] | undefined), 10);
    if (isNaN(customerId)) { res.status(400).json({ error: "customerId query param is required" }); return; }

    try {
      if (!(await assertCustomerAccess(req.user!, customerId))) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "Access to this customer is not permitted");
        return;
      }

      const [tier, customerTier, catalog, templates, customerTenant] = await Promise.all([
        loadTier(mspId),
        resolveCustomerMonitoringTier(customerId),
        db.select().from(writeActionCatalogTable).orderBy(asc(writeActionCatalogTable.sortOrder)),
        db
          .select({
            templateId: baselineActionTemplatesTable.templateId,
            requiredVariables: baselineActionTemplatesTable.requiredVariables,
          })
          .from(baselineActionTemplatesTable),
        db
          .select({ tenantId: tenantsTable.tenantId })
          .from(tenantsTable)
          .where(and(eq(tenantsTable.id, customerId), eq(tenantsTable.mspId, mspId)))
          .limit(1)
          .then((rows) => rows[0]),
      ]);
      const customerTierRank = resolveTierRank(customerTier);
      // Keyed off write_action_catalog.template_id, not the catalog row's own
      // id — a catalog row only has non-empty requiredVariables once it's
      // wired to a real baseline_action_templates row.
      const requiredVariablesByTemplateId = new Map(templates.map((t) => [t.templateId, t.requiredVariables]));

      // Git #3947 — one live /subscribedSkus read per listing render (cached
      // ~60s per tenant in license-gate.ts), not one per catalog row — the
      // dispatch note's explicit "don't hammer Graph per action-picker
      // render." No connected tenant means no license can ever be confirmed
      // — fails closed (any row with a requirement shows license_required).
      const tenantSkus = customerTenant?.tenantId
        ? await getSubscribedSkuPartNumbersForTenant(customerTenant.tenantId)
        : { skuPartNumbers: new Set<string>(), error: "Selected customer has no connected tenant" };

      const actions = catalog.map((row) => {
        const requiredLicenseSkus = (row.requiredLicenseSkus ?? []) as string[];
        const hasRequiredLicense = tenantHasRequiredLicense(requiredLicenseSkus, tenantSkus.skuPartNumbers);
        return {
          ...row,
          availability: computeAvailability(row, tier, customerTierRank, hasRequiredLicense),
          licenseRequirement: requiredLicenseSkus.length > 0
            ? { skus: requiredLicenseSkus, satisfied: hasRequiredLicense, description: describeRequiredLicense(requiredLicenseSkus) }
            : null,
          requiredVariables: row.templateId ? (requiredVariablesByTemplateId.get(row.templateId) ?? []) : [],
        };
      });

      res.json({ actions, customerTier });
    } catch (err) {
      log.error({ err, mspId, customerId }, "GET /msp/:mspId/launch-control/actions failed");
      res.status(500).json({ error: "Failed to load launch control actions" });
    }
  },
);

// ── POST /msp/:mspId/launch-control/execute ───────────────────────────────────

router.post(
  "/msp/:mspId/launch-control/execute",
  requireCapability("ladder.msp-operator"),
  requireMspScope("params"),
  async (req: Request, res: Response): Promise<void> => {
    const mspId = parseInt(p(req.params["mspId"]), 10);
    if (isNaN(mspId)) { res.status(400).json({ error: "mspId must be a number" }); return; }

    const body = req.body as { catalogActionId?: number; customerId?: number; variables?: Record<string, string> };
    const catalogActionId = typeof body.catalogActionId === "number" ? body.catalogActionId : NaN;
    const customerId = typeof body.customerId === "number" ? body.customerId : NaN;
    if (isNaN(catalogActionId) || isNaN(customerId)) {
      res.status(400).json({ error: "catalogActionId and customerId are required" });
      return;
    }

    try {
      if (!(await assertCustomerAccess(req.user!, customerId))) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "Access to this customer is not permitted");
        return;
      }

      // Re-validate from scratch — never trust a client-supplied availability
      // label. The client sends the catalog row's own id (not templateId —
      // actionName is a human-readable string and templateId is a machine
      // key, they can never match); write_action_catalog.template_id is the
      // real, nullable link into baseline_action_templates once promoted.
      const [catalogRow] = await db
        .select()
        .from(writeActionCatalogTable)
        .where(eq(writeActionCatalogTable.id, catalogActionId))
        .limit(1);
      if (!catalogRow) {
        res.status(404).json({ error: "Action not found in the write action catalog" });
        return;
      }
      if (!catalogRow.templateId) {
        res.status(409).json({ error: "This action isn't wired to a real executable template yet" });
        return;
      }
      // Git #3936 — templateId alone is not enough: a row can be demoted back
      // off execution_ready (e.g. its linked template's endpoint turned out to
      // be a made-up pseudo-scheme with no real executor) while templateId
      // stays set on the row. Re-check the real gate the catalog itself uses
      // to mean "ready," not just presence of a link.
      if (catalogRow.status !== "execution_ready") {
        res.status(409).json({ error: "This action is not currently execution-ready", status: catalogRow.status });
        return;
      }
      const templateId = catalogRow.templateId;

      // Explicit column list (never a bare .select() — tenants carries the
      // consent jsonb). Scoped by mspId as well as id: assertCustomerAccess
      // above already fenced cross-MSP access, but this is the row whose
      // isTestbed flag authorizes a REAL Graph write against a live tenant, so
      // it is re-scoped to the caller's own MSP at the point of read rather
      // than trusting an earlier check.
      //
      // Git #3947 — moved ahead of the tier/availability check below (was
      // fetched after it) because computeAvailability now needs the real
      // tenantId to check the catalog row's required_license_skus live —
      // license availability can no longer be decided without it.
      const [customer] = await db
        .select({
          id: tenantsTable.id,
          tenantId: tenantsTable.tenantId,
          isTestbed: tenantsTable.isTestbed,
          name: tenantsTable.customerName,
          domain: tenantsTable.domain,
        })
        .from(tenantsTable)
        .where(and(eq(tenantsTable.id, customerId), eq(tenantsTable.mspId, mspId)))
        .limit(1);
      if (!customer?.tenantId) {
        res.status(400).json({ error: "Selected customer has no connected tenant" });
        return;
      }
      // TEMPORARY STAGING RESTRICTION: Launch Control only runs against a
      // testbed-flagged customer for now — this is a real Graph write, and
      // lifting this restriction for live customer tenants is a separate,
      // later task (out of scope here).
      //
      // tenants.is_testbed is NOT NULL DEFAULT false, so a tenant created by
      // any path that doesn't set it explicitly fails CLOSED here.
      if (!customer.isTestbed) {
        res.status(403).json({ error: "Launch Control is only available for a customer flagged isTestbed" });
        return;
      }

      const [tier, customerTier, tenantSkus] = await Promise.all([
        loadTier(mspId),
        resolveCustomerMonitoringTier(customerId),
        getSubscribedSkuPartNumbersForTenant(customer.tenantId),
      ]);
      const requiredLicenseSkus = (catalogRow.requiredLicenseSkus ?? []) as string[];
      const hasRequiredLicense = tenantHasRequiredLicense(requiredLicenseSkus, tenantSkus.skuPartNumbers);
      const availability = computeAvailability(catalogRow, tier, resolveTierRank(customerTier), hasRequiredLicense);
      if (availability === "license_required") {
        // Git #3947 — proactive gate: block BEFORE raising a real Change
        // Request or ever attempting the Graph write, unlike #3937's reactive
        // fallback below (kept as defense-in-depth for a row with no
        // required_license_skus set, or a license revoked mid-flight between
        // this check and the write actually firing).
        const description = describeRequiredLicense(requiredLicenseSkus);
        log.info(
          { mspId, catalogActionId, customerId, tenantId: customer.tenantId, requiredLicenseSkus, skuReadError: tenantSkus.error },
          "msp-launch-control: execute blocked by proactive license precheck",
        );
        res.status(409).json({
          error: `This action requires ${description} on this customer's tenant, which it does not currently have.`,
          errorType: "license_gap",
          licenseFeature: description,
        });
        return;
      }
      if (availability !== "included") {
        res.status(402).json({ error: "This action is not included in your current plan for this customer", availability });
        return;
      }

      const [template] = await db
        .select()
        .from(baselineActionTemplatesTable)
        .where(eq(baselineActionTemplatesTable.templateId, templateId))
        .limit(1);
      if (!template) {
        res.status(404).json({ error: "This action is in the catalog but has no runnable template yet" });
        return;
      }

      // #3541 — Change Control as the AUTHORIZATION GATE (#1497's own principle)
      // applies here too: raise the real, pre-approved CR BEFORE the Graph write
      // fires, so there is always a real `msp_change_requests` row behind this
      // execution rather than one assumed-but-never-created (the exact gap
      // #3541 found — `human-action` 404ing with no CR to attest against).
      const payload: Record<string, unknown> = { ...(body.variables ?? {}), customerId };
      const changeRequest = await raiseChangeRequestForLaunchControlExecution({
        mspId,
        tenantId: customer.tenantId,
        tenantName: customer.name,
        primaryDomain: customer.domain ?? "",
        catalogRow: {
          domain: catalogRow.domain,
          actionName: catalogRow.actionName,
          surface: catalogRow.surface,
          safeOrGated: catalogRow.safeOrGated,
        },
        templateId,
        proposedPayload: payload,
        requestedBy: req.user?.email ?? "unknown@mspplatform.com",
        reverseTemplateId: template.reversible ? template.reverseTemplateId : null,
      });

      const { runBaselineTemplateAgainstTenant } = await import("../lib/workflow-executor.ts");
      const result = await runBaselineTemplateAgainstTenant(
        templateId,
        customer.tenantId,
        customerId,
        payload,
        "launch_control",
      );

      // Git #3937 — real, live-confirmed evidence: CA actions that require Entra ID
      // P1/P2 (create-ca-signin-risk-policy, create-ca-user-risk-policy, and any
      // other license-gated write) were surfacing as an undifferentiated raw Graph
      // 403 with no indication the tenant simply isn't licensed for the feature.
      // graphWriteForTenant now classifies this distinctly as errorType
      // "license_gap" (see graph.ts); surface a clear, customer-safe message here
      // instead of falling through to the generic 200-with-success:false response
      // below, which would otherwise still leave a raw Graph error body as the
      // only signal to a technician.
      if (!result.success && result.errorType === "license_gap") {
        try {
          await recordLaunchControlExecutionOutcome({
            changeRequestId: changeRequest.id,
            mspId,
            tenantId: customer.tenantId,
            success: false,
          });
        } catch (err) {
          log.error({ err, mspId, changeRequestId: changeRequest.id }, "msp-launch-control: execution record failed (non-fatal)");
        }
        log.info(
          { mspId, templateId, customerId, tenantId: customer.tenantId, licenseFeature: result.licenseFeature, changeRequestId: changeRequest.id },
          "msp-launch-control: execute blocked by tenant license gap",
        );
        res.status(409).json({
          error: `This action requires ${result.licenseFeature ?? "a Microsoft 365 add-on license"} on this customer's tenant, which it does not currently have.`,
          errorType: "license_gap",
          licenseFeature: result.licenseFeature ?? null,
          changeRequest: { id: changeRequest.id, code: changeRequest.code },
        });
        return;
      }

      // #3541 — record the execution as a `write_action` (a code path — this
      // very call — confirms it) and close the CR out immediately; see
      // launch-control-change-request.ts's header for why this is NOT a
      // `human_action` and needs no separate Console attestation call.
      try {
        await recordLaunchControlExecutionOutcome({
          changeRequestId: changeRequest.id,
          mspId,
          tenantId: customer.tenantId,
          success: result.success,
        });
      } catch (err) {
        log.error({ err, mspId, changeRequestId: changeRequest.id }, "msp-launch-control: execution record failed (non-fatal)");
      }

      log.info(
        { mspId, templateId, customerId, tenantId: customer.tenantId, success: result.success, userId: req.user?.id, changeRequestId: changeRequest.id },
        "msp-launch-control: execute completed",
      );
      res.json({
        result: { ...result, reversible: result.success && template.reversible },
        tenant: { customerId: customer.id, name: customer.name },
        changeRequest: { id: changeRequest.id, code: changeRequest.code },
      });
    } catch (err) {
      log.error({ err, mspId, catalogActionId, customerId }, "POST /msp/:mspId/launch-control/execute failed");
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to execute action" });
    }
  },
);

// ── POST /msp/:mspId/launch-control/rollback/:auditLogId ─────────────────────

router.post(
  "/msp/:mspId/launch-control/rollback/:auditLogId",
  requireCapability("ladder.msp-operator"),
  requireMspScope("params"),
  async (req: Request, res: Response): Promise<void> => {
    const mspId = parseInt(p(req.params["mspId"]), 10);
    const auditLogId = parseInt(p(req.params["auditLogId"]), 10);
    if (isNaN(mspId) || isNaN(auditLogId)) {
      res.status(400).json({ error: "mspId and auditLogId must be numbers" });
      return;
    }

    try {
      const [auditRow] = await db
        .select()
        .from(baselineActionTemplateAuditLogTable)
        .where(eq(baselineActionTemplateAuditLogTable.id, auditLogId))
        .limit(1);
      if (!auditRow) {
        res.status(404).json({ error: "Audit log entry not found" });
        return;
      }
      const afterSnapshot = (auditRow.afterSnapshot ?? {}) as Record<string, unknown>;
      const customerId = afterSnapshot["customerId"];
      if (typeof customerId !== "number") {
        res.status(400).json({ error: "Audit log entry has no recoverable customer context" });
        return;
      }
      if (!(await assertCustomerAccess(req.user!, customerId))) {
        apiError(res, 403, ApiErrorCode.FORBIDDEN, "Access to this customer is not permitted");
        return;
      }

      const { rollbackExecution } = await import("../lib/workflow-executor.ts");
      const result = await rollbackExecution(auditLogId);

      log.info(
        { mspId, auditLogId, customerId, success: result.success, userId: req.user?.id },
        "msp-launch-control: rollback completed",
      );
      res.json({ result });
    } catch (err) {
      log.error({ err, mspId, auditLogId }, "POST /msp/:mspId/launch-control/rollback/:auditLogId failed");
      res.status(400).json({ error: err instanceof Error ? err.message : "Failed to roll back action" });
    }
  },
);

export default router;
