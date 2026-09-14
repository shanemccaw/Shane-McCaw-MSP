/**
 * msp-azure-credentials.ts
 *
 * MSP-Console-scoped CRUD for a client's Azure tenant credential (#3967,
 * Feature #3966). This is the technician-side mirror of
 * `admin-azure-credentials.ts`'s client-scoped endpoints
 * (`/admin/clients/:id/azure-credential`), with two differences:
 *
 *   1. Gated `requireCapability("ladder.msp-operator")` + `requireMspScope("params")`
 *      instead of `requireAdmin` — the standing MSP Console route gate
 *      (mirrored from `msp-launch-control.ts`).
 *   2. Every operation is filtered to the MSP's OWN book of clients. The real
 *      ownership join, confirmed against the live schema during the build audit
 *      (not assumed):
 *        azure_tenant_credentials.client_user_id → users.id  (FK, schema/index.ts:1911)
 *        users.msp_id                            → msps.id    (FK, schema/index.ts:108)
 *      so an MSP owns a credential iff its linked client user carries that
 *      MSP's msp_id. A client user belonging to a different MSP (or none) is
 *      treated as not found — no cross-MSP read or write is possible.
 *
 * The `:clientUserId` path segment is a `users.id` (the "client"), exactly as
 * the admin client-scoped routes key on `azure_tenant_credentials.client_user_id`.
 *
 * Credential VALUES (secrets, certs) live in Key Vault — this table stores only
 * metadata. The raw secret value is NEVER returned in any response; when one is
 * supplied it is written to Key Vault under the same deterministic
 * `client-${clientUserId}-appreg` name the admin surface uses (reuse, not
 * re-derive), and only the KV secret NAME is persisted/returned.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, azureTenantCredentialsTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireCapability, requireMspScope } from "../middlewares/requireAuth.ts";
import { setSecretValue } from "../lib/azure-keyvault.ts";
import { safeGetExpiry } from "../lib/azure-credential-expiry.ts";
import { logger } from "../lib/logger.ts";

const router: IRouter = Router();
const log = logger.child({ channel: "integration.azure" });

/**
 * Confirm `clientUserId` names a user that belongs to `mspId`. This is the
 * client→MSP ownership gate every handler below runs before touching a
 * credential row — it is what makes the surface "filtered to that MSP's own
 * book of clients." Returns true only when the users row exists AND its msp_id
 * matches; a client in another MSP (or with no msp_id) returns false.
 */
async function clientBelongsToMsp(clientUserId: number, mspId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(eq(usersTable.id, clientUserId), eq(usersTable.mspId, mspId)))
    .limit(1);
  return Boolean(row);
}

/** Deterministic Key Vault secret name for a client's app-registration secret. */
function kvSecretName(clientUserId: number): string {
  return `client-${clientUserId}-appreg`;
}

// ── GET /msp/:mspId/clients/:clientUserId/azure-credential ─────────────────────
// Fetch the credential linked to this client (or null). Only the owning MSP.
router.get(
  "/msp/:mspId/clients/:clientUserId/azure-credential",
  requireCapability("ladder.msp-operator"),
  requireMspScope("params"),
  async (req: Request, res: Response): Promise<void> => {
    const mspId = Number(req.params["mspId"]);
    const clientUserId = Number(req.params["clientUserId"]);
    if (isNaN(mspId) || isNaN(clientUserId)) {
      res.status(400).json({ error: "Invalid mspId or clientUserId" });
      return;
    }

    try {
      if (!(await clientBelongsToMsp(clientUserId, mspId))) {
        res.status(404).json({ error: "Client not found for this MSP" });
        return;
      }

      const [row] = await db
        .select()
        .from(azureTenantCredentialsTable)
        .where(eq(azureTenantCredentialsTable.clientUserId, clientUserId))
        .limit(1);

      if (!row) {
        res.json(null);
        return;
      }

      const expiresOn = await safeGetExpiry(row.keyVaultSecretName, req.log);
      res.json({ ...row, expiresOn });
    } catch (err) {
      log.error({ err, mspId, clientUserId }, "GET msp azure-credential failed");
      res.status(500).json({ error: "Failed to fetch Azure credential" });
    }
  },
);

// ── POST /msp/:mspId/clients/:clientUserId/azure-credential ────────────────────
// Upsert the credential for this client (insert, or update in place). Writes the
// raw secret to Key Vault when one is supplied; never returns it.
router.post(
  "/msp/:mspId/clients/:clientUserId/azure-credential",
  requireCapability("ladder.msp-operator"),
  requireMspScope("params"),
  async (req: Request, res: Response): Promise<void> => {
    const mspId = Number(req.params["mspId"]);
    const clientUserId = Number(req.params["clientUserId"]);
    if (isNaN(mspId) || isNaN(clientUserId)) {
      res.status(400).json({ error: "Invalid mspId or clientUserId" });
      return;
    }

    const { displayName, tenantId, clientId: appClientId, credentialType, keyVaultSecretName, clientSecretValue } =
      req.body as {
        displayName?: string;
        tenantId?: string;
        clientId?: string;
        credentialType?: "secret" | "certificate";
        keyVaultSecretName?: string;
        clientSecretValue?: string;
      };

    if (!displayName || !tenantId || !appClientId) {
      res.status(400).json({ error: "displayName, tenantId, and clientId are required" });
      return;
    }

    try {
      if (!(await clientBelongsToMsp(clientUserId, mspId))) {
        res.status(404).json({ error: "Client not found for this MSP" });
        return;
      }

      // Determine the Key Vault secret name to persist.
      let resolvedSecretName = keyVaultSecretName;
      if (clientSecretValue && clientSecretValue.trim() !== "") {
        const derivedName = kvSecretName(clientUserId);
        try {
          await setSecretValue(derivedName, clientSecretValue.trim(), {
            mspId: String(mspId),
            clientId: String(clientUserId),
            appClientId,
          });
        } catch (err) {
          log.error({ err, mspId, clientUserId, derivedName }, "msp azure-credential: failed to write secret to Key Vault");
          res.status(502).json({ error: "Failed to write secret to Key Vault — credential not saved" });
          return;
        }
        resolvedSecretName = derivedName;
      }

      if (!resolvedSecretName) {
        res.status(400).json({ error: "Provide either a Client Secret Value or a Key Vault Secret Name" });
        return;
      }

      const [existing] = await db
        .select({ id: azureTenantCredentialsTable.id })
        .from(azureTenantCredentialsTable)
        .where(eq(azureTenantCredentialsTable.clientUserId, clientUserId))
        .limit(1);

      if (existing) {
        const [row] = await db
          .update(azureTenantCredentialsTable)
          .set({
            displayName,
            tenantId,
            clientId: appClientId,
            credentialType: credentialType ?? "secret",
            keyVaultSecretName: resolvedSecretName,
            updatedAt: new Date(),
          })
          .where(eq(azureTenantCredentialsTable.id, existing.id))
          .returning();
        res.json(row);
      } else {
        const [row] = await db
          .insert(azureTenantCredentialsTable)
          .values({
            displayName,
            tenantId,
            clientId: appClientId,
            credentialType: credentialType ?? "secret",
            keyVaultSecretName: resolvedSecretName,
            clientUserId,
          })
          .returning();
        res.status(201).json(row);
      }
    } catch (err) {
      log.error({ err, mspId, clientUserId }, "POST msp azure-credential failed");
      res.status(500).json({ error: "Failed to save Azure credential" });
    }
  },
);

// ── PUT /msp/:mspId/clients/:clientUserId/azure-credential ─────────────────────
// Update the existing credential for this client in place. 404 if none exists
// yet (use POST to create). Writes a supplied raw secret to Key Vault; never
// returns it.
router.put(
  "/msp/:mspId/clients/:clientUserId/azure-credential",
  requireCapability("ladder.msp-operator"),
  requireMspScope("params"),
  async (req: Request, res: Response): Promise<void> => {
    const mspId = Number(req.params["mspId"]);
    const clientUserId = Number(req.params["clientUserId"]);
    if (isNaN(mspId) || isNaN(clientUserId)) {
      res.status(400).json({ error: "Invalid mspId or clientUserId" });
      return;
    }

    const { displayName, tenantId, clientId: appClientId, credentialType, keyVaultSecretName, clientSecretValue } =
      req.body as {
        displayName?: string;
        tenantId?: string;
        clientId?: string;
        credentialType?: "secret" | "certificate";
        keyVaultSecretName?: string;
        clientSecretValue?: string;
      };

    try {
      if (!(await clientBelongsToMsp(clientUserId, mspId))) {
        res.status(404).json({ error: "Client not found for this MSP" });
        return;
      }

      const [existing] = await db
        .select({ id: azureTenantCredentialsTable.id })
        .from(azureTenantCredentialsTable)
        .where(eq(azureTenantCredentialsTable.clientUserId, clientUserId))
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: "Credential not found" });
        return;
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (displayName !== undefined) updates.displayName = displayName;
      if (tenantId !== undefined) updates.tenantId = tenantId;
      if (appClientId !== undefined) updates.clientId = appClientId;
      if (credentialType !== undefined) updates.credentialType = credentialType;

      // If a raw secret value is provided, write it to Key Vault first.
      if (clientSecretValue && clientSecretValue.trim() !== "") {
        const derivedName = kvSecretName(clientUserId);
        try {
          await setSecretValue(derivedName, clientSecretValue.trim(), {
            mspId: String(mspId),
            clientId: String(clientUserId),
            ...(appClientId ? { appClientId } : {}),
          });
        } catch (err) {
          log.error({ err, mspId, clientUserId, derivedName }, "msp azure-credential: failed to write secret to Key Vault");
          res.status(502).json({ error: "Failed to write secret to Key Vault — credential not updated" });
          return;
        }
        updates.keyVaultSecretName = derivedName;
      } else if (keyVaultSecretName !== undefined) {
        updates.keyVaultSecretName = keyVaultSecretName;
      }

      const [row] = await db
        .update(azureTenantCredentialsTable)
        .set(updates)
        .where(eq(azureTenantCredentialsTable.id, existing.id))
        .returning();
      res.json(row);
    } catch (err) {
      log.error({ err, mspId, clientUserId }, "PUT msp azure-credential failed");
      res.status(500).json({ error: "Failed to update Azure credential" });
    }
  },
);

// ── DELETE /msp/:mspId/clients/:clientUserId/azure-credential ──────────────────
// Remove the credential linked to this client. Only the owning MSP.
router.delete(
  "/msp/:mspId/clients/:clientUserId/azure-credential",
  requireCapability("ladder.msp-operator"),
  requireMspScope("params"),
  async (req: Request, res: Response): Promise<void> => {
    const mspId = Number(req.params["mspId"]);
    const clientUserId = Number(req.params["clientUserId"]);
    if (isNaN(mspId) || isNaN(clientUserId)) {
      res.status(400).json({ error: "Invalid mspId or clientUserId" });
      return;
    }

    try {
      if (!(await clientBelongsToMsp(clientUserId, mspId))) {
        res.status(404).json({ error: "Client not found for this MSP" });
        return;
      }

      await db
        .delete(azureTenantCredentialsTable)
        .where(eq(azureTenantCredentialsTable.clientUserId, clientUserId));

      res.json({ ok: true });
    } catch (err) {
      log.error({ err, mspId, clientUserId }, "DELETE msp azure-credential failed");
      res.status(500).json({ error: "Failed to delete Azure credential" });
    }
  },
);

export default router;
