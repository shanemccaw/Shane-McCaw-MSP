/**
 * workflow-executor.ts
 *
 * In-process workflow executor. Uses an edge-based BFS traversal that
 * correctly handles converging branches: a node only executes once all
 * predecessors have "resolved" (ran or were skipped), and only skips when
 * EVERY resolved predecessor was itself skipped.
 *
 * Algorithm:
 *   resolvedCount[node] — how many predecessor edges have been resolved
 *   activeCount[node]   — how many of those were from executed (non-skipped) nodes
 *   Ready when resolvedCount == inDegree.
 *   Skip when ready and activeCount == 0.
 */

import { db, pool } from "@workspace/db";
import {
  wfRunsTable,
  wfVersionsTable,
  wfDefinitionsTable,
  wfRunNodeLogsTable,
  wfRunNodeOutputsTable,
  wfTriggersTable,
  pendingApprovalsTable,
  leadsTable,
  usersTable,
  projectsTable,
  opportunitiesTable,
  clientDocumentsTable,
  leadQualificationsTable,
  quizLeadsTable,
  clientHealthHistoryTable,
  emailTemplatesTable,
  marketingTasksTable,
  kanbanTasksTable,
  articlesTable,
  notificationsTable,
  campaignsTable,
  campaignAssetsTable,
  offersTable,
  landingPagesTable,
  clientPresentationsTable,
  scriptRunResultsTable,
  insightsGeneratedDocumentsTable,
  clientM365ProfilesTable,
  deviceTokensTable,
  workflowStepsTable,
  quickWinPresentationsTable,
  type WfGraph,
  type WfNode,
} from "@workspace/db";

import { createRunbookJob, isAzureConfigured } from "./azure-automation";
import { fetchNewsHeadlines, DEFAULT_NEWS_PROMPT, CAMPAIGN_BRIEF_PROMPT } from "./news-fetcher.js";
import { sendWebPushToAdmins } from "./web-push";
import { sendPushNotifications } from "./push";
import { broadcastAdminWorkflowEvent, broadcastPresentationPhaseGenProgress, broadcastPresentationPhaseGenComplete, broadcastPresentationPhaseGenError, broadcastPresentationDocsChange } from "./sse-broadcast";
import { generateConsolidatedSowDocument, broadcastSowChangeForProject, broadcastDocsChangeForProject } from "./consolidated-sow-generator";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { openai } from "@workspace/integrations-openai-ai-server/image";
import { eq, and, count, desc, inArray } from "drizzle-orm";
import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import { logger } from "./logger";
import { handleSystemAction } from "./system-action-handlers";
import Ajv from "ajv";
import { getPrompt, getDocumentStylePrefix } from "./prompt-loader";
import { persistSowPricing } from "./sow-pricing-persist.js";

// ── Insights document generation helpers ─────────────────────────────────────
// Mirrors the same helpers in routes/admin-insights.ts so the generate_document
// workflow node produces identical output to clicking Generate in the UI.

const REPORT_DOC_TYPE_LABELS: Record<string, string> = {
  executive_summary:           "Executive Summary",
  full_readiness_report:       "Full Readiness Report",
  security_posture_report:     "Security Posture Report",
  governance_maturity_report:  "Governance Maturity Report",
  data_exposure_risk_report:   "Data Exposure Risk Report",
  license_optimization_report: "License Optimization Report",
};

const CONSULTING_TYPE_LABELS: Record<string, string> = {
  consolidated_sow:            "Consolidated Statement of Work",
  sow:                         "Statement of Work",
  remediation_plan:            "Remediation Plan",
  deployment_plan:             "Deployment Plan",
  governance_framework:        "Governance Framework",
  security_hardening_plan:     "Security Hardening Plan",
  copilot_enablement_plan:     "Copilot Enablement Plan",
  identity_modernization_plan: "Identity Modernization Plan",
  copilot_readiness:           "Copilot Readiness Assessment",
};

const CONSULTING_SECTION_HINTS: Record<string, string> = {
  sow:                         "Include: Scope of Work, Objectives, Deliverables, Timeline (phased), Resource Requirements, Acceptance Criteria (each criterion on its own line as <div style='margin:6px 0'>&#9744; criterion</div>), Terms & Conditions",
  consolidated_sow:            "Include: Scope of Work, Objectives, Deliverables, Timeline (phased), Resource Requirements, Acceptance Criteria (each criterion on its own line as <div style='margin:6px 0'>&#9744; criterion</div>), Terms & Conditions",
  remediation_plan:            "Include: Executive Summary, Current State Assessment, Critical Findings, Remediation Steps by Domain (Priority 1/2/3), Implementation Timeline, Success Metrics, Risk Mitigation",
  deployment_plan:             "Include: Deployment Overview, Pre-deployment Checklist, Environment Readiness, Phased Rollout Plan, Rollback Procedure, Testing & Validation, Go-live Criteria, Post-deployment Support",
  governance_framework:        "Include: Governance Principles, Roles & Responsibilities Matrix, Policy Framework, Compliance Requirements, Enforcement Mechanisms, Review Cadence, Exception Process",
  security_hardening_plan:     "Include: Threat Assessment, Identity & Access Hardening, Conditional Access Policy Design, Defender Configuration, Security Monitoring, Incident Response",
  copilot_enablement_plan:     "Include: Readiness Assessment, License & Entitlement Review, Data Governance Pre-work, Pilot Group Selection, Training Plan, Success Metrics, Rollout Phases, Adoption Strategy",
  identity_modernization_plan: "Include: Current Identity State, Entra ID Configuration, MFA Enforcement, Privileged Identity Management, External Identities, Migration Roadmap, Legacy System Decommission",
  copilot_readiness:           "Include: Executive Readiness Summary, Identity & MFA Posture, Licensing & Entitlement Gaps, Data Governance Readiness, Security Score vs Copilot Minimum Bar, Blockers & Remediation Recommendations, Overall Readiness Rating (Red / Amber / Green)",
};

const TASK_EXECUTION_GUIDE_WF_PROMPT = `You are Shane McCaw, a senior Microsoft 365 Architect with 30 years of experience. Generate a professional SOW Task Execution Guide in HTML format.

Client: {{clientName}}
Document title: {{title}}
Date: {{date}}

SOW / SCOPE DOCUMENT (the ONLY source of truth — derive all tasks, phases, and deliverables exclusively from this document):
{{sowHtml}}

INSTRUCTIONS:
- For EACH deliverable or work item in the SOW above, produce a clearly formatted section:
    - Task name as a styled heading
    - Purpose: one sentence — why this task matters for this client
    - Prerequisites: what must already be done before starting
    - Step-by-step instructions: numbered list, technically specific for Microsoft 365 Admin Center / Entra ID / PowerShell / SharePoint — use actual UI paths and cmdlet names
    - Expected outcome: what success looks like
    - How to validate: a specific check (UI screenshot, PowerShell command, or report) that confirms completion
    - Common pitfalls: 1-3 things that commonly go wrong and how to avoid them
- Group task sections by their phase/section from the SOW
- Add an intro section and a completion checklist at the end
- Output ONLY valid HTML (no markdown, no code fences)
- Use inline CSS — white background, #0078D4 accent (#0A2540 for headers), professional enterprise typography
- Write in first person as Shane McCaw
- Be technically precise — this is an engineer's execution guide, not a marketing document
- Total length: produce complete content for every task — do not truncate`;

const INSIGHTS_CONSULTING_PROMPT_FALLBACK = `You are Shane McCaw, a senior Microsoft 365 Architect with 30 years of experience. Generate a professional consulting {{typeLabel}} in HTML format.

Client: {{clientName}}{{projectLine}}
Document title: {{title}}
Date: {{date}}

M365 Environment Health Scores:
{{scores}}

Key Findings: {{findings}}
Key Recommendations: {{recommendations}}

Configuration Telemetry Sample:
{{profileSample}}

{{priorDocsSummary}}Section Requirements:
{{sectionHints}}

INSTRUCTIONS:
- Output ONLY valid HTML (no markdown, no code fences)
- Use inline CSS — white background, #0078D4 accent (Microsoft Azure Blue), professional enterprise typography
- Professional consulting tone as Shane McCaw, first person where appropriate
- Be specific and actionable — reference actual findings, not generic advice
- Total length: 800-1500 words of body content`;

const INSIGHTS_REPORT_PROMPT_FALLBACK = `You are Shane McCaw, a senior Microsoft 365 Architect. Generate a professional, client-facing {{docLabel}} in HTML format.

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

function igSubstituteTokens(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (t, [k, v]) => t.replace(new RegExp(`\\{\\{${k}\\}\\}`, "g"), v),
    template,
  );
}

function igComputeScoresFromRuns(runs: { scoreImpact: Record<string, number> }[]) {
  const sums: Record<string, number> = {};
  const cnts: Record<string, number> = {};
  for (const run of runs) {
    for (const [k, v] of Object.entries(run.scoreImpact ?? {})) {
      sums[k] = (sums[k] ?? 0) + v;
      cnts[k] = (cnts[k] ?? 0) + 1;
    }
  }
  const avg = (key: string, fallback = 0): number =>
    cnts[key] ? Math.min(100, Math.max(0, Math.round(sums[key]! / cnts[key]!))) : fallback;
  const security    = avg("security",    avg("Security",    60));
  const compliance  = avg("compliance",  avg("Compliance",  60));
  const copilot     = avg("copilotReadiness", avg("copilot_readiness", avg("CopilotReadiness", avg("copilot", 50))));
  const governance  = avg("governance",  avg("Governance",  55));
  const productivity = avg("productivity", avg("Productivity", 55));
  return { security, compliance, copilot, governance, productivity, composite: Math.round((security + compliance + copilot + governance + productivity) / 5) };
}

async function igFetchClientHealthScores(customerId: number) {
  const rows = await db.select({ category: clientHealthHistoryTable.category, score: clientHealthHistoryTable.score })
    .from(clientHealthHistoryTable)
    .where(eq(clientHealthHistoryTable.clientId, customerId))
    .orderBy(desc(clientHealthHistoryTable.recordedAt));
  if (rows.length === 0) return null;
  const latest: Record<string, number> = {};
  for (const row of rows) { if (!(row.category in latest)) latest[row.category] = row.score; }
  const sec = latest["security"] ?? 0, com = latest["compliance"] ?? 0, cop = latest["copilot"] ?? 0;
  const gov = latest["governance"] ?? 0, pro = latest["productivity"] ?? 0;
  if (!sec && !com && !cop && !gov && !pro) return null;
  const total = [sec, com, cop, gov, pro].filter(v => v > 0);
  return { security: sec, compliance: com, copilot: cop, governance: gov, productivity: pro,
    composite: total.length ? Math.round(total.reduce((a, b) => a + b, 0) / total.length) : 0 };
}

async function igFetchRuns(customerId: number, limit = 50) {
  return db.select({
    scoreImpact: scriptRunResultsTable.scoreImpact,
    parsedFindings: scriptRunResultsTable.parsedFindings,
    recommendations: scriptRunResultsTable.recommendations,
    profileUpdates: scriptRunResultsTable.profileUpdates,
  }).from(scriptRunResultsTable)
    .where(and(eq(scriptRunResultsTable.status, "completed"), eq(scriptRunResultsTable.customerId, customerId)))
    .orderBy(desc(scriptRunResultsTable.createdAt))
    .limit(limit);
}

function igCollectFindings(runs: { parsedFindings: string[] | null; recommendations: string[] | null }[]) {
  const findings = new Set<string>();
  const recs = new Set<string>();
  for (const run of runs) {
    for (const f of run.parsedFindings ?? []) findings.add(f);
    for (const r of run.recommendations ?? []) recs.add(r);
  }
  return { findings: [...findings].slice(0, 50), recommendations: [...recs].slice(0, 50) };
}

function igExtractHtml(aiText: string): string {
  // Strip markdown code fences if the model wrapped the HTML
  const fenceMatch = aiText.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();
  const start = aiText.indexOf("<");
  if (start !== -1) return aiText.slice(start).trim();
  return aiText.trim();
}

// ── Generated images directory ────────────────────────────────────────────────
const UPLOADS_BASE = process.env.UPLOADS_DIR
  ? path.resolve(process.env.UPLOADS_DIR)
  : path.resolve("../../data/uploads");

const GENERATED_IMAGES_DIR = path.join(UPLOADS_BASE, "generated-images");

// Ensure directory exists at module load (sync is fine — happens once on boot)
import fsSync from "fs";
fsSync.mkdirSync(GENERATED_IMAGES_DIR, { recursive: true });

// Size map for gpt-image-1 (only three sizes are supported)
const ASPECT_RATIO_SIZE: Record<string, "1024x1024" | "1536x1024" | "1024x1536"> = {
  "square":    "1024x1024",
  "landscape": "1536x1024",
  "portrait":  "1024x1536",
  "wide":      "1536x1024",
};

// Captured once when the module is first loaded. Used by fireStartupTriggers
// to detect runs created in the current boot session vs. orphaned runs from a
// previous boot — so a crash-interrupted startup trigger re-fires on the next
// restart instead of being silently skipped.
const BOOT_TIME = new Date();

// ── Payload interpolation ────────────────────────────────────────────────────
// Replaces {{key}} and {{payload.key}} tokens with values from payload.
function interp(template: string | undefined, payload: Record<string, unknown>): string | undefined {
  if (!template) return undefined;
  // [\w.\-]+ — word chars, dots, and hyphens, so node IDs like "node-106" resolve correctly
  return template.replace(/\{\{([\w.\-]+)\}\}/g, (_match, path: string) => {
    const key = path.startsWith("payload.") ? path.slice(8) : path;
    const parts = key.split(".");
    let cur: unknown = payload;
    for (const part of parts) {
      if (cur == null || typeof cur !== "object") return "";
      cur = (cur as Record<string, unknown>)[part];
    }
    if (cur == null) return "";
    if (typeof cur === "object") {
      // Arrays and objects: emit compact JSON so downstream templates see
      // valid data instead of the useless "[object Object]" coercion
      try { return JSON.stringify(cur); } catch { return String(cur); }
    }
    return String(cur);
  });
}

function interpOrNull(template: string | undefined, payload: Record<string, unknown>): string | null {
  const result = interp(template, payload);
  return result?.trim() ? result : null;
}

// ── Content helpers ───────────────────────────────────────────────────────────

/** Extract the first JSON object from an AI response that may contain prose. */
function extractJsonFromAiText(text: string): Record<string, unknown> | null {
  // Try code-fenced JSON first
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) {
    try { return JSON.parse(fenceMatch[1].trim()) as Record<string, unknown>; } catch { /* fall through */ }
  }
  // Brace-delimited fallback
  const start = text.indexOf("{");
  const end   = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>; } catch { /* fall through */ }
  }
  return null;
}

/** Convert a string to URL-safe kebab-case, max 80 chars. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

/** Absolute path to the consulting site articles directory.
 *
 *  Path derivation (verified at module load below):
 *    import.meta.url  → file:///…/artifacts/api-server/dist/index.mjs  (single bundle)
 *    path.dirname(…)  → …/artifacts/api-server/dist
 *    resolve + "../../…" → …/artifacts/shane-mccaw-consulting/src/content/articles
 *
 *  Two parent steps from dist/ reach artifacts/, NOT api-server root.
 *  Using import.meta.url is deterministic regardless of process.cwd(). */
const ARTICLES_DIR = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../../shane-mccaw-consulting/src/content/articles",
);

// Log resolved path at startup — useful for debugging and code-review verification.
logger.info({ articlesDir: ARTICLES_DIR }, "workflow-executor: content articles directory resolved");

// ── Safe condition evaluator ─────────────────────────────────────────────────
// NO eval/new Function. Supports: path op literal (==,!=,>,<,>=,<=,contains),
// boolean truthy path, && and || logical operators.

function evalCondition(expression: string, payload: Record<string, unknown>): boolean {
  function resolvePath(p: string): unknown {
    const parts = p.trim().split(".");
    let cur: unknown = payload;
    for (const part of parts) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
  }

  function parseValue(s: string): unknown {
    const t = s.trim();
    if (t === "true") return true;
    if (t === "false") return false;
    if (t === "null") return null;
    if (t === "undefined") return undefined;
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    if (/^["'].*["']$/.test(t)) return t.slice(1, -1);
    return resolvePath(t);
  }

  function evalClause(clause: string): boolean {
    const c = clause.trim();
    for (const op of [">=", "<=", "!=", "==", ">", "<", " contains "]) {
      const idx = c.indexOf(op);
      if (idx !== -1) {
        const lhs = resolvePath(c.slice(0, idx).trim());
        const rhs = parseValue(c.slice(idx + op.length));
        switch (op.trim()) {
          case "==": return lhs == rhs; // eslint-disable-line eqeqeq
          case "!=": return lhs != rhs; // eslint-disable-line eqeqeq
          case ">":  return Number(lhs) > Number(rhs);
          case "<":  return Number(lhs) < Number(rhs);
          case ">=": return Number(lhs) >= Number(rhs);
          case "<=": return Number(lhs) <= Number(rhs);
          case "contains": return String(lhs).includes(String(rhs));
        }
      }
    }
    return Boolean(resolvePath(c));
  }

  try {
    const orParts = expression.split(" || ");
    for (const orPart of orParts) {
      const andParts = orPart.split(" && ");
      if (andParts.every(p => evalClause(p))) return true;
    }
    return false;
  } catch {
    return false;
  }
}

// ── Dry-run synthetic outputs ─────────────────────────────────────────────────
// Returns a realistic-looking output for every DB-touching node type without
// actually reading or writing the database.  Keys match real node outputs so
// downstream condition expressions still evaluate correctly.

function makeDryRunOutput(node: WfNode, payload: Record<string, unknown>): Record<string, unknown> {
  const p = payload;
  const num = (key: string) => {
    const v = interp(`{{${key}}}`, p);
    const n = v ? parseInt(v, 10) : NaN;
    return isNaN(n) ? 1 : n;
  };
  const str = (key: string, fallback: string) => interp(`{{${key}}}`, p) ?? String(p[key] ?? fallback);

  switch (node.type) {
    case "delay":
      return { dryRun: true, mode: (node.data.mode ?? "fixed") as string, skipped: true };

    case "action": {
      const at = node.data.actionType as string | undefined;
      if (at === "cancel_workflow")      return { dryRun: true, cancelled: false, note: "cancel skipped in dry run" };
      if (at === "http_request")         return { dryRun: true, status: 200, ok: true };
      if (at === "create_lead")          return { dryRun: true, leadId: 1, leadEmail: str("email", "test@example.com"), leadName: str("name", "Test Lead") };
      if (at === "convert_to_opportunity") return { dryRun: true, opportunityId: 1, leadId: num("leadId") };
      if (at === "create_client")        return { dryRun: true, clientId: 1, clientEmail: str("email", "test@example.com") };
      if (at === "create_project")       return { dryRun: true, projectId: 1, projectTitle: str("title", "Test Project") };
      if (at === "execute_runbook" || at === "update_m365_profile")
        return { dryRun: true, jobId: "dry-run-job", jobStatus: "Queued", runbookName: node.data.runbookName ?? "runbook" };
      if (at === "generate_document")    return { dryRun: true, documentId: 1, docType: node.data.docType ?? "report", name: str("docTitle", "Dry-run document") };
      if (at === "calculate_pricing")    return { dryRun: true, documentId: num("documentId"), totalPrice: 0, lineCount: 0 };
      return { dryRun: true, actionType: at ?? "none", note: "dry run — action skipped" };
    }

    case "score_lead":
      return { dryRun: true, leadId: num("leadId"), score: 80, scoreLabel: "High", qualified: true };

    case "assign_pipeline_stage": {
      const dryTarget = (node.data.targetType as string | undefined) ?? "opportunity";
      return dryTarget === "lead"
        ? { dryRun: true, targetType: "lead",        leadId: num("leadId"),             stage: str("stage", "AQL") }
        : { dryRun: true, targetType: "opportunity",  opportunityId: num("opportunityId"), stage: str("stage", "Proposal") };
    }

    case "create_opportunity":
      return { dryRun: true, opportunityId: 1, leadId: num("leadId") };

    case "parse_quiz_results":
      return {
        dryRun: true, quizLeadId: num("quizLeadId"), totalScore: 72, tier: "Intermediate",
        recommendedService: "Microsoft 365 Assessment", leadName: "Test Lead",
        leadEmail: "test@example.com", company: "Contoso Ltd", categoryScores: {},
      };

    case "generate_readiness_score":
      return { dryRun: true, readinessScore: 72, readinessLabel: "Medium", recordId: null };

    case "attach_quiz_insights":
      return { dryRun: true, insightsAttached: true, documentId: 1 };

    case "validate_m365_permissions":
      return { dryRun: true, permissionsValid: true, missingCount: 0, jobId: "dry-run-job" };

    case "update_intelligence_tables":
      return { dryRun: true, updated: true, recordId: null, jobId: "dry-run-job" };

    case "generate_diff_report":
      return { dryRun: true, documentId: 1, changesFound: true, changeCount: 5 };

    case "notify_major_changes":
      return { dryRun: true, notified: false, skipped: true };

    case "play_sound": {
      const psTarget = (node.data.target as string | undefined) ?? "browser";
      const psSound  = (node.data.sound  as string | undefined) ?? "ping";
      logger.info({ psTarget, psSound }, "workflow-executor [dry-run]: play_sound would play");
      return { dryRun: true, soundPlayed: false, soundTarget: psTarget, skipped: true };
    }

    case "send_browser_notification": {
      const dryTitle   = interp(node.data.title    as string | undefined, payload) ?? "(no title)";
      const dryBody    = interp(node.data.body      as string | undefined, payload) ?? "";
      const dryLink    = interp(node.data.linkPath  as string | undefined, payload) ?? null;
      logger.info({ dryTitle, dryBody, dryLink }, "workflow-executor [dry-run]: send_browser_notification would send");
      return { dryRun: true, notificationSent: true, preview: { title: dryTitle, body: dryBody, linkPath: dryLink } };
    }

    case "create_notification": {
      const cnTitle = interp(node.data.title as string | undefined, payload) ?? "(no title)";
      const cnBody  = interp(node.data.body  as string | undefined, payload) ?? "";
      const cnLink  = interp(node.data.linkPath as string | undefined, payload)?.trim() || null;
      const cnType  = (interp(node.data.type as string | undefined, payload) ?? "message") as string;
      logger.info({ cnTitle, cnBody, cnLink, cnType }, "workflow-executor [dry-run]: create_notification would insert");
      return { dryRun: true, notificationCount: 0, preview: { title: cnTitle, body: cnBody, linkPath: cnLink, type: cnType } };
    }

    case "send_mobile_push": {
      const dryMpTitle = interp(node.data.title as string | undefined, payload) ?? "(no title)";
      const dryMpBody  = interp(node.data.body  as string | undefined, payload) ?? "";
      logger.info({ dryMpTitle, dryMpBody }, "workflow-executor [dry-run]: send_mobile_push would send");
      return { dryRun: true, sent: true, sentCount: 0, preview: { title: dryMpTitle, body: dryMpBody } };
    }

    case "send_campaign_email":
      return {
        dryRun: true,
        sourceRef: node.data.assetId ? `asset:${node.data.assetId}` : `template:${str("templateSlug", "unknown-template")}`,
        templateSlug: str("templateSlug", ""),
        recipient: interp((node.data.recipientExpr as string | undefined) ?? "", p) || "recipient@example.com",
        subject: "(email subject — preview in live run)",
        sent: false,
      };

    case "create_kanban_task":
      return {
        dryRun: true,
        boardId: interp((node.data.boardId as string | undefined) ?? "marketing", p) || "marketing",
        columnId: str("columnId", "backlog"),
        title: interp((node.data.titleExpr as string | undefined) ?? "New task", p) || "New task",
        taskId: null,
      };

    case "get_phases":
      return {
        dryRun: true,
        phases: [{ id: "uuid-dry-1", title: "Phase 1", description: "Dry-run phase", price: 1000, subtasks: ["Task A", "Task B"], selected: true }],
        phaseCount: 1,
        presentationId: null,
      };

    case "create_phase":
      return {
        dryRun: true,
        phaseId: 0,
        phaseTitle: interp((node.data.title as string | undefined) ?? "Phase 1", p) || "Phase 1",
      };

    case "save_presentation_phases":
      return {
        dryRun: true,
        saved: true,
        phaseCount: 4,
        resolvedPhases: [],
      };

    case "generate_article":
      return {
        dryRun: true,
        articleTitle:    `Dry-run: ${str("topic", "M365 Best Practices Overview")}`,
        articleSlug:     `dry-run-preview-${Date.now().toString(36)}`,
        articleCategory: str("category", "M365 Best Practices"),
        articleSummary:  "Dry-run preview — no AI call made and no article written.",
        articleDate:     new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
        articleContent:  "## Preview\n\nThis is a dry-run — content generation was skipped.",
      };

    case "publish_article":
      return { dryRun: true, published: true, slug: "dry-run-preview-article", articleId: 0, title: str("titleExpr", "Dry-run Article") };

    case "topic_picker":
      return {
        dryRun: true,
        articleTopic: `Dry-run topic: ${str("focusArea", "Microsoft 365 governance best practices")}`,
        topicCategory: str("category", "M365 Best Practices"),
      };

    case "create_marketing_campaign":
      return { dryRun: true, campaignId: 1, campaignName: str("nameExpr", "Dry-run Campaign"), campaignStatus: "draft" };

    case "publish_landing_page":
      return { dryRun: true, landingPageId: 1, slug: str("slugExpr", "dry-run-page"), published: false };

    case "generate_landing_page":
      return {
        dryRun: true,
        landingPageId: null,
        slug: "dry-run-landing-page",
        headline: "(AI-generated headline — preview in live run)",
        subheadline: "(AI-generated subheadline)",
        published: false,
      };

    case "edit_stripe_invoice":
      return { dryRun: true, invoiceId: "dry-run-inv-id", status: "draft", dueDate: new Date().toISOString() };

    case "compose": {
      const dryResolved = interp(node.data.inputs as string | undefined, payload) ?? "";
      const dryRawValue = dryResolved || "<compose output>";
      if (node.data.parseAsJson && dryResolved) {
        try {
          const dryParsed = JSON.parse(dryResolved);
          const hasSchema = Boolean(node.data.jsonSchema && String(node.data.jsonSchema).trim());
          return { dryRun: true, value: dryParsed, ...(hasSchema ? { schemaValidation: "skipped in dry-run — will be applied on live runs" } : {}) };
        } catch {
          return { dryRun: true, value: dryRawValue };
        }
      }
      return { dryRun: true, value: dryRawValue };
    }

    case "system_action":
      return { dryRun: true, skipped: true, task: node.data.task ?? "unknown" };

    case "generate_image": {
      const giAspect = (node.data.aspectRatio as string | undefined) ?? "landscape";
      const giSize = ASPECT_RATIO_SIZE[giAspect] ?? "1536x1024";
      const giPlaceholderSize = giSize === "1024x1024" ? "1024x1024" : giSize === "1024x1536" ? "1024x1536" : "1536x1024";
      const [giW, giH] = giPlaceholderSize.split("x");
      return {
        dryRun: true,
        imageUrl: `https://placehold.co/${giW}x${giH}/0A2540/FFFFFF?text=Generated+Image`,
        revisedPrompt: "[dry-run — no AI call made]",
      };
    }

    case "fetch_news_headlines":
      return {
        dryRun: true,
        newsHeadlines: [
          { title: "Microsoft releases Copilot AI updates for Government clients", source: "Microsoft Blog", url: "https://blogs.microsoft.com", publishedAt: new Date().toISOString(), description: "New Copilot features targeting federal agencies and public sector compliance." },
          { title: "SharePoint Embedded GA: what it means for Power Platform developers", source: "Tech Community", url: "https://techcommunity.microsoft.com", publishedAt: new Date().toISOString(), description: "SharePoint Embedded reaches general availability, unlocking new embedding scenarios." },
        ],
        newsTopic: "Copilot AI for Government M365 rollout",
        newsContext: "Microsoft's latest Copilot update introduces FedRAMP-compliant AI features tailored for government agencies. For M365 architects supporting public sector clients, this creates an immediate opportunity to lead Copilot readiness assessments. Agencies that delay risk falling behind peers who move first on the AI adoption curve.",
        newsArticleSuggestion: "The federal government just got its own version of Microsoft Copilot — and if you're an IT leader in a public sector agency, the clock is ticking. In this post, Shane McCaw breaks down what the new FedRAMP-authorized Copilot features mean for your M365 environment, which compliance controls you need to review before rollout, and why the agencies that act in the next 90 days will have a significant productivity edge over those who wait.",
        hotScore: 74,
        isHot: true,
        targetSector: "Government",
        campaignBrief: {
          audience: "IT directors and M365 admins at federal and state government agencies (500+ employees)",
          hook: "Your agency's Copilot window is open — don't let compliance concerns keep you on the sideline",
          angles: [
            "LinkedIn post: '3 things every federal IT director needs to check before enabling Copilot AI'",
            "Email subject: 'Is your agency ready for FedRAMP Copilot? Free readiness checklist inside'",
            "Webinar title: 'Copilot for Government: Compliance-First Rollout Strategies with Shane McCaw'",
          ],
        },
        campaignId: null,
      };

    case "post_linkedin":
      return {
        dryRun: true,
        linkedinPostId: "dry-run-linkedin-post-id",
        linkedinPostUrl: "https://www.linkedin.com/feed/update/dry-run-linkedin-post-id",
        preview: interp(node.data.postBody as string | undefined, p) ?? "(no post body configured)",
        ...(node.data.imageUrl ? { imageUrl: interp(node.data.imageUrl as string | undefined, p) ?? "" } : {}),
      };

    case "post_twitter":
      return {
        dryRun: true,
        twitterTweetId: "dry-run-tweet-id",
        twitterTweetUrl: "https://twitter.com/i/web/status/dry-run-tweet-id",
        preview: interp(node.data.postBody as string | undefined, p) ?? "(no tweet text configured)",
        ...(node.data.imageUrl ? { imageUrl: interp(node.data.imageUrl as string | undefined, p) ?? "" } : {}),
      };

    case "post_facebook":
      return {
        dryRun: true,
        facebookPostId: "dry-run-facebook-post-id",
        facebookPostUrl: "https://www.facebook.com/dry-run/posts/facebook-post-id",
        preview: interp(node.data.postBody as string | undefined, p) ?? "(no post body configured)",
        ...(node.data.imageUrl ? { imageUrl: interp(node.data.imageUrl as string | undefined, p) ?? "" } : {}),
      };

    case "ask_for_input": {
      const fields = (node.data.fields as Array<{ variableName: string; label: string; type: string }> | undefined) ?? [];
      const out: Record<string, unknown> = { dryRun: true };
      for (const f of fields) {
        out[f.variableName] = f.type === "number" ? 0 : `sample-${f.variableName}`;
      }
      return out;
    }

    case "switch_case": {
      const dsCases = (node.data.cases as Array<{ id: string; matchValue: string; label: string }> | undefined) ?? [];
      const firstCase = dsCases[0];
      const chosenBranch = firstCase ? (firstCase.label || firstCase.matchValue || "case-1") : "default";
      return {
        dryRun: true,
        switchValue: interp(node.data.switchExpr as string | undefined, payload) ?? "",
        chosenBranch,
        matchedCaseId: firstCase?.id ?? null,
      };
    }

    case "foreach": {
      const dryAlias = (node.data.itemAlias as string | undefined)?.trim() || "item";
      const dryItem1 = { dryRunElement: 1 };
      const dryItem2 = { dryRunElement: 2 };
      return {
        dryRun: true,
        foreachItems: [dryItem1, dryItem2],
        item: dryItem1,
        [dryAlias]: dryItem1,
        itemIndex: 0,
        itemsTotal: 2,
        arrayPath: (node.data.arrayPath as string | undefined) ?? "",
        collectedResults: [{ dryRun: true, element: 1 }, { dryRun: true, element: 2 }],
      };
    }

    case "check_exchange_calendar_availability":
      return {
        dryRun: true,
        isBusy: false,
        availableSlots: ["2025-01-01T09:00:00Z / 2025-01-01T10:00:00Z"],
        busySlots: [],
      };

    case "create_exchange_calendar_event":
      return {
        dryRun: true,
        eventId: "dry-run-event-id",
        eventUrl: "https://outlook.office.com/calendar/item/dry-run",
        eventWebLink: "https://outlook.office.com/calendar/item/dry-run",
      };

    case "generate_pdf":
      return {
        dryRun: true,
        pdfBase64: "dry-run-base64==",
        pdfDataUri: "data:application/pdf;base64,dry-run-base64==",
        fileName: (node.data.fileName as string | undefined) ?? "document.pdf",
      };

    case "save_to_sharepoint":
      return {
        dryRun: true,
        sharePointItemId: "dry-run-item-id",
        sharePointWebUrl: "https://contoso.sharepoint.com/dry-run",
        sharePointDownloadUrl: "https://contoso.sharepoint.com/dry-run/download",
      };

    case "get_from_sharepoint":
      return {
        dryRun: true,
        fileContentBase64: "dry-run-base64==",
        fileName: "document.pdf",
        mimeType: "application/pdf",
        sharePointWebUrl: "https://contoso.sharepoint.com/dry-run",
      };

    case "generate_invoice_stripe_payment":
      return {
        dryRun: true,
        invoiceId: "dry-run-inv-id",
        invoiceUrl: "https://invoice.stripe.com/dry-run",
        invoicePdfUrl: "https://invoice.stripe.com/dry-run/pdf",
        amountDue: 99900,
        currency: "usd",
      };

    case "generate_stripe_payment_link":
      return {
        dryRun: true,
        paymentLinkId: "dry-run-pl-id",
        paymentLinkUrl: "https://buy.stripe.com/dry-run",
      };

    case "create_phased_invoices":
      return {
        dryRun: true,
        invoiceIds: ["dry-run-inv-1", "dry-run-inv-2"],
        phaseCount: 2,
        totalScheduled: 80000,
      };

    case "charge_stripe_invoice":
      return {
        dryRun: true,
        chargeStatus: "succeeded",
        amountCharged: 40000,
        stripePaymentIntentId: "dry-run-pi-id",
      };

    case "build_presentation":
      return {
        dryRun: true,
        presentationHtml: "<html><body><h1>Dry Run Proposal</h1><p>This is a dry-run — no data was saved.</p></body></html>",
        presentationUrl: "https://example.com/api/presentations/dry-run-id",
        presentationId: "dry-run-pres-id",
      };

    case "find_object": {
      const foType = (node.data.objectType as string | undefined) ?? "lead";
      if (foType === "stripe_invoice") {
        return { dryRun: true, found: true, objectId: "dry-run-inv-id", objectType: "stripe_invoice", stripeInvoiceId: "dry-run-inv-id", status: "draft", dueDate: new Date().toISOString(), amountDue: 50000, customerId: "cus_dry_run" };
      }
      if (foType === "insights_document") {
        return {
          dryRun:          true,
          found:           true,
          objectType:      "insights_document",
          objectId:        1,
          documentId:      1,
          title:           "Dry-run: M365 Readiness Assessment",
          category:        "report",
          docType:         "full_readiness_report",
          status:          "delivered",
          htmlContent:     "<h1>Dry-run Insights Document</h1><p>This is synthetic content returned during a dry run.</p>",
          pdfUrl:          null,
          sowPricingLines: [{ title: "Phase 1 — Discovery", scope: "Initial assessment and planning", priceUsd: 12500, notes: "", line_type: "workstream", weeks: 2 }],
          sowTotalPrice:   "12500.00",
          approvedAt:      null,
          deliveredAt:     new Date().toISOString(),
          customerId:      1,
          projectId:       1,
        };
      }
      return { dryRun: true, found: true, objectType: foType, objectId: 1 };
    }

    default:
      return { dryRun: true, error: true, reason: `unknown node type: ${node.type}` };
  }
}

// ── OAuth 1.0a helper ─────────────────────────────────────────────────────────

/**
 * Build an OAuth 1.0a Authorization header using HMAC-SHA1.
 * Pass bodyParams only for application/x-www-form-urlencoded requests whose
 * body fields must be included in the signature base string; omit for JSON
 * or multipart/form-data requests.
 */
async function buildOAuth1Header(
  method: string,
  url: string,
  apiKey: string,
  apiSecret: string,
  accessToken: string,
  accessSecret: string,
  bodyParams: Record<string, string> = {},
): Promise<string> {
  const { createHmac } = await import("crypto");
  const enc = (s: string) => encodeURIComponent(s);
  const nonce = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const ts = Math.floor(Date.now() / 1000).toString();

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: ts,
    oauth_token: accessToken,
    oauth_version: "1.0",
  };

  const allParams: Record<string, string> = { ...oauthParams, ...bodyParams };
  const paramStr = Object.entries(allParams)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${enc(k)}=${enc(v)}`)
    .join("&");
  const sigBase = `${method}&${enc(url)}&${enc(paramStr)}`;
  const sigKey = `${enc(apiSecret)}&${enc(accessSecret)}`;

  const hmac = createHmac("sha1", sigKey);
  hmac.update(sigBase);
  const signature = hmac.digest("base64");

  return (
    "OAuth " +
    Object.entries({ ...oauthParams, oauth_signature: signature })
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${enc(k)}="${enc(v)}"`)
      .join(", ")
  );
}

// ── Promoted action sub-type aliases ─────────────────────────────────────────
// These are the 13 first-class node types that were promoted from the generic
// "action + actionType" pattern. They map 1-to-1 to the corresponding actionType
// handler in the action case. Normalizing here keeps all execution logic in one
// place and ensures backward compat: old workflows with type:"action" still work,
// and new workflows with type:"http_request" etc. are handled transparently.
const PROMOTED_ACTION_TYPES = new Set([
  "http_request", "sql_query", "send_email", "send_sms", "emit_event",
  "cancel_workflow", "create_lead", "convert_to_opportunity", "create_client",
  "create_project", "update_m365_profile", "execute_runbook", "generate_document",
  "calculate_pricing", "run_workflow",
]);

// ── Node execution ────────────────────────────────────────────────────────────

async function executeNode(
  node: WfNode,
  payload: Record<string, unknown>,
  runId: number,
  dryRun = false,
  inputValues: Record<string, string | string[]> = {},
  definitionId?: number,
): Promise<{
  output: Record<string, unknown>;
  nextPayload: Record<string, unknown>;
  cancelRun: boolean;
  nodeError: boolean;
  conditionResult?: boolean;
  /** For switch_case nodes: the handle ID of the chosen branch (a case UUID or "default") */
  switchChosenHandle?: string;
  /** Set to true when an approval_gate pauses the run — BFS should exit cleanly */
  pauseForApproval?: boolean;
}> {
  const startMs = Date.now();
  let output: Record<string, unknown> = {};
  let cancelRun = false;
  let nodeError = false;
  let conditionResult: boolean | undefined;
  let switchChosenHandle: string | undefined;

  // Write a "started" log immediately so the live run viewer can show which node
  // is currently executing — even during long-running operations (AI document
  // generation, runbooks, etc.) that may take 30–120 seconds.
  if (!dryRun) {
    await db.insert(wfRunNodeLogsTable).values({
      runId,
      nodeId: node.id,
      level: "info",
      message: `Node ${node.type} (${node.id}) started`,
      metadata: { started: true } as Record<string, unknown>,
    }).catch(() => { /* non-fatal */ });
  }

  // Structural nodes always execute normally; everything else is stubbed in dry-run.
  const STRUCTURAL_TYPES = new Set(["start", "end", "condition", "error", "switch_case", "report_progress"]);

  // Promoted type bridge: first-class node types alias to the action handler.
  // Inject data.actionType from node.type so the action case works unchanged.
  // Old workflows (type:"action" + data.actionType) are unaffected.
  if (PROMOTED_ACTION_TYPES.has(node.type)) {
    node = {
      ...node,
      type: "action",
      data: { ...node.data, actionType: node.data.actionType ?? node.type },
    } as WfNode;
  }

  try {
    if (dryRun && !STRUCTURAL_TYPES.has(node.type)) {
      output = makeDryRunOutput(node, payload);
    } else switch (node.type) {
      case "start":
        output = { started: true };
        break;

      case "end":
        output = { finished: true, label: node.data.label ?? "End" };
        break;

      case "action": {
        const actionType = node.data.actionType as string | undefined;
        if (actionType === "cancel_workflow") {
          cancelRun = true;
          output = { cancelled: true };
        } else if (actionType === "http_request") {
          const url = node.data.params?.url as string | undefined;
          if (url) {
            const resp = await fetch(url, {
              method: (node.data.params?.method as string | undefined) ?? "GET",
              headers: (node.data.params?.headers as Record<string, string> | undefined),
              body: node.data.params?.body ? JSON.stringify(node.data.params.body) : undefined,
            });
            output = { status: resp.status, ok: resp.ok };
            if (!resp.ok) {
              nodeError = true;
              output.errorDetail = `HTTP ${resp.status}`;
            }
          } else {
            output = { skipped: true, reason: "no url configured" };
          }
        } else if (actionType === "create_lead") {
          const name = interp(node.data.name as string | undefined, payload);
          const email = interp(node.data.email as string | undefined, payload);
          if (!name || !email) {
            nodeError = true;
            output = { error: "create_lead requires name and email" };
          } else {
            const [lead] = await db.insert(leadsTable).values({
              name,
              email: email.toLowerCase(),
              company: interpOrNull(node.data.company as string | undefined, payload),
              serviceArea: interpOrNull(node.data.serviceArea as string | undefined, payload),
              message: interpOrNull(node.data.message as string | undefined, payload),
              source: "contact_form",
              status: "new",
            }).returning();
            output = { leadId: lead.id, leadEmail: lead.email, leadName: lead.name };
          }
        } else if (actionType === "convert_to_opportunity") {
          const leadId = parseInt(interp(node.data.leadId as string | undefined, payload) ?? "", 10);
          if (isNaN(leadId)) {
            nodeError = true;
            output = { error: "convert_to_opportunity requires a valid leadId" };
          } else {
            const [opp] = await db.insert(opportunitiesTable).values({
              leadId,
              workflowType: (node.data.workflowType as string | undefined) ?? "DiscoveryCall",
            }).returning();
            output = { opportunityId: opp.id, leadId };
          }
        } else if (actionType === "create_client") {
          const name = interp(node.data.name as string | undefined, payload);
          const email = interp(node.data.email as string | undefined, payload);
          if (!email) {
            nodeError = true;
            output = { error: "create_client requires email" };
          } else {
            const [client] = await db.insert(usersTable).values({
              email: email.toLowerCase(),
              name: name ?? email,
              role: "client",
            }).returning();
            output = { clientId: client.id, clientEmail: client.email };
          }
        } else if (actionType === "create_project") {
          const title = interp(node.data.title as string | undefined, payload);
          if (!title) {
            nodeError = true;
            output = { error: "create_project requires title" };
          } else {
            const clientUserIdRaw = interp(node.data.clientUserId as string | undefined, payload);
            const clientUserId = clientUserIdRaw ? parseInt(clientUserIdRaw, 10) : null;
            const [project] = await db.insert(projectsTable).values({
              title,
              description: interpOrNull(node.data.description as string | undefined, payload),
              projectType: (node.data.projectType as "project" | "retainer" | "quick_win" | undefined) ?? "project",
              clientUserId: clientUserId && !isNaN(clientUserId) ? clientUserId : null,
              status: "active",
            }).returning();
            output = { projectId: project.id, projectTitle: project.title };
          }
        } else if (actionType === "execute_runbook" || actionType === "update_m365_profile") {
          const runbookName = interp(node.data.runbookName as string | undefined, payload);
          if (!runbookName) {
            nodeError = true;
            output = { error: "execute_runbook requires runbookName" };
          } else if (!isAzureConfigured()) {
            nodeError = true;
            output = { error: "Azure Automation is not configured — add the required secrets" };
          } else {
            let parameters: Record<string, string> = {};
            const rawParams = node.data.runbookParams as string | undefined;
            if (rawParams?.trim()) {
              try { parameters = JSON.parse(interp(rawParams, payload) ?? "{}") as Record<string, string>; }
              catch { /* ignore bad JSON — run with no params */ }
            }
            if (actionType === "update_m365_profile") {
              const clientId = interp(node.data.clientId as string | undefined, payload);
              if (clientId) parameters["ClientId"] = clientId;
            }
            const job = await createRunbookJob({ runbookName, parameters });
            output = { jobId: job.jobId, jobStatus: job.status, runbookName };
          }
        } else if (actionType === "generate_document") {
          // Mirrors POST /api/admin/insights/documents/generate exactly.
          // clientId and projectId are resolved from payload first, then from
          // node.data.customerId / node.data.projectId as fallbacks so the node
          // config panel can hard-code IDs when needed.
          const clientIdRaw  = interp(node.data.clientId as string | undefined, payload)
                            ?? interp(node.data.customerId as string | undefined, payload);
          const projectIdRaw = interp(node.data.projectId as string | undefined, payload);
          const clientUserId = clientIdRaw ? parseInt(clientIdRaw, 10) : NaN;
          const projectId    = projectIdRaw ? parseInt(projectIdRaw, 10) : NaN;

          if (isNaN(clientUserId)) {
            nodeError = true;
            output = { error: "generate_document requires a valid clientId" };
          } else {
            const docType     = (interp(node.data.docType as string | undefined, payload) ?? "executive_summary") as string;
            const docCategory = ((node.data.docCategory as string | undefined) ?? "report") === "consulting" ? "consulting" : "report";
            const docTitle    = interp(node.data.docTitle as string | undefined, payload)
              ?? (CONSULTING_TYPE_LABELS[docType] ?? REPORT_DOC_TYPE_LABELS[docType] ?? docType);

            // ── Consolidated SOW: delegate to the shared generator ───────────────
            // The generic consulting path below uses scores/findings and invents
            // phases from scratch. consolidated_sow MUST use the real engagement
            // projects catalogue from the DB, which the shared lib handles.
            let sowHandled = false;
            if (docType === "consolidated_sow" && docCategory === "consulting") {
              sowHandled = true;
              try {
                const rawPresId = payload.presentationId;
                const presId = typeof rawPresId === "number" ? rawPresId
                  : typeof rawPresId === "string" ? parseInt(rawPresId, 10) : NaN;
                const sowResult = await generateConsolidatedSowDocument({
                  clientUserId,
                  projectId: !isNaN(projectId) ? projectId : null,
                  title: docTitle,
                  runId: runId != null ? String(runId) : undefined,
                });
                if (!isNaN(presId)) {
                  broadcastPresentationDocsChange(presId);
                  logger.info({ runId, presId, docId: sowResult.docId }, "wf-executor: consolidated_sow broadcast docs_changed for presentation");
                }
                if (!isNaN(projectId)) {
                  void broadcastSowChangeForProject(projectId);
                  void broadcastDocsChangeForProject(projectId);
                }
                output = { documentId: sowResult.docId, docType, category: docCategory, title: docTitle, clientId: clientUserId };
              } catch (sowErr) {
                nodeError = true;
                output = { error: sowErr instanceof Error ? sowErr.message : String(sowErr) };
                logger.error({ runId, err: sowErr }, "wf-executor: consolidated_sow generation failed");
              }
            }

            if (!sowHandled) {
            // Fetch supporting data in parallel (common to both report and consulting paths)
            const [runs, customerRow, projectRow] = await Promise.all([
              igFetchRuns(clientUserId, 50),
              db.select({ name: usersTable.name, company: usersTable.company })
                .from(usersTable).where(eq(usersTable.id, clientUserId)).limit(1),
              !isNaN(projectId)
                ? db.select({ title: projectsTable.title }).from(projectsTable).where(eq(projectsTable.id, projectId)).limit(1)
                : Promise.resolve([] as { title: string }[]),
            ]);

            const healthScores = await igFetchClientHealthScores(clientUserId);
            const scores = healthScores ?? igComputeScoresFromRuns(runs as { scoreImpact: Record<string, number> }[]);
            const { findings, recommendations } = igCollectFindings(runs as { parsedFindings: string[] | null; recommendations: string[] | null }[]);

            const clientName  = customerRow[0]?.company ?? customerRow[0]?.name ?? "Client";
            const projectName = projectRow[0]?.title ?? "";
            const projectLine = projectName ? ` · Project: ${projectName}` : "";
            const dateStr     = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

            // Merge all profileUpdates into one object (most-recent run wins) so
            // critical metrics like totalUserCount and sharepointSiteCount are never
            // silently dropped by a per-run slice cap.
            const mergedWfProfile: Record<string, unknown> = {};
            for (const run of [...(runs as { profileUpdates: Record<string, unknown> | null }[])].reverse()) {
              Object.assign(mergedWfProfile, run.profileUpdates ?? {});
            }
            const profileSample = Object.entries(mergedWfProfile)
              .map(([k, v]) => `  ${k}: ${String(v)}`)
              .join("\n") || "  No telemetry captured yet.";

            const scoresBlock = `- Security: ${scores.security}/100\n- Compliance: ${scores.compliance}/100\n- Copilot: ${scores.copilot}/100\n- Governance: ${scores.governance}/100\n- Productivity: ${scores.productivity}/100\n- Composite: ${scores.composite}/100`;

            // Build the AI prompt — consulting and report use different templates and token shapes
            let prompt: string;
            if (docCategory === "consulting" && docType === "task_execution_guide") {
              // Resolve the SOW HTML: prefer sowDocumentId (look up from DB) over
              // inline sowHtml, so the builder only needs a document ID reference.
              let sowHtmlForDoc = interp(node.data.sowHtml as string | undefined, payload) ?? "";
              const sowDocumentIdRaw = interp(node.data.sowDocumentId as string | undefined, payload) ?? "";
              const sowDocumentId = sowDocumentIdRaw ? parseInt(sowDocumentIdRaw, 10) : NaN;
              if (!isNaN(sowDocumentId)) {
                const [sowDocRow] = await db
                  .select({ htmlContent: insightsGeneratedDocumentsTable.htmlContent })
                  .from(insightsGeneratedDocumentsTable)
                  .where(eq(insightsGeneratedDocumentsTable.id, sowDocumentId))
                  .limit(1);
                if (sowDocRow?.htmlContent) sowHtmlForDoc = sowDocRow.htmlContent;
              }

              // task_execution_guide uses ONLY the SOW HTML — no scores, findings, or telemetry.
              const rawTemplate = await getPrompt("insights-consulting-task_execution_guide", TASK_EXECUTION_GUIDE_WF_PROMPT, ["{{scores}}", "{{findings}}", "{{typeLabel}}", "{{sectionHints}}"]);
              prompt = igSubstituteTokens(rawTemplate, {
                clientName,
                title: docTitle,
                date: dateStr,
                sowHtml: sowHtmlForDoc || "(No SOW provided — generate based on available context)",
              });
            } else if (docCategory === "consulting") {
              const typeLabel    = CONSULTING_TYPE_LABELS[docType] ?? docType;
              const sectionHints = CONSULTING_SECTION_HINTS[docType] ?? "Include all relevant sections for this consulting deliverable";
              const findingsInline = findings.slice(0, 10).join("; ") || "Pending assessment runs";
              const recsInline     = recommendations.slice(0, 8).join("; ") || "Pending assessment runs";
              const rawTemplate = await getPrompt(`insights-consulting-${docType}`, INSIGHTS_CONSULTING_PROMPT_FALLBACK, ["{{sowHtml}}", "{{engagementStart}}", "{{existingDocs}}"]);
              prompt = igSubstituteTokens(rawTemplate, {
                typeLabel,
                clientName,
                projectLine,
                title: docTitle,
                date: dateStr,
                scores: scoresBlock,
                findings: findingsInline,
                recommendations: recsInline,
                profileSample: profileSample || "  No telemetry captured yet.",
                sectionHints,
                priorDocsSummary: "",
              });
            } else {
              const docLabel      = REPORT_DOC_TYPE_LABELS[docType] ?? docType;
              const findingsBlock = findings.slice(0, 15).map((f, i) => `${i + 1}. ${f}`).join("\n") || "No findings recorded yet.";
              const recsBlock     = recommendations.slice(0, 10).map((r, i) => `${i + 1}. ${r}`).join("\n") || "No recommendations recorded yet.";
              const rawTemplate   = await getPrompt(`insights-report-${docType}`, INSIGHTS_REPORT_PROMPT_FALLBACK, ["{{typeLabel}}", "{{sectionHints}}", "{{sowHtml}}"]);
              prompt = igSubstituteTokens(rawTemplate, {
                docLabel,
                clientName,
                projectLine,
                title: docTitle,
                date: dateStr,
                scores: scoresBlock,
                findingsCount: String(findings.length),
                findings: findingsBlock,
                recommendationsCount: String(recommendations.length),
                recommendations: recsBlock,
                profileSample: profileSample || "  No telemetry captured yet.",
                runCount: String(runs.length),
              });
            }

            // Find any prior completed doc for same customer+project+docType (to replace on success)
            let priorWfDocId: number | null = null;
            {
              const prior = await db.select({ id: insightsGeneratedDocumentsTable.id })
                .from(insightsGeneratedDocumentsTable)
                .where(and(
                  eq(insightsGeneratedDocumentsTable.customerId, clientUserId),
                  ...(!isNaN(projectId) ? [eq(insightsGeneratedDocumentsTable.projectId, projectId)] : []),
                  eq(insightsGeneratedDocumentsTable.docType, docType),
                  inArray(insightsGeneratedDocumentsTable.status, ["draft", "approved", "delivered", "archived"]),
                ))
                .limit(1);
              priorWfDocId = prior[0]?.id ?? null;
            }

            // Always INSERT a new generating row — fresh createdAt sorts to top; prior doc untouched until success
            const [genWfRow] = await db.insert(insightsGeneratedDocumentsTable).values({
              customerId: clientUserId,
              projectId: !isNaN(projectId) ? projectId : null,
              category: docCategory,
              docType,
              title: docTitle,
              htmlContent: "",
              status: "generating",
            }).returning({ id: insightsGeneratedDocumentsTable.id });
            const reportDocId = genWfRow!.id;

            let htmlContent: string;
            try {
              const docStylePrefix = await getDocumentStylePrefix();
              // Use streaming + finalMessage() for all doc generation.
              // task_execution_guide is a comprehensive step-by-step guide that can
              // easily exceed 8 k tokens, so we give it 16 k.  Other doc types keep
              // a 8 k ceiling but also benefit from streaming avoiding the hard
              // 10-min messages.create() timeout on slow completions.
              const docMaxTokens = docType === "task_execution_guide" ? 16384 : 8192;
              const stream = anthropic.messages.stream({
                model: "claude-haiku-4-5",
                max_tokens: docMaxTokens,
                messages: [{ role: "user", content: docStylePrefix + prompt }],
              });
              const aiResp = await stream.finalMessage();
              const rawText = aiResp.content.map(b => ("text" in b ? b.text : "")).join("");
              htmlContent = igExtractHtml(rawText);
            } catch (aiErr) {
              // Mark the placeholder as failed so the admin sees an error indicator instead of a vanished row
              const errMsg = aiErr instanceof Error ? aiErr.message : String(aiErr);
              await db.update(insightsGeneratedDocumentsTable)
                .set({ status: "failed", errorMessage: errMsg.slice(0, 500), updatedAt: new Date() })
                .where(eq(insightsGeneratedDocumentsTable.id, reportDocId));
              throw aiErr;
            }

            // Update generating row with finished content
            await db.update(insightsGeneratedDocumentsTable)
              .set({ title: docTitle, htmlContent, status: "approved", approvedAt: new Date(), updatedAt: new Date() })
              .where(eq(insightsGeneratedDocumentsTable.id, reportDocId));

            // For consolidated SOW documents, also write pricing lines so the
            // client's Scope & Pricing step shows correct prices immediately —
            // without requiring a separate calculate_pricing node or admin action.
            if (docType === "consolidated_sow") {
              try {
                await persistSowPricing(reportDocId, htmlContent);
              } catch (pricingErr) {
                logger.warn({ runId, reportDocId, err: pricingErr }, "wf-executor: generate_document — persistSowPricing failed (non-fatal)");
              }

              // Notify any open presentation SSE channels so the client's
              // SowGeneratingCard transitions to the document view immediately
              // rather than waiting for the next poll cycle.
              const rawPresId = payload.presentationId;
              const presId = typeof rawPresId === "number"
                ? rawPresId
                : typeof rawPresId === "string"
                ? parseInt(rawPresId, 10)
                : NaN;
              if (!isNaN(presId)) {
                broadcastPresentationDocsChange(presId);
                logger.info({ runId, presId, reportDocId }, "wf-executor: generate_document — broadcast docs_changed for presentation");
              }
            }

            // Remove superseded prior doc now that the new one is live
            if (priorWfDocId !== null) {
              await db.delete(insightsGeneratedDocumentsTable)
                .where(eq(insightsGeneratedDocumentsTable.id, priorWfDocId));
            }

            // Set the canonical PDF download URL
            await db.update(insightsGeneratedDocumentsTable)
              .set({ pdfUrl: `/api/admin/insights/documents/${reportDocId}/download` })
              .where(eq(insightsGeneratedDocumentsTable.id, reportDocId));

            logger.info({ runId, reportDocId, docType, docCategory, clientUserId }, "wf-executor: generate_document completed");
            output = docType === "task_execution_guide"
              ? { documentId: reportDocId, docType, category: docCategory, title: docTitle, clientId: clientUserId, htmlContent }
              : { documentId: reportDocId, docType, category: docCategory, title: docTitle, clientId: clientUserId };
            } // end if (!sowHandled)
          }
        } else if (actionType === "emit_event") {
          const emitEventType = interp(node.data.eventType as string | undefined, payload)
            ?? interp(node.data.eventName as string | undefined, payload);
          if (!emitEventType) {
            nodeError = true;
            output = { error: "emit_event requires eventType or eventName" };
          } else {
            const rawExtraPayload = node.data.extraPayload as string | undefined;
            let extraPayload: Record<string, unknown> = {};
            if (rawExtraPayload?.trim()) {
              try { extraPayload = JSON.parse(interp(rawExtraPayload, payload) ?? "{}") as Record<string, unknown>; }
              catch { /* ignore bad JSON */ }
            }
            const currentChainDepth = (payload._chainDepth as number | undefined) ?? 0;
            const mergedPayload = { ...payload, ...extraPayload };
            await emitWorkflowEvent(emitEventType, mergedPayload, definitionId, currentChainDepth);
            output = { emitted: true, eventType: emitEventType };
            logger.info({ runId, definitionId, eventType: emitEventType, chainDepth: currentChainDepth }, "wf-executor: emit_event node fired");

            // ── Route presentation.phase_gen.* events to the SSE channel ──────
            if (emitEventType.startsWith("presentation.phase_gen.")) {
              const rawPresId = mergedPayload.presentationId;
              const presId = typeof rawPresId === "number"
                ? rawPresId
                : typeof rawPresId === "string"
                ? parseInt(rawPresId, 10)
                : NaN;
              if (!isNaN(presId)) {
                if (emitEventType === "presentation.phase_gen.progress") {
                  broadcastPresentationPhaseGenProgress(presId, {
                    message: String(mergedPayload.message ?? ""),
                    current: Number(mergedPayload.current ?? 0),
                    total: Number(mergedPayload.total ?? 0),
                  });
                } else if (emitEventType === "presentation.phase_gen.complete") {
                  // Prefer mergedPayload.phases (extra payload), then fall back to
                  // payload.resolvedPhases (set by save_presentation_phases system action).
                  // The fallback avoids JSON-in-JSON quoting issues when emit_event uses
                  // {{resolvedPhases}} as a template token inside extraPayload.
                  let phases: unknown[] = [];
                  const rawMergedPhases = mergedPayload.phases;
                  if (Array.isArray(rawMergedPhases) && rawMergedPhases.length > 0) {
                    phases = rawMergedPhases;
                  } else if (typeof rawMergedPhases === "string" && rawMergedPhases.trim().startsWith("[")) {
                    try { phases = JSON.parse(rawMergedPhases) as unknown[]; } catch { /* ignore */ }
                  }
                  // Fall back to resolvedPhases written directly into payload by save_presentation_phases
                  if (phases.length === 0) {
                    const rawPayloadPhases = payload.resolvedPhases;
                    if (Array.isArray(rawPayloadPhases) && rawPayloadPhases.length > 0) {
                      phases = rawPayloadPhases;
                    }
                  }
                  broadcastPresentationPhaseGenComplete(presId, phases as Parameters<typeof broadcastPresentationPhaseGenComplete>[1]);
                } else if (emitEventType === "presentation.phase_gen.error") {
                  broadcastPresentationPhaseGenError(presId, String(mergedPayload.message ?? "An error occurred"));
                }
              }
            }
          }
        } else if (actionType === "sql_query") {
          // Execute a read-only SQL query and spread first-row fields into the step output
          // so downstream condition nodes can branch on them (e.g. status, age_ms).
          // {{token}} placeholders in the query are resolved from the current payload via interp().
          // WARNING: values are string-interpolated — only use with trusted internal event payloads.
          const rawQuery = node.data.query as string | undefined;
          if (!rawQuery?.trim()) {
            nodeError = true;
            output = { error: "sql_query: node.data.query is empty" };
          } else {
            const interpolatedQuery = interp(rawQuery, payload) ?? rawQuery;
            try {
              const result = await pool.query(interpolatedQuery);
              const firstRow = (result.rows[0] as Record<string, unknown> | undefined) ?? null;
              output = firstRow
                ? { rowCount: result.rowCount ?? result.rows.length, ...firstRow }
                : { rowCount: 0 };
              logger.info({ runId, rowCount: result.rowCount ?? result.rows.length }, "wf-executor: sql_query node executed");
            } catch (queryErr) {
              nodeError = true;
              const errMsg = queryErr instanceof Error ? queryErr.message : String(queryErr);
              output = { error: `sql_query failed: ${errMsg.slice(0, 200)}` };
              logger.warn({ runId, err: queryErr }, "wf-executor: sql_query node failed");
            }
          }
        } else if (actionType === "calculate_pricing") {
          // Re-parse pricing from a previously-generated SOW document and write
          // sowPricingLines + sowTotalPrice back to the DB row.  Accepts documentId
          // from the payload (piped from an upstream generate_document node) or from
          // node.data.documentId as a hard-coded fallback.
          // An optional docType override can be supplied via node.data.docType but
          // is not required — the node always writes pricing regardless of doc type.
          const rawDocId =
            interp(node.data.documentId as string | undefined, payload) ??
            String((payload.documentId as number | undefined) ?? "");
          const calcDocId = rawDocId ? parseInt(rawDocId, 10) : NaN;
          const calcDocType = interp(node.data.docType as string | undefined, payload) ?? null;

          if (isNaN(calcDocId)) {
            nodeError = true;
            output = { error: "calculate_pricing requires a valid documentId" };
          } else {
            const docRow = await db
              .select({
                htmlContent: insightsGeneratedDocumentsTable.htmlContent,
              })
              .from(insightsGeneratedDocumentsTable)
              .where(eq(insightsGeneratedDocumentsTable.id, calcDocId))
              .limit(1);

            if (!docRow[0]) {
              nodeError = true;
              output = { error: `calculate_pricing: document ${calcDocId} not found` };
            } else if (!docRow[0].htmlContent?.trim()) {
              nodeError = true;
              output = { error: `calculate_pricing: document ${calcDocId} has no htmlContent` };
            } else {
              const { lineCount, totalPrice } = await persistSowPricing(calcDocId, docRow[0].htmlContent);
              if (lineCount === 0) {
                nodeError = true;
                output = {
                  error:
                    "No pricing lines found — check that the document is a SOW and that its pricing table contains rows with dollar amounts. " +
                    "The upstream generate_document node may have produced malformed or non-SOW HTML.",
                  documentId: calcDocId,
                  lineCount: 0,
                  totalPrice: 0,
                };
                logger.warn({ runId, calcDocId, calcDocType }, "wf-executor: calculate_pricing found 0 pricing lines — failing node");
              } else {
                output = { documentId: calcDocId, totalPrice, lineCount, ...(calcDocType ? { docType: calcDocType } : {}) };
                logger.info({ runId, calcDocId, lineCount, totalPrice, calcDocType }, "wf-executor: calculate_pricing completed");
              }
            }
          }
        } else if (actionType === "run_workflow") {
          // ── Run Workflow: execute a published sub-workflow synchronously ─────
          const RUN_WORKFLOW_MAX_DEPTH = Math.max(1, parseInt(process.env.RUN_WORKFLOW_MAX_DEPTH ?? "5", 10) || 5);
          const workflowIdRaw = node.data.workflowId as string | number | undefined;
          const subDefId = typeof workflowIdRaw === "number"
            ? workflowIdRaw
            : parseInt(String(workflowIdRaw ?? ""), 10);

          if (isNaN(subDefId)) {
            nodeError = true;
            output = { error: "run_workflow requires a workflowId" };
          } else {
            const rawDepth = payload._depth;
            const currentDepth = Math.max(0, Number.isInteger(rawDepth) ? (rawDepth as number) : 0);
            if (currentDepth >= RUN_WORKFLOW_MAX_DEPTH) {
              nodeError = true;
              output = {
                error: `run_workflow: maximum nesting depth of ${RUN_WORKFLOW_MAX_DEPTH} reached — possible recursive workflow loop. Aborting to prevent infinite recursion.`,
                depth: currentDepth,
                maxDepth: RUN_WORKFLOW_MAX_DEPTH,
              };
              logger.warn({ runId, subDefId, currentDepth, maxDepth: RUN_WORKFLOW_MAX_DEPTH }, "wf-executor: run_workflow depth limit reached — aborting to prevent infinite loop");
            } else {
            const rawMapping = node.data.inputMapping as Array<{ key: string; expr: string }> | undefined;
            const subPayload: Record<string, unknown> = { ...payload };
            if (rawMapping) {
              for (const { key, expr } of rawMapping) {
                if (key) subPayload[key] = interp(expr, payload) ?? expr;
              }
            }
            subPayload._parentRunId = runId;
            subPayload._depth = currentDepth + 1;

            const subVersionRows = await db.select()
              .from(wfVersionsTable)
              .where(and(eq(wfVersionsTable.definitionId, subDefId), eq(wfVersionsTable.status, "published")))
              .limit(1);
            const subVersion = subVersionRows[0];

            if (!subVersion) {
              nodeError = true;
              output = { error: `run_workflow: no published version found for workflow ${subDefId}` };
            } else {
              const [childRunRow] = await db.insert(wfRunsTable).values({
                versionId: subVersion.id,
                definitionId: subDefId,
                triggerType: "manual",
                triggerRef: `run_workflow:parent:${runId}`,
                payload: subPayload,
                status: "pending",
              }).returning({ id: wfRunsTable.id });
              const childRunId = childRunRow?.id;

              if (!childRunId) {
                nodeError = true;
                output = { error: "run_workflow: failed to create child run record" };
              } else {
                await executeWorkflowRun(childRunId);

                const childRunStatusRows = await db.select({
                  status: wfRunsTable.status,
                  errorMessage: wfRunsTable.errorMessage,
                }).from(wfRunsTable).where(eq(wfRunsTable.id, childRunId)).limit(1);
                const childStatus = childRunStatusRows[0];

                if (childStatus?.status === "failed" || childStatus?.status === "cancelled") {
                  nodeError = true;
                  output = {
                    error: childStatus.errorMessage ?? `Sub-workflow ${childStatus.status}`,
                    childRunId,
                  };
                } else {
                  const childOutputRows = await db.select({ output: wfRunNodeOutputsTable.output })
                    .from(wfRunNodeOutputsTable)
                    .where(and(
                      eq(wfRunNodeOutputsTable.runId, childRunId),
                      eq(wfRunNodeOutputsTable.status, "ok"),
                    ))
                    .orderBy(wfRunNodeOutputsTable.id)
                    .limit(50);
                  const mergedChildOutput: Record<string, unknown> = {};
                  for (const row of childOutputRows) {
                    const rowOutput = row.output as Record<string, unknown> | null;
                    if (rowOutput) Object.assign(mergedChildOutput, rowOutput);
                  }
                  output = { childRunId, ...mergedChildOutput };
                  logger.info({ runId, childRunId, subDefId }, "wf-executor: run_workflow completed — child outputs merged into parent context");
                }
              }
            }
            } // end depth-check else
          }
        } else {
          output = { actionType: actionType ?? "none", note: "action executed (no-op in this environment)" };
        }
        break;
      }

      case "condition": {
        const expression = node.data.expression as string | undefined;
        const result = expression ? evalCondition(expression, payload) : false;
        conditionResult = result;
        output = { result, expression };
        if (!result && node.data.cancelOnFalse === true) {
          cancelRun = true;
          output.cancelledReason = "cancelOnFalse=true";
        }
        break;
      }

      case "switch_case": {
        const switchExpr = node.data.switchExpr as string | undefined;
        const cases = (node.data.cases as Array<{ id: string; matchValue: string; label: string }> | undefined) ?? [];
        if (dryRun) {
          // Dry-run: deterministically pick the first configured case so the visual trace works
          const firstCase = cases[0];
          switchChosenHandle = firstCase ? firstCase.id : "default";
          const dryBranch = firstCase ? (firstCase.label || firstCase.matchValue || "case-1") : "default";
          output = { dryRun: true, switchValue: interp(switchExpr, payload) ?? "", chosenBranch: dryBranch, matchedCaseId: firstCase?.id ?? null };
        } else {
          const switchValue = interp(switchExpr, payload) ?? "";
          // Find first case whose matchValue exactly matches the resolved value
          const matchedCase = cases.find(c => c.matchValue === switchValue);
          switchChosenHandle = matchedCase ? matchedCase.id : "default";
          const chosenBranch = matchedCase ? (matchedCase.label || matchedCase.matchValue) : "default";
          output = { switchValue, chosenBranch, matchedCaseId: matchedCase?.id ?? null };
        }
        break;
      }

      case "foreach": {
        // Resolve the array from the payload using the configured path.
        // Strips {{…}} wrapper if present, normalises payload. prefix (same
        // as interp()), then walks dot-notation keys.
        const feArrayPath = (node.data.arrayPath as string | undefined) ?? "";
        // Strip {{ }} wrapper
        const feCleanPath = feArrayPath.replace(/^\{\{(.+)\}\}$/, "$1").trim();
        // Normalise payload. prefix — interp() strips it so we must too
        const feNormPath = feCleanPath.startsWith("payload.") ? feCleanPath.slice(8) : feCleanPath;
        let feResolved: unknown = payload;
        if (feNormPath) {
          for (const part of feNormPath.split(".")) {
            if (feResolved == null || typeof feResolved !== "object") { feResolved = undefined; break; }
            feResolved = (feResolved as Record<string, unknown>)[part];
          }
        }
        // Accept a real JS array OR a comma-separated string (e.g. "a,b,c")
        let feItems: unknown[] | null = null;
        if (Array.isArray(feResolved)) {
          feItems = feResolved;
        } else if (typeof feResolved === "string" && feResolved.trim().length > 0) {
          feItems = feResolved.split(",").map(s => s.trim()).filter(s => s.length > 0);
        }
        if (!feItems) {
          logger.warn({ runId, arrayPath: feCleanPath, resolvedType: typeof feResolved },
            "workflow-executor: foreach array path did not resolve to an array or CSV string — skipping all iterations");
        }
        const feAlias = (node.data.itemAlias as string | undefined)?.trim() || null;
        output = {
          foreachItems: feItems ?? [],
          foreachSkipped: !feItems,
          arrayPath: feCleanPath,
          itemAlias: feAlias,
          collectedResults: [],
        };
        break;
      }

      case "delay": {
        // No hard cap — trust the node-configured values.
        // For production workflows with multi-hour delays, a resumable job
        // queue (e.g. pg-boss) would be more appropriate than an in-process wait.
        const mode = (node.data.mode ?? "fixed") as string;
        if (mode === "fixed") {
          const durationMs = ((node.data.duration as number | undefined) ?? 0) * 1000;
          if (durationMs > 0) {
            await new Promise(r => setTimeout(r, durationMs));
          }
          output = { mode, durationMs };
        } else if (mode === "until_timestamp") {
          const ts = node.data.timestamp as string | number | undefined;
          if (ts) {
            const targetMs = typeof ts === "number" ? ts : new Date(ts).getTime();
            const waitMs = Math.max(0, targetMs - Date.now());
            if (waitMs > 0) await new Promise(r => setTimeout(r, waitMs));
          }
          output = { mode, waitedUntil: ts ?? null };
        } else if (mode === "until_condition") {
          const expression = node.data.expression as string | undefined;
          const intervalMs = Math.max(1000, ((node.data.interval as number | undefined) ?? 30) * 1000);
          const timeoutMs = ((node.data.timeout as number | undefined) ?? 300) * 1000;
          const deadline = Date.now() + timeoutMs;
          let met = false;
          while (Date.now() < deadline) {
            if (expression && evalCondition(expression, payload)) { met = true; break; }
            await new Promise(r => setTimeout(r, Math.min(intervalMs, deadline - Date.now())));
          }
          output = { mode, conditionMet: met };
        } else {
          output = { mode, note: "unknown delay mode" };
        }
        break;
      }

      case "error":
        output = { caught: true, label: node.data.label ?? "Error handler" };
        break;

      // ── CRM nodes ─────────────────────────────────────────────────────────

      case "score_lead": {
        const leadIdRaw = interp(node.data.leadId as string | undefined, payload);
        const leadId = leadIdRaw ? parseInt(leadIdRaw, 10) : NaN;
        if (isNaN(leadId)) {
          nodeError = true;
          output = { error: "score_lead requires a valid leadId" };
        } else {
          const [lead] = await db.select().from(leadsTable).where(eq(leadsTable.id, leadId)).limit(1);
          if (!lead) {
            nodeError = true;
            output = { error: `Lead #${leadId} not found` };
          } else {
            const threshold = parseInt(String(node.data.threshold ?? "50"), 10);
            let score = 20;
            if (lead.company) score += 20;
            if (lead.serviceArea) score += 20;
            if ((lead.message ?? "").length > 50) score += 20;
            if (lead.stage !== "Lead") score += 20;
            const scoreLabel = score >= 80 ? "High" : score >= 50 ? "Medium" : "Low";
            const qualified = score >= threshold;
            const stage = qualified ? "SQL" : "AQL";
            await db.insert(leadQualificationsTable).values({
              leadId,
              newScore: score,
              previousScore: 0,
              stage,
              recommendedNextStep: qualified ? "Book discovery call" : "Send nurture email",
              workflowType: lead.serviceArea ?? undefined,
              evidence: [
                ...(lead.company ? ["Has company name"] : []),
                ...(lead.serviceArea ? [`Service interest: ${lead.serviceArea}`] : []),
                ...((lead.message ?? "").length > 50 ? ["Detailed message"] : []),
              ],
              scoreFit: lead.company ? 25 : 0,
              scorePain: lead.serviceArea ? 25 : 0,
              scoreMaturity: 0,
              scoreIntent: (lead.message ?? "").length > 50 ? 25 : 0,
              scoreUrgency: 25,
              status: "pending",
            });
            output = { leadId, score, scoreLabel, qualified };
          }
        }
        break;
      }

      case "assign_pipeline_stage": {
        const targetType = (node.data.targetType as string | undefined) ?? "opportunity";
        const stage = interp(node.data.stage as string | undefined, payload);
        if (!stage) {
          nodeError = true;
          output = { error: "assign_pipeline_stage requires a stage" };
          break;
        }
        if (targetType === "lead") {
          const leadIdRaw = interp(node.data.leadId as string | undefined, payload);
          const leadId = leadIdRaw ? parseInt(leadIdRaw, 10) : NaN;
          if (isNaN(leadId)) {
            nodeError = true;
            output = { error: "assign_pipeline_stage (lead) requires a valid leadId" };
          } else {
            await db.update(leadsTable)
              .set({ stage: stage as "Lead" | "AQL" | "SQL" })
              .where(eq(leadsTable.id, leadId));
            output = { targetType: "lead", leadId, stage };
          }
        } else {
          const oppIdRaw = interp(node.data.opportunityId as string | undefined, payload);
          const opportunityId = oppIdRaw ? parseInt(oppIdRaw, 10) : NaN;
          if (isNaN(opportunityId)) {
            nodeError = true;
            output = { error: "assign_pipeline_stage (opportunity) requires a valid opportunityId" };
          } else {
            await db.update(opportunitiesTable)
              .set({ workflowType: stage })
              .where(eq(opportunitiesTable.id, opportunityId));
            output = { targetType: "opportunity", opportunityId, stage };
          }
        }
        break;
      }

      case "create_opportunity": {
        const coLeadIdRaw = interp(node.data.leadId as string | undefined, payload);
        const coLeadId = coLeadIdRaw ? parseInt(coLeadIdRaw, 10) : NaN;
        if (isNaN(coLeadId)) {
          nodeError = true;
          output = { error: "create_opportunity requires a valid leadId" };
        } else {
          const [opp] = await db.insert(opportunitiesTable).values({
            leadId: coLeadId,
            workflowType: (node.data.workflowType as string | undefined) ?? "DiscoveryCall",
          }).returning();
          output = { opportunityId: opp.id, leadId: coLeadId };
        }
        break;
      }

      // ── Diagnostics / Quiz nodes ───────────────────────────────────────────

      case "parse_quiz_results": {
        const quizLeadIdRaw = interp(node.data.quizLeadId as string | undefined, payload);
        const quizLeadId = quizLeadIdRaw ? parseInt(quizLeadIdRaw, 10) : NaN;
        if (isNaN(quizLeadId)) {
          nodeError = true;
          output = { error: "parse_quiz_results requires a valid quizLeadId" };
        } else {
          const [qLead] = await db.select().from(quizLeadsTable).where(eq(quizLeadsTable.id, quizLeadId)).limit(1);
          if (!qLead) {
            nodeError = true;
            output = { error: `Quiz lead #${quizLeadId} not found` };
          } else {
            output = {
              quizLeadId: qLead.id,
              totalScore: qLead.totalScore,
              tier: qLead.tier,
              recommendedService: qLead.recommendedService ?? null,
              leadName: qLead.name,
              leadEmail: qLead.email,
              company: qLead.company ?? null,
              categoryScores: qLead.categoryScores,
            };
          }
        }
        break;
      }

      case "generate_readiness_score": {
        const grClientIdRaw = interp(node.data.clientId as string | undefined, payload);
        const grClientId = grClientIdRaw ? parseInt(grClientIdRaw, 10) : NaN;
        if (isNaN(grClientId)) {
          nodeError = true;
          output = { error: "generate_readiness_score requires a valid clientId" };
        } else {
          const history = await db.select()
            .from(clientHealthHistoryTable)
            .where(eq(clientHealthHistoryTable.clientId, grClientId))
            .limit(20);
          if (history.length === 0) {
            output = { readinessScore: 0, readinessLabel: "Low", recordId: null };
          } else {
            const avg = Math.round(history.reduce((s, r) => s + r.score, 0) / history.length);
            const readinessLabel = avg >= 75 ? "High" : avg >= 45 ? "Medium" : "Low";
            const [rec] = await db.insert(clientHealthHistoryTable).values({
              clientId: grClientId,
              category: "productivity",
              score: avg,
            }).returning();
            output = { readinessScore: avg, readinessLabel, recordId: rec.id };
          }
        }
        break;
      }

      case "attach_quiz_insights": {
        const aqClientIdRaw = interp(node.data.clientId as string | undefined, payload);
        const aqClientId = aqClientIdRaw ? parseInt(aqClientIdRaw, 10) : NaN;
        if (isNaN(aqClientId)) {
          nodeError = true;
          output = { error: "attach_quiz_insights requires a valid clientId" };
        } else {
          const insightText = interp(node.data.insightText as string | undefined, payload) ?? "Quiz insights";
          const [doc] = await db.insert(clientDocumentsTable).values({
            clientUserId: aqClientId,
            name: insightText,
            category: "reports",
          }).returning();
          output = { insightsAttached: true, documentId: doc.id };
        }
        break;
      }

      // ── M365 Health nodes ─────────────────────────────────────────────────

      case "validate_m365_permissions": {
        const vpClientIdRaw = interp(node.data.clientId as string | undefined, payload);
        const runbookName = interp(node.data.runbookName as string | undefined, payload) ?? "Validate-M365-Permissions";
        if (!vpClientIdRaw) {
          nodeError = true;
          output = { error: "validate_m365_permissions requires clientId" };
        } else if (!isAzureConfigured()) {
          nodeError = true;
          output = { error: "Azure Automation is not configured — add required secrets" };
        } else {
          const job = await createRunbookJob({ runbookName, parameters: { ClientId: vpClientIdRaw } });
          output = { permissionsValid: true, missingCount: 0, jobId: job.jobId };
        }
        break;
      }

      case "update_intelligence_tables": {
        const uitClientIdRaw = interp(node.data.clientId as string | undefined, payload);
        const uitClientId = uitClientIdRaw ? parseInt(uitClientIdRaw, 10) : NaN;
        const uitRunbook = interp(node.data.runbookName as string | undefined, payload) ?? "Update-M365-Intelligence";
        if (isNaN(uitClientId)) {
          nodeError = true;
          output = { error: "update_intelligence_tables requires a valid clientId" };
        } else if (!isAzureConfigured()) {
          nodeError = true;
          output = { error: "Azure Automation is not configured — add required secrets" };
        } else {
          const job = await createRunbookJob({ runbookName: uitRunbook, parameters: { ClientId: String(uitClientId) } });
          const [rec] = await db.insert(clientHealthHistoryTable).values({
            clientId: uitClientId,
            category: "governance",
            score: 0,
          }).returning();
          output = { updated: true, recordId: rec.id, jobId: job.jobId };
        }
        break;
      }

      case "generate_diff_report": {
        const gdrClientIdRaw = interp(node.data.clientId as string | undefined, payload);
        const gdrClientId = gdrClientIdRaw ? parseInt(gdrClientIdRaw, 10) : NaN;
        if (isNaN(gdrClientId)) {
          nodeError = true;
          output = { error: "generate_diff_report requires a valid clientId" };
        } else {
          const snapshots = await db.select()
            .from(clientHealthHistoryTable)
            .where(eq(clientHealthHistoryTable.clientId, gdrClientId))
            .limit(2);
          const changesFound = snapshots.length >= 2 && snapshots[0].score !== snapshots[1].score;
          const changeCount = changesFound ? Math.abs(snapshots[0].score - snapshots[1].score) : 0;
          const [doc] = await db.insert(clientDocumentsTable).values({
            clientUserId: gdrClientId,
            name: `M365 Health Diff Report — ${new Date().toLocaleDateString("en-GB")}`,
            category: "reports",
          }).returning();
          output = { documentId: doc.id, changesFound, changeCount };
        }
        break;
      }

      case "notify_major_changes": {
        const nmcClientIdRaw = interp(node.data.clientId as string | undefined, payload);
        const nmcThreshold = parseInt(String(node.data.changeThreshold ?? "15"), 10);
        const changesFound = Boolean(payload.changesFound);
        const changeCount = parseInt(String(payload.changeCount ?? "0"), 10);
        if (!changesFound || changeCount < nmcThreshold) {
          output = { notified: false, skipped: true };
        } else {
          const to = interp(node.data.notifyEmail as string | undefined, payload) ?? process.env.CRM_ADMIN_EMAIL;
          if (to) {
            const { sendEmail } = await import("./mailer");
            await sendEmail(
              to,
              `M365 Health Alert — significant changes detected${nmcClientIdRaw ? ` for client #${nmcClientIdRaw}` : ""}`,
              `<p>A health diff report detected <strong>${changeCount}</strong> changed fields${nmcClientIdRaw ? ` for client #${nmcClientIdRaw}` : ""}.</p><p>Check the Admin Panel for the full diff report.</p>`,
            );
          }
          output = { notified: true, skipped: false };
        }
        break;
      }

      case "send_browser_notification": {
        const sbnTitle    = interp(node.data.title    as string | undefined, payload)?.trim() ?? "";
        const sbnBody     = interp(node.data.body     as string | undefined, payload) ?? "";
        const sbnLinkPath = interp(node.data.linkPath as string | undefined, payload)?.trim() || null;
        if (!sbnTitle) {
          logger.warn({ runId }, "send_browser_notification: title is empty — skipping push");
          output = { notificationSent: false, skipped: true, reason: "title is empty" };
        } else {
          try {
            await sendWebPushToAdmins({ title: sbnTitle, body: sbnBody, linkPath: sbnLinkPath });
            output = { notificationSent: true };
          } catch (sbnErr) {
            logger.warn({ sbnErr, runId }, "send_browser_notification: push dispatch failed — continuing run");
            output = { notificationSent: false, error: String(sbnErr) };
          }
        }
        break;
      }

      case "create_notification": {
        const cnTitle = interp(node.data.title    as string | undefined, payload)?.trim() ?? "";
        const cnBody  = interp(node.data.body     as string | undefined, payload) ?? "";
        const cnLink  = interp(node.data.linkPath as string | undefined, payload)?.trim() || null;
        const cnType  = (interp(node.data.type    as string | undefined, payload)?.trim() || "message") as
          "project_update" | "message" | "invoice" | "document" | "general" | "lead_created" | "quiz_lead_created" | "purchase_created";
        const validTypes = ["project_update","message","invoice","document","general","lead_created","quiz_lead_created","purchase_created"] as const;
        const resolvedType = (validTypes as readonly string[]).includes(cnType) ? cnType : "message" as const;

        if (!cnTitle) {
          logger.warn({ runId }, "create_notification: title is empty — skipping insert");
          output = { notificationCount: 0, skipped: true, reason: "title is empty" };
        } else {
          const adminRows = await db
            .select({ id: usersTable.id })
            .from(usersTable)
            .where(eq(usersTable.role, "admin"));

          if (adminRows.length === 0) {
            logger.warn({ runId }, "create_notification: no admin users found — skipping insert");
            output = { notificationCount: 0, skipped: true, reason: "no admin users" };
          } else {
            await db.insert(notificationsTable).values(
              adminRows.map(row => ({
                userId: row.id,
                title: cnTitle,
                body: cnBody || null,
                type: resolvedType,
                linkPath: cnLink,
                read: false,
              })),
            );
            logger.info({ runId, notificationCount: adminRows.length, cnType: resolvedType }, "create_notification: inserted notifications");
            output = { notificationCount: adminRows.length };
          }
        }
        break;
      }

      case "send_mobile_push": {
        const smpTitle  = interp(node.data.title as string | undefined, payload)?.trim() ?? "";
        const smpBody   = interp(node.data.body  as string | undefined, payload) ?? "";
        const tokenRows = await db.select({ token: deviceTokensTable.token }).from(deviceTokensTable);
        if (!tokenRows.length) {
          logger.warn({ runId }, "send_mobile_push: no device tokens registered — skipping");
          output = { sent: false, sentCount: 0 };
        } else {
          const tokens = tokenRows.map(r => r.token);
          await sendPushNotifications(tokens, smpTitle || "Notification", smpBody);
          logger.info({ runId, sentCount: tokens.length }, "send_mobile_push: dispatched to device tokens");
          output = { sent: true, sentCount: tokens.length };
        }
        break;
      }

      case "play_sound": {
        const psTarget  = (node.data.target  as string | undefined)?.trim() ?? "browser";
        const psSound   = (node.data.sound   as string | undefined)?.trim() ?? "ping";
        const psUrl     = (node.data.url     as string | undefined)?.trim() ?? "";
        const psParams  = node.data.synthParams as Record<string, unknown> | undefined;
        const psLabel   = psParams ? "synthesised" : (psUrl ? psUrl : psSound);

        // ── Condition gate ──────────────────────────────────────────────────────
        const psCondOp   = (node.data.playConditionOp   as string | undefined) ?? "always";
        const psCondExpr = (node.data.playConditionExpr as string | undefined) ?? "";
        const psCondVal  = (node.data.playConditionVal  as string | undefined) ?? "";

        if (psCondOp !== "always" && psCondExpr.trim()) {
          // Resolve the expression against the current payload (step outputs live under
          // payload.steps.<nodeId>.<key> after the executor merges them in).
          const resolved = interp(psCondExpr.trim(), payload) ?? "";
          let conditionMet = false;
          switch (psCondOp) {
            case "truthy":
              conditionMet = resolved !== "" && resolved !== "0" && resolved !== "false" && resolved !== "null";
              break;
            case "falsy":
              conditionMet = resolved === "" || resolved === "0" || resolved === "false" || resolved === "null";
              break;
            case "eq":
              conditionMet = resolved === psCondVal;
              break;
            case "neq":
              conditionMet = resolved !== psCondVal;
              break;
            default:
              conditionMet = true;
          }
          if (!conditionMet) {
            logger.info({ runId, psCondOp, psCondExpr, resolved }, "play_sound: condition not met — skipping");
            output = { soundPlayed: false, soundSkipped: true, soundTarget: psTarget };
            break;
          }
        }

        if (psTarget === "desktop") {
          // Deliver via web push — the service worker will broadcast PLAY_WORKFLOW_SOUND
          // to open admin panel tabs, which then call playSoundFromParams.
          try {
            await sendWebPushToAdmins({
              title: "🔔 Workflow Sound",
              body: `Playing: ${psLabel}`,
              linkPath: null,
              playSound: false,
              soundPayload: JSON.stringify(
                psParams ? { type: "params", params: psParams }
                  : psUrl   ? { type: "url",    url: psUrl }
                  : { type: "preset", preset: psSound }
              ),
            } as Parameters<typeof sendWebPushToAdmins>[0] & { soundPayload?: string });
            logger.info({ runId, psLabel }, "play_sound [desktop]: web push dispatched");
            output = { soundPlayed: true, soundTarget: "desktop" };
          } catch (psErr) {
            logger.warn({ psErr, runId }, "play_sound [desktop]: push dispatch failed");
            output = { soundPlayed: false, soundTarget: "desktop", error: String(psErr) };
          }
        } else {
          // Browser target — emit SSE event; open admin panel tabs pick it up
          broadcastAdminWorkflowEvent({
            type: "play_sound",
            source: psParams ? { type: "params", params: psParams }
              : psUrl   ? { type: "url",    url: psUrl }
              : { type: "preset", preset: psSound },
          });
          logger.info({ runId, psLabel }, "play_sound [browser]: SSE event broadcast");
          output = { soundPlayed: true, soundTarget: "browser" };
        }
        break;
      }

      case "send_campaign_email": {
        // Escape a plain string value for safe insertion into HTML
        function escHtml(s: string): string {
          return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
        }
        // Substitute {{path}} tokens from the workflow payload into a template string.
        function renderTemplate(template: string, p: Record<string, unknown>): string {
          return template.replace(/\{\{([\w.]+)\}\}/g, (_m, path: string) => {
            const key = path.startsWith("payload.") ? path.slice(8) : path;
            const parts = key.split(".");
            let cur: unknown = p;
            for (const part of parts) {
              if (cur == null || typeof cur !== "object") return `{{${path}}}`;
              cur = (cur as Record<string, unknown>)[part];
            }
            return cur != null ? escHtml(String(cur)) : `{{${path}}}`;
          });
        }

        const recipient = interp(node.data.recipientExpr as string | undefined, payload);
        if (!recipient?.trim()) {
          nodeError = true;
          output = { error: "send_campaign_email: recipient resolved to empty — check recipientExpr" };
          break;
        }

        const assetId = node.data.assetId as number | undefined;
        const templateSlug = node.data.templateSlug as string | undefined;

        let bodyHtml: string;
        let subject: string;
        let sourceRef: string;

        if (assetId) {
          // New path: resolve by campaign asset ID
          const [asset] = await db.select().from(campaignAssetsTable).where(eq(campaignAssetsTable.id, assetId)).limit(1);
          if (!asset) {
            nodeError = true;
            output = { error: `send_campaign_email: campaign asset #${assetId} not found` };
            break;
          }
          // Convert plain-text content to simple HTML paragraphs for email rendering
          const paragraphs = asset.content.split(/\n{2,}/).map(p => `<p>${escHtml(p.trim()).replace(/\n/g, "<br>")}</p>`).join("\n");
          bodyHtml  = paragraphs;
          subject   = asset.title;
          sourceRef = `asset:${assetId}`;
        } else if (templateSlug) {
          // Legacy path: resolve by email template slug
          const [tmpl] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.slug, templateSlug)).limit(1);
          if (!tmpl) {
            nodeError = true;
            output = { error: `Email template '${templateSlug}' not found` };
            break;
          }
          bodyHtml  = tmpl.bodyHtml;
          subject   = tmpl.subject;
          sourceRef = `template:${templateSlug}`;
        } else {
          nodeError = true;
          output = { error: "send_campaign_email requires an assetId (Campaign Email Copy) or a templateSlug" };
          break;
        }

        const renderedBody    = renderTemplate(bodyHtml, payload);
        const renderedSubject = renderTemplate(subject, payload);
        const { sendEmail, brandedEmail } = await import("./mailer");
        const fullHtml = brandedEmail(renderedBody);
        await sendEmail(recipient, renderedSubject, fullHtml, { skipWrapper: true });
        // Emit sourceRef plus backward-compat templateSlug for existing workflows
        output = {
          sent: true,
          recipient,
          subject: renderedSubject,
          sourceRef,
          templateSlug: assetId ? "" : (templateSlug ?? ""),
        };
        break;
      }

      case "create_kanban_task": {
        const boardIdRaw = interp(node.data.boardId as string | undefined, payload);
        const columnId = node.data.columnId as string | undefined;
        const title = interp(node.data.titleExpr as string | undefined, payload);
        const description = interp(node.data.descriptionExpr as string | undefined, payload);
        const priority = (node.data.priority as string | undefined) ?? "medium";
        const phaseIdRaw = interp(node.data.phaseId as string | undefined, payload);
        const phaseIdNum = phaseIdRaw ? parseInt(phaseIdRaw, 10) : undefined;

        if (!boardIdRaw || !columnId || !title?.trim()) {
          nodeError = true;
          output = { error: "create_kanban_task requires boardId, columnId, and a non-empty title" };
        } else if (boardIdRaw === "marketing") {
          const validStatuses = ["ideas", "in_progress", "scheduled", "published", "completed", "money_task"] as const;
          type MarketingStatus = typeof validStatuses[number];
          const status: MarketingStatus = (validStatuses as readonly string[]).includes(columnId) ? (columnId as MarketingStatus) : "ideas";
          const [task] = await db.insert(marketingTasksTable).values({
            title: title.trim(),
            description: description ?? undefined,
            status,
          }).returning();
          output = { taskId: task.id, boardId: boardIdRaw, columnId: status, title: task.title };
        } else {
          const projectId = parseInt(boardIdRaw, 10);
          if (isNaN(projectId)) {
            nodeError = true;
            output = { error: `create_kanban_task: invalid boardId '${boardIdRaw}' — must be 'marketing' or a numeric project ID` };
          } else {
            const validColumns = ["backlog", "in_progress", "waiting_on_customer", "completed"] as const;
            type KanbanColumn = typeof validColumns[number];
            const column: KanbanColumn = (validColumns as readonly string[]).includes(columnId) ? (columnId as KanbanColumn) : "backlog";
            const [task] = await db.insert(kanbanTasksTable).values({
              projectId,
              title: title.trim(),
              description: description ?? undefined,
              column,
              priority,
              workflowStepId: !isNaN(phaseIdNum!) ? phaseIdNum : undefined,
            }).returning();
            output = { taskId: task.id, boardId: boardIdRaw, columnId: column, title: task.title };
          }
        }
        break;
      }

      case "get_phases": {
        const gpProjectId = interp(node.data.projectId as string | undefined, payload);
        const gpPresentationId = interp(node.data.presentationId as string | undefined, payload);

        let presRow: { id: number; sowPhases: unknown } | undefined;
        if (gpProjectId) {
          const pid = parseInt(gpProjectId, 10);
          if (!isNaN(pid)) {
            const [found] = await db
              .select({ id: quickWinPresentationsTable.id, sowPhases: quickWinPresentationsTable.sowPhases })
              .from(quickWinPresentationsTable)
              .where(eq(quickWinPresentationsTable.projectId, pid))
              .orderBy(quickWinPresentationsTable.createdAt)
              .limit(1);
            presRow = found;
          }
        }
        if (!presRow && gpPresentationId) {
          const presId = parseInt(gpPresentationId, 10);
          if (!isNaN(presId)) {
            const [found] = await db
              .select({ id: quickWinPresentationsTable.id, sowPhases: quickWinPresentationsTable.sowPhases })
              .from(quickWinPresentationsTable)
              .where(eq(quickWinPresentationsTable.id, presId))
              .limit(1);
            presRow = found;
          }
        }

        if (!presRow) {
          logger.warn({ gpProjectId, gpPresentationId }, "get_phases: no presentation found — returning empty phases");
          output = { phases: [], phaseCount: 0, presentationId: null };
          break;
        }

        const allPhases = Array.isArray(presRow.sowPhases) ? presRow.sowPhases as Array<{ id: string; title: string; description: string; price: number; subtasks?: string[]; selected?: boolean }> : [];
        const phases = allPhases.filter(p => p.selected !== false);
        output = { phases, phaseCount: phases.length, presentationId: presRow.id };
        break;
      }

      case "create_phase": {
        const cpProjectId = interp(node.data.projectId as string | undefined, payload);
        const cpTitle = interp(node.data.title as string | undefined, payload);
        const cpDescription = interp(node.data.description as string | undefined, payload);
        const cpOrderRaw = interp(node.data.order as string | undefined, payload);
        const cpOrder = cpOrderRaw ? parseInt(cpOrderRaw, 10) : 0;

        if (!cpProjectId || !cpTitle?.trim()) {
          nodeError = true;
          output = { error: "create_phase requires projectId and title" };
          break;
        }

        const cpProjId = parseInt(cpProjectId, 10);
        if (isNaN(cpProjId)) {
          nodeError = true;
          output = { error: `create_phase: invalid projectId '${cpProjectId}'` };
          break;
        }

        const [phase] = await db.insert(workflowStepsTable).values({
          projectId: cpProjId,
          title: cpTitle.trim(),
          description: cpDescription ?? undefined,
          status: "pending",
          order: isNaN(cpOrder) ? 0 : cpOrder,
        }).returning();
        output = { phaseId: phase.id, phaseTitle: phase.title };
        break;
      }

      case "save_presentation_phases": {
        const spPayload = {
          presentationId: interp(node.data.presentationId as string | undefined, payload),
          totalPrice: interp(node.data.totalPrice as string | undefined, payload),
          value: interp(node.data.value as string | undefined, payload),
        };
        output = await handleSystemAction("save_presentation_phases", spPayload);
        break;
      }

      // ── Content nodes ─────────────────────────────────────────────────────

      case "generate_article": {
        const gaTopic = interp(node.data.topic as string | undefined, payload);
        if (!gaTopic?.trim()) {
          nodeError = true;
          output = { error: "generate_article requires a topic" };
          break;
        }
        const gaCategory = interp(node.data.category as string | undefined, payload) ?? "M365 Best Practices";
        const gaKeywords = interp(node.data.keywords as string | undefined, payload) ?? "";
        const gaTone     = interp(node.data.tone     as string | undefined, payload) ?? "professional, authoritative, practical";
        const gaDate     = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

        const gaPrompt = `You are Shane McCaw, a 30-year Microsoft 365 veteran and Lead Architect at NASA. Write a professional consulting blog article.

Topic: ${gaTopic}
Category: ${gaCategory}
Keywords to include: ${gaKeywords || "Microsoft 365, tenant management, best practices"}
Tone: ${gaTone}
Target length: 700–1000 words

Return ONLY a JSON object with these exact keys (no prose outside the JSON):
{
  "title": "Article title — compelling, under 80 chars",
  "slug": "url-friendly-kebab-case-slug",
  "summary": "2–3 sentence card summary, under 200 chars",
  "date": "${gaDate}",
  "content": "Full article body in Markdown — use ## subheadings, bullet points where appropriate"
}`;

        const gaResp = await anthropic.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 4096,
          messages: [{ role: "user", content: gaPrompt }],
        });

        const gaRaw = gaResp.content
          .filter(b => b.type === "text")
          .map(b => (b as { type: "text"; text: string }).text)
          .join("");

        const gaParsed = extractJsonFromAiText(gaRaw);
        if (!gaParsed?.title || !gaParsed?.content) {
          nodeError = true;
          output = { error: "generate_article: AI did not return valid article JSON", rawText: gaRaw.slice(0, 500) };
        } else {
          output = {
            articleTitle:    String(gaParsed.title),
            articleSlug:     slugify(String(gaParsed.slug || gaParsed.title)),
            articleCategory: String(gaParsed.category ?? gaCategory),
            articleSummary:  String(gaParsed.summary ?? ""),
            articleDate:     String(gaParsed.date ?? gaDate),
            articleContent:  String(gaParsed.content),
          };
        }
        break;
      }

      case "publish_article": {
        // For each field: if an override expr is set, interpolate it;
        // otherwise fall back to the matching top-level payload key which was
        // spread there by the preceding generate_article node (or trigger payload).
        const paTitle    = (interp(node.data.titleExpr    as string | undefined, payload)
                            || String(payload.articleTitle    ?? "")).trim();
        const paCategory = (interp(node.data.categoryExpr as string | undefined, payload)
                            || String(payload.articleCategory ?? "General")).trim();
        const paSummary  = (interp(node.data.summaryExpr  as string | undefined, payload)
                            || String(payload.articleSummary  ?? "")).trim();
        const paDate     = (interp(node.data.dateExpr     as string | undefined, payload)
                            || String(payload.articleDate ?? new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }))).trim();
        const paContent  = (interp(node.data.contentExpr  as string | undefined, payload)
                            || String(payload.articleContent ?? "")).trim();

        if (!paTitle || !paContent) {
          nodeError = true;
          output = { error: "publish_article requires articleTitle and articleContent in the workflow payload (wire a generate_article node first)" };
          break;
        }

        let paSlug = slugify(
          interp(node.data.slugExpr as string | undefined, payload) || String(payload.articleSlug ?? paTitle),
        );

        // Conflict check — append a short timestamp suffix if slug already taken
        const [existing] = await db
          .select({ slug: articlesTable.slug })
          .from(articlesTable)
          .where(eq(articlesTable.slug, paSlug))
          .limit(1);
        if (existing) {
          paSlug = `${paSlug}-${Date.now().toString(36)}`;
        }

        const draftOnly = Boolean(node.data.draftOnly);

        const [newArticle] = await db.insert(articlesTable).values({
          slug:        paSlug,
          category:    paCategory,
          title:       paTitle,
          summary:     paSummary,
          date:        paDate,
          content:     paContent,
          isPublished: !draftOnly,
        }).returning();

        if (!draftOnly) {
          // Write .md file — required for the public site to reflect the article
          const mdContent =
            `---\nslug: ${newArticle.slug}\ncategory: ${newArticle.category}\n` +
            `title: "${newArticle.title.replace(/"/g, '\\"')}"\n` +
            `summary: "${newArticle.summary.replace(/"/g, '\\"')}"\n` +
            `date: ${newArticle.date}\n---\n\n${newArticle.content}`;

          await fs.mkdir(ARTICLES_DIR, { recursive: true });
          await fs.writeFile(path.join(ARTICLES_DIR, `${newArticle.slug}.md`), mdContent, "utf8");
        }

        if (draftOnly) {
          const notifTitle = "New article draft ready for review";
          const notifBody  = `"${newArticle.title}" was generated and saved as a draft.`;
          const notifLink  = "/admin-panel/content/articles?tab=drafts";

          try {
            const admins = await db
              .select({ id: usersTable.id })
              .from(usersTable)
              .where(eq(usersTable.role, "admin"));

            if (admins.length > 0) {
              await db.insert(notificationsTable).values(
                admins.map(a => ({
                  userId:   a.id,
                  title:    notifTitle,
                  body:     notifBody,
                  type:     "general" as const,
                  linkPath: notifLink,
                })),
              );
            }
          } catch (notifErr) {
            logger.warn({ notifErr, slug: newArticle.slug }, "publish_article: failed to insert draft notifications (non-fatal)");
          }

          void sendWebPushToAdmins({
            title:    notifTitle,
            body:     notifBody,
            linkPath: notifLink,
          });
        }

        output = {
          published: !draftOnly,
          draft: draftOnly,
          slug: newArticle.slug,
          articleId: newArticle.id,
          title: newArticle.title,
        };
        break;
      }

      // ── Topic Picker ──────────────────────────────────────────────────────
      case "topic_picker": {
        const tpCategory    = interp(node.data.category    as string | undefined, payload) ?? "M365 Best Practices";
        const tpFocusArea   = interp(node.data.focusArea   as string | undefined, payload) ?? "";
        const tpExcludeRecent = Number(node.data.excludeRecent ?? 20);

        const recentRows = await db
          .select({ title: articlesTable.title })
          .from(articlesTable)
          .orderBy(articlesTable.createdAt)
          .limit(tpExcludeRecent);

        const recentTitles = recentRows.map(r => `- ${r.title}`).join("\n") || "(none yet)";

        const tpPrompt = `You are a content strategist for Shane McCaw Consulting, a Microsoft 365 advisory firm.

Choose ONE compelling article topic in the "${tpCategory}" category that has NOT already been covered.

${tpFocusArea ? `Focus area: ${tpFocusArea}\n` : ""}Already published topics (do NOT repeat these):
${recentTitles}

Return ONLY a JSON object with these exact keys:
{
  "topic": "Specific, actionable article topic — under 100 chars",
  "rationale": "One sentence explaining why this topic will resonate"
}`;

        const tpResp = await anthropic.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 512,
          messages: [{ role: "user", content: tpPrompt }],
        });

        const tpRaw = tpResp.content.filter(b => b.type === "text").map(b => (b as { type: "text"; text: string }).text).join("");
        const tpParsed = extractJsonFromAiText(tpRaw);

        if (!tpParsed?.topic) {
          nodeError = true;
          output = { error: "topic_picker: AI did not return a valid topic", rawText: tpRaw.slice(0, 300) };
        } else {
          output = {
            articleTopic:   String(tpParsed.topic),
            topicRationale: String(tpParsed.rationale ?? ""),
            topicCategory:  tpCategory,
          };
        }
        break;
      }

      // ── Generate Image ────────────────────────────────────────────────────
      case "generate_image": {
        const giPromptRaw = interp(node.data.prompt as string | undefined, payload);
        if (!giPromptRaw?.trim()) {
          nodeError = true;
          output = { error: "generate_image requires a prompt" };
          break;
        }

        const giAspect = (node.data.aspectRatio as string | undefined) ?? "landscape";
        const giStyle  = (node.data.style  as string | undefined) ?? "";
        const giSize   = ASPECT_RATIO_SIZE[giAspect] ?? "1536x1024";

        const giFullPrompt = giStyle
          ? `${giPromptRaw.trim()} Style: ${giStyle}.`
          : giPromptRaw.trim();

        try {
          const giResp = await openai.images.generate({
            model: "gpt-image-1",
            prompt: giFullPrompt,
            size: giSize,
          });

          const giBase64 = (giResp.data ?? [])[0]?.b64_json;
          if (!giBase64) {
            nodeError = true;
            output = { error: "generate_image: API returned no image data" };
            break;
          }

          const giBuffer = Buffer.from(giBase64, "base64");
          const giFilename = `${randomUUID()}.png`;
          const giFilePath = path.join(GENERATED_IMAGES_DIR, giFilename);
          await fs.writeFile(giFilePath, giBuffer);

          output = {
            imageUrl:      `/api/uploads/generated-images/${giFilename}`,
            revisedPrompt: giFullPrompt,
          };
        } catch (err) {
          logger.error({ err }, "generate_image: OpenAI image generation failed");
          nodeError = true;
          output = { error: `generate_image: ${err instanceof Error ? err.message : String(err)}` };
        }
        break;
      }

      // ── Define Campaign Goal ───────────────────────────────────────────────
      case "define_campaign_goal": {
        const dcgGoal = (interp(node.data.goalExpr as string | undefined, payload) ?? "").trim();
        output = { campaignGoal: dcgGoal || "Generate leads" };
        break;
      }

      // ── Define Target Audience ─────────────────────────────────────────────
      case "define_target_audience": {
        const dtaAudience = (interp(node.data.audienceExpr as string | undefined, payload) ?? "").trim();
        output = { targetAudience: dtaAudience || "Mid-market IT decision-makers" };
        break;
      }

      // ── Create Campaign Offer ──────────────────────────────────────────────
      case "create_campaign_offer": {
        const ccoName     = (interp(node.data.nameExpr     as string | undefined, payload) ?? "").trim();
        const ccoGoal     = (interp(node.data.goalExpr     as string | undefined, payload) ?? (payload.campaignGoal as string | undefined) ?? "Generate leads").trim();
        const ccoAudience = (interp(node.data.audienceExpr as string | undefined, payload) ?? (payload.targetAudience as string | undefined) ?? "Mid-market IT decision-makers").trim();
        const ccoPricing  = (interp(node.data.pricingExpr  as string | undefined, payload) ?? "").trim();
        const ccoCta      = (interp(node.data.ctaExpr      as string | undefined, payload) ?? "").trim();

        if (!ccoName) {
          nodeError = true;
          output = { error: "create_campaign_offer requires an offer name" };
          break;
        }

        const [newOffer] = await db.insert(offersTable).values({
          name:      ccoName,
          goal:      ccoGoal,
          audience:  ccoAudience,
          pricing:   ccoPricing || null,
          cta:       ccoCta || null,
        }).returning();

        output = {
          offerId:       newOffer.id,
          offerName:     newOffer.name,
          offerGoal:     newOffer.goal,
          offerAudience: newOffer.audience,
        };
        break;
      }

      // ── Create Marketing Campaign ──────────────────────────────────────────
      case "create_marketing_campaign": {
        const cmcName     = (interp(node.data.nameExpr     as string | undefined, payload) ?? "").trim();
        const cmcGoal     = (interp(node.data.goalExpr     as string | undefined, payload) ?? "Generate leads").trim();
        const cmcAudience = (interp(node.data.audienceExpr as string | undefined, payload) ?? "Mid-market IT decision-makers").trim();
        const cmcOffer    = (interp(node.data.offerExpr    as string | undefined, payload) ?? "").trim();
        const cmcStatus   = (node.data.status as "draft" | "active" | undefined) ?? "draft";

        if (!cmcName) {
          nodeError = true;
          output = { error: "create_marketing_campaign requires a campaign name" };
          break;
        }

        const [newCampaign] = await db.insert(campaignsTable).values({
          name:     cmcName,
          goal:     cmcGoal,
          audience: cmcAudience,
          offer:    cmcOffer || cmcName,
          status:   cmcStatus,
        }).returning();

        output = {
          campaignId:     newCampaign.id,
          campaignName:   newCampaign.name,
          campaignStatus: newCampaign.status,
        };
        break;
      }

      // ── Publish Landing Page ───────────────────────────────────────────────
      case "publish_landing_page": {
        const plpSlug = (interp(node.data.slugExpr as string | undefined, payload) || String(payload.slug ?? "")).trim();

        if (!plpSlug) {
          nodeError = true;
          output = { error: "publish_landing_page requires a slug (configure slugExpr or wire a node that outputs {{slug}})" };
          break;
        }

        const [plpPage] = await db
          .select({ id: landingPagesTable.id, slug: landingPagesTable.slug, published: landingPagesTable.published })
          .from(landingPagesTable)
          .where(eq(landingPagesTable.slug, plpSlug))
          .limit(1);

        if (!plpPage) {
          nodeError = true;
          output = { error: `publish_landing_page: no landing page found with slug "${plpSlug}"` };
          break;
        }

        await db
          .update(landingPagesTable)
          .set({ published: true, updatedAt: new Date() })
          .where(eq(landingPagesTable.id, plpPage.id));

        output = {
          landingPageId: plpPage.id,
          slug:          plpPage.slug,
          published:     true,
          wasAlreadyPublished: plpPage.published,
        };
        break;
      }

      // ── Generate Landing Page ─────────────────────────────────────────────
      case "generate_landing_page": {
        const glpTopic    = (interp(node.data.topic    as string | undefined, payload) ?? "Microsoft 365 Consulting").trim();
        const glpAudience = (interp(node.data.audience as string | undefined, payload) ?? "IT decision-makers").trim();
        const glpCta      = (interp(node.data.cta      as string | undefined, payload) ?? "Book Your Paid Assessment").trim();

        const glpPrompt = `You are generating a landing page for a PAID professional Microsoft 365 service.
Topic: ${glpTopic}
Target audience: ${glpAudience}
CTA: ${glpCta}

RULES:
- DO NOT use generic marketing language, hype, or "free audit" language.
- DO NOT write long paragraphs. Keep it concise and enterprise-grade.
- Never imply the offer is free.
- The headline must be risk-first (e.g. "Your M365 Tenant Is a Compliance Risk").
- The subheadline must frame the core problem the prospect faces right now.
- Produce exactly 3 valuePropBlocks.
- Each valuePropBlock body must be 1–2 concise, authoritative sentences.
- Each valuePropBlock icon must be a single relevant emoji.
- socialProof must always be an empty array.

Generate a landing page as JSON — output ONLY valid JSON, no prose, no markdown fences:
{
  "title": "page title (service name — concise)",
  "headline": "risk-first headline",
  "subheadline": "one sentence framing the core problem",
  "valuePropBlocks": [
    { "icon": "🔍", "heading": "pillar heading", "body": "1–2 authoritative sentences" }
  ],
  "socialProof": [],
  "cta": { "buttonText": "${glpCta}", "href": "/contact", "subtext": "Fixed price. Senior-level delivery." }
}`;

        const glpResp = await anthropic.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 2000,
          messages: [{ role: "user", content: glpPrompt }],
        });

        const glpRaw = glpResp.content.filter(b => b.type === "text").map(b => (b as { type: "text"; text: string }).text).join("");
        const glpParsed = extractJsonFromAiText(glpRaw);

        if (!glpParsed?.title || !glpParsed?.headline) {
          nodeError = true;
          output = { error: "generate_landing_page: AI did not return valid landing page JSON" };
          break;
        }

        const glpTitle    = String(glpParsed.title);
        const glpHeadline = String(glpParsed.headline);
        const glpSlugBase = slugify(glpTitle).slice(0, 55);

        // Insert with slug-collision retry (up to 5 attempts)
        let glpPage: { id: number; slug: string } | undefined;
        for (let attempt = 0; attempt <= 5; attempt++) {
          const slug = attempt === 0 ? glpSlugBase : `${glpSlugBase}-${attempt + 1}`;
          try {
            ([glpPage] = await db.insert(landingPagesTable).values({
              slug,
              title:            glpTitle,
              headline:         glpHeadline,
              subheadline:      glpParsed.subheadline ? String(glpParsed.subheadline) : null,
              valuePropBlocks:  Array.isArray(glpParsed.valuePropBlocks) ? glpParsed.valuePropBlocks as Array<{ icon?: string; heading: string; body: string }> : [],
              socialProof:      [],
              cta:              glpParsed.cta as { buttonText: string; href: string; subtext?: string } ?? { buttonText: glpCta, href: "/contact" },
              layoutBlocks:     [],
              published:        false,
            }).returning({ id: landingPagesTable.id, slug: landingPagesTable.slug }));
            break;
          } catch (e) {
            const errText = String(e).toLowerCase();
            if ((errText.includes("unique") || errText.includes("duplicate")) && attempt < 5) continue;
            throw e;
          }
        }

        if (!glpPage) {
          nodeError = true;
          output = { error: "generate_landing_page: failed to insert landing page after slug retries" };
          break;
        }

        output = {
          landingPageId: glpPage.id,
          slug:          glpPage.slug,
          headline:      glpHeadline,
          subheadline:   glpParsed.subheadline ? String(glpParsed.subheadline) : "",
          published:     false,
        };
        break;
      }

      // ── Find Object ───────────────────────────────────────────────────────
      case "find_object": {
        const foObjectType = (node.data.objectType as string | undefined) ?? "lead";
        const foField      = (node.data.fieldName  as string | undefined) ?? "id";
        const foValue      = (interp(node.data.fieldValueExpr as string | undefined, payload) ?? "").trim();

        if (!foValue) {
          output = { found: false, objectType: foObjectType, reason: "field value expression resolved to empty string" };
          break;
        }

        switch (foObjectType) {
          case "lead": {
            const rows = await db.select().from(leadsTable).where(
              foField === "id"    ? eq(leadsTable.id, parseInt(foValue, 10)) :
              foField === "email" ? eq(leadsTable.email, foValue) :
              foField === "name"  ? eq(leadsTable.name, foValue) :
              eq(leadsTable.email, foValue)
            ).limit(1);
            const row = rows[0];
            output = row
              ? { found: true, objectType: "lead", objectId: row.id, leadId: row.id, email: row.email, name: row.name, company: row.company, status: row.status, score: row.score }
              : { found: false, objectType: "lead", fieldName: foField, fieldValue: foValue };
            break;
          }
          case "client": {
            const rows = await db.select().from(usersTable).where(
              foField === "id"    ? eq(usersTable.id, parseInt(foValue, 10)) :
              foField === "email" ? eq(usersTable.email, foValue) :
              eq(usersTable.email, foValue)
            ).limit(1);
            const row = rows[0];
            output = row
              ? { found: true, objectType: "client", objectId: row.id, clientId: row.id, email: row.email, name: row.name, company: row.company }
              : { found: false, objectType: "client", fieldName: foField, fieldValue: foValue };
            break;
          }
          case "project": {
            const rows = await db.select().from(projectsTable).where(
              foField === "id" ? eq(projectsTable.id, parseInt(foValue, 10)) :
              eq(projectsTable.id, parseInt(foValue, 10))
            ).limit(1);
            const row = rows[0];
            output = row
              ? { found: true, objectType: "project", objectId: row.id, projectId: row.id, title: row.title, status: row.status, clientUserId: row.clientUserId }
              : { found: false, objectType: "project", fieldName: foField, fieldValue: foValue };
            break;
          }
          case "article": {
            const rows = await db.select().from(articlesTable).where(
              foField === "id"   ? eq(articlesTable.id, parseInt(foValue, 10)) :
              foField === "slug" ? eq(articlesTable.slug, foValue) :
              eq(articlesTable.slug, foValue)
            ).limit(1);
            const row = rows[0];
            output = row
              ? { found: true, objectType: "article", objectId: row.id, articleId: row.id, slug: row.slug, title: row.title, isPublished: row.isPublished }
              : { found: false, objectType: "article", fieldName: foField, fieldValue: foValue };
            break;
          }
          case "stripe_invoice": {
            const { getStripeKey: getFoStripeKey } = await import("./stripe");
            let foStripeKey: string;
            try { foStripeKey = getFoStripeKey(); } catch (e) { nodeError = true; output = { error: String(e) }; break; }
            const { default: StripeFo } = await import("stripe");
            const stripeFo = new StripeFo(foStripeKey);

            try {
              if (foField === "stripeInvoiceId") {
                const inv = await stripeFo.invoices.retrieve(foValue);
                if (inv.status !== "draft") {
                  output = { found: false, objectType: "stripe_invoice", reason: `invoice ${foValue} is not in draft status (current: ${inv.status})` };
                  break;
                }
                output = {
                  found: true,
                  objectType: "stripe_invoice",
                  objectId: inv.id,
                  stripeInvoiceId: inv.id,
                  status: inv.status,
                  dueDate: inv.due_date ? new Date(inv.due_date * 1000).toISOString() : null,
                  amountDue: inv.amount_due,
                  customerId: typeof inv.customer === "string" ? inv.customer : (inv.customer as { id?: string } | null)?.id ?? null,
                };
              } else if (foField === "clientUserId") {
                const clientId = parseInt(foValue, 10);
                if (isNaN(clientId)) { output = { found: false, objectType: "stripe_invoice", reason: "clientUserId must be a number" }; break; }
                const [clientUser] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, clientId)).limit(1);
                if (!clientUser) { output = { found: false, objectType: "stripe_invoice", reason: "client not found" }; break; }
                const foCustomers = await stripeFo.customers.search({ query: `email:"${clientUser.email}"`, limit: 1 });
                if (foCustomers.data.length === 0) { output = { found: false, objectType: "stripe_invoice", reason: "no Stripe customer for client" }; break; }
                const foCustomerId = foCustomers.data[0].id;
                const foInvoices = await stripeFo.invoices.list({ customer: foCustomerId, status: "draft", limit: 1 });
                if (foInvoices.data.length === 0) { output = { found: false, objectType: "stripe_invoice", reason: "no draft invoices for customer" }; break; }
                const foInv = foInvoices.data[0];
                output = {
                  found: true, objectType: "stripe_invoice", objectId: foInv.id, stripeInvoiceId: foInv.id,
                  status: foInv.status ?? "unknown",
                  dueDate: foInv.due_date ? new Date(foInv.due_date * 1000).toISOString() : null,
                  amountDue: foInv.amount_due, customerId: foCustomerId,
                };
              } else if (foField === "projectId") {
                const projId = parseInt(foValue, 10);
                if (isNaN(projId)) { output = { found: false, objectType: "stripe_invoice", reason: "projectId must be a number" }; break; }
                const [foProj] = await db.select({ clientUserId: projectsTable.clientUserId }).from(projectsTable).where(eq(projectsTable.id, projId)).limit(1);
                if (!foProj?.clientUserId) { output = { found: false, objectType: "stripe_invoice", reason: "project or client not found" }; break; }
                const [foProjUser] = await db.select({ email: usersTable.email }).from(usersTable).where(eq(usersTable.id, foProj.clientUserId)).limit(1);
                if (!foProjUser) { output = { found: false, objectType: "stripe_invoice", reason: "client user not found" }; break; }
                const foProjCustomers = await stripeFo.customers.search({ query: `email:"${foProjUser.email}"`, limit: 1 });
                if (foProjCustomers.data.length === 0) { output = { found: false, objectType: "stripe_invoice", reason: "no Stripe customer for client" }; break; }
                const foProjCustomerId = foProjCustomers.data[0].id;
                const foProjInvoices = await stripeFo.invoices.list({ customer: foProjCustomerId, status: "draft", limit: 100 });
                const foProjInv = foProjInvoices.data.find(i => {
                  const meta = (i.metadata ?? {}) as Record<string, string>;
                  return meta.projectId === String(projId);
                });
                if (!foProjInv) { output = { found: false, objectType: "stripe_invoice", reason: "no draft invoice with matching projectId metadata found for customer" }; break; }
                output = {
                  found: true, objectType: "stripe_invoice", objectId: foProjInv.id, stripeInvoiceId: foProjInv.id,
                  status: foProjInv.status ?? "unknown",
                  dueDate: foProjInv.due_date ? new Date(foProjInv.due_date * 1000).toISOString() : null,
                  amountDue: foProjInv.amount_due, customerId: foProjCustomerId,
                };
              } else {
                output = { found: false, objectType: "stripe_invoice", reason: `unsupported fieldName: ${foField}` };
              }
            } catch (foStripeErr) {
              const foErrMsg = foStripeErr instanceof Error ? foStripeErr.message : String(foStripeErr);
              output = { found: false, objectType: "stripe_invoice", error: foErrMsg };
            }
            break;
          }
          case "insights_document": {
            const foIdField = foField === "id"         ? eq(insightsGeneratedDocumentsTable.id,         parseInt(foValue, 10)) :
                              foField === "customerId" ? eq(insightsGeneratedDocumentsTable.customerId,  parseInt(foValue, 10)) :
                              foField === "projectId"  ? eq(insightsGeneratedDocumentsTable.projectId,   parseInt(foValue, 10)) :
                              foField === "docType"    ? eq(insightsGeneratedDocumentsTable.docType,     foValue) :
                              foField === "title"      ? eq(insightsGeneratedDocumentsTable.title,       foValue) :
                              eq(insightsGeneratedDocumentsTable.id, parseInt(foValue, 10));
            const foDocRows = await db.select().from(insightsGeneratedDocumentsTable).where(foIdField).limit(1);
            const foDoc = foDocRows[0];
            output = foDoc
              ? {
                  found:           true,
                  objectType:      "insights_document",
                  objectId:        foDoc.id,
                  documentId:      foDoc.id,
                  title:           foDoc.title,
                  category:        foDoc.category,
                  docType:         foDoc.docType,
                  status:          foDoc.status,
                  htmlContent:     foDoc.htmlContent,
                  pdfUrl:          foDoc.pdfUrl ?? null,
                  sowPricingLines: foDoc.sowPricingLines ?? [],
                  sowTotalPrice:   foDoc.sowTotalPrice ?? null,
                  approvedAt:      foDoc.approvedAt?.toISOString() ?? null,
                  deliveredAt:     foDoc.deliveredAt?.toISOString() ?? null,
                  customerId:      foDoc.customerId ?? null,
                  projectId:       foDoc.projectId ?? null,
                }
              : { found: false, objectType: "insights_document", fieldName: foField, fieldValue: foValue };
            break;
          }
          default:
            output = { found: false, objectType: foObjectType, reason: `unsupported objectType: ${foObjectType}` };
        }
        break;
      }

      // ── Edit Stripe Invoice ────────────────────────────────────────────────
      case "edit_stripe_invoice": {
        const { getStripeKey: getEsiKey } = await import("./stripe");
        let esiStripeKey: string;
        try { esiStripeKey = getEsiKey(); } catch (e) { nodeError = true; output = { error: String(e) }; break; }
        const { default: StripeEsi } = await import("stripe");
        const stripeEsi = new StripeEsi(esiStripeKey);

        const esiInvoiceId = (interp(node.data.stripeInvoiceIdExpr as string | undefined, payload) ?? "").trim();
        if (!esiInvoiceId) {
          const esiWarnMsg =
            "edit_stripe_invoice: no Stripe invoice ID was found for this phase. " +
            "The phase likely has no linked draft invoice — run the \"Create Phased Invoices\" node first, " +
            "or link an invoice manually by setting stripeInvoiceId on the workflow step row. " +
            `Expression evaluated: "${node.data.stripeInvoiceIdExpr ?? "(not set)"}"`;
          logger.warn({ runId, nodeId: node.id, expr: node.data.stripeInvoiceIdExpr }, esiWarnMsg);
          nodeError = true;
          output = { error: esiWarnMsg };
          break;
        }

        try {
          const esiCurrent = await stripeEsi.invoices.retrieve(esiInvoiceId);
          if (esiCurrent.status !== "draft") {
            nodeError = true;
            output = { error: `edit_stripe_invoice: invoice ${esiInvoiceId} is not in draft status (current: ${esiCurrent.status})` };
            break;
          }

          const esiUpdateParams: Record<string, unknown> = {};

          const esiDueDateRaw = (interp(node.data.dueDateExpr as string | undefined, payload) ?? "").trim();
          if (esiDueDateRaw) {
            let esiDueDateEpoch: number;
            const esiAsNumber = Number(esiDueDateRaw);
            if (!isNaN(esiAsNumber) && esiAsNumber > 1_000_000) {
              // Already an epoch (seconds or milliseconds)
              esiDueDateEpoch = esiAsNumber > 9_999_999_999 ? Math.floor(esiAsNumber / 1000) : Math.floor(esiAsNumber);
            } else {
              // ISO date string or other parseable date
              const esiParsed = new Date(esiDueDateRaw);
              if (isNaN(esiParsed.getTime())) {
                nodeError = true;
                output = { error: `edit_stripe_invoice: dueDateExpr "${esiDueDateRaw}" is not a valid date` };
                break;
              }
              esiDueDateEpoch = Math.floor(esiParsed.getTime() / 1000);
            }
            esiUpdateParams.due_date = esiDueDateEpoch;
          }

          const esiDescription = (interp(node.data.descriptionExpr as string | undefined, payload) ?? "").trim();
          if (esiDescription) esiUpdateParams.description = esiDescription;

          const esiFooter = (interp(node.data.footerExpr as string | undefined, payload) ?? "").trim();
          if (esiFooter) esiUpdateParams.footer = esiFooter;

          const esiUpdated = await stripeEsi.invoices.update(esiInvoiceId, esiUpdateParams as Parameters<typeof stripeEsi.invoices.update>[1]);
          output = {
            invoiceId: esiUpdated.id,
            status: esiUpdated.status ?? "unknown",
            dueDate: esiUpdated.due_date ? new Date(esiUpdated.due_date * 1000).toISOString() : null,
          };
        } catch (esiErr) {
          const esiErrMsg = esiErr instanceof Error ? esiErr.message : String(esiErr);
          logger.warn({ invoiceId: esiInvoiceId, err: esiErr }, "edit_stripe_invoice: update failed");
          nodeError = true;
          output = { error: esiErrMsg };
        }
        break;
      }

      // ── Ask AI ────────────────────────────────────────────────────────────
      case "ask_ai": {
        // If the payload carries a sowDocId but no inline sowHtml, fetch the HTML
        // from the DB and inject it so {{sowHtml}} interpolation works in promptExpr.
        if (payload.sowDocId && !payload.sowHtml) {
          const docId = parseInt(String(payload.sowDocId), 10);
          if (!isNaN(docId)) {
            const [docRow] = await db
              .select({ htmlContent: insightsGeneratedDocumentsTable.htmlContent })
              .from(insightsGeneratedDocumentsTable)
              .where(eq(insightsGeneratedDocumentsTable.id, docId))
              .limit(1);
            if (docRow?.htmlContent) {
              payload = { ...payload, sowHtml: docRow.htmlContent };
            }
          }
        }
        const aaPrompt = (interp(node.data.promptExpr as string | undefined, payload) ?? "").trim();
        const aaSystem = (interp(node.data.systemExpr  as string | undefined, payload) ?? "").trim();
        const aaModel  = (node.data.model as string | undefined) ?? "claude-haiku-4-5";

        if (!aaPrompt) {
          nodeError = true;
          output = { error: "ask_ai requires a prompt" };
          break;
        }

        const aaResp = await anthropic.messages.create({
          model: aaModel,
          max_tokens: 1024,
          ...(aaSystem ? { system: aaSystem } : {}),
          messages: [{ role: "user", content: aaPrompt }],
        });

        const aaText = aaResp.content
          .filter(b => b.type === "text")
          .map(b => (b as { type: "text"; text: string }).text)
          .join("")
          .trim();

        output = { aiResponse: aaText, model: aaModel };
        break;
      }

      // ── Compose ───────────────────────────────────────────────────────────
      case "compose": {
        const resolvedValue = interp(node.data.inputs as string | undefined, payload) ?? "";
        if (node.data.parseAsJson) {
          let parsed: unknown;
          // Strip markdown code fences before parsing — AI often wraps JSON in ```json … ``` blocks.
          // Try the fence-stripped version first; fall back to the raw string so we have the best
          // chance of a successful parse without silently changing non-fenced values.
          const fenceStripped = resolvedValue.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
          const valueToParse = fenceStripped || resolvedValue;
          try {
            parsed = JSON.parse(valueToParse);
          } catch {
            logger.warn({ nodeId: node.id, resolvedValue }, "compose: JSON.parse failed — falling back to raw string");
            output = { value: resolvedValue, parseError: true };
            break;
          }

          // JSON Schema validation (optional)
          const rawSchema = (node.data.jsonSchema as string | undefined)?.trim();
          if (rawSchema) {
            let schema: unknown;
            try {
              schema = JSON.parse(rawSchema);
            } catch {
              nodeError = true;
              output = { error: "Compose: jsonSchema is not valid JSON — fix the schema definition" };
              break;
            }
            const ajv = new Ajv({ allErrors: true });
            const validate = ajv.compile(schema as Parameters<typeof ajv.compile>[0]);
            const valid = validate(parsed);
            if (!valid) {
              const messages = (validate.errors ?? [])
                .map(e => `${e.instancePath || "(root)"} ${e.message}`)
                .join("; ");
              nodeError = true;
              output = { error: `Compose: JSON Schema validation failed — ${messages}` };
              break;
            }
          }

          output = { value: parsed };
        } else {
          output = { value: resolvedValue };
        }
        break;
      }

      case "system_action": {
        const task = node.data.task as string | undefined;
        if (!task) {
          output = { skipped: true, reason: "no task configured" };
        } else {
          output = await handleSystemAction(task, payload);
        }
        break;
      }

      case "ask_for_input": {
        const fields = (node.data.fields as Array<{ variableName: string; label: string; type: string; required?: boolean }> | undefined) ?? [];
        for (const f of fields) {
          const val = inputValues[f.variableName];
          output[f.variableName] = f.type === "number" ? (val !== undefined ? Number(val) : null) : (val ?? null);
        }
        break;
      }

      // ── Fetch News Headlines ───────────────────────────────────────────────

      case "fetch_news_headlines": {
        const fnhTopicsRaw  = (interp(node.data.topics as string | undefined, payload) ?? "Microsoft 365, Copilot AI, SharePoint, Power Platform, Azure, Microsoft Viva, Project Online").trim();
        const fnhTopics     = fnhTopicsRaw.split(",").map(t => t.trim()).filter(Boolean);
        const fnhMaxResults = parseInt(interp(node.data.maxResults as string | undefined, payload) ?? "10", 10) || 10;
        const fnhThreshold  = parseInt(interp(node.data.hotScoreThreshold as string | undefined, payload) ?? "60", 10) || 60;
        const fnhCustomPrompt = (interp(node.data.customPrompt as string | undefined, payload) ?? "").trim();
        const fnhAutoBuild  = Boolean(node.data.autoBuildCampaign);

        const fnhHeadlines = await fetchNewsHeadlines(fnhTopics, fnhMaxResults);

        if (fnhHeadlines.length === 0) {
          output = {
            newsHeadlines: [],
            newsTopic: "",
            newsContext: "",
            newsArticleSuggestion: "",
            hotScore: 0,
            isHot: false,
            targetSector: "Enterprise",
            campaignBrief: null,
            campaignId: null,
          };
          break;
        }

        const fnhPrompt = fnhCustomPrompt || DEFAULT_NEWS_PROMPT;
        // Send slim headline data (title + source + url + publishedAt only) to
        // keep the token count under control — descriptions add bulk without
        // improving topic selection.
        const fnhSlimHeadlines = fnhHeadlines.map(h => ({
          title: h.title,
          source: h.source,
          url: h.url,
          publishedAt: h.publishedAt,
        }));
        const fnhAiInput = `${fnhPrompt}\n\nHEADLINES (${fnhSlimHeadlines.length} stories):\n${JSON.stringify(fnhSlimHeadlines, null, 2)}`;

        const fnhAiResponse = await anthropic.messages.create({
          model: "claude-haiku-4-5",
          max_tokens: 2048,
          system: "You must respond with a single JSON object only — no prose, no markdown fences, no explanation before or after. Start your response with { and end with }.",
          messages: [{ role: "user", content: fnhAiInput }],
        });

        const fnhAiText = fnhAiResponse.content.find(b => b.type === "text")?.text ?? "";
        const fnhParsed = extractJsonFromAiText(fnhAiText) ?? {};

        // If the AI failed to return parseable JSON, log it so it's visible in
        // the run logs and downstream nodes can fall back gracefully.
        if (!fnhAiText || Object.keys(fnhParsed).length === 0) {
          logger.warn({ runId, nodeId: node.id, rawResponse: fnhAiText.slice(0, 500) },
            "fetch_news_headlines: AI did not return valid JSON — fields will be derived from first headline");
        }

        const fnhRawTopic   = String(fnhParsed.topic      ?? "").trim();
        const fnhRawContext = String(fnhParsed.context    ?? "").trim();
        const fnhArticle    = String(fnhParsed.articleSuggestion ?? "").trim();
        const fnhScore      = Math.min(100, Math.max(0, Number(fnhParsed.hotScore) || 0));
        const fnhSector     = String(fnhParsed.targetSector ?? "Enterprise").trim();

        // Fallback: if AI parsing produced empty topic/context (e.g. JSON was
        // truncated or Haiku returned prose), derive from the first headline so
        // downstream Ask AI nodes always receive meaningful content.
        const fnhFirstHeadline = fnhHeadlines[0];
        const fnhTopic   = fnhRawTopic   || (fnhFirstHeadline ? fnhFirstHeadline.title.slice(0, 100) : "Microsoft 365 update");
        const fnhContext = fnhRawContext  || (fnhFirstHeadline
          ? `${fnhFirstHeadline.title} — ${fnhFirstHeadline.description || fnhFirstHeadline.url}`
          : "");

        const fnhIsHot      = fnhScore > fnhThreshold;

        let fnhBrief: Record<string, unknown> | null = null;
        let fnhCampaignId: number | null = null;

        if (fnhIsHot) {
          const fnhBriefInput = `${CAMPAIGN_BRIEF_PROMPT}\n\nTopic: ${fnhTopic}\nContext: ${fnhContext}\nTarget sector: ${fnhSector}`;
          const fnhBriefResponse = await anthropic.messages.create({
            model: "claude-haiku-4-5",
            max_tokens: 512,
            messages: [{ role: "user", content: fnhBriefInput }],
          });
          const fnhBriefText = fnhBriefResponse.content.find(b => b.type === "text")?.text ?? "";
          fnhBrief = extractJsonFromAiText(fnhBriefText);

          if (fnhAutoBuild && fnhBrief) {
            const fnhCampaignName = `News: ${fnhTopic}`.slice(0, 200);
            const fnhAudience = String(fnhBrief.audience ?? "M365 decision-makers");
            const fnhHook     = String(fnhBrief.hook ?? fnhContext.slice(0, 200));
            const [fnhNewCampaign] = await db.insert(campaignsTable).values({
              name:     fnhCampaignName,
              goal:     "Content-driven lead generation from news hot-score",
              audience: fnhAudience,
              offer:    fnhHook,
              status:   "draft",
            }).returning();
            fnhCampaignId = fnhNewCampaign.id;
            logger.info({ campaignId: fnhCampaignId, topic: fnhTopic }, "fetch_news_headlines: auto-created campaign draft");
          }
        }

        output = {
          newsHeadlines:        fnhHeadlines,
          newsTopic:            fnhTopic,
          newsContext:          fnhContext,
          newsArticleSuggestion: fnhArticle,
          hotScore:             fnhScore,
          isHot:                fnhIsHot,
          targetSector:         fnhSector,
          campaignBrief:        fnhBrief,
          campaignId:           fnhCampaignId,
        };
        break;
      }

      // ── Social Media connectors ────────────────────────────────────────────

      case "post_linkedin": {
        const accessToken = process.env.LINKEDIN_ACCESS_TOKEN;
        const orgId = interp((node.data.orgId as string | undefined) ?? "", payload)
          || process.env.LINKEDIN_ORG_ID;
        const postBody = interp(node.data.postBody as string | undefined, payload);
        const imageUrl = interpOrNull(node.data.imageUrl as string | undefined, payload);

        if (!accessToken) {
          nodeError = true;
          output = { error: "post_linkedin: LINKEDIN_ACCESS_TOKEN secret is not set" };
        } else if (!orgId) {
          nodeError = true;
          output = { error: "post_linkedin: orgId must be configured on the node or via the LINKEDIN_ORG_ID secret" };
        } else if (!postBody?.trim()) {
          nodeError = true;
          output = { error: "post_linkedin: postBody is empty — configure the post body field on this node" };
        } else {
          // Optionally upload an image and attach it to the post
          let shareMediaCategory: string = "NONE";
          let mediaItems: unknown[] = [];
          let imageUploadWarning: string | undefined;

          if (imageUrl) {
            try {
              // Step 1: Register upload intent with LinkedIn Assets API
              type LiRegResp = {
                value?: {
                  uploadMechanism?: {
                    "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"?: { uploadUrl?: string };
                  };
                  asset?: string;
                };
              };
              const regResp = await fetch("https://api.linkedin.com/v2/assets?action=registerUpload", {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${accessToken}`,
                  "Content-Type": "application/json",
                  "X-Restli-Protocol-Version": "2.0.0",
                },
                body: JSON.stringify({
                  registerUploadRequest: {
                    recipes: ["urn:li:digitalmediaRecipe:feedshare-image"],
                    owner: `urn:li:organization:${orgId}`,
                    serviceRelationships: [
                      { relationshipType: "OWNER", identifier: "urn:li:userGeneratedContent" },
                    ],
                  },
                }),
              });

              if (regResp.ok) {
                const regJson = (await regResp.json()) as LiRegResp;
                const uploadUrl =
                  regJson.value?.uploadMechanism?.[
                    "com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest"
                  ]?.uploadUrl;
                const assetUrn = regJson.value?.asset;

                if (uploadUrl && assetUrn) {
                  // Guard: LinkedIn image upload has a 10 MB limit.
                  // Check Content-Length via HEAD first so we never download an oversized file.
                  const LINKEDIN_MAX_BYTES = 10 * 1024 * 1024;
                  const liHeadResp = await fetch(imageUrl, { method: "HEAD" });
                  const liClHeader = liHeadResp.headers.get("content-length");
                  const liDeclaredBytes = liClHeader ? parseInt(liClHeader, 10) : NaN;

                  if (!isNaN(liDeclaredBytes) && liDeclaredBytes > LINKEDIN_MAX_BYTES) {
                    imageUploadWarning = `Image not attached — image is ${(liDeclaredBytes / 1024 / 1024).toFixed(1)} MB which exceeds LinkedIn's 10 MB upload limit`;
                  } else {
                    // Step 2: Download source image
                    const imgResp = await fetch(imageUrl);
                    if (!imgResp.ok) {
                      imageUploadWarning = "Image not attached — could not download image from source URL";
                    } else {
                      const imgBuf = await imgResp.arrayBuffer();
                      // Secondary size guard in case Content-Length was absent or incorrect
                      if (imgBuf.byteLength > LINKEDIN_MAX_BYTES) {
                        imageUploadWarning = `Image not attached — image is ${(imgBuf.byteLength / 1024 / 1024).toFixed(1)} MB which exceeds LinkedIn's 10 MB upload limit`;
                      } else {
                        const contentType = imgResp.headers.get("content-type") ?? "image/jpeg";

                        // Step 3: Upload binary to LinkedIn
                        const putResp = await fetch(uploadUrl, {
                          method: "PUT",
                          headers: {
                            "Authorization": `Bearer ${accessToken}`,
                            "Content-Type": contentType,
                          },
                          body: imgBuf,
                        });

                        if (putResp.ok || putResp.status === 201) {
                          shareMediaCategory = "IMAGE";
                          mediaItems = [
                            { status: "READY", description: { text: "" }, media: assetUrn, title: { text: "" } },
                          ];
                        } else {
                          imageUploadWarning = `Image not attached — LinkedIn rejected the image upload (HTTP ${putResp.status})`;
                        }
                      }
                    }
                  }
                } else {
                  imageUploadWarning = "Image not attached — LinkedIn did not return an upload URL or asset URN";
                }
              } else {
                imageUploadWarning = `Image not attached — LinkedIn asset registration failed (HTTP ${regResp.status})`;
              }
            } catch (imgErr) {
              // Image upload is best-effort — log and fall back to text-only post
              logger.warn({ err: imgErr, imageUrl }, "post_linkedin: image upload failed, falling back to text-only");
              imageUploadWarning = `Image not attached — ${imgErr instanceof Error ? imgErr.message : "upload failed"}`;
            }
          }

          const resp = await fetch("https://api.linkedin.com/v2/ugcPosts", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${accessToken}`,
              "Content-Type": "application/json",
              "X-Restli-Protocol-Version": "2.0.0",
            },
            body: JSON.stringify({
              author: `urn:li:organization:${orgId}`,
              lifecycleState: "PUBLISHED",
              specificContent: {
                "com.linkedin.ugc.ShareContent": {
                  shareCommentary: { text: postBody },
                  shareMediaCategory,
                  ...(mediaItems.length > 0 && { media: mediaItems }),
                },
              },
              visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
            }),
          });
          if (!resp.ok) {
            nodeError = true;
            const errText = await resp.text().catch(() => "");
            output = { error: `post_linkedin: LinkedIn API error ${resp.status}`, detail: errText.slice(0, 400) };
          } else {
            const postId = resp.headers.get("x-restli-id") ?? "unknown";
            const linkedinPostUrl = `https://www.linkedin.com/feed/update/${postId}`;
            output = { linkedinPostId: postId, linkedinPostUrl, ...(imageUploadWarning ? { imageUploadWarning } : {}) };
          }
        }
        break;
      }

      case "post_twitter": {
        const bearerToken   = process.env.TWITTER_BEARER_TOKEN;
        const apiKey        = process.env.TWITTER_API_KEY;
        const apiSecret     = process.env.TWITTER_API_SECRET;
        const accessToken   = process.env.TWITTER_ACCESS_TOKEN;
        const accessSecret  = process.env.TWITTER_ACCESS_TOKEN_SECRET;
        const tweetText     = interp(node.data.postBody as string | undefined, payload);
        const imageUrl      = interpOrNull(node.data.imageUrl as string | undefined, payload);

        if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
          nodeError = true;
          output = { error: "post_twitter: one or more Twitter OAuth 1.0a secrets are missing (TWITTER_API_KEY, TWITTER_API_SECRET, TWITTER_ACCESS_TOKEN, TWITTER_ACCESS_TOKEN_SECRET)" };
        } else if (!tweetText?.trim()) {
          nodeError = true;
          output = { error: "post_twitter: postBody is empty — configure the tweet text on this node" };
        } else {
          // Optionally upload an image and get a media_id to attach to the tweet
          let mediaId: string | undefined;
          let imageUploadWarning: string | undefined;

          if (imageUrl) {
            try {
              // Guard: Twitter simple upload (media_data) has a 5 MB limit.
              // Check Content-Length via HEAD first so we never download an oversized file.
              const TWITTER_MAX_BYTES = 5 * 1024 * 1024;
              const headResp = await fetch(imageUrl, { method: "HEAD" });
              const clHeader = headResp.headers.get("content-length");
              const declaredBytes = clHeader ? parseInt(clHeader, 10) : NaN;

              if (!isNaN(declaredBytes) && declaredBytes > TWITTER_MAX_BYTES) {
                imageUploadWarning = `Image not attached — image is ${(declaredBytes / 1024 / 1024).toFixed(1)} MB which exceeds Twitter's 5 MB upload limit`;
              } else {
                // Download the source image
                const imgResp = await fetch(imageUrl);
                if (!imgResp.ok) {
                  imageUploadWarning = "Image not attached — could not download image from source URL";
                } else {
                  const imgBuf = Buffer.from(await imgResp.arrayBuffer());
                  // Secondary size guard in case Content-Length was absent or incorrect
                  if (imgBuf.byteLength > TWITTER_MAX_BYTES) {
                    imageUploadWarning = `Image not attached — image is ${(imgBuf.byteLength / 1024 / 1024).toFixed(1)} MB which exceeds Twitter's 5 MB upload limit`;
                  } else {
                    const mediaData = imgBuf.toString("base64");

                    // Twitter v1.1 media/upload uses URL-encoded form; include media_data in
                    // the OAuth signature base string per the spec.
                    const uploadUrl = "https://upload.twitter.com/1.1/media/upload.json";
                    const uploadAuthHeader = await buildOAuth1Header(
                      "POST",
                      uploadUrl,
                      apiKey,
                      apiSecret,
                      accessToken,
                      accessSecret,
                      { media_data: mediaData },
                    );

                    const uploadResp = await fetch(uploadUrl, {
                      method: "POST",
                      headers: {
                        "Authorization": uploadAuthHeader,
                        "Content-Type": "application/x-www-form-urlencoded",
                      },
                      body: new URLSearchParams({ media_data: mediaData }).toString(),
                    });

                    if (uploadResp.ok) {
                      const uploadJson = (await uploadResp.json()) as { media_id_string?: string };
                      mediaId = uploadJson.media_id_string;
                      if (!mediaId) {
                        imageUploadWarning = "Image not attached — Twitter media upload succeeded but returned no media ID";
                      }
                    } else {
                      imageUploadWarning = `Image not attached — Twitter media upload failed (HTTP ${uploadResp.status})`;
                    }
                  }
                }
              }
            } catch (imgErr) {
              // Image upload is best-effort — log and fall back to text-only tweet
              logger.warn({ err: imgErr, imageUrl }, "post_twitter: image upload failed, falling back to text-only");
              imageUploadWarning = `Image not attached — ${imgErr instanceof Error ? imgErr.message : "upload failed"}`;
            }
          }

          const tweetUrl = "https://api.twitter.com/2/tweets";
          const authHeader = await buildOAuth1Header(
            "POST",
            tweetUrl,
            apiKey,
            apiSecret,
            accessToken,
            accessSecret,
          );

          const tweetBody: Record<string, unknown> = { text: tweetText };
          if (mediaId) tweetBody.media = { media_ids: [mediaId] };

          const resp = await fetch(tweetUrl, {
            method: "POST",
            headers: {
              "Authorization": authHeader,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(tweetBody),
          });

          if (!resp.ok) {
            nodeError = true;
            const errText = await resp.text().catch(() => "");
            output = { error: `post_twitter: Twitter API error ${resp.status}`, detail: errText.slice(0, 400) };
          } else {
            const json = (await resp.json()) as { data?: { id?: string } };
            const tweetId = json?.data?.id ?? "unknown";
            const twitterTweetUrl = `https://twitter.com/i/web/status/${tweetId}`;
            output = { twitterTweetId: tweetId, twitterTweetUrl, ...(imageUploadWarning ? { imageUploadWarning } : {}) };
          }
        }
        void bearerToken; // may be used for read-only calls; required secret for completeness
        break;
      }

      case "post_facebook": {
        const pageAccessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
        const pageId = interp((node.data.pageId as string | undefined) ?? "", payload)
          || process.env.FACEBOOK_PAGE_ID;
        const postBody = interp(node.data.postBody as string | undefined, payload);
        const imageUrl = interpOrNull(node.data.imageUrl as string | undefined, payload);

        if (!pageAccessToken) {
          nodeError = true;
          output = { error: "post_facebook: FACEBOOK_PAGE_ACCESS_TOKEN secret is not set" };
        } else if (!pageId) {
          nodeError = true;
          output = { error: "post_facebook: pageId must be configured on the node or via the FACEBOOK_PAGE_ID secret" };
        } else if (!postBody?.trim()) {
          nodeError = true;
          output = { error: "post_facebook: postBody is empty — configure the post body field on this node" };
        } else if (imageUrl) {
          // Guard: Facebook photo posts have a 10 MB limit.
          // Check Content-Length via HEAD first so we catch oversized images early.
          const FACEBOOK_MAX_BYTES = 10 * 1024 * 1024;
          let fbImageUploadWarning: string | undefined;
          let fbUseImage = true;
          try {
            const fbHeadResp = await fetch(imageUrl, { method: "HEAD" });
            const fbClHeader = fbHeadResp.headers.get("content-length");
            const fbDeclaredBytes = fbClHeader ? parseInt(fbClHeader, 10) : NaN;
            if (!isNaN(fbDeclaredBytes) && fbDeclaredBytes > FACEBOOK_MAX_BYTES) {
              fbImageUploadWarning = `Image not attached — image is ${(fbDeclaredBytes / 1024 / 1024).toFixed(1)} MB which exceeds Facebook's 10 MB upload limit`;
              fbUseImage = false;
            }
          } catch {
            // HEAD failed — proceed optimistically; Facebook will reject if too large
          }

          if (fbUseImage) {
            // Photo post: use /{page-id}/photos with url + caption so the image
            // is displayed inline rather than as a link card.
            try {
              const resp = await fetch(
                `https://graph.facebook.com/v19.0/${encodeURIComponent(pageId)}/photos`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ url: imageUrl, caption: postBody, access_token: pageAccessToken }),
                },
              );
              if (!resp.ok) {
                const errText = await resp.text().catch(() => "");
                logger.warn({ status: resp.status, detail: errText.slice(0, 400), imageUrl }, "post_facebook: image upload failed, falling back to text-only");
                fbImageUploadWarning = `Image not attached — Facebook Graph API rejected the image upload (HTTP ${resp.status})`;
                fbUseImage = false;
              } else {
                const json = (await resp.json()) as { id?: string; post_id?: string };
                const rawId = json?.post_id ?? json?.id ?? "unknown";
                const facebookPostUrl = `https://www.facebook.com/${rawId.replace("_", "/posts/")}`;
                output = { facebookPostId: rawId, facebookPostUrl };
              }
            } catch (imgErr) {
              logger.warn({ err: imgErr, imageUrl }, "post_facebook: image upload failed, falling back to text-only");
              fbImageUploadWarning = `Image not attached — ${imgErr instanceof Error ? imgErr.message : "upload failed"}`;
              fbUseImage = false;
            }
          }

          if (!fbUseImage && !output) {
            // Fall back to text-only post and surface the warning
            const resp = await fetch(
              `https://graph.facebook.com/v19.0/${encodeURIComponent(pageId)}/feed`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: postBody, access_token: pageAccessToken }),
              },
            );
            if (!resp.ok) {
              nodeError = true;
              const errText = await resp.text().catch(() => "");
              output = { error: `post_facebook: Facebook Graph API error ${resp.status}`, detail: errText.slice(0, 400) };
            } else {
              const json = (await resp.json()) as { id?: string };
              const rawId = json?.id ?? "unknown";
              const facebookPostUrl = `https://www.facebook.com/${rawId.replace("_", "/posts/")}`;
              output = { facebookPostId: rawId, facebookPostUrl, ...(fbImageUploadWarning ? { imageUploadWarning: fbImageUploadWarning } : {}) };
            }
          }
        } else {
          // Text-only post
          const resp = await fetch(
            `https://graph.facebook.com/v19.0/${encodeURIComponent(pageId)}/feed`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message: postBody, access_token: pageAccessToken }),
            },
          );
          if (!resp.ok) {
            nodeError = true;
            const errText = await resp.text().catch(() => "");
            output = { error: `post_facebook: Facebook Graph API error ${resp.status}`, detail: errText.slice(0, 400) };
          } else {
            const json = (await resp.json()) as { id?: string };
            const rawId = json?.id ?? "unknown";
            const facebookPostUrl = `https://www.facebook.com/${rawId.replace("_", "/posts/")}`;
            output = { facebookPostId: rawId, facebookPostUrl };
          }
        }
        break;
      }

      case "approval_gate": {
        if (dryRun) {
          output = {
            dryRun: true,
            approved: true,
            decisionNote: "dry-run — approval auto-approved",
            approverRole: (node.data.approverRole as string | undefined) ?? "admin",
          };
        } else {
          const approverRole = (node.data.approverRole as string | undefined) ?? "admin";
          const timeoutSeconds = Number(node.data.timeoutSeconds ?? 3600);
          const expiresAt = new Date(Date.now() + timeoutSeconds * 1000);
          const label = (node.data.label as string | undefined) ?? "Approval Gate";

          const [approval] = await db.insert(pendingApprovalsTable).values({
            runId,
            nodeId: node.id,
            approverRole,
            timeoutSeconds,
            status: "pending",
            context: payload,
            expiresAt,
          }).returning();

          await db.update(wfRunsTable)
            .set({ status: "awaiting_approval" })
            .where(eq(wfRunsTable.id, runId));

          const notifTitle = `Workflow approval required`;
          const notifBody = `Run #${runId} paused at "${label}" — admin action required.`;
          const notifLink = `/admin-panel/workflows/runs/${runId}`;

          try {
            const admins = await db
              .select({ id: usersTable.id })
              .from(usersTable)
              .where(eq(usersTable.role, "admin"));

            if (admins.length > 0) {
              await db.insert(notificationsTable).values(
                admins.map(a => ({
                  userId: a.id,
                  title: notifTitle,
                  body: notifBody,
                  type: "general" as const,
                  linkPath: notifLink,
                })),
              );
            }
          } catch (notifErr) {
            logger.warn({ notifErr, runId }, "approval_gate: failed to insert notifications (non-fatal)");
          }

          void sendWebPushToAdmins({ title: notifTitle, body: notifBody, linkPath: notifLink });

          output = { approvalId: approval.id, approverRole, expiresAt: expiresAt.toISOString(), label };
          // Record the node output before returning the sentinel
          const durationMs = Date.now() - startMs;
          await db.insert(wfRunNodeOutputsTable).values({
            runId,
            nodeId: node.id,
            input: payload,
            output,
            durationMs,
            status: "ok",
          }).catch(() => { });
          await db.insert(wfRunNodeLogsTable).values({
            runId,
            nodeId: node.id,
            level: "info",
            message: `approval_gate (${node.id}): run paused for approval #${approval.id}`,
          }).catch(() => { });
          // Return sentinel immediately — skip the normal log/output insert below
          const nextPayload = { ...payload, ...output, nodes: { ...((payload.nodes as Record<string, unknown>) ?? {}), [node.id]: output }, steps: { ...((payload.nodes as Record<string, unknown>) ?? {}), [node.id]: output } };
          return { output, nextPayload, cancelRun: false, nodeError: false, pauseForApproval: true };
        }
        break;
      }

      // ── Exchange Calendar nodes ────────────────────────────────────────────

      case "check_exchange_calendar_availability": {
        const { getAccessToken, graphCredentialsPresent } = await import("./graph");
        if (!graphCredentialsPresent()) {
          nodeError = true;
          output = { error: "check_exchange_calendar_availability: Graph credentials missing (GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_TENANT_ID)" };
          break;
        }
        const ecaUpn = interp(node.data.userUpn as string | undefined, payload);
        const ecaStart = interp(node.data.startDateTime as string | undefined, payload);
        const ecaEnd = interp(node.data.endDateTime as string | undefined, payload);
        if (!ecaUpn || !ecaStart || !ecaEnd) {
          nodeError = true;
          output = { error: "check_exchange_calendar_availability: userUpn, startDateTime, and endDateTime are required" };
          break;
        }
        const ecaToken = await getAccessToken();
        const ecaResp = await fetch(
          `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(ecaUpn)}/calendar/getSchedule`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${ecaToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              schedules: [ecaUpn],
              startTime: { dateTime: ecaStart, timeZone: "UTC" },
              endTime: { dateTime: ecaEnd, timeZone: "UTC" },
              availabilityViewInterval: 60,
            }),
          },
        );
        if (!ecaResp.ok) {
          nodeError = true;
          const errText = await ecaResp.text().catch(() => "");
          output = { error: `check_exchange_calendar_availability: Graph API error ${ecaResp.status}`, detail: errText.slice(0, 400) };
          break;
        }
        type ScheduleResp = { value?: Array<{ scheduleItems?: Array<{ start: { dateTime: string }; end: { dateTime: string } }>; availabilityView?: string }> };
        const ecaJson = (await ecaResp.json()) as ScheduleResp;
        const scheduleData = ecaJson.value?.[0];
        const busySlots = (scheduleData?.scheduleItems ?? []).map(
          (item) => `${item.start.dateTime} / ${item.end.dateTime}`,
        );
        const isBusy = busySlots.length > 0;
        const availabilityView = scheduleData?.availabilityView ?? "";
        const availableSlots: string[] = [];
        let freeStart: string | null = null;
        const slotStart = new Date(ecaStart);
        for (let i = 0; i < availabilityView.length; i++) {
          const slotTime = new Date(slotStart.getTime() + i * 60 * 60 * 1000).toISOString();
          const nextSlotTime = new Date(slotStart.getTime() + (i + 1) * 60 * 60 * 1000).toISOString();
          if (availabilityView[i] === "0") {
            if (!freeStart) freeStart = slotTime;
          } else {
            if (freeStart) { availableSlots.push(`${freeStart} / ${slotTime}`); freeStart = null; }
          }
          if (i === availabilityView.length - 1 && freeStart) {
            availableSlots.push(`${freeStart} / ${nextSlotTime}`);
          }
        }
        output = { isBusy, availableSlots, busySlots };
        break;
      }

      case "create_exchange_calendar_event": {
        const { getAccessToken: getExchangeToken, graphCredentialsPresent: graphCreds2 } = await import("./graph");
        if (!graphCreds2()) {
          nodeError = true;
          output = { error: "create_exchange_calendar_event: Graph credentials missing (GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_TENANT_ID)" };
          break;
        }
        const cceUpn = interp(node.data.userUpn as string | undefined, payload);
        const cceSubject = interp(node.data.subject as string | undefined, payload);
        const cceBody = interp(node.data.body as string | undefined, payload) ?? "";
        const cceStart = interp(node.data.startDateTime as string | undefined, payload);
        const cceEnd = interp(node.data.endDateTime as string | undefined, payload);
        const cceAttendeesRaw = interp(node.data.attendees as string | undefined, payload) ?? "";
        if (!cceUpn || !cceSubject || !cceStart || !cceEnd) {
          nodeError = true;
          output = { error: "create_exchange_calendar_event: userUpn, subject, startDateTime, and endDateTime are required" };
          break;
        }
        const cceAttendees = cceAttendeesRaw
          .split(",")
          .map(e => e.trim())
          .filter(Boolean)
          .map(email => ({ emailAddress: { address: email }, type: "required" }));
        const cceToken = await getExchangeToken();
        const cceResp = await fetch(
          `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cceUpn)}/events`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${cceToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              subject: cceSubject,
              body: { contentType: "text", content: cceBody },
              start: { dateTime: cceStart, timeZone: "UTC" },
              end: { dateTime: cceEnd, timeZone: "UTC" },
              ...(cceAttendees.length > 0 && { attendees: cceAttendees }),
            }),
          },
        );
        if (!cceResp.ok) {
          nodeError = true;
          const errText = await cceResp.text().catch(() => "");
          output = { error: `create_exchange_calendar_event: Graph API error ${cceResp.status}`, detail: errText.slice(0, 400) };
          break;
        }
        type EventResp = { id?: string; webLink?: string };
        const cceJson = (await cceResp.json()) as EventResp;
        output = {
          eventId: cceJson.id ?? "unknown",
          eventUrl: cceJson.webLink ?? "",
          eventWebLink: cceJson.webLink ?? "",
        };
        break;
      }

      // ── PDF generation node ────────────────────────────────────────────────

      case "generate_pdf": {
        const gpHtmlTemplate = interp(node.data.htmlTemplate as string | undefined, payload) ?? "";
        const gpFileNameRaw = interp(node.data.fileName as string | undefined, payload) ?? "document.pdf";
        const gpFileName = gpFileNameRaw.endsWith(".pdf") ? gpFileNameRaw : `${gpFileNameRaw}.pdf`;
        if (!gpHtmlTemplate.trim()) {
          nodeError = true;
          output = { error: "generate_pdf: htmlTemplate is required" };
          break;
        }
        // Use Playwright + system Chromium for faithful HTML-to-PDF rendering
        const { chromium } = await import("playwright-core");
        const gpChromiumExe = process.env.CHROMIUM_PATH
          ?? "/nix/store/qa9cnw4v5xkxyip6mb9kxqfq1z4x2dx1-chromium-138.0.7204.100/bin/chromium";
        const gpBrowser = await chromium.launch({
          executablePath: gpChromiumExe,
          args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        });
        try {
          const gpPage = await gpBrowser.newPage();
          // Detect whether the template is a full HTML document or a fragment
          const gpIsFullDoc = /^\s*<!DOCTYPE|^\s*<html/i.test(gpHtmlTemplate);
          if (gpIsFullDoc) {
            await gpPage.setContent(gpHtmlTemplate, { waitUntil: "domcontentloaded" });
          } else {
            // Wrap fragment in a minimal print-ready document
            await gpPage.setContent(
              `<!DOCTYPE html><html><head><meta charset="UTF-8">
              <style>
                body { font-family: system-ui, Arial, sans-serif; font-size: 12pt; color: #111; margin: 0; }
              </style></head><body>${gpHtmlTemplate}</body></html>`,
              { waitUntil: "domcontentloaded" },
            );
          }
          const gpPdfBytes = await gpPage.pdf({
            format: "A4",
            printBackground: true,
            margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
          });
          const pdfBase64 = Buffer.from(gpPdfBytes).toString("base64");
          const pdfDataUri = `data:application/pdf;base64,${pdfBase64}`;
          output = { pdfBase64, pdfDataUri, fileName: gpFileName };
        } finally {
          await gpBrowser.close();
        }
        break;
      }

      // ── SharePoint nodes ───────────────────────────────────────────────────

      case "save_to_sharepoint": {
        const { getAccessToken: getSPToken, graphCredentialsPresent: spCreds } = await import("./graph");
        if (!spCreds()) {
          nodeError = true;
          output = { error: "save_to_sharepoint: Graph credentials missing (GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_TENANT_ID)" };
          break;
        }
        const spSiteId = interp(node.data.siteId as string | undefined, payload);
        const spDriveId = interp(node.data.driveId as string | undefined, payload);
        const spFolderPath = interp(node.data.folderPath as string | undefined, payload) ?? "";
        const spFileName = interp(node.data.fileName as string | undefined, payload);
        const spContentBase64 = interp(node.data.fileContentBase64 as string | undefined, payload);
        const spContentText = interp(node.data.fileContentText as string | undefined, payload);
        const spContentType = (interp(node.data.contentType as string | undefined, payload) ?? "application/octet-stream");
        if (!spSiteId || !spDriveId || !spFileName) {
          nodeError = true;
          output = { error: "save_to_sharepoint: siteId, driveId, and fileName are required" };
          break;
        }
        if (!spContentBase64 && !spContentText) {
          nodeError = true;
          output = { error: "save_to_sharepoint: fileContentBase64 or fileContentText is required" };
          break;
        }
        const spToken = await getSPToken();
        let spBuffer: Buffer;
        if (spContentBase64) {
          spBuffer = Buffer.from(spContentBase64, "base64");
        } else {
          spBuffer = Buffer.from(spContentText!, "utf-8");
        }
        // Encode each path segment individually so slashes acting as separators are preserved
        const encodeSegments = (p: string) => p.split("/").map(encodeURIComponent).join("/");
        const spItemPath = spFolderPath ? `${spFolderPath.replace(/\/$/, "")}/${spFileName}` : spFileName;
        const spUploadUrl = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(spSiteId)}/drives/${encodeURIComponent(spDriveId)}/items/root:/${encodeSegments(spItemPath)}:/content`;
        const spResp = await fetch(spUploadUrl, {
          method: "PUT",
          headers: { Authorization: `Bearer ${spToken}`, "Content-Type": spContentType },
          body: spBuffer,
        });
        if (!spResp.ok) {
          nodeError = true;
          const errText = await spResp.text().catch(() => "");
          output = { error: `save_to_sharepoint: Graph API error ${spResp.status}`, detail: errText.slice(0, 400) };
          break;
        }
        type SpItem = { id?: string; webUrl?: string; "@microsoft.graph.downloadUrl"?: string };
        const spJson = (await spResp.json()) as SpItem;
        output = {
          sharePointItemId: spJson.id ?? "unknown",
          sharePointWebUrl: spJson.webUrl ?? "",
          sharePointDownloadUrl: spJson["@microsoft.graph.downloadUrl"] ?? spJson.webUrl ?? "",
        };
        break;
      }

      case "get_from_sharepoint": {
        const { getAccessToken: getGSPToken, graphCredentialsPresent: gspCreds } = await import("./graph");
        if (!gspCreds()) {
          nodeError = true;
          output = { error: "get_from_sharepoint: Graph credentials missing (GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_TENANT_ID)" };
          break;
        }
        const gspSiteId = interp(node.data.siteId as string | undefined, payload);
        const gspDriveId = interp(node.data.driveId as string | undefined, payload);
        const gspItemId = interp(node.data.itemId as string | undefined, payload);
        const gspItemPath = interp(node.data.itemPath as string | undefined, payload);
        if (!gspSiteId || !gspDriveId || (!gspItemId && !gspItemPath)) {
          nodeError = true;
          output = { error: "get_from_sharepoint: siteId, driveId, and either itemId or itemPath are required" };
          break;
        }
        const gspToken = await getGSPToken();
        // Encode path segments individually so folder separators (/) are preserved in the URL
        const gspEncodeSegments = (p: string) => p.split("/").map(encodeURIComponent).join("/");
        const gspItemUrl = gspItemId
          ? `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(gspSiteId)}/drives/${encodeURIComponent(gspDriveId)}/items/${encodeURIComponent(gspItemId)}`
          : `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(gspSiteId)}/drives/${encodeURIComponent(gspDriveId)}/items/root:/${gspEncodeSegments(gspItemPath!)}`;
        const gspMetaResp = await fetch(gspItemUrl, {
          headers: { Authorization: `Bearer ${gspToken}`, "Content-Type": "application/json" },
        });
        if (!gspMetaResp.ok) {
          nodeError = true;
          const errText = await gspMetaResp.text().catch(() => "");
          output = { error: `get_from_sharepoint: Graph API error ${gspMetaResp.status}`, detail: errText.slice(0, 400) };
          break;
        }
        type GspMeta = { id?: string; name?: string; webUrl?: string; file?: { mimeType?: string }; "@microsoft.graph.downloadUrl"?: string };
        const gspMeta = (await gspMetaResp.json()) as GspMeta;
        const gspDownloadUrl = gspMeta["@microsoft.graph.downloadUrl"];
        if (!gspDownloadUrl) {
          nodeError = true;
          output = { error: "get_from_sharepoint: item metadata did not include a download URL" };
          break;
        }
        const gspContentResp = await fetch(gspDownloadUrl);
        if (!gspContentResp.ok) {
          nodeError = true;
          output = { error: `get_from_sharepoint: download failed with HTTP ${gspContentResp.status}` };
          break;
        }
        const gspBuffer = Buffer.from(await gspContentResp.arrayBuffer());
        output = {
          fileContentBase64: gspBuffer.toString("base64"),
          fileName: gspMeta.name ?? "file",
          mimeType: gspMeta.file?.mimeType ?? "application/octet-stream",
          sharePointWebUrl: gspMeta.webUrl ?? "",
        };
        break;
      }

      // ── Stripe nodes ───────────────────────────────────────────────────────

      case "generate_invoice_stripe_payment": {
        const { getStripeKey } = await import("./stripe");
        let stripeKey: string;
        try { stripeKey = getStripeKey(); } catch (e) { nodeError = true; output = { error: String(e) }; break; }
        const { default: Stripe } = await import("stripe");
        const stripeInv = new Stripe(stripeKey);
        const invEmail = interp(node.data.customerEmail as string | undefined, payload);
        const invName = interp(node.data.customerName as string | undefined, payload) ?? "";
        const invDaysRaw = parseInt(String(node.data.daysUntilDue ?? "7"), 10);
        const invDays = isNaN(invDaysRaw) ? 7 : invDaysRaw;
        if (!invEmail) { nodeError = true; output = { error: "generate_invoice_stripe_payment: customerEmail is required" }; break; }
        let invLineItemsRaw: unknown;
        const invLineItemsStr = interp(node.data.lineItems as string | undefined, payload);
        try { invLineItemsRaw = invLineItemsStr ? JSON.parse(invLineItemsStr) : []; } catch { nodeError = true; output = { error: "generate_invoice_stripe_payment: lineItems must be valid JSON array" }; break; }
        const invLineItems = Array.isArray(invLineItemsRaw) ? invLineItemsRaw as Array<{ description?: string; amount?: number; currency?: string }> : [];
        if (invLineItems.length === 0) { nodeError = true; output = { error: "generate_invoice_stripe_payment: at least one line item is required" }; break; }
        const invCustomers = await stripeInv.customers.list({ email: invEmail, limit: 1 });
        let invCustomerId: string;
        if (invCustomers.data.length > 0) {
          invCustomerId = invCustomers.data[0].id;
        } else {
          const invCust = await stripeInv.customers.create({ email: invEmail, name: invName || undefined });
          invCustomerId = invCust.id;
        }
        const invRecord = await stripeInv.invoices.create({ customer: invCustomerId, days_until_due: invDays, collection_method: "send_invoice" });
        const invCurrency = (invLineItems[0]?.currency ?? "usd").toLowerCase();
        for (const item of invLineItems) {
          await stripeInv.invoiceItems.create({
            customer: invCustomerId,
            invoice: invRecord.id,
            description: item.description ?? "Service",
            amount: Math.round(Number(item.amount ?? 0)),
            currency: (item.currency ?? invCurrency).toLowerCase(),
          });
        }
        const finalInv = await stripeInv.invoices.finalizeInvoice(invRecord.id);
        output = {
          invoiceId: finalInv.id,
          invoiceUrl: finalInv.hosted_invoice_url ?? "",
          invoicePdfUrl: finalInv.invoice_pdf ?? "",
          amountDue: finalInv.amount_due,
          currency: finalInv.currency,
        };
        break;
      }

      case "generate_stripe_payment_link": {
        const { getStripeKey: getPlKey } = await import("./stripe");
        let plStripeKey: string;
        try { plStripeKey = getPlKey(); } catch (e) { nodeError = true; output = { error: String(e) }; break; }
        const { default: StripePl } = await import("stripe");
        const stripePl = new StripePl(plStripeKey);
        const plProductName = interp(node.data.productName as string | undefined, payload);
        const plAmount = Math.round(Number(interp(node.data.amount as string | undefined, payload) ?? node.data.amount ?? 0));
        const plCurrency = (interp(node.data.currency as string | undefined, payload) ?? "usd").toLowerCase();
        const plQuantity = Math.max(1, parseInt(String(node.data.quantity ?? "1"), 10));
        const plMetadataStr = interp(node.data.metadata as string | undefined, payload);
        let plMetadata: Record<string, string> = {};
        if (plMetadataStr) { try { plMetadata = JSON.parse(plMetadataStr) as Record<string, string>; } catch { /* ignore */ } }
        if (!plProductName || plAmount <= 0) { nodeError = true; output = { error: "generate_stripe_payment_link: productName and a positive amount (in cents) are required" }; break; }
        const plProduct = await stripePl.products.create({ name: plProductName });
        const plPrice = await stripePl.prices.create({ product: plProduct.id, unit_amount: plAmount, currency: plCurrency });
        const plLink = await stripePl.paymentLinks.create({
          line_items: [{ price: plPrice.id, quantity: plQuantity }],
          ...(Object.keys(plMetadata).length > 0 && { metadata: plMetadata }),
        });
        output = { paymentLinkId: plLink.id, paymentLinkUrl: plLink.url };
        break;
      }

      // ── Phased invoice creation (20%+per-phase billing) ────────────────────

      case "create_phased_invoices": {
        const { getStripeKey: getCpiKey } = await import("./stripe");
        let cpiStripeKey: string;
        try { cpiStripeKey = getCpiKey(); } catch (e) { nodeError = true; output = { error: String(e) }; break; }
        const { default: StripeCpi } = await import("stripe");
        const stripeCpi = new StripeCpi(cpiStripeKey);

        const cpiProjectIdRaw = interp(node.data.projectId as string | undefined, payload);
        const cpiProjectId = cpiProjectIdRaw ? parseInt(cpiProjectIdRaw, 10) : NaN;
        if (isNaN(cpiProjectId)) { nodeError = true; output = { error: "create_phased_invoices: projectId is required" }; break; }

        const cpiEmail = interp(node.data.clientEmail as string | undefined, payload) ?? String(payload.clientEmail ?? "");
        const cpiName  = interp(node.data.clientName  as string | undefined, payload) ?? String(payload.clientName  ?? "");
        const cpiDepositSessionId = interp(node.data.depositSessionId as string | undefined, payload) ?? String(payload.stripeSessionId ?? "");

        if (!cpiEmail) { nodeError = true; output = { error: "create_phased_invoices: clientEmail is required" }; break; }
        if (!cpiDepositSessionId) { nodeError = true; output = { error: "create_phased_invoices: depositSessionId is required" }; break; }

        // Retrieve the deposit checkout session to extract the confirmed payment method.
        // This MUST succeed — the workflow is triggered from checkout.session.completed,
        // so the payment_intent is complete and the payment_method is guaranteed to be set.
        // Treat failure as a hard node error so the workflow log shows a clear failure
        // rather than silently creating invoices that can never be auto-charged.
        let cpiPaymentMethodId: string | null = null;
        try {
          const cpiSession = await stripeCpi.checkout.sessions.retrieve(cpiDepositSessionId, {
            expand: ["payment_intent"],
          });
          const pi = cpiSession.payment_intent;
          if (pi && typeof pi === "object") {
            cpiPaymentMethodId = typeof pi.payment_method === "string"
              ? pi.payment_method
              : (pi.payment_method as { id?: string } | null)?.id ?? null;
          }
          if (!cpiPaymentMethodId) {
            nodeError = true;
            output = { error: `create_phased_invoices: deposit session ${cpiDepositSessionId} has no confirmed payment method — invoices NOT created to prevent unchargeable drafts` };
            break;
          }
        } catch (e) {
          nodeError = true;
          output = { error: `create_phased_invoices: failed to retrieve deposit session payment method: ${String(e)}` };
          break;
        }

        // Look up or create the Stripe Customer
        const cpiCustomers = await stripeCpi.customers.list({ email: cpiEmail, limit: 1 });
        let cpiCustomerId: string;
        if (cpiCustomers.data.length > 0) {
          cpiCustomerId = cpiCustomers.data[0].id;
        } else {
          const cpiCust = await stripeCpi.customers.create({ email: cpiEmail, name: cpiName || undefined });
          cpiCustomerId = cpiCust.id;
        }

        // Attach payment method as customer default so future auto-charges work
        if (cpiPaymentMethodId) {
          try {
            await stripeCpi.paymentMethods.attach(cpiPaymentMethodId, { customer: cpiCustomerId });
          } catch { /* already attached */ }
          await stripeCpi.customers.update(cpiCustomerId, {
            invoice_settings: { default_payment_method: cpiPaymentMethodId },
          });
        }

        // Retrieve the presentation for this project to get the phased payment schedule
        const cpiPresRows = await db
          .select({
            id: quickWinPresentationsTable.id,
            paymentSchedule: quickWinPresentationsTable.paymentSchedule,
          })
          .from(quickWinPresentationsTable)
          .where(eq(quickWinPresentationsTable.projectId, cpiProjectId))
          .limit(1);

        type CpiPhaseEntry = { phaseId: string; phaseTitle: string; amount: number; status: string };
        type CpiPaymentSchedule = { deposit?: number; phases?: CpiPhaseEntry[] };

        const cpiSchedule = cpiPresRows[0]?.paymentSchedule as CpiPaymentSchedule | null;
        const cpiPhases = cpiSchedule?.phases ?? [];

        if (cpiPhases.length === 0) {
          nodeError = true;
          output = { error: "create_phased_invoices: no phased payment schedule found for project — ensure checkout was completed with paymentPlan=phased" };
          break;
        }

        // Look up workflow_steps for this project.
        // Phase IDs in paymentSchedule use synthetic "sow-0", "sow-1", ... identifiers
        // (not DB primary keys) — match by title first, then by SOW index order as fallback.
        const cpiSteps = await db
          .select({ id: workflowStepsTable.id, title: workflowStepsTable.title, dueDate: workflowStepsTable.dueDate, order: workflowStepsTable.order })
          .from(workflowStepsTable)
          .where(eq(workflowStepsTable.projectId, cpiProjectId))
          .orderBy(workflowStepsTable.order);

        // Build lookup: title (normalised) → step
        const cpiStepByTitle = new Map(cpiSteps.map(s => [s.title.trim().toLowerCase(), s]));
        // Build lookup: sow index → step (fallback when title doesn't match)
        const cpiStepByIndex = new Map(cpiSteps.map((s, i) => [`sow-${i}`, s]));

        const cpiInvoiceIds: string[] = [];
        let cpiTotalScheduled = 0;

        for (const phase of cpiPhases) {
          const cpiAmountCents = Math.round(phase.amount * 100);
          if (cpiAmountCents <= 0) continue;
          // Match by title first (most reliable), fall back to sow-{index} position
          const cpiStep =
            cpiStepByTitle.get(phase.phaseTitle.trim().toLowerCase()) ??
            cpiStepByIndex.get(phase.phaseId);
          const cpiDueDate = cpiStep?.dueDate;

          // Create a draft invoice (auto_advance: false = stays as draft until we finalize it)
          const cpiInvoice = await stripeCpi.invoices.create({
            customer: cpiCustomerId,
            collection_method: "charge_automatically",
            auto_advance: false,
            metadata: {
              phaseId: phase.phaseId,
              phaseTitle: phase.phaseTitle,
              projectId: String(cpiProjectId),
              ...(cpiDueDate ? { phaseDueDate: cpiDueDate.toISOString() } : {}),
            },
          });
          await stripeCpi.invoiceItems.create({
            customer: cpiCustomerId,
            invoice: cpiInvoice.id,
            description: `Phase: ${phase.phaseTitle}`,
            amount: cpiAmountCents,
            currency: "usd",
          });

          cpiInvoiceIds.push(cpiInvoice.id);
          cpiTotalScheduled += cpiAmountCents;

          // Write the stripeInvoiceId back to the matching workflow_step row
          if (cpiStep) {
            await db
              .update(workflowStepsTable)
              .set({ stripeInvoiceId: cpiInvoice.id })
              .where(eq(workflowStepsTable.id, cpiStep.id));
          }
        }

        output = {
          invoiceIds: cpiInvoiceIds,
          phaseCount: cpiInvoiceIds.length,
          totalScheduled: cpiTotalScheduled,
        };
        break;
      }

      // ── Charge a draft Stripe invoice (phased auto-charge) ─────────────────

      case "charge_stripe_invoice": {
        const { getStripeKey: getCsiKey } = await import("./stripe");
        let csiStripeKey: string;
        try { csiStripeKey = getCsiKey(); } catch (e) { nodeError = true; output = { error: String(e) }; break; }
        const { default: StripeCsi } = await import("stripe");
        const stripeCsi = new StripeCsi(csiStripeKey);

        const csiInvoiceId = interp(node.data.invoiceId as string | undefined, payload) ?? String(payload.stripeInvoiceId ?? "");
        if (!csiInvoiceId) { nodeError = true; output = { error: "charge_stripe_invoice: invoiceId is required" }; break; }

        try {
          // Finalize the draft invoice (makes it ready to be paid)
          await stripeCsi.invoices.finalizeInvoice(csiInvoiceId, { auto_advance: false });
          // Immediately charge the customer's default payment method
          const csiPaid = await stripeCsi.invoices.pay(csiInvoiceId);
          // The Stripe SDK types don't always reflect expanded fields; cast to any to access payment_intent
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const csiRaw = csiPaid as any;
          const csiPiRaw = csiRaw.payment_intent;
          const csiPaymentIntentId = typeof csiPiRaw === "string" ? csiPiRaw : (csiPiRaw as { id?: string } | null)?.id ?? null;
          output = {
            chargeStatus: csiPaid.status === "paid" ? "succeeded" : "failed",
            amountCharged: csiPaid.amount_paid,
            stripePaymentIntentId: csiPaymentIntentId,
          };
        } catch (csiErr) {
          // Card declined, insufficient funds, etc. — return failure status instead of throwing
          const csiErrMsg = csiErr instanceof Error ? csiErr.message : String(csiErr);
          logger.warn({ invoiceId: csiInvoiceId, err: csiErr }, "charge_stripe_invoice: charge failed");
          output = {
            chargeStatus: "failed",
            amountCharged: 0,
            stripePaymentIntentId: null,
            error: csiErrMsg,
          };
        }
        break;
      }

      // ── Client Proposal Presentation node ─────────────────────────────────

      case "build_presentation": {
        // Helper: escape user-controlled strings before inserting into HTML
        const bpEsc = (s: string) =>
          s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

        const bpClientName = bpEsc(interp(node.data.clientName as string | undefined, payload) ?? "Valued Client");
        const bpClientEmail = bpEsc(interp(node.data.clientEmail as string | undefined, payload) ?? "");
        const bpProjectTitle = bpEsc(interp(node.data.projectTitle as string | undefined, payload) ?? "Microsoft 365 Engagement Proposal");
        // Validate checkoutUrl — only allow https: URLs to prevent javascript: injection
        const bpCheckoutUrlRaw = interp(node.data.checkoutUrl as string | undefined, payload) ?? "";
        const bpCheckoutUrl = /^https:\/\//i.test(bpCheckoutUrlRaw) ? bpEsc(bpCheckoutUrlRaw) : "";
        const bpValidUntil = bpEsc(interp(node.data.validUntil as string | undefined, payload) ?? "");
        const bpTotalAmount = bpEsc(interp(node.data.totalAmount as string | undefined, payload) ?? String(node.data.totalAmount ?? ""));
        const bpCurrency = bpEsc((interp(node.data.currency as string | undefined, payload) ?? "usd").toUpperCase());

        let bpScores: Record<string, number> = {};
        const bpScoresStr = interp(node.data.scores as string | undefined, payload);
        try { if (bpScoresStr) bpScores = JSON.parse(bpScoresStr) as Record<string, number>; } catch { /* ignore */ }

        let bpDocuments: Array<{ name: string; description?: string }> = [];
        const bpDocumentsStr = interp(node.data.documents as string | undefined, payload);
        try { if (bpDocumentsStr) bpDocuments = JSON.parse(bpDocumentsStr) as Array<{ name: string; description?: string }>; } catch { /* ignore */ }

        let bpLineItems: Array<{ label: string; amount: string | number }> = [];
        const bpLineItemsStr = interp(node.data.lineItems as string | undefined, payload);
        try { if (bpLineItemsStr) bpLineItems = JSON.parse(bpLineItemsStr) as Array<{ label: string; amount: string | number }>; } catch { /* ignore */ }

        const bpGeneratedAt = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

        const bpScoreRows = Object.entries(bpScores)
          .map(([cat, score]) => {
            const pct = Math.min(100, Math.max(0, Number(score)));
            const color = pct >= 70 ? "#00B4D8" : pct >= 40 ? "#F59E0B" : "#EF4444";
            return `<tr><td style="padding:8px 12px;border-bottom:1px solid #1C2128;color:#C9D1D9">${bpEsc(cat)}</td><td style="padding:8px 12px;border-bottom:1px solid #1C2128"><div style="background:#1C2128;border-radius:4px;height:8px;overflow:hidden"><div style="background:${color};height:100%;width:${pct}%"></div></div></td><td style="padding:8px 12px;border-bottom:1px solid #1C2128;color:${color};font-weight:600;text-align:right">${pct}%</td></tr>`;
          })
          .join("");

        const bpDocRows = bpDocuments
          .map(doc => `<tr><td style="padding:8px 12px;border-bottom:1px solid #1C2128;color:#C9D1D9;font-weight:600">✓ ${bpEsc(doc.name)}</td><td style="padding:8px 12px;border-bottom:1px solid #1C2128;color:#7D8590">${bpEsc(doc.description ?? "")}</td></tr>`)
          .join("");

        const bpPriceRows = bpLineItems
          .map(item => `<tr><td style="padding:8px 12px;border-bottom:1px solid #1C2128;color:#C9D1D9">${bpEsc(String(item.label))}</td><td style="padding:8px 12px;border-bottom:1px solid #1C2128;color:#E6EDF3;text-align:right;font-weight:600">${bpCurrency} ${Number(item.amount).toLocaleString()}</td></tr>`)
          .join("");

        const bpHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${bpProjectTitle} — Shane McCaw Consulting</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #0D1117; color: #E6EDF3; line-height: 1.6; }
  .container { max-width: 800px; margin: 0 auto; padding: 40px 20px; }
  .header { background: linear-gradient(135deg, #0A2540 0%, #0D1117 100%); border: 1px solid #30363D; border-radius: 16px; padding: 48px 40px; margin-bottom: 32px; text-align: center; }
  .logo { color: #0078D4; font-size: 14px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 16px; }
  h1 { font-size: 32px; font-weight: 700; color: #E6EDF3; margin-bottom: 8px; }
  .subtitle { color: #7D8590; font-size: 16px; }
  .prepared-for { margin-top: 24px; padding: 16px; background: rgba(0,120,212,0.1); border: 1px solid rgba(0,120,212,0.3); border-radius: 8px; }
  .prepared-for p { color: #7D8590; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
  .prepared-for strong { color: #E6EDF3; font-size: 20px; }
  .card { background: #161B22; border: 1px solid #30363D; border-radius: 12px; padding: 32px; margin-bottom: 24px; }
  .card h2 { font-size: 18px; font-weight: 700; color: #0078D4; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 1px solid #30363D; }
  table { width: 100%; border-collapse: collapse; }
  .cta { text-align: center; padding: 40px; background: linear-gradient(135deg, #0A2540 0%, #0D1117 100%); border: 1px solid #0078D4; border-radius: 16px; margin-bottom: 24px; }
  .cta h2 { font-size: 24px; margin-bottom: 8px; }
  .cta p { color: #7D8590; margin-bottom: 24px; }
  .cta a { display: inline-block; background: #0078D4; color: #fff; text-decoration: none; padding: 16px 40px; border-radius: 8px; font-weight: 700; font-size: 16px; letter-spacing: 0.5px; }
  .cta a:hover { background: #006cbd; }
  .total-row td { font-weight: 700; font-size: 16px; color: #E6EDF3; padding: 12px; background: rgba(0,120,212,0.1); }
  .footer { text-align: center; color: #484F58; font-size: 12px; padding: 24px; }
  .meta { color: #7D8590; font-size: 13px; margin-top: 8px; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <div class="logo">Shane McCaw Consulting</div>
    <h1>${bpProjectTitle}</h1>
    <div class="subtitle">Microsoft 365 &amp; Copilot AI Engagement Proposal</div>
    <div class="prepared-for">
      <p>Prepared exclusively for</p>
      <strong>${bpClientName}</strong>
      <div class="meta">Generated ${bpGeneratedAt}${bpValidUntil ? ` · Valid until ${bpValidUntil}` : ""}</div>
    </div>
  </div>

  ${Object.keys(bpScores).length > 0 ? `
  <div class="card">
    <h2>📊 Assessment Scores</h2>
    <table>
      <tbody>${bpScoreRows}</tbody>
    </table>
  </div>` : ""}

  ${bpDocuments.length > 0 ? `
  <div class="card">
    <h2>📄 Deliverables Included</h2>
    <table>
      <tbody>${bpDocRows}</tbody>
    </table>
  </div>` : ""}

  ${bpLineItems.length > 0 ? `
  <div class="card">
    <h2>💰 Investment Breakdown</h2>
    <table>
      <tbody>
        ${bpPriceRows}
        ${bpTotalAmount ? `<tr class="total-row"><td>Total Investment</td><td style="text-align:right">${bpCurrency} ${Number(bpTotalAmount).toLocaleString()}</td></tr>` : ""}
      </tbody>
    </table>
  </div>` : ""}

  ${bpCheckoutUrl ? `
  <div class="cta">
    <h2>Ready to get started?</h2>
    <p>Click below to review and complete your secure checkout</p>
    <a href="${bpCheckoutUrl}" target="_blank" rel="noopener noreferrer">Accept Proposal &amp; Pay Securely →</a>
  </div>` : ""}

  <div class="footer">
    <p>Shane McCaw Consulting · Lead Microsoft 365 Architect</p>
    <p style="margin-top:4px">This proposal is confidential and prepared exclusively for ${bpClientName}.</p>
  </div>
</div>
</body>
</html>`;

        const bpExpiresAt = bpValidUntil ? new Date(bpValidUntil) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const [bpRecord] = await db.insert(clientPresentationsTable).values({
          clientEmail: bpClientEmail || "unknown@example.com",
          projectTitle: bpProjectTitle,
          html: bpHtml,
          checkoutUrl: bpCheckoutUrl || null,
          expiresAt: bpExpiresAt,
        }).returning();

        const bpDomains = process.env.REPLIT_DOMAINS ?? "";
        const bpIsProd = bpDomains.length > 0 && bpDomains.split(",").some(d => !d.trim().endsWith(".replit.dev"));
        const bpBaseUrl = bpIsProd
          ? `https://${bpDomains.split(",")[0].trim()}`
          : `https://${bpDomains.split(",")[0]?.trim() ?? "localhost"}`;
        const bpPresentationUrl = `${bpBaseUrl}/api/presentations/${bpRecord.id}`;

        output = {
          presentationHtml: bpHtml,
          presentationUrl: bpPresentationUrl,
          presentationId: bpRecord.id,
        };
        break;
      }

      case "report_progress": {
        const rawMsg = (node.data.message as string | undefined) ?? "Progress update";
        const progressMsg = interp(rawMsg, payload) ?? rawMsg;
        // Step and Total support {{variable}} expressions — resolve them against payload first
        const rawStep  = node.data.step  != null ? String(node.data.step)  : undefined;
        const rawTotal = node.data.total != null ? String(node.data.total) : undefined;
        const stepVal  = rawStep  ? Number(interp(rawStep,  payload) ?? rawStep)  : undefined;
        const totalVal = rawTotal ? Number(interp(rawTotal, payload) ?? rawTotal) : undefined;
        const meta: Record<string, unknown> = {};
        if (stepVal  != null && !isNaN(stepVal))  meta.step  = stepVal;
        if (totalVal != null && !isNaN(totalVal)) meta.total = totalVal;
        const hasMeta = Object.keys(meta).length > 0;
        await db.insert(wfRunNodeLogsTable).values({
          runId,
          nodeId: node.id,
          level: "progress",
          message: progressMsg,
          ...(hasMeta ? { metadata: meta } : {}),
        }).catch(() => { /* non-fatal */ });
        output = {};
        break;
      }

      default:
        logger.warn({ nodeType: node.type, nodeId: node.id, runId }, "workflow-executor: unrecognised node type — setting error output");
        nodeError = true;
        output = { error: true, reason: `unknown node type: ${node.type}` };
    }
  } catch (err) {
    nodeError = true;
    output = { error: String(err), nodeType: node.type };
  }

  const durationMs = Date.now() - startMs;
  const status = nodeError ? "error" : "ok";

  await db.insert(wfRunNodeOutputsTable).values({
    runId,
    nodeId: node.id,
    input: payload,
    output,
    durationMs,
    status,
    errorMessage: nodeError ? (output.error as string ?? "node error") : null,
  }).catch(() => { /* non-fatal */ });

  const completionMeta: Record<string, unknown> | undefined =
    !nodeError &&
    (node.data?.actionType as string) === "calculate_pricing" &&
    output.totalPrice != null
      ? { totalPrice: output.totalPrice as number, lineCount: output.lineCount as number }
      : undefined;

  await db.insert(wfRunNodeLogsTable).values({
    runId,
    nodeId: node.id,
    level: nodeError ? "error" : "info",
    message: nodeError
      ? `Node ${node.type} (${node.id}) failed: ${output.error ?? "error"}`
      : `Node ${node.type} (${node.id}) completed in ${durationMs}ms`,
    ...(completionMeta ? { metadata: completionMeta } : {}),
  }).catch(() => { /* non-fatal */ });

  const prevNodes = (payload.nodes as Record<string, unknown>) ?? {};
  const updatedNodes = { ...prevNodes, [node.id]: output };
  const nextPayload = {
    ...payload,
    // Spread output at top level so downstream nodes can read directly
    // (e.g. {{articleTitle}} after generate_article, {{changeCount}} after
    // generate_diff_report). Top-level keys from earlier nodes are overwritten
    // only when a later node emits the same key name.
    ...output,
    nodes: updatedNodes,
    // `steps` is a canonical downstream reference namespace so workflow authors
    // can chain outputs using {{steps.<nodeId>.<key>}} in subsequent nodes.
    steps: updatedNodes,
  };

  return { output, nextPayload, cancelRun, nodeError, conditionResult, switchChosenHandle };
}

// ── ForEach item sub-graph executor ──────────────────────────────────────────
// Runs a mini-BFS over a restricted set of nodes (the foreach loop body) for a
// single array element. Handles condition/switch_case branching within the
// subgraph, skips edges that leave the subgraph boundary, and returns the
// merged payload produced by all executed nodes.

async function executeItemSubgraph(
  graph: WfGraph,
  subgraphNodeIdSet: Set<string>,
  startNodeIds: string[],
  itemPayload: Record<string, unknown>,
  runId: number,
  dryRun: boolean,
  inputValues: Record<string, string | string[]>,
  definitionId?: number,
): Promise<{
  payload: Record<string, unknown>;
  lastOutput: Record<string, unknown>;
  cancelRun: boolean;
  nodeError: boolean;
  errorOutput?: Record<string, unknown>;
  failedNodeId?: string;
}> {
  const subNodes = graph.nodes.filter(n => subgraphNodeIdSet.has(n.id));
  const subNodeMap = new Map(subNodes.map(n => [n.id, n]));
  // Only edges whose source AND target are both inside the subgraph
  const subEdges = graph.edges.filter(
    e => subgraphNodeIdSet.has(e.source) && subgraphNodeIdSet.has(e.target),
  );

  // In-degree within the subgraph only
  const subInDegree = new Map<string, number>();
  for (const n of subNodes) subInDegree.set(n.id, 0);
  for (const e of subEdges) subInDegree.set(e.target, (subInDegree.get(e.target) ?? 0) + 1);

  const subResolved = new Map<string, number>();
  const subActive   = new Map<string, number>();
  for (const n of subNodes) { subResolved.set(n.id, 0); subActive.set(n.id, 0); }

  const subQueue: Array<{ nodeId: string; skip: boolean }> = [];

  function subResolveEdge(targetId: string, active: boolean) {
    if (!subgraphNodeIdSet.has(targetId)) return;
    if (active) subActive.set(targetId, (subActive.get(targetId) ?? 0) + 1);
    const r = (subResolved.get(targetId) ?? 0) + 1;
    subResolved.set(targetId, r);
    if (r === (subInDegree.get(targetId) ?? 0)) {
      subQueue.push({ nodeId: targetId, skip: (subActive.get(targetId) ?? 0) === 0 });
    }
  }

  // Seed start nodes directly (they were entered from the foreach item handle)
  for (const id of startNodeIds) {
    if (subgraphNodeIdSet.has(id)) subQueue.push({ nodeId: id, skip: false });
  }

  let currentPayload = { ...itemPayload };
  // Tracks the raw output of the last node that actually executed this iteration.
  // collectedResults stores this per iteration (not the full merged payload).
  let lastOutput: Record<string, unknown> = {};

  while (subQueue.length > 0) {
    const { nodeId, skip } = subQueue.shift()!;
    const node = subNodeMap.get(nodeId);
    if (!node) continue;

    if (skip) {
      for (const e of subEdges.filter(e => e.source === nodeId)) subResolveEdge(e.target, false);
      continue;
    }

    const { output, nextPayload, cancelRun, nodeError, conditionResult, switchChosenHandle } =
      await executeNode(node, currentPayload, runId, dryRun, inputValues, definitionId);
    currentPayload = nextPayload;
    lastOutput = output;

    // cancel_workflow inside the loop body must bubble up to cancel the whole run
    if (cancelRun) return { payload: currentPayload, lastOutput, cancelRun: true, nodeError: false };

    if (nodeError) {
      const outEdges = subEdges.filter(e => e.source === nodeId);
      const errorEdge = outEdges.find(e => e.sourceHandle === "error" || e.sourceHandle === "onError");
      if (errorEdge) {
        // Route to the in-subgraph error handler and continue
        for (const e of outEdges) subResolveEdge(e.target, e.target === errorEdge.target);
        continue;
      }
      // No error handler in subgraph — surface as a run failure (mirrors main BFS behaviour)
      return { payload: currentPayload, lastOutput, cancelRun: false, nodeError: true, errorOutput: output, failedNodeId: nodeId };
    }

    if (node.type === "condition" && conditionResult !== undefined) {
      const outEdges  = subEdges.filter(e => e.source === nodeId);
      const trueEdge  = outEdges.find(e => e.sourceHandle === "true");
      const falseEdge = outEdges.find(e => e.sourceHandle === "false");
      for (const e of outEdges) {
        subResolveEdge(e.target, conditionResult ? e.id === trueEdge?.id : e.id === falseEdge?.id);
      }
      continue;
    }

    if (node.type === "switch_case" && switchChosenHandle !== undefined) {
      for (const e of subEdges.filter(e => e.source === nodeId)) {
        subResolveEdge(e.target, e.sourceHandle === switchChosenHandle);
      }
      continue;
    }

    for (const e of subEdges.filter(e => e.source === nodeId)) subResolveEdge(e.target, true);
  }

  return { payload: currentPayload, lastOutput, cancelRun: false, nodeError: false };
}

// ── Concurrency check (read-only) ─────────────────────────────────────────────

async function countRunningRuns(definitionId: number): Promise<number> {
  const rows = await db
    .select({ cnt: count() })
    .from(wfRunsTable)
    .where(and(
      eq(wfRunsTable.definitionId, definitionId),
      eq(wfRunsTable.status, "running"),
    ));
  return Number(rows[0]?.cnt ?? 0);
}

// ── Main executor ─────────────────────────────────────────────────────────────
// Edge-based BFS that correctly handles converging branches.

export async function executeWorkflowRun(
  runId: number,
  opts: { inlineGraph?: WfGraph; dryRun?: boolean; inputValues?: Record<string, string | string[]> } = {},
): Promise<void> {
  const runRows = await db.select().from(wfRunsTable).where(eq(wfRunsTable.id, runId)).limit(1);
  const run = runRows[0];
  if (!run) { logger.warn({ runId }, "wf-executor: run not found"); return; }

  const versionRows = await db.select().from(wfVersionsTable).where(eq(wfVersionsTable.id, run.versionId)).limit(1);
  const version = versionRows[0];
  if (!version) {
    await db.update(wfRunsTable).set({ status: "failed", errorMessage: "Version not found", finishedAt: new Date() }).where(eq(wfRunsTable.id, runId));
    return;
  }

  await db.update(wfRunsTable).set({ status: "running", startedAt: new Date() }).where(eq(wfRunsTable.id, runId));

  // opts.inlineGraph overrides the stored version graph (used by draft test runs)
  const graph: WfGraph = opts.inlineGraph ?? ((version.graph as WfGraph) ?? { nodes: [], edges: [] });
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));

  // Compute in-degrees
  const inDegree = new Map<string, number>();
  for (const n of graph.nodes) inDegree.set(n.id, 0);
  for (const e of graph.edges) inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);

  // Per-node activation counters
  const resolvedCount = new Map<string, number>();
  const activeCount   = new Map<string, number>();
  for (const n of graph.nodes) { resolvedCount.set(n.id, 0); activeCount.set(n.id, 0); }

  const branchPath: string[] = [];
  let payload: Record<string, unknown> = { ...(run.payload as Record<string, unknown> ?? {}) };

  // Queue holds { nodeId, skip } — skip=true when all predecessors were skipped
  const readyQueue: Array<{ nodeId: string; skip: boolean }> = [];

  function resolveEdge(targetId: string, active: boolean) {
    if (active) activeCount.set(targetId, (activeCount.get(targetId) ?? 0) + 1);
    const r = (resolvedCount.get(targetId) ?? 0) + 1;
    resolvedCount.set(targetId, r);
    const total = inDegree.get(targetId) ?? 0;
    if (r === total) {
      readyQueue.push({ nodeId: targetId, skip: (activeCount.get(targetId) ?? 0) === 0 });
    }
  }

  // Seed with root nodes (no predecessors)
  for (const n of graph.nodes) {
    if ((inDegree.get(n.id) ?? 0) === 0) readyQueue.push({ nodeId: n.id, skip: false });
  }

  try {
    while (readyQueue.length > 0) {
      const item = readyQueue.shift()!;
      const { nodeId } = item;
      const node = nodeMap.get(nodeId);
      if (!node) continue;

      // Periodically check external cancellation
      const freshStatus = await db.select({ status: wfRunsTable.status }).from(wfRunsTable).where(eq(wfRunsTable.id, runId)).limit(1);
      if (freshStatus[0]?.status === "cancelled") { logger.info({ runId, nodeId }, "wf-executor: cancelled mid-execution"); return; }

      // ── Skip path: node is reachable only through skipped predecessors ──
      if (item.skip) {
        await db.insert(wfRunNodeOutputsTable).values({
          runId, nodeId, input: payload, output: { skipped: true }, status: "skipped",
        }).catch(() => { });
        for (const e of graph.edges.filter(edge => edge.source === nodeId)) {
          resolveEdge(e.target, false);
        }
        continue;
      }

      // ── Execute ──
      branchPath.push(nodeId);

      const { output, nextPayload, cancelRun, nodeError, conditionResult, switchChosenHandle, pauseForApproval } = await executeNode(node, payload, runId, opts.dryRun ?? false, opts.inputValues ?? {}, run.definitionId);
      payload = nextPayload;

      await db.update(wfRunsTable).set({ branchPath: branchPath as unknown as string[] }).where(eq(wfRunsTable.id, runId));

      // Approval gate paused — exit BFS cleanly; run status already set to awaiting_approval
      if (pauseForApproval) {
        logger.info({ runId, nodeId }, "wf-executor: run paused at approval_gate");
        return;
      }

      // Cancel
      if (cancelRun) {
        await db.update(wfRunsTable).set({ status: "cancelled", finishedAt: new Date(), branchPath: branchPath as unknown as string[] }).where(eq(wfRunsTable.id, runId));
        await db.insert(wfRunNodeLogsTable).values({ runId, nodeId, level: "info", message: "Run cancelled" }).catch(() => { });
        return;
      }

      // Node error: route to error-handle edge if present, otherwise fail
      if (nodeError) {
        const outEdges = graph.edges.filter(e => e.source === nodeId);
        const errorEdge = outEdges.find(e => e.sourceHandle === "error" || e.sourceHandle === "onError");
        if (errorEdge) {
          for (const e of outEdges) resolveEdge(e.target, e.target === errorEdge.target);
        } else {
          // Broadcast phase_gen error to the client SSE channel so the UI can show the escape hatch
          const rawPresId = payload.presentationId;
          const presId = typeof rawPresId === "number" ? rawPresId : typeof rawPresId === "string" ? parseInt(rawPresId, 10) : NaN;
          if (!isNaN(presId)) {
            broadcastPresentationPhaseGenError(presId, (output.error as string) ?? `Step failed: ${nodeId}`);
          }
          await db.update(wfRunsTable).set({
            status: "failed", finishedAt: new Date(),
            errorMessage: (output.error as string) ?? `Node ${nodeId} failed`,
            branchPath: branchPath as unknown as string[],
          }).where(eq(wfRunsTable.id, runId));
          logger.warn({ runId, nodeId }, "wf-executor: node error, no handler — run failed");
          return;
        }
        continue;
      }

      // Condition: route true/false/cancel branches
      // cancel handle: when condition is false AND a cancel edge exists → cancel run immediately
      if (node.type === "condition" && conditionResult !== undefined) {
        const outEdges  = graph.edges.filter(e => e.source === nodeId);
        const trueEdge  = outEdges.find(e => e.sourceHandle === "true" || (!e.sourceHandle && !outEdges.find(x => x.sourceHandle === "true")));
        const falseEdge = outEdges.find(e => e.sourceHandle === "false");
        const cancelEdge = outEdges.find(e => e.sourceHandle === "cancel");

        if (!conditionResult && cancelEdge) {
          // Explicit cancel branch — cancel the run immediately, skip all successors
          await db.update(wfRunsTable).set({
            status: "cancelled", finishedAt: new Date(), branchPath: branchPath as unknown as string[],
          }).where(eq(wfRunsTable.id, runId));
          await db.insert(wfRunNodeLogsTable).values({
            runId, nodeId, level: "info", message: "Run cancelled via explicit cancel edge",
          }).catch(() => { });
          return;
        }

        for (const e of outEdges) {
          const isTaken = conditionResult ? (e.id === trueEdge?.id) : (e.id === falseEdge?.id);
          resolveEdge(e.target, isTaken);
        }
        continue;
      }

      // Switch/Case: route only the matching case branch (or default)
      if (node.type === "switch_case" && switchChosenHandle !== undefined) {
        const outEdges = graph.edges.filter(e => e.source === nodeId);
        for (const e of outEdges) {
          resolveEdge(e.target, e.sourceHandle === switchChosenHandle);
        }
        continue;
      }

      // ForEach: run item subgraph sequentially for each element, then route done edge
      if (node.type === "foreach") {
        const foreachItems = (output.foreachItems as unknown[]) ?? [];
        const itemAlias    = (output.itemAlias as string | null) ?? null;
        const outEdges     = graph.edges.filter(e => e.source === nodeId);
        // Builder persists the body edge with sourceHandle "body"; older graphs may
        // use "item". Accept both so either representation works.
        const itemEdges    = outEdges.filter(e => e.sourceHandle === "item" || e.sourceHandle === "body");
        const doneEdges    = outEdges.filter(e => e.sourceHandle === "done");

        // Collect item subgraph nodes via DFS from item-handle targets.
        // Stop at any node that is a direct target of the done handle —
        // those belong to the post-loop main flow, not the loop body.
        const doneTargetIds = new Set(doneEdges.map(e => e.target));
        const itemSubgraphIds = new Set<string>();
        const dfsStack = itemEdges.map(e => e.target);
        while (dfsStack.length > 0) {
          const nId = dfsStack.pop()!;
          if (itemSubgraphIds.has(nId) || doneTargetIds.has(nId)) continue;
          itemSubgraphIds.add(nId);
          for (const e of graph.edges.filter(e => e.source === nId)) {
            if (!itemSubgraphIds.has(e.target) && !doneTargetIds.has(e.target)) {
              dfsStack.push(e.target);
            }
          }
        }

        const itemsTotal = foreachItems.length;
        const collectedResults: Record<string, unknown>[] = [];
        const startIds = itemEdges.map(e => e.target).filter(id => itemSubgraphIds.has(id));

        logger.info({ runId, nodeId, itemsTotal, subgraphSize: itemSubgraphIds.size },
          "wf-executor: foreach starting iterations");

        for (let i = 0; i < foreachItems.length; i++) {
          const element = foreachItems[i];
          // Patch steps[nodeId] and nodes[nodeId] so that
          // {{steps.<foreachNodeId>.item}} resolves to the current element.
          // Without this, switch_case / condition nodes inside the loop body
          // that reference {{steps.node-106.item}} get undefined.
          const prevSteps = (payload.steps as Record<string, unknown>) ?? {};
          const prevNodes = (payload.nodes as Record<string, unknown>) ?? {};
          const foreachIterStep = {
            ...(prevSteps[nodeId] as Record<string, unknown> ?? {}),
            item: element,
            itemIndex: i,
            itemsTotal,
            ...(itemAlias ? { [itemAlias]: element } : {}),
          };
          const iterPayload: Record<string, unknown> = {
            ...payload,
            item: element,
            ...(itemAlias ? { [itemAlias]: element } : {}),
            itemIndex: i,
            itemsTotal,
            steps: { ...prevSteps, [nodeId]: foreachIterStep },
            nodes: { ...prevNodes, [nodeId]: foreachIterStep },
          };

          const iterResult = await executeItemSubgraph(
            graph, itemSubgraphIds, startIds, iterPayload,
            runId, opts.dryRun ?? false, opts.inputValues ?? {}, run.definitionId,
          );
          branchPath.push(...startIds.map(id => `${id}[${i}]`));

          // cancel_workflow inside a loop body cancels the whole run immediately
          if (iterResult.cancelRun) {
            await db.update(wfRunsTable).set({
              status: "cancelled", finishedAt: new Date(),
              branchPath: branchPath as unknown as string[],
            }).where(eq(wfRunsTable.id, runId));
            await db.insert(wfRunNodeLogsTable).values({
              runId, nodeId, level: "info",
              message: `Run cancelled by cancel_workflow inside foreach iteration ${i}`,
            }).catch(() => { });
            return;
          }

          // Unhandled node error in loop body fails the whole run (mirrors main BFS)
          if (iterResult.nodeError) {
            const errMsg = (iterResult.errorOutput?.error as string | undefined)
              ?? `foreach: node ${iterResult.failedNodeId ?? "unknown"} failed at iteration ${i}`;
            await db.update(wfRunsTable).set({
              status: "failed", finishedAt: new Date(), errorMessage: errMsg,
              branchPath: branchPath as unknown as string[],
            }).where(eq(wfRunsTable.id, runId));
            logger.warn({ runId, nodeId, iteration: i, failedNodeId: iterResult.failedNodeId },
              "wf-executor: foreach — node error in loop body, no handler — run failed");
            return;
          }

          // Store the terminal node's raw output (not full merged payload) so
          // {{collectedResults}} downstream contains per-iteration node outputs only.
          collectedResults.push(iterResult.lastOutput);

          logger.info({ runId, nodeId, iteration: i, itemsTotal },
            "wf-executor: foreach iteration complete");
        }

        // Update main payload with collected results
        payload = { ...payload, collectedResults, itemsTotal };

        // Prevent the main BFS from ever executing item-subgraph nodes again.
        // Setting resolvedCount above inDegree means any future resolveEdge call
        // on these nodes increments past inDegree and never re-queues them.
        for (const nId of itemSubgraphIds) {
          resolvedCount.set(nId, (inDegree.get(nId) ?? 0) + 1);
        }

        // Route done edges as active (post-loop continuation)
        for (const e of doneEdges) resolveEdge(e.target, true);

        await db.update(wfRunsTable)
          .set({ branchPath: branchPath as unknown as string[] })
          .where(eq(wfRunsTable.id, runId));

        continue;
      }

      // fetch_news_headlines: two conditional output handles:
      //   "hot"    → fires when isHot=true  (news is trending)
      //   "notHot" → fires when isHot=false (news is not trending / below threshold)
      // Edges with no sourceHandle fire unconditionally.
      if (node.type === "fetch_news_headlines") {
        const isHot = Boolean(output.isHot);
        for (const e of graph.edges.filter(edge => edge.source === nodeId)) {
          let active: boolean;
          if (e.sourceHandle === "hot") active = isHot;
          else if (e.sourceHandle === "notHot") active = !isHot;
          else active = true;
          resolveEdge(e.target, active);
        }
        continue;
      }

      // Normal: all outgoing edges are active
      for (const e of graph.edges.filter(edge => edge.source === nodeId)) {
        resolveEdge(e.target, true);
      }
    }

    await db.update(wfRunsTable).set({ status: "completed", finishedAt: new Date(), branchPath: branchPath as unknown as string[] }).where(eq(wfRunsTable.id, runId));
    logger.info({ runId, steps: branchPath.length }, "wf-executor: run completed");
  } catch (err) {
    const errMsg = String(err);
    // Broadcast phase_gen error to client SSE channel so the UI can show the escape hatch
    const rawPresId = payload.presentationId;
    const presId = typeof rawPresId === "number" ? rawPresId : typeof rawPresId === "string" ? parseInt(rawPresId, 10) : NaN;
    if (!isNaN(presId)) {
      broadcastPresentationPhaseGenError(presId, errMsg);
    }
    await db.update(wfRunsTable).set({ status: "failed", finishedAt: new Date(), errorMessage: errMsg, branchPath: branchPath as unknown as string[] }).where(eq(wfRunsTable.id, runId));
    await db.insert(wfRunNodeLogsTable).values({ runId, nodeId: "__executor__", level: "error", message: `Executor error: ${errMsg}` }).catch(() => { });
    logger.warn({ runId, err }, "wf-executor: run failed");
  }
}

// ── Approval timeout checker ──────────────────────────────────────────────────
// Called periodically to auto-reject expired pending approvals.

export async function checkApprovalTimeouts(): Promise<void> {
  try {
    const expired = await pool.query<{ id: number; run_id: number; node_id: string }>(`
      SELECT id, run_id, node_id
      FROM pending_approvals
      WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at < NOW()
    `);

    for (const row of expired.rows) {
      try {
        await pool.query(
          `UPDATE pending_approvals SET status = 'timed_out', decided_at = NOW(), decision_note = 'Auto-rejected: approval timeout elapsed' WHERE id = $1`,
          [row.id],
        );
        await db.update(wfRunsTable).set({
          status: "failed",
          finishedAt: new Date(),
          errorMessage: `Approval gate timed out for node ${row.node_id}`,
        }).where(eq(wfRunsTable.id, row.run_id));

        await db.insert(wfRunNodeLogsTable).values({
          runId: row.run_id,
          nodeId: row.node_id,
          level: "error",
          message: `approval_gate: approval timed out — run auto-rejected`,
        }).catch(() => { });

        logger.info({ approvalId: row.id, runId: row.run_id }, "approval-gate: timed out, run marked failed");
      } catch (innerErr) {
        logger.warn({ err: innerErr, approvalId: row.id }, "approval-gate: timeout processing failed (non-fatal)");
      }
    }
  } catch (err) {
    logger.warn({ err }, "approval-gate: timeout check failed (non-fatal)");
  }
}

// ── Resume workflow from approval_gate ────────────────────────────────────────
// Re-enters the BFS from the successors of the approval_gate node.

export async function resumeWorkflowRun(
  runId: number,
  approvalGateNodeId: string,
  resumePayload: Record<string, unknown>,
  decisionNote?: string,
): Promise<void> {
  const runRows = await db.select().from(wfRunsTable).where(eq(wfRunsTable.id, runId)).limit(1);
  const run = runRows[0];
  if (!run) { logger.warn({ runId }, "resumeWorkflowRun: run not found"); return; }

  const versionRows = await db.select().from(wfVersionsTable).where(eq(wfVersionsTable.id, run.versionId)).limit(1);
  const version = versionRows[0];
  if (!version) {
    await db.update(wfRunsTable).set({ status: "failed", errorMessage: "Version not found", finishedAt: new Date() }).where(eq(wfRunsTable.id, runId));
    return;
  }

  await db.update(wfRunsTable).set({ status: "running" }).where(eq(wfRunsTable.id, runId));

  const graph: WfGraph = (version.graph as WfGraph) ?? { nodes: [], edges: [] };
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));

  const inDegree = new Map<string, number>();
  for (const n of graph.nodes) inDegree.set(n.id, 0);
  for (const e of graph.edges) inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);

  const resolvedCount = new Map<string, number>();
  const activeCount   = new Map<string, number>();
  for (const n of graph.nodes) { resolvedCount.set(n.id, 0); activeCount.set(n.id, 0); }

  // Mark all nodes that were in the existing branchPath as already resolved
  const existingBranchPath = (run.branchPath as string[]) ?? [];
  const processedNodeIds = new Set(existingBranchPath.map(id => id.split("[")[0]));
  for (const nId of processedNodeIds) {
    resolvedCount.set(nId, (inDegree.get(nId) ?? 0) + 1);
  }

  const branchPath: string[] = [...existingBranchPath];
  // Inject gate-decision context so downstream nodes can read {{approved}} and {{decisionNote}}
  let payload: Record<string, unknown> = {
    ...resumePayload,
    approved: true,
    decisionNote: decisionNote ?? null,
  };

  const readyQueue: Array<{ nodeId: string; skip: boolean }> = [];

  function resolveEdge(targetId: string, active: boolean) {
    if (active) activeCount.set(targetId, (activeCount.get(targetId) ?? 0) + 1);
    const r = (resolvedCount.get(targetId) ?? 0) + 1;
    resolvedCount.set(targetId, r);
    const total = inDegree.get(targetId) ?? 0;
    if (r === total) {
      readyQueue.push({ nodeId: targetId, skip: (activeCount.get(targetId) ?? 0) === 0 });
    }
  }

  // Seed BFS with successors of the approval_gate node via the "approved" handle only
  const outEdges = graph.edges.filter(e => e.source === approvalGateNodeId);
  const approvedEdges = outEdges.filter(e => !e.sourceHandle || e.sourceHandle === "approved");
  const edgesToFollow = approvedEdges.length > 0 ? approvedEdges : outEdges;
  for (const e of edgesToFollow) {
    resolveEdge(e.target, true);
  }

  try {
    while (readyQueue.length > 0) {
      const item = readyQueue.shift()!;
      const { nodeId } = item;
      const node = nodeMap.get(nodeId);
      if (!node) continue;

      const freshStatus = await db.select({ status: wfRunsTable.status }).from(wfRunsTable).where(eq(wfRunsTable.id, runId)).limit(1);
      if (freshStatus[0]?.status === "cancelled") { logger.info({ runId, nodeId }, "wf-executor: cancelled mid-resume"); return; }

      if (item.skip) {
        await db.insert(wfRunNodeOutputsTable).values({
          runId, nodeId, input: payload, output: { skipped: true }, status: "skipped",
        }).catch(() => { });
        for (const e of graph.edges.filter(edge => edge.source === nodeId)) {
          resolveEdge(e.target, false);
        }
        continue;
      }

      branchPath.push(nodeId);

      const { output, nextPayload, cancelRun, nodeError, conditionResult, switchChosenHandle, pauseForApproval } = await executeNode(node, payload, runId, false, {}, run.definitionId);
      payload = nextPayload;

      await db.update(wfRunsTable).set({ branchPath: branchPath as unknown as string[] }).where(eq(wfRunsTable.id, runId));

      if (pauseForApproval) {
        logger.info({ runId, nodeId }, "wf-executor: resumed run paused at another approval_gate");
        return;
      }

      if (cancelRun) {
        await db.update(wfRunsTable).set({ status: "cancelled", finishedAt: new Date(), branchPath: branchPath as unknown as string[] }).where(eq(wfRunsTable.id, runId));
        return;
      }

      if (nodeError) {
        const outEdgesNode = graph.edges.filter(e => e.source === nodeId);
        const errorEdge = outEdgesNode.find(e => e.sourceHandle === "error" || e.sourceHandle === "onError");
        if (errorEdge) {
          for (const e of outEdgesNode) resolveEdge(e.target, e.target === errorEdge.target);
        } else {
          await db.update(wfRunsTable).set({
            status: "failed", finishedAt: new Date(),
            errorMessage: (output.error as string) ?? `Node ${nodeId} failed`,
            branchPath: branchPath as unknown as string[],
          }).where(eq(wfRunsTable.id, runId));
          return;
        }
        continue;
      }

      if (node.type === "condition" && conditionResult !== undefined) {
        const outEdgesNode  = graph.edges.filter(e => e.source === nodeId);
        const trueEdge  = outEdgesNode.find(e => e.sourceHandle === "true" || (!e.sourceHandle && !outEdgesNode.find(x => x.sourceHandle === "true")));
        const falseEdge = outEdgesNode.find(e => e.sourceHandle === "false");
        const cancelEdge = outEdgesNode.find(e => e.sourceHandle === "cancel");
        if (!conditionResult && cancelEdge) {
          await db.update(wfRunsTable).set({ status: "cancelled", finishedAt: new Date(), branchPath: branchPath as unknown as string[] }).where(eq(wfRunsTable.id, runId));
          return;
        }
        for (const e of outEdgesNode) {
          const isTaken = conditionResult ? (e.id === trueEdge?.id) : (e.id === falseEdge?.id);
          resolveEdge(e.target, isTaken);
        }
        continue;
      }

      if (node.type === "switch_case" && switchChosenHandle !== undefined) {
        const outEdgesNode = graph.edges.filter(e => e.source === nodeId);
        for (const e of outEdgesNode) {
          resolveEdge(e.target, e.sourceHandle === switchChosenHandle);
        }
        continue;
      }

      for (const e of graph.edges.filter(edge => edge.source === nodeId)) {
        resolveEdge(e.target, true);
      }
    }

    await db.update(wfRunsTable).set({ status: "completed", finishedAt: new Date(), branchPath: branchPath as unknown as string[] }).where(eq(wfRunsTable.id, runId));
    logger.info({ runId, steps: branchPath.length }, "wf-executor: resumed run completed");
  } catch (err) {
    const errMsg = String(err);
    await db.update(wfRunsTable).set({ status: "failed", finishedAt: new Date(), errorMessage: errMsg, branchPath: branchPath as unknown as string[] }).where(eq(wfRunsTable.id, runId));
    await db.insert(wfRunNodeLogsTable).values({ runId, nodeId: "__resume__", level: "error", message: `Resume executor error: ${errMsg}` }).catch(() => { });
    logger.warn({ runId, err }, "wf-executor: resumed run failed");
  }
}

// ── Scheduled trigger scanner ─────────────────────────────────────────────────

export async function triggerScheduledWorkflows(): Promise<void> {
  try {
    const rows = await pool.query<{
      id: number;
      definition_id: number;
      config: Record<string, unknown>;
    }>(`
      SELECT id, definition_id, config
      FROM wf_triggers
      WHERE type = 'schedule'
        AND enabled = true
        AND next_run_at IS NOT NULL
        AND next_run_at <= NOW()
    `);

    for (const trigger of rows.rows) {
      const cronExpr = trigger.config.cron as string | undefined;
      const nextRun = cronExpr ? computeNextCronRun(cronExpr) : null;

      const claimed = await pool.query(
        `UPDATE wf_triggers SET next_run_at = $1 WHERE id = $2 AND next_run_at <= NOW() RETURNING id`,
        [nextRun, trigger.id],
      );
      if (!claimed.rowCount || claimed.rowCount === 0) continue;

      // Concurrency guard: skip if a run is already in progress for this definition
      const inProgress = await pool.query<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM wf_runs WHERE definition_id = $1 AND status = 'running'`,
        [trigger.definition_id],
      );
      if (parseInt(inProgress.rows[0]?.cnt ?? "0", 10) > 0) {
        logger.warn({ triggerId: trigger.id, definitionId: trigger.definition_id }, "wf-engine: skipping scheduled trigger — run already in progress");
        continue;
      }

      const fanOutMode  = trigger.config.fan_out_mode  as string | undefined;
      const fanOutQuery = trigger.config.fan_out_query as string | undefined;

      function safeFanOutQuery(q: string): string | null {
        const t = q.trim();
        return /^SELECT\s+/i.test(t) && !t.includes(";") ? t : null;
      }

      if ((fanOutMode === "per_record" || fanOutMode === "batched") && fanOutQuery) {
        const safeQ = safeFanOutQuery(fanOutQuery);
        if (!safeQ) {
          logger.warn({ triggerId: trigger.id }, "wf-engine: fan_out_query rejected — must be a single SELECT with no semicolons");
        } else {
          try {
            const records = await pool.query(safeQ);
            if (fanOutMode === "per_record") {
              for (const row of records.rows) {
                await fireWorkflowForDefinition(trigger.definition_id, "schedule", `trigger:${trigger.id}`, row as Record<string, unknown>);
              }
              logger.info({ triggerId: trigger.id, rowCount: records.rowCount }, "wf-engine: per_record fan-out fired");
            } else {
              // batched: one run with all rows
              await fireWorkflowForDefinition(
                trigger.definition_id, "schedule", `trigger:${trigger.id}`,
                { records: records.rows as Record<string, unknown>[] },
              );
              logger.info({ triggerId: trigger.id, rowCount: records.rowCount }, "wf-engine: batched fan-out fired");
            }
          } catch (err) {
            logger.warn({ err, triggerId: trigger.id }, "wf-engine: fan_out_query execution failed (non-fatal)");
          }
        }
      } else {
        await fireWorkflowForDefinition(
          trigger.definition_id, "schedule", `trigger:${trigger.id}`,
          (trigger.config.payload as Record<string, unknown>) ?? {},
        );
      }
    }
  } catch (err) {
    logger.warn({ err }, "wf-executor: scheduled trigger scan failed (non-fatal)");
  }
}

// ── Startup trigger firing ────────────────────────────────────────────────────
// Called once on server init. Finds all enabled startup triggers and fires each
// definition once per boot. The trigger is never consumed/disabled, so a crash
// before the run is created does not permanently suppress the startup job —
// the next restart will fire it again. Same-boot double-fire is prevented by
// checking for an existing run created since BOOT_TIME.

export async function fireStartupTriggers(): Promise<void> {
  try {
    const rows = await pool.query<{ id: number; definition_id: number }>(
      `SELECT id, definition_id FROM wf_triggers WHERE type = 'startup' AND enabled = true`,
    );

    for (const trigger of rows.rows) {
      // Guard against same-boot double-fire: skip if a run for this definition
      // was already created since this server process started.
      //
      // Crucially, we do NOT consume (disable) the trigger before firing.
      // The old pattern — consuming before the run is created — meant a crash
      // in that window left the trigger consumed but the work never done.
      // With BOOT_TIME scoping, orphaned runs from a previous boot (created
      // before BOOT_TIME) are invisible to this check, so the trigger
      // re-fires correctly on every restart even if the previous boot crashed.
      const existing = await pool.query<{ id: number }>(
        `SELECT id FROM wf_runs
         WHERE definition_id = $1
           AND created_at >= $2
         LIMIT 1`,
        [trigger.definition_id, BOOT_TIME],
      );

      if ((existing.rowCount ?? 0) > 0) {
        logger.info(
          { triggerId: trigger.id, definitionId: trigger.definition_id },
          "wf-engine: startup trigger skipped — already fired this boot",
        );
        continue;
      }

      const runId = await fireWorkflowForDefinition(
        trigger.definition_id,
        "manual",
        `startup:trigger:${trigger.id}`,
        {},
      );

      logger.info({ triggerId: trigger.id, definitionId: trigger.definition_id, runId }, "wf-engine: startup trigger fired");
    }

    if (rows.rowCount && rows.rowCount > 0) {
      logger.info({ count: rows.rowCount }, "wf-engine: all startup triggers fired");
    }
  } catch (err) {
    logger.warn({ err }, "wf-engine: fireStartupTriggers failed (non-fatal)");
  }
}

// ── Chain-depth runaway guard ─────────────────────────────────────────────────
// Multi-hop chains (A→B→A→B…) can run away if they never terminate.
// Normal cascading chains (e.g. 5-phase project ≈ 10 hops) complete well below
// this limit.  When exceeded we log a warning and suppress further emissions.

const MAX_WORKFLOW_CHAIN_DEPTH = 50;

// ── Event emitter helper ──────────────────────────────────────────────────────

export async function emitWorkflowEvent(
  eventType: string,
  payload: Record<string, unknown> = {},
  sourceDefinitionId?: number,
  chainDepth = 0,
): Promise<void> {
  // Honor _sourceDefinitionId from payload when no explicit param is provided
  // (supports callers that thread source via payload metadata)
  const srcDefId = sourceDefinitionId ?? (payload._sourceDefinitionId as number | undefined);

  // Depth guard — suppress runaway chains and log a diagnostic warning
  if (chainDepth > MAX_WORKFLOW_CHAIN_DEPTH) {
    const chainDefIds = (payload._chainDefIds as number[] | undefined) ?? [];
    logger.warn(
      { eventType, chainDepth, maxDepth: MAX_WORKFLOW_CHAIN_DEPTH, sourceDefinitionId: srcDefId, chainDefIds },
      "wf-executor: chain depth exceeded MAX_WORKFLOW_CHAIN_DEPTH — suppressing further event emissions to prevent runaway chain",
    );
    return;
  }

  try {
    const triggers = await db.select().from(wfTriggersTable).where(and(
      eq(wfTriggersTable.type, "event"),
      eq(wfTriggersTable.enabled, true),
    ));
    for (const trigger of triggers) {
      const cfg = trigger.config as Record<string, unknown>;
      // TriggersPage stores eventName; also accept eventType for forward-compat
      const filterName = (cfg.eventName ?? cfg.eventType) as string | undefined;
      if (!filterName || filterName === eventType) {
        if (srcDefId != null && trigger.definitionId === srcDefId) {
          logger.info({ definitionId: srcDefId, eventType }, "wf-executor: self-loop guard — skipping re-trigger of source definition");
          continue;
        }
        // Thread chain depth and definition ID history through payload so the
        // depth counter survives the async setImmediate boundary into executeWorkflowRun
        const prevChainDefIds = (payload._chainDefIds as number[] | undefined) ?? [];
        const emitPayload: Record<string, unknown> = {
          ...payload,
          _eventType: eventType,
          _chainDepth: chainDepth + 1,
          _chainDefIds: srcDefId != null ? [...prevChainDefIds, srcDefId] : prevChainDefIds,
        };
        if (srcDefId != null) emitPayload._sourceDefinitionId = srcDefId;
        await fireWorkflowForDefinition(trigger.definitionId, "event", `event:${eventType}`, emitPayload);
      }
    }
  } catch (err) {
    logger.warn({ err, eventType }, "wf-engine: emitWorkflowEvent failed (non-fatal)");
  }
}

// ── Fire + concurrency-gate ───────────────────────────────────────────────────
// Concurrency is checked BEFORE inserting the run to avoid noisy post-insertion failures.

export async function fireWorkflowForDefinition(
  definitionId: number,
  triggerType: "manual" | "schedule" | "webhook" | "event",
  triggerRef: string,
  payload: Record<string, unknown> = {},
  opts: { versionId?: number; inputValues?: Record<string, string | string[]> } = {},
): Promise<number | null> {
  try {
    // Resolve version: explicit versionId (e.g. test-run from draft) or latest published
    const versionRows = opts.versionId
      ? await db.select().from(wfVersionsTable).where(and(
          eq(wfVersionsTable.id, opts.versionId),
          eq(wfVersionsTable.definitionId, definitionId),
        )).limit(1)
      : await db.select().from(wfVersionsTable).where(and(
          eq(wfVersionsTable.definitionId, definitionId),
          eq(wfVersionsTable.status, "published"),
        )).limit(1);
    const version = versionRows[0];
    if (!version) { logger.warn({ definitionId, versionId: opts.versionId }, "wf-executor: no version found"); return null; }

    // Fetch definition for concurrency limit
    const defRows = await db.select().from(wfDefinitionsTable).where(eq(wfDefinitionsTable.id, definitionId)).limit(1);
    const def = defRows[0];
    const concurrencyLimit = def?.concurrencyLimit ?? 5;

    // Enforce concurrency BEFORE inserting (prevents noisy failed runs)
    const runningCount = await countRunningRuns(definitionId);
    if (runningCount >= concurrencyLimit) {
      logger.warn({ definitionId, runningCount, concurrencyLimit }, "wf-executor: concurrency limit reached — run rejected at admission");
      return null;
    }

    const inserted = await db.insert(wfRunsTable).values({
      versionId: version.id, definitionId, triggerType, triggerRef, payload, status: "pending",
    }).returning({ id: wfRunsTable.id });

    const runId = inserted[0]?.id;
    if (!runId) return null;

    setImmediate(() => {
      executeWorkflowRun(runId, { inputValues: opts.inputValues }).catch(err => {
        logger.warn({ err, runId }, "wf-executor: detached run failed (non-fatal)");
      });
    });

    return runId;
  } catch (err) {
    logger.warn({ err, definitionId }, "wf-executor: fireWorkflowForDefinition failed (non-fatal)");
    return null;
  }
}

// ── Event dispatch ───────────────────────────────────────────────────────────
// Finds all enabled event-type triggers whose config.eventName matches the given
// name and fires a workflow run for each one.

export async function fireWorkflowsForEvent(
  eventName: string,
  payload: Record<string, unknown> = {},
  sourceDefinitionId?: number,
  chainDepth = 0,
): Promise<number[]> {
  // Honor _sourceDefinitionId from payload when no explicit param is provided
  const srcDefId = sourceDefinitionId ?? (payload._sourceDefinitionId as number | undefined);

  // Depth guard — suppress runaway chains and log a diagnostic warning
  if (chainDepth > MAX_WORKFLOW_CHAIN_DEPTH) {
    const chainDefIds = (payload._chainDefIds as number[] | undefined) ?? [];
    logger.warn(
      { eventName, chainDepth, maxDepth: MAX_WORKFLOW_CHAIN_DEPTH, sourceDefinitionId: srcDefId, chainDefIds },
      "wf-executor: chain depth exceeded MAX_WORKFLOW_CHAIN_DEPTH — suppressing further event emissions to prevent runaway chain",
    );
    return [];
  }

  try {
    const allEventTriggers = await db
      .select()
      .from(wfTriggersTable)
      .where(and(eq(wfTriggersTable.type, "event"), eq(wfTriggersTable.enabled, true)));

    const matching = allEventTriggers.filter(
      t => (t.config as Record<string, unknown>).eventName === eventName,
    );

    const runIds: number[] = [];
    await Promise.all(
      matching.map(async t => {
        if (srcDefId != null && t.definitionId === srcDefId) {
          logger.info({ definitionId: srcDefId, eventName }, "wf-executor: self-loop guard — skipping re-trigger of source definition");
          return;
        }
        // Thread chain depth and definition ID history through payload so the
        // depth counter survives the async setImmediate boundary into executeWorkflowRun
        const prevChainDefIds = (payload._chainDefIds as number[] | undefined) ?? [];
        const emitPayload: Record<string, unknown> = {
          ...payload,
          eventName,
          _chainDepth: chainDepth + 1,
          _chainDefIds: srcDefId != null ? [...prevChainDefIds, srcDefId] : prevChainDefIds,
        };
        if (srcDefId != null) emitPayload._sourceDefinitionId = srcDefId;
        const runId = await fireWorkflowForDefinition(
          t.definitionId,
          "event",
          `event:${eventName}:trigger:${t.id}`,
          emitPayload,
        );
        if (runId != null) runIds.push(runId);
      }),
    );

    if (matching.length > 0) {
      logger.info(
        { eventName, triggered: runIds.length, total: matching.length },
        "wf-executor: event dispatched",
      );
    }
    return runIds;
  } catch (err) {
    logger.warn({ err, eventName }, "wf-executor: fireWorkflowsForEvent failed (non-fatal)");
    return [];
  }
}

// ── Full cron "next run" computation ─────────────────────────────────────────
// 5-field cron: minute hour dom month dow
// Supports *, n, */step, a-b ranges, and a,b,c lists.

export function computeNextCronRun(cron: string): Date | null {
  try {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) return null;
    const [minStr, hourStr, domStr, monthStr, dowStr] = parts;

    function matches(value: number, spec: string): boolean {
      if (spec === "*") return true;
      if (spec.includes(",")) return spec.split(",").some(s => matches(value, s.trim()));
      if (spec.includes("-") && !spec.includes("/")) {
        const [lo, hi] = spec.split("-").map(Number);
        return value >= lo && value <= hi;
      }
      if (spec.includes("/")) {
        const [base, step] = spec.split("/");
        const stepN = parseInt(step, 10);
        const start = base === "*" ? 0 : parseInt(base, 10);
        return (value - start) % stepN === 0;
      }
      return value === parseInt(spec, 10);
    }

    const next = new Date();
    next.setSeconds(0, 0);
    next.setTime(next.getTime() + 60_000); // always advance at least one minute

    for (let i = 0; i < 525_600; i++) {
      if (
        matches(next.getMinutes(),     minStr)   &&
        matches(next.getHours(),       hourStr)  &&
        matches(next.getDate(),        domStr)   &&
        matches(next.getMonth() + 1,   monthStr) &&
        matches(next.getDay(),         dowStr)
      ) return new Date(next);
      next.setTime(next.getTime() + 60_000);
    }
    return null;
  } catch { return null; }
}
