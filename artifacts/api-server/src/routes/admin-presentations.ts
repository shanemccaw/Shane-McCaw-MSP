import { Router, type IRouter, type Request, type Response } from "express";
import { db, quickWinPresentationsTable, presentationDocViewsTable, projectsTable, insightsGeneratedDocumentsTable, workflowStepsTable, usersTable } from "@workspace/db";
import { eq, and, desc, asc, count, inArray, isNotNull } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { getPortalBaseUrl } from "../lib/portal-url.ts";
import { type SowPricingLine } from "../lib/sow-pricing.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ channel: "admin.presentations" });

const router: IRouter = Router();

function guardAgainstSignedPresentation(
  pres: { id: number; status: string },
  context: string,
  log: { warn: (obj: object, msg: string) => void },
): boolean {
  if (pres.status !== "signed") return false;
  log.warn(
    { presentationId: pres.id, context },
    `${context}: presentation is already signed — write blocked to protect terminal state`,
  );
  return true;
}

router.get("/admin/engagements/:id/presentation-analytics", requireAdmin, async (req: Request, res: Response) => {
  try {
    const projectId = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }

    const [pres] = await db.select({
      id: quickWinPresentationsTable.id,
      status: quickWinPresentationsTable.status,
      createdAt: quickWinPresentationsTable.createdAt,
    })
      .from(quickWinPresentationsTable)
      .where(eq(quickWinPresentationsTable.projectId, projectId))
      .orderBy(desc(quickWinPresentationsTable.createdAt))
      .limit(1);

    if (!pres) {
      res.json({ presentationId: null, views: [], rawViews: [], firstCardClick: null });
      return;
    }

    const rawViews = await db.select({
      id: presentationDocViewsTable.id,
      documentId: presentationDocViewsTable.documentId,
      documentTitle: presentationDocViewsTable.documentTitle,
      viewedAt: presentationDocViewsTable.viewedAt,
      dwellSeconds: presentationDocViewsTable.dwellSeconds,
      eventType: presentationDocViewsTable.eventType,
      cardName: presentationDocViewsTable.cardName,
    })
      .from(presentationDocViewsTable)
      .where(eq(presentationDocViewsTable.presentationId, pres.id))
      .orderBy(asc(presentationDocViewsTable.viewedAt));

    // Aggregate dwell time per document (dwell events only)
    const byDoc = new Map<string, { documentId: number | null; documentTitle: string; totalSeconds: number; visits: number }>();
    for (const v of rawViews) {
      if ((v.eventType ?? "dwell") !== "dwell") continue;
      const key = v.documentTitle ?? `doc-${v.documentId ?? "unknown"}`;
      const existing = byDoc.get(key);
      if (existing) {
        existing.totalSeconds += v.dwellSeconds ?? 0;
        existing.visits += 1;
      } else {
        byDoc.set(key, {
          documentId: v.documentId,
          documentTitle: v.documentTitle ?? key,
          totalSeconds: v.dwellSeconds ?? 0,
          visits: 1,
        });
      }
    }

    // First card click: earliest card_click event
    // totalClicks = distinct card names (deduplicates legacy re-click events already in the DB)
    const cardClicks = rawViews.filter(v => v.eventType === "card_click" && v.cardName);
    const distinctCardNames = new Set(cardClicks.map(v => v.cardName!));
    const firstCardClick = cardClicks.length > 0
      ? { cardName: cardClicks[0].cardName!, clickedAt: cardClicks[0].viewedAt, totalClicks: distinctCardNames.size }
      : null;

    res.json({
      presentationId: pres.id,
      presentationStatus: pres.status,
      presentationCreatedAt: pres.createdAt,
      views: Array.from(byDoc.values()).sort((a, b) => b.totalSeconds - a.totalSeconds),
      rawViews,
      firstCardClick,
    });
  } catch (err) {
    log.error({ err }, "portal: failed to fetch presentation analytics");
    res.status(500).json({ error: "Failed to fetch presentation analytics" });
  }
});

router.post("/admin/engagements/:id/send-presentation", requireAdmin, async (req: Request, res: Response) => {
  try {
    const projectId = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(projectId)) { res.status(400).json({ error: "Invalid project ID" }); return; }

    const [project] = await db.select({
      id: projectsTable.id,
      title: projectsTable.title,
      clientUserId: projectsTable.clientUserId,
    }).from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1);

    if (!project) { res.status(404).json({ error: "Project not found" }); return; }
    if (!project.clientUserId) { res.status(400).json({ error: "Project has no linked client" }); return; }

    // Find or create a presentation for this project
    let [pres] = await db.select({ id: quickWinPresentationsTable.id, shareToken: quickWinPresentationsTable.shareToken })
      .from(quickWinPresentationsTable)
      .where(eq(quickWinPresentationsTable.projectId, projectId))
      .orderBy(desc(quickWinPresentationsTable.createdAt))
      .limit(1);

    const { randomUUID } = await import("crypto");

    if (!pres) {
      // Auto-create a presentation
      const docs = await db.select({ id: insightsGeneratedDocumentsTable.id })
        .from(insightsGeneratedDocumentsTable)
        .where(and(
          eq(insightsGeneratedDocumentsTable.projectId, projectId),
          eq(insightsGeneratedDocumentsTable.status, "delivered"),
        ));

      const steps = await db.select({ id: workflowStepsTable.id, title: workflowStepsTable.title, description: workflowStepsTable.description })
        .from(workflowStepsTable)
        .where(eq(workflowStepsTable.projectId, projectId))
        .orderBy(asc(workflowStepsTable.order));

      // Look for SOW pricing lines stored when a SOW was generated for this project.
      // Only use a project-scoped SOW — a customer-scoped fallback could pull pricing
      // from a different engagement for the same client and produce incorrect line items.
      const [activeSowDoc] = await db.select({
        sowTotalPrice:   insightsGeneratedDocumentsTable.sowTotalPrice,
        sowPricingLines: insightsGeneratedDocumentsTable.sowPricingLines,
      })
        .from(insightsGeneratedDocumentsTable)
        .where(and(
          eq(insightsGeneratedDocumentsTable.projectId, projectId),
          inArray(insightsGeneratedDocumentsTable.docType, ["consolidated_sow", "sow"]),
          isNotNull(insightsGeneratedDocumentsTable.sowTotalPrice),
        ))
        .orderBy(desc(insightsGeneratedDocumentsTable.createdAt))
        .limit(1);

      // Price: SOW total > fallback $5k
      const baseTotal = activeSowDoc?.sowTotalPrice
        ? parseFloat(String(activeSowDoc.sowTotalPrice))
        : 5000;

      // Build phases: SOW pricing lines > workflow steps evenly split > single default phase
      type StoredLine = { title: string; scope: string; priceUsd: number; notes: string };
      const storedLines = (activeSowDoc?.sowPricingLines ?? []) as StoredLine[];

      let sowPhases: Array<{ id: string; title: string; description: string; price: number; selected: boolean }>;

      if (storedLines.length > 0) {
        sowPhases = storedLines.map((l, i) => ({
          id: `sow-${i}`,
          title: l.title,
          description: l.scope || l.notes || "",
          price: l.priceUsd,
          selected: true,
        }));
      } else if (steps.length > 0) {
        const pricePerPhase = Math.round(baseTotal / steps.length);
        sowPhases = steps.map(s => ({ id: String(s.id), title: s.title, description: s.description ?? "", price: pricePerPhase, selected: true }));
      } else {
        sowPhases = [{ id: "default", title: "Full Engagement", description: "Complete Microsoft 365 consulting engagement", price: baseTotal, selected: true }];
      }

      const shareToken = randomUUID();
      const [inserted] = await db.insert(quickWinPresentationsTable).values({
        projectId,
        clientUserId: project.clientUserId,
        shareToken,
        documentsIncluded: docs.map(d => d.id),
        sowPhases,
        selectedPhaseIds: sowPhases.map(p => p.id),
        totalPrice: String(storedLines.length > 0 ? sowPhases.reduce((s, p) => s + p.price, 0) : baseTotal),
        status: "draft",
      }).returning({ id: quickWinPresentationsTable.id, shareToken: quickWinPresentationsTable.shareToken });
      pres = inserted;
    } else if (!pres.shareToken) {
      const shareToken = randomUUID();
      await db.update(quickWinPresentationsTable)
        .set({ shareToken, updatedAt: new Date() })
        .where(eq(quickWinPresentationsTable.id, pres.id));
      pres = { id: pres.id, shareToken };
    }

    const baseUrl = getPortalBaseUrl(); // already ends in /crm
    const shareUrl = `${baseUrl}/portal/presentation/${pres.id}?token=${pres.shareToken}`;

    res.json({ presentationId: pres.id, shareUrl });
  } catch (err) {
    log.error({ err }, "portal: failed to generate presentation share URL");
    res.status(500).json({ error: "Failed to generate shareable link" });
  }
});

router.get("/admin/presentations", requireAdmin, async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10)));
    const offset = (page - 1) * limit;

    const rows = await db
      .select({
        id: quickWinPresentationsTable.id,
        shareToken: quickWinPresentationsTable.shareToken,
        status: quickWinPresentationsTable.status,
        totalPrice: quickWinPresentationsTable.totalPrice,
        paymentPlan: quickWinPresentationsTable.paymentPlan,
        paymentSchedule: quickWinPresentationsTable.paymentSchedule,
        sowPhases: quickWinPresentationsTable.sowPhases,
        selectedPhaseIds: quickWinPresentationsTable.selectedPhaseIds,
        documentsIncluded: quickWinPresentationsTable.documentsIncluded,
        signedAt: quickWinPresentationsTable.signedAt,
        signerName: quickWinPresentationsTable.signerName,
        stripeSessionId: quickWinPresentationsTable.stripeSessionId,
        createdAt: quickWinPresentationsTable.createdAt,
        updatedAt: quickWinPresentationsTable.updatedAt,
        projectId: quickWinPresentationsTable.projectId,
        projectName: projectsTable.title,
        clientUserId: quickWinPresentationsTable.clientUserId,
        clientName: usersTable.name,
        clientEmail: usersTable.email,
        clientCompany: usersTable.company,
      })
      .from(quickWinPresentationsTable)
      .leftJoin(projectsTable, eq(quickWinPresentationsTable.projectId, projectsTable.id))
      .leftJoin(usersTable, eq(quickWinPresentationsTable.clientUserId, usersTable.id))
      .orderBy(desc(quickWinPresentationsTable.createdAt))
      .limit(limit)
      .offset(offset);

    const [{ total }] = await db
      .select({ total: count() })
      .from(quickWinPresentationsTable);

    res.json({
      presentations: rows.map(r => ({
        ...r,
        totalPrice: r.totalPrice ? Number(r.totalPrice) : null,
        signedAt: r.signedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
      total,
      page,
      limit,
    });
  } catch (err) {
    log.error({ err }, "portal: failed to fetch admin presentations list");
    res.status(500).json({ error: "Failed to load presentations" });
  }
});

router.patch("/admin/presentations/:id/phase-dates", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseInt(String(req.params.id ?? ""), 10);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const { phases } = req.body as { phases?: unknown };
    if (!Array.isArray(phases)) { res.status(400).json({ error: "phases must be an array" }); return; }

    // Validate and build id→date map
    const dateMap = new Map<string, string | null>();
    for (const entry of phases) {
      const e = entry as Record<string, unknown>;
      if (typeof e.id !== "string") continue;
      const d = e.deliveryDate;
      // Accept YYYY-MM-DD strings or null/undefined (clear)
      const validated = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
      dateMap.set(e.id, validated);
    }

    const [pres] = await db.select().from(quickWinPresentationsTable)
      .where(eq(quickWinPresentationsTable.id, id)).limit(1);
    if (!pres) { res.status(404).json({ error: "Presentation not found" }); return; }

    if (guardAgainstSignedPresentation(pres, "PATCH /admin/presentations/:id/phase-dates", logger)) {
      res.status(409).json({ error: "Presentation is already signed and cannot be modified" }); return;
    }

    // ── 1. Update sowPricingLines on every linked consolidated/consulting SOW doc ──
    const docIds = (pres.documentsIncluded ?? []) as number[];
    if (docIds.length > 0) {
      const docs = await db.select({
        id: insightsGeneratedDocumentsTable.id,
        sowPricingLines: insightsGeneratedDocumentsTable.sowPricingLines,
      })
        .from(insightsGeneratedDocumentsTable)
        .where(and(
          inArray(insightsGeneratedDocumentsTable.id, docIds),
          inArray(insightsGeneratedDocumentsTable.docType, ["consolidated_sow", "sow"]),
        ));

      for (const doc of docs) {
        if (!Array.isArray(doc.sowPricingLines) || doc.sowPricingLines.length === 0) continue;

        let workstreamIdx = 0;
        const updatedLines = (doc.sowPricingLines as SowPricingLine[]).map(line => {
          if (line.line_type === "adjustment") return line;
          const phaseId = `sow-${workstreamIdx}`;
          workstreamIdx++;
          if (!dateMap.has(phaseId)) return line;
          const newDate = dateMap.get(phaseId);
          if (newDate === null) {
            const { deliveryDate: _removed, ...rest } = line;
            return rest as SowPricingLine;
          }
          return { ...line, deliveryDate: newDate } as SowPricingLine;
        });

        await db.update(insightsGeneratedDocumentsTable)
          .set({ sowPricingLines: updatedLines, updatedAt: new Date() })
          .where(eq(insightsGeneratedDocumentsTable.id, doc.id));
      }
    }

    // ── 2. Mirror dates into the sowPhases snapshot so the admin panel can display them ──
    type SnapPhase = { id: string; title: string; description: string; price: number; selected: boolean; deliveryDate?: string | null };
    const snap = (pres.sowPhases ?? []) as SnapPhase[];
    if (snap.length > 0) {
      const updatedSnap = snap.map(phase => {
        if (!dateMap.has(phase.id)) return phase;
        const newDate = dateMap.get(phase.id);
        return { ...phase, deliveryDate: newDate ?? null };
      });
      await db.update(quickWinPresentationsTable)
        .set({ sowPhases: updatedSnap, updatedAt: new Date() })
        .where(eq(quickWinPresentationsTable.id, id));
    }

    req.log.info({ presentationId: id, phasesUpdated: dateMap.size }, "admin: updated SOW phase delivery dates");
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "admin: failed to update SOW phase delivery dates");
    res.status(500).json({ error: "Failed to update delivery dates" });
  }
});

export default router;
