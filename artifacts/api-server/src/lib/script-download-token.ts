/**
 * script-download-token.ts
 *
 * The single, shared Script Library execution primitive (Git #4291 / #4354).
 *
 * The Script Library's real "run" mechanism is the single-use download token:
 * the platform mints a token, augments the .ps1 with an auto-ingestion header,
 * and the operator runs it — results POST back to /api/script-ingestion and land
 * in `script_run_results`. This module is that mechanism, factored out of
 * portal-script-library.ts so the unified Automation wrapper's
 * `POST /automations/:id/run` (type = "script", #4354) delegates to the exact
 * same code instead of re-implementing a second execution path.
 */

import { randomUUID, createHash } from "crypto";
import { eq } from "drizzle-orm";
import { db, powershellScriptsTable, scriptDownloadTokensTable } from "@workspace/db";

/** Default token TTL: 72 hours */
export const SCRIPT_DOWNLOAD_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function buildIngestionUrl(): string {
  const domain = process.env.REPLIT_DOMAINS?.split(",")[0]?.trim();
  if (domain) return `https://${domain}/api/script-ingestion`;
  return `${process.env.API_BASE_URL ?? "http://localhost:8080"}/api/script-ingestion`;
}

/**
 * Injects the ingestion token into the PowerShell script body. Adds a header
 * block with $IngestionToken, $IngestionUrl, and a Submit-ScriptResults helper.
 */
export function injectTokenIntoScript(
  scriptBody: string,
  token: string,
  scriptType: string,
  schemaVersion: string,
): string {
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

export class ScriptDownloadTokenError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ScriptDownloadTokenError";
    this.status = status;
  }
}

export interface ScriptDownloadTokenResult {
  tokenId: number;
  scriptTitle: string;
  scriptType: string;
  schemaVersion: string;
  expiresAt: Date;
  scriptBody: string;
}

/**
 * Mints a single-use download token for a published platform script and returns
 * the augmented script body. Throws {@link ScriptDownloadTokenError} with a 404
 * when the script is missing or unpublished.
 */
export async function generateScriptDownloadToken(opts: {
  scriptId: string;
  mspId?: number | null;
  customerId?: number | null;
}): Promise<ScriptDownloadTokenResult> {
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
    .where(eq(powershellScriptsTable.id, opts.scriptId))
    .limit(1);

  if (!script) throw new ScriptDownloadTokenError("Script not found", 404);
  if (!script.platformPublished) throw new ScriptDownloadTokenError("Script is not published", 404);

  const plaintext = randomUUID();
  const tokenHash = hashToken(plaintext);
  const expiresAt = new Date(Date.now() + SCRIPT_DOWNLOAD_TOKEN_TTL_MS);
  const scriptType = script.scriptType ?? "m365";
  const schemaVersion = script.schemaVersion ?? "1.0";

  const [tokenRow] = await db
    .insert(scriptDownloadTokensTable)
    .values({
      tokenHash,
      scriptId: script.id,
      mspId: opts.mspId ?? null,
      customerId: opts.customerId ?? null,
      label: script.title,
      expiresAt,
    })
    .returning({ id: scriptDownloadTokensTable.id, expiresAt: scriptDownloadTokensTable.expiresAt });

  const augmentedScript = injectTokenIntoScript(script.scriptBody, plaintext, scriptType, schemaVersion);

  return {
    tokenId: tokenRow.id,
    scriptTitle: script.title,
    scriptType,
    schemaVersion,
    expiresAt: tokenRow.expiresAt,
    scriptBody: augmentedScript,
  };
}
