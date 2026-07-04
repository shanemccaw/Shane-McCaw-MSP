/**
 * document-generator.ts
 *
 * Shared helper for auto-generating and auto-delivering an Insights document
 * (report or consulting deliverable) directly from a kanban workflow task.
 *
 * Called by kanban-auto-fire.ts when a card with taskType="document_generation"
 * becomes the first backlog item in an active phase.
 *
 * The document is written to insights_generated_documents with
 * status="delivered" and deliveredAt set, making it immediately visible in the
 * client portal without admin approval.
 */

import {
  db,
  usersTable,
  projectsTable,
  insightsGeneratedDocumentsTable,
  scriptRunResultsTable,
  kanbanTasksTable,
  clientHealthHistoryTable,
  engagementProjectsTable,
} from "@workspace/db";
import { eq, and, desc, ne } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "./logger";
import { getPrompt, getDocumentStylePrefix } from "./prompt-loader";
import { extractAiHtml, parseSowPricing } from "./sow-pricing";
import { ensureOpportunityForSow } from "./crm-pipeline";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DocumentGenerationConfig {
  category: "report" | "consulting";
  docType: string;
  title: string;
}

export interface GenerateAndDeliverResult {
  documentId: number;
  title: string;
}

// ── Document type labels (mirrors admin-insights.ts) ──────────────────────────

const REPORT_DOC_TYPE_LABELS: Record<string, string> = {
  executive_summary:           "Executive Summary",
  full_readiness_report:       "Full Readiness Report",
  security_posture_report:     "Security Posture Report",
  governance_maturity_report:  "Governance Maturity Report",
  data_exposure_risk_report:   "Data Exposure Risk Report",
  license_optimization_report: "License Optimization Report",
};

const CONSULTING_TYPE_LABELS: Record<string, string> = {
  sow:                         "Statement of Work",
  task_execution_guide:        "SOW Task Execution Guide",
  remediation_plan:            "Remediation Plan",
  deployment_plan:             "Deployment Plan",
  governance_framework:        "Governance Framework",
  security_hardening_plan:     "Security Hardening Plan",
  copilot_enablement_plan:     "Copilot Enablement Plan",
  identity_modernization_plan: "Identity Modernization Plan",
};

const CONSULTING_SECTION_HINTS: Record<string, string> = {
  sow:                         "Include: Scope of Work, Objectives, Deliverables, Timeline (phased), Resource Requirements, Pricing (see Tier 02 formula below), Acceptance Criteria, Terms & Conditions",
  task_execution_guide:        "Use the project task list below as your source. For EACH task produce: Task name (h3), Purpose (one sentence), Prerequisites, Step-by-step instructions (numbered, technically specific for Microsoft 365), Expected outcome, Validation check, Common pitfalls. Group tasks by their workflow phase/group. Add an intro section and a completion checklist at the end.",
  remediation_plan:            "Include: Executive Summary, Current State Assessment, Critical Findings, Remediation Steps by Domain (Priority 1/2/3), Implementation Timeline, Success Metrics, Risk Mitigation",
  deployment_plan:             "Include: Deployment Overview, Pre-deployment Checklist, Environment Readiness, Phased Rollout Plan, Rollback Procedure, Testing & Validation, Go-live Criteria, Post-deployment Support",
  governance_framework:        "Include: Governance Principles, Roles & Responsibilities Matrix, Policy Framework, Compliance Requirements, Enforcement Mechanisms, Review Cadence, Exception Process",
  security_hardening_plan:     "Include: Threat Assessment, Identity & Access Hardening, Conditional Access Policy Design, Privileged Access Workstations, Defender Configuration, Security Monitoring, Incident Response",
  copilot_enablement_plan:     "Include: Readiness Assessment, License & Entitlement Review, Data Governance Pre-work, Pilot Group Selection, Training Plan, Success Metrics, Rollout Phases, Adoption Strategy",
  identity_modernization_plan: "Include: Current Identity State, Entra ID Configuration, MFA Enforcement, Privileged Identity Management, External Identities, B2B/B2C Strategy, Migration Roadmap, Legacy System Decommission",
};

// ── Tier 02 Pricing Formula (verbatim — embedded into every SOW prompt) ───────

const TIER_02_PRICING_FORMULA = `You are pricing Microsoft 365 remediation projects for Shane McCaw Consulting. These are NOT assessments — they are project-based engagements where real problems are fixed.

STEP 1 — DETECT TENANT TIER (use ONLY "Total Users in Tenant" from the TENANT FACTS block — never infer from any other field):
  Tier01: 1–50 users
  Tier02: 51–250 users
  Tier03: 251–750 users
  Tier04: 751+ users

STEP 2 — BASE CEILINGS (select the row matching the detected tier):
  Workstream        | Tier01   | Tier02   | Tier03   | Tier04
  Governance        | $10,000  | $25,000  | $30,000  | $35,000
  Security          | $10,000  | $28,000  | $35,000  | $42,000
  Copilot           |  $8,000  | $30,000  | $35,000  | $42,000
  Info Architecture | $12,000  | $25,000  | $30,000  | $42,000
  License Optim.    |  $4,000  |  $8,000  | $12,000  | $15,000

  Include only the workstreams relevant to this engagement.
  Workstream Total = sum of all included workstream Base Ceilings.

STEP 3 — ADJUSTMENTS (flat per-tier amounts — apply each adjustment if the findings support it; if a category does not apply, add $0 and explain why):
  Adjustment        | Tier01  | Tier02   | Tier03   | Tier04
  Complexity        | $5,000  | $15,000  | $25,000  | $35,000
  Data Sprawl       | $5,000  | $10,000  | $20,000  | $25,000
  Security/Compli.  | $5,000  | $10,000  | $20,000  | $25,000
  Copilot Readiness | $5,000  | $10,000  | $20,000  | $25,000

  Criteria for applying each adjustment:
  - Complexity: apply if the findings show multiple critical gaps or ≥ 3 remediation domains.
  - Data Sprawl: apply if DLP policies = 0, sensitivity labels unconfigured, or ≥ 50 SharePoint sites with no governance.
  - Security/Compliance: apply if MFA not enforced, Conditional Access = 0, or industry compliance risk identified.
  - Copilot Readiness: apply ONLY when Copilot-related workstreams are in scope; base on Copilot score and blocker count.
  Adjustment Total = sum of all applicable adjustments at the tier-correct dollar amount.

STEP 4 — TOTALS:
  Engagement Total = Workstream Total + Adjustment Total.

Always show the detected tier, always show each step's arithmetic, never leave pricing blank, never say TBD.

Output requirements for the Pricing section:
- Show a per-workstream pricing table with columns: Project/Workstream | Base Ceiling | Final Price (USD) | Reasoning. Do NOT add per-row adjustment columns.
- After the per-workstream table, render a SECOND HTML <table> for Pricing Adjustments. This table MUST use proper <table><thead><tbody> elements — NOT divs or CSS classes. Header row: Adjustment Factor | Amount (USD) | Reasoning. One body row per applicable adjustment. A final body row titled "Adjustments Subtotal" showing the sum.
- After both tables, show the Grand Total calculation as plain text: Grand Total = $[workstream subtotal] (workstreams) + $[adjustments subtotal] (adjustments) = $[grand total].
- Always explain the reasoning for each tier and each adjustment applied.
- Never invent new pricing models. Never use TBD.
- Your goal is to produce a firm, defensible, enterprise-grade project price.`;

// ── Prompt fallbacks (no "Staged for Review" banner — docs are auto-delivered) ─

const REPORT_PROMPT_FALLBACK = `You are Shane McCaw, a senior Microsoft 365 Architect. Generate a professional, client-facing {{docLabel}} in HTML format.

Client: {{clientName}}{{projectLine}}
Document title: {{title}}
Report date: {{date}}

M365 Environment Health Scores:
{{scores}}

Key Findings ({{findingsCount}} total):
{{findings}}

Key Recommendations ({{recommendationsCount}} total):
{{recommendations}}

Configuration Telemetry Sample (from profileUpdates):
{{profileSample}}

Script analysis runs: {{runCount}} completed assessments

INSTRUCTIONS:
- Output ONLY valid HTML (no markdown, no code fences)
- Use inline CSS for styling — white background, #0078D4 accent (Microsoft Azure Blue), professional enterprise typography
- Structure: header with "Shane McCaw Consulting" + report metadata, executive overview table with the score cards, findings section with a data table, recommendations section, configuration status summary (use profileUpdates data), next steps, footer with Shane's name
- Write in first person as Shane McCaw with professional consulting tone
- Be specific and actionable — reference actual findings, not generic advice
- Total length: 800-1500 words of body content`;

const CONSULTING_PROMPT_FALLBACK = `You are Shane McCaw, a senior Microsoft 365 Architect with 30 years of experience. Generate a professional consulting {{typeLabel}} in HTML format.

Client: {{clientName}}
{{projectDesc}}Document title: {{title}}
Date: {{date}}

M365 Health Scores:
{{scores}}

Key Findings: {{findings}}
Key Recommendations: {{recommendations}}

Configuration Telemetry:
{{profileSample}}

{{priorDocsSummary}}Document Structure Requirements:
{{sectionHints}}

INSTRUCTIONS:
- Output ONLY valid HTML (no markdown, no code fences)
- Use inline CSS: white background, #0078D4 accent, professional enterprise typography
- Write in first person as Shane McCaw with expert consulting tone
- Be specific and actionable — reference client's actual environment data
- Include a professional header ("Shane McCaw Consulting") and footer
- Total length: 1000-2000 words`;

const TASK_EXECUTION_GUIDE_PROMPT = `You are Shane McCaw, a senior Microsoft 365 Architect with 30 years of experience. Generate a professional SOW Task Execution Guide in HTML format.

Client: {{clientName}}
{{projectDesc}}Document title: {{title}}
Date: {{date}}

M365 Environment Health Scores (current):
{{scores}}

PROJECT TASK LIST (these are the SOW work items — use these as the source of truth):
{{taskList}}

Key Findings from assessments: {{findings}}

{{priorDocsSummary}}INSTRUCTIONS:
- Output ONLY valid HTML (no markdown, no code fences)
- Use inline CSS: white background, #0078D4 accent (#0A2540 for headers), professional enterprise typography; use alternating row shading on any tables
- Structure the document as follows:
  1. Professional header: "Shane McCaw Consulting" + document title + client name + date
  2. Introduction: one paragraph explaining the purpose of this guide and the M365 environment context (reference the actual scores)
  3. For EACH task in the PROJECT TASK LIST above, produce a clearly formatted section:
     - Task name as a styled heading
     - Purpose: one sentence — why this task matters for this client
     - Prerequisites: what must be true / already done before starting
     - Step-by-step instructions: numbered list, technically specific for Microsoft 365 Admin Center / Entra ID / PowerShell / SharePoint — use the actual Microsoft UI paths and cmdlet names where relevant
     - Expected outcome: what success looks like
     - How to validate: a specific check (UI screenshot, PowerShell command, or report) that confirms completion
     - Common pitfalls: 1-3 things that commonly go wrong and how to avoid them
  4. Group task sections by their phase/group label exactly as provided in the task list
  5. Completion Checklist: a simple HTML checkbox-style table listing every task title for sign-off
  6. Footer: Shane McCaw's name, title, and the date
- Write in first person as Shane McCaw
- Be technically precise — this is an engineer's execution guide, not a marketing document
- Do NOT invent tasks not in the list; do NOT skip any tasks in the list
- Total length: produce complete content for every task — do not truncate`;


// ── Utilities ──────────────────────────────────────────────────────────────────

function substituteTokens(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (t, [k, v]) => t.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v),
    template,
  );
}

// ── M365 health score fetch — reads clientHealthHistoryTable (same source as CRM portal) ─

interface RealScores {
  security: number;
  compliance: number;
  copilot: number;
  governance: number;
  productivity: number;
  /** Average of all five dimensions */
  composite: number;
  /** Whether any scores were actually found in the database */
  hasData: boolean;
}

async function fetchRealScores(clientUserId: number): Promise<RealScores> {
  const rows = await db
    .select({
      category:   clientHealthHistoryTable.category,
      score:      clientHealthHistoryTable.score,
    })
    .from(clientHealthHistoryTable)
    .where(eq(clientHealthHistoryTable.clientId, clientUserId))
    .orderBy(desc(clientHealthHistoryTable.recordedAt))
    .limit(50);

  if (rows.length === 0) {
    return { security: 0, compliance: 0, copilot: 0, governance: 0, productivity: 0, composite: 0, hasData: false };
  }

  // Keep only the most-recent entry per category (rows already DESC by date)
  const latest: Record<string, number> = {};
  for (const row of rows) {
    if (!(row.category in latest)) latest[row.category] = row.score;
  }

  const security    = latest["security"]    ?? 0;
  const compliance  = latest["compliance"]  ?? 0;
  const copilot     = latest["copilot"]     ?? 0;
  const governance  = latest["governance"]  ?? 0;
  const productivity = latest["productivity"] ?? 0;

  const vals = [security, compliance, copilot, governance, productivity];
  const composite = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);

  return { security, compliance, copilot, governance, productivity, composite, hasData: true };
}

function formatScoresBlock(s: RealScores): string {
  if (!s.hasData) {
    return "No M365 health scores on record yet — assessment runs are pending.";
  }
  return [
    `- Security Posture:      ${s.security}/100`,
    `- Compliance Coverage:   ${s.compliance}/100`,
    `- Copilot Readiness:     ${s.copilot}/100`,
    `- Governance Maturity:   ${s.governance}/100`,
    `- Adoption Score:        ${s.productivity}/100`,
    `- Composite (avg):       ${s.composite}/100`,
  ].join("\n");
}

function collectFindings(runs: { parsedFindings: string[]; recommendations: string[] }[]): {
  findings: string[]; recommendations: string[];
} {
  const findings = new Set<string>();
  const recommendations = new Set<string>();
  for (const run of runs) {
    for (const f of run.parsedFindings ?? []) findings.add(f);
    for (const r of run.recommendations ?? []) recommendations.add(r);
  }
  return { findings: [...findings].slice(0, 50), recommendations: [...recommendations].slice(0, 50) };
}

// ── Fetch the project's own Kanban tasks (SOW work items) ─────────────────────

async function fetchProjectTasks(projectId: number) {
  const rows = await db
    .select({
      title:       kanbanTasksTable.title,
      description: kanbanTasksTable.description,
      groupName:   kanbanTasksTable.groupName,
      taskType:    kanbanTasksTable.taskType,
      column:      kanbanTasksTable.column,
      order:       kanbanTasksTable.order,
    })
    .from(kanbanTasksTable)
    .where(eq(kanbanTasksTable.projectId, projectId))
    .orderBy(kanbanTasksTable.order);
  return rows;
}

function formatTaskList(tasks: Awaited<ReturnType<typeof fetchProjectTasks>>): string {
  if (tasks.length === 0) return "No tasks found for this project.";

  // Group by groupName (phase), preserving order
  const groups = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const g = t.groupName ?? "General";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(t);
  }

  const lines: string[] = [];
  for (const [group, items] of groups) {
    lines.push(`\n### ${group}`);
    for (const t of items) {
      lines.push(`- **${t.title}**${t.description ? `: ${t.description}` : ""}${t.taskType ? ` [${t.taskType}]` : ""}`);
    }
  }
  return lines.join("\n");
}

// ── Fetch completed script runs — all runs for this customer, no kanban filter ─

async function fetchRunsForClient(clientUserId: number, limit: number) {
  return db.select({
    scoreImpact:     scriptRunResultsTable.scoreImpact,
    parsedFindings:  scriptRunResultsTable.parsedFindings,
    recommendations: scriptRunResultsTable.recommendations,
    profileUpdates:  scriptRunResultsTable.profileUpdates,
  })
    .from(scriptRunResultsTable)
    .where(and(
      eq(scriptRunResultsTable.status, "completed"),
      eq(scriptRunResultsTable.customerId, clientUserId),
    ))
    .orderBy(desc(scriptRunResultsTable.createdAt))
    .limit(limit);
}

// ── Fetch engagement projects for SOW pricing ──────────────────────────────────

async function fetchEngagementProjects() {
  return db.select({
    title:       engagementProjectsTable.title,
    priceRange:  engagementProjectsTable.priceRange,
    description: engagementProjectsTable.description,
    sowItems:    engagementProjectsTable.sowItems,
  })
    .from(engagementProjectsTable)
    .where(eq(engagementProjectsTable.isVisible, true))
    .orderBy(engagementProjectsTable.sortOrder);
}

function formatEngagementProjectsBlock(projects: Awaited<ReturnType<typeof fetchEngagementProjects>>): string {
  if (projects.length === 0) return "No engagement project pricing configured.";
  return projects.map(p =>
    `• ${p.title} — ${p.priceRange}${p.description ? `\n  ${p.description}` : ""}${p.sowItems?.length ? `\n  Deliverables: ${(p.sowItems as string[]).join(", ")}` : ""}`
  ).join("\n\n");
}

// ── Fetch prior documents for same customer+project (for context injection) ────

async function fetchPriorDocuments(clientUserId: number, projectId: number, excludeDocType: string): Promise<string> {
  const docs = await db.select({
    title:       insightsGeneratedDocumentsTable.title,
    docType:     insightsGeneratedDocumentsTable.docType,
    htmlContent: insightsGeneratedDocumentsTable.htmlContent,
  })
    .from(insightsGeneratedDocumentsTable)
    .where(and(
      eq(insightsGeneratedDocumentsTable.customerId, clientUserId),
      eq(insightsGeneratedDocumentsTable.projectId, projectId),
      ne(insightsGeneratedDocumentsTable.docType, excludeDocType),
    ))
    .orderBy(desc(insightsGeneratedDocumentsTable.createdAt));

  if (docs.length === 0) return "";

  const stripHtml = (html: string) =>
    html.replace(/<[^>]+>/g, " ").replace(/\s{2,}/g, " ").trim().slice(0, 400);

  const summaries = docs.map(d =>
    `[${d.title} (${d.docType})]: ${stripHtml(d.htmlContent)}`
  ).join("\n\n");

  return `PRIOR DOCUMENTS FOR THIS CLIENT (your output must be consistent with these findings and must not contradict these prior conclusions):\n${summaries}\n\n`;
}

// ── Upsert helper — one document per (customerId, projectId, docType) ─────────

async function upsertDocument(
  customerId: number,
  projectId: number,
  values: {
    category: "report" | "consulting";
    docType: string;
    title: string;
    htmlContent: string;
    status: "draft" | "approved" | "delivered" | "archived";
    deliveredAt: Date | null;
    approvedAt?: Date | null;
    pdfUrl: string | null;
    sowPricingLines: Array<{ title: string; scope: string; priceUsd: number; notes: string }> | null;
    sowTotalPrice: string | null;
  },
): Promise<{ id: number }> {
  const existing = await db.select({ id: insightsGeneratedDocumentsTable.id })
    .from(insightsGeneratedDocumentsTable)
    .where(and(
      eq(insightsGeneratedDocumentsTable.customerId, customerId),
      eq(insightsGeneratedDocumentsTable.projectId, projectId),
      eq(insightsGeneratedDocumentsTable.docType, values.docType),
    ))
    .limit(1);

  if (existing[0]) {
    const [updated] = await db.update(insightsGeneratedDocumentsTable)
      .set({
        title:           values.title,
        htmlContent:     values.htmlContent,
        status:          values.status,
        deliveredAt:     values.deliveredAt ?? undefined,
        pdfUrl:          values.pdfUrl,
        sowPricingLines: values.sowPricingLines,
        sowTotalPrice:   values.sowTotalPrice,
        updatedAt:       new Date(),
      })
      .where(eq(insightsGeneratedDocumentsTable.id, existing[0].id))
      .returning({ id: insightsGeneratedDocumentsTable.id });
    return updated!;
  }

  const [inserted] = await db.insert(insightsGeneratedDocumentsTable).values({
    customerId,
    projectId,
    category:        values.category,
    docType:         values.docType,
    title:           values.title,
    htmlContent:     values.htmlContent,
    status:          values.status,
    deliveredAt:     values.deliveredAt ?? undefined,
    approvedAt:      values.approvedAt ?? undefined,
    pdfUrl:          values.pdfUrl,
    sowPricingLines: values.sowPricingLines,
    sowTotalPrice:   values.sowTotalPrice,
  }).returning({ id: insightsGeneratedDocumentsTable.id });
  return inserted!;
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function generateAndDeliverDocument(
  clientUserId: number,
  projectId: number,
  config: DocumentGenerationConfig,
): Promise<GenerateAndDeliverResult> {
  const { category, docType, title } = config;
  const isSowDoc = docType === "sow" || docType === "consolidated_sow";

  const [userRows, projectRows, runs, realScores, projectTasks] = await Promise.all([
    db.select({ name: usersTable.name, company: usersTable.company })
      .from(usersTable)
      .where(eq(usersTable.id, clientUserId))
      .limit(1),
    db.select({ title: projectsTable.title, phase: projectsTable.phase, description: projectsTable.description })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1),
    fetchRunsForClient(clientUserId, 50),
    fetchRealScores(clientUserId),
    fetchProjectTasks(projectId),
  ]);

  const clientName = userRows[0]?.company ?? userRows[0]?.name ?? "Client";
  const projRow = projectRows[0];
  const projectLine = projRow ? ` · Project: ${projRow.title}` : "";
  const projectDesc = projRow
    ? `Project: ${projRow.title}${projRow.phase ? ` (${projRow.phase})` : ""}${projRow.description ? ` — ${projRow.description}` : ""}\n`
    : "";

  const { findings, recommendations } = collectFindings(runs as { parsedFindings: string[]; recommendations: string[] }[]);

  const scoresBlock = formatScoresBlock(realScores);

  // Merge all profileUpdates across runs into one object — most-recent run wins
  // for duplicate keys. We no longer cap at 5 entries per run because critical
  // metrics like totalUserCount and sharepointSiteCount often appear later in
  // the JSON object and were silently dropped, causing the AI to hallucinate.
  const mergedProfile: Record<string, unknown> = {};
  for (const run of [...(runs as { profileUpdates: Record<string, unknown> }[])].reverse()) {
    Object.assign(mergedProfile, run.profileUpdates ?? {});
  }
  const profileSample = Object.entries(mergedProfile).length > 0
    ? Object.entries(mergedProfile).map(([k, v]) => `  ${k}: ${String(v)}`).join("\n")
    : "  No telemetry captured yet.";

  const date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  let prompt: string;

  if (category === "report") {
    const docLabel = REPORT_DOC_TYPE_LABELS[docType] ?? docType;
    const findingsBlock = findings.slice(0, 15).map((f, i) => `${i + 1}. ${f}`).join("\n") || "No findings recorded yet — assessment runs pending.";
    const recommendationsBlock = recommendations.slice(0, 10).map((r, i) => `${i + 1}. ${r}`).join("\n") || "No recommendations recorded yet.";

    const rawTemplate = await getPrompt(`insights-report-${docType}`, REPORT_PROMPT_FALLBACK);
    prompt = substituteTokens(rawTemplate, {
      docLabel,
      clientName,
      projectLine,
      title,
      date,
      scores: scoresBlock,
      findingsCount: String(findings.length),
      findings: findingsBlock,
      recommendationsCount: String(recommendations.length),
      recommendations: recommendationsBlock,
      profileSample,
      runCount: String(runs.length),
    });
  } else if (docType === "task_execution_guide") {
    const taskList = formatTaskList(projectTasks);
    const findingsInline = findings.slice(0, 10).join("; ") || "Pending assessment runs";
    const priorDocsSummary = await fetchPriorDocuments(clientUserId, projectId, docType);
    const rawTemplate = await getPrompt("insights-consulting-task_execution_guide", TASK_EXECUTION_GUIDE_PROMPT);
    prompt = substituteTokens(rawTemplate, {
      clientName,
      projectDesc,
      title,
      date,
      scores: scoresBlock,
      taskList,
      findings: findingsInline,
      priorDocsSummary,
    });
  } else {
    const typeLabel = CONSULTING_TYPE_LABELS[docType] ?? docType;
    const findingsInline = findings.slice(0, 10).join("; ") || "Pending assessment runs";
    const recommendationsInline = recommendations.slice(0, 8).join("; ") || "Pending assessment runs";
    const sectionHints = CONSULTING_SECTION_HINTS[docType] ?? "Include relevant sections for this type of consulting deliverable";

    const priorDocsSummary = await fetchPriorDocuments(clientUserId, projectId, docType);

    // For SOW types, fetch engagement projects and embed Tier 02 pricing formula
    let pricingAppendix = "";
    if (isSowDoc) {
      const engagementProjects = await fetchEngagementProjects();
      const engagementProjectsBlock = formatEngagementProjectsBlock(engagementProjects);

      // Build a structured TENANT FACTS block from the merged profile so the AI
      // has exact numbers for every pricing adjustment. This prevents hallucination
      // of tenant size, site counts, and data sprawl metrics.
      const p = mergedProfile as Record<string, unknown>;
      const tenantFacts = [
        `Total Users in Tenant:      ${p.totalUserCount ?? "unknown"}`,
        `Licensed Users:             ${p.licensedUserCount ?? "unknown"}`,
        `Unlicensed Users:           ${typeof p.totalUserCount === "number" && typeof p.licensedUserCount === "number" ? p.totalUserCount - p.licensedUserCount : "unknown"}`,
        `Active User Percent:        ${p.activeUserPercent ?? "unknown"}%`,
        `SharePoint Sites:           ${p.sharepointSiteCount ?? "unknown"}`,
        `Microsoft 365 Groups:       ${p.m365GroupCount ?? "unknown"}`,
        `Teams Count:                ${p.teamCount ?? p.teamsCount ?? "unknown"}`,
        `Public Teams:               ${p.teamsPublicCount ?? "unknown"}`,
        `Guest Users:                ${p.guestUserCount ?? "unknown"}`,
        `External Sharing Enabled:   ${p.externalSharingEnabled ?? "unknown"}`,
        `External Shares Found:      ${p.externalUserSharesFound ?? "unknown"}`,
        `DLP Policies:               ${p.dlpPoliciesCount ?? (p.hasDLP === false ? 0 : "unknown")}`,
        `Sensitivity Labels:         ${p.sensitivityLabelsConfigured === false ? "None configured" : (p.sensitivityLabelsConfigured ?? "unknown")}`,
        `Retention Policies:         ${p.hasRetentionPolicies === false ? "None" : (p.hasRetentionPolicies ?? "unknown")}`,
        `Conditional Access Policies: ${p.conditionalAccessPolicyCount ?? p.conditionalAccessPoliciesCount ?? (p.conditionalAccessEnabled === false ? 0 : "unknown")}`,
        `Copilot Licenses:           ${p.copilotLicenseCount ?? (p.hasCopilotLicenses === false ? 0 : "unknown")}`,
        `Copilot Readiness Score:    ${p.copilotReadinessScore ?? "unknown"}/100`,
        `Intune Enabled:             ${p.intuneEnabled ?? "unknown"}`,
        `MFA Enforced:               ${p.mfaEnforced ?? "unknown"}`,
        `SharePoint Sites Scanned:   ${p.sharePointSitesScanned ?? p.sharepointSiteCount ?? "unknown"}`,
      ].join("\n");

      pricingAppendix = `\n\nCRITICAL — TENANT FACTS (use ONLY these exact numbers for all pricing adjustments; do NOT invent, estimate, or extrapolate any values not listed here):\n${tenantFacts}\n\nENGAGEMENT PROJECTS CATALOGUE (use these as Base Ceiling starting points):\n${engagementProjectsBlock}\n\nPRICING FORMULA:\n${TIER_02_PRICING_FORMULA}`;
    }

    const consultingFallback = substituteTokens(CONSULTING_PROMPT_FALLBACK, { sectionHints });
    const rawTemplate = await getPrompt(`insights-consulting-${docType}`, consultingFallback);
    prompt = substituteTokens(rawTemplate, {
      typeLabel,
      clientName,
      projectDesc,
      title,
      date,
      scores: scoresBlock,
      findings: findingsInline,
      recommendations: recommendationsInline,
      profileSample,
      sectionHints,
      priorDocsSummary,
    });
    if (pricingAppendix) prompt += pricingAppendix;
  }

  // SOW documents are significantly longer than other doc types — use a higher
  // token budget so pricing tables and closing sections are never cut off.
  const docStylePrefix = await getDocumentStylePrefix();
  const aiResponse = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: isSowDoc ? 16000 : 8000,
    messages: [{ role: "user", content: docStylePrefix + prompt }],
  });

  if (aiResponse.stop_reason === "max_tokens") {
    logger.warn(
      { clientUserId, projectId, docType, outputLen: (aiResponse.content[0] as { text: string }).text?.length },
      "document-generator: output hit max_tokens — document may be truncated. Consider raising max_tokens or shortening prompt.",
    );
  }

  let htmlContent = extractAiHtml(aiResponse);
  // Strip any "Staged for Review" banner that may have leaked in from a prompt template
  htmlContent = htmlContent.replace(
    /<div[^>]*>⚠️\s*<strong>Staged for Review<\/strong>[\s\S]*?<\/div>/gi,
    "",
  );

  const { lines: sowLines, totalPrice: sowTotal } = isSowDoc ? parseSowPricing(htmlContent) : { lines: [], totalPrice: 0 };

  const doc = await upsertDocument(clientUserId, projectId, {
    category,
    docType,
    title,
    htmlContent,
    status:          "delivered",
    deliveredAt:     new Date(),
    pdfUrl:          null,
    sowPricingLines: sowLines.length > 0 ? sowLines : null,
    sowTotalPrice:   sowTotal > 0 ? String(sowTotal) : null,
  });

  // When a SOW is auto-generated and delivered, promote client to Opportunities pipeline
  if (isSowDoc) void ensureOpportunityForSow(clientUserId, doc.id);

  const pdfUrl = `/api/admin/insights/documents/${doc.id}/download`;
  await db.update(insightsGeneratedDocumentsTable)
    .set({ pdfUrl })
    .where(eq(insightsGeneratedDocumentsTable.id, doc.id));

  logger.info(
    { clientUserId, projectId, documentId: doc.id, category, docType },
    "document-generator: document generated and auto-delivered",
  );

  return { documentId: doc.id, title };
}
