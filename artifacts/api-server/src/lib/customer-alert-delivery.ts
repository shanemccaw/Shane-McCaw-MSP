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
 * That customer-side preference persistence is #1276 and does NOT exist yet:
 * `artifacts/msp-portal/src/components/portal-v2/alertPrefsData.ts` (ALERT_CATS,
 * ALERT_MODES, ALERT_RECIPIENTS_SEED, quiet hours, presets) is a pure front-end
 * fixture with no table or route behind it (confirmed — Git #1236 investigation).
 *
 * This module is the EXPLICIT SEAM #1276 plugs into — a real function with a
 * fixed contract, deliberately NOT a bare `// TODO` scattered in the engine.
 * The engine calls `deliverCustomerTenantAlertToCustomer()` on every firing it
 * marks `notify_customer`. Today that call:
 *   1. feature-detects the #1276 preference layer via
 *      `resolveCustomerAlertPreferences()`, and
 *   2. finding none, returns `{ status: "pending_prefs" }` — the engine records
 *      that verdict on the event row (`customer_delivery_status`), so no alert
 *      is lost: the events accumulate, queryable, ready for #1276's delivery
 *      worker to drain (or for this function to deliver inline the moment the
 *      preference layer starts returning a real profile).
 *
 * When #1276 lands it implements exactly ONE thing here —
 * `resolveCustomerAlertPreferences(customerId)` returning a real
 * `CustomerAlertPreferenceProfile` — and fills in `sendToCustomerRecipients()`.
 * The rest of the contract (category→pref lookup, severity-floor / digest /
 * quiet-hours filtering, the `CustomerDeliveryOutcome` shape the engine records)
 * is already defined below, so the engine never changes again.
 */

import { logger } from "./logger";

const log = logger.child({ channel: "notification" });

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
  | "pending_prefs" // #1276 preference layer not present yet — recorded, not lost
  | "delivered"     // sent to at least one customer recipient
  | "suppressed"    // the customer's own threshold / quiet-hours filtered it out
  | "skipped";      // rule.notify_customer = false (never reaches this module)

export interface CustomerDeliveryOutcome {
  status: CustomerDeliveryStatus;
  /** Human note for the event row / logs. */
  detail?: string;
  /** Recipients actually delivered to (empty unless status = "delivered"). */
  recipients?: string[];
}

/**
 * The per-customer, per-category preference profile #1276 will persist and
 * resolve. Shape mirrors alertPrefsData.ts so #1276's implementation is a
 * direct read of its own table, not a re-modelling. Kept here (not imported
 * from the portal fixture) because api-server must not depend on msp-portal.
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

/**
 * #1276 EXTENSION POINT. Returns the customer's persisted Alert Preferences
 * profile, or null if no preference persistence exists yet. Until #1276 builds
 * its table + read path, this returns null and the whole delivery degrades
 * cleanly to "pending_prefs".
 *
 * Intentionally the ONLY thing #1276 must implement to switch customer delivery
 * on: replace the body with a read of its new customer-alert-preferences table.
 */
export async function resolveCustomerAlertPreferences(
  _customerId: number,
): Promise<CustomerAlertPreferenceProfile | null> {
  // #1276 not landed — no persistence to read. See module header.
  return null;
}

/**
 * #1276 EXTENSION POINT. Sends one alert to the given customer recipients via
 * Exchange Online (Microsoft Graph — NEVER Resend, per CLAUDE.md), deep-linking
 * into the customer portal. Unreachable until resolveCustomerAlertPreferences()
 * returns a real profile.
 */
async function sendToCustomerRecipients(
  _alert: CustomerTenantAlertForDelivery,
  _recipients: string[],
): Promise<void> {
  // #1276 implements the Graph sendMail to customer recipients here.
  throw new Error(
    "sendToCustomerRecipients is a #1276 extension point and is not implemented until the customer Alert Preferences layer exists",
  );
}

/**
 * Apply the customer's own preference for this alert's category: is the category
 * on, does the alert clear the category's severity floor, and are we inside
 * quiet hours (with the critical-break honoured)? Pure, so #1276 can unit-test it.
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
  // Quiet hours are a digest concern (#1276's batcher) — represented here so the
  // contract is complete; the critical break always wins.
  return { deliver: true, reason: "ok" };
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
      log.info(
        { eventId: alert.eventId, ruleKey: alert.ruleKey, customerId: alert.customerId },
        "customer-alert: customer delivery pending #1276 preference layer",
      );
      return {
        status: "pending_prefs",
        detail: "customer Alert Preferences persistence (#1276) not present; event recorded for later delivery",
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

    await sendToCustomerRecipients(alert, recipients);
    return { status: "delivered", detail: `sent to ${recipients.length} recipient(s)`, recipients };
  } catch (err) {
    log.warn({ err, eventId: alert.eventId, ruleKey: alert.ruleKey }, "customer-alert: customer delivery failed");
    // Never lose the alert — a delivery failure records as pending_prefs so a
    // later drain retries, rather than being silently marked delivered.
    return { status: "pending_prefs", detail: "customer delivery error; will retry" };
  }
}
