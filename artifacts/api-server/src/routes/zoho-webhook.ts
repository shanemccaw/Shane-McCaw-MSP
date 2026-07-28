// Zoho webhook receiver (Zoho Integration Foundation, #82).
//
//   POST /api/zoho/webhook[?token=...&event_type=...]
//
// Dedicated inbound endpoint — Zoho is never pointed at the generic
// unauthenticated /api/webhooks/workflow/{token} endpoint. Every request must
// present ZOHO_WEBHOOK_SECRET (query `token`, `X-Zoho-Webhook-Token` header,
// or body `token`), compared in constant time. The resolved event type
// (module.operation, e.g. "Leads.create") is matched against enabled
// wf_triggers rows of type "webhook" whose config.zohoEventType equals it,
// and each match fires through the same fireWorkflowForDefinition() the
// generic webhook triggers use — no duplicated dispatch logic.

import { Router, type IRouter, type Request, type Response } from "express";
import { db, wfTriggersTable, wfTriggerEventsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { fireWorkflowForDefinition } from "../lib/workflow-executor";
import { verifyZohoWebhookToken, resolveZohoEventType } from "../lib/zoho-webhook.ts";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "integration.zoho" });

const router: IRouter = Router();

router.post("/zoho/webhook", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const provided =
    (typeof req.query.token === "string" ? req.query.token : undefined) ??
    (typeof req.headers["x-zoho-webhook-token"] === "string" ? (req.headers["x-zoho-webhook-token"] as string) : undefined) ??
    (typeof body.token === "string" ? (body.token as string) : undefined);

  if (!verifyZohoWebhookToken(provided, process.env.ZOHO_WEBHOOK_SECRET)) {
    log.warn({ hasToken: Boolean(provided) }, "zoho-webhook: rejected — invalid or missing token");
    res.status(401).json({ error: "Invalid webhook token" });
    return;
  }

  const eventType = resolveZohoEventType(body, req.query as Record<string, unknown>);
  if (!eventType) {
    log.warn("zoho-webhook: could not resolve event type from payload");
    res.status(400).json({ error: "Could not resolve Zoho event type (module/operation or event_type)" });
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
          sql`${wfTriggersTable.config} ->> 'zohoEventType' = ${eventType}`,
        ),
      );

    let fired = 0;
    for (const trigger of triggers) {
      const t0 = Date.now();
      const runId = await fireWorkflowForDefinition(
        trigger.definitionId,
        "webhook",
        `zoho-webhook:${trigger.id}`,
        { ...body, zohoEventType: eventType },
      );
      if (runId) fired++;

      await db
        .insert(wfTriggerEventsTable)
        .values({
          triggerId: trigger.id,
          runId: runId ?? undefined,
          status: runId ? "fired" : "skipped",
          payload: { ...body, zohoEventType: eventType },
          durationMs: Date.now() - t0,
        })
        .catch((err: unknown) => {
          log.warn({ err, triggerId: trigger.id }, "zoho-webhook: failed to record trigger event (non-fatal)");
        });
    }

    log.info({ eventType, matched: triggers.length, fired }, "zoho-webhook: processed inbound event");
    res.status(202).json({ eventType, matched: triggers.length, fired });
  } catch (err) {
    log.error({ err, eventType }, "zoho-webhook: dispatch failed");
    res.status(500).json({ error: "Zoho webhook dispatch failed" });
  }
});

export default router;
