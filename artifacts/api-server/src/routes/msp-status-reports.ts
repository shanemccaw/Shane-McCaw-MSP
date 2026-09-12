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
 *       publishedAt stamp.
 *
 * Auth: requireCapability("ladder.msp-operator") on every route (admits
 * MSPOperator, MSPAdmin, PlatformAdmin) plus assertCustomerAccess on every
 * :customerId-scoped route — the same ownership-check pattern every other
 * MSP-scoped route in this repo uses (msp-break-glass.ts, msp-diagnostics.ts).
 * The two :id-only routes resolve the report first, then run the exact same
 * assertCustomerAccess check against its stored customerId, so a report id
 * belonging to another MSP's customer 404s rather than confirming existence.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, mspStatusReportsTable, usersTable } from "@workspace/db";
import { eq, desc, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireCapability, assertCustomerAccess } from "../middlewares/requireAuth.ts";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

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

      return res.json({ report: reportToWire(row, author?.name ?? null) });
    } catch (err) {
      log.error({ err, id }, "msp-status-reports: POST publish failed");
      return res.status(500).json({ error: "Failed to publish status report" });
    }
  },
);

export default router;
