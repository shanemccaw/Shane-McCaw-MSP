import { Router, type IRouter, type Request, type Response } from "express";
import { db, servicesTable, workflowTemplateStepsTable } from "@workspace/db";
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

    const templateIds = services
      .map((s) => s.workflowTemplateId)
      .filter((id): id is number => id != null);

    const stepsByTemplateId = new Map<
      number,
      Array<{ title: string; description: string | null; order: number }>
    >();

    if (templateIds.length > 0) {
      const steps = await db
        .select({
          workflowTemplateId: workflowTemplateStepsTable.workflowTemplateId,
          title: workflowTemplateStepsTable.title,
          description: workflowTemplateStepsTable.description,
          order: workflowTemplateStepsTable.order,
        })
        .from(workflowTemplateStepsTable)
        .where(inArray(workflowTemplateStepsTable.workflowTemplateId, templateIds))
        .orderBy(asc(workflowTemplateStepsTable.order));

      for (const step of steps) {
        const existing = stepsByTemplateId.get(step.workflowTemplateId);
        if (existing) {
          existing.push({ title: step.title, description: step.description, order: step.order });
        } else {
          stepsByTemplateId.set(step.workflowTemplateId, [
            { title: step.title, description: step.description, order: step.order },
          ]);
        }
      }
    }

    res.json(
      services.map((s) => ({
        ...s,
        hasPdf: s.overviewPdfKey != null,
        workflowTasks: s.workflowTemplateId
          ? (stepsByTemplateId.get(s.workflowTemplateId) ?? [])
          : [],
      }))
    );
  } catch {
    res.status(500).json({ error: "Failed to fetch services" });
  }
});

export default router;
