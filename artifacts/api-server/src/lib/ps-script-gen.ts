/**
 * Shared PowerShell script generation helpers.
 *
 * Both the route handler (generate-from-service / generate-from-document)
 * and the workflow executor's `generate_script` node import from here so the
 * canonical AI prompts, parsing helpers, and DB-save logic live in one place.
 */

import { anthropic } from "@workspace/integrations-anthropic-ai";
import { db, pool } from "@workspace/db";
import {
  powershellScriptsTable,
  scriptPackagesTable,
  scriptModulesTable,
  servicesTable,
  workflowTemplatesTable,
  workflowTemplateStepsTable,
  workflowTemplateStepTasksTable,
  insightsGeneratedDocumentsTable,
  type PsScriptPermissions,
} from "@workspace/db";
import { eq, asc, inArray } from "drizzle-orm";
import { getPrompt } from "./prompt-loader.js";
import { logger } from "./logger.js";

// ─── Prompt: generate from service ──────────────────────────────────────────
export const GENERATE_FROM_SERVICE_SYSTEM = `You are an expert Microsoft 365 PowerShell script engineer with 20+ years of experience across Azure, Exchange Online, SharePoint, Teams, Intune, Defender, Entra ID, and related services.

You will receive a consulting service definition and its delivery workflow (phases + tasks).

STEP 1 — CLASSIFY every task as one of THREE categories:

  AUTOMATABLE — runs UNATTENDED inside an Azure Automation Runbook as a service principal (App Registration with client credentials grant). Key constraints:
    ★ APPLICATION PERMISSIONS ONLY — never Delegated permissions. There is no signed-in user; only Microsoft Graph Application permission scopes are valid (e.g. User.Read.All, not User.Read).
    ★ NO interactive login, no licensed user account, no MFA prompt — the script must authenticate entirely via -ClientId / -ClientSecret or a certificate.
    ★ Output via Write-Output ONLY — Azure Automation captures only the output stream. Write-Host, Export-Csv, Out-File, Set-Content are silently lost.
    Eligible operations:
    • Entra ID / Azure AD: user/group/license management, Conditional Access policies, app registrations, directory queries
    • Exchange Online (app-only Graph): mailbox property reads/writes that support Application permissions (Mail.ReadWrite, Calendars.ReadWrite, MailboxSettings.Read)
    • SharePoint provisioning via PnP PowerShell with -ClientId/-ClientSecret (not -Interactive)
    • Intune: device/policy management via Graph Application permissions
    • Azure resources: provisioning, querying, RBAC via service principal
    • Defender/Purview/Sensitivity Labels/DLP/Retention policies via Graph Application permissions
    • Reporting and data export via Graph Application permissions

  USER_ACCOUNT_REQUIRED — can be scripted in PowerShell but REQUIRES a real licensed user account (delegated/interactive auth). CANNOT run as a service principal or Azure Automation runbook. Use this category for:
    • ALL mailbox migration tasks: New-MigrationBatch, Start-MigrationBatch, etc.
    • ALL Connect-MicrosoftTeams operations
    • Connect-ExchangeOnline without -AppId/-CertificateThumbprint
    • Connect-PnPOnline -Interactive
    • Connect-MgGraph -Scopes
    • Any Graph scope that lists as "Delegated only" with no Application equivalent in Microsoft docs
    • RULE: If uncertain whether a scope supports app-only auth, classify it USER_ACCOUNT_REQUIRED.

  HUMAN_ONLY — cannot be scripted at all:
    • Client calls, kickoff meetings, status updates, emails, document review
    • Business decisions, approvals, sign-off, risk acceptance

STEP 2 — For every scriptable task write a complete production-ready PowerShell script.
  For AUTOMATABLE tasks: app-only auth (-ClientId/-TenantId/-ClientSecret), Write-Output only.
  For USER_ACCOUNT_REQUIRED: interactive auth (Connect-MgGraph -Scopes, etc.), Write-Host acceptable.
  Both: [CmdletBinding()], typed param(), $ErrorActionPreference = "Stop", try/catch/finally.

STEP 3 — Choose output shape based on NUMBER OF SCRIPTABLE TASKS:
  • NO scriptable tasks → type "human-only"
  • EXACTLY ONE scriptable AND AUTOMATABLE → type "single"
  • TWO OR MORE all AUTOMATABLE → type "package" (one script per task)
  • ANY USER_ACCOUNT_REQUIRED → type "manual" (one consolidated interactive script)

Output format:
1. Start with \`\`\`json fence containing ONLY metadata.
2. After closing \`\`\`, each script in its own \`\`\`powershell fence.
3. First line of every powershell fence MUST be: # file: <filename.ps1>
4. No prose outside fences.

Human-only shape:
\`\`\`json
{ "type": "human-only", "title": "...", "explanation": "...", "humanOnlyTasks": ["..."] }
\`\`\`

Single script shape:
\`\`\`json
{ "type": "single", "title": "...", "humanOnlyTasks": [], "permissions": { "appPermissions": ["..."], "delegatedPermissions": [], "notes": "..." } }
\`\`\`
\`\`\`powershell
# file: script.ps1
...
\`\`\`

Package shape:
\`\`\`json
{ "type": "package", "title": "...", "modules": [{ "filename": "01-Task.ps1", "description": "..." }], "humanOnlyTasks": [], "permissions": { "appPermissions": ["..."], "delegatedPermissions": [], "notes": "..." } }
\`\`\`
\`\`\`powershell
# file: 01-Task.ps1
...
\`\`\`

Manual shape:
\`\`\`json
{ "type": "manual", "title": "...", "humanOnlyTasks": [], "permissions": { "appPermissions": [], "delegatedPermissions": ["..."], "notes": "Run as licensed M365 admin." } }
\`\`\`
\`\`\`powershell
# file: script.ps1
...
\`\`\``;

// ─── Prompt: generate from document ──────────────────────────────────────────
export const GENERATE_FROM_DOCUMENT_SYSTEM = `You are an expert Microsoft 365 PowerShell script engineer. You will receive the text of a consulting deliverable (assessment report, statement of work, remediation plan, or similar). Your job is to extract every actionable technical task from the document and write complete, production-ready PowerShell scripts to execute them.

EXECUTION CONTEXT — LOCAL ADMIN SESSION:
- Scripts run locally under a licensed Microsoft 365 admin user account with the necessary admin roles already assigned.
- Use interactive / delegated authentication: Connect-MgGraph -Scopes, Connect-ExchangeOnline, Connect-PnPOnline -Interactive, Connect-MicrosoftTeams, Connect-AzAccount, etc.
- You MAY use any cmdlet including those that require a real user account.
- Write-Host, Export-Csv, Out-File are all fine — the script runs in a local PowerShell session.

CODING STANDARDS:
- [CmdletBinding()] attribute + typed param() block with documented parameters.
- $ErrorActionPreference = "Stop" at the top.
- try/catch/finally blocks with descriptive Write-Error messages.
- Connect statements at the top of each script; Disconnect in the finally block.
- Skip tasks that are purely human (meetings, approvals, document review) — add # HUMAN TASK comment.

After all PowerShell code, append a \`\`\`json block with this shape:
{
  "appPermissions": [],
  "delegatedPermissions": ["scope1", "scope2"],
  "notes": "Run as a licensed M365 admin. Required admin roles: ..."
}`;

// ─── Shared parsing helpers ───────────────────────────────────────────────────

export function normalizeAppPerms(raw: unknown[]): { scope: string; reason: string }[] {
  return raw
    .map((entry): { scope: string; reason: string } | null => {
      if (typeof entry === "string") return { scope: entry, reason: "" };
      if (entry !== null && typeof entry === "object") {
        const e = entry as Record<string, unknown>;
        return { scope: String(e["scope"] ?? ""), reason: String(e["reason"] ?? "") };
      }
      return null;
    })
    .filter((e): e is { scope: string; reason: string } => e !== null && e.scope !== "");
}

// LLMs sometimes emit literal (unescaped) newlines / tabs inside JSON string
// values, making the payload invalid JSON. Walk the raw text and escape any
// control characters that appear inside a string token.
function repairJsonStrings(raw: string): string {
  let out = "";
  let inStr = false;
  let esc = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (esc) { out += ch; esc = false; continue; }
    if (ch === "\\") { out += ch; esc = true; continue; }
    if (ch === '"') { out += ch; inStr = !inStr; continue; }
    if (inStr) {
      if (ch === "\n") { out += "\\n"; continue; }
      if (ch === "\r") { out += "\\r"; continue; }
      if (ch === "\t") { out += "\\t"; continue; }
    }
    out += ch;
  }
  return out;
}

// Try JSON.parse; if it fails, repair control-char escaping and retry.
export function jsonParse(candidate: string): unknown {
  try { return JSON.parse(candidate); } catch { /* fall through */ }
  try { return JSON.parse(repairJsonStrings(candidate)); } catch { /* fall through */ }
  return null;
}

// Extract the first ```json fence only (envelope has no embedded code).
export function extractEnvelopeJson(text: string): unknown {
  const jsonTagPos = text.indexOf("```json");
  if (jsonTagPos === -1) return null;
  const bodyStart = jsonTagPos + 7;
  const afterNewline = text[bodyStart] === "\n" ? bodyStart + 1 : bodyStart;
  const closingPos = text.indexOf("```", afterNewline);
  if (closingPos <= afterNewline) return null;
  return jsonParse(text.slice(afterNewline, closingPos).trim());
}

// More robust extractor for multi-section responses: tries fenced JSON, then
// any fenced block, then bare {…} — matching the existing route behaviour.
export function extractJson(text: string): unknown {
  const jsonTagPos = text.indexOf("```json");
  if (jsonTagPos !== -1) {
    const bodyStart = jsonTagPos + 7;
    const afterNewline = text[bodyStart] === "\n" ? bodyStart + 1 : bodyStart;
    const closingPos = text.lastIndexOf("```");
    if (closingPos > afterNewline) {
      const v = jsonParse(text.slice(afterNewline, closingPos).trim());
      if (v !== null && typeof v === "object" && !Array.isArray(v)) return v;
    }
  }
  const anyOpen = text.indexOf("```");
  if (anyOpen !== -1) {
    const afterTag = text.indexOf("\n", anyOpen);
    const closingPos = text.lastIndexOf("```");
    if (afterTag !== -1 && closingPos > afterTag) {
      const v = jsonParse(text.slice(afterTag + 1, closingPos).trim());
      if (v !== null && typeof v === "object" && !Array.isArray(v)) return v;
    }
  }
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const v = jsonParse(text.slice(start, end + 1));
    if (v !== null && typeof v === "object" && !Array.isArray(v)) return v;
  }
  return null;
}

export function extractJsonArray(text: string): unknown[] | null {
  const jsonTagPos = text.indexOf("```json");
  if (jsonTagPos !== -1) {
    const bodyStart = jsonTagPos + 7;
    const afterNewline = text[bodyStart] === "\n" ? bodyStart + 1 : bodyStart;
    const closingPos = text.lastIndexOf("```");
    if (closingPos > afterNewline) {
      const v = jsonParse(text.slice(afterNewline, closingPos).trim());
      if (Array.isArray(v)) return v;
    }
  }
  const anyOpen = text.indexOf("```");
  if (anyOpen !== -1) {
    const afterTag = text.indexOf("\n", anyOpen);
    const closingPos = text.lastIndexOf("```");
    if (afterTag !== -1 && closingPos > afterTag) {
      const v = jsonParse(text.slice(afterTag + 1, closingPos).trim());
      if (Array.isArray(v)) return v;
    }
  }
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end > start) {
    const v = jsonParse(text.slice(start, end + 1));
    if (Array.isArray(v)) return v;
  }
  return null;
}

export function extractPowershellFences(text: string): Map<string, string> {
  const scripts = new Map<string, string>();
  const lowerText = text.toLowerCase();
  let searchFrom = 0;
  let fallbackIdx = 0;
  while (true) {
    let openPos = -1;
    for (const marker of ["```powershell", "```ps1", "```ps\n", "```ps\r"]) {
      const pos = lowerText.indexOf(marker, searchFrom);
      if (pos !== -1 && (openPos === -1 || pos < openPos)) openPos = pos;
    }
    if (openPos === -1) break;
    const afterOpen = text.indexOf("\n", openPos);
    if (afterOpen === -1) break;
    const closePos = text.indexOf("```", afterOpen + 1);
    if (closePos === -1) break;
    const content = text.slice(afterOpen + 1, closePos).trimEnd();
    if (content) {
      const headerMatch = content.match(/^#\s*file:\s*(\S+\.ps1)/i);
      scripts.set(headerMatch ? headerMatch[1] : `_script_${fallbackIdx++}`, content);
    }
    searchFrom = closePos + 3;
  }
  return scripts;
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s{2,}/g, " ").trim();
}

const PS_KEYWORD_RE = /Param|function|#requires|\$|Write-|Get-|Set-|New-|Remove-/i;

// ─── generateScriptFromService ────────────────────────────────────────────────
/**
 * Generate a PowerShell script (or package) from a service record using the
 * canonical `ps-engineer-from-service` system prompt. Saves with `category`
 * (defaults to `"workflow-generated"`) and returns the saved IDs.
 */
export async function generateScriptFromService(
  serviceId: number,
  opts: { customInstructions?: string; category?: string } = {},
): Promise<{ scriptId: string | null; packageId: string | null; title: string }> {
  const category = opts.category ?? "workflow-generated";

  const [service] = await db
    .select()
    .from(servicesTable)
    .where(eq(servicesTable.id, serviceId))
    .limit(1);
  if (!service) throw new Error(`Service ${serviceId} not found`);

  // Build workflow context if the service has a workflow template
  let workflowContext = "";
  if (service.workflowTemplateId) {
    const [template] = await db
      .select()
      .from(workflowTemplatesTable)
      .where(eq(workflowTemplatesTable.id, service.workflowTemplateId))
      .limit(1);
    if (template) {
      const steps = await db
        .select()
        .from(workflowTemplateStepsTable)
        .where(eq(workflowTemplateStepsTable.workflowTemplateId, template.id))
        .orderBy(asc(workflowTemplateStepsTable.order));
      const stepIds = steps.map((s) => s.id);
      const allTasks =
        stepIds.length > 0
          ? await db
              .select()
              .from(workflowTemplateStepTasksTable)
              .where(inArray(workflowTemplateStepTasksTable.workflowTemplateStepId, stepIds))
              .orderBy(asc(workflowTemplateStepTasksTable.order))
          : [];

      workflowContext = `\n\nWORKFLOW TEMPLATE: "${template.name}"`;
      if (template.description) workflowContext += `\n${template.description}`;
      for (const step of steps) {
        const tasks = allTasks.filter((t) => t.workflowTemplateStepId === step.id);
        workflowContext += `\n\nPhase: ${step.title}`;
        if (step.description) workflowContext += `\n  ${step.description}`;
        for (const task of tasks) {
          workflowContext += `\n  - [TASK] ${task.title}`;
          if (task.taskType) workflowContext += ` [type: ${task.taskType}]`;
          if (task.description) workflowContext += `\n    Description: ${task.description}`;
        }
      }
    }
  }

  const deliverables = Array.isArray(service.deliverables) ? (service.deliverables as string[]) : [];
  const inclusions = Array.isArray(service.inclusions) ? (service.inclusions as string[]) : [];
  const features = Array.isArray(service.features) ? (service.features as string[]) : [];

  let serviceContext = `SERVICE: ${service.name}`;
  if (service.description) serviceContext += `\nDescription: ${service.description}`;
  if (service.category) serviceContext += `\nCategory: ${service.category}`;
  if (service.tagline) serviceContext += `\nTagline: ${service.tagline}`;
  if (deliverables.length > 0)
    serviceContext += `\nDeliverables:\n${deliverables.map((d) => `  - ${d}`).join("\n")}`;
  if (inclusions.length > 0)
    serviceContext += `\nInclusions:\n${inclusions.map((i) => `  - ${i}`).join("\n")}`;
  if (features.length > 0)
    serviceContext += `\nFeatures:\n${features.map((f) => `  - ${f}`).join("\n")}`;

  const customBlock = opts.customInstructions?.trim()
    ? `\n\nAdditional instructions:\n${opts.customInstructions.trim()}`
    : "";

  const userMessage = `${serviceContext}${workflowContext}${customBlock}

Classify each task and generate PowerShell automation scripts for all M365/Azure-automatable tasks. If no tasks can be automated, return the human-only shape. Return the JSON response exactly as instructed.`;

  const systemPrompt = await getPrompt("ps-engineer-from-service", GENERATE_FROM_SERVICE_SYSTEM);

  const resp = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 16000,
    messages: [{ role: "user", content: `${systemPrompt}\n\n${userMessage}` }],
  });

  const fullText = resp.content.filter((b) => b.type === "text").map((b) => (b as { type: "text"; text: string }).text).join("");

  const envelope = extractJson(fullText);
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new Error("generate_script: AI did not return a valid JSON envelope — try again");
  }
  const env = envelope as Record<string, unknown>;
  const envType = String(env["type"] ?? "");

  if (envType === "human-only") {
    throw new Error("generate_script: service has no automatable tasks — all tasks require human action");
  }

  const psMap = extractPowershellFences(fullText);
  if (psMap.size === 0) {
    throw new Error("generate_script: AI returned no PowerShell code — try again");
  }

  const rawPerms = env["permissions"] as Record<string, unknown> | undefined;
  const permissions: PsScriptPermissions = {
    appPermissions: Array.isArray(rawPerms?.["appPermissions"]) ? normalizeAppPerms(rawPerms["appPermissions"] as unknown[]) : [],
    delegatedPermissions: Array.isArray(rawPerms?.["delegatedPermissions"]) ? (rawPerms["delegatedPermissions"] as string[]) : [],
    notes: typeof rawPerms?.["notes"] === "string" ? rawPerms["notes"] : "",
  };

  const packageTitle = String(env["title"] ?? `${service.name} — Workflow Generated`);

  if (envType === "package" && psMap.size > 1) {
    const [pkg] = await db
      .insert(scriptPackagesTable)
      .values({ title: packageTitle, category, permissions, tags: ["workflow-generated"] })
      .returning({ id: scriptPackagesTable.id });

    const modRows: { packageId: string; filename: string; description: string | null; content: string; sortOrder: number }[] = [];
    let i = 0;
    for (const [filename, content] of psMap) {
      if (!PS_KEYWORD_RE.test(content)) continue;
      const modules = env["modules"] as Array<{ filename: string; description?: string }> | undefined;
      const meta = modules?.find((m) => m.filename === filename);
      modRows.push({ packageId: pkg!.id, filename, description: meta?.description ?? null, content, sortOrder: i++ });
    }
    if (modRows.length === 0) {
      throw new Error("generate_script: no valid PowerShell modules found in AI response");
    }
    await db.insert(scriptModulesTable).values(modRows);
    logger.info({ packageId: pkg!.id, moduleCount: modRows.length, service: service.name }, "ps-script-gen: saved package");
    return { scriptId: null, packageId: pkg!.id, title: packageTitle };
  }

  // single or manual — use the first (largest) script
  const [[, scriptBody]] = [...psMap.entries()];
  if (!scriptBody || !PS_KEYWORD_RE.test(scriptBody)) {
    throw new Error("generate_script: AI returned prose instead of a PowerShell script — try again");
  }
  const scriptTitle = String(env["title"] ?? `${service.name} — Workflow Generated`);
  const [saved] = await db
    .insert(powershellScriptsTable)
    .values({
      title: scriptTitle,
      description: `Auto-generated from service "${service.name}" by a workflow run.`,
      category,
      scriptBody,
      permissions,
      tags: ["workflow-generated", service.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")],
    })
    .returning({ id: powershellScriptsTable.id });

  logger.info({ scriptId: saved!.id, service: service.name }, "ps-script-gen: saved single script");
  return { scriptId: saved!.id, packageId: null, title: scriptTitle };
}

// ─── generateScriptFromDocument ───────────────────────────────────────────────
/**
 * Generate a PowerShell script from an insights document using the canonical
 * `ps-engineer-from-document` system prompt. Saves with `category`
 * (defaults to `"workflow-generated"`) and returns the saved IDs.
 */
export async function generateScriptFromDocument(
  documentId: number,
  opts: { customInstructions?: string; category?: string } = {},
): Promise<{ scriptId: string | null; packageId: string | null; title: string }> {
  const category = opts.category ?? "workflow-generated";

  const [doc] = await db
    .select({ id: insightsGeneratedDocumentsTable.id, title: insightsGeneratedDocumentsTable.title, htmlContent: insightsGeneratedDocumentsTable.htmlContent })
    .from(insightsGeneratedDocumentsTable)
    .where(eq(insightsGeneratedDocumentsTable.id, documentId))
    .limit(1);
  if (!doc) throw new Error(`Document ${documentId} not found`);

  const plainText = stripHtml(doc.htmlContent);
  if (plainText.length < 50) throw new Error("Document has no readable content");

  const customBlock = opts.customInstructions?.trim()
    ? `\n\nAdditional instructions:\n${opts.customInstructions.trim()}`
    : "";

  const systemPrompt = await getPrompt("ps-engineer-from-document", GENERATE_FROM_DOCUMENT_SYSTEM);

  const resp = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 16000,
    messages: [
      {
        role: "user",
        content: `${systemPrompt}${customBlock}\n\nDocument title: ${doc.title ?? "Untitled"}\n\nDocument content:\n${plainText.slice(0, 24000)}\n\nWrite complete PowerShell scripts followed by the permissions JSON block.`,
      },
    ],
  });

  const fullText = resp.content.filter((b) => b.type === "text").map((b) => (b as { type: "text"; text: string }).text).join("");

  // Document mode: find the ```json perms block at the end + powershell fences
  const jsonFenceIdx = fullText.search(/```json/i);
  let scriptBody: string;
  if (jsonFenceIdx > 0) {
    scriptBody = fullText.slice(0, jsonFenceIdx)
      .replace(/```powershell\s*/i, "").replace(/```\s*$/, "").trim();
  } else {
    scriptBody = fullText.replace(/```(?:powershell)?\s*/gi, "").replace(/```\s*/g, "").trim();
  }
  if (scriptBody.length < 20) {
    scriptBody = fullText.replace(/```json[\s\S]*?```/gi, "")
      .replace(/```powershell\s*/gi, "").replace(/```\s*$/gm, "").trim();
  }

  if (!PS_KEYWORD_RE.test(scriptBody)) {
    throw new Error("generate_script: AI returned prose instead of a PowerShell script — try again");
  }

  // Parse trailing permissions JSON block
  let permissions: PsScriptPermissions = { appPermissions: [], delegatedPermissions: [], notes: "" };
  const trailingJson = extractEnvelopeJson(fullText);
  if (trailingJson && typeof trailingJson === "object" && !Array.isArray(trailingJson)) {
    const raw = trailingJson as Record<string, unknown>;
    permissions = {
      appPermissions: Array.isArray(raw["appPermissions"]) ? normalizeAppPerms(raw["appPermissions"] as unknown[]) : [],
      delegatedPermissions: Array.isArray(raw["delegatedPermissions"]) ? (raw["delegatedPermissions"] as string[]) : [],
      notes: typeof raw["notes"] === "string" ? raw["notes"] : "",
    };
  }

  const scriptTitle = `${doc.title ?? "Document"} — Workflow Generated`;
  const [saved] = await db
    .insert(powershellScriptsTable)
    .values({
      title: scriptTitle,
      description: `Auto-generated from insights document "${doc.title ?? documentId}" by a workflow run.`,
      category,
      scriptBody,
      permissions,
      tags: ["workflow-generated", "from-document"],
    })
    .returning({ id: powershellScriptsTable.id });

  logger.info({ scriptId: saved!.id, documentId }, "ps-script-gen: saved script from document");
  return { scriptId: saved!.id, packageId: null, title: scriptTitle };
}
