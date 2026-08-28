/**
 * portal-retainer.ts — the customer-facing read for "My Architect" (#1285).
 *
 * The AdminV2 module (`routes/admin-retainer.ts`, Git #1293) is where Shane
 * logs retainer hours; this is the one route the customer-facing retainer page
 * (`portal-v2-retainer.tsx`) reads from — its OWN retainer only, never another
 * customer's. `settings`/`bucket`/`entries` are scoped via `resolveCustomerId`,
 * the same `tenants.id` every other portal-owned table (retainer_settings/
 * retainer_work_log are keyed the same way admin-retainer.ts already
 * established) uses — no admin privilege, no cross-tenant surface.
 *
 * `statusReports` (Git #1410) is a DIFFERENT id space — `status_reports.
 * clientUserId` is a `users.id`, not a `tenants.id` — so it is scoped via
 * `resolveSiblingUserIds(req.user!.id)` (`tenant-signals.ts`'s bridge, the
 * same one #1397 fixed `portal-projects.ts` onto), never `clientUserId`
 * directly and never `resolveCustomerId`'s tenants.id. Only `reportStatus:
 * "sent"` rows are returned — a draft the architect hasn't published yet is
 * not the customer's to see, the same rule `portal-projects.ts` already
 * applies to a project's status reports.
 *
 * GET /api/portal/retainer — settings + this month's bucket + the full ledger
 * for the caller's own retainer, plus their own sent status reports.
 * `configured` is false (and `settings`/`bucket` carry the honest
 * default-allotment shape) when the customer has no active retainer row yet
 * — the page falls back to its design fixture rather than rendering a
 * manufactured zero. `statusReports` is independent of `configured`: a
 * customer can have sent reports with no active retainer row (or vice versa).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, retainerSettingsTable, retainerWorkLogTable, statusReportsTable } from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.ts";
import { resolveCustomerId } from "../lib/portal-customer-scope.ts";
import { resolveSiblingUserIds } from "../lib/tenant-signals.ts";
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

    // #1410: users.id-shaped bridge — NOT resolveCustomerId's tenants.id.
    const siblingIds = await resolveSiblingUserIds(req.user!.id);
    const statusReports = await db
      .select()
      .from(statusReportsTable)
      .where(and(
        inArray(statusReportsTable.clientUserId, siblingIds),
        eq(statusReportsTable.reportStatus, "sent"),
      ))
      .orderBy(desc(statusReportsTable.sentAt));

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
      statusReports: statusReports.map(statusReportToWire),
    });
  } catch (err) {
    log.error({ err }, "GET /portal/retainer failed");
    res.status(500).json({ error: "Failed to load your retainer" });
  }
});

/** The wire shape `useRetainerLive.ts` parses a `status_reports` row into. */
function statusReportToWire(r: typeof statusReportsTable.$inferSelect) {
  return {
    id: r.id,
    title: r.title,
    period: r.period,
    executiveSummary: r.executiveSummary,
    completedActivities: r.completedActivities,
    keyOutcomes: r.keyOutcomes,
    reportDate: r.reportDate ? r.reportDate.toISOString() : null,
    sentAt: r.sentAt ? r.sentAt.toISOString() : null,
    clientStatus: r.clientStatus,
    clientQuestion: r.clientQuestion,
    adminReply: r.adminReply,
    replyThread: r.replyThread,
  };
}

export default router;
