import { createHmac } from "crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { db, quizLeadsTable, quizAnalyticsEventsTable, notificationsTable, usersTable, servicesTable, leadOfferRuleGroupsTable } from "@workspace/db";
import { sendWebPushToAdmins } from "../lib/web-push";
import { and, asc, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
const log = logger.child({ channel: "growth.quiz" });
import { emitWorkflowEvent } from "../lib/workflow-executor.ts";
import { inferSignalsFromQuizScores, computeLeadOfferEngine } from "../lib/lead-offer-engine.ts";
import { ensureLeadForEmail } from "../lib/lead-intent.ts";
import { generateQuizPdf } from "../lib/quiz-pdf";
import { sendEmailWithAttachment, sendEmailWithAttachmentOrThrow, sendEmail, sendEmailFromTemplate, getEmailTemplateOrFallback, brandedEmail, quizLeadNotificationEmail } from "../lib/mailer";

const RESEND_TOKEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function makeResendToken(leadId: number): string {
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

1. Security Posture (Q1, Q2): Microsoft Secure Score engagement, Defender for Office 365 configuration, anti-phishing and anti-malware policies, DKIM/DMARC/SPF email authentication.
2. Identity & Conditional Access (Q3, Q4): MFA coverage across all accounts, Conditional Access policy deployment and breadth, Entra ID configuration, privileged identity management.
3. Collaboration Sprawl (Q5, Q6): Teams and SharePoint governance — naming conventions, site and team lifecycle policies, guest access controls, sprawl and shadow IT indicators.
4. Admin Roles & Shadow IT (Q7, Q8): Global Admin count and least-privilege practices, admin role hygiene, monitoring and alerting tools in use, shadow IT and unsanctioned app usage.
5. DLP & Sensitivity Labels (Q9, Q10): Sensitivity label deployment and coverage, DLP policy configuration and scope, data classification maturity, information protection readiness.

Rules:
- Ask questions in a conversational, professional tone.
- Do NOT number the questions explicitly.
- Ask one focused question at a time and wait for the user's answer.
- Keep each question to 1–2 sentences maximum.
- On the very first message, greet the user briefly (1 sentence) and immediately ask about their Microsoft Secure Score.
- For questions 2–10, acknowledge the previous answer in one short sentence before asking the next question.
- Do NOT provide scores, feedback, or analysis during the quiz.
- After question 10 is answered, respond with exactly: "Thank you — that completes the assessment. I'll now generate your personalised tenant health report."`,

  sharepoint: `You are a SharePoint architecture specialist working for Shane McCaw Consulting. Your job is to conduct a structured 10-question SharePoint architecture assessment for organisations wanting to understand the health and maturity of their SharePoint environment.

You ask exactly 10 questions, one at a time. Each question probes one of five architecture categories (two questions per category):

1. Information Architecture (Q1, Q2): Hub site structure, naming conventions, site hierarchy, provisioning processes, and whether the environment was intentionally designed or grew organically.
2. Search & Metadata (Q3, Q4): Content findability, search configuration quality, managed properties usage, metadata tagging practices, and navigation structure consistency.
3. Content Lifecycle (Q5, Q6): What happens to content when projects end or employees leave, retention and archiving policies, inactive site handling, and whether lifecycle management is documented.
4. Governance Gaps (Q7, Q8): Inherited vs unique permissions, external sharing posture, guest access controls, known governance gaps, oversharing risks, and ownership accountability.
5. Migration Readiness (Q9, Q10): Whether a SharePoint migration or modernisation is planned, technical debt identified, blockers to migration, documentation accuracy, and legacy content volume.

Rules:
- Ask questions in a conversational, professional tone.
- Do NOT number the questions explicitly.
- Ask one focused question at a time and wait for the user's answer.
- Keep each question to 1–2 sentences maximum.
- On the very first message, greet the user briefly (1 sentence) and immediately ask about their SharePoint site structure and hierarchy.
- For questions 2–10, acknowledge the previous answer in one short sentence before asking the next question.
- Do NOT provide scores, feedback, or analysis during the quiz.
- After question 10 is answered, respond with exactly: "Thank you — that completes the assessment. I'll now generate your personalised SharePoint architecture report."`,

  "power-platform": `You are a Power Platform maturity specialist working for Shane McCaw Consulting. Your job is to conduct a structured 10-question Power Platform maturity assessment for organisations wanting to understand how well-governed and mature their Power Platform practice is.

You ask exactly 10 questions, one at a time. Each question probes one of five maturity categories (two questions per category):

1. Environment Strategy (Q1, Q2): How environments are structured (dev/test/prod), naming conventions, who can create environments, environment request and approval process, capacity planning.
2. DLP & Maker Permissions (Q3, Q4): Data Loss Prevention policy configuration across environments, connector governance model, maker permission tiers, who can build what in which environment, maker enablement guardrails.
3. App Sprawl & Data Risk (Q5, Q6): Number of apps in production, undocumented or abandoned apps, data sensitivity of connected sources, unmanaged connections, data residency and sovereignty concerns.
4. Monitoring & Compliance (Q7, Q8): Flow failure alerting and monitoring, CoE toolkit adoption and usage, capacity utilisation awareness, compliance with internal IT governance policies, audit capability.
5. Governance Readiness (Q9, Q10): Whether a formal Power Platform governance framework exists, documentation quality and completeness, IT strategy alignment, expansion plans, and maturity of the Centre of Excellence.

Rules:
- Ask questions in a conversational, professional tone.
- Do NOT number the questions explicitly.
- Ask one focused question at a time and wait for the user's answer.
- Keep each question to 1–2 sentences maximum.
- On the very first message, greet the user briefly (1 sentence) and immediately ask about their Power Platform environment strategy.
- For questions 2–10, acknowledge the previous answer in one short sentence before asking the next question.
- Do NOT provide scores, feedback, or analysis during the quiz.
- After question 10 is answered, respond with exactly: "Thank you — that completes the assessment. I'll now generate your personalised Power Platform maturity report."`,

  "security-compliance": `You are a Microsoft 365 security and compliance specialist working for Shane McCaw Consulting. Your job is to conduct a structured 10-question M365 security and compliance posture assessment for organisations wanting to understand their risk posture and compliance readiness.

You ask exactly 10 questions, one at a time. Each question probes one of five security and compliance categories (two questions per category):

1. Identity & Access Control (Q1, Q2): MFA coverage for all users including admins and contractors, Conditional Access policy deployment and enforcement, Entra ID configuration, Privileged Identity Management and just-in-time access controls.
2. Data Protection (Q3, Q4): Microsoft Purview sensitivity label deployment and coverage, DLP policy configuration and enforcement across email, Teams, SharePoint, and OneDrive, information protection maturity and data classification practices.
3. Insider Risk & Compliance (Q5, Q6): Microsoft Purview Insider Risk Management policy deployment, Communication Compliance configuration, Compliance Manager usage and improvement score, overall compliance posture.
4. Audit & eDiscovery (Q7, Q8): Unified Audit Log retention configuration, eDiscovery readiness and whether it has been tested in practice, Content Search usage, audit log review processes and alerting.
5. Regulatory Readiness (Q9, Q10): Applicable regulatory framework mapping (HIPAA, CMMC, FedRAMP, SOX, GDPR, NIST), corresponding Microsoft Purview Compliance Manager control configuration, audit readiness posture and gaps.

Rules:
- Ask questions in a conversational, professional tone.
- Do NOT number the questions explicitly.
- Ask one focused question at a time and wait for the user's answer.
- Keep each question to 1–2 sentences maximum.
- On the very first message, greet the user briefly (1 sentence) and immediately ask about their MFA and Conditional Access deployment.
- For questions 2–10, acknowledge the previous answer in one short sentence before asking the next question.
- Do NOT provide scores, feedback, or analysis during the quiz.
- After question 10 is answered, respond with exactly: "Thank you — that completes the assessment. I'll now generate your personalised security posture report."`,

  teams: `You are a Microsoft Teams specialist working for Shane McCaw Consulting. Your job is to conduct a structured 10-question Teams health assessment for organisations wanting to understand how well-governed and effectively used their Microsoft Teams environment is.

You ask exactly 10 questions, one at a time. Each question probes one of five Teams health categories (two questions per category):

1. Lifecycle & Naming (Q1, Q2): Team and channel creation policies, naming convention enforcement, ownership assignment at provisioning, lifecycle management (expiry policies, archiving, inactive team remediation).
2. Adoption & Culture (Q3, Q4): Which departments use Teams as their primary collaboration tool vs defaulting to email, adoption barriers, training and enablement provided, executive modelling of Teams use.
3. Guest & Channel Structure (Q5, Q6): External guest access controls and review processes, standard vs private vs shared channel governance, channel structure consistency across teams, external collaboration policies.
4. App Usage Governance (Q7, Q8): Third-party apps added to Teams, app approval and governance policies, governance of the app catalogue, advanced feature usage (Copilot meeting summaries, polls, breakout rooms).
5. Collaboration Governance (Q9, Q10): Meeting recording retention policies, information architecture within Teams (channel naming, file organisation, content findability), alignment between Teams governance and SharePoint governance policies.

Rules:
- Ask questions in a conversational, professional tone.
- Do NOT number the questions explicitly.
- Ask one focused question at a time and wait for the user's answer.
- Keep each question to 1–2 sentences maximum.
- On the very first message, greet the user briefly (1 sentence) and immediately ask about how Teams and channels are created and named in their organisation.
- For questions 2–10, acknowledge the previous answer in one short sentence before asking the next question.
- Do NOT provide scores, feedback, or analysis during the quiz.
- After question 10 is answered, respond with exactly: "Thank you — that completes the assessment. I'll now generate your personalised Teams health report."`,

  migration: `You are a Microsoft 365 cloud migration specialist working for Shane McCaw Consulting. Your job is to conduct a structured 10-question migration readiness assessment for organisations planning to migrate to Microsoft 365.

You ask exactly 10 questions, one at a time. Each question probes one of five readiness categories (two questions per category):

1. Source Complexity & ROT (Q1, Q2): Scale and platform of source environment (Exchange/Google Workspace/legacy file servers), data volumes, Redundant/Obsolete/Trivial (ROT) data, whether a pre-migration clean-up phase is planned, legacy system dependencies.
2. Permissions & Metadata (Q3, Q4): Permission complexity in the source environment, inheritance vs unique permissions, metadata richness and tagging quality, whether permissions and metadata will be migrated or rebuilt from scratch post-migration.
3. IA & Security Blockers (Q5, Q6): Information architecture blockers (naming conventions, structure decisions), regulatory and security requirements that could slow the migration, legacy authentication systems, compliance framework migration obligations (HIPAA, CMMC, FedRAMP).
4. Timeline Realism (Q7, Q8): Planned migration timeline and approach (phased vs big-bang), cut-over planning, known schedule risks and resource constraints, executive-level commitment to the timeline, previous failed migration attempts.
5. Migration Governance (Q9, Q10): Migration project governance (named owner, steering committee, communication plan), rollback procedures, success criteria definition, post-migration validation plan, and whether end-user training is scoped.

Rules:
- Ask questions in a conversational, professional tone.
- Do NOT number the questions explicitly.
- Ask one focused question at a time and wait for the user's answer.
- Keep each question to 1–2 sentences maximum.
- On the very first message, greet the user briefly (1 sentence) and immediately ask what platform or system they are migrating from and the approximate data scale.
- For questions 2–10, acknowledge the previous answer in one short sentence before asking the next question.
- Do NOT provide scores, feedback, or analysis during the quiz.
- After question 10 is answered, respond with exactly: "Thank you — that completes the assessment. I'll now generate your personalised migration readiness report."`,

  governance: `You are a Microsoft 365 governance specialist working for Shane McCaw Consulting. Your job is to conduct a structured 10-question governance maturity assessment for organisations wanting to understand the maturity of their Microsoft 365 governance framework.

You ask exactly 10 questions, one at a time. Each question probes one of five governance categories (two questions per category):

1. Policies & Roles (Q1, Q2): Whether formal governance policies exist (acceptable use, data classification, naming conventions), who owns governance in the organisation, the RACI model for M365 governance decisions, and whether policies are reviewed regularly.
2. Lifecycle Management (Q3, Q4): Team, site, group, and mailbox lifecycle policies, owner accountability processes, archiving and deletion procedures, inactive resource detection and remediation, guest account expiry.
3. Security & Compliance Controls (Q5, Q6): Technical enforcement of governance through M365 controls — Conditional Access, sensitivity labels, DLP policies, retention, and compliance framework implementation through Purview.
4. Monitoring & Reporting (Q7, Q8): How governance compliance is monitored and reported, what reports are reviewed and by whom, frequency of governance audits, tooling used (Compliance Manager, Microsoft 365 admin reports, third-party tools).
5. Adoption & Accountability (Q9, Q10): How governance policies are communicated to end users and new joiners, training and change management approach, accountability mechanisms for policy violations, exception handling and escalation paths.

Rules:
- Ask questions in a conversational, professional tone.
- Do NOT number the questions explicitly.
- Ask one focused question at a time and wait for the user's answer.
- Keep each question to 1–2 sentences maximum.
- On the very first message, greet the user briefly (1 sentence) and immediately ask about their M365 governance policy documentation.
- For questions 2–10, acknowledge the previous answer in one short sentence before asking the next question.
- Do NOT provide scores, feedback, or analysis during the quiz.
- After question 10 is answered, respond with exactly: "Thank you — that completes the assessment. I'll now generate your personalised governance maturity report."`,
};

// ─── Scoring configs per quiz type ────────────────────────────────────────────
interface ScoringConfig {
  categories: string;
  categoryKeys: string;
  categoryConfig: Array<{ key: string; label: string }>;
  services: string;
  defaultService: string;
  reportName: string;
  pdfFilename: string;
}

// ─── Service descriptions per quiz type ───────────────────────────────────────
// Used to populate serviceDescription in the submit response for all quiz types.
const SERVICE_DESCRIPTIONS: Record<string, Record<string, string>> = {
  copilot: {
    "Microsoft 365 Essentials Audit": "A comprehensive tenant audit revealing quick wins and critical gaps in your M365 environment.",
    "Copilot AI Readiness & Deployment": "End-to-end Copilot enablement: licensing, data governance, training, and governed rollout.",
    "Microsoft 365 Governance Setup": "Establish DLP policies, sensitivity labels, and compliance controls that protect your data.",
    "AI Adoption & Change Management": "Drive Copilot adoption through executive alignment, champion networks, and structured change management.",
    "SharePoint & Teams Modernisation": "Redesign your intranet and collaboration spaces so Copilot has clean, well-structured data to work with.",
  },
  "m365-health": {
    "M365 Tenant Health Audit": "A structured end-to-end audit of your Microsoft 365 tenant covering security posture, identity controls, collaboration governance, admin role hygiene, and data protection readiness.",
    "Copilot for M365 Readiness Assessment": "A focused evaluation of your tenant's readiness to deploy Microsoft Copilot — licensing, data governance, security controls, and adoption planning.",
    "Governance Foundations Package": "A full governance framework build-out: DLP policies, sensitivity labels, lifecycle management, and compliance controls tailored to your regulatory environment.",
  },
  sharepoint: {
    "M365 Tenant Health Audit": "A comprehensive review of your Microsoft 365 tenant to resolve the underlying configuration and governance issues limiting your SharePoint environment.",
    "Governance Foundations Package": "Naming conventions, lifecycle policies, permission models, and hub site architecture — everything needed to bring order and scalability to your SharePoint environment.",
    "Copilot for M365 Readiness Assessment": "Evaluate your readiness to deploy Microsoft Copilot, which relies on well-governed, well-structured SharePoint content to deliver accurate AI-generated results.",
  },
  "power-platform": {
    "Power Platform Quick-Start": "A focused 4-week sprint to stand up your Power Platform governance framework, deploy the CoE Toolkit, and deliver one production-ready app or flow as a repeatable template.",
    "Governance Foundations Package": "Enterprise-scale governance across your full Microsoft 365 environment, including Power Platform DLP policies, environment strategy, and maker lifecycle management.",
    "Copilot for M365 Readiness Assessment": "Assess your readiness to add AI to your Power Platform practice — including AI Builder, Copilot Studio, and Copilot-powered app and flow generation.",
  },
  "security-compliance": {
    "Governance Foundations Package": "A complete M365 security and governance build-out: Conditional Access policies, sensitivity labels, DLP rules, retention schedules, and compliance framework alignment.",
    "M365 Tenant Health Audit": "A comprehensive tenant audit that surfaces every security misconfiguration, licensing gap, and governance deficiency creating risk in your environment.",
    "Copilot for M365 Readiness Assessment": "Validate that your security and compliance controls are strong enough to deploy Microsoft Copilot safely — including data classification, DLP, and information barriers.",
  },
  teams: {
    "M365 Tenant Health Audit": "A full Microsoft 365 tenant audit to resolve the underlying configuration gaps that are limiting your Teams environment's governance and performance.",
    "Governance Foundations Package": "Teams lifecycle policies, naming conventions, guest access governance, and channel structure standards — everything needed to make your Teams environment auditable and manageable.",
    "Copilot for M365 Readiness Assessment": "Assess your readiness to deploy Copilot for Microsoft Teams — meeting summaries, chat drafting, intelligent recaps, and AI-powered channel assistance.",
  },
  migration: {
    "Migration Readiness Assessment": "A structured pre-migration assessment that evaluates your source environment complexity, identity readiness, governance posture, and stakeholder alignment — producing a formal go/no-go recommendation.",
    "Governance Foundations Package": "Establish the DLP policies, sensitivity labels, retention schedules, and lifecycle controls that should be in place in your Microsoft 365 tenant before or alongside migration execution.",
    "M365 Tenant Health Audit": "A post-migration tenant health audit to validate that your newly migrated Microsoft 365 environment is correctly configured, secured, and governed.",
  },
  governance: {
    "Governance Foundations Package": "A complete Microsoft 365 governance framework: acceptable use policies, data classification standards, DLP enforcement, retention schedules, lifecycle management, and compliance framework alignment.",
    "Copilot for M365 Readiness Assessment": "With strong governance in place, evaluate your full Microsoft Copilot readiness — ensuring the data governance controls Copilot relies on are already operational.",
    "M365 Tenant Health Audit": "A comprehensive tenant audit that validates your governance controls are correctly implemented and identifies gaps between your policies and the technical configuration.",
  },
};

const SCORING_CONFIGS: Record<string, ScoringConfig> = {
  copilot: {
    categories: `- infrastructure: M365 licensing, Entra ID, MFA, device compliance
- data: Sensitivity labels, DLP, governance, compliance
- aiLiteracy: Employee AI skills, training, adoption culture
- changeManagement: Executive buy-in, policies, rollout planning
- businessProcess: Use cases identified, ROI tracking, success metrics`,
    categoryKeys: "infrastructure, data, aiLiteracy, changeManagement, businessProcess",
    categoryConfig: [
      { key: "infrastructure", label: "Infrastructure & Identity" },
      { key: "data", label: "Data & Compliance" },
      { key: "aiLiteracy", label: "AI Literacy" },
      { key: "changeManagement", label: "Change Management" },
      { key: "businessProcess", label: "Business Process" },
    ],
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
    categoryConfig: [
      { key: "securityPosture", label: "Security Posture" },
      { key: "identityConditionalAccess", label: "Identity & Conditional Access" },
      { key: "collaborationSprawl", label: "Collaboration Sprawl" },
      { key: "adminRolesShadowIT", label: "Admin Roles & Shadow IT" },
      { key: "dlpSensitivityLabels", label: "DLP & Sensitivity Labels" },
    ],
    services: `- "M365 Tenant Health Audit" — comprehensive audit for tenants with configuration gaps, security issues, or governance debt
- "Copilot for M365 Readiness Assessment" — for mature tenants ready to evaluate Copilot deployment
- "Governance Foundations Package" — for tenants that need formal governance after addressing health issues`,
    defaultService: "M365 Tenant Health Audit",
    reportName: "Microsoft 365 Tenant Health Assessment",
    pdfFilename: "m365-health-report.pdf",
  },
  sharepoint: {
    categories: `- infoArchitecture: Hub site structure, naming conventions, site hierarchy, provisioning process, whether the environment was designed or grew organically
- searchMetadata: Content findability, search configuration quality, managed properties usage, metadata tagging practices, navigation structure consistency
- contentLifecycle: What happens to content when projects end or employees leave, retention and archiving policies, inactive site handling, lifecycle management documentation
- governanceGaps: Inherited vs unique permissions, external sharing posture, guest access controls, known governance gaps, oversharing risks, ownership accountability
- migrationReadiness: Whether a SharePoint migration or modernisation is planned, technical debt identified, blockers to migration, documentation accuracy, legacy content volume`,
    categoryKeys: "infoArchitecture, searchMetadata, contentLifecycle, governanceGaps, migrationReadiness",
    categoryConfig: [
      { key: "infoArchitecture", label: "Information Architecture" },
      { key: "searchMetadata", label: "Search & Metadata" },
      { key: "contentLifecycle", label: "Content Lifecycle" },
      { key: "governanceGaps", label: "Governance Gaps" },
      { key: "migrationReadiness", label: "Migration Readiness" },
    ],
    services: `- "M365 Tenant Health Audit" — for environments with significant configuration and governance debt
- "Governance Foundations Package" — for environments needing formal governance, naming conventions, and lifecycle policies
- "Copilot for M365 Readiness Assessment" — for mature environments ready to deploy Copilot on clean SharePoint foundations`,
    defaultService: "Governance Foundations Package",
    reportName: "SharePoint Architecture Assessment",
    pdfFilename: "sharepoint-assessment-report.pdf",
  },
  "power-platform": {
    categories: `- environmentStrategy: Environment structure (dev/test/prod), naming conventions, who can create environments, approval process, capacity planning
- dlpMakerPermissions: DLP policy configuration across environments, connector governance, maker permission tiers, who can build what, maker enablement guardrails
- appSprawlDataRisk: App volume in production, undocumented or abandoned apps, data sensitivity of connected sources, unmanaged connections, data residency concerns
- monitoringCompliance: Flow failure alerting and monitoring, CoE toolkit adoption, capacity utilisation awareness, compliance with IT governance policies, audit capability
- governanceReadiness: Whether a formal Power Platform governance framework exists, documentation quality, IT strategy alignment, expansion plans, Centre of Excellence maturity`,
    categoryKeys: "environmentStrategy, dlpMakerPermissions, appSprawlDataRisk, monitoringCompliance, governanceReadiness",
    categoryConfig: [
      { key: "environmentStrategy", label: "Environment Strategy" },
      { key: "dlpMakerPermissions", label: "DLP & Maker Permissions" },
      { key: "appSprawlDataRisk", label: "App Sprawl & Data Risk" },
      { key: "monitoringCompliance", label: "Monitoring & Compliance" },
      { key: "governanceReadiness", label: "Governance Readiness" },
    ],
    services: `- "Power Platform Quick-Start" — for organisations with limited governance or early-stage maker practices
- "Governance Foundations Package" — for organisations with mature Power Platform usage needing broader M365 governance
- "Copilot for M365 Readiness Assessment" — for mature organisations ready to add AI to their Power Platform practice`,
    defaultService: "Power Platform Quick-Start",
    reportName: "Power Platform Maturity Assessment",
    pdfFilename: "power-platform-assessment-report.pdf",
  },
  "security-compliance": {
    categories: `- identityAccess: MFA coverage, Conditional Access policy breadth and enforcement, Entra ID configuration, privileged identity management and just-in-time access
- dataProtection: Sensitivity label deployment and coverage, DLP policy configuration and enforcement, information protection maturity, data classification practices
- insiderRiskCompliance: Insider Risk Manager policy deployment, Communication Compliance configuration, Compliance Manager usage and improvement score, compliance posture
- auditEDiscovery: Audit log retention configuration, eDiscovery readiness and tested capability, Content Search usage, audit log review processes
- regulatoryReadiness: Applicable regulatory framework mapping (HIPAA, CMMC, FedRAMP, SOX, GDPR, NIST), Purview compliance control configuration, audit readiness posture`,
    categoryKeys: "identityAccess, dataProtection, insiderRiskCompliance, auditEDiscovery, regulatoryReadiness",
    categoryConfig: [
      { key: "identityAccess", label: "Identity & Access Control" },
      { key: "dataProtection", label: "Data Protection" },
      { key: "insiderRiskCompliance", label: "Insider Risk & Compliance" },
      { key: "auditEDiscovery", label: "Audit & eDiscovery" },
      { key: "regulatoryReadiness", label: "Regulatory Readiness" },
    ],
    services: `- "Governance Foundations Package" — for organisations with significant security and compliance gaps requiring a full governance framework
- "M365 Tenant Health Audit" — for organisations needing a comprehensive tenant-wide security and configuration review
- "Copilot for M365 Readiness Assessment" — for mature, secure environments ready to deploy Copilot safely`,
    defaultService: "Governance Foundations Package",
    reportName: "Microsoft 365 Security Posture Assessment",
    pdfFilename: "m365-security-assessment-report.pdf",
  },
  teams: {
    categories: `- lifecycleNaming: Team and channel creation policies, naming convention enforcement, ownership assignment at provisioning, lifecycle management (expiry policies, archiving, inactive team remediation)
- adoptionCulture: Which departments use Teams as primary collaboration tool vs email, adoption barriers, training and enablement provided, executive modelling of Teams use
- guestChannelStructure: External guest access controls and review processes, standard vs private vs shared channel governance, channel structure consistency, external collaboration policies
- appGovernance: Third-party apps in Teams, app approval and governance policies, app catalogue governance, advanced feature usage (Copilot summaries, polls, breakout rooms)
- collaborationGovernance: Meeting recording retention policies, information architecture within Teams, content findability, alignment between Teams and SharePoint governance policies`,
    categoryKeys: "lifecycleNaming, adoptionCulture, guestChannelStructure, appGovernance, collaborationGovernance",
    categoryConfig: [
      { key: "lifecycleNaming", label: "Lifecycle & Naming" },
      { key: "adoptionCulture", label: "Adoption & Culture" },
      { key: "guestChannelStructure", label: "Guest & Channel Structure" },
      { key: "appGovernance", label: "App Usage Governance" },
      { key: "collaborationGovernance", label: "Collaboration Governance" },
    ],
    services: `- "M365 Tenant Health Audit" — for tenants with broad configuration issues underlying Teams problems
- "Governance Foundations Package" — for Teams environments needing formal governance and lifecycle management
- "Copilot for M365 Readiness Assessment" — for well-governed Teams environments ready for Copilot meeting summaries and chat assistance`,
    defaultService: "Governance Foundations Package",
    reportName: "Microsoft Teams Health Assessment",
    pdfFilename: "teams-assessment-report.pdf",
  },
  migration: {
    categories: `- sourceComplexity: Scale and platform of source environment, data volumes, Redundant/Obsolete/Trivial (ROT) data, whether a pre-migration clean-up phase is planned, legacy system dependencies
- permissionsMetadata: Permission complexity in source environment, inheritance vs unique permissions, metadata richness and tagging quality, whether permissions and metadata will migrate or be rebuilt
- securityBlockers: Information architecture blockers, regulatory and security requirements that could slow migration, legacy authentication systems, compliance framework migration obligations
- timelineRealism: Planned migration timeline and approach (phased vs big-bang), cut-over planning, schedule risks, resource constraints, executive commitment, prior failed migration attempts
- migrationGovernance: Migration project governance (owner, steering committee, communication plan), rollback procedures, success criteria, post-migration validation plan, end-user training scope`,
    categoryKeys: "sourceComplexity, permissionsMetadata, securityBlockers, timelineRealism, migrationGovernance",
    categoryConfig: [
      { key: "sourceComplexity", label: "Source Complexity & ROT" },
      { key: "permissionsMetadata", label: "Permissions & Metadata" },
      { key: "securityBlockers", label: "IA & Security Blockers" },
      { key: "timelineRealism", label: "Timeline Realism" },
      { key: "migrationGovernance", label: "Migration Governance" },
    ],
    services: `- "Migration Readiness Assessment" — for organisations planning a migration that need a formal readiness report and go/no-go recommendation
- "Governance Foundations Package" — for organisations that need governance controls in place before or alongside migration execution
- "M365 Tenant Health Audit" — for organisations that have already migrated and want to assess the health of their new M365 tenant`,
    defaultService: "Migration Readiness Assessment",
    reportName: "Cloud Migration Readiness Assessment",
    pdfFilename: "migration-readiness-report.pdf",
  },
  governance: {
    categories: `- policiesRoles: Whether formal governance policies exist (acceptable use, data classification, naming conventions), who owns governance, RACI model, policy review frequency
- lifecycleManagement: Team, site, group, and mailbox lifecycle policies, owner accountability processes, archiving and deletion procedures, inactive resource remediation, guest account expiry
- securityComplianceControls: Technical enforcement of governance through M365 controls — Conditional Access, sensitivity labels, DLP policies, retention, Purview compliance framework implementation
- monitoringReporting: How governance compliance is monitored and reported, reports reviewed and by whom, governance audit frequency, tooling used (Compliance Manager, M365 admin reports)
- adoptionAccountability: How governance policies are communicated to end users and new joiners, training approach, accountability mechanisms for violations, exception handling and escalation`,
    categoryKeys: "policiesRoles, lifecycleManagement, securityComplianceControls, monitoringReporting, adoptionAccountability",
    categoryConfig: [
      { key: "policiesRoles", label: "Policies & Roles" },
      { key: "lifecycleManagement", label: "Lifecycle Management" },
      { key: "securityComplianceControls", label: "Security & Compliance Controls" },
      { key: "monitoringReporting", label: "Monitoring & Reporting" },
      { key: "adoptionAccountability", label: "Adoption & Accountability" },
    ],
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
  const knownQuizTypes = Object.keys(SYSTEM_PROMPTS);
  if (!knownQuizTypes.includes(quizType)) {
    req.log.warn({ quizType }, "quiz/chat: unknown quizType — falling back to copilot");
  }
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
    log.error({ err }, "quiz/chat: AI call failed");
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
  const knownQuizTypes = Object.keys(SCORING_CONFIGS);
  if (!knownQuizTypes.includes(quizType)) {
    req.log.warn({ quizType }, "quiz/submit: unknown quizType — falling back to copilot scoring");
  }
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
- roiProjection: 2–3 sentences projecting realistic ROI/value if they address the identified gaps${quizType === "m365-health" ? `
- detectedSeats: integer — if the respondent mentioned a specific number of users, seats, licences, employees, or staff at any point in the conversation, extract that number; otherwise use null` : ""}

Respond ONLY with valid JSON in this exact shape:
{
  "categoryScores": { ${cfg.categoryKeys.split(", ").map(k => `"${k}": 5`).join(", ")} },
  "recommendedService": "${cfg.defaultService}",
  "whatThisMeans": "...",
  "whyThisFits": "...",
  "roiProjection": "..."${quizType === "m365-health" ? `,
  "detectedSeats": null` : ""}
}`;

  const defaultCategoryScores = Object.fromEntries(
    cfg.categoryKeys.split(", ").map((k) => [k.trim(), 5])
  );

  let scores: Record<string, number> = { ...defaultCategoryScores };
  let recommendedService = cfg.defaultService;
  let whatThisMeans = "Your organisation has a solid foundation with some areas to strengthen.";
  let whyThisFits = "This service will address your key gaps and set you up for success.";
  let roiProjection = "Organisations at your maturity level typically achieve significant productivity and compliance gains within 6 months of a structured engagement.";
  let detectedSeats: number | null = null;

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
      if (quizType === "m365-health" && typeof parsedScores.detectedSeats === "number" && parsedScores.detectedSeats > 0) {
        detectedSeats = Math.round(parsedScores.detectedSeats);
      }
    }
  } catch (err) {
    log.warn({ err }, "quiz/submit: scoring AI call failed, using defaults");
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
      detectedSeats,
    }).returning({ id: quizLeadsTable.id });
    leadId = inserted?.id ?? null;
  } catch (err) {
    log.error({ err }, "quiz/submit: DB insert failed");
    return res.status(500).json({ error: "Failed to save your results. Please try again." });
  }

  // Bridge into the CRM leads table (check-then-create by email) so the
  // Engagement Offer Engine's findLeadByEmail lookup has a real row to find —
  // quiz submission alone never created one before this.
  void ensureLeadForEmail(email, { name, company: company ?? undefined, source: "quiz" });

  if (leadId !== null) {
    try {
      const inferredSignals = await inferSignalsFromQuizScores(scores, null);
      if (inferredSignals.size > 0) {
        const ruleGroups = await db.select().from(leadOfferRuleGroupsTable).where(eq(leadOfferRuleGroupsTable.isActive, true));
        const services = await db
          .select({ id: servicesTable.id, name: servicesTable.name, price: servicesTable.price, basePrice: servicesTable.basePrice })
          .from(servicesTable);

        const offerResult = await computeLeadOfferEngine(
          leadId,
          null,
          inferredSignals,
          ruleGroups,
          services,
          { minScore: 30, maxCandidates: 3, defaultExpirationDays: 14, bundlingThreshold: 2 },
        );

        if (offerResult.candidates.length > 0) {
          await db.update(quizLeadsTable)
            .set({
              leadOfferResult: {
                inferredSignals: offerResult.inferredSignals,
                candidates: offerResult.candidates.map(c => ({
                  serviceId: c.serviceId,
                  serviceName: c.serviceName,
                  title: c.title,
                  rationale: c.rationale,
                  basePriceCents: c.basePriceCents,
                  adjustedPriceCents: c.adjustedPriceCents,
                  aiPricingReasoning: c.aiPricingReasoning,
                  score: c.score,
                  expirationDays: c.expirationDays,
                })),
                generatedAt: new Date().toISOString(),
              },
            })
            .where(eq(quizLeadsTable.id, leadId));
          log.info({ leadId, candidateCount: offerResult.candidates.length }, "quiz/submit: lead offer generated");
        }
      }
    } catch (err) {
      log.warn({ err, leadId }, "quiz/submit: lead offer generation failed (non-fatal) — quiz submission still succeeds");
    }
  }

  if (leadId !== null) {
    void emitWorkflowEvent("quiz.lead_submitted", {
      quizLeadId: leadId,
      name,
      email,
      company: company ?? null,
      quizType,
      totalScore,
      tier,
      recommendedService,
      categoryScores: scores,
    });

    void (async () => {
      try {
        const admins = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.role, "admin"));
        if (admins.length > 0) {
          await db.insert(notificationsTable).values(
            admins.map(a => ({
              userId: a.id,
              title: `New quiz lead: ${name}`,
              body: company ? `${company} — ${tier}` : tier,
              type: "quiz_lead_created" as const,
              linkPath: `/crm/quiz-leads/${leadId}`,
            }))
          );
        }
        void sendWebPushToAdmins({
          title: `New quiz lead: ${name}`,
          body: company ? `${company} — ${tier}` : tier,
          linkPath: `/crm/quiz-leads/${leadId}`,
        });
      } catch {}
    })();
  }

  let resendToken: string | null = null;
  try {
    resendToken = leadId !== null ? makeResendToken(leadId) : null;
  } catch (err) {
    log.warn({ err }, "quiz/submit: could not generate resend token");
  }
  const resultsUrl = leadId !== null && resendToken !== null
    ? `https://shanemccaw.consulting/quiz/results/${leadId}?token=${resendToken}`
    : "";
  const categoryScoresRows = cfg.categoryConfig
    .map(cat => `<tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:160px;">${cat.label}</td><td style="padding:4px 0;font-weight:600;">${scores[cat.key] ?? 0}/10</td></tr>`)
    .join("\n");

  void (async () => {
    const shaneEmail = process.env.ADMIN_EMAIL ?? process.env.CRM_ADMIN_EMAIL;
    if (shaneEmail) {
      await sendEmailFromTemplate(
        "quiz-lead-notification",
        shaneEmail,
        {
          name,
          email,
          company: company ?? "",
          totalScore: String(totalScore),
          tier,
          recommendedService,
          whatThisMeans,
          whyThisFits,
          roiProjection,
          categoryScoresRows,
          resultsUrl,
        },
        `New quiz lead: ${name} (${cfg.reportName} — ${tier} — ${totalScore}/50)`,
        quizLeadNotificationEmail({ name, email, company, totalScore, tier, recommendedService }),
      );
    }
  })();

  const pdfData = { name, email, company, totalScore, tier, recommendedService, categoryScores: scores, whatThisMeans, whyThisFits, roiProjection, reportTitle: cfg.reportName, categoryConfig: cfg.categoryConfig };

  void (async () => {
    try {
      const pdfBuffer = await generateQuizPdf(pdfData);
      const firstName = name.split(" ")[0] || "there";
      const defaultBody = `
        <p>Hi ${firstName},</p>
        <p>Thank you for completing the <strong>${cfg.reportName}</strong>. Your personalised report is attached to this email — here is a summary of your results.</p>
        <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
          <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:160px;">Total Score</td><td style="padding:4px 0;font-weight:600;">${totalScore} / 50</td></tr>
          <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Maturity Tier</td><td style="padding:4px 0;font-weight:600;">${tier}</td></tr>
          <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Recommended Service</td><td style="padding:4px 0;font-weight:600;">${recommendedService}</td></tr>
          ${categoryScoresRows}
        </table>
        ${whatThisMeans ? `<p style="margin:16px 0 4px;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">What This Means For You</p><p style="margin:0 0 16px;font-size:14px;line-height:1.6;">${whatThisMeans}</p>` : ""}
        ${whyThisFits ? `<p style="margin:16px 0 4px;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Recommended Next Step — Why This Fits</p><p style="margin:0 0 16px;font-size:14px;line-height:1.6;">${whyThisFits}</p>` : ""}
        ${roiProjection ? `<p style="margin:16px 0 4px;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">ROI Projection</p><p style="margin:0 0 16px;font-size:14px;line-height:1.6;">${roiProjection}</p>` : ""}
        ${resultsUrl ? `<p style="margin:12px 0;"><a href="${resultsUrl}" style="color:#0078D4;font-size:13px;">View your full results online →</a></p>` : ""}
        <p>Ready to discuss your results? Book a complimentary 30-minute strategy call with Shane.</p>
        <p style="margin:24px 0 0;">
          <a href="https://shanemccaw.consulting/contact" style="display:inline-block;background:#0078D4;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">Book a Strategy Call →</a>
        </p>
        <p style="margin-top:24px;">— Shane McCaw<br/><span style="color:#64748b;font-size:13px;">Lead Microsoft 365 Architect | Shane McCaw Consulting</span></p>
      `;
      const { subject: emailSubject, bodyHtml } = await getEmailTemplateOrFallback(
        "quiz-report-email",
        {
          firstName,
          reportName: cfg.reportName,
          totalScore: String(totalScore),
          tier,
          recommendedService,
          whatThisMeans,
          whyThisFits,
          roiProjection,
          categoryScoresRows,
          resultsUrl,
        },
        `Your ${cfg.reportName} Report`,
        defaultBody,
      );
      await sendEmailWithAttachment(
        email,
        emailSubject,
        await brandedEmail(bodyHtml),
        [{ filename: cfg.pdfFilename, content: pdfBuffer }],
      );
    } catch (err) {
      log.warn({ err }, "quiz/submit: PDF email failed");
    }
  })();

  return res.json({
    success: true,
    leadId,
    resendToken,
    totalScore,
    tier,
    recommendedService,
    categoryScores: scores,
    serviceDescription: SERVICE_DESCRIPTIONS[quizType]?.[recommendedService ?? ""] ?? "",
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
  const leadCategoryScores = lead.categoryScores as unknown as Record<string, number>;
  const resendResultsUrl = `https://shanemccaw.consulting/quiz/results/${leadId}?token=${resendToken}`;
  const resendCategoryScoresRows = cfg.categoryConfig
    .map(cat => `<tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:160px;">${cat.label}</td><td style="padding:4px 0;font-weight:600;">${leadCategoryScores[cat.key] ?? 0}/10</td></tr>`)
    .join("\n");

  try {
    const pdfBuffer = await generateQuizPdf({
      name: lead.name,
      email: lead.email,
      company: lead.company ?? undefined,
      totalScore: lead.totalScore,
      tier: lead.tier,
      recommendedService: lead.recommendedService ?? "",
      categoryScores: leadCategoryScores,
      whatThisMeans: analysis.whatThisMeans,
      whyThisFits: analysis.whyThisFits,
      roiProjection: analysis.roiProjection,
      reportTitle: cfg.reportName,
      categoryConfig: cfg.categoryConfig,
    });

    const firstName = lead.name.split(" ")[0] || "there";
    const defaultBody = `
      <p>Hi ${firstName},</p>
      <p>As requested, your <strong>${cfg.reportName}</strong> report is attached to this email — here is a summary of your results.</p>
      <table cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;padding:16px 20px;margin:16px 0;width:100%;">
        <tr><td style="padding:4px 0;color:#64748b;font-size:13px;width:160px;">Total Score</td><td style="padding:4px 0;font-weight:600;">${lead.totalScore} / 50</td></tr>
        <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Maturity Tier</td><td style="padding:4px 0;font-weight:600;">${lead.tier}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b;font-size:13px;">Recommended Service</td><td style="padding:4px 0;font-weight:600;">${lead.recommendedService ?? ""}</td></tr>
        ${resendCategoryScoresRows}
      </table>
      ${analysis.whatThisMeans ? `<p style="margin:16px 0 4px;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">What This Means For You</p><p style="margin:0 0 16px;font-size:14px;line-height:1.6;">${analysis.whatThisMeans}</p>` : ""}
      ${analysis.whyThisFits ? `<p style="margin:16px 0 4px;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">Recommended Next Step — Why This Fits</p><p style="margin:0 0 16px;font-size:14px;line-height:1.6;">${analysis.whyThisFits}</p>` : ""}
      ${analysis.roiProjection ? `<p style="margin:16px 0 4px;color:#64748b;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;">ROI Projection</p><p style="margin:0 0 16px;font-size:14px;line-height:1.6;">${analysis.roiProjection}</p>` : ""}
      <p style="margin:12px 0;"><a href="${resendResultsUrl}" style="color:#0078D4;font-size:13px;">View your full results online →</a></p>
      <p>Ready to discuss your results? Book a complimentary 30-minute strategy call with Shane.</p>
      <p style="margin:24px 0 0;">
        <a href="https://shanemccaw.consulting/contact" style="display:inline-block;background:#0078D4;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 24px;border-radius:6px;">Book a Strategy Call →</a>
      </p>
      <p style="margin-top:24px;">— Shane McCaw<br/><span style="color:#64748b;font-size:13px;">Lead Microsoft 365 Architect | Shane McCaw Consulting</span></p>
    `;
    const { subject: emailSubject, bodyHtml } = await getEmailTemplateOrFallback(
      "quiz-report-email",
      {
        firstName,
        reportName: cfg.reportName,
        totalScore: String(lead.totalScore),
        tier: lead.tier,
        recommendedService: lead.recommendedService ?? "",
        whatThisMeans: analysis.whatThisMeans,
        whyThisFits: analysis.whyThisFits,
        roiProjection: analysis.roiProjection,
        categoryScoresRows: resendCategoryScoresRows,
        resultsUrl: resendResultsUrl,
      },
      `Your ${cfg.reportName} Report`,
      defaultBody,
    );

    await sendEmailWithAttachmentOrThrow(
      email,
      emailSubject,
      await brandedEmail(bodyHtml),
      [{ filename: cfg.pdfFilename, content: pdfBuffer }],
    );

    return res.json({ success: true });
  } catch (err) {
    log.warn({ err }, "quiz/resend-pdf: failed");
    return res.status(500).json({ error: "Failed to send the report. Please try again." });
  }
});

// ─── Analytics event capture ──────────────────────────────────────────────────
const analyticsEventSchema = z.object({
  name: z.string().min(1).max(100),
  properties: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
});

// ─── GET /api/quiz/results/:leadId ────────────────────────────────────────────
const resultsLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 60, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many requests. Please try again later." } });

router.get("/quiz/results/:leadId", resultsLimiter, async (req, res) => {
  const leadId = Number(req.params.leadId);
  if (!Number.isInteger(leadId) || leadId <= 0) return res.status(400).json({ error: "Invalid lead ID." });

  const token = req.query.token as string | undefined;
  if (!token) return res.status(401).json({ error: "Token required." });

  if (!verifyResendToken(leadId, token)) return res.status(403).json({ error: "Invalid or expired token." });

  const lead = await db.query.quizLeadsTable.findFirst({ where: (t, { eq }) => eq(t.id, leadId) });
  if (!lead) return res.status(404).json({ error: "Results not found." });

  const qt = lead.quizType ?? "copilot";
  const cfg = SCORING_CONFIGS[qt] ?? SCORING_CONFIGS.copilot;
  const analysis = (lead.analysisText ?? {}) as { whatThisMeans?: string; whyThisFits?: string; roiProjection?: string };

  return res.json({
    name: lead.name,
    totalScore: lead.totalScore,
    tier: lead.tier,
    quizType: qt,
    categoryScores: lead.categoryScores as Record<string, number>,
    categoryConfig: cfg.categoryConfig,
    recommendedService: lead.recommendedService ?? null,
    reportName: cfg.reportName,
    whatThisMeans: analysis.whatThisMeans ?? "",
    whyThisFits: analysis.whyThisFits ?? "",
    roiProjection: analysis.roiProjection ?? "",
    createdAt: lead.createdAt,
    detectedSeats: lead.detectedSeats ?? null,
    leadOffer: lead.leadOfferResult ?? null,
  });
});

// ─── GET /api/quiz/monitoring-tiers ───────────────────────────────────────────
// Public endpoint used by the quiz results page to resolve a detected seat count
// to the matching monitoring tier slug for deep-link CTA routing.
// Returns only the fields needed for seat matching — no auth required.
const monitoringTiersLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: "draft-8", legacyHeaders: false });

router.get("/quiz/monitoring-tiers", monitoringTiersLimiter, async (_req, res) => {
  try {
    const tiers = await db
      .select({
        id: servicesTable.id,
        slug: servicesTable.slug,
        name: servicesTable.name,
        sortOrder: servicesTable.sortOrder,
        typeAttributes: servicesTable.typeAttributes,
      })
      .from(servicesTable)
      .where(and(
        eq(servicesTable.serviceType, "monitoring_tier"),
      ))
      .orderBy(asc(servicesTable.sortOrder), asc(servicesTable.id));

    return res.json(tiers);
  } catch (err) {
    log.warn({ err }, "quiz/monitoring-tiers: DB query failed");
    return res.status(500).json({ error: "Failed to fetch monitoring tiers" });
  }
});

const analyticsLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });

router.post("/quiz/analytics-event", analyticsLimiter, async (req, res) => {
  const parsed = analyticsEventSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid payload" });

  const { name, properties = {} } = parsed.data;
  req.log.info({ event: name, properties }, "quiz analytics event");

  try {
    await db.insert(quizAnalyticsEventsTable).values({ eventName: name, properties });
  } catch {
    req.log.warn({ event: name }, "quiz analytics event: db insert failed");
  }

  return res.json({ ok: true });
});

export default router;
