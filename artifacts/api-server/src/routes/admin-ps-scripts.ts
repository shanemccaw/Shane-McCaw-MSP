import { Router, type Request, type Response } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { db } from "@workspace/db";
import {
  powershellScriptsTable,
  scriptPackagesTable,
  scriptModulesTable,
  type PsScriptPermissions,
  type ScriptModule,
} from "@workspace/db";
import { eq, desc, asc, inArray } from "drizzle-orm";
import { logger } from "../lib/logger.ts";
import { hasPsKeywords } from "../lib/ps-guard.ts";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractJson(text: string): unknown {
  // 1. Require the explicit ```json fence — most reliable since the prompt mandates it.
  const jsonFence = text.match(/```json\s*([\s\S]*?)```/i);
  if (jsonFence) {
    try { return JSON.parse(jsonFence[1].trim()); } catch { /* fall through */ }
  }

  // 2. Try every fenced block in document order; pick the first that parses as a
  //    plain JSON object (not an array or primitive). This handles the case where
  //    the model omits the "json" language tag.
  const anyFenceRe = /```[^\n`]*\n?([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = anyFenceRe.exec(text)) !== null) {
    try {
      const v = JSON.parse(m[1].trim());
      if (v !== null && typeof v === "object" && !Array.isArray(v)) return v;
    } catch { /* continue */ }
  }

  // 3. Last-resort backward scan: find the last '}' and walk left looking for the
  //    matching opening '{'. Scanning from the END increases the chance of finding
  //    the permissions JSON (which appears after the script in Claude's output)
  //    rather than a PowerShell block.
  let end = text.lastIndexOf("}");
  while (end !== -1) {
    const start = text.lastIndexOf("{", end);
    if (start === -1) break;
    const slice = text.slice(start, end + 1);
    try {
      const v = JSON.parse(slice);
      if (v !== null && typeof v === "object" && !Array.isArray(v)) return v;
    } catch { /* keep scanning */ }
    end = text.lastIndexOf("}", start - 1);
  }

  return null;
}

function extractJsonArray(text: string): unknown[] | null {
  const jsonFence = text.match(/```json\s*([\s\S]*?)```/i);
  if (jsonFence) {
    try {
      const v = JSON.parse(jsonFence[1].trim());
      if (Array.isArray(v)) return v;
    } catch { /* fall through */ }
  }
  const anyFenceRe = /```[^\n`]*\n?([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = anyFenceRe.exec(text)) !== null) {
    try {
      const v = JSON.parse(m[1].trim());
      if (Array.isArray(v)) return v;
    } catch { /* continue */ }
  }
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const v = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(v)) return v;
    } catch { /* nothing */ }
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
   - Write-Host / Write-Error / Write-Warning for meaningful logging
   - Inline comments explaining each logical section
   - Clear output (export to CSV where applicable, structured objects, or console summary)
   - $ErrorActionPreference = "Stop" at the top

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

    // Heuristic guard: if the first 200 chars contain no recognisable PowerShell
    // keyword, the AI likely returned only prose and the fence was absent entirely.
    // Return a 500 so the editor is never overwritten with non-PS text.
    if (!hasPsKeywords(scriptBody)) {
      logger.error(
        { scriptBodyPrefix: scriptBody.slice(0, 300) },
        "generate endpoint: fallback result contains no PS keywords — AI returned prose only; refusing to send to client",
      );
      res.status(500).json({ error: "AI returned a summary instead of a script. Please try again." });
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
    res.json(updated);
  } catch (err) {
    logger.error({ err }, "Failed to update PS script");
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

    // Heuristic guard: if the first 200 chars contain no recognisable PowerShell
    // keyword, the AI likely returned only prose (a summary or explanation).
    // Serving that to the client would replace the editor with non-PS text.
    if (!hasPsKeywords(fixedScript)) {
      logger.error(
        { fixedScriptPrefix: fixedScript.slice(0, 300) },
        "fix endpoint: fallback result contains no PS keywords — AI returned prose only; refusing to overwrite editor",
      );
      res.status(500).json({ error: "AI returned a summary instead of a script. Please try again." });
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
