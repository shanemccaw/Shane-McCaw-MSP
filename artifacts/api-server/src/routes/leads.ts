import { Router, type IRouter, type Request, type Response } from "express";
import { db, leadsTable, emailsTable } from "@workspace/db";
import { eq, desc, count, gte, and, type SQL } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { sendEmailOrThrow, contactInquiryNotificationEmail } from "../lib/mailer";

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

  if (leadSource === "contact_form") {
    const adminEmail = process.env.CONTACT_NOTIFICATION_EMAIL ?? process.env.CRM_ADMIN_EMAIL ?? "info@shanemccaw.com";
    try {
      await sendEmailOrThrow(
        adminEmail,
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
    } catch (err) {
      req.log.error({ err }, "Failed to send contact notification email");
      res.status(503).json({ error: "Message could not be delivered. Please try again or email info@shanemccaw.com directly." });
      return;
    }
  }

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

  const { status, message, company } = req.body as { status?: string; message?: string; company?: string };

  const validStatuses = ["new", "contacted", "qualified", "converted", "archived"];
  if (status && !validStatuses.includes(status)) {
    res.status(400).json({ error: "Invalid status" });
    return;
  }

  const updates: Partial<{ status: "new" | "contacted" | "qualified" | "converted" | "archived"; message: string | null; company: string | null; updatedAt: Date }> = {
    updatedAt: new Date(),
  };
  if (status) updates.status = status as "new" | "contacted" | "qualified" | "converted" | "archived";
  if (message !== undefined) updates.message = message ?? null;
  if (company !== undefined) updates.company = company ?? null;

  const [updated] = await db
    .update(leadsTable)
    .set(updates)
    .where(eq(leadsTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }

  res.json(updated);
});

export default router;
