/**
 * Admin Exception Tracking Routes
 *
 * Operator surface over the exception_groups / exception_occurrences tables
 * (fed by lib/exception-tracker.ts). Groups are one row per unique
 * file:line:normalized-message fingerprint; occurrences are one row per
 * instance.
 *   GET   /api/admin/exceptions                        — list groups (filter by status, sort by count/lastSeen)
 *   GET   /api/admin/exceptions/:fingerprint           — group detail + recent occurrences
 *   PATCH /api/admin/exceptions/:fingerprint/resolve   — mark resolved
 *   PATCH /api/admin/exceptions/:fingerprint/suppress  — suppress (reason required)
 *   PATCH /api/admin/exceptions/:fingerprint/unsuppress — reopen a suppressed group
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, exceptionGroupsTable, exceptionOccurrencesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireAdmin } from "../middlewares/requireAuth";

const router: IRouter = Router();
const log = logger.child({ channel: "admin.exceptions" });

const VALID_STATUSES = ["open", "suppressed", "resolved"] as const;
type Status = (typeof VALID_STATUSES)[number];

// GET /api/admin/exceptions — list groups.
router.get("/admin/exceptions", requireAdmin, async (req: Request, res: Response) => {
  try {
    const statusParam = String(req.query["status"] ?? "open");
    const sort = String(req.query["sort"] ?? "lastSeen");
    const limit = Math.min(parseInt(String(req.query["limit"] ?? "50"), 10) || 50, 200);

    const orderBy =
      sort === "count"
        ? desc(exceptionGroupsTable.occurrenceCount)
        : desc(exceptionGroupsTable.lastSeenAt);

    const base = db.select().from(exceptionGroupsTable);
    const filtered =
      statusParam !== "all" && (VALID_STATUSES as readonly string[]).includes(statusParam)
        ? base.where(eq(exceptionGroupsTable.status, statusParam as Status))
        : base;

    const groups = await filtered.orderBy(orderBy).limit(limit);
    res.json({ groups });
  } catch (err) {
    log.error({ err }, "GET /admin/exceptions failed");
    res.status(500).json({ error: "Failed to list exception groups" });
  }
});

// GET /api/admin/exceptions/:fingerprint — group detail + recent occurrences.
router.get("/admin/exceptions/:fingerprint", requireAdmin, async (req: Request, res: Response) => {
  const fingerprint = String(req.params["fingerprint"] ?? "");
  if (!fingerprint) {
    res.status(400).json({ error: "Invalid fingerprint" });
    return;
  }

  try {
    const [group] = await db
      .select()
      .from(exceptionGroupsTable)
      .where(eq(exceptionGroupsTable.fingerprint, fingerprint))
      .limit(1);
    if (!group) {
      res.status(404).json({ error: "Exception group not found" });
      return;
    }

    const occurrences = await db
      .select()
      .from(exceptionOccurrencesTable)
      .where(eq(exceptionOccurrencesTable.fingerprint, fingerprint))
      .orderBy(desc(exceptionOccurrencesTable.occurredAt))
      .limit(100);

    res.json({ group, occurrences });
  } catch (err) {
    log.error({ err }, "GET /admin/exceptions/:fingerprint failed");
    res.status(500).json({ error: "Failed to load exception group" });
  }
});

// PATCH /api/admin/exceptions/:fingerprint/resolve — mark resolved.
router.patch(
  "/admin/exceptions/:fingerprint/resolve",
  requireAdmin,
  async (req: Request, res: Response) => {
    const fingerprint = String(req.params["fingerprint"] ?? "");
    if (!fingerprint) {
      res.status(400).json({ error: "Invalid fingerprint" });
      return;
    }
    const { note } = req.body as Record<string, unknown>;

    try {
      const updated = await db
        .update(exceptionGroupsTable)
        .set({
          status: "resolved",
          resolvedAt: new Date(),
          resolvedBy: req.user?.id ?? null,
          resolutionNote: typeof note === "string" ? note : null,
        })
        .where(eq(exceptionGroupsTable.fingerprint, fingerprint))
        .returning({ fingerprint: exceptionGroupsTable.fingerprint });
      if (!updated.length) {
        res.status(404).json({ error: "Exception group not found" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      log.error({ err }, "PATCH /admin/exceptions/:fingerprint/resolve failed");
      res.status(500).json({ error: "Failed to resolve exception group" });
    }
  },
);

// PATCH /api/admin/exceptions/:fingerprint/suppress — suppress (reason required).
router.patch(
  "/admin/exceptions/:fingerprint/suppress",
  requireAdmin,
  async (req: Request, res: Response) => {
    const fingerprint = String(req.params["fingerprint"] ?? "");
    if (!fingerprint) {
      res.status(400).json({ error: "Invalid fingerprint" });
      return;
    }
    const { reason } = req.body as Record<string, unknown>;
    if (typeof reason !== "string" || !reason.trim()) {
      res.status(400).json({ error: "A suppression reason is required" });
      return;
    }

    try {
      const updated = await db
        .update(exceptionGroupsTable)
        .set({
          status: "suppressed",
          suppressedAt: new Date(),
          suppressedBy: req.user?.id ?? null,
          suppressionReason: reason,
        })
        .where(eq(exceptionGroupsTable.fingerprint, fingerprint))
        .returning({ fingerprint: exceptionGroupsTable.fingerprint });
      if (!updated.length) {
        res.status(404).json({ error: "Exception group not found" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      log.error({ err }, "PATCH /admin/exceptions/:fingerprint/suppress failed");
      res.status(500).json({ error: "Failed to suppress exception group" });
    }
  },
);

// PATCH /api/admin/exceptions/:fingerprint/unsuppress — reopen a suppressed group.
router.patch(
  "/admin/exceptions/:fingerprint/unsuppress",
  requireAdmin,
  async (req: Request, res: Response) => {
    const fingerprint = String(req.params["fingerprint"] ?? "");
    if (!fingerprint) {
      res.status(400).json({ error: "Invalid fingerprint" });
      return;
    }

    try {
      const updated = await db
        .update(exceptionGroupsTable)
        .set({
          status: "open",
          suppressedAt: null,
          suppressedBy: null,
          suppressionReason: null,
        })
        .where(eq(exceptionGroupsTable.fingerprint, fingerprint))
        .returning({ fingerprint: exceptionGroupsTable.fingerprint });
      if (!updated.length) {
        res.status(404).json({ error: "Exception group not found" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      log.error({ err }, "PATCH /admin/exceptions/:fingerprint/unsuppress failed");
      res.status(500).json({ error: "Failed to unsuppress exception group" });
    }
  },
);

// POST /api/admin/exceptions/_test/trigger — throws a deliberate test error
// through the real logger.error({ err }) → captureException path, so the full
// pipeline (group upsert, occurrence insert, auto-reopen, suppression) can be
// exercised end-to-end without needing a real bug or Simulator Studio.
//
// The `marker` query param varies the message so different markers land in
// different groups. Use NON-numeric markers (?marker=alpha vs ?marker=beta) —
// numbers are normalized to <n> for fingerprinting, so ?marker=1 vs ?marker=2
// would (correctly) collapse into the same group.
router.post("/admin/exceptions/_test/trigger", requireAdmin, (req: Request, res: Response) => {
  const marker = String(req.query["marker"] ?? "default");
  const testErr = new Error(`[TEST] Synthetic exception trigger (marker=${marker})`);
  log.error({ err: testErr }, "Synthetic test exception triggered via admin API");
  res.json({ ok: true, message: "Test exception captured — check GET /admin/exceptions" });
});

export default router;
