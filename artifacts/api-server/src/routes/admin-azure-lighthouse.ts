/**
 * admin-azure-lighthouse.ts (#1915)
 *
 * Admin-only surface over the Azure Lighthouse onboarding PROMISE/RECORD layer
 * (tenant_azure_lighthouse_offers). Deliberately admin-only and NOT a portal
 * route: the customer-facing half of #1915 is out of scope for this build,
 * blocked on #2758 (contract pack) -> Design -> #1650 (portal onboarding
 * rebuild). This exists so the generation/record logic is real and testable on
 * its own before any UI consumes it — see azure-lighthouse-onboarding.ts.
 *
 * Nothing here writes to Azure. Every route either generates template content
 * the CUSTOMER would deploy themselves, or records/reads what was offered —
 * the same one-way boundary azure-rm.ts's header documents.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, tenantAzureLighthouseOffersTable, tenantAzureReachTable, tenantsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import {
  buildLighthouseArmTemplate,
  buildLighthouseDeepLink,
  resolveArmScopePath,
  type LighthouseScopeType,
} from "../lib/azure-lighthouse-onboarding";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "integration.azure" });

const router: IRouter = Router();

interface CreateOfferBody {
  subscriptionId?: string;
  scopeType?: LighthouseScopeType;
  resourceGroupName?: string;
  mspOfferDescription?: string;
  offeredByUserId?: number;
}

/**
 * POST /admin/tenants/:tenantId/azure-lighthouse-offers
 *
 * Generates a real Lighthouse ARM template for the requested scope and
 * persists (or re-offers, in place) the promise/record row. Returns the full
 * template content and authorizations so an admin-only caller (script, Test
 * Pad, a future UI) can inspect exactly what would be handed to the customer.
 */
router.post("/admin/tenants/:tenantId/azure-lighthouse-offers", requireAdmin, async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const { subscriptionId, scopeType, resourceGroupName, mspOfferDescription, offeredByUserId } =
    req.body as CreateOfferBody;

  if (!subscriptionId) {
    res.status(400).json({ error: "subscriptionId is required" });
    return;
  }
  const resolvedScopeType: LighthouseScopeType = scopeType === "resource_group" ? "resource_group" : "subscription";
  if (resolvedScopeType === "resource_group" && !resourceGroupName) {
    res.status(400).json({ error: "resourceGroupName is required when scopeType is 'resource_group'" });
    return;
  }

  const [tenant] = await db
    .select({ customerName: tenantsTable.customerName })
    .from(tenantsTable)
    .where(eq(tenantsTable.tenantId, tenantId))
    .limit(1);
  if (!tenant) {
    res.status(404).json({ error: `No tenant found with tenant_id ${tenantId}` });
    return;
  }

  const mspOfferName = `Shane McCaw Consulting — ${tenant.customerName}`;
  const mspOfferDescriptionResolved = mspOfferDescription ??
    "Read-only Azure configuration monitoring for security and compliance reporting.";

  let built: ReturnType<typeof buildLighthouseArmTemplate>;
  try {
    built = buildLighthouseArmTemplate({
      mspOfferName,
      mspOfferDescription: mspOfferDescriptionResolved,
      scope: { scopeType: resolvedScopeType, subscriptionId, resourceGroupName },
    });
  } catch (err) {
    // Config-missing is the one expected failure here (see azure-lighthouse-onboarding.ts) —
    // report it plainly rather than a generic 500, same as armPrincipalCredentials' pattern.
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ tenantId, err: message }, "admin-azure-lighthouse: template generation failed");
    res.status(503).json({ error: message });
    return;
  }

  // No public template-hosting route exists yet (see azure-lighthouse-onboarding.ts's
  // buildLighthouseDeepLink doc comment) — the deep link is real in SHAPE but not
  // yet fetchable by the Azure Portal. Recorded verbatim so the offer artifact is
  // honest about what was actually generated at offer time.
  const templateUri = `${req.protocol}://${req.get("host")}/admin/azure-lighthouse-offers/template-not-yet-publicly-hosted`;
  const deepLinkUrl = buildLighthouseDeepLink(templateUri);

  const offeredArtifact = {
    mspOfferName,
    mspOfferDescription: mspOfferDescriptionResolved,
    authorizations: built.authorizations,
    deepLinkUrl,
  };

  const [row] = await db
    .insert(tenantAzureLighthouseOffersTable)
    .values({
      tenantId,
      scopeType: resolvedScopeType,
      subscriptionId,
      resourceGroupName: resolvedScopeType === "resource_group" ? resourceGroupName ?? null : null,
      armScopePath: built.armScopePath,
      roleDefinitionId: built.roleDefinitionId,
      roleName: built.roleName,
      state: "offered",
      offeredArtifact,
      offeredByUserId: offeredByUserId ?? null,
      offeredAt: new Date(),
      completedAt: null,
      revokedAt: null,
    })
    .onConflictDoUpdate({
      target: [tenantAzureLighthouseOffersTable.tenantId, tenantAzureLighthouseOffersTable.armScopePath],
      set: {
        roleDefinitionId: built.roleDefinitionId,
        roleName: built.roleName,
        state: "offered",
        offeredArtifact,
        offeredByUserId: offeredByUserId ?? null,
        offeredAt: new Date(),
        // Re-offering an existing scope resets completion/revocation — the new
        // offer supersedes whatever was previously observed against the old one.
        completedAt: null,
        revokedAt: null,
        updatedAt: new Date(),
      },
    })
    .returning();

  log.info({ tenantId, armScopePath: built.armScopePath, offerId: row.id }, "admin-azure-lighthouse: offer recorded");
  res.status(201).json({ offer: row, template: built.template });
});

/**
 * GET /admin/tenants/:tenantId/azure-lighthouse-offers
 *
 * Lists every offer ever recorded for this tenant, newest first. An EMPTY
 * array is the real, honest "never offered" state (#1915's own requirement) —
 * this route never invents a placeholder row for a tenant that was never
 * onboarded.
 */
router.get("/admin/tenants/:tenantId/azure-lighthouse-offers", requireAdmin, async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const rows = await db
    .select()
    .from(tenantAzureLighthouseOffersTable)
    .where(eq(tenantAzureLighthouseOffersTable.tenantId, tenantId))
    .orderBy(desc(tenantAzureLighthouseOffersTable.offeredAt));

  res.json({ tenantId, offers: rows, everOffered: rows.length > 0 });
});

/**
 * POST /admin/tenants/:tenantId/azure-lighthouse-offers/:id/reconcile
 *
 * Compares this offer's recorded scope against the tenant's LAST OBSERVED
 * `tenant_azure_reach` row (subscriptions[].managedByTenantIds — the same
 * field the reach probe already populates verbatim from ARM) and flips
 * offered -> completed, or completed -> revoked, based on what is actually
 * observed. This is the mechanism that makes a revoked delegation
 * distinguishable from one never made: the reach probe alone cannot do it
 * (it has no memory of what was ever promised), and this table alone cannot
 * do it (it has no live observation) — this route is where the two meet.
 *
 * Never fabricates an observation: if there is no tenant_azure_reach row yet,
 * or the offer's subscription isn't present in the last probe, the offer's
 * state is left exactly as it was and that fact is returned, not silently
 * assumed either way.
 */
router.post("/admin/tenants/:tenantId/azure-lighthouse-offers/:id/reconcile", requireAdmin, async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const offerId = Number(req.params.id);
  if (isNaN(offerId)) {
    res.status(400).json({ error: "Invalid offer id" });
    return;
  }

  const [offer] = await db
    .select()
    .from(tenantAzureLighthouseOffersTable)
    .where(and(eq(tenantAzureLighthouseOffersTable.id, offerId), eq(tenantAzureLighthouseOffersTable.tenantId, tenantId)))
    .limit(1);
  if (!offer) {
    res.status(404).json({ error: "Offer not found for this tenant" });
    return;
  }

  const [reach] = await db
    .select()
    .from(tenantAzureReachTable)
    .where(eq(tenantAzureReachTable.tenantId, tenantId))
    .limit(1);

  if (!reach) {
    res.json({ offer, reconciled: false, reason: "no tenant_azure_reach row yet — tenant has never been probed" });
    return;
  }

  const sub = reach.subscriptions.find((s) => s.subscriptionId === offer.subscriptionId);
  const isDelegated = sub != null && sub.managedByTenantIds.length > 0;

  let nextState = offer.state;
  let completedAt = offer.completedAt;
  let revokedAt = offer.revokedAt;
  let reconciled = false;

  if (isDelegated && offer.state !== "completed") {
    nextState = "completed";
    completedAt = new Date();
    reconciled = true;
  } else if (!isDelegated && offer.state === "completed") {
    nextState = "revoked";
    revokedAt = new Date();
    reconciled = true;
  }

  if (!reconciled) {
    res.json({ offer, reconciled: false, reason: "last observation matches current recorded state" });
    return;
  }

  const [updated] = await db
    .update(tenantAzureLighthouseOffersTable)
    .set({
      state: nextState,
      completedAt,
      revokedAt,
      notes: `Reconciled against tenant_azure_reach probed_at=${reach.probedAt.toISOString()}`,
      updatedAt: new Date(),
    })
    .where(eq(tenantAzureLighthouseOffersTable.id, offerId))
    .returning();

  log.info({ tenantId, offerId, from: offer.state, to: nextState }, "admin-azure-lighthouse: offer reconciled against reach probe");
  res.json({ offer: updated, reconciled: true });
});

/**
 * PATCH /admin/tenants/:tenantId/azure-lighthouse-offers/:id
 *
 * Manual state correction for when an admin knows something the reach probe
 * hasn't observed yet (e.g. the customer told Shane directly they revoked it).
 */
router.patch("/admin/tenants/:tenantId/azure-lighthouse-offers/:id", requireAdmin, async (req: Request, res: Response) => {
  const tenantId = String(req.params.tenantId);
  const offerId = Number(req.params.id);
  if (isNaN(offerId)) {
    res.status(400).json({ error: "Invalid offer id" });
    return;
  }
  const { state, notes } = req.body as { state?: "offered" | "completed" | "revoked"; notes?: string };
  if (state && !["offered", "completed", "revoked"].includes(state)) {
    res.status(400).json({ error: "state must be one of offered, completed, revoked" });
    return;
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (state) {
    updates.state = state;
    if (state === "completed") updates.completedAt = new Date();
    if (state === "revoked") updates.revokedAt = new Date();
  }
  if (notes !== undefined) updates.notes = notes;

  const [row] = await db
    .update(tenantAzureLighthouseOffersTable)
    .set(updates)
    .where(and(eq(tenantAzureLighthouseOffersTable.id, offerId), eq(tenantAzureLighthouseOffersTable.tenantId, tenantId)))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Offer not found for this tenant" });
    return;
  }
  res.json(row);
});

export default router;
