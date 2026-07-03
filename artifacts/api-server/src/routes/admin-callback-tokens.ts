/**
 * admin-callback-tokens.ts
 *
 * Routes for the customer script auto-callback feature:
 *
 * PUBLIC (no auth — token in Authorization header):
 *   POST /api/script-callback          — inbound auto-callback from a downloaded .ps1 script
 *
 * ADMIN-only:
 *   GET    /api/admin/callback-tokens?clientId=N  — list tokens for a client
 *   DELETE /api/admin/callback-tokens/:id         — revoke a token
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  clientCallbackTokensTable,
  scriptRunResultsTable,
  projectsTable,
  kanbanTasksTable,
  notificationsTable,
  usersTable,
  clientScoresTable,
  clientM365ProfilesTable,
  powershellScriptsTable,
} from "@workspace/db";
import { eq, and, isNull, isNotNull } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { logger } from "../lib/logger.ts";
import { createHash } from "crypto";
import { runAiAnalyzer } from "../lib/ai-analyzer.ts";
import { parseM365ScriptOutput, normaliseProfileUpdates } from "../lib/parse-m365-script-output.ts";
import { sendWebPushToAdmins } from "../lib/web-push.ts";

const router: IRouter = Router();

function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

function clampScore(current: number, delta: number): number {
  return Math.max(0, Math.min(100, current + delta));
}

/**
 * Runs the AI Analyzer on a newly-inserted customer_upload result row,
 * updates the row with findings/recommendations/scoreImpact/profileUpdates,
 * applies score + profile side-effects, and notifies all admin users.
 *
 * Designed to be called fire-and-forget (void) after the HTTP response is sent.
 */
async function runCallbackAnalysis(
  resultId: number,
  rawOutput: Record<string, unknown>,
  customerId: number | null,
  libraryScriptId: string | null,
): Promise<void> {
  const scriptOutput = JSON.stringify(rawOutput, null, 2);

  // Resolve AI instructions and package context from the library script (if any)
  let aiInstructions = "Analyze the output for security, governance, and compliance findings.";
  let packageContext = "Customer auto-callback script run";
  if (libraryScriptId) {
    try {
      const [script] = await db
        .select({ description: powershellScriptsTable.description, title: powershellScriptsTable.title })
        .from(powershellScriptsTable)
        .where(eq(powershellScriptsTable.id, libraryScriptId))
        .limit(1);
      if (script) {
        if (script.description) aiInstructions = script.description;
        if (script.title) packageContext = script.title;
      }
    } catch {
      // non-fatal
    }
  }

  let aiResult = {
    findings: [] as string[],
    recommendations: [] as string[],
    scoreImpact: {} as Record<string, number>,
    profileUpdates: {} as Record<string, unknown>,
  };

  try {
    aiResult = await runAiAnalyzer({ scriptOutput, aiInstructions, packageContext });
  } catch (aiErr) {
    logger.warn({ aiErr, resultId }, "admin-callback-tokens: AI analysis failed (non-fatal)");
  }

  // Deterministic extraction overrides AI guesses for known fields
  const deterministicUpdates = parseM365ScriptOutput(rawOutput);
  const mergedProfileUpdates = { ...aiResult.profileUpdates, ...deterministicUpdates };

  // Update the result row with AI output
  try {
    await db
      .update(scriptRunResultsTable)
      .set({
        parsedFindings: aiResult.findings,
        recommendations: aiResult.recommendations,
        scoreImpact: aiResult.scoreImpact,
        profileUpdates: mergedProfileUpdates,
      })
      .where(eq(scriptRunResultsTable.id, resultId));
  } catch (updateErr) {
    logger.error({ updateErr, resultId }, "admin-callback-tokens: failed to persist AI analysis results");
    return;
  }

  // Apply score side-effects
  if (customerId && Object.keys(aiResult.scoreImpact).length > 0) {
    try {
      const [existing] = await db
        .select()
        .from(clientScoresTable)
        .where(eq(clientScoresTable.clientId, customerId))
        .limit(1);

      const base = {
        identity: existing?.identity ?? 0,
        security: existing?.security ?? 0,
        collaboration: existing?.collaboration ?? 0,
        compliance: existing?.compliance ?? 0,
        copilotReadiness: existing?.copilotReadiness ?? 0,
      };

      const updated = {
        identity: aiResult.scoreImpact.identity !== undefined ? clampScore(base.identity, aiResult.scoreImpact.identity) : base.identity,
        security: aiResult.scoreImpact.security !== undefined ? clampScore(base.security, aiResult.scoreImpact.security) : base.security,
        collaboration: aiResult.scoreImpact.collaboration !== undefined ? clampScore(base.collaboration, aiResult.scoreImpact.collaboration) : base.collaboration,
        compliance: aiResult.scoreImpact.compliance !== undefined ? clampScore(base.compliance, aiResult.scoreImpact.compliance) : base.compliance,
        copilotReadiness: aiResult.scoreImpact.copilotReadiness !== undefined ? clampScore(base.copilotReadiness, aiResult.scoreImpact.copilotReadiness) : base.copilotReadiness,
      };

      if (existing) {
        await db.update(clientScoresTable).set({ ...updated, updatedAt: new Date() }).where(eq(clientScoresTable.clientId, customerId));
      } else {
        await db.insert(clientScoresTable).values({ clientId: customerId, ...updated });
      }
    } catch (scoreErr) {
      logger.warn({ scoreErr, customerId, resultId }, "admin-callback-tokens: score impact failed (non-fatal)");
    }
  }

  // Apply M365 profile side-effects
  if (customerId && Object.keys(mergedProfileUpdates).length > 0) {
    try {
      const normalised = normaliseProfileUpdates(mergedProfileUpdates);
      const [existing] = await db
        .select()
        .from(clientM365ProfilesTable)
        .where(eq(clientM365ProfilesTable.clientId, customerId))
        .limit(1);

      const existingProfile = (existing?.profile as Record<string, unknown>) ?? {};
      const merged = { ...normaliseProfileUpdates(existingProfile), ...normalised };

      if (existing) {
        await db.update(clientM365ProfilesTable).set({ profile: merged, updatedAt: new Date() }).where(eq(clientM365ProfilesTable.clientId, customerId));
      } else {
        await db.insert(clientM365ProfilesTable).values({ clientId: customerId, profile: merged });
      }
    } catch (profileErr) {
      logger.warn({ profileErr, customerId, resultId }, "admin-callback-tokens: profile updates failed (non-fatal)");
    }
  }

  // Resolve customer name for the notification
  let customerName = "A client";
  if (customerId) {
    try {
      const [user] = await db
        .select({ name: usersTable.name, email: usersTable.email })
        .from(usersTable)
        .where(eq(usersTable.id, customerId))
        .limit(1);
      customerName = user?.name ?? user?.email ?? customerName;
    } catch {
      // non-fatal
    }
  }

  // Notify all admin users (bell + web push)
  try {
    const admins = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.role, "admin"));

    if (admins.length > 0) {
      await db.insert(notificationsTable).values(
        admins.map((a) => ({
          userId: a.id,
          title: `Customer script results received`,
          body: `${customerName} submitted script results via auto-callback. AI analysis is ready.`,
          type: "general" as const,
          linkPath: `/admin-panel/script-runs/${resultId}`,
        }))
      );
    }
  } catch (notifErr) {
    logger.warn({ notifErr, resultId }, "admin-callback-tokens: admin notification failed (non-fatal)");
  }

  try {
    await sendWebPushToAdmins({
      title: "Customer script results received",
      body: `${customerName} submitted script results. AI analysis ready.`,
      linkPath: `/admin-panel/script-runs/${resultId}`,
      playSound: true,
    });
  } catch (pushErr) {
    logger.warn({ pushErr, resultId }, "admin-callback-tokens: web push failed (non-fatal)");
  }

  logger.info({ resultId, customerId }, "admin-callback-tokens: callback analysis complete");
}

// ─── PUBLIC: inbound callback from a customer-run .ps1 ───────────────────────

/**
 * POST /api/script-callback
 *
 * Called automatically by the final block of a downloaded .ps1 script.
 * Bearer token in Authorization header is SHA-256 hashed and looked up in
 * client_callback_tokens. On success, inserts a new script_run_results row
 * and updates the token's last_used_at. Token is NOT revoked — stays active
 * so the client can re-run the script.
 *
 * Body: the full JSON output object produced by the script.
 */
router.post("/script-callback", async (req: Request, res: Response) => {
  const authHeader = String(req.headers.authorization ?? "");
  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }
  const plaintext = authHeader.slice(7).trim();
  if (!plaintext) {
    res.status(401).json({ error: "Empty token" });
    return;
  }

  const tokenHash = hashToken(plaintext);

  try {
    const [tokenRow] = await db
      .select()
      .from(clientCallbackTokensTable)
      .where(eq(clientCallbackTokensTable.tokenHash, tokenHash))
      .limit(1);

    if (!tokenRow) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    if (tokenRow.revokedAt !== null) {
      res.status(401).json({ error: "Token has been revoked" });
      return;
    }

    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      res.status(400).json({ error: "Request body must be a JSON object" });
      return;
    }

    // Resolve linkage from the token's linked run result (if any).
    // When the original row is still "awaiting_upload" we UPDATE it in-place so the
    // portal and kanban card see the result immediately (they track by that row's id).
    // If it was already completed (repeat run), we INSERT a fresh history row instead.
    let linkage: {
      customerId: number | null;
      kanbanTaskId: number | null;
      libraryScriptId: string | null;
      packageId: number | null;
      scriptId: number | null;
    } = {
      customerId: tokenRow.clientUserId,
      kanbanTaskId: null,
      libraryScriptId: null,
      packageId: null,
      scriptId: null,
    };

    let resultId: number | null = null;

    if (tokenRow.scriptRunResultId !== null) {
      const [orig] = await db
        .select({
          id: scriptRunResultsTable.id,
          status: scriptRunResultsTable.status,
          customerId: scriptRunResultsTable.customerId,
          kanbanTaskId: scriptRunResultsTable.kanbanTaskId,
          libraryScriptId: scriptRunResultsTable.libraryScriptId,
          packageId: scriptRunResultsTable.packageId,
          scriptId: scriptRunResultsTable.scriptId,
        })
        .from(scriptRunResultsTable)
        .where(eq(scriptRunResultsTable.id, tokenRow.scriptRunResultId))
        .limit(1);

      if (orig) {
        linkage = {
          customerId: orig.customerId ?? tokenRow.clientUserId,
          kanbanTaskId: orig.kanbanTaskId ?? null,
          libraryScriptId: orig.libraryScriptId ?? null,
          packageId: orig.packageId ?? null,
          scriptId: orig.scriptId ?? null,
        };

        if (orig.status === "awaiting_upload") {
          // First callback run: update the original row so the portal sees it as done.
          await db
            .update(scriptRunResultsTable)
            .set({
              status: "completed",
              executionSource: "customer_upload",
              rawOutput: { text: JSON.stringify(body, null, 2) },
              uploadedAt: new Date(),
              uploadedBy: "customer_script_callback",
            })
            .where(eq(scriptRunResultsTable.id, orig.id));
          resultId = orig.id;
        }
      }
    }

    // Insert a new history row for repeat runs (original already completed) or
    // when no linked run result was on the token.
    if (resultId === null) {
      const [resultRow] = await db
        .insert(scriptRunResultsTable)
        .values({
          customerId: linkage.customerId,
          kanbanTaskId: linkage.kanbanTaskId,
          libraryScriptId: linkage.libraryScriptId,
          packageId: linkage.packageId,
          scriptId: linkage.scriptId,
          jobId: null,
          status: "completed",
          executionSource: "customer_upload",
          rawOutput: { text: JSON.stringify(body, null, 2) },
          uploadedAt: new Date(),
          uploadedBy: "customer_script_callback",
          scriptName: "Customer Upload",
        })
        .returning({ id: scriptRunResultsTable.id });
      resultId = resultRow?.id ?? null;
    }

    // Update last_used_at on the token
    await db
      .update(clientCallbackTokensTable)
      .set({ lastUsedAt: new Date() })
      .where(eq(clientCallbackTokensTable.id, tokenRow.id));

    logger.info(
      { tokenId: tokenRow.id, clientUserId: tokenRow.clientUserId, resultId },
      "admin-callback-tokens: customer script auto-callback received"
    );

    res.json({ received: true, resultId });

    // Fire-and-forget: run AI analysis and notify admins without blocking the response
    if (resultId !== null) {
      runCallbackAnalysis(resultId, body, linkage.customerId, linkage.libraryScriptId).catch((err) => {
        logger.error({ err, resultId }, "admin-callback-tokens: runCallbackAnalysis unhandled error");
      });
    }
  } catch (err) {
    logger.error({ err }, "admin-callback-tokens: script-callback error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── ADMIN: kanban task IDs with unreviewed customer_upload results ───────────

/**
 * GET /api/admin/projects/:projectId/customer-upload-task-ids
 *
 * Returns an array of kanban task IDs for which there is at least one
 * completed `customer_upload` script_run_results row that has not yet been
 * reviewed (reviewedAt IS NULL). Used to show the teal badge on kanban cards.
 */
router.get("/admin/projects/:projectId/customer-upload-task-ids", requireAdmin, async (req: Request, res: Response) => {
  const projectId = Number(req.params.projectId);
  if (!Number.isFinite(projectId) || projectId <= 0) {
    res.status(400).json({ error: "Invalid projectId" });
    return;
  }

  try {
    const rows = await db
      .select({ kanbanTaskId: scriptRunResultsTable.kanbanTaskId })
      .from(scriptRunResultsTable)
      .innerJoin(
        kanbanTasksTable,
        eq(scriptRunResultsTable.kanbanTaskId, kanbanTasksTable.id)
      )
      .where(
        and(
          eq(scriptRunResultsTable.executionSource, "customer_upload"),
          eq(scriptRunResultsTable.status, "completed"),
          isNull(scriptRunResultsTable.reviewedAt),
          isNotNull(scriptRunResultsTable.kanbanTaskId),
          eq(kanbanTasksTable.projectId, projectId),
        )
      );

    const taskIds = [...new Set(rows.map(r => r.kanbanTaskId).filter((id): id is number => id !== null))];
    res.json({ taskIds });
  } catch (err) {
    logger.error({ err, projectId }, "admin-callback-tokens: failed to get customer-upload task ids");
    res.status(500).json({ error: "Failed to fetch task ids" });
  }
});

// ─── ADMIN: list callback tokens for a client ────────────────────────────────

/**
 * GET /api/admin/callback-tokens?clientId=N
 *
 * Returns all callback tokens linked to a client — without the hash.
 * Each row includes: id, label, projectTitle, status (active|revoked),
 * createdAt, lastUsedAt.
 */
router.get("/admin/callback-tokens", requireAdmin, async (req: Request, res: Response) => {
  const clientIdRaw = Number(req.query.clientId);
  if (!Number.isFinite(clientIdRaw) || clientIdRaw <= 0) {
    res.status(400).json({ error: "clientId query parameter is required" });
    return;
  }

  try {
    const rows = await db
      .select({
        id: clientCallbackTokensTable.id,
        label: clientCallbackTokensTable.label,
        projectId: clientCallbackTokensTable.projectId,
        projectTitle: projectsTable.title,
        scriptRunResultId: clientCallbackTokensTable.scriptRunResultId,
        createdAt: clientCallbackTokensTable.createdAt,
        revokedAt: clientCallbackTokensTable.revokedAt,
        lastUsedAt: clientCallbackTokensTable.lastUsedAt,
      })
      .from(clientCallbackTokensTable)
      .leftJoin(projectsTable, eq(clientCallbackTokensTable.projectId, projectsTable.id))
      .where(eq(clientCallbackTokensTable.clientUserId, clientIdRaw))
      .orderBy(clientCallbackTokensTable.createdAt);

    const result = rows.map(r => ({
      id: r.id,
      label: r.label,
      projectId: r.projectId,
      projectTitle: r.projectTitle ?? null,
      scriptRunResultId: r.scriptRunResultId,
      status: r.revokedAt ? "revoked" : "active",
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt ?? null,
    }));

    res.json(result);
  } catch (err) {
    logger.error({ err, clientId: clientIdRaw }, "admin-callback-tokens: failed to list tokens");
    res.status(500).json({ error: "Failed to list tokens" });
  }
});

// ─── ADMIN: revoke a token ────────────────────────────────────────────────────

/**
 * DELETE /api/admin/callback-tokens/:id
 *
 * Sets revoked_at = NOW() on the given token. Idempotent — revoking an already-
 * revoked token is a no-op (still returns 200).
 */
router.delete("/admin/callback-tokens/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Invalid token id" });
    return;
  }

  try {
    const [updated] = await db
      .update(clientCallbackTokensTable)
      .set({ revokedAt: new Date() })
      .where(and(eq(clientCallbackTokensTable.id, id), isNull(clientCallbackTokensTable.revokedAt)))
      .returning({ id: clientCallbackTokensTable.id });

    if (!updated) {
      // Either already revoked or not found — both are acceptable
      const [existing] = await db
        .select({ id: clientCallbackTokensTable.id })
        .from(clientCallbackTokensTable)
        .where(eq(clientCallbackTokensTable.id, id))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: "Token not found" });
        return;
      }
    }

    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, tokenId: id }, "admin-callback-tokens: failed to revoke token");
    res.status(500).json({ error: "Failed to revoke token" });
  }
});

export default router;
