/**
 * Outbound Webhook Delivery Engine
 *
 * Fans out canonical events to registered outbound webhooks.
 * Signs every payload with HMAC-SHA256 so receivers can verify authenticity.
 * Retries on failure with exponential backoff (up to MAX_ATTEMPTS attempts).
 *
 * Architecture note: retries use in-process setTimeout. This is sufficient for
 * this deployment scale. If reliability requirements grow, move to a durable
 * queue (e.g. pg_cron or BullMQ).
 */

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { db, outboundWebhooksTable, outboundWebhookDeliveriesTable } from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import { logger } from "./logger.ts";
const log = logger.child({ channel: "comms.webhook" });
import type { DispatchedEvent } from "./event-bus.ts";

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 3;
// Delay in ms before each retry attempt (index 0 = first retry, index 1 = second, …)
const RETRY_DELAYS_MS = [30_000, 300_000]; // 30 s, 5 min
const RESPONSE_SNIPPET_MAX = 500;
const DELIVERY_TIMEOUT_MS = 10_000;

// ── Secret helpers ────────────────────────────────────────────────────────────

/**
 * Generate a new webhook secret: "whsec_" + 32 random bytes as hex.
 */
export function generateWebhookSecret(): string {
  return "whsec_" + randomBytes(32).toString("hex");
}

/**
 * Sign a payload body string with HMAC-SHA256.
 * Returns "sha256=<hex>".
 */
export function signPayload(secret: string, body: string): string {
  const hmac = createHmac("sha256", secret);
  hmac.update(body, "utf8");
  return "sha256=" + hmac.digest("hex");
}

/**
 * Constant-time signature verification.
 */
export function verifySignature(
  secret: string,
  body: string,
  signature: string,
): boolean {
  const expected = signPayload(secret, body);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ── Payload builder ───────────────────────────────────────────────────────────

export interface WebhookPayload {
  webhookId: string;
  eventId: string | null;
  eventType: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

function buildPayload(
  webhookId: string,
  event: DispatchedEvent & { payload?: Record<string, unknown> },
): WebhookPayload {
  return {
    webhookId,
    eventId: event.eventId,
    eventType: event.eventType,
    occurredAt: event.occurredAt.toISOString(),
    payload: event.payload ?? {},
  };
}

// ── Core delivery ─────────────────────────────────────────────────────────────

interface DeliveryTarget {
  webhookId: string;
  url: string;
  secret: string;
}

interface DeliveryResult {
  success: boolean;
  statusCode?: number;
  responseSnippet?: string;
}

async function doHttpDelivery(
  target: DeliveryTarget,
  body: string,
  signature: string,
): Promise<DeliveryResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);

  try {
    const res = await fetch(target.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
        "X-Webhook-Id": target.webhookId,
        "User-Agent": "MSP-Platform-Webhook/1.0",
      },
      body,
      signal: controller.signal,
    });

    const text = await res.text().catch(() => "");
    return {
      success: res.status >= 200 && res.status < 300,
      statusCode: res.status,
      responseSnippet: text.slice(0, RESPONSE_SNIPPET_MAX),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, responseSnippet: msg.slice(0, RESPONSE_SNIPPET_MAX) };
  } finally {
    clearTimeout(timer);
  }
}

async function attemptDelivery(
  deliveryId: string,
  target: DeliveryTarget,
  bodyPayload: WebhookPayload,
  attemptNumber: number,
): Promise<boolean> {
  const body = JSON.stringify(bodyPayload);
  const signature = signPayload(target.secret, body);

  const result = await doHttpDelivery(target, body, signature);

  if (result.success) {
    await db
      .update(outboundWebhookDeliveriesTable)
      .set({
        status: "success",
        statusCode: result.statusCode ?? null,
        responseSnippet: result.responseSnippet ?? null,
        deliveredAt: new Date(),
        nextRetryAt: null,
      })
      .where(eq(outboundWebhookDeliveriesTable.deliveryId, deliveryId));

    log.info(
      { deliveryId, webhookId: target.webhookId, attempt: attemptNumber, statusCode: result.statusCode },
      "webhook-delivery: delivered",
    );
    return true;
  }

  // Failed — determine if we retry
  const isLastAttempt = attemptNumber >= MAX_ATTEMPTS;
  const nextRetryAt = isLastAttempt
    ? null
    : new Date(Date.now() + RETRY_DELAYS_MS[attemptNumber - 1]);

  await db
    .update(outboundWebhookDeliveriesTable)
    .set({
      status: isLastAttempt ? "failed" : "retrying",
      statusCode: result.statusCode ?? null,
      responseSnippet: result.responseSnippet ?? null,
      nextRetryAt,
    })
    .where(eq(outboundWebhookDeliveriesTable.deliveryId, deliveryId));

  log.warn(
    {
      deliveryId,
      webhookId: target.webhookId,
      attempt: attemptNumber,
      statusCode: result.statusCode,
      willRetry: !isLastAttempt,
    },
    "webhook-delivery: delivery failed",
  );

  if (!isLastAttempt) {
    const delay = RETRY_DELAYS_MS[attemptNumber - 1];
    setTimeout(
      () => void scheduleAttempt(deliveryId, target, bodyPayload, attemptNumber + 1),
      delay,
    );
  }

  return false;
}

async function scheduleAttempt(
  deliveryId: string,
  target: DeliveryTarget,
  bodyPayload: WebhookPayload,
  attemptNumber: number,
): Promise<void> {
  // Update attempt number before delivery
  await db
    .update(outboundWebhookDeliveriesTable)
    .set({ attempt: attemptNumber, status: "pending" })
    .where(eq(outboundWebhookDeliveriesTable.deliveryId, deliveryId));

  await attemptDelivery(deliveryId, target, bodyPayload, attemptNumber);
}

// ── Fan-out ───────────────────────────────────────────────────────────────────

export interface FanOutEventInput {
  eventId: string;
  eventType: string;
  occurredAt: Date;
  mspId?: number | null;
  customerId?: number | null;
  payload?: Record<string, unknown>;
}

/**
 * Fan out a canonical event to all active webhooks that subscribe to that event type.
 * Scoped by mspId and/or customerId — a webhook only receives events from its owner.
 *
 * Never throws — errors are logged and swallowed so event dispatch is never disrupted.
 */
export async function fanOutWebhooks(event: FanOutEventInput): Promise<void> {
  try {
    await fanOutWebhooksUnsafe(event);
  } catch (err) {
    log.error({ err, eventType: event.eventType }, "webhook-delivery: fan-out error");
  }
}

async function fanOutWebhooksUnsafe(event: FanOutEventInput): Promise<void> {
  // Find active webhooks that:
  // 1. Subscribe to this event type (or have an empty subscription list = all events)
  // 2. Are owned by the same MSP and/or customer as the event
  const whereConditions = [eq(outboundWebhooksTable.isActive, true)];

  // Scope to the event's owner — webhooks only receive events from their own tenant
  // We query all webhooks for the mspId + customerId, then filter by eventTypes in JS
  // (JSONB contains checks are db-specific; this is simpler and the set is small).
  const webhooks = await db
    .select()
    .from(outboundWebhooksTable)
    .where(and(...whereConditions));

  // Filter to matching owner scope
  const matchingWebhooks = webhooks.filter((wh) => {
    // Guard: skip inactive (DB WHERE clause already filters this, but be explicit)
    if (!wh.isActive) return false;
    // Scope check: the webhook's owner must match the event's tenant
    const mspMatch = event.mspId != null && wh.mspId === event.mspId;
    const customerMatch = event.customerId != null && wh.customerId === event.customerId;
    if (!mspMatch && !customerMatch) return false;

    // Event type subscription check: empty list = subscribe to all
    const subs = wh.eventTypes as string[];
    return subs.length === 0 || subs.includes(event.eventType);
  });

  if (matchingWebhooks.length === 0) return;

  const dispatchedEvent: DispatchedEvent & { payload?: Record<string, unknown> } = {
    eventId: event.eventId,
    eventType: event.eventType,
    occurredAt: event.occurredAt,
    payload: event.payload,
  };

  for (const wh of matchingWebhooks) {
    const bodyPayload = buildPayload(wh.webhookId, dispatchedEvent);

    // Create delivery record
    const [row] = await db
      .insert(outboundWebhookDeliveriesTable)
      .values({
        webhookId: wh.webhookId,
        eventId: event.eventId,
        eventType: event.eventType,
        attempt: 1,
        status: "pending",
        requestBodySnapshot: bodyPayload as unknown as Record<string, unknown>,
      })
      .returning({ deliveryId: outboundWebhookDeliveriesTable.deliveryId });

    if (!row) continue;

    const target: DeliveryTarget = {
      webhookId: wh.webhookId,
      url: wh.url,
      secret: wh.secret,
    };

    // Fire-and-forget (async, no await) so event dispatch isn't blocked
    void attemptDelivery(row.deliveryId, target, bodyPayload, 1);
  }
}

// ── Delivery log query ────────────────────────────────────────────────────────

export interface DeliveryLogEntry {
  deliveryId: string;
  webhookId: string;
  eventId: string | null;
  eventType: string;
  attempt: number;
  status: string;
  statusCode: number | null;
  responseSnippet: string | null;
  nextRetryAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
}

export async function getDeliveryLog(
  webhookId: string,
  limit = 50,
): Promise<DeliveryLogEntry[]> {
  const rows = await db
    .select()
    .from(outboundWebhookDeliveriesTable)
    .where(eq(outboundWebhookDeliveriesTable.webhookId, webhookId))
    .orderBy(desc(outboundWebhookDeliveriesTable.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    deliveryId: r.deliveryId,
    webhookId: r.webhookId,
    eventId: r.eventId ?? null,
    eventType: r.eventType,
    attempt: r.attempt,
    status: r.status,
    statusCode: r.statusCode ?? null,
    responseSnippet: r.responseSnippet ?? null,
    nextRetryAt: r.nextRetryAt ?? null,
    deliveredAt: r.deliveredAt ?? null,
    createdAt: r.createdAt,
  }));
}
