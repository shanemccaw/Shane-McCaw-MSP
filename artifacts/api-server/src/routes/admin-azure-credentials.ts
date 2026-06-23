/**
 * admin-azure-credentials.ts
 *
 * CRUD routes for Azure Tenant Credentials (per-customer app registrations).
 * Credential values (secrets, certs) are stored in Key Vault — this table
 * only stores metadata. No sensitive values are returned.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db, azureTenantCredentialsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAdmin } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/admin/azure-credentials", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const rows = await db
      .select()
      .from(azureTenantCredentialsTable)
      .orderBy(azureTenantCredentialsTable.displayName);
    res.json(rows);
  } catch {
    res.status(500).json({ error: "Failed to fetch Azure credentials" });
  }
});

router.post("/admin/azure-credentials", requireAdmin, async (req: Request, res: Response) => {
  try {
    const { displayName, tenantId, clientId, credentialType, keyVaultSecretName, clientUserId } =
      req.body as {
        displayName?: string;
        tenantId?: string;
        clientId?: string;
        credentialType?: "secret" | "certificate";
        keyVaultSecretName?: string;
        clientUserId?: number | null;
      };

    if (!displayName || !tenantId || !clientId || !keyVaultSecretName) {
      res.status(400).json({ error: "displayName, tenantId, clientId, and keyVaultSecretName are required" });
      return;
    }

    const [row] = await db
      .insert(azureTenantCredentialsTable)
      .values({
        displayName,
        tenantId,
        clientId,
        credentialType: credentialType ?? "secret",
        keyVaultSecretName,
        clientUserId: clientUserId ?? null,
      })
      .returning();

    res.status(201).json(row);
  } catch {
    res.status(500).json({ error: "Failed to create Azure credential" });
  }
});

router.put("/admin/azure-credentials/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    const { displayName, tenantId, clientId, credentialType, keyVaultSecretName, clientUserId } =
      req.body as {
        displayName?: string;
        tenantId?: string;
        clientId?: string;
        credentialType?: "secret" | "certificate";
        keyVaultSecretName?: string;
        clientUserId?: number | null;
      };

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (displayName !== undefined) updates.displayName = displayName;
    if (tenantId !== undefined) updates.tenantId = tenantId;
    if (clientId !== undefined) updates.clientId = clientId;
    if (credentialType !== undefined) updates.credentialType = credentialType;
    if (keyVaultSecretName !== undefined) updates.keyVaultSecretName = keyVaultSecretName;
    if (clientUserId !== undefined) updates.clientUserId = clientUserId;

    const [row] = await db
      .update(azureTenantCredentialsTable)
      .set(updates)
      .where(eq(azureTenantCredentialsTable.id, id))
      .returning();

    if (!row) { res.status(404).json({ error: "Credential not found" }); return; }
    res.json(row);
  } catch {
    res.status(500).json({ error: "Failed to update Azure credential" });
  }
});

router.delete("/admin/azure-credentials/:id", requireAdmin, async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

    await db.delete(azureTenantCredentialsTable).where(eq(azureTenantCredentialsTable.id, id));
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete Azure credential" });
  }
});

// ─── Client-scoped credential endpoints ──────────────────────────────────────
// GET  /admin/clients/:id/azure-credential  — fetch credential linked to this client (or null)
// POST /admin/clients/:id/azure-credential  — upsert credential for this client
// DELETE /admin/clients/:id/azure-credential — remove credential linked to this client

router.get("/admin/clients/:id/azure-credential", requireAdmin, async (req: Request, res: Response) => {
  try {
    const clientId = Number(req.params.id);
    if (isNaN(clientId)) { res.status(400).json({ error: "Invalid client id" }); return; }

    const [row] = await db
      .select()
      .from(azureTenantCredentialsTable)
      .where(eq(azureTenantCredentialsTable.clientUserId, clientId))
      .limit(1);

    res.json(row ?? null);
  } catch {
    res.status(500).json({ error: "Failed to fetch Azure credential" });
  }
});

router.post("/admin/clients/:id/azure-credential", requireAdmin, async (req: Request, res: Response) => {
  try {
    const clientId = Number(req.params.id);
    if (isNaN(clientId)) { res.status(400).json({ error: "Invalid client id" }); return; }

    const { displayName, tenantId, clientId: appClientId, credentialType, keyVaultSecretName } =
      req.body as {
        displayName?: string;
        tenantId?: string;
        clientId?: string;
        credentialType?: "secret" | "certificate";
        keyVaultSecretName?: string;
      };

    if (!displayName || !tenantId || !appClientId || !keyVaultSecretName) {
      res.status(400).json({ error: "displayName, tenantId, clientId, and keyVaultSecretName are required" });
      return;
    }

    const [existing] = await db
      .select({ id: azureTenantCredentialsTable.id })
      .from(azureTenantCredentialsTable)
      .where(eq(azureTenantCredentialsTable.clientUserId, clientId))
      .limit(1);

    if (existing) {
      const [row] = await db
        .update(azureTenantCredentialsTable)
        .set({
          displayName,
          tenantId,
          clientId: appClientId,
          credentialType: credentialType ?? "secret",
          keyVaultSecretName,
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
          keyVaultSecretName,
          clientUserId: clientId,
        })
        .returning();
      res.status(201).json(row);
    }
  } catch {
    res.status(500).json({ error: "Failed to save Azure credential" });
  }
});

router.delete("/admin/clients/:id/azure-credential", requireAdmin, async (req: Request, res: Response) => {
  try {
    const clientId = Number(req.params.id);
    if (isNaN(clientId)) { res.status(400).json({ error: "Invalid client id" }); return; }

    await db
      .delete(azureTenantCredentialsTable)
      .where(eq(azureTenantCredentialsTable.clientUserId, clientId));

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete Azure credential" });
  }
});

export default router;
