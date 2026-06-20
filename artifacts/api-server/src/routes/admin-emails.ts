import { Router, type IRouter, type Request, type Response } from "express";
import { db, emailsTable, emailDomainRulesTable, usersTable, kanbanTasksTable, projectsTable } from "@workspace/db";
import { eq, and, isNull, isNotNull, desc, count, gte } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { graphCredentialsPresent, getMailMessageBody } from "../lib/graph";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── GET /admin/emails/unread-count ──────────────────────────────────────────
router.get("/admin/emails/unread-count", requireAdmin, async (req: Request, res: Response) => {
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  let since = cutoff24h;
  const sinceParam = req.query["since"];
  if (sinceParam && typeof sinceParam === "string") {
    const parsed = new Date(
      /^\d+$/.test(sinceParam) ? parseInt(sinceParam, 10) : sinceParam
    );
    if (!isNaN(parsed.getTime()) && parsed > cutoff24h) {
      since = parsed;
    }
  }

  const [{ total }] = await db
    .select({ total: count() })
    .from(emailsTable)
    .where(and(isNull(emailsTable.linkedUserId), gte(emailsTable.receivedAt, since)));

  res.json({ count: total });
});

// ─── GET /admin/emails ───────────────────────────────────────────────────────
router.get("/admin/emails", requireAdmin, async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(String(req.query["page"] ?? "1"), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query["limit"] ?? "50"), 10)));
  const offset = (page - 1) * limit;

  const userIdParam = req.query["userId"];
  const unlinked = req.query["unlinked"] === "true";
  const linked = req.query["linked"] === "true";
  const domainParam = req.query["domain"];

  type WhereCondition = ReturnType<typeof eq> | ReturnType<typeof isNull> | ReturnType<typeof isNotNull>;
  const conditions: WhereCondition[] = [];

  if (userIdParam) {
    conditions.push(eq(emailsTable.linkedUserId, parseInt(String(userIdParam), 10)));
  } else if (unlinked) {
    conditions.push(isNull(emailsTable.linkedUserId));
  } else if (linked) {
    conditions.push(isNotNull(emailsTable.linkedUserId));
  }

  if (domainParam && typeof domainParam === "string") {
    conditions.push(eq(emailsTable.senderDomain, domainParam.toLowerCase().trim()));
  }

  const baseQuery = conditions.length > 0
    ? and(...(conditions as [WhereCondition, ...WhereCondition[]]))
    : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select({
        email: emailsTable,
        clientName: usersTable.name,
        clientEmail: usersTable.email,
        clientCompany: usersTable.company,
      })
      .from(emailsTable)
      .leftJoin(usersTable, eq(emailsTable.linkedUserId, usersTable.id))
      .where(baseQuery)
      .orderBy(desc(emailsTable.receivedAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ total: count() })
      .from(emailsTable)
      .where(baseQuery),
  ]);

  res.json({ emails: rows, total, page, limit });
});

// ─── GET /admin/emails/:id ────────────────────────────────────────────────────
// Returns stored email fields + attempts live body fetch from Microsoft Graph.
// Falls back to bodyPreview if Graph credentials are not configured.
router.get("/admin/emails/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid email ID" }); return; }

  const [row] = await db
    .select({
      email: emailsTable,
      clientName: usersTable.name,
      clientEmail: usersTable.email,
      clientCompany: usersTable.company,
      clientPhone: usersTable.phone,
      clientId: usersTable.id,
    })
    .from(emailsTable)
    .leftJoin(usersTable, eq(emailsTable.linkedUserId, usersTable.id))
    .where(eq(emailsTable.id, id))
    .limit(1);

  if (!row) { res.status(404).json({ error: "Email not found" }); return; }

  let bodyContent: string | null = row.email.bodyPreview ?? null;
  let bodyContentType: "html" | "text" | "preview" = "preview";

  const mailUserId = process.env["GRAPH_MAIL_USER_ID"];
  if (graphCredentialsPresent() && mailUserId) {
    try {
      const msg = await getMailMessageBody(mailUserId, row.email.messageId);
      if (msg?.body?.content) {
        bodyContent = msg.body.content;
        bodyContentType = msg.body.contentType;
      }
    } catch (err) {
      logger.warn({ err }, "Failed to fetch email body from Graph; falling back to preview");
    }
  }

  res.json({
    ...row,
    bodyContent,
    bodyContentType,
    graphAvailable: graphCredentialsPresent() && Boolean(mailUserId),
  });
});

// ─── PATCH /admin/emails/:id ─────────────────────────────────────────────────
router.patch("/admin/emails/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid email ID" }); return; }

  const { userId } = req.body as { userId?: number | null };
  if (userId !== null && userId !== undefined && (typeof userId !== "number" || isNaN(userId))) {
    res.status(400).json({ error: "userId must be a number or null" });
    return;
  }

  const [updated] = await db
    .update(emailsTable)
    .set({ linkedUserId: userId ?? null })
    .where(eq(emailsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Email not found" }); return; }

  res.json(updated);
});

// ─── POST /admin/emails/:id/tasks ─────────────────────────────────────────────
// Create a kanban task linked to this email.
router.post("/admin/emails/:id/tasks", requireAdmin, async (req: Request, res: Response) => {
  const emailId = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(emailId)) { res.status(400).json({ error: "Invalid email ID" }); return; }

  const [emailRow] = await db
    .select()
    .from(emailsTable)
    .where(eq(emailsTable.id, emailId))
    .limit(1);

  if (!emailRow) { res.status(404).json({ error: "Email not found" }); return; }

  const { projectId, title, description, priority, dueDate } = req.body as {
    projectId?: number;
    title?: string;
    description?: string;
    priority?: string;
    dueDate?: string;
  };

  if (!projectId || !title) {
    res.status(400).json({ error: "projectId and title are required" });
    return;
  }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .limit(1);

  if (!project) { res.status(404).json({ error: "Project not found" }); return; }

  const [task] = await db
    .insert(kanbanTasksTable)
    .values({
      projectId,
      title,
      description: description ?? null,
      column: "backlog",
      order: 0,
      priority: priority ?? null,
      dueDate: dueDate ? new Date(dueDate) : null,
      sourceEmailId: emailId,
    })
    .returning();

  res.status(201).json({ task, project });
});

// ─── GET /admin/email-domain-rules ───────────────────────────────────────────
router.get("/admin/email-domain-rules", requireAdmin, async (_req: Request, res: Response) => {
  const rules = await db
    .select({
      rule: emailDomainRulesTable,
      clientName: usersTable.name,
      clientEmail: usersTable.email,
    })
    .from(emailDomainRulesTable)
    .leftJoin(usersTable, eq(emailDomainRulesTable.linkedUserId, usersTable.id))
    .orderBy(emailDomainRulesTable.domain);

  res.json(rules);
});

// ─── POST /admin/email-domain-rules ──────────────────────────────────────────
router.post("/admin/email-domain-rules", requireAdmin, async (req: Request, res: Response) => {
  const { domain, userId } = req.body as { domain?: string; userId?: number };

  if (!domain || typeof domain !== "string") {
    res.status(400).json({ error: "domain is required" });
    return;
  }
  if (!userId || typeof userId !== "number") {
    res.status(400).json({ error: "userId is required" });
    return;
  }

  const normalised = domain.toLowerCase().trim().replace(/^@/, "");

  try {
    const [rule] = await db
      .insert(emailDomainRulesTable)
      .values({ domain: normalised, linkedUserId: userId })
      .returning();

    res.status(201).json(rule);
  } catch {
    res.status(409).json({ error: "Domain rule already exists for this domain" });
  }
});

// ─── DELETE /admin/email-domain-rules/:id ────────────────────────────────────
router.delete("/admin/email-domain-rules/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid rule ID" }); return; }

  const [deleted] = await db
    .delete(emailDomainRulesTable)
    .where(eq(emailDomainRulesTable.id, id))
    .returning();

  if (!deleted) { res.status(404).json({ error: "Rule not found" }); return; }

  res.json({ success: true });
});

// ─── POST /admin/emails/:id/rematch ──────────────────────────────────────────
router.post("/admin/emails/:id/rematch", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid email ID" }); return; }

  const [email] = await db
    .select()
    .from(emailsTable)
    .where(eq(emailsTable.id, id))
    .limit(1);

  if (!email) { res.status(404).json({ error: "Email not found" }); return; }

  const { matchSenderToUser } = await import("../lib/email-domain-match");
  const linkedUserId = await matchSenderToUser(email.senderAddress);

  const [updated] = await db
    .update(emailsTable)
    .set({ linkedUserId })
    .where(eq(emailsTable.id, id))
    .returning();

  res.json(updated);
});

export default router;
