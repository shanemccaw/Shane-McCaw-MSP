import { createHmac } from "crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { db, quizLeadsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { generateQuizPdf } from "../lib/quiz-pdf";
import { sendEmailWithAttachment, sendEmailWithAttachmentOrThrow, sendEmail, brandedEmail, quizLeadNotificationEmail } from "../lib/mailer";

/** Generate a short HMAC token that proves the caller completed quiz leadId. */
function makeResendToken(leadId: number): string {
  const secret = process.env.JWT_SECRET ?? "quiz-resend-fallback";
  return createHmac("sha256", secret).update(String(leadId)).digest("hex");
}

function verifyResendToken(leadId: number, token: string): boolean {
  return makeResendToken(leadId) === token;
}

const router = Router();

const chatLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many quiz chat requests from this IP. Please try again in an hour." },
});

const resendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many resend requests from this IP. Please try again in an hour." },
});

const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many quiz submissions from this IP. Please try again in an hour." },
});

// ─── System prompt for the quiz AI ────────────────────────────────────────────
const QUIZ_SYSTEM_PROMPT = `You are a Microsoft Copilot readiness assessment specialist working for Shane McCaw Consulting. Your job is to conduct a structured 10-question readiness quiz for organisations considering deploying Microsoft 365 Copilot.

You ask exactly 10 questions, one at a time. Each question probes one of five readiness categories (two questions per category):

1. Infrastructure & Identity (Q1, Q2): Microsoft 365 licensing status, Entra ID configuration, MFA deployment, device compliance.
2. Data & Compliance (Q3, Q4): Sensitivity labels, DLP policies, data governance, information barriers.
3. AI Literacy (Q5, Q6): Employee AI skills, training plans, adoption culture, AI champions.
4. Change Management (Q7, Q8): Executive buy-in, Copilot policy documentation, rollout planning, pilot programmes.
5. Business Process (Q9, Q10): Identified use cases, ROI tracking plans, success metrics, process owners.

Rules:
- Ask questions in a conversational, professional tone.
- Do NOT number the questions explicitly (e.g., don't say "Question 1 of 10").
- Ask one focused question at a time and wait for the user's answer.
- Keep each question to 1–2 sentences maximum.
- On the very first message (when the conversation is empty), greet the user briefly (1 sentence) and immediately ask the first question about their M365 licensing.
- For questions 2–10, acknowledge the previous answer in one short sentence before asking the next question.
- Do NOT provide scores, feedback, or analysis during the quiz — save all evaluation for the end.
- After question 10 is answered, respond with exactly: "Thank you — that completes the assessment. I'll now generate your personalised readiness report."`;

// ─── POST /api/quiz/chat ───────────────────────────────────────────────────────
const chatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
  })),
});

router.post("/quiz/chat", chatLimiter, async (req, res) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const { messages } = parsed.data;

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      system: QUIZ_SYSTEM_PROMPT,
      messages: messages.length === 0
        ? [{ role: "user", content: "Start the quiz." }]
        : messages,
    });

    const block = response.content[0];
    if (!block || block.type !== "text") {
      return res.status(500).json({ error: "Unexpected AI response" });
    }

    return res.json({ content: block.text });
  } catch (err) {
    logger.error({ err }, "quiz/chat: AI call failed");
    return res.status(500).json({ error: "AI service unavailable" });
  }
});

// ─── POST /api/quiz/submit ─────────────────────────────────────────────────────
const submitSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  company: z.string().optional(),
  conversation: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
  })),
});

const SERVICE_MAP: Record<string, string> = {
  "Microsoft 365 Essentials Audit": "A comprehensive tenant audit revealing quick wins and critical gaps in your M365 environment.",
  "Copilot AI Readiness & Deployment": "End-to-end Copilot enablement: licensing, data governance, training, and governed rollout.",
  "Microsoft 365 Governance Setup": "Establish DLP policies, sensitivity labels, and compliance controls that protect your data.",
  "AI Adoption & Change Management": "Drive Copilot adoption through executive alignment, champion networks, and structured change management.",
  "SharePoint & Teams Modernisation": "Redesign your intranet and collaboration spaces so Copilot has clean, well-structured data to work with.",
};

router.post("/quiz/submit", submitLimiter, async (req, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }

  const { name, email, company, conversation } = parsed.data;

  // Ask Claude to score the conversation
  const conversationText = conversation
    .map((m) => `${m.role === "assistant" ? "Quiz" : "Respondent"}: ${m.content}`)
    .join("\n\n");

  const scoringPrompt = `You are scoring a Microsoft Copilot Readiness Assessment. Below is the full quiz conversation. Score the respondent across 5 categories (0–10 each) based on their answers. Also select the most appropriate service recommendation.

CONVERSATION:
${conversationText}

Categories to score (0–10 each):
- infrastructure: M365 licensing, Entra ID, MFA, device compliance
- data: Sensitivity labels, DLP, governance, compliance
- aiLiteracy: Employee AI skills, training, adoption culture
- changeManagement: Executive buy-in, policies, rollout planning
- businessProcess: Use cases identified, ROI tracking, success metrics

Service options (pick exactly one):
- "Microsoft 365 Essentials Audit" — best for early-stage orgs with licensing/infrastructure gaps
- "Copilot AI Readiness & Deployment" — best for orgs ready to deploy but needing guided rollout
- "Microsoft 365 Governance Setup" — best for orgs with data/compliance gaps
- "AI Adoption & Change Management" — best for orgs with technical readiness but culture/change gaps
- "SharePoint & Teams Modernisation" — best for orgs needing clean data foundations first

Also write:
- whatThisMeans: 2–3 sentence plain-English summary of what the scores mean for this org
- whyThisFits: 2–3 sentences explaining why the recommended service is the right fit
- roiProjection: 2–3 sentences projecting realistic ROI/value if they address the gaps

Respond ONLY with valid JSON in this exact shape:
{
  "categoryScores": { "infrastructure": 7, "data": 5, "aiLiteracy": 4, "changeManagement": 6, "businessProcess": 5 },
  "recommendedService": "Copilot AI Readiness & Deployment",
  "whatThisMeans": "...",
  "whyThisFits": "...",
  "roiProjection": "..."
}`;

  let scores = {
    infrastructure: 5, data: 5, aiLiteracy: 5, changeManagement: 5, businessProcess: 5,
  };
  let recommendedService = "Copilot AI Readiness & Deployment";
  let whatThisMeans = "Your organisation has a solid foundation with some areas to strengthen before Copilot deployment.";
  let whyThisFits = "This service will address your key gaps and set you up for a successful Copilot rollout.";
  let roiProjection = "Organisations at your readiness level typically achieve 15–25% productivity gains within 6 months of a structured Copilot deployment.";

  try {
    const scoringResponse = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: scoringPrompt }],
    });

    const block = scoringResponse.content[0];
    if (block && block.type === "text") {
      const raw = block.text.trim();
      const jsonStr = raw.startsWith("{") ? raw : raw.replace(/^```json?\s*/i, "").replace(/\s*```$/, "");
      const parsed = JSON.parse(jsonStr);
      if (parsed.categoryScores) scores = parsed.categoryScores;
      if (parsed.recommendedService) recommendedService = parsed.recommendedService;
      if (parsed.whatThisMeans) whatThisMeans = parsed.whatThisMeans;
      if (parsed.whyThisFits) whyThisFits = parsed.whyThisFits;
      if (parsed.roiProjection) roiProjection = parsed.roiProjection;
    }
  } catch (err) {
    logger.warn({ err }, "quiz/submit: scoring AI call failed, using defaults");
  }

  const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);

  const tier =
    totalScore >= 46 ? "Ready" :
    totalScore >= 36 ? "Advanced" :
    totalScore >= 26 ? "Emerging" :
    totalScore >= 16 ? "Developing" : "Beginner";

  // Persist to DB — fail the request if this doesn't succeed so leads are never silently dropped
  let leadId: number | null = null;
  try {
    const [inserted] = await db.insert(quizLeadsTable).values({
      name,
      email,
      company: company ?? null,
      totalScore,
      tier,
      recommendedService,
      categoryScores: scores,
      analysisText: { whatThisMeans, whyThisFits, roiProjection },
      conversation,
    }).returning({ id: quizLeadsTable.id });
    leadId = inserted?.id ?? null;
  } catch (err) {
    logger.error({ err }, "quiz/submit: DB insert failed");
    return res.status(500).json({ error: "Failed to save your results. Please try again." });
  }

  // Notify Shane of the new quiz lead (fire and forget)
  void (async () => {
    const shaneEmail = process.env.ADMIN_EMAIL ?? process.env.CRM_ADMIN_EMAIL;
    if (shaneEmail) {
      await sendEmail(
        shaneEmail,
        `New quiz lead: ${name} (${tier} — ${totalScore}/50)`,
        quizLeadNotificationEmail({ name, email, company, totalScore, tier, recommendedService }),
      );
    }
  })();

  // Generate and email PDF (fire and forget — don't block the response)
  const pdfData = {
    name,
    email,
    company,
    totalScore,
    tier,
    recommendedService,
    categoryScores: scores,
    whatThisMeans,
    whyThisFits,
    roiProjection,
  };

  void (async () => {
    try {
      const pdfBuffer = await generateQuizPdf(pdfData);

      const bodyHtml = `
        <p>Hi ${name.split(" ")[0] || "there"},</p>
        <p>Thank you for completing the <strong>Microsoft Copilot Readiness Assessment</strong>. Your personalised report is attached to this email.</p>
        <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
          <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:160px;">Total Score</td><td style="padding:4px 0;font-weight:600;">${totalScore} / 50</td></tr>
          <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Maturity Tier</td><td style="padding:4px 0;font-weight:600;">${tier}</td></tr>
          <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Recommended Service</td><td style="padding:4px 0;font-weight:600;">${recommendedService}</td></tr>
        </table>
        <p>Your PDF report includes a full breakdown of your readiness across all five categories, plus a tailored recommendation and ROI projection.</p>
        <p>Ready to discuss your results and next steps? Book a complimentary 30-minute strategy call with Shane.</p>
        <p style="margin:24px 0 0;">
          <a href="https://shanemccaw.consulting/contact" style="display:inline-block;background:#0078D4;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">Book a Strategy Call →</a>
        </p>
        <p style="margin-top:24px;">— Shane McCaw<br/><span style="color:#64748b;font-size:13px;">Lead Microsoft 365 Architect | Shane McCaw Consulting</span></p>
      `;

      await sendEmailWithAttachment(
        email,
        "Your Microsoft Copilot Readiness Report",
        brandedEmail(bodyHtml),
        [{ filename: "copilot-readiness-report.pdf", content: pdfBuffer }],
      );
    } catch (err) {
      logger.warn({ err }, "quiz/submit: PDF email failed");
    }
  })();

  const resendToken = leadId !== null ? makeResendToken(leadId) : null;

  return res.json({
    success: true,
    leadId,
    resendToken,
    totalScore,
    tier,
    recommendedService,
    categoryScores: scores,
    serviceDescription: SERVICE_MAP[recommendedService] ?? "",
    whatThisMeans,
    whyThisFits,
    roiProjection,
  });
});

// ─── POST /api/quiz/resend-pdf ─────────────────────────────────────────────────
const resendSchema = z.object({
  leadId: z.number().int().positive(),
  email: z.string().email(),
  resendToken: z.string().min(1),
});

router.post("/quiz/resend-pdf", resendLimiter, async (req, res) => {
  const parsed = resendSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body" });
  }
  const { leadId, email, resendToken } = parsed.data;

  if (!verifyResendToken(leadId, resendToken)) {
    return res.status(403).json({ error: "Invalid or expired resend token." });
  }

  const lead = await db.query.quizLeadsTable.findFirst({
    where: (t, { eq }) => eq(t.id, leadId),
  });

  if (!lead) {
    return res.status(404).json({ error: "Quiz result not found." });
  }

  const analysis = lead.analysisText ?? { whatThisMeans: "", whyThisFits: "", roiProjection: "" };

  try {
    const pdfBuffer = await generateQuizPdf({
      name: lead.name,
      email: lead.email,
      company: lead.company ?? undefined,
      totalScore: lead.totalScore,
      tier: lead.tier,
      recommendedService: lead.recommendedService ?? "",
      categoryScores: lead.categoryScores as unknown as Record<string, number>,
      whatThisMeans: analysis.whatThisMeans,
      whyThisFits: analysis.whyThisFits,
      roiProjection: analysis.roiProjection,
    });

    const firstName = lead.name.split(" ")[0] || "there";
    const bodyHtml = `
      <p>Hi ${firstName},</p>
      <p>As requested, your <strong>Microsoft Copilot Readiness Assessment</strong> report is attached to this email.</p>
      <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
        <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:160px;">Total Score</td><td style="padding:4px 0;font-weight:600;">${lead.totalScore} / 50</td></tr>
        <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Maturity Tier</td><td style="padding:4px 0;font-weight:600;">${lead.tier}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Recommended Service</td><td style="padding:4px 0;font-weight:600;">${lead.recommendedService ?? ""}</td></tr>
      </table>
      <p>Ready to discuss your results and plan your next steps? Book a complimentary 30-minute strategy call with Shane.</p>
      <p style="margin:24px 0 0;">
        <a href="https://shanemccaw.consulting/contact" style="display:inline-block;background:#0078D4;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">Book a Strategy Call →</a>
      </p>
      <p style="margin-top:24px;">— Shane McCaw<br/><span style="color:#64748b;font-size:13px;">Lead Microsoft 365 Architect | Shane McCaw Consulting</span></p>
    `;

    await sendEmailWithAttachmentOrThrow(
      email,
      "Your Microsoft Copilot Readiness Report",
      brandedEmail(bodyHtml),
      [{ filename: "copilot-readiness-report.pdf", content: pdfBuffer }],
    );

    return res.json({ success: true });
  } catch (err) {
    logger.warn({ err }, "quiz/resend-pdf: failed");
    return res.status(500).json({ error: "Failed to send the report. Please try again." });
  }
});

export default router;
