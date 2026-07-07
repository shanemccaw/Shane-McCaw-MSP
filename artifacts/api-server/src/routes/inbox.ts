import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  inboxMessageLinksTable,
  kanbanTasksTable,
  projectsTable,
  leadsTable,
  opportunitiesTable,
  leadQualificationsTable,
  opportunityTasksTable,
  usersTable,
} from "@workspace/db";
import { generateWorkflowTasks, daysFromNow } from "../lib/workflow-tasks";
import { eq, desc, and, or, isNotNull } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { getPrompt } from "../lib/prompt-loader.ts";
import { graphCredentialsPresent } from "../lib/graph";
import {
  listMessages,
  getMessage,
  getMessageBody,
  markReadUnread,
  flagMessage,
  moveToFolder,
  sendMessage,
  replyToMessage,
  forwardMessage,
  createDraft,
  updateDraft,
  searchMessages,
  listMailFolders,
  getConversationMessages,
} from "../lib/graphEmail";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const mailUserId = () => process.env.GRAPH_MAIL_USER_ID ?? "";

// ─── Check Graph availability ─────────────────────────────────────────────────

router.get("/inbox/status", requireAdmin, (_req: Request, res: Response) => {
  res.json({
    graphAvailable: graphCredentialsPresent() && Boolean(mailUserId()),
    mailUserId: mailUserId() || null,
  });
});

// ─── List mail folders ────────────────────────────────────────────────────────

router.get("/inbox/folders", requireAdmin, async (_req: Request, res: Response) => {
  if (!graphCredentialsPresent() || !mailUserId()) {
    res.json({ folders: [] });
    return;
  }
  const folders = await listMailFolders(mailUserId());
  res.json({ folders });
});

// ─── List messages ────────────────────────────────────────────────────────────

router.get("/inbox/messages", requireAdmin, async (req: Request, res: Response) => {
  if (!graphCredentialsPresent() || !mailUserId()) {
    res.json({ messages: [], nextLink: null, totalCount: 0 });
    return;
  }
  const folder = String(req.query["folder"] ?? "inbox");
  const pageSize = Math.min(100, parseInt(String(req.query["pageSize"] ?? "50"), 10));
  const skipToken = typeof req.query["skipToken"] === "string" ? req.query["skipToken"] : undefined;
  const onlyUnread = req.query["onlyUnread"] === "true";
  const onlyFlagged = req.query["onlyFlagged"] === "true";
  const onlyHasAttachments = req.query["onlyHasAttachments"] === "true";

  const result = await listMessages({
    userId: mailUserId(),
    folder,
    pageSize,
    skipToken,
    onlyUnread,
    onlyFlagged,
    onlyHasAttachments,
  });

  res.json(result);
});

// ─── Get message detail ───────────────────────────────────────────────────────

router.get("/inbox/messages/:id", requireAdmin, async (req: Request, res: Response) => {
  const messageId = String(req.params["id"] ?? "");
  if (!messageId || !graphCredentialsPresent() || !mailUserId()) {
    res.status(404).json({ error: "Message not found" });
    return;
  }
  const detail = await getMessageBody(mailUserId(), messageId);
  if (!detail) {
    res.status(404).json({ error: "Message not found" });
    return;
  }

  // Mark as read on open
  if (!detail.isRead) {
    void markReadUnread(mailUserId(), messageId, true);
  }

  // Fetch CRM links
  const links = await db
    .select()
    .from(inboxMessageLinksTable)
    .where(eq(inboxMessageLinksTable.graphMessageId, messageId))
    .limit(10);

  res.json({ message: detail, links });
});

// ─── Get thread messages ──────────────────────────────────────────────────────

router.get("/inbox/messages/:id/thread", requireAdmin, async (req: Request, res: Response) => {
  const messageId = String(req.params["id"] ?? "");
  if (!messageId || !graphCredentialsPresent() || !mailUserId()) {
    res.json({ messages: [] });
    return;
  }
  const msg = await getMessage(mailUserId(), messageId);
  if (!msg?.conversationId) {
    res.json({ messages: [] });
    return;
  }
  const thread = await getConversationMessages(mailUserId(), msg.conversationId);
  res.json({ messages: thread });
});

// ─── Mark read/unread ─────────────────────────────────────────────────────────

router.patch("/inbox/messages/:id/read", requireAdmin, async (req: Request, res: Response) => {
  const messageId = String(req.params["id"] ?? "");
  const { isRead } = req.body as { isRead: boolean };
  if (!messageId || !graphCredentialsPresent() || !mailUserId()) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const ok = await markReadUnread(mailUserId(), messageId, isRead);
  res.json({ ok });
});

// ─── Flag message ─────────────────────────────────────────────────────────────

router.patch("/inbox/messages/:id/flag", requireAdmin, async (req: Request, res: Response) => {
  const messageId = String(req.params["id"] ?? "");
  const { flagStatus } = req.body as { flagStatus: "flagged" | "notFlagged" | "complete" };
  if (!messageId || !graphCredentialsPresent() || !mailUserId()) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const ok = await flagMessage(mailUserId(), messageId, flagStatus);
  res.json({ ok });
});

// ─── Move message ─────────────────────────────────────────────────────────────

router.patch("/inbox/messages/:id/move", requireAdmin, async (req: Request, res: Response) => {
  const messageId = String(req.params["id"] ?? "");
  const { folder } = req.body as { folder: string };
  if (!messageId || !folder || !graphCredentialsPresent() || !mailUserId()) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const ok = await moveToFolder(mailUserId(), messageId, folder);
  res.json({ ok });
});

// ─── Send new message ─────────────────────────────────────────────────────────

router.post("/inbox/send", requireAdmin, async (req: Request, res: Response) => {
  const { to, cc, bcc, subject, body, bodyType } = req.body as {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
    bodyType?: "html" | "text";
  };
  if (!to?.length || !subject || !body || !graphCredentialsPresent() || !mailUserId()) {
    res.status(400).json({ error: "Missing required fields or Graph not available" });
    return;
  }
  const ok = await sendMessage({ userId: mailUserId(), to, cc, bcc, subject, body, bodyType });
  if (!ok) {
    res.status(500).json({ error: "Failed to send message" });
    return;
  }
  res.json({ ok: true });
});

// ─── Reply to message ─────────────────────────────────────────────────────────

router.post("/inbox/messages/:id/reply", requireAdmin, async (req: Request, res: Response) => {
  const messageId = String(req.params["id"] ?? "");
  const { body, replyAll } = req.body as { body: string; replyAll?: boolean };
  if (!messageId || !body || !graphCredentialsPresent() || !mailUserId()) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  const ok = await replyToMessage(mailUserId(), messageId, body, replyAll ?? false);
  if (!ok) {
    res.status(500).json({ error: "Failed to send reply" });
    return;
  }
  res.json({ ok: true });
});

// ─── Forward message ──────────────────────────────────────────────────────────

router.post("/inbox/messages/:id/forward", requireAdmin, async (req: Request, res: Response) => {
  const messageId = String(req.params["id"] ?? "");
  const { to, comment } = req.body as { to: string[]; comment?: string };
  if (!messageId || !to?.length || !graphCredentialsPresent() || !mailUserId()) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  const ok = await forwardMessage(mailUserId(), messageId, to, comment);
  if (!ok) {
    res.status(500).json({ error: "Failed to forward message" });
    return;
  }
  res.json({ ok: true });
});

// ─── Create draft ─────────────────────────────────────────────────────────────

router.post("/inbox/drafts", requireAdmin, async (req: Request, res: Response) => {
  const { to, cc, bcc, subject, body, bodyType } = req.body as {
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    body: string;
    bodyType?: "html" | "text";
  };
  if (!graphCredentialsPresent() || !mailUserId()) {
    res.status(400).json({ error: "Graph not available" });
    return;
  }
  const draft = await createDraft({ userId: mailUserId(), to: to ?? [], cc, bcc, subject: subject ?? "", body: body ?? "", bodyType });
  if (!draft) {
    res.status(500).json({ error: "Failed to create draft" });
    return;
  }
  res.json({ message: draft });
});

// ─── Update draft ─────────────────────────────────────────────────────────────

router.patch("/inbox/drafts/:id", requireAdmin, async (req: Request, res: Response) => {
  const messageId = String(req.params["id"] ?? "");
  if (!messageId || !graphCredentialsPresent() || !mailUserId()) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  const ok = await updateDraft(mailUserId(), messageId, req.body as Parameters<typeof updateDraft>[2]);
  res.json({ ok });
});

// ─── Search messages ──────────────────────────────────────────────────────────

router.get("/inbox/search", requireAdmin, async (req: Request, res: Response) => {
  const query = String(req.query["q"] ?? "").trim();
  if (!query || !graphCredentialsPresent() || !mailUserId()) {
    res.json({ messages: [] });
    return;
  }
  const messages = await searchMessages(mailUserId(), query, 30);
  res.json({ messages });
});

// ─── CRM links CRUD ───────────────────────────────────────────────────────────

router.get("/inbox/messages/:id/links", requireAdmin, async (req: Request, res: Response) => {
  const graphMessageId = String(req.params["id"] ?? "");
  const links = await db
    .select()
    .from(inboxMessageLinksTable)
    .where(eq(inboxMessageLinksTable.graphMessageId, graphMessageId));
  res.json({ links });
});

router.post("/inbox/messages/:id/links", requireAdmin, async (req: Request, res: Response) => {
  const graphMessageId = String(req.params["id"] ?? "");
  const { leadId, opportunityId, customerId, taskId, direction } = req.body as {
    leadId?: number;
    opportunityId?: number;
    customerId?: number;
    taskId?: number;
    direction?: "inbound" | "outbound";
  };
  if (!graphMessageId) {
    res.status(400).json({ error: "Missing message ID" });
    return;
  }
  const [existing] = await db
    .select({ id: inboxMessageLinksTable.id })
    .from(inboxMessageLinksTable)
    .where(eq(inboxMessageLinksTable.graphMessageId, graphMessageId))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(inboxMessageLinksTable)
      .set({ leadId: leadId ?? null, opportunityId: opportunityId ?? null, customerId: customerId ?? null, taskId: taskId ?? null })
      .where(eq(inboxMessageLinksTable.id, existing.id))
      .returning();
    res.json({ link: updated });
  } else {
    const [created] = await db
      .insert(inboxMessageLinksTable)
      .values({ graphMessageId, leadId: leadId ?? null, opportunityId: opportunityId ?? null, customerId: customerId ?? null, taskId: taskId ?? null, direction: direction ?? "inbound" })
      .returning();
    res.json({ link: created });
  }
});

router.delete("/inbox/messages/:id/links", requireAdmin, async (req: Request, res: Response) => {
  const graphMessageId = String(req.params["id"] ?? "");
  await db.delete(inboxMessageLinksTable).where(eq(inboxMessageLinksTable.graphMessageId, graphMessageId));
  res.json({ ok: true });
});

// ─── Convert to Kanban task ───────────────────────────────────────────────────

router.post("/inbox/messages/:id/convert-to-task", requireAdmin, async (req: Request, res: Response) => {
  const graphMessageId = String(req.params["id"] ?? "");
  const { projectId, title, description, dueDate, priority, leadId, opportunityId, customerId } = req.body as {
    projectId: number;
    title: string;
    description?: string;
    dueDate?: string;
    priority?: string;
    leadId?: number;
    opportunityId?: number;
    customerId?: number;
  };

  if (!projectId || !title?.trim()) {
    res.status(400).json({ error: "projectId and title are required" });
    return;
  }

  const [project] = await db.select({ id: projectsTable.id }).from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const [task] = await db.insert(kanbanTasksTable).values({
    projectId,
    title: title.trim(),
    description: description?.trim() ?? null,
    column: "backlog",
    priority: (priority as "low" | "medium" | "high") ?? "medium",
    dueDate: dueDate ? new Date(dueDate) : null,
    assignedTo: "Shane",
  }).returning();

  if (!task) {
    res.status(500).json({ error: "Failed to create task" });
    return;
  }

  const [existing] = await db.select({ id: inboxMessageLinksTable.id }).from(inboxMessageLinksTable).where(eq(inboxMessageLinksTable.graphMessageId, graphMessageId)).limit(1);
  if (existing) {
    await db.update(inboxMessageLinksTable).set({ taskId: task.id, leadId: leadId ?? null, opportunityId: opportunityId ?? null, customerId: customerId ?? null }).where(eq(inboxMessageLinksTable.id, existing.id));
  } else {
    await db.insert(inboxMessageLinksTable).values({ graphMessageId, taskId: task.id, leadId: leadId ?? null, opportunityId: opportunityId ?? null, customerId: customerId ?? null, direction: "inbound" });
  }

  res.json({ task });
});

// ─── Batch create tasks from AI extraction ────────────────────────────────────

router.post("/inbox/messages/:id/extract-tasks", requireAdmin, async (req: Request, res: Response) => {
  const graphMessageId = String(req.params["id"] ?? "");
  const { projectId, tasks, leadId, opportunityId, customerId } = req.body as {
    projectId: number;
    tasks: Array<{ title: string; description?: string; dueDate?: string; priority?: string }>;
    leadId?: number;
    opportunityId?: number;
    customerId?: number;
  };

  if (!projectId || !tasks?.length) {
    res.status(400).json({ error: "projectId and tasks array are required" });
    return;
  }

  const created = [];
  for (const t of tasks) {
    if (!t.title?.trim()) continue;
    const [task] = await db.insert(kanbanTasksTable).values({
      projectId,
      title: t.title.trim(),
      description: t.description?.trim() ?? null,
      column: "backlog",
      priority: (t.priority as "low" | "medium" | "high") ?? "medium",
      dueDate: t.dueDate ? new Date(t.dueDate) : null,
      assignedTo: "Shane",
    }).returning();
    if (task) created.push(task);
  }

  // Upsert the CRM link with all entity associations + first task
  if (created.length > 0) {
    const [existing] = await db.select({ id: inboxMessageLinksTable.id }).from(inboxMessageLinksTable).where(eq(inboxMessageLinksTable.graphMessageId, graphMessageId)).limit(1);
    if (existing) {
      await db.update(inboxMessageLinksTable)
        .set({
          taskId: created[0]!.id,
          leadId: leadId ?? null,
          opportunityId: opportunityId ?? null,
          customerId: customerId ?? null,
        })
        .where(eq(inboxMessageLinksTable.id, existing.id));
    } else {
      await db.insert(inboxMessageLinksTable).values({
        graphMessageId,
        taskId: created[0]!.id,
        leadId: leadId ?? null,
        opportunityId: opportunityId ?? null,
        customerId: customerId ?? null,
        direction: "inbound",
      });
    }
  }

  res.json({ tasks: created });
});

// ─── AI Actions ───────────────────────────────────────────────────────────────

router.post("/inbox/ai", requireAdmin, async (req: Request, res: Response) => {
  const { action, messageBody, subject, senderName, crmContext } = req.body as {
    action: "draft_reply" | "suggest_subject" | "summarize" | "suggest_followup" | "generate_template" | "extract_tasks" | "detect_opportunity" | "detect_lead_signals";
    messageBody: string;
    subject?: string;
    senderName?: string;
    crmContext?: {
      leadName?: string;
      leadCompany?: string;
      leadScore?: number;
      opportunityStage?: string;
      customerName?: string;
    };
  };

  if (!action || !messageBody) {
    res.status(400).json({ error: "action and messageBody are required" });
    return;
  }

  const crmCtx = crmContext
    ? `\nCRM Context: Lead=${crmContext.leadName ?? "unknown"}, Company=${crmContext.leadCompany ?? "unknown"}, Score=${crmContext.leadScore ?? 0}, Stage=${crmContext.opportunityStage ?? "none"}`
    : "";

  try {
    let prompt = "";

    const DRAFT_REPLY_DEFAULT    = `You are Shane McCaw, a senior Microsoft 365 consultant. Be concise and professional.\n\nDraft a professional reply to this email from {{senderName}}.\nSubject: {{subject}}\nBody:\n{{messageBody}}\n\nDraft reply (plain text, no markdown headers):`;
    const SUMMARIZE_DEFAULT      = `You are Shane McCaw, a senior Microsoft 365 consultant. Be concise and professional.\n\nSummarize this email thread. Extract: key action items, commitments made, deadlines mentioned, and decision points.\nSubject: {{subject}}\nBody:\n{{messageBody}}\n\nReturn JSON: {"summary":"...","actionItems":["..."],"commitments":["..."],"deadlines":["..."]}`;
    const EXTRACT_TASKS_DEFAULT  = `You are Shane McCaw, a senior Microsoft 365 consultant. Be concise and professional.\n\nExtract all action items and tasks from this email. For each task include a title, brief description, estimated due date (relative like "within 3 days"), and priority (low/medium/high).\nSubject: {{subject}}\nBody:\n{{messageBody}}\n\nReturn ONLY a JSON array: [{"title":"...","description":"...","dueDate":"YYYY-MM-DD or null","priority":"medium"}]`;
    const DETECT_OPP_DEFAULT     = `You are Shane McCaw, a senior Microsoft 365 consultant. Be concise and professional.\n\nAnalyze this email for buying signals — budget discussion, timeline, decision maker involvement, pain points, or explicit purchase intent.\nSubject: {{subject}}\nBody:\n{{messageBody}}\n\nReturn JSON: {"detected":true/false,"confidence":"high/medium/low","signals":["..."],"opportunityName":"...","recommendedNextStep":"..."}`;
    const DETECT_LEAD_DEFAULT    = `You are Shane McCaw, a senior Microsoft 365 consultant. Be concise and professional.\n\nAnalyze this email for lead qualification signals. Score each dimension (0-10): fit, pain, maturity, intent, urgency.\nSubject: {{subject}}\nBody:\n{{messageBody}}\n\nReturn JSON: {"scoreFit":0,"scorePain":0,"scoreMaturity":0,"scoreIntent":0,"scoreUrgency":0,"signals":["..."],"stageProgression":"none/propose/qualify","confidence":"high/medium/low"}`;
    const SUGGEST_SUBJECT_DEFAULT = `You are Shane McCaw, a senior Microsoft 365 consultant. Be concise and professional.\n\nSuggest 3 professional subject line alternatives for this email thread.\nCurrent subject: {{subject}}\nBody: {{messageBody}}\n\nReturn ONLY a JSON array of 3 strings, no other text:`;
    const SUGGEST_FOLLOWUP_DEFAULT = `You are Shane McCaw, a senior Microsoft 365 consultant. Be concise and professional.\n\nBased on this email, suggest 2-3 follow-up messages to send later.\nSubject: {{subject}}\nBody: {{messageBody}}\n\nReturn JSON array: [{"subject":"...","body":"...","timing":"..."}]`;
    const GEN_TEMPLATE_DEFAULT   = `You are Shane McCaw, a senior Microsoft 365 consultant. Be concise and professional.\n\nGenerate a reusable outreach email template based on the context of this message.\nSubject: {{subject}}\nBody: {{messageBody}}\n\nReturn JSON: {"subject":"...","body":"...","description":"..."}`;

    if (action === "draft_reply") {
      const tpl = await getPrompt("inbox-draft-reply", DRAFT_REPLY_DEFAULT);
      prompt = tpl
        .replace("{{senderName}}", senderName ?? "the sender")
        .replace("{{subject}}", subject ?? "")
        .replace("{{messageBody}}", messageBody + crmCtx);
    } else if (action === "suggest_subject") {
      const tpl = await getPrompt("inbox-suggest-subject", SUGGEST_SUBJECT_DEFAULT);
      prompt = tpl
        .replace("{{subject}}", subject ?? "none")
        .replace("{{messageBody}}", messageBody.slice(0, 500));
    } else if (action === "summarize") {
      const tpl = await getPrompt("inbox-summarize", SUMMARIZE_DEFAULT);
      prompt = tpl
        .replace("{{subject}}", subject ?? "")
        .replace("{{messageBody}}", messageBody);
    } else if (action === "suggest_followup") {
      const tpl = await getPrompt("inbox-suggest-followup", SUGGEST_FOLLOWUP_DEFAULT);
      prompt = tpl
        .replace("{{subject}}", subject ?? "")
        .replace("{{messageBody}}", messageBody.slice(0, 800) + crmCtx);
    } else if (action === "generate_template") {
      const tpl = await getPrompt("inbox-generate-template", GEN_TEMPLATE_DEFAULT);
      prompt = tpl
        .replace("{{subject}}", subject ?? "")
        .replace("{{messageBody}}", messageBody.slice(0, 600) + crmCtx);
    } else if (action === "extract_tasks") {
      const tpl = await getPrompt("inbox-extract-tasks", EXTRACT_TASKS_DEFAULT);
      prompt = tpl
        .replace("{{subject}}", subject ?? "")
        .replace("{{messageBody}}", messageBody);
    } else if (action === "detect_opportunity") {
      const tpl = await getPrompt("inbox-detect-opportunity", DETECT_OPP_DEFAULT);
      prompt = tpl
        .replace("{{subject}}", subject ?? "")
        .replace("{{messageBody}}", messageBody);
    } else if (action === "detect_lead_signals") {
      const tpl = await getPrompt("inbox-detect-lead-signals", DETECT_LEAD_DEFAULT);
      prompt = tpl
        .replace("{{subject}}", subject ?? "")
        .replace("{{messageBody}}", messageBody + crmCtx);
    } else {
      res.status(400).json({ error: "Unknown action" });
      return;
    }

    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    });

    const block = msg.content[0];
    if (!block || block.type !== "text") {
      res.status(500).json({ error: "AI returned no text" });
      return;
    }

    const text = block.text.trim();

    if (["suggest_subject", "summarize", "suggest_followup", "generate_template", "extract_tasks", "detect_opportunity", "detect_lead_signals"].includes(action)) {
      try {
        const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
        if (jsonMatch) {
          res.json({ result: JSON.parse(jsonMatch[0]) });
          return;
        }
      } catch { /* fall through to raw text */ }
    }

    res.json({ result: text });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "AI error";
    logger.error({ err }, "inbox AI error");
    res.status(500).json({ error: errMsg });
  }
});

// ─── Get linked CRM entities for message ─────────────────────────────────────

router.get("/inbox/messages/:id/crm", requireAdmin, async (req: Request, res: Response) => {
  const graphMessageId = String(req.params["id"] ?? "");
  const [link] = await db
    .select()
    .from(inboxMessageLinksTable)
    .where(eq(inboxMessageLinksTable.graphMessageId, graphMessageId))
    .limit(1);

  if (!link) {
    res.json({ link: null, lead: null, opportunity: null, customer: null, task: null });
    return;
  }

  const [lead, opportunity, customer, task] = await Promise.all([
    link.leadId
      ? db.select({ id: leadsTable.id, name: leadsTable.name, email: leadsTable.email, company: leadsTable.company, score: leadsTable.score, status: leadsTable.status, stage: leadsTable.stage }).from(leadsTable).where(eq(leadsTable.id, link.leadId)).limit(1).then(r => r[0] ?? null)
      : Promise.resolve(null),
    link.opportunityId
      ? db.select({ id: opportunitiesTable.id, leadId: opportunitiesTable.leadId, scoreSnapshot: opportunitiesTable.scoreSnapshot, evidence: opportunitiesTable.evidence, recommendedNextStep: opportunitiesTable.recommendedNextStep }).from(opportunitiesTable).where(eq(opportunitiesTable.id, link.opportunityId)).limit(1).then(r => r[0] ?? null)
      : Promise.resolve(null),
    link.customerId
      ? db.select({ id: usersTable.id, name: usersTable.name, email: usersTable.email, company: usersTable.company }).from(usersTable).where(eq(usersTable.id, link.customerId)).limit(1).then(r => r[0] ?? null)
      : Promise.resolve(null),
    link.taskId
      ? db.select({ id: kanbanTasksTable.id, title: kanbanTasksTable.title, column: kanbanTasksTable.column, priority: kanbanTasksTable.priority }).from(kanbanTasksTable).where(eq(kanbanTasksTable.id, link.taskId)).limit(1).then(r => r[0] ?? null)
      : Promise.resolve(null),
  ]);

  res.json({ link, lead, opportunity, customer, task });
});

// ─── List messages linked to a CRM entity ────────────────────────────────────

router.get("/inbox/crm-view/:type/:id", requireAdmin, async (req: Request, res: Response) => {
  const entityType = String(req.params["type"] ?? "");
  const entityId = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(entityId) || !["lead", "opportunity", "customer"].includes(entityType)) {
    res.status(400).json({ error: "Invalid entity type or ID" });
    return;
  }

  let rows;
  if (entityType === "lead") {
    rows = await db.select().from(inboxMessageLinksTable).where(eq(inboxMessageLinksTable.leadId, entityId)).orderBy(desc(inboxMessageLinksTable.createdAt));
  } else if (entityType === "opportunity") {
    rows = await db.select().from(inboxMessageLinksTable).where(eq(inboxMessageLinksTable.opportunityId, entityId)).orderBy(desc(inboxMessageLinksTable.createdAt));
  } else {
    rows = await db.select().from(inboxMessageLinksTable).where(eq(inboxMessageLinksTable.customerId, entityId)).orderBy(desc(inboxMessageLinksTable.createdAt));
  }

  res.json({ links: rows });
});

// ─── Count linked CRM messages for sidebar badges ────────────────────────────

router.get("/inbox/crm-counts", requireAdmin, async (_req: Request, res: Response) => {
  const [leadCount] = await db.select({ c: isNotNull(inboxMessageLinksTable.leadId) }).from(inboxMessageLinksTable).where(isNotNull(inboxMessageLinksTable.leadId)).limit(1);
  const [oppCount] = await db.select({ c: isNotNull(inboxMessageLinksTable.opportunityId) }).from(inboxMessageLinksTable).where(isNotNull(inboxMessageLinksTable.opportunityId)).limit(1);
  const [custCount] = await db.select({ c: isNotNull(inboxMessageLinksTable.customerId) }).from(inboxMessageLinksTable).where(isNotNull(inboxMessageLinksTable.customerId)).limit(1);

  res.json({
    linkedLeads: leadCount ? 1 : 0,
    linkedOpportunities: oppCount ? 1 : 0,
    linkedCustomers: custCount ? 1 : 0,
  });
});

// ─── CRM folder views: fetch all messages linked to a CRM type ───────────────
// type: "leads" | "prospects" | "customers"
// Fetches the graph message IDs stored in inbox_message_links, then pulls
// the live Graph message objects for each one.

router.get("/inbox/crm-messages", requireAdmin, async (req: Request, res: Response) => {
  const entityType = String(req.query["type"] ?? "leads");
  if (!graphCredentialsPresent() || !mailUserId()) {
    res.json({ messages: [], links: [] });
    return;
  }

  // Build query based on type
  let links;
  if (entityType === "leads") {
    links = await db
      .select()
      .from(inboxMessageLinksTable)
      .where(isNotNull(inboxMessageLinksTable.leadId))
      .orderBy(desc(inboxMessageLinksTable.createdAt))
      .limit(50);
  } else if (entityType === "prospects") {
    // Leads that have an opportunity (AQL/SQL stage)
    links = await db
      .select()
      .from(inboxMessageLinksTable)
      .where(isNotNull(inboxMessageLinksTable.opportunityId))
      .orderBy(desc(inboxMessageLinksTable.createdAt))
      .limit(50);
  } else {
    // customers
    links = await db
      .select()
      .from(inboxMessageLinksTable)
      .where(isNotNull(inboxMessageLinksTable.customerId))
      .orderBy(desc(inboxMessageLinksTable.createdAt))
      .limit(50);
  }

  if (links.length === 0) {
    res.json({ messages: [], links: [] });
    return;
  }

  // Fetch Graph messages in parallel (cap at 20 to avoid throttling)
  const toFetch = links.slice(0, 20);
  const messageResults = await Promise.allSettled(
    toFetch.map(link => getMessage(mailUserId(), link.graphMessageId))
  );

  const messages = messageResults
    .map((r, i) => ({
      link: toFetch[i]!,
      message: r.status === "fulfilled" ? r.value : null,
    }))
    .filter(r => r.message !== null)
    .map(r => r.message!);

  res.json({ messages, links });
});

// ─── Get all linked graph message IDs (for client-side filter) ───────────────

router.get("/inbox/linked-ids", requireAdmin, async (req: Request, res: Response) => {
  const type = String(req.query["type"] ?? "any");

  let rows;
  if (type === "lead") {
    rows = await db
      .select({ id: inboxMessageLinksTable.graphMessageId })
      .from(inboxMessageLinksTable)
      .where(isNotNull(inboxMessageLinksTable.leadId));
  } else if (type === "opportunity") {
    rows = await db
      .select({ id: inboxMessageLinksTable.graphMessageId })
      .from(inboxMessageLinksTable)
      .where(isNotNull(inboxMessageLinksTable.opportunityId));
  } else if (type === "customer") {
    rows = await db
      .select({ id: inboxMessageLinksTable.graphMessageId })
      .from(inboxMessageLinksTable)
      .where(isNotNull(inboxMessageLinksTable.customerId));
  } else {
    rows = await db
      .select({ id: inboxMessageLinksTable.graphMessageId })
      .from(inboxMessageLinksTable);
  }

  res.json({ ids: rows.map(r => r.id) });
});

// ─── AI score/stage suggestion for on-open chips ─────────────────────────────

router.post("/inbox/messages/:id/suggest-updates", requireAdmin, async (req: Request, res: Response) => {
  const { messageBody, subject, currentScore, currentStage, leadId } = req.body as {
    messageBody: string;
    subject?: string;
    currentScore?: number;
    currentStage?: string;
    leadId?: number;
  };

  if (!messageBody) {
    res.status(400).json({ error: "messageBody required" });
    return;
  }

  const prompt = `You are Shane McCaw's CRM assistant. Based on this email, suggest whether the linked lead's score and stage should be updated.

Current lead score: ${currentScore ?? "unknown"}/100
Current stage: ${currentStage ?? "unknown"}
Subject: ${subject ?? ""}
Email excerpt: ${messageBody.slice(0, 1000)}

Return JSON: {
  "suggestScoreChange": true/false,
  "newScore": <number or null>,
  "suggestStageChange": true/false,
  "newStage": "Junk" | "Cold" | "Warm" | "Hot" | null,
  "reasoning": "one-line explanation",
  "urgency": "high" | "medium" | "low"
}
If no changes are warranted return suggestScoreChange: false and suggestStageChange: false.`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });
    const block = msg.content[0];
    if (!block || block.type !== "text") {
      res.json({ suggestScoreChange: false, suggestStageChange: false });
      return;
    }
    const jsonMatch = block.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      res.json(JSON.parse(jsonMatch[0]));
    } else {
      res.json({ suggestScoreChange: false, suggestStageChange: false });
    }
  } catch (err) {
    logger.error({ err }, "suggest-updates error");
    res.json({ suggestScoreChange: false, suggestStageChange: false });
  }
});

// ─── Create opportunity directly from an inbox email ─────────────────────────
// One-shot: qualification record → approve → opportunity + workflow tasks → link

router.post("/inbox/messages/:id/create-opportunity", requireAdmin, async (req: Request, res: Response) => {
  const graphMessageId = String(req.params["id"] ?? "");
  const {
    leadId, opportunityName, signals = [], recommendedNextStep = "",
    scoreFit = 3, scorePain = 5, scoreMaturity = 2, scoreIntent = 4, scoreUrgency = 3,
    workflowType = "discovery",
  } = req.body as {
    leadId: number;
    opportunityName?: string;
    signals?: string[];
    recommendedNextStep?: string;
    scoreFit?: number; scorePain?: number; scoreMaturity?: number;
    scoreIntent?: number; scoreUrgency?: number;
    workflowType?: string;
  };

  if (!leadId) { res.status(400).json({ error: "leadId is required" }); return; }

  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, leadId)).limit(1);
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  const newScore = Math.min(100, (lead.score ?? 0) + 15);

  // 1. Create a qualification record (auto-approved)
  const [qual] = await db.insert(leadQualificationsTable).values({
    leadId,
    previousScore: lead.score ?? 0,
    newScore,
    stage: "Warm",
    scoreFit,
    scorePain,
    scoreMaturity,
    scoreIntent,
    scoreUrgency,
    evidence: signals,
    recommendedNextStep,
    workflowType,
    status: "pending",
  }).returning();

  if (!qual) { res.status(500).json({ error: "Failed to create qualification" }); return; }

  // 2. Find or create Opportunities project
  let opProject = await db.select().from(projectsTable).where(eq(projectsTable.title, "Opportunities")).limit(1).then(r => r[0] ?? null);
  if (!opProject) {
    const [created] = await db.insert(projectsTable).values({
      title: "Opportunities",
      description: "Auto-created for opportunity workflow tasks",
      status: "active",
      clientUserId: null,
    }).returning();
    opProject = created ?? null;
  }

  // 3. Create opportunity
  const [opportunity] = await db.insert(opportunitiesTable).values({
    leadId,
    scoreSnapshot: newScore,
    scoreFit,
    scorePain,
    scoreMaturity,
    scoreIntent,
    scoreUrgency,
    evidence: signals,
    recommendedNextStep,
    workflowType,
    projectId: opProject?.id ?? null,
  }).returning();

  if (!opportunity) { res.status(500).json({ error: "Failed to create opportunity" }); return; }

  // 4. Update lead score + stage
  await db.update(leadsTable)
    .set({ score: newScore, stage: "Warm", status: "contacted" })
    .where(eq(leadsTable.id, leadId));

  // 5. Approve the qualification
  await db.update(leadQualificationsTable)
    .set({ status: "approved" })
    .where(eq(leadQualificationsTable.id, qual.id));

  // 6. Generate workflow tasks
  const taskTemplates = generateWorkflowTasks(workflowType, lead.name);
  if (opProject && taskTemplates.length > 0) {
    await Promise.allSettled(
      taskTemplates.map(async (t, idx) => {
        const due = daysFromNow(t.dueDaysFromNow);
        const [kanbanTask] = await db.insert(kanbanTasksTable).values({
          projectId: opProject.id,
          title: t.title,
          description: t.description ?? null,
          column: "backlog",
          order: idx,
          assignedTo: t.assignedTo,
          dueDate: due,
          groupName: `${workflowType} — ${lead.name}`,
          priority: "medium",
          taskType: "opportunity",
          taskMetadata: { opportunityId: opportunity.id, leadName: lead.name },
        }).returning({ id: kanbanTasksTable.id });

        if (kanbanTask) {
          await db.insert(opportunityTasksTable).values({
            opportunityId: opportunity.id,
            title: t.title,
            description: t.description ?? null,
            assignedTo: t.assignedTo,
            dueDate: due,
            status: "todo",
            kanbanTaskId: kanbanTask.id,
          });
        }
      })
    );
  }

  // 7. Upsert inbox message link with lead + opportunity
  const [existing] = await db.select({ id: inboxMessageLinksTable.id })
    .from(inboxMessageLinksTable)
    .where(eq(inboxMessageLinksTable.graphMessageId, graphMessageId))
    .limit(1);

  if (existing) {
    await db.update(inboxMessageLinksTable)
      .set({ leadId, opportunityId: opportunity.id })
      .where(eq(inboxMessageLinksTable.id, existing.id));
  } else {
    await db.insert(inboxMessageLinksTable).values({
      graphMessageId,
      leadId,
      opportunityId: opportunity.id,
      direction: "inbound",
    });
  }

  res.json({ opportunity, lead: { ...lead, score: newScore, stage: "Warm" } });
});

// ─── Apply lead score/stage update from inbox ─────────────────────────────────

router.patch("/inbox/leads/:leadId/score-stage", requireAdmin, async (req: Request, res: Response) => {
  const leadId = parseInt(String(req.params["leadId"] ?? ""), 10);
  if (isNaN(leadId)) { res.status(400).json({ error: "Invalid lead ID" }); return; }

  const { score, stage } = req.body as { score?: number; stage?: string };

  if (score === undefined && stage === undefined) {
    res.status(400).json({ error: "Nothing to update" });
    return;
  }

  try {
    // Build a strongly-typed set object — only include fields that are present
    const setVal: {
      score?: number;
      stage?: "Junk" | "Cold" | "Warm" | "Hot";
    } = {};
    if (score !== undefined) setVal.score = score;
    if (stage !== undefined) setVal.stage = stage as "Junk" | "Cold" | "Warm" | "Hot";

    const [updated] = await db
      .update(leadsTable)
      .set(setVal)
      .where(eq(leadsTable.id, leadId))
      .returning({ id: leadsTable.id, score: leadsTable.score, stage: leadsTable.stage });
    res.json({ lead: updated ?? null });
  } catch (err) {
    logger.error({ err }, "score-stage patch error");
    res.status(500).json({ error: "Failed to update lead" });
  }
});

export default router;
