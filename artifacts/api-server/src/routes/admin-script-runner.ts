/**
 * admin-script-runner.ts
 *
 * Script Library management and download-token administration.
 *
 * GET    /api/admin/script-library                — list PS scripts with platformPublished flag
 * PATCH  /api/admin/script-library/:id/publish    — toggle platformPublished on/off
 * GET    /api/admin/script-download-tokens        — list tokens (filterable by scriptId, customerId)
 * POST   /api/admin/script-download-tokens        — generate a single-use download token
 * DELETE /api/admin/script-download-tokens/:id    — revoke a token
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  pool,
  powershellScriptsTable,
  scriptDownloadTokensTable,
  usersTable,
} from "@workspace/db";
import { eq, desc, and, isNull } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "workflow.script" });
import { randomUUID } from "crypto";
import { createHash } from "crypto";

const router: IRouter = Router();

function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

/** Default token TTL: 72 hours */
const TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

// ── GET /api/admin/script-library ─────────────────────────────────────────────

router.get("/admin/script-library", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await pool.query<{
      id: string;
      title: string;
      description: string | null;
      category: string;
      script_type: string | null;
      schema_version: string | null;
      platform_published: boolean;
      tags: string[];
      created_at: string;
      updated_at: string;
    }>(
      `SELECT id, title, description, category, script_type, schema_version,
              platform_published, tags, created_at, updated_at
       FROM powershell_scripts
       ORDER BY platform_published DESC, created_at DESC`,
    );
    res.json(
      rows.rows.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        category: r.category,
        scriptType: r.script_type,
        schemaVersion: r.schema_version,
        platformPublished: r.platform_published,
        tags: r.tags,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    );
  } catch (err) {
    log.error({ err }, "admin-script-runner: failed to list script library");
    res.status(500).json({ error: "Failed to list script library" });
  }
});

// ── PATCH /api/admin/script-library/:id/publish ───────────────────────────────

router.patch("/admin/script-library/:id/publish", requireAdmin, async (req: Request, res: Response) => {
  const { id } = req.params as { id: string };
  const { published } = req.body as { published?: boolean };

  if (typeof published !== "boolean") {
    res.status(400).json({ error: "published (boolean) is required" });
    return;
  }

  try {
    const [updated] = await db
      .update(powershellScriptsTable)
      .set({ platformPublished: published, updatedAt: new Date() })
      .where(eq(powershellScriptsTable.id, id))
      .returning({ id: powershellScriptsTable.id, platformPublished: powershellScriptsTable.platformPublished });

    if (!updated) {
      res.status(404).json({ error: "Script not found" });
      return;
    }

    log.info({ scriptId: id, published }, "admin-script-runner: toggled platformPublished");
    res.json(updated);
  } catch (err) {
    log.error({ err, id }, "admin-script-runner: failed to update publish state");
    res.status(500).json({ error: "Failed to update publish state" });
  }
});

// ── GET /api/admin/script-download-tokens ─────────────────────────────────────

router.get("/admin/script-download-tokens", requireAdmin, async (req: Request, res: Response) => {
  const { scriptId, customerId } = req.query as { scriptId?: string; customerId?: string };

  try {
    const rows = await pool.query<{
      id: number;
      script_id: string;
      script_title: string;
      msp_id: number | null;
      customer_id: number | null;
      customer_name: string | null;
      label: string;
      expires_at: string;
      used_at: string | null;
      revoked_at: string | null;
      run_result_id: number | null;
      created_at: string;
    }>(
      `SELECT t.id, t.script_id, ps.title AS script_title,
              t.msp_id, t.customer_id, u.name AS customer_name, t.label,
              t.expires_at, t.used_at, t.revoked_at, t.run_result_id, t.created_at
       FROM script_download_tokens t
       JOIN powershell_scripts ps ON ps.id = t.script_id
       LEFT JOIN users u ON u.id = t.customer_id
       WHERE ($1::uuid IS NULL OR t.script_id = $1::uuid)
         AND ($2::int IS NULL OR t.customer_id = $2::int)
       ORDER BY t.created_at DESC
       LIMIT 200`,
      [scriptId ?? null, customerId ? parseInt(customerId, 10) : null],
    );

    res.json(
      rows.rows.map((r) => ({
        id: r.id,
        scriptId: r.script_id,
        scriptTitle: r.script_title,
        mspId: r.msp_id,
        customerId: r.customer_id,
        customerName: r.customer_name,
        label: r.label,
        expiresAt: r.expires_at,
        usedAt: r.used_at,
        revokedAt: r.revoked_at,
        runResultId: r.run_result_id,
        createdAt: r.created_at,
        status: r.revoked_at ? "revoked" : r.used_at ? "used" : new Date(r.expires_at) < new Date() ? "expired" : "active",
      })),
    );
  } catch (err) {
    log.error({ err }, "admin-script-runner: failed to list download tokens");
    res.status(500).json({ error: "Failed to list download tokens" });
  }
});

// ── POST /api/admin/script-download-tokens ────────────────────────────────────

router.post("/admin/script-download-tokens", requireAdmin, async (req: Request, res: Response) => {
  const { scriptId, customerId, mspId, label, ttlHours } = req.body as {
    scriptId?: string;
    customerId?: number;
    mspId?: number;
    label?: string;
    ttlHours?: number;
  };

  if (!scriptId || typeof scriptId !== "string") {
    res.status(400).json({ error: "scriptId is required" });
    return;
  }

  try {
    const [script] = await db
      .select({ id: powershellScriptsTable.id, title: powershellScriptsTable.title })
      .from(powershellScriptsTable)
      .where(eq(powershellScriptsTable.id, scriptId))
      .limit(1);

    if (!script) {
      res.status(404).json({ error: "Script not found" });
      return;
    }

    const plaintext = randomUUID();
    const tokenHash = hashToken(plaintext);
    const ttl = typeof ttlHours === "number" && ttlHours > 0 ? ttlHours * 60 * 60 * 1000 : TOKEN_TTL_MS;
    const expiresAt = new Date(Date.now() + ttl);

    const [row] = await db
      .insert(scriptDownloadTokensTable)
      .values({
        tokenHash,
        scriptId,
        mspId: mspId ?? null,
        customerId: customerId ?? null,
        label: label?.trim() ?? script.title,
        expiresAt,
      })
      .returning({ id: scriptDownloadTokensTable.id, expiresAt: scriptDownloadTokensTable.expiresAt });

    log.info({ tokenId: row.id, scriptId, customerId, mspId }, "admin-script-runner: generated download token");

    res.status(201).json({
      tokenId: row.id,
      token: plaintext,
      scriptId,
      expiresAt: row.expiresAt,
    });
  } catch (err) {
    log.error({ err }, "admin-script-runner: failed to generate download token");
    res.status(500).json({ error: "Failed to generate download token" });
  }
});

// ── DELETE /api/admin/script-download-tokens/:tokenId ─────────────────────────

router.delete("/admin/script-download-tokens/:tokenId", requireAdmin, async (req: Request, res: Response) => {
  const tokenId = parseInt(String(req.params["tokenId"] ?? ""), 10);
  if (isNaN(tokenId)) {
    res.status(400).json({ error: "Invalid token ID" });
    return;
  }

  try {
    const [revoked] = await db
      .update(scriptDownloadTokensTable)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(scriptDownloadTokensTable.id, tokenId),
          isNull(scriptDownloadTokensTable.revokedAt),
        ),
      )
      .returning({ id: scriptDownloadTokensTable.id });

    if (!revoked) {
      res.status(404).json({ error: "Token not found or already revoked" });
      return;
    }

    log.info({ tokenId }, "admin-script-runner: revoked download token");
    res.json({ revoked: true, tokenId });
  } catch (err) {
    log.error({ err, tokenId }, "admin-script-runner: failed to revoke token");
    res.status(500).json({ error: "Failed to revoke token" });
  }
});

export default router;
