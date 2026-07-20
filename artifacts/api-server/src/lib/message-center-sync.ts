/**
 * message-center-sync.ts
 *
 * Fetches Microsoft 365 Message Center posts (Graph
 * /admin/serviceAnnouncement/messages) for every consented tenant, upserts
 * them into msp_message_center_items, and notifies each tenant's MSP admins
 * about genuinely-new posts only (not re-notified on later content edits).
 *
 * Distinct from monitor-executor.ts's generic check runner: that pipeline
 * only stores per-run aggregates (tenant_monitor_profiles), never individual
 * items, so it can't tell "new since last check" on its own. This module
 * still reads its endpoint/config from the monitor_checks row (key
 * "m365:message-center") so the check stays DB-driven, but does its own
 * Graph fetch + per-item persistence.
 */

import { db } from "@workspace/db";
import {
  monitorChecksTable,
  tenantConsentTable,
  mspCustomersTable,
  mspUsersTable,
  mspMessageCenterItemsTable,
} from "@workspace/db";
import { eq, and, or } from "drizzle-orm";
import { graphFetchPaginated } from "./monitor-executor";
import { ConsentRevokedError, markTenantConsentRevoked } from "./graph";
import { createNotification } from "./notification-center";
import { logger } from "./logger";

const log = logger.child({ channel: "integration.azure" });

const CHECK_KEY = "m365:message-center";

interface GraphServiceUpdateMessage {
  id: string;
  title: string;
  category?: string | null;
  severity?: string | null;
  isMajorChange?: boolean | null;
  services?: string[] | null;
  tags?: string[] | null;
  body?: { contentType?: string | null; content?: string | null } | null;
  startDateTime?: string | null;
  endDateTime?: string | null;
  actionRequiredByDateTime?: string | null;
  lastModifiedDateTime: string;
}

function toDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface MessageCenterSyncResult {
  tenantId: string;
  status: "ok" | "error" | "consent_revoked" | "no_check" | "no_customer";
  itemCount: number;
  newCount: number;
  errorMessage?: string;
}

/**
 * Syncs Message Center items for one tenant. Resolves mspId/customerId from
 * the tenant's msp_customers row (via tenant_consent -> customerId) so newly
 * seen posts can be routed to that MSP's admins.
 */
export async function syncMessageCenterForTenant(tenantId: string): Promise<MessageCenterSyncResult> {
  const [check] = await db
    .select()
    .from(monitorChecksTable)
    .where(and(eq(monitorChecksTable.key, CHECK_KEY), eq(monitorChecksTable.status, "active")))
    .limit(1);

  if (!check) {
    log.warn({ tenantId }, "message-center-sync: monitor_checks row m365:message-center not found or inactive — skipping");
    return { tenantId, status: "no_check", itemCount: 0, newCount: 0 };
  }

  const [consent] = await db
    .select({ customerId: tenantConsentTable.customerId })
    .from(tenantConsentTable)
    .where(eq(tenantConsentTable.tenantId, tenantId))
    .limit(1);

  if (!consent?.customerId) {
    log.warn({ tenantId }, "message-center-sync: no msp_customers row bridged for this tenant — skipping");
    return { tenantId, status: "no_customer", itemCount: 0, newCount: 0 };
  }

  const [customer] = await db
    .select({ id: mspCustomersTable.id, mspId: mspCustomersTable.mspId })
    .from(mspCustomersTable)
    .where(eq(mspCustomersTable.id, consent.customerId))
    .limit(1);

  if (!customer) {
    log.warn({ tenantId, customerId: consent.customerId }, "message-center-sync: msp_customers row missing — skipping");
    return { tenantId, status: "no_customer", itemCount: 0, newCount: 0 };
  }

  try {
    const { items } = await graphFetchPaginated(tenantId, check.endpoint, check.method ?? "GET", check.requestBody as unknown);
    const messages = items as GraphServiceUpdateMessage[];

    let newCount = 0;
    const newMessages: GraphServiceUpdateMessage[] = [];

    for (const msg of messages) {
      if (!msg?.id) continue;

      const [existing] = await db
        .select({ id: mspMessageCenterItemsTable.id })
        .from(mspMessageCenterItemsTable)
        .where(and(
          eq(mspMessageCenterItemsTable.tenantId, tenantId),
          eq(mspMessageCenterItemsTable.graphMessageId, msg.id),
        ))
        .limit(1);

      const values = {
        tenantId,
        mspId: customer.mspId,
        customerId: customer.id,
        graphMessageId: msg.id,
        title: msg.title,
        category: msg.category ?? null,
        severity: msg.severity ?? null,
        isMajorChange: msg.isMajorChange ?? false,
        services: msg.services ?? [],
        tags: msg.tags ?? [],
        bodyContentType: msg.body?.contentType ?? null,
        bodyContent: msg.body?.content ?? null,
        startDateTime: toDate(msg.startDateTime),
        endDateTime: toDate(msg.endDateTime),
        actionRequiredByDateTime: toDate(msg.actionRequiredByDateTime),
        lastModifiedDateTime: toDate(msg.lastModifiedDateTime) ?? new Date(),
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      };

      if (existing) {
        await db
          .update(mspMessageCenterItemsTable)
          .set(values)
          .where(eq(mspMessageCenterItemsTable.id, existing.id));
      } else {
        await db.insert(mspMessageCenterItemsTable).values(values);
        newCount++;
        newMessages.push(msg);
      }
    }

    if (newMessages.length > 0) {
      await notifyMspAdminsOfNewMessages(customer.mspId, newMessages);
    }

    log.info({ tenantId, mspId: customer.mspId, itemCount: messages.length, newCount }, "message-center-sync: synced tenant");
    return { tenantId, status: "ok", itemCount: messages.length, newCount };
  } catch (err) {
    if (err instanceof ConsentRevokedError) {
      await markTenantConsentRevoked(tenantId);
      log.warn({ tenantId }, "message-center-sync: consent revoked");
      return { tenantId, status: "consent_revoked", itemCount: 0, newCount: 0 };
    }
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.error({ tenantId, err: errorMessage }, "message-center-sync: sync failed");
    return { tenantId, status: "error", itemCount: 0, newCount: 0, errorMessage };
  }
}

/**
 * Message Center is MSP-facing operational awareness (Graph/tenant admin
 * announcements), not something end customers see — notify MSPAdmin +
 * MSPOperator users of the owning MSP, mirroring the audience of the
 * cross-tenant Alerts page (msp-alerts.ts).
 */
async function notifyMspAdminsOfNewMessages(mspId: number, messages: GraphServiceUpdateMessage[]): Promise<void> {
  const admins = await db
    .select({ mspUserId: mspUsersTable.id })
    .from(mspUsersTable)
    .where(and(
      eq(mspUsersTable.mspId, mspId),
      eq(mspUsersTable.isActive, true),
      or(eq(mspUsersTable.mspRole, "MSPAdmin"), eq(mspUsersTable.mspRole, "MSPOperator")),
    ));

  if (admins.length === 0) return;

  for (const msg of messages) {
    const title = `Message Center: ${msg.title}`;
    const severity: "info" | "warning" | "critical" = msg.isMajorChange ? "warning" : "info";
    const body = msg.body?.content ? stripHtml(msg.body.content).slice(0, 500) : undefined;

    for (const admin of admins) {
      await createNotification({
        title,
        body,
        category: "message_center",
        severity,
        linkPath: "/alerts",
        feedType: "personal",
        notifType: "general",
        recipient: { type: "msp_user", mspUserId: admin.mspUserId, mspId },
        mspId,
      });
    }
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Runs syncMessageCenterForTenant for every tenant with granted consent.
 * Intended to be called on a daily schedule (see index.ts).
 */
export async function syncMessageCenterForAllTenants(): Promise<MessageCenterSyncResult[]> {
  const tenants = await db
    .select({ tenantId: tenantConsentTable.tenantId })
    .from(tenantConsentTable)
    .where(eq(tenantConsentTable.consentStatus, "granted"));

  const results: MessageCenterSyncResult[] = [];
  for (const t of tenants) {
    results.push(await syncMessageCenterForTenant(t.tenantId));
  }
  return results;
}
