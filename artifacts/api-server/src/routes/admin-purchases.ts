import { Router, type IRouter, type Request, type Response } from "express";
import { db, invoicesTable, usersTable, projectsTable, contractsTable, servicesTable, kanbanTasksTable, documentsTable, workflowStepsTable, statusReportsTable, projectUpdatesTable, reportsTable, clientServicesTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
const log = logger.child({ channel: "admin.purchases" });

const router: IRouter = Router();

router.get("/admin/purchases", requireAdmin, async (_req: Request, res: Response) => {
  const purchases = await db
    .select({
      id: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
      description: invoicesTable.description,
      amount: invoicesTable.amount,
      currency: invoicesTable.currency,
      status: invoicesTable.status,
      paidAt: invoicesTable.paidAt,
      stripeSessionId: invoicesTable.stripeSessionId,
      createdAt: invoicesTable.createdAt,
      clientEmail: usersTable.email,
      clientName: usersTable.name,
      clientCompany: usersTable.company,
    })
    .from(invoicesTable)
    .leftJoin(usersTable, eq(invoicesTable.clientUserId, usersTable.id))
    .where(sql`${invoicesTable.invoiceNumber} like 'ONB-%' OR ${invoicesTable.invoiceNumber} like 'SVC-%'`)
    .orderBy(desc(invoicesTable.createdAt));
  res.json(purchases);
});

// ─── ADMIN: Purchase detail ────────────────────────────────────────────────
router.get("/admin/purchases/:id", requireAdmin, async (req: Request, res: Response) => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // Fetch the base invoice row first (no contract join yet)
  const invoiceRows = await db
    .select({
      id: invoicesTable.id,
      invoiceNumber: invoicesTable.invoiceNumber,
      description: invoicesTable.description,
      amount: invoicesTable.amount,
      currency: invoicesTable.currency,
      status: invoicesTable.status,
      paidAt: invoicesTable.paidAt,
      stripeSessionId: invoicesTable.stripeSessionId,
      couponCode: invoicesTable.couponCode,
      discountAmount: invoicesTable.discountAmount,
      createdAt: invoicesTable.createdAt,
      clientId: usersTable.id,
      clientName: usersTable.name,
      clientEmail: usersTable.email,
      clientCompany: usersTable.company,
      projectId: projectsTable.id,
      projectName: projectsTable.title,
    })
    .from(invoicesTable)
    .leftJoin(usersTable, eq(invoicesTable.clientUserId, usersTable.id))
    .leftJoin(projectsTable, eq(invoicesTable.projectId, projectsTable.id))
    .where(eq(invoicesTable.id, id))
    .limit(1);

  if (invoiceRows.length === 0) { res.status(404).json({ error: "Not found" }); return; }
  const inv = invoiceRows[0];


  // Fetch ALL contracts linked to this purchase (multi-service cart support).
  // Strategy: prefer stripeSessionId match (set on all contracts during fulfillment).
  // Fallback to projectId match for non-first invoices whose stripeSessionId is null.
  type ContractRow = {
    contractId: number;
    serviceName: string | null;
    wizardSelections: unknown;
    orderWorkflow: unknown;
  };
  let contracts: ContractRow[] = [];
  if (inv.stripeSessionId) {
    contracts = await db
      .select({
        contractId: contractsTable.id,
        serviceName: servicesTable.name,
        wizardSelections: contractsTable.wizardSelections,
        orderWorkflow: servicesTable.orderWorkflow,
      })
      .from(contractsTable)
      .leftJoin(servicesTable, eq(contractsTable.serviceId, servicesTable.id))
      .where(eq(contractsTable.stripeSessionId, inv.stripeSessionId));
  } else if (inv.projectId) {
    // Non-first invoice in a multi-service cart — contracts were updated with
    // projectId at fulfillment time even though the invoice has no sessionId.
    contracts = await db
      .select({
        contractId: contractsTable.id,
        serviceName: servicesTable.name,
        wizardSelections: contractsTable.wizardSelections,
        orderWorkflow: servicesTable.orderWorkflow,
      })
      .from(contractsTable)
      .leftJoin(servicesTable, eq(contractsTable.serviceId, servicesTable.id))
      .where(
        and(
          eq(contractsTable.projectId, inv.projectId),
          eq(contractsTable.userId, inv.clientId ?? -1)
        )
      );
  }

  res.json({
    id: inv.id,
    invoiceNumber: inv.invoiceNumber,
    description: inv.description,
    amount: inv.amount,
    currency: inv.currency,
    status: inv.status,
    paidAt: inv.paidAt,
    stripeSessionId: inv.stripeSessionId,
    couponCode: inv.couponCode ?? null,
    discountAmount: inv.discountAmount ?? null,
    createdAt: inv.createdAt,
    client: {
      id: inv.clientId,
      name: inv.clientName,
      email: inv.clientEmail,
      company: inv.clientCompany,
    },
    project: inv.projectId ? { id: inv.projectId, name: inv.projectName } : null,
    contracts: contracts.map(c => ({
      contractId: c.contractId,
      serviceName: c.serviceName,
      wizardSelections: c.wizardSelections ?? null,
      orderWorkflow: c.orderWorkflow ?? null,
    })),
  });
});

// ─── ADMIN: Delete purchase ────────────────────────────────────────────────
router.delete("/admin/purchases/:id", requireAdmin, async (req: Request, res: Response) => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const force = req.query.force === "true";

  const [inv] = await db
    .select({ id: invoicesTable.id, stripeSessionId: invoicesTable.stripeSessionId, projectId: invoicesTable.projectId })
    .from(invoicesTable)
    .where(eq(invoicesTable.id, id))
    .limit(1);

  if (!inv) { res.status(404).json({ error: "Purchase not found" }); return; }

  // ── Blocker check ──────────────────────────────────────────────────────────
  if (inv.projectId && !force) {
    const [project] = await db
      .select({ id: projectsTable.id, title: projectsTable.title, status: projectsTable.status })
      .from(projectsTable)
      .where(eq(projectsTable.id, inv.projectId))
      .limit(1);

    if (project) {
      const [{ taskCount }] = await db
        .select({ taskCount: sql<number>`cast(count(*) as int)` })
        .from(kanbanTasksTable)
        .where(eq(kanbanTasksTable.projectId, inv.projectId));

      const [{ docCount }] = await db
        .select({ docCount: sql<number>`cast(count(*) as int)` })
        .from(documentsTable)
        .where(eq(documentsTable.projectId, inv.projectId));

      const [{ stepCount }] = await db
        .select({ stepCount: sql<number>`cast(count(*) as int)` })
        .from(workflowStepsTable)
        .where(eq(workflowStepsTable.projectId, inv.projectId));

      const [{ reportCount }] = await db
        .select({ reportCount: sql<number>`cast(count(*) as int)` })
        .from(statusReportsTable)
        .where(eq(statusReportsTable.projectId, inv.projectId));

      const hasBlockers = (taskCount > 0) || (docCount > 0) || (stepCount > 0) || (reportCount > 0) || project.status === "active";

      if (hasBlockers) {
        res.status(409).json({
          error: "blocked",
          blockers: {
            project: { id: project.id, title: project.title, status: project.status },
            kanbanTasks: taskCount,
            documents: docCount,
            workflowSteps: stepCount,
            statusReports: reportCount,
          },
        });
        return;
      }
    }
  }

  // ── Cascade delete (force path cleans up the project first) ────────────────
  await db.transaction(async (tx) => {
    if (inv.projectId && force) {
      const [project] = await tx
        .select({ id: projectsTable.id })
        .from(projectsTable)
        .where(eq(projectsTable.id, inv.projectId))
        .limit(1);

      if (project) {
        await tx.delete(kanbanTasksTable).where(eq(kanbanTasksTable.projectId, inv.projectId));
        await tx.delete(workflowStepsTable).where(eq(workflowStepsTable.projectId, inv.projectId));
        await tx.delete(documentsTable).where(eq(documentsTable.projectId, inv.projectId));
        await tx.delete(projectUpdatesTable).where(eq(projectUpdatesTable.projectId, inv.projectId));
        await tx.update(reportsTable).set({ projectId: null }).where(eq(reportsTable.projectId, inv.projectId));
        await tx.update(statusReportsTable).set({ projectId: null }).where(eq(statusReportsTable.projectId, inv.projectId));
        // Nullify projectId on this invoice so FK allows project deletion
        await tx.update(invoicesTable).set({ projectId: null }).where(eq(invoicesTable.projectId, inv.projectId));
        await tx.delete(projectsTable).where(eq(projectsTable.id, inv.projectId));
      }
    }

    // Delete linked contracts (matched by stripeSessionId or projectId)
    if (inv.stripeSessionId) {
      await tx.delete(contractsTable).where(eq(contractsTable.stripeSessionId, inv.stripeSessionId));
    }
    if (inv.projectId) {
      await tx.delete(contractsTable).where(eq(contractsTable.projectId, inv.projectId));
      await tx.delete(clientServicesTable).where(eq(clientServicesTable.projectId, inv.projectId));
    }

    await tx.delete(invoicesTable).where(eq(invoicesTable.id, id));
  });

  res.status(204).end();
});

export default router;
