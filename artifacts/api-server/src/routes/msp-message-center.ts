/**
 * msp-message-center.ts
 *
 * MSP-facing view of Microsoft 365 Message Center posts collected by
 * message-center-sync.ts (msp_message_center_items). Read-only — the sync
 * job (daily, see index.ts) is the only writer.
 *
 * Routes (MSPOperator+, mspId from JWT claim via resolveMspIdStrict):
 *   GET /api/msp/message-center — recent items across the caller's MSP,
 *     newest lastModifiedDateTime first, filterable by category/customerId.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, mspMessageCenterItemsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireRole } from "../middlewares/requireAuth";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "integration.azure" });

const router: IRouter = Router();

router.get("/msp/message-center", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  try {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) {
      res.status(403).json({ error: "MSP context required" });
      return;
    }

    const categoryFilter = req.query["category"] ? String(req.query["category"]) : undefined;
    const customerIdParam = req.query["customerId"] ? Number(req.query["customerId"]) : undefined;
    const customerIdFilter = typeof customerIdParam === "number" && !isNaN(customerIdParam) ? customerIdParam : undefined;
    const limit = Math.min(Number(req.query["limit"] ?? 50), 200);
    const offset = Math.max(Number(req.query["offset"] ?? 0), 0);

    const conditions = [eq(mspMessageCenterItemsTable.mspId, mspId)];
    if (categoryFilter) conditions.push(eq(mspMessageCenterItemsTable.category, categoryFilter));
    if (customerIdFilter !== undefined) conditions.push(eq(mspMessageCenterItemsTable.customerId, customerIdFilter));

    const items = await db
      .select()
      .from(mspMessageCenterItemsTable)
      .where(and(...conditions))
      .orderBy(desc(mspMessageCenterItemsTable.lastModifiedDateTime))
      .limit(limit)
      .offset(offset);

    res.json({ items, limit, offset });
  } catch (err) {
    log.error({ err }, "msp-message-center: GET /msp/message-center failed");
    res.status(500).json({ error: "Failed to fetch Message Center items" });
  }
});

export default router;
