// EngageBay Activity Log route (EngageBay Admin Panel: Activity Log + Settings, #109).
//
//   GET /api/engagebay/activity — webhook-driven event history across every
//                                 wf_triggers row listening for an EngageBay
//                                 event, filterable by eventType + date range
//
// No prior integration (Zoho included) built a cross-trigger activity view —
// the existing GET /admin/workflows/definitions/:id/triggers/:tid/events
// (admin-workflows.ts) is scoped to one trigger under one definition and
// doesn't fit "every trigger listening for engagebayEventType". This mirrors
// that route's query shape (orderBy firedAt desc, limit clamped to 200)
// joined against wf_triggers so the EngageBay-only scope can be enforced and
// each event's engagebayEventType can be surfaced without callers re-deriving
// it from the raw payload.
//
// Realistic expectation, not a bug to chase: no EngageBay webhook has ever
// fired against this platform, so this will legitimately return an empty
// list until a real account is connected and sends something.

import { Router, type IRouter, type Request, type Response } from "express";
import { db, wfTriggersTable, wfTriggerEventsTable } from "@workspace/db";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "integration.engagebay" });

const router: IRouter = Router();

router.get("/engagebay/activity", requireAdmin, async (req: Request, res: Response) => {
  const limit = Math.min(parseInt((req.query.limit as string) || "50", 10), 200);
  const eventType = typeof req.query.eventType === "string" ? req.query.eventType : undefined;
  const from = typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
  const to = typeof req.query.to === "string" ? new Date(req.query.to) : undefined;

  if ((from && isNaN(from.getTime())) || (to && isNaN(to.getTime()))) {
    res.status(400).json({ error: "Invalid from/to date" });
    return;
  }

  try {
    const conditions = [
      eq(wfTriggersTable.type, "webhook"),
      sql`${wfTriggersTable.config} ->> 'engagebayEventType' IS NOT NULL`,
    ];
    if (eventType) conditions.push(sql`${wfTriggersTable.config} ->> 'engagebayEventType' = ${eventType}`);
    if (from) conditions.push(gte(wfTriggerEventsTable.firedAt, from));
    if (to) conditions.push(lte(wfTriggerEventsTable.firedAt, to));

    const events = await db
      .select({
        id: wfTriggerEventsTable.id,
        triggerId: wfTriggerEventsTable.triggerId,
        runId: wfTriggerEventsTable.runId,
        firedAt: wfTriggerEventsTable.firedAt,
        status: wfTriggerEventsTable.status,
        durationMs: wfTriggerEventsTable.durationMs,
        payload: wfTriggerEventsTable.payload,
        errorMessage: wfTriggerEventsTable.errorMessage,
        eventType: sql<string>`${wfTriggersTable.config} ->> 'engagebayEventType'`,
        definitionId: wfTriggersTable.definitionId,
      })
      .from(wfTriggerEventsTable)
      .innerJoin(wfTriggersTable, eq(wfTriggerEventsTable.triggerId, wfTriggersTable.id))
      .where(and(...conditions))
      .orderBy(desc(wfTriggerEventsTable.firedAt))
      .limit(limit);

    res.json({ events });
  } catch (err) {
    log.error({ err }, "engagebay-activity route: failed to fetch activity");
    res.status(500).json({ error: "Failed to fetch EngageBay activity" });
  }
});

export default router;
