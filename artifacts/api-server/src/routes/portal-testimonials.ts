/**
 * Customer Portal Testimonials (Git #3891)
 *
 * Real, standing customer submission surface — deliberately separate from
 * project_closures.feedback, which stays the project-closure-specific record
 * it already is. A customer can submit a testimonial/feedback/suggestion at
 * any time, not gated on a project closing.
 *
 *   POST /api/portal/testimonials  — submit a new one
 *   GET  /api/portal/testimonials  — the requesting user's own submission history
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { requireCapability } from "../middlewares/requireAuth.ts";
import { logger } from "../lib/logger.ts";
import { db, customerTestimonialsTable, CUSTOMER_TESTIMONIAL_KINDS } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

const router: IRouter = Router();
const log = logger.child({ channel: "portal-testimonials" });

const postSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  kind: z.enum(CUSTOMER_TESTIMONIAL_KINDS).default("testimonial"),
  permissionToPublish: z.boolean().default(false),
});

// ── POST /api/portal/testimonials ─────────────────────────────────────────
router.post("/portal/testimonials", requireCapability("ladder.customer-user"), async (req: Request, res: Response) => {
  const customerId = req.user!.customerId;
  if (!customerId) {
    res.status(400).json({ error: "No customer account associated with this user" });
    return;
  }

  const parsed = postSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }
  const { body, kind, permissionToPublish } = parsed.data;

  try {
    const [row] = await db
      .insert(customerTestimonialsTable)
      .values({
        customerId,
        authorUserId: req.user!.id,
        body,
        kind,
        permissionToPublish,
      })
      .returning();

    res.status(201).json({
      id: row.id,
      body: row.body,
      kind: row.kind,
      permissionToPublish: row.permissionToPublish,
      createdAt: row.createdAt,
    });
  } catch (err) {
    log.error({ err, customerId }, "portal-testimonials: POST failed");
    res.status(500).json({ error: "Unable to submit right now. Please try again shortly." });
  }
});

// ── GET /api/portal/testimonials ──────────────────────────────────────────
// The requesting user's OWN submission history (not the whole customer's).
router.get("/portal/testimonials", requireCapability("ladder.customer-user"), async (req: Request, res: Response) => {
  const customerId = req.user!.customerId;
  if (!customerId) {
    res.status(400).json({ error: "No customer account associated with this user" });
    return;
  }

  try {
    const rows = await db
      .select()
      .from(customerTestimonialsTable)
      .where(and(eq(customerTestimonialsTable.customerId, customerId), eq(customerTestimonialsTable.authorUserId, req.user!.id)))
      .orderBy(desc(customerTestimonialsTable.createdAt));

    res.json(
      rows.map((r) => ({
        id: r.id,
        body: r.body,
        kind: r.kind,
        permissionToPublish: r.permissionToPublish,
        createdAt: r.createdAt,
      })),
    );
  } catch (err) {
    log.error({ err, customerId }, "portal-testimonials: GET failed");
    res.status(500).json({ error: "Unable to load submission history right now. Please try again shortly." });
  }
});

export default router;
