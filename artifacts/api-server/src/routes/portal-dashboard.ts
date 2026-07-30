import { Router, type IRouter, type Request, type Response } from "express";
import { db, projectsTable, clientServicesTable, servicesTable, kanbanTasksTable, invoicesTable, reportsTable, notificationsTable, messagesTable, tenantsTable } from "@workspace/db";
import { eq, and, desc, asc, count, inArray, or } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "tenant.portal" });

const router: IRouter = Router();

router.get("/portal/dashboard", requireAuth, async (req: Request, res: Response) => {
  const userId = req.user!.id;

  const projects = await db.select().from(projectsTable)
    .where(and(eq(projectsTable.clientUserId, userId), eq(projectsTable.status, "active")))
    .orderBy(desc(projectsTable.updatedAt)).limit(5);

  // Enrich projects with currentTask (first in-progress kanban task + step position)
  type EnrichedProject = typeof projects[0] & {
    currentTask: { stepNumber: number; totalSteps: number; title: string } | null;
  };
  let enrichedProjects: EnrichedProject[];

  if (projects.length > 0) {
    const projectIds = projects.map(p => p.id);
    const allTasks = await db.select({
      id: kanbanTasksTable.id,
      title: kanbanTasksTable.title,
      order: kanbanTasksTable.order,
      column: kanbanTasksTable.column,
      projectId: kanbanTasksTable.projectId,
    }).from(kanbanTasksTable)
      .where(inArray(kanbanTasksTable.projectId, projectIds))
      .orderBy(asc(kanbanTasksTable.order));

    const tasksByProject = new Map<number, typeof allTasks>();
    for (const task of allTasks) {
      if (!task.projectId) continue;
      const arr = tasksByProject.get(task.projectId) ?? [];
      arr.push(task);
      tasksByProject.set(task.projectId, arr);
    }

    enrichedProjects = projects.map(p => {
      const tasks = tasksByProject.get(p.id) ?? [];
      const inProgressTask = tasks.find(t => t.column === "in_progress");
      if (!inProgressTask) return { ...p, currentTask: null };
      const stepNumber = tasks.indexOf(inProgressTask) + 1;
      return {
        ...p,
        currentTask: { stepNumber, totalSteps: tasks.length, title: inProgressTask.title },
      };
    });
  } else {
    enrichedProjects = [];
  }

  const clientServices = await db.select({
    cs: clientServicesTable,
    service: {
      name: servicesTable.name,
      billingType: servicesTable.billingType,
      price: servicesTable.price,
    },
  }).from(clientServicesTable)
    .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id))
    .where(and(eq(clientServicesTable.clientUserId, userId), or(eq(clientServicesTable.status, "active"), eq(clientServicesTable.status, "paused"))))
    .orderBy(desc(clientServicesTable.purchasedAt)).limit(6);

  const invoices = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.clientUserId, userId))
    .orderBy(desc(invoicesTable.createdAt)).limit(5);

  const reports = await db.select().from(reportsTable)
    .where(eq(reportsTable.clientUserId, userId))
    .orderBy(desc(reportsTable.createdAt)).limit(3);

  const [{ unread }] = await db.select({ unread: count() }).from(notificationsTable)
    .where(and(eq(notificationsTable.userId, userId), eq(notificationsTable.read, false)));

  const [{ unreadMessages }] = await db.select({ unreadMessages: count() }).from(messagesTable)
    .where(and(eq(messagesTable.clientUserId, userId), eq(messagesTable.readByClient, false)));

  // customerStatus/mspId power the account-inactive banner (app-shell.tsx) and
  // the re-activation promo (customer-dashboard). Resolved from the JWT's
  // customerId claim, same as portal-mission-control.ts's resolveCustomerId —
  // req.user.mspId is already on the token, no join needed for it.
  const customerId = req.user!.customerId;
  let customerStatus: string | null = null;
  if (customerId != null) {
    const [customer] = await db.select({ status: tenantsTable.status })
      .from(tenantsTable).where(eq(tenantsTable.id, customerId)).limit(1);
    customerStatus = customer?.status ?? null;
  }

  res.json({
    projects: enrichedProjects, clientServices, invoices, reports,
    unreadNotifications: unread, unreadMessages,
    customerStatus, mspId: req.user!.mspId ?? null,
  });
});

export default router;
