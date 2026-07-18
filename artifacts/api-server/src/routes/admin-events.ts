import { Router, type IRouter, type Request, type Response } from "express";
import { requireAdmin } from "../middlewares/requireAuth";
import { dispatchEvent, systemActor, EVENT_TYPES } from "../lib/event-bus";
import { requireTestbedCustomer } from "../lib/test-suite-runner";
import { logger } from "../lib/logger";
const log = logger.child({ channel: "system.core" });

const router: IRouter = Router();

/**
 * @route GET /api/admin/events/types
 * @desc Lists the canonical EVENT_TYPES for the simulator's Events tree,
 *       grouped by dot-prefix (e.g. "auth", "customer", "dlq").
 */
router.get("/admin/events/types", requireAdmin, (_req: Request, res: Response) => {
  const types = Object.values(EVENT_TYPES).map(eventType => ({
    eventType,
    group: eventType.split(".")[0] as string,
  }));
  res.json({ types });
});

/**
 * @route POST /api/admin/events/_test/fire
 * @desc Fires a synthetic canonical event against a testbed customer.
 *       Firing is NOT inert — seeded workflows trigger off real event types
 *       and webhook fan-out reaches real configured webhooks (both scoped by
 *       mspId/customerId) — so the target MUST be a testbed-flagged customer.
 */
router.post("/admin/events/_test/fire", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { eventType, testbedCustomerId, payload } = req.body ?? {};

    if (typeof eventType !== "string" || !Object.values(EVENT_TYPES).includes(eventType as never)) {
      return void res.status(400).json({ error: "A known eventType is required." });
    }
    if (payload !== undefined && (typeof payload !== "object" || payload === null || Array.isArray(payload))) {
      return void res.status(400).json({ error: "payload must be a JSON object when provided." });
    }

    let customer;
    try {
      customer = await requireTestbedCustomer(Number(testbedCustomerId));
    } catch {
      return void res.status(400).json({ error: "Events can only be fired against a testbed customer" });
    }

    const dispatched = await dispatchEvent({
      eventType,
      source: "simulator-test-fire",
      actor: systemActor(),
      mspId: customer.mspId,
      customerId: customer.id,
      payload: { ...(payload as Record<string, unknown> | undefined), __testFired: true },
    });

    // dispatchEvent never throws — null means the dispatch failed and was logged.
    if (!dispatched) {
      return void res.status(500).json({ error: "Event dispatch failed — see server logs." });
    }

    log.info(
      { eventType, mspId: customer.mspId, customerId: customer.id, eventId: dispatched.eventId },
      `admin-events: test-fired ${eventType} against testbed customer ${customer.id}`,
    );
    res.json({ ok: true, dispatched });
  } catch (err) {
    log.error({ err }, "admin-events: test fire failed");
    res.status(500).json({ error: "Failed to fire event" });
  }
});

export default router;
