import { Router, type Request, type Response } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { requireAdmin, requireCapability } from "../middlewares/requireAuth.ts";
import { db, pool } from "@workspace/db";
import {
  powershellScriptsTable,
  scriptPackagesTable,
  scriptModulesTable,
  type PsScriptPermissions,
  type ScriptModule,
} from "@workspace/db";
import { eq, desc, asc, inArray, and, isNotNull } from "drizzle-orm";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "workflow.script" });
import { hasPsKeywordsFullText } from "../lib/ps-guard.ts";
import { getPrompt } from "../lib/prompt-loader.ts";
import {
  normalizeAppPerms,
  jsonParse,
  extractEnvelopeJson,
  extractPowershellFences,
  extractJson,
  extractJsonArray,
} from "../lib/ps-script-gen.ts";

const router = Router();

/** Converts a title to a safe filename slug (alphanumeric + hyphens, max 63 chars). */
function titleToSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63) || "script";
}

// ─── Helpers (canonical implementations live in ps-script-gen.ts; imported above) ──

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
  "workflow-generated": "Workflow Generated",
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
      log.warn(
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
      log.error(
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
        appPermissions: Array.isArray(p["appPermissions"]) ? normalizeAppPerms(p["appPermissions"] as unknown[]) : [],
        delegatedPermissions: Array.isArray(p["delegatedPermissions"]) ? (p["delegatedPermissions"] as string[]) : [],
        notes: typeof p["notes"] === "string" ? p["notes"] : "",
      };
    }

    sendSSE({ type: "done", payload: { script: scriptBody, permissions } });
    res.end();
  } catch (err) {
    log.error({ err }, "PS script generation failed");
    sendError(err instanceof Error ? err.message : "AI generation failed");
  }
});

// ─── POST /api/admin/ps-scripts/generate-from-task ────────────────────────────
// Generates a single PowerShell script for a specific workflow task, saves it
// to the library with source_task_id, and immediately sets runbook_id on the task.

const GENERATE_FROM_TASK_SYSTEM = `You are an expert Microsoft 365 PowerShell script engineer with 20+ years of experience.

Given a single workflow task, classify it and generate an appropriate PowerShell script.

CLASSIFY the task as one of:
  AUTOMATABLE — runs UNATTENDED as an app-only service principal (App Registration with client credentials).
    ★ APPLICATION PERMISSIONS ONLY — never Delegated permissions. There is no signed-in user; only Microsoft Graph Application scopes are valid (e.g. User.Read.All, not User.Read).
    ★ NO interactive login, no licensed user account, no MFA — must authenticate entirely via -ClientId / -ClientSecret or a certificate.
    ★ Output via Write-Output ONLY — only the output stream is captured. Write-Host, Export-Csv, Out-File, Set-Content are silently lost.
    ★ permissions.delegatedPermissions MUST be [] for every AUTOMATABLE script.
  USER_ACCOUNT_REQUIRED — can be scripted but REQUIRES a real licensed user account with delegated/interactive auth. CANNOT run as an app-only service principal.
  HUMAN_ONLY — cannot be scripted at all (meetings, approvals, document review, client calls, business decisions)

Classification rules:
  - Migration cmdlets (New-MigrationBatch etc.) → USER_ACCOUNT_REQUIRED
  - Connect-MicrosoftTeams → USER_ACCOUNT_REQUIRED
  - ANY Connect-MgGraph -Scopes → USER_ACCOUNT_REQUIRED
  - Reporting, Entra, SharePoint (PnP app-only), Intune via Graph Application → AUTOMATABLE
  - If unsure whether a cmdlet supports app-only auth → USER_ACCOUNT_REQUIRED

For AUTOMATABLE tasks (app-only / unattended):
  - [CmdletBinding()] attribute + typed param() block with -TenantId, -ClientId, -ClientSecret where applicable
  - Authentication MUST use app-only credentials: Connect-MgGraph -ClientId -TenantId -ClientSecret (or cert), Connect-PnPOnline -ClientId/-ClientSecret, Connect-AzAccount -ServicePrincipal
  - NEVER use -Scopes, -Interactive, or any delegated auth flow — the script has no signed-in user
  - Inline comments explaining each logical section

For USER_ACCOUNT_REQUIRED tasks:
  - [CmdletBinding()] attribute + typed param() block — OMIT -ClientId/-ClientSecret/-CertificateThumbprint entirely
  - Use interactive auth: Connect-MgGraph -Scopes "...", Connect-ExchangeOnline (no -AppId), Connect-PnPOnline -Interactive
  - Inline comments explaining each logical section

Both types:
  - $ErrorActionPreference = "Stop"
  - Structured try/catch/finally error handling
  - Write-Output (NOT Write-Host) for all console output — Write-Error and Write-Warning are acceptable
  - NEVER write output to files — all results MUST go to the output stream via Write-Output
  - FORBIDDEN: Export-Csv, Out-File, Set-Content, Add-Content, New-Item (for file creation), Write-Host — Write-Host bypasses the pipeline

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
{"type":"manual","title":"Brief script title max 60 chars","permissions":{"appPermissions":[],"delegatedPermissions":["e.g. MailboxSettings.ReadWrite (Microsoft Graph Delegated)"],"notes":"Must run interactively under a licensed user account. Cannot run as an app-only service principal."}}
\`\`\`
\`\`\`powershell
# file: script.ps1
# ===========================================================================
# WARNING: MANUAL EXECUTION REQUIRED
# This script uses delegated/interactive authentication and MUST be run
# locally under a licensed user account with appropriate permissions.
# It cannot run as an app-only service principal.
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
    log.info({ taskId, title: task.title }, "generate-from-task: calling Claude");

    const aiResponse = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });

    const rawText = aiResponse.content.filter(b => b.type === "text").map(b => b.text).join("");

    const jsonFenceMatch = rawText.match(/```json\s*([\s\S]*?)```/);
    if (!jsonFenceMatch) {
      log.error({ rawText: rawText.slice(0, 500) }, "generate-from-task: no JSON fence");
      res.status(500).json({ error: "AI returned unrecognised format. Please try again." });
      return;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonFenceMatch[1]!) as Record<string, unknown>;
    } catch {
      log.error({ raw: jsonFenceMatch[1]?.slice(0, 300) }, "generate-from-task: JSON parse failed");
      res.status(500).json({ error: "AI returned malformed JSON. Please try again." });
      return;
    }

    const type = typeof parsed["type"] === "string" ? parsed["type"] : "single";
    const title = (typeof parsed["title"] === "string" ? parsed["title"].trim() : null) || task.title;
    const rawParsedPerms = parsed["permissions"];
    const permissions: PsScriptPermissions = (rawParsedPerms && typeof rawParsedPerms === "object" && !Array.isArray(rawParsedPerms))
      ? {
          appPermissions: Array.isArray((rawParsedPerms as Record<string,unknown>)["appPermissions"]) ? normalizeAppPerms((rawParsedPerms as Record<string,unknown>)["appPermissions"] as unknown[]) : [],
          delegatedPermissions: Array.isArray((rawParsedPerms as Record<string,unknown>)["delegatedPermissions"]) ? ((rawParsedPerms as Record<string,unknown>)["delegatedPermissions"] as string[]) : [],
          notes: typeof (rawParsedPerms as Record<string,unknown>)["notes"] === "string" ? ((rawParsedPerms as Record<string,unknown>)["notes"] as string) : "",
        }
      : { appPermissions: [], delegatedPermissions: [], notes: "" };

    if (type === "human-only") {
      const explanation = typeof parsed["explanation"] === "string"
        ? parsed["explanation"]
        : "This task requires human action and cannot be automated.";
      log.info({ taskId }, "generate-from-task: human-only");
      res.json({ type: "human-only", title, explanation });
      return;
    }

    const psFenceMatch = rawText.match(/```powershell\s*([\s\S]*?)```/);
    const scriptBody = psFenceMatch
      ? psFenceMatch[1]!.replace(/^#\s*file:.*\n/, "").trim()
      : "";

    if (scriptBody.length < 20 || !hasPsKeywordsFullText(scriptBody)) {
      log.error({ scriptBodyPrefix: scriptBody.slice(0, 300) }, "generate-from-task: empty/no PS keywords");
      res.status(500).json({ error: "AI returned an unreadable script. Please try again." });
      return;
    }

    const tags: string[] = type === "manual" ? ["manual"] : [];

    const savedRow = await pool.query<{ id: string; title: string }>(
      `INSERT INTO powershell_scripts (title, category, script_body, permissions, tags, source_task_id)
       VALUES ($1, 'task', $2, $3::jsonb, $4::text[], $5)
       RETURNING id, title`,
      [title, scriptBody, JSON.stringify(permissions), tags, taskId],
    );
    const saved = savedRow.rows[0]!;

    // Write the script's UUID as runbook_id (FK to powershell_scripts.id — single source of truth)
    await pool.query(
      `UPDATE workflow_template_step_tasks SET runbook_id = $1 WHERE id = $2`,
      [saved.id, taskId],
    );

    log.info({ scriptId: saved.id, taskId, runbookId: saved.id }, "generate-from-task: saved and linked");
    res.json({ type, scriptId: saved.id, title: saved.title, runbookId: saved.id });
  } catch (err) {
    log.error({ err }, "generate-from-task failed");
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
    const row = await pool.query<{ source_task_id: number | null; title: string }>(
      `SELECT source_task_id, title FROM powershell_scripts WHERE id = $1`,
      [scriptId],
    );
    if (row.rowCount === 0) { res.status(404).json({ error: "Script not found" }); return; }
    const script = row.rows[0]!;
    if (!script.source_task_id) {
      res.json({ assigned: 0, message: "No source task recorded for this script." });
      return;
    }
    // Write the script's UUID as runbook_id (FK to powershell_scripts.id — single source of truth)
    const updateResult = await pool.query(
      `UPDATE workflow_template_step_tasks SET runbook_id = $1 WHERE id = $2 RETURNING id`,
      [scriptId, script.source_task_id],
    );
    const assigned = updateResult.rowCount ?? 0;
    log.info({ scriptId, assigned, taskId: script.source_task_id, runbookId: scriptId }, "assign-task: runbook_id set");
    res.json({ assigned, taskId: script.source_task_id });
  } catch (err) {
    log.error({ err }, "Failed to assign script to task");
    res.status(500).json({ error: "Failed to assign script to task" });
  }
});

// ─── GET /api/admin/ps-scripts/published ─────────────────────────────────────
// Returns a merged list of all runnable entries for the "Linked Runbook" dropdown:
//   • Platform-published scripts — id = powershell_scripts UUID
//   • All script modules — id = script_modules UUID
// All IDs are UUIDs (FK-compatible with workflow_template_step_tasks.runbook_id).

router.get("/admin/ps-scripts/published", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [scripts, modules] = await Promise.all([
      db
        .select({
          id: powershellScriptsTable.id,
          title: powershellScriptsTable.title,
          platformPublished: powershellScriptsTable.platformPublished,
        })
        .from(powershellScriptsTable)
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

    const scriptEntries = scripts.map(s => ({ id: s.id, title: s.title, platformPublished: s.platformPublished }));
    const moduleEntries = modules.map(m => ({
      id: m.id,
      title: m.title ?? m.filename.replace(/\.ps1$/i, "").replace(/-/g, " "),
    }));

    res.json([...scriptEntries, ...moduleEntries]);
  } catch (err) {
    log.error({ err }, "Failed to list published PS scripts");
    res.status(500).json({ error: "Failed to list published scripts" });
  }
});

// ─── GET /api/admin/ps-scripts ────────────────────────────────────────────────
// Re-gated ladder.msp-operator (Git #4264) so msp-console's Kanban card
// "customer download" script picker (KanbanCardModal.tsx) can load for real
// MSP operators, not just platform admins. `powershell_scripts` has no
// `msp_id` column — it's a genuine platform-global library, not per-MSP data —
// so this is a projection narrowing, not a tenant-scoping change: operators
// get only what the picker reads (id, title, category), not `script_body` or
// the other admin-only fields.

router.get("/admin/ps-scripts", requireCapability("ladder.msp-operator"), async (_req: Request, res: Response) => {
  try {
    const result = await pool.query<{ id: string; title: string; category: string }>(
      `SELECT id, title, category
       FROM powershell_scripts ORDER BY created_at DESC`,
    );
    res.json(result.rows.map(r => ({
      id: r.id,
      title: r.title,
      category: r.category,
    })));
  } catch (err) {
    log.error({ err }, "Failed to list PS scripts");
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

  try {
    const [created] = await db.insert(powershellScriptsTable).values({
      title: title.trim(),
      description: description?.trim() ?? null,
      category: category ?? "other",
      scriptBody: scriptBody.trim(),
      permissions: permissions ?? { appPermissions: [], delegatedPermissions: [], notes: "" },
      tags: tags ?? [],
    }).returning();

    res.status(201).json(created);
  } catch (err) {
    log.error({ err }, "Failed to save PS script");
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
    appPermissions: Array.isArray(permissions.appPermissions) ? normalizeAppPerms(permissions.appPermissions as unknown[]) : [],
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
    log.error({ err }, "Failed to create script package");
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
      // Normalize legacy string[] appPermissions to {scope,reason}[] before returning to UI
      permissions: pkg.permissions
        ? { ...pkg.permissions, appPermissions: normalizeAppPerms(pkg.permissions.appPermissions as unknown[]) }
        : pkg.permissions,
      modules: allModules.filter((m) => m.packageId === pkg.id).map((m) => ({
        ...m,
        permissions: m.permissions
          ? { ...m.permissions, appPermissions: normalizeAppPerms(m.permissions.appPermissions as unknown[]) }
          : { appPermissions: [], delegatedPermissions: [], notes: "" },
      })),
    }));

    res.json(result);
  } catch (err) {
    log.error({ err }, "Failed to list script packages");
    res.status(500).json({ error: "Failed to list packages" });
  }
});

// ─── GET /api/admin/ps-scripts/packages/:id/inherited-permissions ─────────────
// Returns permissions aggregated from standalone scripts that were associated
// into this package (tracked via script_modules.source_script_id).

router.get("/admin/ps-scripts/packages/:id/inherited-permissions", requireAdmin, async (req: Request, res: Response) => {
  const pkgId = String(req.params["id"] ?? "");
  if (!UUID_RE.test(pkgId)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    // Find all modules in this package that were linked from a standalone script
    const linkedModules = await db
      .select({ sourceScriptId: scriptModulesTable.sourceScriptId })
      .from(scriptModulesTable)
      .where(and(eq(scriptModulesTable.packageId, pkgId), isNotNull(scriptModulesTable.sourceScriptId)));

    const scriptIds = linkedModules
      .map(m => m.sourceScriptId)
      .filter((id): id is string => typeof id === "string");

    if (scriptIds.length === 0) {
      res.json({ permissions: [] });
      return;
    }

    // Aggregate permissions from the linked standalone scripts
    const scripts = await db
      .select({ id: powershellScriptsTable.id, permissions: powershellScriptsTable.permissions })
      .from(powershellScriptsTable)
      .where(inArray(powershellScriptsTable.id, scriptIds));

    const seen = new Map<string, string>();
    for (const script of scripts) {
      const perms = script.permissions as PsScriptPermissions | null;
      if (!perms?.appPermissions) continue;
      for (const entry of perms.appPermissions) {
        const normalized = typeof entry === "string"
          ? { scope: entry, reason: "" }
          : { scope: entry.scope, reason: entry.reason ?? "" };
        if (!seen.has(normalized.scope)) seen.set(normalized.scope, normalized.reason);
      }
    }

    const permissions = Array.from(seen.entries()).map(([scope, reason]) => ({ scope, reason }));
    res.json({ permissions });
  } catch (err) {
    log.error({ err }, "Failed to fetch inherited permissions");
    res.status(500).json({ error: "Failed to fetch inherited permissions" });
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
    log.error({ err }, "Failed to update script package");
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
    log.error({ err }, "Failed to delete script package");
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
    log.error({ err }, "Failed to add module to package");
    res.status(500).json({ error: "Failed to add module" });
  }
});

// ─── PUT /api/admin/ps-scripts/modules/:id ───────────────────────────────────

router.put("/admin/ps-scripts/modules/:id", requireAdmin, async (req: Request, res: Response) => {
  const moduleId = String(req.params["id"] ?? "");
  if (!UUID_RE.test(moduleId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { filename, description, content, sortOrder, permissions } = req.body as {
    filename?: string;
    description?: string;
    content?: string;
    sortOrder?: number;
    permissions?: PsScriptPermissions;
  };

  try {
    const [updated] = await db
      .update(scriptModulesTable)
      .set({
        ...(filename !== undefined && { filename: filename.trim() }),
        ...(description !== undefined && { description: description?.trim() ?? null }),
        ...(content !== undefined && { content }),
        ...(sortOrder !== undefined && { sortOrder }),
        ...(permissions !== undefined && { permissions }),
      })
      .where(eq(scriptModulesTable.id, moduleId))
      .returning();
    if (!updated) { res.status(404).json({ error: "Module not found" }); return; }
    res.json(updated);
  } catch (err) {
    log.error({ err }, "Failed to update script module");
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
    log.info({ moduleId, assigned }, "assign-tasks: runbook_id set on source tasks");
    res.json({ assigned });
  } catch (err) {
    log.error({ err }, "Failed to assign module to tasks");
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
    log.error({ err }, "Failed to delete script module");
    res.status(500).json({ error: "Failed to delete module" });
  }
});

// ─── Canonical module endpoints at /admin/script-packages/:id/modules ─────────
// These are the task-specified paths; they delegate to the same logic above.

router.post("/admin/script-packages/:id/modules", requireAdmin, async (req: Request, res: Response) => {
  const pkgId = String(req.params["id"] ?? "");
  if (!UUID_RE.test(pkgId)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { filename, description, content, sortOrder } = req.body as {
    filename?: string;
    description?: string;
    content?: string;
    sortOrder?: number;
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
      })
      .returning();
    res.status(201).json(created);
  } catch (err) {
    log.error({ err }, "Failed to add module to script package");
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
    log.error({ err }, "Failed to delete script module");
    res.status(500).json({ error: "Failed to delete module" });
  }
});

// ─── POST /api/admin/ps-scripts/:id/analyze-permissions ──────────────────────
// NOTE: must be registered BEFORE /admin/ps-scripts/:id to prevent route shadowing

router.post("/admin/ps-scripts/:id/analyze-permissions", requireAdmin, async (req: Request, res: Response) => {
  const id = String(req.params["id"] ?? "");
  if (!UUID_RE.test(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  try {
    // Try powershell_scripts first; fall back to script_modules (module UUIDs are used
    // when the permissions panel is open while editing inside a Script Set)
    let scriptBody: string | null | undefined;
    const [script] = await db.select({ scriptBody: powershellScriptsTable.scriptBody })
      .from(powershellScriptsTable).where(eq(powershellScriptsTable.id, id));
    if (script) {
      scriptBody = script.scriptBody;
    } else {
      const [mod] = await db.select({ content: scriptModulesTable.content })
        .from(scriptModulesTable).where(eq(scriptModulesTable.id, id));
      scriptBody = mod?.content;
    }
    if (!scriptBody?.trim()) { res.status(404).json({ error: "Script not found" }); return; }

    const prompt = `Analyze the following PowerShell script and identify every Azure App Registration permission it requires.

Return ONLY a JSON object with this exact structure — no prose before or after:
\`\`\`json
{
  "appPermissions": [
    {"name": "ExactScope.Name", "description": "One sentence explaining why this script needs this specific permission."}
  ],
  "delegatedPermissions": [
    {"name": "ExactScope.Name", "description": "One sentence explaining why this script needs this specific permission."}
  ]
}
\`\`\`

Rules:
- Application permissions (app-only, no signed-in user): put in "appPermissions"
- Delegated permissions (act on behalf of signed-in user): put in "delegatedPermissions"
- "name" must be the exact Microsoft Graph or Azure RBAC scope string (e.g. "User.Read.All", "Mail.Send")
- "description" must be one sentence explaining why THIS script specifically needs it
- Only include permissions the script actually invokes — do not speculate
- If no permissions of a type are needed, return an empty array for that key

PowerShell script to analyze:
\`\`\`powershell
${scriptBody}
\`\`\``;

    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });

    const text = msg.content.filter(b => b.type === "text").map(b => (b as { type: "text"; text: string }).text).join("");
    const parsed = extractJson(text) as Record<string, unknown> | null;

    type PermDetail = { name: string; description: string };
    const isPermDetailArr = (v: unknown): v is PermDetail[] =>
      Array.isArray(v) && v.every(e => e && typeof (e as Record<string, unknown>)["name"] === "string");

    const appPermissions: PermDetail[] = isPermDetailArr(parsed?.["appPermissions"]) ? parsed["appPermissions"] : [];
    const delegatedPermissions: PermDetail[] = isPermDetailArr(parsed?.["delegatedPermissions"]) ? parsed["delegatedPermissions"] : [];

    res.json({ appPermissionDetails: appPermissions, delegatedPermissionDetails: delegatedPermissions });
  } catch (err) {
    log.error({ err }, "analyze-permissions: failed");
    res.status(500).json({ error: "Failed to analyze permissions" });
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

    const filename = `${titleToSlug(script.title)}.ps1`;
    const [mod] = await db.insert(scriptModulesTable).values({
      packageId,
      filename,
      description: script.description ?? null,
      content: script.scriptBody ?? "",
      sortOrder: 999,
      sourceScriptId: script.id,
    }).returning();

    res.status(201).json(mod);
  } catch (err) {
    log.error({ err }, "Failed to associate script to package");
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
    // Normalize legacy string[] appPermissions to {scope,reason}[] before returning to UI
    res.json({
      ...script,
      permissions: script.permissions
        ? { ...script.permissions, appPermissions: normalizeAppPerms(script.permissions.appPermissions as unknown[]) }
        : script.permissions,
    });
  } catch (err) {
    log.error({ err }, "Failed to fetch PS script");
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

    res.json(updated);
  } catch (err) {
    log.error({ err }, "Failed to update PS script");
    res.status(500).json({ error: "Failed to update script" });
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
    log.error({ err }, "Failed to delete PS script");
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
      log.warn(
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
      log.error(
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
        appPermissions: Array.isArray(p["appPermissions"]) ? normalizeAppPerms(p["appPermissions"] as unknown[]) : [],
        delegatedPermissions: Array.isArray(p["delegatedPermissions"]) ? (p["delegatedPermissions"] as string[]) : [],
        notes: typeof p["notes"] === "string" ? p["notes"] : "",
      };
    }

    res.json({ fixedScript, fixSummary, permissions });
  } catch (err) {
    log.error({ err }, "PS script fix failed");
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
    log.error({ err }, "PS script explain failed");
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
      log.warn({ text: block.text.slice(0, 500) }, "ps-scripts/modularize: failed to parse JSON array from AI");
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
      log.error(
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

    log.info({ packageId: pkg.id, moduleCount: validModules.length }, "ps-scripts/modularize: saved package");
    res.json({ packageId: pkg.id, title: packageTitle, modules: validModules });
  } catch (err) {
    log.error({ err }, "PS script modularize failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Modularization failed" });
  }
});

// ─── Service Script Sets ──────────────────────────────────────────────────────
// NOTE: service_script_sets table was dropped in the catalog schema cleanup.
// These endpoints return empty responses / no-ops to preserve API compatibility.

// GET /api/admin/services/:id/script-sets
router.get("/admin/services/:id/script-sets", requireAdmin, (_req: Request, res: Response) => {
  res.json([]);
});

// POST /api/admin/services/:id/script-sets — no-op (table dropped)
router.post("/admin/services/:id/script-sets", requireAdmin, (_req: Request, res: Response) => {
  res.json([]);
});

// PATCH /api/admin/services/:id/script-sets/reorder — no-op (table dropped)
router.patch("/admin/services/:id/script-sets/reorder", requireAdmin, (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// POST /api/admin/services/:id/run-script-sets — returns empty plan (table dropped)
router.post("/admin/services/:id/run-script-sets", requireAdmin, (req: Request, res: Response) => {
  const { customerId } = req.body as { customerId?: number };
  res.json({ ok: true, message: "No script packages linked to this service.", executionPlan: [], customerId: customerId ?? null });
});

// ─── POST /api/admin/ps-scripts/:id/publish-to-prod ──────────────────────────
// Reads the full script record from dev DB and upserts it into the prod DB.
// Uses DATABASE_URL_PROD (or PROD_DATABASE_URL) — returns 503 if not set.

router.post("/admin/ps-scripts/:id/publish-to-prod", requireAdmin, async (req: Request, res: Response) => {
  const scriptId = String(req.params.id ?? "");
  if (!scriptId) { res.status(400).json({ error: "Invalid id" }); return; }

  const { isProdDbConfigured, buildProdDb } = await import("../lib/prod-db.ts");
  if (!isProdDbConfigured()) {
    res.status(503).json({ error: "Production database is not configured. Set DATABASE_URL_PROD in Replit Secrets." });
    return;
  }

  try {
    const [script] = await db
      .select()
      .from(powershellScriptsTable)
      .where(eq(powershellScriptsTable.id, scriptId))
      .limit(1);

    if (!script) { res.status(404).json({ error: "Script not found" }); return; }

    const { db: prodDb, pool: prodPool } = buildProdDb();

    await prodDb
      .insert(powershellScriptsTable)
      .values({
        id: script.id,
        title: script.title,
        description: script.description,
        category: script.category,
        scriptBody: script.scriptBody,
        permissions: script.permissions,
        tags: script.tags,
        azureSyncedAt: script.azureSyncedAt,
        createdAt: script.createdAt,
        updatedAt: script.updatedAt,
      })
      .onConflictDoUpdate({
        target: powershellScriptsTable.id,
        set: {
          title: script.title,
          description: script.description,
          category: script.category,
          scriptBody: script.scriptBody,
          permissions: script.permissions,
          tags: script.tags,
          azureSyncedAt: script.azureSyncedAt,
          updatedAt: new Date(),
        },
      });

    await prodPool.end();

    log.info({ scriptId, title: script.title }, "admin-ps-scripts: published to prod DB");
    res.json({ ok: true, scriptId, title: script.title });
  } catch (err) {
    log.error({ err, scriptId }, "admin-ps-scripts: publish-to-prod failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to publish to production" });
  }
});

// ─── POST /api/admin/ps-scripts/packages/:id/publish-to-prod ─────────────────
// Upserts the script package + all its modules into the production database.

router.post("/admin/ps-scripts/packages/:id/publish-to-prod", requireAdmin, async (req: Request, res: Response) => {
  const packageId = String(req.params.id ?? "");
  if (!packageId) { res.status(400).json({ error: "Invalid id" }); return; }

  const { isProdDbConfigured, buildProdDb } = await import("../lib/prod-db.ts");
  if (!isProdDbConfigured()) {
    res.status(503).json({ error: "Production database is not configured. Set DATABASE_URL_PROD in Replit Secrets." });
    return;
  }

  try {
    const [pkg] = await db
      .select()
      .from(scriptPackagesTable)
      .where(eq(scriptPackagesTable.id, packageId))
      .limit(1);

    if (!pkg) { res.status(404).json({ error: "Package not found" }); return; }

    const mods = await db
      .select()
      .from(scriptModulesTable)
      .where(eq(scriptModulesTable.packageId, packageId))
      .orderBy(asc(scriptModulesTable.sortOrder));

    const { db: prodDb, pool: prodPool } = buildProdDb();

    await prodDb
      .insert(scriptPackagesTable)
      .values({
        id: pkg.id,
        title: pkg.title,
        category: pkg.category,
        permissions: pkg.permissions,
        tags: pkg.tags,
        createdAt: pkg.createdAt,
      })
      .onConflictDoUpdate({
        target: scriptPackagesTable.id,
        set: {
          title: pkg.title,
          category: pkg.category,
          permissions: pkg.permissions,
          tags: pkg.tags,
        },
      });

    for (const mod of mods) {
      await prodDb
        .insert(scriptModulesTable)
        .values({
          id: mod.id,
          packageId: pkg.id,
          filename: mod.filename,
          description: mod.description,
          content: mod.content,
          sortOrder: mod.sortOrder,
          sourceScriptId: mod.sourceScriptId,
          sourceTaskIds: mod.sourceTaskIds,
          azureSyncedAt: mod.azureSyncedAt,
          permissions: mod.permissions,
          createdAt: mod.createdAt,
        })
        .onConflictDoUpdate({
          target: scriptModulesTable.id,
          set: {
            filename: mod.filename,
            description: mod.description,
            content: mod.content,
            sortOrder: mod.sortOrder,
            permissions: mod.permissions,
          },
        });
    }

    await prodPool.end();

    log.info({ packageId, title: pkg.title, moduleCount: mods.length }, "admin-ps-scripts: package published to prod DB");
    res.json({ ok: true, packageId, title: pkg.title, moduleCount: mods.length });
  } catch (err) {
    log.error({ err, packageId }, "admin-ps-scripts: packages publish-to-prod failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to publish package to production" });
  }
});

// DELETE /api/admin/services/:id/script-sets/:packageId — no-op (table dropped)
router.delete("/admin/services/:id/script-sets/:packageId", requireAdmin, (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// ─── GET /api/admin/services/:id/required-scripts ────────────────────────────
// service_required_scripts table was dropped — always returns empty.

router.get("/admin/services/:id/required-scripts", requireAdmin, (_req: Request, res: Response) => {
  res.json([]);
});

// ─── POST /api/admin/services/:id/required-scripts ───────────────────────────
router.post("/admin/services/:id/required-scripts", requireAdmin, (_req: Request, res: Response) => {
  res.json([]);
});

// ─── DELETE /api/admin/services/:id/required-scripts/:scriptId ───────────────
router.delete("/admin/services/:id/required-scripts/:scriptId", requireAdmin, (_req: Request, res: Response) => {
  res.json({ ok: true });
});

export default router;
