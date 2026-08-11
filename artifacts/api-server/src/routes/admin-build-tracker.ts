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
        milestoneId:  btEpicsTable.milestoneId,
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

/** PATCH /admin/build-tracker/epics/:id — update title/description/status/milestoneId */
router.patch("/admin/build-tracker/epics/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
  const { title, description, status, githubNumber, milestoneId } = req.body as {
    title?: string;
    description?: string;
    status?: string;
    githubNumber?: number | null;
    milestoneId?: number | null;
  };
  const updates: Partial<typeof btEpicsTable.$inferInsert> = { updatedAt: new Date() };
  if (title !== undefined)         updates.title        = title.trim();
  if (description !== undefined)   updates.description  = description ?? null;
  if (status !== undefined)        updates.status       = status;
  if (githubNumber !== undefined)  updates.githubNumber = githubNumber ?? null;

  try {
    const [row] = await db.update(btEpicsTable).set(updates).where(eq(btEpicsTable.id, id)).returning();
    const ghNum = githubNumber || row?.githubNumber;

    if (process.env.GITHUB_TOKEN && ghNum && milestoneId !== undefined) {
      try {
        await ghFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/issues/${ghNum}`, {
          method: "PATCH",
          body: JSON.stringify({
            milestone: milestoneId ?? null,
          }),
        });
      } catch (err) {
        log.error({ err, id, ghNum }, "Failed to update GitHub issue milestone remote");
      }
    }

    // GitHub's REST issue state only has open/closed — "in_progress" is a
    // local-only refinement this tool invented on top of that (see the sync
    // reconciliation below). Any status PATCH that lands on/off "closed"
    // pushes the matching real state to the GitHub issue so a local status
    // change is actually visible there, not just in this tool. The separate
    // Projects v2 "Status" board field (In Progress/Done/etc, a GraphQL-only
    // concept the REST state above can't touch) gets pushed too.
    if (process.env.GITHUB_TOKEN && ghNum && status !== undefined) {
      try {
        await ghFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/issues/${ghNum}`, {
          method: "PATCH",
          body: JSON.stringify({ state: status === "closed" ? "closed" : "open" }),
        });
      } catch (err) {
        log.error({ err, id, ghNum, status }, "Failed to push epic status to GitHub issue");
      }
      await pushStatusToProjects(ghNum, status);
    }

    if (!row) { res.status(404).json({ error: "not found" }); return; }
    res.json({ ...row, milestoneId });
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
// MILESTONES
// ─────────────────────────────────────────────────────────────────────────────

/** GET /admin/build-tracker/milestones — real GitHub milestones */
router.get("/admin/build-tracker/milestones", requireAdmin, async (_req: Request, res: Response) => {
  try {
    if (process.env.GITHUB_TOKEN) {
      const msRes = await ghFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/milestones?state=all`);
      if (msRes.ok) {
        const ghMsList = await msRes.json();
        const milestones = ghMsList.map((m: any) => ({
          id: m.number,
          title: m.title,
          description: m.description,
          startDate: new Date().toISOString().split("T")[0],
          targetDate: m.due_on ? m.due_on.split("T")[0] : null,
          status: m.state,
          githubNumber: m.number,
          createdAt: m.created_at,
          updatedAt: m.updated_at,
          epicCount: m.open_issues + m.closed_issues,
        }));
        res.json(milestones);
        return;
      }
    }
    res.json([]);
  } catch (err) {
    log.error({ err }, "GET /milestones failed");
    res.status(500).json({ error: "Failed to load milestones" });
  }
});

/** POST /admin/build-tracker/milestones */
router.post("/admin/build-tracker/milestones", requireAdmin, async (req: Request, res: Response) => {
  const { title, description, targetDate, startDate, status } = req.body as {
    title?: string;
    description?: string;
    targetDate?: string;
    startDate?: string;
    status?: string;
  };
  if (!title?.trim()) {
    res.status(400).json({ error: "title is required" });
    return;
  }

  let ghNumber: number | null = null;
  if (process.env.GITHUB_TOKEN) {
    try {
      const ghRes = await ghFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/milestones`, {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: description?.trim() || undefined,
          due_on: targetDate ? `${targetDate}T23:59:59Z` : undefined,
          state: status === "closed" ? "closed" : "open",
        }),
      });
      if (ghRes.ok) {
        const ghData = await ghRes.json();
        ghNumber = ghData.number;
      }
    } catch (err) {
      log.error({ err }, "Failed to create GitHub milestone remotely");
    }
  }

  const milestone = {
    id: ghNumber || Date.now(),
    title: title.trim(),
    description: description?.trim() || null,
    startDate: startDate || new Date().toISOString().split("T")[0],
    targetDate: targetDate || null,
    status: status || "open",
    githubNumber: ghNumber,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    epicCount: 0,
  };
  res.status(201).json(milestone);
});

/** PATCH /admin/build-tracker/milestones/:id — update title/description/status/dates */
router.patch("/admin/build-tracker/milestones/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

  const { title, description, status, targetDate, startDate, githubNumber } = req.body as {
    title?: string;
    description?: string;
    status?: string;
    targetDate?: string;
    startDate?: string;
    githubNumber?: number;
  };

  const milestoneNumber = githubNumber || id;
  if (process.env.GITHUB_TOKEN && milestoneNumber) {
    try {
      await ghFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/milestones/${milestoneNumber}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...(title ? { title: title.trim() } : {}),
          ...(description !== undefined ? { description: description?.trim() || null } : {}),
          ...(targetDate !== undefined ? { due_on: targetDate ? `${targetDate}T23:59:59Z` : null } : {}),
          ...(status ? { state: status === "closed" ? "closed" : "open" } : {}),
        }),
      });
    } catch (err) {
      log.error({ err, id }, "Failed to update remote GitHub milestone");
    }
  }

  res.json({ id, title, description, status, startDate, targetDate });
});

/** DELETE /admin/build-tracker/milestones/:id */
router.delete("/admin/build-tracker/milestones/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

  const githubNumber = req.query.githubNumber ? parseInt(req.query.githubNumber as string, 10) : undefined;
  const milestoneNumber = githubNumber || id;

  if (process.env.GITHUB_TOKEN && milestoneNumber) {
    try {
      await ghFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/milestones/${milestoneNumber}`, {
        method: "PATCH",
        body: JSON.stringify({ state: "closed" }),
      });
    } catch (err) {
      log.error({ err, id }, "Failed to close remote GitHub milestone");
    }
  }

  res.status(204).end();
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
        milestoneId:  btIssuesTable.milestoneId,
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

/**
 * PATCH /admin/build-tracker/issues/:id
 *
 * Auth widened to ingestAuth (Git #714 follow-up) — Shane: "this is
 * replacing that manual step in GitHub... when I close it in this, that IS
 * me closing it." The panel's complete-row click now calls this with
 * {status: "closed"} to actually close the real GitHub issue (this route
 * already pushed status to GitHub for the admin panel's own issue editing —
 * reused as-is, not a new capability), not just mark it done locally.
 */
router.patch("/admin/build-tracker/issues/:id", ingestAuth, async (req: Request, res: Response) => {
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
    const ghNum = githubNumber || row?.githubNumber;

    // GitHub's REST issue state only has open/closed — "backlog"/"in_progress"/
    // "done" are local refinements this tool invented on top of that. Without
    // this, a local status change never reached GitHub at all: Sync only ever
    // pulled FROM GitHub, so closing/reopening an issue here silently diverged
    // from the real issue on GitHub forever, even after a resync. The
    // Projects v2 "Status" board field (a GraphQL-only concept the REST
    // state above can't touch — Shane confirmed this issue, its real
    // mechanism) gets pushed too.
    if (process.env.GITHUB_TOKEN && ghNum && status !== undefined) {
      try {
        await ghFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/issues/${ghNum}`, {
          method: "PATCH",
          body: JSON.stringify({ state: status === "closed" ? "closed" : "open" }),
        });
      } catch (err) {
        log.error({ err, id, ghNum, status }, "Failed to push issue status to GitHub issue");
      }
      await pushStatusToProjects(ghNum, status);
    }

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
 *   { "conversation_id": "13e012ad-...", "title"?: "...", "issueId"?: 5, "epicId"?: 9 }
 *
 * `title` is optional and meant to be `document.title` read straight off the
 * live claude.ai tab by the extension — there's no server-side way to get a
 * conversation's real title (claude.ai has no public API for it, and a plain
 * HTTP GET on the chat URL 403s without the user's session cookie anyway,
 * confirmed directly rather than assumed). The extension is the one place
 * that's already inside an authenticated, JS-rendered page, so it's the only
 * realistic source for this.
 *
 * `issueId`/`epicId` are optional and come from the extension's claude.ai-side
 * panel (GET /extension/board below) — Shane picking "this chat is about
 * that issue" while still inside the chat, instead of triaging it later.
 * Same non-clobbering rule as title: applied ONLY when the chat is currently
 * unlinked (no issueId AND no epicId set yet). If he already decided this
 * chat belongs somewhere else, re-sending a different id here is a no-op for
 * linking — relinking stays a deliberate action inside Build Tracker itself,
 * not something a background sync call can silently override.
 *
 * Creates a stub chat record (title = given title, or conversation_id if
 * none was sent; issueId/epicId applied as given) if the conversation_id is
 * new. If it already exists: title backfills only while still stubbed as the
 * conversation_id, issueId/epicId apply only while still unlinked — neither
 * ever overwrites a choice Shane already made. Always returns 200 with the
 * current record either way, so the extension can call it idempotently on
 * every page load/title change without needing to track what it already sent.
 *
 * Auth: admin session cookie OR Authorization: Bearer <BUILD_TRACKER_INGEST_TOKEN>
 */
router.post("/admin/build-tracker/chats/ingest", ingestAuth, async (req: Request, res: Response) => {
  const { conversation_id, title, issueId, epicId } = req.body as {
    conversation_id?: string;
    title?: string;
    issueId?: number | null;
    epicId?: number | null;
  };
  if (!conversation_id?.trim()) {
    res.status(400).json({ error: "conversation_id is required" });
    return;
  }
  const id = conversation_id.trim();
  const incomingTitle = title?.trim() || null;
  const incomingIssueId = typeof issueId === "number" ? issueId : null;
  const incomingEpicId = typeof epicId === "number" ? epicId : null;
  try {
    // Upsert: if already exists, maybe backfill its title/link; otherwise insert stub.
    const existing = await db
      .select()
      .from(btChatsTable)
      .where(eq(btChatsTable.conversationId, id))
      .limit(1);

    if (existing.length > 0) {
      let row = existing[0];
      const patch: Partial<typeof btChatsTable.$inferInsert> = {};
      if (incomingTitle && row.title === row.conversationId) patch.title = incomingTitle;
      if ((incomingIssueId !== null || incomingEpicId !== null) && row.issueId === null && row.epicId === null) {
        patch.issueId = incomingIssueId;
        patch.epicId = incomingIssueId ? null : incomingEpicId;
      }
      if (Object.keys(patch).length > 0) {
        [row] = await db
          .update(btChatsTable)
          .set({ ...patch, updatedAt: new Date() })
          .where(eq(btChatsTable.id, row.id))
          .returning();
        log.info({ conversationId: id, patch: Object.keys(patch) }, "ingest: backfilled existing stub");
      } else {
        log.debug({ conversationId: id }, "ingest: already exists, nothing to backfill");
      }
      res.json({ ...row, claudeUrl: claudeUrl(row.conversationId), created: false });
      return;
    }

    const [row] = await db
      .insert(btChatsTable)
      .values({
        conversationId: id,
        title: incomingTitle ?? id,
        issueId: incomingIssueId,
        epicId: incomingIssueId ? null : incomingEpicId,
      })
      .returning();

    log.info({ conversationId: id, hadTitle: !!incomingTitle, linked: !!(incomingIssueId || incomingEpicId) }, "ingest: new chat stub created");
    res.status(201).json({ ...row, claudeUrl: claudeUrl(row.conversationId), created: true });
  } catch (err) {
    log.error({ err, conversationId: id }, "POST /chats/ingest failed");
    res.status(500).json({ error: "Ingest failed" });
  }
});

/**
 * GET /admin/build-tracker/extension/board?conversationId=<uuid>
 *
 * Companion to the browser extension's claude.ai-side panel: a trimmed,
 * open-work-only view of Milestones/Epics/Issues so Shane can see what he's
 * working on without leaving the chat, plus — when conversationId is given —
 * whether *this* chat is already linked to something. Deliberately not the
 * same shape as GET /epics|/issues|/milestones: those carry full
 * description/count fields the extension's small panel has no use for, and
 * every open record for a repo this size is already a lot to render inside
 * claude.ai's own busy page.
 *
 * When the chat resolves to an epic (directly via chat.epicId, or via
 * chat.issueId's own epicId), the response also carries `focusEpic` + its
 * open issues + its milestone's progress — resolved here rather than left
 * for the panel to figure out, so "already linked → show just that epic" is
 * one lookup, not client-side matching against the full board.
 *
 * Auth: admin session cookie OR Authorization: Bearer <BUILD_TRACKER_INGEST_TOKEN>
 */
router.get("/admin/build-tracker/extension/board", ingestAuth, async (req: Request, res: Response) => {
  const conversationId = typeof req.query.conversationId === "string" ? req.query.conversationId.trim() : "";
  try {
    // Unfiltered — needed both for the open-work browse list below AND to
    // compute real milestone progress, which has to count closed/done work
    // too (a milestone with everything closed should read 100%, not 0/0).
    const [allEpics, allIssues, allChats, currentChatRows] = await Promise.all([
      db
        .select({
          id: btEpicsTable.id,
          title: btEpicsTable.title,
          status: btEpicsTable.status,
          githubNumber: btEpicsTable.githubNumber,
          milestoneId: btEpicsTable.milestoneId,
          parentEpicId: btEpicsTable.parentEpicId,
        })
        .from(btEpicsTable)
        .orderBy(asc(btEpicsTable.title)),
      db
        .select({
          id: btIssuesTable.id,
          title: btIssuesTable.title,
          description: btIssuesTable.description,
          status: btIssuesTable.status,
          githubNumber: btIssuesTable.githubNumber,
          epicId: btIssuesTable.epicId,
          // `in-flight`/`complete` labels (see CLAUDE.md's "GitHub issue
          // label sync") ride along on this same real GitHub labels array —
          // refreshed by the normal GitHub sync, not fetched live here.
          labels: btIssuesTable.labels,
        })
        .from(btIssuesTable)
        // By Git number, not title (Git #700 — Shane, with 19 issues under
        // one epic: "hard to find" in title-alphabetical order). Filtering
        // this array later (focusEpicOpenIssues, per-epic groups) preserves
        // this order since Array.filter keeps source order.
        .orderBy(asc(btIssuesTable.githubNumber)),
      // Every chat, not just open-work ones — the navigator (Git #697) needs
      // to point at a chat even if the epic it's linked to has since closed,
      // and there's no cheap way to filter that server-side without also
      // dragging in a join against both issueId and epicId.
      db
        .select({
          conversationId: btChatsTable.conversationId,
          title: btChatsTable.title,
          issueId: btChatsTable.issueId,
          epicId: btChatsTable.epicId,
          updatedAt: btChatsTable.updatedAt,
        })
        .from(btChatsTable),
      conversationId
        ? db.select().from(btChatsTable).where(eq(btChatsTable.conversationId, conversationId)).limit(1)
        : Promise.resolve([]),
    ]);

    const epics = allEpics.filter((e) => e.status !== "closed");
    const issues = allIssues.filter((i) => i.status !== "closed" && i.status !== "done");

    // Milestones are GitHub-live here too, same as GET /milestones above —
    // there's no local bt_milestones table, only bt_epics.milestone_id
    // pointing at a GitHub milestone number (so, unlike epic/issue
    // milestoneId elsewhere in this file, no id-vs-githubNumber ambiguity
    // to resolve — every milestone here IS its GitHub number).
    let milestones: Array<{
      id: number; title: string; githubNumber: number | null; status: string;
      progress: { done: number; total: number; pct: number };
    }> = [];
    if (process.env.GITHUB_TOKEN) {
      try {
        const msRes = await ghFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/milestones?state=open`);
        if (msRes.ok) {
          const ghMsList = (await msRes.json()) as Array<{ number: number; title: string; state: string }>;
          milestones = ghMsList.map((m) => {
            // Git #699 follow-up — Shane: "I am closing Issues but it's not
            // changing." A nested epic (an issue with its own sub-issues,
            // itself nested under a real epic) usually has no `milestone`
            // set on ITSELF on GitHub — only the top epic gets tagged. The
            // old `e.milestoneId === m.number` filter silently dropped every
            // nested epic (and everything under it) out of this count
            // whenever that was the case — closing one of its issues had
            // genuinely zero effect on the number, not a caching problem.
            // Walking the whole parentEpicId tree from each top-level epic
            // in this milestone counts every descendant regardless of its
            // own milestoneId.
            const collectTree = (epicId: number): number[] => {
              const children = allEpics.filter((e) => e.parentEpicId === epicId);
              return [epicId, ...children.flatMap((c) => collectTree(c.id))];
            };
            const topEpics = allEpics.filter((e) => e.milestoneId === m.number && e.parentEpicId == null);
            const msEpicIds = topEpics.flatMap((e) => collectTree(e.id));

            let total = 0;
            let done = 0;
            for (const epicId of msEpicIds) {
              const ep = allEpics.find((e) => e.id === epicId)!;
              const epIssues = allIssues.filter((i) => i.epicId === epicId);
              if (epIssues.length === 0) {
                total += 1;
                if (ep.status === "closed") done += 1;
              } else {
                total += epIssues.length;
                done += epIssues.filter((i) => i.status === "done" || i.status === "closed").length;
              }
            }
            const pct = total === 0 ? 0 : Math.round((done / total) * 100);
            return { id: m.number, title: m.title, githubNumber: m.number, status: m.state, progress: { done, total, pct } };
          });
        }
      } catch (err) {
        log.error({ err }, "GET /extension/board: GitHub milestones fetch failed");
      }
    }

    // A "sub item under an item" (Git #699) — an issue promoted into
    // bt_epics because it has its own sub-issues, nested under a real epic
    // via parentEpicId. Without surfacing these separately they're
    // invisible in the focused view: they don't show as one of the epic's
    // own OPEN ISSUES (they're not in bt_issues at all, they're their own
    // epic row), so "This epic's open issues" would silently omit them.
    const subEpicsOf = (epicId: number) =>
      allEpics
        .filter((e) => e.parentEpicId === epicId)
        .map((e) => ({
          id: e.id,
          title: e.title,
          githubNumber: e.githubNumber,
          status: e.status,
          openIssueCount: allIssues.filter(
            (i) => i.epicId === e.id && i.status !== "closed" && i.status !== "done",
          ).length,
        }));

    const chatRow = currentChatRows[0] ?? null;
    let focusEpic: typeof allEpics[number] | null = null;
    let focusEpicOpenIssues: typeof allIssues = [];
    let focusEpicSubEpics: ReturnType<typeof subEpicsOf> = [];
    let focusMilestone: (typeof milestones)[number] | null = null;

    if (chatRow) {
      let epicId = chatRow.epicId;
      if (!epicId && chatRow.issueId) {
        epicId = allIssues.find((i) => i.id === chatRow.issueId)?.epicId ?? null;
      }
      if (epicId) {
        focusEpic = allEpics.find((e) => e.id === epicId) ?? null;
        if (focusEpic) {
          focusEpicOpenIssues = allIssues.filter(
            (i) => i.epicId === focusEpic!.id && i.status !== "closed" && i.status !== "done",
          );
          focusEpicSubEpics = subEpicsOf(focusEpic.id);
          focusMilestone = milestones.find((m) => m.githubNumber === focusEpic!.milestoneId) ?? null;
        }
      }
    }

    const currentChat = chatRow
      ? { ...chatRow, claudeUrl: claudeUrl(chatRow.conversationId), focusEpic, focusEpicOpenIssues, focusEpicSubEpics, focusMilestone }
      : null;

    // Proactive warning (Git #699) — Shane: "I might have closed parents
    // thinking I was done." A closed epic with a still-open child issue OR
    // a still-open nested sub-epic underneath it is real work that just
    // went invisible: closed epics are filtered out of `epics` above, so
    // nothing else in this response would ever surface it again. Checked
    // regardless of which chat/epic is currently focused — this needs to be
    // seen even from an unrelated chat.
    function hasOpenDescendantWork(epicId: number, seen: Set<number> = new Set()): boolean {
      if (seen.has(epicId)) return false; // cycle guard — shouldn't happen, but never loop forever
      seen.add(epicId);
      const hasOpenIssue = allIssues.some(
        (i) => i.epicId === epicId && i.status !== "closed" && i.status !== "done",
      );
      if (hasOpenIssue) return true;
      return allEpics
        .filter((e) => e.parentEpicId === epicId)
        .some((child) => child.status !== "closed" || hasOpenDescendantWork(child.id, seen));
    }
    const alerts = allEpics
      .filter((e) => e.status === "closed" && hasOpenDescendantWork(e.id))
      .map((e) => ({
        id: e.id,
        title: e.title,
        githubNumber: e.githubNumber,
        githubUrl: e.githubNumber != null ? `https://github.com/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/issues/${e.githubNumber}` : null,
      }));

    // Resolved against allEpics/allIssues (unfiltered) rather than the
    // open-only `epics`/`issues` above, so a chat pointing at an already-
    // closed epic/issue still resolves — the navigator should still be able
    // to find it, same reasoning as focusEpic's own resolution above.
    const chats = allChats.map((c) => {
      let epicId = c.epicId;
      if (!epicId && c.issueId) {
        epicId = allIssues.find((i) => i.id === c.issueId)?.epicId ?? null;
      }
      return {
        conversationId: c.conversationId,
        title: c.title,
        epicId,
        claudeUrl: claudeUrl(c.conversationId),
        updatedAt: c.updatedAt,
      };
    });

    res.json({ milestones, epics, issues, chats, currentChat, alerts });
  } catch (err) {
    log.error({ err }, "GET /extension/board failed");
    res.status(500).json({ error: "Failed to load board" });
  }
});

/**
 * POST /admin/build-tracker/extension/quick-sync
 *
 * A fast, targeted alternative to POST /github-sync for the extension's
 * Refresh button (Git #695) — a full sync paginates the WHOLE repo just to
 * catch a couple of label changes on issues Shane is already looking at,
 * which he flagged as slow. This fetches only the given issue numbers
 * directly from GitHub and updates just their title/description/labels/
 * githubUrl in place, plus a one-way "closed wins" status push (same rule
 * the full sync uses) — no epic/milestone discovery, no GitHub Projects v2
 * status lookup (that's its own GraphQL round trip the full sync pays for;
 * skipped here to stay fast). Never creates a row — an issue Build Tracker
 * doesn't already know about needs a real full sync, not this; the panel's
 * separate "Full sync" link is still there for that.
 *
 * Body: { issueNumbers: number[] } — deduped, capped at 30 per call.
 *
 * Auth: admin session cookie OR Authorization: Bearer <BUILD_TRACKER_INGEST_TOKEN>
 */
router.post("/admin/build-tracker/extension/quick-sync", ingestAuth, async (req: Request, res: Response) => {
  if (!process.env.GITHUB_TOKEN) {
    res.status(503).json({ error: "GITHUB_TOKEN is not set on this server" });
    return;
  }
  const { issueNumbers } = req.body as { issueNumbers?: number[] };
  const numbers = Array.from(
    new Set((issueNumbers ?? []).filter((n) => Number.isInteger(n))),
  ).slice(0, 30);
  if (numbers.length === 0) {
    res.status(400).json({ error: "issueNumbers is required" });
    return;
  }

  let updated = 0;
  const failed: number[] = [];
  for (const num of numbers) {
    try {
      const ghRes = await ghFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/issues/${num}`);
      if (!ghRes.ok) { failed.push(num); continue; }
      const gh = (await ghRes.json()) as GitHubIssuePayload;
      const labels = gh.labels.map((l) => l.name);
      const patch: Partial<typeof btIssuesTable.$inferInsert> = {
        title: gh.title,
        description: gh.body,
        githubUrl: gh.html_url,
        labels,
        updatedAt: new Date(),
      };
      // `complete` means done in code, not yet reviewed/closed by Shane —
      // see the full sync's comment for the full story (Git #713 follow-up).
      if (gh.state === "closed") patch.status = "closed";
      else if (labels.includes("complete")) patch.status = "done";

      const result = await db
        .update(btIssuesTable)
        .set(patch)
        .where(eq(btIssuesTable.githubNumber, num))
        .returning({ id: btIssuesTable.id });
      if (result.length > 0) updated++;
    } catch (err) {
      log.error({ err, num }, "quick-sync: single-issue fetch failed");
      failed.push(num);
    }
  }

  res.json({ updated, requested: numbers.length, failed });
});

async function ghFetchIssue(number: number): Promise<GitHubIssuePayload | null> {
  const res = await ghFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/issues/${number}`);
  if (!res.ok) return null;
  return (await res.json()) as GitHubIssuePayload;
}

async function ghFetchSubIssues(number: number): Promise<GitHubIssuePayload[]> {
  const res = await ghFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/issues/${number}/sub_issues`);
  if (!res.ok) return [];
  return (await res.json()) as GitHubIssuePayload[];
}

/** Upserts a GitHub issue as an EPIC row (used both for the epic being synced and any nested sub-epic found under it). */
async function upsertEpicRow(gh: GitHubIssuePayload, parentEpicId: number | null): Promise<number> {
  const milestoneId = gh.milestone ? (gh.milestone.number ?? gh.milestone.id) : null;
  const [row] = await db
    .insert(btEpicsTable)
    .values({
      title: gh.title,
      description: gh.body,
      status: gh.state === "closed" ? "closed" : "open",
      githubNumber: gh.number,
      milestoneId,
      parentEpicId,
    })
    .onConflictDoUpdate({
      target: btEpicsTable.githubNumber,
      set: {
        title: gh.title,
        description: gh.body,
        // "closed wins" one-way push, same rule quick-sync uses — never
        // downgrades a locally-tracked "in_progress" back to "open" here.
        ...(gh.state === "closed" ? { status: "closed" as const } : {}),
        milestoneId,
        parentEpicId,
        updatedAt: new Date(),
      },
    })
    .returning({ id: btEpicsTable.id });
  return row.id;
}

async function upsertIssueRow(gh: GitHubIssuePayload, epicId: number): Promise<void> {
  const milestoneId = gh.milestone ? (gh.milestone.number ?? gh.milestone.id) : null;
  const labels = gh.labels.map((l) => l.name);
  // `complete` means done in code, not yet reviewed/closed by Shane himself
  // — see the full sync's matching comment above for the full story (Git
  // #713 follow-up). Only ever WIDENS what counts as done locally; never
  // touches the real GitHub state, and never downgrades an update back to
  // "backlog" when neither signal applies (same as before this fix).
  const derivedStatus: "closed" | "done" | null =
    gh.state === "closed" ? "closed" : labels.includes("complete") ? "done" : null;
  await db
    .insert(btIssuesTable)
    .values({
      title: gh.title,
      description: gh.body,
      status: derivedStatus ?? "backlog",
      epicId,
      milestoneId,
      githubNumber: gh.number,
      githubUrl: gh.html_url,
      labels,
    })
    .onConflictDoUpdate({
      target: btIssuesTable.githubNumber,
      set: {
        title: gh.title,
        description: gh.body,
        epicId,
        milestoneId,
        githubUrl: gh.html_url,
        labels,
        ...(derivedStatus ? { status: derivedStatus } : {}),
        updatedAt: new Date(),
      },
    });
}

/**
 * POST /admin/build-tracker/extension/sync-epic
 *
 * Git #698 — Shane, after #695's quick-sync: "When I sync you should sync
 * the entire epic so I dont have to sync the whole thing again to get new
 * items in that one epic." Quick-sync only refreshes issue numbers it's
 * handed — a brand-new sub-issue GitHub-side never shows up until the slow
 * full repo sync. This calls GitHub's own sub-issues endpoint for ONE epic
 * (a single request, not a full-repo page-through) so newly added children
 * get discovered too, not just refreshed.
 *
 * Git #699 — sub-issues can themselves have sub-issues ("if there are sub
 * items under items I need to know that so I can work them too... I might
 * have closed parents thinking I was done"). A child that itself has
 * sub_issues_summary.total > 0 gets promoted into bt_epics (same rule the
 * full sync uses to decide what's an "Epic") WITH parentEpicId pointing
 * back here, instead of silently becoming an orphaned top-level epic with
 * no visible tie to where it actually lives — that disconnect is exactly
 * what made it easy to close a "done"-looking parent while its own children
 * were still open underneath it. Walks two levels deep (children, then
 * their children) — a 4th level still gets upserted as a plain issue (not
 * lost) but isn't expanded further; that deep a hierarchy needs its own
 * sync-epic call on that item directly. Capped at 40 total upserts as a
 * runaway guard.
 *
 * Body: { epicNumber: number }
 * Auth: admin session cookie OR Authorization: Bearer <BUILD_TRACKER_INGEST_TOKEN>
 */
/**
 * GET /admin/build-tracker/extension/issue-lookup?number=N
 *
 * Git #716 follow-up — Shane: "Claude Chat... spits out Git numbers like I
 * remember what all 700+ are... hover over it it shows me the Issue."
 * Powers a hover card the content script builds for any #N it finds in a
 * claude.ai message. Deliberately reads straight from GitHub, not Build
 * Tracker's own DB — a number in chat could be an issue, an epic, or
 * something never synced/linked at all, and this needs to answer for all of
 * them the same way, not just what's already tracked locally.
 *
 * Auth: admin session cookie OR Authorization: Bearer <BUILD_TRACKER_INGEST_TOKEN>
 */
router.get("/admin/build-tracker/extension/issue-lookup", ingestAuth, async (req: Request, res: Response) => {
  if (!process.env.GITHUB_TOKEN) {
    res.status(503).json({ error: "GITHUB_TOKEN is not set on this server" });
    return;
  }
  const number = parseInt(String(req.query.number ?? ""), 10);
  if (!Number.isInteger(number)) {
    res.status(400).json({ error: "number is required" });
    return;
  }
  try {
    const gh = await ghFetchIssue(number);
    if (!gh) {
      res.status(404).json({ error: `#${number} not found on GitHub` });
      return;
    }
    res.json({
      number: gh.number,
      title: gh.title,
      state: gh.state,
      labels: gh.labels.map((l) => l.name),
      htmlUrl: gh.html_url,
      isEpic: !!(gh.sub_issues_summary && gh.sub_issues_summary.total > 0),
    });
  } catch (err) {
    log.error({ err, number }, "GET /extension/issue-lookup failed");
    res.status(500).json({ error: "Lookup failed" });
  }
});

router.post("/admin/build-tracker/extension/sync-epic", ingestAuth, async (req: Request, res: Response) => {
  if (!process.env.GITHUB_TOKEN) {
    res.status(503).json({ error: "GITHUB_TOKEN is not set on this server" });
    return;
  }
  const { epicNumber } = req.body as { epicNumber?: number };
  if (!Number.isInteger(epicNumber)) {
    res.status(400).json({ error: "epicNumber is required" });
    return;
  }

  try {
    const ghEpic = await ghFetchIssue(epicNumber!);
    if (!ghEpic) {
      res.status(404).json({ error: `Epic #${epicNumber} not found on GitHub` });
      return;
    }

    // If this epic is itself nested under another tracked epic, link it —
    // otherwise a sub-epic synced directly (e.g. via the navigator) reads
    // as an unrelated top-level epic same as before this fix.
    let ownParentEpicId: number | null = null;
    const ownParentNum = getParentNumber(ghEpic.parent_issue_url);
    if (ownParentNum !== null) {
      const [parentRow] = await db
        .select({ id: btEpicsTable.id })
        .from(btEpicsTable)
        .where(eq(btEpicsTable.githubNumber, ownParentNum))
        .limit(1);
      ownParentEpicId = parentRow?.id ?? null;
    }
    const epicId = await upsertEpicRow(ghEpic, ownParentEpicId);

    const level1 = await ghFetchSubIssues(epicNumber!);
    let issuesUpserted = 0;
    let nestedEpicsUpserted = 0;
    const MAX_UPSERTS = 40;

    for (const gh of level1) {
      if (gh.pull_request) continue;
      if (issuesUpserted + nestedEpicsUpserted >= MAX_UPSERTS) break;

      if (gh.sub_issues_summary && gh.sub_issues_summary.total > 0) {
        const subEpicId = await upsertEpicRow(gh, epicId);
        nestedEpicsUpserted++;
        const level2 = await ghFetchSubIssues(gh.number);
        for (const gh2 of level2) {
          if (gh2.pull_request) continue;
          if (issuesUpserted + nestedEpicsUpserted >= MAX_UPSERTS) break;
          await upsertIssueRow(gh2, subEpicId);
          issuesUpserted++;
        }
      } else {
        await upsertIssueRow(gh, epicId);
        issuesUpserted++;
      }
    }

    res.json({ epicNumber, issuesUpserted, nestedEpicsUpserted, issuesFound: level1.length });
  } catch (err) {
    log.error({ err, epicNumber }, "POST /extension/sync-epic failed");
    res.status(500).json({ error: "Epic sync failed" });
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
// Pulls all issues from shanemccaw/Shane-McCaw-MSP.
// An Epic is defined as any issue that has sub-issues assigned to it (meaning
// it has sub_issues_summary.total > 0 OR is referenced as a parent by another
// issue's parent_issue_url).
// All other issues (child issues and standalone issues) are stored in bt_issues.
// ─────────────────────────────────────────────────────────────────────────────

const GITHUB_OWNER = "shanemccaw";
const GITHUB_REPO_NAME = "Shane-McCaw-MSP";
const GITHUB_API = "https://api.github.com";

async function ghFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN env var not set");
  return fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init?.headers || {}),
    },
  });
}

// ── GitHub Projects (v2) "Status" field — read + write ──────────────────────
// "In Progress"/"Done" etc. are Projects v2 board fields (the right-hand
// Projects panel on an issue), NOT anything the plain REST Issues API
// exposes — REST only ever gives open/closed. Both directions go through the
// separate GraphQL API. Confirmed by Shane the token in this environment DOES
// have project write access (another tool using the same PAT already sets
// this field) — a prior session's read:project-only finding was a different
// token, not this one.

const GITHUB_GRAPHQL_API = "https://api.github.com/graphql";

async function ghGraphQL<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN env var not set");
  const res = await fetch(GITHUB_GRAPHQL_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json() as { data?: T; errors?: Array<{ message: string }> };
  if (!res.ok || body.errors?.length) {
    const message = body.errors?.map((e) => e.message).join("; ") || `HTTP ${res.status}`;
    throw new Error(`GitHub GraphQL error: ${message}`);
  }
  return body.data as T;
}

const PROJECT_STATUS_QUERY = `
  query($owner: String!, $repo: String!, $after: String) {
    repository(owner: $owner, name: $repo) {
      issues(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          number
          projectItems(first: 10) {
            nodes {
              fieldValueByName(name: "Status") {
                ... on ProjectV2ItemFieldSingleSelectValue { name }
              }
            }
          }
        }
      }
    }
  }
`;

interface ProjectStatusQueryResult {
  repository: {
    issues: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: Array<{
        number: number;
        projectItems: { nodes: Array<{ fieldValueByName: { name: string } | null }> };
      }>;
    };
  };
}

export interface ProjectStatusDiagnostics {
  inProgress: Set<number>;
  /** GraphQL exception message, if the call failed outright (bad scope, network, etc). Null on success. */
  error: string | null;
  issuesScanned: number;
  /** Issues with at least one Projects v2 item linked at all. */
  issuesWithProjectItems: number;
  /** Issues where a linked project actually has a "Status" field with a value set. */
  issuesWithStatusField: number;
  /** Every distinct Status value actually seen, capped — lets a human confirm real label casing/wording. */
  distinctStatusValues: string[];
}

/**
 * Every issue number where AT LEAST ONE linked GitHub Project's Status field
 * reads "In Progress" — Shane's call: an issue counts if either of his two
 * linked projects (repo-level "Shane McCaw Consulting" or the per-release
 * "Shane-McCaw-MSP v1.1 Launch" board) says so, not just one specific board.
 * Best-effort: `error` records any failure (insufficient token/GraphQL
 * scope, network) rather than throwing — a Projects read failure degrades
 * `inProgress` to empty, not a failed sync; the REST-sourced open/closed
 * data sync depends on is unaffected. The rest of the diagnostics exist
 * because the first attempt at this (commit f9d80c3c) came back all zeros
 * with no way to tell WHY from outside a live server's logs — this makes
 * the real cause (wrong field name, no project links resolving, a
 * fine-grained PAT's known GraphQL ProjectV2 restriction, label mismatch)
 * visible in the sync result itself instead of requiring log access.
 */
async function fetchInProgressFromProjects(): Promise<ProjectStatusDiagnostics> {
  const inProgress = new Set<number>();
  const distinctStatusValues = new Set<string>();
  let issuesScanned = 0;
  let issuesWithProjectItems = 0;
  let issuesWithStatusField = 0;
  let after: string | null = null;
  try {
    do {
      const data: ProjectStatusQueryResult = await ghGraphQL(PROJECT_STATUS_QUERY, {
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO_NAME,
        after,
      });
      for (const issue of data.repository.issues.nodes) {
        issuesScanned++;
        if (issue.projectItems.nodes.length > 0) issuesWithProjectItems++;
        let hasStatusField = false;
        for (const item of issue.projectItems.nodes) {
          const value = item.fieldValueByName?.name?.trim();
          if (!value) continue;
          hasStatusField = true;
          if (distinctStatusValues.size < 20) distinctStatusValues.add(value);
          if (value.toLowerCase() === "in progress") inProgress.add(issue.number);
        }
        if (hasStatusField) issuesWithStatusField++;
      }
      after = data.repository.issues.pageInfo.hasNextPage ? data.repository.issues.pageInfo.endCursor : null;
    } while (after);
    return { inProgress, error: null, issuesScanned, issuesWithProjectItems, issuesWithStatusField, distinctStatusValues: [...distinctStatusValues] };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err }, "fetchInProgressFromProjects failed — continuing sync without Projects status data");
    return { inProgress, error: message, issuesScanned, issuesWithProjectItems, issuesWithStatusField, distinctStatusValues: [...distinctStatusValues] };
  }
}

// Shane's real board — given directly rather than looked up per-issue by
// field/option NAME, more reliable than matching on "Status"/"In Progress"
// strings (case, renames, a second field also named "Status" on some other
// linked project) and needs no extra query per push to discover them.
//
// NOT STABLE ACROSS TIME: the project this originally pointed at
// ("Shane-McCaw-MSP v1.1 Launch", PVT_kwHOEiBDdc4Bfy37, verified live when
// b8aea5da landed) had been DELETED by the time the very next request in
// this same session re-verified it — a `gh api graphql` node lookup that
// had just succeeded came back NOT_FOUND. Its fields (Status, and nothing
// else) look consolidated onto Shane's other project, "Shane McCaw
// Consulting" (PVT_kwHOEiBDdc4BeoiY), which now carries a materially richer
// field set (Status/Priority/Size/Estimate/Iteration) — re-verified live
// 2026-08-10 before writing these ids. If pushStatusToProjects()/the
// iteration bulk-assign start silently no-op'ing again, the project was
// probably reorganized again — re-run the same read-only `gh api graphql`
// node/title lookup rather than assume the code is broken.
const PROJECT_V2_ID = "PVT_kwHOEiBDdc4BeoiY";
const PROJECT_V2_STATUS_FIELD_ID = "PVTSSF_lAHOEiBDdc4BeoiYzhZBRB0";

/**
 * local status -> real Status option id. "Architecting"/"In review"/"Batter
 * Up"/"Need to Test"/"Zoho"/"EngageBay" are real stages on the board this
 * tool has no local equivalent for — never written here, only ever set by
 * Shane by hand. "closed" reuses "Done" since there's no separate "Closed"
 * stage; the real close itself is still the REST issue-state push above,
 * this is just the board reflecting it. Option name is "In progress"
 * (lowercase p) on this board, unlike the deleted board's "In Progress" —
 * matched by id here, not name, so the casing difference doesn't matter.
 */
const PROJECT_V2_STATUS_OPTION_ID: Record<string, string> = {
  backlog: "63cc47c8",
  open: "63cc47c8", // epic "open" -> the same Backlog bucket
  in_progress: "6cf0ca80",
  done: "0003ae3b",
  closed: "0003ae3b",
};

const ISSUE_NODE_AND_PROJECT_ITEM_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        id
        projectItems(first: 20) {
          nodes { id project { id } }
        }
      }
    }
  }
`;

const ADD_PROJECT_V2_ITEM_MUTATION = `
  mutation($projectId: ID!, $contentId: ID!) {
    addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) {
      item { id }
    }
  }
`;

const UPDATE_PROJECT_V2_ITEM_STATUS_MUTATION = `
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
      value: { singleSelectOptionId: $optionId }
    }) {
      projectV2Item { id }
    }
  }
`;

interface IssueNodeAndProjectItemResult {
  repository: {
    issue: {
      id: string;
      projectItems: { nodes: Array<{ id: string; project: { id: string } }> };
    } | null;
  };
}

/**
 * Moves `issueNumber` to `localStatus` on Shane's real Projects v2 board
 * (an epic is itself a GitHub issue, so this covers both). Adds the issue
 * to the board first (addProjectV2ItemById) if it isn't already an item on
 * it — a fresh issue synced from GitHub has no project item yet. No-op for
 * a local status with no real board option (see PROJECT_V2_STATUS_OPTION_ID).
 * Best-effort like every other GitHub-write call site in this file: logs
 * and returns on any failure, never throws into the caller, which has
 * already committed the local write.
 */
async function pushStatusToProjects(issueNumber: number, localStatus: string): Promise<void> {
  const optionId = PROJECT_V2_STATUS_OPTION_ID[localStatus];
  if (!optionId) return;
  try {
    const data = await ghGraphQL<IssueNodeAndProjectItemResult>(ISSUE_NODE_AND_PROJECT_ITEM_QUERY, {
      owner: GITHUB_OWNER,
      repo: GITHUB_REPO_NAME,
      number: issueNumber,
    });
    const issue = data.repository.issue;
    if (!issue) return;

    let itemId = issue.projectItems.nodes.find((n) => n.project.id === PROJECT_V2_ID)?.id;
    if (!itemId) {
      const added = await ghGraphQL<{ addProjectV2ItemById: { item: { id: string } } }>(
        ADD_PROJECT_V2_ITEM_MUTATION,
        { projectId: PROJECT_V2_ID, contentId: issue.id },
      );
      itemId = added.addProjectV2ItemById.item.id;
    }

    await ghGraphQL(UPDATE_PROJECT_V2_ITEM_STATUS_MUTATION, {
      projectId: PROJECT_V2_ID,
      itemId,
      fieldId: PROJECT_V2_STATUS_FIELD_ID,
      optionId,
    });
  } catch (err) {
    log.error({ err, issueNumber, localStatus }, "pushStatusToProjects failed");
  }
}

// ── Iteration field bulk-assign ──────────────────────────────────────────────
// Shane asked for a button to assign a chosen iteration to every board item
// that doesn't have one set yet. "Iteration" here is purely a live Projects
// v2 field (id verified 2026-08-10 alongside the Status field fix above) —
// this tool has no local column for it at all, nothing to sync or store.

const PROJECT_V2_ITERATION_FIELD_ID = "PVTIF_lAHOEiBDdc4BeoiYzhZBRMY";

const ITERATION_FIELD_CONFIG_QUERY = `
  query($projectId: ID!) {
    node(id: $projectId) {
      ... on ProjectV2 {
        field(name: "Iteration") {
          ... on ProjectV2IterationField {
            id
            configuration {
              iterations { id title startDate duration }
              completedIterations { id title startDate duration }
            }
          }
        }
      }
    }
  }
`;

interface IterationFieldConfigResult {
  node: {
    field: {
      id: string;
      configuration: {
        iterations: Array<{ id: string; title: string; startDate: string; duration: number }>;
        completedIterations: Array<{ id: string; title: string; startDate: string; duration: number }>;
      };
    } | null;
  } | null;
}

/** GET /admin/build-tracker/iterations — the board's real current/future + completed iterations. */
router.get("/admin/build-tracker/iterations", requireAdmin, async (_req: Request, res: Response) => {
  if (!process.env.GITHUB_TOKEN) {
    res.status(503).json({ error: "GITHUB_TOKEN is not set on this server" });
    return;
  }
  try {
    const data = await ghGraphQL<IterationFieldConfigResult>(ITERATION_FIELD_CONFIG_QUERY, {
      projectId: PROJECT_V2_ID,
    });
    const config = data.node?.field?.configuration;
    if (!config) {
      res.status(502).json({ error: "Could not read the Iteration field — the board may have been reorganized again, see the PROJECT_V2_ID comment" });
      return;
    }
    res.json({
      iterations: [
        ...config.iterations.map((it) => ({ ...it, completed: false })),
        ...config.completedIterations.map((it) => ({ ...it, completed: true })),
      ],
    });
  } catch (err) {
    log.error({ err }, "GET /iterations failed");
    res.status(500).json({ error: "Failed to load iterations" });
  }
});

const PROJECT_ITEMS_WITHOUT_ITERATION_QUERY = `
  query($projectId: ID!, $after: String) {
    node(id: $projectId) {
      ... on ProjectV2 {
        items(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            id
            content { ... on Issue { number title } }
            fieldValueByName(name: "Iteration") {
              ... on ProjectV2ItemFieldIterationValue { title }
            }
          }
        }
      }
    }
  }
`;

interface ProjectItemsPage {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: Array<{
    id: string;
    content: { number: number; title: string } | null;
    fieldValueByName: { title: string } | null;
  }>;
}

interface ProjectItemsWithoutIterationResult {
  node: { items: ProjectItemsPage } | null;
}

/** Every board item (id + issue number/title) with no Iteration value set, paginating the whole project. */
async function findItemsWithoutIteration(): Promise<Array<{ itemId: string; number: number | null; title: string }>> {
  const found: Array<{ itemId: string; number: number | null; title: string }> = [];
  let after: string | null = null;
  do {
    const data: ProjectItemsWithoutIterationResult = await ghGraphQL(PROJECT_ITEMS_WITHOUT_ITERATION_QUERY, {
      projectId: PROJECT_V2_ID,
      after,
    });
    const items: ProjectItemsPage | undefined = data.node?.items;
    if (!items) break;
    for (const item of items.nodes) {
      if (item.fieldValueByName) continue; // already has an iteration
      found.push({ itemId: item.id, number: item.content?.number ?? null, title: item.content?.title ?? "(untitled)" });
    }
    after = items.pageInfo.hasNextPage ? items.pageInfo.endCursor : null;
  } while (after);
  return found;
}

/** Hard ceiling on one bulk-assign call — a real cap, not silent: the response reports how many were left over. */
const MAX_ITERATION_ASSIGNMENTS_PER_CALL = 400;

const UPDATE_PROJECT_V2_ITEM_ITERATION_MUTATION = `
  mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $iterationId: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $projectId, itemId: $itemId, fieldId: $fieldId,
      value: { iterationId: $iterationId }
    }) {
      projectV2Item { id }
    }
  }
`;

/**
 * POST /admin/build-tracker/assign-iteration — assigns `iterationId` to every
 * board item with no Iteration value set. `dryRun: true` only counts
 * candidates (no writes) so the client can show a real impact count before
 * asking Shane to confirm a bulk, live, hard-to-reverse change.
 */
router.post("/admin/build-tracker/assign-iteration", requireAdmin, async (req: Request, res: Response) => {
  if (!process.env.GITHUB_TOKEN) {
    res.status(503).json({ error: "GITHUB_TOKEN is not set on this server" });
    return;
  }
  const { iterationId, dryRun } = req.body as { iterationId?: string; dryRun?: boolean };
  if (!iterationId?.trim()) { res.status(400).json({ error: "iterationId is required" }); return; }

  try {
    const candidates = await findItemsWithoutIteration();

    if (dryRun) {
      res.json({
        candidateCount: candidates.length,
        sampleTitles: candidates.slice(0, 8).map((c) => (c.number ? `#${c.number} ${c.title}` : c.title)),
        updated: 0,
        failed: 0,
      });
      return;
    }

    const toAssign = candidates.slice(0, MAX_ITERATION_ASSIGNMENTS_PER_CALL);
    let updated = 0;
    let failed = 0;
    for (const item of toAssign) {
      try {
        await ghGraphQL(UPDATE_PROJECT_V2_ITEM_ITERATION_MUTATION, {
          projectId: PROJECT_V2_ID,
          itemId: item.itemId,
          fieldId: PROJECT_V2_ITERATION_FIELD_ID,
          iterationId,
        });
        updated++;
      } catch (err) {
        failed++;
        log.error({ err, itemId: item.itemId, number: item.number }, "assign-iteration: single item failed");
      }
    }

    const remaining = candidates.length - toAssign.length;
    if (remaining > 0) {
      log.warn({ remaining, capped: MAX_ITERATION_ASSIGNMENTS_PER_CALL }, "assign-iteration: hit the per-call cap, items left over");
    }
    res.json({ candidateCount: candidates.length, updated, failed, remaining });
  } catch (err) {
    log.error({ err }, "POST /assign-iteration failed");
    res.status(500).json({ error: "Failed to assign iteration" });
  }
});

function getParentNumber(url: string | null | undefined): number | null {
  if (!url) return null;
  const match = url.match(/\/issues\/(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

type GhIssueStatus = "backlog" | "in_progress" | "done" | "closed";

interface GitHubIssuePayload {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  parent_issue_url?: string | null;
  sub_issues_summary?: {
    total: number;
    completed: number;
    percent_completed: number;
  } | null;
  labels: Array<{ name: string }>;
  pull_request?: unknown;
  milestone?: { number: number; id: number } | null;
}

import fs from "node:fs/promises";
import path from "node:path";

/**
 * POST /admin/build-tracker/github-sync
 *
 * Auth: admin session cookie OR Authorization: Bearer <BUILD_TRACKER_INGEST_TOKEN>
 * — the extension's "Refresh" button (Git #693) triggers a real sync through
 * this same route, not just a re-read of already-stale local data, so it
 * needs the same bearer-token path every other extension-facing route uses.
 */
router.post("/admin/build-tracker/github-sync", ingestAuth, async (_req: Request, res: Response) => {
  if (!process.env.GITHUB_TOKEN) {
    res.status(503).json({ error: "GITHUB_TOKEN is not set on this server" });
    return;
  }
  const debugLogPath = path.resolve(process.cwd(), "scratch-sync-debug.txt");
  let debugLog = `Sync started at ${new Date().toISOString()}\n`;

  try {
    // ── 1. Fetch all issues (paginated) ──────────────────────────────────
    let page = 1;
    const fetchedIssues: GitHubIssuePayload[] = [];

    while (true) {
      const issuesRes = await ghFetch(
        `/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/issues?state=all&per_page=100&page=${page}`,
      );
      if (!issuesRes.ok) {
        log.error({ status: issuesRes.status }, "GitHub issues page fetch failed");
        debugLog += `Page ${page} fetch failed: ${issuesRes.status}\n`;
        break;
      }
      const pageIssues = (await issuesRes.json()) as GitHubIssuePayload[];
      if (!pageIssues.length) break;

      for (const gh of pageIssues) {
        if (!gh.pull_request) {
          fetchedIssues.push(gh);
        }
      }
      if (pageIssues.length < 100) break;
      page++;
    }

    debugLog += `Fetched issues count: ${fetchedIssues.length}\n`;

    // GitHub Projects (v2) "Status" field — the real source for "In Progress"
    // (the REST issues fetched above only ever carry open/closed). Best-effort:
    // an empty set here just means no real in-progress signal from GitHub this
    // sync, not a failure — see fetchInProgressFromProjects()'s own comment.
    const projectStatus = await fetchInProgressFromProjects();
    const projectInProgress = projectStatus.inProgress;
    debugLog += `Projects status diagnostics: ${JSON.stringify({ ...projectStatus, inProgress: projectInProgress.size })}\n`;

    // ── 2. Identify parents (Epics) ──────────────────────────────────────
    const parentNumbers = new Set<number>();
    let subIssuesSummaryFound = 0;
    let parentIssueUrlFound = 0;

    for (const gh of fetchedIssues) {
      if (gh.sub_issues_summary && gh.sub_issues_summary.total > 0) {
        parentNumbers.add(gh.number);
        subIssuesSummaryFound++;
      }
      const pNum = getParentNumber(gh.parent_issue_url);
      if (pNum !== null) {
        parentNumbers.add(pNum);
        parentIssueUrlFound++;
      }
    }

    debugLog += `sub_issues_summary found count: ${subIssuesSummaryFound}\n`;
    debugLog += `parent_issue_url found count: ${parentIssueUrlFound}\n`;
    debugLog += `Unique parent numbers identified: ${Array.from(parentNumbers).join(", ")}\n`;

    // GitHub only knows "open"/"closed" — "in_progress" and "done" are local-only
    // refinements this tool invented on top of that. Read them before the wipe
    // below so a re-sync doesn't silently discard work-in-progress tracking:
    // an issue/epic keeps its local status as long as GitHub still shows it
    // open; the moment GitHub shows it closed, "closed" wins regardless. The
    // PATCH routes above now push a local "closed" out to the real GitHub
    // issue when GITHUB_TOKEN is set, so this should be the normal path to
    // "closed" reappearing here too — previousStatus also carries "closed"
    // itself through as a fallback (belt-and-suspenders for a push that
    // failed — no token, rate limit, network) rather than silently reverting
    // a closed issue back to "backlog" on the next sync.
    const previousEpicRows = await db
      .select({ githubNumber: btEpicsTable.githubNumber, status: btEpicsTable.status })
      .from(btEpicsTable)
      .where(sql`github_number IS NOT NULL`);
    const previousEpicStatusByNumber = new Map(
      previousEpicRows.filter((e) => e.githubNumber !== null).map((e) => [e.githubNumber!, e.status]),
    );
    const previousIssueRows = await db
      .select({ githubNumber: btIssuesTable.githubNumber, status: btIssuesTable.status })
      .from(btIssuesTable)
      .where(sql`github_number IS NOT NULL`);
    const previousIssueStatusByNumber = new Map(
      previousIssueRows.filter((i) => i.githubNumber !== null).map((i) => [i.githubNumber!, i.status]),
    );

    // Upsert by github_number (Git #693) rather than delete-then-reinsert —
    // the old delete wiped every bt_epics/bt_issues row with a github_number
    // on every sync, and bt_chats.epic_id/issue_id being ON DELETE SET NULL
    // meant that silently unlinked every chat Shane had already matched to
    // an epic/issue. Upserting keeps the same row `id` across syncs, so
    // those links survive. Requires the unique index from Git #693's manual
    // migration — ON CONFLICT has nothing to target without it.
    debugLog += `Upserting by github_number instead of delete-then-reinsert (Git #693)\n`;

    // ── 3. Upsert Epics into bt_epics ────────────────────────────────────
    let epicsUpserted = 0;
    const issueMapByNumber = new Map(fetchedIssues.map((i) => [i.number, i]));

    for (const pNum of parentNumbers) {
      const ghEpic = issueMapByNumber.get(pNum);
      const title = ghEpic ? ghEpic.title : `Epic #${pNum}`;
      const description = ghEpic ? ghEpic.body : null;
      const previousStatus = previousEpicStatusByNumber.get(pNum);
      const status = (ghEpic && ghEpic.state === "closed")
        ? "closed"
        : projectInProgress.has(pNum)
          ? "in_progress"
          : (previousStatus === "in_progress" || previousStatus === "closed") ? previousStatus : "open";
      
      let milestoneId = ghEpic?.milestone ? (ghEpic.milestone.number ?? ghEpic.milestone.id) : null;
      if (milestoneId === null) {
        const childWithMs = fetchedIssues.find((i) => getParentNumber(i.parent_issue_url) === pNum && i.milestone);
        if (childWithMs?.milestone) {
          milestoneId = childWithMs.milestone.number ?? childWithMs.milestone.id;
        }
      }

      await db.insert(btEpicsTable).values({
        title,
        description,
        status,
        githubNumber: pNum,
        milestoneId,
      }).onConflictDoUpdate({
        target: btEpicsTable.githubNumber,
        set: { title, description, status, milestoneId, updatedAt: new Date() },
      });
      epicsUpserted++;
    }

    debugLog += `Epics upserted into db: ${epicsUpserted}\n`;

    // Load newly inserted epics to map githubNumber -> DB id
    const dbEpics = await db
      .select({ id: btEpicsTable.id, githubNumber: btEpicsTable.githubNumber })
      .from(btEpicsTable);
    const epicIdByGithubNumber = new Map(
      dbEpics.filter((e) => e.githubNumber !== null).map((e) => [e.githubNumber!, e.id]),
    );

    // ── 3b. Link nested epics to their real parent epic (Git #699) ────────
    // An epic here is really "any issue with sub-issues" — one of those can
    // itself be a sub-issue of ANOTHER epic. Without this, a nested one
    // shows up as an unrelated top-level epic with no tie back to where it
    // actually lives, and if it's closed while its own children stay open,
    // it silently vanishes from every filtered ("open only") view.
    let nestedEpicsLinked = 0;
    for (const pNum of parentNumbers) {
      const ghEpic = issueMapByNumber.get(pNum);
      const ownParentNum = getParentNumber(ghEpic?.parent_issue_url);
      const ownParentEpicId = ownParentNum !== null ? (epicIdByGithubNumber.get(ownParentNum) ?? null) : null;
      if (ownParentEpicId === null) continue;
      await db
        .update(btEpicsTable)
        .set({ parentEpicId: ownParentEpicId, updatedAt: new Date() })
        .where(eq(btEpicsTable.githubNumber, pNum));
      nestedEpicsLinked++;
    }
    debugLog += `Nested epics linked to their parent epic: ${nestedEpicsLinked}\n`;

    // ── 4. Upsert Child and Standalone Issues into bt_issues ──────────────
    let issuesUpserted = 0;
    let inProgressIssueCount = 0;
    for (const gh of fetchedIssues) {
      // Epics themselves are saved in bt_epics, not bt_issues
      if (parentNumbers.has(gh.number)) continue;

      const parentNum = getParentNumber(gh.parent_issue_url);
      const epicId = parentNum !== null ? (epicIdByGithubNumber.get(parentNum) ?? null) : null;
      const previousStatus = previousIssueStatusByNumber.get(gh.number);
      const labels = gh.labels.map((l) => l.name);
      // Git #713 follow-up — Shane: "when I am closing them... you see the
      // green shanemccaw added complete... then it goes away for our view.
      // But then you see at the bottom right 'Close issue' — Git doesn't
      // know it's actually closed." Per CLAUDE.md's own "GitHub issue label
      // sync" convention, `complete` means Claude confirms the code is
      // done — NOT that Shane has reviewed/closed it, which stays his own
      // call, on his own schedule. Every progress number and every "open
      // issues" list up to now only ever looked at GitHub's real
      // open/closed state, so a `complete`-labeled-but-still-open issue
      // counted as unfinished everywhere — this never auto-closes anything,
      // it only teaches OUR local status field to recognize the label.
      const issueStatus: GhIssueStatus = gh.state === "closed"
        ? "closed"
        : labels.includes("complete")
          ? "done"
          : projectInProgress.has(gh.number)
            ? "in_progress"
            : (previousStatus === "in_progress" || previousStatus === "done" || previousStatus === "closed")
              ? previousStatus
              : "backlog";
      const issueMilestoneId = gh.milestone ? (gh.milestone.number ?? gh.milestone.id) : null;

      await db.insert(btIssuesTable).values({
        title: gh.title,
        description: gh.body,
        status: issueStatus,
        epicId,
        milestoneId: issueMilestoneId,
        githubNumber: gh.number,
        githubUrl: gh.html_url,
        labels,
      }).onConflictDoUpdate({
        target: btIssuesTable.githubNumber,
        set: {
          title: gh.title, description: gh.body, status: issueStatus, epicId,
          milestoneId: issueMilestoneId, githubUrl: gh.html_url, labels, updatedAt: new Date(),
        },
      });
      issuesUpserted++;
      if (issueStatus === "in_progress") inProgressIssueCount++;
    }

    debugLog += `Issues upserted into db: ${issuesUpserted}\n`;

    // ── 5. Fetch GitHub Milestones ────────────────────────────────────────
    let syncedMilestones: any[] = [];
    try {
      const msRes = await ghFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/milestones?state=all`);
      if (msRes.ok) {
        const ghMsList = await msRes.json();
        syncedMilestones = ghMsList.map((m: any) => ({
          id: m.number,
          title: m.title,
          description: m.description,
          startDate: new Date().toISOString().split("T")[0],
          targetDate: m.due_on ? m.due_on.split("T")[0] : null,
          status: m.state,
          githubNumber: m.number,
          createdAt: m.created_at,
          updatedAt: m.updated_at,
          epicCount: m.open_issues + m.closed_issues,
        }));
        debugLog += `Milestones fetched from GitHub: ${syncedMilestones.length}\n`;
      }
    } catch (err) {
      debugLog += `Fetching GitHub milestones failed: ${String(err)}\n`;
    }

    await fs.writeFile(debugLogPath, debugLog, "utf-8");

    log.info({ epicsUpserted, issuesUpserted, milestoneCount: syncedMilestones.length }, "GitHub sync complete");
    res.json({
      epics: epicsUpserted,
      issues: issuesUpserted,
      milestones: syncedMilestones,
      // The REAL final count after every signal (status:* label, then
      // Projects v2, then preserved local state) — what the diagnostics
      // below are checked against, not projectStatus.inProgressCount alone,
      // since a label-driven result should never be reported as "0 In
      // Progress" just because the Projects v2 signal itself was empty.
      inProgressIssueCount,
      projectStatus: {
        error: projectStatus.error,
        issuesScanned: projectStatus.issuesScanned,
        issuesWithProjectItems: projectStatus.issuesWithProjectItems,
        issuesWithStatusField: projectStatus.issuesWithStatusField,
        distinctStatusValues: projectStatus.distinctStatusValues,
        inProgressCount: projectInProgress.size,
      },
    });
  } catch (err: any) {
    debugLog += `Sync failed with error: ${err instanceof Error ? err.stack : String(err)}\n`;
    await fs.writeFile(debugLogPath, debugLog, "utf-8");
    log.error({ err }, "github-sync failed");
    res.status(500).json({ error: "GitHub sync failed" });
  }
});


export default router;


