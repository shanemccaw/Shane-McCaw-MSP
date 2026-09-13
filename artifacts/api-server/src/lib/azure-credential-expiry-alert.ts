/**
 * azure-credential-expiry-alert.ts
 *
 * Git #3861 — Reinstate App Registration / Azure credential expiry email
 * alerting on the new Azure Tenant Credentials surface (azure_tenant_credentials,
 * admin-azure-credentials.ts). The old alert on the deleted admin-clients.ts
 * route (appRegExpiryAlertEmail, lib/mailer.ts) was dead — #3424 removed its
 * only caller when that route was deleted; #3674 confirmed it dead; this
 * reinstates real sending on the new surface, wired to the same
 * getExpiringAzureCredentials() query the dashboard's expiring-summary badge
 * uses (azure-credential-expiry.ts), so the two can never disagree on what
 * counts as "expiring."
 *
 * Recipient: process.env.ADMIN_EMAIL ?? process.env.CRM_ADMIN_EMAIL — the
 * same admin-alert recipient convention used everywhere else in this codebase
 * (portal-checkout-free.ts, data-rights.ts, auth.ts, booking.ts, quiz.ts,
 * workflow-executor.ts's send_email action, …). This is always Shane; nothing
 * here resolves a per-client recipient, mirroring the old dead template.
 *
 * De-dup: azure_tenant_credentials.last_expiry_alert_sent_at (added by this
 * issue's migration) — a credential is only re-alerted once per
 * EXPIRY_ALERT_RESEND_HOURS window, not on every evaluation pass, matching
 * the existing 24-hour re-fire convention used by the Escalation Check system
 * workflow (kanban_tasks.task_metadata.lastEscalationAlertSentAt).
 *
 * Invoked daily by the "__system__: Azure Credential Expiry Alerts" seeded
 * workflow (seed-system-workflows.ts) via the azure_credential_expiry_check
 * node type — not a bare setInterval poller.
 */

import { db, azureTenantCredentialsTable, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { logger } from "./logger.ts";
import { getExpiringAzureCredentials } from "./azure-credential-expiry.ts";
import { azureCredentialExpiryAlertEmail, sendEmailOrThrow } from "./mailer.ts";

const log = logger.child({ channel: "integration.azure" });

const EXPIRY_ALERT_RESEND_HOURS = 24;

function getAdminPanelBaseUrl(): string {
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) {
    const first = domains.split(",")[0]?.trim();
    return `https://${first}/admin-panel`;
  }
  return "http://localhost:80/admin-panel";
}

export interface AzureCredentialExpiryAlertResult {
  expiringCount: number;
  alertedCount: number;
  skippedRecentlyAlertedCount: number;
  skippedNoRecipientCount: number;
}

/**
 * Workflow node handler for the azure_credential_expiry_check node type
 * (workflow-executor.ts's executeNode switch).
 */
export async function handleAzureCredentialExpiryAlert(
  payload: Record<string, unknown>,
): Promise<AzureCredentialExpiryAlertResult> {
  void payload;

  const adminEmail = process.env.ADMIN_EMAIL ?? process.env.CRM_ADMIN_EMAIL;
  if (!adminEmail) {
    log.warn(
      "azure-credential-expiry-alert: ADMIN_EMAIL/CRM_ADMIN_EMAIL not configured — cannot deliver expiry alerts",
    );
  }

  const expiring = await getExpiringAzureCredentials(log);
  const resendCutoff = new Date(Date.now() - EXPIRY_ALERT_RESEND_HOURS * 60 * 60 * 1000);

  const due = expiring.filter(
    c => !c.lastExpiryAlertSentAt || c.lastExpiryAlertSentAt < resendCutoff,
  );
  const skippedRecentlyAlertedCount = expiring.length - due.length;

  if (due.length === 0 || !adminEmail) {
    return {
      expiringCount: expiring.length,
      alertedCount: 0,
      skippedRecentlyAlertedCount,
      skippedNoRecipientCount: adminEmail ? 0 : due.length,
    };
  }

  const clientUserIds = [...new Set(due.map(c => c.clientUserId).filter((id): id is number => id !== null))];
  const clients = clientUserIds.length
    ? await db
        .select({ id: usersTable.id, name: usersTable.name, email: usersTable.email })
        .from(usersTable)
        .where(inArray(usersTable.id, clientUserIds))
    : [];
  const clientById = new Map(clients.map(c => [c.id, c]));

  const adminPanelUrl = getAdminPanelBaseUrl();
  const alertedIds: number[] = [];

  for (const credential of due) {
    const client = credential.clientUserId !== null ? clientById.get(credential.clientUserId) : undefined;
    try {
      const html = azureCredentialExpiryAlertEmail({
        displayName: credential.displayName,
        clientName: client?.name ?? null,
        clientEmail: client?.email ?? null,
        tenantId: credential.tenantId,
        azureClientId: credential.clientId,
        expiresOn: new Date(credential.expiresOn),
        daysLeft: credential.daysLeft,
        adminPanelUrl,
      });
      const urgencyLabel = credential.daysLeft <= 0 ? "EXPIRED" : `expires in ${credential.daysLeft}d`;
      await sendEmailOrThrow(
        adminEmail,
        `[Azure Credential] ${credential.displayName} — ${urgencyLabel}`,
        html,
        { templateName: "azure-credential-expiry-alert" },
      );
      alertedIds.push(credential.id);
    } catch (err) {
      log.error({ err, credentialId: credential.id }, "azure-credential-expiry-alert: failed to send alert email");
    }
  }

  if (alertedIds.length > 0) {
    await db
      .update(azureTenantCredentialsTable)
      .set({ lastExpiryAlertSentAt: new Date() })
      .where(inArray(azureTenantCredentialsTable.id, alertedIds));
  }

  log.info(
    { expiringCount: expiring.length, alertedCount: alertedIds.length, skippedRecentlyAlertedCount },
    "azure-credential-expiry-alert: completed",
  );

  return {
    expiringCount: expiring.length,
    alertedCount: alertedIds.length,
    skippedRecentlyAlertedCount,
    skippedNoRecipientCount: 0,
  };
}
