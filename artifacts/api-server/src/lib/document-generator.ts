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
  clientScoresTable,
  clientHealthHistoryTable,
} from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { logger } from "./logger";
import { getPrompt } from "./prompt-loader";
import { stripMarkdownFence, parseSowPricing } from "./sow-pricing";

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
  sow:                         "Include: Scope of Work, Objectives, Deliverables, Timeline (phased), Resource Requirements, Pricing (use [TBD] placeholders), Acceptance Criteria, Terms & Conditions",
  task_execution_guide:        "Use the project task list below as your source. For EACH task produce: Task name (h3), Purpose (one sentence), Prerequisites, Step-by-step instructions (numbered, technically specific for Microsoft 365), Expected outcome, Validation check, Common pitfalls. Group tasks by their workflow phase/group. Add an intro section and a completion checklist at the end.",
  remediation_plan:            "Include: Executive Summary, Current State Assessment, Critical Findings, Remediation Steps by Domain (Priority 1/2/3), Implementation Timeline, Success Metrics, Risk Mitigation",
  deployment_plan:             "Include: Deployment Overview, Pre-deployment Checklist, Environment Readiness, Phased Rollout Plan, Rollback Procedure, Testing & Validation, Go-live Criteria, Post-deployment Support",
  governance_framework:        "Include: Governance Principles, Roles & Responsibilities Matrix, Policy Framework, Compliance Requirements, Enforcement Mechanisms, Review Cadence, Exception Process",
  security_hardening_plan:     "Include: Threat Assessment, Identity & Access Hardening, Conditional Access Policy Design, Privileged Access Workstations, Defender Configuration, Security Monitoring, Incident Response",
  copilot_enablement_plan:     "Include: Readiness Assessment, License & Entitlement Review, Data Governance Pre-work, Pilot Group Selection, Training Plan, Success Metrics, Rollout Phases, Adoption Strategy",
  identity_modernization_plan: "Include: Current Identity State, Entra ID Configuration, MFA Enforcement, Privileged Identity Management, External Identities, B2B/B2C Strategy, Migration Roadmap, Legacy System Decommission",
};

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
- Structure: header with "Shane McCaw Consulting" + report metadata, executive overview table with the 4 score cards, findings section with a data table, recommendations section, configuration status summary (use profileUpdates data), next steps, footer with Shane's name
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

Document Structure Requirements:
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

INSTRUCTIONS:
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

// ── Real M365 score fetch — reads stored clientScoresTable + clientHealthHistoryTable ─

interface RealScores {
  identity: number;
  security: number;
  collaboration: number;
  compliance: number;
  copilotReadiness: number;
  /** Average of all five dimensions */
  composite: number;
  /** Whether any scores were actually found in the database */
  hasData: boolean;
  /** Recent per-category snapshots for trend context */
  recentHistory: { category: string; score: number; recordedAt: Date }[];
}

async function fetchRealScores(clientUserId: number): Promise<RealScores> {
  const [scoreRow, historyRows] = await Promise.all([
    db
      .select({
        identity:         clientScoresTable.identity,
        security:         clientScoresTable.security,
        collaboration:    clientScoresTable.collaboration,
        compliance:       clientScoresTable.compliance,
        copilotReadiness: clientScoresTable.copilotReadiness,
        updatedAt:        clientScoresTable.updatedAt,
      })
      .from(clientScoresTable)
      .where(eq(clientScoresTable.clientId, clientUserId))
      .limit(1),
    db
      .select({
        category:   clientHealthHistoryTable.category,
        score:      clientHealthHistoryTable.score,
        recordedAt: clientHealthHistoryTable.recordedAt,
      })
      .from(clientHealthHistoryTable)
      .where(eq(clientHealthHistoryTable.clientId, clientUserId))
      .orderBy(desc(clientHealthHistoryTable.recordedAt))
      .limit(40),
  ]);

  const row = scoreRow[0];
  if (!row) {
    return {
      identity: 0, security: 0, collaboration: 0, compliance: 0, copilotReadiness: 0,
      composite: 0, hasData: false, recentHistory: [],
    };
  }

  const vals = [row.identity, row.security, row.collaboration, row.compliance, row.copilotReadiness];
  const composite = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);

  return {
    identity:         row.identity,
    security:         row.security,
    collaboration:    row.collaboration,
    compliance:       row.compliance,
    copilotReadiness: row.copilotReadiness,
    composite,
    hasData: true,
    recentHistory: historyRows,
  };
}

function formatScoresBlock(s: RealScores): string {
  if (!s.hasData) {
    return "No M365 health scores on record yet — assessment runs are pending.";
  }
  const lines = [
    `- Identity & Access:    ${s.identity}/100`,
    `- Security:             ${s.security}/100`,
    `- Collaboration:        ${s.collaboration}/100`,
    `- Compliance:           ${s.compliance}/100`,
    `- Copilot Readiness:    ${s.copilotReadiness}/100`,
    `- Composite (avg):      ${s.composite}/100`,
  ];
  if (s.recentHistory.length > 0) {
    // Show most recent score per category as a trend snapshot
    const seen = new Set<string>();
    const trend = s.recentHistory
      .filter(h => { if (seen.has(h.category)) return false; seen.add(h.category); return true; })
      .map(h => `  ${h.category}: ${h.score}/100 (${new Date(h.recordedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })})`);
    if (trend.length > 0) lines.push("", "Recent snapshot per category:", ...trend);
  }
  return lines.join("\n");
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

async function fetchRunsForClient(clientUserId: number, projectId: number, limit: number) {
  const taskRows = await db
    .select({ id: kanbanTasksTable.id })
    .from(kanbanTasksTable)
    .where(eq(kanbanTasksTable.projectId, projectId));
  const taskIds = taskRows.map(t => t.id);

  const conditions = [
    eq(scriptRunResultsTable.status, "completed"),
    eq(scriptRunResultsTable.customerId, clientUserId),
  ] as Parameters<typeof and>[0][];

  if (taskIds.length > 0) {
    conditions.push(inArray(scriptRunResultsTable.kanbanTaskId, taskIds));
  }

  return db.select({
    scoreImpact:    scriptRunResultsTable.scoreImpact,
    parsedFindings: scriptRunResultsTable.parsedFindings,
    recommendations: scriptRunResultsTable.recommendations,
    profileUpdates: scriptRunResultsTable.profileUpdates,
  })
    .from(scriptRunResultsTable)
    .where(and(...conditions))
    .orderBy(desc(scriptRunResultsTable.createdAt))
    .limit(limit);
}

// ── Main export ────────────────────────────────────────────────────────────────

export async function generateAndDeliverDocument(
  clientUserId: number,
  projectId: number,
  config: DocumentGenerationConfig,
): Promise<GenerateAndDeliverResult> {
  const { category, docType, title } = config;

  const [userRows, projectRows, runs, realScores, projectTasks] = await Promise.all([
    db.select({ name: usersTable.name, company: usersTable.company })
      .from(usersTable)
      .where(eq(usersTable.id, clientUserId))
      .limit(1),
    db.select({ title: projectsTable.title, phase: projectsTable.phase, description: projectsTable.description })
      .from(projectsTable)
      .where(eq(projectsTable.id, projectId))
      .limit(1),
    fetchRunsForClient(clientUserId, projectId, 50),
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

  const profileSample = (runs as { profileUpdates: Record<string, unknown> }[])
    .flatMap(r => Object.entries(r.profileUpdates ?? {}).slice(0, 5))
    .slice(0, 30)
    .map(([k, v]) => `  ${k}: ${String(v)}`)
    .join("\n") || "  No telemetry captured yet.";

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
    const rawTemplate = await getPrompt("insights-consulting-task_execution_guide", TASK_EXECUTION_GUIDE_PROMPT);
    prompt = substituteTokens(rawTemplate, {
      clientName,
      projectDesc,
      title,
      date,
      scores: scoresBlock,
      taskList,
      findings: findingsInline,
    });
  } else {
    const typeLabel = CONSULTING_TYPE_LABELS[docType] ?? docType;
    const findingsInline = findings.slice(0, 10).join("; ") || "Pending assessment runs";
    const recommendationsInline = recommendations.slice(0, 8).join("; ") || "Pending assessment runs";
    const sectionHints = CONSULTING_SECTION_HINTS[docType] ?? "Include relevant sections for this type of consulting deliverable";

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
    });
  }

  const aiResponse = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt }],
  });

  if (aiResponse.stop_reason === "max_tokens") {
    logger.warn(
      { clientUserId, projectId, docType, outputLen: (aiResponse.content[0] as { text: string }).text?.length },
      "document-generator: output hit max_tokens — document may be truncated. Consider raising max_tokens or shortening prompt.",
    );
  }

  let htmlContent = (aiResponse.content[0] as { text: string }).text ?? "";
  // Strip markdown code fences Claude sometimes wraps around HTML output
  htmlContent = stripMarkdownFence(htmlContent);
  // Strip any "Staged for Review" banner that may have leaked in from a prompt template
  htmlContent = htmlContent.replace(
    /<div[^>]*>⚠️\s*<strong>Staged for Review<\/strong>[\s\S]*?<\/div>/gi,
    "",
  );

  const isSowDoc = docType === "sow" || docType === "consolidated_sow";
  const { lines: sowLines, totalPrice: sowTotal } = isSowDoc ? parseSowPricing(htmlContent) : { lines: [], totalPrice: 0 };

  const [newDoc] = await db.insert(insightsGeneratedDocumentsTable).values({
    customerId:  clientUserId,
    projectId,
    category,
    docType,
    title,
    htmlContent,
    status:      "delivered",
    deliveredAt: new Date(),
    pdfUrl:      null,
    sowPricingLines: sowLines.length > 0 ? sowLines : null,
    sowTotalPrice:   sowTotal > 0 ? String(sowTotal) : null,
  }).returning();

  if (!newDoc) throw new Error("document-generator: insert returned no row");

  const pdfUrl = `/api/admin/insights/documents/${newDoc.id}/download`;
  await db.update(insightsGeneratedDocumentsTable)
    .set({ pdfUrl })
    .where(eq(insightsGeneratedDocumentsTable.id, newDoc.id));

  logger.info(
    { clientUserId, projectId, documentId: newDoc.id, category, docType },
    "document-generator: document generated and auto-delivered",
  );

  return { documentId: newDoc.id, title };
}
