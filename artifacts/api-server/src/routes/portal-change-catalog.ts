/**
 * portal-change-catalog.ts — the CUSTOMER-facing half of the Standard Change
 * Catalog (#1498): "approve once, execute many."
 *
 *   GET  /api/portal/change-catalog          — this tenant's available standard changes
 *   POST /api/portal/change-catalog/:id/execute — raise one as an auto-approved CR
 *
 * ── What "execute" means here, and what it deliberately does not do ─────────
 * A catalog item is a governed, pre-approved TEMPLATE. Calling `execute` raises
 * a real `msp_change_requests` row — `changeClass: 'standard'`, carrying the
 * catalog item's real approver on `approvedBy` so the approval ledger
 * (`materializeApprovalsForChange`) records that same real human, never "the
 * system" — and skips the human approval stages an ordinary CR would need
 * (`requiredStages()` is 0 for `standard`). It does NOT itself write anything to
 * the customer's M365 tenant: making the CR the actual write gate (#1497) and
 * recording the execution (#1499) are separate, already-DECIDED pieces of work
 * this build does not own. What ships here is the governance half — a real,
 * auditable, auto-approved change request — which is exactly what #1498 scopes.
 *
 * ── Scoping and gating ────────────────────────────────────────────────────────
 * Same customer-scope resolution and the same `change_control` add-on
 * entitlement as the rest of Change Control (see `portal-change-control.ts`'s
 * header for why the (mspId, tenantId) pair is required and why a blank tenant
 * identifier fails closed to an empty list rather than a query).
 *
 * ── Revocation is checked live, every call (#1555) ───────────────────────────
 * `execute` re-reads the catalog item's `status` from the database on every
 * invocation. A revoked or still-draft item 409s — there is no cached or
 * JWT-carried "this is pre-approved" flag anywhere on the request path.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, changeCatalogItemsTable, configPacksTable, mspChangeRequestsTable, type InsertMspChangeRequest } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";

import { requireRole } from "../middlewares/requireAuth";
import { resolveCustomerId, resolveTenantScope } from "../lib/portal-customer-scope";
import { requireAddOnEntitlement } from "../lib/portal-addon-entitlements";
import { materializeApprovalsForChange } from "../lib/portal-change-approvals-store";
import { formatChangeRequestCode } from "../lib/portal-change-control";
import { CHANGE_CONTROL_FEATURE_KEY } from "./portal-change-control";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

interface WireCatalogItem {
  readonly id: number;
  readonly title: string;
  readonly description: string;
  readonly category: string;
  readonly riskLevel: string;
  /** The signed decision this item's pre-approval rests on — never "the system". */
  readonly approvedByName: string | null;
  readonly approvedAt: string | null;
}

// ── List ──────────────────────────────────────────────────────────────────────
router.get(
  "/portal/change-catalog",
  requireRole("CustomerUser"),
  requireAddOnEntitlement(CHANGE_CONTROL_FEATURE_KEY),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const scope = await resolveTenantScope(customerId);
      if (!scope) {
        // Fail closed, same as GET /portal/change-control — an unresolvable
        // tenant genuinely has nothing it could safely be shown here.
        log.info({ customerId }, "change-catalog: no resolvable tenant scope, serving empty list");
        res.json({ items: [], scoped: false });
        return;
      }

      // Only currently-APPROVED items are visible — a draft or revoked item is
      // not a thing a customer could execute, so it is not a thing they can see.
      const rows = await db
        .select()
        .from(changeCatalogItemsTable)
        .where(and(eq(changeCatalogItemsTable.mspId, scope.mspId), eq(changeCatalogItemsTable.status, "approved")))
        .orderBy(desc(changeCatalogItemsTable.id));

      const items: WireCatalogItem[] = rows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        category: r.category,
        riskLevel: r.riskLevel,
        approvedByName: r.approvedByName,
        approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
      }));
      res.json({ items, scoped: true });
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/change-catalog failed");
      res.status(500).json({ error: "Failed to load the standard change catalog" });
    }
  },
);

// ── Execute — raise a pre-approved standard CR ───────────────────────────────
router.post(
  "/portal/change-catalog/:id/execute",
  requireRole("CustomerUser"),
  requireAddOnEntitlement(CHANGE_CONTROL_FEATURE_KEY),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }
    const itemId = Number(req.params.id);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      res.status(400).json({ error: "Invalid catalog item id" });
      return;
    }

    try {
      const scope = await resolveTenantScope(customerId);
      if (!scope) {
        res.status(409).json({ error: "This account has no connected Microsoft 365 tenant" });
        return;
      }

      // Scoped to the caller's OWN msp — a customer of MSP A can never execute
      // MSP B's catalog item, even by guessing an id.
      const [item] = await db
        .select()
        .from(changeCatalogItemsTable)
        .where(and(eq(changeCatalogItemsTable.id, itemId), eq(changeCatalogItemsTable.mspId, scope.mspId)))
        .limit(1);
      if (!item) {
        res.status(404).json({ error: "Standard change not found" });
        return;
      }
      // Live check, not cached — the whole point of #1555's revocation model.
      if (item.status !== "approved") {
        res.status(409).json({ error: "This standard change is not currently approved" });
        return;
      }

      // Defence in depth: the pack may have been archived after this item was
      // approved without anyone revoking the item itself. Fail closed either way.
      const [pack] = await db
        .select({ status: configPacksTable.status })
        .from(configPacksTable)
        .where(eq(configPacksTable.packKey, item.packKey))
        .limit(1);
      if (!pack || pack.status !== "active") {
        res.status(409).json({ error: "The runbook behind this standard change is no longer active" });
        return;
      }

      const requestedBy = req.user?.email ?? "unknown";
      const requestedAt = new Date().toISOString();

      const [inserted] = await db
        .insert(mspChangeRequestsTable)
        .values({
          mspId: scope.mspId,
          tenantId: scope.tenantId,
          tenantName: scope.tenantName,
          primaryDomain: scope.primaryDomain,
          title: item.title,
          description: `Raised from the standard change catalog: ${item.title}. Pre-approved — no CAB required.`,
          changeClass: "standard",
          riskLevel: item.riskLevel as "critical" | "high" | "medium" | "low",
          category: item.category as InsertMspChangeRequest["category"],
          targetResource: `Config pack: ${item.packKey}`,
          psaTicketId: "No ticket reference",
          requestedBy,
          requestedAt,
          scheduledFor: "Immediate — standard, pre-approved change",
          impactedUsersCount: 0,
          status: "pending_approval",
          backupVerified: false,
          backupHash: "",
          preChangeSnapshot: {},
          proposedPayload: {},
          rollbackScriptSnippet: "",
          catalogItemId: item.id,
          // The catalog item's own real, signed approver — never "the system".
          // materializeApprovalsForChange's "already-approved at creation"
          // branch records this same name into the cr_approvals ledger as
          // approver_role = 'catalog_inherited'.
          approvedBy: item.approvedByName,
        })
        .returning({ id: mspChangeRequestsTable.id, createdAt: mspChangeRequestsTable.createdAt });

      try {
        await materializeApprovalsForChange({
          id: inserted.id,
          mspId: scope.mspId,
          tenantId: scope.tenantId,
          changeClass: "standard",
          riskLevel: item.riskLevel as "critical" | "high" | "medium" | "low",
          status: "pending_approval",
          approvedBy: item.approvedByName,
          requestedBy,
          createdAt: inserted.createdAt,
        });
      } catch (err) {
        log.error({ err, crId: inserted.id }, "catalog-raised change created but approval materialisation failed");
      }

      const code = formatChangeRequestCode(inserted.id);
      log.info(
        { customerId, mspId: scope.mspId, code, catalogItemId: item.id, packKey: item.packKey },
        "standard change raised from the customer portal's change catalog",
      );
      res.status(201).json({ code, catalogItemId: item.id, title: item.title });
    } catch (err) {
      log.error({ err, customerId, itemId }, "POST /portal/change-catalog/:id/execute failed");
      res.status(500).json({ error: "Failed to raise the standard change" });
    }
  },
);

export default router;
