/**
 * Build Tracker API — admin routes for organising Claude chats against
 * GitHub epics / issues, and a browser-extension ingest endpoint.
 *
 * Base: /admin/build-tracker
 *
 * Auth: all routes use requireAdmin EXCEPT POST /chats/ingest, which accepts
 * either an admin session cookie OR a static Bearer token in the
 * BUILD_TRACKER_INGEST_TOKEN environment variable. This lets a Chrome extension
 * call it without the user's session cookie.
 *
 * No direct database access — per CLAUDE.md the DATABASE_URL is not available
 * in this build environment. The routes are written against @workspace/db
 * (Drizzle) exactly as every other route in this codebase. Shane runs the SQL
 * migration (lib/db/migrations/manual/2026-08-09-build-tracker.sql) himself.
 */

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { db, btEpicsTable, btIssuesTable, btChatsTable } from "@workspace/db";
import { eq, desc, asc, isNull, sql, and } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "admin.build-tracker" });

const router: IRouter = Router();

// ── Ingest auth middleware ─────────────────────────────────────────────────────
// Accepts either a valid admin session (requireAdmin passes) OR a static Bearer
// token stored in BUILD_TRACKER_INGEST_TOKEN.  Used only on POST /chats/ingest.

function ingestAuth(req: Request, res: Response, next: NextFunction): void {
  const envToken = process.env.BUILD_TRACKER_INGEST_TOKEN;
  if (envToken) {
    const auth = req.headers.authorization ?? "";
    if (auth === `Bearer ${envToken}`) {
      next();
      return;
    }
  }
  // Fall through to the regular admin session check.
  requireAdmin(req, res, next);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Claude URL from conversation id
// ─────────────────────────────────────────────────────────────────────────────

function claudeUrl(conversationId: string): string {
  return `https://claude.ai/chat/${conversationId}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// EPICS
// ─────────────────────────────────────────────────────────────────────────────

/** GET /admin/build-tracker/epics — all epics with issue_count and chat_count */
router.get("/admin/build-tracker/epics", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const epics = await db
      .select({
        id:           btEpicsTable.id,
        title:        btEpicsTable.title,
        description:  btEpicsTable.description,
        status:       btEpicsTable.status,
        githubNumber: btEpicsTable.githubNumber,
        createdAt:    btEpicsTable.createdAt,
        updatedAt:    btEpicsTable.updatedAt,
        issueCount:   sql<number>`(SELECT COUNT(*) FROM bt_issues WHERE epic_id = ${btEpicsTable.id})::int`,
        chatCount:    sql<number>`(SELECT COUNT(*) FROM bt_chats  WHERE epic_id = ${btEpicsTable.id} OR issue_id IN (SELECT id FROM bt_issues WHERE epic_id = ${btEpicsTable.id}))::int`,
      })
      .from(btEpicsTable)
      .orderBy(desc(btEpicsTable.updatedAt));
    res.json(epics);
  } catch (err) {
    log.error({ err }, "GET /epics failed");
    res.status(500).json({ error: "Failed to load epics" });
  }
});

/** POST /admin/build-tracker/epics — create a new epic */
router.post("/admin/build-tracker/epics", requireAdmin, async (req: Request, res: Response) => {
  const { title, description, status, githubNumber } = req.body as {
    title?: string;
    description?: string;
    status?: string;
    githubNumber?: number;
  };
  if (!title?.trim()) { res.status(400).json({ error: "title is required" }); return; }
  try {
    const [row] = await db
      .insert(btEpicsTable)
      .values({ title: title.trim(), description: description ?? null, status: status ?? "open", githubNumber: githubNumber ?? null })
      .returning();
    log.info({ id: row.id, title: row.title }, "epic created");
    res.status(201).json(row);
  } catch (err) {
    log.error({ err }, "POST /epics failed");
    res.status(500).json({ error: "Failed to create epic" });
  }
});

/** PATCH /admin/build-tracker/epics/:id — update title/description/status */
router.patch("/admin/build-tracker/epics/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
  const { title, description, status, githubNumber } = req.body as {
    title?: string;
    description?: string;
    status?: string;
    githubNumber?: number | null;
  };
  const updates: Partial<typeof btEpicsTable.$inferInsert> = { updatedAt: new Date() };
  if (title !== undefined)         updates.title        = title.trim();
  if (description !== undefined)   updates.description  = description ?? null;
  if (status !== undefined)        updates.status       = status;
  if (githubNumber !== undefined)  updates.githubNumber = githubNumber ?? null;
  try {
    const [row] = await db.update(btEpicsTable).set(updates).where(eq(btEpicsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "not found" }); return; }
    res.json(row);
  } catch (err) {
    log.error({ err, id }, "PATCH /epics/:id failed");
    res.status(500).json({ error: "Failed to update epic" });
  }
});

/** DELETE /admin/build-tracker/epics/:id */
router.delete("/admin/build-tracker/epics/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
  try {
    await db.delete(btEpicsTable).where(eq(btEpicsTable.id, id));
    res.status(204).end();
  } catch (err) {
    log.error({ err, id }, "DELETE /epics/:id failed");
    res.status(500).json({ error: "Failed to delete epic" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ISSUES
// ─────────────────────────────────────────────────────────────────────────────

/** GET /admin/build-tracker/issues — all issues, optionally ?epicId= filtered */
router.get("/admin/build-tracker/issues", requireAdmin, async (req: Request, res: Response) => {
  try {
    const epicId = req.query.epicId ? parseInt(req.query.epicId as string, 10) : undefined;
    const issues = await db
      .select({
        id:           btIssuesTable.id,
        epicId:       btIssuesTable.epicId,
        title:        btIssuesTable.title,
        description:  btIssuesTable.description,
        status:       btIssuesTable.status,
        githubNumber: btIssuesTable.githubNumber,
        githubUrl:    btIssuesTable.githubUrl,
        labels:       btIssuesTable.labels,
        createdAt:    btIssuesTable.createdAt,
        updatedAt:    btIssuesTable.updatedAt,
        chatCount:    sql<number>`(SELECT COUNT(*) FROM bt_chats WHERE issue_id = ${btIssuesTable.id})::int`,
      })
      .from(btIssuesTable)
      .where(epicId !== undefined ? eq(btIssuesTable.epicId, epicId) : undefined)
      .orderBy(asc(btIssuesTable.status), desc(btIssuesTable.updatedAt));
    res.json(issues);
  } catch (err) {
    log.error({ err }, "GET /issues failed");
    res.status(500).json({ error: "Failed to load issues" });
  }
});

/** POST /admin/build-tracker/issues */
router.post("/admin/build-tracker/issues", requireAdmin, async (req: Request, res: Response) => {
  const { title, description, status, epicId, githubNumber, githubUrl, labels } = req.body as {
    title?: string;
    description?: string;
    status?: string;
    epicId?: number | null;
    githubNumber?: number;
    githubUrl?: string;
    labels?: string[];
  };
  if (!title?.trim()) { res.status(400).json({ error: "title is required" }); return; }
  try {
    const [row] = await db
      .insert(btIssuesTable)
      .values({
        title: title.trim(),
        description: description ?? null,
        status: status ?? "backlog",
        epicId: epicId ?? null,
        githubNumber: githubNumber ?? null,
        githubUrl: githubUrl ?? null,
        labels: labels ?? [],
      })
      .returning();
    log.info({ id: row.id, title: row.title }, "issue created");
    res.status(201).json(row);
  } catch (err) {
    log.error({ err }, "POST /issues failed");
    res.status(500).json({ error: "Failed to create issue" });
  }
});

/** PATCH /admin/build-tracker/issues/:id */
router.patch("/admin/build-tracker/issues/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
  const { title, description, status, epicId, githubNumber, githubUrl, labels } = req.body as {
    title?: string;
    description?: string;
    status?: string;
    epicId?: number | null;
    githubNumber?: number | null;
    githubUrl?: string | null;
    labels?: string[];
  };
  const updates: Partial<typeof btIssuesTable.$inferInsert> = { updatedAt: new Date() };
  if (title !== undefined)        updates.title        = title.trim();
  if (description !== undefined)  updates.description  = description ?? null;
  if (status !== undefined)       updates.status       = status;
  if (epicId !== undefined)       updates.epicId       = epicId ?? null;
  if (githubNumber !== undefined) updates.githubNumber = githubNumber ?? null;
  if (githubUrl !== undefined)    updates.githubUrl    = githubUrl ?? null;
  if (labels !== undefined)       updates.labels       = labels;
  try {
    const [row] = await db.update(btIssuesTable).set(updates).where(eq(btIssuesTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "not found" }); return; }
    res.json(row);
  } catch (err) {
    log.error({ err, id }, "PATCH /issues/:id failed");
    res.status(500).json({ error: "Failed to update issue" });
  }
});

/** DELETE /admin/build-tracker/issues/:id */
router.delete("/admin/build-tracker/issues/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
  try {
    await db.delete(btIssuesTable).where(eq(btIssuesTable.id, id));
    res.status(204).end();
  } catch (err) {
    log.error({ err, id }, "DELETE /issues/:id failed");
    res.status(500).json({ error: "Failed to delete issue" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CHATS
// ─────────────────────────────────────────────────────────────────────────────

/** GET /admin/build-tracker/chats — all chats, supports ?issueId= / ?epicId= / ?category= / ?unlinked=1 */
router.get("/admin/build-tracker/chats", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { issueId, epicId, category, unlinked } = req.query as Record<string, string | undefined>;
    let whereClause;
    if (issueId)          whereClause = eq(btChatsTable.issueId,  parseInt(issueId, 10));
    else if (epicId)      whereClause = eq(btChatsTable.epicId,   parseInt(epicId, 10));
    else if (category)    whereClause = eq(btChatsTable.category, category);
    else if (unlinked === "1") {
      whereClause = and(isNull(btChatsTable.issueId), isNull(btChatsTable.epicId), isNull(btChatsTable.category));
    }

    const rows = await db
      .select()
      .from(btChatsTable)
      .where(whereClause)
      .orderBy(desc(btChatsTable.createdAt));

    const chats = rows.map((c) => ({ ...c, claudeUrl: claudeUrl(c.conversationId) }));
    res.json(chats);
  } catch (err) {
    log.error({ err }, "GET /chats failed");
    res.status(500).json({ error: "Failed to load chats" });
  }
});

/** POST /admin/build-tracker/chats — create a chat link directly */
router.post("/admin/build-tracker/chats", requireAdmin, async (req: Request, res: Response) => {
  const { conversationId, title, issueId, epicId, category, notes } = req.body as {
    conversationId?: string;
    title?: string;
    issueId?: number | null;
    epicId?: number | null;
    category?: string;
    notes?: string;
  };
  if (!conversationId?.trim()) { res.status(400).json({ error: "conversationId is required" }); return; }
  try {
    const [row] = await db
      .insert(btChatsTable)
      .values({
        conversationId: conversationId.trim(),
        title: title?.trim() || conversationId.trim(),
        issueId: issueId ?? null,
        epicId: epicId ?? null,
        category: category ?? null,
        notes: notes ?? null,
      })
      .returning();
    res.status(201).json({ ...row, claudeUrl: claudeUrl(row.conversationId) });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("unique")) {
      res.status(409).json({ error: "A chat with this conversation_id already exists" });
      return;
    }
    log.error({ err }, "POST /chats failed");
    res.status(500).json({ error: "Failed to create chat" });
  }
});

/**
 * POST /admin/build-tracker/chats/ingest
 *
 * Browser-extension webhook. Payload:
 *   { "conversation_id": "13e012ad-5aa8-401a-9905-dcb0ec545147" }
 *
 * Creates a stub chat record (title = conversation_id, unlinked). If the
 * conversation_id already exists, returns the existing record with 200 so
 * the extension can call it idempotently on every page load.
 *
 * Auth: admin session cookie OR Authorization: Bearer <BUILD_TRACKER_INGEST_TOKEN>
 */
router.post("/admin/build-tracker/chats/ingest", ingestAuth, async (req: Request, res: Response) => {
  const { conversation_id } = req.body as { conversation_id?: string };
  if (!conversation_id?.trim()) {
    res.status(400).json({ error: "conversation_id is required" });
    return;
  }
  const id = conversation_id.trim();
  try {
    // Upsert: if already exists return it, otherwise insert stub.
    const existing = await db
      .select()
      .from(btChatsTable)
      .where(eq(btChatsTable.conversationId, id))
      .limit(1);

    if (existing.length > 0) {
      const row = existing[0];
      log.debug({ conversationId: id }, "ingest: already exists");
      res.json({ ...row, claudeUrl: claudeUrl(row.conversationId), created: false });
      return;
    }

    const [row] = await db
      .insert(btChatsTable)
      .values({ conversationId: id, title: id })
      .returning();

    log.info({ conversationId: id }, "ingest: new chat stub created");
    res.status(201).json({ ...row, claudeUrl: claudeUrl(row.conversationId), created: true });
  } catch (err) {
    log.error({ err, conversationId: id }, "POST /chats/ingest failed");
    res.status(500).json({ error: "Ingest failed" });
  }
});

/** PATCH /admin/build-tracker/chats/:id */
router.patch("/admin/build-tracker/chats/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
  const { title, issueId, epicId, category, notes } = req.body as {
    title?: string;
    issueId?: number | null;
    epicId?: number | null;
    category?: string | null;
    notes?: string | null;
  };
  const updates: Partial<typeof btChatsTable.$inferInsert> = { updatedAt: new Date() };
  if (title !== undefined)    updates.title    = title.trim();
  if (issueId !== undefined)  updates.issueId  = issueId ?? null;
  if (epicId !== undefined)   updates.epicId   = epicId ?? null;
  if (category !== undefined) updates.category = category ?? null;
  if (notes !== undefined)    updates.notes    = notes ?? null;
  try {
    const [row] = await db.update(btChatsTable).set(updates).where(eq(btChatsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "not found" }); return; }
    res.json({ ...row, claudeUrl: claudeUrl(row.conversationId) });
  } catch (err) {
    log.error({ err, id }, "PATCH /chats/:id failed");
    res.status(500).json({ error: "Failed to update chat" });
  }
});

/** DELETE /admin/build-tracker/chats/:id */
router.delete("/admin/build-tracker/chats/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
  try {
    await db.delete(btChatsTable).where(eq(btChatsTable.id, id));
    res.status(204).end();
  } catch (err) {
    log.error({ err, id }, "DELETE /chats/:id failed");
    res.status(500).json({ error: "Failed to delete chat" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GITHUB SYNC
// Pulls milestones → bt_epics and all issues → bt_issues from
// shanemccaw/Shane-McCaw-MSP. Uses GITHUB_TOKEN env var (PAT with repo:read).
// Upserts on github_number so re-running is fully idempotent.
// ─────────────────────────────────────────────────────────────────────────────

const GITHUB_OWNER = "shanemccaw";
const GITHUB_REPO_NAME = "Shane-McCaw-MSP";
const GITHUB_API = "https://api.github.com";

async function ghFetch(path: string): Promise<Response> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN env var not set");
  return fetch(`${GITHUB_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
}

type GhIssueStatus = "backlog" | "in_progress" | "done" | "closed";

/** POST /admin/build-tracker/github-sync */
router.post("/admin/build-tracker/github-sync", requireAdmin, async (_req: Request, res: Response) => {
  if (!process.env.GITHUB_TOKEN) {
    res.status(503).json({ error: "GITHUB_TOKEN is not set on this server" });
    return;
  }
  try {
    // ── 1. Milestones → bt_epics ──────────────────────────────────────────
    const milestonesRes = await ghFetch(
      `/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/milestones?state=all&per_page=100`,
    );
    if (!milestonesRes.ok) {
      res.status(502).json({ error: `GitHub milestones fetch failed: ${milestonesRes.status}` });
      return;
    }
    const milestones = (await milestonesRes.json()) as Array<{
      number: number; title: string; description: string | null; state: string;
    }>;

    let epicsUpserted = 0;
    for (const m of milestones) {
      const epicStatus = m.state === "closed" ? "closed" : "open";
      const existing = await db
        .select({ id: btEpicsTable.id })
        .from(btEpicsTable)
        .where(eq(btEpicsTable.githubNumber, m.number))
        .limit(1);
      if (existing.length > 0) {
        await db.update(btEpicsTable)
          .set({ title: m.title, description: m.description ?? null, status: epicStatus, updatedAt: new Date() })
          .where(eq(btEpicsTable.githubNumber, m.number));
      } else {
        await db.insert(btEpicsTable)
          .values({ title: m.title, description: m.description ?? null, status: epicStatus, githubNumber: m.number });
      }
      epicsUpserted++;
    }

    // ── 2. Build milestone → epic id map ─────────────────────────────────
    const allEpics = await db
      .select({ id: btEpicsTable.id, githubNumber: btEpicsTable.githubNumber })
      .from(btEpicsTable);
    const epicByMilestone = new Map(
      allEpics.filter((e) => e.githubNumber !== null).map((e) => [e.githubNumber!, e.id]),
    );

    // ── 3. Issues → bt_issues (paginated, all states) ────────────────────
    let page = 1;
    let issuesUpserted = 0;

    while (true) {
      const issuesRes = await ghFetch(
        `/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/issues?state=all&per_page=100&page=${page}`,
      );
      if (!issuesRes.ok) break;
      const ghIssues = (await issuesRes.json()) as Array<{
        number: number; title: string; body: string | null;
        state: string; html_url: string;
        milestone: { number: number } | null;
        labels: Array<{ name: string }>;
        pull_request?: unknown;
      }>;
      if (!ghIssues.length) break;

      for (const gh of ghIssues) {
        if (gh.pull_request) continue; // GitHub /issues includes PRs; skip them
        const issueStatus: GhIssueStatus = gh.state === "closed" ? "closed" : "backlog";
        const epicId = gh.milestone ? (epicByMilestone.get(gh.milestone.number) ?? null) : null;
        const labels = gh.labels.map((l) => l.name);

        const existing = await db
          .select({ id: btIssuesTable.id })
          .from(btIssuesTable)
          .where(eq(btIssuesTable.githubNumber, gh.number))
          .limit(1);

        if (existing.length > 0) {
          await db.update(btIssuesTable)
            .set({ title: gh.title, description: gh.body ?? null, status: issueStatus, epicId, githubUrl: gh.html_url, labels, updatedAt: new Date() })
            .where(eq(btIssuesTable.githubNumber, gh.number));
        } else {
          await db.insert(btIssuesTable)
            .values({ title: gh.title, description: gh.body ?? null, status: issueStatus, epicId, githubNumber: gh.number, githubUrl: gh.html_url, labels });
        }
        issuesUpserted++;
      }
      if (ghIssues.length < 100) break;
      page++;
    }

    log.info({ epicsUpserted, issuesUpserted }, "GitHub sync complete");
    res.json({ epics: epicsUpserted, issues: issuesUpserted });
  } catch (err) {
    log.error({ err }, "github-sync failed");
    res.status(500).json({ error: "GitHub sync failed" });
  }
});

export default router;

