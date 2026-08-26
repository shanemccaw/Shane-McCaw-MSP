/**
 * portal-retainer.ts — the customer-facing read for "My Architect" (#1285).
 *
 * The AdminV2 module (`routes/admin-retainer.ts`, Git #1293) is where Shane
 * logs retainer hours; this is the one route the customer-facing retainer page
 * (`portal-v2-retainer.tsx`) reads from — its OWN retainer only, never another
 * customer's. Scoped via `resolveCustomerId`, the same `tenants.id` every other
 * portal-owned table (retainer_settings/retainer_work_log are keyed the same
 * way admin-retainer.ts already established) uses — no admin privilege, no
 * cross-tenant surface.
 *
 * GET /api/portal/retainer — settings + this month's bucket + the full ledger
 * for the caller's own retainer. `configured` is false (and `settings`/`bucket`
 * carry the honest default-allotment shape) when the customer has no active
 * retainer row yet — the page falls back to its design fixture rather than
 * rendering a manufactured zero.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, retainerSettingsTable, retainerWorkLogTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.ts";
import { resolveCustomerId } from "../lib/portal-customer-scope.ts";
import { logger } from "../lib/logger.ts";
import { periodMonthOf, computeMonthBucket, usedMinutesByPeriod, minutesToHours } from "../lib/retainer-hours.ts";
import { DEFAULT_RETAINED_MINUTES, entryToWire, bucketToWire } from "./admin-retainer.ts";

const log = logger.child({ channel: "billing" });

const router: IRouter = Router();

router.get("/portal/retainer", requireAuth, async (req: Request, res: Response) => {
  try {
    const customerId = resolveCustomerId(req);
    if (customerId == null) {
      res.status(400).json({ error: "No customer scope on this session" });
      return;
    }

    const [settings] = await db
      .select()
      .from(retainerSettingsTable)
      .where(eq(retainerSettingsTable.customerId, customerId))
      .limit(1);

    const entries = await db
      .select()
      .from(retainerWorkLogTable)
      .where(eq(retainerWorkLogTable.customerId, customerId))
      .orderBy(desc(retainerWorkLogTable.occurredAt));

    const retainedMinutes = settings?.retainedMinutesPerMonth ?? DEFAULT_RETAINED_MINUTES;
    const usedByPeriod = usedMinutesByPeriod(entries);
    const period = periodMonthOf(new Date());
    const bucket = computeMonthBucket(period, retainedMinutes, usedByPeriod);

    res.json({
      configured: !!settings && settings.active,
      settings: settings
        ? {
            retainedHours: minutesToHours(retainedMinutes),
            hourlyRateCents: settings.hourlyRateCents,
            architectName: settings.architectName,
            active: settings.active,
          }
        : null,
      bucket: bucketToWire(bucket),
      months: [...new Set(entries.map((e) => e.periodMonth))].sort().reverse(),
      entries: entries.map(entryToWire),
    });
  } catch (err) {
    log.error({ err }, "GET /portal/retainer failed");
    res.status(500).json({ error: "Failed to load your retainer" });
  }
});

export default router;
