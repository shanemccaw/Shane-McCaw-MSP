/**
 * Customer-Tenant Alert — Customer Delivery Seam (Git #1278 / #1276)
 *
 * Sign-off decision #2 for #1278 is DUAL delivery: every customer-tenant alert
 * firing goes to admin (Exchange Online email + admin web-push, handled inline
 * by customer-tenant-alert-engine.ts, reusing the platform engine's senders)
 * AND to the customer's own recipients — through the thresholds, digest mode,
 * quiet hours and recipient list the customer configures on the portal Alert
 * Preferences page.
 *
 * #1276 landed the real persistence this module reads
 * (`customer_alert_preferences` / `customer_alert_settings` /
 * `customer_alert_recipients`, see lib/db/src/schema/msp.ts and
 * routes/portal-alert-preferences.ts). This module remains the one seam the
 * engine calls (`deliverCustomerTenantAlertToCustomer`) — the engine itself
 * never changed.
 *
 * Timing (#1276's own scope, per #1278's sign-off comment #4: "digest batching
 * ... lives in #1276"): a category's `mode` (immediate/daily/weekly) and the
 * page-level quiet hours decide whether an alert sends right now or gets
 * queued into `customer_alert_digest_queue` for customer-alert-digest.ts to
 * drain later. Critical severity breaks quiet hours when the customer has
 * opted into that (quiet.breakForCritical) — it never breaks daily/weekly
 * digest mode, which is the customer's own explicit choice.
 */

import { pool } from "@workspace/db";
import { logger } from "./logger";
import { sendMailViaGraph, graphCredentialsPresent } from "./graph";
import { enqueueCustomerAlertDigest } from "./customer-alert-digest";
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

/** A single fired customer-tenant alert, as handed to the customer-delivery seam. */
export interface CustomerTenantAlertForDelivery {
  eventId: number;
  ruleKey: string;
  /** One of the 7 customer-facing categories (alertPrefsData.ts ALERT_CATS). */
  alertCategory: string;
  severity: "info" | "warning" | "critical";
  /** tenants.id — the JWT customerId. The customer this alert is about. */
  customerId: number;
  mspId: number | null;
  tenantId: string | null;
  summary: string;
  /** Customer-portal-relative deep link (e.g. /portal-v2/health). */
  deepLinkPath: string | null;
}

export type CustomerDeliveryStatus =
  | "pending_prefs"  // no customer account resolvable for this tenant, or a send error — recorded, not lost
  | "delivered"      // sent immediately to at least one customer recipient
  | "queued_digest"  // held for a daily/weekly digest or the quiet-hours window (customer_alert_digest_queue)
  | "suppressed"     // the customer's own threshold filtered it out, or no recipient is scoped to it
  | "skipped";       // rule.notify_customer = false (never reaches this module)

export interface CustomerDeliveryOutcome {
  status: CustomerDeliveryStatus;
  /** Human note for the event row / logs. */
  detail?: string;
  /** Recipients actually delivered to (empty unless status = "delivered"). */
  recipients?: string[];
}

/**
 * The per-customer, per-category preference profile persisted by #1276
 * (routes/portal-alert-preferences.ts). Kept here (not imported from the
 * portal fixture) because api-server must not depend on msp-portal.
 */
export interface CustomerAlertCategoryPref {
  on: boolean;
  email: boolean;
  mode: "immediate" | "daily" | "weekly";
  /** Category-specific severity floor / sensitivity key (e.g. "critical", "high", "any"). */
  threshold: string;
}
export interface CustomerAlertRecipient {
  email: string;
  scopeCategories: string[] | "all";
}
export interface CustomerAlertQuietHours {
  on: boolean;
  from: string; // "19:00"
  to: string;   // "07:30"
  breakForCritical: boolean;
}
export interface CustomerAlertPreferenceProfile {
  customerId: number;
  categories: Record<string, CustomerAlertCategoryPref>;
  recipients: CustomerAlertRecipient[];
  quiet: CustomerAlertQuietHours;
}

// The page's own "Balanced" preset (alertPrefsData.ts ALERT_PRESETS) — the
// default for any category a customer has never explicitly saved. Category
// identifiers/thresholds are stable data keys, not user-facing copy, so this
// is intentionally duplicated (not imported) from routes/portal-alert-preferences.ts,
// which re-exports this same object for its own GET defaults.
export const CUSTOMER_ALERT_BALANCED_DEFAULTS: Record<string, CustomerAlertCategoryPref> = {
  findings:    { on: true, email: true,  mode: "immediate", threshold: "high" },
  drift:       { on: true, email: true,  mode: "immediate", threshold: "worse" },
  progress:    { on: true, email: true,  mode: "daily",     threshold: "five" },
  reviews:     { on: true, email: true,  mode: "daily",     threshold: "fourteen" },
  remediation: { on: true, email: false, mode: "daily",     threshold: "waiting" },
  billing:     { on: true, email: true,  mode: "immediate", threshold: "all" },
  support:     { on: true, email: true,  mode: "immediate", threshold: "mine" },
};

const DEFAULT_QUIET: CustomerAlertQuietHours = { on: true, from: "19:00", to: "07:30", breakForCritical: true };

/**
 * Reads the real #1276 persistence: `customer_alert_preferences` /
 * `customer_alert_settings` / `customer_alert_recipients`. Returns null only
 * when no customer account is resolvable for this tenant (nothing to deliver
 * to) — every other gap (no saved rows) degrades to the Balanced defaults, the
 * same "unset = default" convention the page itself uses.
 */
export async function resolveCustomerAlertPreferences(
  customerId: number,
): Promise<CustomerAlertPreferenceProfile | null> {
  const primaryRes = await pool.query<{ email: string }>(
    `SELECT email FROM users WHERE tenant_id = $1 ORDER BY id ASC LIMIT 1`,
    [customerId],
  );
  const primaryEmail = primaryRes.rows[0]?.email;
  if (!primaryEmail) {
    log.info({ customerId }, "customer-alert: no customer account resolvable for tenant; delivery pending");
    return null;
  }

  const [prefRes, settingsRes, recipientRes] = await Promise.all([
    pool.query<{ category: string; enabled: boolean; email_enabled: boolean; mode: string; threshold: string }>(
      `SELECT category, enabled, email_enabled, mode, threshold FROM customer_alert_preferences WHERE customer_id = $1`,
      [customerId],
    ),
    pool.query<{ quiet_hours_enabled: boolean; quiet_hours_from: string; quiet_hours_to: string; quiet_break_for_critical: boolean }>(
      `SELECT quiet_hours_enabled, quiet_hours_from, quiet_hours_to, quiet_break_for_critical FROM customer_alert_settings WHERE customer_id = $1`,
      [customerId],
    ),
    pool.query<{ email: string; scope_categories: string[] | null }>(
      `SELECT email, scope_categories FROM customer_alert_recipients WHERE customer_id = $1`,
      [customerId],
    ),
  ]);

  const categories: Record<string, CustomerAlertCategoryPref> = {};
  const byCategory = new Map(prefRes.rows.map((r) => [r.category, r]));
  for (const [cat, fallback] of Object.entries(CUSTOMER_ALERT_BALANCED_DEFAULTS)) {
    const row = byCategory.get(cat);
    categories[cat] = row
      ? { on: row.enabled, email: row.email_enabled, mode: row.mode as CustomerAlertCategoryPref["mode"], threshold: row.threshold }
      : fallback;
  }

  const s = settingsRes.rows[0];
  const quiet: CustomerAlertQuietHours = s
    ? { on: s.quiet_hours_enabled, from: s.quiet_hours_from, to: s.quiet_hours_to, breakForCritical: s.quiet_break_for_critical }
    : DEFAULT_QUIET;

  const recipients: CustomerAlertRecipient[] = [
    { email: primaryEmail, scopeCategories: "all" },
    ...recipientRes.rows.map((r) => ({
      email: r.email,
      scopeCategories: (r.scope_categories && r.scope_categories.length > 0 ? r.scope_categories : "all") as string[] | "all",
    })),
  ];

  return { customerId, categories, recipients, quiet };
}

function buildCustomerEmailHtml(opts: { summary: string; severity: string; deepLinkPath: string | null; portalBaseUrl: string }): string {
  const color = opts.severity === "critical" ? "#DC2626" : opts.severity === "warning" ? "#D97706" : "#0284C7";
  // #1827: never emit a raw /portal-v2/* link — it 404s (portal-v2 was
  // deleted under #1673). Resolve through the map so the button always
  // lands somewhere real: the live page once shipped, an honest
  // "not built yet" page until then.
  const resolved = resolvePortalDeepLink(opts.deepLinkPath);
  const linkText = resolved.available ? "View in your portal" : `${resolved.label} is coming to your portal`;
  const link = `<p style="margin-top:16px"><a href="${opts.portalBaseUrl}${resolved.href}" style="background:#0078D4;color:#fff;padding:8px 16px;border-radius:4px;text-decoration:none;font-size:14px">${linkText} &rarr;</a></p>`;
  return `<!DOCTYPE html><html><body style="font-family:Inter,sans-serif;background:#f7f9fc;margin:0;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;border:1px solid #e2e8f0;padding:24px">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
      <span style="background:${color};color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:9999px;letter-spacing:.05em">${opts.severity.toUpperCase()}</span>
    </div>
    <p style="color:#4a5568;font-size:14px;line-height:1.6;margin:0 0 12px">${opts.summary}</p>
    ${link}
    <hr style="margin:20px 0;border:none;border-top:1px solid #e2e8f0" />
    <p style="color:#a0aec0;font-size:12px;margin:0">Shane McCaw Consulting &mdash; alert preferences are yours to change any time in the portal.</p>
  </div></body></html>`;
}

/**
 * Sends one alert to the given customer recipients via Exchange Online
 * (Microsoft Graph — NEVER Resend, per CLAUDE.md), deep-linking into the
 * customer portal. Throws (caught by the caller) if Graph credentials are
 * absent or every send fails, so the event stays `pending_prefs` for retry.
 */
async function sendToCustomerRecipients(
  alert: CustomerTenantAlertForDelivery,
  recipients: string[],
): Promise<void> {
  if (!graphCredentialsPresent()) {
    throw new Error("Graph credentials not configured; cannot send customer alert email");
  }
  const mailUserId = process.env.GRAPH_MAIL_USER_ID;
  if (!mailUserId) {
    throw new Error("GRAPH_MAIL_USER_ID not configured; cannot send customer alert email");
  }

  const html = buildCustomerEmailHtml({
    summary: alert.summary,
    severity: alert.severity,
    deepLinkPath: alert.deepLinkPath,
    portalBaseUrl: getPortalBaseUrl(),
  });

  let sentAny = false;
  for (const to of recipients) {
    try {
      await sendMailViaGraph({
        fromUserId: mailUserId,
        subject: `[${alert.severity.toUpperCase()}] ${alert.summary}`,
        to,
        htmlBody: html,
      });
      sentAny = true;
    } catch (err) {
      log.warn({ err, to, eventId: alert.eventId }, "customer-alert: customer email send failed for one recipient");
    }
  }
  if (!sentAny) throw new Error("customer alert email failed for every recipient");
}

/**
 * Apply the customer's own preference for this alert's category: is the
 * category on, and does the alert clear the category's severity floor? Pure,
 * so it can be unit-tested independently of the DB/Graph.
 */
export function passesCustomerPreference(
  alert: CustomerTenantAlertForDelivery,
  profile: CustomerAlertPreferenceProfile,
): { deliver: boolean; reason: string } {
  const pref = profile.categories[alert.alertCategory];
  if (!pref || !pref.on) return { deliver: false, reason: "category off" };

  // Severity floor: "critical" only | "high"(=warning+) | "any". Categories that
  // don't use severity (billing/support/reviews) treat any non-"critical"/"high"
  // threshold as "any".
  const floor = pref.threshold;
  const sevRank = { info: 0, warning: 1, critical: 2 } as const;
  if (floor === "critical" && sevRank[alert.severity] < sevRank.critical) {
    return { deliver: false, reason: "below critical floor" };
  }
  if (floor === "high" && sevRank[alert.severity] < sevRank.warning) {
    return { deliver: false, reason: "below high floor" };
  }
  return { deliver: true, reason: "ok" };
}

/** Minutes since local midnight for an "HH:MM" string. */
function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((n) => parseInt(n, 10));
  return (h || 0) * 60 + (m || 0);
}

/** Is `now` inside the [from, to) window, honouring an overnight wrap (e.g. 19:00→07:30)? */
export function isWithinQuietWindow(quiet: CustomerAlertQuietHours, now: Date): boolean {
  if (!quiet.on) return false;
  const from = minutesOfDay(quiet.from);
  const to = minutesOfDay(quiet.to);
  const cur = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (from === to) return false;
  if (from < to) return cur >= from && cur < to; // same-day window
  return cur >= from || cur < to; // overnight wrap
}

export type CustomerAlertTiming =
  | { mode: "immediate" }
  | { mode: "daily" | "weekly" | "quiet_hours"; dueAt: Date };

/**
 * When should this alert actually go out: right now, or held for a digest /
 * the quiet-hours window? Daily/weekly is the customer's own explicit choice
 * and is never broken by severity. Quiet hours only applies to "immediate"
 * mode categories, and is broken by critical severity when the customer has
 * opted into that (breakForCritical).
 */
export function computeDeliveryTiming(
  alert: CustomerTenantAlertForDelivery,
  pref: CustomerAlertCategoryPref,
  quiet: CustomerAlertQuietHours,
  now: Date,
): CustomerAlertTiming {
  if (pref.mode === "daily") return { mode: "daily", dueAt: nextDailyBoundary(now) };
  if (pref.mode === "weekly") return { mode: "weekly", dueAt: nextWeeklyBoundary(now) };

  if (quiet.on && isWithinQuietWindow(quiet, now) && !(alert.severity === "critical" && quiet.breakForCritical)) {
    return { mode: "quiet_hours", dueAt: nextQuietWindowClose(quiet, now) };
  }
  return { mode: "immediate" };
}

/** Next 08:00 UTC at least 1 minute in the future. */
function nextDailyBoundary(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 8, 0, 0));
  if (d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/** Next Monday 08:00 UTC at least 1 minute in the future. */
function nextWeeklyBoundary(now: Date): Date {
  const d = nextDailyBoundary(now);
  const daysToMonday = (8 - d.getUTCDay()) % 7; // getUTCDay(): Mon=1
  d.setUTCDate(d.getUTCDate() + daysToMonday);
  return d;
}

/** The next occurrence of quiet.to (HH:MM) after `now`. */
function nextQuietWindowClose(quiet: CustomerAlertQuietHours, now: Date): Date {
  const [h, m] = quiet.to.split(":").map((n) => parseInt(n, 10));
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h || 0, m || 0, 0));
  if (d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

/**
 * THE SEAM the engine calls on every firing it marks notify_customer. See the
 * module header. Returns a CustomerDeliveryOutcome the engine records on the
 * event row's customer_delivery_status.
 */
export async function deliverCustomerTenantAlertToCustomer(
  alert: CustomerTenantAlertForDelivery,
): Promise<CustomerDeliveryOutcome> {
  try {
    const profile = await resolveCustomerAlertPreferences(alert.customerId);
    if (!profile) {
      return {
        status: "pending_prefs",
        detail: "no customer account resolvable for this tenant yet; event recorded for later delivery",
      };
    }

    const verdict = passesCustomerPreference(alert, profile);
    if (!verdict.deliver) {
      return { status: "suppressed", detail: verdict.reason };
    }

    const recipients = profile.recipients
      .filter((r) => r.scopeCategories === "all" || r.scopeCategories.includes(alert.alertCategory))
      .map((r) => r.email);
    if (recipients.length === 0) {
      return { status: "suppressed", detail: "no recipient scoped to this category" };
    }

    const pref = profile.categories[alert.alertCategory];
    const timing = computeDeliveryTiming(alert, pref, profile.quiet, new Date());

    if (timing.mode !== "immediate") {
      await enqueueCustomerAlertDigest({
        customerId: alert.customerId,
        eventId: alert.eventId,
        alertCategory: alert.alertCategory,
        severity: alert.severity,
        summary: alert.summary,
        deepLinkPath: alert.deepLinkPath,
        holdReason: timing.mode,
        dueAt: timing.dueAt,
      });
      return { status: "queued_digest", detail: `held for ${timing.mode} delivery, due ${timing.dueAt.toISOString()}` };
    }

    await sendToCustomerRecipients(alert, recipients);
    return { status: "delivered", detail: `sent to ${recipients.length} recipient(s)`, recipients };
  } catch (err) {
    log.warn({ err, eventId: alert.eventId, ruleKey: alert.ruleKey }, "customer-alert: customer delivery failed");
    // Never lose the alert — a delivery failure records as pending_prefs so a
    // later drain retries, rather than being silently marked delivered.
    return { status: "pending_prefs", detail: "customer delivery error; will retry" };
  }
}
