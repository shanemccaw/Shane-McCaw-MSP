// Pure helpers for the EngageBay webhook receiver (EngageBay Webhooks + Workflow
// Nodes, #105). Kept DB/Express-free so they unit-test without mocks — mirrors
// zoho-webhook.ts's split.
//
// EngageBay's webhook payload is simpler than Zoho's: `{ "event": "contact.created",
// "entity": {...} }` (confirmed via github.com/engagebay/webhooks) — no
// module+operation split needed.

import crypto from "crypto";

/**
 * Constant-time comparison of the token EngageBay presented against
 * ENGAGEBAY_WEBHOOK_SECRET. An unset/empty secret always fails — a receiver
 * with no configured secret must reject rather than open the endpoint to
 * anyone.
 */
export function verifyEngageBayWebhookToken(
  provided: string | undefined,
  secret: string | undefined,
): boolean {
  if (!provided || !secret) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(secret, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Derives the event type from an inbound EngageBay notification. Reads
 * `body.event` directly (e.g. "contact.created") — an explicit `event_type`
 * in the body or query wins so a custom trigger can name its event directly,
 * same precedence as resolveZohoEventType. Returns null when undeterminable.
 *
 * The full EngageBay webhook event catalog is unconfirmed (see #105 audit) —
 * this deliberately matches whatever string arrives rather than validating
 * against a hardcoded enum.
 */
export function resolveEngageBayEventType(
  body: Record<string, unknown> | undefined,
  query: Record<string, unknown> | undefined,
): string | null {
  const explicit =
    (typeof query?.event_type === "string" && query.event_type) ||
    (typeof body?.event_type === "string" && body.event_type);
  if (explicit) return explicit;

  return typeof body?.event === "string" ? body.event : null;
}
