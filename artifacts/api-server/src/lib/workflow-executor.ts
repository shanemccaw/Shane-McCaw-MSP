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
  wfNodeOutputSamplesTable,
  wfTriggersTable,
  wfTriggerEventsTable,
  pendingApprovalsTable,
  breakGlassPendingSecretsTable,
  baselineActionTemplatesTable,
  baselineActionTemplateAuditLogTable,
  leadsTable,
  usersTable,
  mspUsersTable,
  mspCustomersTable,
  tenantMonitorProfilesTable,
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
  signalDerivationRulesTable,
  signalRuleGroupsTable,
  deviceTokensTable,
  workflowStepsTable,
  workflowTemplateStepTasksTable,
  quickWinPresentationsTable,
  powershellScriptsTable,
  scriptModulesTable,
  clientAppRegistrationsTable,
  servicesTable,
  type PsScriptPermissions,
  type WfGraph,
  type WfNode,
  type WfRun,
} from "@workspace/db";

import { createScriptJob, getJobStatus, getJobOutput, isTerminalStatus, isAzureConfigured, resolveScriptById, findActiveJobForScript } from "./azure-automation";
import { getSecretValue } from "./azure-keyvault";
import { generateScriptFromService, generateScriptFromDocument } from "./ps-script-gen.js";
import { fetchNewsHeadlines, DEFAULT_NEWS_PROMPT, CAMPAIGN_BRIEF_PROMPT } from "./news-fetcher.js";
import { sendWebPushToAdmins } from "./web-push";
import { sendPushNotifications } from "./push";
import { broadcastAdminWorkflowEvent, broadcastPresentationPhaseGenProgress, broadcastPresentationPhaseGenComplete, broadcastPresentationPhaseGenError, broadcastPresentationDocsChange, broadcastPresentationProjectReady, broadcastPresentationEvent, broadcastProjectEvent } from "./sse-channels";
import { generateConsolidatedSowDocument, broadcastSowChangeForProject, broadcastDocsChangeForProject } from "./consolidated-sow-generator";
import { computeTenantSignals, resolveSignalsOverride, getDisabledSignalKeys, coerceDecayRate, type SignalDerivationRule, type SignalRuleGroup } from "./tenant-signals";
import { calculateCrmScore, type CrmScoreBreakdown } from "./crm-engine";
import { getEngineDef } from "./engine-registry.ts";
import { scoreHealthFromScriptRun } from "./m365-health-ai-scorer";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { openai } from "@workspace/integrations-openai-ai-server/image";
import { eq, and, count, desc, inArray, or, sql } from "drizzle-orm";
import path from "path";
import fs from "fs/promises";
import { randomUUID } from "crypto";
import { logger } from "./logger";
const log = logger.child({ channel: "workflow.run" });
import { runWithRequestContext } from "./request-context.ts";
import { evaluateRules as runAlertRuleEvaluation } from "./alert-engine";
import { STATIC_NODE_SAMPLES } from "./workflow-node-default-samples";
import { reconcileOrphanedRuns, reconcileStalledPhases, reconcileLateStuckQueuedCompletions } from "./kanban-auto-fire";
import { handleAutoFireKanban } from "./auto-fire-kanban-handler";
import { handleMspDunningAdvance, handleMspOverageMeter } from "./msp-billing-nodes";
import { handleMspScoreSnapshot } from "./msp-engine.js";
import { handlePlatformLogStreamPrune } from "./telemetry-retention-nodes";
import Ajv from "ajv";
import { getPrompt, getDocumentStylePrefix } from "./prompt-loader";
import { persistSowPricing } from "./sow-pricing-persist.js";
import { seedKanbanCardsForPhase } from "./kanban-phase-advance";

// ── Sensitive payload redaction for node-input logging ───────────────────────
// wf_run_node_outputs.input snapshots the full run payload at the moment a node
// executes. That payload can carry secrets a break_glass_verification_gate is
// about to consume/redact — but nodes execute (and log their input) before the
// gate ever runs, so those keys would otherwise land in plaintext regardless of
// the gate's own redactedPayload handling. Mirrors the gate's default field
// names (see the break_glass_verification_gate case) so an input log can never
// contain what the gate itself would have stripped.
const SENSITIVE_PAYLOAD_KEYS = new Set(["generatedPassword", "breakGlassSecret", "breakGlassAccountId"]);

function redactSensitivePayloadKeys(payload: Record<string, unknown>): Record<string, unknown> {
  if (payload == null || typeof payload !== "object") return payload;
  const redacted = { ...payload };
  for (const key of SENSITIVE_PAYLOAD_KEYS) delete redacted[key];
  return redacted;
}

// ── Insights document generation helpers ─────────────────────────────────────
// Mirrors the same helpers in routes/admin-insights.ts so the generate_document
// workflow node produces identical output to clicking Generate in the UI.

export const ENGINE_NODE_TYPE_MAP = {
  calculate_priority: "priority",
  calculate_pricing_engine: "pricing",
  calculate_health: "health",
  calculate_drift: "drift",
  calculate_forecast: "forecasting",
  calculate_crm: "crm",
  calculate_msp: "msp",
} as const;
export type EngineNodeType = keyof typeof ENGINE_NODE_TYPE_MAP;

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
  // [\w.\-\[\]]+ — word chars, dots, hyphens, and bracket chars so bracket-notation
  // like phases[0] or phases[myCounter] resolves correctly alongside node IDs like "node-106"
  return template.replace(/\{\{([\w.\-\[\]]+)\}\}/g, (_match, path: string) => {
    const key = path.startsWith("payload.") ? path.slice(8) : path;
    const parts = key.split(".");
    let cur: unknown = payload;
    for (const part of parts) {
      if (cur == null || typeof cur !== "object") return "";
      const bracketIdx = part.indexOf("[");
      if (bracketIdx !== -1) {
        // Bracket-notation segment, e.g. "phases[0]" or "phases[myCounter]"
        const propName = part.slice(0, bracketIdx);
        // Strip trailing "]"
        const rawIndex = part.slice(bracketIdx + 1, part.endsWith("]") ? part.length - 1 : part.length);
        // Navigate into the named property first (if any)
        if (propName) {
          cur = (cur as Record<string, unknown>)[propName];
          if (cur == null || !Array.isArray(cur)) return "";
        }
        // Resolve the index: plain integer string → direct; otherwise look up in payload
        let idx: number;
        if (/^\d+$/.test(rawIndex)) {
          idx = parseInt(rawIndex, 10);
        } else {
          const lookedUp = (payload as Record<string, unknown>)[rawIndex];
          const asStr = String(lookedUp ?? "");
          if (!/^\d+$/.test(asStr)) return "";
          idx = parseInt(asStr, 10);
        }
        cur = (cur as unknown[])[idx];
      } else {
        cur = (cur as Record<string, unknown>)[part];
      }
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

export interface BaselineTemplateExecutionResult {
  success: boolean;
  status: number;
  data: unknown;
  errorType?: "insufficient_privilege" | "conflict" | "bad_request" | "unexpected";
  endpoint: string;
  method: string;
  label: string;
  /** Present (and success=false) when requiredVariables didn't resolve — no Graph call was made. */
  missingVariables?: string[];
}

/**
 * Resolve a baseline action template's endpoint/body against `payload` and
 * execute it via graphWriteForTenant, recording the attempt in
 * baseline_action_template_audit_log. Shared by the execute_baseline_template
 * node handler and the admin "Testing" endpoint (routes/admin-baseline-templates.ts)
 * so there is exactly one implementation of "run this template for real."
 */
export async function runBaselineTemplateAgainstTenant(
  templateId: string,
  tenantId: string,
  customerId: number,
  payload: Record<string, unknown>,
): Promise<BaselineTemplateExecutionResult> {
  const [template] = await db
    .select()
    .from(baselineActionTemplatesTable)
    .where(eq(baselineActionTemplatesTable.templateId, templateId))
    .limit(1);

  if (!template) {
    throw new Error(`Template '${templateId}' not found`);
  }

  // Resolve {{variable}} placeholders in bodyTemplate using interp(). We do this
  // by JSON-serializing the template, running interp on the string, then parsing
  // it back — the same approach as any structured JSON template.
  const bodyTemplateStr = JSON.stringify(template.bodyTemplate ?? {});
  const bodyResolved = interp(bodyTemplateStr, payload) ?? "{}";
  const body = JSON.parse(bodyResolved) as Record<string, unknown>;

  // Validate all requiredVariables are present and non-empty after resolution
  const requiredVars = template.requiredVariables ?? [];
  const missingVariables = requiredVars.filter(varName => {
    const resolved = interp(`{{${varName}}}`, payload);
    return !resolved || resolved.trim() === "";
  });
  if (missingVariables.length > 0) {
    return {
      success: false, status: 400, errorType: "bad_request", data: null,
      endpoint: template.endpoint, method: template.method, label: template.label,
      missingVariables,
    };
  }

  // Resolve the endpoint (may also contain {{variable}} placeholders)
  const endpoint = interp(template.endpoint, payload) ?? template.endpoint;
  const method = template.method as "POST" | "PATCH" | "PUT";

  const { graphWriteForTenant } = await import("./graph");
  const result = await graphWriteForTenant(tenantId, endpoint, method, body, [200, 201, 204]);

  await db.insert(baselineActionTemplateAuditLogTable).values({
    action: result.success ? "executed" : "failed",
    templateId,
    afterSnapshot: {
      success: result.success,
      status: result.status,
      errorType: result.errorType ?? null,
      endpoint,
      method,
      customerId,
      tenantId,
      executedAt: new Date().toISOString(),
    },
  }).catch((auditErr: unknown) => {
    log.warn({ auditErr, templateId }, "runBaselineTemplateAgainstTenant: audit log insert failed (non-fatal)");
  });

  return {
    success: result.success, status: result.status, data: result.data, errorType: result.errorType,
    endpoint, method, label: template.label,
  };
}

/**
 * Resolve a template expression to its NATIVE value instead of a string.
 *
 * `interp()` always returns a string — it JSON.stringifies arrays/objects so
 * they can be embedded inside a larger template string (e.g. "Hello {{name}}").
 * That's correct for string interpolation, but wrong whenever the ENTIRE
 * expression is a single `{{...}}` placeholder that should preserve its
 * original type (e.g. passing an array of tasks into a Run Workflow node's
 * inputMapping — the child should receive a real array, not the string
 * "[{...}]").
 *
 * If `expr` is exactly one placeholder (no surrounding text), this resolves
 * the path directly off `payload` and returns the raw value untouched.
 * Otherwise it falls back to `interp()`'s string-interpolation behaviour.
 */
function resolveExprNative(expr: string | undefined, payload: Record<string, unknown>): unknown {
  if (!expr) return undefined;
  const trimmed = expr.trim();
  const soleMatch = trimmed.match(/^\{\{([\w.\-\[\]]+)\}\}$/);
  if (!soleMatch) return interp(expr, payload);

  const path = soleMatch[1]!;
  const key = path.startsWith("payload.") ? path.slice(8) : path;
  const parts = key.split(".");
  let cur: unknown = payload;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    const bracketIdx = part.indexOf("[");
    if (bracketIdx !== -1) {
      const propName = part.slice(0, bracketIdx);
      const rawIndex = part.slice(bracketIdx + 1, part.endsWith("]") ? part.length - 1 : part.length);
      if (propName) {
        cur = (cur as Record<string, unknown>)[propName];
        if (cur == null || !Array.isArray(cur)) return undefined;
      }
      let idx: number;
      if (/^\d+$/.test(rawIndex)) {
        idx = parseInt(rawIndex, 10);
      } else {
        const lookedUp = (payload as Record<string, unknown>)[rawIndex];
        const asStr = String(lookedUp ?? "");
        if (!/^\d+$/.test(asStr)) return undefined;
        idx = parseInt(asStr, 10);
      }
      cur = (cur as unknown[])[idx];
    } else {
      cur = (cur as Record<string, unknown>)[part];
    }
  }
  return cur;
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
log.info({ articlesDir: ARTICLES_DIR }, "workflow-executor: content articles directory resolved");

// ── Safe condition evaluator ─────────────────────────────────────────────────
// NO eval/new Function. Supports: path op literal (==,!=,>,<,>=,<=,contains),
// boolean truthy path, && and || logical operators.

function evalCondition(expression: string, payload: Record<string, unknown>): boolean {
  /** Strip {{ }} template delimiters so "{{key}}" resolves the same as "key". */
  function stripTpl(s: string): string {
    const t = s.trim();
    return t.startsWith("{{") && t.endsWith("}}") ? t.slice(2, -2).trim() : t;
  }

  function resolvePath(p: string): unknown {
    const parts = stripTpl(p).split(".");
    let cur: unknown = payload;
    for (const part of parts) {
      if (cur == null || typeof cur !== "object") return undefined;
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
  }

  function parseValue(s: string): unknown {
    const t = s.trim();
    // Template reference: {{key}} or {{steps.nodeId.field}}
    if (t.startsWith("{{") && t.endsWith("}}")) return resolvePath(t);
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
        const lhsRaw = c.slice(0, idx).trim();
        const lhs = resolvePath(lhsRaw);
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

// ── Variable type coercion ────────────────────────────────────────────────────

/**
 * Coerce a string value to the declared type.
 * Throws a descriptive Error on invalid input so the executor can fail fast
 * and surface a clear message instead of silently producing wrong data.
 */
function coerceToType(raw: string, type: string, varName: string): unknown {
  switch (type) {
    case "int": {
      const n = parseInt(raw, 10);
      if (isNaN(n)) throw new Error(`Set Variable "${varName}": cannot parse "${raw}" as int`);
      return n;
    }
    case "float": {
      const f = parseFloat(raw);
      if (isNaN(f)) throw new Error(`Set Variable "${varName}": cannot parse "${raw}" as float`);
      return f;
    }
    case "boolean":
      if (raw !== "true" && raw !== "false" && raw !== "1" && raw !== "0")
        throw new Error(`Set Variable "${varName}": expected "true"/"false"/"1"/"0", got "${raw}"`);
      return raw === "true" || raw === "1";
    case "null":
      return null;
    case "array":
    case "object":
    case "json": {
      let parsed: unknown;
      try { parsed = JSON.parse(raw); }
      catch (e) { throw new Error(`Set Variable "${varName}": invalid JSON — ${(e as Error).message}`); }
      if (type === "array" && !Array.isArray(parsed))
        throw new Error(`Set Variable "${varName}": expected JSON array, got ${typeof parsed}`);
      if (type === "object" && (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)))
        throw new Error(`Set Variable "${varName}": expected JSON object, got ${typeof parsed}`);
      return parsed;
    }
    default:
      return raw;
  }
}

// ── Runbook array coercion ────────────────────────────────────────────────────
/**
 * Coerce a resolved string to an array of runbook names.
 * Accepts:
 *   - A JSON array string:    '["Runbook A", "Runbook B"]'
 *   - A comma-separated list: "Runbook A, Runbook B"
 * Returns null if the input is empty/blank.
 */
function coerceToRunbookArray(resolved: string): string[] | null {
  const trimmed = resolved.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const names = parsed.map(v => String(v).trim()).filter(Boolean);
        return names.length > 0 ? names : null;
      }
    } catch { /* fall through to comma-split */ }
  }
  const names = trimmed.split(",").map(s => s.trim()).filter(Boolean);
  return names.length > 0 ? names : null;
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
      if (at === "execute_runbook") {
        const runbooksRaw = node.data.runbooks as string | undefined;
        const resolvedRunbooks = runbooksRaw ? interp(runbooksRaw, payload) : undefined;
        const runbookList = resolvedRunbooks ? coerceToRunbookArray(resolvedRunbooks) : null;
        if (runbookList && runbookList.length > 0) {
          const results = runbookList.map(name => ({ runbook: name, status: "succeeded", output: "", jobId: "dry-run-job" }));
          return { dryRun: true, allSucceeded: true, results, succeeded: runbookList, failed: [] };
        }
        return { dryRun: true, jobId: "dry-run-job", jobStatus: "Completed", runbookName: node.data.runbookName ?? "runbook", jobOutput: "" };
      }
      if (at === "update_m365_profile")
        return { dryRun: true, jobId: "dry-run-job", jobStatus: "Queued", runbookName: node.data.runbookName ?? "runbook" };
      if (at === "generate_document")    return { dryRun: true, documentId: 1, docType: node.data.docType ?? "report", name: str("docTitle", "Dry-run document") };
      if (at === "calculate_pricing")    return { dryRun: true, documentId: num("documentId"), totalPrice: 0, lineCount: 0 };
      if (at === "send_email")           return { dryRun: true, sent: true, messageId: "dry-run", recipient: str("to", "test@example.com"), subject: str("subject", "Dry-run subject") };
      if (at === "charge_msp_card")      return { dryRun: true, success: true, status: "paid", stripePaymentIntentId: "pi_dry_run" };
      return { dryRun: true, actionType: at ?? "none", note: "dry run — action skipped" };
    }

    case "score_lead":
      return { dryRun: true, leadId: num("leadId"), score: 80, scoreLabel: "High", qualified: true };

    case "assign_pipeline_stage": {
      const dryTarget = (node.data.targetType as string | undefined) ?? "opportunity";
      return dryTarget === "lead"
        ? { dryRun: true, targetType: "lead",        leadId: num("leadId"),             stage: str("stage", "Warm") }
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
      return { dryRun: true, updated: true, scores: { identity: 75, security: 60, collaboration: 80, compliance: 55, copilotReadiness: 65 }, recordCount: 5, scriptRunId: null };

    case "get_tenant_signals":
      return { dryRun: true, signals: ["alwaysInclude", "hasGovernanceGaps"], signalCount: 2, hasSignals: true };

    case "evaluate_signal_policies":
      return { dryRun: true, customersChecked: 3, totalFired: 1 };

    case "calculate_priority":
    case "calculate_pricing_engine":
    case "calculate_health":
    case "calculate_drift":
    case "calculate_forecast":
    case "calculate_crm":
    case "calculate_msp": {
      const engineKey = ENGINE_NODE_TYPE_MAP[node.type as EngineNodeType];
      const def = getEngineDef(engineKey);
      return {
        dryRun: true,
        engine: engineKey,
        score: engineKey === "pricing"
          ? { totalPricingImpact: 250, totalPricingValueContribution: 500 }
          : 42,
        breakdown: [],
        rawSignals: ["alwaysInclude"],
        timestamp: new Date().toISOString(),
        note: def ? undefined : "unknown engine",
      };
    }

    case "sla_start_timer":
      return {
        dryRun: true,
        timerId: "00000000-0000-0000-0000-000000000000",
        alreadyExisted: false,
        phase: (node.data.phase as string | undefined) ?? "response",
        note: "Timer would be started in live run",
      };

    case "sla_stop_timer":
      return {
        dryRun: true,
        stopped: true,
        timerId: interp(node.data.timerId as string | undefined, payload) ?? "",
        note: "Timer would be stopped in live run",
      };

    case "sla_warning":
      return {
        dryRun: true,
        warningFired: true,
        timerId: interp(node.data.timerId as string | undefined, payload) ?? "",
        note: "Warning event would be recorded in live run",
      };

    case "sla_breach":
      return {
        dryRun: true,
        breachId: "00000000-0000-0000-0000-000000000000",
        alreadyExisted: false,
        note: "Breach record would be created in live run",
      };

    case "sla_escalate":
      return {
        dryRun: true,
        escalationId: "00000000-0000-0000-0000-000000000000",
        alreadyExisted: false,
        level: (node.data.level as number | undefined) ?? 1,
        note: "Escalation would be created in live run",
      };

    case "sla_resolve":
      return {
        dryRun: true,
        resolved: true,
        timerId: interp(node.data.timerId as string | undefined, payload) ?? "",
        note: "Timer would be resolved and open escalations closed in live run",
      };

    case "scope_creep_detect":
      return {
        dryRun: true,
        detectionId: "00000000-0000-0000-0000-000000000000",
        alreadyExisted: false,
        detectionType: (node.data.detectionType as string | undefined) ?? "drift",
        note: "Scope creep detection would be recorded in live run",
      };

    case "scope_creep_score":
      return {
        dryRun: true,
        scoreId: "00000000-0000-0000-0000-000000000000",
        compositeScore: 0,
        alreadyExisted: false,
        note: "Scope creep composite score would be computed and persisted in live run",
      };

    case "scope_creep_violation":
      return {
        dryRun: true,
        violationId: "00000000-0000-0000-0000-000000000000",
        severity: "medium",
        alreadyExisted: false,
        note: "Scope creep violation would be fired in live run",
      };

    case "scope_creep_escalate":
      return {
        dryRun: true,
        escalationId: "00000000-0000-0000-0000-000000000000",
        alreadyExisted: false,
        level: (node.data.level as number | undefined) ?? 1,
        flagSowAmendment: (node.data.flagSowAmendment as boolean | undefined) ?? false,
        flagPricingReview: (node.data.flagPricingReview as boolean | undefined) ?? false,
        note: "Scope creep escalation would be created in live run",
      };

    case "scope_creep_resolve":
      return {
        dryRun: true,
        resolved: true,
        violationId: interp(node.data.violationId as string | undefined, payload) ?? "",
        note: "Scope creep violation would be resolved and open escalations closed in live run",
      };

    case "scope_creep_compliance_update":
      return {
        dryRun: true,
        recordId: "00000000-0000-0000-0000-000000000000",
        compliancePct: 100,
        note: "Scope creep compliance snapshot would be computed and persisted in live run",
      };

    // ── Sales Offer Engine nodes (dry-run stubs) ────────────────────────────
    case "sales_offer_generate":
      return {
        dryRun: true,
        insertedOfferIds: [],
        candidateCount: 0,
        note: "Sales offer candidates would be generated and persisted as draft rows in live run",
      };

    case "sales_offer_score":
      return {
        dryRun: true,
        offerId: parseInt(interp(node.data.offerId as string | undefined, payload) ?? "0", 10) || 0,
        previousScore: 0,
        newScore: 0,
        note: "Offer score would be re-computed from rule groups in live run",
      };

    case "sales_offer_violation":
      return {
        dryRun: true,
        offerId: parseInt(interp(node.data.offerId as string | undefined, payload) ?? "0", 10) || 0,
        violationType: (node.data.violationType as string | undefined) ?? "policy",
        note: "Sales offer violation event would be emitted in live run",
      };

    case "sales_offer_escalate":
      return {
        dryRun: true,
        offerId: parseInt(interp(node.data.offerId as string | undefined, payload) ?? "0", 10) || 0,
        escalatedTo: (node.data.escalatedTo as string | undefined) ?? "admin",
        note: "Offer would be escalated and a notification emitted in live run",
      };

    case "sales_offer_resolve":
      return {
        dryRun: true,
        offerId: parseInt(interp(node.data.offerId as string | undefined, payload) ?? "0", 10) || 0,
        newState: (node.data.newState as string | undefined) ?? "accepted",
        note: "Offer lifecycle state would be transitioned in live run",
      };

    case "generate_diff_report":
      return { dryRun: true, documentId: 1, changesFound: true, changeCount: 5 };

    case "notify_major_changes":
      return { dryRun: true, notified: false, skipped: true };

    case "check_script_output":
      return { dryRun: true, passed: true, outcome: "Dry run: output accepted (balanced sensitivity)" };

    case "play_sound": {
      const psTarget = (node.data.target as string | undefined) ?? "browser";
      const psSound  = (node.data.sound  as string | undefined) ?? "ping";
      log.info({ psTarget, psSound }, "workflow-executor [dry-run]: play_sound would play");
      return { dryRun: true, soundPlayed: false, soundTarget: psTarget, skipped: true };
    }

    case "reconcile_orphaned_runs":
      return { dryRun: true, reconciled: false, task: (node.data.task as string | undefined) ?? "reconcile_orphaned_runs", note: "dry run — reconciliation skipped" };

    case "alert_evaluate_rules":
      return { dryRun: true, evaluated: false, note: "dry run — alert rule evaluation skipped" };

    case "kanban_auto_fire":
      return { dryRun: true, fired: false, clientId: 0, action: (node.data.action as string | undefined) ?? "", note: "dry run — kanban auto-fire skipped" };

    case "monitor_subscription_ensure": {
      const mseContentTypeDry = (node.data.contentType as string | undefined) ?? "Audit.AzureActiveDirectory";
      return { dryRun: true, subscriptionStatus: "active", contentType: mseContentTypeDry, note: "dry run — subscription not started" };
    }

    case "monitor_poll_activity": {
      const mpaTenantIdDry = interp(node.data.tenantId as string | undefined, payload) ?? "(tenantId)";
      const mpaContentTypeDry = interp(node.data.contentType as string | undefined, payload) ?? "Audit.AzureActiveDirectory";
      return { dryRun: true, criticalChangeDetected: false, eventCount: 0, criticalCount: 0, tenantId: mpaTenantIdDry, contentType: mpaContentTypeDry, note: "dry run — poll skipped" };
    }

    case "msp_dunning_advance":
      return { dryRun: true, checked: 0, advanced: 0, suspended: 0, revoked: 0, archived: 0, note: "dry run — dunning advancement skipped" };

    case "msp_overage_meter":
      return { dryRun: true, subscriptionsChecked: 0, metered: 0, totalOverageTenants: 0, note: "dry run — overage metering skipped" };

    case "platform_log_stream_prune": {
      const retentionDaysDry = Number((node.data.retentionDays as number | undefined) ?? 7);
      return { dryRun: true, retentionDays: retentionDaysDry, rowsDeleted: 0, note: "dry run — prune skipped" };
    }

    case "send_browser_notification": {
      const dryTitle   = interp(node.data.title    as string | undefined, payload) ?? "(no title)";
      const dryBody    = interp(node.data.body      as string | undefined, payload) ?? "";
      const dryLink    = interp(node.data.linkPath  as string | undefined, payload) ?? null;
      log.info({ dryTitle, dryBody, dryLink }, "workflow-executor [dry-run]: send_browser_notification would send");
      return { dryRun: true, notificationSent: true, preview: { title: dryTitle, body: dryBody, linkPath: dryLink } };
    }

    case "create_notification": {
      const cnTitle = interp(node.data.title as string | undefined, payload) ?? "(no title)";
      const cnBody  = interp(node.data.body  as string | undefined, payload) ?? "";
      const cnLink  = interp(node.data.linkPath as string | undefined, payload)?.trim() || null;
      const cnType  = (interp(node.data.type as string | undefined, payload) ?? "message") as string;
      log.info({ cnTitle, cnBody, cnLink, cnType }, "workflow-executor [dry-run]: create_notification would insert");
      return { dryRun: true, notificationCount: 0, preview: { title: cnTitle, body: cnBody, linkPath: cnLink, type: cnType } };
    }

    case "send_mobile_push": {
      const dryMpTitle = interp(node.data.title as string | undefined, payload) ?? "(no title)";
      const dryMpBody  = interp(node.data.body  as string | undefined, payload) ?? "";
      log.info({ dryMpTitle, dryMpBody }, "workflow-executor [dry-run]: send_mobile_push would send");
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

    case "get_project_tasks": {
      const dryPhase1Tasks = [
        { taskId: 1, title: "Define scope", column: "done", priority: "high", assignedTo: null, dueDate: null, groupName: null, taskType: null, isCustomerTask: false, linkedRunbookId: null, customerDownloadScriptId: null, triggersHealthScore: false, taskMetadata: null, phaseId: 1, phaseTitle: "Discovery", phaseStatus: "active", phaseOrder: 1 },
        { taskId: 2, title: "Kickoff call", column: "in_progress", priority: "medium", assignedTo: null, dueDate: null, groupName: null, taskType: null, isCustomerTask: true, linkedRunbookId: null, customerDownloadScriptId: null, triggersHealthScore: false, taskMetadata: null, phaseId: 1, phaseTitle: "Discovery", phaseStatus: "active", phaseOrder: 1 },
      ];
      const dryPhase2Tasks = [
        { taskId: 3, title: "Deploy configuration", column: "todo", priority: "high", assignedTo: null, dueDate: null, groupName: null, taskType: null, isCustomerTask: false, linkedRunbookId: null, customerDownloadScriptId: null, triggersHealthScore: true, taskMetadata: null, phaseId: 2, phaseTitle: "Implementation", phaseStatus: "pending", phaseOrder: 2 },
      ];
      return {
        dryRun: true,
        phases: [
          { phaseId: 1, phaseTitle: "Discovery", phaseStatus: "active", order: 1, tasks: dryPhase1Tasks.map(t => { const { phaseId: _p, phaseTitle: _pt, phaseStatus: _ps, phaseOrder: _po, ...rest } = t; return rest; }) },
          { phaseId: 2, phaseTitle: "Implementation", phaseStatus: "pending", order: 2, tasks: dryPhase2Tasks.map(t => { const { phaseId: _p, phaseTitle: _pt, phaseStatus: _ps, phaseOrder: _po, ...rest } = t; return rest; }) },
        ],
        flatTasks: [...dryPhase1Tasks, ...dryPhase2Tasks],
        taskCount: 3,
        projectId: num("projectId") || 1,
      };
    }

    case "update_project_task":
      return {
        dryRun: true,
        updated: true,
        taskId: num("taskId") || 1,
        column: str("column", "in_progress"),
        title: str("titleExpr", "Updated task"),
      };

    case "update_milestone":
      return {
        dryRun: true,
        milestoneId: num("milestoneIdExpr") || 1,
        previousStatus: "pending",
        newStatus: interp((node.data.statusExpr as string | undefined) ?? "in_progress", p) || "in_progress",
        kanbanCardsSeeded: false,
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

    case "generate_script":
      return {
        dryRun: true,
        scriptId: "dry-run-script-id",
        packageId: null,
        title: `Dry-run script from ${(node.data.sourceMode as string | undefined) ?? "service"} ${interp((node.data.targetId as string | undefined) ?? "", p) || "<not configured>"}`,
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

    case "group_by": {
      const dryKeyExpr = (node.data.keyExpression as string | undefined) ?? "{{currentItem.key}}";
      const drySort = (node.data.sortGroups as string | undefined) ?? "none";
      const dryNullBehaviour = (node.data.nullKeyBehaviour as string | undefined) ?? "collect";
      const dryGroups = [
        { key: `<${dryKeyExpr}>`, items: [{ dryRunElement: 1 }, { dryRunElement: 2 }] },
        { key: `<${dryKeyExpr} — group 2>`, items: [{ dryRunElement: 3 }] },
      ];
      if (drySort === "asc") dryGroups.sort((a, b) => String(a.key).localeCompare(String(b.key)));
      else if (drySort === "desc") dryGroups.sort((a, b) => String(b.key).localeCompare(String(a.key)));
      const dryNullNote =
        dryNullBehaviour === "skip"
          ? "items with a blank/null key will be skipped"
          : dryNullBehaviour === "error"
          ? "a blank/null key will fail the node"
          : "items with a blank/null key are collected under '(no key)'";
      return {
        dryRun: true,
        groups: dryGroups,
        groupCount: dryGroups.length,
        nullKeyBehaviour: dryNullBehaviour,
        nullKeyNote: dryNullNote,
      };
    }

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

    case "for": {
      return {
        dryRun: true,
        forItems: [],
        item: null,
        index: 0,
        arraySource: (node.data.arraySource as string | undefined) ?? "",
      };
    }

    case "parallel": {
      const branchCount  = (node.data.branchCount  as number   | undefined) ?? 2;
      const branchLabels = (node.data.branchLabels as string[] | undefined) ?? [];
      const branchWait   = (node.data.branchWait   as boolean[] | undefined) ?? [];
      const branchOutputs: Record<string, unknown> = {};
      for (let i = 0; i < branchCount; i++) {
        const handle = `branch_${i + 1}`;
        const label  = branchLabels[i] ?? `Branch ${i + 1}`;
        const wait   = branchWait[i] !== false;
        branchOutputs[handle] = { dryRun: true, label, waitForCompletion: wait };
      }
      return { dryRun: true, ...branchOutputs };
    }

    case "join":
      return { dryRun: true, joined: true };

    case "set_variable":
    case "update_variable": {
      const svDryName  = (node.data.variableName as string | undefined)?.trim() || "";
      const svDryType  = ((node.data.variableType as string | undefined)?.trim()) || "string";
      const dryPlaceholder: unknown =
        svDryType === "int"    ? 0
        : svDryType === "float"  ? 0.0
        : svDryType === "boolean" ? false
        : svDryType === "null"   ? null
        : svDryType === "array"  ? []
        : svDryType === "object" ? {}
        : svDryType === "json"   ? null
        : `<${svDryName || "variable"}>`;
      const currentDryVars: Record<string, unknown> = {};
      if (svDryName) currentDryVars[svDryName] = dryPlaceholder;
      return { dryRun: true, value: dryPlaceholder, variables: currentDryVars, ...(svDryName ? { [svDryName]: dryPlaceholder } : {}) };
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
      if (foType === "presentation") {
        return {
          dryRun:           true,
          found:            true,
          objectType:       "presentation",
          objectId:         1,
          presentationId:   1,
          projectId:        1,
          clientUserId:     1,
          status:           "signed",
          totalPrice:       "12500.00",
          paymentPlan:      "phased",
          signedAt:         new Date().toISOString(),
          sowPhases: [
            { id: "phase-1", title: "Phase 1 — Discovery", description: "Initial assessment and planning", price: 5000, selected: true },
            { id: "phase-2", title: "Phase 2 — Implementation", description: "Core M365 deployment", price: 7500, selected: true },
          ],
          selectedPhaseIds: ["phase-1", "phase-2"],
          createdAt:        new Date().toISOString(),
        };
      }
      return { dryRun: true, found: true, objectType: foType, objectId: 1 };
    }

    // ── Graph Write Operation (dry-run: explicitly blocked) ────────────────
    case "graph_write_operation":
      // Graph writes are never mocked — return a clear skip indicator so
      // downstream condition nodes can detect the dry-run branch.
      return {
        dryRun: true,
        skipped: true,
        reason: "graph_write_operation does not support dry-run execution",
      };

    // ── Execute Baseline Template (dry-run: explicitly blocked) ─────────────
    case "execute_baseline_template":
      return {
        dryRun: true,
        skipped: true,
        reason: "execute_baseline_template does not support dry-run execution",
      };

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

// ── Runbook ID resolution ─────────────────────────────────────────────────────
// The Execute Runbook node's "Runbook ID" field is populated from two very
// different ID spaces depending on where it came from:
//   1. An internal script-library UUID (workflow_template_step_tasks.runbook_id
//      is a FK to powershell_scripts.id or script_modules.id — see
//      admin-ps-scripts.ts "single source of truth" comments and the same
//      resolution pattern in kanban-auto-fire.ts's resolveRunbook()).
//   2. A literal Azure Automation ARM resource ID, if the user typed/piped one
//      in manually via the builder's Runbook ID field.
// Internal UUIDs never match Azure's ARM-style `rb.id` values, so they must be
// resolved against our own tables FIRST; only fall back to the Azure ARM-ID
// lookup (resolveScriptById) when the value isn't one of our UUIDs.
const RUNBOOK_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveExecuteRunbookId(runbookId: string): Promise<string> {
  if (RUNBOOK_UUID_RE.test(runbookId)) {
    // The script name column has been removed — use the script UUID as the identifier
    const [script] = await db
      .select({ id: powershellScriptsTable.id })
      .from(powershellScriptsTable)
      .where(eq(powershellScriptsTable.id, runbookId))
      .limit(1);
    if (script) return script.id;

    const [mod] = await db
      .select({ id: scriptModulesTable.id })
      .from(scriptModulesTable)
      .where(eq(scriptModulesTable.id, runbookId))
      .limit(1);
    if (mod) return mod.id;
    // Not a known internal script/module UUID — fall through.
  }
  return resolveScriptById(runbookId);
}

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
  const STRUCTURAL_TYPES = new Set(["start", "end", "condition", "check_script_output", "error", "switch_case", "report_progress", "retry"]);

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
        // Expose the run's incoming trigger/input payload as the Start node's
        // output (in addition to top-level access) so workflow authors can
        // reference it as {{steps.<startNodeId>.<field>}} and so the run
        // viewer shows what actually kicked off the run instead of just a
        // static marker. Top-level payload fields remain unaffected either way.
        output = { started: true, ...payload };
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
            const resolvedClientUserId = clientUserId && !isNaN(clientUserId) ? clientUserId : null;
            if (resolvedClientUserId !== null) {
              const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, resolvedClientUserId)).limit(1);
              if (!existing) {
                nodeError = true;
                output = { error: `create_project: clientUserId ${resolvedClientUserId} not found — no user with that ID exists` };
              }
            }
            if (!nodeError) {
              const [project] = await db.insert(projectsTable).values({
                title,
                description: interpOrNull(node.data.description as string | undefined, payload),
                projectType: (node.data.projectType as "project" | "retainer" | "quick_win" | undefined) ?? "project",
                clientUserId: resolvedClientUserId,
                status: "active",
              }).returning();
              output = { projectId: project.id, projectTitle: project.title };
              // If this run was triggered by a presentation, broadcast project_ready so the
              // client's ConfirmationStep CTA button lights up without a page refresh.
              // The agreement_signed event uses `contractId`; other paths may use `presentationId`.
              const presIdRaw = payload.contractId ?? payload.presentationId;
              const presId = typeof presIdRaw === "number" ? presIdRaw
                : typeof presIdRaw === "string" ? parseInt(presIdRaw, 10) : NaN;
              if (!isNaN(presId) && presId > 0) {
                broadcastPresentationProjectReady(presId, project.id);
                log.info({ runId, presId, projectId: project.id }, "wf-executor: project_ready broadcast sent for presentation");
              }
            }
          }
        } else if (actionType === "execute_runbook" || actionType === "update_m365_profile") {
          // ── Multiple-runbook parallel path (execute_runbook only) ────────────
          const runbooksParam = actionType === "execute_runbook"
            ? (node.data.runbooks as string | undefined)
            : undefined;
          const resolvedRunbooksStr = runbooksParam ? interp(runbooksParam, payload) : undefined;
          const runbookList = resolvedRunbooksStr ? coerceToRunbookArray(resolvedRunbooksStr) : null;

          if (runbookList && runbookList.length > 0) {
            // Parallel fan-out: fire all runbooks simultaneously via Promise.allSettled
            if (!isAzureConfigured()) {
              nodeError = true;
              output = { error: "Azure Automation is not configured — add the required secrets" };
            } else {
              const POLL_INTERVAL_MS = 5_000;
              const TIMEOUT_MS = 10 * 60 * 1_000;

              let sharedParameters: Record<string, string> = {};
              const rawParams = node.data.runbookParams as string | undefined;
              if (rawParams?.trim()) {
                try { sharedParameters = JSON.parse(interp(rawParams, payload) ?? "{}") as Record<string, string>; }
                catch { /* ignore bad JSON — run with no params */ }
              }
              const mClientId = interp(node.data.clientId as string | undefined, payload);
              if (mClientId) sharedParameters["ClientId"] = mClientId;
              const mProjectId = interp(node.data.projectId as string | undefined, payload);
              if (mProjectId) sharedParameters["ProjectId"] = mProjectId;

              type SingleResult = {
                runbook: string;
                status: "succeeded" | "failed";
                jobId: string;
                output?: string;
                error?: string;
              };

              const pollSingle = async (runbookName: string, jobId: string): Promise<SingleResult> => {
                const deadline = Date.now() + TIMEOUT_MS;
                let finalStatus = "New";
                while (!isTerminalStatus(finalStatus)) {
                  if (Date.now() >= deadline) {
                    return { runbook: runbookName, status: "failed", jobId, error: "Timed out after 10 minutes" };
                  }
                  await new Promise<void>(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
                  try {
                    const statusResult = await getJobStatus(jobId);
                    finalStatus = statusResult.status;
                  } catch (e) {
                    return { runbook: runbookName, status: "failed", jobId, error: (e as Error).message };
                  }
                }
                const streams = await getJobOutput(jobId).catch(() => [] as Array<{ streamType: string; text: string }>);
                const jobOutput = streams.filter(s => s.streamType === "Output").map(s => s.text).join("\n");
                return {
                  runbook: runbookName,
                  status: finalStatus === "Completed" ? "succeeded" : "failed",
                  jobId,
                  output: jobOutput,
                  ...(finalStatus !== "Completed" ? { error: `Azure status: ${finalStatus}` } : {}),
                };
              };

              // Create all jobs in parallel (allSettled so one creation failure doesn't abort the rest)
              const jobSettled = await Promise.allSettled(
                runbookList.map(name => createScriptJob({ runbookName: name, parameters: { ...sharedParameters } })),
              );

              // Poll all created jobs in parallel; map creation failures to immediate failed results
              const pollPromises = runbookList.map((name, i) => {
                const settled = jobSettled[i]!;
                if (settled.status === "rejected") {
                  return Promise.resolve<SingleResult>({
                    runbook: name,
                    status: "failed",
                    jobId: "n/a",
                    error: String((settled as PromiseRejectedResult).reason),
                  });
                }
                const { jobId } = (settled as PromiseFulfilledResult<{ jobId: string; status: string }>).value;
                return pollSingle(name, jobId);
              });

              const results = await Promise.all(pollPromises);
              const succeeded = results.filter(r => r.status === "succeeded").map(r => r.runbook);
              const failed    = results.filter(r => r.status !== "succeeded").map(r => r.runbook);

              output = { allSucceeded: failed.length === 0, results, succeeded, failed };
              log.info(
                { runId, nodeId: node.id, total: runbookList.length, succeeded: succeeded.length, failed: failed.length },
                "wf-executor: execute_runbook multi-runbook fan-out complete",
              );
            }
          } else {
          // ── Single-runbook path (existing behaviour, unchanged) ───────────────
          let runbookName = interp(node.data.runbookName as string | undefined, payload);
          const runbookId = actionType === "execute_runbook" ? interp(node.data.runbookId as string | undefined, payload) : undefined;
          if (!runbookName && !runbookId) {
            nodeError = true;
            output = { error: "execute_runbook requires either runbookName or runbookId" };
          } else if (!isAzureConfigured()) {
            nodeError = true;
            output = { error: "Azure Automation is not configured — add the required secrets" };
          } else {
            // Runbook ID takes priority over name when both are set (matches
            // the "overrides name" hint shown in the builder UI).
            if (runbookId) {
              try {
                runbookName = await resolveExecuteRunbookId(runbookId);
              } catch (err) {
                nodeError = true;
                output = { error: (err as Error).message ?? `Could not resolve runbook ID "${runbookId}"` };
              }
            }
            if (!nodeError) {
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
            if (actionType === "execute_runbook") {
              // Resolve App Registration credentials from Key Vault so the
              // runbook receives the real Azure AD TenantId, ClientId (app
              // registration client ID), and ClientSecret — not raw DB integers.
              // This mirrors the exact same pattern used in kanban-auto-fire.ts.
              const clientIdRaw = interp(node.data.clientId as string | undefined, payload);
              const clientUserId = clientIdRaw ? parseInt(clientIdRaw, 10) : NaN;
              if (!isNaN(clientUserId)) {
                const [appReg] = await db
                  .select()
                  .from(clientAppRegistrationsTable)
                  .where(
                    and(
                      eq(clientAppRegistrationsTable.clientUserId, clientUserId),
                      eq(clientAppRegistrationsTable.status, "verified"),
                    ),
                  )
                  .limit(1);

                if (!appReg) {
                  nodeError = true;
                  output = { error: `No verified App Registration found for client #${clientUserId}` };
                } else {
                  let clientSecret: string;
                  try {
                    clientSecret = await getSecretValue(appReg.keyVaultSecretName);
                  } catch (kvErr) {
                    nodeError = true;
                    output = { error: `Key Vault fetch failed for client #${clientUserId}: ${(kvErr as Error).message}` };
                  }
                  if (!nodeError) {
                    parameters["TenantId"]     = appReg.tenantId;
                    parameters["ClientId"]     = appReg.azureClientId;
                    parameters["ClientSecret"] = clientSecret!;
                  }
                }
              }
            }
            if (!nodeError) {
            const job = await createScriptJob({ runbookName: runbookName!, parameters });
            if (actionType === "execute_runbook") {
              // Poll until the job reaches a terminal status (max 10 minutes).
              const POLL_INTERVAL_MS = 5_000;
              const TIMEOUT_MS = 10 * 60 * 1_000;
              // Bail early if the job never leaves Queued/New/Activating —
              // that almost always means the runbook isn't Published in Azure.
              const STUCK_QUEUED_MS = 2 * 60 * 1_000;
              const deadline = Date.now() + TIMEOUT_MS;
              let finalStatus = job.status;
              let firstQueuedAt: number | null = null;
              while (!isTerminalStatus(finalStatus)) {
                if (Date.now() >= deadline) {
                  nodeError = true;
                  output = { error: "Runbook timed out after 10 minutes", jobId: job.jobId };
                  break;
                }
                await new Promise<void>(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
                const statusResult = await getJobStatus(job.jobId);
                finalStatus = statusResult.status;
                // Stuck-Queued detection: if the job stays pre-execution for
                // 2+ minutes it will likely never start.
                if (finalStatus === "New" || finalStatus === "Queued" || finalStatus === "Activating") {
                  if (!firstQueuedAt) firstQueuedAt = Date.now();
                  if (Date.now() - firstQueuedAt >= STUCK_QUEUED_MS) {
                    nodeError = true;
                    output = {
                      error: `Script job stuck in "${finalStatus}" for 2+ minutes — ensure the script is published and the Azure account has available workers`,
                      jobId: job.jobId,
                    };
                    break;
                  }
                } else {
                  firstQueuedAt = null;
                }
              }
              if (!nodeError) {
                const streams = await getJobOutput(job.jobId);
                const jobOutput = streams
                  .filter(s => s.streamType === "Output")
                  .map(s => s.text)
                  .join("\n");
                output = { jobId: job.jobId, jobStatus: finalStatus, runbookName, jobOutput };
              }
            } else {
              output = { jobId: job.jobId, jobStatus: job.status, runbookName };
            }
            } // end inner if (!nodeError) — app reg lookup guard
            } // end outer if (!nodeError) — runbook ID resolution guard
          }
          } // end single-runbook path
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
                const sowSignalsOverride = resolveSignalsOverride(
                  node.data.signalsOverride as string | undefined,
                  payload,
                  interp,
                );
                const sowResult = await generateConsolidatedSowDocument({
                  clientUserId,
                  projectId: !isNaN(projectId) ? projectId : null,
                  title: docTitle,
                  runId: runId != null ? String(runId) : undefined,
                  signalsOverride: sowSignalsOverride,
                });
                if (!isNaN(presId)) {
                  broadcastPresentationDocsChange(presId);
                  log.info({ runId, presId, docId: sowResult.docId }, "wf-executor: consolidated_sow broadcast docs_changed for presentation");
                }
                if (!isNaN(projectId)) {
                  void broadcastSowChangeForProject(projectId);
                  void broadcastDocsChangeForProject(projectId);
                }
                output = { documentId: sowResult.docId, docType, category: docCategory, title: docTitle, clientId: clientUserId };
              } catch (sowErr) {
                nodeError = true;
                const sowErrMsg = sowErr instanceof Error ? sowErr.message : String(sowErr);
                output = {
                  error: sowErrMsg,
                  customerError: "SOW generation failed — please retry or contact support if the problem persists.",
                };
                log.error({ runId, err: sowErr }, "wf-executor: consolidated_sow generation failed");
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
                log.warn({ runId, reportDocId, err: pricingErr }, "wf-executor: generate_document — persistSowPricing failed (non-fatal)");
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
                log.info({ runId, presId, reportDocId }, "wf-executor: generate_document — broadcast docs_changed for presentation");
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

            log.info({ runId, reportDocId, docType, docCategory, clientUserId }, "wf-executor: generate_document completed");
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
            log.info({ runId, definitionId, eventType: emitEventType, chainDepth: currentChainDepth }, "wf-executor: emit_event node fired");

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
            } else {
              // ── Route other events to generic presentation/project SSE channels ──
              const rawPresId = mergedPayload.presentationId;
              const presId = typeof rawPresId === "number"
                ? rawPresId
                : typeof rawPresId === "string"
                ? parseInt(rawPresId, 10)
                : NaN;
              if (!isNaN(presId)) {
                broadcastPresentationEvent(presId, {
                  type: emitEventType,
                  ...mergedPayload,
                });
              }

              const rawProjId = mergedPayload.projectId;
              const projId = typeof rawProjId === "number"
                ? rawProjId
                : typeof rawProjId === "string"
                ? parseInt(rawProjId, 10)
                : NaN;
              if (!isNaN(projId)) {
                broadcastProjectEvent(projId, {
                  type: emitEventType,
                  ...mergedPayload,
                });
              }
            }
          }
        } else if (actionType === "sql_query") {
          // Execute a SQL statement and spread first-row fields into the step output.
          // Supports both interpolated queries and parameterized queries via node.data.params.
          //
          // node.data.params — optional JSON array of template expressions. Each expression is
          // resolved with resolveExprNative() and passed as a positional parameter ($1, $2, ...).
          // Objects and arrays are serialized to JSON string for PostgreSQL JSONB parameters.
          // Use this for trusted-but-interpolation-unsafe values (e.g. AI-generated JSON).
          //
          // {{token}} interpolation in the query text is also supported for simple scalar values.
          // WARNING: string-interpolated values are never sanitized — only use with trusted sources.
          const rawQuery = node.data.query as string | undefined;
          if (!rawQuery?.trim()) {
            nodeError = true;
            output = { error: "sql_query: node.data.query is empty" };
          } else {
            const interpolatedQuery = interp(rawQuery, payload) ?? rawQuery;
            // Build positional params from node.data.params array (optional)
            const rawParamsField = node.data.params as unknown;
            const queryParams: unknown[] = [];
            if (Array.isArray(rawParamsField)) {
              for (const paramExpr of rawParamsField as string[]) {
                const native = resolveExprNative(String(paramExpr), payload);
                const pgVal = (native !== null && native !== undefined && typeof native === "object")
                  ? JSON.stringify(native)
                  : native;
                queryParams.push(pgVal);
              }
            }
            try {
              const result = await pool.query(
                interpolatedQuery,
                queryParams.length > 0 ? queryParams : undefined,
              );
              const firstRow = (result.rows[0] as Record<string, unknown> | undefined) ?? null;
              output = firstRow
                ? { rowCount: result.rowCount ?? result.rows.length, ...firstRow }
                : { rowCount: result.rowCount ?? 0 };
              log.info({ runId, rowCount: result.rowCount ?? result.rows.length }, "wf-executor: sql_query node executed");
            } catch (queryErr) {
              nodeError = true;
              const errMsg = queryErr instanceof Error ? queryErr.message : String(queryErr);
              output = { error: `sql_query failed: ${errMsg.slice(0, 200)}` };
              log.warn({ runId, err: queryErr }, "wf-executor: sql_query node failed");
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
                log.warn({ runId, calcDocId, calcDocType }, "wf-executor: calculate_pricing found 0 pricing lines — failing node");
              } else {
                output = { documentId: calcDocId, totalPrice, lineCount, ...(calcDocType ? { docType: calcDocType } : {}) };
                log.info({ runId, calcDocId, lineCount, totalPrice, calcDocType }, "wf-executor: calculate_pricing completed");
              }
            }
          }
        } else if (actionType === "run_workflow") {
          // ── Run Workflow: execute a published sub-workflow synchronously ─────
          const globalMaxDepth = Math.max(1, parseInt(process.env.RUN_WORKFLOW_MAX_DEPTH ?? "5", 10) || 5);
          const workflowIdRaw = node.data.workflowId as string | number | undefined;
          let subDefId = typeof workflowIdRaw === "number"
            ? workflowIdRaw
            : parseInt(String(workflowIdRaw ?? ""), 10);

          const workflowNameRaw = node.data.workflowName as string | undefined;

          if (isNaN(subDefId) && workflowNameRaw?.trim()) {
            const resolvedRows = await db.select({ id: wfDefinitionsTable.id })
              .from(wfDefinitionsTable)
              .where(eq(wfDefinitionsTable.name, workflowNameRaw.trim()))
              .limit(1);
            if (resolvedRows[0]) {
              subDefId = resolvedRows[0].id;
            }
          }

          if (isNaN(subDefId)) {
            nodeError = true;
            output = { error: workflowNameRaw?.trim() ? `run_workflow: no workflow found with name "${workflowNameRaw.trim()}"` : "run_workflow requires a workflowId or workflowName" };
          } else {
            const rawDepth = payload._depth;
            const currentDepth = Math.max(0, Number.isInteger(rawDepth) ? (rawDepth as number) : 0);

            // Load the sub-workflow's definition to read its per-workflow maxRunDepth setting
            const subDefRows = await db.select({ maxRunDepth: wfDefinitionsTable.maxRunDepth })
              .from(wfDefinitionsTable)
              .where(eq(wfDefinitionsTable.id, subDefId))
              .limit(1);
            const subDefMaxDepth = subDefRows[0]?.maxRunDepth;
            // Use the sub-workflow's configured limit; fall back to the global env/default
            const RUN_WORKFLOW_MAX_DEPTH = (typeof subDefMaxDepth === "number" && subDefMaxDepth >= 1 && subDefMaxDepth <= 10)
              ? subDefMaxDepth
              : globalMaxDepth;

            if (currentDepth >= RUN_WORKFLOW_MAX_DEPTH) {
              nodeError = true;
              output = {
                error: `run_workflow: maximum nesting depth of ${RUN_WORKFLOW_MAX_DEPTH} reached — possible recursive workflow loop. Aborting to prevent infinite recursion.`,
                depth: currentDepth,
                maxDepth: RUN_WORKFLOW_MAX_DEPTH,
              };
              log.warn({ runId, subDefId, currentDepth, maxDepth: RUN_WORKFLOW_MAX_DEPTH }, "wf-executor: run_workflow depth limit reached — aborting to prevent infinite loop");
            } else {
            const rawMapping = node.data.inputMapping as Array<{ key: string; expr: string }> | undefined;
            // Start with a clean payload for the child workflow — do NOT spread the
            // parent payload.  Inheriting the parent's `item`, `index`, `depth`,
            // `nodes`, `steps`, `collectedResults`, etc. pollutes the child's
            // context (especially when the Run Workflow node is inside a For/ForEach
            // loop).  The caller explicitly controls what the child sees via
            // inputMapping; everything else stays in the parent.
            const subPayload: Record<string, unknown> = {};
            if (rawMapping) {
              for (const { key, expr } of rawMapping) {
                if (key) subPayload[key] = resolveExprNative(expr, payload) ?? expr;
              }
            }
            subPayload._parentRunId = runId;
            subPayload._depth = currentDepth + 1;

            // ORDER BY versionNumber DESC guards against ever picking a stale
            // published row — e.g. if the archive-old/publish-new pair of
            // updates in the publish endpoint is not atomic, or any other edge
            // case leaves more than one version momentarily marked
            // "published" for this definition, the latest one always wins.
            const subVersionRows = await db.select()
              .from(wfVersionsTable)
              .where(and(eq(wfVersionsTable.definitionId, subDefId), eq(wfVersionsTable.status, "published")))
              .orderBy(desc(wfVersionsTable.versionNumber))
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
                  output = { ...mergedChildOutput, childRunId, depth: currentDepth + 1, maxDepth: RUN_WORKFLOW_MAX_DEPTH };
                  log.info({ runId, childRunId, subDefId, depth: currentDepth + 1, maxDepth: RUN_WORKFLOW_MAX_DEPTH }, "wf-executor: run_workflow completed — child outputs merged into parent context");
                }
              }
            }
             } // end depth-check else
          }
        } else if (actionType === "send_email") {
          // Real send_email implementation. Spec/docs previously said "via Resend" —
          // that was never built and is wrong; this uses the existing Graph-based
          // mailer (mailer.ts), same transport as send_campaign_email.
          const seTo = interp(node.data.to as string | undefined, payload)?.trim() || process.env.ADMIN_EMAIL || process.env.CRM_ADMIN_EMAIL || undefined;
          const seTemplateSlug = (node.data.templateSlug as string | undefined)?.trim();
          const seSubject = interp(node.data.subject as string | undefined, payload);
          const seHtmlBody = interp(node.data.htmlBody as string | undefined, payload);
          const seMspIdRaw = node.data.mspId as string | number | undefined;
          const seMspId = seMspIdRaw != null ? parseInt(interp(String(seMspIdRaw), payload) ?? String(seMspIdRaw), 10) : NaN;

          if (!seTo) {
            nodeError = true;
            output = { error: "send_email: 'to' resolved to empty — check the recipient expression" };
          } else if (!seTemplateSlug && !(seSubject?.trim() && seHtmlBody?.trim())) {
            nodeError = true;
            output = { error: "send_email requires either templateSlug, or both subject and htmlBody" };
          } else {
            const { sendEmailOrThrow, sendEmailForMspOrThrow, getEmailTemplateOrFallback } = await import("./mailer");
            const messageId = `wf-${runId}-${node.id}-${Date.now()}`;
            try {
              let finalSubject = seSubject ?? "";
              let finalBody = seHtmlBody ?? "";
              if (seTemplateSlug) {
                const reserved = new Set(["nodeType", "actionType", "label", "to", "templateSlug", "subject", "htmlBody", "mspId"]);
                const templateVars: Record<string, string> = {};
                for (const [k, v] of Object.entries(node.data)) {
                  if (!reserved.has(k) && v != null && typeof v !== "object") {
                    templateVars[k] = interp(String(v), payload) ?? String(v);
                  }
                }
                const resolved = await getEmailTemplateOrFallback(seTemplateSlug, templateVars, seSubject ?? "", seHtmlBody ?? "");
                finalSubject = resolved.subject;
                finalBody = resolved.bodyHtml;
              }
              if (!isNaN(seMspId)) {
                await sendEmailForMspOrThrow(seMspId, seTo, finalSubject, finalBody);
              } else {
                await sendEmailOrThrow(seTo, finalSubject, finalBody, seTemplateSlug ? { templateName: seTemplateSlug } : undefined);
              }
              output = { sent: true, messageId, recipient: seTo, subject: finalSubject, sourceRef: seTemplateSlug ? `template:${seTemplateSlug}` : "inline" };
            } catch (err) {
              nodeError = true;
              const errorMessage = err instanceof Error ? err.message : String(err);
              log.warn({ runId, nodeId: node.id, err, to: seTo }, "wf-executor: send_email failed");
              output = { sent: false, error: errorMessage };
            }
          }
        } else if (actionType === "charge_msp_card") {
          const cmcSowId = interp(node.data.sowId as string | undefined, payload);
          const cmcMspIdRaw = interp(node.data.mspId as string | undefined, payload);
          const cmcAmountRaw = interp(node.data.amountCents as string | undefined, payload);
          const cmcActorUserIdRaw = interp(node.data.actorUserId as string | undefined, payload);

          const cmcMspId = parseInt(cmcMspIdRaw ?? "", 10);
          const cmcAmountCents = parseInt(cmcAmountRaw ?? "", 10);
          const cmcActorUserId = cmcActorUserIdRaw ? parseInt(cmcActorUserIdRaw, 10) : NaN;

          if (!cmcSowId || isNaN(cmcMspId) || isNaN(cmcAmountCents)) {
            nodeError = true;
            output = { error: "charge_msp_card requires sowId, mspId, and amountCents to resolve" };
          } else {
            try {
              const { triggerMspCharge } = await import("../routes/msp-sow");
              const result = await triggerMspCharge(
                cmcSowId, cmcMspId, cmcAmountCents,
                isNaN(cmcActorUserId) ? null : cmcActorUserId,
              );
              if (!result.success && result.status === "failed") nodeError = true;
              output = { ...result };
            } catch (err) {
              nodeError = true;
              const errorMessage = err instanceof Error ? err.message : String(err);
              log.warn({ runId, nodeId: node.id, err, sowId: cmcSowId }, "wf-executor: charge_msp_card failed");
              output = { success: false, status: "failed", error: errorMessage };
            }
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

      case "check_script_output": {
        // Fully deterministic: HTTP status code detection + output schema shape validation.
        // No AI call, no token cost.
        const rawOutput   = interp(node.data.scriptOutput as string | undefined, payload) ?? "";
        const sensitivity = (node.data.sensitivity as string | undefined) ?? "balanced";
        const outputSchema = node.data.outputSchema as Record<string, unknown> | undefined;
        if (dryRun) {
          conditionResult = true;
          output = { dryRun: true, passed: true, outcome: "Dry run: output accepted (deterministic mode)" };
          break;
        }

        // 1. Schema validation if outputSchema is present
        if (outputSchema) {
          const { validateOutputShape } = await import("./monitor-executor");
          let parsed: unknown = rawOutput;
          try { parsed = JSON.parse(rawOutput); } catch { /* keep as string */ }
          const { valid, errors } = validateOutputShape(parsed, outputSchema);
          conditionResult = valid;
          output = {
            passed: valid,
            outcome: valid
              ? "Output matches expected schema"
              : `Schema validation failed: ${errors.slice(0, 3).join("; ")}`,
            sensitivity,
            schemaErrors: valid ? [] : errors,
          };
          break;
        }

        // 2. HTTP status code heuristic — scan for failure patterns
        const isEmpty = rawOutput.trim().length === 0;
        if (isEmpty) {
          const lenientPass = sensitivity === "lenient" || sensitivity === "very_lenient";
          conditionResult = lenientPass;
          output = { passed: lenientPass, outcome: "Script produced no output", sensitivity };
          break;
        }

        const fatalPatterns = [
          /\b(fatal|unhandled exception|terminated|crash)\b/i,
          /Exception calling "[\w]+" with "[\d]+" argument/i,
          /TerminatingError/i,
        ];
        const errorPatterns = [
          /\bERROR\b.*:/i,
          /\bException\b/i,
          /status\s*[=:]\s*[4-9]\d{2}\b/i,
          /HTTP[/ ]\d\.\d\s+[4-9]\d{2}\b/i,
          /exit code[: ]+[1-9]\d*/i,
        ];
        const successPatterns = [
          /status\s*[=:]\s*2\d{2}\b/i,
          /HTTP[/ ]\d\.\d\s+2\d{2}\b/i,
          /success|completed|done|ok\b/i,
        ];

        const hasFatal = fatalPatterns.some(p => p.test(rawOutput));
        const hasErrors = errorPatterns.some(p => p.test(rawOutput));
        const hasSuccess = successPatterns.some(p => p.test(rawOutput));

        let passed: boolean;
        let outcome: string;

        if (hasFatal) {
          passed = false;
          outcome = "Script produced a fatal/terminating error";
        } else if (sensitivity === "very_lenient") {
          passed = true;
          outcome = hasErrors ? "Partial errors detected but not fatal (very_lenient mode)" : "Output received";
        } else if (sensitivity === "lenient") {
          passed = !hasFatal && (!hasErrors || hasSuccess);
          outcome = passed ? "Output looks healthy or has recoverable errors" : "Output indicates significant failure";
        } else if (sensitivity === "strict") {
          passed = !hasErrors && !hasFatal;
          outcome = passed ? "No errors detected" : "Errors found (strict mode)";
        } else {
          // balanced
          passed = !hasFatal && (!hasErrors || hasSuccess);
          outcome = passed ? "Output looks acceptable" : "Output contains errors without success indicators";
        }

        conditionResult = passed;
        output = { passed, outcome, sensitivity };
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
          log.warn({ runId, arrayPath: feCleanPath, resolvedType: typeof feResolved },
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

      case "for": {
        // Resolve the array from the payload using a token expression (e.g. {{steps.n1.items}}).
        const forArraySource = (node.data.arraySource as string | undefined) ?? "";
        const forResolved = interp(forArraySource, payload);
        let forItems: unknown[] | null = null;
        if (Array.isArray(forResolved)) {
          forItems = forResolved;
        } else if (typeof forResolved === "string" && forResolved.trim().length > 0) {
          const trimmed = forResolved.trim();
          let parsedJson: unknown = undefined;
          try {
            parsedJson = JSON.parse(trimmed);
          } catch {
            // not valid JSON — fall through to comma-split
          }
          if (parsedJson !== undefined) {
            if (Array.isArray(parsedJson)) {
              forItems = parsedJson;
            } else {
              log.warn({ runId, arraySource: forArraySource, resolvedType: typeof parsedJson },
                "workflow-executor: for loop arraySource resolved to a non-array JSON value — skipping all iterations");
            }
          } else {
            forItems = trimmed.split(",").map(s => s.trim()).filter(s => s.length > 0);
          }
        }
        if (!forItems) {
          log.warn({ runId, arraySource: forArraySource, resolvedType: typeof forResolved },
            "workflow-executor: for loop arraySource did not resolve to an array — skipping all iterations");
        }
        const forMaxIter = (node.data.maxIterations as number | undefined) ?? null;
        output = {
          forItems: forItems ?? [],
          forSkipped: !forItems,
          arraySource: forArraySource,
          maxIterations: forMaxIter,
        };
        break;
      }

      case "parallel":
        // Execution handled by the BFS block below; executeNode just returns an empty output.
        output = {};
        break;

      case "join":
        // Pass-through merge point — no-op in executeNode; BFS resolves edges and logs a summary.
        output = { joined: true };
        break;

      case "retry":
        // No-op — all retry logic is handled in the BFS block after executeNode returns.
        // nodeError stays false so the BFS can enter the retry block normally.
        output = {};
        break;

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
          const abortExpression = node.data.abortExpression as string | undefined;
          const refreshNodeIds = node.data.refreshNodeIds as string[] | undefined;
          const intervalMs = Math.max(1000, ((node.data.interval as number | undefined) ?? 30) * 1000);
          const timeoutMs = ((node.data.timeout as number | undefined) ?? 300) * 1000;
          const deadline = Date.now() + timeoutMs;

          let refreshNodes: WfNode[] = [];
          if (refreshNodeIds && refreshNodeIds.length > 0) {
            const runRows = await db.select({ versionId: wfRunsTable.versionId })
              .from(wfRunsTable)
              .where(eq(wfRunsTable.id, runId))
              .limit(1);
            const rRow = runRows[0];
            if (rRow) {
              const versionRows = await db.select({ graph: wfVersionsTable.graph })
                .from(wfVersionsTable)
                .where(eq(wfVersionsTable.id, rRow.versionId))
                .limit(1);
              const vRow = versionRows[0];
              if (vRow) {
                const graph = (vRow.graph as WfGraph) ?? { nodes: [], edges: [] };
                refreshNodes = graph.nodes.filter(n => refreshNodeIds.includes(n.id));
              }
            }
          }

          let met = false;
          let aborted = false;
          while (Date.now() < deadline) {
            if (refreshNodes.length > 0) {
              for (const rNode of refreshNodes) {
                try {
                  const rResult = await executeNode(rNode, payload, runId, dryRun, inputValues, definitionId);
                  const prevNodes = (payload.nodes as Record<string, unknown>) ?? {};
                  const updatedNodes = { ...prevNodes, [rNode.id]: rResult.output };
                  payload = {
                    ...payload,
                    ...rResult.output,
                    nodes: updatedNodes,
                    steps: updatedNodes,
                  };
                } catch (err) {
                  log.error({ runId, nodeId: node.id, refreshNodeId: rNode.id, err }, "wf-executor: delay node refresh failed for sub-node");
                }
              }
            }

            if (expression && evalCondition(expression, payload)) {
              met = true;
              break;
            }

            if (abortExpression && evalCondition(abortExpression, payload)) {
              aborted = true;
              break;
            }

            const waitTime = Math.min(intervalMs, deadline - Date.now());
            if (waitTime <= 0) break;
            await new Promise(r => setTimeout(r, waitTime));
          }

          if (aborted) {
            output = { mode, conditionMet: false, aborted: true };
          } else {
            output = { mode, conditionMet: met };
          }
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
            if (lead.stage !== "Cold") score += 20;
            const scoreLabel = score >= 80 ? "High" : score >= 50 ? "Medium" : "Low";
            const qualified = score >= threshold;
            const stage = qualified ? "Hot" : "Warm";
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

      case "write_crm_scores": {
        // Runs the CRM scoring engine (crm-engine.ts) for a tenant/client and
        // persists the resulting scores onto the lead record's priorityScore
        // and pricingInfluenceScore columns. The engine itself is a pure sum
        // over the tenant's fired `crm:*` signals — this node only decides
        // which score-object field maps to which CRM column (default: the
        // combined `total` for both), so no scoring formula lives here.
        const leadIdRaw = interp(node.data.leadId as string | undefined, payload);
        const leadId = leadIdRaw ? parseInt(leadIdRaw, 10) : NaN;
        const clientUserIdRaw = interp(node.data.clientUserId as string | undefined, payload);
        const clientUserId = clientUserIdRaw ? parseInt(clientUserIdRaw, 10) : NaN;

        if (isNaN(leadId) || isNaN(clientUserId)) {
          nodeError = true;
          output = { error: "write_crm_scores requires a valid leadId and clientUserId" };
        } else {
          const priorityField = (interp(node.data.priorityScoreField as string | undefined, payload) ?? "total") as keyof CrmScoreBreakdown;
          const pricingField = (interp(node.data.pricingInfluenceScoreField as string | undefined, payload) ?? "total") as keyof CrmScoreBreakdown;

          const crmScoreResult = await calculateCrmScore(clientUserId);
          const priorityScore = crmScoreResult.score[priorityField] ?? crmScoreResult.score.total;
          const pricingInfluenceScore = crmScoreResult.score[pricingField] ?? crmScoreResult.score.total;

          await db.update(leadsTable)
            .set({ priorityScore, pricingInfluenceScore })
            .where(eq(leadsTable.id, leadId));

          output = {
            leadId,
            clientUserId,
            priorityScore,
            pricingInfluenceScore,
            crmScore: crmScoreResult.score,
            crmSignals: crmScoreResult.breakdown.map(b => b.signalKey),
          };
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
              .set({ stage: stage as "Junk" | "Cold" | "Warm" | "Hot" })
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
          output = { error: "Azure is not configured — add required secrets" };
        } else {
          const job = await createScriptJob({ runbookName, parameters: { ClientId: vpClientIdRaw } });
          output = { permissionsValid: true, missingCount: 0, jobId: job.jobId };
        }
        break;
      }

      case "update_intelligence_tables": {
        const uitClientIdRaw = interp(node.data.clientId as string | undefined, payload);
        const uitClientId = uitClientIdRaw ? parseInt(uitClientIdRaw, 10) : NaN;
        if (isNaN(uitClientId)) {
          nodeError = true;
          output = { error: "update_intelligence_tables requires a valid clientId" };
        } else {
          // Fetch the most recent completed script run for this client
          const [latestRun] = await db
            .select({
              id: scriptRunResultsTable.id,
              rawOutput: scriptRunResultsTable.rawOutput,
              parsedFindings: scriptRunResultsTable.parsedFindings,
              recommendations: scriptRunResultsTable.recommendations,
              scoreImpact: scriptRunResultsTable.scoreImpact,
            })
            .from(scriptRunResultsTable)
            .where(
              and(
                eq(scriptRunResultsTable.customerId, uitClientId),
                eq(scriptRunResultsTable.status, "completed"),
              )
            )
            .orderBy(desc(scriptRunResultsTable.createdAt))
            .limit(1);

          if (!latestRun) {
            nodeError = true;
            output = { error: "No completed script run found for this client" };
          } else {
            const scores = await scoreHealthFromScriptRun({
              scriptRunId: latestRun.id,
              rawOutput: latestRun.rawOutput ?? {},
              parsedFindings: latestRun.parsedFindings ?? [],
              recommendations: latestRun.recommendations ?? [],
              scoreImpact: latestRun.scoreImpact ?? {},
            });

            // Map copilotReadiness → copilot for the DB category enum
            const categoryMap: Record<string, string> = {
              identity: "identity",
              security: "security",
              collaboration: "collaboration",
              compliance: "compliance",
              copilotReadiness: "copilot",
            };

            type HealthHistoryCategory = "identity" | "security" | "collaboration" | "compliance" | "copilot" | "governance" | "productivity" | "data";
            const now = new Date();
            await db.insert(clientHealthHistoryTable).values(
              Object.entries(scores).map(([key, score]) => ({
                clientId: uitClientId,
                category: (categoryMap[key] ?? key) as HealthHistoryCategory,
                score,
                recordedAt: now,
              }))
            );

            output = {
              updated: true,
              scores,
              recordCount: Object.keys(scores).length,
              scriptRunId: latestRun.id,
            };
          }
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

      case "get_tenant_signals": {
        const gtsClientIdRaw = interp(node.data.clientId as string | undefined, payload);
        const gtsClientId = gtsClientIdRaw ? parseInt(gtsClientIdRaw, 10) : NaN;
        if (isNaN(gtsClientId)) {
          nodeError = true;
          output = {
            error: "get_tenant_signals requires a valid clientId",
            customerError: "Unable to retrieve your tenant signals — no client ID was provided.",
          };
        } else {
          try {
            // Resolve usersTable.id -> mspCustomersTable.tenantId via the same join
            // pattern used in portal.ts's ensureDirectCustomerRecord/ensureClientMspUser.
            const [customerRow] = await db
              .select({
                tenantId: mspCustomersTable.tenantId,
                customerId: mspCustomersTable.id,
                mspId: mspCustomersTable.mspId,
              })
              .from(mspUsersTable)
              .innerJoin(mspCustomersTable, eq(mspUsersTable.customerId, mspCustomersTable.id))
              .where(eq(mspUsersTable.userId, gtsClientId))
              .limit(1);
            const gtsTenantId = customerRow?.tenantId ?? null;

            const [profileRow, scriptRuns, monitorRows] = await Promise.all([
              db.select({ profile: clientM365ProfilesTable.profile })
                .from(clientM365ProfilesTable)
                .where(eq(clientM365ProfilesTable.clientId, gtsClientId))
                .limit(1),
              db.select({
                parsedFindings: scriptRunResultsTable.parsedFindings,
                profileUpdates: scriptRunResultsTable.profileUpdates,
              })
              .from(scriptRunResultsTable)
              .where(and(
                eq(scriptRunResultsTable.customerId, gtsClientId),
                eq(scriptRunResultsTable.status, "completed"),
              ))
              .orderBy(desc(scriptRunResultsTable.createdAt))
              .limit(50),
              gtsTenantId
                ? db.selectDistinctOn([tenantMonitorProfilesTable.checkKey], {
                    checkKey: tenantMonitorProfilesTable.checkKey,
                    extractedProperties: tenantMonitorProfilesTable.extractedProperties,
                  })
                  .from(tenantMonitorProfilesTable)
                  .where(eq(tenantMonitorProfilesTable.tenantId, gtsTenantId))
                  .orderBy(tenantMonitorProfilesTable.checkKey, desc(tenantMonitorProfilesTable.collectedAt))
                : Promise.resolve([]),
            ]);

            // Legacy (scriptRunResultsTable) profile first, oldest-first so newer
            // legacy runs win over older ones, matching the pre-existing behavior.
            const mergedProfile: Record<string, unknown> = {};
            for (const run of [...scriptRuns].reverse()) {
              Object.assign(mergedProfile, run.profileUpdates ?? {});
            }
            Object.assign(mergedProfile, (profileRow[0]?.profile as Record<string, unknown> | null) ?? {});

            // Monitor data merged in last so it wins on key collision (it's the
            // fresher, modern pipeline). Each check contributes a synthetic
            // `${checkKey}__itemCount` key that "threshold" rules read.
            for (const row of monitorRows) {
              const props = (row.extractedProperties as Record<string, unknown> | null) ?? {};
              mergedProfile[`${row.checkKey}__itemCount`] = props["_itemCount"] ?? 0;
            }

            const allFindings = [...new Set(scriptRuns.flatMap(r => (r.parsedFindings as string[] | null) ?? []))];

            const [signalRules, signalGroups, disabledSignalKeys] = await Promise.all([
              db.select().from(signalDerivationRulesTable).orderBy(signalDerivationRulesTable.sortOrder),
              db.select().from(signalRuleGroupsTable).orderBy(signalRuleGroupsTable.sortOrder),
              getDisabledSignalKeys(),
            ]);

            const [{ customerId: gtsCustomerId, mspId: gtsMspId }] = [customerRow ?? { customerId: null, mspId: null }];
            const { firedSignals } = computeTenantSignals(
              mergedProfile,
              allFindings,
              coerceDecayRate(signalRules as unknown as SignalDerivationRule[]) as Parameters<typeof computeTenantSignals>[2],
              coerceDecayRate(signalGroups as unknown as SignalRuleGroup[]) as Parameters<typeof computeTenantSignals>[3],
              disabledSignalKeys,
              gtsCustomerId != null && gtsMspId != null ? { customerId: gtsCustomerId, mspId: gtsMspId } : undefined,
            );

            const signals = [...firedSignals];
            const hasSignals = firedSignals.size > 1;
            output = { signals, signalCount: signals.length, hasSignals };
            log.info({ runId, gtsClientId, gtsTenantId, monitorCheckCount: monitorRows.length, signalCount: signals.length, hasSignals }, "wf-executor: get_tenant_signals completed");
          } catch (gtsErr) {
            nodeError = true;
            const errMsg = gtsErr instanceof Error ? gtsErr.message : String(gtsErr);
            output = {
              error: errMsg,
              customerError: "Unable to retrieve your tenant signals — an error occurred. Please retry or contact support.",
            };
            log.error({ runId, gtsErr }, "wf-executor: get_tenant_signals failed");
          }
        }
        break;
      }

      case "evaluate_signal_policies": {
        try {
          const { evaluateAllPolicies } = await import("./policy-engine.ts");
          const result = await evaluateAllPolicies();
          output = { customersChecked: result.customersChecked, totalFired: result.totalFired };
          log.info({ runId, ...result }, "wf-executor: evaluate_signal_policies node executed");
        } catch (espErr) {
          nodeError = true;
          const errMsg = espErr instanceof Error ? espErr.message : String(espErr);
          output = { error: `evaluate_signal_policies failed: ${errMsg.slice(0, 200)}` };
          log.warn({ runId, err: espErr }, "wf-executor: evaluate_signal_policies node failed");
        }
        break;
      }

      case "calculate_priority":
      case "calculate_pricing_engine":
      case "calculate_health":
      case "calculate_drift":
      case "calculate_forecast":
      case "calculate_crm":
      case "calculate_msp": {
        const engineKey = ENGINE_NODE_TYPE_MAP[node.type as EngineNodeType];
        const ceClientIdRaw = interp(node.data.clientId as string | undefined, payload);
        const ceClientId = ceClientIdRaw ? parseInt(ceClientIdRaw, 10) : NaN;
        if (isNaN(ceClientId)) {
          nodeError = true;
          output = {
            error: `${node.type} requires a valid clientId`,
            customerError: "Unable to compute this score — no client ID was provided.",
          };
        } else {
          try {
            const def = getEngineDef(engineKey);
            if (!def) {
              nodeError = true;
              output = { error: `Unknown engine: ${engineKey}` };
            } else {
              const result = await def.runForTenant(ceClientId);
              output = { engine: engineKey, ...(result as Record<string, unknown>) };
              log.info({ runId, ceClientId, engine: engineKey }, "wf-executor: engine node completed");
            }
          } catch (ceErr) {
            nodeError = true;
            const errMsg = ceErr instanceof Error ? ceErr.message : String(ceErr);
            output = {
              error: errMsg,
              customerError: "Unable to compute this score — an error occurred. Please retry or contact support.",
            };
            log.error({ runId, ceErr }, "wf-executor: engine node failed");
          }
        }
        break;
      }

      case "sla_start_timer": {
        const { startSlaTimer: slaStartTimer } = await import("./sla-engine.ts");
        const slaMspId = parseInt(interp(node.data.mspId as string | undefined, payload) ?? "", 10);
        const slaCustomerId = parseInt(interp(node.data.customerId as string | undefined, payload) ?? "", 10);
        const slaPolicyId = parseInt(interp(node.data.policyId as string | undefined, payload) ?? "", 10);
        if (isNaN(slaMspId) || isNaN(slaCustomerId) || isNaN(slaPolicyId)) {
          nodeError = true;
          output = { error: "sla_start_timer requires mspId, customerId, and policyId" };
        } else {
          try {
            const slaStartResult = await slaStartTimer({
              mspId: slaMspId,
              customerId: slaCustomerId,
              policyId: slaPolicyId,
              ticketRef: interp(node.data.ticketRef as string | undefined, payload) ?? undefined,
              ticketType: (interp(node.data.ticketType as string | undefined, payload) ?? "incident") || "incident",
              phase: ((interp(node.data.phase as string | undefined, payload) ?? "response") as "response" | "resolution"),
              idempotencyKey: interp(node.data.idempotencyKey as string | undefined, payload) ?? undefined,
              traceId: String(runId),
            });
            output = slaStartResult;
            log.info({ runId, timerId: slaStartResult.timerId }, "wf-executor: sla_start_timer completed");
          } catch (slaErr) {
            nodeError = true;
            output = { error: slaErr instanceof Error ? slaErr.message : String(slaErr) };
            log.error({ runId, slaErr }, "wf-executor: sla_start_timer failed");
          }
        }
        break;
      }

      case "sla_stop_timer": {
        const { stopSlaTimer: slaStopTimer } = await import("./sla-engine.ts");
        const slaStopTimerId = interp(node.data.timerId as string | undefined, payload) ?? "";
        if (!slaStopTimerId) {
          nodeError = true;
          output = { error: "sla_stop_timer requires timerId" };
        } else {
          try {
            const stopped = await slaStopTimer(slaStopTimerId);
            output = { stopped, timerId: slaStopTimerId };
            log.info({ runId, timerId: slaStopTimerId, stopped }, "wf-executor: sla_stop_timer completed");
          } catch (slaStopErr) {
            nodeError = true;
            output = { error: slaStopErr instanceof Error ? slaStopErr.message : String(slaStopErr) };
            log.error({ runId, slaStopErr }, "wf-executor: sla_stop_timer failed");
          }
        }
        break;
      }

      case "sla_warning": {
        const slaWarnTimerId = interp(node.data.timerId as string | undefined, payload) ?? "";
        if (!slaWarnTimerId) {
          nodeError = true;
          output = { error: "sla_warning requires timerId" };
        } else {
          try {
            const { db: slaDb } = await import("@workspace/db");
            const { sql: slaSql } = await import("drizzle-orm");
            await slaDb.execute(slaSql`
              UPDATE sla_timers SET warning_fired_at = NOW(), updated_at = NOW()
              WHERE timer_id = ${slaWarnTimerId} AND warning_fired_at IS NULL
            `);
            output = { warningFired: true, timerId: slaWarnTimerId };
            log.info({ runId, timerId: slaWarnTimerId }, "wf-executor: sla_warning fired");
          } catch (slaWarnErr) {
            nodeError = true;
            output = { error: slaWarnErr instanceof Error ? slaWarnErr.message : String(slaWarnErr) };
            log.error({ runId, slaWarnErr }, "wf-executor: sla_warning failed");
          }
        }
        break;
      }

      case "sla_breach": {
        const { fireSlaBreachRecord: slaFireBreach } = await import("./sla-engine.ts");
        const slaBreachTimerId = interp(node.data.timerId as string | undefined, payload) ?? "";
        const slaBreachMspId = parseInt(interp(node.data.mspId as string | undefined, payload) ?? "", 10);
        const slaBreachCustomerId = parseInt(interp(node.data.customerId as string | undefined, payload) ?? "", 10);
        const slaBreachPolicyId = parseInt(interp(node.data.policyId as string | undefined, payload) ?? "", 10);
        const slaBreachElapsed = parseInt(interp(node.data.elapsedMinutes as string | undefined, payload) ?? "0", 10);
        const slaBreachThreshold = parseInt(interp(node.data.thresholdMinutes as string | undefined, payload) ?? "60", 10);
        if (!slaBreachTimerId || isNaN(slaBreachMspId) || isNaN(slaBreachCustomerId) || isNaN(slaBreachPolicyId)) {
          nodeError = true;
          output = { error: "sla_breach requires timerId, mspId, customerId, and policyId" };
        } else {
          try {
            const slaBreachResult = await slaFireBreach({
              timerId: slaBreachTimerId,
              mspId: slaBreachMspId,
              customerId: slaBreachCustomerId,
              policyId: slaBreachPolicyId,
              ticketRef: interp(node.data.ticketRef as string | undefined, payload) ?? undefined,
              phase: ((interp(node.data.phase as string | undefined, payload) ?? "response") as "response" | "resolution"),
              elapsedMinutes: isNaN(slaBreachElapsed) ? 0 : slaBreachElapsed,
              thresholdMinutes: isNaN(slaBreachThreshold) ? 60 : slaBreachThreshold,
              idempotencyKey: interp(node.data.idempotencyKey as string | undefined, payload) ?? undefined,
              traceId: String(runId),
            });
            output = slaBreachResult;
            log.info({ runId, breachId: slaBreachResult.breachId }, "wf-executor: sla_breach recorded");
          } catch (slaBreachErr) {
            nodeError = true;
            output = { error: slaBreachErr instanceof Error ? slaBreachErr.message : String(slaBreachErr) };
            log.error({ runId, slaBreachErr }, "wf-executor: sla_breach failed");
          }
        }
        break;
      }

      case "sla_escalate": {
        const { escalateSla: slaEscalate } = await import("./sla-engine.ts");
        const slaEscBreachId = interp(node.data.breachId as string | undefined, payload) ?? "";
        const slaEscMspId = parseInt(interp(node.data.mspId as string | undefined, payload) ?? "", 10);
        const slaEscCustomerId = parseInt(interp(node.data.customerId as string | undefined, payload) ?? "", 10);
        const slaEscLevel = parseInt(interp(node.data.level as string | undefined, payload) ?? "1", 10);
        if (!slaEscBreachId || isNaN(slaEscMspId) || isNaN(slaEscCustomerId)) {
          nodeError = true;
          output = { error: "sla_escalate requires breachId, mspId, and customerId" };
        } else {
          try {
            const slaEscResult = await slaEscalate({
              breachId: slaEscBreachId,
              mspId: slaEscMspId,
              customerId: slaEscCustomerId,
              level: isNaN(slaEscLevel) ? 1 : slaEscLevel,
              escalationType: (interp(node.data.escalationType as string | undefined, payload) as "operator_task" | "email" | "sms" | "webhook" | undefined) ?? "operator_task",
              assignedTo: interp(node.data.assignedTo as string | undefined, payload) ?? undefined,
              target: interp(node.data.target as string | undefined, payload) ?? undefined,
              idempotencyKey: interp(node.data.idempotencyKey as string | undefined, payload) ?? undefined,
              traceId: String(runId),
            });
            output = slaEscResult;
            log.info({ runId, escalationId: slaEscResult.escalationId }, "wf-executor: sla_escalate completed");
          } catch (slaEscErr) {
            nodeError = true;
            output = { error: slaEscErr instanceof Error ? slaEscErr.message : String(slaEscErr) };
            log.error({ runId, slaEscErr }, "wf-executor: sla_escalate failed");
          }
        }
        break;
      }

      case "sla_resolve": {
        const { resolveSlaTimer: slaResolve } = await import("./sla-engine.ts");
        const slaResTimerId = interp(node.data.timerId as string | undefined, payload) ?? "";
        if (!slaResTimerId) {
          nodeError = true;
          output = { error: "sla_resolve requires timerId" };
        } else {
          try {
            const resolved = await slaResolve(
              slaResTimerId,
              interp(node.data.notes as string | undefined, payload) ?? undefined,
            );
            output = { resolved, timerId: slaResTimerId };
            log.info({ runId, timerId: slaResTimerId, resolved }, "wf-executor: sla_resolve completed");
          } catch (slaResErr) {
            nodeError = true;
            output = { error: slaResErr instanceof Error ? slaResErr.message : String(slaResErr) };
            log.error({ runId, slaResErr }, "wf-executor: sla_resolve failed");
          }
        }
        break;
      }

      case "scope_creep_detect": {
        const { recordScopeCreepDetection: scRecord } = await import("./scope-creep-engine.ts");
        const scDetMspId = parseInt(interp(node.data.mspId as string | undefined, payload) ?? "", 10);
        const scDetCustomerId = parseInt(interp(node.data.customerId as string | undefined, payload) ?? "", 10);
        const scDetPolicyId = parseInt(interp(node.data.policyId as string | undefined, payload) ?? "", 10);
        const scDetType = (interp(node.data.detectionType as string | undefined, payload) ?? "drift") as "drift" | "expansion" | "timeline_slip";
        const scDetChangePct = parseFloat(interp(node.data.changePct as string | undefined, payload) ?? "0");
        if (isNaN(scDetMspId) || isNaN(scDetCustomerId) || isNaN(scDetPolicyId)) {
          nodeError = true;
          output = { error: "scope_creep_detect requires mspId, customerId, and policyId" };
        } else {
          try {
            const scDetResult = await scRecord({
              mspId: scDetMspId,
              customerId: scDetCustomerId,
              policyId: scDetPolicyId,
              detectionType: scDetType,
              ref: interp(node.data.ref as string | undefined, payload) ?? undefined,
              baselineValue: parseFloat(interp(node.data.baselineValue as string | undefined, payload) ?? "0") || 0,
              currentValue: parseFloat(interp(node.data.currentValue as string | undefined, payload) ?? "0") || 0,
              changePct: isNaN(scDetChangePct) ? 0 : scDetChangePct,
              idempotencyKey: interp(node.data.idempotencyKey as string | undefined, payload) ?? undefined,
              traceId: String(runId),
            });
            output = scDetResult;
            log.info({ runId, detectionId: scDetResult.detectionId }, "wf-executor: scope_creep_detect recorded");
          } catch (scDetErr) {
            nodeError = true;
            output = { error: scDetErr instanceof Error ? scDetErr.message : String(scDetErr) };
            log.error({ runId, scDetErr }, "wf-executor: scope_creep_detect failed");
          }
        }
        break;
      }

      case "scope_creep_score": {
        const { computeAndPersistScore: scScore } = await import("./scope-creep-engine.ts");
        const scScoreMspId = parseInt(interp(node.data.mspId as string | undefined, payload) ?? "", 10);
        const scScoreCustomerId = parseInt(interp(node.data.customerId as string | undefined, payload) ?? "", 10);
        const scScorePolicyId = parseInt(interp(node.data.policyId as string | undefined, payload) ?? "", 10);
        if (isNaN(scScoreMspId) || isNaN(scScoreCustomerId) || isNaN(scScorePolicyId)) {
          nodeError = true;
          output = { error: "scope_creep_score requires mspId, customerId, and policyId" };
        } else {
          try {
            const scScoreResult = await scScore({
              mspId: scScoreMspId,
              customerId: scScoreCustomerId,
              policyId: scScorePolicyId,
              idempotencyKey: interp(node.data.idempotencyKey as string | undefined, payload) ?? undefined,
              traceId: String(runId),
            });
            output = scScoreResult;
            log.info({ runId, scoreId: scScoreResult.scoreId, compositeScore: scScoreResult.compositeScore }, "wf-executor: scope_creep_score completed");
          } catch (scScoreErr) {
            nodeError = true;
            output = { error: scScoreErr instanceof Error ? scScoreErr.message : String(scScoreErr) };
            log.error({ runId, scScoreErr }, "wf-executor: scope_creep_score failed");
          }
        }
        break;
      }

      case "scope_creep_violation": {
        const { fireScopeCreepViolation: scViolation } = await import("./scope-creep-engine.ts");
        const scViolMspId = parseInt(interp(node.data.mspId as string | undefined, payload) ?? "", 10);
        const scViolCustomerId = parseInt(interp(node.data.customerId as string | undefined, payload) ?? "", 10);
        const scViolPolicyId = parseInt(interp(node.data.policyId as string | undefined, payload) ?? "", 10);
        const scViolScore = parseFloat(interp(node.data.compositeScore as string | undefined, payload) ?? "0");
        const scViolThreshold = parseFloat(interp(node.data.threshold as string | undefined, payload) ?? "60");
        if (isNaN(scViolMspId) || isNaN(scViolCustomerId) || isNaN(scViolPolicyId)) {
          nodeError = true;
          output = { error: "scope_creep_violation requires mspId, customerId, and policyId" };
        } else {
          try {
            const scViolResult = await scViolation({
              mspId: scViolMspId,
              customerId: scViolCustomerId,
              policyId: scViolPolicyId,
              detectionId: interp(node.data.detectionId as string | undefined, payload) ?? undefined,
              compositeScore: isNaN(scViolScore) ? 0 : scViolScore,
              threshold: isNaN(scViolThreshold) ? 60 : scViolThreshold,
              idempotencyKey: interp(node.data.idempotencyKey as string | undefined, payload) ?? undefined,
              traceId: String(runId),
            });
            output = scViolResult;
            if (scViolResult.belowThreshold) {
              log.info({ runId, compositeScore: isNaN(scViolScore) ? 0 : scViolScore, threshold: isNaN(scViolThreshold) ? 60 : scViolThreshold }, "wf-executor: scope_creep_violation skipped — score below threshold");
            } else {
              log.info({ runId, violationId: scViolResult.violationId, severity: scViolResult.severity }, "wf-executor: scope_creep_violation fired");
            }
          } catch (scViolErr) {
            nodeError = true;
            output = { error: scViolErr instanceof Error ? scViolErr.message : String(scViolErr) };
            log.error({ runId, scViolErr }, "wf-executor: scope_creep_violation failed");
          }
        }
        break;
      }

      case "scope_creep_escalate": {
        const { escalateScopeCreep: scEscalate } = await import("./scope-creep-engine.ts");
        const scEscViolationId = interp(node.data.violationId as string | undefined, payload) ?? "";
        const scEscMspId = parseInt(interp(node.data.mspId as string | undefined, payload) ?? "", 10);
        const scEscCustomerId = parseInt(interp(node.data.customerId as string | undefined, payload) ?? "", 10);
        const scEscLevel = parseInt(interp(node.data.level as string | undefined, payload) ?? "1", 10);
        if (!scEscViolationId || isNaN(scEscMspId) || isNaN(scEscCustomerId)) {
          nodeError = true;
          output = { error: "scope_creep_escalate requires violationId, mspId, and customerId" };
        } else {
          try {
            const scEscResult = await scEscalate({
              violationId: scEscViolationId,
              mspId: scEscMspId,
              customerId: scEscCustomerId,
              level: isNaN(scEscLevel) ? 1 : scEscLevel,
              escalationType: (interp(node.data.escalationType as string | undefined, payload) as "operator_task" | "email" | "sms" | "webhook" | undefined) ?? "operator_task",
              flagSowAmendment: (node.data.flagSowAmendment as boolean | undefined) ?? false,
              flagPricingReview: (node.data.flagPricingReview as boolean | undefined) ?? false,
              assignedTo: interp(node.data.assignedTo as string | undefined, payload) ?? undefined,
              target: interp(node.data.target as string | undefined, payload) ?? undefined,
              idempotencyKey: interp(node.data.idempotencyKey as string | undefined, payload) ?? undefined,
              traceId: String(runId),
            });
            output = scEscResult;
            log.info({ runId, escalationId: scEscResult.escalationId }, "wf-executor: scope_creep_escalate completed");
          } catch (scEscErr) {
            nodeError = true;
            output = { error: scEscErr instanceof Error ? scEscErr.message : String(scEscErr) };
            log.error({ runId, scEscErr }, "wf-executor: scope_creep_escalate failed");
          }
        }
        break;
      }

      case "scope_creep_resolve": {
        const { resolveScopeCreepViolation: scResolve } = await import("./scope-creep-engine.ts");
        const scResViolationId = interp(node.data.violationId as string | undefined, payload) ?? "";
        if (!scResViolationId) {
          nodeError = true;
          output = { error: "scope_creep_resolve requires violationId" };
        } else {
          try {
            const resolved = await scResolve(
              scResViolationId,
              interp(node.data.notes as string | undefined, payload) ?? undefined,
            );
            output = { resolved, violationId: scResViolationId };
            log.info({ runId, violationId: scResViolationId, resolved }, "wf-executor: scope_creep_resolve completed");
          } catch (scResErr) {
            nodeError = true;
            output = { error: scResErr instanceof Error ? scResErr.message : String(scResErr) };
            log.error({ runId, scResErr }, "wf-executor: scope_creep_resolve failed");
          }
        }
        break;
      }

      case "scope_creep_compliance_update": {
        const { computeScopeCreepCompliance: scCompliance } = await import("./scope-creep-engine.ts");
        const { randomUUID: scUUID } = await import("crypto");
        const { db: scDb } = await import("@workspace/db");
        const { sql: scSql } = await import("drizzle-orm");
        const scCompMspId = parseInt(interp(node.data.mspId as string | undefined, payload) ?? "", 10);
        const scCompCustomerId = parseInt(interp(node.data.customerId as string | undefined, payload) ?? "", 10);
        const scCompPolicyId = parseInt(interp(node.data.policyId as string | undefined, payload) ?? "", 10);
        const scCompPeriodStart = interp(node.data.periodStart as string | undefined, payload) ?? "";
        const scCompPeriodEnd = interp(node.data.periodEnd as string | undefined, payload) ?? "";
        if (isNaN(scCompMspId) || isNaN(scCompCustomerId) || isNaN(scCompPolicyId) || !scCompPeriodStart || !scCompPeriodEnd) {
          nodeError = true;
          output = { error: "scope_creep_compliance_update requires mspId, customerId, policyId, periodStart, and periodEnd" };
        } else {
          try {
            const snapshot = await scCompliance(
              scCompMspId,
              scCompCustomerId,
              scCompPolicyId,
              new Date(scCompPeriodStart),
              new Date(scCompPeriodEnd),
            );
            const scRecordId = scUUID();
            await scDb.execute(scSql`
              INSERT INTO scope_creep_compliance (
                record_id, msp_id, customer_id, policy_id,
                period_start, period_end,
                total_detections, violation_count, compliance_pct, avg_composite_score, notes
              ) VALUES (
                ${scRecordId}, ${scCompMspId}, ${scCompCustomerId}, ${scCompPolicyId},
                ${scCompPeriodStart}, ${scCompPeriodEnd},
                ${snapshot.totalDetections}, ${snapshot.violationCount},
                ${snapshot.compliancePct}, ${snapshot.avgCompositeScore},
                ${interp(node.data.notes as string | undefined, payload) ?? null}
              )
              ON CONFLICT DO NOTHING
            `);
            output = { recordId: scRecordId, ...snapshot };
            log.info({ runId, recordId: scRecordId, compliancePct: snapshot.compliancePct }, "wf-executor: scope_creep_compliance_update completed");
          } catch (scCompErr) {
            nodeError = true;
            output = { error: scCompErr instanceof Error ? scCompErr.message : String(scCompErr) };
            log.error({ runId, scCompErr }, "wf-executor: scope_creep_compliance_update failed");
          }
        }
        break;
      }

      // ── Sales Offer Engine nodes (live) ────────────────────────────────────

      case "sales_offer_generate": {
        const { runSalesOfferEngineForTenant: soRun, persistSalesOfferCandidates: soPersist } = await import("./sales-offer-engine.ts");
        const soTenantId = parseInt(interp(node.data.tenantId as string | undefined, payload) ?? "", 10);
        const soMspId = parseInt(interp(node.data.mspId as string | undefined, payload) ?? "", 10) || null;
        if (isNaN(soTenantId)) {
          nodeError = true;
          output = { error: "sales_offer_generate requires tenantId" };
        } else {
          try {
            const soResult = await soRun(soTenantId, soMspId);
            const soInserted = await soPersist(soResult.candidates, soTenantId, soMspId, soResult as unknown as Record<string, unknown>);
            output = { insertedOfferIds: soInserted, candidateCount: soResult.candidates.length, firedSignals: soResult.firedSignals };
            log.info({ runId, soTenantId, candidateCount: soResult.candidates.length, insertedCount: soInserted.length }, "wf-executor: sales_offer_generate completed");
          } catch (soGenErr) {
            nodeError = true;
            output = { error: soGenErr instanceof Error ? soGenErr.message : String(soGenErr) };
            log.error({ runId, soGenErr }, "wf-executor: sales_offer_generate failed");
          }
        }
        break;
      }

      case "sales_offer_score": {
        const { salesOffersTable: soTable, salesOfferRuleGroupsTable: soRgTable, servicesTable: soSvcTable } = await import("@workspace/db");
        const { computeSalesOfferEngine: soCompute, loadSalesOfferConfig: soLoadCfg, emitOfferEvent: soScoreEmit } = await import("./sales-offer-engine.ts");
        const { db: soDb } = await import("@workspace/db");
        const { eq: soEq } = await import("drizzle-orm");
        const soScoreOfferId = parseInt(interp(node.data.offerId as string | undefined, payload) ?? "", 10);
        if (isNaN(soScoreOfferId)) {
          nodeError = true;
          output = { error: "sales_offer_score requires offerId" };
        } else {
          try {
            const [soOffer] = await soDb.select().from(soTable).where(soEq(soTable.id, soScoreOfferId)).limit(1);
            if (!soOffer) throw new Error(`Sales offer ${soScoreOfferId} not found`);
            const [soRgs, soSvcs, soCfg] = await Promise.all([
              soDb.select().from(soRgTable).where(soEq(soRgTable.isActive, true)),
              soDb.select({ id: soSvcTable.id, name: soSvcTable.name, price: soSvcTable.price, basePrice: soSvcTable.basePrice }).from(soSvcTable),
              soLoadCfg(soOffer.mspId),
            ]);
            const soEngineOut = soCompute(soOffer.customerId, new Set(soOffer.firedSignalKeys ?? []), soRgs, soSvcs, soCfg);
            const soCandidate = soEngineOut.candidates.find(c => c.serviceId === soOffer.serviceId);
            const soNewScore = soCandidate?.score ?? 0;
            const soPrevScore = soOffer.score;
            await soDb.update(soTable).set({ score: soNewScore, updatedAt: new Date() }).where(soEq(soTable.id, soScoreOfferId));
            // Emit canonical offer.scored event for audit trail completeness
            await soScoreEmit(soScoreOfferId, "offer.scored", { previousScore: soPrevScore, newScore: soNewScore }, null);
            output = { offerId: soScoreOfferId, previousScore: soPrevScore, newScore: soNewScore };
            log.info({ runId, soScoreOfferId, soPrevScore, soNewScore }, "wf-executor: sales_offer_score completed");
          } catch (soScoreErr) {
            nodeError = true;
            output = { error: soScoreErr instanceof Error ? soScoreErr.message : String(soScoreErr) };
            log.error({ runId, soScoreErr }, "wf-executor: sales_offer_score failed");
          }
        }
        break;
      }

      case "sales_offer_violation": {
        // Idempotent: node.data.idempotencyKey prevents duplicate violation events when
        // the workflow node is retried (e.g. after a transient failure).
        const { emitOfferEvent: soEmit } = await import("./sales-offer-engine.ts");
        const soViolOfferId = parseInt(interp(node.data.offerId as string | undefined, payload) ?? "", 10);
        const soViolType = (interp(node.data.violationType as string | undefined, payload) ?? "policy");
        const soViolIdempKey = interp(node.data.idempotencyKey as string | undefined, payload) ?? null;
        if (isNaN(soViolOfferId)) {
          nodeError = true;
          output = { error: "sales_offer_violation requires offerId" };
        } else {
          try {
            const { alreadyExisted: soViolAlreadyExisted } = await soEmit(soViolOfferId, "offer.violation", { violationType: soViolType, note: interp(node.data.note as string | undefined, payload) ?? "" }, null, soViolIdempKey ?? undefined);
            if (soViolAlreadyExisted) {
              output = { offerId: soViolOfferId, violationType: soViolType, emitted: false, skipped: true, reason: "idempotent: already emitted" };
              log.info({ runId, soViolOfferId }, "wf-executor: sales_offer_violation skipped (idempotent)");
            } else {
              output = { offerId: soViolOfferId, violationType: soViolType, emitted: true };
              log.info({ runId, soViolOfferId, soViolType }, "wf-executor: sales_offer_violation emitted");
            }
          } catch (soViolErr) {
            nodeError = true;
            output = { error: soViolErr instanceof Error ? soViolErr.message : String(soViolErr) };
            log.error({ runId, soViolErr }, "wf-executor: sales_offer_violation failed");
          }
        }
        break;
      }

      case "sales_offer_escalate": {
        // Idempotent: dedupe on (offerId, "offer.escalated") when idempotencyKey supplied.
        const { emitOfferEvent: soEscEmit } = await import("./sales-offer-engine.ts");
        const soEscOfferId = parseInt(interp(node.data.offerId as string | undefined, payload) ?? "", 10);
        const soEscTo = interp(node.data.escalatedTo as string | undefined, payload) ?? "admin";
        const soEscIdempKey = interp(node.data.idempotencyKey as string | undefined, payload) ?? null;
        if (isNaN(soEscOfferId)) {
          nodeError = true;
          output = { error: "sales_offer_escalate requires offerId" };
        } else {
          try {
            const { alreadyExisted: soEscAlreadyExisted } = await soEscEmit(soEscOfferId, "offer.escalated", { escalatedTo: soEscTo, note: interp(node.data.note as string | undefined, payload) ?? "" }, null, soEscIdempKey ?? undefined);
            if (soEscAlreadyExisted) {
              output = { offerId: soEscOfferId, escalatedTo: soEscTo, emitted: false, skipped: true, reason: "idempotent: already emitted" };
              log.info({ runId, soEscOfferId }, "wf-executor: sales_offer_escalate skipped (idempotent)");
            } else {
              output = { offerId: soEscOfferId, escalatedTo: soEscTo, emitted: true };
              log.info({ runId, soEscOfferId, soEscTo }, "wf-executor: sales_offer_escalate emitted");
            }
          } catch (soEscErr) {
            nodeError = true;
            output = { error: soEscErr instanceof Error ? soEscErr.message : String(soEscErr) };
            log.error({ runId, soEscErr }, "wf-executor: sales_offer_escalate failed");
          }
        }
        break;
      }

      case "sales_offer_resolve": {
        const { transitionOfferState: soTransition } = await import("./sales-offer-engine.ts");
        const soResOfferId = parseInt(interp(node.data.offerId as string | undefined, payload) ?? "", 10);
        const soResState = (interp(node.data.newState as string | undefined, payload) ?? "accepted");
        const soResReason = interp(node.data.rejectionReason as string | undefined, payload) ?? undefined;
        if (isNaN(soResOfferId)) {
          nodeError = true;
          output = { error: "sales_offer_resolve requires offerId" };
        } else {
          try {
            const soUpdated = await soTransition(soResOfferId, soResState as import("@workspace/db").SalesOfferState, null, { rejectionReason: soResReason });
            output = { offerId: soResOfferId, newState: soResState, updatedAt: soUpdated.updatedAt };
            log.info({ runId, soResOfferId, soResState }, "wf-executor: sales_offer_resolve completed");
          } catch (soResErr) {
            nodeError = true;
            output = { error: soResErr instanceof Error ? soResErr.message : String(soResErr) };
            log.error({ runId, soResErr }, "wf-executor: sales_offer_resolve failed");
          }
        }
        break;
      }

      case "send_browser_notification": {
        const sbnTitle    = interp(node.data.title    as string | undefined, payload)?.trim() ?? "";
        const sbnBody     = interp(node.data.body     as string | undefined, payload) ?? "";
        const sbnLinkPath = interp(node.data.linkPath as string | undefined, payload)?.trim() || null;
        if (!sbnTitle) {
          log.warn({ runId }, "send_browser_notification: title is empty — skipping push");
          output = { notificationSent: false, skipped: true, reason: "title is empty" };
        } else {
          try {
            await sendWebPushToAdmins({ title: sbnTitle, body: sbnBody, linkPath: sbnLinkPath });
            output = { notificationSent: true };
          } catch (sbnErr) {
            log.warn({ sbnErr, runId }, "send_browser_notification: push dispatch failed — continuing run");
            output = { notificationSent: false, error: String(sbnErr) };
          }
        }
        break;
      }

      case "create_notification": {
        const cnTitle    = interp(node.data.title    as string | undefined, payload)?.trim() ?? "";
        const cnBody     = interp(node.data.body     as string | undefined, payload) ?? "";
        const cnLink     = interp(node.data.linkPath as string | undefined, payload)?.trim() || null;
        const cnType     = (interp(node.data.type    as string | undefined, payload)?.trim() || "message") as
          "project_update" | "message" | "invoice" | "document" | "general" | "lead_created" | "quiz_lead_created" | "purchase_created";
        const validTypes = ["project_update","message","invoice","document","general","lead_created","quiz_lead_created","purchase_created"] as const;
        const resolvedType = (validTypes as readonly string[]).includes(cnType) ? cnType : "message" as const;

        // channel: "inbox" enables Notification Center delivery in addition to legacy admin-only inserts
        const cnChannel  = (interp(node.data.channel  as string | undefined, payload)?.trim() || "default") as string;
        const cnCategory = interp(node.data.category  as string | undefined, payload)?.trim() || null;
        const cnSeverity = (interp(node.data.severity as string | undefined, payload)?.trim() || "info") as "info" | "warning" | "critical";
        const cnFeedType = (interp(node.data.feedType as string | undefined, payload)?.trim() || "personal") as "personal" | "all_activity";

        if (!cnTitle) {
          log.warn({ runId }, "create_notification: title is empty — skipping insert");
          output = { notificationCount: 0, skipped: true, reason: "title is empty" };
        } else if (cnChannel === "inbox") {
          // Notification Center path: insert for all admins with full NC fields
          const adminRows = await db
            .select({ id: usersTable.id })
            .from(usersTable)
            .where(eq(usersTable.role, "admin"));

          if (adminRows.length === 0) {
            log.warn({ runId }, "create_notification[inbox]: no admin users found — skipping");
            output = { notificationCount: 0, skipped: true, reason: "no admin users" };
          } else {
            const { broadcastNotification, broadcastUnreadCount } = await import("./sse-channels");
            await db.insert(notificationsTable).values(
              adminRows.map(row => ({
                userId: row.id,
                title: cnTitle,
                body: cnBody || null,
                type: resolvedType,
                linkPath: cnLink,
                read: false,
                feedType: cnFeedType,
                category: cnCategory,
                severity: cnSeverity,
                recipientType: "platform_admin" as const,
              })),
            );
            // SSE broadcast for each admin so open tabs update instantly
            const newNotif = {
              title: cnTitle, body: cnBody || null, category: cnCategory,
              severity: cnSeverity, linkPath: cnLink, feedType: cnFeedType,
              read: false, createdAt: new Date().toISOString(),
            };
            for (const row of adminRows) {
              broadcastNotification(row.id, newNotif);
              // Recompute unread count and push it
              const [cnt] = await db
                .select({ n: count() })
                .from(notificationsTable)
                .where(and(eq(notificationsTable.userId, row.id), eq(notificationsTable.feedType, "personal"), eq(notificationsTable.read, false)));
              broadcastUnreadCount(row.id, cnt?.n ?? 0);
            }
            log.info({ runId, notificationCount: adminRows.length, cnFeedType, cnCategory }, "create_notification[inbox]: inserted notifications");
            output = { notificationCount: adminRows.length };
          }
        } else {
          // Legacy path: insert for all admins without NC fields (backward compat)
          const adminRows = await db
            .select({ id: usersTable.id })
            .from(usersTable)
            .where(eq(usersTable.role, "admin"));

          if (adminRows.length === 0) {
            log.warn({ runId }, "create_notification: no admin users found — skipping insert");
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
            log.info({ runId, notificationCount: adminRows.length, cnType: resolvedType }, "create_notification: inserted notifications");
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
          log.warn({ runId }, "send_mobile_push: no device tokens registered — skipping");
          output = { sent: false, sentCount: 0 };
        } else {
          const tokens = tokenRows.map(r => r.token);
          await sendPushNotifications(tokens, smpTitle || "Notification", smpBody);
          log.info({ runId, sentCount: tokens.length }, "send_mobile_push: dispatched to device tokens");
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
            log.info({ runId, psCondOp, psCondExpr, resolved }, "play_sound: condition not met — skipping");
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
            log.info({ runId, psLabel }, "play_sound [desktop]: web push dispatched");
            output = { soundPlayed: true, soundTarget: "desktop" };
          } catch (psErr) {
            log.warn({ psErr, runId }, "play_sound [desktop]: push dispatch failed");
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
          log.info({ runId, psLabel }, "play_sound [browser]: SSE event broadcast");
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
        const fullHtml = await brandedEmail(renderedBody);
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
        const boardIdRaw = interp(node.data.boardId as string | undefined, payload) || "marketing";
        const columnId = node.data.columnId as string | undefined;
        const title = interp(node.data.titleExpr as string | undefined, payload);
        const description = interp(node.data.descriptionExpr as string | undefined, payload);
        const priority = (node.data.priority as string | undefined) ?? "medium";
        const phaseIdRaw = interp(node.data.phaseId as string | undefined, payload);
        const phaseIdNum = phaseIdRaw ? parseInt(phaseIdRaw, 10) : undefined;

        if (!columnId || !title?.trim()) {
          nodeError = true;
          output = { error: "create_kanban_task requires columnId and a non-empty title" };
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

      case "get_project_tasks": {
        const gptProjectIdRaw = interp(node.data.projectId as string | undefined, payload);
        if (!gptProjectIdRaw?.trim()) {
          nodeError = true;
          output = { error: "get_project_tasks: projectId is required" };
          break;
        }
        const gptProjectId = parseInt(gptProjectIdRaw, 10);
        if (isNaN(gptProjectId)) {
          nodeError = true;
          output = { error: `get_project_tasks: invalid projectId '${gptProjectIdRaw}'` };
          break;
        }

        // Query 0: fetch ALL phases for the project so empty phases appear in the output.
        // Starting from kanban_tasks would silently drop phases that have no tasks yet.
        const gptPhases = await db
          .select({
            id:                     workflowStepsTable.id,
            title:                  workflowStepsTable.title,
            status:                 workflowStepsTable.status,
            order:                  workflowStepsTable.order,
            workflowTemplateStepId: workflowStepsTable.workflowTemplateStepId,
          })
          .from(workflowStepsTable)
          .where(eq(workflowStepsTable.projectId, gptProjectId))
          .orderBy(workflowStepsTable.order);

        // Query 1: kanban_tasks left-joined to workflow_steps for per-task phase metadata.
        // Ordered so tasks within the same step appear in their creation order (kanban_tasks.order).
        const gptRows = await db
          .select({
            taskId:                    kanbanTasksTable.id,
            title:                     kanbanTasksTable.title,
            column:                    kanbanTasksTable.column,
            priority:                  kanbanTasksTable.priority,
            assignedTo:                kanbanTasksTable.assignedTo,
            dueDate:                   kanbanTasksTable.dueDate,
            groupName:                 kanbanTasksTable.groupName,
            taskType:                  kanbanTasksTable.taskType,
            taskMetadata:              kanbanTasksTable.taskMetadata,
            taskOrder:                 kanbanTasksTable.order,
            workflowStepId:            kanbanTasksTable.workflowStepId,
            phaseId:                   workflowStepsTable.id,
            phaseTitle:                workflowStepsTable.title,
            phaseStatus:               workflowStepsTable.status,
            phaseOrder:                workflowStepsTable.order,
            workflowTemplateStepId:    workflowStepsTable.workflowTemplateStepId,
          })
          .from(kanbanTasksTable)
          .leftJoin(workflowStepsTable, eq(kanbanTasksTable.workflowStepId, workflowStepsTable.id))
          .where(eq(kanbanTasksTable.projectId, gptProjectId))
          .orderBy(workflowStepsTable.order, kanbanTasksTable.order);

        // Query 2: fetch template step tasks for all steps that have a template link.
        // Include IDs from BOTH task rows AND phases — phases with no kanban tasks yet
        // still need their template tasks so we can synthesize entries for them.
        const gptTemplateStepIds = [...new Set([
          ...gptRows.map(r => r.workflowTemplateStepId).filter((id): id is number => id != null),
          ...gptPhases.map(p => p.workflowTemplateStepId).filter((id): id is number => id != null),
        ])];

        type TemplateMeta = {
          isCustomerTask: boolean;
          linkedRunbookId: string | null;
          customerDownloadScriptId: string | null;
          triggersHealthScore: boolean;
        };
        type FullTemplateMeta = TemplateMeta & {
          id: number;
          title: string;
          groupName: string | null;
          taskType: string | null;
          taskMetadata: Record<string, unknown> | null;
          runbookId: string | null;
        };
        // key: `${templateStepId}:${positionIndex}` → enrichment metadata for kanban tasks
        const gptTemplateMetaMap = new Map<string, TemplateMeta>();
        // key: templateStepId → ordered list of full template task data (for synthesizing tasks in empty phases)
        const gptTemplateTasksByStep = new Map<number, FullTemplateMeta[]>();

        if (gptTemplateStepIds.length > 0) {
          const gptTemplateTasks = await db
            .select({
              id:                       workflowTemplateStepTasksTable.id,
              workflowTemplateStepId:   workflowTemplateStepTasksTable.workflowTemplateStepId,
              title:                    workflowTemplateStepTasksTable.title,
              groupName:                workflowTemplateStepTasksTable.groupName,
              taskType:                 workflowTemplateStepTasksTable.taskType,
              taskMetadata:             workflowTemplateStepTasksTable.taskMetadata,
              order:                    workflowTemplateStepTasksTable.order,
              isCustomerTask:           workflowTemplateStepTasksTable.isCustomerTask,
              runbookId:                workflowTemplateStepTasksTable.runbookId,
              customerDownloadScriptId: workflowTemplateStepTasksTable.customerDownloadScriptId,
              triggersHealthScore:      workflowTemplateStepTasksTable.triggersHealthScore,
            })
            .from(workflowTemplateStepTasksTable)
            .where(inArray(workflowTemplateStepTasksTable.workflowTemplateStepId, gptTemplateStepIds))
            .orderBy(workflowTemplateStepTasksTable.workflowTemplateStepId, workflowTemplateStepTasksTable.order);

          // Group by templateStepId, track position index within each step
          const gptTemplateByStep = new Map<number, typeof gptTemplateTasks>();
          for (const tt of gptTemplateTasks) {
            const bucket = gptTemplateByStep.get(tt.workflowTemplateStepId) ?? [];
            bucket.push(tt);
            gptTemplateByStep.set(tt.workflowTemplateStepId, bucket);
          }

          for (const [stepId, tasks] of gptTemplateByStep) {
            const full: FullTemplateMeta[] = [];
            tasks.forEach((tt, idx) => {
              const entry: FullTemplateMeta = {
                id:                       tt.id,
                title:                    tt.title,
                groupName:                tt.groupName ?? null,
                taskType:                 tt.taskType ?? null,
                taskMetadata:             tt.taskMetadata ?? null,
                runbookId:                tt.runbookId ?? null,
                isCustomerTask:           tt.isCustomerTask ?? false,
                linkedRunbookId:          tt.runbookId ?? null,
                customerDownloadScriptId: tt.customerDownloadScriptId ?? null,
                triggersHealthScore:      tt.triggersHealthScore,
              };
              gptTemplateMetaMap.set(`${stepId}:${idx}`, entry);
              full.push(entry);
            });
            gptTemplateTasksByStep.set(stepId, full);
          }
        }

        // Query 3: resolve linked workflow names for run_workflow tasks.
        // Collect IDs from both live kanban rows AND synthesized template tasks so that
        // phases with no kanban tasks yet (whose entries come from gptTemplateTasksByStep)
        // still resolve their linked workflow names.
        const gptRunWorkflowIdSet = new Set<number>();
        for (const row of gptRows) {
          if (row.taskType === "run_workflow") {
            const wfId = (row.taskMetadata as any)?.runWorkflow?.workflowId;
            if (typeof wfId === "number" && wfId > 0) gptRunWorkflowIdSet.add(wfId);
          }
        }
        for (const tasks of gptTemplateTasksByStep.values()) {
          for (const tt of tasks) {
            if (tt.taskType === "run_workflow") {
              const wfId = (tt.taskMetadata as any)?.runWorkflow?.workflowId;
              if (typeof wfId === "number" && wfId > 0) gptRunWorkflowIdSet.add(wfId);
            }
          }
        }
        const gptRunWorkflowIds = [...gptRunWorkflowIdSet];
        const gptWorkflowNameMap = new Map<number, string>();
        if (gptRunWorkflowIds.length > 0) {
          const gptWfDefs = await db
            .select({ id: wfDefinitionsTable.id, name: wfDefinitionsTable.name })
            .from(wfDefinitionsTable)
            .where(inArray(wfDefinitionsTable.id, gptRunWorkflowIds));
          for (const def of gptWfDefs) {
            gptWorkflowNameMap.set(def.id, def.name);
          }
        }

        // Track position index of each kanban task within its step (for template task matching)
        const gptStepPositionCount = new Map<string, number>();

        type PhaseGroup = {
          phaseId: number | null;
          phaseTitle: string;
          phaseStatus: string | null;
          order: number;
          tasks: Array<{
            taskId: number | null;
            title: string;
            column: string;
            priority: string;
            assignedTo: string | null;
            dueDate: Date | null;
            groupName: string | null;
            taskType: string | null;
            isCustomerTask: boolean | null;
            linkedRunbookId: string | null;
            customerDownloadScriptId: string | null;
            triggersHealthScore: boolean | null;
            linkedWorkflowId: number | null;
            linkedWorkflowName: string | null;
            taskMetadata: unknown;
          }>;
        };

        const phaseMap = new Map<string, PhaseGroup>();

        // Pre-seed phaseMap with ALL phases so empty phases appear in the output.
        for (const phase of gptPhases) {
          phaseMap.set(String(phase.id), {
            phaseId:     phase.id,
            phaseTitle:  phase.title,
            phaseStatus: phase.status,
            order:       phase.order,
            tasks:       [],
          });
        }

        for (const row of gptRows) {
          const phaseKey = row.phaseId != null ? String(row.phaseId) : "__unassigned__";
          if (!phaseMap.has(phaseKey)) {
            phaseMap.set(phaseKey, {
              phaseId:     row.phaseId ?? null,
              phaseTitle:  row.phaseTitle ?? "Unassigned",
              phaseStatus: row.phaseStatus ?? null,
              order:       row.phaseOrder ?? 9999,
              tasks:       [],
            });
          }

          // Determine position of this kanban task within its workflow step (for template lookup)
          const posKey = String(row.workflowStepId ?? "__none__");
          const posIdx = gptStepPositionCount.get(posKey) ?? 0;
          gptStepPositionCount.set(posKey, posIdx + 1);

          // Look up template task metadata for this position, falling back to taskMetadata JSONB
          let templateMeta: TemplateMeta | undefined;
          if (row.workflowTemplateStepId != null) {
            templateMeta = gptTemplateMetaMap.get(`${row.workflowTemplateStepId}:${posIdx}`);
          }
          const metaFallback = (row.taskMetadata ?? {}) as Record<string, unknown>;

          const gptLinkedWfId = row.taskType === "run_workflow"
            ? ((row.taskMetadata as any)?.runWorkflow?.workflowId ?? null)
            : null;
          phaseMap.get(phaseKey)!.tasks.push({
            taskId:                   row.taskId,
            title:                    row.title,
            column:                   row.column,
            priority:                 row.priority,
            assignedTo:               row.assignedTo ?? null,
            dueDate:                  row.dueDate ?? null,
            groupName:                row.groupName ?? null,
            taskType:                 row.taskType ?? null,
            isCustomerTask:           templateMeta?.isCustomerTask ?? (typeof metaFallback.isCustomerTask === "boolean" ? metaFallback.isCustomerTask : null),
            linkedRunbookId:          templateMeta?.linkedRunbookId ?? (typeof metaFallback.linkedRunbookId === "string" ? metaFallback.linkedRunbookId : null),
            customerDownloadScriptId: templateMeta?.customerDownloadScriptId ?? (typeof metaFallback.customerDownloadScriptId === "string" ? metaFallback.customerDownloadScriptId : null),
            triggersHealthScore:      templateMeta?.triggersHealthScore ?? (typeof metaFallback.triggersHealthScore === "boolean" ? metaFallback.triggersHealthScore : null),
            linkedWorkflowId:         typeof gptLinkedWfId === "number" ? gptLinkedWfId : null,
            linkedWorkflowName:       typeof gptLinkedWfId === "number" ? (gptWorkflowNameMap.get(gptLinkedWfId) ?? null) : null,
            taskMetadata:             row.taskMetadata ?? null,
          });
        }

        // For phases that still have no kanban tasks, synthesize task entries from their
        // workflow template so the phase's expected work is visible to downstream nodes.
        for (const phase of gptPhases) {
          if (!phase.workflowTemplateStepId) continue;
          const phaseEntry = phaseMap.get(String(phase.id));
          if (!phaseEntry || phaseEntry.tasks.length > 0) continue;
          const templateTasks = gptTemplateTasksByStep.get(phase.workflowTemplateStepId) ?? [];
          for (const tt of templateTasks) {
            const ttLinkedWfId = tt.taskType === "run_workflow"
              ? ((tt.taskMetadata as any)?.runWorkflow?.workflowId ?? null)
              : null;
            phaseEntry.tasks.push({
              taskId:                   null,
              title:                    tt.title,
              column:                   "backlog",
              priority:                 "medium",
              assignedTo:               null,
              dueDate:                  null,
              groupName:                tt.groupName,
              taskType:                 tt.taskType,
              isCustomerTask:           tt.isCustomerTask,
              linkedRunbookId:          tt.linkedRunbookId,
              customerDownloadScriptId: tt.customerDownloadScriptId,
              triggersHealthScore:      tt.triggersHealthScore,
              linkedWorkflowId:         typeof ttLinkedWfId === "number" ? ttLinkedWfId : null,
              linkedWorkflowName:       typeof ttLinkedWfId === "number" ? (gptWorkflowNameMap.get(ttLinkedWfId) ?? null) : null,
              taskMetadata:             tt.taskMetadata,
            });
          }
        }

        const phases = Array.from(phaseMap.values()).sort((a, b) => a.order - b.order);
        const taskCount = gptRows.length;

        // flatTasks: all tasks across all phases, each enriched with phase metadata.
        // Allows a single ForEach over flatTasks instead of nested ForEach over phases then tasks.
        const flatTasks = phases.flatMap(phase =>
          phase.tasks.map(task => ({
            ...task,
            phaseId:     phase.phaseId,
            phaseTitle:  phase.phaseTitle,
            phaseStatus: phase.phaseStatus,
            phaseOrder:  phase.order,
          }))
        );

        output = { phases, flatTasks, taskCount, projectId: gptProjectId };
        break;
      }

      case "update_project_task": {
        const uptTaskIdRaw = interp(node.data.taskId as string | undefined, payload);
        if (!uptTaskIdRaw?.trim()) {
          nodeError = true;
          output = { error: "update_project_task: taskId is required" };
          break;
        }
        const uptTaskId = parseInt(uptTaskIdRaw, 10);
        if (isNaN(uptTaskId)) {
          nodeError = true;
          output = { error: `update_project_task: invalid taskId '${uptTaskIdRaw}'` };
          break;
        }

        const uptPatch: Record<string, unknown> = { updatedAt: new Date() };
        const validColumns = ["backlog", "in_progress", "waiting_on_customer", "completed"] as const;

        const uptColumn      = interp(node.data.column      as string | undefined, payload);
        const uptTitle       = interp(node.data.title       as string | undefined, payload);
        const uptDescription = interp(node.data.description as string | undefined, payload);
        const uptPriority    = interp(node.data.priority    as string | undefined, payload);
        const uptAssignedTo  = interp(node.data.assignedTo  as string | undefined, payload);
        const uptDueDate     = interp(node.data.dueDate     as string | undefined, payload);

        if (uptColumn?.trim()      && (validColumns as readonly string[]).includes(uptColumn.trim())) uptPatch.column      = uptColumn.trim();
        if (uptTitle?.trim())       uptPatch.title       = uptTitle.trim();
        if (uptDescription?.trim()) uptPatch.description = uptDescription.trim();
        if (uptPriority?.trim())    uptPatch.priority    = uptPriority.trim();
        if (uptAssignedTo?.trim())  uptPatch.assignedTo  = uptAssignedTo.trim();
        if (uptDueDate?.trim()) {
          const d = new Date(uptDueDate.trim());
          if (!isNaN(d.getTime())) uptPatch.dueDate = d;
        }

        const [uptUpdated] = await db
          .update(kanbanTasksTable)
          .set(uptPatch as Parameters<typeof db.update>[0] extends never ? never : Record<string, unknown>)
          .where(eq(kanbanTasksTable.id, uptTaskId))
          .returning({ id: kanbanTasksTable.id, column: kanbanTasksTable.column, title: kanbanTasksTable.title });

        if (!uptUpdated) {
          nodeError = true;
          output = { error: `update_project_task: no task found with id ${uptTaskId}` };
          break;
        }
        output = { updated: true, taskId: uptUpdated.id, column: uptUpdated.column, title: uptUpdated.title };
        break;
      }

      case "update_milestone": {
        const umMilestoneIdRaw = interp(node.data.milestoneIdExpr as string | undefined, payload);
        if (!umMilestoneIdRaw?.trim()) {
          nodeError = true;
          output = { error: "update_milestone: milestoneIdExpr is required" };
          break;
        }
        const umMilestoneId = parseInt(umMilestoneIdRaw, 10);
        if (isNaN(umMilestoneId)) {
          nodeError = true;
          output = { error: `update_milestone: invalid milestoneId '${umMilestoneIdRaw}'` };
          break;
        }

        const umStatusRaw = interp(node.data.statusExpr as string | undefined, payload)?.trim();
        const validStatuses = ["pending", "in_progress", "completed", "blocked"] as const;
        type StepStatus = typeof validStatuses[number];
        if (umStatusRaw && !(validStatuses as readonly string[]).includes(umStatusRaw)) {
          nodeError = true;
          output = { error: `update_milestone: invalid status '${umStatusRaw}' — must be one of ${validStatuses.join(", ")}` };
          break;
        }

        const [umExistingStep] = await db
          .select({ id: workflowStepsTable.id, status: workflowStepsTable.status, projectId: workflowStepsTable.projectId })
          .from(workflowStepsTable)
          .where(eq(workflowStepsTable.id, umMilestoneId))
          .limit(1);

        if (!umExistingStep) {
          nodeError = true;
          output = { error: `update_milestone: no milestone found with id ${umMilestoneId}` };
          break;
        }

        const umPatch: Record<string, unknown> = {};
        if (umStatusRaw) umPatch.status = umStatusRaw as StepStatus;

        const umDeliveryDateRaw = interp(node.data.deliveryDateExpr as string | undefined, payload)?.trim();
        if (umDeliveryDateRaw) {
          const umDate = new Date(umDeliveryDateRaw);
          if (!isNaN(umDate.getTime())) umPatch.dueDate = umDate;
        }

        if (Object.keys(umPatch).length === 0) {
          output = {
            milestoneId: umExistingStep.id,
            previousStatus: umExistingStep.status,
            newStatus: umExistingStep.status,
            kanbanCardsSeeded: false,
          };
          break;
        }

        const [umUpdated] = await db
          .update(workflowStepsTable)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .set(umPatch as any)
          .where(eq(workflowStepsTable.id, umMilestoneId))
          .returning({ id: workflowStepsTable.id, status: workflowStepsTable.status, projectId: workflowStepsTable.projectId });

        let umKanbanCardsSeeded = false;
        if (umStatusRaw === "in_progress" && umUpdated?.id) {
          const seedResult = await seedKanbanCardsForPhase(umUpdated.id, logger);
          umKanbanCardsSeeded = seedResult.seeded;
        }

        output = {
          milestoneId: umMilestoneId,
          previousStatus: umExistingStep.status,
          newStatus: umUpdated?.status ?? umExistingStep.status,
          kanbanCardsSeeded: umKanbanCardsSeeded,
        };
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
          log.warn({ gpProjectId, gpPresentationId }, "get_phases: no presentation found — returning empty phases");
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
        // Optional: link this step to a SOW phase ID so find_object can nest steps per phase
        const cpSowPhaseId = interp(node.data.sowPhaseId as string | undefined, payload)?.trim() || null;

        if (!cpProjectId || !cpTitle?.trim()) {
          const missing: string[] = [];
          if (!cpProjectId) missing.push(`projectId (configured: "${node.data.projectId ?? "(not set)"}", resolved: "${cpProjectId ?? ""}")`);
          if (!cpTitle?.trim()) missing.push(`title (configured: "${node.data.title ?? "(not set)"}", resolved: "${cpTitle ?? ""}")`);
          nodeError = true;
          output = { error: `create_phase: missing required field(s): ${missing.join("; ")}` };
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
          sowPhaseId: cpSowPhaseId,
        }).returning();
        output = { phaseId: phase.id, phaseTitle: phase.title };
        break;
      }

      case "save_presentation_phases": {
        // This node type is retired. The seeded Presentation Phase Generator now uses
        // a sql_query node with a CTE that computes price weights and upserts the
        // quick_win_presentations row directly. Graphs still using this node type
        // receive a compat patch from seedSystemWorkflows on next server startup.
        log.warn({ runId, nodeId: node.id }, "wf-executor: save_presentation_phases is retired — graph needs re-seeding via seedSystemWorkflows");
        output = { skipped: true, note: "save_presentation_phases is retired — use sql_query instead" };
        break;
      }

      // ── Generate Script ───────────────────────────────────────────────────

      case "generate_script": {
        const gsSourceMode = (node.data.sourceMode as string | undefined) ?? "service";
        const gsTargetRaw  = interp(node.data.targetId as string | undefined, payload) ?? "";
        const gsCustom     = interp(node.data.customInstructions as string | undefined, payload) ?? "";
        const gsTargetId   = parseInt(gsTargetRaw, 10);
        const gsOutputMode = (node.data.outputMode as "auto" | "single" | "package" | undefined) ?? "auto";

        if (!gsTargetRaw || isNaN(gsTargetId)) {
          nodeError = true;
          output = { error: `generate_script: ${gsSourceMode === "service" ? "serviceId" : "documentId"} is required and must be a number (got "${gsTargetRaw}")` };
          break;
        }

        try {
          const gsResult = gsSourceMode === "service"
            ? await generateScriptFromService(gsTargetId, { customInstructions: gsCustom || undefined, outputMode: gsOutputMode })
            : await generateScriptFromDocument(gsTargetId, { customInstructions: gsCustom || undefined, outputMode: gsOutputMode });
          output = { ...gsResult, category: "workflow-generated" };
        } catch (gsErr) {
          nodeError = true;
          output = { error: String(gsErr instanceof Error ? gsErr.message : gsErr) };
        }
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
            log.warn({ notifErr, slug: newArticle.slug }, "publish_article: failed to insert draft notifications (non-fatal)");
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
          log.error({ err }, "generate_image: OpenAI image generation failed");
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
          case "monitoring_package": {
            // Resolves a monitoring package record from the DB by its slug key.
            // Use this in event-driven workflows to validate/resolve the package before execution.
            // Supported fieldNames: "key" (default)
            const { monitoringPackagesTable: foMpT, monitoringPackageChecksTable: foMpLinkT } = await import("@workspace/db");
            const { eq: foMpEq } = await import("drizzle-orm");
            const [foMpRow] = await db.select().from(foMpT).where(foMpEq(foMpT.key, foValue)).limit(1);
            if (!foMpRow) {
              output = { found: false, objectType: "monitoring_package", fieldName: foField, fieldValue: foValue };
              break;
            }
            const foMpLinks = await db
              .select({ checkKey: foMpLinkT.checkKey, sortOrder: foMpLinkT.sortOrder })
              .from(foMpLinkT)
              .where(foMpEq(foMpLinkT.packageKey, foMpRow.key))
              .orderBy(foMpLinkT.sortOrder);
            output = {
              found: true,
              objectType: "monitoring_package",
              objectId: foMpRow.packageId,
              packageKey: foMpRow.key,
              packageId: foMpRow.packageId,
              packageLabel: foMpRow.label,
              status: foMpRow.status,
              checkCount: foMpLinks.length,
              engines: foMpRow.engines ?? [],
            };
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
          case "presentation": {
            const foPresField = foField === "clientUserId" ? eq(quickWinPresentationsTable.clientUserId, parseInt(foValue, 10))
                              : foField === "projectId"    ? eq(quickWinPresentationsTable.projectId,    parseInt(foValue, 10))
                              : eq(quickWinPresentationsTable.projectId, parseInt(foValue, 10));
            const foPresRows = await db.select().from(quickWinPresentationsTable).where(foPresField).orderBy(quickWinPresentationsTable.createdAt).limit(1);
            const foPres = foPresRows[0];
            if (!foPres) {
              output = { found: false, objectType: "presentation", fieldName: foField, fieldValue: foValue };
            } else {
              // When sow_phases is empty, derive from the linked SOW document's pricing
              // lines — same two-step fallback used by deriveEffectiveSowData in portal.ts.
              type FoPricingLine = { title: string; scope: string; priceUsd: number; notes: string; line_type?: string };
              let foSowPhases = (foPres.sowPhases ?? []) as Array<{ id: string; title: string; description: string; price: number; selected: boolean }>;
              if (foSowPhases.length === 0) {
                const foDocIds = (foPres.documentsIncluded ?? []) as number[];
                let foPricingLines: FoPricingLine[] | null = null;

                // A scoped SOW (docType "scoped_sow") reflects a client-approved scope
                // reduction and, when present, is authoritative over the full/consolidated
                // SOW — otherwise workflows would surface the pre-reduction pricing/phases
                // even after the client scoped down (mirrors resolveScopeAwarePrice in
                // portal.ts, which fixes the same class of bug on the payment endpoints).
                const foHasScopeReduction =
                  Array.isArray(foPres.scopedPhaseIds) && (foPres.scopedPhaseIds as unknown[]).length > 0;

                // Step 1 — check the included documents, preferring scoped_sow over consolidated_sow/sow
                if (foDocIds.length > 0) {
                  const foIncludedDocs = await db.select({
                    docType: insightsGeneratedDocumentsTable.docType,
                    sowPricingLines: insightsGeneratedDocumentsTable.sowPricingLines,
                  }).from(insightsGeneratedDocumentsTable)
                    .where(inArray(insightsGeneratedDocumentsTable.id, foDocIds));
                  const foScopedDoc = foHasScopeReduction
                    ? foIncludedDocs.find(
                        d => d.docType === "scoped_sow" &&
                             Array.isArray(d.sowPricingLines) && (d.sowPricingLines as unknown[]).length > 0,
                      )
                    : undefined;
                  const foSowDoc = foScopedDoc ?? foIncludedDocs.find(
                    d => (d.docType === "consolidated_sow" || d.docType === "sow") &&
                         Array.isArray(d.sowPricingLines) && (d.sowPricingLines as unknown[]).length > 0,
                  );
                  if (foSowDoc) foPricingLines = foSowDoc.sowPricingLines as FoPricingLine[];
                }

                // Step 2 — fall back to project's most recent approved SOW, again preferring
                // a scoped_sow document if one exists and a scope reduction is active.
                if (!foPricingLines && foPres.projectId) {
                  const foDocTypesToTry = foHasScopeReduction
                    ? ["scoped_sow", "consolidated_sow", "sow"]
                    : ["consolidated_sow", "sow"];
                  const [foProjectSow] = await db.select({
                    docType: insightsGeneratedDocumentsTable.docType,
                    sowPricingLines: insightsGeneratedDocumentsTable.sowPricingLines,
                  }).from(insightsGeneratedDocumentsTable)
                    .where(and(
                      eq(insightsGeneratedDocumentsTable.projectId, foPres.projectId),
                      inArray(insightsGeneratedDocumentsTable.docType, foDocTypesToTry),
                      inArray(insightsGeneratedDocumentsTable.status, ["approved", "delivered"]),
                    ))
                    .orderBy(
                      foHasScopeReduction
                        ? sql`CASE WHEN ${insightsGeneratedDocumentsTable.docType} = 'scoped_sow' THEN 0 ELSE 1 END`
                        : sql`0`,
                      desc(insightsGeneratedDocumentsTable.createdAt),
                    )
                    .limit(1);
                  if (foProjectSow && Array.isArray(foProjectSow.sowPricingLines) && (foProjectSow.sowPricingLines as unknown[]).length > 0) {
                    foPricingLines = foProjectSow.sowPricingLines as FoPricingLine[];
                  }
                }

                if (foPricingLines && foPricingLines.length > 0) {
                  const foWorkstreamLines = foPricingLines.filter(l => l.line_type !== "adjustment");
                  foSowPhases = foWorkstreamLines.map((l, i) => ({
                    id: `sow-${i}`,
                    title: l.title,
                    description: l.scope || l.notes || "",
                    price: l.priceUsd,
                    selected: true,
                  }));
                }
              }

              // Filter sowPhases to only the client-selected ones.
              // selectedPhaseIds records which sow-N ids the client actually agreed to.
              // The fallback above may derive ALL pricing lines from the SOW doc;
              // we must restrict to the agreed subset before exposing to workflows.
              const foSelectedIds = (foPres.selectedPhaseIds ?? []) as string[];
              if (foSelectedIds.length > 0) {
                foSowPhases = foSowPhases.filter(p => foSelectedIds.includes(p.id));
              }

              // Fetch workflow steps (tasks) for the project so downstream nodes
              // can iterate over them without a separate find_object call.
              // Steps with a sow_phase_id are also nested inside their parent phase
              // in the sowPhases array (Option B). Steps without a sow_phase_id land
              // in projectSteps only (backward-compatible flat list).
              type FoStep = { id: number; title: string; description: string; order: number; dueDate: string | null; status: string; sowPhaseId: string | null };
              let foProjectSteps: FoStep[] = [];
              if (foPres.projectId) {
                const foStepRows = await db
                  .select({
                    id:          workflowStepsTable.id,
                    title:       workflowStepsTable.title,
                    description: workflowStepsTable.description,
                    order:       workflowStepsTable.order,
                    dueDate:     workflowStepsTable.dueDate,
                    status:      workflowStepsTable.status,
                    sowPhaseId:  workflowStepsTable.sowPhaseId,
                  })
                  .from(workflowStepsTable)
                  .where(eq(workflowStepsTable.projectId, foPres.projectId))
                  .orderBy(workflowStepsTable.order);
                foProjectSteps = foStepRows.map(s => ({
                  id:          s.id,
                  title:       s.title,
                  description: s.description ?? "",
                  order:       s.order ?? 0,
                  dueDate:     s.dueDate instanceof Date ? s.dueDate.toISOString() : (s.dueDate ?? null),
                  status:      s.status ?? "pending",
                  sowPhaseId:  s.sowPhaseId ?? null,
                }));
              }

              // Nest steps inside their parent SOW phase (Option B).
              // Steps without a sowPhaseId are omitted from phase.steps but
              // remain available in the top-level projectSteps array.
              const foStepsByPhase = new Map<string, FoStep[]>();
              for (const s of foProjectSteps) {
                if (!s.sowPhaseId) continue;
                const arr = foStepsByPhase.get(s.sowPhaseId) ?? [];
                arr.push(s);
                foStepsByPhase.set(s.sowPhaseId, arr);
              }
              const foSowPhasesWithSteps = foSowPhases.map(p => ({
                ...p,
                steps: foStepsByPhase.get(p.id) ?? [],
              }));

              output = {
                found:            true,
                objectType:       "presentation",
                objectId:         foPres.id,
                presentationId:   foPres.id,
                projectId:        foPres.projectId ?? null,
                clientUserId:     foPres.clientUserId ?? null,
                status:           foPres.status,
                totalPrice:       foPres.totalPrice != null ? Number(foPres.totalPrice) : null,
                paymentPlan:      foPres.paymentPlan ?? null,
                signedAt:         foPres.signedAt?.toISOString() ?? null,
                sowPhases:        foSowPhasesWithSteps,
                selectedPhaseIds: foSelectedIds,
                projectSteps:     foProjectSteps,
                createdAt:        foPres.createdAt.toISOString(),
              };
            }
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
          log.warn({ runId, nodeId: node.id, expr: node.data.stripeInvoiceIdExpr }, esiWarnMsg);
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
          log.warn({ invoiceId: esiInvoiceId, err: esiErr }, "edit_stripe_invoice: update failed");
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
      case "group_by": {
        const gbArrayExpr = (node.data.arrayExpression as string | undefined) ?? "";
        const gbKeyExpr   = (node.data.keyExpression   as string | undefined) ?? "";
        const gbRaw = interp(gbArrayExpr, payload);
        let gbArray: unknown[];
        if (Array.isArray(gbRaw)) {
          gbArray = gbRaw;
        } else if (typeof gbRaw === "string" && gbRaw.trim().startsWith("[")) {
          try { gbArray = JSON.parse(gbRaw); }
          catch { nodeError = true; output = { error: "Group By: arrayExpression resolved to an invalid JSON string — expected an array" }; break; }
        } else {
          nodeError = true;
          output = { error: `Group By: arrayExpression did not resolve to an array (got ${Array.isArray(gbRaw) ? "array" : typeof gbRaw})` };
          break;
        }
        const gbNullBehaviour = (node.data.nullKeyBehaviour as string | undefined) ?? "collect";
        const grouped: Record<string, unknown[]> = {};
        let gbSkippedCount = 0;
        for (const item of gbArray) {
          // Spread the item's own properties into the payload so that a key expression like
          // {{linkedRunbookId}} works directly, without requiring {{currentItem.linkedRunbookId}}.
          // currentItem is still available for explicit dot-notation access.
          const itemProps = (typeof item === "object" && item !== null) ? (item as Record<string, unknown>) : {};
          const tempPayload = { ...payload, ...itemProps, currentItem: item };
          const rawKey = interp(gbKeyExpr, tempPayload);
          const isBlank = rawKey === null || rawKey === undefined || String(rawKey).trim() === "";
          if (isBlank) {
            if (gbNullBehaviour === "error") {
              nodeError = true;
              output = { error: "Group By: one or more items resolved to a blank/null key — set 'Null key behaviour' to Collect or Skip to suppress this error" };
              break;
            }
            if (gbNullBehaviour === "skip") {
              gbSkippedCount++;
              continue;
            }
            // collect (default)
            const collectKey = "(no key)";
            if (!grouped[collectKey]) grouped[collectKey] = [];
            grouped[collectKey].push(item);
          } else {
            const key = String(rawKey);
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(item);
          }
        }
        if (nodeError) break;
        let groups = Object.entries(grouped).map(([key, items]) => ({ key, items }));
        const gbSort = (node.data.sortGroups as string | undefined) ?? "none";
        if (gbSort === "asc") groups.sort((a, b) => String(a.key).localeCompare(String(b.key)));
        else if (gbSort === "desc") groups.sort((a, b) => String(b.key).localeCompare(String(a.key)));
        output = { groups, groupCount: groups.length, ...(gbSkippedCount > 0 ? { skippedCount: gbSkippedCount } : {}) };
        break;
      }

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
            log.warn({ nodeId: node.id, resolvedValue }, "compose: JSON.parse failed — falling back to raw string");
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

      case "msp_dunning_advance": {
        // Promoted node type: advances MSP dunning states for past-due subscriptions.
        output = await handleMspDunningAdvance(node.data as Record<string, unknown>);
        break;
      }

      case "msp_overage_meter": {
        // Promoted node type: meters MSP tenant overage for monthly billing.
        output = await handleMspOverageMeter(node.data as Record<string, unknown>);
        break;
      }

      case "msp_score_snapshot": {
        // Promoted node type: calculates and snapshots MSP portfolio risk daily.
        output = await handleMspScoreSnapshot(node.data as Record<string, unknown>);
        break;
      }

      case "platform_log_stream_prune": {
        // Promoted node type: deletes platform_log_stream rows past retention.
        output = await handlePlatformLogStreamPrune(node.data as Record<string, unknown>);
        break;
      }

      case "reconcile_orphaned_runs": {
        // Promoted node type: inspects live process state after a restart to recover
        // orphaned kanban runs, stalled phases, and late stuck-queued completions.
        // This is the one legitimate "internal" node because inspecting live process
        // state is not expressible generically with sql_query or other node types.
        const rorTask = (node.data.task as string | undefined) ?? "reconcile_orphaned_runs";
        if (rorTask === "reconcile_late_stuck_queued") {
          await reconcileLateStuckQueuedCompletions();
          log.info("wf-executor: reconcile_orphaned_runs — reconcile_late_stuck_queued completed");
          output = { reconciled: true, task: rorTask };
        } else {
          await reconcileOrphanedRuns();
          await reconcileStalledPhases();
          await reconcileLateStuckQueuedCompletions();
          log.info("wf-executor: reconcile_orphaned_runs completed");
          output = { reconciled: true, task: rorTask };
        }
        break;
      }

      case "alert_evaluate_rules": {
        await runAlertRuleEvaluation();
        log.info("wf-executor: alert_evaluate_rules completed");
        output = { evaluated: true };
        break;
      }

      case "kanban_auto_fire": {
        // Fires the appropriate kanban auto-fire function based on the `action`
        // field in the node data / payload (set by the upstream kanban.card_moved event).
        //   action = "script"   → autoFireFirstBacklogScript (Azure script execution)
        //   action = "document" → autoFireDocumentCard (AI document generation)
        //   action = "workflow" → autoFireRunWorkflowCards (child workflow launch)
        //   action = ""         → defaults to "script" (backwards-compatible)
        // Delegated to handleAutoFireKanban for testable, isolated dispatch logic.
        const mepClientIdRaw = interp(node.data.clientId as string | undefined, payload)
          ?? String((payload.clientUserId as number | string | undefined) ?? "");
        const mepClientId = mepClientIdRaw ? parseInt(mepClientIdRaw, 10) : NaN;
        const mepAction   = (interp(node.data.action as string | undefined, payload)
          ?? String(payload.action ?? "")) as string;

        if (isNaN(mepClientId)) {
          log.warn({ runId, nodeId: node.id }, "kanban_auto_fire: no clientId — skipping");
          output = { skipped: true, reason: "no clientId" };
          break;
        }

        // Empty action defaults to "script" (original executor behaviour).
        output = await handleAutoFireKanban({ clientUserId: mepClientId, action: mepAction || "script" });
        log.info({ runId, mepClientId, mepAction, output }, "wf-executor: kanban_auto_fire dispatched");
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

      // ── Set Variable / Update Variable ────────────────────────────────────
      case "set_variable":
      case "update_variable": {
        const svName   = (node.data.variableName as string | undefined)?.trim() ?? "";
        const svType   = ((node.data.variableType as string | undefined)?.trim()) || "string";
        const svRawTpl = (node.data.variableValue as string | undefined) ?? "";
        const svRaw    = interp(svRawTpl, payload) ?? "";
        let svValue: unknown;
        try {
          svValue = coerceToType(svRaw, svType, svName || node.id);
        } catch (e) {
          nodeError = true;
          output = { error: (e as Error).message };
          break;
        }
        // Maintain a per-run variables namespace inside the payload
        const currentVars = (payload.variables as Record<string, unknown> | undefined) ?? {};
        const updatedVars = svName ? { ...currentVars, [svName]: svValue } : currentVars;
        output = { value: svValue, variables: updatedVars };
        if (svName) output[svName] = svValue;
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
          log.warn({ runId, nodeId: node.id, rawResponse: fnhAiText.slice(0, 500) },
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
            log.info({ campaignId: fnhCampaignId, topic: fnhTopic }, "fetch_news_headlines: auto-created campaign draft");
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
              log.warn({ err: imgErr, imageUrl }, "post_linkedin: image upload failed, falling back to text-only");
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
              log.warn({ err: imgErr, imageUrl }, "post_twitter: image upload failed, falling back to text-only");
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
                log.warn({ status: resp.status, detail: errText.slice(0, 400), imageUrl }, "post_facebook: image upload failed, falling back to text-only");
                fbImageUploadWarning = `Image not attached — Facebook Graph API rejected the image upload (HTTP ${resp.status})`;
                fbUseImage = false;
              } else {
                const json = (await resp.json()) as { id?: string; post_id?: string };
                const rawId = json?.post_id ?? json?.id ?? "unknown";
                const facebookPostUrl = `https://www.facebook.com/${rawId.replace("_", "/posts/")}`;
                output = { facebookPostId: rawId, facebookPostUrl };
              }
            } catch (imgErr) {
              log.warn({ err: imgErr, imageUrl }, "post_facebook: image upload failed, falling back to text-only");
              fbImageUploadWarning = `Image not attached — ${imgErr instanceof Error ? imgErr.message : "upload failed"}`;
              fbUseImage = false;
            }
          }

          if (!fbUseImage && Object.keys(output).length === 0) {
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
          // MSP-scoped approvals (e.g. this run's payload carries an mspId, set by
          // the triggering event) notify that MSP's admin/approvers instead of
          // platform admins, and get an mspId written onto the row so the MSP
          // Portal's pending-approvals endpoint can filter to it.
          const gateMspIdRaw = payload.mspId;
          const gateMspId = gateMspIdRaw != null ? parseInt(String(gateMspIdRaw), 10) : NaN;
          const isMspScoped = !isNaN(gateMspId);

          const [approval] = await db.insert(pendingApprovalsTable).values({
            runId,
            nodeId: node.id,
            approverRole,
            mspId: isMspScoped ? gateMspId : undefined,
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

          if (isMspScoped) {
            const notifLink = `/pending-approvals`;
            try {
              const approvers = await db
                .select({ userId: mspUsersTable.userId, email: usersTable.email, name: usersTable.name })
                .from(mspUsersTable)
                .innerJoin(usersTable, eq(usersTable.id, mspUsersTable.userId))
                .where(and(
                  eq(mspUsersTable.mspId, gateMspId),
                  eq(mspUsersTable.isActive, true),
                  or(eq(mspUsersTable.mspRole, "MSPAdmin"), eq(mspUsersTable.canApprovePurchases, true)),
                ));

              if (approvers.length > 0) {
                await db.insert(notificationsTable).values(
                  approvers.map(a => ({
                    mspUserId: a.userId,
                    mspId: gateMspId,
                    recipientType: "msp_user" as const,
                    title: notifTitle,
                    body: notifBody,
                    type: "general" as const,
                    linkPath: notifLink,
                    feedType: "personal" as const,
                    category: "approval",
                    severity: "warning" as const,
                  })),
                );
                const { sendEmail } = await import("./mailer");
                for (const a of approvers) {
                  if (a.email) void sendEmail(a.email, notifTitle, `<p>${notifBody}</p><p>Log in to the MSP Portal to review.</p>`);
                }
              } else {
                log.warn({ runId, mspId: gateMspId }, "approval_gate: MSP-scoped approval with no eligible approver (no MSPAdmin, no canApprovePurchases user) — nobody notified");
              }
            } catch (notifErr) {
              log.warn({ notifErr, runId, mspId: gateMspId }, "approval_gate: failed to notify MSP approvers (non-fatal)");
            }
          } else {
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
              log.warn({ notifErr, runId }, "approval_gate: failed to insert notifications (non-fatal)");
            }

            void sendWebPushToAdmins({ title: notifTitle, body: notifBody, linkPath: notifLink });
          }

          output = { approvalId: approval.id, approverRole, expiresAt: expiresAt.toISOString(), label };
          // Record the node output before returning the sentinel
          const durationMs = Date.now() - startMs;
          await db.insert(wfRunNodeOutputsTable).values({
            runId,
            nodeId: node.id,
            input: redactSensitivePayloadKeys(payload),
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

      // ── Break-glass verification gate ──────────────────────────────────────
      // Pauses the run exactly like approval_gate, but the "approver" is a
      // customer-tenant admin who proves control via Microsoft OAuth out-of-band
      // (see routes/break-glass-verification.ts). On first execution we create the
      // pending-secret row (encrypted, status "pending_delivery") and pause; the
      // secret is NEVER placed in the node output / run payload / output-sample —
      // only a redacted { pendingSecretId } is recorded.
      case "break_glass_verification_gate": {
        if (dryRun) {
          output = { dryRun: true, revealed: false };
          break;
        }

        // Resolve the inputs from the run payload — all produced by an upstream
        // creation node (no such node ships in-repo yet; these field names are the
        // contract that producer must satisfy). Each is configurable on node.data:
        //   secretField / secretTemplate — the plaintext secret (secretTemplate is a
        //     {{path}} template, no HTML escaping — this is a raw secret, not markup),
        //   customerIdField — the customer whose tenant proves control,
        //   accountIdField — the break-glass account the override path resets.
        const resolveSecretPath = (raw: unknown, p: Record<string, unknown>): string | undefined => {
          if (typeof raw !== "string" || raw.length === 0) return undefined;
          const tpl = raw.replace(/\{\{([\w.]+)\}\}/g, (_m, path: string) => {
            const key = path.startsWith("payload.") ? path.slice(8) : path;
            let cur: unknown = p;
            for (const part of key.split(".")) {
              if (cur == null || typeof cur !== "object") return "";
              cur = (cur as Record<string, unknown>)[part];
            }
            return cur != null ? String(cur) : "";
          });
          return tpl.length > 0 ? tpl : undefined;
        };

        const secretField = (node.data.secretField as string | undefined) ?? "breakGlassSecret";
        const plaintext =
          resolveSecretPath(node.data.secretTemplate, payload) ??
          (typeof payload[secretField] === "string" ? (payload[secretField] as string) : undefined);

        const customerFieldRaw = (node.data.customerIdField as string | undefined)
          ? payload[node.data.customerIdField as string]
          : payload.customerId;
        const gateCustomerId = customerFieldRaw != null ? parseInt(String(customerFieldRaw), 10) : NaN;

        // The break-glass account identity (UPN or object-id) the admin-override
        // path resets. Configurable on this node exactly like secretField /
        // customerIdField; resolved here and stamped onto the (non-secret) payload
        // snapshot under the canonical `breakGlassAccountId` key so the override
        // endpoint reads one stable key regardless of the configured source field.
        const accountIdField = (node.data.accountIdField as string | undefined) ?? "breakGlassAccountId";
        const resolvedAccountId = payload[accountIdField];

        if (!plaintext || isNaN(gateCustomerId)) {
          nodeError = true;
          output = { error: "break_glass_verification_gate: missing secret plaintext or customerId in payload" };
          break;
        }

        const { encryptSecret } = await import("./secret-crypto");
        const [pendingSecret] = await db.insert(breakGlassPendingSecretsTable).values({
          runId,
          customerId: gateCustomerId,
          encryptedValue: encryptSecret(plaintext),
          gateNodeId: node.id,
          status: "pending_delivery",
        }).returning();

        // Build a REDACTED payload snapshot for resume: strip the plaintext secret
        // (the configured field plus any top-level keys referenced by secretTemplate)
        // so it never lands in wf_runs.payload or flows to downstream nodes. The
        // acknowledge endpoint reads this snapshot back to resume the run.
        const redactedPayload: Record<string, unknown> = { ...payload };
        delete redactedPayload[secretField];
        if (typeof node.data.secretTemplate === "string") {
          for (const m of (node.data.secretTemplate as string).matchAll(/\{\{([\w.]+)\}\}/g)) {
            const key = (m[1].startsWith("payload.") ? m[1].slice(8) : m[1]).split(".")[0];
            delete redactedPayload[key];
          }
        }
        redactedPayload.pendingSecretId = pendingSecret.id;
        // Canonicalize the (non-secret) account id so admin-override reads one stable
        // key even when accountIdField points at a differently-named source field.
        if (resolvedAccountId != null) {
          redactedPayload.breakGlassAccountId = String(resolvedAccountId);
        }

        await db.update(wfRunsTable)
          .set({ status: "awaiting_approval", payload: redactedPayload })
          .where(eq(wfRunsTable.id, runId));

        // Redacted output only — never the plaintext.
        output = { pendingSecretId: pendingSecret.id, status: "pending_delivery" };
        const bgDurationMs = Date.now() - startMs;
        await db.insert(wfRunNodeOutputsTable).values({
          runId,
          nodeId: node.id,
          input: { redacted: true },
          output,
          durationMs: bgDurationMs,
          status: "ok",
        }).catch(() => { });
        await db.insert(wfRunNodeLogsTable).values({
          runId,
          nodeId: node.id,
          level: "info",
          message: `break_glass_verification_gate (${node.id}): run paused, pending secret #${pendingSecret.id} awaiting tenant-admin verification`,
        }).catch(() => { });

        // Return the pause sentinel immediately — skip the shared output/sample
        // tail so the secret can never leak into wf_run_node_outputs (full payload),
        // wf_node_output_samples, or the run payload spread.
        return { output, nextPayload: redactedPayload, cancelRun: false, nodeError: false, pauseForApproval: true };
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
        let cpiSessionCustomerId: string | null = null;
        try {
          const cpiSession = await stripeCpi.checkout.sessions.retrieve(cpiDepositSessionId, {
            expand: ["payment_intent"],
          });
          // Prefer the customer directly on the session — it is guaranteed to own the payment method.
          cpiSessionCustomerId = typeof cpiSession.customer === "string"
            ? cpiSession.customer
            : (cpiSession.customer as { id?: string } | null)?.id ?? null;
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

        // Resolve the Stripe customer.
        // Always prefer the customer that Stripe already linked to the checkout session —
        // that customer is guaranteed to own the payment method. Falling back to an
        // email lookup can return a different customer record, causing the subsequent
        // `customers.update(invoice_settings.default_payment_method)` to fail because
        // the PM is not attached to that customer.
        let cpiCustomerId: string;
        if (cpiSessionCustomerId) {
          cpiCustomerId = cpiSessionCustomerId;
        } else {
          const cpiCustomers = await stripeCpi.customers.list({ email: cpiEmail, limit: 1 });
          if (cpiCustomers.data.length > 0) {
            cpiCustomerId = cpiCustomers.data[0].id;
          } else {
            const cpiCust = await stripeCpi.customers.create({ email: cpiEmail, name: cpiName || undefined });
            cpiCustomerId = cpiCust.id;
          }
        }

        // Attach payment method as customer default so future auto-charges work.
        // Always attempt attach — Stripe only auto-attaches the PM to the customer
        // when the session has setup_future_usage set; without it the PM is used
        // once but never attached, causing customers.update to throw.
        // The try/catch swallows "already attached" errors gracefully.
        if (cpiPaymentMethodId) {
          try {
            await stripeCpi.paymentMethods.attach(cpiPaymentMethodId, { customer: cpiCustomerId });
          } catch { /* already attached — safe to ignore */ }
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

      // ── Generate a single phased invoice ───────────────────────────────────

      case "generate_phased_invoice": {
        const { getStripeKey: getGpiKey } = await import("./stripe");
        let gpiStripeKey: string;
        try { gpiStripeKey = getGpiKey(); } catch (e) { nodeError = true; output = { error: String(e) }; break; }
        const { default: StripeGpi } = await import("stripe");
        const stripeGpi = new StripeGpi(gpiStripeKey);

        const gpiEmail        = interp(node.data.clientEmail      as string | undefined, payload) ?? String(payload.clientEmail ?? "");
        const gpiName         = interp(node.data.clientName       as string | undefined, payload) ?? String(payload.clientName  ?? "");
        const gpiPhaseTitle   = interp(node.data.phaseTitle       as string | undefined, payload) ?? String(payload.phaseTitle  ?? "Phase");
        const gpiAmountRaw    = interp(node.data.amountCents      as string | undefined, payload) ?? String(payload.amountCents ?? "0");
        const gpiAmountCents  = Math.round(Number(gpiAmountRaw));
        const gpiDepositSid   = interp(node.data.depositSessionId as string | undefined, payload) ?? String(payload.stripeSessionId ?? "");
        const gpiProjectIdRaw = interp(node.data.projectId        as string | undefined, payload);
        const gpiProjectId    = gpiProjectIdRaw ? parseInt(gpiProjectIdRaw, 10) : NaN;
        const gpiPhaseIdRaw   = interp(node.data.phaseId          as string | undefined, payload) ?? String(payload.phaseId ?? "");

        if (!gpiEmail)        { nodeError = true; output = { error: "generate_phased_invoice: clientEmail is required" }; break; }
        if (gpiAmountCents <= 0) { nodeError = true; output = { error: "generate_phased_invoice: amountCents must be a positive number" }; break; }
        if (!gpiDepositSid)   { nodeError = true; output = { error: "generate_phased_invoice: depositSessionId is required to retrieve the saved payment method" }; break; }

        // Retrieve deposit session — extract customer and payment method
        let gpiCustomerId: string;
        let gpiPaymentMethodId: string | null = null;
        try {
          const gpiSession = await stripeGpi.checkout.sessions.retrieve(gpiDepositSid, { expand: ["payment_intent"] });
          const gpiSessionCid = typeof gpiSession.customer === "string"
            ? gpiSession.customer
            : (gpiSession.customer as { id?: string } | null)?.id ?? null;
          const gpiPi = gpiSession.payment_intent;
          if (gpiPi && typeof gpiPi === "object") {
            gpiPaymentMethodId = typeof gpiPi.payment_method === "string"
              ? gpiPi.payment_method
              : (gpiPi.payment_method as { id?: string } | null)?.id ?? null;
          }
          if (gpiSessionCid) {
            gpiCustomerId = gpiSessionCid;
          } else {
            // Fallback: look up or create by email
            const gpiCusts = await stripeGpi.customers.list({ email: gpiEmail, limit: 1 });
            gpiCustomerId = gpiCusts.data.length > 0
              ? gpiCusts.data[0].id
              : (await stripeGpi.customers.create({ email: gpiEmail, name: gpiName || undefined })).id;
          }
        } catch (e) {
          nodeError = true;
          output = { error: `generate_phased_invoice: failed to retrieve deposit session: ${String(e)}` };
          break;
        }

        if (!gpiPaymentMethodId) {
          nodeError = true;
          output = { error: `generate_phased_invoice: deposit session ${gpiDepositSid} has no confirmed payment method — invoice NOT created` };
          break;
        }

        // Always attempt attach — Stripe only auto-attaches the PM when the session
        // has setup_future_usage set; without it the PM is used once but never attached.
        try { await stripeGpi.paymentMethods.attach(gpiPaymentMethodId, { customer: gpiCustomerId }); } catch { /* already attached */ }
        await stripeGpi.customers.update(gpiCustomerId, {
          invoice_settings: { default_payment_method: gpiPaymentMethodId },
        });

        // Create the draft invoice for this single phase
        const gpiInvoice = await stripeGpi.invoices.create({
          customer: gpiCustomerId,
          collection_method: "charge_automatically",
          auto_advance: false,
          metadata: {
            phaseTitle: gpiPhaseTitle,
            ...(gpiPhaseIdRaw  ? { phaseId:   gpiPhaseIdRaw } : {}),
            ...(isNaN(gpiProjectId) ? {} : { projectId: String(gpiProjectId) }),
          },
        });
        await stripeGpi.invoiceItems.create({
          customer: gpiCustomerId,
          invoice: gpiInvoice.id,
          description: `Phase: ${gpiPhaseTitle}`,
          amount: gpiAmountCents,
          currency: "usd",
        });

        // If we have a project ID, try to write the stripeInvoiceId back to the
        // matching workflow_step row (best-effort — matched by title)
        if (!isNaN(gpiProjectId) && gpiPhaseTitle) {
          try {
            const gpiSteps = await db
              .select({ id: workflowStepsTable.id, title: workflowStepsTable.title })
              .from(workflowStepsTable)
              .where(eq(workflowStepsTable.projectId, gpiProjectId));
            const gpiMatch = gpiSteps.find(s => s.title.trim().toLowerCase() === gpiPhaseTitle.trim().toLowerCase());
            if (gpiMatch) {
              await db.update(workflowStepsTable)
                .set({ stripeInvoiceId: gpiInvoice.id })
                .where(eq(workflowStepsTable.id, gpiMatch.id));
            }
          } catch { /* non-fatal */ }
        }

        output = {
          invoiceId: gpiInvoice.id,
          customerId: gpiCustomerId,
          amountCents: gpiAmountCents,
          phaseTitle: gpiPhaseTitle,
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
          log.warn({ invoiceId: csiInvoiceId, err: csiErr }, "charge_stripe_invoice: charge failed");
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

        const rawPresId = payload.presentationId;
        const presId = typeof rawPresId === "number"
          ? rawPresId
          : typeof rawPresId === "string"
          ? parseInt(rawPresId, 10)
          : NaN;
        if (!isNaN(presId)) {
          broadcastPresentationEvent(presId, {
            type: "workflow_progress",
            runId,
            nodeId: node.id,
            message: progressMsg,
            ...meta,
          });
        }

        const rawProjId = payload.projectId;
        const projId = typeof rawProjId === "number"
          ? rawProjId
          : typeof rawProjId === "string"
          ? parseInt(rawProjId, 10)
          : NaN;
        if (!isNaN(projId)) {
          broadcastProjectEvent(projId, {
            type: "workflow_progress",
            runId,
            nodeId: node.id,
            message: progressMsg,
            ...meta,
          });
        }

        output = {};
        break;
      }

      case "comment":
        output = {};
        break;

      // ── Monitor Package Engine nodes ──────────────────────────────────────────

      case "monitor_get_package": {
        const mpgPackageKey = interp(node.data.packageKey as string | undefined, payload);
        if (!mpgPackageKey) {
          nodeError = true;
          output = { error: "monitor_get_package: packageKey is required" };
          break;
        }
        if (dryRun) {
          output = {
            dryRun: true,
            packageKey: mpgPackageKey,
            packageLabel: "Dry-run package",
            checkCount: 0,
            checks: [],
          };
          break;
        }
        const { monitoringPackagesTable: mpgPkgT, monitoringPackageChecksTable: mpgLinkT, monitorChecksTable: mpgCheckT } = await import("@workspace/db");
        const { eq: mpgEq, and: mpgAnd } = await import("drizzle-orm");
        const [mpgPkg] = await db.select().from(mpgPkgT).where(mpgAnd(mpgEq(mpgPkgT.key, mpgPackageKey), mpgEq(mpgPkgT.status, "active"))).limit(1);
        if (!mpgPkg) {
          nodeError = true;
          output = { error: `monitor_get_package: package "${mpgPackageKey}" not found or not active` };
          break;
        }
        const mpgLinks = await db.select().from(mpgLinkT).where(mpgEq(mpgLinkT.packageKey, mpgPackageKey)).orderBy(mpgLinkT.sortOrder);
        const mpgActiveChecks = mpgLinks.length > 0
          ? await db.select({ key: mpgCheckT.key, label: mpgCheckT.label, requiresCustomerScript: mpgCheckT.requiresCustomerScript, frequency: mpgCheckT.frequency })
              .from(mpgCheckT)
              .where(mpgEq(mpgCheckT.status, "active"))
          : [];
        output = {
          packageKey: mpgPkg.key,
          packageId: mpgPkg.packageId,
          packageLabel: mpgPkg.label,
          checkCount: mpgLinks.length,
          checks: mpgLinks.map(l => {
            const c = mpgActiveChecks.find(ch => ch.key === l.checkKey);
            return { checkKey: l.checkKey, label: c?.label ?? l.checkKey, requiresCustomerScript: c?.requiresCustomerScript ?? false, sortOrder: l.sortOrder };
          }),
          engines: mpgPkg.engines ?? [],
        };
        break;
      }

      case "monitor_execute_package": {
        const mepPackageKey = interp(node.data.packageKey as string | undefined, payload) ??
          (payload.packageKey as string | undefined);
        const mepTenantId  = interp(node.data.tenantId as string | undefined, payload) ??
          (payload.tenantId as string | undefined);
        if (!mepPackageKey || !mepTenantId) {
          nodeError = true;
          output = { error: "monitor_execute_package: packageKey and tenantId are required" };
          break;
        }
        if (dryRun) {
          output = {
            dryRun: true,
            packageKey: mepPackageKey,
            tenantId: mepTenantId,
            runStatus: "completed",
            checksTotal: 0,
            checksOk: 0,
            checksError: 0,
            requiresScript: 0,
            checks: [],
          };
          break;
        }
        const { executeMonitoringPackage } = await import("./monitor-executor");
        const mepTriggerId =
          (node.data.triggerId as string | undefined
            ? interp(node.data.triggerId as string, payload)
            : undefined) ?? `wf-run-${runId}-node-${node.id}`;
        const mepResult = await executeMonitoringPackage({
          packageKey: mepPackageKey,
          tenantId: mepTenantId,
          triggerId: mepTriggerId,
          onProgress: (evt) => {
            broadcastAdminWorkflowEvent({
              type: "node_progress",
              runId,
              nodeId: node.id,
              level: "progress",
              message: `Monitor check ${evt.index + 1}/${evt.total}: ${evt.checkLabel} → ${evt.status}`,
              metadata: {
                checkKey: evt.checkKey,
                status: evt.status,
                requiresCustomerScript: evt.requiresCustomerScript,
                index: evt.index,
                total: evt.total,
              },
            });
          },
        });
        nodeError = mepResult.runStatus === "consent_revoked" || mepResult.runStatus === "partial_failure";
        output = {
          packageKey: mepResult.packageKey,
          tenantId: mepResult.tenantId,
          runStatus: mepResult.runStatus,
          triggerId: mepTriggerId,
          checksTotal: mepResult.checks.length,
          checksOk: mepResult.checks.filter((c: { status: string }) => c.status === "ok").length,
          checksError: mepResult.checks.filter((c: { status: string }) => c.status === "error").length,
          requiresScript: mepResult.checks.filter((c: { status: string }) => c.status === "requires_script").length,
          consentRevoked: mepResult.checks.filter((c: { status: string }) => c.status === "consent_revoked").length,
          checks: mepResult.checks,
          enginesRecomputed: mepResult.enginesRecomputed,
          startedAt: mepResult.startedAt,
          completedAt: mepResult.completedAt,
        };
        break;
      }

      // ── monitor_subscription_ensure ────────────────────────────────────────
      // Starts (or re-confirms) an O365 Management Activity API subscription
      // for a single tenant+contentType combination. Upserts the DB row and
      // resets the polling watermark if this is the first run.
      // NEVER sets nodeError — on API failure it records the error in the DB
      // and returns subscriptionStatus:"error" so the loop can continue.
      case "monitor_subscription_ensure": {
        const mseTenantId     = interp(node.data.tenantId     as string | undefined, payload)?.trim();
        const mseContentType  = interp(node.data.contentType  as string | undefined, payload)?.trim()
          ?? (payload.assignment && typeof payload.assignment === "object"
              ? ((payload.assignment as Record<string, unknown>).contentType as string | undefined)
              : undefined);
        const mseTId = mseTenantId
          ?? (payload.assignment && typeof payload.assignment === "object"
              ? ((payload.assignment as Record<string, unknown>).tenantId as string | undefined)
              : undefined);

        if (!mseTId || !mseContentType) {
          output = { subscriptionStatus: "skipped", reason: "tenantId or contentType missing" };
          break;
        }

        try {
          const { activitySubscriptionsTable: astT } = await import("@workspace/db");
          const { ensureActivityApiSubscription } = await import("./graph");
          const { eq: eqMse, and: andMse } = await import("drizzle-orm");

          const subInfo = await ensureActivityApiSubscription(mseTId, mseContentType);
          const now = new Date();

          const existingRows = await db
            .select({ id: astT.id, pollWatermark: astT.pollWatermark })
            .from(astT)
            .where(andMse(eq(astT.tenantId, mseTId), eq(astT.contentType, mseContentType)))
            .limit(1);

          if (existingRows.length === 0) {
            await db.insert(astT).values({
              tenantId: mseTId,
              contentType: mseContentType,
              webhookAuthId: subInfo?.webhook?.authId ?? null,
              status: subInfo ? "active" : "disabled",
              pollWatermark: subInfo ? new Date(Date.now() - 5 * 60 * 1000) : null,
              lastErrorMessage: subInfo ? null : "Initial subscription start failed",
              updatedAt: now,
            }).onConflictDoNothing();
          } else {
            await db.update(astT).set({
              status: subInfo ? "active" : "disabled",
              webhookAuthId: subInfo?.webhook?.authId ?? existingRows[0]?.pollWatermark ? undefined : null,
              lastErrorMessage: subInfo ? null : "Subscription re-confirm failed",
              updatedAt: now,
            }).where(eqMse(astT.id, existingRows[0]!.id));
          }

          output = {
            subscriptionStatus: subInfo ? "active" : "error",
            contentType: mseContentType,
            tenantId: mseTId,
            webhookAuthId: subInfo?.webhook?.authId ?? null,
          };
          log.info({ tenantId: mseTId, contentType: mseContentType, status: output.subscriptionStatus },
            "wf-executor: monitor_subscription_ensure done");
        } catch (mseErr) {
          log.warn({ tenantId: mseTId, contentType: mseContentType, err: mseErr },
            "wf-executor: monitor_subscription_ensure error (non-fatal)");
          output = { subscriptionStatus: "error", tenantId: mseTId, contentType: mseContentType, error: String(mseErr) };
        }
        break;
      }

      // ── monitor_poll_activity ───────────────────────────────────────────────
      // Polls the O365 Management Activity API for new audit events since the
      // stored watermark. Applies mapping + severity rules from the monitor_check
      // config. Writes tenant_monitor_profile rows for critical events and
      // advances the watermark on success.
      // NEVER sets nodeError — all errors are logged and returned in output.
      case "monitor_poll_activity": {
        const mpaTenantId    = interp(node.data.tenantId    as string | undefined, payload)?.trim()
          ?? (payload.assignment && typeof payload.assignment === "object"
              ? ((payload.assignment as Record<string, unknown>).tenantId as string | undefined)
              : undefined);
        const mpaContentType = interp(node.data.contentType as string | undefined, payload)?.trim()
          ?? (payload.assignment && typeof payload.assignment === "object"
              ? ((payload.assignment as Record<string, unknown>).contentType as string | undefined)
              : undefined);
        const mpaCheckKey    = interp(node.data.checkKey    as string | undefined, payload)?.trim()
          ?? (payload.assignment && typeof payload.assignment === "object"
              ? ((payload.assignment as Record<string, unknown>).checkKey as string | undefined)
              : undefined);

        if (!mpaTenantId || !mpaContentType) {
          output = { criticalChangeDetected: false, eventCount: 0, criticalCount: 0, reason: "tenantId or contentType missing" };
          break;
        }

        try {
          const { activitySubscriptionsTable: astPT } = await import("@workspace/db");
          const { listActivityContent, fetchActivityBlob } = await import("./graph");
          const { eq: eqMpa, and: andMpa } = await import("drizzle-orm");

          // Resolve mapping and severity rules from node.data or assignment payload
          const rawMapping     = (node.data.mapping ?? (payload.assignment as Record<string, unknown> | undefined)?.mapping) as Array<{ sourceField: string; targetField: string }> | string | undefined;
          const rawSeverity    = (node.data.severityRules ?? (payload.assignment as Record<string, unknown> | undefined)?.severityRules) as Array<{ expression: string; severity: string; label?: string }> | string | undefined;
          const mappingRules   = typeof rawMapping  === "string" ? JSON.parse(rawMapping)  as Array<{ sourceField: string; targetField: string }> : (rawMapping ?? []);
          const severityRules  = typeof rawSeverity === "string" ? JSON.parse(rawSeverity) as Array<{ expression: string; severity: string; label?: string }> : (rawSeverity ?? []);

          // Get watermark from DB
          const subRows = await db
            .select({ id: astPT.id, pollWatermark: astPT.pollWatermark })
            .from(astPT)
            .where(andMpa(eq(astPT.tenantId, mpaTenantId), eq(astPT.contentType, mpaContentType)))
            .limit(1);

          const subRow = subRows[0];
          const endTime   = new Date();
          const startTime = subRow?.pollWatermark ?? new Date(endTime.getTime() - 5 * 60 * 1000);

          // List and fetch content blobs
          const blobs = await listActivityContent(mpaTenantId, mpaContentType, startTime, endTime);
          let totalEventCount = 0;
          let criticalCount   = 0;

          for (const blob of blobs) {
            const events = await fetchActivityBlob(mpaTenantId, blob.contentUri);
            totalEventCount += events.length;

            for (const evt of events) {
              // Build extracted properties via mapping rules
              const extracted: Record<string, unknown> = {};
              for (const rule of mappingRules) {
                const val = (evt as Record<string, unknown>)[rule.sourceField];
                if (val !== undefined) extracted[rule.targetField] = val;
              }
              extracted.Operation = evt.Operation;
              extracted.Workload  = evt.Workload;
              extracted.UserId    = evt.UserId;

              // Evaluate severity rules
              let matchedSeverity: string | null = null;
              let matchedLabel: string | undefined;
              const evtPayload = { ...payload, ...extracted, event: evt };
              for (const rule of severityRules) {
                try {
                  if (evalCondition(rule.expression, evtPayload as Record<string, unknown>)) {
                    matchedSeverity = rule.severity;
                    matchedLabel    = rule.label;
                    break;
                  }
                } catch { /* bad expression — skip rule */ }
              }

              if (matchedSeverity) {
                criticalCount++;
                // Write tenant_monitor_profile for this critical event
                const checkKeyFinal = mpaCheckKey ?? `live.${mpaContentType.toLowerCase().replace(".", "-")}`;
                const idempKey = `live-${mpaTenantId}-${checkKeyFinal}-${evt.Id ?? blob.contentId + "-" + totalEventCount}`;
                try {
                  const { tenantMonitorProfilesTable: tmpT } = await import("@workspace/db");
                  await db.insert(tmpT).values({
                    tenantId:   mpaTenantId,
                    checkKey:   checkKeyFinal,
                    triggerId:  `wf-run-${runId}`,
                    idempotencyKey: idempKey,
                    status:     "ok",
                    rawResponse: evt as Record<string, unknown>,
                    extractedProperties: extracted,
                    severityMatched: `${matchedSeverity}${matchedLabel ? `: ${matchedLabel}` : ""}`,
                    itemCount:  1,
                  }).onConflictDoNothing();
                } catch (profileErr) {
                  log.warn({ err: profileErr, idempKey }, "monitor_poll_activity: profile insert failed (non-fatal)");
                }
              }
            }
          }

          // Advance watermark
          if (subRow) {
            await db.update(astPT).set({
              pollWatermark:       endTime,
              lastPolledAt:        endTime,
              lastPollEventCount:  totalEventCount,
              lastErrorMessage:    null,
              updatedAt:           endTime,
            }).where(eqMpa(astPT.id, subRow.id));
          }

          output = {
            criticalChangeDetected: criticalCount > 0,
            eventCount:   totalEventCount,
            criticalCount,
            blobCount:    blobs.length,
            tenantId:     mpaTenantId,
            contentType:  mpaContentType,
            watermarkFrom: startTime.toISOString(),
            watermarkTo:   endTime.toISOString(),
          };
          log.info(
            { tenantId: mpaTenantId, contentType: mpaContentType, totalEventCount, criticalCount },
            "wf-executor: monitor_poll_activity done",
          );
        } catch (mpaErr) {
          log.warn({ tenantId: mpaTenantId, contentType: mpaContentType, err: mpaErr },
            "wf-executor: monitor_poll_activity error (non-fatal)");
          output = { criticalChangeDetected: false, eventCount: 0, criticalCount: 0, error: String(mpaErr), tenantId: mpaTenantId, contentType: mpaContentType };
        }
        break;
      }

      // ── Graph Write Operation ─────────────────────────────────────────────
      case "graph_write_operation": {
        if (dryRun) {
          output = { dryRun: true, skipped: true, reason: "graph_write_operation does not support dry-run execution" };
          break;
        }

        const gwoEndpointRaw = interp(node.data.endpoint as string | undefined, payload);
        const gwoMethod = (node.data.method as string | undefined) as "POST" | "PATCH" | "PUT" | undefined;
        const gwoExpectedCodes = (node.data.expectedStatusCodes as number[] | undefined) ?? [200, 201, 204];

        if (!gwoEndpointRaw || !gwoMethod) {
          nodeError = true;
          output = { error: "graph_write_operation requires endpoint and method" };
          break;
        }

        // Resolve body — may be a template string, a {{...}} reference to an object,
        // or a static object. Use resolveExprNative to preserve type for object values.
        const gwoBodyRaw = node.data.body;
        let gwoBody: unknown = {};
        if (typeof gwoBodyRaw === "string") {
          const resolved = resolveExprNative(gwoBodyRaw, payload);
          if (resolved !== undefined) {
            gwoBody = resolved;
          } else {
            try { gwoBody = JSON.parse(interp(gwoBodyRaw, payload) ?? "{}"); } catch { gwoBody = {}; }
          }
        } else if (gwoBodyRaw != null) {
          // Static object in node.data — still interp any string values inside it
          gwoBody = gwoBodyRaw;
        }

        // Resolve customerId → tenantId directly from mspCustomersTable
        const gwoCustomerIdRaw = interp(node.data.customerId as string | undefined, payload);
        const gwoCustomerId = gwoCustomerIdRaw ? parseInt(gwoCustomerIdRaw, 10) : NaN;
        if (isNaN(gwoCustomerId)) {
          nodeError = true;
          output = { error: "graph_write_operation requires a valid customerId to resolve the Graph tenant" };
          break;
        }

        const [gwoCustomerRow] = await db
          .select({ tenantId: mspCustomersTable.tenantId })
          .from(mspCustomersTable)
          .where(eq(mspCustomersTable.id, gwoCustomerId))
          .limit(1);

        if (!gwoCustomerRow?.tenantId) {
          nodeError = true;
          output = { error: `graph_write_operation: no tenant found for customerId ${gwoCustomerId}` };
          break;
        }

        try {
          const { graphWriteForTenant, ConsentRevokedError: GwoConsentRevokedError } = await import("./graph");
          const gwoResult = await graphWriteForTenant(
            gwoCustomerRow.tenantId,
            gwoEndpointRaw,
            gwoMethod,
            gwoBody,
            gwoExpectedCodes,
          );

          // Route to named handle via switchChosenHandle mechanism
          if (gwoResult.success) {
            switchChosenHandle = "success";
            output = { success: true, status: gwoResult.status, data: gwoResult.data };
          } else {
            switchChosenHandle = gwoResult.errorType ?? "unexpected";
            output = { success: false, status: gwoResult.status, errorType: gwoResult.errorType, data: gwoResult.data };
            nodeError = true;
          }
          log.info({ runId, customerId: gwoCustomerId, tenantId: gwoCustomerRow.tenantId, method: gwoMethod, endpoint: gwoEndpointRaw, status: gwoResult.status, success: gwoResult.success }, "wf-executor: graph_write_operation completed");
        } catch (gwoErr) {
          nodeError = true;
          const errMsg = gwoErr instanceof Error ? gwoErr.message : String(gwoErr);
          output = { error: errMsg, success: false };
          log.error({ runId, gwoErr }, "wf-executor: graph_write_operation failed");
        }
        break;
      }

      // ── Execute Baseline Template ─────────────────────────────────────────
      case "execute_baseline_template": {
        if (dryRun) {
          output = { dryRun: true, skipped: true, reason: "execute_baseline_template does not support dry-run execution" };
          break;
        }

        const ebtTemplateId = interp(node.data.templateId as string | undefined, payload);
        if (!ebtTemplateId) {
          nodeError = true;
          output = { error: "execute_baseline_template requires templateId" };
          break;
        }

        // Resolve customerId → tenantId (same pattern as graph_write_operation)
        const ebtCustomerIdRaw = interp(node.data.customerId as string | undefined, payload);
        const ebtCustomerId = ebtCustomerIdRaw ? parseInt(ebtCustomerIdRaw, 10) : NaN;
        if (isNaN(ebtCustomerId)) {
          nodeError = true;
          output = { error: "execute_baseline_template requires a valid customerId" };
          break;
        }

        const [ebtCustomerRow] = await db
          .select({ tenantId: mspCustomersTable.tenantId })
          .from(mspCustomersTable)
          .where(eq(mspCustomersTable.id, ebtCustomerId))
          .limit(1);

        if (!ebtCustomerRow?.tenantId) {
          nodeError = true;
          output = { error: `execute_baseline_template: no tenant found for customerId ${ebtCustomerId}` };
          break;
        }

        try {
          const ebtResult = await runBaselineTemplateAgainstTenant(ebtTemplateId, ebtCustomerRow.tenantId, ebtCustomerId, payload);

          if (ebtResult.missingVariables) {
            nodeError = true;
            output = {
              error: `execute_baseline_template: missing required variables: ${ebtResult.missingVariables.join(", ")}`,
              missingVariables: ebtResult.missingVariables,
            };
            break;
          }

          if (ebtResult.success) {
            switchChosenHandle = "success";
            output = {
              success: true,
              status: ebtResult.status,
              data: ebtResult.data,
              templateId: ebtTemplateId,
              label: ebtResult.label,
            };
          } else {
            switchChosenHandle = ebtResult.errorType ?? "unexpected";
            output = {
              success: false,
              status: ebtResult.status,
              errorType: ebtResult.errorType,
              data: ebtResult.data,
              templateId: ebtTemplateId,
              label: ebtResult.label,
            };
            nodeError = true;
          }
          log.info({ runId, ebtTemplateId, tenantId: ebtCustomerRow.tenantId, status: ebtResult.status, success: ebtResult.success }, "wf-executor: execute_baseline_template completed");
        } catch (ebtErr) {
          nodeError = true;
          const ebtErrMsg = ebtErr instanceof Error ? ebtErr.message : String(ebtErr);
          output = { error: ebtErrMsg, success: false, templateId: ebtTemplateId };
          log.error({ runId, ebtErr, ebtTemplateId }, "wf-executor: execute_baseline_template failed");
        }
        break;
      }

      default:
        log.warn({ nodeType: node.type, nodeId: node.id, runId }, "workflow-executor: unrecognised node type — setting error output");
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
    input: redactSensitivePayloadKeys(payload),
    output,
    durationMs,
    status,
    errorMessage: nodeError ? (output.error as string ?? "node error") : null,
  }).catch(() => { /* non-fatal */ });

  // ── Capture output sample for the variable picker ─────────────────────────
  // Upsert a sample for this (definition, node) pair when the node succeeded.
  // This lets the Config Panel variable-picker show real sample keys without
  // an AI call. Skip on error so we never store a partial/error shape.
  // Wrapped in Promise.resolve().then() so any synchronous throw (e.g. in
  // test mocks that don't implement onConflictDoUpdate) is caught too.
  // Defense-in-depth: never capture an output sample for the break-glass gate.
  // Its handler returns early (above) so this is normally unreachable, but the
  // guard guarantees a sensitive value can never land in wf_node_output_samples
  // even if that early return is ever refactored away.
  if (!nodeError && definitionId != null && node.type !== "break_glass_verification_gate") {
    const resolvedNodeType = (node.data?.actionType as string | undefined) ?? node.type;
    Promise.resolve().then(() =>
      db.insert(wfNodeOutputSamplesTable).values({
        definitionId,
        nodeId: node.id,
        nodeType: resolvedNodeType,
        sample: output,
        capturedAt: new Date(),
        sourceRunId: runId,
      }).onConflictDoUpdate({
        target: [wfNodeOutputSamplesTable.definitionId, wfNodeOutputSamplesTable.nodeId],
        set: {
          nodeType: resolvedNodeType,
          sample: output,
          capturedAt: new Date(),
          sourceRunId: runId,
        },
      })
    ).catch(() => { /* non-fatal — capture failure must never affect the run */ });
  }

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
  iterationIndex?: number,
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

    const nodeInputPayload = currentPayload;
    const { output, nextPayload, cancelRun, nodeError, conditionResult, switchChosenHandle } =
      await executeNode(node, currentPayload, runId, dryRun, inputValues, definitionId);
    currentPayload = nextPayload;
    lastOutput = output;

    // Write a per-iteration indexed output row (e.g. "node-103[0]") so the run
    // detail page can show distinct Input/Output for each ForEach iteration.
    // Only written for start nodes (which are the ones pushed into branchPath
    // with the [i] suffix by the main BFS forEach block).
    if (iterationIndex !== undefined && startNodeIds.includes(nodeId)) {
      await db.insert(wfRunNodeOutputsTable).values({
        runId,
        nodeId: `${node.id}[${iterationIndex}]`,
        input: redactSensitivePayloadKeys(nodeInputPayload),
        output,
        durationMs: null,
        status: nodeError ? "error" : "ok",
        errorMessage: nodeError ? (output.error as string ?? "node error") : null,
      }).catch(() => { });
    }

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

    if (node.type === "check_script_output" && conditionResult !== undefined) {
      const outEdges  = subEdges.filter(e => e.source === nodeId);
      const trueEdge  = outEdges.find(e => e.sourceHandle === "yes");
      const falseEdge = outEdges.find(e => e.sourceHandle === "no");
      for (const e of outEdges) {
        subResolveEdge(e.target, conditionResult ? e.id === trueEdge?.id : e.id === falseEdge?.id);
      }
      continue;
    }

    if (node.type === "condition" && conditionResult !== undefined) {
      const outEdges  = subEdges.filter(e => e.source === nodeId);
      const trueEdge  = outEdges.find(e => e.sourceHandle === "yes" || e.sourceHandle === "true");
      const falseEdge = outEdges.find(e => e.sourceHandle === "no"  || e.sourceHandle === "false");
      for (const e of outEdges) {
        subResolveEdge(e.target, conditionResult ? e.id === trueEdge?.id : e.id === falseEdge?.id);
      }
      continue;
    }

    if ((node.type === "switch_case" || node.type === "graph_write_operation" || node.type === "execute_baseline_template") && switchChosenHandle !== undefined) {
      for (const e of subEdges.filter(e => e.source === nodeId)) {
        subResolveEdge(e.target, e.sourceHandle === switchChosenHandle);
      }
      continue;
    }

    // Nested ForEach: expand and iterate sequentially, mirroring main BFS foreach logic.
    // Without this, the inner foreach is treated as a regular node — item is never injected
    // into the payload, so any node in the inner loop body that uses {{item.*}} gets undefined.
    if (node.type === "foreach") {
      const nestedItems  = (output.foreachItems as unknown[]) ?? [];
      const nestedAlias  = (output.itemAlias as string | null) ?? null;
      const nestedOut    = subEdges.filter(e => e.source === nodeId);
      const nestedBody   = nestedOut.filter(e => e.sourceHandle === "item" || e.sourceHandle === "body");
      const nestedDone   = nestedOut.filter(e => e.sourceHandle === "done");

      // DFS to collect the nested foreach body subgraph, constrained to nodes already
      // in the outer subgraph so we never escape the current execution boundary.
      const nestedDoneIds = new Set(nestedDone.map(e => e.target));
      const nestedSubIds  = new Set<string>();
      const nStack = nestedBody.map(e => e.target);
      while (nStack.length > 0) {
        const nId = nStack.pop()!;
        if (nestedSubIds.has(nId) || nestedDoneIds.has(nId) || !subgraphNodeIdSet.has(nId)) continue;
        nestedSubIds.add(nId);
        for (const e of subEdges.filter(e => e.source === nId)) {
          if (!nestedSubIds.has(e.target) && !nestedDoneIds.has(e.target)) nStack.push(e.target);
        }
      }

      const nestedStartIds   = nestedBody.map(e => e.target).filter(id => nestedSubIds.has(id));
      const nestedTotal      = nestedItems.length;
      const nestedCollected: Record<string, unknown>[] = [];

      for (let ni = 0; ni < nestedItems.length; ni++) {
        const nestedElem = nestedItems[ni];
        const prevSteps  = (currentPayload.steps as Record<string, unknown>) ?? {};
        const prevNodes  = (currentPayload.nodes as Record<string, unknown>) ?? {};
        const nIterStep: Record<string, unknown> = {
          ...(prevSteps[nodeId] as Record<string, unknown> ?? {}),
          item: nestedElem,
          currentItem: nestedElem,
          itemIndex: ni,
          itemsTotal: nestedTotal,
          ...(nestedAlias ? { [nestedAlias]: nestedElem } : {}),
        };
        const nIterPayload: Record<string, unknown> = {
          ...currentPayload,
          item: nestedElem,
          currentItem: nestedElem,
          ...(nestedAlias ? { [nestedAlias]: nestedElem } : {}),
          itemIndex: ni,
          itemsTotal: nestedTotal,
          steps: { ...prevSteps, [nodeId]: nIterStep },
          nodes: { ...prevNodes, [nodeId]: nIterStep },
        };

        const nResult = await executeItemSubgraph(
          graph, nestedSubIds, nestedStartIds, nIterPayload,
          runId, dryRun, inputValues, definitionId,
        );

        if (nResult.cancelRun) return { payload: currentPayload, lastOutput, cancelRun: true, nodeError: false };
        if (nResult.nodeError) return {
          payload: currentPayload, lastOutput, cancelRun: false,
          nodeError: true, errorOutput: nResult.errorOutput, failedNodeId: nResult.failedNodeId,
        };

        nestedCollected.push(nResult.lastOutput);
        currentPayload = nResult.payload;
      }

      currentPayload = { ...currentPayload, collectedResults: nestedCollected, itemsTotal: nestedTotal };

      // Prevent the outer subgraph BFS from re-executing the inner loop body nodes.
      for (const nId of nestedSubIds) {
        subResolved.set(nId, (subInDegree.get(nId) ?? 0) + 1);
      }

      // Route done edges (post inner-loop continuation within the outer loop body).
      for (const e of nestedDone) subResolveEdge(e.target, true);
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
  if (!run) { log.warn({ runId }, "wf-executor: run not found"); return; }

  // Establish one AsyncLocalStorage correlation context per RUN so every event
  // dispatched while this run executes shares a single correlationId. An
  // event-triggered run whose triggerRef is a bare event UUID inherits it as
  // the correlation; free-form refs (e.g. "run_workflow:parent:123") don't
  // match the UUID shape and fall back to a fresh id. wf_runs carries no tenant
  // columns, so mspId/customerId stay null here.
  const traceId =
    run.triggerRef && RUNBOOK_UUID_RE.test(run.triggerRef)
      ? run.triggerRef
      : randomUUID();

  return runWithRequestContext(
    { traceId, mspId: null, customerId: null, actor: null },
    () => executeWorkflowRunInner(run, opts),
  );
}

async function executeWorkflowRunInner(
  run: WfRun,
  opts: { inlineGraph?: WfGraph; dryRun?: boolean; inputValues?: Record<string, string | string[]> } = {},
): Promise<void> {
  const runId = run.id;

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
      if (freshStatus[0]?.status === "cancelled") { log.info({ runId, nodeId }, "wf-executor: cancelled mid-execution"); return; }

      // ── Skip path: node is reachable only through skipped predecessors ──
      if (item.skip) {
        await db.insert(wfRunNodeOutputsTable).values({
          runId, nodeId, input: redactSensitivePayloadKeys(payload), output: { skipped: true }, status: "skipped",
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
        log.info({ runId, nodeId }, "wf-executor: run paused at approval_gate");
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
          // If the error target is a Retry node, defer resolution of normal outgoing edges.
          // The Retry node will activate them directly on success so that resolveEdge can
          // still re-queue them (their resolvedCount must not already be at inDegree).
          const errorTargetNode = graph.nodes.find(n => n.id === errorEdge.target);
          if (errorTargetNode?.type === "retry") {
            resolveEdge(errorEdge.target, true);
          } else {
            for (const e of outEdges) resolveEdge(e.target, e.target === errorEdge.target);
          }
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
          log.warn({ runId, nodeId }, "wf-executor: node error, no handler — run failed");
          return;
        }
        continue;
      }

      // Condition / Check Script Output: route yes/no branches
      if (node.type === "check_script_output" && conditionResult !== undefined) {
        const outEdges  = graph.edges.filter(e => e.source === nodeId);
        const trueEdge  = outEdges.find(e => e.sourceHandle === "yes");
        const falseEdge = outEdges.find(e => e.sourceHandle === "no");
        for (const e of outEdges) {
          resolveEdge(e.target, conditionResult ? e.id === trueEdge?.id : e.id === falseEdge?.id);
        }
        continue;
      }

      // Condition: route true/false/cancel branches
      // cancel handle: when condition is false AND a cancel edge exists → cancel run immediately
      if (node.type === "condition" && conditionResult !== undefined) {
        const outEdges  = graph.edges.filter(e => e.source === nodeId);
        // Graphs store condition branch handles as "yes"/"no" (set by the flow
        // builder's treeToGraph). Support "true"/"false" as well for backward
        // compatibility with any manually-created graphs that used the old naming.
        // IMPORTANT: always prefer "yes" over "true" (and "no" over "false") so
        // that array ordering of edges cannot change which branch is taken when
        // a graph contains both handle names (e.g. a stale "true" edge alongside
        // a live "yes" edge from a subsequent edit).
        const trueEdge =
          outEdges.find(e => e.sourceHandle === "yes") ??
          outEdges.find(e => e.sourceHandle === "true") ??
          outEdges.find(e => !e.sourceHandle && !outEdges.some(x => x.sourceHandle === "yes" || x.sourceHandle === "true"));
        const falseEdge =
          outEdges.find(e => e.sourceHandle === "no") ??
          outEdges.find(e => e.sourceHandle === "false");
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

      // Switch/Case and named-handle write nodes: route only the matching handle
      if ((node.type === "switch_case" || node.type === "graph_write_operation" || node.type === "execute_baseline_template") && switchChosenHandle !== undefined) {
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

        log.info({ runId, nodeId, itemsTotal, subgraphSize: itemSubgraphIds.size },
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
            currentItem: element,
            itemIndex: i,
            itemsTotal,
            ...(itemAlias ? { [itemAlias]: element } : {}),
          };
          const iterPayload: Record<string, unknown> = {
            ...payload,
            item: element,
            currentItem: element,
            ...(itemAlias ? { [itemAlias]: element } : {}),
            itemIndex: i,
            itemsTotal,
            steps: { ...prevSteps, [nodeId]: foreachIterStep },
            nodes: { ...prevNodes, [nodeId]: foreachIterStep },
          };

          const iterResult = await executeItemSubgraph(
            graph, itemSubgraphIds, startIds, iterPayload,
            runId, opts.dryRun ?? false, opts.inputValues ?? {}, run.definitionId,
            i,
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
            log.warn({ runId, nodeId, iteration: i, failedNodeId: iterResult.failedNodeId },
              "wf-executor: foreach — node error in loop body, no handler — run failed");
            return;
          }

          // Store the terminal node's raw output (not full merged payload) so
          // {{collectedResults}} downstream contains per-iteration node outputs only.
          collectedResults.push(iterResult.lastOutput);

          log.info({ runId, nodeId, iteration: i, itemsTotal },
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

      // For: sequential index-based loop — mirrors foreach but injects item + index
      if (node.type === "for") {
        const forItems    = (output.forItems as unknown[]) ?? [];
        const maxIter     = (output.maxIterations as number | null) ?? null;
        const outEdges    = graph.edges.filter(e => e.source === nodeId);
        const bodyEdges   = outEdges.filter(e => e.sourceHandle === "body");
        const doneEdges   = outEdges.filter(e => e.sourceHandle === "done");

        // Collect body subgraph nodes via DFS from body-handle targets.
        const doneTargetIds    = new Set(doneEdges.map(e => e.target));
        const bodySubgraphIds  = new Set<string>();
        const dfsStack         = bodyEdges.map(e => e.target);
        while (dfsStack.length > 0) {
          const nId = dfsStack.pop()!;
          if (bodySubgraphIds.has(nId) || doneTargetIds.has(nId)) continue;
          bodySubgraphIds.add(nId);
          for (const e of graph.edges.filter(e => e.source === nId)) {
            if (!bodySubgraphIds.has(e.target) && !doneTargetIds.has(e.target)) {
              dfsStack.push(e.target);
            }
          }
        }

        const iterLimit  = maxIter !== null ? Math.min(forItems.length, maxIter) : forItems.length;
        const startIds   = bodyEdges.map(e => e.target).filter(id => bodySubgraphIds.has(id));
        const forCollectedResults: Record<string, unknown>[] = [];

        log.info({ runId, nodeId, iterLimit, subgraphSize: bodySubgraphIds.size },
          "wf-executor: for — starting iterations");

        for (let i = 0; i < iterLimit; i++) {
          const element = forItems[i];
          const prevSteps = (payload.steps as Record<string, unknown>) ?? {};
          const prevNodes = (payload.nodes as Record<string, unknown>) ?? {};
          const forIterStep = {
            ...(prevSteps[nodeId] as Record<string, unknown> ?? {}),
            item:  element,
            index: i,
          };
          const iterPayload: Record<string, unknown> = {
            ...payload,
            item:  element,
            index: i,
            steps: { ...prevSteps, [nodeId]: forIterStep },
            nodes: { ...prevNodes, [nodeId]: forIterStep },
          };

          const iterResult = await executeItemSubgraph(
            graph, bodySubgraphIds, startIds, iterPayload,
            runId, opts.dryRun ?? false, opts.inputValues ?? {}, run.definitionId,
            i,
          );
          branchPath.push(...startIds.map(id => `${id}[${i}]`));

          if (iterResult.cancelRun) {
            await db.update(wfRunsTable).set({
              status: "cancelled", finishedAt: new Date(),
              branchPath: branchPath as unknown as string[],
            }).where(eq(wfRunsTable.id, runId));
            await db.insert(wfRunNodeLogsTable).values({
              runId, nodeId, level: "info",
              message: `Run cancelled by cancel_workflow inside for iteration ${i}`,
            }).catch(() => { });
            return;
          }

          if (iterResult.nodeError) {
            const errMsg = (iterResult.errorOutput?.error as string | undefined)
              ?? `for: node ${iterResult.failedNodeId ?? "unknown"} failed at iteration ${i}`;
            await db.update(wfRunsTable).set({
              status: "failed", finishedAt: new Date(), errorMessage: errMsg,
              branchPath: branchPath as unknown as string[],
            }).where(eq(wfRunsTable.id, runId));
            log.warn({ runId, nodeId, iteration: i, failedNodeId: iterResult.failedNodeId },
              "wf-executor: for — node error in loop body, no handler — run failed");
            return;
          }

          // Accumulate per-iteration output so {{collectedResults}} is available downstream.
          forCollectedResults.push(iterResult.lastOutput);

          log.info({ runId, nodeId, iteration: i, iterLimit },
            "wf-executor: for iteration complete");
        }

        // Update main payload with collected results so downstream nodes (e.g. Group By)
        // receive the fresh per-iteration outputs rather than the pre-loop payload.
        payload = { ...payload, collectedResults: forCollectedResults, itemsTotal: iterLimit };

        // Prevent the main BFS from executing body-subgraph nodes again.
        for (const nId of bodySubgraphIds) {
          resolvedCount.set(nId, (inDegree.get(nId) ?? 0) + 1);
        }

        // Route done edges as active (post-loop continuation)
        for (const e of doneEdges) resolveEdge(e.target, true);

        await db.update(wfRunsTable)
          .set({ branchPath: branchPath as unknown as string[] })
          .where(eq(wfRunsTable.id, runId));

        continue;
      }

      // Parallel: run branch subgraphs concurrently; awaited branches block, detached fire-and-forget.
      if (node.type === "parallel") {
        const parallelOutEdges = graph.edges.filter(e => e.source === nodeId);
        // Sort branch edges by their handle number so config is always keyed to the
        // correct branch regardless of the order edges were stored in the graph (edge
        // order can change after editor insertions/removals).
        const branchEdgesRaw = parallelOutEdges.filter(e => e.sourceHandle?.startsWith("branch_"));
        const branchEdges = [...branchEdgesRaw].sort((a, b) => {
          const numA = parseInt((a.sourceHandle ?? "branch_0").replace("branch_", ""), 10) || 0;
          const numB = parseInt((b.sourceHandle ?? "branch_0").replace("branch_", ""), 10) || 0;
          return numA - numB;
        });

        const joinNodeId      = node.data.joinNodeId as string | undefined;
        const branchWaitArr   = (node.data.branchWait   as boolean[] | undefined) ?? [];
        const branchLabelsArr = (node.data.branchLabels as string[] | undefined) ?? [];

        // Build handle → config maps so lookup is O(1) and immune to edge reordering.
        // Config arrays are 0-indexed corresponding to branch_1, branch_2, … branch_N.
        function waitForHandle(handle: string): boolean {
          const idx = parseInt(handle.replace("branch_", ""), 10) - 1;
          return branchWaitArr[idx] !== false; // defaults to true when missing
        }
        function labelForHandle(handle: string): string {
          const idx = parseInt(handle.replace("branch_", ""), 10) - 1;
          return branchLabelsArr[idx] ?? handle;
        }

        // Stop set for DFS: the join node
        const joinStop = joinNodeId ? new Set([joinNodeId]) : new Set<string>();

        interface BranchDef {
          branchIdx: number;
          startId: string;
          handle: string;
          wait: boolean;
          label: string;
          subgraphIds: Set<string>;
        }

        const branchDefs: BranchDef[] = branchEdges.map((edge, i) => {
          const handle = edge.sourceHandle ?? `branch_${i + 1}`;
          const subgraphIds = new Set<string>();
          const dfsStack    = [edge.target];
          while (dfsStack.length > 0) {
            const nId = dfsStack.pop()!;
            if (subgraphIds.has(nId) || joinStop.has(nId)) continue;
            subgraphIds.add(nId);
            for (const e of graph.edges.filter(e => e.source === nId)) {
              if (!subgraphIds.has(e.target) && !joinStop.has(e.target)) dfsStack.push(e.target);
            }
          }
          return {
            branchIdx:  i,
            startId:    edge.target,
            handle,
            wait:       waitForHandle(handle),
            label:      labelForHandle(handle),
            subgraphIds,
          };
        });

        const awaitedBranches  = branchDefs.filter(b => b.wait);
        const detachedBranches = branchDefs.filter(b => !b.wait);

        // ── Fire-and-forget detached branches ─────────────────────────────
        // In dry-run mode we execute detached branches synchronously so the dry run
        // completes deterministically (no background tasks outlive the run).
        const isDryRun = opts.dryRun ?? false;

        if (isDryRun) {
          // Dry-run: await detached branches sequentially for deterministic output
          for (const branch of detachedBranches) {
            if (branch.subgraphIds.size === 0) continue;
            const startIds = [branch.startId].filter(id => branch.subgraphIds.has(id));
            try {
              const result = await executeItemSubgraph(
                graph, branch.subgraphIds, startIds, payload,
                runId, true, opts.inputValues ?? {}, run.definitionId,
              );
              if (result.nodeError) {
                log.warn({ runId, nodeId, branch: branch.label },
                  "wf-executor: parallel dry-run detached branch failed (logged, not propagated)");
              }
            } catch (err) {
              log.error({ runId, nodeId, branch: branch.label, err },
                "wf-executor: parallel dry-run detached branch threw");
            }
          }
        } else {
          // Live run: true fire-and-forget via .then()
          for (const branch of detachedBranches) {
            if (branch.subgraphIds.size === 0) continue;
            const startIds = [branch.startId].filter(id => branch.subgraphIds.has(id));
            executeItemSubgraph(
              graph, branch.subgraphIds, startIds, payload,
              runId, false, opts.inputValues ?? {}, run.definitionId,
            ).then(result => {
              if (result.nodeError) {
                log.warn({ runId, nodeId, branch: branch.label },
                  "wf-executor: parallel fire-and-forget branch failed (logged, not propagated)");
              } else {
                log.info({ runId, nodeId, branch: branch.label },
                  "wf-executor: parallel fire-and-forget branch completed");
              }
            }).catch(err => {
              log.error({ runId, nodeId, branch: branch.label, err },
                "wf-executor: parallel fire-and-forget branch threw");
            });
          }
        }

        // ── Awaited branches (Promise.all) ─────────────────────────────────
        const branchOutputs: Record<string, unknown> = {};
        let parallelFailed = false;

        const awaitedResults = await Promise.all(
          awaitedBranches.map(branch => {
            if (branch.subgraphIds.size === 0) {
              return Promise.resolve({ branch, result: { payload, lastOutput: {}, cancelRun: false, nodeError: false } });
            }
            const startIds = [branch.startId].filter(id => branch.subgraphIds.has(id));
            return executeItemSubgraph(
              graph, branch.subgraphIds, startIds, payload,
              runId, opts.dryRun ?? false, opts.inputValues ?? {}, run.definitionId,
            ).then(result => ({ branch, result }));
          }),
        );

        for (const { branch, result } of awaitedResults) {
          if (result.cancelRun) {
            await db.update(wfRunsTable).set({
              status: "cancelled", finishedAt: new Date(),
              branchPath: branchPath as unknown as string[],
            }).where(eq(wfRunsTable.id, runId));
            await db.insert(wfRunNodeLogsTable).values({
              runId, nodeId, level: "info",
              message: `Run cancelled by cancel_workflow inside parallel branch "${branch.label}"`,
            }).catch(() => { });
            return;
          }
          if (result.nodeError) {
            parallelFailed = true;
            log.warn({ runId, nodeId, branch: branch.label }, "wf-executor: parallel awaited branch failed");
          } else {
            branchOutputs[branch.handle] = result.lastOutput;
          }
        }

        if (parallelFailed) {
          await db.update(wfRunsTable).set({
            status: "failed", finishedAt: new Date(),
            errorMessage: `A parallel branch failed`,
            branchPath: branchPath as unknown as string[],
          }).where(eq(wfRunsTable.id, runId));
          log.warn({ runId, nodeId }, "wf-executor: parallel — awaited branch failed, run aborted");
          return;
        }

        // Log join summary (awaited vs detached counts) before continuing
        await db.insert(wfRunNodeLogsTable).values({
          runId,
          nodeId,
          level: "info",
          message: `Parallel completed: ${awaitedBranches.length} awaited branch${awaitedBranches.length !== 1 ? "es" : ""} merged` +
            (detachedBranches.length > 0
              ? `; ${detachedBranches.length} fire-and-forget branch${detachedBranches.length !== 1 ? "es" : ""} launched`
              : ""),
        }).catch(() => { });

        // Merge branch outputs into payload
        const prevStepsP = (payload.steps as Record<string, unknown>) ?? {};
        payload = { ...payload, steps: { ...prevStepsP, [nodeId]: branchOutputs } };

        // Fence all branch subgraph nodes from the main BFS
        const allSubgraphIds = new Set<string>();
        for (const branch of branchDefs) {
          for (const id of branch.subgraphIds) allSubgraphIds.add(id);
        }
        for (const nId of allSubgraphIds) {
          resolvedCount.set(nId, (inDegree.get(nId) ?? 0) + 1);
        }

        // Resolve the join node's incoming edges.
        // Its inDegree = number of branch edges leading to it.
        // Since we fenced the branch nodes, resolve manually N times.
        if (joinNodeId) {
          const joinInDeg = inDegree.get(joinNodeId) ?? 0;
          for (let i = 0; i < joinInDeg; i++) resolveEdge(joinNodeId, true);
        }

        await db.update(wfRunsTable)
          .set({ branchPath: branchPath as unknown as string[] })
          .where(eq(wfRunsTable.id, runId));

        continue;
      }

      // Retry: re-run the source node up to maxAttempts times; on exhaustion run the
      // exhausted subgraph (same pattern as ForEach body), then fire the done edges.
      if (node.type === "retry") {
        const retryOutEdges  = graph.edges.filter(e => e.source === nodeId);
        const exhaustedEdges = retryOutEdges.filter(e => e.sourceHandle === "exhausted");
        const doneEdges      = retryOutEdges.filter(e => e.sourceHandle === "done");

        // Find the source node before dry-run check so it's available in all branches.
        // The source is the node whose error/onError edge leads here; filter strictly to
        // avoid accidentally picking a non-error predecessor.
        const incomingErrorEdge = graph.edges.find(
          e => e.target === nodeId && (e.sourceHandle === "error" || e.sourceHandle === "onError"),
        );
        const sourceNodeId  = incomingErrorEdge?.source ?? null;
        const sourceNode    = sourceNodeId ? graph.nodes.find(n => n.id === sourceNodeId) ?? null : null;

        // Helper: deferred source-normal edges — must be resolved (active or inactive) in
        // every exit path so that AND-gated join nodes that have incoming edges from both
        // the source normal path AND the retry done path can reach their full inDegree.
        const sourceNormalEdges = sourceNodeId
          ? graph.edges.filter(
              e => e.source === sourceNodeId
                && e.sourceHandle !== "error"
                && e.sourceHandle !== "onError",
            )
          : [];

        // Dry-run: treat as pass-through — done edges active, source-normal edges inactive,
        // exhausted subgraph skipped. Resolving both sides satisfies AND-gated join nodes.
        if (opts.dryRun) {
          for (const e of sourceNormalEdges) resolveEdge(e.target, false);
          for (const e of doneEdges) resolveEdge(e.target, true);
          continue;
        }

        const maxAttempts   = typeof node.data.maxAttempts  === "number" ? node.data.maxAttempts  : 3;
        const delaySeconds  = typeof node.data.delaySeconds === "number" ? node.data.delaySeconds : 0;

        // Retrieve current retry state from nested payload: payload._retry[nodeId]
        // Using nested form so {{_retry.<id>.count}} resolves correctly via the
        // workflow interpolation engine's dot-path traversal.
        const retryBucket = (payload._retry as Record<string, { count: number; lastError: string }> | undefined) ?? {};
        const retryState  = retryBucket[nodeId] ?? { count: 0, lastError: "" };
        let   attempt     = retryState.count + 1;

        log.info({ runId, retryNodeId: nodeId, attempt, maxAttempts, sourceNodeId },
          "wf-executor: retry — attempt starting");

        // Collect exhausted subgraph nodes via DFS from exhausted handle targets.
        // Stop at nodes directly targeted by the done edges (mirrors ForEach pattern).
        const doneTargetIds = new Set(doneEdges.map(e => e.target));
        const exhaustedSubgraphIds = new Set<string>();
        const exDfsStack = exhaustedEdges.map(e => e.target);
        while (exDfsStack.length > 0) {
          const nId = exDfsStack.pop()!;
          if (exhaustedSubgraphIds.has(nId) || doneTargetIds.has(nId)) continue;
          exhaustedSubgraphIds.add(nId);
          for (const e of graph.edges.filter(e => e.source === nId)) {
            if (!exhaustedSubgraphIds.has(e.target) && !doneTargetIds.has(e.target)) {
              exDfsStack.push(e.target);
            }
          }
        }

        if (sourceNode && attempt <= maxAttempts) {
          // Delay before retry
          if (delaySeconds > 0) {
            await new Promise<void>(res => setTimeout(res, delaySeconds * 1000));
          }

          // Re-execute the source node
          const retryResult = await executeNode(
            sourceNode, payload, runId, false, opts.inputValues ?? {}, run.definitionId,
          );

          payload = retryResult.nextPayload;

          if (!retryResult.nodeError) {
            // Success — fence the retry node + exhausted subgraph so main BFS never re-runs them
            resolvedCount.set(nodeId, (inDegree.get(nodeId) ?? 0) + 1);
            for (const nId of exhaustedSubgraphIds) {
              resolvedCount.set(nId, (inDegree.get(nId) ?? 0) + 1);
            }
            // Source normal edges fire active; done edges fire inactive.
            // Both must be resolved to satisfy AND-gated join nodes that have incoming
            // edges from both paths (source-normal AND retry-done).
            for (const e of sourceNormalEdges) resolveEdge(e.target, true);
            for (const e of doneEdges)         resolveEdge(e.target, false);
            branchPath.push(`${nodeId}[retry-success-${attempt}]`);
          } else {
            // Still failing — update retry state in nested payload and re-queue this retry node
            const updatedBucket = {
              ...retryBucket,
              [nodeId]: {
                count:     attempt,
                lastError: (retryResult.output.error as string | undefined) ?? `Attempt ${attempt} failed`,
              },
            };
            payload = { ...payload, _retry: updatedBucket };
            readyQueue.push({ nodeId, skip: false });
            // Bump resolvedCount so the node re-enters the queue correctly on the next pass
            resolvedCount.set(nodeId, (inDegree.get(nodeId) ?? 0));
          }
        } else {
          // All attempts exhausted (or source node not found)
          const lastError = retryState.lastError || `Retry exhausted after ${maxAttempts} attempt(s)`;

          if (exhaustedEdges.length === 0) {
            // No exhausted handler wired — fail the run
            await db.update(wfRunsTable).set({
              status: "failed", finishedAt: new Date(),
              errorMessage: `Retry exhausted after ${maxAttempts} attempt(s): ${lastError}`,
              branchPath: branchPath as unknown as string[],
            }).where(eq(wfRunsTable.id, runId));
            log.warn({ runId, nodeId, maxAttempts, lastError }, "wf-executor: retry exhausted — no handler — run failed");
            return;
          }

          // Run the exhausted subgraph — inject retry state under nested _retry[nodeId]
          // so that {{_retry.<id>.count}} and {{_retry.<id>.lastError}} resolve correctly
          // in the interpolation engine's dot-path traversal.
          const exhaustedPayload: Record<string, unknown> = {
            ...payload,
            _retry: { ...retryBucket, [nodeId]: { count: retryState.count, lastError } },
          };
          const startIds = exhaustedEdges.map(e => e.target).filter(id => exhaustedSubgraphIds.has(id));

          log.info({ runId, retryNodeId: nodeId, maxAttempts, subgraphSize: exhaustedSubgraphIds.size },
            "wf-executor: retry — running exhausted subgraph");

          const exResult = await executeItemSubgraph(
            graph, exhaustedSubgraphIds, startIds, exhaustedPayload,
            runId, opts.dryRun ?? false, opts.inputValues ?? {}, run.definitionId,
          );
          branchPath.push(...startIds.map(id => `${id}[exhausted]`));

          if (exResult.cancelRun) {
            await db.update(wfRunsTable).set({
              status: "cancelled", finishedAt: new Date(),
              branchPath: branchPath as unknown as string[],
            }).where(eq(wfRunsTable.id, runId));
            return;
          }

          if (exResult.nodeError) {
            const errMsg = (exResult.errorOutput?.error as string | undefined)
              ?? `retry: node ${exResult.failedNodeId ?? "unknown"} failed in exhausted subgraph`;
            await db.update(wfRunsTable).set({
              status: "failed", finishedAt: new Date(), errorMessage: errMsg,
              branchPath: branchPath as unknown as string[],
            }).where(eq(wfRunsTable.id, runId));
            log.warn({ runId, nodeId, failedNodeId: exResult.failedNodeId },
              "wf-executor: retry — node error in exhausted subgraph — run failed");
            return;
          }

          payload = exResult.payload;

          // Fence exhausted subgraph nodes from main BFS
          for (const nId of exhaustedSubgraphIds) {
            resolvedCount.set(nId, (inDegree.get(nId) ?? 0) + 1);
          }

          // Resolve the source node's normal (non-error) outgoing edges as inactive.
          // On exhaustion we deferred their resolution (so retry-success could still
          // activate them), but now we must account for them in the AND-style join:
          // any continuation node with incoming edges from both the source normal path
          // AND the retry done path needs both resolved to reach its full inDegree.
          for (const e of sourceNormalEdges) resolveEdge(e.target, false);

          // Fire done edges (post-retry continuation)
          for (const e of doneEdges) resolveEdge(e.target, true);

          await db.update(wfRunsTable)
            .set({ branchPath: branchPath as unknown as string[] })
            .where(eq(wfRunsTable.id, runId));
        }

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

      // Normal: non-error outgoing edges are active; onError/error edges are inactive on success
      // (they are only activated by the nodeError path above so the retry node is never
      // queued when the source node succeeds on its first attempt).
      for (const e of graph.edges.filter(edge => edge.source === nodeId)) {
        const isErrorEdge = e.sourceHandle === "error" || e.sourceHandle === "onError";
        resolveEdge(e.target, !isErrorEdge);
      }
    }

    await db.update(wfRunsTable).set({ status: "completed", finishedAt: new Date(), branchPath: branchPath as unknown as string[] }).where(eq(wfRunsTable.id, runId));
    log.info({ runId, steps: branchPath.length }, "wf-executor: run completed");
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
    log.warn({ runId, err }, "wf-executor: run failed");
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

        log.info({ approvalId: row.id, runId: row.run_id }, "approval-gate: timed out, run marked failed");
      } catch (innerErr) {
        log.warn({ err: innerErr, approvalId: row.id }, "approval-gate: timeout processing failed (non-fatal)");
      }
    }
  } catch (err) {
    log.warn({ err }, "approval-gate: timeout check failed (non-fatal)");
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
  if (!run) { log.warn({ runId }, "resumeWorkflowRun: run not found"); return; }

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
      if (freshStatus[0]?.status === "cancelled") { log.info({ runId, nodeId }, "wf-executor: cancelled mid-resume"); return; }

      if (item.skip) {
        await db.insert(wfRunNodeOutputsTable).values({
          runId, nodeId, input: redactSensitivePayloadKeys(payload), output: { skipped: true }, status: "skipped",
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
        log.info({ runId, nodeId }, "wf-executor: resumed run paused at another approval_gate");
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

      if ((node.type === "switch_case" || node.type === "graph_write_operation" || node.type === "execute_baseline_template") && switchChosenHandle !== undefined) {
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
    log.info({ runId, steps: branchPath.length }, "wf-executor: resumed run completed");
  } catch (err) {
    const errMsg = String(err);
    await db.update(wfRunsTable).set({ status: "failed", finishedAt: new Date(), errorMessage: errMsg, branchPath: branchPath as unknown as string[] }).where(eq(wfRunsTable.id, runId));
    await db.insert(wfRunNodeLogsTable).values({ runId, nodeId: "__resume__", level: "error", message: `Resume executor error: ${errMsg}` }).catch(() => { });
    log.warn({ runId, err }, "wf-executor: resumed run failed");
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
        log.warn({ triggerId: trigger.id, definitionId: trigger.definition_id }, "wf-engine: skipping scheduled trigger — run already in progress");
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
          log.warn({ triggerId: trigger.id }, "wf-engine: fan_out_query rejected — must be a single SELECT with no semicolons");
        } else {
          try {
            const records = await pool.query(safeQ);
            if (fanOutMode === "per_record") {
              for (const row of records.rows) {
                await fireWorkflowForDefinition(trigger.definition_id, "schedule", `trigger:${trigger.id}`, row as Record<string, unknown>);
              }
              log.info({ triggerId: trigger.id, rowCount: records.rowCount }, "wf-engine: per_record fan-out fired");
            } else {
              // batched: one run with all rows
              await fireWorkflowForDefinition(
                trigger.definition_id, "schedule", `trigger:${trigger.id}`,
                { records: records.rows as Record<string, unknown>[] },
              );
              log.info({ triggerId: trigger.id, rowCount: records.rowCount }, "wf-engine: batched fan-out fired");
            }
          } catch (err) {
            log.warn({ err, triggerId: trigger.id }, "wf-engine: fan_out_query execution failed (non-fatal)");
          }
        }
      } else {
        const t0 = Date.now();
        const runId = await fireWorkflowForDefinition(
          trigger.definition_id, "schedule", `trigger:${trigger.id}`,
          (trigger.config.payload as Record<string, unknown>) ?? {},
        );
        const durationMs = Date.now() - t0;
        // Record trigger event
        await db.insert(wfTriggerEventsTable).values({
          triggerId: trigger.id,
          runId: runId ?? undefined,
          status: runId ? "fired" : "skipped",
          payload: (trigger.config.payload as Record<string, unknown>) ?? {},
          durationMs,
        }).catch((err: unknown) => { log.warn({ err, triggerId: trigger.id }, "wf-engine: failed to record trigger event (non-fatal)"); });
      }
    }
  } catch (err) {
    log.warn({ err }, "wf-executor: scheduled trigger scan failed (non-fatal)");
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
        log.info(
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

      log.info({ triggerId: trigger.id, definitionId: trigger.definition_id, runId }, "wf-engine: startup trigger fired");
    }

    if (rows.rowCount && rows.rowCount > 0) {
      log.info({ count: rows.rowCount }, "wf-engine: all startup triggers fired");
    }
  } catch (err) {
    log.warn({ err }, "wf-engine: fireStartupTriggers failed (non-fatal)");
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
    log.warn(
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
          log.info({ definitionId: srcDefId, eventType }, "wf-executor: self-loop guard — skipping re-trigger of source definition");
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
        const t0Evt = Date.now();
        const runId = await fireWorkflowForDefinition(trigger.definitionId, "event", `event:${eventType}`, emitPayload);
        const durationMsEvt = Date.now() - t0Evt;
        // Record trigger event for observability
        await db.insert(wfTriggerEventsTable).values({
          triggerId: trigger.id,
          runId: runId ?? undefined,
          status: runId ? "fired" : "skipped",
          payload: emitPayload,
          durationMs: durationMsEvt,
        }).catch((err: unknown) => { log.warn({ err, triggerId: trigger.id }, "wf-engine: failed to record event trigger event (non-fatal)"); });
      }
    }
  } catch (err) {
    log.warn({ err, eventType }, "wf-engine: emitWorkflowEvent failed (non-fatal)");
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
        )).orderBy(desc(wfVersionsTable.versionNumber)).limit(1);
    const version = versionRows[0];
    if (!version) { log.warn({ definitionId, versionId: opts.versionId }, "wf-executor: no version found"); return null; }

    // Fetch definition for concurrency limit
    const defRows = await db.select().from(wfDefinitionsTable).where(eq(wfDefinitionsTable.id, definitionId)).limit(1);
    const def = defRows[0];
    const concurrencyLimit = def?.concurrencyLimit ?? 5;

    // Enforce concurrency BEFORE inserting (prevents noisy failed runs)
    const runningCount = await countRunningRuns(definitionId);
    if (runningCount >= concurrencyLimit) {
      log.warn({ definitionId, runningCount, concurrencyLimit }, "wf-executor: concurrency limit reached — run rejected at admission");
      return null;
    }

    const inserted = await db.insert(wfRunsTable).values({
      versionId: version.id, definitionId, triggerType, triggerRef, payload, status: "pending",
    }).returning({ id: wfRunsTable.id });

    const runId = inserted[0]?.id;
    if (!runId) return null;

    setImmediate(() => {
      executeWorkflowRun(runId, { inputValues: opts.inputValues }).catch(err => {
        log.warn({ err, runId }, "wf-executor: detached run failed (non-fatal)");
      });
    });

    return runId;
  } catch (err) {
    log.warn({ err, definitionId }, "wf-executor: fireWorkflowForDefinition failed (non-fatal)");
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
    log.warn(
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
          log.info({ definitionId: srcDefId, eventName }, "wf-executor: self-loop guard — skipping re-trigger of source definition");
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
      log.info(
        { eventName, triggered: runIds.length, total: matching.length },
        "wf-executor: event dispatched",
      );
    }
    return runIds;
  } catch (err) {
    log.warn({ err, eventName }, "wf-executor: fireWorkflowsForEvent failed (non-fatal)");
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

// ── Safety check: duplicate "published" versions ────────────────────────────
// Under normal operation exactly one wf_versions row per definition should
// ever have status = 'published'. Historically the publish endpoint archived
// the old version and published the new one as two separate non-transactional
// UPDATEs, which left a window where a crash/race could leave two (or zero)
// rows marked "published" for the same definition. That bad state, combined
// with an unordered lookup, is what let a Run Workflow node silently execute
// a stale (e.g. stub) version instead of the latest one.
//
// The publish endpoints now wrap archive+publish in a single db.transaction()
// and every "get published version" lookup orders by versionNumber DESC, so
// new bad state should not occur — but this scans for and repairs any rows
// left over from before that fix (or from any other future non-transactional
// write path) by keeping only the highest versionNumber as "published" and
// archiving the rest. Safe to call repeatedly; a no-op when data is clean.
export async function reconcileDuplicatePublishedVersions(): Promise<void> {
  try {
    const dupRows = await db.execute<{ definition_id: number; published_count: number }>(sql`
      SELECT definition_id, COUNT(*)::int AS published_count
      FROM   wf_versions
      WHERE  status = 'published'
      GROUP  BY definition_id
      HAVING COUNT(*) > 1
    `);

    if (dupRows.rows.length === 0) return;

    log.warn(
      { definitionIds: dupRows.rows.map(r => r.definition_id) },
      "wf-engine: found workflow definitions with more than one published version — auto-resolving to the highest version number",
    );

    for (const row of dupRows.rows) {
      const versions = await db
        .select({ id: wfVersionsTable.id, versionNumber: wfVersionsTable.versionNumber })
        .from(wfVersionsTable)
        .where(and(eq(wfVersionsTable.definitionId, row.definition_id), eq(wfVersionsTable.status, "published")))
        .orderBy(desc(wfVersionsTable.versionNumber));

      const [keep, ...archive] = versions;
      if (!keep || archive.length === 0) continue;

      await db.transaction(async (tx) => {
        await tx
          .update(wfVersionsTable)
          .set({ status: "archived", updatedAt: new Date() })
          .where(inArray(wfVersionsTable.id, archive.map(v => v.id)));
      });

      log.warn(
        { definitionId: row.definition_id, keptVersionId: keep.id, keptVersionNumber: keep.versionNumber, archivedVersionIds: archive.map(v => v.id) },
        "wf-engine: resolved duplicate published versions for definition",
      );
    }
  } catch (err) {
    log.warn({ err }, "wf-engine: duplicate published version reconciliation failed (non-fatal)");
  }
}
