// Pure helpers for the Zoho webhook receiver (Zoho Integration Foundation, #82).
// Kept DB/Express-free so they unit-test without mocks.

import crypto from "crypto";

/** The Zoho event types a webhook trigger can listen for (config.zohoEventType). */
export const ZOHO_WEBHOOK_EVENT_TYPES = [
  "Leads.create",
  "Deals.update",
  "Contacts.update",
] as const;
export type ZohoWebhookEventType = typeof ZOHO_WEBHOOK_EVENT_TYPES[number];

/**
 * Constant-time comparison of the token Zoho presented against
 * ZOHO_WEBHOOK_SECRET. An unset/empty secret always fails — a receiver with no
 * configured secret must reject rather than open the endpoint to anyone.
 */
export function verifyZohoWebhookToken(
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
 * Derives the event type from an inbound Zoho notification. Zoho's
 * notification payloads carry `module` + `operation` (e.g. Leads + create);
 * an explicit `event_type` in the body or query wins so custom Zoho workflow
 * webhooks can name their event directly. Returns null when undeterminable.
 */
export function resolveZohoEventType(
  body: Record<string, unknown> | undefined,
  query: Record<string, unknown> | undefined,
): string | null {
  const explicit =
    (typeof query?.event_type === "string" && query.event_type) ||
    (typeof body?.event_type === "string" && body.event_type);
  if (explicit) return explicit;

  const module = typeof body?.module === "string" ? body.module : null;
  const operation = typeof body?.operation === "string" ? body.operation : null;
  if (module && operation) return `${module}.${operation}`;
  return null;
}
