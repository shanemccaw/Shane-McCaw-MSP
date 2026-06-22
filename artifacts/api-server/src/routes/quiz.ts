import { createHmac } from "crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { db, quizLeadsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { generateQuizPdf } from "../lib/quiz-pdf";
import { sendEmailWithAttachment, sendEmailWithAttachmentOrThrow, sendEmail, brandedEmail, quizLeadNotificationEmail } from "../lib/mailer";

const RESEND_TOKEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function makeResendToken(leadId: number): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET must be set");
  const slot = Math.floor(Date.now() / RESEND_TOKEN_WINDOW_MS);
  return createHmac("sha256", secret).update(`${leadId}:${slot}`).digest("hex");
}

function verifyResendToken(leadId: number, token: string): boolean {
  const secret = process.env.JWT_SECRET;
  if (!secret) return false;
  const slot = Math.floor(Date.now() / RESEND_TOKEN_WINDOW_MS);
  const current = createHmac("sha256", secret).update(`${leadId}:${slot}`).digest("hex");
  const previous = createHmac("sha256", secret).update(`${leadId}:${slot - 1}`).digest("hex");
  return token === current || token === previous;
}

const router = Router();

const chatLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many quiz chat requests from this IP. Please try again in an hour." } });
const resendLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many resend requests from this IP. Please try again in an hour." } });
const submitLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many quiz submissions from this IP. Please try again in an hour." } });

// ─── System prompts per quiz type ─────────────────────────────────────────────
const SYSTEM_PROMPTS: Record<string, string> = {
  copilot: `You are a Microsoft Copilot readiness assessment specialist working for Shane McCaw Consulting. Your job is to conduct a structured 10-question readiness quiz for organisations considering deploying Microsoft 365 Copilot.

You ask exactly 10 questions, one at a time. Each question probes one of five readiness categories (two questions per category):

1. Infrastructure & Identity (Q1, Q2): Microsoft 365 licensing status, Entra ID configuration, MFA deployment, device compliance.
2. Data & Compliance (Q3, Q4): Sensitivity labels, DLP policies, data governance, information barriers.
3. AI Literacy (Q5, Q6): Employee AI skills, training plans, adoption culture, AI champions.
4. Change Management (Q7, Q8): Executive buy-in, Copilot policy documentation, rollout planning, pilot programmes.
5. Business Process (Q9, Q10): Identified use cases, ROI tracking plans, success metrics, process owners.

Rules:
- Ask questions in a conversational, professional tone.
- Do NOT number the questions explicitly.
- Ask one focused question at a time and wait for the user's answer.
- Keep each question to 1–2 sentences maximum.
- On the very first message (when the conversation is empty), greet the user briefly (1 sentence) and immediately ask the first question about their M365 licensing.
- For questions 2–10, acknowledge the previous answer in one short sentence before asking the next question.
- Do NOT provide scores, feedback, or analysis during the quiz.
- After question 10 is answered, respond with exactly: "Thank you — that completes the assessment. I'll now generate your personalised readiness report."`,

  "m365-health": `You are a Microsoft 365 tenant health specialist working for Shane McCaw Consulting. Your job is to conduct a structured 10-question tenant health assessment for organisations wanting to understand the health of their Microsoft 365 environment.

You ask exactly 10 questions, one at a time. Each question probes one of five health categories (two questions per category):

1. Licensing & Entitlements (Q1, Q2): Licensing tiers, licence utilisation, wasted licences, appropriate plans for roles.
2. Security & Identity (Q3, Q4): MFA coverage, Entra ID / Azure AD setup, admin role hygiene, identity management approach.
3. Collaboration Hygiene (Q5, Q6): Teams and SharePoint governance, naming conventions, email security (DKIM/DMARC/SPF).
4. Admin & Governance (Q7, Q8): Admin centre usage, monitoring tools, Global Admin count, least-privilege practices.
5. Adoption & Training (Q9, Q10): End-user adoption levels, formal M365 training programmes, self-serve vs structured enablement.

Rules:
- Ask questions in a conversational, professional tone.
- Do NOT number the questions explicitly.
- Ask one focused question at a time and wait for the user's answer.
- Keep each question to 1–2 sentences maximum.
- On the very first message, greet the user briefly (1 sentence) and immediately ask about their M365 licensing tier.
- For questions 2–10, acknowledge the previous answer in one short sentence before asking the next question.
- Do NOT provide scores, feedback, or analysis during the quiz.
- After question 10 is answered, respond with exactly: "Thank you — that completes the assessment. I'll now generate your personalised tenant health report."`,

  sharepoint: `You are a SharePoint architecture specialist working for Shane McCaw Consulting. Your job is to conduct a structured 10-question SharePoint architecture assessment for organisations wanting to understand the health and maturity of their SharePoint environment.

You ask exactly 10 questions, one at a time. Each question probes one of five architecture categories (two questions per category):

1. Information Architecture (Q1, Q2): Hub site structure, naming conventions, site hierarchy, provisioning processes.
2. Permissions & Governance (Q3, Q4): Inherited vs unique permissions, guest access controls, lifecycle policies, ownership accountability.
3. Search & Navigation (Q5, Q6): Content findability, search configuration, managed properties, navigation consistency.
4. Content Lifecycle (Q7, Q8): What happens to content when projects end or employees leave, retention and archiving processes, metadata usage.
5. Adoption & Usage (Q9, Q10): Which departments use SharePoint effectively, training and enablement history, adoption barriers.

Rules:
- Ask questions in a conversational, professional tone.
- Do NOT number the questions explicitly.
- Ask one focused question at a time and wait for the user's answer.
- Keep each question to 1–2 sentences maximum.
- On the very first message, greet the user briefly (1 sentence) and immediately ask about their SharePoint site structure.
- For questions 2–10, acknowledge the previous answer in one short sentence before asking the next question.
- Do NOT provide scores, feedback, or analysis during the quiz.
- After question 10 is answered, respond with exactly: "Thank you — that completes the assessment. I'll now generate your personalised SharePoint architecture report."`,

  "power-platform": `You are a Power Platform maturity specialist working for Shane McCaw Consulting. Your job is to conduct a structured 10-question Power Platform maturity assessment for organisations wanting to understand how well-governed and mature their Power Platform practice is.

You ask exactly 10 questions, one at a time. Each question probes one of five maturity categories (two questions per category):

1. Platform Governance (Q1, Q2): CoE toolkit deployment, environment strategy (dev/test/prod), DLP policies, governance maturity.
2. Maker Skills & Training (Q3, Q4): Active maker count, training paths (formal vs self-taught), champion programmes, skill levels.
3. Data Connectivity (Q5, Q6): Data sources used, Dataverse adoption, connection security and documentation, data residency.
4. Automation Maturity (Q7, Q8): Types of flows deployed, monitoring and maintenance practices, flow reliability and complexity.
5. AI Builder Readiness (Q9, Q10): AI Builder feature awareness and usage, Copilot Studio awareness, positioning for AI-assisted app building.

Rules:
- Ask questions in a conversational, professional tone.
- Do NOT number the questions explicitly.
- Ask one focused question at a time and wait for the user's answer.
- Keep each question to 1–2 sentences maximum.
- On the very first message, greet the user briefly (1 sentence) and immediately ask about their Power Platform governance approach.
- For questions 2–10, acknowledge the previous answer in one short sentence before asking the next question.
- Do NOT provide scores, feedback, or analysis during the quiz.
- After question 10 is answered, respond with exactly: "Thank you — that completes the assessment. I'll now generate your personalised Power Platform maturity report."`,

  security: `You are a Microsoft 365 security specialist working for Shane McCaw Consulting. Your job is to conduct a structured 10-question M365 security posture assessment for organisations wanting to understand the security risks in their Microsoft 365 environment.

You ask exactly 10 questions, one at a time. Each question probes one of five security categories (two questions per category):

1. Identity & Access (Q1, Q2): MFA coverage for all users, Conditional Access policy deployment, access controls beyond basic authentication.
2. Data Protection (Q3, Q4): Sensitivity label deployment, DLP policy configuration, protection against data exfiltration via email, Teams, and SharePoint.
3. Device & Endpoint Management (Q5, Q6): Intune/MDM enrollment, device compliance policies, App Protection Policies for unmanaged devices, remote wipe capability.
4. Threat Detection & Response (Q7, Q8): Microsoft Secure Score engagement, Defender for Office 365 configuration (Safe Attachments, Safe Links, anti-phishing).
5. Compliance & Policy (Q9, Q10): Applicable regulatory frameworks (HIPAA, CMMC, FedRAMP, SOX, GDPR), Purview compliance control configuration, incident response readiness.

Rules:
- Ask questions in a conversational, professional tone.
- Do NOT number the questions explicitly.
- Ask one focused question at a time and wait for the user's answer.
- Keep each question to 1–2 sentences maximum.
- On the very first message, greet the user briefly (1 sentence) and immediately ask about their MFA deployment status.
- For questions 2–10, acknowledge the previous answer in one short sentence before asking the next question.
- Do NOT provide scores, feedback, or analysis during the quiz.
- After question 10 is answered, respond with exactly: "Thank you — that completes the assessment. I'll now generate your personalised security posture report."`,

  teams: `You are a Microsoft Teams specialist working for Shane McCaw Consulting. Your job is to conduct a structured 10-question Teams health assessment for organisations wanting to understand how well-governed and effectively used their Microsoft Teams environment is.

You ask exactly 10 questions, one at a time. Each question probes one of five Teams health categories (two questions per category):

1. Governance & Lifecycle (Q1, Q2): Team creation policies, naming conventions, ownership assignment, lifecycle management (expiry, archiving, inactive teams).
2. Meetings & Calling (Q3, Q4): Meeting quality and standards, Teams Phone deployment, recording and transcription usage, meeting productivity.
3. Information Architecture (Q5, Q6): Channel structure consistency across teams, file storage organisation, content findability within Teams.
4. Adoption & Culture (Q7, Q8): Which departments use Teams as their primary collaboration tool, adoption barriers, training and enablement provided.
5. Apps & Integration (Q9, Q10): Third-party apps added to Teams, governance of the app ecosystem, advanced feature usage (Copilot summaries, breakout rooms, polls).

Rules:
- Ask questions in a conversational, professional tone.
- Do NOT number the questions explicitly.
- Ask one focused question at a time and wait for the user's answer.
- Keep each question to 1–2 sentences maximum.
- On the very first message, greet the user briefly (1 sentence) and immediately ask about how Teams and channels are created in their organisation.
- For questions 2–10, acknowledge the previous answer in one short sentence before asking the next question.
- Do NOT provide scores, feedback, or analysis during the quiz.
- After question 10 is answered, respond with exactly: "Thank you — that completes the assessment. I'll now generate your personalised Teams health report."`,

  migration: `You are a Microsoft 365 cloud migration specialist working for Shane McCaw Consulting. Your job is to conduct a structured 10-question migration readiness assessment for organisations planning to migrate to Microsoft 365.

You ask exactly 10 questions, one at a time. Each question probes one of five readiness categories (two questions per category):

1. Source Environment Inventory (Q1, Q2): Source platform (Exchange/Google Workspace/legacy), accurate inventory of mailboxes, shared inboxes, distribution groups, file volumes, and data size.
2. Identity Readiness (Q3, Q4): Active Directory / identity provider status, Entra ID sync planning, MFA compatibility with legacy systems, modern authentication readiness.
3. Data & Governance Prerequisites (Q5, Q6): Sensitive data classification, applicable compliance frameworks (HIPAA, CMMC, FedRAMP), governance controls planned for pre-migration configuration.
4. Stakeholder Alignment (Q7, Q8): Executive sponsorship and formal project approval, department head and end-user engagement, change management and communication planning.
5. Risk & Rollback Planning (Q9, Q10): Documented rollback procedures, integration and line-of-business application testing, dependency mapping and recovery scenario planning.

Rules:
- Ask questions in a conversational, professional tone.
- Do NOT number the questions explicitly.
- Ask one focused question at a time and wait for the user's answer.
- Keep each question to 1–2 sentences maximum.
- On the very first message, greet the user briefly (1 sentence) and immediately ask what system they are migrating from.
- For questions 2–10, acknowledge the previous answer in one short sentence before asking the next question.
- Do NOT provide scores, feedback, or analysis during the quiz.
- After question 10 is answered, respond with exactly: "Thank you — that completes the assessment. I'll now generate your personalised migration readiness report."`,

  governance: `You are a Microsoft 365 governance specialist working for Shane McCaw Consulting. Your job is to conduct a structured 10-question governance maturity assessment for organisations wanting to understand the maturity of their Microsoft 365 governance framework.

You ask exactly 10 questions, one at a time. Each question probes one of five governance categories (two questions per category):

1. DLP & Sensitivity Labels (Q1, Q2): DLP policy deployment and coverage, sensitivity label implementation (manual vs automatic), information protection maturity.
2. Retention & Records Management (Q3, Q4): Retention schedule configuration in Purview, litigation hold capability, eDiscovery readiness and testing.
3. Access & Identity Governance (Q5, Q6): Admin role least-privilege practices, guest access controls and expiry policies, Privileged Identity Management (PIM) deployment.
4. Compliance Framework Alignment (Q7, Q8): Applicable regulatory frameworks (HIPAA, CMMC, FedRAMP, SOX, ITAR, GDPR), Purview compliance control configuration, recent compliance assessments.
5. Policy Documentation (Q9, Q10): Whether governance policies are documented, current, and accessible — and whether they are enforced technically through M365 controls or primarily paper-based.

Rules:
- Ask questions in a conversational, professional tone.
- Do NOT number the questions explicitly.
- Ask one focused question at a time and wait for the user's answer.
- Keep each question to 1–2 sentences maximum.
- On the very first message, greet the user briefly (1 sentence) and immediately ask about their DLP policy deployment.
- For questions 2–10, acknowledge the previous answer in one short sentence before asking the next question.
- Do NOT provide scores, feedback, or analysis during the quiz.
- After question 10 is answered, respond with exactly: "Thank you — that completes the assessment. I'll now generate your personalised governance maturity report."`,
};

// ─── Scoring configs per quiz type ────────────────────────────────────────────
interface ScoringConfig {
  categories: string;
  categoryKeys: string;
  services: string;
  defaultService: string;
  reportName: string;
  pdfFilename: string;
}

const COPILOT_SERVICE_MAP: Record<string, string> = {
  "Microsoft 365 Essentials Audit": "A comprehensive tenant audit revealing quick wins and critical gaps in your M365 environment.",
  "Copilot AI Readiness & Deployment": "End-to-end Copilot enablement: licensing, data governance, training, and governed rollout.",
  "Microsoft 365 Governance Setup": "Establish DLP policies, sensitivity labels, and compliance controls that protect your data.",
  "AI Adoption & Change Management": "Drive Copilot adoption through executive alignment, champion networks, and structured change management.",
  "SharePoint & Teams Modernisation": "Redesign your intranet and collaboration spaces so Copilot has clean, well-structured data to work with.",
};

const SCORING_CONFIGS: Record<string, ScoringConfig> = {
  copilot: {
    categories: `- infrastructure: M365 licensing, Entra ID, MFA, device compliance
- data: Sensitivity labels, DLP, governance, compliance
- aiLiteracy: Employee AI skills, training, adoption culture
- changeManagement: Executive buy-in, policies, rollout planning
- businessProcess: Use cases identified, ROI tracking, success metrics`,
    categoryKeys: "infrastructure, data, aiLiteracy, changeManagement, businessProcess",
    services: `- "Microsoft 365 Essentials Audit" — best for early-stage orgs with licensing/infrastructure gaps
- "Copilot AI Readiness & Deployment" — best for orgs ready to deploy but needing guided rollout
- "Microsoft 365 Governance Setup" — best for orgs with data/compliance gaps
- "AI Adoption & Change Management" — best for orgs with technical readiness but culture/change gaps
- "SharePoint & Teams Modernisation" — best for orgs needing clean data foundations first`,
    defaultService: "Copilot AI Readiness & Deployment",
    reportName: "Microsoft Copilot Readiness Assessment",
    pdfFilename: "copilot-readiness-report.pdf",
  },
  "m365-health": {
    categories: `- securityPosture: Microsoft Secure Score engagement, Defender for Office 365 configuration, anti-phishing and anti-malware policies, DKIM/DMARC/SPF email authentication
- identityConditionalAccess: MFA coverage across all accounts, Conditional Access policy breadth and enforcement, Entra ID configuration, privileged identity management
- collaborationSprawl: Teams and SharePoint governance — naming conventions, site/team lifecycle policies, guest access controls, sprawl and shadow IT indicators
- adminRolesShadowIT: Global Admin count and least-privilege practices, admin role hygiene, monitoring tools in use, shadow IT and unsanctioned app usage
- dlpSensitivityLabels: Sensitivity label deployment and coverage, DLP policy configuration and scope, data classification maturity, information protection readiness`,
    categoryKeys: "securityPosture, identityConditionalAccess, collaborationSprawl, adminRolesShadowIT, dlpSensitivityLabels",
    services: `- "M365 Tenant Health Audit" — comprehensive audit for tenants with configuration gaps, security issues, or governance debt
- "Copilot for M365 Readiness Assessment" — for mature tenants ready to evaluate Copilot deployment
- "Governance Foundations Package" — for tenants that need formal governance after addressing health issues`,
    defaultService: "M365 Tenant Health Audit",
    reportName: "Microsoft 365 Tenant Health Assessment",
    pdfFilename: "m365-health-report.pdf",
  },
  sharepoint: {
    categories: `- infoArchitecture: Hub site structure, naming conventions, site hierarchy, provisioning process quality
- permissionsGovernance: Inherited vs unique permissions, guest access controls, lifecycle policies, ownership accountability
- searchNavigation: Content findability, search configuration, managed properties, navigation consistency
- contentLifecycle: Retention and archiving processes, what happens when projects end or employees leave, metadata usage
- adoptionUsage: Department adoption levels, training and enablement history, adoption barriers`,
    categoryKeys: "infoArchitecture, permissionsGovernance, searchNavigation, contentLifecycle, adoptionUsage",
    services: `- "M365 Tenant Health Audit" — for environments with significant configuration and governance debt
- "Governance Foundations Package" — for environments needing formal governance, naming conventions, and lifecycle policies
- "Copilot for M365 Readiness Assessment" — for mature environments ready to deploy Copilot on clean SharePoint foundations`,
    defaultService: "Governance Foundations Package",
    reportName: "SharePoint Architecture Assessment",
    pdfFilename: "sharepoint-assessment-report.pdf",
  },
  "power-platform": {
    categories: `- platformGovernance: CoE toolkit deployment, environment strategy, DLP policies, governance maturity
- makerSkills: Active maker count, training paths (formal vs self-taught), champion programmes, skill levels
- dataConnectivity: Data sources used, Dataverse adoption, connection security and documentation
- automationMaturity: Types of flows deployed, monitoring and maintenance practices, flow reliability and complexity
- aiBuilderReadiness: AI Builder feature awareness and usage, Copilot Studio awareness, AI-assisted building positioning`,
    categoryKeys: "platformGovernance, makerSkills, dataConnectivity, automationMaturity, aiBuilderReadiness",
    services: `- "Power Platform Quick-Start" — for organisations with limited governance or early-stage maker practices
- "Governance Foundations Package" — for organisations with mature Power Platform usage needing broader M365 governance
- "Copilot for M365 Readiness Assessment" — for mature organisations ready to add AI to their Power Platform practice`,
    defaultService: "Power Platform Quick-Start",
    reportName: "Power Platform Maturity Assessment",
    pdfFilename: "power-platform-assessment-report.pdf",
  },
  security: {
    categories: `- identityAccess: MFA coverage, Conditional Access policy breadth and enforcement, Entra ID configuration, privileged identity management and just-in-time access
- dataProtection: Sensitivity label deployment and coverage, DLP policy configuration and enforcement, information protection maturity, data classification practices
- insiderRiskCompliance: Insider Risk Manager policy deployment, Communication Compliance configuration, Compliance Manager usage and improvement score, compliance posture
- auditEDiscovery: Audit log retention configuration, eDiscovery readiness and tested capability, Content Search usage, audit log review processes
- regulatoryReadiness: Applicable regulatory framework mapping (HIPAA, CMMC, FedRAMP, SOX, GDPR, NIST), Purview compliance control configuration, audit readiness posture`,
    categoryKeys: "identityAccess, dataProtection, insiderRiskCompliance, auditEDiscovery, regulatoryReadiness",
    services: `- "Governance Foundations Package" — for organisations with significant security and compliance gaps requiring a full governance framework
- "M365 Tenant Health Audit" — for organisations needing a comprehensive tenant-wide security and configuration review
- "Copilot for M365 Readiness Assessment" — for mature, secure environments ready to deploy Copilot safely`,
    defaultService: "Governance Foundations Package",
    reportName: "Microsoft 365 Security Posture Assessment",
    pdfFilename: "m365-security-assessment-report.pdf",
  },
  teams: {
    categories: `- governanceLifecycle: Team creation policies, naming conventions, ownership assignment, lifecycle management (expiry, archiving)
- meetingsCalling: Meeting quality, Teams Phone deployment, recording and transcription usage, meeting productivity
- infoArchitecture: Channel structure consistency, file storage organisation, content findability within Teams
- adoptionCulture: Which departments use Teams as primary collaboration tool, adoption barriers, training provided
- integrationApps: Third-party app governance, advanced feature usage (Copilot summaries, breakout rooms, polls)`,
    categoryKeys: "governanceLifecycle, meetingsCalling, infoArchitecture, adoptionCulture, integrationApps",
    services: `- "M365 Tenant Health Audit" — for tenants with broad configuration issues underlying Teams problems
- "Governance Foundations Package" — for Teams environments needing formal governance and lifecycle management
- "Copilot for M365 Readiness Assessment" — for well-governed Teams environments ready for Copilot meeting summaries and chat assistance`,
    defaultService: "Governance Foundations Package",
    reportName: "Microsoft Teams Health Assessment",
    pdfFilename: "teams-assessment-report.pdf",
  },
  migration: {
    categories: `- sourceInventory: Accuracy of source environment inventory (mailboxes, shared inboxes, distribution groups, file volumes, data size)
- identityReadiness: Active Directory / identity provider status, Entra ID sync planning, MFA compatibility, modern authentication readiness
- dataGovernance: Sensitive data classification, applicable compliance frameworks, governance controls planned pre-migration
- stakeholderAlignment: Executive sponsorship and formal project approval, department head engagement, change management planning
- riskPlanning: Documented rollback procedures, integration and line-of-business application testing, dependency mapping`,
    categoryKeys: "sourceInventory, identityReadiness, dataGovernance, stakeholderAlignment, riskPlanning",
    services: `- "Migration Readiness Assessment" — for organisations planning a migration that need a formal readiness report and go/no-go recommendation
- "Governance Foundations Package" — for organisations that need governance controls in place before or alongside migration execution
- "M365 Tenant Health Audit" — for organisations that have already migrated and want to assess the health of their new M365 tenant`,
    defaultService: "Migration Readiness Assessment",
    reportName: "Cloud Migration Readiness Assessment",
    pdfFilename: "migration-readiness-report.pdf",
  },
  governance: {
    categories: `- dlpLabels: DLP policy deployment and coverage, sensitivity label implementation (manual vs automatic), information protection maturity
- retentionRecords: Retention schedule configuration in Purview, litigation hold capability, eDiscovery readiness and testing
- accessGovernance: Admin role least-privilege practices, guest access controls and expiry policies, PIM deployment
- complianceFramework: Applicable regulatory frameworks (HIPAA, CMMC, FedRAMP, SOX, ITAR, GDPR), Purview compliance control configuration
- policyDocumentation: Whether governance policies are documented, current, accessible, and technically enforced through M365 controls`,
    categoryKeys: "dlpLabels, retentionRecords, accessGovernance, complianceFramework, policyDocumentation",
    services: `- "Governance Foundations Package" — for organisations with significant governance gaps requiring a full framework build-out
- "Copilot for M365 Readiness Assessment" — for organisations with mature governance ready to deploy Copilot safely
- "M365 Tenant Health Audit" — for organisations that want a broader tenant review alongside their governance assessment`,
    defaultService: "Governance Foundations Package",
    reportName: "Microsoft 365 Governance Maturity Assessment",
    pdfFilename: "governance-maturity-report.pdf",
  },
};

// ─── POST /api/quiz/chat ───────────────────────────────────────────────────────
const chatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string(),
  })),
  quizType: z.string().optional().default("copilot"),
});

router.post("/quiz/chat", chatLimiter, async (req, res) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request body" });

  const { messages, quizType } = parsed.data;
  const systemPrompt = SYSTEM_PROMPTS[quizType] ?? SYSTEM_PROMPTS.copilot;

  try {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      system: systemPrompt,
      messages: messages.length === 0
        ? [{ role: "user", content: "Start the quiz." }]
        : messages,
    });

    const block = response.content[0];
    if (!block || block.type !== "text") return res.status(500).json({ error: "Unexpected AI response" });
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
  quizType: z.string().optional().default("copilot"),
});

router.post("/quiz/submit", submitLimiter, async (req, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid request body" });

  const { name, email, company, conversation, quizType } = parsed.data;
  const cfg = SCORING_CONFIGS[quizType] ?? SCORING_CONFIGS.copilot;

  const conversationText = conversation
    .map((m) => `${m.role === "assistant" ? "Quiz" : "Respondent"}: ${m.content}`)
    .join("\n\n");

  const scoringPrompt = `You are scoring a ${cfg.reportName}. Below is the full quiz conversation. Score the respondent across 5 categories (0–10 each) based on their answers. Also select the most appropriate service recommendation.

CONVERSATION:
${conversationText}

Categories to score (0–10 each):
${cfg.categories}

Service options (pick exactly one):
${cfg.services}

Also write:
- whatThisMeans: 2–3 sentence plain-English summary of what the scores mean for this organisation
- whyThisFits: 2–3 sentences explaining why the recommended service is the right fit
- roiProjection: 2–3 sentences projecting realistic ROI/value if they address the identified gaps

Respond ONLY with valid JSON in this exact shape:
{
  "categoryScores": { ${cfg.categoryKeys.split(", ").map(k => `"${k}": 5`).join(", ")} },
  "recommendedService": "${cfg.defaultService}",
  "whatThisMeans": "...",
  "whyThisFits": "...",
  "roiProjection": "..."
}`;

  const defaultCategoryScores = Object.fromEntries(
    cfg.categoryKeys.split(", ").map((k) => [k.trim(), 5])
  );

  let scores: Record<string, number> = { ...defaultCategoryScores };
  let recommendedService = cfg.defaultService;
  let whatThisMeans = "Your organisation has a solid foundation with some areas to strengthen.";
  let whyThisFits = "This service will address your key gaps and set you up for success.";
  let roiProjection = "Organisations at your maturity level typically achieve significant productivity and compliance gains within 6 months of a structured engagement.";

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
      const parsedScores = JSON.parse(jsonStr);
      if (parsedScores.categoryScores) scores = parsedScores.categoryScores as Record<string, number>;
      if (parsedScores.recommendedService) recommendedService = parsedScores.recommendedService as string;
      if (parsedScores.whatThisMeans) whatThisMeans = parsedScores.whatThisMeans as string;
      if (parsedScores.whyThisFits) whyThisFits = parsedScores.whyThisFits as string;
      if (parsedScores.roiProjection) roiProjection = parsedScores.roiProjection as string;
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
      quizType,
    }).returning({ id: quizLeadsTable.id });
    leadId = inserted?.id ?? null;
  } catch (err) {
    logger.error({ err }, "quiz/submit: DB insert failed");
    return res.status(500).json({ error: "Failed to save your results. Please try again." });
  }

  void (async () => {
    const shaneEmail = process.env.ADMIN_EMAIL ?? process.env.CRM_ADMIN_EMAIL;
    if (shaneEmail) {
      await sendEmail(
        shaneEmail,
        `New quiz lead: ${name} (${cfg.reportName} — ${tier} — ${totalScore}/50)`,
        quizLeadNotificationEmail({ name, email, company, totalScore, tier, recommendedService }),
      );
    }
  })();

  const pdfData = { name, email, company, totalScore, tier, recommendedService, categoryScores: scores, whatThisMeans, whyThisFits, roiProjection };

  void (async () => {
    try {
      const pdfBuffer = await generateQuizPdf(pdfData);
      const bodyHtml = `
        <p>Hi ${name.split(" ")[0] || "there"},</p>
        <p>Thank you for completing the <strong>${cfg.reportName}</strong>. Your personalised report is attached to this email.</p>
        <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
          <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:160px;">Total Score</td><td style="padding:4px 0;font-weight:600;">${totalScore} / 50</td></tr>
          <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Maturity Tier</td><td style="padding:4px 0;font-weight:600;">${tier}</td></tr>
          <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Recommended Service</td><td style="padding:4px 0;font-weight:600;">${recommendedService}</td></tr>
        </table>
        <p>Your PDF report includes a full breakdown across all five assessment categories, plus a tailored recommendation and ROI projection.</p>
        <p>Ready to discuss your results? Book a complimentary 30-minute strategy call with Shane.</p>
        <p style="margin:24px 0 0;">
          <a href="https://shanemccaw.consulting/contact" style="display:inline-block;background:#0078D4;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">Book a Strategy Call →</a>
        </p>
        <p style="margin-top:24px;">— Shane McCaw<br/><span style="color:#64748b;font-size:13px;">Lead Microsoft 365 Architect | Shane McCaw Consulting</span></p>
      `;
      await sendEmailWithAttachment(
        email,
        `Your ${cfg.reportName} Report`,
        brandedEmail(bodyHtml),
        [{ filename: cfg.pdfFilename, content: pdfBuffer }],
      );
    } catch (err) {
      logger.warn({ err }, "quiz/submit: PDF email failed");
    }
  })();

  let resendToken: string | null = null;
  try {
    resendToken = leadId !== null ? makeResendToken(leadId) : null;
  } catch (err) {
    logger.warn({ err }, "quiz/submit: could not generate resend token");
  }

  return res.json({
    success: true,
    leadId,
    resendToken,
    totalScore,
    tier,
    recommendedService,
    categoryScores: scores,
    serviceDescription: quizType === "copilot" ? (COPILOT_SERVICE_MAP[recommendedService ?? ""] ?? "") : "",
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
  if (!parsed.success) return res.status(400).json({ error: "Invalid request body" });
  const { leadId, email, resendToken } = parsed.data;

  if (!verifyResendToken(leadId, resendToken)) return res.status(403).json({ error: "Invalid or expired resend token." });

  const lead = await db.query.quizLeadsTable.findFirst({ where: (t, { eq }) => eq(t.id, leadId) });
  if (!lead) return res.status(404).json({ error: "Quiz result not found." });

  const analysis = lead.analysisText ?? { whatThisMeans: "", whyThisFits: "", roiProjection: "" };
  const qt = lead.quizType ?? "copilot";
  const cfg = SCORING_CONFIGS[qt] ?? SCORING_CONFIGS.copilot;

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
      <p>As requested, your <strong>${cfg.reportName}</strong> report is attached to this email.</p>
      <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
        <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:160px;">Total Score</td><td style="padding:4px 0;font-weight:600;">${lead.totalScore} / 50</td></tr>
        <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Maturity Tier</td><td style="padding:4px 0;font-weight:600;">${lead.tier}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Recommended Service</td><td style="padding:4px 0;font-weight:600;">${lead.recommendedService ?? ""}</td></tr>
      </table>
      <p>Ready to discuss your results? Book a complimentary 30-minute strategy call with Shane.</p>
      <p style="margin:24px 0 0;">
        <a href="https://shanemccaw.consulting/contact" style="display:inline-block;background:#0078D4;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">Book a Strategy Call →</a>
      </p>
      <p style="margin-top:24px;">— Shane McCaw<br/><span style="color:#64748b;font-size:13px;">Lead Microsoft 365 Architect | Shane McCaw Consulting</span></p>
    `;

    await sendEmailWithAttachmentOrThrow(
      email,
      `Your ${cfg.reportName} Report`,
      brandedEmail(bodyHtml),
      [{ filename: cfg.pdfFilename, content: pdfBuffer }],
    );

    return res.json({ success: true });
  } catch (err) {
    logger.warn({ err }, "quiz/resend-pdf: failed");
    return res.status(500).json({ error: "Failed to send the report. Please try again." });
  }
});

export default router;
