import { Router, type Request, type Response } from "express";
import {
  db, leadsTable, recommendedLeadsTable, outreachTemplatesTable,
  marketingTasksTable, campaignsTable, campaignAssetsTable,
  analyticsSessionsTable, analyticsSiteEventsTable, servicesTable,
  settingsTable, quizPainSignalConfigTable, emailEventsTable, seoRankingsTable,
} from "@workspace/db";
import { eq, desc, count, and, gte, sql, inArray } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { sendMessage, GraphMailConfigError } from "../lib/graphEmail";
import { fetchTopQueries } from "../lib/search-console";
import { z } from "zod";

const router = Router();

function parseId(params: Request["params"], key: string): number {
  return parseInt(String(params[key] ?? ""), 10);
}

function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
}

class AiResponseError extends Error {}

function parseAiJson<T>(text: string, schema: z.ZodType<T>): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(text));
  } catch {
    throw new AiResponseError("AI returned an unreadable response — please try again");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new AiResponseError("AI returned unexpected format — please try again");
  }
  return result.data;
}

// ─── ICP context helper — sources from DB ─────────────────────────────────────

async function buildICPContext(): Promise<string> {
  const [services, topLeads, painSignals, icpSettings] = await Promise.all([
    db.select({ name: servicesTable.name, description: servicesTable.description, targetAudience: servicesTable.targetAudience })
      .from(servicesTable).where(eq(servicesTable.isPublic, true)).limit(8),
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

    res.json({ visitorsToday: visitors, leadsThisWeek: leads, conversionRate, activeCampaigns: campaigns });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ─── Recommended Leads ────────────────────────────────────────────────────────

router.get("/admin/marketing/recommended-leads", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db.select().from(recommendedLeadsTable).orderBy(desc(recommendedLeadsTable.generatedAt)).limit(40);
    res.json(rows);
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

router.post("/admin/marketing/recommended-leads/generate", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const icpContext = await buildICPContext();

    const message = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 2000,
      messages: [{
        role: "user",
        content: `You are a B2B lead generation specialist for a Microsoft 365 consulting firm led by Shane McCaw, a 30-year Microsoft veteran and NASA M365 architect.

${icpContext}

Generate 7 highly specific, realistic recommended leads who perfectly match the above ICP. Each should be a real-sounding decision-maker at a company that would genuinely benefit from these services.

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
]`,
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
    const status = e instanceof AiResponseError ? 422 : 500;
    res.status(status).json({ error: e instanceof Error ? e.message : String(e) });
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

    const prompts: Record<string, string> = {
      cold_email: `Write a concise, personalized cold email from Shane McCaw (Lead Microsoft 365 Architect, 30-year Microsoft veteran, NASA M365 architect) to ${leadData.name} at ${leadData.company} (${leadData.role}, ${leadData.industry}). Pain points: ${painStr}. Context: ${icpContext}. Keep it short, no fluff, specific value prop, clear CTA. Format: SUBJECT: ...\n\nBODY: ...`,
      linkedin: `Write a LinkedIn connection request message from Shane McCaw to ${leadData.name} at ${leadData.company}. 300 chars max. Reference their ${leadData.industry} context and offer value around Microsoft 365. No salesy language. Be specific.`,
      followup: `Write a 3-touch follow-up email sequence from Shane McCaw to ${leadData.name} at ${leadData.company} who hasn't responded to the initial outreach. Pain points: ${painStr}. Each email shorter and different angle. Format: EMAIL 1:\nSUBJECT: ...\nBODY: ...\n\nEMAIL 2:\nSUBJECT: ...\nBODY: ...\n\nEMAIL 3:\nSUBJECT: ...\nBODY: ...`,
      cold_call: `Write a cold call script for Shane McCaw to call ${leadData.name} at ${leadData.company} (${leadData.role}, ${leadData.industry}). Include: opener (5 sec), permission ask, value prop (15 sec), pain-point discovery question, objection handler for "not interested", CTA. Keep under 90 seconds conversational flow.`,
    };

    const prompt = prompts[body.templateType] ?? prompts["cold_email"] ?? "";
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
      max_tokens: 3000,
      messages: [{
        role: "user",
        content: `You are a marketing strategist for Shane McCaw Consulting, a Microsoft 365 consulting firm.

Campaign Brief:
- Name: ${body.name}
- Goal: ${body.goal}
- Target Audience: ${body.audience}
- Offer: ${body.offer}

Generate complete campaign assets. Respond with JSON only (no markdown):
{
  "landing_copy": {
    "title": "Landing Page Copy",
    "content": "Headline\\nSubheadline\\nValue props (bullet list)\\nCTA button text"
  },
  "email_sequence": {
    "title": "3-Email Sequence",
    "content": "EMAIL 1 - Subject: ...\\nBody: ...\\n\\nEMAIL 2 - Subject: ...\\nBody: ...\\n\\nEMAIL 3 - Subject: ...\\nBody: ..."
  },
  "social_posts": {
    "title": "Social Media Posts",
    "content": "LINKEDIN:\\n...\\n\\nTWITTER/X:\\n...\\n\\nFACEBOOK:\\n..."
  },
  "follow_up_tasks": {
    "title": "Follow-Up Task List",
    "content": "1. ...\\n2. ...\\n3. ...\\n4. ...\\n5. ..."
  }
}`,
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
    const status = e instanceof AiResponseError ? 422 : 500;
    res.status(status).json({ error: e instanceof Error ? e.message : String(e) });
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
    const status = e instanceof AiResponseError ? 422 : 500;
    res.status(status).json({ error: e instanceof Error ? e.message : String(e) });
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
    const status = e instanceof AiResponseError ? 422 : 500;
    res.status(status).json({ error: e instanceof Error ? e.message : String(e) });
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
    const status = e instanceof AiResponseError ? 422 : 500;
    res.status(status).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ─── AI Suggest: Campaign Field ───────────────────────────────────────────────

router.post("/admin/marketing/generate/campaign-suggest", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { field, name, goal, audience } = req.body as {
      field: "goal" | "audience" | "offer";
      name?: string;
      goal?: string;
      audience?: string;
    };
    const icpContext = await buildICPContext();

    const fieldPrompts: Record<string, string> = {
      goal: `Suggest a specific, measurable campaign goal for a Microsoft 365 consulting firm. Campaign name: "${name ?? "new campaign"}". Context: ${icpContext}. Return one concise goal sentence (1-2 sentences).`,
      audience: `Suggest a target audience description for a Microsoft 365 consulting campaign with goal: "${goal ?? "generate leads"}". Context: ${icpContext}. Return one concise audience paragraph.`,
      offer: `Suggest a compelling offer for a Microsoft 365 consulting campaign targeting "${audience ?? "IT decision-makers"}" with goal "${goal ?? "generate leads"}". Context: ${icpContext}. Return one concise offer description (1-2 sentences).`,
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
    const status = e instanceof AiResponseError ? 422 : 500;
    res.status(status).json({ error: e instanceof Error ? e.message : String(e) });
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
    const [row] = await db.insert(campaignAssetsTable)
      .values({ campaignId: campaignId ?? null, assetType: assetType as AssetType, title, content })
      .returning();
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

router.patch("/admin/marketing/campaign-assets/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = parseId(req.params, "id");
    const { title, content, assetType } = req.body as { title?: string; content?: string; assetType?: string };
    type AssetType = "landing_copy" | "email_sequence" | "social_post" | "follow_up_task" | "blog_post" | "linkedin_post" | "newsletter" | "seo_keywords";
    const updateData: Partial<typeof campaignAssetsTable.$inferInsert> = {};
    if (title !== undefined) updateData.title = title;
    if (content !== undefined) updateData.content = content;
    if (assetType !== undefined) updateData.assetType = assetType as AssetType;
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
    const inserted = await db.insert(campaignAssetsTable)
      .values(body.assets.map(a => ({
        campaignId: body.campaignId,
        assetType: a.assetType as AssetType,
        title: a.title,
        content: a.content,
      })))
      .returning();
    res.json(inserted);
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

router.get("/admin/marketing/analytics", requireAdmin, async (_req: Request, res: Response) => {
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
          (SELECT COUNT(DISTINCT s.id) FROM analytics_sessions s
           JOIN analytics_pageviews p ON p.session_id = s.id
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

export default router;
