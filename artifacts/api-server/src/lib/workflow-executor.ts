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
  landingPagesTable,
  type WfGraph,
  type WfNode,
} from "@workspace/db";

import { createRunbookJob, isAzureConfigured } from "./azure-automation";
import { sendWebPushToAdmins } from "./web-push";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { eq, and, count } from "drizzle-orm";
import path from "path";
import fs from "fs/promises";
import { logger } from "./logger";
import { handleSystemAction } from "./system-action-handlers";

// Captured once when the module is first loaded. Used by fireStartupTriggers
// to detect runs created in the current boot session vs. orphaned runs from a
// previous boot — so a crash-interrupted startup trigger re-fires on the next
// restart instead of being silently skipped.
const BOOT_TIME = new Date();

// ── Payload interpolation ────────────────────────────────────────────────────
// Replaces {{key}} and {{payload.key}} tokens with values from payload.
function interp(template: string | undefined, payload: Record<string, unknown>): string | undefined {
  if (!template) return undefined;
  return template.replace(/\{\{([\w.]+)\}\}/g, (_match, path: string) => {
    const key = path.startsWith("payload.") ? path.slice(8) : path;
    const parts = key.split(".");
    let cur: unknown = payload;
    for (const part of parts) {
      if (cur == null || typeof cur !== "object") return "";
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur != null ? String(cur) : "";
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

    case "send_campaign_email":
      return {
        dryRun: true,
        templateSlug: str("templateSlug", "unknown-template"),
        recipient: interp((node.data.recipientExpr as string | undefined) ?? "", p) || "recipient@example.com",
        subject: "(template subject — preview in config panel)",
        sent: false,
      };

    case "create_kanban_task":
      return {
        dryRun: true,
        boardId: str("boardId", "marketing"),
        columnId: str("columnId", "backlog"),
        title: interp((node.data.titleExpr as string | undefined) ?? "New task", p) || "New task",
        taskId: null,
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

    case "find_object":
      return { dryRun: true, found: true, objectId: 1, objectType: (node.data.objectType as string | undefined) ?? "lead" };

    case "system_action":
      return { dryRun: true, skipped: true, task: node.data.task ?? "unknown" };

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

    default:
      return { dryRun: true, note: "dry run — node skipped", nodeType: node.type };
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

// ── Node execution ────────────────────────────────────────────────────────────

async function executeNode(
  node: WfNode,
  payload: Record<string, unknown>,
  runId: number,
  dryRun = false,
): Promise<{
  output: Record<string, unknown>;
  nextPayload: Record<string, unknown>;
  cancelRun: boolean;
  nodeError: boolean;
  conditionResult?: boolean;
}> {
  const startMs = Date.now();
  let output: Record<string, unknown> = {};
  let cancelRun = false;
  let nodeError = false;
  let conditionResult: boolean | undefined;

  // Structural nodes always execute normally; everything else is stubbed in dry-run.
  const STRUCTURAL_TYPES = new Set(["start", "end", "condition", "error"]);

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
          const clientIdRaw = interp(node.data.clientId as string | undefined, payload);
          const clientUserId = clientIdRaw ? parseInt(clientIdRaw, 10) : NaN;
          if (isNaN(clientUserId)) {
            nodeError = true;
            output = { error: "generate_document requires a valid clientId" };
          } else {
            const docType = (node.data.docType as string | undefined) ?? "security";
            const docName = interp(node.data.docTitle as string | undefined, payload) ?? `${docType} report`;
            const [doc] = await db.insert(clientDocumentsTable).values({
              clientUserId,
              name: docName,
              category: "reports",
            }).returning();
            output = { documentId: doc.id, docType, name: doc.name };
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

      case "send_campaign_email": {
        const templateSlug = node.data.templateSlug as string | undefined;
        if (!templateSlug) {
          nodeError = true;
          output = { error: "send_campaign_email requires a templateSlug" };
        } else {
          const [tmpl] = await db.select().from(emailTemplatesTable).where(eq(emailTemplatesTable.slug, templateSlug)).limit(1);
          if (!tmpl) {
            nodeError = true;
            output = { error: `Email template '${templateSlug}' not found` };
          } else {
            const recipient = interp(node.data.recipientExpr as string | undefined, payload);
            if (!recipient?.trim()) {
              nodeError = true;
              output = { error: "send_campaign_email: recipient resolved to empty — check recipientExpr" };
            } else {
              // Escape a plain string value for safe insertion into HTML
              function escHtml(s: string): string {
                return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
              }
              // Substitute {{path}} tokens (including dotted paths like {{lead.email}})
              // from the workflow payload into a template string.
              // Values are HTML-escaped before insertion; unresolved tokens are left intact.
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
              const renderedBody = renderTemplate(tmpl.bodyHtml, payload);
              const renderedSubject = renderTemplate(tmpl.subject, payload);
              const { sendEmail, brandedEmail } = await import("./mailer");
              const fullHtml = brandedEmail(renderedBody);
              await sendEmail(recipient, renderedSubject, fullHtml, { skipWrapper: true });
              output = { sent: true, recipient, subject: renderedSubject, templateSlug };
            }
          }
        }
        break;
      }

      case "create_kanban_task": {
        const boardId = node.data.boardId as string | undefined;
        const columnId = node.data.columnId as string | undefined;
        const title = interp(node.data.titleExpr as string | undefined, payload);
        const description = interp(node.data.descriptionExpr as string | undefined, payload);
        const priority = (node.data.priority as string | undefined) ?? "medium";

        if (!boardId || !columnId || !title?.trim()) {
          nodeError = true;
          output = { error: "create_kanban_task requires boardId, columnId, and a non-empty title" };
        } else if (boardId === "marketing") {
          const validStatuses = ["ideas", "in_progress", "scheduled", "published", "completed", "money_task"] as const;
          type MarketingStatus = typeof validStatuses[number];
          const status: MarketingStatus = (validStatuses as readonly string[]).includes(columnId) ? (columnId as MarketingStatus) : "ideas";
          const [task] = await db.insert(marketingTasksTable).values({
            title: title.trim(),
            description: description ?? undefined,
            status,
          }).returning();
          output = { taskId: task.id, boardId, columnId: status, title: task.title };
        } else {
          const projectId = parseInt(boardId, 10);
          if (isNaN(projectId)) {
            nodeError = true;
            output = { error: `create_kanban_task: invalid boardId '${boardId}' — must be 'marketing' or a numeric project ID` };
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
            }).returning();
            output = { taskId: task.id, boardId, columnId: column, title: task.title };
          }
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
          default:
            output = { found: false, objectType: foObjectType, reason: `unsupported objectType: ${foObjectType}` };
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
                  // Step 2: Download source image
                  const imgResp = await fetch(imageUrl);
                  if (imgResp.ok) {
                    const imgBuf = await imgResp.arrayBuffer();
                    const contentType = imgResp.headers.get("content-type") ?? "image/jpeg";

                    // Step 3: Upload binary to LinkedIn
                    await fetch(uploadUrl, {
                      method: "PUT",
                      headers: {
                        "Authorization": `Bearer ${accessToken}`,
                        "Content-Type": contentType,
                      },
                      body: imgBuf,
                    });

                    shareMediaCategory = "IMAGE";
                    mediaItems = [
                      { status: "READY", description: { text: "" }, media: assetUrn, title: { text: "" } },
                    ];
                  }
                }
              }
            } catch (imgErr) {
              // Image upload is best-effort — log and fall back to text-only post
              logger.warn({ err: imgErr, imageUrl }, "post_linkedin: image upload failed, falling back to text-only");
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
            output = { linkedinPostId: postId, linkedinPostUrl };
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

          if (imageUrl) {
            try {
              // Download the source image
              const imgResp = await fetch(imageUrl);
              if (imgResp.ok) {
                const imgBuf = Buffer.from(await imgResp.arrayBuffer());
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
                }
              }
            } catch (imgErr) {
              // Image upload is best-effort — log and fall back to text-only tweet
              logger.warn({ err: imgErr, imageUrl }, "post_twitter: image upload failed, falling back to text-only");
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
            output = { twitterTweetId: tweetId, twitterTweetUrl };
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
          // Photo post: use /{page-id}/photos with url + caption so the image
          // is displayed inline rather than as a link card.
          const resp = await fetch(
            `https://graph.facebook.com/v19.0/${encodeURIComponent(pageId)}/photos`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ url: imageUrl, caption: postBody, access_token: pageAccessToken }),
            },
          );
          if (!resp.ok) {
            nodeError = true;
            const errText = await resp.text().catch(() => "");
            output = { error: `post_facebook: Facebook Graph API error ${resp.status}`, detail: errText.slice(0, 400) };
          } else {
            const json = (await resp.json()) as { id?: string; post_id?: string };
            const rawId = json?.post_id ?? json?.id ?? "unknown";
            const facebookPostUrl = `https://www.facebook.com/${rawId.replace("_", "/posts/")}`;
            output = { facebookPostId: rawId, facebookPostUrl };
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

      default:
        output = { note: "unknown node type", nodeType: node.type };
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

  await db.insert(wfRunNodeLogsTable).values({
    runId,
    nodeId: node.id,
    level: nodeError ? "error" : "info",
    message: nodeError
      ? `Node ${node.type} (${node.id}) failed: ${output.error ?? "error"}`
      : `Node ${node.type} (${node.id}) completed in ${durationMs}ms`,
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

  return { output, nextPayload, cancelRun, nodeError, conditionResult };
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
  opts: { inlineGraph?: WfGraph; dryRun?: boolean } = {},
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

      const { output, nextPayload, cancelRun, nodeError, conditionResult } = await executeNode(node, payload, runId, opts.dryRun ?? false);
      payload = nextPayload;

      await db.update(wfRunsTable).set({ branchPath: branchPath as unknown as string[] }).where(eq(wfRunsTable.id, runId));

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

      // Normal: all outgoing edges are active
      for (const e of graph.edges.filter(edge => edge.source === nodeId)) {
        resolveEdge(e.target, true);
      }
    }

    await db.update(wfRunsTable).set({ status: "completed", finishedAt: new Date(), branchPath: branchPath as unknown as string[] }).where(eq(wfRunsTable.id, runId));
    logger.info({ runId, steps: branchPath.length }, "wf-executor: run completed");
  } catch (err) {
    const errMsg = String(err);
    await db.update(wfRunsTable).set({ status: "failed", finishedAt: new Date(), errorMessage: errMsg, branchPath: branchPath as unknown as string[] }).where(eq(wfRunsTable.id, runId));
    await db.insert(wfRunNodeLogsTable).values({ runId, nodeId: "__executor__", level: "error", message: `Executor error: ${errMsg}` }).catch(() => { });
    logger.warn({ runId, err }, "wf-executor: run failed");
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

// ── Event emitter helper ──────────────────────────────────────────────────────

export async function emitWorkflowEvent(
  eventType: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
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
        await fireWorkflowForDefinition(trigger.definitionId, "event", `event:${eventType}`, { ...payload, _eventType: eventType });
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
  opts: { versionId?: number } = {},
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
      executeWorkflowRun(runId).catch(err => {
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
): Promise<number[]> {
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
        const runId = await fireWorkflowForDefinition(
          t.definitionId,
          "event",
          `event:${eventName}:trigger:${t.id}`,
          { ...payload, eventName },
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
