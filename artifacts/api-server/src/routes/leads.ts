import { Router, type IRouter, type Request, type Response } from "express";
import {
  db, leadsTable, emailsTable, servicesTable, quizLeadsTable,
  leadQualificationsTable,
} from "@workspace/db";
import { eq, desc, count, gte, and, ilike, or, type SQL, lt } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { deriveSignalsFromQuiz, loadQuizPainConfig } from "../lib/derive-quiz-signals";
import {
  sendEmailOrThrow,
  sendEmail,
  sendEmailFromTemplate,
  getEmailTemplateOrFallback,
  sendEmailWithAttachment,
  brandedEmail,
  contactInquiryNotificationEmail,
  serviceOverviewConfirmationEmail,
  serviceOverviewLeadNotificationEmail,
} from "../lib/mailer";
import { createAuditLog } from "../lib/audit";
import { generateServiceOverviewPdf } from "../lib/service-overview-pdf";
import { scoreLead, determineNextStep } from "../lib/lead-scorer";
import fs from "fs";
import path from "path";

const UPLOADS_BASE = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve("../../data/uploads");

const router: IRouter = Router();

router.post("/leads", async (req: Request, res: Response) => {
  const { name, email, company, companySize, serviceArea, message, source, howFound } = req.body as {
    name?: string;
    email?: string;
    company?: string;
    companySize?: string;
    serviceArea?: string;
    message?: string;
    source?: string;
    howFound?: string;
  };

  if (!name || !email) {
    res.status(400).json({ error: "name and email are required" });
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    res.status(400).json({ error: "Invalid email address" });
    return;
  }

  const isServiceOverviewDownload = source === "service_overview_download";
  const validSources = ["contact_form", "lead_magnet"];
  const leadSource = validSources.includes(source ?? "") ? (source as "contact_form" | "lead_magnet") : "contact_form";

  const [lead] = await db.insert(leadsTable).values({
    name: name.trim(),
    email: email.toLowerCase().trim(),
    company: company ?? null,
    companySize: companySize ?? null,
    serviceArea: serviceArea ?? null,
    message: message ?? null,
    source: leadSource,
    howFound: howFound ?? null,
    status: "new",
  }).returning();

  if (isServiceOverviewDownload) {
    const adminEmail = process.env.CONTACT_NOTIFICATION_EMAIL ?? process.env.CRM_ADMIN_EMAIL ?? "info@shanemccaw.com";
    const trimmedName = name.trim();
    const trimmedEmail = email.toLowerCase().trim();
    const serviceName = serviceArea ?? "M365 Governance";

    void (async () => {
      try {
        const matchedServices = await db
          .select({ id: servicesTable.id, name: servicesTable.name, overviewPdfKey: servicesTable.overviewPdfKey })
          .from(servicesTable)
          .where(or(
            ilike(servicesTable.name, serviceName),
            ilike(servicesTable.name, `%${serviceName}%`),
          ))
          .limit(1);
        const matchedService = matchedServices[0] ?? null;

        let pdfAttached = false;
        let attachments: { filename: string; content: Buffer }[] | undefined;

        if (matchedService?.overviewPdfKey) {
          const filePath = path.join(UPLOADS_BASE, matchedService.overviewPdfKey);
          if (fs.existsSync(filePath)) {
            const pdfBuffer = fs.readFileSync(filePath);
            const safeName = serviceName.replace(/[^a-z0-9]/gi, "-").toLowerCase();
            attachments = [{ filename: `${safeName}-overview.pdf`, content: pdfBuffer }];
            pdfAttached = true;
          } else {
            req.log.warn({ serviceId: matchedService.id, overviewPdfKey: matchedService.overviewPdfKey }, "Service overview PDF key set but file missing on disk");
          }
        }

        if (!pdfAttached && matchedService) {
          try {
            const dynamicBuffer = await generateServiceOverviewPdf(serviceName);
            if (dynamicBuffer) {
              const safeName = serviceName.replace(/[^a-z0-9]/gi, "-").toLowerCase();
              attachments = [{ filename: `${safeName}-overview.pdf`, content: dynamicBuffer }];
              pdfAttached = true;
            }
          } catch (pdfErr) {
            req.log.warn({ pdfErr, serviceName }, "Dynamic PDF generation failed; sending email without attachment");
          }
        }

        const { subject, bodyHtml } = await getEmailTemplateOrFallback(
          "service-overview-email",
          { firstName: trimmedName.split(" ")[0] ?? trimmedName, serviceName, bookingLink: "https://shanemccaw.consulting/book" },
          `Your ${serviceName} Overview — Shane McCaw Consulting`,
          serviceOverviewConfirmationEmail({ name: trimmedName, serviceName, pdfAttached }),
        );

        if (attachments) {
          await sendEmailWithAttachment(trimmedEmail, subject, brandedEmail(bodyHtml), attachments);
        } else {
          await sendEmail(trimmedEmail, subject, bodyHtml);
        }
      } catch (err) {
        req.log.error({ err }, "Failed to send service overview email with PDF");
      }
    })();

    void sendEmailFromTemplate(
      "service-overview-lead-notification",
      adminEmail,
      { name: trimmedName, email: trimmedEmail, company: company ?? "", serviceName },
      `New service overview request from ${trimmedName} — ${company ?? ""}`,
      serviceOverviewLeadNotificationEmail({ name: trimmedName, email: trimmedEmail, company: company ?? "", serviceName }),
    );
  } else if (leadSource === "contact_form") {
    const adminEmail = process.env.CONTACT_NOTIFICATION_EMAIL ?? process.env.CRM_ADMIN_EMAIL ?? "info@shanemccaw.com";
    try {
      const { subject: contactSubject, bodyHtml: contactBody } = await getEmailTemplateOrFallback(
        "contact-inquiry-notification",
        {
          name: name.trim(),
          email: email.toLowerCase().trim(),
          company: company ?? "",
          companySize: companySize ?? "",
          serviceArea: serviceArea ?? "",
          message: message ?? "",
          howFound: howFound ?? "",
        },
        `New contact inquiry from ${name.trim()} — ${company ?? ""}`,
        contactInquiryNotificationEmail({
          name: name.trim(),
          email: email.toLowerCase().trim(),
          company: company ?? "",
          companySize: companySize ?? undefined,
          serviceArea: serviceArea ?? undefined,
          message: message ?? "",
          howFound: howFound ?? undefined,
        }),
      );
      await sendEmailOrThrow(adminEmail, contactSubject, contactBody);
    } catch (err) {
      req.log.error({ err }, "Failed to send contact notification email");
      res.status(503).json({ error: "Message could not be delivered. Please try again or email info@shanemccaw.com directly." });
      return;
    }
  }

  void createAuditLog({
    actorName: lead.name,
    actorRole: "client",
    actionType: "lead_created",
    entityType: "lead",
    entityId: lead.id,
    entityLabel: lead.name,
    metadata: { source: lead.source, company: lead.company ?? null },
  });

  res.status(201).json(lead);
});

router.get("/leads/stats", requireAdmin, async (_req: Request, res: Response) => {
  const [totalRow] = await db.select({ count: count() }).from(leadsTable);

  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const [weekRow] = await db.select({ count: count() }).from(leadsTable).where(gte(leadsTable.createdAt, weekAgo));

  const [contactRow] = await db.select({ count: count() }).from(leadsTable).where(eq(leadsTable.source, "contact_form"));
  const [magnetRow] = await db.select({ count: count() }).from(leadsTable).where(eq(leadsTable.source, "lead_magnet"));

  res.json({
    total: totalRow?.count ?? 0,
    newThisWeek: weekRow?.count ?? 0,
    fromContactForm: contactRow?.count ?? 0,
    fromLeadMagnet: magnetRow?.count ?? 0,
  });
});

router.get("/leads", requireAdmin, async (req: Request, res: Response) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10)));
  const offset = (page - 1) * limit;

  const conditions: SQL[] = [];

  const validStatuses = ["new", "contacted", "qualified", "converted", "archived"];
  if (req.query.status && validStatuses.includes(req.query.status as string)) {
    conditions.push(eq(leadsTable.status, req.query.status as "new" | "contacted" | "qualified" | "converted" | "archived"));
  }

  const validSources = ["contact_form", "lead_magnet"];
  if (req.query.source && validSources.includes(req.query.source as string)) {
    conditions.push(eq(leadsTable.source, req.query.source as "contact_form" | "lead_magnet"));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [totalRow] = await db.select({ count: count() }).from(leadsTable).where(whereClause);
  const leads = await db
    .select()
    .from(leadsTable)
    .where(whereClause)
    .orderBy(desc(leadsTable.createdAt))
    .limit(limit)
    .offset(offset);

  res.json({ leads, total: totalRow?.count ?? 0, page, limit });
});

router.get("/leads/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid lead ID" });
    return;
  }

  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, id)).limit(1);
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }

  res.json(lead);
});

router.get("/leads/:id/quiz-matches", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid lead ID" });
    return;
  }

  const [lead] = await db
    .select({ email: leadsTable.email })
    .from(leadsTable)
    .where(eq(leadsTable.id, id))
    .limit(1);

  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }

  const matches = await db
    .select()
    .from(quizLeadsTable)
    .where(eq(quizLeadsTable.email, lead.email))
    .orderBy(desc(quizLeadsTable.createdAt));

  res.json(matches);
});

// GET /api/leads/:id/derive-signals[?quizId=<id>]
// Derives pain signals for a lead from its quiz matches using the server-side
// config (reads the DB; falls back to hardcoded defaults).
// Optionally restrict to a specific quiz via ?quizId=<n>.
router.get("/leads/:id/derive-signals", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid lead ID" });
    return;
  }

  const [lead] = await db
    .select({ email: leadsTable.email, source: leadsTable.source })
    .from(leadsTable)
    .where(eq(leadsTable.id, id))
    .limit(1);

  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }

  const quizIdFilter = req.query.quizId !== undefined
    ? parseInt(String(req.query.quizId), 10)
    : null;

  let matches = await db
    .select()
    .from(quizLeadsTable)
    .where(eq(quizLeadsTable.email, lead.email))
    .orderBy(desc(quizLeadsTable.totalScore));

  if (quizIdFilter !== null && !isNaN(quizIdFilter)) {
    matches = matches.filter(m => m.id === quizIdFilter);
  }

  if (matches.length === 0) {
    res.json({ painPoints: [], maturityIndicators: [], engagementSignals: [], urgencySignals: [], provenance: {} });
    return;
  }

  const bestMatch = matches[0];
  const config = await loadQuizPainConfig();
  const source = (lead.source === "lead_magnet" ? "lead_magnet" : "contact_form") as "lead_magnet" | "contact_form";

  try {
    const signals = deriveSignalsFromQuiz(
      {
        quizType: bestMatch.quizType,
        categoryScores: (bestMatch.categoryScores ?? {}) as Record<string, number>,
        conversation: (bestMatch.conversation ?? []) as { role: "user" | "assistant"; content: string }[],
      },
      source,
      config,
    );
    res.json(signals);
  } catch (err) {
    req.log.error({ err }, "derive-signals failed");
    res.status(500).json({ error: "Failed to derive signals" });
  }
});

router.get("/leads/:id/emails", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid lead ID" });
    return;
  }

  const emails = await db
    .select({
      id: emailsTable.id,
      subject: emailsTable.subject,
      senderAddress: emailsTable.senderAddress,
      rawFrom: emailsTable.rawFrom,
      receivedAt: emailsTable.receivedAt,
      bodyPreview: emailsTable.bodyPreview,
    })
    .from(emailsTable)
    .where(eq(emailsTable.linkedLeadId, id))
    .orderBy(desc(emailsTable.receivedAt));

  res.json(emails);
});

router.patch("/leads/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id ?? ""), 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid lead ID" });
    return;
  }

  const {
    status, message, company,
    industry, employeeCount, licenseTier, tenantAge, itTeamSize,
    painPoints, maturityIndicators, engagementSignals, urgencySignals,
  } = req.body as {
    status?: string;
    message?: string;
    company?: string;
    industry?: string;
    employeeCount?: number;
    licenseTier?: string;
    tenantAge?: number;
    itTeamSize?: number;
    painPoints?: string[];
    maturityIndicators?: string[];
    engagementSignals?: string[];
    urgencySignals?: string[];
  };

  const validStatuses = ["new", "contacted", "qualified", "converted", "archived"];
  if (status && !validStatuses.includes(status)) {
    res.status(400).json({ error: "Invalid status" });
    return;
  }

  // Build update payload
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (status) updates.status = status;
  if (message !== undefined) updates.message = message ?? null;
  if (company !== undefined) updates.company = company ?? null;
  if (industry !== undefined) updates.industry = industry ?? null;
  if (employeeCount !== undefined) updates.employeeCount = employeeCount ?? null;
  if (licenseTier !== undefined) updates.licenseTier = licenseTier ?? null;
  if (tenantAge !== undefined) updates.tenantAge = tenantAge ?? null;
  if (itTeamSize !== undefined) updates.itTeamSize = itTeamSize ?? null;
  if (painPoints !== undefined) updates.painPoints = painPoints;
  if (maturityIndicators !== undefined) updates.maturityIndicators = maturityIndicators;
  if (engagementSignals !== undefined) updates.engagementSignals = engagementSignals;
  if (urgencySignals !== undefined) updates.urgencySignals = urgencySignals;

  // Fetch current lead before update for scoring comparison
  const [currentLead] = await db.select().from(leadsTable).where(eq(leadsTable.id, id)).limit(1);
  if (!currentLead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }

  const [updated] = await db
    .update(leadsTable)
    .set(updates as Partial<typeof leadsTable.$inferInsert>)
    .where(eq(leadsTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }

  if (status && req.user) {
    const actor = req.user;
    void createAuditLog({
      actorUserId: actor.id,
      actorName: actor.name ?? actor.email,
      actorRole: "admin",
      actionType: "lead_status_changed",
      entityType: "lead",
      entityId: updated.id,
      entityLabel: updated.name,
      metadata: { from: null, to: status },
    });
  }

  // ── Qualification scoring ──────────────────────────────────────────────────
  // Only score if qualifying profile fields changed
  const qualFieldsChanged = (
    industry !== undefined ||
    employeeCount !== undefined ||
    licenseTier !== undefined ||
    tenantAge !== undefined ||
    itTeamSize !== undefined ||
    painPoints !== undefined ||
    maturityIndicators !== undefined ||
    engagementSignals !== undefined ||
    urgencySignals !== undefined
  );

  let qualificationPending = false;

  if (qualFieldsChanged) {
    const scoreResult = scoreLead({
      industry: updated.industry,
      employeeCount: updated.employeeCount,
      licenseTier: updated.licenseTier,
      tenantAge: updated.tenantAge,
      itTeamSize: updated.itTeamSize,
      painPoints: (updated.painPoints as string[]) ?? [],
      maturityIndicators: (updated.maturityIndicators as string[]) ?? [],
      engagementSignals: (updated.engagementSignals as string[]) ?? [],
      urgencySignals: (updated.urgencySignals as string[]) ?? [],
      companySize: updated.companySize,
      serviceArea: updated.serviceArea,
      source: updated.source,
    });

    const prevScore = currentLead.score ?? 0;
    const newScore = scoreResult.total;

    // Determine if a threshold was crossed (60 = AQL, 75 = SQL)
    const crossedAQL = prevScore < 60 && newScore >= 60;
    const crossedSQL = prevScore < 75 && newScore >= 75;
    const stage: "AQL" | "SQL" | null = crossedSQL ? "SQL" : crossedAQL ? "AQL" : null;

    if (stage) {
      // 24-hour cooldown — check for existing pending or recent qualification
      const cooldownStart = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const recentQuals = await db
        .select({ id: leadQualificationsTable.id })
        .from(leadQualificationsTable)
        .where(
          and(
            eq(leadQualificationsTable.leadId, id),
            gte(leadQualificationsTable.createdAt, cooldownStart),
          ),
        )
        .limit(1);

      if (recentQuals.length === 0) {
        const nextStep = determineNextStep(newScore, (updated.painPoints as string[]) ?? []);

        await db.insert(leadQualificationsTable).values({
          leadId: id,
          newScore,
          previousScore: prevScore,
          stage,
          recommendedNextStep: nextStep.label,
          workflowType: nextStep.workflowType,
          evidence: scoreResult.evidence,
          scoreFit: scoreResult.fit,
          scorePain: scoreResult.pain,
          scoreMaturity: scoreResult.maturity,
          scoreIntent: scoreResult.intent,
          scoreUrgency: scoreResult.urgency,
          status: "pending",
        });

        // Update lead score + stage
        await db
          .update(leadsTable)
          .set({
            score: newScore,
            previousScore: prevScore,
            stage,
            lastQualifiedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(leadsTable.id, id));

        qualificationPending = true;
      } else {
        // Cooldown active — still update score AND stage so the lead's band is accurate.
        // No new qualification record is inserted; the existing pending one covers this window.
        await db
          .update(leadsTable)
          .set({ score: newScore, previousScore: prevScore, stage, updatedAt: new Date() })
          .where(eq(leadsTable.id, id));
      }
    } else {
      // Update score without triggering qualification
      await db
        .update(leadsTable)
        .set({ score: newScore, previousScore: prevScore, updatedAt: new Date() })
        .where(eq(leadsTable.id, id));
    }

    // Re-fetch updated lead for response
    const [finalLead] = await db.select().from(leadsTable).where(eq(leadsTable.id, id)).limit(1);
    res.json({ ...(finalLead ?? updated), qualificationPending });
    return;
  }

  res.json({ ...updated, qualificationPending });
});

// GET /api/leads/:id/qualifications — score history for a lead
router.get("/leads/:id/qualifications", requireAdmin, async (req: Request, res: Response) => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid lead id" }); return; }

  const rows = await db
    .select()
    .from(leadQualificationsTable)
    .where(eq(leadQualificationsTable.leadId, id))
    .orderBy(desc(leadQualificationsTable.createdAt));

  res.json(rows);
});

export default router;
