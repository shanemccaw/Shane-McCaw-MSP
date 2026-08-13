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
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { eq, desc } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "admin.content-studio" });

const router = Router();

function parseId(params: Request["params"], key: string): number {
  return parseInt(String(params[key] ?? ""), 10);
}

const AI_DRAFT_SYSTEM_PROMPT = `You write short-form LinkedIn posts for a Microsoft 365 consulting/MSP business, in the voice of a senior, professional advisor. Style rules:
- 3-6 short paragraphs or lines, LinkedIn-native (no markdown headers, minimal hashtags — at most 2-3 at the very end if relevant)
- Confident, clear, and results-oriented — a trusted advisor's voice, not a vendor pitch
- No filler openers like "Exciting news!" or "I hope this finds you well"
- Output ONLY the post body text — no preamble, no explanation, no quotes around it`;

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

// ── POST /admin/content-studio/posts/:id/ai-draft ────────────────────────────
// The compose peek's "AI Assist" button — generates a first-draft body from a
// topic/bullet the person typed in. Persists straight to the row (aiGenerated
// true) so the client can just swap in the returned row, same shape as every
// other mutation endpoint here; the peek still requires an explicit Schedule
// afterward, this never touches `status`.

router.post("/admin/content-studio/posts/:id/ai-draft", requireAdmin, async (req: Request, res: Response) => {
  const id = parseId(req.params, "id");
  const { topic } = req.body as { topic?: string };
  if (!topic?.trim()) {
    res.status(400).json({ error: "topic is required" });
    return;
  }

  let draft: string;
  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      system: AI_DRAFT_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Write a LinkedIn post about: ${topic.trim()}` }],
    });
    const block = msg.content.find((b) => b.type === "text");
    if (!block || block.type !== "text" || !block.text.trim()) {
      throw new Error("No text response from AI");
    }
    draft = block.text.trim();
  } catch (e) {
    log.warn({ err: e, id }, "AI draft generation failed");
    res.status(502).json({ error: e instanceof Error ? e.message : "AI generation failed" });
    return;
  }

  try {
    const [row] = await db.update(contentPostsTable)
      .set({ body: draft, aiGenerated: true, updatedAt: new Date() })
      .where(eq(contentPostsTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (e) {
    log.warn({ err: e, id }, "failed to persist AI draft for content_posts row");
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ── POST /admin/content-studio/posts/:id/schedule ────────────────────────────
// Flips status to scheduled — the dispatcher workflow's fan_out_query is what
// actually picks it up and posts it once scheduled_for arrives. Git #711:
// validates scheduledFor is a real, parseable, future date first — flipping
// status unconditionally let a garbage/empty schedule "succeed" and the post
// just sat there forever, since the dispatcher's fan-out query never matched
// it against now().

router.post("/admin/content-studio/posts/:id/schedule", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    const [existing] = await db.select().from(contentPostsTable).where(eq(contentPostsTable.id, id));
    if (!existing) { res.status(404).json({ error: "Not found" }); return; }
    if (!existing.scheduledFor) {
      res.status(400).json({ error: "Set a scheduled time before scheduling this post" });
      return;
    }
    const when = new Date(existing.scheduledFor);
    if (Number.isNaN(when.getTime())) {
      res.status(400).json({ error: "Scheduled time is not a valid date" });
      return;
    }
    if (when.getTime() <= Date.now()) {
      res.status(400).json({ error: "Scheduled time must be in the future" });
      return;
    }
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
