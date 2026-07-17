/**
 * manual-script-upload.ts
 *
 * Shared processor for manual script JSON uploads.
 * Called by both the admin route and the portal client route.
 * Ownership / authorization must be verified by the caller before invoking
 * processManualScriptUpload — this module does not check who is uploading.
 */

import {
  db,
  scriptRunResultsTable,
  clientScoresTable,
  clientM365ProfilesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { runAiAnalyzer } from "./ai-analyzer";
import { parseM365ScriptOutput, normaliseProfileUpdates } from "./parse-m365-script-output";
import { completeManualScriptKanbanCard } from "./manual-script-kanban";

function clampScore(current: number, delta: number): number {
  return Math.max(0, Math.min(100, current + delta));
}

async function applyScoreImpact(
  clientId: number,
  scoreImpact: Record<string, number>,
): Promise<void> {
  if (Object.keys(scoreImpact).length === 0) return;

  const [existing] = await db
    .select()
    .from(clientScoresTable)
    .where(eq(clientScoresTable.clientId, clientId))
    .limit(1);

  const base = {
    identity: existing?.identity ?? 0,
    security: existing?.security ?? 0,
    collaboration: existing?.collaboration ?? 0,
    compliance: existing?.compliance ?? 0,
    copilotReadiness: existing?.copilotReadiness ?? 0,
  };

  const updated = {
    identity:
      scoreImpact.identity !== undefined
        ? clampScore(base.identity, scoreImpact.identity)
        : base.identity,
    security:
      scoreImpact.security !== undefined
        ? clampScore(base.security, scoreImpact.security)
        : base.security,
    collaboration:
      scoreImpact.collaboration !== undefined
        ? clampScore(base.collaboration, scoreImpact.collaboration)
        : base.collaboration,
    compliance:
      scoreImpact.compliance !== undefined
        ? clampScore(base.compliance, scoreImpact.compliance)
        : base.compliance,
    copilotReadiness:
      scoreImpact.copilotReadiness !== undefined
        ? clampScore(base.copilotReadiness, scoreImpact.copilotReadiness)
        : base.copilotReadiness,
  };

  if (existing) {
    await db
      .update(clientScoresTable)
      .set({ ...updated, updatedAt: new Date() })
      .where(eq(clientScoresTable.clientId, clientId));
  } else {
    await db.insert(clientScoresTable).values({ clientId, ...updated });
  }
}

async function applyProfileUpdates(
  clientId: number,
  profileUpdates: Record<string, unknown>,
): Promise<void> {
  if (Object.keys(profileUpdates).length === 0) return;

  // Normalise: convert legacy authMethod string → authMethods array
  const normalised = normaliseProfileUpdates(profileUpdates);

  const [existing] = await db
    .select()
    .from(clientM365ProfilesTable)
    .where(eq(clientM365ProfilesTable.clientId, clientId))
    .limit(1);

  const existingProfile = (existing?.profile as Record<string, unknown>) ?? {};
  const normalisedExisting = normaliseProfileUpdates(existingProfile);
  const merged = { ...normalisedExisting, ...normalised };

  if (existing) {
    await db
      .update(clientM365ProfilesTable)
      .set({ profile: merged, updatedAt: new Date() })
      .where(eq(clientM365ProfilesTable.clientId, clientId));
  } else {
    await db
      .insert(clientM365ProfilesTable)
      .values({ clientId, profile: merged });
  }
}

export interface UploadResult {
  runResultId: number;
  scriptId: number;
  status: "completed";
  findings: string[];
  recommendations: string[];
  scoreImpact: Record<string, number>;
}

export class UploadError extends Error {
  constructor(
    message: string,
    public readonly statusCode: 400 | 404 | 409,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

/**
 * Core manual script upload processor.
 *
 * Validates the run result state, runs the AI Analyzer on the submitted JSON,
 * stores results, and applies score / M365 profile updates.
 *
 * @param runResultId - The script_run_results row to process.
 * @param jsonData    - Parsed JSON object from the uploaded file. Must have a "data" key.
 * @param uploadedBy  - Display name / email of the uploader (for audit trail).
 */
export async function processManualScriptUpload(
  runResultId: number,
  jsonData: Record<string, unknown>,
  uploadedBy: string,
): Promise<UploadResult> {
  const [runResult] = await db
    .select()
    .from(scriptRunResultsTable)
    .where(eq(scriptRunResultsTable.id, runResultId))
    .limit(1);

  if (!runResult) throw new UploadError("Run result not found", 404);
  if (runResult.executionSource !== "manual")
    throw new UploadError("This run result was not created by the manual execution flow", 400);
  if (runResult.status === "completed")
    throw new UploadError("Results have already been uploaded for this run", 409);

  const scriptOutput = JSON.stringify(jsonData, null, 2);

  // Deterministic extraction — runs before AI so known fields are always captured
  const deterministicUpdates = parseM365ScriptOutput(jsonData);

  let aiResult = {
    findings: [] as string[],
    recommendations: [] as string[],
    scoreImpact: {} as Record<string, number>,
    profileUpdates: {} as Record<string, unknown>,
  };

  try {
    aiResult = await runAiAnalyzer({
      scriptOutput,
      aiInstructions: "",
      packageContext: runResult.packageId
        ? `Package ${runResult.packageId}`
        : "Manual script upload",
      customerId: runResult.customerId ?? undefined,
    });
  } catch (aiErr) {
    logger.warn(
      { aiErr, runResultId },
      "manual-script-upload: AI analysis failed (non-fatal)",
    );
  }

  // Deterministic fields override AI guesses for the same keys
  const mergedProfileUpdates = { ...aiResult.profileUpdates, ...deterministicUpdates };

  await db
    .update(scriptRunResultsTable)
    .set({
      rawOutput: { text: JSON.stringify(jsonData, null, 2) },
      parsedFindings: aiResult.findings,
      recommendations: aiResult.recommendations,
      scoreImpact: aiResult.scoreImpact,
      profileUpdates: mergedProfileUpdates,
      status: "completed",
      uploadedBy,
      uploadedAt: new Date(),
    })
    .where(eq(scriptRunResultsTable.id, runResultId));

  if (runResult.customerId) {
    try {
      await applyScoreImpact(runResult.customerId, aiResult.scoreImpact);
    } catch (err) {
      logger.warn(
        { err, customerId: runResult.customerId },
        "manual-script-upload: score impact failed (non-fatal)",
      );
    }
    try {
      await applyProfileUpdates(runResult.customerId, mergedProfileUpdates);
    } catch (err) {
      logger.warn(
        { err, customerId: runResult.customerId },
        "manual-script-upload: profile updates failed (non-fatal)",
      );
    }
  }

  completeManualScriptKanbanCard(runResultId).catch((err) => {
    logger.warn(
      { err, runResultId },
      "manual-script-upload: kanban card completion failed (non-fatal)",
    );
  });

  logger.info(
    { runResultId, scriptId: runResult.scriptId, uploadedBy },
    "manual-script-upload: processed successfully",
  );

  return {
    runResultId,
    scriptId: runResult.scriptId ?? 0,
    status: "completed",
    findings: aiResult.findings,
    recommendations: aiResult.recommendations,
    scoreImpact: aiResult.scoreImpact,
  };
}
