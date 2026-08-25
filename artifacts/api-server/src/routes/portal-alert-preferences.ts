/**
 * Customer Portal Alert Preferences (Git #1276)
 *
 * Real persistence for portal-v2-alert-preferences.tsx — per-category
 * mode/threshold/delivery, page-level quiet hours, and additional recipients.
 * A genuinely NEW taxonomy (7 conceptual categories), not the existing
 * 15-technical-category `customer_notification_preferences` (Notification
 * Center bell) — confirmed decision (a) from the #1236/#1276 scoping.
 *
 * Scoped by req.user.customerId (tenants.id) — alerts are about ONE monitored
 * tenant, so every portal user for that tenant reads/writes the same shared
 * profile. This is also the real backing store for the #1278 customer-delivery
 * seam (`customer-alert-delivery.ts` `resolveCustomerAlertPreferences`).
 *
 * The primary recipient ("you") is never a stored row — always the requesting
 * user's own account, resolved live. `customer_alert_recipients` holds only the
 * additional ones the design's "Add recipient" adds.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { requireRole } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import {
  db,
  customerAlertPreferencesTable,
  customerAlertSettingsTable,
  customerAlertRecipientsTable,
  usersTable,
  CUSTOMER_ALERT_CATEGORIES,
  CUSTOMER_ALERT_DIGEST_MODES,
  CUSTOMER_ALERT_PRESETS,
  type CustomerAlertCategory,
  type CustomerAlertDigestMode,
  type CustomerAlertPreset,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { CUSTOMER_ALERT_BALANCED_DEFAULTS } from "../lib/customer-alert-delivery";

const router: IRouter = Router();
const log = logger.child({ channel: "notification" });

// ── Defaults — the page's own "Balanced" preset (alertPrefsData.ts ALERT_PRESETS)
// The single source of truth lives in customer-alert-delivery.ts (the #1278
// seam also reads it); this just maps its {on,email,...} shape onto this
// route's {enabled,emailEnabled,...} response naming (matches the DB columns).

interface CategoryPrefShape {
  enabled: boolean;
  emailEnabled: boolean;
  mode: CustomerAlertDigestMode;
  threshold: string;
}

const BALANCED_DEFAULTS: Record<CustomerAlertCategory, CategoryPrefShape> = Object.fromEntries(
  Object.entries(CUSTOMER_ALERT_BALANCED_DEFAULTS).map(([cat, p]) => [
    cat,
    { enabled: p.on, emailEnabled: p.email, mode: p.mode, threshold: p.threshold },
  ]),
) as Record<CustomerAlertCategory, CategoryPrefShape>;

// ── GET /api/portal/alert-preferences ─────────────────────────────────────────

router.get("/portal/alert-preferences", requireRole("CustomerUser"), async (req: Request, res: Response) => {
  const customerId = req.user!.customerId;
  if (!customerId) {
    res.status(400).json({ error: "No customer account associated with this user" });
    return;
  }

  try {
    const [prefRows, settingsRows, recipientRows, [me]] = await Promise.all([
      db.select().from(customerAlertPreferencesTable).where(eq(customerAlertPreferencesTable.customerId, customerId)),
      db.select().from(customerAlertSettingsTable).where(eq(customerAlertSettingsTable.customerId, customerId)),
      db.select().from(customerAlertRecipientsTable).where(eq(customerAlertRecipientsTable.customerId, customerId)),
      db.select({ email: usersTable.email, name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.id)),
    ]);

    const byCategory = new Map(prefRows.map((r) => [r.category, r]));
    const categories: Record<string, CategoryPrefShape> = {};
    for (const cat of CUSTOMER_ALERT_CATEGORIES) {
      const row = byCategory.get(cat);
      categories[cat] = row
        ? { enabled: row.enabled, emailEnabled: row.emailEnabled, mode: row.mode as CustomerAlertDigestMode, threshold: row.threshold }
        : BALANCED_DEFAULTS[cat];
    }

    const settingsRow = settingsRows[0];
    let updatedByName: string | null = null;
    if (settingsRow?.updatedByUserId) {
      const [updater] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, settingsRow.updatedByUserId));
      updatedByName = updater?.name ?? null;
    }
    const settings = settingsRow
      ? {
          activePreset: settingsRow.activePreset,
          quietHoursEnabled: settingsRow.quietHoursEnabled,
          quietHoursFrom: settingsRow.quietHoursFrom,
          quietHoursTo: settingsRow.quietHoursTo,
          quietBreakForCritical: settingsRow.quietBreakForCritical,
          updatedAt: settingsRow.updatedAt,
          updatedByName,
        }
      : {
          activePreset: "balanced" as CustomerAlertPreset,
          quietHoursEnabled: true,
          quietHoursFrom: "19:00",
          quietHoursTo: "07:30",
          quietBreakForCritical: true,
          updatedAt: null,
          updatedByName: null,
        };

    res.json({
      categories,
      settings,
      primaryRecipient: { email: me?.email ?? req.user!.email, name: me?.name ?? null },
      recipients: recipientRows.map((r) => ({
        email: r.email,
        role: r.role,
        scopeCategories: r.scopeCategories ?? null, // null = all
      })),
    });
  } catch (err) {
    log.error({ err, customerId }, "portal-alert-preferences: GET failed");
    res.status(500).json({ error: "Unable to load alert preferences right now. Please try again shortly." });
  }
});

// ── PUT /api/portal/alert-preferences ─────────────────────────────────────────
// Full-profile save (matches the page's single "Save preferences" action).

const categoryPrefSchema = z.object({
  enabled: z.boolean(),
  emailEnabled: z.boolean(),
  mode: z.enum(CUSTOMER_ALERT_DIGEST_MODES),
  threshold: z.string().min(1).max(40),
});

const putSchema = z.object({
  categories: z.record(z.enum(CUSTOMER_ALERT_CATEGORIES), categoryPrefSchema),
  settings: z.object({
    activePreset: z.enum(CUSTOMER_ALERT_PRESETS),
    quietHoursEnabled: z.boolean(),
    quietHoursFrom: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    quietHoursTo: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    quietBreakForCritical: z.boolean(),
  }),
  recipients: z.array(z.object({
    email: z.string().email(),
    role: z.string().max(80).nullable().optional(),
    scopeCategories: z.array(z.enum(CUSTOMER_ALERT_CATEGORIES)).nullable().optional(),
  })).max(50),
});

router.put("/portal/alert-preferences", requireRole("CustomerUser"), async (req: Request, res: Response) => {
  const customerId = req.user!.customerId;
  if (!customerId) {
    res.status(400).json({ error: "No customer account associated with this user" });
    return;
  }

  const parsed = putSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation failed", details: parsed.error.flatten() });
    return;
  }
  const { categories, settings, recipients } = parsed.data;

  try {
    await db.transaction(async (tx) => {
      for (const cat of CUSTOMER_ALERT_CATEGORIES) {
        const pref = categories[cat];
        if (!pref) continue;
        await tx
          .insert(customerAlertPreferencesTable)
          .values({ customerId, category: cat, enabled: pref.enabled, emailEnabled: pref.emailEnabled, mode: pref.mode, threshold: pref.threshold })
          .onConflictDoUpdate({
            target: [customerAlertPreferencesTable.customerId, customerAlertPreferencesTable.category],
            set: { enabled: pref.enabled, emailEnabled: pref.emailEnabled, mode: pref.mode, threshold: pref.threshold, updatedAt: new Date() },
          });
      }

      await tx
        .insert(customerAlertSettingsTable)
        .values({
          customerId,
          activePreset: settings.activePreset,
          quietHoursEnabled: settings.quietHoursEnabled,
          quietHoursFrom: settings.quietHoursFrom,
          quietHoursTo: settings.quietHoursTo,
          quietBreakForCritical: settings.quietBreakForCritical,
          updatedByUserId: req.user!.id,
        })
        .onConflictDoUpdate({
          target: customerAlertSettingsTable.customerId,
          set: {
            activePreset: settings.activePreset,
            quietHoursEnabled: settings.quietHoursEnabled,
            quietHoursFrom: settings.quietHoursFrom,
            quietHoursTo: settings.quietHoursTo,
            quietBreakForCritical: settings.quietBreakForCritical,
            updatedAt: new Date(),
            updatedByUserId: req.user!.id,
          },
        });

      // Replace-all: the page's Save action reflects the full recipient list
      // it holds client-side (adds and removes both land through this one call).
      await tx.delete(customerAlertRecipientsTable).where(eq(customerAlertRecipientsTable.customerId, customerId));
      if (recipients.length > 0) {
        await tx.insert(customerAlertRecipientsTable).values(
          recipients.map((r) => ({
            customerId,
            email: r.email,
            role: r.role ?? null,
            scopeCategories: r.scopeCategories && r.scopeCategories.length > 0 ? r.scopeCategories : null,
          })),
        );
      }
    });

    res.json({ ok: true });
  } catch (err) {
    log.error({ err, customerId }, "portal-alert-preferences: PUT failed");
    res.status(500).json({ error: "Unable to save alert preferences right now. Please try again shortly." });
  }
});

export default router;
