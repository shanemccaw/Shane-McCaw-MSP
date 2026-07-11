/**
 * script-ingestion.ts
 *
 * Token-authenticated script results ingestion endpoint.
 * No session auth required — scripts embed a single-use token generated at download time.
 *
 * POST /api/script-ingestion
 *
 * Authorization: Bearer <token>
 * Content-Type: application/json
 *
 * Body: {
 *   scriptType:    string  (e.g. "m365-health", "intune-compliance")
 *   schemaVersion: string  (e.g. "1.0")
 *   payload:       object  (arbitrary collected data — at least one key required)
 * }
 *
 * Validation pipeline:
 *   1. Token lookup: SHA256 hash → script_download_tokens row
 *   2. Liveness: not expired, not used, not revoked
 *   3. Structural check: scriptType (string), schemaVersion (string), payload (non-empty object)
 *   4. Deterministic viability gate: keywords, size, shape checks — no AI
 *   5. Insert script_run_results row (executionSource = "customer_upload")
 *   6. Fire-and-forget AI analysis
 *   7. Burn token: set usedAt, set runResultId FK
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  scriptDownloadTokensTable,
  scriptRunResultsTable,
  powershellScriptsTable,
} from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { createHash } from "crypto";
import { logger } from "../lib/logger.ts";
import { runAiAnalyzer } from "../lib/ai-analyzer.ts";
import { parseM365ScriptOutput, normaliseProfileUpdates } from "../lib/parse-m365-script-output.ts";

const router: IRouter = Router();

function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

// ── Deterministic viability gate ──────────────────────────────────────────────

const FATAL_ERROR_PATTERNS = [
  /^error:/im,
  /unhandled exception/i,
  /exception of type .* was thrown/i,
  /terminating error/i,
  /script exited with code [1-9]/i,
  /^\s*critical:/im,
];

const KNOWN_NOISE_PATTERNS = [
  /^warning:/im,
  /^\s*info:/im,
  /^\s*verbose:/im,
];

interface ViabilityResult {
  passed: boolean;
  reason: string;
}

function checkViability(payload: Record<string, unknown>): ViabilityResult {
  const keys = Object.keys(payload);

  if (keys.length === 0) {
    return { passed: false, reason: "Payload is empty — no data collected" };
  }

  const serialised = JSON.stringify(payload);

  if (serialised.length < 10) {
    return { passed: false, reason: "Payload is too small to contain meaningful data" };
  }

  const text = typeof payload["output"] === "string" ? payload["output"] as string : serialised;
  for (const pat of FATAL_ERROR_PATTERNS) {
    if (pat.test(text)) {
      const suppressedByNoise = KNOWN_NOISE_PATTERNS.some((np) => np.test(text));
      if (!suppressedByNoise) {
        return { passed: false, reason: `Fatal error pattern detected: ${pat.toString()}` };
      }
    }
  }

  return { passed: true, reason: "Payload passed deterministic viability checks" };
}

// ── Fire-and-forget AI analysis ───────────────────────────────────────────────

async function runIngestionAnalysis(
  runResultId: number,
  rawOutput: Record<string, unknown>,
  customerId: number | null,
  libraryScriptId: string | null,
): Promise<void> {
  try {
    let aiInstructions = "Analyze the output for security, governance, and compliance findings.";
    let packageContext = "Portal script ingestion";

    if (libraryScriptId) {
      try {
        const [script] = await db
          .select({ description: powershellScriptsTable.description, title: powershellScriptsTable.title })
          .from(powershellScriptsTable)
          .where(eq(powershellScriptsTable.id, libraryScriptId))
          .limit(1);
        if (script?.description) aiInstructions = script.description;
        if (script?.title) packageContext = script.title;
      } catch {
        // non-fatal
      }
    }

    const scriptOutput = JSON.stringify(rawOutput, null, 2);
    const deterministicUpdates = parseM365ScriptOutput(rawOutput);

    const aiResult = await runAiAnalyzer({ scriptOutput, aiInstructions, packageContext });
    const mergedProfileUpdates = { ...aiResult.profileUpdates, ...deterministicUpdates };

    await db
      .update(scriptRunResultsTable)
      .set({
        parsedFindings: aiResult.findings,
        recommendations: aiResult.recommendations,
        scoreImpact: aiResult.scoreImpact,
        profileUpdates: mergedProfileUpdates,
        status: "completed",
        reviewedAt: new Date(),
      })
      .where(eq(scriptRunResultsTable.id, runResultId));

    logger.info({ runResultId, customerId }, "script-ingestion: AI analysis complete");
  } catch (err) {
    logger.warn({ err, runResultId }, "script-ingestion: AI analysis failed (non-fatal) — result stays awaiting_upload");
    await db
      .update(scriptRunResultsTable)
      .set({ status: "failed" })
      .where(eq(scriptRunResultsTable.id, runResultId))
      .catch(() => {});
  }
}

// ── POST /api/script-ingestion ────────────────────────────────────────────────

router.post("/script-ingestion", async (req: Request, res: Response) => {
  const authHeader = req.headers.authorization ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(authHeader);
  if (!match) {
    res.status(401).json({ error: "Bearer token required in Authorization header" });
    return;
  }
  const plaintext = match[1];
  const tokenHash = hashToken(plaintext);

  let tokenRow: {
    id: number;
    scriptId: string;
    mspId: number | null;
    customerId: number | null;
    clientUserId: number | null;
    expiresAt: Date;
    usedAt: Date | null;
    revokedAt: Date | null;
  } | undefined;

  try {
    const [row] = await db
      .select({
        id: scriptDownloadTokensTable.id,
        scriptId: scriptDownloadTokensTable.scriptId,
        mspId: scriptDownloadTokensTable.mspId,
        customerId: scriptDownloadTokensTable.customerId,
        clientUserId: scriptDownloadTokensTable.clientUserId,
        expiresAt: scriptDownloadTokensTable.expiresAt,
        usedAt: scriptDownloadTokensTable.usedAt,
        revokedAt: scriptDownloadTokensTable.revokedAt,
      })
      .from(scriptDownloadTokensTable)
      .where(eq(scriptDownloadTokensTable.tokenHash, tokenHash))
      .limit(1);
    tokenRow = row;
  } catch (err) {
    logger.error({ err }, "script-ingestion: DB error during token lookup");
    res.status(500).json({ error: "Internal server error" });
    return;
  }

  if (!tokenRow) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }
  if (tokenRow.revokedAt) {
    res.status(401).json({ error: "Token has been revoked" });
    return;
  }
  if (tokenRow.usedAt) {
    res.status(409).json({ error: "Token has already been used" });
    return;
  }
  if (tokenRow.expiresAt < new Date()) {
    res.status(401).json({ error: "Token has expired" });
    return;
  }

  // ── Structural validation ──
  const body = req.body as Record<string, unknown>;
  const { scriptType, schemaVersion, payload } = body;

  if (!scriptType || typeof scriptType !== "string") {
    res.status(400).json({ error: "scriptType (string) is required" });
    return;
  }
  if (!schemaVersion || typeof schemaVersion !== "string") {
    res.status(400).json({ error: "schemaVersion (string) is required" });
    return;
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    res.status(400).json({ error: "payload (object) is required" });
    return;
  }

  // ── Deterministic viability gate ──
  const viability = checkViability(payload as Record<string, unknown>);
  if (!viability.passed) {
    logger.warn({ tokenId: tokenRow.id, reason: viability.reason }, "script-ingestion: viability gate failed");
    res.status(422).json({ error: "Payload failed viability check", reason: viability.reason });
    return;
  }

  // ── Insert script_run_results row ──
  const rawOutput: Record<string, unknown> = {
    scriptType,
    schemaVersion,
    data: payload,
    ingestedAt: new Date().toISOString(),
  };

  let runResultId: number;
  try {
    const [inserted] = await db
      .insert(scriptRunResultsTable)
      .values({
        customerId: tokenRow.customerId ?? null,
        libraryScriptId: tokenRow.scriptId,
        rawOutput,
        status: "awaiting_upload",
        executionSource: "customer_upload",
        uploadedBy: `token:${tokenRow.id}`,
        uploadedAt: new Date(),
        scriptName: scriptType,
      })
      .returning({ id: scriptRunResultsTable.id });
    runResultId = inserted.id;
  } catch (err) {
    logger.error({ err }, "script-ingestion: failed to insert run result");
    res.status(500).json({ error: "Failed to record ingestion" });
    return;
  }

  // ── Burn the token ──
  try {
    await db
      .update(scriptDownloadTokensTable)
      .set({ usedAt: new Date(), runResultId })
      .where(eq(scriptDownloadTokensTable.id, tokenRow.id));
  } catch (err) {
    logger.warn({ err, tokenId: tokenRow.id }, "script-ingestion: failed to mark token as used (non-fatal)");
  }

  logger.info(
    { tokenId: tokenRow.id, runResultId, scriptId: tokenRow.scriptId, scriptType, schemaVersion },
    "script-ingestion: ingestion accepted",
  );

  // ── Fire-and-forget AI analysis ──
  void runIngestionAnalysis(runResultId, rawOutput, tokenRow.customerId ?? null, tokenRow.scriptId);

  res.status(202).json({
    accepted: true,
    runResultId,
    viabilityResult: viability.reason,
  });
});

export default router;
