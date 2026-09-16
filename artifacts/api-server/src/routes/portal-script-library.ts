/**
 * portal-script-library.ts
 *
 * MSP Portal routes for the platform script library.
 *
 * GET  /api/portal/scripts              — list platform-published scripts (MSP auth required)
 * POST /api/portal/scripts/:id/download — generate a single-use download token and
 *                                         return the augmented .ps1 script body with
 *                                         the token and ingestion endpoint injected.
 *
 * The token-minting / script-augmentation logic lives in the shared
 * lib/script-download-token.ts primitive (Git #4354) so the unified Automation
 * wrapper's run path delegates to the exact same mechanism.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { requireCapability } from "../middlewares/requireAuth.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "workflow.script" });
import {
  generateScriptDownloadToken,
  ScriptDownloadTokenError,
} from "../lib/script-download-token.ts";

const router: IRouter = Router();

// ── GET /api/portal/scripts ───────────────────────────────────────────────────

router.get(
  "/portal/scripts",
  requireCapability("ladder.msp-operator"),
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
      log.error({ err }, "portal-script-library: failed to list scripts");
      res.status(500).json({ error: "Failed to list scripts" });
    }
  },
);

// ── POST /api/portal/scripts/:id/download ─────────────────────────────────────

router.post(
  "/portal/scripts/:id/download",
  requireCapability("ladder.msp-operator"),
  async (req: Request, res: Response) => {
    const { id } = req.params as { id: string };
    const user = req.user!;
    const { customerId } = req.body as { customerId?: number };

    try {
      const result = await generateScriptDownloadToken({
        scriptId: id,
        mspId: user.mspId ?? null,
        customerId: customerId ?? null,
      });

      log.info(
        { tokenId: result.tokenId, scriptId: id, mspId: user.mspId, customerId },
        "portal-script-library: generated download token",
      );

      res.json({
        tokenId: result.tokenId,
        scriptTitle: result.scriptTitle,
        scriptType: result.scriptType,
        schemaVersion: result.schemaVersion,
        expiresAt: result.expiresAt,
        scriptBody: result.scriptBody,
      });
    } catch (err) {
      if (err instanceof ScriptDownloadTokenError) {
        res.status(err.status).json({ error: err.message });
        return;
      }
      log.error({ err, scriptId: id }, "portal-script-library: failed to generate download");
      res.status(500).json({ error: "Failed to generate script download" });
    }
  },
);

export default router;
