import { Router, type Request, type Response } from "express";
import {
  db, leadsTable, recommendedLeadsTable, outreachTemplatesTable,
  marketingTasksTable, campaignsTable, campaignAssetsTable,
  analyticsSessionsTable, analyticsSiteEventsTable, servicesTable,
  settingsTable, quizPainSignalConfigTable, emailEventsTable, seoRankingsTable,
  leadIntentEventsTable, followUpEventsTable, offersTable, landingPagesTable,
  clientServicesTable,
} from "@workspace/db";
import { eq, desc, count, and, gte, lte, sql, inArray, lt, isNull, or, ne } from "drizzle-orm";
import { ingestIntentEvent, recomputeAndPersistHotScore } from "../lib/lead-intent";
import { requireAdmin } from "../middlewares/requireAuth";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { sendMessage, GraphMailConfigError } from "../lib/graphEmail";
import { fetchTopQueries } from "../lib/search-console";
import { logger } from "../lib/logger";
import { getPrompt } from "../lib/prompt-loader.ts";
import { z } from "zod";

const router = Router();

function parseId(params: Request["params"], key: string): number {
  return parseInt(String(params[key] ?? ""), 10);
}

function extractJson(text: string): string {
  // 1. Try to pull JSON out of a ```json ... ``` or ``` ... ``` fence anywhere in the text
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();

  // 2. No fence — find the first { or [ and return from there to the matching close
  const objStart = text.indexOf("{");
  const arrStart = text.indexOf("[");
  if (objStart === -1 && arrStart === -1) return text.trim();
  const start = objStart === -1 ? arrStart : arrStart === -1 ? objStart : Math.min(objStart, arrStart);
  const openChar = text[start] === "{" ? "{" : "[";
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\" && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === openChar) depth++;
    else if (ch === closeChar) { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return text.slice(start).trim();
}

class AiResponseError extends Error {}

function parseAiJson<T>(text: string, schema: z.ZodType<T>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJson(text));
  } catch {
    throw new AiResponseError("AI returned an unreadable response — please try again");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new AiResponseError(`AI returned unexpected format — please try again (${result.error.issues.map(i => i.message).join("; ")})`);
  }
  return result.data;
}

const AI_ERROR_MESSAGE = "AI generation failed — please try again";

function aiErrorResponse(e: unknown): { _aiError: true; error: string; message: string } {
  const msg = e instanceof Error ? e.message : AI_ERROR_MESSAGE;
  return { _aiError: true, error: msg, message: msg };
}

// ─── ARCHITECTURE NOTE — Archived opportunities exclusion rule ────────────────
// Any future query against opportunitiesTable in this file (for AI context or
// prompts) MUST include a ne(opportunitiesTable.state, 'archived') filter so
// archived deals do not skew targeting, scoring, or AI recommendations.
// opportunitiesTable is not currently queried here; if you add a query, apply
// the exclusion above.  Example: .where(ne(opportunitiesTable.state, 'archived'))
// ─────────────────────────────────────────────────────────────────────────────

// ─── ICP context helper — sources from DB ─────────────────────────────────────

async function buildICPContext(): Promise<string> {
  const [services, topLeads, painSignals, icpSettings] = await Promise.all([
    db.select({ name: servicesTable.name, description: servicesTable.description, targetAudience: servicesTable.targetAudience })
      .from(servicesTable).where(eq(servicesTable.visibility, "public")).limit(8),
    db.execute(sql`
      SELECT industry, company_size, COUNT(*) as cnt
      FROM leads
      WHERE industry IS NOT NULL
      GROUP BY industry, company_size
      ORDER BY cnt DESC
      LIMIT 10
    `),
    db.select({ quizTypePainMap: quizPainSignalConfigTable.quizTypePainMap, categoryPainMap: quizPainSignalConfigTable.categoryPainMap })
      .from(quizPainSignalConfigTable).limit(1),
    db.select({ key: settingsTable.key, value: settingsTable.value })
      .from(settingsTable)
      .where(inArray(settingsTable.key, ["icp_description", "target_industries", "ideal_company_size", "value_proposition", "differentiators"])),
  ]);

  type TopLeadRow = { industry: string; company_size: string; cnt: string };
  const rawLeads = (topLeads as unknown as { rows: TopLeadRow[] }).rows ?? [];

  const settingsMap = Object.fromEntries(icpSettings.map(s => [s.key, s.value ?? ""]));

  const sections: string[] = [];

  if (settingsMap["icp_description"]) sections.push(`ICP: ${settingsMap["icp_description"]}`);
  if (settingsMap["target_industries"]) sections.push(`Target industries: ${settingsMap["target_industries"]}`);
  if (settingsMap["ideal_company_size"]) sections.push(`Ideal company size: ${settingsMap["ideal_company_size"]}`);
  if (settingsMap["value_proposition"]) sections.push(`Value proposition: ${settingsMap["value_proposition"]}`);
  if (settingsMap["differentiators"]) sections.push(`Differentiators: ${settingsMap["differentiators"]}`);

  if (services.length > 0) {
    sections.push(`Services: ${services.map(s => `${s.name} (targets: ${s.targetAudience ?? "mid-market"})`).join("; ")}`);
  }

  if (rawLeads.length > 0) {
    const leadProfiles = rawLeads.map(r => `${String(r.industry)} (${String(r.company_size ?? "various")})`).join(", ");
    sections.push(`Top existing lead profiles: ${leadProfiles}`);
  }

  // Extract pain signal category names from JSONB blob
  const painConfig = painSignals[0];
  if (painConfig?.categoryPainMap && Array.isArray(painConfig.categoryPainMap) && painConfig.categoryPainMap.length > 0) {
    const signalNames = (painConfig.categoryPainMap as [string, string][]).slice(0, 8).map(([name]) => name).filter(Boolean);
    if (signalNames.length > 0) sections.push(`Key pain signals: ${signalNames.join(", ")}`);
  }

  if (sections.length === 0) {
    sections.push("Microsoft 365 consulting, mid-market (50-2000 employees), IT decision-makers in healthcare, government, finance, or technology sectors");
  }

  return sections.join("\n");
}

// ─── KPI Summary ─────────────────────────────────────────────────────────────

router.get("/admin/marketing/kpi", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [visitorsToday, leadsThisWeek, activeCampaigns, conversionEvents] = await Promise.all([
      db.select({ cnt: count() }).from(analyticsSessionsTable).where(gte(analyticsSessionsTable.startedAt, todayStart)),
      db.select({ cnt: count() }).from(leadsTable).where(gte(leadsTable.createdAt, weekAgo)),
      db.select({ cnt: count() }).from(campaignsTable).where(eq(campaignsTable.status, "active")),
      db.select({ cnt: count() }).from(analyticsSiteEventsTable)
        .where(and(eq(analyticsSiteEventsTable.eventType, "cta_click"), gte(analyticsSiteEventsTable.createdAt, weekAgo))),
    ]);

    const visitors = Number(visitorsToday[0]?.cnt ?? 0);
    const leads = Number(leadsThisWeek[0]?.cnt ?? 0);
    const campaigns = Number(activeCampaigns[0]?.cnt ?? 0);
    const conversions = Number(conversionEvents[0]?.cnt ?? 0);
    const conversionRate = visitors > 0 ? ((conversions / visitors) * 100).toFixed(1) : "0.0";

    const [hotLeadsCount, intentEventsToday, followUpsDue, offersCount, revenueThisMonth, convertedLeadsThisWeek, avgServicePrice] = await Promise.all([
      db.select({ cnt: count() }).from(leadsTable).where(gte(leadsTable.score, 70)),
      db.select({ cnt: count() }).from(leadIntentEventsTable).where(gte(leadIntentEventsTable.occurredAt, todayStart)),
      db.select({ cnt: count() }).from(followUpEventsTable)
        .where(and(eq(followUpEventsTable.status, "pending"), lte(followUpEventsTable.scheduledAt, now))),
      db.select({ cnt: count() }).from(offersTable),
      db.select({ total: sql<string>`COALESCE(SUM(revenue_attributed::numeric), 0)` }).from(campaignsTable).where(eq(campaignsTable.status, "active")),
      db.select({ cnt: count() }).from(leadsTable).where(and(eq(leadsTable.status, "converted"), gte(leadsTable.createdAt, weekAgo))),
      // Avg deal size derived from actual service pricing (base_price fallback to price)
      db.select({ avg: sql<string>`COALESCE(AVG(COALESCE(base_price::numeric, price::numeric)), 5000)` }).from(servicesTable).where(eq(servicesTable.visibility, "public")),
    ]);

    const totalLeadsThisWeek = leads;
    const converted = Number(convertedLeadsThisWeek[0]?.cnt ?? 0);
    const offerConversionRate = totalLeadsThisWeek > 0 ? ((converted / totalLeadsThisWeek) * 100).toFixed(1) : "0.0";
    // Revenue opportunity = hot leads × avg deal value derived from service pricing (min $1,000 fallback)
    const avgDeal = Math.max(1000, parseFloat(String(avgServicePrice[0]?.avg ?? "5000")));
    const revenueOpportunity = Math.round(Number(hotLeadsCount[0]?.cnt ?? 0) * avgDeal);

    res.json({
      visitorsToday: visitors,
      leadsThisWeek: leads,
      conversionRate,
      activeCampaigns: campaigns,
      hotLeadsCount: Number(hotLeadsCount[0]?.cnt ?? 0),
      intentSignalsToday: Number(intentEventsToday[0]?.cnt ?? 0),
      followUpsDue: Number(followUpsDue[0]?.cnt ?? 0),
      activeOffers: Number(offersCount[0]?.cnt ?? 0),
      revenueThisMonth: parseFloat(String(revenueThisMonth[0]?.total ?? "0")),
      revenueOpportunity,
      offerConversionRate,
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Recommended Leads ────────────────────────────────────────────────────────

router.get("/admin/marketing/recommended-leads", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [rows, archivedLeads] = await Promise.all([
      db.select().from(recommendedLeadsTable).orderBy(desc(recommendedLeadsTable.generatedAt)).limit(40),
      db.select({ email: leadsTable.email }).from(leadsTable).where(eq(leadsTable.status, "archived")),
    ]);
    const archivedEmails = new Set(archivedLeads.map(l => l.email.toLowerCase()));
    const filtered = rows.filter(r => !r.email || !archivedEmails.has(r.email.toLowerCase()));
    res.json(filtered);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.post("/admin/marketing/recommended-leads", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name, company, role, email, industry, companySize, location, painPoints, whyFit, recommendedService, confidence } = req.body as {
      name: string; company?: string; role?: string; email?: string; industry?: string;
      companySize?: string; location?: string; painPoints?: string[]; whyFit?: string;
      recommendedService?: string; confidence?: number;
    };
    const [row] = await db.insert(recommendedLeadsTable).values({
      name, company: company ?? null, role: role ?? null, email: email ?? null,
      industry: industry ?? null, companySize: companySize ?? null, location: location ?? null,
      painPoints: painPoints ?? [], whyFit: whyFit ?? null,
      recommendedService: recommendedService ?? null, confidence: confidence ?? 75,
    }).returning();
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.patch("/admin/marketing/recommended-leads/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    const { name, company, role, email, industry, companySize, location, painPoints, whyFit, recommendedService, confidence, status } = req.body as {
      name?: string; company?: string; role?: string; email?: string; industry?: string;
      companySize?: string; location?: string; painPoints?: string[]; whyFit?: string;
      recommendedService?: string; confidence?: number; status?: "pending" | "converted" | "dismissed";
    };
    const updateData: Partial<typeof recommendedLeadsTable.$inferInsert> = {};
    if (name !== undefined) updateData.name = name;
    if (company !== undefined) updateData.company = company;
    if (role !== undefined) updateData.role = role;
    if (email !== undefined) updateData.email = email;
    if (industry !== undefined) updateData.industry = industry;
    if (companySize !== undefined) updateData.companySize = companySize;
    if (location !== undefined) updateData.location = location;
    if (painPoints !== undefined) updateData.painPoints = painPoints;
    if (whyFit !== undefined) updateData.whyFit = whyFit;
    if (recommendedService !== undefined) updateData.recommendedService = recommendedService;
    if (confidence !== undefined) updateData.confidence = confidence;
    if (status !== undefined) updateData.status = status;
    const [row] = await db.update(recommendedLeadsTable).set(updateData).where(eq(recommendedLeadsTable.id, id)).returning();
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.delete("/admin/marketing/recommended-leads/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    await db.delete(recommendedLeadsTable).where(eq(recommendedLeadsTable.id, id));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.post("/admin/marketing/recommended-leads/generate", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { targetingPrompt } = req.body as { targetingPrompt?: string };
    const icpContext = await buildICPContext();

    const targetingClause = targetingPrompt?.trim()
      ? `\nADDITIONAL TARGETING INSTRUCTIONS: ${targetingPrompt.trim()}\nFocus lead generation specifically on this criteria while still matching the ICP above.\n`
      : "";

    const LEAD_GEN_DEFAULT = `You are a B2B lead generation specialist for a Microsoft 365 consulting firm led by Shane McCaw, a 30-year Microsoft veteran and NASA M365 architect.

{{icpContext}}
{{targetingClause}}
Generate 7 highly specific, realistic recommended leads who perfectly match the above ICP. Each should be a real-sounding decision-maker at a company that would genuinely benefit from these services.

IMPORTANT COMPLIANCE CONSTRAINT: Shane McCaw is a full-time federal employee (NASA). He is legally prohibited from contracting with: (1) other federal agencies, government departments, national laboratories, DoD components, or any other government entity; (2) any commercial company that holds, pursues, or is known to be a prime or subcontractor on NASA contracts. Only recommend private-sector, commercially-focused companies with NO known NASA or federal prime/sub contract relationships.

Respond with a JSON array (no markdown):
[
  {
    "name": "First Last",
    "company": "Company Name",
    "role": "Job Title",
    "email": "email@company.com",
    "industry": "Industry",
    "companySize": "100-500",
    "location": "City, State",
    "painPoints": ["specific pain point 1", "specific pain point 2"],
    "whyFit": "Brief explanation of why they fit the ICP",
    "recommendedService": "Service name",
    "confidence": 85
  }
]`;
    const leadGenTemplate = await getPrompt("marketing-lead-gen", LEAD_GEN_DEFAULT);
    const leadGenPrompt = leadGenTemplate
      .replace("{{icpContext}}", icpContext)
      .replace("{{targetingClause}}", targetingClause);

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 2000,
      messages: [{
        role: "user",
        content: leadGenPrompt,
      }],
    });

    const content = message.content[0];
    if (content?.type !== "text") throw new Error("Unexpected response type");

    const leads = parseAiJson(content.text, z.array(z.record(z.unknown())));

    const inserted = await db.insert(recommendedLeadsTable).values(
      leads.map(l => ({
        name: String(l["name"] ?? ""),
        company: l["company"] ? String(l["company"]) : null,
        role: l["role"] ? String(l["role"]) : null,
        email: l["email"] ? String(l["email"]) : null,
        industry: l["industry"] ? String(l["industry"]) : null,
        companySize: l["companySize"] ? String(l["companySize"]) : null,
        location: l["location"] ? String(l["location"]) : null,
        painPoints: Array.isArray(l["painPoints"]) ? l["painPoints"] as string[] : [],
        whyFit: l["whyFit"] ? String(l["whyFit"]) : null,
        recommendedService: l["recommendedService"] ? String(l["recommendedService"]) : null,
        confidence: typeof l["confidence"] === "number" ? l["confidence"] : 75,
      }))
    ).returning();

    res.json(inserted);
  } catch (e) {
    if (e instanceof AiResponseError) { logger.warn({ err: e }, "AI parse failed on /recommended-leads/generate"); res.json(aiErrorResponse(e)); return; }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/admin/marketing/recommended-leads/:id/convert", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    const [rec] = await db.select().from(recommendedLeadsTable).where(eq(recommendedLeadsTable.id, id));
    if (!rec) {
      res.status(404).json({ error: "Not found" });
      return;
    }

    const body = req.body as { outreachDraft?: string | null } | undefined;
    const outreachDraft = body?.outreachDraft ?? rec.lastOutreachDraft ?? null;

    const emailFallback = `${rec.name.toLowerCase().replace(/\s+/g, ".")}@${(rec.company ?? "company").toLowerCase().replace(/\s+/g, "")}.com`;
    const noteParts: string[] = [`[${new Date().toISOString()}] Converted from AI-recommended lead.`];
    if (rec.whyFit) noteParts.push(`Why fit: ${rec.whyFit}`);
    if (rec.recommendedService) noteParts.push(`Recommended service: ${rec.recommendedService}`);
    if (rec.confidence) noteParts.push(`Confidence: ${rec.confidence}%`);
    if (outreachDraft) noteParts.push(`\n--- AI Outreach Draft ---\n${outreachDraft}`);

    const [newLead] = await db.insert(leadsTable).values({
      name: rec.name,
      email: rec.email ?? emailFallback,
      company: rec.company ?? null,
      companySize: rec.companySize ?? null,
      industry: rec.industry ?? null,
      role: rec.role ?? null,
      phone: rec.phone ?? null,
      location: rec.location ?? null,
      painPoints: rec.painPoints,
      source: "ai_recommended",
      status: "contacted",
      stage: "AQL",
      notes: noteParts.join(" | "),
    }).returning();

    await db.update(recommendedLeadsTable)
      .set({ status: "converted", convertedLeadId: newLead?.id })
      .where(eq(recommendedLeadsTable.id, id));

    res.json({ success: true, lead: newLead });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.patch("/admin/marketing/recommended-leads/:id/dismiss", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    await db.update(recommendedLeadsTable).set({ status: "dismissed" }).where(eq(recommendedLeadsTable.id, id));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── AI Generation (outreach + content) ──────────────────────────────────────

const generateOutreachSchema = z.object({
  leadId: z.number().optional(),
  recommendedLeadId: z.number().optional(),
  name: z.string().optional(),
  company: z.string().optional(),
  role: z.string().optional(),
  industry: z.string().optional(),
  painPoints: z.array(z.string()).optional(),
  templateType: z.enum(["cold_email", "linkedin", "followup", "cold_call"]),
});

router.post("/admin/marketing/generate/outreach", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = generateOutreachSchema.parse(req.body);
    let leadData = {
      name: body.name ?? "",
      company: body.company ?? "",
      role: body.role ?? "",
      industry: body.industry ?? "",
      painPoints: body.painPoints ?? [] as string[],
    };

    if (body.leadId) {
      const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, body.leadId));
      if (lead) {
        const leadWithRole = lead as typeof lead & { role?: string };
        leadData = {
          name: lead.name,
          company: lead.company ?? "",
          role: leadWithRole.role ?? "",
          industry: lead.industry ?? "",
          painPoints: lead.painPoints,
        };
      }
    }

    if (body.recommendedLeadId && !body.leadId) {
      const [recLead] = await db.select().from(recommendedLeadsTable)
        .where(eq(recommendedLeadsTable.id, body.recommendedLeadId));
      if (recLead) {
        leadData = {
          name: recLead.name,
          company: recLead.company ?? "",
          role: recLead.role ?? "",
          industry: recLead.industry ?? "",
          painPoints: recLead.painPoints ?? [],
        };
      }
    }

    const icpContext = await buildICPContext();
    const painStr = leadData.painPoints.join(", ") || "M365 adoption challenges";

    const OUTREACH_DEFAULTS: Record<string, string> = {
      cold_email: `Write a concise, personalized cold email from Shane McCaw (Lead Microsoft 365 Architect, 30-year Microsoft veteran, NASA M365 architect) to {{name}} at {{company}} ({{role}}, {{industry}}). Pain points: {{painPoints}}. Context: {{icpContext}}. Keep it short, no fluff, specific value prop, clear CTA. Format: SUBJECT: ...\n\nBODY: ...`,
      linkedin:   `Write a LinkedIn connection request message from Shane McCaw to {{name}} at {{company}}. 300 chars max. Reference their {{industry}} context and offer value around Microsoft 365. No salesy language. Be specific.`,
      followup:   `Write a 3-touch follow-up email sequence from Shane McCaw to {{name}} at {{company}} who hasn't responded to the initial outreach. Pain points: {{painPoints}}. Each email shorter and a different angle. Format: EMAIL 1:\nSUBJECT: ...\nBODY: ...\n\nEMAIL 2:\nSUBJECT: ...\nBODY: ...\n\nEMAIL 3:\nSUBJECT: ...\nBODY: ...`,
      cold_call:  `Write a cold call script for Shane McCaw to call {{name}} at {{company}} ({{role}}, {{industry}}). Include: opener (5 sec), permission ask, value prop (15 sec), pain-point discovery question, objection handler for "not interested", CTA. Keep under 90 seconds conversational flow.`,
    };
    const OUTREACH_KEYS: Record<string, string> = {
      cold_email: "marketing-outreach-cold-email",
      linkedin:   "marketing-outreach-linkedin",
      followup:   "marketing-outreach-followup",
      cold_call:  "marketing-outreach-cold-call",
    };
    const templateType = body.templateType in OUTREACH_KEYS ? body.templateType : "cold_email";
    const outreachDefault = OUTREACH_DEFAULTS[templateType] ?? OUTREACH_DEFAULTS["cold_email"] ?? "";
    const outreachTemplate = await getPrompt(OUTREACH_KEYS[templateType] ?? "marketing-outreach-cold-email", outreachDefault);
    const prompt = outreachTemplate
      .replace(/\{\{name\}\}/g, leadData.name)
      .replace(/\{\{company\}\}/g, leadData.company)
      .replace(/\{\{role\}\}/g, leadData.role)
      .replace(/\{\{industry\}\}/g, leadData.industry)
      .replace(/\{\{painPoints\}\}/g, painStr)
      .replace(/\{\{icpContext\}\}/g, icpContext);
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1200,
      messages: [{ role: "user", content: prompt }],
    });

    const content = message.content[0];
    if (content?.type !== "text") throw new Error("Unexpected response type");

    if (body.recommendedLeadId) {
      await db.update(recommendedLeadsTable)
        .set({ lastOutreachDraft: content.text })
        .where(eq(recommendedLeadsTable.id, body.recommendedLeadId));
    }

    res.json({ content: content.text, templateType: body.templateType, leadName: leadData.name });
  } catch (e) {
    if (e instanceof AiResponseError || (e instanceof Error && e.message === "Unexpected response type")) {
      req.log.warn({ err: e }, "AI generation failed on /generate/outreach");
      res.json({ ...aiErrorResponse(e), content: "", templateType: (req.body as Record<string, unknown>).templateType ?? "cold_email", leadName: "" });
      return;
    }
    res.status(500).json({ error: String(e) });
  }
});

const generateContentSchema = z.object({
  contentType: z.enum(["blog_post", "linkedin_post", "newsletter", "social_post", "seo_keywords"]),
  topic: z.string(),
  tone: z.string().optional(),
  keywords: z.string().optional(),
});

router.post("/admin/marketing/generate/content", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = generateContentSchema.parse(req.body);
    const icpContext = await buildICPContext();

    const prompts: Record<string, string> = {
      blog_post: `Write a detailed blog post for Shane McCaw Consulting about: "${body.topic}". Context about the firm's ICP: ${icpContext}. Tone: ${body.tone ?? "professional, authoritative"}. Keywords: ${body.keywords ?? "Microsoft 365, Copilot AI, digital transformation"}. Include: SEO headline, compelling intro, 3-4 sections with subheadings, actionable insights, conclusion with CTA. Target: IT decision-makers at mid-market companies.`,
      linkedin_post: `Write an engaging LinkedIn post for Shane McCaw (Microsoft 365 Expert, NASA architect) about: "${body.topic}". ICP context: ${icpContext}. Tone: ${body.tone ?? "thought leadership, conversational"}. Include a hook, key insight, practical takeaway, and soft CTA. 1200 chars max. Use line breaks for readability.`,
      newsletter: `Write an email newsletter from Shane McCaw about: "${body.topic}". ICP context: ${icpContext}. Include: subject line, preview text (60 chars), personal greeting, main content with practical insights, one soft CTA. Tone: ${body.tone ?? "expert, helpful"}. 400-600 words.`,
      social_post: `Write 3 social media posts for Shane McCaw Consulting about: "${body.topic}". ICP context: ${icpContext}. Tone: ${body.tone ?? "professional"}. Keywords: ${body.keywords ?? "Microsoft 365"}. Format each:\nLINKEDIN:\n...\n\nTWITTER/X:\n...\n\nFACEBOOK:\n...`,
      seo_keywords: `Generate 20 high-value SEO keywords for a Microsoft 365 consulting firm blog post about: "${body.topic}". ICP context: ${icpContext}. Include: 5 primary keywords (high volume), 5 secondary keywords, 5 long-tail phrases, 5 question-based keywords (People Also Ask format). Format as a clean list with category labels.`,
    };

    const prompt = prompts[body.contentType] ?? "";
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1800,
      messages: [{ role: "user", content: prompt }],
    });

    const content = message.content[0];
    if (content?.type !== "text") throw new Error("Unexpected response type");

    res.json({ content: content.text, contentType: body.contentType });
  } catch (e) {
    if (e instanceof AiResponseError || (e instanceof Error && e.message === "Unexpected response type")) {
      req.log.warn({ err: e }, "AI generation failed on /generate/content");
      res.json({ ...aiErrorResponse(e), content: "", contentType: (req.body as Record<string, unknown>).contentType ?? "blog_post" });
      return;
    }
    res.status(500).json({ error: String(e) });
  }
});

// ─── Campaign asset preview (no DB write) ────────────────────────────────────

const campaignPreviewSchema = z.object({
  name: z.string(),
  goal: z.string(),
  audience: z.string(),
  offer: z.string(),
});

router.post("/admin/marketing/campaigns/preview-assets", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = campaignPreviewSchema.parse(req.body);

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 4096,
      messages: [{
        role: "user",
        content: `You are a marketing strategist for Shane McCaw Consulting, a Microsoft 365 consulting firm.

Campaign Brief:
- Name: ${body.name}
- Goal: ${body.goal}
- Target Audience: ${body.audience}
- Offer: ${body.offer}

Generate concise campaign assets. Keep each content field short (2-5 sentences or bullet points max per section). Respond with JSON only (no markdown, no code fences):
{"landing_copy":{"title":"Landing Page Copy","content":"HEADLINE: ...\\nSUBHEAD: ...\\n• Value prop 1\\n• Value prop 2\\n• Value prop 3\\nCTA: ..."},"email_sequence":{"title":"3-Email Sequence","content":"EMAIL 1 - Subject: ...\\nBody: 2-3 sentences.\\n\\nEMAIL 2 - Subject: ...\\nBody: 2-3 sentences.\\n\\nEMAIL 3 - Subject: ...\\nBody: 2-3 sentences."},"social_posts":{"title":"Social Media Posts","content":"LINKEDIN: 2-3 sentences + hashtags\\n\\nX/TWITTER: 1 sentence + hashtags\\n\\nFACEBOOK: 2 sentences + hashtags"},"follow_up_tasks":{"title":"Follow-Up Task List","content":"1. ...\\n2. ...\\n3. ...\\n4. ...\\n5. ..."}}`,
      }],
    });

    const textContent = message.content[0];
    if (textContent?.type !== "text") throw new Error("Unexpected response type");

    const assets = parseAiJson(textContent.text, z.record(z.object({ title: z.string(), content: z.string() })));

    type AssetType = "landing_copy" | "email_sequence" | "social_post" | "follow_up_task";
    const assetTypeMap: Record<string, AssetType> = {
      landing_copy: "landing_copy",
      email_sequence: "email_sequence",
      social_posts: "social_post",
      follow_up_tasks: "follow_up_task",
    };

    const preview = Object.entries(assets).map(([key, val]) => ({
      assetType: assetTypeMap[key] ?? "social_post",
      title: val.title,
      content: val.content,
    }));

    res.json(preview);
  } catch (e) {
    if (e instanceof AiResponseError) { req.log.warn({ err: e }, "AI parse failed on /campaigns/preview-assets"); res.json(aiErrorResponse(e)); return; }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── AI Suggest: Outreach Prospect ────────────────────────────────────────────

router.post("/admin/marketing/generate/outreach-suggest", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { templateType } = req.body as { templateType?: string };
    const icpContext = await buildICPContext();

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 400,
      messages: [{
        role: "user",
        content: `You are a B2B sales specialist for Shane McCaw Consulting, a Microsoft 365 consulting firm.

${icpContext}

Generate one realistic ICP-matched prospect suitable for a "${templateType ?? "cold_email"}" outreach.
Respond with JSON only (no markdown):
{"name":"First Last","company":"Company Name","role":"Job Title","industry":"Industry"}`,
      }],
    });

    const content = message.content[0];
    if (content?.type !== "text") throw new Error("Unexpected response type");
    const prospect = parseAiJson(content.text, z.object({ name: z.string(), company: z.string(), role: z.string(), industry: z.string() }));
    res.json(prospect);
  } catch (e) {
    if (e instanceof AiResponseError) { req.log.warn({ err: e }, "AI parse failed on /generate/outreach-suggest"); res.json({ ...aiErrorResponse(e), name: "", company: "", role: "", industry: "" }); return; }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── AI Suggest: Content Idea ─────────────────────────────────────────────────

router.post("/admin/marketing/generate/content-suggest", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { contentType } = req.body as { contentType?: string };
    const icpContext = await buildICPContext();

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 400,
      messages: [{
        role: "user",
        content: `You are a content strategist for Shane McCaw Consulting, a Microsoft 365 consulting firm.

${icpContext}

Suggest one on-brand content idea for a "${contentType ?? "blog_post"}".
Respond with JSON only (no markdown):
{"topic":"Topic title here","tone":"e.g. authoritative, conversational","keywords":"keyword1, keyword2, keyword3"}`,
      }],
    });

    const content = message.content[0];
    if (content?.type !== "text") throw new Error("Unexpected response type");
    const idea = parseAiJson(content.text, z.object({ topic: z.string(), tone: z.string(), keywords: z.string() }));
    res.json(idea);
  } catch (e) {
    if (e instanceof AiResponseError) { req.log.warn({ err: e }, "AI parse failed on /generate/content-suggest"); res.json({ ...aiErrorResponse(e), topic: "", tone: "", keywords: "" }); return; }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── AI Suggest: Marketing Tasks ──────────────────────────────────────────────

router.post("/admin/marketing/generate/task-suggestions", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const icpContext = await buildICPContext();

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: `You are a marketing strategist for Shane McCaw Consulting, a Microsoft 365 consulting firm.

${icpContext}

Generate 6 prioritised, actionable marketing and sales tasks tailored to Shane's services and ICP.
Respond with a JSON array only (no markdown):
[{"title":"Task title","description":"Brief description of what to do and why"}]`,
      }],
    });

    const content = message.content[0];
    if (content?.type !== "text") throw new Error("Unexpected response type");
    const suggestions = parseAiJson(content.text, z.array(z.object({ title: z.string(), description: z.string() })));

    res.json(suggestions);
  } catch (e) {
    if (e instanceof AiResponseError) { logger.warn({ err: e }, "AI parse failed on /generate/task-suggestions"); res.json(aiErrorResponse(e)); return; }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── AI Suggest: Campaign Field ───────────────────────────────────────────────

router.post("/admin/marketing/generate/campaign-topics", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { exclude } = req.body as { exclude?: string[] };
    const icpContext = await buildICPContext();
    const exclusionLine = Array.isArray(exclude) && exclude.length > 0
      ? `\nDo NOT suggest any of these (already shown): ${exclude.map(t => `"${t}"`).join(", ")}. Generate 5 completely different topics.`
      : "";

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 400,
      messages: [{
        role: "user",
        content: `You are a marketing strategist for Shane McCaw Consulting, a Microsoft 365 consulting firm led by a 30-year Microsoft veteran.

${icpContext}

Generate exactly 5 short campaign topic ideas relevant to Microsoft 365 consulting. Each topic should be 2-6 words, punchy, and specific (e.g. "Microsoft Copilot Adoption", "Teams Governance Rollout", "SharePoint Intranet Launch").${exclusionLine}

Respond with JSON only (no markdown): {"topics":["Topic One","Topic Two","Topic Three","Topic Four","Topic Five"]}`,
      }],
    });

    const content = message.content[0];
    if (content?.type !== "text") throw new Error("Unexpected response type");
    const result = parseAiJson(content.text, z.object({ topics: z.array(z.string()).length(5) }));
    res.json(result);
  } catch (e) {
    if (e instanceof AiResponseError) { res.json(aiErrorResponse(e)); return; }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/admin/marketing/generate/campaign-suggest", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { field, name, goal, audience, topic } = req.body as {
      field: "goal" | "audience" | "offer";
      name?: string;
      goal?: string;
      audience?: string;
      topic?: string;
    };
    const icpContext = await buildICPContext();

    const fieldPrompts: Record<string, string> = {
      goal: topic
        ? `Write a single specific, measurable campaign goal sentence centred on the topic "${topic}" for a Microsoft 365 consulting firm. Context: ${icpContext}. Return one concise goal sentence (1-2 sentences).`
        : `Suggest a specific, measurable campaign goal for a Microsoft 365 consulting firm. Campaign name: "${name ?? "new campaign"}". Context: ${icpContext}. Return one concise goal sentence (1-2 sentences).`,
      audience: topic
        ? `Write a specific target audience description for the audience segment "${topic}" for a Microsoft 365 consulting campaign with goal: "${goal ?? "generate leads"}". Context: ${icpContext}. Return one concise audience paragraph (2-3 sentences).`
        : `Suggest a target audience description for a Microsoft 365 consulting campaign with goal: "${goal ?? "generate leads"}". Context: ${icpContext}. Return one concise audience paragraph.`,
      offer: topic
        ? `Write a compelling offer description focused on "${topic}" for a Microsoft 365 consulting campaign targeting "${audience ?? "IT decision-makers"}" with goal "${goal ?? "generate leads"}". Context: ${icpContext}. Return one concise offer description (1-2 sentences).`
        : `Suggest a compelling offer for a Microsoft 365 consulting campaign targeting "${audience ?? "IT decision-makers"}" with goal "${goal ?? "generate leads"}". Context: ${icpContext}. Return one concise offer description (1-2 sentences).`,
    };

    const prompt = fieldPrompts[field];
    if (!prompt) { res.status(400).json({ error: "Invalid field" }); return; }

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: `You are a marketing strategist for Shane McCaw Consulting, a Microsoft 365 consulting firm. ${prompt} Respond with JSON only (no markdown): {"value":"your suggestion here"}`,
      }],
    });

    const content = message.content[0];
    if (content?.type !== "text") throw new Error("Unexpected response type");
    const result = parseAiJson(content.text, z.object({ value: z.string() }));
    res.json(result);
  } catch (e) {
    if (e instanceof AiResponseError) { req.log.warn({ err: e }, "AI parse failed on /generate/campaign-suggest"); res.json({ ...aiErrorResponse(e), value: "" }); return; }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/admin/marketing/generate/audience-topics", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { goal, exclude } = req.body as { goal?: string; exclude?: string[] };
    const icpContext = await buildICPContext();
    const exclusionLine = Array.isArray(exclude) && exclude.length > 0
      ? `\nDo NOT suggest any of these (already shown): ${exclude.map(t => `"${t}"`).join(", ")}. Generate 5 completely different audience segments.`
      : "";

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 400,
      messages: [{
        role: "user",
        content: `You are a marketing strategist for Shane McCaw Consulting, a Microsoft 365 consulting firm led by a 30-year Microsoft veteran.

${icpContext}

Campaign goal: "${goal ?? "generate leads for Microsoft 365 consulting"}"

Generate exactly 5 short target audience segment labels relevant to this campaign. Each should be 3-7 words, specific and job-role focused (e.g. "IT Directors — Healthcare", "CTOs at Mid-Market SaaS", "Government IT Managers").${exclusionLine}

Respond with JSON only (no markdown): {"topics":["Audience One","Audience Two","Audience Three","Audience Four","Audience Five"]}`,
      }],
    });

    const content = message.content[0];
    if (content?.type !== "text") throw new Error("Unexpected response type");
    const result = parseAiJson(content.text, z.object({ topics: z.array(z.string()).length(5) }));
    res.json(result);
  } catch (e) {
    if (e instanceof AiResponseError) { res.json(aiErrorResponse(e)); return; }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post("/admin/marketing/generate/offer-topics", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { goal, audience, exclude } = req.body as { goal?: string; audience?: string; exclude?: string[] };
    const icpContext = await buildICPContext();
    const exclusionLine = Array.isArray(exclude) && exclude.length > 0
      ? `\nDo NOT suggest any of these (already shown): ${exclude.map(t => `"${t}"`).join(", ")}. Generate 5 completely different offer ideas.`
      : "";

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 400,
      messages: [{
        role: "user",
        content: `You are a marketing strategist for Shane McCaw Consulting, a Microsoft 365 consulting firm led by a 30-year Microsoft veteran.

${icpContext}

Campaign goal: "${goal ?? "generate leads"}"
Target audience: "${audience ?? "IT decision-makers"}"

Generate exactly 5 short offer idea labels for this campaign. Each should be 3-7 words, compelling and specific (e.g. "Free Copilot Assessment", "30-Day M365 Audit", "SharePoint Quick-Start Package").${exclusionLine}

Respond with JSON only (no markdown): {"topics":["Offer One","Offer Two","Offer Three","Offer Four","Offer Five"]}`,
      }],
    });

    const content = message.content[0];
    if (content?.type !== "text") throw new Error("Unexpected response type");
    const result = parseAiJson(content.text, z.object({ topics: z.array(z.string()).length(5) }));
    res.json(result);
  } catch (e) {
    if (e instanceof AiResponseError) { res.json(aiErrorResponse(e)); return; }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── Outreach Templates ───────────────────────────────────────────────────────

router.get("/admin/marketing/outreach-templates", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(outreachTemplatesTable).orderBy(desc(outreachTemplatesTable.createdAt));
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.post("/admin/marketing/outreach-templates", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name, templateType, subject, body, leadId } = req.body as {
      name: string; templateType: "cold_email" | "linkedin" | "followup" | "cold_call";
      subject?: string; body: string; leadId?: number;
    };
    const [row] = await db.insert(outreachTemplatesTable)
      .values({ name, templateType, subject: subject ?? null, body, leadId: leadId ?? null })
      .returning();
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.patch("/admin/marketing/outreach-templates/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    const { name, templateType, subject, body } = req.body as {
      name?: string; templateType?: "cold_email" | "linkedin" | "followup" | "cold_call";
      subject?: string; body?: string;
    };
    const updateData: Partial<typeof outreachTemplatesTable.$inferInsert> & { updatedAt: Date } = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = name;
    if (templateType !== undefined) updateData.templateType = templateType;
    if (subject !== undefined) updateData.subject = subject;
    if (body !== undefined) updateData.body = body;
    const [row] = await db.update(outreachTemplatesTable).set(updateData).where(eq(outreachTemplatesTable.id, id)).returning();
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.delete("/admin/marketing/outreach-templates/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    await db.delete(outreachTemplatesTable).where(eq(outreachTemplatesTable.id, id));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Marketing Tasks ──────────────────────────────────────────────────────────

router.get("/admin/marketing/tasks", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(marketingTasksTable).orderBy(marketingTasksTable.order, desc(marketingTasksTable.createdAt));
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.post("/admin/marketing/tasks", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { title, description, status, dueDate, relatedLeadId, relatedCampaignId } = req.body as {
      title: string; description?: string; status?: "ideas" | "in_progress" | "scheduled" | "published" | "completed";
      dueDate?: string; relatedLeadId?: number; relatedCampaignId?: number;
    };
    const [row] = await db.insert(marketingTasksTable).values({
      title,
      description: description ?? null,
      status: status ?? "ideas",
      dueDate: dueDate ? new Date(dueDate) : null,
      relatedLeadId: relatedLeadId ?? null,
      relatedCampaignId: relatedCampaignId ?? null,
    }).returning();
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.patch("/admin/marketing/tasks/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    const { title, description, status, dueDate, order, relatedLeadId, relatedCampaignId } = req.body as {
      title?: string; description?: string;
      status?: "ideas" | "in_progress" | "scheduled" | "published" | "completed";
      dueDate?: string | null; order?: number; relatedLeadId?: number | null; relatedCampaignId?: number | null;
    };
    const updateData: Partial<typeof marketingTasksTable.$inferInsert> & { updatedAt: Date } = { updatedAt: new Date() };
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (status !== undefined) updateData.status = status;
    if (dueDate !== undefined) updateData.dueDate = dueDate ? new Date(dueDate) : null;
    if (order !== undefined) updateData.order = order;
    if (relatedLeadId !== undefined) updateData.relatedLeadId = relatedLeadId;
    if (relatedCampaignId !== undefined) updateData.relatedCampaignId = relatedCampaignId;
    const [row] = await db.update(marketingTasksTable).set(updateData).where(eq(marketingTasksTable.id, id)).returning();
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.delete("/admin/marketing/tasks/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    await db.delete(marketingTasksTable).where(eq(marketingTasksTable.id, id));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Campaigns ────────────────────────────────────────────────────────────────

router.get("/admin/marketing/campaigns", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select({
        id: campaignsTable.id,
        name: campaignsTable.name,
        goal: campaignsTable.goal,
        audience: campaignsTable.audience,
        offer: campaignsTable.offer,
        status: campaignsTable.status,
        startDate: campaignsTable.startDate,
        endDate: campaignsTable.endDate,
        leadsGenerated: campaignsTable.leadsGenerated,
        emailsSent: campaignsTable.emailsSent,
        revenueAttributed: campaignsTable.revenueAttributed,
        createdAt: campaignsTable.createdAt,
        updatedAt: campaignsTable.updatedAt,
        emailsSentAuto: count(emailEventsTable.id),
      })
      .from(campaignsTable)
      .leftJoin(
        emailEventsTable,
        and(
          eq(emailEventsTable.campaignId, campaignsTable.id),
          eq(emailEventsTable.eventType, "sent"),
        )
      )
      .groupBy(campaignsTable.id)
      .orderBy(desc(campaignsTable.createdAt));
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.post("/admin/marketing/campaigns/build-from-prompt", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { prompt } = req.body as { prompt?: string };
    if (!prompt?.trim()) { res.status(400).json({ error: "prompt is required" }); return; }
    const icpContext = await buildICPContext();

    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 800,
      messages: [{
        role: "user",
        content: `You are a marketing strategist for Shane McCaw Consulting, a Microsoft 365 consulting firm led by a 30-year Microsoft veteran.

${icpContext}

The user has described this campaign:
"""
${prompt.trim()}
"""

Extract a complete campaign from this brief. Respond ONLY with valid JSON (no prose, no markdown):
{
  "name": "campaign name, 3-6 words",
  "goal": "specific measurable campaign goal, 1-2 sentences",
  "audience": "detailed target audience description, 2-3 sentences",
  "offer": "compelling offer description, 1-2 sentences"
}`,
      }],
    });

    const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
    const schema = z.object({
      name: z.string().min(1),
      goal: z.string().min(1),
      audience: z.string().min(1),
      offer: z.string().min(1),
    });
    const fields = parseAiJson(raw, schema);

    const [campaign] = await db.insert(campaignsTable)
      .values({ name: fields.name, goal: fields.goal, audience: fields.audience, offer: fields.offer, status: "draft" })
      .returning();

    if (fields.offer.trim()) {
      await db.insert(offersTable).values({
        name: fields.offer, goal: fields.goal, audience: fields.audience, campaignId: campaign.id,
      });
    }

    res.status(201).json(campaign);
  } catch (e) {
    if (e instanceof AiResponseError) {
      res.status(422).json({ error: "AI could not extract a campaign from your prompt — try adding more detail about the goal, audience, and offer." });
      return;
    }
    res.status(500).json({ error: String(e) });
  }
});

router.post("/admin/marketing/campaigns", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { name, goal, audience, offer, status } = req.body as {
      name: string; goal: string; audience: string; offer: string;
      status?: "draft" | "active" | "paused" | "completed";
    };
    const [row] = await db.insert(campaignsTable)
      .values({ name, goal, audience, offer, status: status ?? "draft" })
      .returning();
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.patch("/admin/marketing/campaigns/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    const { name, goal, audience, offer, status, leadsGenerated, emailsSent, revenueAttributed } = req.body as {
      name?: string; goal?: string; audience?: string; offer?: string;
      status?: "draft" | "active" | "paused" | "completed";
      leadsGenerated?: number; emailsSent?: number; revenueAttributed?: number;
    };
    const updateData: Partial<typeof campaignsTable.$inferInsert> & { updatedAt: Date } = { updatedAt: new Date() };
    if (name !== undefined) updateData.name = name;
    if (goal !== undefined) updateData.goal = goal;
    if (audience !== undefined) updateData.audience = audience;
    if (offer !== undefined) updateData.offer = offer;
    if (status !== undefined) updateData.status = status;
    if (leadsGenerated !== undefined) updateData.leadsGenerated = leadsGenerated;
    if (emailsSent !== undefined) updateData.emailsSent = emailsSent;
    if (revenueAttributed !== undefined) updateData.revenueAttributed = String(revenueAttributed);
    const [row] = await db.update(campaignsTable).set(updateData).where(eq(campaignsTable.id, id)).returning();
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.delete("/admin/marketing/campaigns/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    await db.delete(campaignsTable).where(eq(campaignsTable.id, id));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Campaign 360° Detail ─────────────────────────────────────────────────────

router.get("/admin/marketing/campaigns/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    const [campaign] = await db
      .select({
        id: campaignsTable.id,
        name: campaignsTable.name,
        goal: campaignsTable.goal,
        audience: campaignsTable.audience,
        offer: campaignsTable.offer,
        status: campaignsTable.status,
        leadsGenerated: campaignsTable.leadsGenerated,
        emailsSent: campaignsTable.emailsSent,
        revenueAttributed: campaignsTable.revenueAttributed,
        createdAt: campaignsTable.createdAt,
        updatedAt: campaignsTable.updatedAt,
        emailsSentAuto: count(emailEventsTable.id),
      })
      .from(campaignsTable)
      .leftJoin(emailEventsTable, and(eq(emailEventsTable.campaignId, campaignsTable.id), eq(emailEventsTable.eventType, "sent")))
      .where(eq(campaignsTable.id, id))
      .groupBy(campaignsTable.id)
      .limit(1);

    if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }

    const [assets, landingPages, offers, emailEvents] = await Promise.all([
      db.select().from(campaignAssetsTable).where(eq(campaignAssetsTable.campaignId, id)).orderBy(campaignAssetsTable.assetType, desc(campaignAssetsTable.createdAt)),
      db.select({
        id: landingPagesTable.id, slug: landingPagesTable.slug, title: landingPagesTable.title,
        headline: landingPagesTable.headline, published: landingPagesTable.published, createdAt: landingPagesTable.createdAt,
      }).from(landingPagesTable).where(eq(landingPagesTable.campaignId, id)).orderBy(desc(landingPagesTable.createdAt)),
      db.select({
        id: offersTable.id, name: offersTable.name, pricing: offersTable.pricing,
        deliverables: offersTable.deliverables, outcomes: offersTable.outcomes, createdAt: offersTable.createdAt,
      }).from(offersTable).where(eq(offersTable.campaignId, id)).orderBy(desc(offersTable.createdAt)),
      db.select({
        id: emailEventsTable.id, subject: emailEventsTable.subject, recipient: emailEventsTable.recipient,
        eventType: emailEventsTable.eventType, occurredAt: emailEventsTable.occurredAt,
      }).from(emailEventsTable).where(eq(emailEventsTable.campaignId, id)).orderBy(desc(emailEventsTable.occurredAt)).limit(50),
    ]);

    res.json({ campaign, assets, landingPages, offers, emailEvents });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Campaign ↔ Offer / Landing-Page associations ─────────────────────────────

router.get("/admin/marketing/campaigns/:id/offers", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    const rows = await db.select().from(offersTable).where(eq(offersTable.campaignId, id)).orderBy(desc(offersTable.createdAt));
    res.json(rows);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.get("/admin/marketing/campaigns/:id/landing-pages", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    const rows = await db.select().from(landingPagesTable).where(eq(landingPagesTable.campaignId, id)).orderBy(desc(landingPagesTable.createdAt));
    res.json(rows);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.post("/admin/marketing/campaigns/:id/offers/:offerId/link", requireAdmin, async (req: Request, res: Response) => {
  try {
    const campaignId = parseId(req.params, "id");
    const offerId = parseId(req.params, "offerId");
    const [row] = await db.update(offersTable).set({ campaignId, updatedAt: new Date() }).where(eq(offersTable.id, offerId)).returning();
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.delete("/admin/marketing/campaigns/:id/offers/:offerId/link", requireAdmin, async (req: Request, res: Response) => {
  try {
    const offerId = parseId(req.params, "offerId");
    const [row] = await db.update(offersTable).set({ campaignId: null, updatedAt: new Date() }).where(eq(offersTable.id, offerId)).returning();
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.post("/admin/marketing/campaigns/:id/landing-pages/:pageId/link", requireAdmin, async (req: Request, res: Response) => {
  try {
    const campaignId = parseId(req.params, "id");
    const pageId = parseId(req.params, "pageId");
    const [row] = await db.update(landingPagesTable).set({ campaignId, updatedAt: new Date() }).where(eq(landingPagesTable.id, pageId)).returning();
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

router.delete("/admin/marketing/campaigns/:id/landing-pages/:pageId/link", requireAdmin, async (req: Request, res: Response) => {
  try {
    const pageId = parseId(req.params, "pageId");
    const [row] = await db.update(landingPagesTable).set({ campaignId: null, updatedAt: new Date() }).where(eq(landingPagesTable.id, pageId)).returning();
    res.json(row);
  } catch (e) { res.status(500).json({ error: String(e) }); }
});

// ─── Campaign Assets ──────────────────────────────────────────────────────────

router.get("/admin/marketing/campaign-assets", requireAdmin, async (req: Request, res: Response) => {
  try {
    const campaignId = req.query["campaignId"] ? parseInt(String(req.query["campaignId"]), 10) : null;
    const assetType = req.query["assetType"] ? String(req.query["assetType"]) : null;

    const conditions = [];
    if (campaignId) conditions.push(eq(campaignAssetsTable.campaignId, campaignId));
    if (assetType) conditions.push(eq(campaignAssetsTable.assetType, assetType as typeof campaignAssetsTable.$inferSelect["assetType"]));

    const rows = await db.select().from(campaignAssetsTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(campaignAssetsTable.createdAt))
      .limit(50);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.get("/admin/marketing/campaigns/:id/assets", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    const rows = await db.select().from(campaignAssetsTable)
      .where(eq(campaignAssetsTable.campaignId, id))
      .orderBy(campaignAssetsTable.assetType);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.post("/admin/marketing/campaign-assets", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { campaignId, assetType, title, content } = req.body as {
      campaignId?: number; assetType: string; title: string; content: string;
    };
    type AssetType = "landing_copy" | "email_sequence" | "social_post" | "follow_up_task" | "blog_post" | "linkedin_post" | "newsletter" | "seo_keywords";
    const generatedWithOfferIds = campaignId
      ? (await db.select({ id: offersTable.id }).from(offersTable).where(eq(offersTable.campaignId, campaignId))).map(o => o.id)
      : [];
    const [row] = await db.insert(campaignAssetsTable)
      .values({ campaignId: campaignId ?? null, assetType: assetType as AssetType, title, content, generatedWithOfferIds })
      .returning();
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.patch("/admin/marketing/campaign-assets/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    const { title, content, assetType, campaignId } = req.body as { title?: string; content?: string; assetType?: string; campaignId?: number | null };
    type AssetType = "landing_copy" | "email_sequence" | "social_post" | "follow_up_task" | "blog_post" | "linkedin_post" | "newsletter" | "seo_keywords";
    const updateData: Partial<typeof campaignAssetsTable.$inferInsert> = {};
    if (title !== undefined) updateData.title = title;
    if (content !== undefined) updateData.content = content;
    if (assetType !== undefined) updateData.assetType = assetType as AssetType;
    if (campaignId !== undefined) {
      updateData.campaignId = campaignId ?? null;
      if (campaignId != null) {
        updateData.generatedWithOfferIds = null;
      }
    }
    const [row] = await db.update(campaignAssetsTable).set(updateData).where(eq(campaignAssetsTable.id, id)).returning();
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.delete("/admin/marketing/campaign-assets/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    await db.delete(campaignAssetsTable).where(eq(campaignAssetsTable.id, id));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Bulk save assets for a campaign (called after user confirms wizard)
const campaignSaveAssetsSchema = z.object({
  campaignId: z.number(),
  assets: z.array(z.object({
    assetType: z.string(),
    title: z.string(),
    content: z.string(),
  })),
});

router.post("/admin/marketing/campaigns/save-assets", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = campaignSaveAssetsSchema.parse(req.body);
    type AssetType = "landing_copy" | "email_sequence" | "social_post" | "follow_up_task" | "blog_post" | "linkedin_post" | "newsletter" | "seo_keywords";
    const currentOffers = await db.select({ id: offersTable.id }).from(offersTable).where(eq(offersTable.campaignId, body.campaignId));
    const generatedWithOfferIds = currentOffers.map(o => o.id);
    const inserted = await db.insert(campaignAssetsTable)
      .values(body.assets.map(a => ({
        campaignId: body.campaignId,
        assetType: a.assetType as AssetType,
        title: a.title,
        content: a.content,
        generatedWithOfferIds,
      })))
      .returning();
    res.json(inserted);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Ad Generation endpoint ───────────────────────────────────────────────────

const generateAdsSchema = z.object({
  campaignId: z.number(),
  adType: z.enum(["ad_google", "ad_linkedin", "ad_retargeting", "ad_creative", "landing_page"]),
  topic: z.string().min(1),
  offer: z.string().optional().default(""),
  angle: z.string().optional().default(""),
  audience: z.string().optional().default(""),
  destinationPath: z.string().optional(),
});

const adVariationSchema = z.object({
  headline: z.string(),
  description: z.string(),
  cta: z.string().optional(),
  url: z.string().optional(),
});

// ─── UTM helpers ──────────────────────────────────────────────────────────────

const AD_TYPE_UTM: Record<string, { source: string; medium: string; page: string }> = {
  ad_google:      { source: "google",   medium: "cpc",        page: "/contact" },
  ad_linkedin:    { source: "linkedin", medium: "paid-social", page: "/contact" },
  ad_retargeting: { source: "google",   medium: "display",    page: "/contact" },
  ad_creative:    { source: "display",  medium: "banner",     page: "/contact" },
  landing_page:   { source: "paid",     medium: "cpc",        page: "/" },
};

function slugifyForUtm(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
}

function getPublicSiteBase(): string {
  const domains = (process.env.REPLIT_DOMAINS ?? "")
    .split(",").map((d) => d.trim()).filter(Boolean);
  const custom = domains.find((d) => !d.includes("replit."));
  if (custom) return `https://${custom}`;
  const app = domains.find((d) => d.endsWith(".replit.app"));
  if (app) return `https://${app}`;
  const dev = domains.find((d) => d.endsWith(".replit.dev")) ?? process.env.REPLIT_DEV_DOMAIN;
  if (dev) return `https://${dev}`;
  return "https://shanemccaw.com";
}

function buildUtmUrl(adType: string, campaignSlug: string, variationIdx: number, destinationPath?: string): string {
  const base = getPublicSiteBase();
  const { source, medium, page } = AD_TYPE_UTM[adType] ?? { source: "paid", medium: "cpc", page: "/contact" };
  const effectivePage = destinationPath ?? page;
  const params = new URLSearchParams({
    utm_source: source,
    utm_medium: medium,
    utm_campaign: campaignSlug,
    utm_content: `var-${variationIdx + 1}`,
  });
  return `${base}${effectivePage}?${params.toString()}`;
}

router.post("/admin/marketing/campaigns/generate-ads", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = generateAdsSchema.parse(req.body);

    const [campaignRow] = await db.select().from(campaignsTable).where(eq(campaignsTable.id, body.campaignId));
    if (!campaignRow) {
      res.status(404).json({ error: `Campaign ${body.campaignId} not found — it may not have saved correctly. Please go back and retry saving the campaign.` });
      return;
    }
    const icpContext = await buildICPContext();

    const campaignContext = `Campaign goal: ${campaignRow.goal}\nCampaign audience: ${campaignRow.audience}\nCampaign offer: ${campaignRow.offer}`;

    const audience = body.audience || campaignRow?.audience || "IT decision-makers at mid-market companies";
    const offer = body.offer || campaignRow?.offer || body.topic;
    const angle = body.angle || "benefit-focused";

    const prompts: Record<string, string> = {
      ad_google: `You are a Google Ads copywriter for Shane McCaw Consulting, a Microsoft 365 consulting firm.

${icpContext}
${campaignContext}

Topic: ${body.topic}
Offer: ${offer}
Angle: ${angle}
Audience: ${audience}

Generate 3 Google Search Ad variations. Each variation must have:
- headline: max 30 characters (STRICT — count carefully)
- description: max 90 characters (STRICT — count carefully)
- cta: 2-4 words call to action

Respond ONLY with valid JSON, no prose:
{
  "variations": [
    { "headline": "...", "description": "...", "cta": "..." },
    { "headline": "...", "description": "...", "cta": "..." },
    { "headline": "...", "description": "...", "cta": "..." }
  ]
}`,
      ad_linkedin: `You are a LinkedIn Ads specialist for Shane McCaw Consulting, a Microsoft 365 consulting firm.

${icpContext}
${campaignContext}

Topic: ${body.topic}
Offer: ${offer}
Angle: ${angle}
Audience: ${audience}

Generate 3 LinkedIn Sponsored Content ad variations. Each variation must have:
- headline: 70 characters max, attention-grabbing
- description: 150 characters max, benefit-driven intro text
- cta: one of "Learn More", "Sign Up", "Download", "Register", "Get Quote", "Contact Us"

Respond ONLY with valid JSON, no prose:
{
  "variations": [
    { "headline": "...", "description": "...", "cta": "..." },
    { "headline": "...", "description": "...", "cta": "..." },
    { "headline": "...", "description": "...", "cta": "..." }
  ]
}`,
      ad_retargeting: `You are a retargeting ad specialist for Shane McCaw Consulting, a Microsoft 365 consulting firm.

${icpContext}
${campaignContext}

Topic: ${body.topic}
Offer: ${offer}
Angle: ${angle}
Audience: ${audience} (these users already visited the site)

Generate 3 retargeting ad variations designed to re-engage warm visitors. Each variation must have:
- headline: 60 characters max, urgency or value reinforcement
- description: 120 characters max, addressing hesitation or reinforcing the offer
- cta: short action phrase

Respond ONLY with valid JSON, no prose:
{
  "variations": [
    { "headline": "...", "description": "...", "cta": "..." },
    { "headline": "...", "description": "...", "cta": "..." },
    { "headline": "...", "description": "...", "cta": "..." }
  ]
}`,
      ad_creative: `You are a creative director briefing a design team for Shane McCaw Consulting, a Microsoft 365 consulting firm.

${icpContext}
${campaignContext}

Topic: ${body.topic}
Offer: ${offer}
Angle: ${angle}
Audience: ${audience}

Generate 3 creative concept prompts for a designer. Each prompt must have:
- headline: The main visual/text concept name (5-8 words)
- description: A 2-3 sentence brief describing the visual style, imagery, color mood, and the emotion to evoke
- cta: The button/action text for the creative

Respond ONLY with valid JSON, no prose:
{
  "variations": [
    { "headline": "...", "description": "...", "cta": "..." },
    { "headline": "...", "description": "...", "cta": "..." },
    { "headline": "...", "description": "...", "cta": "..." }
  ]
}`,
      landing_page: `You are a landing page copywriter for Shane McCaw Consulting, a Microsoft 365 consulting firm.

${icpContext}
${campaignContext}

Topic: ${body.topic}
Offer: ${offer}
Angle: ${angle}
Audience: ${audience}

Generate 3 landing page copy variations (above-the-fold sections). Each variation must have:
- headline: 10 words max, outcome-focused hero headline
- description: 2-3 sentences of subheadline + supporting copy, 200 chars max
- cta: button text (3-6 words)

Respond ONLY with valid JSON, no prose:
{
  "variations": [
    { "headline": "...", "description": "...", "cta": "..." },
    { "headline": "...", "description": "...", "cta": "..." },
    { "headline": "...", "description": "...", "cta": "..." }
  ]
}`,
    };

    const prompt = prompts[body.adType] ?? prompts["ad_google"] ?? "";
    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = message.content[0]?.type === "text" ? message.content[0].text : "{}";
    const parsed = parseAiJson(raw, z.object({ variations: z.array(adVariationSchema) }));

    const campaignSlug = slugifyForUtm(body.topic);
    const variations = parsed.variations.map((v, idx) => ({
      ...v,
      url: buildUtmUrl(body.adType, campaignSlug, idx, body.destinationPath),
    }));

    res.json({ adType: body.adType, variations });
  } catch (e) {
    if (e instanceof AiResponseError) { req.log.warn({ err: e }, "AI parse failed on /campaigns/generate-ads"); res.json({ ...aiErrorResponse(e), adType: (req.body as Record<string, unknown>).adType ?? "ad_google", variations: [] }); return; }
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── Save ads endpoint (bulk insert ad assets with variations) ─────────────────

const saveAdsSchema = z.object({
  campaignId: z.number(),
  adType: z.enum(["ad_google", "ad_linkedin", "ad_retargeting", "ad_creative", "landing_page"]),
  title: z.string(),
  variations: z.array(adVariationSchema),
});

router.post("/admin/marketing/campaigns/save-ads", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = saveAdsSchema.parse(req.body);
    type AssetType = typeof campaignAssetsTable.$inferInsert["assetType"];
    const primaryContent = body.variations
      .map((v, i) => `Variation ${i + 1}:\nHeadline: ${v.headline}\nDescription: ${v.description}${v.cta ? `\nCTA: ${v.cta}` : ""}${v.url ? `\nURL: ${v.url}` : ""}`)
      .join("\n\n");
    const currentOffers = await db.select({ id: offersTable.id }).from(offersTable).where(eq(offersTable.campaignId, body.campaignId));
    const generatedWithOfferIds = currentOffers.map(o => o.id);
    const [saved] = await db.insert(campaignAssetsTable).values({
      campaignId: body.campaignId,
      assetType: body.adType as AssetType,
      title: body.title,
      content: primaryContent,
      metadata: { variations: body.variations },
      generatedWithOfferIds,
    }).returning();
    res.json(saved);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Analytics for marketing ──────────────────────────────────────────────────

// ─── Send outreach email via Exchange Online ──────────────────────────────────

const sendOutreachSchema = z.object({
  to: z.string().email("Invalid recipient email address"),
  subject: z.string().min(1, "Subject is required"),
  body: z.string().min(1, "Body is required"),
  leadId: z.number().optional(),
  campaignId: z.number().optional(),
  bodyType: z.enum(["text", "html"]).optional().default("text"),
});

router.post("/admin/marketing/send-outreach", requireAdmin, async (req: Request, res: Response) => {
  try {
    const parsed = sendOutreachSchema.parse(req.body);
    const userId = process.env["GRAPH_MAIL_USER_ID"];
    if (!userId) {
      res.status(503).json({ error: "GRAPH_MAIL_USER_ID is not configured — cannot send via Exchange Online" });
      return;
    }

    const sent = await sendMessage({
      userId,
      to: [parsed.to],
      subject: parsed.subject,
      body: parsed.body,
      bodyType: parsed.bodyType ?? "text",
      saveToSentItems: true,
    });

    if (!sent) {
      res.status(502).json({ error: "Graph API rejected the send request" });
      return;
    }

    db.insert(emailEventsTable).values({
      emailId: `outreach-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      eventType: "sent",
      recipient: parsed.to,
      subject: parsed.subject,
      campaignId: parsed.campaignId ?? null,
      leadId: parsed.leadId ?? null,
      metadata: { source: "outreach" },
    }).catch((err: unknown) => req.log.warn({ err }, "Failed to record email_event for outreach send"));

    if (parsed.leadId) {
      const [lead] = await db
        .select({ notes: leadsTable.notes })
        .from(leadsTable)
        .where(eq(leadsTable.id, parsed.leadId));
      if (lead !== undefined) {
        const timestamp = new Date().toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
        const entry = `[${timestamp}] Outreach email sent to: ${parsed.to} — Subject: "${parsed.subject}"`;
        const updated = lead.notes ? `${lead.notes}\n${entry}` : entry;
        await db.update(leadsTable).set({ notes: updated }).where(eq(leadsTable.id, parsed.leadId));
      }
    }

    res.json({ success: true });
  } catch (e) {
    if (e instanceof z.ZodError) {
      res.status(400).json({ error: e.errors[0]?.message ?? "Validation error" });
      return;
    }
    if (e instanceof GraphMailConfigError) {
      res.status(503).json({ error: e.message });
      return;
    }
    res.status(500).json({ error: String(e) });
  }
});

// ─── Lead email delivery history ─────────────────────────────────────────────

router.get("/admin/marketing/leads/:id/emails", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    if (isNaN(id)) { res.status(400).json({ error: "Invalid lead id" }); return; }

    const rows = await db
      .select({
        id: emailEventsTable.id,
        recipient: emailEventsTable.recipient,
        subject: emailEventsTable.subject,
        eventType: emailEventsTable.eventType,
        sentAt: emailEventsTable.occurredAt,
        campaignId: emailEventsTable.campaignId,
      })
      .from(emailEventsTable)
      .where(eq(emailEventsTable.leadId, id))
      .orderBy(desc(emailEventsTable.occurredAt));

    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Analytics for marketing ──────────────────────────────────────────────────

router.get("/admin/marketing/analytics", requireAdmin, async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [dailyVisitors, topPages, trafficSources, conversionFunnel, campaignPerf] = await Promise.all([
      db.execute(sql`
        SELECT DATE(started_at) as day, COUNT(*) as visitors
        FROM analytics_sessions
        WHERE started_at >= ${sevenDaysAgo}
        GROUP BY DATE(started_at) ORDER BY day
      `),
      db.execute(sql`
        SELECT page, COUNT(*) as views
        FROM analytics_pageviews
        WHERE entered_at >= ${thirtyDaysAgo}
        GROUP BY page ORDER BY views DESC LIMIT 10
      `),
      db.execute(sql`
        SELECT
          COALESCE(utm_source, CASE WHEN referrer IS NULL OR referrer = '' THEN 'Direct' ELSE 'Referral' END) as source,
          COUNT(*) as sessions
        FROM analytics_sessions
        WHERE started_at >= ${thirtyDaysAgo}
        GROUP BY source ORDER BY sessions DESC LIMIT 8
      `),
      db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM analytics_sessions WHERE started_at >= ${thirtyDaysAgo}) as visitors,
          (SELECT COUNT(DISTINCT s.session_id) FROM analytics_sessions s
           JOIN analytics_pageviews p ON p.session_id = s.session_id
           WHERE s.started_at >= ${thirtyDaysAgo} AND p.page LIKE '/contact%') as contact_page_views,
          (SELECT COUNT(*) FROM leads WHERE created_at >= ${thirtyDaysAgo}) as leads,
          (SELECT COUNT(*) FROM leads WHERE status = 'converted' AND created_at >= ${thirtyDaysAgo}) as converted
      `),
      db.execute(sql`
        SELECT c.id, c.name, c.status, c.created_at,
          COUNT(DISTINCT ca.id) as asset_count,
          COALESCE(c.leads_generated, 0) as leads_generated,
          COALESCE(c.revenue_attributed, 0) as revenue_attributed
        FROM campaigns c
        LEFT JOIN campaign_assets ca ON ca.campaign_id = c.id
        GROUP BY c.id, c.name, c.status, c.created_at, c.leads_generated, c.revenue_attributed
        ORDER BY
          CASE WHEN COALESCE(c.leads_generated, 0) > 0
            THEN COALESCE(c.revenue_attributed, 0)::numeric / c.leads_generated
          END DESC NULLS LAST,
          c.created_at DESC
        LIMIT 10
      `),
    ]);

    type DayRow = { day: string; visitors: string };
    type PageRow = { page: string; views: string };
    type SourceRow = { source: string; sessions: string };
    type FunnelRow = { visitors: string; contact_page_views: string; leads: string; converted: string };
    type CampaignRow = { id: number; name: string; status: string; asset_count: string; leads_generated: string; revenue_attributed: string };

    const rawDaily = (dailyVisitors as unknown as { rows: DayRow[] }).rows ?? [];
    const rawPages = (topPages as unknown as { rows: PageRow[] }).rows ?? [];
    const rawSources = (trafficSources as unknown as { rows: SourceRow[] }).rows ?? [];
    const rawFunnel = ((conversionFunnel as unknown as { rows: FunnelRow[] }).rows ?? [])[0];
    const rawCampaigns = (campaignPerf as unknown as { rows: CampaignRow[] }).rows ?? [];

    const funnelData = rawFunnel ? [
      { stage: "Visitors", value: Number(rawFunnel.visitors) },
      { stage: "Contact Page", value: Number(rawFunnel.contact_page_views) },
      { stage: "Leads", value: Number(rawFunnel.leads) },
      { stage: "Converted", value: Number(rawFunnel.converted) },
    ] : [];

    res.json({
      dailyVisitors: rawDaily.map(r => ({ day: String(r.day).slice(0, 10), visitors: Number(r.visitors) })),
      topPages: rawPages.map(r => ({ page: String(r.page), views: Number(r.views) })),
      trafficSources: rawSources.map(r => ({ source: String(r.source), sessions: Number(r.sessions) })),
      conversionFunnel: funnelData,
      campaignPerformance: rawCampaigns.map(r => {
        const leads = Number(r.leads_generated);
        const revenue = Number(r.revenue_attributed);
        const revenuePerLead = leads > 0 ? revenue / leads : null;
        return { id: r.id, name: r.name, status: r.status, assetCount: Number(r.asset_count), leadsGenerated: leads, revenueAttributed: revenue, revenuePerLead };
      }),
    });
  } catch (e) {
    req.log.error({ err: e }, "GET /admin/marketing/analytics failed");
    res.status(500).json({ error: String(e) });
  }
});

// ─── Email Stats (from stored Resend webhook events) ─────────────────────────

router.get("/admin/marketing/email-stats", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [totals, daily] = await Promise.all([
      db.execute(sql`
        SELECT
          event_type,
          COUNT(*) as cnt
        FROM email_events
        WHERE occurred_at >= ${thirtyDaysAgo}
        GROUP BY event_type
      `),
      db.execute(sql`
        SELECT
          DATE(occurred_at) as day,
          COUNT(*) as sent
        FROM email_events
        WHERE occurred_at >= ${thirtyDaysAgo}
          AND event_type = 'sent'
        GROUP BY DATE(occurred_at)
        ORDER BY day
      `),
    ]);

    type TotalsRow = { event_type: string; cnt: string };
    type DailyRow = { day: string; sent: string };

    const rawTotals = (totals as unknown as { rows: TotalsRow[] }).rows ?? [];
    const rawDaily = (daily as unknown as { rows: DailyRow[] }).rows ?? [];

    const countMap = Object.fromEntries(rawTotals.map(r => [String(r.event_type), Number(r.cnt)]));
    const totalSent = countMap["sent"] ?? 0;

    res.json({
      totalSent,
      hasData: totalSent > 0,
      dailyTrend: rawDaily.map(r => ({
        day: String(r.day).slice(0, 10),
        sent: Number(r.sent),
      })),
    });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── SEO Rankings ─────────────────────────────────────────────────────────────

router.get("/admin/marketing/seo-rankings", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(seoRankingsTable).orderBy(seoRankingsTable.position);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

const seoRankingSchema = z.object({
  keyword: z.string().min(1),
  position: z.number().int().min(1).max(100),
  url: z.string().optional(),
  searchVolume: z.number().int().optional(),
  notes: z.string().optional(),
});

router.post("/admin/marketing/seo-rankings", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = seoRankingSchema.parse(req.body);
    const [row] = await db.insert(seoRankingsTable).values({
      keyword: body.keyword,
      position: body.position,
      url: body.url ?? null,
      searchVolume: body.searchVolume ?? null,
      notes: body.notes ?? null,
    }).returning();
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.patch("/admin/marketing/seo-rankings/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    const body = seoRankingSchema.partial().parse(req.body);

    const existing = await db.select({ position: seoRankingsTable.position }).from(seoRankingsTable).where(eq(seoRankingsTable.id, id));
    const prevPos = existing[0]?.position ?? null;

    const updateData: Partial<typeof seoRankingsTable.$inferInsert> & { updatedAt: Date; checkedAt: Date } = {
      updatedAt: new Date(),
      checkedAt: new Date(),
    };
    if (body.keyword !== undefined) updateData.keyword = body.keyword;
    if (body.position !== undefined) {
      if (prevPos !== null && prevPos !== body.position) updateData.previousPosition = prevPos;
      updateData.position = body.position;
    }
    if (body.url !== undefined) updateData.url = body.url;
    if (body.searchVolume !== undefined) updateData.searchVolume = body.searchVolume;
    if (body.notes !== undefined) updateData.notes = body.notes;

    const [row] = await db.update(seoRankingsTable).set(updateData).where(eq(seoRankingsTable.id, id)).returning();
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.delete("/admin/marketing/seo-rankings/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    await db.delete(seoRankingsTable).where(eq(seoRankingsTable.id, id));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Search Console Sync ──────────────────────────────────────────────────────

router.post("/admin/marketing/seo-rankings/sync-search-console", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const siteUrl = process.env["GOOGLE_SEARCH_CONSOLE_SITE_URL"];
    if (!siteUrl) {
      res.status(400).json({ error: "GOOGLE_SEARCH_CONSOLE_SITE_URL is not configured" });
      return;
    }

    const entries = await fetchTopQueries(siteUrl, 28, 100);
    if (entries.length === 0) {
      res.json({ synced: 0, inserted: 0, updated: 0, message: "No data returned from Search Console" });
      return;
    }

    const existing = await db.select({
      id: seoRankingsTable.id,
      keyword: seoRankingsTable.keyword,
      position: seoRankingsTable.position,
    }).from(seoRankingsTable);

    const existingByKeyword = new Map(existing.map(r => [r.keyword.toLowerCase(), r]));

    let inserted = 0;
    let updated = 0;

    for (const entry of entries) {
      if (!entry.query) continue;
      const keyLower = entry.query.toLowerCase();
      const match = existingByKeyword.get(keyLower);

      if (match) {
        const prevPos = match.position !== entry.position ? match.position : undefined;
        await db.update(seoRankingsTable)
          .set({
            position: entry.position,
            ...(prevPos !== undefined ? { previousPosition: prevPos } : {}),
            checkedAt: new Date(),
            updatedAt: new Date(),
            notes: `Last synced from Search Console (${entry.clicks} clicks, ${entry.impressions} impressions)`,
          })
          .where(eq(seoRankingsTable.id, match.id));
        existingByKeyword.set(keyLower, { ...match, position: entry.position });
        updated++;
      } else {
        const [inserted_row] = await db.insert(seoRankingsTable).values({
          keyword: entry.query,
          position: entry.position,
          notes: `Imported from Search Console (${entry.clicks} clicks, ${entry.impressions} impressions)`,
        }).returning({ id: seoRankingsTable.id, keyword: seoRankingsTable.keyword, position: seoRankingsTable.position });
        if (inserted_row) {
          existingByKeyword.set(keyLower, inserted_row);
        }
        inserted++;
      }
    }

    res.json({ synced: entries.length, inserted, updated });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Revenue Engine — module-level cache ──────────────────────────────────────

let dailyCommandCache: { data: unknown; expiresAt: number } | null = null;

// ── Spec-compliant paths: POST /leads/:id/intent-event & GET /leads/:id/intent-events ──

router.post("/admin/marketing/leads/:id/intent-event", requireAdmin, async (req: Request, res: Response) => {
  try {
    const leadId = parseId(req.params, "id");
    const body = req.body as { eventType?: string; metadata?: Record<string, unknown> };
    if (!body.eventType) { res.status(400).json({ error: "eventType is required" }); return; }
    res.json(await ingestIntentEvent(leadId, body.eventType, body.metadata ?? {}));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.post("/admin/marketing/intent-events", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = req.body as { leadId?: number; eventType?: string; metadata?: Record<string, unknown> };
    if (!body.leadId || !body.eventType) { res.status(400).json({ error: "leadId and eventType are required" }); return; }
    res.json(await ingestIntentEvent(body.leadId, body.eventType, body.metadata ?? {}));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.get("/admin/marketing/leads/:id/intent-events", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    const events = await db.select().from(leadIntentEventsTable)
      .where(eq(leadIntentEventsTable.leadId, id)).orderBy(desc(leadIntentEventsTable.occurredAt)).limit(50);
    res.json(events);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.get("/admin/marketing/hot-leads", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const hotLeads = await db.select({
      id: leadsTable.id,
      name: leadsTable.name,
      email: leadsTable.email,
      company: leadsTable.company,
      industry: leadsTable.industry,
      score: leadsTable.score,
      status: leadsTable.status,
      stage: leadsTable.stage,
    }).from(leadsTable).where(gte(leadsTable.score, 30)).orderBy(desc(leadsTable.score)).limit(20);

    const intentCounts = await db.select({
      leadId: leadIntentEventsTable.leadId,
      cnt: count(),
    }).from(leadIntentEventsTable).where(gte(leadIntentEventsTable.occurredAt, cutoff))
      .groupBy(leadIntentEventsTable.leadId);

    const cntMap = Object.fromEntries(intentCounts.map(r => [r.leadId, r.cnt]));
    const result = hotLeads.map(l => ({ ...l, recentEvents: cntMap[l.id] ?? 0 }));
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.get("/admin/marketing/hot-leads/:leadId/intent-timeline", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "leadId");
    const events = await db.select().from(leadIntentEventsTable)
      .where(eq(leadIntentEventsTable.leadId, id)).orderBy(desc(leadIntentEventsTable.occurredAt)).limit(50);
    res.json(events);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Next Best Action ─────────────────────────────────────────────────────────

async function computeNextBestAction(leadId: number): Promise<{
  outreachMethod: string; messageType: string; bestOffer: string;
  followUpTiming: string; rationale: string; urgency: string;
}> {
  const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, leadId)).limit(1);
  if (!lead) throw new Error("Lead not found");

  const [recentEvents, lastFollowUp, topOffer] = await Promise.all([
    db.select().from(leadIntentEventsTable)
      .where(and(eq(leadIntentEventsTable.leadId, leadId), gte(leadIntentEventsTable.occurredAt, new Date(Date.now() - 7 * 86400000))))
      .orderBy(desc(leadIntentEventsTable.occurredAt)).limit(5),
    db.select().from(followUpEventsTable)
      .where(eq(followUpEventsTable.leadId, leadId)).orderBy(desc(followUpEventsTable.scheduledAt)).limit(1),
    db.select().from(offersTable).limit(1),
  ]);

  const icpCtx = await buildICPContext();
  const prompt = `You are a revenue consultant for a Microsoft 365 architect consultant.
${icpCtx}

Lead: ${lead.name}, ${lead.company ?? "unknown company"}, industry=${lead.industry ?? "unknown"}, stage=${lead.stage}, score=${lead.score}.
Pain points: ${lead.painPoints?.join(", ") || "none recorded"}.
Recent intent signals (last 7 days): ${recentEvents.map(e => e.eventType).join(", ") || "none"}.
Last follow-up: ${lastFollowUp[0] ? `${lastFollowUp[0].channel} on ${lastFollowUp[0].scheduledAt.toDateString()}, status=${lastFollowUp[0].status}` : "none yet"}.
Available offer: ${topOffer[0]?.name ?? "none configured yet"}.

Return JSON with EXACTLY these fields:
{
  "outreachMethod": "email|linkedin|phone|none",
  "messageType": "cold_outreach|warm_follow_up|value_add|close_ask|re_engagement",
  "bestOffer": "name of the best service/offer to propose to this lead",
  "followUpTiming": "today|tomorrow|this_week|next_week",
  "rationale": "2-sentence explanation of why this is the right move now",
  "urgency": "high|medium|low"
}`;

  const msg = await anthropic.messages.create({ model: "claude-haiku-4-5", max_tokens: 400, messages: [{ role: "user", content: prompt }] });
  const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
  return parseAiJson(raw, z.object({
    outreachMethod: z.string(), messageType: z.string(), bestOffer: z.string(),
    followUpTiming: z.string(), rationale: z.string(), urgency: z.string(),
  }));
}

// Spec-compliant POST endpoint
router.post("/admin/marketing/leads/:id/next-best-action", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    res.json(await computeNextBestAction(id));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Lead not found") { res.status(404).json({ error: msg }); return; }
    res.status(500).json({ error: msg });
  }
});

// Legacy GET alias for backwards-compat
router.get("/admin/marketing/next-best-action/:leadId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "leadId");
    res.json(await computeNextBestAction(id));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg === "Lead not found") { res.status(404).json({ error: msg }); return; }
    res.status(500).json({ error: msg });
  }
});

// ─── Offer Builder ────────────────────────────────────────────────────────────

router.post("/admin/marketing/generate/offer", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = req.body as { goal?: string; audience?: string; pricePoint?: string };
    const icpCtx = await buildICPContext();
    const prompt = `You are a B2B offer strategist for a Microsoft 365 consulting firm.
${icpCtx}
Goal: ${body.goal ?? "Help clients adopt Microsoft 365"}
Target audience: ${body.audience ?? "IT directors at mid-market companies"}
Price point: ${body.pricePoint ?? "value-based"}

Return JSON:
{
  "name": "offer name",
  "goal": "specific outcome",
  "audience": "specific audience description",
  "pricing": "pricing description",
  "deliverables": ["deliverable 1", "deliverable 2", "deliverable 3"],
  "outcomes": ["outcome 1", "outcome 2"],
  "cta": "call-to-action phrase"
}`;
    const msg = await anthropic.messages.create({ model: "claude-haiku-4-5", max_tokens: 600, messages: [{ role: "user", content: prompt }] });
    const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
    const schema = z.object({ name: z.string(), goal: z.string(), audience: z.string(), pricing: z.string().optional(), deliverables: z.array(z.string()), outcomes: z.array(z.string()), cta: z.string().optional() });
    res.json(parseAiJson(raw, schema));
  } catch (e) {
    if (e instanceof AiResponseError) {
      req.log.warn({ err: e }, "AI parse failed on /generate/offer");
      res.json({ ...aiErrorResponse(e), name: "", goal: "", audience: "", pricing: "", deliverables: [], outcomes: [], cta: "" });
      return;
    }
    res.status(500).json({ error: String(e) });
  }
});

router.get("/admin/marketing/offers", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(offersTable).orderBy(desc(offersTable.createdAt));
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.post("/admin/marketing/offers", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = req.body as { name?: string; goal?: string; audience?: string; pricing?: string; deliverables?: string[]; outcomes?: string[]; cta?: string; campaignId?: number };
    if (!body.name || !body.goal || !body.audience) { res.status(400).json({ error: "name, goal, audience required" }); return; }
    const [row] = await db.insert(offersTable).values({
      name: body.name, goal: body.goal, audience: body.audience,
      pricing: body.pricing ?? null, deliverables: body.deliverables ?? [], outcomes: body.outcomes ?? [],
      cta: body.cta ?? null, campaignId: body.campaignId ?? null,
    }).returning();
    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.patch("/admin/marketing/offers/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    const body = req.body as Partial<{ name: string; goal: string; audience: string; pricing: string; deliverables: string[]; outcomes: string[]; cta: string; campaignId: number }>;
    const [row] = await db.update(offersTable).set({ ...body, updatedAt: new Date() }).where(eq(offersTable.id, id)).returning();
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.delete("/admin/marketing/offers/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    await db.delete(offersTable).where(eq(offersTable.id, parseId(req.params, "id")));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Canonical alias: POST /admin/marketing/offers/generate
router.post("/admin/marketing/offers/generate", requireAdmin, (req: Request, res: Response) => {
  req.url = "/admin/marketing/generate/offer";
  (router as unknown as { handle(req: Request, res: Response, cb: () => void): void }).handle(req, res, () => res.status(404).json({ error: "Not found" }));
});

// ─── AI Suggest: Offer fields ─────────────────────────────────────────────────

router.post("/admin/marketing/suggest/offer", requireAdmin, async (req: Request, res: Response) => {
  try {
    const icpCtx = await buildICPContext();
    const prompt = `You are a B2B offer strategist for a Microsoft 365 consulting firm.
${icpCtx}

Generate exactly 3 distinct offer angle suggestions, each covering a different service line or buyer persona. Each should have a specific goal, a well-defined audience, and a realistic price point for consulting services.

Respond with ONLY a raw JSON array — no prose, no markdown fences. Schema:
[{"goal":"string","audience":"string","pricePoint":"string"}]`;

    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 400,
      messages: [
        { role: "user", content: prompt },
        { role: "assistant", content: "[" },
      ],
    });
    const continuation = msg.content[0]?.type === "text" ? msg.content[0].text : "]";
    const raw = "[" + continuation;
    const schema = z.array(z.object({ goal: z.string(), audience: z.string(), pricePoint: z.string() }));
    res.json(parseAiJson(raw, schema));
  } catch (e) {
    if (e instanceof AiResponseError) { req.log.warn({ err: e }, "AI parse failed on /suggest/offer"); res.json(aiErrorResponse(e)); return; }
    req.log.error({ err: e }, "POST /admin/marketing/suggest/offer failed");
    res.status(500).json({ error: String(e) });
  }
});

// ─── Landing Page Generator ───────────────────────────────────────────────────

// ── spec-driven layoutBlocks generation ──────────────────────────────────────

async function generateSpecLayoutBlocks(
  spec: string, topic: string, audience: string,
  copy: string, deliverablesBullets: string, outcomesBullets: string,
): Promise<Array<{ blockType: string; content: unknown }>> {
  const copySnippet = copy.trim() ? `EXISTING COPY (source content from this):\n${copy.slice(0, 2500)}` : "";
  const prompt = `You are building the layout blocks for a Microsoft 365 consulting landing page.

AVAILABLE BLOCK TYPES — output a JSON array of {blockType, content} objects:

why_this_matters: {"blockType":"why_this_matters","content":{"body":"2–3 sentences on the core problem"}}
authority: {"blockType":"authority","content":{"heading":"...","body":"...","complianceBadges":["FedRAMP","FISMA","ITAR","GCC High"],"stats":[{"stat":"30+","label":"Years in Microsoft Ecosystem"},{"stat":"NASA","label":"Current Lead M365 Architect"},{"stat":"100%","label":"Senior Delivery — No Junior Staff"}]}}
process: {"blockType":"process","content":{"steps":[{"step":"01","title":"...","description":"...","note":"optional"}]}}
trust_badges: {"blockType":"trust_badges","content":{"badges":["Lead M365 Architect at NASA","30 Years Microsoft Experience","Fixed-Price Engagements","Senior-Level Delivery"]}}
rich_text: {"blockType":"rich_text","content":{"title":"optional heading","body":"paragraph text","list":["optional","bullet points"]}}
faq: {"blockType":"faq","content":{"title":"optional FAQ title","items":[{"q":"Question?","a":"Answer."}]}}
testimonials: {"blockType":"testimonials","content":{"items":[{"quote":"...","author":"Name","role":"Title","company":"Company"}]}} — ONLY if real quotes exist in the copy; do NOT fabricate.
problem_solution: {"blockType":"problem_solution","content":{"problem":"The problem.","solution":"The solution.","bullets":["optional detail"]}}
checklist: {"blockType":"checklist","content":{"title":"optional heading","items":["Item 1","Item 2"]}}
stats_bar: {"blockType":"stats_bar","content":{"stats":[{"value":"30+","label":"Years Experience"}]}}
featured_quote: {"blockType":"featured_quote","content":{"quote":"A compelling pull quote.","attribution":"optional"}}
quiz_cta: {"blockType":"quiz_cta","content":{"quizType":"copilot","title":"optional","description":"optional","buttonText":"optional"}}
  quizType must be one of: copilot, m365-health, sharepoint, power-platform, security-compliance, teams, migration, governance

PAGE SPEC:
${spec}

CAMPAIGN CONTEXT:
Topic: ${topic}
Audience: ${audience}
Deliverables: ${deliverablesBullets}
Outcomes: ${outcomesBullets}
${copySnippet}

RULES:
- Always include an authority block (Shane McCaw, NASA Lead M365 Architect, 30+ years Microsoft)
- Always include a trust_badges block
- Generate 5–9 blocks in the order they should appear on the page
- Draw all content from the copy and context — do NOT invent content
- Do NOT fabricate testimonials
- Output ONLY a valid JSON array, no prose, no markdown fences`;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5", max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "[]";
    const parsed = JSON.parse(extractJson(raw)) as unknown;
    if (Array.isArray(parsed)) return parsed as Array<{ blockType: string; content: unknown }>;
  } catch { /* fall through to default */ }
  return [];
}

const LP_QUIZ_ROUTES: Record<string, string> = {
  copilot: "/copilot-quiz",
  "m365-health": "/m365-health-quiz",
  sharepoint: "/sharepoint-readiness-quiz",
  "power-platform": "/power-platform-quiz",
  "security-compliance": "/security-compliance-quiz",
  teams: "/teams-maturity-quiz",
  migration: "/migration-readiness-quiz",
  governance: "/governance-maturity-quiz",
};

function applyCtaMode(
  cta: { buttonText: string; href: string; subtext?: string },
  ctaMode?: string, quizType?: string, customHref?: string,
): { buttonText: string; href: string; subtext?: string } {
  if (!ctaMode || ctaMode === "order_service") return cta;
  if (ctaMode === "book_call") return { ...cta, href: "/book", buttonText: cta.buttonText || "Book a Discovery Call", subtext: cta.subtext || "Free. No commitment." };
  if (ctaMode === "take_assessment") {
    const qt = quizType ?? "copilot";
    return { ...cta, href: LP_QUIZ_ROUTES[qt] ?? `/${qt}-quiz`, buttonText: cta.buttonText || "Start Free Assessment" };
  }
  if (ctaMode === "custom" && customHref?.trim()) return { ...cta, href: customHref.trim() };
  return cta;
}

router.post("/admin/marketing/generate/landing-page", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      offerId?: number;
      topic?: string;
      audience?: string;
      cta?: string;
      copy?: string;
      deliverables?: string[];
      outcomes?: string[];
      spec?: string;
      ctaMode?: string;
      quizType?: string;
      customHref?: string;
    };

    const icpCtx = await buildICPContext();

    // Collect offer context: inline deliverables/outcomes take precedence; fall back to offerId DB lookup
    let offerCtx = "";
    const inlineDeliverables = (body.deliverables ?? []).filter(Boolean);
    const inlineOutcomes = (body.outcomes ?? []).filter(Boolean);

    if (inlineDeliverables.length > 0 || inlineOutcomes.length > 0) {
      const parts: string[] = [];
      if (inlineDeliverables.length > 0) parts.push(`Deliverables: ${inlineDeliverables.join("; ")}`);
      if (inlineOutcomes.length > 0) parts.push(`Outcomes: ${inlineOutcomes.join("; ")}`);
      offerCtx = parts.join("\n");
    } else if (body.offerId) {
      const [offer] = await db.select().from(offersTable).where(eq(offersTable.id, body.offerId)).limit(1);
      if (offer) offerCtx = `Offer: ${offer.name} — ${offer.goal}. Deliverables: ${offer.deliverables.join("; ")}. Outcomes: ${offer.outcomes.join("; ")}.`;
    }

    const deliverablesBullets = inlineDeliverables.length > 0
      ? inlineDeliverables.map(d => `• ${d}`).join("\n")
      : "• Full tenant configuration assessment\n• Prioritised findings document\n• Executive summary";
    const outcomesBullets = inlineOutcomes.length > 0
      ? inlineOutcomes.map(o => `• ${o}`).join("\n")
      : "• Clear remediation roadmap\n• Confidence for Copilot deployment\n• Eliminates blind spots before audits";

    const rawCopy = body.copy?.trim() ?? "";

    // ── Helpers ────────────────────────────────────────────────────────────
    const isPlaceholder = (v: string) => !v || v === "..." || v.includes("Value prop") || v.startsWith("[") || v.length < 6;

    function parseCopyLayoutBlocks(copy: string): Array<{ blockType: string; content: unknown }> {
      const blocks: Array<{ blockType: string; content: unknown }> = [];

      // Generic "next section" boundary: blank line + something that looks like a section heading
      // Handles optional emoji prefixes (⭐, ✅, etc.) and any all-caps heading
      const nextSectionLookahead = String.raw`(?=\n\n(?:[^\w\n]{0,3}\s*)?(?:WHAT|VALUE|THE |AUTHORITY|PROCESS|FINAL|WHY|HOW|OPTIONAL|YOUR|CTA:|$))`;

      // WHY section — match any heading that begins with WHY (e.g. "WHY THIS MATTERS", "WHY COPILOT READINESS MATTERS")
      const whyMatch = copy.match(new RegExp(String.raw`^WHY\s[^\n]+\n([\s\S]+?)` + nextSectionLookahead, "m"));
      if (whyMatch) {
        const whyBody = whyMatch[1].trim();
        if (whyBody.length > 10) blocks.push({ blockType: "why_this_matters", content: { body: whyBody } });
      }

      // AUTHORITY — section heading is always "AUTHORITY"; terminator handles optional emoji-prefixed PROCESS
      const authMatch = copy.match(/^AUTHORITY\n([\s\S]+?)(?=\n\n(?:[^\w\n]{0,3}\s*)?(?:PROCESS|FINAL|WHAT|$))/m);
      const authContent = authMatch ? authMatch[1].trim() : "";
      const authLines = authContent.split("\n").filter(Boolean);
      const authHeading = authLines[0]?.trim() || "Built at NASA Scale. Available to You.";
      const authBody = authLines.slice(1).join(" ").trim() || "Shane McCaw is NASA's Lead Microsoft 365 Architect with over 30 years inside the Microsoft ecosystem. Senior-level delivery only. No junior staff. No handoffs.";
      const knownBadges = ["FedRAMP", "FISMA", "ITAR", "GCC High", "HIPAA", "SOC 2", "NIST"];
      const complianceBadges = knownBadges.filter(b => authBody.includes(b));
      if (complianceBadges.length === 0) complianceBadges.push("FedRAMP", "FISMA", "ITAR", "GCC High", "HIPAA");
      blocks.push({
        blockType: "authority",
        content: {
          heading: authHeading,
          body: authBody,
          complianceBadges,
          stats: [
            { stat: "30+", label: "Years in the Microsoft Ecosystem" },
            { stat: "NASA", label: "Current Lead M365 Architect" },
            { stat: "100%", label: "Senior Delivery — No Junior Staff" },
          ],
        },
      });

      // PROCESS — allow optional emoji/symbol prefix before "PROCESS" (e.g. "⭐ PROCESS")
      const processMatch = copy.match(/^(?:[^\w\n]{0,3}\s*)?PROCESS\n([\s\S]+?)(?=\n\n(?:[^\w\n]{0,3}\s*)?(?:FINAL|AUTHORITY|WHAT|OPTIONAL|YOUR|$))/m);
      const processSteps: Array<{ step: string; title: string; description: string; note?: string }> = [];
      if (processMatch) {
        const processBody = processMatch[1];

        // Inline format: "01 — Title: Description on same line"
        const inlineSteps = [...processBody.matchAll(/^(\d{2})\s*[—–-]+\s*([^:\n]+):\s*(.+)$/gm)];
        if (inlineSteps.length > 0) {
          for (const m of inlineSteps) {
            processSteps.push({ step: m[1] as string, title: (m[2] as string).trim(), description: (m[3] as string).trim() });
          }
        } else {
          // Multi-line format: "01 — Title\nDescription lines..."
          const multiSteps = [...processBody.matchAll(/^(\d{2})\s*[—–-]+\s*([^\n]+)\n([\s\S]+?)(?=\n(?:\d{2})\s*[—–-]|$)/gm)];
          for (const m of multiSteps) {
            const desc = (m[3] as string)
              .split("\n")
              .map((l: string) => l.trim())
              .filter((l: string) => l.length > 0 && !l.startsWith("•") && !l.startsWith("⭐"))
              .slice(0, 2)
              .join(" ")
              .replace(/\s+/g, " ");
            processSteps.push({ step: m[1] as string, title: (m[2] as string).trim(), description: desc || (m[2] as string).trim() });
          }
        }
      }
      if (processSteps.length === 0) {
        processSteps.push(
          { step: "01", title: "Discovery Call", description: "A 30-minute call to understand your environment. No pitch. No obligation.", note: "No pitch. No obligation." },
          { step: "02", title: "Scoped Engagement", description: "Fixed-price, clearly defined deliverables. No open-ended fees. No scope creep.", note: "Fixed price. Delivered personally by Shane." },
          { step: "03", title: "Actionable Results", description: "A documented, immediately executable output delivered personally by Shane.", note: "No handoffs. No junior staff." },
        );
      }
      blocks.push({ blockType: "process", content: { steps: processSteps } });

      // Trust badges — consistent across all Shane campaigns
      blocks.push({ blockType: "trust_badges", content: { badges: ["Lead M365 Architect at NASA", "30 Years Microsoft Experience", "Fixed-Price Engagements", "Senior-Level Delivery"] } });

      return blocks;
    }

    const defaultLayoutBlocks: Array<{ blockType: string; content: unknown }> = [
      {
        blockType: "authority",
        content: {
          heading: "Built at NASA Scale. Available to You.",
          body: "Shane McCaw is NASA's Lead Microsoft 365 Architect with over 30 years inside the Microsoft ecosystem. Senior-level delivery only. No junior staff. No handoffs. Mission-critical compliance experience: FedRAMP, FISMA, ITAR, GCC High.",
          complianceBadges: ["FedRAMP", "FISMA", "ITAR", "GCC High", "HIPAA"],
          stats: [
            { stat: "30+", label: "Years in the Microsoft Ecosystem" },
            { stat: "NASA", label: "Current Lead M365 Architect" },
            { stat: "100%", label: "Senior Delivery — No Junior Staff" },
          ],
        },
      },
      {
        blockType: "process",
        content: {
          steps: [
            { step: "01", title: "Discovery Call", description: "A 30-minute call to understand your environment. No pitch. No obligation.", note: "No pitch. No obligation." },
            { step: "02", title: "Scoped Engagement", description: "Fixed-price, clearly defined deliverables. No open-ended fees. No scope creep.", note: "Fixed price. Delivered personally by Shane." },
            { step: "03", title: "Actionable Results", description: "A documented, immediately executable output delivered personally by Shane.", note: "No handoffs. No junior staff." },
          ],
        },
      },
      { blockType: "trust_badges", content: { badges: ["Lead M365 Architect at NASA", "30 Years Microsoft Experience", "Fixed-Price Engagements", "Senior-Level Delivery"] } },
    ];

    function parsedCopyFields(copy: string) {
      let headline: string | null = null;
      let subheadline: string | null = null;
      let ctaButtonText: string | null = null;
      const pillars: Array<{ heading: string; body: string }> = [];

      const hMatch = copy.match(/^(?:HEADLINE|Headline):\s*(.+)$/m);
      if (hMatch) { const v = hMatch[1].trim().replace(/^\[|\]$/g, ""); if (!isPlaceholder(v)) headline = v; }

      const sMatch = copy.match(/^(?:SUBHEAD(?:LINE)?|Subheadline):\s*(.+)$/m);
      if (sMatch) { const v = sMatch[1].trim().replace(/^\[|\]$/g, ""); if (!isPlaceholder(v)) subheadline = v; }

      const ctaMatches = [...copy.matchAll(/^CTA:\s*(.+)$/gm)];
      if (ctaMatches.length > 0) ctaButtonText = ctaMatches[ctaMatches.length - 1][1].trim();

      // "Pillar N — Heading\nBody…" — supports em dash, en dash, hyphen
      const pillarRe = /^Pillar\s+\d+\s*[—–-]+\s*(.+)\n([\s\S]+?)(?=\n\nPillar\s+\d+|\n\nWHAT\s|\n\nAUTHORITY|\n\nAUTHOR|\n\nPROCESS|\n\nFINAL|$)/gm;
      for (const m of copy.matchAll(pillarRe)) {
        const heading = m[1].trim();
        const bodyRaw = m[2].trim().replace(/^\[|\]$/g, "").trim();
        if (!isPlaceholder(heading) && !isPlaceholder(bodyRaw)) pillars.push({ heading, body: bodyRaw });
      }

      return { headline, subheadline, ctaButtonText, pillars };
    }

    // ── Path A: structured copy present — extract all fields, use AI only for emoji ──
    if (rawCopy && !rawCopy.includes("Value prop 1") && rawCopy.length > 80) {
      const parsed = parsedCopyFields(rawCopy);

      if (parsed.headline && parsed.subheadline && parsed.pillars.length >= 3) {
        // Ask AI ONLY for emoji icons — do not let it touch any content
        const iconPrompt = `Pick one relevant professional emoji for each Microsoft 365 consulting value proposition heading below.
Use only technical/business emojis (e.g. 🔍 📋 🚀 🛡️ ⚡ 📊 🔐 📈 🎯 ⚙️ 🔒 💡 🏗️ ✅ 🧩 🌐).
Output ONLY a JSON array of exactly 3 emoji strings. No prose, no markdown.

${parsed.pillars.slice(0, 3).map((p, i) => `${i + 1}. ${p.heading}`).join("\n")}

Example: ["🔍","📋","🚀"]`;

        let icons: string[] = ["🔍", "📋", "🚀"];
        try {
          const iconMsg = await anthropic.messages.create({ model: "claude-haiku-4-5", max_tokens: 60, messages: [{ role: "user", content: iconPrompt }] });
          const iconRaw = iconMsg.content[0]?.type === "text" ? iconMsg.content[0].text.trim() : "[]";
          const maybeArray = JSON.parse(extractJson(iconRaw)) as unknown;
          if (Array.isArray(maybeArray) && maybeArray.length === 3 && maybeArray.every(x => typeof x === "string")) icons = maybeArray as string[];
        } catch { /* keep defaults */ }

        const baseCta = { buttonText: parsed.ctaButtonText ?? "Book Your Paid Assessment", href: "/contact", subtext: "Fixed price. Senior-level delivery." };
        const fastLayoutBlocks = body.spec?.trim()
          ? await generateSpecLayoutBlocks(body.spec, body.topic ?? "Microsoft 365 Consulting", body.audience ?? "IT decision-makers", rawCopy, deliverablesBullets, outcomesBullets)
          : parseCopyLayoutBlocks(rawCopy);
        res.json({
          title: body.topic?.trim() || parsed.headline.split(" ").slice(0, 6).join(" "),
          headline: parsed.headline,
          subheadline: parsed.subheadline,
          valuePropBlocks: parsed.pillars.slice(0, 3).map((p, i) => ({ icon: icons[i] ?? "🔍", heading: p.heading, body: p.body })),
          socialProof: [],
          cta: applyCtaMode(baseCta, body.ctaMode, body.quizType, body.customHref),
          layoutBlocks: fastLayoutBlocks,
        });
        return;
      }

      // Partial parse — use AI as a pure extraction/conversion task (not generation)
      const extractPrompt = `You are converting existing landing page copy into a JSON structure. Do NOT invent new marketing content — extract and restructure what is already written.

LANDING PAGE COPY:
---
${rawCopy}
---

Campaign topic: ${body.topic ?? "Microsoft 365 Consulting"}

RULES:
- "title": Use the campaign topic. Keep it concise.
- "headline": Copy the EXACT text after "Headline:" in the HERO section. Do not rephrase.
- "subheadline": Copy the EXACT text after "Subheadline:" in the HERO section. Do not rephrase.
- "valuePropBlocks": Produce exactly 3 blocks that capture the core value of this offer.
  Source them using this priority order:
  1. "VALUE PILLARS" section — if present, one block per Pillar (heading = name after the dash, body = the sentences that follow)
  2. "WHAT YOU GET" or "THE OFFER" section — group the bullets into 3 thematic blocks. Give each group a short heading that names the theme. Write a 1–2 sentence body for each group using the context from the surrounding copy.
  3. Key themes in the body copy
  Each block must have: { "icon": one relevant professional emoji, "heading": concise heading, "body": 1–2 sentences grounded in the copy }
- "socialProof": Always empty array [].
- "cta": Use the FINAL CTA line for buttonText. href = "/contact". subtext = derive from copy (e.g. "Free. No commitment." or "Fixed price. Senior-level delivery.").

Output ONLY valid JSON, no prose, no markdown fences:
{
  "title": "...",
  "headline": "...",
  "subheadline": "...",
  "valuePropBlocks": [{ "icon": "🔍", "heading": "...", "body": "..." }],
  "socialProof": [],
  "cta": { "buttonText": "...", "href": "/contact", "subtext": "..." }
}`;

      const extractMsg = await anthropic.messages.create({ model: "claude-haiku-4-5", max_tokens: 2000, messages: [{ role: "user", content: extractPrompt }] });
      const extractRaw = extractMsg.content[0]?.type === "text" ? extractMsg.content[0].text : "{}";
      const schema = z.object({
        title: z.string(), headline: z.string(), subheadline: z.string(),
        valuePropBlocks: z.array(z.object({ icon: z.string().optional(), heading: z.string(), body: z.string() })),
        socialProof: z.array(z.object({ quote: z.string(), author: z.string(), role: z.string().optional() })).default([]),
        cta: z.object({ buttonText: z.string(), href: z.string(), subtext: z.string().optional() }),
      });
      const partialResult = parseAiJson(extractRaw, schema);
      const partialLayoutBlocks = body.spec?.trim()
        ? await generateSpecLayoutBlocks(body.spec, body.topic ?? "Microsoft 365 Consulting", body.audience ?? "IT decision-makers", rawCopy, deliverablesBullets, outcomesBullets)
        : parseCopyLayoutBlocks(rawCopy);
      res.json({
        ...partialResult,
        cta: partialResult.cta ? applyCtaMode(partialResult.cta, body.ctaMode, body.quizType, body.customHref) : partialResult.cta,
        layoutBlocks: partialLayoutBlocks,
      });
      return;
    }

    // ── Path B: no copy — generate from campaign context ──────────────────
    const prompt = `You are generating a landing page for a PAID professional Microsoft 365 service.
${icpCtx}
${offerCtx}
Topic: ${body.topic ?? "Microsoft 365 Consulting"}
Target audience: ${body.audience ?? "IT decision-makers"}
CTA: ${body.cta ?? "Book Your Paid Assessment"}

OFFER DELIVERABLES:
${deliverablesBullets}

OFFER OUTCOMES:
${outcomesBullets}

Match the exact tone and authority of a senior enterprise Microsoft 365 architect's consulting pages.

RULES:
- DO NOT use generic marketing language, hype, or "free audit" language.
- DO NOT write long paragraphs. Keep it concise and enterprise-grade.
- Never imply the offer is free.
- The headline must be risk-first (e.g. "Your M365 Tenant Is a Compliance Risk").
- The subheadline must frame the core problem the prospect faces right now.
- Produce exactly 3 valuePropBlocks drawn from the offer deliverables and outcomes.
- Each valuePropBlock body must be 1–2 concise, authoritative sentences.
- Each valuePropBlock icon must be a single relevant emoji (e.g. 🔍 📋 🚀 🛡️ ⚡ 📊).
- socialProof must always be an empty array — do not fabricate testimonials.

Generate a landing page as JSON — output ONLY valid JSON, no prose, no markdown fences:
{
  "title": "page title (service name — concise)",
  "headline": "risk-first headline",
  "subheadline": "one sentence framing the core problem",
  "valuePropBlocks": [
    { "icon": "🔍", "heading": "pillar heading", "body": "1–2 authoritative sentences" }
  ],
  "socialProof": [],
  "cta": { "buttonText": "Book Your Paid Assessment", "href": "/contact", "subtext": "Fixed price. Senior-level delivery." }
}`;
    const msg = await anthropic.messages.create({ model: "claude-haiku-4-5", max_tokens: 2000, messages: [{ role: "user", content: prompt }] });
    const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
    const schema = z.object({
      title: z.string(), headline: z.string(), subheadline: z.string(),
      valuePropBlocks: z.array(z.object({ icon: z.string().optional(), heading: z.string(), body: z.string() })),
      socialProof: z.array(z.object({ quote: z.string(), author: z.string(), role: z.string().optional() })),
      cta: z.object({ buttonText: z.string(), href: z.string(), subtext: z.string().optional() }),
    });
    const bResult = parseAiJson(raw, schema);
    const bLayoutBlocks = body.spec?.trim()
      ? await generateSpecLayoutBlocks(body.spec, body.topic ?? "Microsoft 365 Consulting", body.audience ?? "IT decision-makers", "", deliverablesBullets, outcomesBullets)
      : defaultLayoutBlocks;
    res.json({
      ...bResult,
      cta: bResult.cta ? applyCtaMode(bResult.cta, body.ctaMode, body.quizType, body.customHref) : bResult.cta,
      layoutBlocks: bLayoutBlocks,
    });
  } catch (e) {
    if (e instanceof AiResponseError) {
      req.log.warn({ err: e }, "AI parse failed on /generate/landing-page");
      res.json({ ...aiErrorResponse(e), title: "", headline: "", subheadline: "", valuePropBlocks: [], socialProof: [], cta: { buttonText: "Get Started", href: "/contact" } });
      return;
    }
    res.status(500).json({ error: String(e) });
  }
});

router.post("/admin/marketing/generate/landing-copy", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      campaignName?: string;
      goal?: string;
      audience?: string;
      offer?: string;
      deliverables?: string[];
      outcomes?: string[];
    };

    const icpCtx = await buildICPContext();

    const deliverables = (body.deliverables ?? []).filter(Boolean);
    const outcomes = (body.outcomes ?? []).filter(Boolean);

    const offerSection = [
      body.offer ? `Offer description: ${body.offer}` : "",
      deliverables.length > 0 ? `Deliverables: ${deliverables.join(", ")}` : "",
      outcomes.length > 0 ? `Outcomes / results: ${outcomes.join(", ")}` : "",
    ].filter(Boolean).join("\n");

    const deliverablesBullets = deliverables.length > 0
      ? deliverables.map(d => `• ${d}`).join("\n")
      : "• Full tenant configuration assessment\n• Prioritised findings document\n• Executive summary with remediation roadmap";
    const outcomesBullets = outcomes.length > 0
      ? outcomes.map(o => `• ${o}`).join("\n")
      : "• Eliminates blind spots before governance modernisation\n• Provides a clear remediation roadmap\n• Enables confident Copilot deployment";

    const prompt = `You are generating a landing page for a PAID professional Microsoft 365 service.
${icpCtx}
Campaign: ${body.campaignName ?? "Microsoft 365 Consulting"}
Goal: ${body.goal ?? "Generate qualified leads"}
Target audience: ${body.audience ?? "IT decision-makers"}
${offerSection}

Match the exact tone, structure, and authority of a senior enterprise Microsoft 365 architect's real consulting pages.

RULES:
- DO NOT use generic marketing language.
- DO NOT use hype, fluff, emojis, or "free audit" language.
- DO NOT write long paragraphs. Keep it concise and enterprise-grade.
- Never imply the offer is free.
- Output ONLY the landing page content using exactly the structure below (plain text, no JSON, no markdown).

HERO
Headline: [risk-first headline, e.g. "Your M365 Tenant Is a Compliance Risk"]
Subheadline: [one sentence framing the core problem the prospect faces right now]
CTA: Book Your Paid Assessment

WHY THIS MATTERS
[One short paragraph explaining why this engagement is critical BEFORE Copilot deployment, governance modernisation, or an upcoming audit. Match this tone: "Before you deploy Copilot, modernise governance, or face an audit, you need to know exactly what you're working with."]

VALUE PILLARS
Pillar 1 — Clear Visibility Into Data Exposure
[1–2 authoritative sentences. No guessing — a data-driven map of the actual tenant state.]

Pillar 2 — Prioritised Remediation Roadmap
[1–2 authoritative sentences explaining what the prioritised findings enable the client to act on.]

Pillar 3 — Confidence for Copilot Deployment
[1–2 authoritative sentences explaining how this engagement unlocks a safe, governed Copilot rollout.]

WHAT YOU GET
${deliverablesBullets}

WHAT THIS SOLVES
${outcomesBullets}

AUTHORITY
Built at NASA Scale. Available to You.
Shane McCaw is NASA's Lead Microsoft 365 Architect — 30 years inside the Microsoft ecosystem. Senior-level delivery only. No junior staff. No handoffs. Mission-critical compliance experience: FedRAMP, FISMA, ITAR, GCC High.

PROCESS
01 — Discovery Call: A 30-minute call to understand your environment. No pitch. No obligation.
02 — Scoped Engagement: Fixed-price, clearly defined deliverables. No open-ended fees. No scope creep.
03 — Actionable Results: A documented, immediately executable output delivered personally by Shane.

FINAL CTA
[One closing sentence reinforcing: paid assessment, fixed price, senior-level delivery, readiness score within two weeks.]
CTA: Book Your Paid Assessment`;

    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1400,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "";
    if (!raw.trim()) {
      res.status(502).json({ error: "AI returned empty content — please try again" });
      return;
    }

    res.json({ copy: raw.trim() });
  } catch (e) {
    req.log.error({ err: e }, "Failed to generate landing copy");
    res.status(500).json({ error: String(e) });
  }
});

router.post("/admin/marketing/generate/email-copy", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = req.body as {
      campaignName?: string;
      goal?: string;
      audience?: string;
      offer?: string;
      deliverables?: string[];
      outcomes?: string[];
    };

    const icpCtx = await buildICPContext();

    const deliverables = (body.deliverables ?? []).filter(Boolean);
    const outcomes = (body.outcomes ?? []).filter(Boolean);

    const offerSection = [
      body.offer ? `Offer description: ${body.offer}` : "",
      deliverables.length > 0 ? `Deliverables: ${deliverables.join(", ")}` : "",
      outcomes.length > 0 ? `Outcomes / results: ${outcomes.join(", ")}` : "",
    ].filter(Boolean).join("\n");

    const prompt = `You are an email copywriter for a Microsoft 365 consulting firm.
${icpCtx}
Campaign: ${body.campaignName ?? "Microsoft 365 Consulting"}
Goal: ${body.goal ?? "Generate qualified leads"}
Target audience: ${body.audience ?? "IT decision-makers"}
${offerSection}

Write a plain-text 3-email nurture sequence. Use this exact format (no JSON, no markdown):

SUBJECT: <subject line for email 1>
EMAIL 1 — <short label, e.g. "The Problem">
<2–3 sentences that open a loop around the audience's #1 pain point. End with a soft curiosity hook.>

SUBJECT: <subject line for email 2>
EMAIL 2 — <short label, e.g. "The Solution">
<2–3 sentences that introduce the offer and tie one key deliverable to a concrete outcome. Reference a specific result or client win.>

SUBJECT: <subject line for email 3>
EMAIL 3 — <short label, e.g. "The Invitation">
<2–3 sentences that create urgency and issue a direct CTA. Be specific — tell them exactly what to do next.>

Keep the tone conversational and authoritative. Avoid generic openers like "I hope this finds you well". Each email should stand alone but build on the previous one.`;

    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "";
    if (!raw.trim()) {
      res.status(502).json({ error: "AI returned empty content — please try again" });
      return;
    }

    res.json({ copy: raw.trim() });
  } catch (e) {
    req.log.error({ err: e }, "Failed to generate email copy");
    res.status(500).json({ error: String(e) });
  }
});

router.get("/admin/marketing/landing-pages", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(landingPagesTable).orderBy(desc(landingPagesTable.createdAt));
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.post("/admin/marketing/landing-pages", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = req.body as { slug?: string; title?: string; headline?: string; subheadline?: string; valuePropBlocks?: unknown[]; socialProof?: unknown[]; cta?: unknown; campaignId?: number; linkedServiceId?: number | null; published?: boolean; layoutBlocks?: unknown[] };
    const resolvedTitle = body.title?.trim()
      || body.headline?.trim()
      || (body.slug ? body.slug.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "")
      || "Untitled Landing Page";
    const baseSlug = body.slug ?? resolvedTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
    const hasUserSlug = !!body.slug;

    let insertedRow: typeof landingPagesTable.$inferSelect | undefined;
    let lastInsertErr: unknown;
    for (let attempt = 0; attempt <= 5; attempt++) {
      const slug = hasUserSlug || attempt === 0 ? baseSlug : `${baseSlug.slice(0, 55)}-${attempt + 1}`;
      try {
        ([insertedRow] = await db.insert(landingPagesTable).values({
          slug, title: resolvedTitle, headline: body.headline ?? null,
          subheadline: body.subheadline ?? null,
          valuePropBlocks: (body.valuePropBlocks ?? []) as Array<{ icon?: string; heading: string; body: string }>,
          socialProof: (body.socialProof ?? []) as Array<{ quote: string; author: string; role?: string }>,
          cta: (body.cta ?? { buttonText: "Get Started", href: "/contact" }) as { buttonText: string; href: string; subtext?: string },
          layoutBlocks: (body.layoutBlocks ?? []) as Array<{ blockType: string; content: unknown }>,
          campaignId: body.campaignId ?? null,
          linkedServiceId: body.linkedServiceId ?? null,
          published: body.published ?? false,
        }).returning());
        break;
      } catch (e) {
        lastInsertErr = e;
        const errText = [String(e), String((e as Error)?.cause ?? "")].join(" ").toLowerCase();
        const isUnique = errText.includes("unique") || errText.includes("duplicate");
        if (isUnique && !hasUserSlug && attempt < 5) continue;
        if (isUnique) { res.status(409).json({ error: "A landing page with this slug already exists. Use a different title or URL slug." }); return; }
        throw e;
      }
    }
    if (!insertedRow) { res.status(500).json({ error: String(lastInsertErr) }); return; }
    res.status(201).json(insertedRow);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.patch("/admin/marketing/landing-pages/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    const body = req.body as Partial<{ slug: string; title: string; headline: string; subheadline: string; valuePropBlocks: unknown[]; socialProof: unknown[]; cta: unknown; campaignId: number; published: boolean }>;
    const [row] = await db.update(landingPagesTable).set({ ...body as Record<string, unknown>, updatedAt: new Date() }).where(eq(landingPagesTable.id, id)).returning();
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.delete("/admin/marketing/landing-pages/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    await db.delete(landingPagesTable).where(eq(landingPagesTable.id, parseId(req.params, "id")));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Public landing page route (no auth required for published; ?preview=<jwt> allows draft access)
router.get("/landing-pages/:slug", async (req: Request, res: Response) => {
  try {
    const slug = String(req.params.slug);
    const previewToken = typeof req.query.preview === "string" ? req.query.preview : null;

    let isAdminPreview = false;
    if (previewToken) {
      const secret = process.env.JWT_SECRET;
      if (secret) {
        try {
          const payload = (await import("jsonwebtoken")).default.verify(previewToken, secret) as { role?: string };
          if (payload.role === "admin") isAdminPreview = true;
        } catch { /* invalid token — treat as unauthenticated */ }
      }
    }

    const [page] = await db.select().from(landingPagesTable)
      .where(
        isAdminPreview
          ? eq(landingPagesTable.slug, slug)
          : and(eq(landingPagesTable.slug, slug), eq(landingPagesTable.published, true))
      ).limit(1);

    if (!page) { res.status(404).json({ error: "Not found" }); return; }

    // Resolve linked service visibility so the frontend can decide whether to gate the CTA
    let linkedService: { id: number; slug: string | null; name: string; description: string | null; visibility: string; billingType: string; price: string | null; basePrice: string | null; maxPrice: string | null; turnaround: string | null } | null = null;
    if (page.linkedServiceId) {
      const [svc] = await db.select({
        id: servicesTable.id,
        slug: servicesTable.slug,
        name: servicesTable.name,
        description: servicesTable.description,
        visibility: servicesTable.visibility,
        billingType: servicesTable.billingType,
        price: servicesTable.price,
        basePrice: servicesTable.basePrice,
        maxPrice: servicesTable.maxPrice,
        turnaround: servicesTable.turnaround,
      }).from(servicesTable).where(eq(servicesTable.id, page.linkedServiceId)).limit(1);
      if (svc) linkedService = { ...svc, description: svc.description ?? null, price: svc.price ?? null, basePrice: svc.basePrice ?? null, maxPrice: svc.maxPrice ?? null, turnaround: svc.turnaround ?? null };
    }

    res.json({ ...page, _preview: isAdminPreview && !page.published, linkedService });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Issue a short-lived HMAC-SHA256 token for a landing page's linked LP-only service
router.post("/landing-pages/:slug/token", async (req: Request, res: Response) => {
  try {
    const slug = String(req.params.slug);
    const [page] = await db.select().from(landingPagesTable)
      .where(and(eq(landingPagesTable.slug, slug), eq(landingPagesTable.published, true))).limit(1);
    if (!page) { res.status(404).json({ error: "Landing page not found" }); return; }
    if (!page.linkedServiceId) { res.status(400).json({ error: "This landing page has no linked service" }); return; }

    const [svc] = await db.select({ id: servicesTable.id, visibility: servicesTable.visibility })
      .from(servicesTable).where(eq(servicesTable.id, page.linkedServiceId)).limit(1);
    if (!svc) { res.status(404).json({ error: "Linked service not found" }); return; }
    if (svc.visibility !== "landing_page_only") { res.status(400).json({ error: "Linked service is not restricted to landing pages" }); return; }

    const crypto = await import("crypto");
    const secret = process.env.JWT_SECRET ?? "";
    const exp = Date.now() + 24 * 60 * 60 * 1000;
    const payload = Buffer.from(JSON.stringify({ serviceId: svc.id, exp })).toString("base64url");
    const sig = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    const token = `${payload}.${sig}`;
    res.json({ token, serviceId: svc.id, exp });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Public gate-status check — returns whether the LP is gated and whether the
// requesting user already holds the linked service.  The Authorization header
// is optional; omitting it (or passing an invalid token) means hasAccess=false.
router.get("/landing-pages/:slug/gate-status", async (req: Request, res: Response) => {
  try {
    const slug = String(req.params.slug);

    const [page] = await db.select({ id: landingPagesTable.id, linkedServiceId: landingPagesTable.linkedServiceId })
      .from(landingPagesTable)
      .where(and(eq(landingPagesTable.slug, slug), eq(landingPagesTable.published, true)))
      .limit(1);

    if (!page) { res.status(404).json({ error: "Not found" }); return; }

    let isLpOnly = false;
    let hasAccess = false;

    if (page.linkedServiceId) {
      const [svc] = await db.select({ visibility: servicesTable.visibility })
        .from(servicesTable).where(eq(servicesTable.id, page.linkedServiceId)).limit(1);
      if (svc) isLpOnly = svc.visibility === "landing_page_only";
    }

    // Optionally verify the caller's JWT and check service ownership
    if (isLpOnly && page.linkedServiceId) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.slice(7);
        const secret = process.env.JWT_SECRET;
        if (secret) {
          try {
            const payload = (await import("jsonwebtoken")).default.verify(token, secret) as { id?: number; role?: string };
            if (payload.id) {
              const [match] = await db.select({ id: clientServicesTable.id })
                .from(clientServicesTable)
                .where(and(
                  eq(clientServicesTable.clientUserId, payload.id),
                  eq(clientServicesTable.serviceId, page.linkedServiceId),
                  eq(clientServicesTable.status, "active"),
                ))
                .limit(1);
              if (match) hasAccess = true;
            }
          } catch { /* invalid token — hasAccess stays false */ }
        }
      }
    }

    res.json({ isLpOnly, hasAccess });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── AI Suggest: Landing Page fields ─────────────────────────────────────────

router.post("/admin/marketing/suggest/landing-page", requireAdmin, async (req: Request, res: Response) => {
  try {
    const icpCtx = await buildICPContext();
    const prompt = `You are a conversion copywriter for a Microsoft 365 consulting firm.
${icpCtx}

Generate exactly 3 distinct landing page suggestions, each focused on a different service offering or micro-offer package. Each should have a specific topic, a well-defined audience, and a compelling call-to-action phrase.

Respond with ONLY a raw JSON array — no prose, no markdown fences. Schema:
[{"topic":"string","audience":"string","cta":"string"}]`;

    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 400,
      messages: [
        { role: "user", content: prompt },
        { role: "assistant", content: "[" },
      ],
    });
    const continuation = msg.content[0]?.type === "text" ? msg.content[0].text : "]";
    const raw = "[" + continuation;
    const schema = z.array(z.object({ topic: z.string(), audience: z.string(), cta: z.string() }));
    res.json(parseAiJson(raw, schema));
  } catch (e) {
    if (e instanceof AiResponseError) { req.log.warn({ err: e }, "AI parse failed on /suggest/landing-page"); res.json(aiErrorResponse(e)); return; }
    req.log.error({ err: e }, "POST /admin/marketing/suggest/landing-page failed");
    res.status(500).json({ error: String(e) });
  }
});

// Canonical alias: POST /admin/marketing/landing-pages/generate
router.post("/admin/marketing/landing-pages/generate", requireAdmin, (req: Request, res: Response) => {
  req.url = "/admin/marketing/generate/landing-page";
  (router as unknown as { handle(req: Request, res: Response, cb: () => void): void }).handle(req, res, () => res.status(404).json({ error: "Not found" }));
});

// ─── Lead Magnet Generator ────────────────────────────────────────────────────

router.post("/admin/marketing/generate/lead-magnet", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = req.body as { topic?: string; format?: string; audience?: string; campaignId?: number };
    const icpCtx = await buildICPContext();
    const prompt = `You are a content strategist for a Microsoft 365 consulting firm.
${icpCtx}
Topic: ${body.topic ?? "Microsoft 365 adoption"}
Format: ${body.format ?? "checklist"}
Audience: ${body.audience ?? "IT managers"}

Generate a lead magnet in JSON:
{
  "title": "lead magnet title (compelling, specific)",
  "subtitle": "one-line description of the value",
  "format": "checklist|ebook|template|guide|report",
  "items": ["item/point 1", "item/point 2", "item/point 3", "item 4", "item 5", "item 6", "item 7"],
  "cta": "what to promise readers when they fill out the form",
  "outlineMarkdown": "## Title\n\nFull content outline in markdown with 3-5 sections..."
}`;
    const msg = await anthropic.messages.create({ model: "claude-haiku-4-5", max_tokens: 1200, messages: [{ role: "user", content: prompt }] });
    const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
    const schema = z.object({ title: z.string(), subtitle: z.string(), format: z.string(), items: z.array(z.string()), cta: z.string(), outlineMarkdown: z.string() });
    const generated = parseAiJson(raw, schema);

    // Persist to campaign_assets so it's tracked in the content pipeline
    const generatedWithOfferIds = body.campaignId
      ? (await db.select({ id: offersTable.id }).from(offersTable).where(eq(offersTable.campaignId, body.campaignId))).map(o => o.id)
      : [];
    const [saved] = await db.insert(campaignAssetsTable).values({
      campaignId: body.campaignId ?? null,
      assetType: "lead_magnet",
      title: generated.title,
      content: generated.outlineMarkdown,
      metadata: { subtitle: generated.subtitle, format: generated.format, items: generated.items, cta: generated.cta },
      generatedWithOfferIds,
    }).returning();

    res.json({ ...generated, assetId: saved?.id ?? null });
  } catch (e) {
    if (e instanceof AiResponseError) {
      req.log.warn({ err: e }, "AI parse failed on /generate/lead-magnet");
      res.json({ ...aiErrorResponse(e), title: "", subtitle: "", format: "checklist", items: [], cta: "", outlineMarkdown: "", assetId: null });
      return;
    }
    res.status(500).json({ error: String(e) });
  }
});

// ─── Follow-Up Automation ─────────────────────────────────────────────────────

router.get("/admin/marketing/follow-ups", requireAdmin, async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
    const statusParam = req.query.status as string | undefined;

    // Auto-mark overdue before filtering (so due_today filter sees correct statuses)
    await db.update(followUpEventsTable)
      .set({ status: "overdue", updatedAt: now })
      .where(and(eq(followUpEventsTable.status, "pending"), lt(followUpEventsTable.scheduledAt, todayStart)));

    // Build where clause — supports: pending, completed, overdue, skipped, due_today
    const whereClause =
      statusParam === "due_today"
        ? and(
            or(eq(followUpEventsTable.status, "pending"), eq(followUpEventsTable.status, "overdue")),
            gte(followUpEventsTable.scheduledAt, todayStart),
            lte(followUpEventsTable.scheduledAt, todayEnd),
          )
        : statusParam
          ? eq(followUpEventsTable.status, statusParam as "pending" | "completed" | "overdue" | "skipped")
          : undefined;

    const rows = await db.select({
      fu: followUpEventsTable,
      leadName: leadsTable.name,
      leadEmail: leadsTable.email,
    }).from(followUpEventsTable).leftJoin(leadsTable, eq(followUpEventsTable.leadId, leadsTable.id))
      .where(whereClause ?? undefined).orderBy(followUpEventsTable.scheduledAt).limit(100);

    res.json(rows.map(r => ({ ...r.fu, leadName: r.leadName, leadEmail: r.leadEmail })));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Canonical alias: POST /admin/marketing/lead-magnets/generate
router.post("/admin/marketing/lead-magnets/generate", requireAdmin, (req: Request, res: Response) => {
  req.url = "/admin/marketing/generate/lead-magnet";
  (router as unknown as { handle(req: Request, res: Response, cb: () => void): void }).handle(req, res, () => res.status(404).json({ error: "Not found" }));
});

router.post("/admin/marketing/follow-ups", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = req.body as { leadId?: number; campaignId?: number; scheduledAt?: string; channel?: string; subject?: string; aiDraftContent?: string };
    if (!body.scheduledAt) { res.status(400).json({ error: "scheduledAt required" }); return; }
    const [row] = await db.insert(followUpEventsTable).values({
      leadId: body.leadId ?? null,
      campaignId: body.campaignId ?? null,
      scheduledAt: new Date(body.scheduledAt),
      channel: (body.channel ?? "email") as "email" | "linkedin" | "phone" | "other",
      subject: body.subject ?? null,
      aiDraftContent: body.aiDraftContent ?? null,
      status: "pending",
    }).returning();
    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// Generate draft copy for a SPECIFIC follow-up event and persist aiDraftContent to the record
router.post("/admin/marketing/follow-ups/:id/generate-copy", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    const [fu] = await db.select().from(followUpEventsTable).where(eq(followUpEventsTable.id, id)).limit(1);
    if (!fu) { res.status(404).json({ error: "Follow-up not found" }); return; }

    let leadCtx = "";
    if (fu.leadId) {
      const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, fu.leadId)).limit(1);
      if (lead) leadCtx = `Lead: ${lead.name}, ${lead.company ?? ""}, ${lead.industry ?? ""}, stage=${lead.stage}, pain points: ${lead.painPoints?.join(", ") || "none"}.`;
    }

    const icpCtx = await buildICPContext();
    const prompt = `You are writing a follow-up ${fu.channel} for a Microsoft 365 consultant.
${icpCtx}
${leadCtx}
Subject hint: ${fu.subject ?? "none"}.
Context: following up after initial outreach

Write a concise, value-driven follow-up message (3-5 sentences). Return JSON:
{ "subject": "email subject line", "content": "the full message body" }`;

    const msg = await anthropic.messages.create({ model: "claude-haiku-4-5", max_tokens: 500, messages: [{ role: "user", content: prompt }] });
    const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
    const draft = parseAiJson(raw, z.object({ subject: z.string(), content: z.string() }));

    // Persist aiDraftContent back to the specific follow-up record
    const [updated] = await db.update(followUpEventsTable)
      .set({ aiDraftContent: `Subject: ${draft.subject}\n\n${draft.content}`, subject: fu.subject ?? draft.subject, updatedAt: new Date() })
      .where(eq(followUpEventsTable.id, id)).returning();

    res.json({ ...draft, followUp: updated });
  } catch (e) {
    if (e instanceof AiResponseError) {
      req.log.warn({ err: e }, "AI parse failed on /follow-ups/:id/generate-copy");
      res.json({ ...aiErrorResponse(e), subject: "", content: "", followUp: null });
      return;
    }
    res.status(500).json({ error: String(e) });
  }
});

// Generic draft generation (no persistence — general-purpose)
router.post("/admin/marketing/generate/follow-up-draft", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = req.body as { leadId?: number; channel?: string; context?: string };
    let leadCtx = "";
    if (body.leadId) {
      const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, body.leadId)).limit(1);
      if (lead) leadCtx = `Lead: ${lead.name}, ${lead.company ?? ""}, ${lead.industry ?? ""}, stage=${lead.stage}.`;
    }
    const icpCtx = await buildICPContext();
    const prompt = `You are writing a follow-up ${body.channel ?? "email"} for a Microsoft 365 consultant.
${icpCtx}
${leadCtx}
Context: ${body.context ?? "following up after initial outreach"}

Write a concise, value-driven follow-up message (3-5 sentences). Return JSON:
{ "subject": "email subject line", "content": "the full message body" }`;
    const msg = await anthropic.messages.create({ model: "claude-haiku-4-5", max_tokens: 500, messages: [{ role: "user", content: prompt }] });
    const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
    res.json(parseAiJson(raw, z.object({ subject: z.string(), content: z.string() })));
  } catch (e) {
    if (e instanceof AiResponseError) {
      req.log.warn({ err: e }, "AI parse failed on /generate/follow-up-draft");
      res.json({ ...aiErrorResponse(e), subject: "", content: "" });
      return;
    }
    res.status(500).json({ error: String(e) });
  }
});

router.patch("/admin/marketing/follow-ups/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    const body = req.body as Partial<{ scheduledAt: string; channel: string; subject: string; aiDraftContent: string; status: string }>;
    const update: Record<string, unknown> = { ...body, updatedAt: new Date() };
    if (body.scheduledAt) update.scheduledAt = new Date(body.scheduledAt);
    const [row] = await db.update(followUpEventsTable).set(update).where(eq(followUpEventsTable.id, id)).returning();
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.post("/admin/marketing/follow-ups/:id/complete", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    const [row] = await db.update(followUpEventsTable).set({ status: "completed", completedAt: new Date(), updatedAt: new Date() }).where(eq(followUpEventsTable.id, id)).returning();
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.delete("/admin/marketing/follow-ups/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    await db.delete(followUpEventsTable).where(eq(followUpEventsTable.id, parseId(req.params, "id")));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Daily Revenue Command Panel ──────────────────────────────────────────────

router.get("/admin/marketing/daily-command", requireAdmin, async (req: Request, res: Response) => {
  try {
    // Allow ?refresh=1 to bust the cache
    const forceRefresh = req.query.refresh === "1";
    if (!forceRefresh && dailyCommandCache && dailyCommandCache.expiresAt > Date.now()) {
      res.json(dailyCommandCache.data);
      return;
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 86400000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    // Auto-mark overdue follow-ups before building action panel
    await db.update(followUpEventsTable)
      .set({ status: "overdue", updatedAt: now })
      .where(and(eq(followUpEventsTable.status, "pending"), lt(followUpEventsTable.scheduledAt, todayStart)));

    const [
      leadsToContact,
      followUpsTodayRaw,
      bestOffer,
      campaignAction,
      contentSuggestion,
      revenueThisMonth,
      landingPagesCount,
    ] = await Promise.all([
      // Top 3 hot leads not contacted in the last 7 days, ordered by score desc
      db.select({
        id: leadsTable.id, name: leadsTable.name, company: leadsTable.company,
        score: leadsTable.score, stage: leadsTable.stage, email: leadsTable.email,
        industry: leadsTable.industry, painPoints: leadsTable.painPoints,
      }).from(leadsTable)
        .where(and(
          gte(leadsTable.score, 30),
          or(ne(leadsTable.status, "contacted"), lte(leadsTable.updatedAt, weekAgo)),
        ))
        .orderBy(desc(leadsTable.score)).limit(3),

      // Top 2 follow-ups due today, ordered by linked lead score desc so highest-value contacts surface first
      db.select({
        fu: followUpEventsTable,
        leadName: leadsTable.name,
        leadEmail: leadsTable.email,
        leadScore: leadsTable.score,
      }).from(followUpEventsTable)
        .leftJoin(leadsTable, eq(followUpEventsTable.leadId, leadsTable.id))
        .where(and(
          or(eq(followUpEventsTable.status, "pending"), eq(followUpEventsTable.status, "overdue")),
          lte(followUpEventsTable.scheduledAt, todayEnd),
        ))
        .orderBy(desc(leadsTable.score), followUpEventsTable.scheduledAt).limit(2),

      // Offer to push: offer not touched in the last 5 days (oldest updatedAt first = needs promotion)
      db.select().from(offersTable)
        .where(lte(offersTable.updatedAt, new Date(now.getTime() - 5 * 86400000)))
        .orderBy(offersTable.updatedAt).limit(1),

      // Campaign that needs attention (lowest leads generated among active)
      db.select({
        id: campaignsTable.id, name: campaignsTable.name, status: campaignsTable.status,
        leadsGenerated: campaignsTable.leadsGenerated, revenueAttributed: campaignsTable.revenueAttributed,
      }).from(campaignsTable).where(eq(campaignsTable.status, "active"))
        .orderBy(campaignsTable.leadsGenerated).limit(1),

      // Content to create — latest campaign asset not published in last 7 days
      db.select({ id: campaignAssetsTable.id, title: campaignAssetsTable.title, assetType: campaignAssetsTable.assetType })
        .from(campaignAssetsTable).where(lt(campaignAssetsTable.createdAt, weekAgo))
        .orderBy(desc(campaignAssetsTable.createdAt)).limit(1),

      // Revenue attributed from active campaigns this month
      db.select({ total: sql<string>`COALESCE(SUM(revenue_attributed::numeric), 0)` })
        .from(campaignsTable).where(and(eq(campaignsTable.status, "active"), gte(campaignsTable.createdAt, monthStart))),

      db.select({ count: count() }).from(landingPagesTable).where(eq(landingPagesTable.published, true)),
    ]);

    const followUpsTodo = followUpsTodayRaw.map(r => ({ ...r.fu, leadName: r.leadName, leadEmail: r.leadEmail }));

    const icpCtx = await buildICPContext();
    const aiPrompt = `You are a revenue coach for a Microsoft 365 consulting business.
${icpCtx}
Today's snapshot:
- Leads to contact: ${leadsToContact.map(l => `${l.name} (${l.company ?? "?"}, score ${l.score}, ${l.industry ?? "unknown industry"})`).join("; ") || "none yet"}
- Follow-ups due: ${followUpsTodo.map(f => `${f.leadName ?? "unknown"} via ${f.channel}`).join("; ") || "none"}
- Best offer to push: ${bestOffer[0]?.name ?? "none configured"}
- Campaign needing attention: ${campaignAction[0]?.name ?? "none"} (${campaignAction[0]?.leadsGenerated ?? 0} leads)
- Revenue attributed this month: $${parseFloat(String(revenueThisMonth[0]?.total ?? "0")).toLocaleString()}

Return JSON:
{
  "topPriority": "single most important action today (one sentence)",
  "quickWins": ["win 1", "win 2", "win 3"],
  "revenueInsight": "one insight about revenue potential today",
  "revenueOpportunities": ["specific opportunity 1", "specific opportunity 2"],
  "closestToBuying": "name of the lead closest to buying and why (one sentence)",
  "nextBestActions": ["action 1 for lead 1", "action 2 for lead 2", "action 3"]
}`;

    let aiInsight = {
      topPriority: "Focus on your hottest leads today",
      quickWins: ["Send a LinkedIn message to your #1 hot lead", "Follow up on any overdue outreach", "Post one piece of value content"],
      revenueInsight: "Build pipeline momentum daily",
      revenueOpportunities: [],
      closestToBuying: "Review your hottest lead's pain points and match to your best offer",
      nextBestActions: [],
    } as {
      topPriority: string; quickWins: string[]; revenueInsight: string;
      revenueOpportunities: string[]; closestToBuying: string; nextBestActions: string[];
    };
    try {
      const msg = await anthropic.messages.create({ model: "claude-haiku-4-5", max_tokens: 600, messages: [{ role: "user", content: aiPrompt }] });
      const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
      const parsed = parseAiJson(raw, z.object({
        topPriority: z.string(), quickWins: z.array(z.string()), revenueInsight: z.string(),
        revenueOpportunities: z.array(z.string()).optional(),
        closestToBuying: z.string().optional(),
        nextBestActions: z.array(z.string()).optional(),
      }));
      aiInsight = {
        topPriority: parsed.topPriority,
        quickWins: parsed.quickWins,
        revenueInsight: parsed.revenueInsight,
        revenueOpportunities: parsed.revenueOpportunities ?? [],
        closestToBuying: parsed.closestToBuying ?? "",
        nextBestActions: parsed.nextBestActions ?? [],
      };
    } catch { /* use defaults */ }

    const data = {
      // 3 leads to contact
      leadsToContact,
      // 2 follow-ups to complete today
      followUpsTodo,
      // Offer to push
      offerToPush: bestOffer[0] ?? null,
      // Campaign needing attention
      campaignAction: campaignAction[0] ?? null,
      // Content suggestion
      contentSuggestion: contentSuggestion[0] ?? null,
      // Aggregate stats
      revenueThisMonth: parseFloat(String(revenueThisMonth[0]?.total ?? "0")),
      publishedLandingPages: Number(landingPagesCount[0]?.count ?? 0),
      // AI action panel
      aiInsight,
      generatedAt: now.toISOString(),
    };

    dailyCommandCache = { data, expiresAt: Date.now() + 60 * 60 * 1000 };
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── AI Money Tasks (revenue-focused task generation) ─────────────────────────

router.post("/admin/marketing/generate/money-tasks", requireAdmin, async (req: Request, res: Response) => {
  try {
    const icpCtx = await buildICPContext();
    const hotLeads = await db.select({ name: leadsTable.name, company: leadsTable.company, score: leadsTable.score })
      .from(leadsTable).where(gte(leadsTable.score, 40)).orderBy(desc(leadsTable.score)).limit(5);

    const prompt = `You are a revenue-focused advisor for a Microsoft 365 consulting firm.
${icpCtx}
Hot leads right now: ${hotLeads.map(l => `${l.name} (${l.company ?? "?"}, score ${l.score})`).join("; ") || "none yet"}

Generate 5-7 revenue-generating tasks (tasks that directly lead to income). Each task should be specific, actionable, and completable today or this week.

Respond with ONLY a raw JSON array — no prose, no markdown fences. Schema:
[{"title":"string","description":"string"}]`;

    // Prefill assistant turn with "[" to force JSON array output (no prose preamble)
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 800,
      messages: [
        { role: "user", content: prompt },
        { role: "assistant", content: "[" },
      ],
    });
    const continuation = msg.content[0]?.type === "text" ? msg.content[0].text : "]";
    const raw = "[" + continuation;
    const aiTasks = parseAiJson(raw, z.array(z.object({ title: z.string(), description: z.string() })));

    // Get current max order for money_task column
    const [maxOrderRow] = await db.select({ maxOrder: sql<number>`COALESCE(MAX(${marketingTasksTable.order}), 0)` })
      .from(marketingTasksTable).where(eq(marketingTasksTable.status, "money_task"));
    let nextOrder = Number(maxOrderRow?.maxOrder ?? 0) + 1;

    // Insert each task into the DB with status='money_task' and return persisted rows
    const insertedTasks: (typeof marketingTasksTable.$inferSelect)[] = [];
    for (const t of aiTasks) {
      const [inserted] = await db.insert(marketingTasksTable).values({
        title: t.title,
        description: t.description,
        status: "money_task",
        order: nextOrder++,
      }).returning();
      if (inserted) insertedTasks.push(inserted);
    }

    res.json(insertedTasks);
  } catch (e) {
    if (e instanceof AiResponseError) { req.log.warn({ err: e }, "AI parse failed on /generate/money-tasks"); res.json(aiErrorResponse(e)); return; }
    req.log.error({ err: e }, "POST /admin/marketing/generate/money-tasks failed");
    res.status(500).json({ error: String(e) });
  }
});

// ─── AI Analytics Insights ────────────────────────────────────────────────────

// Legacy alias — kept so any cached clients that hit the old path still work
router.get("/admin/marketing/ai-insights", requireAdmin, (_req, res) => res.redirect(307, "/api/admin/marketing/analytics/insights"));

router.get("/admin/marketing/analytics/insights", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 86400000);
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(todayStart.getTime() - 86400000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);

    const [campaignPerf, leadStats, taskStats, topLPs, todaySessions, avgDailySessions, hotLeads] = await Promise.all([
      db.select({ name: campaignsTable.name, leads: campaignsTable.leadsGenerated, revenue: campaignsTable.revenueAttributed }).from(campaignsTable).where(eq(campaignsTable.status, "active")).limit(5),
      db.select({ count: count() }).from(leadsTable).where(gte(leadsTable.createdAt, monthAgo)),
      db.select({ status: marketingTasksTable.status, count: count() }).from(marketingTasksTable).groupBy(marketingTasksTable.status),
      db.select({ slug: landingPagesTable.slug, title: landingPagesTable.title }).from(landingPagesTable).where(eq(landingPagesTable.published, true)).limit(5),
      // Today's sessions for hot-traffic spike detection
      db.select({ cnt: count() }).from(analyticsSessionsTable).where(gte(analyticsSessionsTable.startedAt, todayStart)),
      // 7-day average daily sessions (yesterday and earlier to compare)
      db.select({ cnt: count() }).from(analyticsSessionsTable).where(and(gte(analyticsSessionsTable.startedAt, sevenDaysAgo), lt(analyticsSessionsTable.startedAt, todayStart))),
      db.select({ cnt: count() }).from(leadsTable).where(gte(leadsTable.score, 70)),
    ]);

    // Hot-traffic spike: today vs 7-day average
    const todayCount = Number(todaySessions[0]?.cnt ?? 0);
    const avgDaily = Number(avgDailySessions[0]?.cnt ?? 0) / 7;
    const trafficSpike = avgDaily > 0 && todayCount > avgDaily * 2;
    const trafficSpikeNote = trafficSpike
      ? `⚠ Hot traffic spike: ${todayCount} sessions today vs ${avgDaily.toFixed(0)} daily avg — high-intent visitors likely. Push your best offer now.`
      : null;

    const icpCtx = await buildICPContext();
    const prompt = `You are analyzing marketing performance for a Microsoft 365 consulting business.
${icpCtx}
Last 30 days:
- New leads: ${leadStats[0]?.count ?? 0}
- Hot leads (score ≥70): ${hotLeads[0]?.cnt ?? 0}
- Active campaigns: ${campaignPerf.map(c => `${c.name} (${String(c.leads ?? 0)} leads, $${String(c.revenue ?? 0)} revenue)`).join("; ") || "none"}
- Task pipeline: ${taskStats.map(t => `${t.status}=${t.count}`).join(", ")}
- Published landing pages: ${topLPs.map(p => p.title).join(", ") || "none"}
${trafficSpikeNote ? `- ${trafficSpikeNote}` : ""}

Return JSON:
{
  "summary": "2-sentence overall performance summary",
  "wins": ["win 1", "win 2"],
  "gaps": ["gap 1", "gap 2"],
  "recommendations": [{"action": "specific action", "impact": "expected impact"}, {"action": "action 2", "impact": "impact 2"}],
  "revenueAlert": "one critical observation about revenue risk or opportunity",
  "hotTrafficAlert": "traffic spike observation or empty string if no spike"
}`;

    const msg = await anthropic.messages.create({ model: "claude-haiku-4-5", max_tokens: 800, messages: [{ role: "user", content: prompt }] });
    const raw = msg.content[0]?.type === "text" ? msg.content[0].text : "{}";
    const schema = z.object({
      summary: z.string(), wins: z.array(z.string()), gaps: z.array(z.string()),
      recommendations: z.array(z.object({ action: z.string(), impact: z.string() })),
      revenueAlert: z.string(),
      hotTrafficAlert: z.string().optional(),
    });
    const parsed = parseAiJson(raw, schema);
    res.json({ ...parsed, trafficSpikeDetected: trafficSpike, trafficSpikeNote });
  } catch (e) {
    if (e instanceof AiResponseError) {
      logger.warn({ err: e }, "AI parse failed on /analytics/insights");
      res.json({ ...aiErrorResponse(e), summary: "AI analysis could not be generated — please try again", wins: [], gaps: [], recommendations: [], revenueAlert: "", trafficSpikeDetected: false, trafficSpikeNote: null });
      return;
    }
    res.status(500).json({ error: String(e) });
  }
});

// ─── Admin: Create lead from AI suggestion ────────────────────────────────────

router.post("/admin/leads", requireAdmin, async (req: Request, res: Response) => {
  try {
    const body = req.body as { name?: string; company?: string; role?: string; industry?: string };
    const { name, company, role, industry } = body;

    if (!name?.trim()) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const emailFallback = `${name.toLowerCase().replace(/\s+/g, ".")}@${(company ?? "unknown").toLowerCase().replace(/[^a-z0-9]/g, "")}.com`;

    const [newLead] = await db.insert(leadsTable).values({
      name: name.trim(),
      email: emailFallback,
      company: company?.trim() ?? null,
      role: role?.trim() ?? null,
      industry: industry?.trim() ?? null,
      source: "ai_suggested",
      status: "new",
      notes: `[AI Suggested] Created from Outreach Automation tab.`,
    }).returning();

    res.status(201).json(newLead);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Active campaign badges with live visitor counts ─────────────────────────

router.get("/admin/marketing/active-campaign-badges", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const cutoff = new Date(Date.now() - 5 * 60 * 1000);

    const rows = await db
      .select({
        id: campaignsTable.id,
        name: campaignsTable.name,
        slug: landingPagesTable.slug,
      })
      .from(campaignsTable)
      .innerJoin(landingPagesTable, and(
        eq(landingPagesTable.campaignId, campaignsTable.id),
        eq(landingPagesTable.published, true),
      ))
      .where(eq(campaignsTable.status, "active"));

    if (rows.length === 0) { res.json([]); return; }

    const perPage = await Promise.all(
      rows.map(async (r) => {
        try {
          const pattern = `%/landing-pages/${r.slug}%`;
          const result = await db.execute(sql`
            SELECT COUNT(DISTINCT ap.session_id)::text AS cnt
            FROM analytics_pageviews ap
            JOIN analytics_sessions s ON s.session_id = ap.session_id
            WHERE s.last_seen_at >= ${cutoff}
            AND ap.page LIKE ${pattern}
          `);
          const qrows = (result as unknown as { rows: { cnt: string }[] }).rows ?? [];
          const cnt = parseInt(qrows[0]?.cnt ?? "0", 10);
          return { id: r.id, name: r.name, slug: r.slug, liveCount: isNaN(cnt) ? 0 : cnt };
        } catch {
          return { id: r.id, name: r.name, slug: r.slug, liveCount: 0 };
        }
      })
    );

    const byId = new Map<number, { id: number; name: string; slug: string; liveCount: number }>();
    for (const r of perPage) {
      const existing = byId.get(r.id);
      if (existing) {
        existing.liveCount += r.liveCount;
      } else {
        byId.set(r.id, { ...r });
      }
    }

    res.json(Array.from(byId.values()));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Campaign badges — SSE stream ────────────────────────────────────────────
// Pushes live visitor counts for active campaign landing pages every 5 seconds.
// Uses the same query as the GET endpoint above. Auth is handled by requireAdmin
// (Bearer JWT), so the client must use fetchWithAuth rather than EventSource.

async function fetchCampaignBadgesData(): Promise<{ id: number; name: string; slug: string; liveCount: number }[]> {
  const cutoff = new Date(Date.now() - 5 * 60 * 1000);

  const rows = await db
    .select({
      id: campaignsTable.id,
      name: campaignsTable.name,
      slug: landingPagesTable.slug,
    })
    .from(campaignsTable)
    .innerJoin(landingPagesTable, and(
      eq(landingPagesTable.campaignId, campaignsTable.id),
      eq(landingPagesTable.published, true),
    ))
    .where(eq(campaignsTable.status, "active"));

  if (rows.length === 0) return [];

  const perPage = await Promise.all(
    rows.map(async (r) => {
      try {
        const pattern = `%/landing-pages/${r.slug}%`;
        const result = await db.execute(sql`
          SELECT COUNT(DISTINCT ap.session_id)::text AS cnt
          FROM analytics_pageviews ap
          JOIN analytics_sessions s ON s.session_id = ap.session_id
          WHERE s.last_seen_at >= ${cutoff}
          AND ap.page LIKE ${pattern}
        `);
        const qrows = (result as unknown as { rows: { cnt: string }[] }).rows ?? [];
        const cnt = parseInt(qrows[0]?.cnt ?? "0", 10);
        return { id: r.id, name: r.name, slug: r.slug, liveCount: isNaN(cnt) ? 0 : cnt };
      } catch {
        return { id: r.id, name: r.name, slug: r.slug, liveCount: 0 };
      }
    })
  );

  const byId = new Map<number, { id: number; name: string; slug: string; liveCount: number }>();
  for (const r of perPage) {
    const existing = byId.get(r.id);
    if (existing) {
      existing.liveCount += r.liveCount;
    } else {
      byId.set(r.id, { ...r });
    }
  }

  return Array.from(byId.values());
}

router.get("/admin/marketing/campaign-badges-stream", requireAdmin, (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: unknown): void => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const push = (): void => {
    fetchCampaignBadgesData()
      .then(send)
      .catch(() => send([]));
  };

  push();
  const interval = setInterval(push, 5_000);

  req.on("close", () => {
    clearInterval(interval);
  });
});

// ─── Social token health ─────────────────────────────────────────────────────

router.get("/admin/marketing/social-token-health", requireAdmin, async (_req: Request, res: Response) => {
  const linkedinToken   = process.env.LINKEDIN_ACCESS_TOKEN;
  const facebookToken   = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  const facebookPageId  = process.env.FACEBOOK_PAGE_ID;

  const expiryRows = await db
    .select({ key: settingsTable.key, value: settingsTable.value })
    .from(settingsTable)
    .where(inArray(settingsTable.key, ["linkedin_token_expires_at", "facebook_token_expires_at"]))
    .catch(() => [] as { key: string; value: string | null }[]);

  const stored: Record<string, string | null> = Object.fromEntries(expiryRows.map(r => [r.key, r.value]));

  function daysUntil(iso: string | null | undefined): number | null {
    if (!iso) return null;
    const diff = new Date(iso).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  // ── LinkedIn ──
  const linkedinExpiresAt = stored["linkedin_token_expires_at"] ?? null;
  let linkedinValid: boolean | null = null;
  let linkedinError: string | null = null;

  if (linkedinToken) {
    try {
      const r = await fetch("https://api.linkedin.com/v2/me", {
        headers: { Authorization: `Bearer ${linkedinToken}` },
        signal: AbortSignal.timeout(8_000),
      });
      linkedinValid = r.ok;
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { message?: string };
        linkedinError = body?.message ?? `LinkedIn API returned ${r.status}`;
      }
    } catch (e) {
      linkedinError = String(e);
    }
  }

  // ── Facebook ──
  const facebookExpiresAt = stored["facebook_token_expires_at"] ?? null;
  let facebookValid: boolean | null = null;
  let facebookError: string | null = null;

  if (facebookToken) {
    const target = facebookPageId ? encodeURIComponent(facebookPageId) : "me";
    try {
      const r = await fetch(
        `https://graph.facebook.com/v19.0/${target}?fields=id,name&access_token=${encodeURIComponent(facebookToken)}`,
        { signal: AbortSignal.timeout(8_000) },
      );
      facebookValid = r.ok;
      if (!r.ok) {
        const body = await r.json().catch(() => ({})) as { error?: { message?: string } };
        facebookError = body?.error?.message ?? `Facebook Graph API returned ${r.status}`;
      }
    } catch (e) {
      facebookError = String(e);
    }
  }

  res.json({
    linkedin: {
      tokenSet: !!linkedinToken,
      valid: linkedinValid,
      expiresAt: linkedinExpiresAt,
      daysUntilExpiry: daysUntil(linkedinExpiresAt),
      error: linkedinError,
    },
    facebook: {
      tokenSet: !!facebookToken,
      valid: facebookValid,
      expiresAt: facebookExpiresAt,
      daysUntilExpiry: daysUntil(facebookExpiresAt),
      error: facebookError,
    },
  });
});

router.post("/admin/marketing/social-token-health/set-expiry", requireAdmin, async (req: Request, res: Response) => {
  const { platform, expiresAt } = req.body as { platform?: string; expiresAt?: string };
  if (!platform || !["linkedin", "facebook"].includes(platform)) {
    res.status(400).json({ error: "platform must be 'linkedin' or 'facebook'" });
    return;
  }
  if (!expiresAt || isNaN(Date.parse(expiresAt))) {
    res.status(400).json({ error: "expiresAt must be a valid ISO date string" });
    return;
  }
  const key = `${platform}_token_expires_at`;
  await db
    .insert(settingsTable)
    .values({ key, value: expiresAt })
    .onConflictDoUpdate({ target: settingsTable.key, set: { value: expiresAt, updatedAt: new Date() } });
  res.json({ ok: true });
});

// ─── Site config (public site URL for linking) ───────────────────────────────

router.get("/admin/site-config", requireAdmin, (_req: Request, res: Response) => {
  const domains = (process.env.REPLIT_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);

  const custom = domains.find((d) => !d.includes("replit."));
  if (custom) { res.json({ publicSiteUrl: `https://${custom}` }); return; }

  const replitApp = domains.find((d) => d.endsWith(".replit.app"));
  if (replitApp) { res.json({ publicSiteUrl: `https://${replitApp}` }); return; }

  const replitDev = domains.find((d) => d.endsWith(".replit.dev")) ?? process.env.REPLIT_DEV_DOMAIN;
  if (replitDev) { res.json({ publicSiteUrl: `https://${replitDev}` }); return; }

  res.json({ publicSiteUrl: "" });
});

export default router;
