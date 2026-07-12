import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  servicesTable,
  workflowTemplateStepsTable,
  checkoutSessionsTable,
} from "@workspace/db";
import { and, asc, eq, inArray, gte } from "drizzle-orm";
import { z } from "zod";

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

// ── UUID detector (checkout session IDs are v4 UUIDs) ─────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── POST /api/public/checkout-session ─────────────────────────────────────────
// Creates a server-side checkout session; returns only the sessionId.
// The client stores only the UUID so PII survives origin-crossing redirects.

const createSessionSchema = z.object({
  productSlug: z.string().min(1, "productSlug is required"),
  fullName: z.string().min(1, "fullName is required"),
  email: z.string().email("email must be a valid email address"),
  seats: z.number().int().min(1).default(1),
});

router.post("/public/checkout-session", async (req: Request, res: Response) => {
  const parsed = createSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? "Invalid request" });
    return;
  }

  const { productSlug, fullName, email, seats } = parsed.data;
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const [row] = await db
    .insert(checkoutSessionsTable)
    .values({ productSlug, fullName, email, seats, expiresAt })
    .returning({ id: checkoutSessionsTable.id });

  res.json({ sessionId: row.id });
});

// ── GET /api/public/checkout-session/:id ──────────────────────────────────────
// Returns only non-PII fields: productSlug and status.
// The client caches name/email in localStorage alongside the sessionId so
// they survive cross-origin redirects without the server ever exposing PII on
// this public endpoint.
// Returns 404 if not found or expired.

router.get("/public/checkout-session/:id", async (req: Request, res: Response) => {
  const id = req.params["id"] as string;
  if (!UUID_RE.test(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const now = new Date();
  const [row] = await db
    .select({
      productSlug: checkoutSessionsTable.productSlug,
      status: checkoutSessionsTable.status,
      seats: checkoutSessionsTable.seats,
    })
    .from(checkoutSessionsTable)
    .where(and(eq(checkoutSessionsTable.id, id), gte(checkoutSessionsTable.expiresAt, now)))
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }

  res.json(row);
});

// ── GET /api/public/consent-url ───────────────────────────────────────────────
// Returns the Microsoft admin-consent URL.
// Optional ?sessionId=<uuid> — if present and the session resolves, the UUID is
// passed as the OAuth `state` parameter so the callback can reconnect the session.

router.get("/public/consent-url", async (req: Request, res: Response) => {
  const clientId = process.env.MT_APP_CLIENT_ID;
  if (!clientId) {
    res.json({ url: null });
    return;
  }

  const proto = req.headers["x-forwarded-proto"] ?? req.protocol;
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const redirectUri = `${proto}://${host}/api/consent/callback`;

  const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri });

  // Thread the checkout session ID through as OAuth `state` if provided and valid.
  const rawSessionId = req.query.sessionId as string | undefined;
  if (rawSessionId) {
    if (!UUID_RE.test(rawSessionId)) {
      req.log?.warn?.({ sessionId: rawSessionId }, "consent-url: sessionId is not a valid UUID — building URL without state");
    } else {
      const now = new Date();
      const [sessionRow] = await db
        .select({ id: checkoutSessionsTable.id })
        .from(checkoutSessionsTable)
        .where(
          and(
            eq(checkoutSessionsTable.id, rawSessionId),
            gte(checkoutSessionsTable.expiresAt, now),
          ),
        )
        .limit(1);

      if (sessionRow) {
        params.set("state", rawSessionId);
      } else {
        req.log?.warn?.({ sessionId: rawSessionId }, "consent-url: checkout session not found or expired — building URL without state");
      }
    }
  }

  const url = `https://login.microsoftonline.com/common/adminconsent?${params.toString()}`;
  res.json({ url });
});

export default router;
