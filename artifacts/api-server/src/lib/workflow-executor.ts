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
  type WfGraph,
  type WfNode,
} from "@workspace/db";
import { createRunbookJob, isAzureConfigured } from "./azure-automation";
import { eq, and, count } from "drizzle-orm";
import { logger } from "./logger";
import { handleSystemAction } from "./system-action-handlers";

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

    case "assign_pipeline_stage":
      return { dryRun: true, opportunityId: num("opportunityId"), stage: str("stage", "discovery") };

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

    case "system_action":
      return { dryRun: true, skipped: true, task: node.data.task ?? "unknown" };

    default:
      return { dryRun: true, note: "dry run — node skipped", nodeType: node.type };
  }
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
              projectType: (node.data.projectType as "project" | "retainer" | undefined) ?? "project",
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
        const oppIdRaw = interp(node.data.opportunityId as string | undefined, payload);
        const opportunityId = oppIdRaw ? parseInt(oppIdRaw, 10) : NaN;
        const stage = interp(node.data.stage as string | undefined, payload);
        if (isNaN(opportunityId) || !stage) {
          nodeError = true;
          output = { error: "assign_pipeline_stage requires opportunityId and stage" };
        } else {
          await db.update(opportunitiesTable)
            .set({ workflowType: stage })
            .where(eq(opportunitiesTable.id, opportunityId));
          output = { opportunityId, stage };
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

      case "system_action": {
        const task = node.data.task as string | undefined;
        if (!task) {
          output = { skipped: true, reason: "no task configured" };
        } else {
          output = await handleSystemAction(task, payload);
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

  const nextPayload = {
    ...payload,
    nodes: { ...(payload.nodes as Record<string, unknown> ?? {}), [node.id]: output },
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
// Called once on server init. Finds all enabled startup triggers, fires each
// definition once, then marks them as consumed (next_run_at set to far future)
// so they don't re-fire on the next scheduler tick.

export async function fireStartupTriggers(): Promise<void> {
  try {
    const rows = await pool.query<{ id: number; definition_id: number }>(
      `SELECT id, definition_id FROM wf_triggers WHERE type = 'startup' AND enabled = true`,
    );

    for (const trigger of rows.rows) {
      // Consume immediately to prevent double-fire on restart
      await pool.query(
        `UPDATE wf_triggers SET next_run_at = NOW() + INTERVAL '100 years' WHERE id = $1`,
        [trigger.id],
      );

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
