/**
 * azure-keyvault.ts
 *
 * Retrieves secrets and certificates from Azure Key Vault.
 * Credentials are NEVER returned to any API response — only passed server-side.
 *
 * Required env vars:
 *   AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID, AZURE_KEY_VAULT_URL
 */

import { SecretClient } from "@azure/keyvault-secrets";
import { CertificateClient } from "@azure/keyvault-certificates";
import { ClientSecretCredential } from "@azure/identity";
import { logger } from "./logger";

function getCredentialClient() {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("AZURE_TENANT_ID, AZURE_CLIENT_ID, and AZURE_CLIENT_SECRET must be set");
  }
  return new ClientSecretCredential(tenantId, clientId, clientSecret);
}

function getKeyVaultUrl(): string {
  const url = process.env.AZURE_KEY_VAULT_URL;
  if (!url) throw new Error("AZURE_KEY_VAULT_URL must be set");
  return url;
}

/**
 * Retrieve a secret value from Key Vault.
 * Returns the secret string value — do not log or return to API callers.
 */
export async function getSecretValue(secretName: string): Promise<string> {
  const credential = getCredentialClient();
  const client = new SecretClient(getKeyVaultUrl(), credential);
  const secret = await client.getSecret(secretName);
  if (!secret.value) {
    throw new Error(`Secret '${secretName}' has no value in Key Vault`);
  }
  return secret.value;
}

/**
 * Retrieve a certificate's PEM-encoded private key from Key Vault.
 * Returns the PEM string — do not log or return to API callers.
 */
export async function getCertificatePem(certName: string): Promise<string> {
  const credential = getCredentialClient();
  const vaultUrl = getKeyVaultUrl();
  const secretClient = new SecretClient(vaultUrl, credential);
  const certClient = new CertificateClient(vaultUrl, credential);

  const cert = await certClient.getCertificate(certName);
  const secretId = cert.secretId;
  if (!secretId) {
    throw new Error(`Certificate '${certName}' has no associated secret in Key Vault`);
  }

  const secretName = secretId.split("/").at(-2);
  if (!secretName) throw new Error("Could not parse secret name from certificate secretId");

  const secret = await secretClient.getSecret(secretName);
  if (!secret.value) {
    throw new Error(`Certificate secret '${secretName}' has no value in Key Vault`);
  }
  return secret.value;
}

/**
 * Generic helper: retrieve the credential value based on type.
 * For "secret" → returns the raw secret string.
 * For "certificate" → returns the PEM-encoded certificate/key bundle.
 */
export async function getCredential(
  secretName: string,
  type: "secret" | "certificate",
): Promise<string> {
  try {
    if (type === "certificate") {
      return await getCertificatePem(secretName);
    }
    return await getSecretValue(secretName);
  } catch (err) {
    logger.error({ err, secretName, type }, "azure-keyvault: failed to retrieve credential");
    throw err;
  }
}
