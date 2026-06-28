import { Router, type Request, type Response } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { db } from "@workspace/db";
import {
  powershellScriptsTable,
  scriptPackagesTable,
  scriptModulesTable,
  servicesTable,
  workflowTemplatesTable,
  workflowTemplateStepsTable,
  workflowTemplateStepTasksTable,
  type PsScriptPermissions,
  type ScriptModule,
} from "@workspace/db";
import { eq, desc, asc, inArray, and } from "drizzle-orm";
import { logger } from "../lib/logger.ts";
import { hasPsKeywordsFullText } from "../lib/ps-guard.ts";
import { isAzureConfigured, pushScriptToAzure } from "../lib/azure-automation.ts";

// ─── Runbook name helpers ─────────────────────────────────────────────────────

function titleToRunbookName(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63) || "script";
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

// Extract all ```powershell fences, keyed by the leading "# file: <filename>" comment.
function extractPowershellFences(text: string): Map<string, string> {
  const scripts = new Map<string, string>();
  let searchFrom = 0;
  while (true) {
    const openPos = text.indexOf("```powershell", searchFrom);
    if (openPos === -1) break;
    const afterOpen = text.indexOf("\n", openPos);
    if (afterOpen === -1) break;
    const closePos = text.indexOf("```", afterOpen + 1);
    if (closePos === -1) break;
    const content = text.slice(afterOpen + 1, closePos).trimEnd();
    const headerMatch = content.match(/^#\s*file:\s*(\S+\.ps1)/i);
    if (headerMatch) scripts.set(headerMatch[1], content);
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

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: `${SYSTEM_PROMPT}${baseBlock}${detailedBlock}

Category: ${categoryLabel}

Task description: ${prompt.trim()}

Write the complete PowerShell script followed by the permissions JSON block.`,
        },
      ],
    });

    const block = msg.content[0];
    if (block.type !== "text") {
      res.status(500).json({ error: "Unexpected AI response format" });
      return;
    }

    const fullText = block.text;

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
    // character-window check would give false positives). Return a 500 so the editor
    // is never overwritten with non-PS text.
    if (!hasPsKeywordsFullText(scriptBody)) {
      logger.error(
        { scriptBodyPrefix: scriptBody.slice(0, 300) },
        "generate endpoint: fallback result contains no PS keywords — AI returned prose only; refusing to send to client",
      );
      res.status(500).json({ error: "AI returned a summary instead of a script. Please try again.", aiResponse: scriptBody.slice(0, 3000) });
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

    res.json({ script: scriptBody, permissions });
  } catch (err) {
    logger.error({ err }, "PS script generation failed");
    const msg = err instanceof Error ? err.message : "AI generation failed";
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/admin/ps-scripts/generate-from-service ────────────────────────

const GENERATE_FROM_SERVICE_SYSTEM = `You are an expert Microsoft 365 PowerShell script engineer with 20+ years of experience across Azure, Exchange Online, SharePoint, Teams, Intune, Defender, Entra ID, and related services.

You will receive a consulting service definition and its delivery workflow (phases + tasks).

STEP 1 — CLASSIFY every task as one of:
  AUTOMATABLE — executable as PowerShell against M365/Azure APIs:
    • Data queries / reporting (Graph API, Exchange cmdlets, SharePoint CSOM/PnP)
    • Configuration changes (mailbox settings, Teams policies, SharePoint site provisioning, Intune profiles, Conditional Access, Sensitivity Labels, DLP rules, Retention policies, Defender settings)
    • User/group/license management via Entra ID / Exchange
    • Azure resource provisioning or querying
  HUMAN_ONLY — requires a human by nature:
    • Client calls, kickoff meetings, status updates, emails, document review
    • Business decisions, approvals, sign-off, risk acceptance
    • Physical / in-person tasks, vendor negotiations

STEP 2 — For every AUTOMATABLE task, write a complete production-ready PowerShell script:
  - [CmdletBinding()] attribute + param() block with typed, documented parameters (-TenantId, -ClientId, -ClientSecret where applicable)
  - $ErrorActionPreference = "Stop"
  - Structured try/catch/finally error handling
  - Write-Output (NOT Write-Host) for all console output — Write-Error and Write-Warning are acceptable for their respective streams
  - Inline comments explaining each logical section
  - CSV export where applicable
  - Never use Write-Host — always Write-Output

STEP 3 — Choose output shape:
  - ALL tasks are HUMAN_ONLY (nothing can be automated) → type "human-only": explanatory note only, no script
  - ONE automatable phase (or all tasks belong to a single phase) → type "single": one consolidated script
  - MULTIPLE distinct automatable phases → type "package": one focused module per phase + a Main.ps1 orchestrator that dot-sources them all

Output format — STRICT RULES:
1. Always start with a single \`\`\`json fence containing ONLY metadata (no PowerShell code inside the JSON).
2. After the closing \`\`\` of the JSON fence, output each script in its own \`\`\`powershell fence.
3. The very first line of every \`\`\`powershell fence MUST be: # file: <filename.ps1>
4. No prose, explanations, or text outside the fences.

Human-only shape (use when NO tasks are automatable):
\`\`\`json
{
  "type": "human-only",
  "title": "Service Workflow — All Tasks Require Human Action",
  "explanation": "Concise explanation of why no PowerShell automation applies to this workflow.",
  "humanOnlyTasks": ["task description 1", "task description 2"]
}
\`\`\`

Single script shape — JSON envelope then one powershell fence:
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

Package shape — JSON envelope then one powershell fence per module in the same order:
\`\`\`json
{
  "type": "package",
  "title": "Package title (max 80 chars)",
  "modules": [
    { "filename": "01-Phase.ps1", "description": "One-line description" },
    { "filename": "Main.ps1", "description": "Orchestrator — dot-sources all modules and runs the workflow" }
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
# file: 01-Phase.ps1
# Full script for this module
\`\`\`
\`\`\`powershell
# file: Main.ps1
# Orchestrator script
\`\`\`

Rules:
- All filenames must end in .ps1; Main.ps1 must be the LAST module entry
- Do NOT put any script code inside the JSON object — all code goes in the \`\`\`powershell fences
- At the top of EVERY powershell script (after the # file: line), insert a comment block listing human-only tasks that apply:
  # ─── HUMAN ACTION REQUIRED — steps NOT automated by this script ───────────────
  # • Client kickoff call: Schedule and conduct an introductory call with the client
  # • Approval sign-off: Obtain written approval before applying configuration changes
  # ─────────────────────────────────────────────────────────────────────────────
  If there are no human-only tasks, omit the block entirely.
- Include HUMAN_ONLY tasks in "humanOnlyTasks" for documentation — never generate code for them
- Be specific about permission scopes (e.g. "Group.Read.All (Microsoft Graph Application)" not just "Group.Read.All")
- Distinguish Application permissions (service principal / app-only) from Delegated (signed-in user)`;

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

    const aiMsg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 16000,
      messages: [{ role: "user", content: `${GENERATE_FROM_SERVICE_SYSTEM}\n\n${userMessage}` }],
    });

    const aiBlock = aiMsg.content[0];
    if (aiBlock.type !== "text") {
      res.status(500).json({ error: "Unexpected AI response format" });
      return;
    }

    // Parse the JSON envelope (metadata only — no script content inside the JSON).
    const rawJson = extractEnvelopeJson(aiBlock.text);
    if (!rawJson || typeof rawJson !== "object" || Array.isArray(rawJson)) {
      logger.warn(
        { textLength: aiBlock.text.length, textPrefix: aiBlock.text.slice(0, 400) },
        "generate-from-service: failed to parse JSON envelope from AI response",
      );
      res.status(500).json({ error: "AI returned an unstructured response. Please try again." });
      return;
    }

    // Extract the PowerShell scripts from their own ```powershell fences.
    const psScripts = extractPowershellFences(aiBlock.text);

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
      res.json({ type: "human-only", title, explanation, humanOnlyTasks });
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
        res.status(500).json({ error: "AI returned a package with no modules. Please try again." });
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
          { psScriptKeys: [...psScripts.keys()], textLength: aiBlock.text.length },
          "generate-from-service: no modules with content found",
        );
        res.status(500).json({ error: "AI returned no valid modules. Please try again." });
        return;
      }

      if (validModules.some((m) => !hasPsKeywordsFullText(m.content))) {
        logger.error(
          { moduleCount: validModules.length },
          "generate-from-service: one or more modules contain no PS keywords — refusing to send",
        );
        res.status(500).json({ error: "AI returned a description instead of a script. Please try again." });
        return;
      }

      const packageTitle =
        (typeof parsed["title"] === "string" ? parsed["title"].trim() : null) || service.name;

      const [pkg] = await db
        .insert(scriptPackagesTable)
        .values({ title: packageTitle, category: "m365" })
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

      logger.info(
        { packageId: pkg.id, moduleCount: validModules.length, service: service.name },
        "generate-from-service: saved package",
      );
      res.json({ type: "package", packageId: pkg.id, title: packageTitle, modules: validModules, humanOnlyTasks, permissions });
      return;
    }

    // type === "single" — script comes from the first ```powershell fence.
    const fenceScript = psScripts.size > 0 ? [...psScripts.values()][0] : "";
    const scriptBody = fenceScript || (typeof parsed["scriptBody"] === "string" ? parsed["scriptBody"].trim() : "");

    if (scriptBody.length < 20 || !hasPsKeywordsFullText(scriptBody)) {
      logger.error(
        { scriptBodyPrefix: scriptBody.slice(0, 300), psScriptCount: psScripts.size },
        "generate-from-service: scriptBody is empty or contains no PS keywords",
      );
      res.status(500).json({ error: "AI returned an unreadable script. Please try again." });
      return;
    }

    const title =
      (typeof parsed["title"] === "string" ? parsed["title"].trim() : null) || service.name;

    res.json({ type: "single", title, script: scriptBody, humanOnlyTasks, permissions });
  } catch (err) {
    logger.error({ err }, "generate-from-service failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Generation failed" });
  }
});

// ─── GET /api/admin/ps-scripts ────────────────────────────────────────────────

router.get("/admin/ps-scripts", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const scripts = await db
      .select({
        id: powershellScriptsTable.id,
        title: powershellScriptsTable.title,
        description: powershellScriptsTable.description,
        category: powershellScriptsTable.category,
        tags: powershellScriptsTable.tags,
        azureRunbookName: powershellScriptsTable.azureRunbookName,
        azureSyncedAt: powershellScriptsTable.azureSyncedAt,
        createdAt: powershellScriptsTable.createdAt,
        updatedAt: powershellScriptsTable.updatedAt,
      })
      .from(powershellScriptsTable)
      .orderBy(desc(powershellScriptsTable.createdAt));
    res.json(scripts);
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

  const { title, category } = req.body as { title?: string; category?: string };

  try {
    const [updated] = await db
      .update(scriptPackagesTable)
      .set({
        ...(title !== undefined && { title: title.trim() }),
        ...(category !== undefined && { category }),
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

  const { filename, description, content, sortOrder } = req.body as {
    filename?: string;
    description?: string;
    content?: string;
    sortOrder?: number;
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

  const { filename, description, content, sortOrder } = req.body as {
    filename?: string;
    description?: string;
    content?: string;
    sortOrder?: number;
  };

  try {
    const [updated] = await db
      .update(scriptModulesTable)
      .set({
        ...(filename !== undefined && { filename: filename.trim() }),
        ...(description !== undefined && { description: description?.trim() ?? null }),
        ...(content !== undefined && { content }),
        ...(sortOrder !== undefined && { sortOrder }),
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

  const { title, description, category, scriptBody, permissions, tags } = req.body as {
    title?: string;
    description?: string;
    category?: string;
    scriptBody?: string;
    permissions?: PsScriptPermissions;
    tags?: string[];
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

    function filenameToRunbookName(filename: string): string {
      // Strip .ps1 extension then sanitize like titleToRunbookName
      return filename
        .replace(/\.ps1$/i, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 63) || "script";
    }

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

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 8192,
      messages: [
        {
          role: "user",
          content: `${SYSTEM_PROMPT}${customBlock}

The user has reported a bug in the following PowerShell script. Fix it.

ORIGINAL SCRIPT:
\`\`\`powershell
${scriptContent.trim()}
\`\`\`

BUG REPORTED BY USER:
${bugDescription.trim()}

Provide the corrected script in a \`\`\`powershell fence. Then include a <fix-summary> block with 2-3 sentences describing what was changed and why. Finally, include the updated permissions JSON block.

\`\`\`powershell
[corrected script here]
\`\`\`

<fix-summary>
[Brief explanation of what was wrong and how it was fixed]
</fix-summary>

\`\`\`json
{"appPermissions": [...], "delegatedPermissions": [...], "notes": "..."}
\`\`\``,
        },
      ],
    });

    const block = msg.content[0];
    if (block.type !== "text") {
      res.status(500).json({ error: "Unexpected AI response format" });
      return;
    }
    const fullText = block.text;

    const fixSummaryMatch = fullText.match(/<fix-summary>([\s\S]*?)<\/fix-summary>/i);
    const fixSummary = fixSummaryMatch ? fixSummaryMatch[1].trim() : "";

    const summaryStart = fixSummaryMatch ? fullText.indexOf("<fix-summary>") : fullText.length;
    const jsonStart = fullText.search(/```json/i);
    const stopAt = Math.min(
      summaryStart > 0 ? summaryStart : fullText.length,
      jsonStart > 0 ? jsonStart : fullText.length,
    );
    const rawScript = fullText.slice(0, stopAt);
    let fixedScript = rawScript
      .replace(/```powershell\s*/gi, "")
      .replace(/```\s*$/gm, "")
      .trim();

    if (fixedScript.length < 20) {
      logger.warn(
        { rawResponsePrefix: fullText.slice(0, 500) },
        "fix endpoint: fixedScript extraction yielded empty/short result; applying safe fallback",
      );
      // Safe fallback: return the full text stripped of the JSON block and fences
      const jsonBlockRe = /```json[\s\S]*?```/gi;
      fixedScript = fullText
        .replace(jsonBlockRe, "")
        .replace(/<fix-summary>[\s\S]*?<\/fix-summary>/gi, "")
        .replace(/```powershell\s*/gi, "")
        .replace(/```\s*$/gm, "")
        .trim();
    }

    // Heuristic guard: if the full text contains no recognisable PowerShell keyword,
    // the AI returned only prose. Serving that to the client would replace the editor
    // with non-PS text.
    if (!hasPsKeywordsFullText(fixedScript)) {
      logger.error(
        { fixedScriptPrefix: fixedScript.slice(0, 300) },
        "fix endpoint: fallback result contains no PS keywords — AI returned prose only; refusing to overwrite editor",
      );
      res.status(500).json({ error: "AI returned a summary instead of a script. Please try again.", aiResponse: fixedScript.slice(0, 3000) });
      return;
    }

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

export default router;
