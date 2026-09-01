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
import { db, btEpicsTable, btIssuesTable, btChatsTable, btChatIssuesTable, btBuildQueueTable } from "@workspace/db";
import { eq, ne, desc, asc, isNull, sql, and, inArray } from "drizzle-orm";
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
  const id = parseInt(req.params.id as string, 10);
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
  const id = parseInt(req.params.id as string, 10);
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
        const ghMsList = (await msRes.json()) as any[];
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
        const ghData = (await ghRes.json()) as { number: number };
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
  const id = parseInt(req.params.id as string, 10);
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
  const id = parseInt(req.params.id as string, 10);
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

/**
 * GET /admin/build-tracker/issues — all issues, optionally ?epicId= filtered.
 * Git #829 — switched from requireAdmin (session cookie only) to ingestAuth
 * (Bearer token OR session cookie) so BuildConsole's "issues in this chat's
 * epic" panel can call it too, same as every other extension/app-facing
 * route in this file already does. Still works unchanged for the
 * admin-panel's own session-cookie callers.
 */
router.get("/admin/build-tracker/issues", ingestAuth, async (req: Request, res: Response) => {
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
  const id = parseInt(req.params.id as string, 10);
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
  const id = parseInt(req.params.id as string, 10);
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
 * unlinked (no issueId AND no epicId set yet) — UNLESS `force` is set. Git
 * #781 (Shane: "when I click on the Epic in a chat I already had it's
 * supposed to assign the chat to that epic... not working") — the
 * non-clobbering rule was written to stop the PASSIVE title-sync call
 * (content.js's settle timer, fires on every tab-title change with no
 * intent behind it) from silently relinking a chat, but it was ALSO
 * blocking the panel's own explicit "link to this epic" click, which is a
 * deliberate Shane action and should win. `force: true` is sent only by
 * that click path — the passive title-sync call never sends it, so it
 * keeps its original non-clobbering behavior unchanged.
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
  const { conversation_id, title, issueId, epicId, force } = req.body as {
    conversation_id?: string;
    title?: string;
    issueId?: number | null;
    epicId?: number | null;
    force?: boolean;
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
      if (
        (incomingIssueId !== null || incomingEpicId !== null) &&
        (force || (row.issueId === null && row.epicId === null))
      ) {
        patch.issueId = incomingIssueId;
        patch.epicId = incomingIssueId ? null : incomingEpicId;
        if (patch.epicId && force) {
          // Explicit re-assignment: clear epicId on any other chat previously linked to this epic
          await db
            .update(btChatsTable)
            .set({ epicId: null, updatedAt: new Date() })
            .where(and(eq(btChatsTable.epicId, patch.epicId), ne(btChatsTable.id, row.id)));
        }
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

    if (row.epicId) {
      await db
        .update(btChatsTable)
        .set({ epicId: null, updatedAt: new Date() })
        .where(and(eq(btChatsTable.epicId, row.epicId), ne(btChatsTable.id, row.id)));
    }

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
    const [allEpics, allIssues, allChats, allChatIssues, currentChatRows] = await Promise.all([
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
          id: btChatsTable.id,
          conversationId: btChatsTable.conversationId,
          title: btChatsTable.title,
          issueId: btChatsTable.issueId,
          epicId: btChatsTable.epicId,
          updatedAt: btChatsTable.updatedAt,
          archived: btChatsTable.archived,
          archivedAt: btChatsTable.archivedAt,
          // Git #1480 — the BuildConsole title-bar account toggle's value when this chat was
          // created, so the Chats panel can scope to the currently-selected account.
          account: btChatsTable.account,
        })
        .from(btChatsTable)
        .orderBy(desc(btChatsTable.updatedAt)),
      db
        .select({
          chatId: btChatIssuesTable.chatId,
          issueNumber: btChatIssuesTable.issueNumber,
        })
        .from(btChatIssuesTable)
        .catch(() => []),
      conversationId
        ? db.select().from(btChatsTable).where(eq(btChatsTable.conversationId, conversationId)).limit(1)
        : Promise.resolve([]),
    ]);

    const epics = allEpics.filter((e) => e.status !== "closed");
    const issues = allIssues.filter((i) => i.status !== "closed" && i.status !== "done");

    // Map associated issue numbers by chat ID
    const issuesByChatId = new Map<number, number[]>();
    for (const ci of allChatIssues as Array<{ chatId: number; issueNumber: number }>) {
      const list = issuesByChatId.get(ci.chatId) || [];
      list.push(ci.issueNumber);
      issuesByChatId.set(ci.chatId, list);
    }

    const epicByIdMap = new Map(allEpics.map((e) => [e.id, e]));
    const issueByIdMap = new Map(allIssues.map((i) => [i.id, i]));

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
    // Git #728 follow-up — Shane: "I only know their issue number... how do
    // I get back to their chat." Needs the chat linked to a SPECIFIC issue,
    // by GitHub number (what he actually has in hand), not just an epic —
    // issueGithubNumber resolved against allIssues (unfiltered) so a chat
    // pointing at an issue that's since closed/done still resolves.
    const chats = allChats.map((c) => {
      let epicId = c.epicId;
      let issueGithubNumber: number | null = null;
      if (c.issueId) {
        const linkedIssue = allIssues.find((i) => i.id === c.issueId);
        issueGithubNumber = linkedIssue?.githubNumber ?? null;
        if (!epicId) epicId = linkedIssue?.epicId ?? null;
      }
      const explicitIssues = issuesByChatId.get(c.id) || [];
      const combined = new Set(explicitIssues);
      if (issueGithubNumber) combined.add(issueGithubNumber);
      if (epicId && epicByIdMap.get(epicId)?.githubNumber) {
        combined.add(epicByIdMap.get(epicId)!.githubNumber!);
      }
      return {
        conversationId: c.conversationId,
        title: c.title,
        epicId,
        issueGithubNumber,
        associatedIssueNumbers: Array.from(combined),
        claudeUrl: claudeUrl(c.conversationId),
        updatedAt: c.updatedAt,
        archived: c.archived,
        archivedAt: c.archivedAt,
        // Git #1480 — see the select() above; "primary" | "secondary".
        account: c.account,
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

/**
 * Only a real 404 means "this issue doesn't exist" — a bad/expired
 * GITHUB_TOKEN (401), a lapsed PAT scope or rate limit (403), or a GitHub
 * 5xx all used to collapse into the same null-returned "not found on
 * GitHub" response, which reads as "that issue number is wrong" when the
 * issue is real and the actual cause is server-side auth/rate-limiting.
 * Non-404 failures now throw with the real status + body so callers (and
 * their error responses) say what actually happened.
 */
async function ghFetchIssue(number: number): Promise<GitHubIssuePayload | null> {
  const res = await ghFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/issues/${number}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub API returned HTTP ${res.status} fetching issue #${number}: ${body.slice(0, 300)}`);
  }
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
  const [existing] = await db
    .select({ status: btEpicsTable.status })
    .from(btEpicsTable)
    .where(eq(btEpicsTable.githubNumber, gh.number))
    .limit(1);
  const previousStatus = existing?.status;
  // GitHub's own open/closed state is authoritative in both directions —
  // closed always wins, but a REOPEN must be able to clear a stale local
  // "closed" too. Git #759 (Shane): #658 was closed then reopened under
  // #647 on GitHub, but stayed invisible through multiple re-syncs of the
  // epic because the old code only ever set status TO "closed" and never
  // set it back. Only "in_progress" is genuinely local-only (no GitHub
  // signal) and worth carrying forward.
  const status: "closed" | "in_progress" | "open" =
    gh.state === "closed" ? "closed" : previousStatus === "in_progress" ? "in_progress" : "open";
  const [row] = await db
    .insert(btEpicsTable)
    .values({
      title: gh.title,
      description: gh.body,
      status,
      githubNumber: gh.number,
      milestoneId,
      parentEpicId,
    })
    .onConflictDoUpdate({
      target: btEpicsTable.githubNumber,
      set: {
        title: gh.title,
        description: gh.body,
        status,
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
  const [existing] = await db
    .select({ status: btIssuesTable.status })
    .from(btIssuesTable)
    .where(eq(btIssuesTable.githubNumber, gh.number))
    .limit(1);
  const previousStatus = existing?.status;
  // `complete` means done in code, not yet reviewed/closed by Shane himself
  // — see the full sync's matching comment above for the full story (Git
  // #713 follow-up). GitHub's real state/labels are authoritative in both
  // directions (Git #759 fix, same bug class as upsertEpicRow above): a
  // reopened issue with no "complete" label must fall back to "backlog",
  // not stick at a stale "closed"/"done" from before it was reopened. Only
  // "in_progress" is genuinely local-only and safe to carry forward.
  const status: "closed" | "done" | "in_progress" | "backlog" =
    gh.state === "closed"
      ? "closed"
      : labels.includes("complete")
        ? "done"
        : previousStatus === "in_progress"
          ? "in_progress"
          : "backlog";
  await db
    .insert(btIssuesTable)
    .values({
      title: gh.title,
      description: gh.body,
      status,
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
        status,
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

    // Git #737 follow-up — Shane: "if I search for a Issue number 686 it
    // should bring back the epic too so I can get to the chat." Resolved
    // straight from GitHub's own parent_issue_url (authoritative, doesn't
    // depend on our local sync having run recently) rather than trusting a
    // possibly-stale bt_issues.epic_id — then matched against bt_epics
    // (best-effort: null if that epic isn't tracked here at all yet).
    //
    // Git #752 follow-up — Shane searched #704 (itself a nested epic under
    // #647), clicked it, and landed on #647's chat instead: this only ever
    // resolved the PARENT epic via parent_issue_url, never checked whether
    // the searched number itself IS an epic. Same unification
    // /extension/in-progress already uses — the epic whose chat this
    // should resolve to is the number itself if it's an epic, its parent
    // otherwise.
    const isEpic = !!(gh.sub_issues_summary && gh.sub_issues_summary.total > 0);
    const epicLookupNum = isEpic ? gh.number : getParentNumber(gh.parent_issue_url);
    let epic: { id: number; title: string; githubNumber: number | null } | null = null;
    if (epicLookupNum !== null) {
      const [epicRow] = await db
        .select({ id: btEpicsTable.id, title: btEpicsTable.title, githubNumber: btEpicsTable.githubNumber })
        .from(btEpicsTable)
        .where(eq(btEpicsTable.githubNumber, epicLookupNum))
        .limit(1);
      epic = epicRow ?? null;
    }

    res.json({
      number: gh.number,
      title: gh.title,
      state: gh.state,
      labels: gh.labels.map((l) => l.name),
      htmlUrl: gh.html_url,
      isEpic,
      epic,
    });
  } catch (err) {
    log.error({ err, number }, "GET /extension/issue-lookup failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Lookup failed" });
  }
});

/**
 * GET /admin/build-tracker/extension/file-content?path=<repo-relative path>
 *
 * Shane: "if that thing is for me to run a SQL script, a link should be
 * shown to load the SQL file into the floaty SQL panel." Reads straight
 * from GitHub's Contents API (not the local filesystem — the api-server
 * process running this route isn't guaranteed to be the same checkout as
 * what's on GitHub, and this avoids ever needing that assumption) so it
 * works from wherever this server happens to be running.
 *
 * `path` is restricted to `lib/db/migrations/manual/*.sql` — the one
 * concrete use case asked for. Not a general file-read endpoint.
 *
 * Auth: admin session cookie OR Authorization: Bearer <BUILD_TRACKER_INGEST_TOKEN>
 */
router.get("/admin/build-tracker/extension/file-content", ingestAuth, async (req: Request, res: Response) => {
  if (!process.env.GITHUB_TOKEN) {
    res.status(503).json({ error: "GITHUB_TOKEN is not set on this server" });
    return;
  }
  const path = typeof req.query.path === "string" ? req.query.path : "";
  if (!/^lib\/db\/migrations\/manual\/[\w.-]+\.sql$/.test(path)) {
    res.status(400).json({ error: "path must be a lib/db/migrations/manual/*.sql file" });
    return;
  }
  try {
    const ghRes = await ghFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/contents/${path}`);
    if (!ghRes.ok) {
      res.status(404).json({ error: `${path} not found on GitHub` });
      return;
    }
    const data = (await ghRes.json()) as { content?: string; encoding?: string };
    if (!data.content || data.encoding !== "base64") {
      res.status(502).json({ error: "Unexpected response from GitHub Contents API" });
      return;
    }
    const content = Buffer.from(data.content, "base64").toString("utf-8");
    res.json({ path, content });
  } catch (err) {
    log.error({ err, path }, "GET /extension/file-content failed");
    res.status(500).json({ error: "Failed to read file" });
  }
});

/**
 * GET /admin/build-tracker/extension/in-progress
 *
 * Git #723 follow-up — Shane: "The In Progress panel should show me
 * everything in progress not just what Epic chat I am currently looking
 * at." The panel already filtered its issue list GLOBALLY, not by current
 * epic — the real gap was that it only ever read Build Tracker's own
 * synced DB, and this session's syncs have all been TARGETED (a specific
 * epic, a specific issue), never a full repo pull. Other concurrent
 * sessions' in-flight work (different epics entirely) was simply never
 * pulled into bt_issues at all, so it couldn't show up no matter how the
 * filtering logic worked. This reads straight from GitHub's own
 * `in-flight` label instead — repo-wide, regardless of what's synced
 * locally — same "bypass the local DB, ask GitHub directly" pattern
 * issue-lookup already uses.
 *
 * Auth: admin session cookie OR Authorization: Bearer <BUILD_TRACKER_INGEST_TOKEN>
 */
router.get("/admin/build-tracker/extension/in-progress", ingestAuth, async (_req: Request, res: Response) => {
  if (!process.env.GITHUB_TOKEN) {
    res.status(503).json({ error: "GITHUB_TOKEN is not set on this server" });
    return;
  }
  try {
    // Git #723 follow-up (3) — Shane: "when the build agent sets the label
    // Done its disappearing from the left In Progress panel... It should
    // stay there highlighted green — then ONLY go away once the issue is
    // Closed totally." The bookend workflow REMOVES in-flight and ADDS
    // complete on completion (CLAUDE.md's own label-sync rule), so a
    // query for only `labels=in-flight` lost the issue the instant it
    // finished — before Shane ever reviewed/closed it. GitHub's issues-list
    // `labels` param is an AND filter, not OR, so this needs two separate
    // fetches (one per label) merged and deduped by number — the client
    // already knows how to render a complete-labeled row green
    // (buildIssueRow's own isComplete styling), it just needs the row to
    // still be IN the list.
    // "Shane To-Do" (Git #744 follow-up) rides along in this same merged
    // fetch — an action-for-Shane issue shows up in its own section below,
    // same "ask GitHub directly, not the local DB" reasoning as the rest of
    // this endpoint. "blocked" (Git #784) rides along the same way — a
    // blocked build has its in-flight label swapped for blocked (per
    // CLAUDE.md's own workflow rule), so without fetching this label
    // separately a blocked build would silently vanish from the panel
    // entirely instead of showing up flagged.
    const collectedByNumber = new Map<number, GitHubIssuePayload>();
    for (const label of ["in-flight", "complete", "Shane To-Do", "blocked"]) {
      let page = 1;
      while (page <= 5) {
        const ghRes = await ghFetch(
          `/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100&page=${page}`,
        );
        if (!ghRes.ok) break;
        const pageIssues = (await ghRes.json()) as GitHubIssuePayload[];
        for (const gh of pageIssues) if (!gh.pull_request) collectedByNumber.set(gh.number, gh);
        if (pageIssues.length < 100) break;
        page++;
      }
    }
    const collected = Array.from(collectedByNumber.values());

    // Shane: "If that thing is for me to run a SQL script, a link should
    // be shown to load the SQL file into the floaty SQL panel." CLAUDE.md's
    // own "Shane To-Do" convention says to reference the migration file's
    // real repo-relative path somewhere in the issue body — pull that out
    // here so the client can offer a one-click load.
    const SQL_PATH_RE = /lib\/db\/migrations\/manual\/[\w.-]+\.sql/;
    const sqlPathFor = (gh: GitHubIssuePayload) => gh.body?.match(SQL_PATH_RE)?.[0] ?? null;

    // Git #723 follow-up (2) — Shane: "I tend to work 2-3 epics at a time...
    // I should be able to mark those Epics as in progress [and see them
    // here too]." An epic in-flight-labeled directly is already included
    // above (this endpoint doesn't discriminate issue vs. epic, just checks
    // the label) — it just needs its OWN chat resolved, not a parent's.
    // "Which epic does this row's chat come from" is: itself, if this row
    // IS an epic; its parent, otherwise — one unified lookup number either
    // way, batched into a single query.
    const isEpicRow = (gh: GitHubIssuePayload) => !!(gh.sub_issues_summary && gh.sub_issues_summary.total > 0);
    const lookupNumberFor = (gh: GitHubIssuePayload) => (isEpicRow(gh) ? gh.number : getParentNumber(gh.parent_issue_url));

    const lookupNums = Array.from(
      new Set(collected.map(lookupNumberFor).filter((n): n is number => n !== null)),
    );
    const epicRows = lookupNums.length > 0
      ? await db
          .select({ id: btEpicsTable.id, title: btEpicsTable.title, githubNumber: btEpicsTable.githubNumber })
          .from(btEpicsTable)
          .where(inArray(btEpicsTable.githubNumber, lookupNums))
      : [];
    const epicByNumber = new Map(epicRows.map((e) => [e.githubNumber, e]));

    // Git #784 — Shane: "if you are blocked and have to wait, update the Git
    // issue with a label 'blocked'... what would be great is if it could
    // tell us what build it was waiting for." CLAUDE.md's new workflow rule
    // has the agent set a REAL GitHub blocked-by dependency, not just the
    // label — resolved here, per blocked item, into the specific issue it's
    // waiting on so the panel can nest it and show whether that wait is
    // actually over yet.
    type BlockedByInfo = { number: number; title: string; state: string; complete: boolean };
    const blockedByMap = new Map<number, BlockedByInfo | null>();
    for (const gh of collected) {
      if (!gh.labels.some((l) => l.name === "blocked")) continue;
      try {
        const depRes = await ghFetch(
          `/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/issues/${gh.number}/dependencies/blocked_by`,
        );
        if (!depRes.ok) { blockedByMap.set(gh.number, null); continue; }
        const deps = (await depRes.json()) as Array<{
          number: number; title: string; state: string; labels?: Array<{ name: string }>;
        }>;
        const first = deps[0];
        blockedByMap.set(
          gh.number,
          first
            ? {
                number: first.number,
                title: first.title,
                state: first.state,
                complete: (first.labels ?? []).some((l) => l.name === "complete"),
              }
            : null,
        );
      } catch {
        blockedByMap.set(gh.number, null);
      }
    }

    const issues = collected.map((gh) => {
      const lookupNum = lookupNumberFor(gh);
      const epic = lookupNum !== null ? (epicByNumber.get(lookupNum) ?? null) : null;
      const labels = gh.labels.map((l) => l.name);
      return {
        githubNumber: gh.number,
        title: gh.title,
        labels,
        githubUrl: gh.html_url,
        isEpic: isEpicRow(gh),
        epic,
        isTodo: labels.includes("Shane To-Do"),
        sqlPath: sqlPathFor(gh),
        isBlocked: labels.includes("blocked"),
        blockedBy: blockedByMap.get(gh.number) ?? null,
      };
    });

    res.json({ issues });
  } catch (err) {
    log.error({ err }, "GET /extension/in-progress failed");
    res.status(500).json({ error: "Failed to list in-progress issues" });
  }
});

/**
 * POST /admin/build-tracker/extension/queue
 *
 * Git #790 — Shane: "if we could really build me a true queued up build...
 * that would speed up my development time like mad." Adds one build to the
 * queue; `scripts/build-queue-watcher.ps1` (a persistent local watcher
 * Shane runs on his own machine) polls GET .../queue/next below and
 * launches it for real once it's ready.
 *
 * Body: { title, prompt, model?, effort?, cwd?, githubNumber?, blockedByNumbers?: number[] }
 * (blockedByNumber, singular, still accepted for old callers — folded into blockedByNumbers.)
 * Auth: admin session cookie OR Authorization: Bearer <BUILD_TRACKER_INGEST_TOKEN>
 */
router.post("/admin/build-tracker/extension/queue", ingestAuth, async (req: Request, res: Response) => {
  const { title, prompt, model, effort, cwd, githubNumber, blockedByNumber, blockedByNumbers, resumeSessionId, originatingChatId, chatUrl, buildSet, cli } = req.body as {
    title?: string;
    prompt?: string;
    model?: string | null;
    effort?: string | null;
    cwd?: string | null;
    githubNumber?: number | null;
    blockedByNumber?: number | null;
    blockedByNumbers?: number[] | null;
    /** Git #826 — set by a Reply action: the watcher launches this item with --resume <this> + `prompt` as the reply text, continuing that exact conversation instead of starting a stateless new one. */
    resumeSessionId?: string | null;
    /** Originating chat conversation UUID when queued from a chat */
    originatingChatId?: string | null;
    /** Full chat URL when queued from a chat */
    chatUrl?: string | null;
    buildSet?: string | null;
    cli?: string | null;
  };
  if (!title?.trim() || !prompt?.trim()) {
    res.status(400).json({ error: "title and prompt are required" });
    return;
  }
  const manualBlockers = Array.from(new Set([
    ...(Array.isArray(blockedByNumbers) ? blockedByNumbers.filter((n) => typeof n === "number") : []),
    ...(typeof blockedByNumber === "number" ? [blockedByNumber] : []),
  ]));
  const resolvedGithubNumber = typeof githubNumber === "number" ? githubNumber : null;
  let gitBlockers: number[] = [];
  if (resolvedGithubNumber != null) {
    try {
      gitBlockers = await fetchRealBlockedByNumbers(resolvedGithubNumber);
    } catch (err) {
      log.warn({ err, resolvedGithubNumber }, "Failed to fetch real blockers at queue time");
    }
  }
  const allBlockers = Array.from(new Set([...manualBlockers, ...gitBlockers]));
  try {
    // Git #823 — Shane: "We should be going based on the ID here... 805 =
    // playing 805 = done, not a new row for playing new row for done new
    // row for error." Queuing (or retrying, which POSTs here the same way)
    // an issue-linked build used to always INSERT, so every Queue/Retry
    // click for the same issue piled up another top-level tree entry —
    // real duplicates, not a rendering artifact (unlike #818). An
    // issue-linked build has a natural identity (its own githubNumber);
    // reuse whatever row already exists for that number instead of
    // spawning a new one, so #805 stays exactly one row that transitions
    // queued -> running -> done/failed and back to queued on retry. A
    // build NOT tied to a real issue (githubNumber null) has no natural
    // identity to dedupe on, so those still insert fresh every time.
    let row;
    if (resolvedGithubNumber != null) {
      const [existing] = await db
        .select({ id: btBuildQueueTable.id })
        .from(btBuildQueueTable)
        .where(
          and(
            eq(btBuildQueueTable.githubNumber, resolvedGithubNumber),
            ne(btBuildQueueTable.status, "running")
          )
        )
        .orderBy(desc(btBuildQueueTable.createdAt))
        .limit(1);
      if (existing) {
        [row] = await db
          .update(btBuildQueueTable)
          .set({
            title: title.trim(),
            prompt,
            model: model?.trim() || null,
            effort: effort?.trim() || null,
            cwd: cwd?.trim() || null,
            blockedByNumber: allBlockers[0] ?? null,
            blockedByNumbers: allBlockers.length > 0 ? allBlockers : null,
            resumeSessionId: resumeSessionId ?? null,
            originatingChatId: originatingChatId?.trim() || null,
            chatUrl: chatUrl?.trim() || null,
            buildSet: buildSet?.trim() || null,
            cli: cli?.trim() || null,
            status: "queued",
            claimedAt: null,
            completedAt: null,
            exitCode: null,
            updatedAt: new Date(),
          })
          .where(eq(btBuildQueueTable.id, existing.id))
          .returning();
      }
    }
    if (!row) {
      [row] = await db
        .insert(btBuildQueueTable)
        .values({
          title: title.trim(),
          prompt,
          model: model?.trim() || null,
          effort: effort?.trim() || null,
          cwd: cwd?.trim() || null,
          githubNumber: resolvedGithubNumber,
          blockedByNumber: allBlockers[0] ?? null,
          blockedByNumbers: allBlockers.length > 0 ? allBlockers : null,
          resumeSessionId: resumeSessionId ?? null,
          originatingChatId: originatingChatId?.trim() || null,
          chatUrl: chatUrl?.trim() || null,
          buildSet: buildSet?.trim() || null,
          cli: cli?.trim() || null,
        })
        .returning();
    }
    res.status(201).json(row);

    // Shane: "Anytime a build with a Git number is queued, you should also
    // update the Git Issue with In-Flight label." Mirrors the SAME
    // in-flight/complete convention CLAUDE.md's session bookends already
    // apply by hand — this just fires it automatically the moment ANY
    // queue action lands here (fresh queue, retry, or a Reply resume all
    // POST this same route), so an issue reflects "actively queued/being
    // worked" without Shane or an agent remembering to run `gh issue edit`.
    // Fire-and-forget AFTER responding — GitHub label-sync latency must
    // never delay the queue action itself — and fully non-fatal: a missing
    // GITHUB_TOKEN or a rejected GitHub call just skips/logs, it never
    // fails the build that's already been queued.
    if (resolvedGithubNumber != null && process.env.GITHUB_TOKEN) {
      void (async () => {
        try {
          const addRes = await ghFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/issues/${resolvedGithubNumber}/labels`, {
            method: "POST",
            body: JSON.stringify({ labels: ["in-flight"] }),
          });
          if (!addRes.ok) {
            log.warn({ status: addRes.status, githubNumber: resolvedGithubNumber }, "queue: couldn't add in-flight label (non-fatal)");
          }
          // "complete" means done-in-code-awaiting-review; a build going back
          // into the queue (retry/reply) means it's no longer in that state.
          const removeRes = await ghFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/issues/${resolvedGithubNumber}/labels/${encodeURIComponent("complete")}`, {
            method: "DELETE",
          });
          if (!removeRes.ok && removeRes.status !== 404) {
            log.warn({ status: removeRes.status, githubNumber: resolvedGithubNumber }, "queue: couldn't remove complete label (non-fatal)");
          }
        } catch (err) {
          log.warn({ err, githubNumber: resolvedGithubNumber }, "queue: in-flight label sync failed (non-fatal)");
        }
      })();
    }
  } catch (err) {
    log.error({ err }, "POST /extension/queue failed");
    res.status(500).json({ error: "Failed to queue build" });
  }
});

/**
 * Git #799 — Shane: real issue #797 already carries a real GitHub
 * "blocked by #796" dependency (set via CLAUDE.md's #784 workflow), but the
 * queue only ever looked at `blockedByNumber` — the column set from an
 * explicit `--blocked-by` flag typed at queue time, which Shane never set
 * for #797. GitHub's real dependency is the actual source of truth (same
 * one /extension/in-progress already reads for the Epics/Issues sections),
 * so it wins whenever the queued build IS a real tracked issue; the stored
 * column only matters as a manual override for a queued prompt that isn't
 * tied to a real issue at all.
 */
/** Git #813 — GitHub's own dependency list can hold more than one blocker; earlier code only ever read deps[0], silently dropping the rest. */
/**
 * Git #904 — Shane: "The Build Queue is giving me a Couldn't reach the API
 * error." Real cause: `ghFetch` (below) uses plain `fetch()` with no
 * timeout at all. `GET /extension/queue` calls this once per active
 * (queued/running) row via `effectiveBlockedByNumbers`, all in parallel via
 * `Promise.all` — if GitHub is slow to answer even ONE of those calls (very
 * plausible right now: #876/#899 both exist because this exact token has
 * been hammering GitHub's API all day, and a token under rate-limit
 * pressure is exactly when GitHub itself starts responding slowly rather
 * than outright rejecting), that one hung call blocks the ENTIRE queue
 * response indefinitely, since `Promise.all` waits for every row before
 * `res.json()` ever runs — easily outlasting BuildConsole's 20s
 * `HttpClient.Timeout`, which is the literal exception Shane saw. A 5s
 * AbortController timeout bounds the worst case: one slow blocked-by check
 * degrades to "fall back to the stored column(s)" (the existing catch
 * already does this for any other error) instead of stalling the whole
 * queue panel.
 */
async function fetchRealBlockedByNumbers(issueNumber: number): Promise<number[]> {
  if (!process.env.GITHUB_TOKEN) return [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const depRes = await ghFetch(
        `/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/issues/${issueNumber}/dependencies/blocked_by`,
        { signal: controller.signal },
      );
      if (!depRes.ok) return [];
      const deps = (await depRes.json()) as Array<{ number: number }>;
      return deps.map((d) => d.number);
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return [];
  }
}

/**
 * Git #813 — real multi-blocker support: an item can wait on several other
 * builds/issues at once (Shane tried "--blocked-by 807,808,809" for exactly
 * this). Real GitHub dependencies still win over the stored column(s) when
 * the queued build IS a real tracked issue, same priority #799 established
 * for the single-blocker case — just over the full list now instead of [0].
 */
async function effectiveBlockedByNumbers(
  item: { githubNumber: number | null; blockedByNumber: number | null; blockedByNumbers?: number[] | null; status?: string },
  allowLiveFetch: boolean,
): Promise<number[]> {
  // Git #899 — Shane: "I am still getting rate limited quickly. Is there an
  // API call this thing is making to our API that is then calling git?"
  // Yes: GET /extension/queue (below) calls this once per row, and this
  // function used to call the real GitHub API per row when it had a
  // githubNumber - with at least 4 independent BuildConsole timers polling
  // that route (MainWindow's 3s _buildTailTimer, BuildWatchWindow's 3s
  // _pollTimer, QueueWatcherService's 10s background watcher, BuildQueuePanel's
  // 15s _pollTimer - #899's own fix only added a 5s per-call timeout + gated
  // to active rows, neither of which stops the automatic polling itself),
  // that was still real, continuous GitHub traffic on the shared 5,000/hr
  // limit — the exact same "this app is killing my git connections" problem
  // Shane already had BuildConsole's own client-side pollers fixed for
  // (2026-08-14, manual-refresh-only) but which persisted here because this
  // leak is server-side, one hop away from any BuildConsole code Shane could
  // see doing it.
  //
  // 2026-08-14 (Shane, same request, follow-up sighting: "Something still
  // made 139 calls in 13 minutes"): the live per-row fetch is now OFF by
  // default - `allowLiveFetch` must be explicitly true, and nothing in this
  // route passes that today, so it never fires from an automatic poll.
  // Retained (not deleted) for a future genuine manual "refresh blocked-by
  // status" trigger to opt into via `?liveBlocked=1`; until Shane wants
  // that wired up, the badge reflects whatever was last written to the
  // stored column(s) by an explicit action (SetBlockedByDialog, sync-epic,
  // github-sync, quick-sync).
  const isActive = item.status === "queued" || item.status === "running";
  if (allowLiveFetch && isActive && item.githubNumber != null) {
    const real = await fetchRealBlockedByNumbers(item.githubNumber);
    if (real.length > 0) return real;
  }
  if (item.blockedByNumbers && item.blockedByNumbers.length > 0) return item.blockedByNumbers;
  return item.blockedByNumber != null ? [item.blockedByNumber] : [];
}

/**
 * Git #1600 — REMOVED here: isBlockerCleared/areBlockersCleared used to decide a
 * blocker was "cleared" from the local queue's own confirmed completion (a `done`
 * row for that githubNumber, real exit code 0) — checked FIRST, before ever asking
 * GitHub, on the theory that a session exiting 0 was itself good enough and Shane's
 * own issue-closing was "an unrelated, purely-cosmetic archival gate."
 *
 * That is precisely how #1483 started while its real blocker #1482 was still open,
 * unverified, and mid-deploy to the same container app: #1482's session had exited
 * 0 (a local "done"/"verifying" row) but its real GitHub issue was still open. A
 * session exiting is not the work being verified. A commit landing on main is not
 * the issue closing. Only a closed GitHub issue releases a dependent — no exception
 * for a local "done" row, no exception for "verifying", no exception for a cleanly
 * exited session. The live replacement (isIssueOpenLive, used inline below) queries
 * GitHub directly for each blocker's real current state and fails closed (holds)
 * if GitHub can't be reached — see its own doc comment.
 */

/**
 * Git #1600 — the real, current state of one issue on GitHub, queried live at
 * dispatch time. Returns `true` (open), `false` (closed), or `null` when GitHub
 * couldn't be reached — a caller MUST treat `null` as "hold, don't release" (fail
 * closed), never as either open or closed. Same 5s AbortController timeout as
 * fetchRealBlockedByNumbers, same reasoning: this only ever runs for the (typically
 * few) blocker numbers actually declared by currently-queued items, not a poll over
 * every row, so it doesn't reopen the #899/2026-08-14 continuous-GitHub-traffic leak
 * that gated the rest of this file's live fetches behind allowLiveFetch.
 */
async function isIssueOpenLive(issueNumber: number): Promise<boolean | null> {
  if (!process.env.GITHUB_TOKEN) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await ghFetch(
        `/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/issues/${issueNumber}`,
        { signal: controller.signal },
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { state?: string };
      return data.state !== "closed";
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

/**
 * Git #1600 — every blocker in the list must be confirmed CLOSED, live, right now.
 * Returns `false` (hold) the moment any blocker comes back open OR unreachable —
 * fail closed, no partial credit.
 */
async function areBlockersClearedLive(blockerNums: number[]): Promise<boolean> {
  if (blockerNums.length === 0) return true;
  const states = await Promise.all(blockerNums.map(isIssueOpenLive));
  return states.every((open) => open === false);
}

/**
 * GET /admin/build-tracker/extension/queue
 *
 * Git #865 — every queue row, terminal or not. Shane: "it should still stay around,
 * just be marked done and filtered out... there are filters at the top of
 * the Build Queue, use those." Used to drop done/failed/canceled rows from
 * the response 30 minutes after they finished (QUEUE_TERMINAL_VISIBLE_MS) so
 * the panel's own All/Done/Canceled filter chips never had a chance to show
 * them — the chips filter what's already in memory, they can't filter data
 * that was never sent. Returns every row now; the existing client-side chips
 * (BuildQueuePanel.ApplyFilter) are the real filtering mechanism.
 */
router.get("/admin/build-tracker/extension/queue", ingestAuth, async (req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(btBuildQueueTable)
      .orderBy(asc(btBuildQueueTable.createdAt));
    // Git #799/#813 — real GitHub dependency (or dependencies, plural)
    // overrides the stored column(s) for display too, so nesting in the
    // panel matches what's actually true. blockedByNumber (singular) stays
    // for older consumers, set to the first blocker.
    //
    // `allowLiveFetch` (2026-08-14, see effectiveBlockedByNumbers's own
    // comment): this route is polled automatically by at least 4 BuildConsole
    // timers, so a real GitHub call per active row here was genuine
    // continuous, automatic GitHub traffic — off by default. `?liveBlocked=1`
    // is the escape hatch for a future explicit manual-refresh action; no
    // current caller sets it.
    const allowLiveFetch = req.query.liveBlocked === "1";
    const items = await Promise.all(
      rows.map(async (row) => {
        const blockers = await effectiveBlockedByNumbers(row, allowLiveFetch);
        return { ...row, blockedByNumbers: blockers, blockedByNumber: blockers[0] ?? null };
      }),
    );
    res.json({ items });
  } catch (err) {
    log.error({ err }, "GET /extension/queue failed");
    res.status(500).json({ error: "Failed to list queue" });
  }
});

/**
 * GET /admin/build-tracker/extension/queue/next?limit=N
 *
 * The watcher's own poll — claims up to `limit` ready rows (status=queued, and
 * either no blocker or every blocker confirmed CLOSED on GitHub live, right now —
 * Git #1600, see areBlockersClearedLive) and marks them `running` atomically (the
 * UPDATE's own `WHERE status = 'queued'` guards against a double-claim if this
 * ever polls faster than a previous claim lands). `limit` is the watcher's own
 * free-slot count (its configured max concurrent minus however many it's already
 * running) — this route has no concurrency opinion of its own, the watcher owns
 * that entirely.
 */
router.get("/admin/build-tracker/extension/queue/next", ingestAuth, async (req: Request, res: Response) => {
  const limit = Math.max(0, Math.min(20, parseInt(String(req.query.limit ?? "1"), 10) || 0));
  if (limit === 0) { res.json({ items: [] }); return; }
  const excludeIds = String(req.query.exclude ?? "")
    .split(",")
    .map(id => parseInt(id, 10))
    .filter(id => !isNaN(id));
  try {
    const queued = await db
      .select()
      .from(btBuildQueueTable)
      .where(eq(btBuildQueueTable.status, "queued"))
      .orderBy(asc(btBuildQueueTable.createdAt));

    const ready: typeof queued = [];
    for (const item of queued) {
      if (ready.length >= limit) break;
      if (excludeIds.includes(item.id)) continue;
      if (item.githubNumber != null && item.blockedByNumbers === null) {
        try {
          const gitBlockers = await fetchRealBlockedByNumbers(item.githubNumber);
          await db
            .update(btBuildQueueTable)
            .set({
              blockedByNumbers: gitBlockers,
              blockedByNumber: gitBlockers[0] ?? null,
              updatedAt: new Date(),
            })
            .where(eq(btBuildQueueTable.id, item.id));
          item.blockedByNumbers = gitBlockers;
          item.blockedByNumber = gitBlockers[0] ?? null;
        } catch (fetchErr) {
          log.error({ fetchErr, githubNumber: item.githubNumber }, "Failed to fetch and cache GitHub blockers in queue/next");
        }
      }
      const blockerNums = await effectiveBlockedByNumbers(item, false);
      if (blockerNums.length === 0) { ready.push(item); continue; }
      // Git #1600 — live GitHub re-check, no exceptions. A local "done"/"verifying"
      // row, a cleanly-exited session, or commits already on main are never enough;
      // only a blocker GitHub itself reports closed releases this item. Unreachable
      // GitHub holds too (fail closed) — never falls through to "ready" on a null.
      if (await areBlockersClearedLive(blockerNums)) {
        ready.push(item);
      } else {
        log.info({ itemId: item.id, githubNumber: item.githubNumber, blockerNums }, "queue/next: held — blocker(s) still open or GitHub unreachable (Git #1600, fail closed)");
      }
    }
    if (ready.length === 0) { res.json({ items: [] }); return; }

    const claimed = await db
      .update(btBuildQueueTable)
      .set({ status: "running", claimedAt: new Date(), updatedAt: new Date() })
      .where(and(
        inArray(btBuildQueueTable.id, ready.map((r) => r.id)),
        eq(btBuildQueueTable.status, "queued"),
      ))
      .returning();
    res.json({ items: claimed });
  } catch (err) {
    log.error({ err }, "GET /extension/queue/next failed");
    res.status(500).json({ error: "Failed to claim next queue item(s)" });
  }
});

/**
 * POST /admin/build-tracker/extension/queue/:id/complete
 *
 * The watcher calls this once the claude.exe process it launched for this
 * row actually exits — exitCode 0 means `done`, anything else `failed`, so
 * Shane can tell a queued build that silently errored apart from one that
 * actually finished, from the panel alone.
 *
 * Body: { exitCode: number, sessionId?: string }
 * Git #826 — sessionId (captured by the watcher from the run's own
 * stream-json output) is stored here so a later Reply action can find it
 * and resume the exact same conversation.
 */
router.post("/admin/build-tracker/extension/queue/:id/complete", ingestAuth, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
  const { exitCode, sessionId } = req.body as { exitCode?: number; sessionId?: string | null };
  try {
    const [row] = await db
      .update(btBuildQueueTable)
      .set({
        status: exitCode === 0 ? "done" : "failed",
        exitCode: typeof exitCode === "number" ? exitCode : null,
        completedAt: new Date(),
        updatedAt: new Date(),
        ...(sessionId ? { sessionId } : {}),
      })
      .where(eq(btBuildQueueTable.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "not found" }); return; }
    res.json(row);
  } catch (err) {
    log.error({ err, id }, "POST /extension/queue/:id/complete failed");
    res.status(500).json({ error: "Failed to mark queue item complete" });
  }
});

/**
 * DELETE /admin/build-tracker/extension/queue/:id
 *
 * Cancels a QUEUED item only — once the watcher's claimed it (`running`),
 * canceling here wouldn't actually stop the already-launched claude.exe
 * process, so that'd be a lie the UI shouldn't tell.
 */
router.delete("/admin/build-tracker/extension/queue/:id", ingestAuth, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
  try {
    const [row] = await db
      .update(btBuildQueueTable)
      .set({ status: "canceled", updatedAt: new Date() })
      .where(and(eq(btBuildQueueTable.id, id), eq(btBuildQueueTable.status, "queued")))
      .returning();
    if (!row) { res.status(409).json({ error: "Only a still-queued item can be canceled" }); return; }
    res.json(row);
  } catch (err) {
    log.error({ err, id }, "DELETE /extension/queue/:id failed");
    res.status(500).json({ error: "Failed to cancel queue item" });
  }
});

/**
 * POST /admin/build-tracker/extension/queue/:id/force-claim
 *
 * Git #820 — Shane: "I need right click like. Stop. Retry. Run Now." Run
 * Now needs to atomically claim a specific still-queued row RIGHT NOW,
 * bypassing the normal blocker-clear check and free-slot limit (that's the
 * whole point of overriding it) — GET /extension/queue/next above can't be
 * reused for this since it always enforces both. The CALLER (a watcher —
 * standalone script or the WPF app's in-process one) still does the actual
 * launch; this route only flips the DB row to `running` so every consumer's
 * status view stays consistent regardless of which one launched it.
 */
router.post("/admin/build-tracker/extension/queue/:id/force-claim", ingestAuth, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
  try {
    const [row] = await db
      .update(btBuildQueueTable)
      .set({ status: "running", claimedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(btBuildQueueTable.id, id), inArray(btBuildQueueTable.status, ["queued", "held"])))
      .returning();
    if (!row) { res.status(409).json({ error: "Only a still-queued or held item can be force-claimed" }); return; }
    res.json(row);
  } catch (err) {
    log.error({ err, id }, "POST /extension/queue/:id/force-claim failed");
    res.status(500).json({ error: "Failed to force-claim queue item" });
  }
});

/**
 * POST /admin/build-tracker/extension/toggle-label
 *
 * Git #723 follow-up — Shane: "you need to also add a quick button to the
 * Epic to set its status to In Progress." Applies/removes a real GitHub
 * label by NUMBER directly (epic or plain issue, doesn't matter which —
 * same as set-issue-state) so an epic marked this way immediately shows up
 * in GET /extension/in-progress above, no separate "epic status" concept
 * to keep in sync. Uses GitHub's dedicated add/remove-label endpoints
 * (not a full PATCH replacing the whole labels array) so a concurrent
 * label change elsewhere can never get clobbered by a stale read.
 *
 * Body: { number: number, label: string, add: boolean }
 * Auth: admin session cookie OR Authorization: Bearer <BUILD_TRACKER_INGEST_TOKEN>
 */
router.post("/admin/build-tracker/extension/toggle-label", ingestAuth, async (req: Request, res: Response) => {
  if (!process.env.GITHUB_TOKEN) {
    res.status(503).json({ error: "GITHUB_TOKEN is not set on this server" });
    return;
  }
  const { number, label, add } = req.body as { number?: number; label?: string; add?: boolean };
  if (!Number.isInteger(number) || !label || typeof add !== "boolean") {
    res.status(400).json({ error: "number, label, and add (boolean) are required" });
    return;
  }
  try {
    const ghRes = add
      ? await ghFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/issues/${number}/labels`, {
          method: "POST",
          body: JSON.stringify({ labels: [label] }),
        })
      : await ghFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/issues/${number}/labels/${encodeURIComponent(label)}`, {
          method: "DELETE",
        });
    // A 404 on DELETE just means the label wasn't there to begin with —
    // that's the desired end state either way, not a real failure.
    if (!ghRes.ok && !(!add && ghRes.status === 404)) {
      res.status(502).json({ error: `GitHub rejected the label update for #${number}` });
      return;
    }
    res.json({ number, label, add });
  } catch (err) {
    log.error({ err, number, label, add }, "POST /extension/toggle-label failed");
    res.status(500).json({ error: "Failed to update label" });
  }
});

/**
 * POST /admin/build-tracker/extension/set-issue-state
 *
 * Git #720 follow-up — Shane: "I should be able to close it right there" —
 * the hover card's Close/Reopen button. Acts by GitHub number directly
 * (like the lookup it's paired with), NOT Build Tracker's internal id —
 * a number Claude mentions may not even be tracked locally yet, and this
 * needs to work either way. Pushes the real state to GitHub first; the
 * local bt_issues row (if one happens to exist) is updated best-effort
 * afterward so the panel doesn't go stale, but isn't required to exist.
 *
 * Body: { number: number, state: "open" | "closed" }
 * Auth: admin session cookie OR Authorization: Bearer <BUILD_TRACKER_INGEST_TOKEN>
 */
router.post("/admin/build-tracker/extension/set-issue-state", ingestAuth, async (req: Request, res: Response) => {
  if (!process.env.GITHUB_TOKEN) {
    res.status(503).json({ error: "GITHUB_TOKEN is not set on this server" });
    return;
  }
  const { number, state } = req.body as { number?: number; state?: string };
  if (typeof number !== "number" || !Number.isInteger(number) || (state !== "open" && state !== "closed")) {
    res.status(400).json({ error: "number and state ('open'|'closed') are required" });
    return;
  }
  try {
    const ghRes = await ghFetch(`/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/issues/${number}`, {
      method: "PATCH",
      body: JSON.stringify({ state }),
    });
    if (!ghRes.ok) {
      res.status(502).json({ error: `GitHub rejected the update for #${number}` });
      return;
    }
    // Best-effort — reopening maps to "done" locally, not "backlog": if it's
    // tracked here at all it's almost certainly because it was complete-
    // labeled (Git #714/#715's own reasoning), and reopening shouldn't
    // silently forget that.
    await db
      .update(btIssuesTable)
      .set({ status: state === "closed" ? "closed" : "done", updatedAt: new Date() })
      .where(eq(btIssuesTable.githubNumber, number));
    res.json({ number, state });
  } catch (err) {
    log.error({ err, number, state }, "POST /extension/set-issue-state failed");
    res.status(500).json({ error: "Failed to update issue state" });
  }
});

router.post("/admin/build-tracker/extension/sync-epic", ingestAuth, async (req: Request, res: Response) => {
  const { epicNumber, title, description, status: incomingStatus } = req.body as {
    epicNumber?: number;
    title?: string;
    description?: string;
    status?: string;
  };
  if (!Number.isInteger(epicNumber)) {
    res.status(400).json({ error: "epicNumber is required" });
    return;
  }

  try {
    let ghEpic: GitHubIssuePayload | null = null;
    if (process.env.GITHUB_TOKEN) {
      try {
        ghEpic = await ghFetchIssue(epicNumber!);
      } catch (fetchErr) {
        log.warn({ fetchErr, epicNumber }, "sync-epic: live ghFetchIssue failed, checking fallback data");
      }
    }

    if (!ghEpic) {
      if (title?.trim()) {
        ghEpic = {
          number: epicNumber!,
          title: title.trim(),
          body: description ?? "",
          state: incomingStatus === "closed" ? "closed" : "open",
        } as GitHubIssuePayload;
      } else {
        res.status(404).json({ error: `Epic #${epicNumber} not found on GitHub` });
        return;
      }
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

    const level1 = process.env.GITHUB_TOKEN
      ? await ghFetchSubIssues(epicNumber!).catch(() => [])
      : [];
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
    res.status(500).json({ error: err instanceof Error ? err.message : "Epic sync failed" });
  }
});

/** PATCH /admin/build-tracker/chats/:id */
router.patch("/admin/build-tracker/chats/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
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

/**
 * POST /admin/build-tracker/chats/unassign-epic
 *
 * BuildConsole's "Unassign from Epic" right-click action. Looks the chat up
 * by conversation_id (the desktop app only ever has the conversationId, not
 * the chat's numeric db id — the /extension/board response doesn't expose
 * it) and clears its epicId directly. Deliberately does NOT touch issueId —
 * a chat linked to an issue (whose epic is shown via inheritance, see
 * /extension/board's `chats` mapping above) isn't "assigned to an epic" in
 * the sense this action targets; only the chat's own epicId column is a
 * direct epic assignment.
 *
 * Auth: `ingestAuth`, NOT `requireAdmin`. This is a pure-local DB write — it
 * clears the chat's own `epicId` column and touches nothing on GitHub (no PAT,
 * no GitHub API call, no re-verification of the epic). It is BuildConsole's
 * "Unassign from Epic" right-click, and BuildConsole authenticates with the
 * static `BUILD_TRACKER_INGEST_TOKEN` Bearer token, exactly like its sibling
 * "Assign to Epic" (POST /chats/ingest, also `ingestAuth`). Gating it behind
 * `requireAdmin` (a real browser admin-session JWT) meant the desktop app's
 * ingest token was rejected by requireAuth with `{"error":"Invalid or expired
 * token"}` even though assign worked — the local bug this fixes. `ingestAuth`
 * still falls through to the admin-session check, so a real admin cookie
 * continues to work too.
 */
router.post("/admin/build-tracker/chats/unassign-epic", ingestAuth, async (req: Request, res: Response) => {
  const { conversation_id } = req.body as { conversation_id?: string };
  if (!conversation_id?.trim()) {
    res.status(400).json({ error: "conversation_id is required" });
    return;
  }
  const id = conversation_id.trim();
  try {
    const [row] = await db
      .update(btChatsTable)
      .set({ epicId: null, updatedAt: new Date() })
      .where(eq(btChatsTable.conversationId, id))
      .returning();
    if (!row) { res.status(404).json({ error: "not found" }); return; }
    log.info(
      { conversationId: id, formerEpicId: null, localOnly: true },
      "unassigned chat from epic (local-only DB write — no GitHub call)",
    );
    res.json({ ...row, claudeUrl: claudeUrl(row.conversationId) });
  } catch (err) {
    log.error({ err, conversationId: id }, "POST /chats/unassign-epic failed");
    res.status(500).json({ error: "Failed to unassign chat" });
  }
});

/**
 * POST /admin/build-tracker/chats/assign-issue
 *
 * Many-to-many link between a chat and a real GitHub issue/epic/milestone number.
 * Inserts into bt_chat_issues (upsert / on conflict do nothing).
 * Auth: ingestAuth
 */
router.post("/admin/build-tracker/chats/assign-issue", ingestAuth, async (req: Request, res: Response) => {
  const { conversation_id, issue_number, title, account } = req.body as {
    conversation_id?: string;
    issue_number?: number;
    title?: string;
    account?: string;
  };
  if (!conversation_id?.trim() || typeof issue_number !== "number") {
    res.status(400).json({ error: "conversation_id and numeric issue_number are required" });
    return;
  }
  const convId = conversation_id.trim();
  try {
    const existingChats = await db
      .select()
      .from(btChatsTable)
      .where(eq(btChatsTable.conversationId, convId))
      .limit(1);

    let chat = existingChats[0];
    if (!chat) {
      // Git #1480 — stamps the BuildConsole title-bar toggle's value (sent by the desktop
      // client) on a genuinely NEW chat row only; re-linking an existing chat below never
      // touches its already-stamped account. Anything but exactly "secondary" reads as primary,
      // matching bt_chats.account's own NOT NULL DEFAULT 'primary'.
      const [inserted] = await db
        .insert(btChatsTable)
        .values({
          conversationId: convId,
          title: title?.trim() || `[#${issue_number}] Chat`,
          account: account === "secondary" ? "secondary" : "primary",
        })
        .returning();
      chat = inserted;
    }

    await db
      .insert(btChatIssuesTable)
      .values({
        chatId: chat.id,
        issueNumber: issue_number,
      })
      .onConflictDoNothing();

    // Git #2068 — this lookup only ever checked bt_epics/bt_issues, which are ONLY
    // repopulated by a full GitHub sync (github-sync/quick-sync/sync-epic). A target
    // that hasn't been synced yet misses both and used to fall through silently:
    // bt_chat_issues (above) still got its row, but bt_chats.epic_id/issue_id were
    // never set, and the response still said `ok: true` with no signal anything was
    // incomplete — same local-table-staleness class #1362 fixed on the read/grouping
    // side, unaddressed here until now. `resolved` below makes that failure honest
    // instead of silent.
    //
    // Deliberately NOT adding a live-GitHub-fetch fallback here (unlike the desktop
    // direct-Postgres path's LinkChatToIssueAsync, which self-heals from its caller's
    // own already-fetched Git Board data): this endpoint's own doc comment above says
    // issue_number can legitimately be "a real GitHub issue/epic/milestone number" —
    // three different GitHub number namespaces sharing one wire parameter. A live
    // GitHub fetch keyed only on the raw number can't tell a not-yet-synced epic/issue
    // apart from an unrelated real issue that happens to share a milestone's number,
    // and would risk syncing/linking the WRONG target. Filed as a follow-up (needs an
    // explicit signal from the caller, e.g. an `isEpicOrIssue` flag, before it's safe
    // to add) rather than guessed at here.
    const [epic] = await db
      .select({ id: btEpicsTable.id })
      .from(btEpicsTable)
      .where(eq(btEpicsTable.githubNumber, issue_number))
      .limit(1);

    let resolved = false;
    if (epic) {
      await db
        .update(btChatsTable)
        .set({ epicId: epic.id, issueId: null, updatedAt: new Date() })
        .where(eq(btChatsTable.id, chat.id));
      resolved = true;
    } else {
      const [issue] = await db
        .select({ id: btIssuesTable.id, epicId: btIssuesTable.epicId })
        .from(btIssuesTable)
        .where(eq(btIssuesTable.githubNumber, issue_number))
        .limit(1);
      if (issue) {
        await db
          .update(btChatsTable)
          .set({ issueId: issue.id, epicId: issue.epicId, updatedAt: new Date() })
          .where(eq(btChatsTable.id, chat.id));
        resolved = true;
      }
    }

    log.info({ conversationId: convId, issueNumber: issue_number, chatId: chat.id, resolved }, "assigned chat to issue");
    res.json({ ok: true, conversationId: convId, issueNumber: issue_number, resolved });
  } catch (err) {
    log.error({ err, conversationId: convId, issueNumber: issue_number }, "POST /chats/assign-issue failed");
    res.status(500).json({ error: "Failed to assign chat to issue" });
  }
});

/**
 * POST /admin/build-tracker/chats/unassign-issue
 *
 * Removes a specific issue number from a chat's bt_chat_issues associations.
 * Auth: ingestAuth
 */
router.post("/admin/build-tracker/chats/unassign-issue", ingestAuth, async (req: Request, res: Response) => {
  const { conversation_id, issue_number } = req.body as { conversation_id?: string; issue_number?: number };
  if (!conversation_id?.trim() || typeof issue_number !== "number") {
    res.status(400).json({ error: "conversation_id and numeric issue_number are required" });
    return;
  }
  const convId = conversation_id.trim();
  try {
    const existing = await db
      .select({ id: btChatsTable.id })
      .from(btChatsTable)
      .where(eq(btChatsTable.conversationId, convId))
      .limit(1);

    if (existing.length === 0) {
      res.status(404).json({ error: "chat not found" });
      return;
    }

    await db
      .delete(btChatIssuesTable)
      .where(and(eq(btChatIssuesTable.chatId, existing[0].id), eq(btChatIssuesTable.issueNumber, issue_number)));

    const remaining = await db
      .select({ issueNumber: btChatIssuesTable.issueNumber })
      .from(btChatIssuesTable)
      .where(eq(btChatIssuesTable.chatId, existing[0].id))
      .limit(1);

    let resolved = true;
    if (remaining.length === 0) {
      await db
        .update(btChatsTable)
        .set({ epicId: null, issueId: null, updatedAt: new Date() })
        .where(eq(btChatsTable.id, existing[0].id));
    } else {
      // Git #2068 — same local-table-only lookup as assign-issue above, same
      // `resolved` honesty fix; see that route's comment for why a live-GitHub-fetch
      // fallback isn't added here.
      const nextIssueNum = remaining[0].issueNumber;
      const [epic] = await db
        .select({ id: btEpicsTable.id })
        .from(btEpicsTable)
        .where(eq(btEpicsTable.githubNumber, nextIssueNum))
        .limit(1);

      resolved = false;
      if (epic) {
        await db
          .update(btChatsTable)
          .set({ epicId: epic.id, issueId: null, updatedAt: new Date() })
          .where(eq(btChatsTable.id, existing[0].id));
        resolved = true;
      } else {
        const [issue] = await db
          .select({ id: btIssuesTable.id, epicId: btIssuesTable.epicId })
          .from(btIssuesTable)
          .where(eq(btIssuesTable.githubNumber, nextIssueNum))
          .limit(1);
        if (issue) {
          await db
            .update(btChatsTable)
            .set({ issueId: issue.id, epicId: issue.epicId, updatedAt: new Date() })
            .where(eq(btChatsTable.id, existing[0].id));
          resolved = true;
        }
      }
    }

    log.info({ conversationId: convId, issueNumber: issue_number, chatId: existing[0].id, resolved }, "unassigned chat from issue");
    res.json({ ok: true, conversationId: convId, issueNumber: issue_number, resolved });
  } catch (err) {
    log.error({ err, conversationId: convId, issueNumber: issue_number }, "POST /chats/unassign-issue failed");
    res.status(500).json({ error: "Failed to unassign chat from issue" });
  }
});

/**
 * POST /admin/build-tracker/chats/rename
 *
 * Renames a chat by its conversation_id.
 * Auth: ingestAuth
 */
router.post("/admin/build-tracker/chats/rename", ingestAuth, async (req: Request, res: Response) => {
  const { conversation_id, title } = req.body as { conversation_id?: string; title?: string };
  if (!conversation_id?.trim() || !title?.trim()) {
    res.status(400).json({ error: "conversation_id and title are required" });
    return;
  }
  const convId = conversation_id.trim();
  const newTitle = title.trim();
  try {
    const [row] = await db
      .update(btChatsTable)
      .set({ title: newTitle, updatedAt: new Date() })
      .where(eq(btChatsTable.conversationId, convId))
      .returning();

    if (!row) {
      res.status(404).json({ error: "chat not found" });
      return;
    }

    log.info({ conversationId: convId, newTitle }, "renamed chat");
    res.json({ ok: true, ...row, claudeUrl: claudeUrl(row.conversationId) });
  } catch (err) {
    log.error({ err, conversationId: convId, title: newTitle }, "POST /chats/rename failed");
    res.status(500).json({ error: "Failed to rename chat" });
  }
});

/**
 * POST /admin/build-tracker/chats/archive
 *
 * Soft-hides a chat from the default active Chats panel view by its
 * conversation_id — the real bt_chats row and every association (bt_chat_issues,
 * epic/issue links) are left fully intact. Reversible via /chats/unarchive.
 * Auth: ingestAuth
 */
router.post("/admin/build-tracker/chats/archive", ingestAuth, async (req: Request, res: Response) => {
  const { conversation_id } = req.body as { conversation_id?: string };
  if (!conversation_id?.trim()) {
    res.status(400).json({ error: "conversation_id is required" });
    return;
  }
  const convId = conversation_id.trim();
  try {
    const [row] = await db
      .update(btChatsTable)
      .set({ archived: true, archivedAt: new Date(), updatedAt: new Date() })
      .where(eq(btChatsTable.conversationId, convId))
      .returning();

    if (!row) {
      res.status(404).json({ error: "chat not found" });
      return;
    }

    log.info({ conversationId: convId }, "archived chat");
    res.json({ ok: true, ...row, claudeUrl: claudeUrl(row.conversationId) });
  } catch (err) {
    log.error({ err, conversationId: convId }, "POST /chats/archive failed");
    res.status(500).json({ error: "Failed to archive chat" });
  }
});

/**
 * POST /admin/build-tracker/chats/unarchive
 *
 * Reverses /chats/archive — restores a chat to the default active Chats panel view.
 * Auth: ingestAuth
 */
router.post("/admin/build-tracker/chats/unarchive", ingestAuth, async (req: Request, res: Response) => {
  const { conversation_id } = req.body as { conversation_id?: string };
  if (!conversation_id?.trim()) {
    res.status(400).json({ error: "conversation_id is required" });
    return;
  }
  const convId = conversation_id.trim();
  try {
    const [row] = await db
      .update(btChatsTable)
      .set({ archived: false, archivedAt: null, updatedAt: new Date() })
      .where(eq(btChatsTable.conversationId, convId))
      .returning();

    if (!row) {
      res.status(404).json({ error: "chat not found" });
      return;
    }

    log.info({ conversationId: convId }, "unarchived chat");
    res.json({ ok: true, ...row, claudeUrl: claudeUrl(row.conversationId) });
  } catch (err) {
    log.error({ err, conversationId: convId }, "POST /chats/unarchive failed");
    res.status(500).json({ error: "Failed to unarchive chat" });
  }
});

/** DELETE /admin/build-tracker/chats/:id */
router.delete("/admin/build-tracker/chats/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
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

async function ghFetch(path: string, init?: RequestInit): Promise<globalThis.Response> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN env var not set");
  return fetch(`${GITHUB_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      // Shane: mark-epic-in-progress "sets the checkbox... but then doesn't
      // show up... After I click the sync the checkbox button changes back
      // to a play button." Root cause: every write call in this file (this
      // one included) builds its own JSON body via JSON.stringify() but
      // NONE of them ever set Content-Type — including calls that appeared
      // to work before, since GitHub tolerates a missing Content-Type on
      // some endpoints but not others (labels-add being one that doesn't).
      // Fixed centrally here rather than patching every call site
      // individually, and rather than assuming any prior "working" call was
      // actually verified — most of this file's writes were never
      // browser-tested this session.
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
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
    // an issue/epic keeps its local "in_progress" status as long as GitHub
    // still shows it open; the moment GitHub shows it closed, "closed" wins
    // regardless. Git #759 fix (Shane: #658 reopened under #647, stayed
    // invisible through multiple re-syncs) — previousStatus no longer carries
    // "closed"/"done" through when GitHub now shows the issue open again;
    // only "in_progress" survives a re-sync, since that's the only local
    // refinement with no GitHub-side signal to derive it from. Trusting
    // GitHub's real open/closed state both ways means a genuine reopen is
    // never stuck behind a stale local status.
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
          : previousStatus === "in_progress" ? previousStatus : "open";
      
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
            : previousStatus === "in_progress"
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
        const ghMsList = (await msRes.json()) as any[];
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


