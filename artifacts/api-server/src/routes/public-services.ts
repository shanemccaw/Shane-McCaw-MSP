import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  servicesTable,
  workflowTemplateStepsTable,
  workflowTemplateStepTasksTable,
} from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";

const router: IRouter = Router();

router.get("/services", async (req: Request, res: Response) => {
  try {
    const { type } = req.query as { type?: string };
    const conditions = [eq(servicesTable.isPublic, true)];
    if (type) {
      conditions.push(eq(servicesTable.serviceType, type));
    }
    const services = await db
      .select()
      .from(servicesTable)
      .where(and(...conditions))
      .orderBy(asc(servicesTable.sortOrder), asc(servicesTable.createdAt));

    // Collect unique workflow template IDs that have linked services
    const templateIds = services
      .map((s) => s.workflowTemplateId)
      .filter((id): id is number => id != null);

    // workflowTasks: flat ordered list of step-level tasks per template
    const workflowTasksByTemplateId = new Map<
      number,
      Array<{ title: string; description: string | null; order: number }>
    >();

    if (templateIds.length > 0) {
      // Fetch steps to get step.id → (templateId, stepOrder) mapping
      const steps = await db
        .select({
          id: workflowTemplateStepsTable.id,
          workflowTemplateId: workflowTemplateStepsTable.workflowTemplateId,
          stepOrder: workflowTemplateStepsTable.order,
        })
        .from(workflowTemplateStepsTable)
        .where(inArray(workflowTemplateStepsTable.workflowTemplateId, templateIds));

      if (steps.length > 0) {
        const stepMeta = new Map<number, { templateId: number; stepOrder: number }>();
        for (const s of steps) {
          stepMeta.set(s.id, { templateId: s.workflowTemplateId, stepOrder: s.stepOrder });
        }

        const stepIds = steps.map((s) => s.id);

        // Fetch all tasks for those steps
        const tasks = await db
          .select({
            workflowTemplateStepId: workflowTemplateStepTasksTable.workflowTemplateStepId,
            title: workflowTemplateStepTasksTable.title,
            description: workflowTemplateStepTasksTable.description,
            taskOrder: workflowTemplateStepTasksTable.order,
          })
          .from(workflowTemplateStepTasksTable)
          .where(inArray(workflowTemplateStepTasksTable.workflowTemplateStepId, stepIds))
          .orderBy(asc(workflowTemplateStepTasksTable.order));

        // Group tasks by template ID with combined sort key
        type SortedTask = {
          title: string;
          description: string | null;
          stepOrder: number;
          taskOrder: number;
        };
        const grouped = new Map<number, SortedTask[]>();

        for (const task of tasks) {
          const meta = stepMeta.get(task.workflowTemplateStepId);
          if (!meta) continue;
          const list = grouped.get(meta.templateId) ?? [];
          list.push({
            title: task.title,
            description: task.description,
            stepOrder: meta.stepOrder,
            taskOrder: task.taskOrder,
          });
          grouped.set(meta.templateId, list);
        }

        // Sort each group by (stepOrder, taskOrder), then convert to final shape
        for (const [templateId, items] of grouped) {
          items.sort((a, b) =>
            a.stepOrder !== b.stepOrder
              ? a.stepOrder - b.stepOrder
              : a.taskOrder - b.taskOrder
          );
          workflowTasksByTemplateId.set(
            templateId,
            items.map(({ title, description }, idx) => ({ title, description, order: idx }))
          );
        }
      }
    }

    res.json(
      services.map((s) => ({
        ...s,
        hasPdf: s.overviewPdfKey != null,
        workflowTasks: s.workflowTemplateId
          ? (workflowTasksByTemplateId.get(s.workflowTemplateId) ?? [])
          : [],
      }))
    );
  } catch {
    res.status(500).json({ error: "Failed to fetch services" });
  }
});

export default router;
