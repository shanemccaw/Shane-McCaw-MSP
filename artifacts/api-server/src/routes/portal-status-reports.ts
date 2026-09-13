/**
 * portal-status-reports.ts — the CUSTOMER-scoped read + comment surface for
 * MSP Status Reports (Git #3887, Feature #3434, phase 1 of 4 — API first).
 *
 * `msp-status-reports.ts` is MSP-operator-only (`requireCapability("ladder.msp-operator")`
 * on every route, `:customerId`-scoped by URL param + `assertCustomerAccess`) —
 * there is deliberately no customer-facing route on that router at all. This
 * router is that missing surface, following the exact same shape
 * `portal-message-center.ts` already established:
 *
 *   - The customer is `resolveCustomerId(req)` — the JWT's own `customerId`
 *     claim — and nothing on the request can override it. There is no
 *     `:customerId` param anywhere on this router to ignore.
 *   - `msp_status_reports.customer_id` is the same `tenants.id` id space the
 *     JWT's claim lives in (no FK, by the same "successor id-space" design
 *     `msp-status-reports.ts`'s own header documents), so `resolveCustomerId`
 *     alone is the whole scoping predicate — the `resolveCustomerId` shape
 *     from `portal-customer-scope.ts`, not `resolveTenantScope`.
 *
 *   GET  /api/portal/status-reports
 *     — This customer's own reports, PUBLISHED ONLY. A draft is the MSP's
 *       own working copy — never served here, and never inferred by state
 *       from a foreign customerId (assertCustomerAccess isn't in play; the
 *       WHERE clause itself never matches a draft or another customer's row).
 *
 *   GET  /api/portal/status-reports/:id
 *     — One report. Foreign id, unknown id, AND a real-but-unpublished report
 *       all 404 alike — never confirm existence of a report this customer may
 *       not see.
 *
 *   GET  /api/portal/status-reports/:id/comments
 *     — The full two-sided comment thread on a report this customer can see
 *       (same ownership/published gate as the detail route above).
 *
 *   POST /api/portal/status-reports/:id/comments
 *     — Add a comment as this customer. Inserts into
 *       `msp_status_report_comments` with `authorType: "customer"` and
 *       `authorUserId: req.user.id`, then notifies the report's author (the
 *       MSP operator who wrote it) via the existing `createNotification`
 *       mechanism (`notification-center.ts`) — no new notification pipeline.
 *
 * Role floor: `requireCapability("ladder.customer-user")`, same floor
 * `portal-message-center.ts` uses — a deliberately higher floor than the
 * portal's `Free`-tier routes, since status reports are paid-engagement MSP
 * output, not something a free assessment account should see.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, mspStatusReportsTable, mspStatusReportCommentsTable, usersTable } from "@workspace/db";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { requireCapability } from "../middlewares/requireAuth.ts";
import { resolveCustomerId } from "../lib/portal-customer-scope.ts";
import { createNotification } from "../lib/notification-center.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

function reportToWire(row: typeof mspStatusReportsTable.$inferSelect, authoredByName: string | null) {
  return {
    id: row.id,
    periodLabel: row.periodLabel,
    asOfDate: row.asOfDate.toISOString(),
    content: row.content,
    authoredByName,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
  };
}

function commentToWire(row: typeof mspStatusReportCommentsTable.$inferSelect, authorName: string | null) {
  return {
    id: row.id,
    reportId: row.reportId,
    authorType: row.authorType,
    authorName,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Resolves a report by id, scoped to THIS customer and published-only in one
 * query — a foreign customerId, an unknown id, and a real draft all come back
 * as `undefined` alike, so every caller below gets the "not found" 404 for
 * free without a separate ownership check to remember.
 */
async function loadPublishedReportForCustomer(id: number, customerId: number) {
  const [row] = await db
    .select()
    .from(mspStatusReportsTable)
    .where(
      and(
        eq(mspStatusReportsTable.id, id),
        eq(mspStatusReportsTable.customerId, customerId),
        eq(mspStatusReportsTable.state, "published"),
      ),
    )
    .limit(1);
  return row;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /portal/status-reports — this customer's own published reports
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/portal/status-reports",
  requireCapability("ladder.customer-user"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const rows = await db
        .select()
        .from(mspStatusReportsTable)
        .where(and(eq(mspStatusReportsTable.customerId, customerId), eq(mspStatusReportsTable.state, "published")))
        .orderBy(desc(mspStatusReportsTable.asOfDate));

      const authorIds = [...new Set(rows.map((r) => r.authoredByUserId))];
      const nameById = new Map<number, string | null>();
      if (authorIds.length) {
        const authorRows = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, authorIds));
        for (const u of authorRows) nameById.set(u.id, u.name);
      }

      res.json({ reports: rows.map((r) => reportToWire(r, nameById.get(r.authoredByUserId) ?? null)) });
    } catch (err) {
      log.error({ err, customerId }, "portal-status-reports: GET list failed");
      res.status(500).json({ error: "Failed to load status reports" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /portal/status-reports/:id — one report
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/portal/status-reports/:id",
  requireCapability("ladder.customer-user"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    try {
      const row = await loadPublishedReportForCustomer(id, customerId);
      if (!row) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      const [author] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, row.authoredByUserId)).limit(1);
      res.json({ report: reportToWire(row, author?.name ?? null) });
    } catch (err) {
      log.error({ err, customerId, id }, "portal-status-reports: GET one failed");
      res.status(500).json({ error: "Failed to load status report" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /portal/status-reports/:id/comments — full two-sided thread
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/portal/status-reports/:id/comments",
  requireCapability("ladder.customer-user"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    try {
      const report = await loadPublishedReportForCustomer(id, customerId);
      if (!report) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      const rows = await db
        .select()
        .from(mspStatusReportCommentsTable)
        .where(eq(mspStatusReportCommentsTable.reportId, id))
        .orderBy(asc(mspStatusReportCommentsTable.createdAt));

      const authorIds = [...new Set(rows.map((r) => r.authorUserId))];
      const nameById = new Map<number, string | null>();
      if (authorIds.length) {
        const authorRows = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable).where(inArray(usersTable.id, authorIds));
        for (const u of authorRows) nameById.set(u.id, u.name);
      }

      res.json({ comments: rows.map((r) => commentToWire(r, nameById.get(r.authorUserId) ?? null)) });
    } catch (err) {
      log.error({ err, customerId, id }, "portal-status-reports: GET comments failed");
      res.status(500).json({ error: "Failed to load comments" });
    }
  },
);

const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /portal/status-reports/:id/comments — customer adds a comment
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/portal/status-reports/:id/comments",
  requireCapability("ladder.customer-user"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const parsed = createCommentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      return;
    }

    try {
      const report = await loadPublishedReportForCustomer(id, customerId);
      if (!report) {
        res.status(404).json({ error: "Not found" });
        return;
      }

      const [row] = await db
        .insert(mspStatusReportCommentsTable)
        .values({
          reportId: id,
          authorType: "customer",
          authorUserId: req.user!.id,
          body: parsed.data.body,
        })
        .returning();

      // Notify the report's author (the MSP operator who wrote it) via the
      // real, existing notification mechanism — no new pipeline. Best-effort:
      // createNotification never throws, so a delivery failure here can't
      // fail the comment write that already committed.
      void createNotification({
        title: `New comment on your status report "${report.periodLabel}"`,
        body: parsed.data.body,
        category: "message",
        notifType: "message",
        linkPath: `/status-reports/${report.id}`,
        recipient: { type: "msp_user", mspUserId: report.authoredByUserId, mspId: report.mspId },
      });

      const [author] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
      res.status(201).json({ comment: commentToWire(row, author?.name ?? null) });
    } catch (err) {
      log.error({ err, customerId, id }, "portal-status-reports: POST comment failed");
      res.status(500).json({ error: "Failed to add comment" });
    }
  },
);

export default router;
