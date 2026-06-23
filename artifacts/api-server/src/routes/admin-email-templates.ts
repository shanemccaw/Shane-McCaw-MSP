import { Router, type IRouter, type Request, type Response } from "express";
import { db, emailTemplatesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { sendEmailOrThrow, brandedEmail } from "../lib/mailer";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function substituteVars(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    key in vars ? escapeHtml(vars[key]) : `{{${key}}}`,
  );
}

const SAMPLE_VARS: Record<string, Record<string, string>> = {
  "purchase-confirmation": {
    clientName: "Jane Smith",
    serviceName: "M365 Health Check",
    amountDollars: "1,497",
    portalLink: "https://shanemccaw.consulting/crm/portal",
  },
  "onboarding-confirmation": {
    clientName: "Jane Smith",
    serviceName: "M365 Governance Setup",
    amountDollars: "4,997",
    projectUrl: "https://shanemccaw.consulting/crm/portal/projects/1",
  },
  "password-reset": {
    resetLink: "https://shanemccaw.consulting/crm/reset-password?token=example",
  },
  "contact-inquiry-notification": {
    name: "Jane Smith",
    email: "jane@contoso.com",
    company: "Contoso Ltd",
    companySize: "51–200",
    serviceArea: "M365 Setup/Optimization",
    message: "Hi Shane, we're looking to migrate our team to M365 and would love your help.",
    howFound: "LinkedIn",
  },
  "closure-request": {
    clientName: "Jane Smith",
    projectTitle: "M365 Governance Setup",
    projectUrl: "https://shanemccaw.consulting/crm/portal/projects/1",
  },
  "status-report-reply": {
    clientName: "Jane Smith",
    reportTitle: "Week 3 Progress Report",
    adminReply: "Great question! The Teams rollout is on track and we'll have it ready for your review by Thursday.",
    projectUrl: "https://shanemccaw.consulting/crm/portal/projects/1",
  },
  "client-thread-reply": {
    clientName: "Jane Smith",
    reportTitle: "Week 3 Progress Report",
    replyContent: "Thanks for the update! Will the SharePoint migration be included in the same sprint?",
    adminPanelUrl: "https://shanemccaw.consulting/admin-panel/crm/projects/1",
  },
  "admin-thread-reply": {
    clientName: "Jane Smith",
    reportTitle: "Week 3 Progress Report",
    replyContent: "Yes, SharePoint migration is in the same sprint — we'll kick that off after the Teams rollout is signed off.",
    projectUrl: "https://shanemccaw.consulting/crm/portal/projects/1",
  },
  "retainer-resumed": {
    clientName: "Jane Smith",
    serviceName: "Microsoft 365 Managed Support",
    nextBillingDate: "August 1, 2026",
    portalLink: "https://shanemccaw.consulting/crm/portal",
  },
  "service-overview-confirmation": {
    firstName: "Jane",
    serviceName: "SharePoint Intranet Build",
    bookingLink: "https://shanemccaw.consulting/book",
  },
  "service-overview-lead-notification": {
    name: "Jane Smith",
    email: "jane@contoso.com",
    company: "Contoso Ltd",
    serviceName: "SharePoint Intranet Build",
  },
  "quiz-lead-notification": {
    name: "Jane Smith",
    email: "jane@contoso.com",
    company: "Contoso Ltd",
    totalScore: "38",
    tier: "Advanced",
    recommendedService: "Copilot AI Deployment",
  },
  "admin-purchase-alert": {
    clientName: "Jane Smith",
    clientEmail: "jane@contoso.com",
    serviceName: "M365 Health Check",
    amountDollars: "1,497",
    purchaseType: "Service purchase",
    portalLink: "https://shanemccaw.consulting/crm/portal",
  },
  "client-message-notification": {
    clientName: "Jane Smith",
    messageBody: "Hi, just wanted to check in on the progress of the SharePoint migration. Any updates?",
    portalLink: "https://shanemccaw.consulting/crm/portal/messages",
  },
  "admin-message-notification": {
    clientName: "Jane Smith",
    messageBody: "Hi, just wanted to check in on the progress of the SharePoint migration. Any updates?",
  },
  "quiz-report-email": {
    firstName: "Jane",
    reportName: "Microsoft Copilot Readiness Assessment",
    totalScore: "38",
    tier: "Advanced",
    recommendedService: "Copilot AI Deployment",
  },
  "welcome-email": {
    clientName: "Jane Smith",
    portalLink: "https://shanemccaw.consulting/crm/portal",
  },
};

// ─── GET /admin/email-templates — list all ───────────────────────────────────
router.get("/admin/email-templates", requireAdmin, async (_req: Request, res: Response) => {
  const rows = await db
    .select({
      slug: emailTemplatesTable.slug,
      name: emailTemplatesTable.name,
      subject: emailTemplatesTable.subject,
      updatedAt: emailTemplatesTable.updatedAt,
    })
    .from(emailTemplatesTable)
    .orderBy(emailTemplatesTable.name);

  res.json(rows);
});

// ─── GET /admin/email-templates/:slug — get full template ────────────────────
router.get("/admin/email-templates/:slug", requireAdmin, async (req: Request, res: Response) => {
  const slug = String(req.params.slug ?? "");
  if (!slug) { res.status(400).json({ error: "slug is required" }); return; }

  const [row] = await db
    .select()
    .from(emailTemplatesTable)
    .where(eq(emailTemplatesTable.slug, slug))
    .limit(1);

  if (!row) { res.status(404).json({ error: "Template not found" }); return; }

  res.json(row);
});

// ─── PUT /admin/email-templates/:slug — update subject and/or body_html ──────
router.put("/admin/email-templates/:slug", requireAdmin, async (req: Request, res: Response) => {
  const slug = String(req.params.slug ?? "");
  if (!slug) { res.status(400).json({ error: "slug is required" }); return; }

  const { subject, bodyHtml } = req.body as { subject?: string; bodyHtml?: string };
  if (!subject && !bodyHtml) {
    res.status(400).json({ error: "subject or bodyHtml is required" });
    return;
  }

  const [existing] = await db
    .select({ slug: emailTemplatesTable.slug })
    .from(emailTemplatesTable)
    .where(eq(emailTemplatesTable.slug, slug))
    .limit(1);

  if (!existing) { res.status(404).json({ error: "Template not found" }); return; }

  const updates: Partial<{ subject: string; bodyHtml: string; updatedAt: Date }> = {
    updatedAt: new Date(),
  };
  if (subject !== undefined) updates.subject = subject.trim();
  if (bodyHtml !== undefined) updates.bodyHtml = bodyHtml;

  const [updated] = await db
    .update(emailTemplatesTable)
    .set(updates)
    .where(eq(emailTemplatesTable.slug, slug))
    .returning();

  res.json(updated);
});

// ─── POST /admin/email-templates/:slug/test — send test email ─────────────────
router.post("/admin/email-templates/:slug/test", requireAdmin, async (req: Request, res: Response) => {
  const slug = String(req.params.slug ?? "");
  if (!slug) { res.status(400).json({ error: "slug is required" }); return; }

  const adminEmail = process.env.ADMIN_EMAIL ?? process.env.CRM_ADMIN_EMAIL;
  if (!adminEmail) {
    res.status(503).json({ error: "No admin email configured — set ADMIN_EMAIL or CRM_ADMIN_EMAIL in secrets" });
    return;
  }

  const [row] = await db
    .select()
    .from(emailTemplatesTable)
    .where(eq(emailTemplatesTable.slug, slug))
    .limit(1);

  if (!row) { res.status(404).json({ error: "Template not found" }); return; }

  const sampleVars = SAMPLE_VARS[slug] ?? {};
  const bodyWithVars = substituteVars(row.bodyHtml, sampleVars);
  const subjectWithVars = substituteVars(row.subject, sampleVars);

  try {
    const fullHtml = brandedEmail(bodyWithVars);
    await sendEmailOrThrow(adminEmail, `[TEST] ${subjectWithVars}`, fullHtml, { skipWrapper: true });
    logger.info({ slug, to: adminEmail }, "Test email sent for template");
    res.json({ ok: true, sentTo: adminEmail });
  } catch (err) {
    logger.error({ err, slug }, "Failed to send test email");
    res.status(503).json({ error: err instanceof Error ? err.message : "Failed to send test email" });
  }
});

export default router;
