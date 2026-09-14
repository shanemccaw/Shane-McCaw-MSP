/**
 * Customer Portal Testimonials (Git #3891, #3892)
 *
 * Real, standing customer submission surface — deliberately separate from
 * project_closures.feedback, which stays the project-closure-specific record
 * it already is. A customer can submit a testimonial/feedback/suggestion at
 * any time, not gated on a project closing.
 *
 *   POST /api/portal/testimonials            — submit a new one
 *   GET  /api/portal/testimonials             — the requesting user's own submission history
 *   GET  /api/portal/testimonials/prompt-due  — whether the portal shell should show the prompt (#3892)
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { requireCapability } from "../middlewares/requireAuth.ts";
import { logger } from "../lib/logger.ts";
import { db, customerTestimonialsTable, tenantsTable, CUSTOMER_TESTIMONIAL_KINDS } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";

// Cadence settled 2026-09-14 on Git #3892: 30 days after the customer starts,
// then every 90 days thereafter, skipping a customer who already has a
// submission within the current window.
const FIRST_PROMPT_AFTER_DAYS = 30;
const REPEAT_PROMPT_AFTER_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

// ── GET /api/portal/testimonials/prompt-due ───────────────────────────────
// Whether the customer-portal shell should show the testimonial prompt right
// now (#3892). "customerId" throughout this file is tenants.id — the anchor
// for "when did this customer start" is tenantsTable.createdAt, the tenant
// row's own creation timestamp. There is no reliable tenant-level onboarding-
// completion timestamp to use instead: usersTable.onboardingWizardCompletedAt
// is per-user and nullable (not every user on a tenant completes the wizard),
// so it cannot anchor a per-customer (tenant-wide) due-check the way
// tenants.createdAt can.
router.get("/portal/testimonials/prompt-due", requireCapability("ladder.customer-user"), async (req: Request, res: Response) => {
  const customerId = req.user!.customerId;
  if (!customerId) {
    res.status(400).json({ error: "No customer account associated with this user" });
    return;
  }

  try {
    const [tenant] = await db
      .select({ createdAt: tenantsTable.createdAt })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, customerId))
      .limit(1);

    if (!tenant) {
      res.status(404).json({ error: "Customer account not found" });
      return;
    }

    const [lastSubmission] = await db
      .select({ createdAt: customerTestimonialsTable.createdAt })
      .from(customerTestimonialsTable)
      .where(eq(customerTestimonialsTable.customerId, customerId))
      .orderBy(desc(customerTestimonialsTable.createdAt))
      .limit(1);

    const now = Date.now();
    const daysSinceCustomerStart = (now - tenant.createdAt.getTime()) / MS_PER_DAY;
    const daysSinceLastSubmission = lastSubmission ? (now - lastSubmission.createdAt.getTime()) / MS_PER_DAY : null;

    const due =
      daysSinceCustomerStart >= FIRST_PROMPT_AFTER_DAYS &&
      (daysSinceLastSubmission === null || daysSinceLastSubmission >= REPEAT_PROMPT_AFTER_DAYS);

    res.json({
      due,
      customerStartedAt: tenant.createdAt,
      lastSubmissionAt: lastSubmission?.createdAt ?? null,
    });
  } catch (err) {
    log.error({ err, customerId }, "portal-testimonials: GET prompt-due failed");
    res.status(500).json({ error: "Unable to check prompt status right now. Please try again shortly." });
  }
});

export default router;
