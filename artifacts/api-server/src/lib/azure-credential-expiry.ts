/**
 * azure-credential-expiry.ts
 *
 * Shared expiry-lookup logic for Azure Tenant Credentials (azure_tenant_credentials).
 * Single source of truth for "which credentials are expiring soon" — used by both:
 *   - GET /admin/azure-credentials/expiring-summary (admin-azure-credentials.ts, the
 *     dashboard count badge)
 *   - the azure_credential_expiry_check workflow node (azure-credential-expiry-alert.ts,
 *     Git #3861), which sends the real email
 * so the two never drift on what "expiring" means.
 */

import { db, azureTenantCredentialsTable } from "@workspace/db";
import { getSecretMetadata } from "./azure-keyvault.ts";

export const EXPIRY_WARN_DAYS = 60;

export interface ExpiringAzureCredential {
  id: number;
  displayName: string;
  clientUserId: number | null;
  tenantId: string;
  clientId: string;
  keyVaultSecretName: string;
  expiresOn: string;
  daysLeft: number;
  lastExpiryAlertSentAt: Date | null;
}

/**
 * Safely fetch expiry metadata for a single Key Vault secret.
 * Returns null (no warning) if Azure is not configured or the call fails.
 */
export async function safeGetExpiry(
  secretName: string,
  log: { warn: (obj: object, msg: string) => void },
): Promise<string | null> {
  try {
    const meta = await getSecretMetadata(secretName);
    return meta.expiresOn ? meta.expiresOn.toISOString() : null;
  } catch (err) {
    log.warn({ err, secretName }, "azure-credential-expiry: could not fetch KV expiry");
    return null;
  }
}

/**
 * Returns every azure_tenant_credentials row whose Key Vault secret expires
 * within EXPIRY_WARN_DAYS days (including already-expired, daysLeft <= 0).
 * Credentials where KV metadata is unavailable are silently excluded — same
 * contract the expiring-summary route has always had.
 */
export async function getExpiringAzureCredentials(
  log: { warn: (obj: object, msg: string) => void },
): Promise<ExpiringAzureCredential[]> {
  const rows = await db
    .select()
    .from(azureTenantCredentialsTable)
    .orderBy(azureTenantCredentialsTable.displayName);

  const warnCutoff = new Date(Date.now() + EXPIRY_WARN_DAYS * 24 * 60 * 60 * 1000);

  const enriched = await Promise.all(
    rows.map(async row => ({
      row,
      expiresOn: await safeGetExpiry(row.keyVaultSecretName, log),
    })),
  );

  return enriched
    .filter(r => r.expiresOn && new Date(r.expiresOn) <= warnCutoff)
    .map(r => ({
      id: r.row.id,
      displayName: r.row.displayName,
      clientUserId: r.row.clientUserId,
      tenantId: r.row.tenantId,
      clientId: r.row.clientId,
      keyVaultSecretName: r.row.keyVaultSecretName,
      expiresOn: r.expiresOn as string,
      daysLeft: Math.ceil((new Date(r.expiresOn as string).getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
      lastExpiryAlertSentAt: r.row.lastExpiryAlertSentAt,
    }));
}
