import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  leadsTable,
  opportunitiesTable,
  opportunityTasksTable,
  leadQualificationsTable,
  projectsTable,
  kanbanTasksTable,
} from "@workspace/db";
import { eq, desc, and, lte, or, isNull, count } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { generateWorkflowTasks, daysFromNow } from "../lib/workflow-tasks";

const router: IRouter = Router();

// ── GET /api/leads/qualification/pending ──────────────────────────────────────
// Returns all pending qualifications that are not currently snoozed
router.get("/leads/qualification/pending", requireAdmin, async (_req: Request, res: Response) => {
  const now = new Date();
  const rows = await db
    .select()
    .from(leadQualificationsTable)
    .where(
      and(
        eq(leadQualificationsTable.status, "pending"),
        or(
          isNull(leadQualificationsTable.snoozedUntil),
          lte(leadQualificationsTable.snoozedUntil, now),
        ),
      ),
    )
    .orderBy(desc(leadQualificationsTable.createdAt))
    .limit(20);

  // Enrich with lead name/email
  const enriched = await Promise.all(
    rows.map(async (q) => {
      const [lead] = await db
        .select({ id: leadsTable.id, name: leadsTable.name, email: leadsTable.email, company: leadsTable.company })
        .from(leadsTable)
        .where(eq(leadsTable.id, q.leadId))
        .limit(1);
      return { ...q, lead: lead ?? null };
    }),
  );

  res.json(enriched);
});

// ── POST /api/leads/qualification/:id/approve ─────────────────────────────────
router.post("/leads/qualification/:id/approve", requireAdmin, async (req: Request, res: Response) => {
  const qualId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(qualId)) { res.status(400).json({ error: "Invalid qualification ID" }); return; }

  const [qual] = await db
    .select()
    .from(leadQualificationsTable)
    .where(eq(leadQualificationsTable.id, qualId))
    .limit(1);

  if (!qual) { res.status(404).json({ error: "Qualification not found" }); return; }
  if (qual.status !== "pending") { res.status(400).json({ error: `Qualification already ${qual.status}` }); return; }

  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, qual.leadId)).limit(1);
  if (!lead) { res.status(404).json({ error: "Lead not found" }); return; }

  // Create or find an "Opportunities" project to hang kanban tasks on
  let opProject = await findOrCreateOpportunitiesProject();

  // Create opportunity
  const [opportunity] = await db.insert(opportunitiesTable).values({
    leadId: qual.leadId,
    scoreSnapshot: qual.newScore,
    scoreFit: qual.scoreFit,
    scorePain: qual.scorePain,
    scoreMaturity: qual.scoreMaturity,
    scoreIntent: qual.scoreIntent,
    scoreUrgency: qual.scoreUrgency,
    evidence: qual.evidence,
    recommendedNextStep: qual.recommendedNextStep,
    workflowType: qual.workflowType,
    projectId: opProject?.id ?? null,
  }).returning();

  // Generate workflow tasks
  const taskTemplates = generateWorkflowTasks(qual.workflowType ?? "DiscoveryCall", lead.name);

  // Bulk insert opportunity_tasks + matching kanban_tasks
  await Promise.all(
    taskTemplates.map(async (t, idx) => {
      const due = daysFromNow(t.dueDaysFromNow);
      let kanbanTaskId: number | null = null;

      if (opProject) {
        const [kanbanTask] = await db.insert(kanbanTasksTable).values({
          projectId: opProject.id,
          title: t.title,
          description: t.description ?? null,
          column: "backlog",
          order: idx,
          assignedTo: t.assignedTo,
          dueDate: due,
          groupName: `${qual.workflowType ?? "Opportunity"} — ${lead.name}`,
          priority: "medium",
          taskType: "opportunity",
          taskMetadata: { opportunityId: opportunity.id, leadName: lead.name },
        }).returning({ id: kanbanTasksTable.id });
        kanbanTaskId = kanbanTask?.id ?? null;
      }

      await db.insert(opportunityTasksTable).values({
        opportunityId: opportunity.id,
        title: t.title,
        description: t.description ?? null,
        dueDate: due,
        assignedTo: t.assignedTo,
        status: "todo",
        kanbanTaskId,
      });
    }),
  );

  // Update qualification status + link to opportunity
  await db
    .update(leadQualificationsTable)
    .set({ status: "approved", opportunityId: opportunity.id })
    .where(eq(leadQualificationsTable.id, qualId));

  // Update lead stage
  await db
    .update(leadsTable)
    .set({ stage: qual.stage, status: "qualified", updatedAt: new Date() })
    .where(eq(leadsTable.id, qual.leadId));

  res.json({ opportunityId: opportunity.id });
});

// ── POST /api/leads/qualification/:id/reject ──────────────────────────────────
router.post("/leads/qualification/:id/reject", requireAdmin, async (req: Request, res: Response) => {
  const qualId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(qualId)) { res.status(400).json({ error: "Invalid qualification ID" }); return; }

  const [qual] = await db.select().from(leadQualificationsTable).where(eq(leadQualificationsTable.id, qualId)).limit(1);
  if (!qual) { res.status(404).json({ error: "Qualification not found" }); return; }

  await db
    .update(leadQualificationsTable)
    .set({ status: "rejected" })
    .where(eq(leadQualificationsTable.id, qualId));

  // Reset lead stage to Lead, status back to contacted (nurture)
  await db
    .update(leadsTable)
    .set({ stage: "Lead", status: "contacted", updatedAt: new Date() })
    .where(eq(leadsTable.id, qual.leadId));

  res.json({ ok: true });
});

// ── POST /api/leads/qualification/:id/snooze ──────────────────────────────────
router.post("/leads/qualification/:id/snooze", requireAdmin, async (req: Request, res: Response) => {
  const qualId = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(qualId)) { res.status(400).json({ error: "Invalid qualification ID" }); return; }

  const [qual] = await db.select().from(leadQualificationsTable).where(eq(leadQualificationsTable.id, qualId)).limit(1);
  if (!qual) { res.status(404).json({ error: "Qualification not found" }); return; }

  const snoozedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);

  // Keep status = "pending" so the GET /pending query (which filters on snoozedUntil)
  // will naturally resurface this record after 24 h without any extra job.
  await db
    .update(leadQualificationsTable)
    .set({ snoozedUntil })
    .where(eq(leadQualificationsTable.id, qualId));

  res.json({ ok: true, snoozedUntil });
});

// ── GET /api/opportunities ────────────────────────────────────────────────────
router.get("/opportunities", requireAdmin, async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10)));
  const offset = (page - 1) * limit;

  const [totalRow] = await db.select({ count: count() }).from(opportunitiesTable);
  const opportunities = await db
    .select()
    .from(opportunitiesTable)
    .orderBy(desc(opportunitiesTable.createdAt))
    .limit(limit)
    .offset(offset);

  // Enrich with lead data + task count
  const enriched = await Promise.all(
    opportunities.map(async (op) => {
      const [lead] = await db
        .select({ id: leadsTable.id, name: leadsTable.name, email: leadsTable.email, company: leadsTable.company })
        .from(leadsTable)
        .where(eq(leadsTable.id, op.leadId))
        .limit(1);

      const [taskCountRow] = await db
        .select({ count: count() })
        .from(opportunityTasksTable)
        .where(eq(opportunityTasksTable.opportunityId, op.id));

      return { ...op, lead: lead ?? null, taskCount: taskCountRow?.count ?? 0 };
    }),
  );

  res.json({ opportunities: enriched, total: totalRow?.count ?? 0, page, limit });
});

// ── GET /api/opportunities/:id ────────────────────────────────────────────────
router.get("/opportunities/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid opportunity ID" }); return; }

  const [op] = await db.select().from(opportunitiesTable).where(eq(opportunitiesTable.id, id)).limit(1);
  if (!op) { res.status(404).json({ error: "Opportunity not found" }); return; }

  const [lead] = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.id, op.leadId))
    .limit(1);

  const tasks = await db
    .select()
    .from(opportunityTasksTable)
    .where(eq(opportunityTasksTable.opportunityId, id))
    .orderBy(opportunityTasksTable.createdAt);

  res.json({ ...op, lead: lead ?? null, tasks });
});

// ── PATCH /api/opportunities/:id/tasks/:taskId ────────────────────────────────
router.patch("/opportunities/:id/tasks/:taskId", requireAdmin, async (req: Request, res: Response) => {
  const opportunityId = parseInt(String(req.params.id ?? ""), 10);
  const taskId = parseInt(String(req.params.taskId ?? ""), 10);
  if (isNaN(opportunityId) || isNaN(taskId)) {
    res.status(400).json({ error: "Invalid opportunity or task ID" });
    return;
  }

  const { status } = req.body as { status?: string };
  const validStatuses = ["todo", "in_progress", "done"];
  if (!status || !validStatuses.includes(status)) {
    res.status(400).json({ error: "Invalid status" });
    return;
  }

  const [updated] = await db
    .update(opportunityTasksTable)
    .set({ status: status as "todo" | "in_progress" | "done" })
    .where(
      and(
        eq(opportunityTasksTable.id, taskId),
        eq(opportunityTasksTable.opportunityId, opportunityId),
      ),
    )
    .returning();

  if (!updated) { res.status(404).json({ error: "Task not found" }); return; }
  res.json(updated);
});

// ── Helper ────────────────────────────────────────────────────────────────────

async function findOrCreateOpportunitiesProject() {
  const existing = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.title, "Lead Opportunities"))
    .limit(1);

  if (existing[0]) return existing[0];

  const [created] = await db.insert(projectsTable).values({
    title: "Lead Opportunities",
    description: "Auto-created project for qualified lead opportunity tasks.",
    status: "active",
    projectType: "project",
    phase: "Sales",
  }).returning();

  return created ?? null;
}

export default router;
