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
  tenantsTable,
  usersTable,
  mspMessageCenterItemsTable,
} from "@workspace/db";
import { eq, and, or } from "drizzle-orm";
import { graphFetchPaginated } from "./monitor-executor";
import { ConsentRevokedError, markTenantConsentRevoked } from "./graph";
import { createNotification } from "./notification-center";
import { extractRoadmapFeatureIds, hasRoadmapFeatureIdsColumn } from "./m365-roadmap-mc-link";
import { extractAdvisoryDateText, hasAdvisoryDateTextColumn } from "./m365-message-center-date-quality";
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
 * Syncs Message Center items for one tenant. Resolves mspId/customerId from the
 * `tenants` row that owns the GUID, so newly seen posts can be routed to that
 * MSP's admins. Pre-refactor this took two hops (tenant_consent -> customerId ->
 * msp_customers); `tenants` carries the GUID and the mspId on one row, so the
 * consent table hop is gone rather than reproduced.
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

  const [customer] = await db
    .select({ id: tenantsTable.id, mspId: tenantsTable.mspId })
    .from(tenantsTable)
    .where(eq(tenantsTable.tenantId, tenantId))
    .limit(1);

  if (!customer) {
    log.warn({ tenantId }, "message-center-sync: no tenants row for this tenant GUID — skipping");
    return { tenantId, status: "no_customer", itemCount: 0, newCount: 0 };
  }

  try {
    const { items } = await graphFetchPaginated(tenantId, check.endpoint, check.method ?? "GET", check.requestBody as unknown);
    const messages = items as GraphServiceUpdateMessage[];

    // #1531 — roadmap_feature_ids ships in a manual migration (Shane's own
    // step, never self-applied here) that this ALREADY-LIVE daily sync must
    // keep working through. Checked once per tenant sync, not per message.
    const roadmapColumnReady = await hasRoadmapFeatureIdsColumn();
    // #1536 — same pattern, for the advisory-date-text column.
    const advisoryDateColumnReady = await hasAdvisoryDateTextColumn();

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
        // #1531 — the roadmap feature ID(s) this post's own body names, parsed
        // ONCE here rather than re-parsed on every read (see
        // m365-roadmap-mc-link.ts's own header for the join this backs).
        // Omitted entirely (not even an empty array) until the column exists —
        // the field has a schema default, so leaving it out is a no-op insert
        // and a no-op update, not a wipe of anything already backfilled.
        ...(roadmapColumnReady ? { roadmapFeatureIds: extractRoadmapFeatureIds(msg.body?.content) } : {}),
        // #1536 — the prose rollout-schedule phrase, parsed ONCE here rather
        // than re-parsed on every read. Advisory only — see
        // m365-message-center-date-quality.ts's own header for the hard
        // constraint this never crosses (never a real Date, never bucket-driving).
        ...(advisoryDateColumnReady ? { advisoryDateText: extractAdvisoryDateText(msg.body?.content) } : {}),
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
  // `notifications.mspUserId` used to hold an msp_users row id; with that table
  // gone the successor id-space is users.id, which this now sends.
  const admins = await db
    .select({ mspUserId: usersTable.id })
    .from(usersTable)
    .where(and(
      eq(usersTable.mspId, mspId),
      eq(usersTable.isActive, true),
      or(eq(usersTable.mspRole, "MSPAdmin"), eq(usersTable.mspRole, "MSPOperator")),
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
  // Consent now lives in the tenants.consent jsonb column, keyed by type. The
  // Graph read grant is the one this sync depends on — writeBack/sharepoint are
  // independent and prove nothing about it. The status is filtered in JS rather
  // than in SQL to match every other consent reader in the codebase
  // (graph.ts, workflow-executor.ts, portal.ts all select the column and
  // inspect it), and because the jsonb path operator needs an explicit cast to
  // be unambiguous in a parameterised query.
  const tenantRows = await db
    .select({ tenantId: tenantsTable.tenantId, consent: tenantsTable.consent })
    .from(tenantsTable);

  const results: MessageCenterSyncResult[] = [];
  for (const t of tenantRows) {
    if (t.consent?.graph?.status !== "granted") continue;
    results.push(await syncMessageCenterForTenant(t.tenantId));
  }
  return results;
}
