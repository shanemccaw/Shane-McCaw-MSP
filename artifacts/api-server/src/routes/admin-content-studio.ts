/**
 * Content Studio backend (Phase F, Git #686, epic #601) — CRUD behind
 * `contentStudioStore.ts`'s admin-panel store. The actual LinkedIn posting
 * and retry/backoff live in the seeded "__system__: Content Studio LinkedIn
 * Dispatcher" workflow (seed-system-workflows.ts) via the existing
 * `post_linkedin` node and the workflow engine's own `retry` node — this
 * file only owns the content_posts row itself (create/edit/schedule/delete),
 * never posts to LinkedIn directly.
 */

import { Router, type Request, type Response } from "express";
import { db, contentPostsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "admin.content-studio" });

const router = Router();

function parseId(params: Request["params"], key: string): number {
  return parseInt(String(params[key] ?? ""), 10);
}

// ── GET /admin/content-studio/posts ──────────────────────────────────────────

router.get("/admin/content-studio/posts", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(contentPostsTable).orderBy(desc(contentPostsTable.createdAt));
    res.json(rows);
  } catch (e) {
    log.warn({ err: e }, "failed to list content_posts");
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── POST /admin/content-studio/posts ─────────────────────────────────────────
// Compose button — always a fresh, empty draft. Body/schedule are filled in
// afterward via PATCH, which is how the peek's `edits` write straight through.

router.post("/admin/content-studio/posts", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [row] = await db.insert(contentPostsTable).values({ status: "draft" }).returning();
    res.json(row);
  } catch (e) {
    log.warn({ err: e }, "failed to create content_posts draft");
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── PATCH /admin/content-studio/posts/:id ────────────────────────────────────

router.patch("/admin/content-studio/posts/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    const { body, scheduledFor } = req.body as { body?: string; scheduledFor?: string | null };
    const updateData: Partial<typeof contentPostsTable.$inferInsert> & { updatedAt: Date } = { updatedAt: new Date() };
    if (body !== undefined) updateData.body = body;
    if (scheduledFor !== undefined) updateData.scheduledFor = scheduledFor ? new Date(scheduledFor) : null;
    const [row] = await db.update(contentPostsTable).set(updateData).where(eq(contentPostsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) {
    log.warn({ err: e }, "failed to update content_posts row");
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── POST /admin/content-studio/posts/:id/schedule ────────────────────────────
// Flips status to scheduled — the dispatcher workflow's fan_out_query is what
// actually picks it up and posts it once scheduled_for arrives.

router.post("/admin/content-studio/posts/:id/schedule", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    const [row] = await db.update(contentPostsTable)
      .set({ status: "scheduled", updatedAt: new Date() })
      .where(eq(contentPostsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) {
    log.warn({ err: e }, "failed to schedule content_posts row");
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── DELETE /admin/content-studio/posts/:id ───────────────────────────────────

router.delete("/admin/content-studio/posts/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    await db.delete(contentPostsTable).where(eq(contentPostsTable.id, id));
    res.json({ success: true });
  } catch (e) {
    log.warn({ err: e }, "failed to delete content_posts row");
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
