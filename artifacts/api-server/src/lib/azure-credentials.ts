/**
 * azure-credentials.ts
 *
 * Shared helper for live-testing Azure App Registration credentials.
 * Used by both the customer submission route (portal.ts) and the admin
 * verify route so the test logic is not duplicated.
 */

import { ClientSecretCredential } from "@azure/identity";

export interface CredentialTestResult {
  ok: true;
}

export interface CredentialTestFailure {
  ok: false;
  reason: string;
}

/**
 * Attempts to acquire a token with the supplied App Registration credentials.
 * A successful token acquisition against the Azure Management API confirms that:
 *   - The Tenant ID is valid
 *   - The Client ID belongs to that tenant
 *   - The Client Secret is correct and not expired
 *
 * Returns { ok: true } on success or { ok: false, reason } with a human-readable
 * message derived from the Azure error code on failure.
 */
export async function testClientCredentials(
  tenantId: string,
  clientId: string,
  clientSecret: string,
): Promise<CredentialTestResult | CredentialTestFailure> {
  try {
    const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
    await credential.getToken("https://management.azure.com/.default");
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: humanizeAzureError(msg) };
  }
}

function humanizeAzureError(msg: string): string {
  if (/AADSTS70011|invalid_resource|scope.*invalid/i.test(msg)) {
    return "The requested resource scope is invalid. Ensure the App Registration has the correct API permissions and admin consent has been granted.";
  }
  if (/AADSTS7000215|invalid_client.*secret|client.*secret.*invalid|invalid client secret/i.test(msg)) {
    return "Invalid client secret — the value you entered does not match the secret in Azure. Double-check you copied the secret Value (not the Secret ID) and that it has not expired.";
  }
  if (/AADSTS700016|application.*not found|AADSTS700011/i.test(msg)) {
    return "Client ID not found in this tenant — verify the Application (client) ID is correct and belongs to the tenant you specified.";
  }
  if (/AADSTS90002|tenant.*not found|invalid.*tenant|no.*tenant/i.test(msg)) {
    return "Tenant not found — verify the Directory (tenant) ID is the correct GUID for your Azure Active Directory.";
  }
  if (/AADSTS65001|admin_consent_required|consent.*required/i.test(msg)) {
    return "Admin consent not yet granted — go to your App Registration → API Permissions and click \"Grant admin consent for [Your Organisation]\".";
  }
  if (/AADSTS50076|AADSTS50079|mfa|multi.factor/i.test(msg)) {
    return "Multi-factor authentication is required for this tenant but cannot be satisfied by an application credential. Ensure the App Registration uses Application permissions (not Delegated).";
  }
  if (/unauthorized|403/i.test(msg)) {
    return "Authorisation denied — the App Registration does not have the required permissions, or admin consent has not been granted.";
  }
  if (/AADSTS/i.test(msg)) {
    const code = msg.match(/AADSTS\d+/)?.[0] ?? "unknown";
    return `Azure authentication error (${code}). Check that the Tenant ID, Client ID, and Client Secret are all correct and that admin consent has been granted.`;
  }
  return "Could not connect to Azure — check that all three values are correct and that your App Registration is properly configured.";
}
