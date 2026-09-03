/**
 * MSP Console — Outbound Webhooks Operator Backend (#2704, part of #1693)
 *
 * The operator half of #1597 (Webhooks). Per #1693's own body: "Customer configures
 * their own webhook endpoints. The MSP can see, manage and disable them." — an MSP
 * supporting a customer needs to see what that customer has wired up and be able to
 * turn it off; a webhook firing into a dead endpoint or leaking to a decommissioned
 * system during an incident is the MSP's problem to stop.
 *
 * Scope, per #1693's own body and #2704's own gap description — deliberately NOT the
 * full CRUD `webhooks.ts` already gives the owner:
 *   - See every endpoint a customer has registered, and its current state
 *   - Disable an endpoint without deleting it — reversible, not destructive
 *   - Read the delivery log and failure history
 *   - See which events each endpoint subscribes to, against the one real event catalog
 *
 * #1693 also asks "can the operator create or edit an endpoint on the customer's
 * behalf?" and answers its own question: "Disable is clearly right; create is less
 * obviously so." Not decided — so create/edit/delete/rotate stay owner-only
 * (`/api/portal/webhooks/*`); this module never writes label/url/eventTypes/secret.
 *
 * Ownership model: every route here takes a `:customerId` and is gated by
 * `requireRole("MSPOperator")` + `assertCustomerAccess(req.user, customerId)` — same
 * pattern as `msp-data-rights.ts`'s customer-scoped routes. This is deliberately
 * different from `webhooks.ts`'s own `resolveOwner()`, which scopes to the CALLER's
 * own mspId/customerId (an MSP operator managing their own MSP-level webhooks); here
 * the operator is reaching into a specific CUSTOMER's book, which needs the
 * MSP-owns-this-tenant check, not caller-owns-this-webhook.
 *
 * Frontend: none yet — `artifacts/msp-console` does not exist (#1693 is blocked on
 * #1680, which scaffolds it). This issue is backend-only, same order-of-work as every
 * other #1485/#1571 module: architect -> build the endpoints -> contract pack ->
 * Design -> wire. These routes are real and callable today; nothing renders them yet.
 *
 * Event catalog (#1607, still open): this module does not invent a second event
 * vocabulary. It re-exports the same real, currently-dispatchable list
 * (`SUBSCRIBABLE_EVENT_TYPES`, `webhooks.ts`) the portal's own
 * `/api/portal/webhooks/event-types` already serves, and flags each webhook's
 * subscribed events that are NOT in that list — e.g. `signal.fired`, which is
 * subscribable today but has no dispatch call site anywhere (see
 * docs/webhooks-contract-pack.md §4(A)) — so an operator can see a subscription that
 * will never fire without cross-referencing the catalog by hand.
 *
 * Routes (MSPOperator+):
 *   GET  /api/msp/webhooks/event-types
 *   GET  /api/msp/customers/:customerId/webhooks
 *   GET  /api/msp/customers/:customerId/webhooks/:webhookId
 *   POST /api/msp/customers/:customerId/webhooks/:webhookId/disable
 *   POST /api/msp/customers/:customerId/webhooks/:webhookId/enable
 *   GET  /api/msp/customers/:customerId/webhooks/:webhookId/deliveries?limit=N
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, outboundWebhooksTable, usersTable } from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { requireRole, assertCustomerAccess } from "../middlewares/requireAuth.ts";
import { getDeliveryLog } from "../lib/webhook-delivery.ts";
import { SUBSCRIBABLE_EVENT_TYPES } from "./webhooks.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "comms.webhook" });

const router: IRouter = Router();

const CATALOG = new Set<string>(SUBSCRIBABLE_EVENT_TYPES);

/** Subset of a webhook's own eventTypes that aren't in the real dispatchable catalog. */
function unrecognizedEventTypes(eventTypes: string[]): string[] {
  return eventTypes.filter((e) => !CATALOG.has(e));
}

const WEBHOOK_ROW_COLUMNS = {
  webhookId: outboundWebhooksTable.webhookId,
  label: outboundWebhooksTable.label,
  url: outboundWebhooksTable.url,
  secretPrefix: outboundWebhooksTable.secretPrefix,
  eventTypes: outboundWebhooksTable.eventTypes,
  isActive: outboundWebhooksTable.isActive,
  ownerType: outboundWebhooksTable.ownerType,
  mspId: outboundWebhooksTable.mspId,
  customerId: outboundWebhooksTable.customerId,
  disabledByMspUserId: outboundWebhooksTable.disabledByMspUserId,
  disabledAt: outboundWebhooksTable.disabledAt,
  disabledReason: outboundWebhooksTable.disabledReason,
  createdAt: outboundWebhooksTable.createdAt,
  updatedAt: outboundWebhooksTable.updatedAt,
} as const;

interface WebhookRow {
  webhookId: string;
  label: string;
  url: string;
  secretPrefix: string;
  eventTypes: string[];
  isActive: boolean;
  ownerType: "msp" | "customer" | "platform";
  mspId: number | null;
  customerId: number | null;
  disabledByMspUserId: number | null;
  disabledAt: Date | null;
  disabledReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Batch-resolves disabledByMspUserId -> a display name, and attaches unrecognizedEventTypes. */
async function shapeRows(rows: WebhookRow[]) {
  const userIds = Array.from(
    new Set(rows.map((r) => r.disabledByMspUserId).filter((id): id is number => id != null)),
  );
  const nameById = new Map<number, string>();
  if (userIds.length > 0) {
    const users = await db
      .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
      .from(usersTable)
      .where(inArray(usersTable.id, userIds));
    for (const u of users) nameById.set(u.id, u.name && u.name.trim().length > 0 ? u.name : u.email);
  }

  return rows.map((row) => ({
    ...row,
    unrecognizedEventTypes: unrecognizedEventTypes(row.eventTypes),
    disabledByName: row.disabledByMspUserId != null ? (nameById.get(row.disabledByMspUserId) ?? null) : null,
  }));
}

function parseCustomerId(req: Request): number | null {
  const customerId = Number(req.params["customerId"]);
  return Number.isInteger(customerId) ? customerId : null;
}

// ── GET /api/msp/webhooks/event-types ─────────────────────────────────────────
// The one real, currently-dispatchable catalog (#1607) — not customer-scoped.
// Same list `/api/portal/webhooks/event-types` serves; exposed here too so the
// (future) MSP console doesn't need portal-scoped auth to read it.

router.get(
  "/msp/webhooks/event-types",
  requireRole("MSPOperator"),
  (_req: Request, res: Response) => {
    res.json({ eventTypes: SUBSCRIBABLE_EVENT_TYPES });
  },
);

// ── GET /api/msp/customers/:customerId/webhooks ───────────────────────────────

router.get(
  "/msp/customers/:customerId/webhooks",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const customerId = parseCustomerId(req);
      if (customerId === null) {
        res.status(400).json({ error: "Invalid customerId" });
        return;
      }

      const allowed = await assertCustomerAccess(req.user!, customerId);
      if (!allowed) {
        res.status(403).json({ error: "Not authorized for this customer" });
        return;
      }

      const rows = await db
        .select(WEBHOOK_ROW_COLUMNS)
        .from(outboundWebhooksTable)
        .where(eq(outboundWebhooksTable.customerId, customerId))
        .orderBy(desc(outboundWebhooksTable.createdAt));

      res.json({ webhooks: await shapeRows(rows) });
    } catch (err) {
      log.error({ err, customerId: req.params["customerId"] }, "msp-console-webhooks: failed to list customer webhooks");
      res.status(500).json({ error: "Unable to load this customer's webhooks right now. Please try again shortly." });
    }
  },
);

// ── GET /api/msp/customers/:customerId/webhooks/:webhookId ───────────────────

router.get(
  "/msp/customers/:customerId/webhooks/:webhookId",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const customerId = parseCustomerId(req);
      if (customerId === null) {
        res.status(400).json({ error: "Invalid customerId" });
        return;
      }

      const allowed = await assertCustomerAccess(req.user!, customerId);
      if (!allowed) {
        res.status(403).json({ error: "Not authorized for this customer" });
        return;
      }

      const webhookId = req.params["webhookId"] as string;
      const [row] = await db
        .select(WEBHOOK_ROW_COLUMNS)
        .from(outboundWebhooksTable)
        .where(and(eq(outboundWebhooksTable.webhookId, webhookId), eq(outboundWebhooksTable.customerId, customerId)))
        .limit(1);

      if (!row) {
        res.status(404).json({ error: "Webhook not found" });
        return;
      }

      const [shaped] = await shapeRows([row]);
      res.json({ webhook: shaped });
    } catch (err) {
      log.error({ err, webhookId: req.params["webhookId"] }, "msp-console-webhooks: failed to load webhook");
      res.status(500).json({ error: "Unable to load this webhook right now. Please try again shortly." });
    }
  },
);

// ── POST /api/msp/customers/:customerId/webhooks/:webhookId/disable ──────────
// Reversible — sets isActive=false and records who/when/why on the MSP side.
// Never touches label/url/eventTypes/secret; owner-only via /api/portal/webhooks/*.

router.post(
  "/msp/customers/:customerId/webhooks/:webhookId/disable",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const customerId = parseCustomerId(req);
      if (customerId === null) {
        res.status(400).json({ error: "Invalid customerId" });
        return;
      }

      const allowed = await assertCustomerAccess(req.user!, customerId);
      if (!allowed) {
        res.status(403).json({ error: "Not authorized for this customer" });
        return;
      }

      const webhookId = req.params["webhookId"] as string;
      const reason = typeof req.body?.reason === "string" && req.body.reason.trim().length > 0
        ? req.body.reason.trim().slice(0, 500)
        : null;

      const [existing] = await db
        .select({ webhookId: outboundWebhooksTable.webhookId })
        .from(outboundWebhooksTable)
        .where(and(eq(outboundWebhooksTable.webhookId, webhookId), eq(outboundWebhooksTable.customerId, customerId)))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Webhook not found" });
        return;
      }

      const [updated] = await db
        .update(outboundWebhooksTable)
        .set({
          isActive: false,
          disabledByMspUserId: req.user!.id,
          disabledAt: new Date(),
          disabledReason: reason,
          updatedAt: new Date(),
        })
        .where(eq(outboundWebhooksTable.webhookId, webhookId))
        .returning(WEBHOOK_ROW_COLUMNS);

      log.info({ webhookId, customerId, mspUserId: req.user!.id }, "msp-console-webhooks: disabled by MSP operator");

      const shaped = updated ? (await shapeRows([updated]))[0] : null;
      res.json({ webhook: shaped ?? null });
    } catch (err) {
      log.error({ err, webhookId: req.params["webhookId"] }, "msp-console-webhooks: failed to disable webhook");
      res.status(500).json({ error: "Unable to disable this webhook right now. Please try again shortly." });
    }
  },
);

// ── POST /api/msp/customers/:customerId/webhooks/:webhookId/enable ───────────
// The reversal — clears the disable-tracking columns along with re-activating.

router.post(
  "/msp/customers/:customerId/webhooks/:webhookId/enable",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const customerId = parseCustomerId(req);
      if (customerId === null) {
        res.status(400).json({ error: "Invalid customerId" });
        return;
      }

      const allowed = await assertCustomerAccess(req.user!, customerId);
      if (!allowed) {
        res.status(403).json({ error: "Not authorized for this customer" });
        return;
      }

      const webhookId = req.params["webhookId"] as string;

      const [existing] = await db
        .select({ webhookId: outboundWebhooksTable.webhookId })
        .from(outboundWebhooksTable)
        .where(and(eq(outboundWebhooksTable.webhookId, webhookId), eq(outboundWebhooksTable.customerId, customerId)))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Webhook not found" });
        return;
      }

      const [updated] = await db
        .update(outboundWebhooksTable)
        .set({
          isActive: true,
          disabledByMspUserId: null,
          disabledAt: null,
          disabledReason: null,
          updatedAt: new Date(),
        })
        .where(eq(outboundWebhooksTable.webhookId, webhookId))
        .returning(WEBHOOK_ROW_COLUMNS);

      log.info({ webhookId, customerId, mspUserId: req.user!.id }, "msp-console-webhooks: re-enabled by MSP operator");

      const shaped = updated ? (await shapeRows([updated]))[0] : null;
      res.json({ webhook: shaped ?? null });
    } catch (err) {
      log.error({ err, webhookId: req.params["webhookId"] }, "msp-console-webhooks: failed to enable webhook");
      res.status(500).json({ error: "Unable to enable this webhook right now. Please try again shortly." });
    }
  },
);

// ── GET /api/msp/customers/:customerId/webhooks/:webhookId/deliveries ────────

router.get(
  "/msp/customers/:customerId/webhooks/:webhookId/deliveries",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    try {
      const customerId = parseCustomerId(req);
      if (customerId === null) {
        res.status(400).json({ error: "Invalid customerId" });
        return;
      }

      const allowed = await assertCustomerAccess(req.user!, customerId);
      if (!allowed) {
        res.status(403).json({ error: "Not authorized for this customer" });
        return;
      }

      const webhookId = req.params["webhookId"] as string;
      const limit = Math.min(Number(req.query["limit"]) || 50, 200);

      const [existing] = await db
        .select({ webhookId: outboundWebhooksTable.webhookId })
        .from(outboundWebhooksTable)
        .where(and(eq(outboundWebhooksTable.webhookId, webhookId), eq(outboundWebhooksTable.customerId, customerId)))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Webhook not found" });
        return;
      }

      const deliveries = await getDeliveryLog(webhookId, limit);
      res.json({ deliveries });
    } catch (err) {
      log.error({ err, webhookId: req.params["webhookId"] }, "msp-console-webhooks: failed to load delivery log");
      res.status(500).json({ error: "Unable to load the delivery log right now. Please try again shortly." });
    }
  },
);

export default router;
