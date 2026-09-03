/**
 * Customer-Tenant Alert — Digest Batching + Quiet-Hours Drain (Git #1276)
 *
 * customer-alert-delivery.ts queues an alert here instead of sending it
 * immediately when the customer's category preference is mode="daily"/"weekly",
 * or when it arrives inside their quiet-hours window (see
 * computeDeliveryTiming). One `customer_alert_digest_queue` row per queued
 * alert, discriminated by `hold_reason`.
 *
 * drainCustomerAlertDigests() runs on the same 5-minute pass
 * evaluateCustomerTenantRules() rides (workflow-executor.ts's
 * `alert_evaluate_rules` node) and, for every customer with at least one
 * due-and-unsent item, composes ONE email per customer covering every item
 * that is due — matching the design's "sent in one email when the window
 * closes" for quiet hours, and the equivalent for daily/weekly digests.
 */

import { pool } from "@workspace/db";
import { logger } from "./logger";
import { sendMailViaGraph, graphCredentialsPresent } from "./graph";
import { randomUUID } from "crypto";
import { resolvePortalDeepLink } from "./portal-deep-links";

const log = logger.child({ channel: "notification" });

function getPortalBaseUrl(): string {
  const domains = process.env.REPLIT_DOMAINS;
  if (domains) {
    const first = domains.split(",")[0]?.trim();
    return `https://${first}/portal`;
  }
  return "http://localhost:80/portal";
}

export interface EnqueueDigestInput {
  customerId: number;
  eventId: number;
  alertCategory: string;
  severity: "info" | "warning" | "critical";
  summary: string;
  deepLinkPath: string | null;
  holdReason: "daily" | "weekly" | "quiet_hours";
  dueAt: Date;
}

export async function enqueueCustomerAlertDigest(input: EnqueueDigestInput): Promise<void> {
  await pool.query(
    `INSERT INTO customer_alert_digest_queue
       (customer_id, event_id, alert_category, severity, summary, deep_link_path, hold_reason, due_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [input.customerId, input.eventId, input.alertCategory, input.severity, input.summary, input.deepLinkPath, input.holdReason, input.dueAt.toISOString()],
  );
}

interface QueueRow {
  id: number;
  customer_id: number;
  alert_category: string;
  severity: string;
  summary: string;
  deep_link_path: string | null;
  hold_reason: string;
}

function buildDigestEmailHtml(opts: { items: QueueRow[]; portalBaseUrl: string; holdReasonLabel: string }): string {
  const sevColor = (s: string) => (s === "critical" ? "#DC2626" : s === "warning" ? "#D97706" : "#0284C7");
  const rows = opts.items
    .map(
      (i) => {
        // #1827: resolve through the map — never emit a raw /portal-v2/*
        // link, it 404s (portal-v2 was deleted under #1673).
        const resolved = resolvePortalDeepLink(i.deep_link_path);
        const linkText = resolved.available ? "View in your portal" : `${resolved.label} is coming to your portal`;
        return `<div style="padding:12px 0;border-bottom:1px solid #e2e8f0">
        <span style="background:${sevColor(i.severity)};color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:9999px;letter-spacing:.05em;margin-right:8px">${i.severity.toUpperCase()}</span>
        <span style="color:#4a5568;font-size:13.5px">${i.summary}</span>
        <div style="margin-top:4px"><a href="${opts.portalBaseUrl}${resolved.href}" style="color:#0078D4;font-size:12px;text-decoration:none">${linkText} &rarr;</a></div>
      </div>`;
      },
    )
    .join("");
  return `<!DOCTYPE html><html><body style="font-family:Inter,sans-serif;background:#f7f9fc;margin:0;padding:24px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e2e8f0;padding:24px">
    <h2 style="margin:0 0 4px;font-size:16px;color:#0a2540">${opts.holdReasonLabel}</h2>
    <p style="margin:0 0 16px;color:#94a3b8;font-size:12px">${opts.items.length} item${opts.items.length === 1 ? "" : "s"}</p>
    ${rows}
    <hr style="margin:20px 0;border:none;border-top:1px solid #e2e8f0" />
    <p style="color:#a0aec0;font-size:12px;margin:0">Shane McCaw Consulting &mdash; alert preferences are yours to change any time in the portal.</p>
  </div></body></html>`;
}

const HOLD_REASON_LABELS: Record<string, string> = {
  daily: "Your daily alert digest",
  weekly: "Your weekly alert digest",
  quiet_hours: "Alerts held overnight",
};

/**
 * Drains every due, unsent digest item, grouped by customer, into one email
 * per customer. Recipients are resolved the same way immediate delivery does
 * (resolveCustomerAlertPreferences), scoped per-item's category — a recipient
 * only scoped to "billing" still gets the digest email if it contains at
 * least one billing item, same coarse scoping immediate delivery already uses.
 */
export async function drainCustomerAlertDigests(): Promise<void> {
  const dueRes = await pool.query<{ customer_id: number }>(
    `SELECT DISTINCT customer_id FROM customer_alert_digest_queue WHERE sent_at IS NULL AND due_at <= NOW()`,
  );
  if (dueRes.rows.length === 0) return;

  // Lazy import avoids a module-load-order cycle with customer-alert-delivery.ts.
  const { resolveCustomerAlertPreferences } = await import("./customer-alert-delivery");

  let drained = 0;
  for (const { customer_id: customerId } of dueRes.rows) {
    try {
      const itemsRes = await pool.query<QueueRow>(
        `SELECT id, customer_id, alert_category, severity, summary, deep_link_path, hold_reason
         FROM customer_alert_digest_queue
         WHERE customer_id = $1 AND sent_at IS NULL AND due_at <= NOW()
         ORDER BY hold_reason, queued_at`,
        [customerId],
      );
      if (itemsRes.rows.length === 0) continue;

      // Group by hold_reason so a quiet-hours batch and a same-moment daily
      // digest never merge into one confusing email.
      const byReason = new Map<string, QueueRow[]>();
      for (const row of itemsRes.rows) {
        const list = byReason.get(row.hold_reason) ?? [];
        list.push(row);
        byReason.set(row.hold_reason, list);
      }

      const profile = await resolveCustomerAlertPreferences(customerId);
      if (!profile) {
        log.info({ customerId }, "customer-alert-digest: no customer account resolvable; leaving queued for retry");
        continue;
      }

      for (const [holdReason, items] of byReason) {
        const categories = new Set(items.map((i) => i.alert_category));
        const recipients = profile.recipients
          .filter((r) => r.scopeCategories === "all" || r.scopeCategories.some((c) => categories.has(c)))
          .map((r) => r.email);

        const batchId = randomUUID();
        if (recipients.length > 0 && graphCredentialsPresent() && process.env.GRAPH_MAIL_USER_ID) {
          try {
            await sendMailViaGraph({
              fromUserId: process.env.GRAPH_MAIL_USER_ID,
              to: recipients[0],
              subject: HOLD_REASON_LABELS[holdReason] ?? "Your alert digest",
              htmlBody: buildDigestEmailHtml({ items, portalBaseUrl: getPortalBaseUrl(), holdReasonLabel: HOLD_REASON_LABELS[holdReason] ?? "Your alert digest" }),
            });
            // Additional recipients get their own send (Graph sendMail here takes one `to`).
            for (const to of recipients.slice(1)) {
              try {
                await sendMailViaGraph({
                  fromUserId: process.env.GRAPH_MAIL_USER_ID,
                  to,
                  subject: HOLD_REASON_LABELS[holdReason] ?? "Your alert digest",
                  htmlBody: buildDigestEmailHtml({ items, portalBaseUrl: getPortalBaseUrl(), holdReasonLabel: HOLD_REASON_LABELS[holdReason] ?? "Your alert digest" }),
                });
              } catch (err) {
                log.warn({ err, to, customerId }, "customer-alert-digest: send failed for one recipient");
              }
            }
          } catch (err) {
            log.warn({ err, customerId, holdReason }, "customer-alert-digest: primary send failed; leaving batch queued for retry");
            continue; // don't mark sent — retry next drain pass
          }
        } else if (recipients.length === 0) {
          log.info({ customerId, holdReason }, "customer-alert-digest: no recipient scoped to this batch; marking sent (nothing to deliver)");
        } else {
          log.info({ customerId, holdReason }, "customer-alert-digest: Graph not configured; leaving batch queued for retry");
          continue;
        }

        const ids = items.map((i) => i.id);
        await pool.query(
          `UPDATE customer_alert_digest_queue SET sent_at = NOW(), digest_batch_id = $1 WHERE id = ANY($2::int[])`,
          [batchId, ids],
        );
        drained += items.length;
      }
    } catch (err) {
      log.error({ err, customerId }, "customer-alert-digest: drain failed for customer");
    }
  }

  if (drained > 0) log.info({ drained }, "customer-alert-digest: drain complete");
}
