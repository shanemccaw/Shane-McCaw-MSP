// EngageBay webhook receiver (EngageBay Webhooks + Workflow Nodes, #105).
//
//   POST /api/engagebay/webhook[?token=...&event_type=...]
//
// Dedicated inbound endpoint — EngageBay is never pointed at the generic
// unauthenticated /api/webhooks/workflow/{token} endpoint. Every request must
// present ENGAGEBAY_WEBHOOK_SECRET (query `token`, `X-EngageBay-Webhook-Token`
// header, or body `token`), compared in constant time. The resolved event
// type (e.g. "contact.created") is matched against enabled wf_triggers rows
// of type "webhook" whose config.engagebayEventType equals it, and each match
// fires through the same fireWorkflowForDefinition() the generic webhook
// triggers use — no duplicated dispatch logic. Mirrors routes/zoho-webhook.ts.

import { Router, type IRouter, type Request, type Response } from "express";
import { db, wfTriggersTable, wfTriggerEventsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { fireWorkflowForDefinition } from "../lib/workflow-executor";
import { verifyEngageBayWebhookToken, resolveEngageBayEventType } from "../lib/engagebay-webhook.ts";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "integration.engagebay" });

const router: IRouter = Router();

router.post("/engagebay/webhook", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const provided =
    (typeof req.query.token === "string" ? req.query.token : undefined) ??
    (typeof req.headers["x-engagebay-webhook-token"] === "string" ? (req.headers["x-engagebay-webhook-token"] as string) : undefined) ??
    (typeof body.token === "string" ? (body.token as string) : undefined);

  if (!verifyEngageBayWebhookToken(provided, process.env.ENGAGEBAY_WEBHOOK_SECRET)) {
    log.warn({ hasToken: Boolean(provided) }, "engagebay-webhook: rejected — invalid or missing token");
    res.status(401).json({ error: "Invalid webhook token" });
    return;
  }

  const eventType = resolveEngageBayEventType(body, req.query as Record<string, unknown>);
  if (!eventType) {
    log.warn("engagebay-webhook: could not resolve event type from payload");
    res.status(400).json({ error: "Could not resolve EngageBay event type (event or event_type)" });
    return;
  }

  try {
    const triggers = await db
      .select()
      .from(wfTriggersTable)
      .where(
        and(
          eq(wfTriggersTable.type, "webhook"),
          eq(wfTriggersTable.enabled, true),
          sql`${wfTriggersTable.config} ->> 'engagebayEventType' = ${eventType}`,
        ),
      );

    let fired = 0;
    for (const trigger of triggers) {
      const t0 = Date.now();
      const runId = await fireWorkflowForDefinition(
        trigger.definitionId,
        "webhook",
        `engagebay-webhook:${trigger.id}`,
        { ...body, engagebayEventType: eventType },
      );
      if (runId) fired++;

      await db
        .insert(wfTriggerEventsTable)
        .values({
          triggerId: trigger.id,
          runId: runId ?? undefined,
          status: runId ? "fired" : "skipped",
          payload: { ...body, engagebayEventType: eventType },
          durationMs: Date.now() - t0,
        })
        .catch((err: unknown) => {
          log.warn({ err, triggerId: trigger.id }, "engagebay-webhook: failed to record trigger event (non-fatal)");
        });
    }

    log.info({ eventType, matched: triggers.length, fired }, "engagebay-webhook: processed inbound event");
    res.status(202).json({ eventType, matched: triggers.length, fired });
  } catch (err) {
    log.error({ err, eventType }, "engagebay-webhook: dispatch failed");
    res.status(500).json({ error: "EngageBay webhook dispatch failed" });
  }
});

export default router;
