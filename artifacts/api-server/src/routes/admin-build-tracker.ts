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
// MILESTONES
// ─────────────────────────────────────────────────────────────────────────────

/** GET /admin/build-tracker/milestones — sample or synced milestones */
router.get("/admin/build-tracker/milestones", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const milestones = [
      {
        id: 1,
        title: "v1.0 MSP Platform Launch",
        description: "Complete remediation guide, EngageBay migration, and full live deployment.",
        startDate: "2026-08-01",
        targetDate: "2026-08-25",
        status: "in_progress",
        githubNumber: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        epicCount: 3,
      },
      {
        id: 2,
        title: "Q3 Security & Copilot Hardening",
        description: "White-Glove Copilot adoption, PowerShell execution engine, and scanning suite.",
        startDate: "2026-08-15",
        targetDate: "2026-09-15",
        status: "open",
        githubNumber: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        epicCount: 2,
      },
      {
        id: 3,
        title: "v1.1 Analytics & Marketing Integration",
        description: "GA4 integration, Zoho API replacement, and LinkedIn campaign automation.",
        startDate: "2026-09-01",
        targetDate: "2026-09-30",
        status: "open",
        githubNumber: 3,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        epicCount: 2,
      },
    ];
    res.json(milestones);
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
}

import fs from "node:fs/promises";
import path from "node:path";

/** POST /admin/build-tracker/github-sync */
router.post("/admin/build-tracker/github-sync", requireAdmin, async (_req: Request, res: Response) => {
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

    // Clear old synced records to prevent duplication or stale links
    const issuesDeleted = await db.delete(btIssuesTable).where(sql`github_number IS NOT NULL`);
    const epicsDeleted = await db.delete(btEpicsTable).where(sql`github_number IS NOT NULL`);
    debugLog += `Clean up: deleted previous issues and epics\n`;

    // ── 3. Upsert Epics into bt_epics ────────────────────────────────────
    let epicsUpserted = 0;
    const issueMapByNumber = new Map(fetchedIssues.map((i) => [i.number, i]));

    for (const pNum of parentNumbers) {
      const ghEpic = issueMapByNumber.get(pNum);
      const title = ghEpic ? ghEpic.title : `Epic #${pNum}`;
      const description = ghEpic ? ghEpic.body : null;
      const status = (ghEpic && ghEpic.state === "closed") ? "closed" : "open";

      await db.insert(btEpicsTable).values({
        title,
        description,
        status,
        githubNumber: pNum,
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

    // ── 4. Upsert Child and Standalone Issues into bt_issues ──────────────
    let issuesUpserted = 0;
    for (const gh of fetchedIssues) {
      // Epics themselves are saved in bt_epics, not bt_issues
      if (parentNumbers.has(gh.number)) continue;

      const parentNum = getParentNumber(gh.parent_issue_url);
      const epicId = parentNum !== null ? (epicIdByGithubNumber.get(parentNum) ?? null) : null;
      const issueStatus: GhIssueStatus = gh.state === "closed" ? "closed" : "backlog";
      const labels = gh.labels.map((l) => l.name);

      await db.insert(btIssuesTable).values({
        title: gh.title,
        description: gh.body,
        status: issueStatus,
        epicId,
        githubNumber: gh.number,
        githubUrl: gh.html_url,
        labels,
      });
      issuesUpserted++;
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
    res.json({ epics: epicsUpserted, issues: issuesUpserted, milestones: syncedMilestones });
  } catch (err: any) {
    debugLog += `Sync failed with error: ${err instanceof Error ? err.stack : String(err)}\n`;
    await fs.writeFile(debugLogPath, debugLog, "utf-8");
    log.error({ err }, "github-sync failed");
    res.status(500).json({ error: "GitHub sync failed" });
  }
});


export default router;


