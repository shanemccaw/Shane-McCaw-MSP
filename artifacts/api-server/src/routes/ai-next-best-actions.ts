import { Router, type Request, type Response } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import {
  db, nextBestActionsTable, usersTable, projectsTable, leadsTable,
  opportunitiesTable, clientHealthHistoryTable, revenueForecastsTable,
  kanbanTasksTable, invoicesTable, workflowStepsTable,
} from "@workspace/db";
import { eq, isNull, desc, and, gte, inArray } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { getPrompt } from "../lib/prompt-loader.ts";

const router = Router();

const NBA_GLOBAL_DEFAULT = `You are Shane McCaw's AI business advisor. Based on the consulting business data below, generate the top 5 most impactful next best actions Shane should take TODAY or THIS WEEK to grow revenue, retain clients, and advance projects.

For each action, determine which entity it relates to (client, project, lead, opportunity, or general business), provide a confidence score (1-100), and suggest an admin panel link path (e.g. /crm/clients/1, /crm/projects/2, /crm/leads/3, /overview).

Return ONLY a JSON array in this exact format, nothing else:
[
  {
    "entityType": "client|project|lead|opportunity|general",
    "entityId": <number or null>,
    "entityName": <string or null>,
    "action": "<30-60 word action description>",
    "rationale": "<20-40 word rationale explaining why this is the priority>",
    "confidence": <50-99>,
    "linkPath": "<path or null>"
  }
]`;

const NBA_ENTITY_DEFAULT = `You are Shane McCaw's AI business advisor. Based on the data below for a specific {{entityType}}, generate the 3–5 most impactful next best actions Shane should take in the next 1–2 weeks for this {{entityType}}.

Be specific and actionable. Reference the actual project/client data. Include confidence (50–99) and a link path if applicable.

Return ONLY a JSON array, nothing else:
[
  {
    "entityType": "{{entityType}}",
    "entityId": {{entityId}},
    "entityName": "{{entityName}}",
    "action": "<25-50 word specific action>",
    "rationale": "<15-30 word rationale>",
    "confidence": <50-99>,
    "linkPath": <path or null>
  }
]`;

interface NbaRow {
  entityType: "client" | "project" | "lead" | "opportunity" | "general";
  entityId: number | null;
  entityName: string | null;
  action: string;
  rationale: string;
  confidence: number;
  linkPath: string | null;
}

// ── POST /api/ai/next-best-actions/generate ───────────────────────────────────
// Gathers cross-system context (health, forecast, pipeline, projects) and asks
// Claude for the top 5 highest-impact actions Shane should take right now.
router.post("/ai/next-best-actions/generate", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    const [clients, activeProjects, openLeads, opportunities, recentHealth, latestForecast, overdueInvoices, overdueKanban] = await Promise.all([
      db.select({ id: usersTable.id, name: usersTable.name, company: usersTable.company, email: usersTable.email })
        .from(usersTable).where(eq(usersTable.role, "client")).limit(30),
      db.select({ id: projectsTable.id, title: projectsTable.title, status: projectsTable.status,
        phase: projectsTable.phase, progress: projectsTable.progress, clientUserId: projectsTable.clientUserId,
        endDate: projectsTable.endDate })
        .from(projectsTable).where(eq(projectsTable.status, "active")).limit(20),
      db.select({ id: leadsTable.id, name: leadsTable.name, company: leadsTable.company,
        status: leadsTable.status, stage: leadsTable.stage, score: leadsTable.score, createdAt: leadsTable.createdAt })
        .from(leadsTable).where(and(
          isNull(leadsTable.lastQualifiedAt),
        )).orderBy(desc(leadsTable.score)).limit(10),
      db.select({ id: opportunitiesTable.id, leadId: opportunitiesTable.leadId,
        scoreSnapshot: opportunitiesTable.scoreSnapshot, recommendedNextStep: opportunitiesTable.recommendedNextStep,
        createdAt: opportunitiesTable.createdAt })
        .from(opportunitiesTable).orderBy(desc(opportunitiesTable.scoreSnapshot)).limit(10),
      db.select({ clientId: clientHealthHistoryTable.clientId, category: clientHealthHistoryTable.category,
        score: clientHealthHistoryTable.score, recordedAt: clientHealthHistoryTable.recordedAt })
        .from(clientHealthHistoryTable).where(gte(clientHealthHistoryTable.recordedAt, thirtyDaysAgo)).limit(200),
      db.select().from(revenueForecastsTable).orderBy(desc(revenueForecastsTable.generatedAt)).limit(3),
      db.select({ id: invoicesTable.id, clientUserId: invoicesTable.clientUserId,
        amount: invoicesTable.amount, dueDate: invoicesTable.dueDate, status: invoicesTable.status })
        .from(invoicesTable).where(eq(invoicesTable.status, "overdue")).limit(10),
      db.select({ id: kanbanTasksTable.id, title: kanbanTasksTable.title,
        dueDate: kanbanTasksTable.dueDate, projectId: kanbanTasksTable.projectId, priority: kanbanTasksTable.priority })
        .from(kanbanTasksTable).where(and(
          gte(kanbanTasksTable.dueDate, ninetyDaysAgo),
        )).limit(20),
    ]);

    // Detect health score drops (score < 40 in last 30 days)
    const healthAlerts: string[] = [];
    const healthByClient: Record<number, Array<{ category: string; score: number }>> = {};
    for (const h of recentHealth) {
      if (!healthByClient[h.clientId]) healthByClient[h.clientId] = [];
      healthByClient[h.clientId].push({ category: h.category, score: h.score });
    }
    for (const [cid, scores] of Object.entries(healthByClient)) {
      const client = clients.find(c => c.id === Number(cid));
      const criticals = scores.filter(s => s.score < 40);
      if (criticals.length > 0) {
        const name = client?.name ?? client?.company ?? `Client #${cid}`;
        healthAlerts.push(`${name}: critical scores in ${criticals.map(c => `${c.category} (${c.score})`).join(", ")}`);
      }
    }

    const overdueInvoiceTotal = overdueInvoices.reduce((s, i) => s + parseFloat(i.amount), 0);
    const overdueKanbanDue = overdueKanban.filter(t => t.dueDate && new Date(t.dueDate) < now);

    const forecastNarrative = latestForecast.length > 0
      ? `Revenue forecast narrative: ${latestForecast[0].narrative ?? "no narrative"}. Next 3 months forecast: ${latestForecast.slice(0, 3).map(f => `${f.period}: $${parseFloat(f.forecast).toLocaleString()}`).join(", ")}.`
      : "No revenue forecast generated yet.";

    const context = `
CONSULTING BUSINESS CONTEXT FOR SHANE McCAW (Microsoft 365 Architect):
Today: ${now.toISOString().slice(0, 10)}

ACTIVE CLIENTS (${clients.length}): ${clients.slice(0, 10).map(c => `${c.name ?? c.email}${c.company ? ` (${c.company})` : ""}`).join(", ")}

ACTIVE PROJECTS (${activeProjects.length}):
${activeProjects.slice(0, 10).map(p => `- "${p.title}" — ${p.progress}% complete, phase: ${p.phase ?? "none"}, due: ${p.endDate ? p.endDate.toString().slice(0, 10) : "no date"}`).join("\n")}

OPEN LEADS (${openLeads.length} unqualified, highest scoring first):
${openLeads.slice(0, 5).map(l => `- ${l.name}${l.company ? ` (${l.company})` : ""} — score ${l.score}, stage ${l.stage}, status ${l.status}`).join("\n")}

OPPORTUNITIES (${opportunities.length} in pipeline):
${opportunities.slice(0, 5).map(o => `- Opportunity #${o.id} — score ${o.scoreSnapshot}, next step: ${o.recommendedNextStep ?? "none"}`).join("\n")}

HEALTH ALERTS (clients with critical M365 scores <40 in last 30 days):
${healthAlerts.length > 0 ? healthAlerts.join("\n") : "No critical health alerts."}

OVERDUE INVOICES: ${overdueInvoices.length} invoices totalling $${overdueInvoiceTotal.toLocaleString("en-US", { minimumFractionDigits: 0 })}

OVERDUE TASKS: ${overdueKanbanDue.length} kanban tasks past due date

${forecastNarrative}
`.trim();

    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: `${await getPrompt("nba-global", NBA_GLOBAL_DEFAULT)}

BUSINESS DATA:
${context}

JSON:`,
        },
      ],
    });

    const block = msg.content[0];
    if (block.type !== "text") {
      res.status(500).json({ error: "Unexpected AI response type" });
      return;
    }

    let actions: NbaRow[] = [];
    try {
      const jsonMatch = block.text.trim().match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as NbaRow[];
        actions = parsed.slice(0, 5);
      }
    } catch {
      res.status(500).json({ error: "Failed to parse AI response as JSON" });
      return;
    }

    if (actions.length === 0) {
      res.status(500).json({ error: "AI returned no actions" });
      return;
    }

    const inserts = actions.map(a => ({
      entityType: a.entityType,
      entityId: a.entityId ?? null,
      entityName: a.entityName ?? null,
      action: a.action,
      rationale: a.rationale,
      confidence: Math.min(99, Math.max(1, a.confidence)),
      linkPath: a.linkPath ?? null,
    }));

    const inserted = await db.insert(nextBestActionsTable).values(inserts).returning();

    res.json({ generated: inserted.length, actions: inserted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Generation failed";
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/ai/next-best-actions ────────────────────────────────────────────
// Entity-specific action generation: body must include { entityType, entityId }.
// Gathers focused context for that entity and calls Claude for 3–5 targeted actions.
router.post("/ai/next-best-actions", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { entityType, entityId } = req.body as { entityType?: string; entityId?: number };
    if (!entityType || !entityId) {
      res.status(400).json({ error: "entityType and entityId are required" });
      return;
    }

    let contextLines: string[] = [];
    let entityName = `${entityType} #${entityId}`;

    if (entityType === "client") {
      const [clientRows, projectRows, healthRows] = await Promise.all([
        db.select({ id: usersTable.id, name: usersTable.name, company: usersTable.company, email: usersTable.email })
          .from(usersTable).where(eq(usersTable.id, entityId)).limit(1),
        db.select({ id: projectsTable.id, title: projectsTable.title, status: projectsTable.status,
          phase: projectsTable.phase, progress: projectsTable.progress, endDate: projectsTable.endDate })
          .from(projectsTable).where(eq(projectsTable.clientUserId, entityId)).limit(10),
        db.select({ category: clientHealthHistoryTable.category, score: clientHealthHistoryTable.score,
          recordedAt: clientHealthHistoryTable.recordedAt })
          .from(clientHealthHistoryTable)
          .where(eq(clientHealthHistoryTable.clientId, entityId))
          .orderBy(desc(clientHealthHistoryTable.recordedAt)).limit(24),
      ]);
      const c = clientRows[0];
      if (c) entityName = c.name ?? c.company ?? c.email;

      // Fetch kanban tasks for this client's projects (join client→projects→tasks via inArray)
      const projectIds = projectRows.map(p => p.id);
      let taskRows: Array<{ id: number; title: string; column: string | null; dueDate: Date | null; priority: string | null }> = [];
      if (projectIds.length > 0) {
        taskRows = await db.select({ id: kanbanTasksTable.id, title: kanbanTasksTable.title,
          column: kanbanTasksTable.column, dueDate: kanbanTasksTable.dueDate, priority: kanbanTasksTable.priority })
          .from(kanbanTasksTable)
          .where(inArray(kanbanTasksTable.projectId, projectIds))
          .limit(30);
      }

      contextLines = [
        `Client: ${entityName}${c?.company ? ` (${c.company})` : ""}`,
        `Projects (${projectRows.length}): ${projectRows.map(p => `"${p.title}" ${p.progress}% — ${p.status} — due ${p.endDate ? p.endDate.toString().slice(0,10) : "none"}`).join("; ")}`,
        `Tasks across all client projects: ${taskRows.length} kanban tasks — ${taskRows.filter(t => t.column === "in_progress").length} in progress, ${taskRows.filter(t => t.column === "waiting_on_customer").length} waiting on client`,
        `Latest M365 health scores: ${healthRows.slice(0, 8).map(h => `${h.category}=${h.score}`).join(", ") || "none recorded"}`,
      ];
    } else if (entityType === "project") {
      const [projRows, taskRows, stepRows] = await Promise.all([
        db.select().from(projectsTable).where(eq(projectsTable.id, entityId)).limit(1),
        db.select({ id: kanbanTasksTable.id, title: kanbanTasksTable.title,
          column: kanbanTasksTable.column, dueDate: kanbanTasksTable.dueDate, priority: kanbanTasksTable.priority })
          .from(kanbanTasksTable).where(eq(kanbanTasksTable.projectId, entityId)).limit(30),
        db.select({ title: workflowStepsTable.title, status: workflowStepsTable.status, dueDate: workflowStepsTable.dueDate })
          .from(workflowStepsTable).where(eq(workflowStepsTable.projectId, entityId)).limit(20),
      ]);
      const p = projRows[0];
      if (p) entityName = p.title;
      const now = new Date();
      const overdueTasks = taskRows.filter(t => t.dueDate && new Date(t.dueDate) < now && t.column !== "completed");
      contextLines = [
        `Project: "${entityName}" — status ${p?.status}, phase ${p?.phase ?? "none"}, ${p?.progress}% complete`,
        `Timeline: ${p?.startDate ? p.startDate.toString().slice(0,10) : "no start"} → ${p?.endDate ? p.endDate.toString().slice(0,10) : "no end"}`,
        `Tasks: ${taskRows.length} total — ${taskRows.filter(t => t.column === "completed").length} done, ${taskRows.filter(t => t.column === "in_progress").length} in progress, ${taskRows.filter(t => t.column === "waiting_on_customer").length} blocked by client`,
        `Overdue tasks (${overdueTasks.length}): ${overdueTasks.slice(0,5).map(t => t.title).join(", ") || "none"}`,
        `Workflow steps: ${stepRows.map(s => `${s.title} (${s.status})`).join(", ") || "none"}`,
      ];
    }

    const context = contextLines.join("\n");
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 4096,
      messages: [{
        role: "user",
        content: `${(await getPrompt("nba-entity", NBA_ENTITY_DEFAULT))
  .replace(/\{\{entityType\}\}/g, entityType)
  .replace(/\{\{entityId\}\}/g, String(entityId ?? "null"))
  .replace(/\{\{entityName\}\}/g, entityName)}

${entityType.toUpperCase()} DATA:
${context}

JSON:`,
      }],
    });

    const block = msg.content[0];
    if (block.type !== "text") {
      res.status(500).json({ error: "Unexpected AI response type" });
      return;
    }

    let actions: NbaRow[] = [];
    try {
      const jsonMatch = block.text.trim().match(/\[[\s\S]*\]/);
      if (jsonMatch) actions = (JSON.parse(jsonMatch[0]) as NbaRow[]).slice(0, 5);
    } catch {
      res.status(500).json({ error: "Failed to parse AI response" });
      return;
    }

    if (actions.length === 0) {
      res.status(500).json({ error: "AI returned no actions" });
      return;
    }

    const inserts = actions.map(a => ({
      entityType: a.entityType,
      entityId: a.entityId ?? entityId,
      entityName: a.entityName ?? entityName,
      action: a.action,
      rationale: a.rationale,
      confidence: Math.min(99, Math.max(1, a.confidence)),
      linkPath: a.linkPath ?? null,
    }));

    const inserted = await db.insert(nextBestActionsTable).values(inserts).returning();
    res.json({ generated: inserted.length, actions: inserted });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Entity NBA generation failed";
    res.status(500).json({ error: msg });
  }
});

// ── GET /api/ai/next-best-actions ─────────────────────────────────────────────
// Returns unresolved actions sorted by confidence desc.
// Optional: ?entityType=client&entityId=5 to filter for entity-specific views
router.get("/ai/next-best-actions", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { entityType, entityId } = req.query as Record<string, string | undefined>;

    const conditions = [isNull(nextBestActionsTable.resolvedAt)];
    if (entityType) {
      conditions.push(eq(nextBestActionsTable.entityType, entityType as "client" | "project" | "lead" | "opportunity" | "general"));
    }
    if (entityId) {
      conditions.push(eq(nextBestActionsTable.entityId, parseInt(entityId)));
    }

    const rows = await db.select().from(nextBestActionsTable)
      .where(and(...conditions))
      .orderBy(desc(nextBestActionsTable.confidence), desc(nextBestActionsTable.generatedAt))
      .limit(20);

    res.json(rows);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch actions";
    res.status(500).json({ error: msg });
  }
});

// ── POST /api/ai/next-best-actions/:id/resolve ────────────────────────────────
// Marks an action as done (sets resolvedAt to now).
router.post("/ai/next-best-actions/:id/resolve", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) {
      res.status(400).json({ error: "Invalid action ID" });
      return;
    }

    const updated = await db.update(nextBestActionsTable)
      .set({ resolvedAt: new Date() })
      .where(eq(nextBestActionsTable.id, id))
      .returning();

    if (updated.length === 0) {
      res.status(404).json({ error: "Action not found" });
      return;
    }

    res.json(updated[0]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to resolve action";
    res.status(500).json({ error: msg });
  }
});

export default router;
