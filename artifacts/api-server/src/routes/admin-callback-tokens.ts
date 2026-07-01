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
import { db, clientCallbackTokensTable, scriptRunResultsTable, projectsTable, kanbanTasksTable } from "@workspace/db";
import { eq, and, isNull, isNotNull } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { logger } from "../lib/logger.ts";
import { createHash } from "crypto";

const router: IRouter = Router();

function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
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

    // Always insert a new row per run so history is preserved across repeat invocations.
    // When the token was linked to an original "awaiting_upload" row, copy its linkage
    // fields (kanbanTaskId, libraryScriptId, packageId, scriptId) so the new row is
    // associated with the same kanban card and library script.
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

    if (tokenRow.scriptRunResultId !== null) {
      const [orig] = await db
        .select({
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
      }
    }

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
        rawOutput: body,
        uploadedAt: new Date(),
        uploadedBy: "customer_script_callback",
      })
      .returning({ id: scriptRunResultsTable.id });
    const resultId = resultRow?.id ?? null;

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
