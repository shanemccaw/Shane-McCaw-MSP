/**
 * Customer Notification Preferences
 *
 * Lets a CustomerUser control what reaches them from the existing Notification
 * Center bell (notifications table / notification-center.ts): which categories
 * they receive, and whether email delivery is also on for those they keep.
 *
 * Deliberately does NOT touch policy_rules severity/cooldown/escalation — those
 * stay MSP-configured. This only gates delivery of already-fired notifications.
 *
 * Webhook delivery (the v1 Teams/Slack mechanism) is handled by the existing
 * generic /api/portal/webhooks endpoints (see routes/webhooks.ts) — a customer
 * webhook subscribed to `notification.*` events receives the same fan-out this
 * page's category toggles gate. Not duplicated here.
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db, customerNotificationPreferencesTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.ts";
import { CATEGORY_STYLES } from "./notifications.ts";

const router = Router();

const KNOWN_CATEGORIES = Object.keys(CATEGORY_STYLES);

// ── GET /api/portal/notification-preferences ──────────────────────────────────
// Returns every known category with the user's current preference, defaulting
// unset categories to { inAppEnabled: true, emailEnabled: false }.

router.get("/portal/notification-preferences", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const rows = await db
    .select({
      category: customerNotificationPreferencesTable.category,
      inAppEnabled: customerNotificationPreferencesTable.inAppEnabled,
      emailEnabled: customerNotificationPreferencesTable.emailEnabled,
    })
    .from(customerNotificationPreferencesTable)
    .where(eq(customerNotificationPreferencesTable.userId, userId));

  const byCategory = new Map(rows.map((r) => [r.category, r]));

  const preferences = KNOWN_CATEGORIES.map((category) => {
    const existing = byCategory.get(category);
    return {
      category,
      inAppEnabled: existing?.inAppEnabled ?? true,
      emailEnabled: existing?.emailEnabled ?? false,
    };
  });

  res.json({ preferences });
});

// ── PATCH /api/portal/notification-preferences ────────────────────────────────
// Upserts one or more category preferences in a single call.

const patchSchema = z.object({
  preferences: z.array(z.object({
    category: z.string().min(1),
    inAppEnabled: z.boolean(),
    emailEnabled: z.boolean(),
  })).min(1).max(50),
});

router.patch("/portal/notification-preferences", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }

  for (const pref of parsed.data.preferences) {
    await db
      .insert(customerNotificationPreferencesTable)
      .values({
        userId,
        category: pref.category,
        inAppEnabled: pref.inAppEnabled,
        emailEnabled: pref.emailEnabled,
      })
      .onConflictDoUpdate({
        target: [customerNotificationPreferencesTable.userId, customerNotificationPreferencesTable.category],
        set: {
          inAppEnabled: pref.inAppEnabled,
          emailEnabled: pref.emailEnabled,
          updatedAt: new Date(),
        },
      });
  }

  res.json({ ok: true });
});

export default router;
