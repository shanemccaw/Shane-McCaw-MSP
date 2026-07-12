import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  servicesTable,
  workflowTemplateStepsTable,
} from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";

const router: IRouter = Router();

router.get("/services", async (req: Request, res: Response) => {
  try {
    const { type, category } = req.query as { type?: string; category?: string };
    const conditions = [eq(servicesTable.visibility, "public")];
    if (type) {
      conditions.push(eq(servicesTable.serviceType, type));
    }
    if (category) {
      conditions.push(eq(servicesTable.category, category));
    }
    const services = await db
      .select()
      .from(servicesTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(servicesTable.sortOrder), asc(servicesTable.createdAt));

    // Collect unique workflow template IDs that have linked services
    const templateIds = services
      .map((s) => s.workflowTemplateId)
      .filter((id): id is number => id != null);

    // workflowTasks: top-level steps (phases) per template, ordered by step order
    const workflowTasksByTemplateId = new Map<
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
        const list = workflowTasksByTemplateId.get(step.workflowTemplateId) ?? [];
        list.push({ title: step.title, description: step.description, order: step.order });
        workflowTasksByTemplateId.set(step.workflowTemplateId, list);
      }
    }

    res.json(
      services.map((s) => {
        const wfSteps = s.workflowTemplateId
          ? (workflowTasksByTemplateId.get(s.workflowTemplateId) ?? [])
          : [];
        return {
          ...s,
          hasPdf: s.overviewPdfKey != null,
          workflowTasks: wfSteps,
          workflowSummary: wfSteps.map(({ title, description }) => ({ title, description })),
        };
      })
    );
  } catch {
    res.status(500).json({ error: "Failed to fetch services" });
  }
});

router.get("/public/consent-url", (req: Request, res: Response) => {
  const clientId = process.env.MT_APP_CLIENT_ID;
  if (!clientId) {
    res.json({ url: null });
    return;
  }
  // Derive the real callback URL from the incoming request headers — same
  // host-derivation approach used in consent.ts getCallbackUrl().
  // (getCallbackUrl is not exported from consent.ts, so the two-line logic
  // is inlined here rather than duplicated into a shared helper.)
  const proto = req.headers["x-forwarded-proto"] ?? req.protocol;
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const redirectUri = `${proto}://${host}/api/consent/callback`;
  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri });
  const url = `https://login.microsoftonline.com/common/adminconsent?${params.toString()}`;
  res.json({ url });
});

export default router;
