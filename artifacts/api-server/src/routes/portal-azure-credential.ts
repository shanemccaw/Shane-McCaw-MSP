/**
 * portal-azure-credential.ts
 *
 * Customer self-service view + rotation of the per-customer Azure app
 * registration credential (Phase 1 of #3960, issue #3961).
 *
 * This is the customer-facing sibling of admin-azure-credentials.ts's
 * client-scoped endpoints — it reuses the same `azure_tenant_credentials`
 * table, the same `setSecretValue` Key Vault path, and the same
 * `client-${clientUserId}-appreg` deterministic secret-naming convention (the
 * row's stored `keyVaultSecretName` already follows it). The secret VALUE lives
 * only in Key Vault; this table holds metadata only, and — exactly as the admin
 * route guarantees — no sensitive value is ever returned in a response here.
 *
 * A credential belongs to the CUSTOMER account, not one login, so both routes
 * resolve the caller's full sibling-login set (`resolveSiblingUserIds`) and
 * match the credential by `clientUserId IN (...siblings)` rather than pinning to
 * whichever login happens to be signed in.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, azureTenantCredentialsTable, type AzureTenantCredential } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth.ts";
import { setSecretValue } from "../lib/azure-keyvault.ts";
import { safeGetExpiry } from "../lib/azure-credential-expiry.ts";
import { resolveSiblingUserIds } from "../lib/tenant-signals.ts";

const router: IRouter = Router();

/**
 * The metadata-only projection returned to the portal. Deliberately an explicit
 * allow-list — never `...row` — so no future column (and never the Key Vault
 * secret name's value) can leak into a customer-facing response by accident.
 */
async function toPortalCredentialView(
  row: AzureTenantCredential,
  log: { warn: (obj: object, msg: string) => void },
) {
  const expiresOn = await safeGetExpiry(row.keyVaultSecretName, log);
  return {
    id: row.id,
    displayName: row.displayName,
    tenantId: row.tenantId,
    clientId: row.clientId,
    credentialType: row.credentialType,
    expiresOn,
    updatedAt: row.updatedAt,
  };
}

/**
 * GET /portal/azure-credential
 * Returns the signed-in customer's Azure credential metadata, or null if none
 * is registered. Never returns the secret value.
 */
router.get("/portal/azure-credential", requireAuth, async (req: Request, res: Response) => {
  try {
    const siblingIds = await resolveSiblingUserIds(req.user!.id);

    const [row] = await db
      .select()
      .from(azureTenantCredentialsTable)
      .where(inArray(azureTenantCredentialsTable.clientUserId, siblingIds))
      .limit(1);

    if (!row) {
      res.json(null);
      return;
    }

    res.json(await toPortalCredentialView(row, req.log));
  } catch (err) {
    req.log.error({ err }, "portal-azure-credential: failed to fetch credential");
    res.status(500).json({ error: "Failed to fetch Azure credential" });
  }
});

/**
 * POST /portal/azure-credential/rotate
 * Accepts a new client secret value, writes it to the credential's existing Key
 * Vault secret (in-place rotation — never orphans a secret, and honours the
 * `client-${clientUserId}-appreg` convention the row was created under), and
 * touches the row's updatedAt. Returns the same metadata-only view; the new
 * secret value is never echoed back.
 */
router.post("/portal/azure-credential/rotate", requireAuth, async (req: Request, res: Response) => {
  try {
    const { clientSecretValue } = req.body as { clientSecretValue?: string };
    if (!clientSecretValue || clientSecretValue.trim() === "") {
      res.status(400).json({ error: "clientSecretValue is required" });
      return;
    }

    const siblingIds = await resolveSiblingUserIds(req.user!.id);

    const [existing] = await db
      .select()
      .from(azureTenantCredentialsTable)
      .where(inArray(azureTenantCredentialsTable.clientUserId, siblingIds))
      .limit(1);

    if (!existing) {
      res.status(404).json({ error: "No Azure credential is registered for this account" });
      return;
    }

    if (existing.credentialType !== "secret") {
      res.status(400).json({ error: "Only secret credentials can be rotated" });
      return;
    }

    // Rotate in place at the row's existing Key Vault secret name — that name was
    // written by the admin client-scoped route under the shared
    // `client-${clientUserId}-appreg` convention, so this reuses it rather than
    // re-deriving (and can never orphan the old secret at a different name).
    const secretName = existing.keyVaultSecretName;
    try {
      await setSecretValue(secretName, clientSecretValue.trim(), {
        clientId: String(existing.clientUserId ?? existing.id),
        appClientId: existing.clientId,
        rotatedVia: "portal-self-service",
      });
    } catch (err) {
      req.log.error({ err, secretName }, "portal-azure-credential: failed to write rotated secret to Key Vault");
      res.status(502).json({ error: "Failed to write secret to Key Vault — credential not rotated" });
      return;
    }

    const [row] = await db
      .update(azureTenantCredentialsTable)
      .set({ updatedAt: new Date() })
      .where(eq(azureTenantCredentialsTable.id, existing.id))
      .returning();

    res.json(await toPortalCredentialView(row, req.log));
  } catch (err) {
    req.log.error({ err }, "portal-azure-credential: failed to rotate credential");
    res.status(500).json({ error: "Failed to rotate Azure credential" });
  }
});

export default router;
