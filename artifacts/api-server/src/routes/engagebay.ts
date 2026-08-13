// EngageBay connection routes (EngageBay Integration Foundation, #104).
//
//   POST /api/engagebay/connect — admin-gated; accepts a pasted API key, stores
//                                 it in Key Vault, validates it with a live
//                                 call, and upserts the connection row
//   GET  /api/engagebay/status  — connection status for the Admin Panel
//                                 (never returns the key value)
//
// Single-tenant: everything binds to MSP #1 (ENGAGEBAY_DEFAULT_MSP_ID). Unlike
// Zoho this is not OAuth — there is no /start or /callback, just a key pasted
// once in Admin Panel Settings (per the architecture plan, #78).

import { Router, type IRouter, type Request, type Response } from "express";
import { db, engagebayConnectionTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";
import { setSecretValue } from "../lib/azure-keyvault.ts";
import {
  ENGAGEBAY_DEFAULT_MSP_ID,
  EngageBayApiError,
  clearEngageBayApiKeyCache,
  engagebayApiKeySecretName,
  listTags,
} from "../lib/engagebay-client.ts";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "integration.engagebay" });

const router: IRouter = Router();

router.post("/engagebay/connect", requireAdmin, async (req: Request, res: Response) => {
  const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
  if (!apiKey) {
    res.status(400).json({ error: "apiKey is required" });
    return;
  }

  const secretName = engagebayApiKeySecretName(ENGAGEBAY_DEFAULT_MSP_ID);
  try {
    await setSecretValue(secretName, apiKey, {
      mspId: String(ENGAGEBAY_DEFAULT_MSP_ID),
      purpose: "engagebay-api-key",
    });
  } catch (err) {
    log.error({ err }, "engagebay: failed to store API key in Key Vault");
    res.status(503).json({ error: "Could not store the EngageBay API key in Azure Key Vault. Connection was not saved." });
    return;
  }

  const now = new Date();
  await db
    .insert(engagebayConnectionTable)
    .values({
      mspId: ENGAGEBAY_DEFAULT_MSP_ID,
      keyVaultSecretName: secretName,
      status: "disconnected",
      lastErrorMessage: null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: engagebayConnectionTable.mspId,
      set: { keyVaultSecretName: secretName, lastErrorMessage: null, updatedAt: now },
    });
  clearEngageBayApiKeyCache(ENGAGEBAY_DEFAULT_MSP_ID);

  // Validate the key with a real call before reporting "connected" — a bad
  // paste should fail loudly here, not silently on the first real write.
  try {
    await listTags(ENGAGEBAY_DEFAULT_MSP_ID);
    await db
      .update(engagebayConnectionTable)
      .set({ status: "connected", connectedAt: now, lastErrorMessage: null, updatedAt: new Date() })
      .where(eq(engagebayConnectionTable.mspId, ENGAGEBAY_DEFAULT_MSP_ID));
    log.info({ mspId: ENGAGEBAY_DEFAULT_MSP_ID }, "engagebay: connected");
    res.json({ status: "connected" });
  } catch (err) {
    const reason = err instanceof EngageBayApiError ? err.message : String(err);
    log.warn({ err, mspId: ENGAGEBAY_DEFAULT_MSP_ID }, "engagebay: key validation failed");
    res.status(502).json({ error: `EngageBay rejected the key: ${reason}`, status: "error" });
  }
});

router.get("/engagebay/status", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const [row] = await db
      .select({
        status: engagebayConnectionTable.status,
        connectedAt: engagebayConnectionTable.connectedAt,
        lastErrorMessage: engagebayConnectionTable.lastErrorMessage,
      })
      .from(engagebayConnectionTable)
      .where(eq(engagebayConnectionTable.mspId, ENGAGEBAY_DEFAULT_MSP_ID))
      .limit(1);

    res.json({ connection: row ?? { status: "disconnected" } });
  } catch (err) {
    log.error({ err }, "engagebay: status read failed");
    res.status(500).json({ error: "Could not read EngageBay connection status" });
  }
});

export default router;
