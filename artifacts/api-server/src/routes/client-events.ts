/**
 * Client Event Beacon
 *
 * Frontend-to-backend door into the existing exception tracker
 * (lib/exception-tracker.ts). Lets browser-side code (canaries, defensive
 * assertions) report an error so it lands in exception_groups /
 * exception_occurrences and shows up in the admin exceptions UI / log stream
 * — the same place server-side captureException() calls already land.
 *
 *   POST /api/client-events
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import { mspMutatingRateLimit } from "../middlewares/mspRateLimit";
import { captureException } from "../lib/exception-tracker";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const log = logger.child({ channel: "client.frontend" });

// Defensive bounds on a client-supplied payload — not a product requirement,
// just enough to stop a malformed/hostile payload from reaching captureException
// with an unbounded message or stack.
const MAX_MESSAGE_LENGTH = 2_000;
const MAX_STACK_LENGTH = 8_000;

const clientEventSchema = z.object({
  errorName: z.string().min(1).max(200),
  message: z.string().min(1).max(MAX_MESSAGE_LENGTH),
  stack: z.string().max(MAX_STACK_LENGTH).optional(),
  channel: z.string().min(1).max(100),
  context: z.record(z.unknown()).optional(),
});

router.post(
  "/client-events",
  requireAuth,
  mspMutatingRateLimit,
  async (req: Request, res: Response) => {
    const parsed = clientEventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
      return;
    }

    const { errorName, message, stack, channel, context } = parsed.data;

    const err = new Error(message);
    err.name = errorName;
    if (stack) err.stack = stack;

    log.info(
      { userId: req.user?.id, channel, errorName, context },
      "client-events: report received",
    );

    await captureException(err, { channel, source: "caught" });

    res.status(204).end();
  },
);

export default router;
