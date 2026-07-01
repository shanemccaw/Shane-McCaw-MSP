import { Router, type Request, type Response } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { db, pool } from "@workspace/db";
import {
  powershellScriptsTable,
  scriptPackagesTable,
  scriptModulesTable,
  serviceScriptSetsTable,
  servicesTable,
  workflowTemplatesTable,
  workflowTemplateStepsTable,
  workflowTemplateStepTasksTable,
  kanbanTasksTable,
  clientServicesTable,
  scriptRunResultsTable,
  type PsScriptPermissions,
  type ScriptModule,
} from "@workspace/db";
import { eq, desc, asc, inArray, and, sql, isNotNull } from "drizzle-orm";
import { logger } from "../lib/logger.ts";
import { hasPsKeywordsFullText } from "../lib/ps-guard.ts";
import { isAzureConfigured, pushScriptToAzure } from "../lib/azure-automation.ts";
import { getPrompt } from "../lib/prompt-loader.ts";

// ─── Runbook name helpers ─────────────────────────────────────────────────────

function titleToRunbookName(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63) || "script";
}

/** Derives the Azure Automation runbook name from a module filename.
 *  Strips the .ps1 extension then applies the same sanitization as
 *  titleToRunbookName — numeric sort prefixes (e.g. "01-") are KEPT so
 *  the name matches what the push-to-azure endpoints register in Azure.
 */
function filenameToRunbookName(filename: string): string {
  return titleToRunbookName(filename.replace(/\.ps1$/i, ""));
}

async function tryPushPsScriptToAzure(scriptId: string, runbookName: string, psCode: string): Promise<void> {
  if (!isAzureConfigured()) {
    logger.warn({ scriptId }, "admin-ps-scripts: Azure not configured — skipping push to Azure Automation");
    return;
  }
  try {
    await pushScriptToAzure(runbookName, psCode);
    await db
      .update(powershellScriptsTable)
      .set({ azureSyncedAt: new Date() })
      .where(eq(powershellScriptsTable.id, scriptId));
    logger.info({ scriptId, runbookName }, "admin-ps-scripts: pushed to Azure Automation and stamped azureSyncedAt");
  } catch (err) {
    logger.warn({ err, scriptId, runbookName }, "admin-ps-scripts: push to Azure failed (non-fatal)");
  }
}

const router = Router();

// ─── Script-task Kanban association helpers ───────────────────────────────────

function titleToWords(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/\.ps1$/i, "")
      .replace(/^\d+-/, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(" ")
      .filter((w) => w.length > 2),
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function findBestModuleForTask(
  taskTitle: string,
  modules: Array<{ filename: string; description: string | null; content: string }>,
): { module: (typeof modules)[0]; score: number } | null {
  if (modules.length === 0) return null;
  const taskWords = titleToWords(taskTitle);
  let best: { module: (typeof modules)[0]; score: number } = { module: modules[0]!, score: -1 };
  for (const mod of modules) {
    const modWords = titleToWords(mod.filename);
    const score = jaccardSimilarity(taskWords, modWords);
    if (score > best.score) best = { module: mod, score };
  }
  return best;
}

function makeStubModule(
  taskTitle: string,
  index: number,
): { filename: string; description: string | null; content: string } {
  const slug = taskTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "script";
  const filename = `${String(index).padStart(2, "0")}-${slug}-stub.ps1`;
  const content = `# file: ${filename}
# ─── STUB MODULE ────────────────────────────────────────────────────────────
# This stub was added automatically because the AI did not produce a dedicated
# module for this task. Implement the PowerShell logic below before running.
# Task: ${taskTitle}
# ─────────────────────────────────────────────────────────────────────────────
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$TenantId,

    [Parameter(Mandatory = $true)]
    [string]$ClientId,

    [Parameter(Mandatory = $true)]
    [string]$ClientSecret
)

$ErrorActionPreference = "Stop"

try {
    # TODO: Implement automation for: ${taskTitle}
    Write-Output "Stub module for: ${taskTitle}"
    Write-Output "Replace this placeholder with the real PowerShell logic."
} catch {
    Write-Error "Error in '${taskTitle}' stub: \$_"
}`;
  return { filename, description: `[STUB] ${taskTitle} — requires implementation`, content };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
function jsonParse(candidate: string): unknown {
  try { return JSON.parse(candidate); } catch { /* fall through */ }
  try { return JSON.parse(repairJsonStrings(candidate)); } catch { /* fall through */ }
  return null;
}

// Extract the first ```json fence only (envelope has no embedded code — no lastIndexOf needed).
function extractEnvelopeJson(text: string): unknown {
  const jsonTagPos = text.indexOf("```json");
  if (jsonTagPos === -1) return null;
  const bodyStart = jsonTagPos + 7;
  const afterNewline = text[bodyStart] === "\n" ? bodyStart + 1 : bodyStart;
  const closingPos = text.indexOf("```", afterNewline); // first close fence, not last
  if (closingPos <= afterNewline) return null;
  return jsonParse(text.slice(afterNewline, closingPos).trim());
}

// Extract all PowerShell code fences from text, keyed by the leading "# file: <filename>" comment.
// Falls back to a numeric index key when the header is absent so callers can always use
// [...psMap.values()][0] as a reliable fallback.
// Recognises ```powershell, ```PowerShell, ```ps1, and ```ps (case-insensitive).
function extractPowershellFences(text: string): Map<string, string> {
  const scripts = new Map<string, string>();
  const lowerText = text.toLowerCase();
  let searchFrom = 0;
  let fallbackIdx = 0;
  while (true) {
    // Find the earliest occurrence of any recognised fence marker
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
      // Always store — use the declared filename or a numeric fallback key
      scripts.set(headerMatch ? headerMatch[1] : `_script_${fallbackIdx++}`, content);
    }
    searchFrom = closePos + 3;
  }
  return scripts;
}

function extractJson(text: string): unknown {
  // 1. ```json … ``` — use indexOf/lastIndexOf so embedded backtick sequences
  //    inside module content strings don't prematurely terminate the match.
  const jsonTagPos = text.indexOf("```json");
  if (jsonTagPos !== -1) {
    const bodyStart = jsonTagPos + 7; // skip "```json"
    const afterNewline = text[bodyStart] === "\n" ? bodyStart + 1 : bodyStart;
    const closingPos = text.lastIndexOf("```");
    if (closingPos > afterNewline) {
      const v = jsonParse(text.slice(afterNewline, closingPos).trim());
      if (v !== null && typeof v === "object" && !Array.isArray(v)) return v;
    }
  }

  // 2. Any fenced block (no language tag): first opening to LAST closing.
  const anyOpen = text.indexOf("```");
  if (anyOpen !== -1) {
    const afterTag = text.indexOf("\n", anyOpen);
    const closingPos = text.lastIndexOf("```");
    if (afterTag !== -1 && closingPos > afterTag) {
      const v = jsonParse(text.slice(afterTag + 1, closingPos).trim());
      if (v !== null && typeof v === "object" && !Array.isArray(v)) return v;
    }
  }

  // 3. Last-resort: first '{' to last '}'.
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const v = jsonParse(text.slice(start, end + 1));
    if (v !== null && typeof v === "object" && !Array.isArray(v)) return v;
  }

  return null;
}

function extractJsonArray(text: string): unknown[] | null {
  // Use indexOf/lastIndexOf so embedded backtick sequences inside content strings
  // don't prematurely terminate the fence match.
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

const CATEGORY_LABELS: Record<string, string> = {
  "m365": "Microsoft 365 (General)",
  "azure": "Azure",
  "exchange": "Exchange Online",
  "sharepoint": "SharePoint",
  "teams": "Microsoft Teams",
  "onedrive": "OneDrive",
  "entra-id": "Entra ID (Azure AD)",
  "intune": "Intune",
  "defender": "Defender",
  "purview": "Purview",
  "dlp": "DLP",
  "sensitivity-labels": "Sensitivity Labels",
  "compliance": "Compliance Center",
  "power-platform": "Power Platform",
  "power-automate": "Power Automate",
  "power-apps": "Power Apps",
  "viva": "Viva",
  "security": "Security & Compliance",
  "other": "Other",
};

const SYSTEM_PROMPT = `You are an expert Microsoft 365 PowerShell script engineer with 20+ years of experience across Azure, Exchange Online, SharePoint, Teams, Intune, Defender, and related services.

When asked to produce a PowerShell script, you MUST:

1. Write a complete, production-ready script with:
   - [CmdletBinding()] attribute
   - A param() block with typed, documented parameters (include -TenantId, -ClientId, -ClientSecret where applicable)
   - Structured error handling via try/catch/finally blocks
   - Write-Output (NOT Write-Host) for all console output — Write-Host bypasses the pipeline and cannot be captured; Write-Error and Write-Warning are acceptable for error/warning streams
   - Inline comments explaining each logical section
   - Clear output (export to CSV where applicable, structured objects, or console summary)
   - $ErrorActionPreference = "Stop" at the top

IMPORTANT: Never use Write-Host. Always use Write-Output for any status messages or console output.

2. After the script, output a JSON block (inside a \`\`\`json fence) with the EXACT Microsoft Graph API application permissions, Exchange Management roles, SharePoint app permissions, or other service permissions required. Use this exact shape:
{
  "appPermissions": ["<e.g. User.Read.All (Microsoft Graph Application)>"],
  "delegatedPermissions": ["<e.g. User.ReadBasic.All (Microsoft Graph Delegated)>"],
  "notes": "<Brief note about which permissions are required vs optional and any tenant admin consent requirements>"
}

Rules:
- Be specific about permission scopes (e.g. "Group.Read.All (Microsoft Graph Application)" not just "Group.Read.All")
- Distinguish Application permissions (used with service principal / app-only) from Delegated (used with signed-in user)
- If the script uses the Graph API, specify Graph permissions; if Exchange Online cmdlets, specify Exchange Management roles
- If no delegated permissions are needed, set delegatedPermissions to []
- The notes field should mention tenant admin consent requirements and whether MFA-capable accounts are needed`;

// ─── POST /api/admin/ps-scripts/generate ─────────────────────────────────────

router.post("/admin/ps-scripts/generate", requireAdmin, async (req: Request, res: Response) => {
  const { prompt, category, baseInstructions, detailedInstructions } = req.body as {
    prompt?: string;
    category?: string;
    baseInstructions?: string;
    detailedInstructions?: string;
  };
  if (!prompt || typeof prompt !== "string" || prompt.trim().length < 5) {
    res.status(400).json({ error: "prompt is required (min 5 characters)" });
    return;
  }

  const categoryLabel = category ? (CATEGORY_LABELS[category] ?? category) : "Microsoft 365";

  const baseBlock = baseInstructions?.trim()
    ? `\n\nBase instructions (always apply):\n${baseInstructions.trim()}`
    : "";
  const detailedBlock = detailedInstructions?.trim()
    ? `\n\nAdditional instructions for this generation:\n${detailedInstructions.trim()}`
    : "";

  const systemPrompt = await getPrompt("ps-engineer-system", SYSTEM_PROMPT);

  // ── Switch to SSE streaming mode ─────────────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sendSSE = (event: Record<string, unknown>): void => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const sendError = (message: string, aiResponse?: string): void => {
    sendSSE({ type: "error", message, ...(aiResponse !== undefined ? { aiResponse } : {}) });
    res.end();
  };

  sendSSE({ type: "phase", label: "Sending prompt to Claude…", pct: 5 });

  try {
    const stream = anthropic.messages.stream({
      model: "claude-haiku-4-5",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: `${systemPrompt}${baseBlock}${detailedBlock}

Category: ${categoryLabel}

Task description: ${prompt.trim()}

Write the complete PowerShell script followed by the permissions JSON block.`,
        },
      ],
    });

    let accumulated = "";
    const EXPECTED_CHARS = 28_000;
    let lastEmittedPct = 5;
    let firstChunk = true;

    stream.on("text", (text: string) => {
      if (firstChunk) {
        firstChunk = false;
        sendSSE({ type: "phase", label: "Claude is writing the PowerShell script…", pct: 20 });
        lastEmittedPct = 20;
      }
      accumulated += text;
      const rawPct = 20 + (accumulated.length / EXPECTED_CHARS) * 60;
      const pct = Math.min(80, Math.round(rawPct));
      if (pct >= lastEmittedPct + 3) {
        lastEmittedPct = pct;
        sendSSE({ type: "progress", pct });
      }
    });

    await stream.finalMessage();

    sendSSE({ type: "phase", label: "Parsing permissions and metadata…", pct: 90 });

    const fullText = accumulated;

    // Extract the script body — everything before the ```json block
    const jsonFenceIdx = fullText.search(/```json/i);
    let scriptBody = jsonFenceIdx > 0
      ? fullText.slice(0, jsonFenceIdx).replace(/```powershell\s*/i, "").replace(/```\s*$/, "").trim()
      : fullText.replace(/```(?:powershell)?\s*/gi, "").replace(/```\s*/g, "").trim();

    if (scriptBody.length < 20) {
      logger.warn(
        { rawResponsePrefix: fullText.slice(0, 500) },
        "generate endpoint: scriptBody extraction yielded empty/short result; applying safe fallback",
      );
      // Safe fallback: return the full text stripped of the JSON block and fences
      const jsonBlockRe = /```json[\s\S]*?```/gi;
      scriptBody = fullText
        .replace(jsonBlockRe, "")
        .replace(/```powershell\s*/gi, "")
        .replace(/```\s*$/gm, "")
        .trim();
    }

    // Heuristic guard: if the full text contains no recognisable PowerShell keyword,
    // the AI returned only prose (scripts may open with long comment blocks so a
    // character-window check would give false positives). Emit SSE error so the editor
    // is never overwritten with non-PS text.
    if (!hasPsKeywordsFullText(scriptBody)) {
      logger.error(
        { scriptBodyPrefix: scriptBody.slice(0, 300) },
        "generate endpoint: fallback result contains no PS keywords — AI returned prose only; refusing to send to client",
      );
      sendError("AI returned a summary instead of a script. Please try again.", scriptBody.slice(0, 3000));
      return;
    }

    // Extract permissions JSON
    const rawPermissions = extractJson(fullText);
    let permissions: PsScriptPermissions = { appPermissions: [], delegatedPermissions: [], notes: "" };
    if (rawPermissions && typeof rawPermissions === "object" && !Array.isArray(rawPermissions)) {
      const p = rawPermissions as Record<string, unknown>;
      permissions = {
        appPermissions: Array.isArray(p["appPermissions"]) ? (p["appPermissions"] as string[]) : [],
        delegatedPermissions: Array.isArray(p["delegatedPermissions"]) ? (p["delegatedPermissions"] as string[]) : [],
        notes: typeof p["notes"] === "string" ? p["notes"] : "",
      };
    }

    sendSSE({ type: "done", payload: { script: scriptBody, permissions } });
    res.end();
  } catch (err) {
    logger.error({ err }, "PS script generation failed");
    sendError(err instanceof Error ? err.message : "AI generation failed");
  }
});

// ─── POST /api/admin/ps-scripts/generate-from-service ────────────────────────

const GENERATE_FROM_SERVICE_SYSTEM = `You are an expert Microsoft 365 PowerShell script engineer with 20+ years of experience across Azure, Exchange Online, SharePoint, Teams, Intune, Defender, Entra ID, and related services.

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
    • ALL mailbox migration tasks: New-MigrationBatch, Start-MigrationBatch, Get-MigrationBatch, Set-MigrationBatch, Remove-MigrationBatch, Get-MigrationStatistics — these cmdlets have NO app-only equivalent
    • ALL Connect-MicrosoftTeams operations — the Teams PowerShell module requires delegated auth; it does not support service-principal-only connections for most administrative operations
    • Connect-ExchangeOnline without -AppId/-CertificateThumbprint — any script using the EXO v2/v3 module interactively
    • Connect-PnPOnline -Interactive — SharePoint/PnP operations that require user consent
    • Connect-MgGraph -Scopes — any delegated Graph flow (Presence.Read, People.Read, Tasks.ReadWrite, Chat.ReadWrite, etc.)
    • Send-MailMessage or sending email on behalf of a specific user when Delegated Mail.Send is required
    • Add-MailboxPermission / Set-MailboxFolderPermission for user delegation scenarios
    • Out-of-Office / automatic replies via Set-MailboxAutoReplyConfiguration (some tenants block app-only)
    • Any Graph scope that lists as "Delegated only" with no Application equivalent in Microsoft docs
    • Any operation requiring MFA or Conditional Access that blocks service principals
    • RULE: If you are uncertain whether a cmdlet or Graph scope supports app-only auth, classify it USER_ACCOUNT_REQUIRED. It is always safer to require user auth than to generate a script that silently fails or requires permissions that must be specially granted.

  HUMAN_ONLY — cannot be scripted at all; requires a human:
    • Client calls, kickoff meetings, status updates, emails, document review
    • Business decisions, approvals, sign-off, risk acceptance
    • Physical / in-person tasks, vendor negotiations

STEP 2 — For every task that can be scripted (AUTOMATABLE or USER_ACCOUNT_REQUIRED), write a complete production-ready PowerShell script:
  For AUTOMATABLE tasks (Azure Runbook / unattended):
  - [CmdletBinding()] attribute + param() block with typed, documented parameters (-TenantId, -ClientId, -ClientSecret where applicable)
  - Authentication MUST use app-only credentials: Connect-MgGraph -ClientId -TenantId -ClientSecret (or certificate), Connect-PnPOnline -ClientId/-ClientSecret, Connect-AzAccount -ServicePrincipal
  - NEVER use -Scopes, -Interactive, or any delegated auth flow — the runbook has no signed-in user
  - permissions.appPermissions must list ONLY Microsoft Graph Application scopes or Azure RBAC roles; permissions.delegatedPermissions MUST be [] (empty)
  For USER_ACCOUNT_REQUIRED tasks:
  - [CmdletBinding()] attribute + param() block — OMIT -ClientId, -ClientSecret, -CertificateThumbprint entirely
  - Use interactive auth: Connect-MgGraph -Scopes "...", Connect-ExchangeOnline (no -AppId), Connect-PnPOnline -Interactive
  Both types:
  - $ErrorActionPreference = "Stop"
  - Structured try/catch/finally error handling
  - Write-Output (NOT Write-Host) for all console output — Write-Error and Write-Warning are acceptable for their respective streams
  - Inline comments explaining each logical section
  - NEVER write output to files — all results, status messages, and summaries MUST go to the output stream via Write-Output so they appear in the Azure Runbook job output
  - FORBIDDEN cmdlets (never use): Export-Csv, Out-File, Set-Content, Add-Content, New-Item (for file creation), Write-Host — file writes are silently lost in Azure Automation; Write-Host bypasses the pipeline entirely

STEP 3 — Choose output shape based on the NUMBER OF SCRIPTABLE TASKS (AUTOMATABLE + USER_ACCOUNT_REQUIRED combined), not by phase count:

  • NO scriptable tasks (everything is HUMAN_ONLY) → type "human-only"
  • EXACTLY ONE scriptable task AND it is AUTOMATABLE → type "single": one standalone script
  • TWO OR MORE scriptable tasks AND ALL are AUTOMATABLE → type "package": ONE dedicated standalone script per task (DO NOT merge tasks)
  • ANY scriptable task is USER_ACCOUNT_REQUIRED (even if mixed with AUTOMATABLE tasks) → type "manual": one consolidated script using interactive auth for all scriptable tasks; list HUMAN_ONLY tasks in humanOnlyTasks

CRITICAL: For "package" type — each task in the MANDATORY MODULES list below MUST produce its own dedicated .ps1 file. Never merge two tasks into one module, never omit a task. If a task has subtasks, treat the parent task as the module boundary.

Output format — STRICT RULES:
1. Always start with a single \`\`\`json fence containing ONLY metadata (no PowerShell code inside the JSON).
2. After the closing \`\`\` of the JSON fence, output each script in its own \`\`\`powershell fence.
3. The very first line of every \`\`\`powershell fence MUST be: # file: <filename.ps1>
4. No prose, explanations, or text outside the fences.

Human-only shape (use when NO tasks can be scripted):
\`\`\`json
{
  "type": "human-only",
  "title": "Service Workflow — All Tasks Require Human Action",
  "explanation": "Concise explanation of why no PowerShell automation applies to this workflow.",
  "humanOnlyTasks": ["task description 1", "task description 2"]
}
\`\`\`

Manual script shape (use when ANY task is USER_ACCOUNT_REQUIRED) — JSON envelope then one powershell fence:
\`\`\`json
{
  "type": "manual",
  "title": "Brief script title (max 60 chars)",
  "humanOnlyTasks": ["human task description 1"],
  "permissions": {
    "appPermissions": [],
    "delegatedPermissions": ["e.g. MailboxSettings.ReadWrite (Microsoft Graph Delegated)", "User.Read (Microsoft Graph Delegated)"],
    "notes": "Must be run interactively under a licensed user account. Cannot run as an Azure Automation runbook or service principal."
  }
}
\`\`\`
\`\`\`powershell
# file: script.ps1
# Complete PowerShell script body using interactive/delegated auth
\`\`\`

Single script shape (exactly ONE automatable task) — JSON envelope then one powershell fence:
\`\`\`json
{
  "type": "single",
  "title": "Brief script title (max 60 chars)",
  "humanOnlyTasks": ["human task description 1"],
  "permissions": {
    "appPermissions": ["e.g. User.Read.All (Microsoft Graph Application)"],
    "delegatedPermissions": [],
    "notes": "Brief note on consent requirements"
  }
}
\`\`\`
\`\`\`powershell
# file: script.ps1
# Complete PowerShell script body here
\`\`\`

Package shape (TWO OR MORE automatable tasks — one module per task) — JSON envelope then one powershell fence per module in the same order:
\`\`\`json
{
  "type": "package",
  "title": "Package title (max 80 chars)",
  "modules": [
    { "filename": "01-Task-Name.ps1", "description": "One-line description of exactly what this task automates" },
    { "filename": "02-Task-Name.ps1", "description": "One-line description of exactly what this task automates" }
  ],
  "humanOnlyTasks": ["human task description 1"],
  "permissions": {
    "appPermissions": ["e.g. User.Read.All (Microsoft Graph Application)"],
    "delegatedPermissions": [],
    "notes": "Brief note on consent requirements"
  }
}
\`\`\`
\`\`\`powershell
# file: 01-Task-Name.ps1
# Fully standalone script for Task One — includes its own auth, param block, and error handling
\`\`\`
\`\`\`powershell
# file: 02-Task-Name.ps1
# Fully standalone script for Task Two — includes its own auth, param block, and error handling
\`\`\`

Rules:
- All filenames must end in .ps1
- NEVER create Main.ps1 or any orchestrator/runner script
- NEVER use dot-sourcing (. .\other-script.ps1) or call another module from within a module
- Every module MUST be completely standalone: its own [CmdletBinding()], param() block, auth connection, error handling, and output — runnable independently without any other file present
- Do NOT put any script code inside the JSON object — all code goes in the \`\`\`powershell fences
- For MANUAL scripts: the very first block after # file: MUST be this banner:
  # ===========================================================================
  # WARNING: MANUAL EXECUTION REQUIRED
  # This script uses delegated/interactive authentication and MUST be run
  # locally under a licensed user account with appropriate permissions.
  # It cannot run as an Azure Automation runbook or service principal.
  # ===========================================================================
- At the top of EVERY powershell script (after the # file: line and after any banner), insert a comment block listing human-only tasks that apply:
  # ─── HUMAN ACTION REQUIRED — steps NOT automated by this script ───────────────
  # • Client kickoff call: Schedule and conduct an introductory call with the client
  # • Approval sign-off: Obtain written approval before applying configuration changes
  # ─────────────────────────────────────────────────────────────────────────────
  If there are no human-only tasks, omit the block entirely.
- Include HUMAN_ONLY tasks in "humanOnlyTasks" for documentation — never generate code for them
- Be specific about permission scopes (e.g. "Group.Read.All (Microsoft Graph Application)" not just "Group.Read.All")
- Distinguish Application permissions (service principal / app-only) from Delegated (signed-in user)
- MANUAL scripts MUST NOT contain -ClientId, -ClientSecret, or -CertificateThumbprint parameters`;

router.post("/admin/ps-scripts/generate-from-service", requireAdmin, async (req: Request, res: Response) => {
  const { serviceId, customInstructions, baseInstructions, detailedInstructions } = req.body as {
    serviceId?: number;
    customInstructions?: string;
    baseInstructions?: string;
    detailedInstructions?: string;
  };

  if (!serviceId || typeof serviceId !== "number") {
    res.status(400).json({ error: "serviceId is required and must be a number" });
    return;
  }

  try {
    const [service] = await db.select().from(servicesTable).where(eq(servicesTable.id, serviceId)).limit(1);
    if (!service) {
      res.status(404).json({ error: "Service not found" });
      return;
    }

    // Script-type template tasks — populated below; used for per-task stub enforcement and Kanban association.
    let scriptTypeTasks: Array<typeof workflowTemplateStepTasksTable.$inferSelect> = [];

    // Automatable phases — populated below when a workflow template is linked.
    // Accessible outside the workflowTemplateId block so the per-phase generation branch can use it.
    let automatablePhases: Array<{
      step: typeof workflowTemplateStepsTable.$inferSelect;
      phaseTasks: Array<typeof workflowTemplateStepTasksTable.$inferSelect>;
    }> = [];

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

        // Collect script-type tasks for Kanban association (script / manualScript tags on kanban cards).
        scriptTypeTasks = allTasks.filter(
          (t) => t.taskType === "script" || t.taskType === "manualScript",
        );

        // Task types that indicate a phase contains automatable work.
        const AUTOMATABLE_TYPES = new Set([
          "script",
          "manualScript",
          "automationBuild",
          "environmentHealthCheck",
          "discovery",
        ]);

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
            if (task.groupName) workflowContext += `\n    Group: ${task.groupName}`;
            const taskInstructions = task.instructions as string[] | null;
            if (taskInstructions?.length)
              workflowContext += `\n    Instructions:${taskInstructions.map((i) => `\n      • ${i}`).join("")}`;
            const taskChecklist = task.checklist as Array<{ id: string; label: string }> | null;
            if (taskChecklist?.length)
              workflowContext += `\n    Checklist:${taskChecklist.map((c) => `\n      ☐ ${c.label}`).join("")}`;
            const taskArtifacts = task.artifactsProduced as string[] | null;
            if (taskArtifacts?.length)
              workflowContext += `\n    Artifacts produced: ${taskArtifacts.join(", ")}`;
            const taskDeliverables = task.clientDeliverables as string[] | null;
            if (taskDeliverables?.length)
              workflowContext += `\n    Client deliverables: ${taskDeliverables.join(", ")}`;
          }
        }

        // Build the MANDATORY MODULES block: one entry per PHASE that contains at least one
        // automatable task. This tells the AI to generate one standalone script per phase,
        // instead of merging everything into a single consolidated script.
        automatablePhases = steps
          .map((step) => {
            const phaseTasks = allTasks.filter(
              (t) =>
                t.workflowTemplateStepId === step.id &&
                AUTOMATABLE_TYPES.has(t.taskType ?? ""),
            );
            return { step, phaseTasks };
          })
          .filter(({ phaseTasks }) => phaseTasks.length > 0);

        if (automatablePhases.length > 0) {
          workflowContext += `\n\nMANDATORY MODULES — each phase below contains automatable tasks and MUST produce its own dedicated PowerShell module. Do NOT merge phases into one module, and do NOT omit any of them:`;
          automatablePhases.forEach(({ step, phaseTasks }, i) => {
            workflowContext += `\n  ${i + 1}. "${step.title}"`;
            phaseTasks.forEach((t) => {
              const typeNote =
                t.taskType === "manualScript"
                  ? " [interactive auth only]"
                  : t.taskType === "automationBuild"
                    ? " [automate this]"
                    : t.taskType === "environmentHealthCheck"
                      ? " [health check / audit]"
                      : t.taskType === "discovery"
                        ? " [collect / query]"
                        : "";
              workflowContext += `\n     - ${t.title}${typeNote}`;
            });
          });
        }
      }
    }

    const deliverables = Array.isArray(service.deliverables) ? (service.deliverables as string[]) : [];
    const inclusions = Array.isArray(service.inclusions) ? (service.inclusions as string[]) : [];
    const features = Array.isArray(service.features) ? (service.features as string[]) : [];

    if (!workflowContext && deliverables.length === 0 && inclusions.length === 0 && features.length === 0) {
      res.status(400).json({
        error:
          "This service has no workflow template or deliverables to generate scripts from. Link a workflow template to the service first.",
      });
      return;
    }

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

    const baseBlock = baseInstructions?.trim()
      ? `\n\nBase instructions (always apply):\n${baseInstructions.trim()}`
      : "";
    const detailedBlock = detailedInstructions?.trim()
      ? `\n\nDetailed instructions:\n${detailedInstructions.trim()}`
      : "";
    const customBlock = customInstructions?.trim()
      ? `\n\nAdditional instructions:\n${customInstructions.trim()}`
      : "";

    const userMessage = `${serviceContext}${workflowContext}${baseBlock}${detailedBlock}${customBlock}

Classify each task and generate PowerShell automation scripts for all M365/Azure-automatable tasks. If no tasks can be automated, return the human-only shape. Return the JSON response exactly as instructed.`;

    const fromServicePrompt = await getPrompt("ps-engineer-from-service", GENERATE_FROM_SERVICE_SYSTEM);

    // ── Switch to SSE streaming mode ────────────────────────────────────────
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const sendSSE = (event: Record<string, unknown>): void => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // System prompt for per-phase generation calls.
    // Critically: we request RAW output (no code fence) to avoid all fence-parsing
    // fragility. The response text IS the script — we validate with hasPsKeywordsFullText
    // directly on the raw text rather than trying to extract from a fence.
    const PER_PHASE_SYSTEM = `You are an expert Microsoft 365 PowerShell engineer.

Write a complete, standalone PowerShell automation script for the tasks described.

OUTPUT FORMAT — very strict:
- Output ONLY the raw PowerShell script. No markdown, no code fences, no preamble, no explanation.
- Your FIRST line must be: # file: <the required filename provided in the user message>
- Your SECOND line must be: [CmdletBinding()]
- Continue immediately with the param() block.

Example of the ONLY acceptable output format:
# file: 01-Conditional-Access-Audit.ps1
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$TenantId,
    [Parameter(Mandatory)][string]$ClientId,
    [Parameter(Mandatory)][string]$ClientSecret
)
...rest of script...

SCRIPT REQUIREMENTS:
- Application auth: -TenantId, -ClientId, -ClientSecret (or -CertificateThumbprint)
- Connect-MgGraph or Connect-ExchangeOnline as needed for Microsoft Graph / Exchange
- Write-Output for ALL output — never Write-Host
- try/catch on every significant operation
- Real automation logic — no placeholder stubs, no TODO comments
- Fully self-contained: runs without any other file present`;

    // Planning prompt: used to cluster each phase's tasks into logical script groups.
    // Output is a small JSON array — stays well within token limits.
    const PLANNING_SYSTEM = `You are a Microsoft 365 PowerShell architect.

Given a list of workflow tasks for one phase, group them into logical, standalone PowerShell scripts.
Each script should cover a coherent workload area (e.g. Conditional Access, SharePoint Inventory, Teams Lifecycle).

Output ONLY a JSON array — no prose, no markdown fences, just raw JSON:
[
  { "description": "Conditional Access & MFA Audit", "tasks": ["Review Conditional Access policies", "Check MFA enforcement"] },
  { "description": "SharePoint Site Inventory", "tasks": ["Export SharePoint site inventory", "Identify orphaned or abandoned sites"] }
]

Rules:
- Each group must contain 1–5 closely related tasks
- Aim for 2–8 groups per phase (use judgment — do NOT create a group for every single task)
- If the phase has ≤ 4 tasks put them all in a single group
- Use clear, short descriptions (no "Phase X" prefix)
- Include EVERY automatable task in exactly one group`;

    // ── Two-phase generation (plan then generate, 2+ automatable phases) ──────
    // Phase 1: one fast planning call per phase → determines how many scripts to
    //           produce and which tasks belong together in each one.
    // Phase 2: one focused generation call per resulting script group.
    // This avoids both the token-limit problem (one giant call) AND the
    // coarseness problem (one script per phase for phases with 20+ tasks).
    if (automatablePhases.length >= 2) {
      const filenameSafe = (s: string) =>
        s.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);

      const typeNoteFn = (taskType: string | null | undefined): string => {
        if (taskType === "automationBuild") return " [automate this]";
        if (taskType === "environmentHealthCheck") return " [health check / audit]";
        if (taskType === "discovery") return " [collect / query]";
        if (taskType === "governanceSetup") return " [configure / remediate]";
        if (taskType === "manualScript") return " [interactive auth only]";
        return "";
      };

      // ── Phase 1: planning calls ──────────────────────────────────────────────
      interface ResolvedGroup {
        phaseTitle: string;
        groupTasks: Array<typeof workflowTemplateStepTasksTable.$inferSelect>;
        filename: string;
        description: string;
      }

      const allGroups: ResolvedGroup[] = [];
      let globalCounter = 1;

      for (let pi = 0; pi < automatablePhases.length; pi++) {
        const { step, phaseTasks } = automatablePhases[pi];
        const planPct = 5 + Math.round((pi / automatablePhases.length) * 20);
        sendSSE({ type: "phase", label: `Planning: ${step.title}…`, pct: planPct });

        let groups: Array<{ description: string; tasks: string[] }> = [];

        if (phaseTasks.length <= 4) {
          // Small phase — skip planning call, treat as one group
          groups = [{ description: step.title, tasks: phaseTasks.map((t) => t.title) }];
        } else {
          try {
            const planMsg = `Phase: ${step.title}${step.description ? "\n" + step.description : ""}

Automatable tasks (${phaseTasks.length} total):
${phaseTasks.map((t) => `- ${t.title} (${t.taskType ?? "unknown"})`).join("\n")}

Group these into logical PowerShell scripts.`;

            const planResponse = await anthropic.messages.create({
              model: "claude-haiku-4-5",
              max_tokens: 1500,
              system: PLANNING_SYSTEM,
              messages: [{ role: "user", content: planMsg }],
            });

            const planText = planResponse.content[0]?.type === "text" ? planResponse.content[0].text.trim() : "";
            const parsed = jsonParse(planText) as unknown;
            if (Array.isArray(parsed) && parsed.length > 0) {
              groups = parsed as Array<{ description: string; tasks: string[] }>;
            }
          } catch (err) {
            logger.warn({ err, phase: step.title }, "generate-from-service: planning call failed, falling back to single group");
          }

          // Fallback if planning call failed or returned nonsense
          if (groups.length === 0) {
            // Batch sequentially into groups of 4
            for (let b = 0; b < phaseTasks.length; b += 4) {
              const batch = phaseTasks.slice(b, b + 4);
              groups.push({ description: `${step.title} (Part ${Math.floor(b / 4) + 1})`, tasks: batch.map((t) => t.title) });
            }
          }
        }

        // Resolve task objects from titles and assign global filenames
        for (const g of groups) {
          const taskTitlesLower = new Set((g.tasks ?? []).map((t: string) => t.toLowerCase()));
          const groupTasks = phaseTasks.filter((t) => taskTitlesLower.has(t.title.toLowerCase()));
          // Fallback: if title matching failed entirely, include all phase tasks in first group only
          const resolvedTasks = groupTasks.length > 0 ? groupTasks : (allGroups.some((ag) => ag.phaseTitle === step.title) ? [] : phaseTasks);
          if (resolvedTasks.length === 0) continue; // skip empty groups (already covered)

          const filename = `${String(globalCounter).padStart(2, "0")}-${filenameSafe(g.description)}.ps1`;
          globalCounter++;
          allGroups.push({ phaseTitle: step.title, groupTasks: resolvedTasks, filename, description: g.description });
        }
      }

      if (allGroups.length === 0) {
        sendSSE({ type: "error", message: "Planning produced no script groups. Please try again." });
        res.end();
        return;
      }

      sendSSE({ type: "phase", label: `Generating ${allGroups.length} scripts…`, pct: 28 });
      logger.info({ groupCount: allGroups.length, service: service.name }, "generate-from-service: planning complete");

      // ── Phase 2: generation calls ─────────────────────────────────────────────
      const generatedModules: Array<{ filename: string; description: string; content: string; sourceTaskIds: number[] }> = [];
      const humanOnlyTasksAll: string[] = [];
      const mergedPerms: PsScriptPermissions = { appPermissions: [], delegatedPermissions: [], notes: "" };

      for (let gi = 0; gi < allGroups.length; gi++) {
        const group = allGroups[gi];
        const genPct = 30 + Math.round((gi / allGroups.length) * 52);
        sendSSE({ type: "phase", label: `Script ${gi + 1}/${allGroups.length}: ${group.description}…`, pct: genPct });

        const taskLines = group.groupTasks.length > 0
          ? group.groupTasks.map((t) => `  - ${t.title}${typeNoteFn(t.taskType)}`).join("\n")
          : `  - Automate tasks for: ${group.description}`;

        const genUserMsg = `SERVICE: ${service.name}

Write a PowerShell script that automates the following Microsoft 365 tasks using the Microsoft Graph API and/or Exchange Online PowerShell.

TASKS TO AUTOMATE:
${taskLines}

Script context: ${group.description} (${group.phaseTitle})
${baseBlock}${detailedBlock}${customBlock}

Required filename (FIRST LINE of your output): ${group.filename}`.trim();

        try {
          const response = await anthropic.messages.create({
            model: "claude-haiku-4-5",
            max_tokens: 8000,
            system: PER_PHASE_SYSTEM,
            messages: [{ role: "user", content: genUserMsg }],
          });

          const rawText = response.content[0]?.type === "text" ? response.content[0].text.trim() : "";
          if (!rawText) continue;

          // Raw-output strategy: the AI outputs the script directly (no fence).
          // Use the raw text as the script body. If the AI disobeyed and wrapped it
          // in a fence anyway, extract from the fence as a fallback.
          let content = "";
          if (hasPsKeywordsFullText(rawText)) {
            // Strip any accidental fence wrapper (```powershell ... ```)
            const psMap = extractPowershellFences(rawText);
            content = psMap.get(group.filename) ?? [...psMap.values()][0] ?? rawText;
          }

          // Ensure # file: header is present on line 1
          if (content) {
            const firstLine = content.split("\n")[0]?.trim() ?? "";
            if (!/^#\s*file:/i.test(firstLine)) {
              content = `# file: ${group.filename}\n${content}`;
            }
          }

          if (content && hasPsKeywordsFullText(content)) {
            generatedModules.push({
              filename: group.filename,
              description: group.description,
              content,
              sourceTaskIds: group.groupTasks.map((t) => t.id),
            });
          } else {
            logger.warn(
              { description: group.description, filename: group.filename, textPreview: rawText.slice(0, 300) },
              "generate-from-service: group script failed PS keyword check, skipping",
            );
          }
        } catch (err) {
          logger.warn({ err, description: group.description }, "generate-from-service: generation call failed, skipping");
        }
      }

      // Deduplicate permissions
      mergedPerms.appPermissions = [...new Set(mergedPerms.appPermissions)];
      mergedPerms.delegatedPermissions = [...new Set(mergedPerms.delegatedPermissions)];

      if (generatedModules.length === 0) {
        sendSSE({ type: "error", message: "No scripts could be generated for this service. Please try again." });
        res.end();
        return;
      }

      sendSSE({ type: "phase", label: "Saving package to library…", pct: 85 });

      // Single module → save as individual script
      if (generatedModules.length === 1) {
        const m = generatedModules[0];
        const [savedSingle] = await db
          .insert(powershellScriptsTable)
          .values({ title: `${service.name} — ${m.description}`, category: "m365", scriptBody: m.content, permissions: mergedPerms, tags: [] })
          .returning();
        logger.info({ scriptId: savedSingle.id, service: service.name }, "generate-from-service: saved single script from plan+generate");
        sendSSE({
          type: "done",
          payload: {
            type: "saved",
            savedScript: {
              id: savedSingle.id, title: savedSingle.title, description: savedSingle.description,
              category: savedSingle.category, tags: savedSingle.tags,
              azureRunbookName: savedSingle.azureRunbookName,
              azureSyncedAt: savedSingle.azureSyncedAt?.toISOString() ?? null,
              createdAt: savedSingle.createdAt.toISOString(), updatedAt: savedSingle.updatedAt.toISOString(),
              scriptBody: savedSingle.scriptBody, permissions: savedSingle.permissions,
            },
            humanOnlyTasks: humanOnlyTasksAll,
          },
        });
        res.end();
        return;
      }

      // Multiple modules → save as a script package
      const packageTitle = `${service.name} — Automation Package`;
      const [pkg] = await db.insert(scriptPackagesTable).values({ title: packageTitle, category: "m365" }).returning();

      // Auto-link to the requesting service
      const [maxRow2] = await db
        .select({ maxOrder: sql<number>`coalesce(max(${serviceScriptSetsTable.displayOrder}), -1)` })
        .from(serviceScriptSetsTable)
        .where(eq(serviceScriptSetsTable.serviceId, serviceId));
      await db
        .insert(serviceScriptSetsTable)
        .values({ serviceId, scriptPackageId: pkg.id, displayOrder: (maxRow2?.maxOrder ?? -1) + 1 })
        .onConflictDoNothing();

      // Use raw SQL so we can populate source_task_ids (array column not in drizzle schema)
      const modParamValues: unknown[] = [];
      const modValueClauses: string[] = [];
      for (let mi = 0; mi < generatedModules.length; mi++) {
        const m = generatedModules[mi];
        const b = mi * 6;
        modParamValues.push(pkg.id, m.filename, m.description ?? null, m.content, mi, m.sourceTaskIds ?? []);
        modValueClauses.push(`($${b + 1}::uuid, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}::int[])`);
      }
      const insertedModsResult = await pool.query<{ id: string; filename: string }>(
        `INSERT INTO script_modules (package_id, filename, description, content, sort_order, source_task_ids)
         VALUES ${modValueClauses.join(", ")}
         RETURNING id, filename`,
        modParamValues,
      );
      const insertedMods = insertedModsResult.rows;

      const fnToId = new Map(insertedMods.map((r) => [r.filename, r.id]));
      const modulesWithIds = generatedModules.map((m) => ({ ...m, id: fnToId.get(m.filename) }));

      logger.info({ packageId: pkg.id, moduleCount: modulesWithIds.length, service: service.name }, "generate-from-service: plan+generate package saved");

      sendSSE({
        type: "done",
        payload: {
          type: "package",
          packageId: pkg.id,
          title: packageTitle,
          modules: modulesWithIds,
          permissions: mergedPerms,
          humanOnlyTasks: humanOnlyTasksAll,
          taskAssociations: [],
        },
      });
      res.end();
      return;
    }

    // ── Single-call generation (0 or 1 automatable phase, or no workflow template) ──
    sendSSE({ type: "phase", label: "Sending prompt to Claude…", pct: 5 });

    const sseStream = anthropic.messages.stream({
      model: "claude-haiku-4-5",
      max_tokens: 16000,
      messages: [{ role: "user", content: `${fromServicePrompt}\n\n${userMessage}` }],
    });

    let accumulated = "";
    const EXPECTED_CHARS = 48_000;
    let lastEmittedPct = 5;
    let firstChunk = true;

    sseStream.on("text", (text: string) => {
      if (firstChunk) {
        firstChunk = false;
        sendSSE({ type: "phase", label: "Claude is generating the PowerShell package…", pct: 20 });
        lastEmittedPct = 20;
      }
      accumulated += text;
      const rawPct = 20 + (accumulated.length / EXPECTED_CHARS) * 55;
      const pct = Math.min(75, Math.round(rawPct));
      if (pct >= lastEmittedPct + 3) {
        lastEmittedPct = pct;
        sendSSE({ type: "progress", pct });
      }
    });

    await sseStream.finalMessage();

    sendSSE({ type: "phase", label: "Parsing modules and validating scripts…", pct: 82 });

    // Parse the JSON envelope (metadata only — no script content inside the JSON).
    const rawJson = extractEnvelopeJson(accumulated);
    if (!rawJson || typeof rawJson !== "object" || Array.isArray(rawJson)) {
      logger.warn(
        { textLength: accumulated.length, textPrefix: accumulated.slice(0, 400) },
        "generate-from-service: failed to parse JSON envelope from AI response",
      );
      sendSSE({ type: "error", message: "AI returned an unstructured response. Please try again." });
      res.end();
      return;
    }

    // Extract the PowerShell scripts from their own ```powershell fences.
    const psScripts = extractPowershellFences(accumulated);

    const parsed = rawJson as Record<string, unknown>;
    const type = typeof parsed["type"] === "string" ? parsed["type"] : "single";
    const humanOnlyTasks = Array.isArray(parsed["humanOnlyTasks"]) ? (parsed["humanOnlyTasks"] as string[]) : [];

    if (type === "human-only") {
      const title =
        typeof parsed["title"] === "string" ? parsed["title"] : "Service Workflow — All Tasks Require Human Action";
      const explanation =
        typeof parsed["explanation"] === "string"
          ? parsed["explanation"]
          : "All tasks in this workflow require human judgment or action and cannot be automated with PowerShell.";
      logger.info({ service: service.name }, "generate-from-service: all tasks human-only");
      sendSSE({ type: "done", payload: { type: "human-only", title, explanation, humanOnlyTasks } });
      res.end();
      return;
    }

    const rawPerms = parsed["permissions"];
    let permissions: PsScriptPermissions = { appPermissions: [], delegatedPermissions: [], notes: "" };
    if (rawPerms && typeof rawPerms === "object" && !Array.isArray(rawPerms)) {
      const p = rawPerms as Record<string, unknown>;
      permissions = {
        appPermissions: Array.isArray(p["appPermissions"]) ? (p["appPermissions"] as string[]) : [],
        delegatedPermissions: Array.isArray(p["delegatedPermissions"]) ? (p["delegatedPermissions"] as string[]) : [],
        notes: typeof p["notes"] === "string" ? p["notes"] : "",
      };
    }

    if (type === "package") {
      const rawModules = parsed["modules"];
      if (!Array.isArray(rawModules) || rawModules.length === 0) {
        sendSSE({ type: "error", message: "AI returned a package with no modules. Please try again." });
        res.end();
        return;
      }

      const validModules = (rawModules as unknown[])
        .filter((m): m is Record<string, unknown> => m !== null && typeof m === "object" && !Array.isArray(m))
        .filter((m) => typeof m["filename"] === "string")
        .map((m) => {
          const filename = String(m["filename"]);
          // Script content comes from the matching ```powershell fence, not from inside the JSON.
          const content = psScripts.get(filename) ?? (typeof m["content"] === "string" ? String(m["content"]) : "");
          return {
            filename,
            description: typeof m["description"] === "string" ? m["description"] : null,
            content,
          };
        })
        .filter((m) => m.content.length > 0);

      if (validModules.length === 0) {
        logger.warn(
          { psScriptKeys: [...psScripts.keys()], textLength: accumulated.length },
          "generate-from-service: no modules with content found",
        );
        sendSSE({ type: "error", message: "AI returned no valid modules. Please try again." });
        res.end();
        return;
      }

      if (validModules.some((m) => !hasPsKeywordsFullText(m.content))) {
        logger.error(
          { moduleCount: validModules.length },
          "generate-from-service: one or more modules contain no PS keywords — refusing to send",
        );
        sendSSE({ type: "error", message: "AI returned a description instead of a script. Please try again." });
        res.end();
        return;
      }

      // ── Bijective stub enforcement ────────────────────────────────────────────
      // Build a one-to-one mapping: each script-type template task is paired with
      // exactly one module using greedy Jaccard matching (each module can be
      // claimed by at most one task). Tasks that get no qualifying unclaimed module
      // receive a newly inserted stub module.
      //
      // bijectiveAssignment: scriptTypeTasks index → validModules index
      const bijectiveAssignment = new Map<number, number>();
      if (scriptTypeTasks.length > 0) {
        const claimedModuleIndices = new Set<number>();
        const existingFilenames = new Set(validModules.map((m) => m.filename.toLowerCase()));

        for (let ti = 0; ti < scriptTypeTasks.length; ti++) {
          const tt = scriptTypeTasks[ti]!;
          const taskWords = titleToWords(tt.title);
          let bestScore = -1;
          let bestMi = -1;

          for (let mi = 0; mi < validModules.length; mi++) {
            if (claimedModuleIndices.has(mi)) continue; // already claimed by another task
            const score = jaccardSimilarity(taskWords, titleToWords(validModules[mi]!.filename));
            if (score > bestScore) { bestScore = score; bestMi = mi; }
          }

          if (bestMi >= 0 && bestScore >= 0.20) {
            // Claim this module for task ti.
            bijectiveAssignment.set(ti, bestMi);
            claimedModuleIndices.add(bestMi);
          } else {
            // No unclaimed module qualifies — insert a stub and claim it.
            const stub = makeStubModule(tt.title, validModules.length + 1);
            if (!existingFilenames.has(stub.filename.toLowerCase())) {
              validModules.push(stub);
              existingFilenames.add(stub.filename.toLowerCase());
            }
            bijectiveAssignment.set(ti, validModules.length - 1);
          }
        }
      }

      const packageTitle =
        (typeof parsed["title"] === "string" ? parsed["title"].trim() : null) || service.name;

      sendSSE({ type: "phase", label: "Saving package to library…", pct: 90 });

      const [pkg] = await db
        .insert(scriptPackagesTable)
        .values({ title: packageTitle, category: "m365" })
        .returning();

      // Auto-link generated package to the requesting service (compute next displayOrder)
      const [maxRow] = await db
        .select({ maxOrder: sql<number>`coalesce(max(${serviceScriptSetsTable.displayOrder}), -1)` })
        .from(serviceScriptSetsTable)
        .where(eq(serviceScriptSetsTable.serviceId, serviceId));
      const nextOrder = (maxRow?.maxOrder ?? -1) + 1;
      await db
        .insert(serviceScriptSetsTable)
        .values({ serviceId, scriptPackageId: pkg.id, displayOrder: nextOrder })
        .onConflictDoNothing();

      const insertedModules = await db.insert(scriptModulesTable).values(
        validModules.map((m, i) => ({
          packageId: pkg.id,
          filename: m.filename,
          description: m.description,
          content: m.content,
          sortOrder: i,
        })),
      ).returning({ id: scriptModulesTable.id, filename: scriptModulesTable.filename });

      // Stitch the DB-generated UUIDs back onto validModules so the done payload
      // carries real ids — the frontend needs them to route module updates correctly.
      const filenameToId = new Map(insertedModules.map((r) => [r.filename, r.id]));
      const validModulesWithIds = validModules.map((m) => ({
        ...m,
        id: filenameToId.get(m.filename),
      }));

      logger.info(
        { packageId: pkg.id, moduleCount: validModulesWithIds.length, service: service.name },
        "generate-from-service: saved package",
      );

      // ── Kanban association (best-effort, non-fatal) ───────────────────────────
      // Use the bijectiveAssignment map (task index → module index) to write back
      // to Kanban cards. A global processedKanbanCardIds set ensures each card is
      // updated exactly once across all template-task iterations, preventing
      // duplicate powershell_scripts / script_run_results inserts.
      interface TaskAssociationResult {
        taskTitle: string;
        taskType: string;
        moduleFilename: string;
        associationStatus: "linked" | "stub";
        kanbanTasksUpdated: number;
      }
      const taskAssociations: TaskAssociationResult[] = [];
      sendSSE({ type: "phase", label: "Linking Kanban tasks…", pct: 95 });

      try {
        if (bijectiveAssignment.size > 0) {
          // Find all client projects linked to this service.
          const linkedServices = await db
            .select({ projectId: clientServicesTable.projectId, clientUserId: clientServicesTable.clientUserId })
            .from(clientServicesTable)
            .where(and(eq(clientServicesTable.serviceId, serviceId), isNotNull(clientServicesTable.projectId)));

          const projectIds = linkedServices
            .map((s) => s.projectId)
            .filter((id): id is number => id !== null);

          // Load all script-type kanban tasks across these projects.
          const allKanbanTasks =
            projectIds.length > 0
              ? await db
                  .select()
                  .from(kanbanTasksTable)
                  .where(
                    and(
                      inArray(kanbanTasksTable.projectId, projectIds),
                      inArray(kanbanTasksTable.taskType, ["script", "manualScript"]),
                    ),
                  )
              : [];

          // Each Kanban card is processed at most once across all task iterations.
          const processedKanbanCardIds = new Set<number>();

          for (let ti = 0; ti < scriptTypeTasks.length; ti++) {
            const templateTask = scriptTypeTasks[ti]!;
            const assignedMi = bijectiveAssignment.get(ti);
            if (assignedMi === undefined) continue;
            const assignedModule = validModules[assignedMi]!;

            const isStub = assignedModule.filename.includes("-stub.ps1");
            // Derive runbook name using the same formula as the push-to-azure endpoints,
            // so the name written to Kanban metadata exactly matches the Azure runbook name.
            const runbookName = filenameToRunbookName(assignedModule.filename);

            // Find kanban cards that resemble this template task, excluding already-processed cards.
            const templateWords = titleToWords(templateTask.title);
            const matchingKanban = allKanbanTasks.filter((kt) => {
              if (processedKanbanCardIds.has(kt.id)) return false;
              return jaccardSimilarity(templateWords, titleToWords(kt.title)) >= 0.20;
            });

            let kanbanTasksUpdated = 0;

            for (const kanbanTask of matchingKanban) {
              // Claim this card before any awaits to prevent double-processing.
              processedKanbanCardIds.add(kanbanTask.id);

              // Re-read current metadata from DB to avoid stale in-memory snapshot.
              const [freshCard] = await db
                .select({ taskMetadata: kanbanTasksTable.taskMetadata })
                .from(kanbanTasksTable)
                .where(eq(kanbanTasksTable.id, kanbanTask.id))
                .limit(1);
              const meta = ((freshCard?.taskMetadata ?? kanbanTask.taskMetadata ?? {}) as Record<string, unknown>);

              if (kanbanTask.taskType === "script") {
                // Automated: write runbookName so "Run Runbook" button appears.
                await db
                  .update(kanbanTasksTable)
                  .set({ taskMetadata: { ...meta, runbookName }, updatedAt: new Date() })
                  .where(eq(kanbanTasksTable.id, kanbanTask.id));
                kanbanTasksUpdated++;
              } else if (kanbanTask.taskType === "manualScript") {
                // Skip if already linked (idempotent guard on the fresh metadata).
                if (meta["scriptRunResultId"]) continue;

                // Save a standalone library script so the download endpoint can serve it.
                const libTitle = `${packageTitle}: ${assignedModule.filename.replace(/^\d+-/, "").replace(/\.ps1$/i, "")}`;
                const [libScript] = await db
                  .insert(powershellScriptsTable)
                  .values({
                    title: libTitle,
                    category: "m365",
                    scriptBody: assignedModule.content,
                    permissions,
                    tags: ["manual", "from-package"],
                  })
                  .returning({ id: powershellScriptsTable.id });

                if (!libScript) continue;

                // Resolve the customerId from the project's linked service row.
                const projSvc = linkedServices.find((s) => s.projectId === kanbanTask.projectId);
                const customerId = projSvc?.clientUserId ?? null;

                const [runResult] = await db
                  .insert(scriptRunResultsTable)
                  .values({
                    customerId,
                    libraryScriptId: libScript.id,
                    packageId: serviceId,   // links run result to the service for portal queries
                    status: "awaiting_upload",
                    executionSource: "manual",
                  })
                  .returning({ id: scriptRunResultsTable.id });

                if (!runResult) continue;

                await db
                  .update(kanbanTasksTable)
                  .set({
                    taskMetadata: {
                      ...meta,
                      scriptId: runResult.id,       // integer ID required by ManualScriptMetadata
                      scriptRunResultId: runResult.id,
                      projectId: kanbanTask.projectId,
                    },
                    updatedAt: new Date(),
                  })
                  .where(eq(kanbanTasksTable.id, kanbanTask.id));
                kanbanTasksUpdated++;
              }
            }

            taskAssociations.push({
              taskTitle: templateTask.title,
              taskType: templateTask.taskType ?? "script",
              moduleFilename: assignedModule.filename,
              associationStatus: isStub ? "stub" : "linked",
              kanbanTasksUpdated,
            });
          }

          logger.info(
            { serviceId, taskAssociations },
            "generate-from-service: completed Kanban association",
          );
        }
      } catch (assocErr) {
        // Non-fatal: log but do not fail the whole generation.
        logger.warn({ assocErr }, "generate-from-service: Kanban association step failed (non-fatal)");
      }

      sendSSE({ type: "done", payload: { type: "package", packageId: pkg.id, title: packageTitle, modules: validModulesWithIds, humanOnlyTasks, permissions, taskAssociations } });
      res.end();
      return;
    }

    // type === "manual" or type === "single" — script comes from the first ```powershell fence.
    const fenceScript = psScripts.size > 0 ? [...psScripts.values()][0] : "";
    const scriptBody = fenceScript || (typeof parsed["scriptBody"] === "string" ? parsed["scriptBody"].trim() : "");

    if (scriptBody.length < 20 || !hasPsKeywordsFullText(scriptBody)) {
      logger.error(
        { scriptBodyPrefix: scriptBody.slice(0, 300), psScriptCount: psScripts.size },
        "generate-from-service: scriptBody is empty or contains no PS keywords",
      );
      sendSSE({ type: "error", message: "AI returned an unreadable script. Please try again." });
      res.end();
      return;
    }

    const title =
      (typeof parsed["title"] === "string" ? parsed["title"].trim() : null) || service.name;

    if (type === "manual") {
      // Auto-save to the library with the "manual" tag so the editor can open it immediately.
      const [saved] = await db
        .insert(powershellScriptsTable)
        .values({
          title,
          category: "m365",
          scriptBody,
          permissions,
          tags: ["manual"],
        })
        .returning();

      logger.info(
        { scriptId: saved.id, service: service.name },
        "generate-from-service: saved manual script",
      );
      sendSSE({
        type: "done",
        payload: {
          type: "manual",
          savedScript: {
            id: saved.id,
            title: saved.title,
            description: saved.description,
            category: saved.category,
            tags: saved.tags,
            azureRunbookName: saved.azureRunbookName,
            azureSyncedAt: saved.azureSyncedAt?.toISOString() ?? null,
            createdAt: saved.createdAt.toISOString(),
            updatedAt: saved.updatedAt.toISOString(),
            scriptBody: saved.scriptBody,
            permissions: saved.permissions,
          },
          humanOnlyTasks,
        },
      });
      res.end();
      return;
    }

    // "single" — auto-save to library so the script appears in the sidebar immediately.
    // Returns type "saved" (not "manual") so the client can auto-close without showing
    // the misleading "requires interactive execution" panel.
    const [savedSingle] = await db
      .insert(powershellScriptsTable)
      .values({
        title,
        category: "m365",
        scriptBody,
        permissions,
        tags: [],
      })
      .returning();

    logger.info(
      { scriptId: savedSingle.id, service: service.name },
      "generate-from-service: saved single script",
    );
    sendSSE({
      type: "done",
      payload: {
        type: "saved",
        savedScript: {
          id: savedSingle.id,
          title: savedSingle.title,
          description: savedSingle.description,
          category: savedSingle.category,
          tags: savedSingle.tags,
          azureRunbookName: savedSingle.azureRunbookName,
          azureSyncedAt: savedSingle.azureSyncedAt?.toISOString() ?? null,
          createdAt: savedSingle.createdAt.toISOString(),
          updatedAt: savedSingle.updatedAt.toISOString(),
          scriptBody: savedSingle.scriptBody,
          permissions: savedSingle.permissions,
        },
        humanOnlyTasks,
      },
    });
    res.end();
  } catch (err) {
    logger.error({ err }, "generate-from-service failed");
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: "error", message: err instanceof Error ? err.message : "Generation failed" })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: err instanceof Error ? err.message : "Generation failed" });
    }
  }
});

// ─── POST /api/admin/ps-scripts/generate-from-task ────────────────────────────
// Generates a single PowerShell script for a specific workflow task, saves it
// to the library with source_task_id, and immediately sets runbook_id on the task.

const GENERATE_FROM_TASK_SYSTEM = `You are an expert Microsoft 365 PowerShell script engineer with 20+ years of experience.

Given a single workflow task, classify it and generate an appropriate PowerShell script.

CLASSIFY the task as one of:
  AUTOMATABLE — runs UNATTENDED inside an Azure Automation Runbook as a service principal (App Registration with client credentials).
    ★ APPLICATION PERMISSIONS ONLY — never Delegated permissions. There is no signed-in user; only Microsoft Graph Application scopes are valid (e.g. User.Read.All, not User.Read).
    ★ NO interactive login, no licensed user account, no MFA — must authenticate entirely via -ClientId / -ClientSecret or a certificate.
    ★ Output via Write-Output ONLY — Azure Automation captures only the output stream. Write-Host, Export-Csv, Out-File, Set-Content are silently lost.
    ★ permissions.delegatedPermissions MUST be [] for every AUTOMATABLE script.
  USER_ACCOUNT_REQUIRED — can be scripted but REQUIRES a real licensed user account with delegated/interactive auth. CANNOT run as an Azure Automation runbook or service principal.
  HUMAN_ONLY — cannot be scripted at all (meetings, approvals, document review, client calls, business decisions)

Classification rules:
  - Migration cmdlets (New-MigrationBatch etc.) → USER_ACCOUNT_REQUIRED
  - Connect-MicrosoftTeams → USER_ACCOUNT_REQUIRED
  - ANY Connect-MgGraph -Scopes → USER_ACCOUNT_REQUIRED
  - Reporting, Entra, SharePoint (PnP app-only), Intune via Graph Application → AUTOMATABLE
  - If unsure whether a cmdlet supports app-only auth → USER_ACCOUNT_REQUIRED

For AUTOMATABLE tasks (Azure Runbook / unattended):
  - [CmdletBinding()] attribute + typed param() block with -TenantId, -ClientId, -ClientSecret where applicable
  - Authentication MUST use app-only credentials: Connect-MgGraph -ClientId -TenantId -ClientSecret (or cert), Connect-PnPOnline -ClientId/-ClientSecret, Connect-AzAccount -ServicePrincipal
  - NEVER use -Scopes, -Interactive, or any delegated auth flow — the runbook has no signed-in user
  - Inline comments explaining each logical section

For USER_ACCOUNT_REQUIRED tasks:
  - [CmdletBinding()] attribute + typed param() block — OMIT -ClientId/-ClientSecret/-CertificateThumbprint entirely
  - Use interactive auth: Connect-MgGraph -Scopes "...", Connect-ExchangeOnline (no -AppId), Connect-PnPOnline -Interactive
  - Inline comments explaining each logical section

Both types:
  - $ErrorActionPreference = "Stop"
  - Structured try/catch/finally error handling
  - Write-Output (NOT Write-Host) for all console output — Write-Error and Write-Warning are acceptable
  - NEVER write output to files — all results MUST go to the output stream via Write-Output so they appear in the Azure Runbook job output
  - FORBIDDEN: Export-Csv, Out-File, Set-Content, Add-Content, New-Item (for file creation), Write-Host — file writes are silently lost in Azure Automation; Write-Host bypasses the pipeline

Output EXACTLY ONE of these three shapes — no prose outside the fences:

Human-only (task requires human action, cannot be scripted):
\`\`\`json
{"type":"human-only","title":"Task Title","explanation":"Why this cannot be automated"}
\`\`\`

Single automatable script (AUTOMATABLE — Application permissions only, delegatedPermissions MUST be []):
\`\`\`json
{"type":"single","title":"Brief script title max 60 chars","permissions":{"appPermissions":["e.g. User.Read.All (Microsoft Graph Application)"],"delegatedPermissions":[],"notes":"Brief note on consent"}}
\`\`\`
\`\`\`powershell
# file: script.ps1
# Complete production-ready script body using app-only auth (-ClientId/-ClientSecret)
\`\`\`

Interactive script (USER_ACCOUNT_REQUIRED — Delegated permissions only, appPermissions MUST be []):
\`\`\`json
{"type":"manual","title":"Brief script title max 60 chars","permissions":{"appPermissions":[],"delegatedPermissions":["e.g. MailboxSettings.ReadWrite (Microsoft Graph Delegated)"],"notes":"Must run interactively under a licensed user account. Cannot run as an Azure Automation runbook."}}
\`\`\`
\`\`\`powershell
# file: script.ps1
# ===========================================================================
# WARNING: MANUAL EXECUTION REQUIRED
# This script uses delegated/interactive authentication and MUST be run
# locally under a licensed user account with appropriate permissions.
# It cannot run as an Azure Automation runbook or service principal.
# ===========================================================================
# Complete production-ready script body using interactive auth
\`\`\``;

router.post("/admin/ps-scripts/generate-from-task", requireAdmin, async (req: Request, res: Response) => {
  const { taskId } = req.body as { taskId?: unknown };
  if (typeof taskId !== "number" || !Number.isInteger(taskId)) {
    res.status(400).json({ error: "taskId (integer) is required" });
    return;
  }
  try {
    const taskRow = await pool.query<{
      id: number; title: string; description: string | null;
      task_type: string | null; instructions: unknown; checklist: unknown;
      workflow_template_step_id: number; step_title: string;
    }>(
      `SELECT t.id, t.title, t.description, t.task_type, t.instructions, t.checklist,
              t.workflow_template_step_id, s.title AS step_title
       FROM workflow_template_step_tasks t
       JOIN workflow_template_steps s ON s.id = t.workflow_template_step_id
       WHERE t.id = $1`,
      [taskId],
    );
    if (taskRow.rowCount === 0) { res.status(404).json({ error: "Task not found" }); return; }
    const task = taskRow.rows[0]!;

    const instructionLines = Array.isArray(task.instructions)
      ? (task.instructions as string[]).filter(Boolean).join("\n- ")
      : "";
    const checklistLines = Array.isArray(task.checklist)
      ? (task.checklist as Array<{ label: string }>).filter(c => c.label).map(c => c.label).join("\n- ")
      : "";

    const userPrompt = [
      `Phase: ${task.step_title}`,
      `Task Title: ${task.title}`,
      task.task_type ? `Task Type: ${task.task_type}` : null,
      task.description ? `\nDescription:\n${task.description}` : null,
      instructionLines ? `\nInstructions:\n- ${instructionLines}` : null,
      checklistLines ? `\nChecklist items:\n- ${checklistLines}` : null,
    ].filter(Boolean).join("\n");

    const systemPrompt = await getPrompt("ps-engineer-from-task", GENERATE_FROM_TASK_SYSTEM);
    logger.info({ taskId, title: task.title }, "generate-from-task: calling Claude");

    const aiResponse = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const rawText = aiResponse.content.filter(b => b.type === "text").map(b => b.text).join("");

    const jsonFenceMatch = rawText.match(/```json\s*([\s\S]*?)```/);
    if (!jsonFenceMatch) {
      logger.error({ rawText: rawText.slice(0, 500) }, "generate-from-task: no JSON fence");
      res.status(500).json({ error: "AI returned unrecognised format. Please try again." });
      return;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonFenceMatch[1]!) as Record<string, unknown>;
    } catch {
      logger.error({ raw: jsonFenceMatch[1]?.slice(0, 300) }, "generate-from-task: JSON parse failed");
      res.status(500).json({ error: "AI returned malformed JSON. Please try again." });
      return;
    }

    const type = typeof parsed["type"] === "string" ? parsed["type"] : "single";
    const title = (typeof parsed["title"] === "string" ? parsed["title"].trim() : null) || task.title;
    const permissions: PsScriptPermissions = (parsed["permissions"] as PsScriptPermissions | undefined)
      ?? { appPermissions: [], delegatedPermissions: [], notes: "" };

    if (type === "human-only") {
      const explanation = typeof parsed["explanation"] === "string"
        ? parsed["explanation"]
        : "This task requires human action and cannot be automated.";
      logger.info({ taskId }, "generate-from-task: human-only");
      res.json({ type: "human-only", title, explanation });
      return;
    }

    const psFenceMatch = rawText.match(/```powershell\s*([\s\S]*?)```/);
    const scriptBody = psFenceMatch
      ? psFenceMatch[1]!.replace(/^#\s*file:.*\n/, "").trim()
      : "";

    if (scriptBody.length < 20 || !hasPsKeywordsFullText(scriptBody)) {
      logger.error({ scriptBodyPrefix: scriptBody.slice(0, 300) }, "generate-from-task: empty/no PS keywords");
      res.status(500).json({ error: "AI returned an unreadable script. Please try again." });
      return;
    }

    const tags: string[] = type === "manual" ? ["manual"] : [];
    const runbookName = titleToRunbookName(title);

    const savedRow = await pool.query<{ id: string; title: string; azure_runbook_name: string | null }>(
      `INSERT INTO powershell_scripts (title, category, script_body, permissions, tags, source_task_id)
       VALUES ($1, 'task', $2, $3::jsonb, $4::text[], $5)
       RETURNING id, title, azure_runbook_name`,
      [title, scriptBody, JSON.stringify(permissions), tags, taskId],
    );
    const saved = savedRow.rows[0]!;

    const effectiveRunbookId = saved.azure_runbook_name ?? runbookName;
    await pool.query(
      `UPDATE workflow_template_step_tasks SET runbook_id = $1 WHERE id = $2`,
      [effectiveRunbookId, taskId],
    );

    logger.info({ scriptId: saved.id, taskId, runbookId: effectiveRunbookId }, "generate-from-task: saved and linked");
    res.json({ type, scriptId: saved.id, title: saved.title, runbookId: effectiveRunbookId });
  } catch (err) {
    logger.error({ err }, "generate-from-task failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Generation failed" });
  }
});

// ─── POST /api/admin/ps-scripts/:id/assign-task ───────────────────────────────
// Re-links a script's source_task_id back to the task via runbook_id.
// Used from the Script Library dropdown → "Assign to Task".

router.post("/admin/ps-scripts/:id/assign-task", requireAdmin, async (req: Request, res: Response) => {
  const scriptId = String(req.params["id"] ?? "");
  if (!UUID_RE.test(scriptId)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const row = await pool.query<{ source_task_id: number | null; title: string; azure_runbook_name: string | null }>(
      `SELECT source_task_id, title, azure_runbook_name FROM powershell_scripts WHERE id = $1`,
      [scriptId],
    );
    if (row.rowCount === 0) { res.status(404).json({ error: "Script not found" }); return; }
    const script = row.rows[0]!;
    if (!script.source_task_id) {
      res.json({ assigned: 0, message: "No source task recorded for this script." });
      return;
    }
    const runbookId = script.azure_runbook_name ?? titleToRunbookName(script.title);
    const updateResult = await pool.query(
      `UPDATE workflow_template_step_tasks SET runbook_id = $1 WHERE id = $2 RETURNING id`,
      [runbookId, script.source_task_id],
    );
    const assigned = updateResult.rowCount ?? 0;
    logger.info({ scriptId, assigned, taskId: script.source_task_id, runbookId }, "assign-task: runbook_id set");
    res.json({ assigned, taskId: script.source_task_id });
  } catch (err) {
    logger.error({ err }, "Failed to assign script to task");
    res.status(500).json({ error: "Failed to assign script to task" });
  }
});

// ─── GET /api/admin/ps-scripts/published ─────────────────────────────────────
// Returns a merged list of all runnable entries for the "Linked Runbook" dropdown:
//   • Published scripts (azureRunbookName IS NOT NULL) — id = azureRunbookName slug
//   • All script modules — id = module UUID (stored by assign-tasks endpoint)
// Both formats can appear as task.runbookId so the combobox must handle both.

router.get("/admin/ps-scripts/published", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [scripts, modules] = await Promise.all([
      db
        .select({
          id: powershellScriptsTable.azureRunbookName,
          title: powershellScriptsTable.title,
        })
        .from(powershellScriptsTable)
        .where(isNotNull(powershellScriptsTable.azureRunbookName))
        .orderBy(powershellScriptsTable.title),
      db
        .select({
          id: scriptModulesTable.id,
          title: scriptModulesTable.description,
          filename: scriptModulesTable.filename,
        })
        .from(scriptModulesTable)
        .orderBy(scriptModulesTable.sortOrder),
    ]);

    const scriptEntries = scripts.map(s => ({ id: s.id as string, title: s.title }));
    const moduleEntries = modules.map(m => ({
      id: m.id,
      title: m.title ?? m.filename.replace(/\.ps1$/i, "").replace(/-/g, " "),
    }));

    res.json([...scriptEntries, ...moduleEntries]);
  } catch (err) {
    logger.error({ err }, "Failed to list published PS scripts");
    res.status(500).json({ error: "Failed to list published scripts" });
  }
});

// ─── GET /api/admin/ps-scripts ────────────────────────────────────────────────

router.get("/admin/ps-scripts", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const result = await pool.query<{
      id: string; title: string; description: string | null; category: string;
      tags: string[]; azure_runbook_name: string | null; azure_synced_at: string | null;
      created_at: string; updated_at: string; source_task_id: number | null;
    }>(
      `SELECT id, title, description, category, tags, azure_runbook_name, azure_synced_at,
              created_at, updated_at, source_task_id
       FROM powershell_scripts ORDER BY created_at DESC`,
    );
    res.json(result.rows.map(r => ({
      id: r.id,
      title: r.title,
      description: r.description,
      category: r.category,
      tags: r.tags,
      azureRunbookName: r.azure_runbook_name,
      azureSyncedAt: r.azure_synced_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      sourceTaskId: r.source_task_id,
    })));
  } catch (err) {
    logger.error({ err }, "Failed to list PS scripts");
    res.status(500).json({ error: "Failed to list scripts" });
  }
});

// ─── POST /api/admin/ps-scripts ───────────────────────────────────────────────

router.post("/admin/ps-scripts", requireAdmin, async (req: Request, res: Response) => {
  const { title, description, category, scriptBody, permissions, tags } = req.body as {
    title?: string;
    description?: string;
    category?: string;
    scriptBody?: string;
    permissions?: PsScriptPermissions;
    tags?: string[];
  };

  if (!title || typeof title !== "string" || title.trim().length === 0) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  if (!scriptBody || typeof scriptBody !== "string" || scriptBody.trim().length === 0) {
    res.status(400).json({ error: "scriptBody is required" });
    return;
  }

  const runbookName = titleToRunbookName(title.trim());

  try {
    const [created] = await db.insert(powershellScriptsTable).values({
      title: title.trim(),
      description: description?.trim() ?? null,
      category: category ?? "other",
      scriptBody: scriptBody.trim(),
      permissions: permissions ?? { appPermissions: [], delegatedPermissions: [], notes: "" },
      tags: tags ?? [],
      azureRunbookName: runbookName,
    }).returning();

    // Fire-and-forget push to Azure Automation
    void tryPushPsScriptToAzure(created.id, runbookName, scriptBody.trim());

    res.status(201).json(created);
  } catch (err) {
    logger.error({ err }, "Failed to save PS script");
    res.status(500).json({ error: "Failed to save script" });
  }
});

// ─── POST /api/admin/ps-scripts/packages ─────────────────────────────────────
// Manually create a named Script Set (empty, no modules). Accepts a minimal body:
//   { title, category?, tags?, permissions? }
// NOTE: must be registered BEFORE /:id to prevent "packages" being treated as an id

router.post("/admin/ps-scripts/packages", requireAdmin, async (req: Request, res: Response) => {
  const { title, category, tags, permissions } = req.body as {
    title?: string;
    category?: string;
    tags?: string[];
    permissions?: PsScriptPermissions;
  };

  if (!title || typeof title !== "string" || title.trim().length === 0) {
    res.status(400).json({ error: "title is required" });
    return;
  }

  const resolvedCategory = (typeof category === "string" && category.trim()) ? category.trim() : "other";
  const resolvedTags = Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter(Boolean) : [];
  const resolvedPermissions: PsScriptPermissions = (
    permissions &&
    typeof permissions === "object" &&
    !Array.isArray(permissions)
  ) ? {
    appPermissions: Array.isArray(permissions.appPermissions) ? permissions.appPermissions : [],
    delegatedPermissions: Array.isArray(permissions.delegatedPermissions) ? permissions.delegatedPermissions : [],
    notes: typeof permissions.notes === "string" ? permissions.notes : "",
  } : { appPermissions: [], delegatedPermissions: [], notes: "" };

  try {
    const [created] = await db
      .insert(scriptPackagesTable)
      .values({
        title: title.trim(),
        category: resolvedCategory,
        tags: resolvedTags,
        permissions: resolvedPermissions,
      })
      .returning();

    // Return in the same shape as the GET /packages list items (with empty modules)
    res.status(201).json({ ...created, modules: [] });
  } catch (err) {
    logger.error({ err }, "Failed to create script package");
    res.status(500).json({ error: "Failed to create package" });
  }
});

// ─── GET /api/admin/ps-scripts/packages ──────────────────────────────────────
// NOTE: must be registered BEFORE /:id to prevent "packages" being treated as an id

router.get("/admin/ps-scripts/packages", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const packages = await db
      .select()
      .from(scriptPackagesTable)
      .orderBy(desc(scriptPackagesTable.createdAt));

    const pkgIds = packages.map((p) => p.id);
    let allModules: ScriptModule[] = [];
    if (pkgIds.length > 0) {
      allModules = await db
        .select()
        .from(scriptModulesTable)
        .where(inArray(scriptModulesTable.packageId, pkgIds))
        .orderBy(asc(scriptModulesTable.sortOrder));
    }

    const result = packages.map((pkg) => ({
      ...pkg,
      modules: allModules.filter((m) => m.packageId === pkg.id),
    }));

    res.json(result);
  } catch (err) {
    logger.error({ err }, "Failed to list script packages");
    res.status(500).json({ error: "Failed to list packages" });
  }
});

// ─── PATCH /api/admin/ps-scripts/packages/:id ────────────────────────────────

router.patch("/admin/ps-scripts/packages/:id", requireAdmin, async (req: Request, res: Response) => {
  const pkgId = String(req.params["id"] ?? "");
  if (!UUID_RE.test(pkgId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { title, category, permissions } = req.body as { title?: string; category?: string; permissions?: PsScriptPermissions };

  try {
    const [updated] = await db
      .update(scriptPackagesTable)
      .set({
        ...(title !== undefined && { title: title.trim() }),
        ...(category !== undefined && { category }),
        ...(permissions !== undefined && { permissions }),
      })
      .where(eq(scriptPackagesTable.id, pkgId))
      .returning();
    if (!updated) { res.status(404).json({ error: "Package not found" }); return; }
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "Failed to update script package");
    res.status(500).json({ error: "Failed to update package" });
  }
});

// ─── DELETE /api/admin/ps-scripts/packages/:id ───────────────────────────────
// NOTE: must be registered BEFORE /admin/ps-scripts/:id

router.delete("/admin/ps-scripts/packages/:id", requireAdmin, async (req: Request, res: Response) => {
  const pkgId = String(req.params["id"] ?? "");
  if (!UUID_RE.test(pkgId)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(scriptPackagesTable).where(eq(scriptPackagesTable.id, pkgId));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Failed to delete script package");
    res.status(500).json({ error: "Failed to delete package" });
  }
});

// ─── POST /api/admin/ps-scripts/packages/:id/modules ─────────────────────────

router.post("/admin/ps-scripts/packages/:id/modules", requireAdmin, async (req: Request, res: Response) => {
  const pkgId = String(req.params["id"] ?? "");
  if (!UUID_RE.test(pkgId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { filename, description, content, sortOrder, azureRunbookName } = req.body as {
    filename?: string;
    description?: string;
    content?: string;
    sortOrder?: number;
    azureRunbookName?: string | null;
  };

  if (!filename || typeof filename !== "string" || filename.trim().length === 0) {
    res.status(400).json({ error: "filename is required" });
    return;
  }
  if (typeof content !== "string") {
    res.status(400).json({ error: "content is required" });
    return;
  }

  try {
    const [created] = await db
      .insert(scriptModulesTable)
      .values({
        packageId: pkgId,
        filename: filename.trim(),
        description: description?.trim() ?? null,
        content,
        sortOrder: typeof sortOrder === "number" ? sortOrder : 999,
        azureRunbookName: azureRunbookName?.trim() || null,
      })
      .returning();
    res.status(201).json(created);
  } catch (err) {
    logger.error({ err }, "Failed to add module to package");
    res.status(500).json({ error: "Failed to add module" });
  }
});

// ─── PUT /api/admin/ps-scripts/modules/:id ───────────────────────────────────

router.put("/admin/ps-scripts/modules/:id", requireAdmin, async (req: Request, res: Response) => {
  const moduleId = String(req.params["id"] ?? "");
  if (!UUID_RE.test(moduleId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { filename, description, content, sortOrder, azureRunbookName } = req.body as {
    filename?: string;
    description?: string;
    content?: string;
    sortOrder?: number;
    azureRunbookName?: string | null;
  };

  try {
    const [updated] = await db
      .update(scriptModulesTable)
      .set({
        ...(filename !== undefined && { filename: filename.trim() }),
        ...(description !== undefined && { description: description?.trim() ?? null }),
        ...(content !== undefined && { content }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(azureRunbookName !== undefined && { azureRunbookName: azureRunbookName?.trim() || null }),
      })
      .where(eq(scriptModulesTable.id, moduleId))
      .returning();
    if (!updated) { res.status(404).json({ error: "Module not found" }); return; }
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "Failed to update script module");
    res.status(500).json({ error: "Failed to update module" });
  }
});

// ─── POST /api/admin/ps-scripts/modules/:id/assign-tasks ─────────────────────
// Sets runbook_id = moduleId on every workflow task recorded as a source task
// for this module (populated automatically during generate-from-service).

router.post("/admin/ps-scripts/modules/:id/assign-tasks", requireAdmin, async (req: Request, res: Response) => {
  const moduleId = String(req.params["id"] ?? "");
  if (!UUID_RE.test(moduleId)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const modRow = await pool.query<{ source_task_ids: number[] }>(
      `SELECT source_task_ids FROM script_modules WHERE id = $1`,
      [moduleId],
    );
    if (modRow.rowCount === 0) { res.status(404).json({ error: "Module not found" }); return; }
    const sourceTaskIds: number[] = modRow.rows[0]?.source_task_ids ?? [];
    if (sourceTaskIds.length === 0) {
      res.json({ assigned: 0, message: "No source tasks recorded for this module. Re-generate the package to capture task associations." });
      return;
    }
    const updateResult = await pool.query(
      `UPDATE workflow_template_step_tasks SET runbook_id = $1 WHERE id = ANY($2::int[]) RETURNING id`,
      [moduleId, sourceTaskIds],
    );
    const assigned = updateResult.rowCount ?? 0;
    logger.info({ moduleId, assigned }, "assign-tasks: runbook_id set on source tasks");
    res.json({ assigned });
  } catch (err) {
    logger.error({ err }, "Failed to assign module to tasks");
    res.status(500).json({ error: "Failed to assign module to tasks" });
  }
});

// ─── DELETE /api/admin/ps-scripts/modules/:id ────────────────────────────────

router.delete("/admin/ps-scripts/modules/:id", requireAdmin, async (req: Request, res: Response) => {
  const moduleId = String(req.params["id"] ?? "");
  if (!UUID_RE.test(moduleId)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(scriptModulesTable).where(eq(scriptModulesTable.id, moduleId));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Failed to delete script module");
    res.status(500).json({ error: "Failed to delete module" });
  }
});

// ─── Canonical module endpoints at /admin/script-packages/:id/modules ─────────
// These are the task-specified paths; they delegate to the same logic above.

router.post("/admin/script-packages/:id/modules", requireAdmin, async (req: Request, res: Response) => {
  const pkgId = String(req.params["id"] ?? "");
  if (!UUID_RE.test(pkgId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { filename, description, content, sortOrder, azureRunbookName } = req.body as {
    filename?: string;
    description?: string;
    content?: string;
    sortOrder?: number;
    azureRunbookName?: string | null;
  };

  if (!filename || typeof filename !== "string" || filename.trim().length === 0) {
    res.status(400).json({ error: "filename is required" }); return;
  }
  if (typeof content !== "string") {
    res.status(400).json({ error: "content is required" }); return;
  }

  try {
    const [created] = await db
      .insert(scriptModulesTable)
      .values({
        packageId: pkgId,
        filename: filename.trim(),
        description: description?.trim() ?? null,
        content,
        sortOrder: typeof sortOrder === "number" ? sortOrder : 999,
        azureRunbookName: azureRunbookName?.trim() || null,
      })
      .returning();
    res.status(201).json(created);
  } catch (err) {
    logger.error({ err }, "Failed to add module to script package");
    res.status(500).json({ error: "Failed to add module" });
  }
});

router.delete("/admin/script-packages/:id/modules/:moduleId", requireAdmin, async (req: Request, res: Response) => {
  const moduleId = String(req.params["moduleId"] ?? "");
  if (!UUID_RE.test(moduleId)) { res.status(400).json({ error: "Invalid module id" }); return; }
  try {
    await db.delete(scriptModulesTable).where(eq(scriptModulesTable.id, moduleId));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Failed to delete script module");
    res.status(500).json({ error: "Failed to delete module" });
  }
});

// ─── POST /api/admin/ps-scripts/:id/associate-to-package ─────────────────────
// NOTE: must be registered BEFORE /admin/ps-scripts/:id to prevent route shadowing

router.post("/admin/ps-scripts/:id/associate-to-package", requireAdmin, async (req: Request, res: Response) => {
  const id = String(req.params["id"] ?? "");
  const UUID_RE_LOCAL = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE_LOCAL.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { packageId } = req.body as { packageId?: string };
  if (!packageId || !UUID_RE_LOCAL.test(packageId)) { res.status(400).json({ error: "packageId is required" }); return; }

  try {
    const [script] = await db.select().from(powershellScriptsTable).where(eq(powershellScriptsTable.id, id));
    if (!script) { res.status(404).json({ error: "Script not found" }); return; }

    const [pkg] = await db.select({ id: scriptPackagesTable.id }).from(scriptPackagesTable).where(eq(scriptPackagesTable.id, packageId));
    if (!pkg) { res.status(404).json({ error: "Package not found" }); return; }

    const filename = `${titleToRunbookName(script.title)}.ps1`;
    const [mod] = await db.insert(scriptModulesTable).values({
      packageId,
      filename,
      description: script.description ?? null,
      content: script.scriptBody ?? "",
      sortOrder: 999,
    }).returning();

    res.status(201).json(mod);
  } catch (err) {
    logger.error({ err }, "Failed to associate script to package");
    res.status(500).json({ error: "Failed to associate script" });
  }
});

// ─── GET /api/admin/ps-scripts/:id ───────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get("/admin/ps-scripts/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = String(req.params["id"] ?? "");
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [script] = await db.select().from(powershellScriptsTable).where(eq(powershellScriptsTable.id, id));
    if (!script) { res.status(404).json({ error: "Script not found" }); return; }
    res.json(script);
  } catch (err) {
    logger.error({ err }, "Failed to fetch PS script");
    res.status(500).json({ error: "Failed to fetch script" });
  }
});

// ─── PUT /api/admin/ps-scripts/:id ───────────────────────────────────────────

router.put("/admin/ps-scripts/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = String(req.params["id"] ?? "");
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { title, description, category, scriptBody, permissions, tags, azureRunbookName } = req.body as {
    title?: string;
    description?: string;
    category?: string;
    scriptBody?: string;
    permissions?: PsScriptPermissions;
    tags?: string[];
    azureRunbookName?: string | null;
  };

  try {
    const [updated] = await db
      .update(powershellScriptsTable)
      .set({
        ...(title !== undefined && { title: title.trim() }),
        ...(description !== undefined && { description: description?.trim() ?? null }),
        ...(category !== undefined && { category }),
        ...(scriptBody !== undefined && { scriptBody: scriptBody.trim() }),
        ...(permissions !== undefined && { permissions }),
        ...(tags !== undefined && { tags }),
        ...(azureRunbookName !== undefined && { azureRunbookName: azureRunbookName?.trim() || null }),
        updatedAt: new Date(),
      })
      .where(eq(powershellScriptsTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Script not found" }); return; }

    // Re-push to Azure when script body changed and a runbook name is set
    const bodyToSync = scriptBody?.trim() ?? updated.scriptBody;
    if (updated.azureRunbookName && bodyToSync) {
      void tryPushPsScriptToAzure(id, updated.azureRunbookName, bodyToSync);
    }

    res.json(updated);
  } catch (err) {
    logger.error({ err }, "Failed to update PS script");
    res.status(500).json({ error: "Failed to update script" });
  }
});

// ─── POST /api/admin/ps-scripts/:id/push-to-azure ─────────────────────────────

router.post("/admin/ps-scripts/:id/push-to-azure", requireAdmin, async (req: Request, res: Response) => {
  const id = String(req.params["id"] ?? "");
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  // Not configured: return a non-fatal warning (200) so the UI can show an
  // informational message without treating it as an error.
  if (!isAzureConfigured()) {
    logger.warn({ id }, "admin-ps-scripts: push-to-azure skipped — Azure not configured");
    res.json({ ok: false, warning: "Azure Automation is not configured on this server — push skipped" });
    return;
  }

  try {
    const [script] = await db
      .select()
      .from(powershellScriptsTable)
      .where(eq(powershellScriptsTable.id, id))
      .limit(1);

    if (!script) { res.status(404).json({ error: "Script not found" }); return; }

    if (!script.scriptBody?.trim()) {
      res.status(400).json({ error: "Script has no body to push" });
      return;
    }

    const runbookName = script.azureRunbookName ?? titleToRunbookName(script.title);

    await pushScriptToAzure(runbookName, script.scriptBody.trim());

    const [updatedRows] = await db
      .update(powershellScriptsTable)
      .set({ azureRunbookName: runbookName, azureSyncedAt: new Date() })
      .where(eq(powershellScriptsTable.id, id))
      .returning({ azureRunbookName: powershellScriptsTable.azureRunbookName, azureSyncedAt: powershellScriptsTable.azureSyncedAt });

    res.json({ ok: true, ...updatedRows });
  } catch (err) {
    logger.error({ err, id }, "admin-ps-scripts: push-to-azure failed");
    const msg = err instanceof Error ? err.message : "Push to Azure failed";
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/admin/ps-scripts/packages/:packageId/push-module ──────────────
// Pushes a single module by filename — used by the client to sequence pushes
// one-at-a-time so it can show real per-module progress in the dialog.

router.post("/admin/ps-scripts/packages/:packageId/push-module", requireAdmin, async (req: Request, res: Response) => {
  const packageId = String(req.params["packageId"] ?? "");
  const { filename } = req.body as { filename?: string };

  if (!UUID_RE.test(packageId)) { res.status(400).json({ error: "Invalid packageId" }); return; }
  if (!filename || typeof filename !== "string") { res.status(400).json({ error: "filename required" }); return; }

  if (!isAzureConfigured()) {
    res.json({ ok: false, warning: "Azure Automation is not configured on this server" });
    return;
  }

  try {
    const [mod] = await db
      .select()
      .from(scriptModulesTable)
      .where(and(eq(scriptModulesTable.packageId, packageId), eq(scriptModulesTable.filename, filename)))
      .limit(1);

    if (!mod) { res.status(404).json({ error: "Module not found" }); return; }

    const content = mod.content?.trim() ?? "";
    if (!content) { res.status(400).json({ error: "Module has no content" }); return; }

    const runbookName = filename
      .replace(/\.ps1$/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 63) || "script";

    await pushScriptToAzure(runbookName, content);
    res.json({ ok: true, filename, runbookName });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Push failed";
    logger.error({ err, packageId, filename }, "admin-ps-scripts: push-module failed");
    res.status(500).json({ ok: false, filename, error: msg });
  }
});

// ─── POST /api/admin/ps-scripts/packages/:packageId/push-to-azure ────────────

router.post("/admin/ps-scripts/packages/:packageId/push-to-azure", requireAdmin, async (req: Request, res: Response) => {
  const packageId = String(req.params["packageId"] ?? "");
  if (!UUID_RE.test(packageId)) { res.status(400).json({ error: "Invalid packageId" }); return; }

  if (!isAzureConfigured()) {
    res.json({ ok: false, warning: "Azure Automation is not configured on this server — push skipped", results: [] });
    return;
  }

  try {
    const mods = await db
      .select()
      .from(scriptModulesTable)
      .where(eq(scriptModulesTable.packageId, packageId))
      .orderBy(asc(scriptModulesTable.sortOrder));

    if (mods.length === 0) {
      res.status(404).json({ error: "No modules found for this package" });
      return;
    }

    // filenameToRunbookName is defined at module scope — reuse it here.
    type ModuleResult = { filename: string; runbookName: string; ok: boolean; error?: string };
    const results: ModuleResult[] = [];

    for (const mod of mods) {
      const filename = mod.filename ?? "module.ps1";
      const content = mod.content?.trim() ?? "";
      const runbookName = filenameToRunbookName(filename);

      if (!content) {
        results.push({ filename, runbookName, ok: false, error: "Module has no content" });
        continue;
      }

      try {
        await pushScriptToAzure(runbookName, content);
        results.push({ filename, runbookName, ok: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Push failed";
        results.push({ filename, runbookName, ok: false, error: msg });
      }
    }

    const allOk = results.every((r) => r.ok);
    logger.info({ packageId, results }, "admin-ps-scripts: package push-to-azure complete");
    res.json({ ok: allOk, results });
  } catch (err) {
    logger.error({ err, packageId }, "admin-ps-scripts: package push-to-azure failed");
    const msg = err instanceof Error ? err.message : "Push to Azure failed";
    res.status(500).json({ error: msg });
  }
});

// ─── DELETE /api/admin/ps-scripts/:id ────────────────────────────────────────

router.delete("/admin/ps-scripts/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = String(req.params["id"] ?? "");
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    await db.delete(powershellScriptsTable).where(eq(powershellScriptsTable.id, id));
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "Failed to delete PS script");
    res.status(500).json({ error: "Failed to delete script" });
  }
});

// ─── POST /api/admin/ps-scripts/fix ──────────────────────────────────────────

router.post("/admin/ps-scripts/fix", requireAdmin, async (req: Request, res: Response) => {
  const { scriptContent, bugDescription, customInstructions } = req.body as {
    scriptContent?: string;
    bugDescription?: string;
    customInstructions?: string;
  };
  if (!scriptContent || typeof scriptContent !== "string" || scriptContent.trim().length === 0) {
    res.status(400).json({ error: "scriptContent is required" });
    return;
  }
  if (!bugDescription || typeof bugDescription !== "string" || bugDescription.trim().length < 3) {
    res.status(400).json({ error: "bugDescription is required (min 3 characters)" });
    return;
  }

  const customBlock = customInstructions?.trim()
    ? `\n\nAdditional instructions:\n${customInstructions.trim()}`
    : "";

  const fixSystemPrompt = await getPrompt("ps-engineer-system", SYSTEM_PROMPT);

  try {
    // Assistant prefill forces Claude to begin its response with the script body
    // immediately — no prose preamble, no "Here is the fixed script:" sentence.
    // fullText will therefore start at the first line of the corrected PS code.
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 16000,
      messages: [
        {
          role: "user",
          content: `${fixSystemPrompt}${customBlock}

The user has reported a bug in the following PowerShell script. Fix it.

ORIGINAL SCRIPT:
\`\`\`powershell
${scriptContent.trim()}
\`\`\`

BUG REPORTED BY USER:
${bugDescription.trim()}

Output the corrected script, then a <fix-summary> block, then the permissions JSON. Follow this exact format with no commentary before the opening fence:

\`\`\`powershell
[corrected script here]
\`\`\`

<fix-summary>
[2-3 sentences: what was wrong and how it was fixed]
</fix-summary>

\`\`\`json
{"appPermissions": [...], "delegatedPermissions": [...], "notes": "..."}
\`\`\``,
        },
        // Prefill: Claude continues from here — response IS the script body
        { role: "assistant", content: "```powershell" },
      ],
    });

    const block = msg.content[0];
    if (block.type !== "text") {
      res.status(500).json({ error: "Unexpected AI response format" });
      return;
    }
    // fullText is the continuation of the prefilled "```powershell\n".
    // Script body ends at the first closing fence on its own line.
    const fullText = block.text;

    const closingFenceIdx = fullText.search(/^```\s*$/m);
    let fixedScript: string;
    if (closingFenceIdx >= 0) {
      fixedScript = fullText.slice(0, closingFenceIdx).trim();
    } else {
      // Closing fence missing (unexpected truncation) — grab everything before the
      // fix-summary or json block as a best-effort fallback.
      logger.warn(
        { rawResponsePrefix: fullText.slice(0, 500) },
        "fix endpoint: no closing powershell fence found; using marker-based fallback",
      );
      const summaryPos = fullText.indexOf("<fix-summary>");
      const jsonPos = fullText.search(/```json/i);
      const stopAt = Math.min(
        summaryPos >= 0 ? summaryPos : fullText.length,
        jsonPos >= 0 ? jsonPos : fullText.length,
      );
      fixedScript = fullText.slice(0, stopAt).trim();
    }

    // Heuristic guard: if the result contains no recognisable PowerShell keyword,
    // the AI returned only prose. Serving that would replace the editor with non-PS text.
    if (!hasPsKeywordsFullText(fixedScript)) {
      logger.error(
        { fixedScriptPrefix: fixedScript.slice(0, 300) },
        "fix endpoint: result contains no PS keywords — AI returned prose only; refusing to overwrite editor",
      );
      res.status(500).json({ error: "AI returned a summary instead of a script. Please try again.", aiResponse: fixedScript.slice(0, 3000) });
      return;
    }

    const fixSummaryMatch = fullText.match(/<fix-summary>([\s\S]*?)<\/fix-summary>/i);
    const fixSummary = fixSummaryMatch ? fixSummaryMatch[1].trim() : "";

    const rawPermissions = extractJson(fullText);
    let permissions: PsScriptPermissions = { appPermissions: [], delegatedPermissions: [], notes: "" };
    if (rawPermissions && typeof rawPermissions === "object" && !Array.isArray(rawPermissions)) {
      const p = rawPermissions as Record<string, unknown>;
      permissions = {
        appPermissions: Array.isArray(p["appPermissions"]) ? (p["appPermissions"] as string[]) : [],
        delegatedPermissions: Array.isArray(p["delegatedPermissions"]) ? (p["delegatedPermissions"] as string[]) : [],
        notes: typeof p["notes"] === "string" ? p["notes"] : "",
      };
    }

    res.json({ fixedScript, fixSummary, permissions });
  } catch (err) {
    logger.error({ err }, "PS script fix failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "AI fix failed" });
  }
});

// ─── POST /api/admin/ps-scripts/explain ──────────────────────────────────────

router.post("/admin/ps-scripts/explain", requireAdmin, async (req: Request, res: Response) => {
  const { scriptContent } = req.body as { scriptContent?: string };
  if (!scriptContent || typeof scriptContent !== "string" || scriptContent.trim().length === 0) {
    res.status(400).json({ error: "scriptContent is required" });
    return;
  }

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `You are a Microsoft 365 PowerShell expert. Analyse the following PowerShell script and produce a clear, concise explanation aimed at a technical admin.

Cover these points (use plain paragraphs, no markdown headers or bullet lists):
1. What the script does overall (one sentence summary).
2. Step-by-step breakdown of the key operations.
3. What Microsoft 365 services or Azure resources it touches.
4. Any permissions it requires to run.
5. Any side-effects, risks, or things to be aware of before running it.

SCRIPT:
\`\`\`powershell
${scriptContent.trim()}
\`\`\``,
        },
        { role: "assistant", content: "This script" },
      ],
    });

    const block = msg.content[0];
    if (block.type !== "text") {
      res.status(500).json({ error: "Unexpected AI response format" });
      return;
    }

    // Prepend the prefill so the explanation reads as a complete sentence
    const explanation = ("This script" + block.text).trim();
    res.json({ explanation });
  } catch (err) {
    logger.error({ err }, "PS script explain failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Explain failed" });
  }
});

// ─── POST /api/admin/ps-scripts/modularize ───────────────────────────────────

router.post("/admin/ps-scripts/modularize", requireAdmin, async (req: Request, res: Response) => {
  const { scriptContent, title, category, customInstructions } = req.body as {
    scriptContent?: string;
    title?: string;
    category?: string;
    customInstructions?: string;
  };
  if (!scriptContent || typeof scriptContent !== "string" || scriptContent.trim().length === 0) {
    res.status(400).json({ error: "scriptContent is required" });
    return;
  }

  const customBlock = customInstructions?.trim()
    ? `\n\nAdditional instructions:\n${customInstructions.trim()}`
    : "";

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 16000,
      messages: [
        {
          role: "user",
          content: `You are an expert Microsoft 365 PowerShell script engineer.${customBlock}

Decompose the following monolithic PowerShell script into smaller, single-responsibility modules.

ORIGINAL SCRIPT:
\`\`\`powershell
${scriptContent.trim()}
\`\`\`

Requirements:
1. Identify logical sections: connection helpers, data-retrieval functions, processing logic, output/export
2. Create 3–6 focused modules plus a Main.ps1 orchestrator
3. Main.ps1 must dot-source all other modules (using . .\\\\ModuleName.ps1) and orchestrate execution
4. Each module must be self-contained, well-commented, and focused on ONE responsibility
5. Preserve ALL original functionality — nothing should be lost
6. Use Write-Output (NOT Write-Host) for any console output in the modules — Write-Host bypasses the pipeline

Return ONLY a JSON array inside a \`\`\`json fence. No other text.

\`\`\`json
[
  { "filename": "HelperModule.ps1", "description": "One-line description", "content": "# full script content" },
  { "filename": "Main.ps1", "description": "Orchestrator — dot-sources all modules and runs the workflow", "content": "# full Main.ps1 content" }
]
\`\`\`

Rules:
- All filenames must end in .ps1
- Main.ps1 must be the LAST entry
- Return only the JSON array, nothing else`,
        },
      ],
    });

    const block = msg.content[0];
    if (block.type !== "text") {
      res.status(500).json({ error: "Unexpected AI response format" });
      return;
    }

    const rawModules = extractJsonArray(block.text);
    if (!rawModules || rawModules.length === 0) {
      logger.warn({ text: block.text.slice(0, 500) }, "ps-scripts/modularize: failed to parse JSON array from AI");
      res.status(500).json({ error: "AI response did not contain a valid module array" });
      return;
    }

    const validModules = rawModules
      .filter((m): m is Record<string, unknown> => m !== null && typeof m === "object" && !Array.isArray(m))
      .filter((m) => typeof m["filename"] === "string" && typeof m["content"] === "string")
      .map((m) => ({
        filename: String(m["filename"]),
        description: typeof m["description"] === "string" ? m["description"] : null,
        content: String(m["content"]),
      }));

    if (validModules.length === 0) {
      res.status(500).json({ error: "AI returned no valid modules" });
      return;
    }

    // Heuristic guard: if any module's content contains no recognisable
    // PowerShell keyword, the AI returned prose instead of actual scripts.
    // Serving that to the client would overwrite the editor with non-PS text.
    const hasProseOnly = validModules.some((m) => !hasPsKeywordsFullText(m.content));
    if (hasProseOnly) {
      logger.error(
        { moduleCount: validModules.length },
        "modularize endpoint: one or more modules contain no PS keywords — AI returned prose only; refusing to overwrite editor",
      );
      const proseModules = validModules.filter((m) => !hasPsKeywordsFullText(m.content));
      const aiResponseText = proseModules.map((m) => `### ${m.filename}\n${m.content}`).join("\n\n").slice(0, 3000);
      res.status(500).json({ error: "AI returned a summary instead of a script. Please try again.", aiResponse: aiResponseText });
      return;
    }

    const packageTitle = title?.trim() || "Modular Package";
    const [pkg] = await db
      .insert(scriptPackagesTable)
      .values({ title: packageTitle, category: category ?? "other" })
      .returning();

    await db.insert(scriptModulesTable).values(
      validModules.map((m, i) => ({
        packageId: pkg.id,
        filename: m.filename,
        description: m.description,
        content: m.content,
        sortOrder: i,
      })),
    );

    logger.info({ packageId: pkg.id, moduleCount: validModules.length }, "ps-scripts/modularize: saved package");
    res.json({ packageId: pkg.id, title: packageTitle, modules: validModules });
  } catch (err) {
    logger.error({ err }, "PS script modularize failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Modularization failed" });
  }
});

// ─── Service Script Sets ──────────────────────────────────────────────────────

// GET /api/admin/services/:id/script-sets
router.get("/admin/services/:id/script-sets", requireAdmin, async (req: Request, res: Response) => {
  const serviceId = parseInt(String(req.params.id));
  if (isNaN(serviceId)) { res.status(400).json({ error: "Invalid service id" }); return; }

  try {
    const rows = await db
      .select({
        scriptPackageId: serviceScriptSetsTable.scriptPackageId,
        displayOrder: serviceScriptSetsTable.displayOrder,
        title: scriptPackagesTable.title,
        category: scriptPackagesTable.category,
        tags: scriptPackagesTable.tags,
        permissions: scriptPackagesTable.permissions,
        createdAt: scriptPackagesTable.createdAt,
      })
      .from(serviceScriptSetsTable)
      .innerJoin(scriptPackagesTable, eq(serviceScriptSetsTable.scriptPackageId, scriptPackagesTable.id))
      .where(eq(serviceScriptSetsTable.serviceId, serviceId))
      .orderBy(asc(serviceScriptSetsTable.displayOrder));
    res.json(rows);
  } catch (err) {
    logger.error({ err, serviceId }, "admin-ps-scripts: failed to list service script sets");
    res.status(500).json({ error: "Failed to list script sets" });
  }
});

// POST /api/admin/services/:id/script-sets
router.post("/admin/services/:id/script-sets", requireAdmin, async (req: Request, res: Response) => {
  const serviceId = parseInt(String(req.params.id));
  if (isNaN(serviceId)) { res.status(400).json({ error: "Invalid service id" }); return; }

  const { scriptPackageId } = req.body as { scriptPackageId?: string };
  if (!scriptPackageId || typeof scriptPackageId !== "string") {
    res.status(400).json({ error: "scriptPackageId is required" }); return;
  }

  try {
    const [maxRow] = await db
      .select({ maxOrder: sql<number>`coalesce(max(${serviceScriptSetsTable.displayOrder}), -1)` })
      .from(serviceScriptSetsTable)
      .where(eq(serviceScriptSetsTable.serviceId, serviceId));
    const nextOrder = (maxRow?.maxOrder ?? -1) + 1;
    await db
      .insert(serviceScriptSetsTable)
      .values({ serviceId, scriptPackageId, displayOrder: nextOrder })
      .onConflictDoNothing();
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, serviceId, scriptPackageId }, "admin-ps-scripts: failed to add service script set");
    res.status(500).json({ error: "Failed to link script package to service" });
  }
});

// PATCH /api/admin/services/:id/script-sets/reorder
// Body: { order: string[] }  — array of scriptPackageIds in desired display order
router.patch("/admin/services/:id/script-sets/reorder", requireAdmin, async (req: Request, res: Response) => {
  const serviceId = parseInt(String(req.params.id));
  if (isNaN(serviceId)) { res.status(400).json({ error: "Invalid service id" }); return; }

  const { order } = req.body as { order?: string[] };
  if (!Array.isArray(order)) { res.status(400).json({ error: "order must be an array of scriptPackageIds" }); return; }

  try {
    await Promise.all(
      order.map((scriptPackageId, idx) =>
        db.update(serviceScriptSetsTable)
          .set({ displayOrder: idx })
          .where(and(
            eq(serviceScriptSetsTable.serviceId, serviceId),
            eq(serviceScriptSetsTable.scriptPackageId, scriptPackageId),
          ))
      )
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, serviceId }, "admin-ps-scripts: failed to reorder script sets");
    res.status(500).json({ error: "Failed to reorder script sets" });
  }
});

// POST /api/admin/services/:id/run-script-sets
// Returns the ordered execution plan (sets ordered by displayOrder, modules within each set by sortOrder).
// Body: { customerId?: number }
// Actual Azure Automation execution is wired in a follow-up task.
router.post("/admin/services/:id/run-script-sets", requireAdmin, async (req: Request, res: Response) => {
  const serviceId = parseInt(String(req.params.id));
  if (isNaN(serviceId)) { res.status(400).json({ error: "Invalid service id" }); return; }

  const { customerId } = req.body as { customerId?: number };

  try {
    // 1. Fetch ordered packages linked to this service
    const sets = await db
      .select({
        scriptPackageId: serviceScriptSetsTable.scriptPackageId,
        displayOrder: serviceScriptSetsTable.displayOrder,
        title: scriptPackagesTable.title,
        category: scriptPackagesTable.category,
        permissions: scriptPackagesTable.permissions,
      })
      .from(serviceScriptSetsTable)
      .innerJoin(scriptPackagesTable, eq(serviceScriptSetsTable.scriptPackageId, scriptPackagesTable.id))
      .where(eq(serviceScriptSetsTable.serviceId, serviceId))
      .orderBy(asc(serviceScriptSetsTable.displayOrder));

    if (sets.length === 0) {
      res.json({ ok: true, message: "No script packages linked to this service.", executionPlan: [], customerId: customerId ?? null });
      return;
    }

    // 2. Fetch ordered modules for each package
    const packageIds = sets.map(s => s.scriptPackageId);
    const modules = await db
      .select({
        packageId: scriptModulesTable.packageId,
        filename: scriptModulesTable.filename,
        description: scriptModulesTable.description,
        sortOrder: scriptModulesTable.sortOrder,
      })
      .from(scriptModulesTable)
      .where(inArray(scriptModulesTable.packageId, packageIds))
      .orderBy(asc(scriptModulesTable.sortOrder));

    // 3. Build execution plan: each package with its ordered modules
    const executionPlan = sets.map(s => ({
      ...s,
      modules: modules
        .filter(m => m.packageId === s.scriptPackageId)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    }));

    res.json({
      ok: true,
      message: "Execution plan built. Automated run-script-sets execution is pending a follow-up task.",
      customerId: customerId ?? null,
      executionPlan,
    });
  } catch (err) {
    logger.error({ err, serviceId }, "admin-ps-scripts: failed to build run-script-sets plan");
    res.status(500).json({ error: "Failed to build script sets execution plan" });
  }
});

// DELETE /api/admin/services/:id/script-sets/:packageId
router.delete("/admin/services/:id/script-sets/:packageId", requireAdmin, async (req: Request, res: Response) => {
  const serviceId = parseInt(String(req.params.id));
  const scriptPackageId = String(req.params.packageId ?? "");
  if (isNaN(serviceId) || !scriptPackageId) { res.status(400).json({ error: "Invalid ids" }); return; }

  try {
    await db
      .delete(serviceScriptSetsTable)
      .where(and(
        eq(serviceScriptSetsTable.serviceId, serviceId),
        eq(serviceScriptSetsTable.scriptPackageId, scriptPackageId),
      ));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, serviceId, scriptPackageId }, "admin-ps-scripts: failed to remove service script set");
    res.status(500).json({ error: "Failed to unlink script package from service" });
  }
});

export default router;
