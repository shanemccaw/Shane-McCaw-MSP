/**
 * portal-script-library.ts
 *
 * MSP Portal routes for the platform script library.
 *
 * GET  /api/portal/scripts              — list platform-published scripts (MSP auth required)
 * POST /api/portal/scripts/:id/download — generate a single-use download token and
 *                                         return the augmented .ps1 script body with
 *                                         the token and ingestion endpoint injected.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  pool,
  powershellScriptsTable,
  scriptDownloadTokensTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireRole } from "../middlewares/requireAuth.ts";
import { logger } from "../lib/logger.ts";
import { randomUUID, createHash } from "crypto";

const router: IRouter = Router();

function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/** Default token TTL: 72 hours */
const TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

function buildIngestionUrl(): string {
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (domain) return `https://${domain}/api/script-ingestion`;
  return `${process.env.API_BASE_URL ?? "http://localhost:8080"}/api/script-ingestion`;
}

/**
 * Injects the ingestion token into the PowerShell script body.
 * Adds a header block with $IngestionToken, $IngestionUrl, and
 * instructions to POST results on completion.
 */
function injectTokenIntoScript(scriptBody: string, token: string, scriptType: string, schemaVersion: string): string {
  const ingestionUrl = buildIngestionUrl();
  const header = `# ── Platform Script Library — Auto-Ingestion Header ──────────────────────────
# This token is single-use and expires in 72 hours. Do not share or reuse it.
$IngestionToken     = "${token}"
$IngestionUrl       = "${ingestionUrl}"
$IngestionScriptType = "${scriptType}"
$IngestionSchemaVersion = "${schemaVersion}"

# Helper: POST results to the platform ingestion endpoint
function Submit-ScriptResults {
    param([Parameter(Mandatory)][hashtable]$Payload)
    $body = @{
        scriptType    = $IngestionScriptType
        schemaVersion = $IngestionSchemaVersion
        payload       = $Payload
    } | ConvertTo-Json -Depth 10
    try {
        $response = Invoke-RestMethod -Uri $IngestionUrl -Method POST \\
            -Headers @{ Authorization = "Bearer $IngestionToken"; "Content-Type" = "application/json" } \\
            -Body $body
        Write-Output "Results submitted: runResultId=$($response.runResultId)"
    } catch {
        Write-Warning "Failed to submit results: $_"
    }
}
# ── End Auto-Ingestion Header ─────────────────────────────────────────────────

`;
  return header + scriptBody;
}

// ── GET /api/portal/scripts ───────────────────────────────────────────────────

router.get(
  "/portal/scripts",
  requireRole("MSPOperator"),
  async (_req: Request, res: Response) => {
    try {
      const rows = await pool.query<{
        id: string;
        title: string;
        description: string | null;
        category: string;
        script_type: string | null;
        schema_version: string | null;
        tags: string[];
        created_at: string;
        updated_at: string;
      }>(
        `SELECT id, title, description, category, script_type, schema_version,
                tags, created_at, updated_at
         FROM powershell_scripts
         WHERE platform_published = TRUE
         ORDER BY title`,
      );
      res.json(
        rows.rows.map((r) => ({
          id: r.id,
          title: r.title,
          description: r.description,
          category: r.category,
          scriptType: r.script_type,
          schemaVersion: r.schema_version,
          tags: r.tags,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
      );
    } catch (err) {
      logger.error({ err }, "portal-script-library: failed to list scripts");
      res.status(500).json({ error: "Failed to list scripts" });
    }
  },
);

// ── POST /api/portal/scripts/:id/download ─────────────────────────────────────

router.post(
  "/portal/scripts/:id/download",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const user = req.user!;
    const { customerId } = req.body as { customerId?: number };

    try {
      const [script] = await db
        .select({
          id: powershellScriptsTable.id,
          title: powershellScriptsTable.title,
          scriptBody: powershellScriptsTable.scriptBody,
          scriptType: powershellScriptsTable.scriptType,
          schemaVersion: powershellScriptsTable.schemaVersion,
          platformPublished: powershellScriptsTable.platformPublished,
        })
        .from(powershellScriptsTable)
        .where(eq(powershellScriptsTable.id, id))
        .limit(1);

      if (!script) {
        res.status(404).json({ error: "Script not found" });
        return;
      }
      if (!script.platformPublished) {
        res.status(404).json({ error: "Script is not published" });
        return;
      }

      const plaintext = randomUUID();
      const tokenHash = hashToken(plaintext);
      const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
      const scriptType = script.scriptType ?? "m365";
      const schemaVersion = script.schemaVersion ?? "1.0";

      const [tokenRow] = await db
        .insert(scriptDownloadTokensTable)
        .values({
          tokenHash,
          scriptId: script.id,
          mspId: user.mspId ?? null,
          customerId: customerId ?? null,
          label: script.title,
          expiresAt,
        })
        .returning({ id: scriptDownloadTokensTable.id, expiresAt: scriptDownloadTokensTable.expiresAt });

      const augmentedScript = injectTokenIntoScript(script.scriptBody, plaintext, scriptType, schemaVersion);

      logger.info(
        { tokenId: tokenRow.id, scriptId: id, mspId: user.mspId, customerId },
        "portal-script-library: generated download token",
      );

      res.json({
        tokenId: tokenRow.id,
        scriptTitle: script.title,
        scriptType,
        schemaVersion,
        expiresAt: tokenRow.expiresAt,
        scriptBody: augmentedScript,
      });
    } catch (err) {
      logger.error({ err, scriptId: id }, "portal-script-library: failed to generate download");
      res.status(500).json({ error: "Failed to generate script download" });
    }
  },
);

export default router;
