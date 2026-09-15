/**
 * msp-status-reports.ts
 *
 * MSP console operator routes for Status Reports (Git #3762, Feature #3434
 * phase 1 of 4 — API first). Real per-customer, operator-authored status
 * reports: a real narrative record of MSP work, backed by `msp_status_reports`
 * (see `lib/db/migrations/manual/2026-09-12-msp-status-reports-3762.sql`) —
 * no fixture data. Same shape family as #1293's retainer-hours ledger.
 *
 *   POST   /api/msp/customers/:customerId/status-reports
 *     — Create a new draft report for a customer.
 *
 *   GET    /api/msp/customers/:customerId/status-reports
 *     — List a customer's reports, newest-as-of-date first, real pagination
 *       via ?limit=&offset=.
 *
 *   GET    /api/msp/status-reports/:id
 *     — One report.
 *
 *   PATCH  /api/msp/status-reports/:id
 *     — Edit while draft only. A published report's content/period/asOfDate
 *       can never be edited (irreversible in v1) — rejected with 409.
 *
 *   POST   /api/msp/status-reports/:id/publish
 *     — Publish (draft -> published). Irreversible in v1 — no unpublish.
 *       Publishing an already-published report is a no-op 409, not a second
 *       publishedAt stamp. Notifies every subscribed, permission-filtered
 *       customer-side user on the report's customer (Git #4252) — same
 *       tenant-wide fan-out + `filterByStatusReportViewAccess` gate the
 *       comments route below already uses, category "status_report_published".
 *
 *   GET    /api/msp/status-reports/:id/comments
 *     — The full two-sided comment thread on a report (Git #3888, phase 2 of
 *       4 — sibling of #3887's customer-facing read+comment surface, same
 *       `msp_status_report_comments` table).
 *
 *   POST   /api/msp/status-reports/:id/comments
 *     — Add a comment as the MSP operator (`authorType: "msp"`). Notifies
 *       every customer-side user on the report's customer (same tenant-wide
 *       fan-out `notifyRetentionRestore` already uses) so engagement is
 *       visible without the customer having to poll.
 *
 * Auth: requireCapability("ladder.msp-operator") on every route (admits
 * MSPOperator, MSPAdmin, PlatformAdmin) plus assertCustomerAccess on every
 * :customerId-scoped route — the same ownership-check pattern every other
 * MSP-scoped route in this repo uses (msp-break-glass.ts, msp-diagnostics.ts).
 * The :id-only routes resolve the report first, then run the exact same
 * assertCustomerAccess check against its stored customerId, so a report id
 * belonging to another MSP's customer 404s rather than confirming existence.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, mspStatusReportsTable, mspStatusReportCommentsTable, usersTable } from "@workspace/db";
import { eq, desc, asc, inArray, and } from "drizzle-orm";
import { z } from "zod";
import { requireCapability, assertCustomerAccess } from "../middlewares/requireAuth.ts";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { createNotification } from "../lib/notification-center.ts";
import { logger } from "../lib/logger.ts";
import { auditPrivilegedRead, resolveAuditActorRole } from "../lib/audit.ts";
import { ladderEvaluationInput } from "../middlewares/rbac-ladder.ts";
import { evaluateAccess } from "@workspace/db/rbac/access";
import { effectiveLegacyRole } from "@workspace/db/rbac/legacy-ladder";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

/**
 * Which of these candidate recipients actually hold `ladder.customer-user` — the
 * exact floor `portal-status-reports.ts` requires to view a status report at all
 * (#3043). Subscription is not sufficient on its own: a Free-tier tenant user can
 * be opted in to the "message" notification category yet still fail this floor,
 * and would otherwise be notified about a report they get a 404 on. Uses #1704's
 * real `evaluateAccess()` / ladder RBAC input — not a bespoke role comparison,
 * per #1923's and #3043's own sequencing decision. Fails closed: a recipient the
 * RBAC model can't be consulted for is skipped, not notified.
 */
async function filterByStatusReportViewAccess(
  recipients: readonly { id: number; role: "admin" | "client"; mspRole: string }[],
): Promise<number[]> {
  const allowed: number[] = [];
  for (const recipient of recipients) {
    const rung = effectiveLegacyRole({ role: recipient.role, mspRole: recipient.mspRole }) ?? null;
    const prepared = await ladderEvaluationInput(rung, "ladder.customer-user");
    if (prepared.kind === "unavailable") {
      log.error(
        { userId: recipient.id, reason: prepared.reason },
        "status-report notification fan-out: RBAC model unavailable for a recipient — skipping (failing closed)",
      );
      continue;
    }
    const decision = evaluateAccess({ rbac: prepared.input, tier: null });
    if (decision.allowed) {
      allowed.push(recipient.id);
    } else {
      log.info(
        { userId: recipient.id, reason: decision.reason },
        "status-report notification fan-out: recipient does not hold ladder.customer-user — skipped",
      );
    }
  }
  return allowed;
}

function reportToWire(row: typeof mspStatusReportsTable.$inferSelect, authoredByName: string | null) {
  return {
    id: row.id,
    customerId: row.customerId,
    periodLabel: row.periodLabel,
    asOfDate: row.asOfDate.toISOString(),
    content: row.content,
    state: row.state,
    authoredByUserId: row.authoredByUserId,
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

const createSchema = z.object({
  periodLabel: z.string().trim().min(1).max(200),
  asOfDate: z.string().datetime({ offset: true }),
  content: z.string().trim().min(1),
});

const patchSchema = z.object({
  periodLabel: z.string().trim().min(1).max(200).optional(),
  asOfDate: z.string().datetime({ offset: true }).optional(),
  content: z.string().trim().min(1).optional(),
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /msp/customers/:customerId/status-reports — create a draft
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/msp/customers/:customerId/status-reports",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = parseInt(req.params.customerId as string, 10);
    if (isNaN(customerId)) return res.status(400).json({ error: "Invalid customerId" });

    try {
      const mspId = resolveMspIdStrict(req);
      if (mspId === null) return res.status(403).json({ error: "MSP context required" });

      if (!(await assertCustomerAccess(req.user!, customerId))) {
        return res.status(404).json({ error: "Customer not found" });
      }

      const parsed = createSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      }

      const [row] = await db
        .insert(mspStatusReportsTable)
        .values({
          mspId,
          customerId,
          periodLabel: parsed.data.periodLabel,
          asOfDate: new Date(parsed.data.asOfDate),
          content: parsed.data.content,
          state: "draft",
          authoredByUserId: req.user!.id,
        })
        .returning();

      return res.status(201).json({ report: reportToWire(row, req.user!.name ?? null) });
    } catch (err) {
      log.error({ err, customerId }, "msp-status-reports: POST create failed");
      return res.status(500).json({ error: "Failed to create status report" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /msp/customers/:customerId/status-reports — list, paginated
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/msp/customers/:customerId/status-reports",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const customerId = parseInt(req.params.customerId as string, 10);
    if (isNaN(customerId)) return res.status(400).json({ error: "Invalid customerId" });

    try {
      if (!(await assertCustomerAccess(req.user!, customerId))) {
        return res.status(404).json({ error: "Customer not found" });
      }

      const limitRaw = parseInt(String(req.query.limit ?? "50"), 10);
      const offsetRaw = parseInt(String(req.query.offset ?? "0"), 10);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
      const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

      const rows = await db
        .select()
        .from(mspStatusReportsTable)
        .where(eq(mspStatusReportsTable.customerId, customerId))
        .orderBy(desc(mspStatusReportsTable.asOfDate))
        .limit(limit)
        .offset(offset);

      const authorIds = [...new Set(rows.map((r) => r.authoredByUserId))];
      const authorRows = authorIds.length
        ? await db
            .select({ id: usersTable.id, name: usersTable.name })
            .from(usersTable)
            .where(inArray(usersTable.id, authorIds))
        : [];
      const nameById = new Map(authorRows.map((u) => [u.id, u.name]));

      await auditPrivilegedRead({
        actorUserId: req.user!.id,
        actorName: req.user!.email,
        actorRole: resolveAuditActorRole(req.user!),
        actionType: "status_report.list_viewed",
        entityType: "msp_status_report",
        tenantId: customerId,
        metadata: { count: rows.length },
      });

      return res.json({
        reports: rows.map((r) => reportToWire(r, nameById.get(r.authoredByUserId) ?? null)),
        limit,
        offset,
      });
    } catch (err) {
      log.error({ err, customerId }, "msp-status-reports: GET list failed");
      return res.status(500).json({ error: "Failed to load status reports" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /msp/status-reports/:id — one report
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/msp/status-reports/:id",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(404).json({ error: "Not found" });

    try {
      const [row] = await db.select().from(mspStatusReportsTable).where(eq(mspStatusReportsTable.id, id)).limit(1);
      if (!row) return res.status(404).json({ error: "Not found" });

      // "not found" and "not yours" both 404 — never confirm a report id
      // belonging to another MSP's customer exists.
      if (!(await assertCustomerAccess(req.user!, row.customerId))) {
        return res.status(404).json({ error: "Not found" });
      }

      const [author] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, row.authoredByUserId)).limit(1);

      return res.json({ report: reportToWire(row, author?.name ?? null) });
    } catch (err) {
      log.error({ err, id }, "msp-status-reports: GET one failed");
      return res.status(500).json({ error: "Failed to load status report" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /msp/status-reports/:id — edit while draft only
// ─────────────────────────────────────────────────────────────────────────────
router.patch(
  "/msp/status-reports/:id",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(404).json({ error: "Not found" });

    try {
      const [existing] = await db.select().from(mspStatusReportsTable).where(eq(mspStatusReportsTable.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: "Not found" });

      if (!(await assertCustomerAccess(req.user!, existing.customerId))) {
        return res.status(404).json({ error: "Not found" });
      }

      if (existing.state === "published") {
        return res.status(409).json({ error: "Published status reports cannot be edited" });
      }

      const parsed = patchSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
      }
      if (Object.keys(parsed.data).length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }

      const [row] = await db
        .update(mspStatusReportsTable)
        .set({
          ...(parsed.data.periodLabel !== undefined ? { periodLabel: parsed.data.periodLabel } : {}),
          ...(parsed.data.asOfDate !== undefined ? { asOfDate: new Date(parsed.data.asOfDate) } : {}),
          ...(parsed.data.content !== undefined ? { content: parsed.data.content } : {}),
          updatedAt: new Date(),
        })
        .where(eq(mspStatusReportsTable.id, id))
        .returning();

      const [author] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, row.authoredByUserId)).limit(1);

      return res.json({ report: reportToWire(row, author?.name ?? null) });
    } catch (err) {
      log.error({ err, id }, "msp-status-reports: PATCH failed");
      return res.status(500).json({ error: "Failed to update status report" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /msp/status-reports/:id/publish — irreversible in v1
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/msp/status-reports/:id/publish",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(404).json({ error: "Not found" });

    try {
      const [existing] = await db.select().from(mspStatusReportsTable).where(eq(mspStatusReportsTable.id, id)).limit(1);
      if (!existing) return res.status(404).json({ error: "Not found" });

      if (!(await assertCustomerAccess(req.user!, existing.customerId))) {
        return res.status(404).json({ error: "Not found" });
      }

      if (existing.state === "published") {
        return res.status(409).json({ error: "Status report is already published" });
      }

      const [row] = await db
        .update(mspStatusReportsTable)
        .set({ state: "published", publishedAt: new Date(), updatedAt: new Date() })
        .where(eq(mspStatusReportsTable.id, id))
        .returning();

      const [author] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, row.authoredByUserId)).limit(1);

      // Notify every customer-side user on this report's customer who is both
      // opted in to the "status_report_published" category (createNotification's
      // own preference check) AND actually holds ladder.customer-user (#4252 —
      // the exact permission-filter gap #1923/#3043 originally flagged, applied
      // here from day one rather than shipped unfiltered). Deny wins: a
      // recipient the RBAC model can't evaluate is skipped, never notified.
      // Best-effort/non-blocking: createNotification never throws, so a
      // delivery failure here can't fail the publish that already committed.
      void (async () => {
        const candidates = await db
          .select({ id: usersTable.id, role: usersTable.role, mspRole: usersTable.mspRole })
          .from(usersTable)
          .where(and(eq(usersTable.tenantId, row.customerId), eq(usersTable.role, "client")));

        const recipientIds = await filterByStatusReportViewAccess(candidates);
        for (const recipientId of recipientIds) {
          void createNotification({
            title: `New status report published: ${row.periodLabel}`,
            body: `Your MSP published a new status report for ${row.periodLabel}.`,
            category: "status_report_published",
            notifType: "document",
            linkPath: `/status-reports/${row.id}`,
            recipient: { type: "customer_user", userId: recipientId },
          });
        }
      })();

      return res.json({ report: reportToWire(row, author?.name ?? null) });
    } catch (err) {
      log.error({ err, id }, "msp-status-reports: POST publish failed");
      return res.status(500).json({ error: "Failed to publish status report" });
    }
  },
);

const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(10_000),
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /msp/status-reports/:id/comments — full two-sided thread
// ─────────────────────────────────────────────────────────────────────────────
router.get(
  "/msp/status-reports/:id/comments",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(404).json({ error: "Not found" });

    try {
      const [report] = await db.select().from(mspStatusReportsTable).where(eq(mspStatusReportsTable.id, id)).limit(1);
      if (!report) return res.status(404).json({ error: "Not found" });

      if (!(await assertCustomerAccess(req.user!, report.customerId))) {
        return res.status(404).json({ error: "Not found" });
      }

      const rows = await db
        .select()
        .from(mspStatusReportCommentsTable)
        .where(eq(mspStatusReportCommentsTable.reportId, id))
        .orderBy(asc(mspStatusReportCommentsTable.createdAt));

      const authorIds = [...new Set(rows.map((r) => r.authorUserId))];
      const authorRows = authorIds.length
        ? await db
            .select({ id: usersTable.id, name: usersTable.name })
            .from(usersTable)
            .where(inArray(usersTable.id, authorIds))
        : [];
      const nameById = new Map(authorRows.map((u) => [u.id, u.name]));

      return res.json({ comments: rows.map((r) => commentToWire(r, nameById.get(r.authorUserId) ?? null)) });
    } catch (err) {
      log.error({ err, id }, "msp-status-reports: GET comments failed");
      return res.status(500).json({ error: "Failed to load comments" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /msp/status-reports/:id/comments — MSP operator adds a comment
// ─────────────────────────────────────────────────────────────────────────────
router.post(
  "/msp/status-reports/:id/comments",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(404).json({ error: "Not found" });

    const parsed = createCommentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    }

    try {
      const [report] = await db.select().from(mspStatusReportsTable).where(eq(mspStatusReportsTable.id, id)).limit(1);
      if (!report) return res.status(404).json({ error: "Not found" });

      if (!(await assertCustomerAccess(req.user!, report.customerId))) {
        return res.status(404).json({ error: "Not found" });
      }

      const [row] = await db
        .insert(mspStatusReportCommentsTable)
        .values({
          reportId: id,
          authorType: "msp",
          authorUserId: req.user!.id,
          body: parsed.data.body,
        })
        .returning();

      // Notify every customer-side user on this report's customer who can
      // actually view status reports (#3043) — same tenant-wide fan-out shape
      // `notifyRetentionRestore` uses, filtered through the real ladder.customer-user
      // RBAC check before notifying, since subscription alone isn't sufficient.
      // Best-effort: createNotification never throws, so a delivery failure
      // here can't fail the comment write that already committed.
      void (async () => {
        const candidates = await db
          .select({ id: usersTable.id, role: usersTable.role, mspRole: usersTable.mspRole })
          .from(usersTable)
          .where(and(eq(usersTable.tenantId, report.customerId), eq(usersTable.role, "client")));

        const recipientIds = await filterByStatusReportViewAccess(candidates);
        for (const recipientId of recipientIds) {
          void createNotification({
            title: `New comment on your status report "${report.periodLabel}"`,
            body: parsed.data.body,
            category: "message",
            notifType: "message",
            linkPath: `/status-reports/${report.id}`,
            recipient: { type: "customer_user", userId: recipientId },
          });
        }
      })();

      const [author] = await db.select({ name: usersTable.name }).from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
      return res.status(201).json({ comment: commentToWire(row, author?.name ?? null) });
    } catch (err) {
      log.error({ err, id }, "msp-status-reports: POST comment failed");
      return res.status(500).json({ error: "Failed to add comment" });
    }
  },
);

export default router;
