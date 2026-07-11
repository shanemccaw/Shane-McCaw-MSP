/**
 * MSP Webhook Endpoints  (/api/msp/v1/webhooks/*)
 *
 * Handles inbound webhooks from external systems.  Each endpoint:
 *   1. Reads the raw (un-parsed) request body for signature verification
 *   2. Verifies the signature before touching any payload data
 *   3. Deduplicates via the idempotency store (keyed on event ID)
 *   4. Dispatches to subsystem-specific handlers (stubbed here — filled in by
 *      the Billing and Platform Subscription tasks)
 *
 * Endpoints:
 *   POST /api/msp/v1/webhooks/stripe
 *     — Stripe billing events (checkout.session.completed, invoice.paid, etc.)
 *       Signature verified with STRIPE_MSP_WEBHOOK_SECRET
 *
 *   POST /api/msp/v1/webhooks/app-signature
 *     — Internal platform-to-platform callbacks signed with APP_WEBHOOK_SECRET
 *       using HMAC-SHA256.  Used by provisioning runbooks, async workers, and
 *       cross-service integrations that call back into the platform.
 *
 * Raw body parsing:
 *   Both routes require the raw Buffer body (not JSON-parsed).  app.ts registers
 *   express.raw() for /api/msp/v1/webhooks/* BEFORE express.json() so this is
 *   already handled by the time the route handler runs.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "crypto";
import { logger } from "../lib/logger.ts";
import { checkIdempotency, recordIdempotency, hashBody } from "../lib/idempotency.ts";
import { apiError, ApiErrorCode } from "../lib/api-helpers.ts";

const router: IRouter = Router();

// ── Stripe MSP Webhook ────────────────────────────────────────────────────────

/**
 * Verify Stripe's webhook signature using the STRIPE_MSP_WEBHOOK_SECRET.
 * Returns the parsed event on success, or null on failure.
 *
 * Stripe uses its own HMAC-SHA256 scheme — we reproduce it here rather than
 * importing the full Stripe SDK so the webhook path has no latency from lazy
 * SDK initialisation.
 */
function verifyStripeSignature(
  rawBody: Buffer,
  sigHeader: string | undefined,
  secret: string,
): { id: string; type: string; data: { object: Record<string, unknown> }; created: number } | null {
  if (!sigHeader) return null;

  // Stripe signature format: "t=<timestamp>,v1=<hmac>,v1=<hmac>..."
  const parts = sigHeader.split(",").reduce<Record<string, string>>((acc, part) => {
    const [k, v] = part.split("=");
    if (k && v) acc[k] = v;
    return acc;
  }, {});

  const timestamp = parts["t"];
  const signatures = sigHeader
    .split(",")
    .filter((p) => p.startsWith("v1="))
    .map((p) => p.slice(3));

  if (!timestamp || signatures.length === 0) return null;

  // Reject events older than 5 minutes (replay protection)
  const eventAge = Math.abs(Date.now() / 1000 - parseInt(timestamp, 10));
  if (eventAge > 300) {
    logger.warn({ eventAge }, "msp-webhook/stripe: event too old — possible replay attack");
    return null;
  }

  const signedPayload = `${timestamp}.${rawBody.toString("utf8")}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");

  const isValid = signatures.some((sig) => {
    try {
      return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
    } catch {
      return false;
    }
  });

  if (!isValid) return null;

  try {
    return JSON.parse(rawBody.toString("utf8")) as { id: string; type: string; data: { object: Record<string, unknown> }; created: number };
  } catch {
    return null;
  }
}

/**
 * Dispatch a verified Stripe event to the appropriate subsystem handler.
 * Stubbed — billing subsystem wires in real handlers here.
 */
async function handleStripeEvent(event: { id: string; type: string; data: { object: Record<string, unknown> } }): Promise<void> {
  logger.info({ eventId: event.id, eventType: event.type }, "msp-webhook/stripe: dispatching event");

  switch (event.type) {
    case "checkout.session.completed":
      // TODO (Billing task): provision subscription on successful checkout
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
      // TODO (Billing task): sync subscription status to msp_subscriptions table
      break;
    case "customer.subscription.deleted":
      // TODO (Platform Subscription task): handle cancellation / downgrade
      break;
    case "invoice.paid":
      // TODO (Billing task): record payment, reset dunning state
      break;
    case "invoice.payment_failed":
      // TODO (Dunning task): increment dunning counter, send warning email
      break;
    default:
      logger.info({ eventType: event.type }, "msp-webhook/stripe: unhandled event type (no-op)");
  }
}

router.post("/stripe", async (req: Request, res: Response) => {
  const secret = process.env["STRIPE_MSP_WEBHOOK_SECRET"];
  if (!secret) {
    logger.warn({}, "msp-webhook/stripe: STRIPE_MSP_WEBHOOK_SECRET not configured — rejecting");
    apiError(res, 503, ApiErrorCode.INTERNAL, "Webhook endpoint not configured");
    return;
  }

  const rawBody = req.body as Buffer;
  if (!Buffer.isBuffer(rawBody)) {
    logger.warn({ bodyType: typeof rawBody }, "msp-webhook/stripe: expected raw Buffer body");
    apiError(res, 400, ApiErrorCode.VALIDATION, "Webhook requires raw body — check Content-Type");
    return;
  }

  const sigHeader = req.headers["stripe-signature"] as string | undefined;
  const event = verifyStripeSignature(rawBody, sigHeader, secret);

  if (!event) {
    logger.warn({ sigHeader: sigHeader?.slice(0, 40) }, "msp-webhook/stripe: invalid signature");
    apiError(res, 400, ApiErrorCode.WEBHOOK_INVALID_SIGNATURE, "Webhook signature verification failed");
    return;
  }

  // Idempotency — deduplicate on Stripe event ID
  const bodyHash = hashBody({ eventId: event.id });
  const cached = await checkIdempotency(`stripe-msp:${event.id}`, null, bodyHash);
  if (cached) {
    logger.info({ eventId: event.id }, "msp-webhook/stripe: duplicate event — returning cached response");
    res.status(cached.statusCode).json(cached.responseBody);
    return;
  }

  try {
    await handleStripeEvent(event);
    const responseBody = { received: true, eventId: event.id, eventType: event.type };
    await recordIdempotency(`stripe-msp:${event.id}`, null, bodyHash, 200, responseBody);
    res.json(responseBody);
  } catch (err) {
    logger.error({ err, eventId: event.id }, "msp-webhook/stripe: handler error");
    apiError(res, 500, ApiErrorCode.INTERNAL, "Webhook processing failed");
  }
});

// ── In-App Signature Webhook ──────────────────────────────────────────────────

/**
 * Verify an internal platform callback signed with HMAC-SHA256 using APP_WEBHOOK_SECRET.
 *
 * Expected headers:
 *   X-App-Signature: sha256=<hex-digest>
 *   X-App-Timestamp: <unix-seconds>   (replay protection)
 *
 * The signed payload is:  "<timestamp>.<raw-body-utf8>"
 */
function verifyAppSignature(
  rawBody: Buffer,
  sigHeader: string | undefined,
  tsHeader: string | undefined,
  secret: string,
): boolean {
  if (!sigHeader || !tsHeader) return false;

  const timestamp = parseInt(tsHeader, 10);
  if (isNaN(timestamp)) return false;

  const eventAge = Math.abs(Date.now() / 1000 - timestamp);
  if (eventAge > 300) {
    logger.warn({ eventAge }, "msp-webhook/app: event too old — possible replay attack");
    return false;
  }

  if (!sigHeader.startsWith("sha256=")) return false;
  const provided = sigHeader.slice(7);

  const signedPayload = `${timestamp}.${rawBody.toString("utf8")}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");

  try {
    return crypto.timingSafeEqual(Buffer.from(provided, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

/**
 * Dispatch a verified in-app callback to the appropriate subsystem handler.
 * Stubbed — subsystem tasks wire in real handlers here.
 */
async function handleAppCallback(event: { eventId: string; eventType: string; payload: Record<string, unknown> }): Promise<void> {
  logger.info({ eventId: event.eventId, eventType: event.eventType }, "msp-webhook/app: dispatching callback");

  switch (event.eventType) {
    case "provisioning.completed":
      // TODO (Provisioning task): update customer status, fire notifications
      break;
    case "provisioning.failed":
      // TODO (Provisioning task): mark failed, notify admin
      break;
    case "health.scan.completed":
      // TODO (Diagnostics task): ingest health snapshot
      break;
    default:
      logger.info({ eventType: event.eventType }, "msp-webhook/app: unhandled callback type (no-op)");
  }
}

router.post("/app-signature", async (req: Request, res: Response) => {
  const secret = process.env["APP_WEBHOOK_SECRET"];
  if (!secret) {
    logger.warn({}, "msp-webhook/app: APP_WEBHOOK_SECRET not configured — rejecting");
    apiError(res, 503, ApiErrorCode.INTERNAL, "Webhook endpoint not configured");
    return;
  }

  const rawBody = req.body as Buffer;
  if (!Buffer.isBuffer(rawBody)) {
    logger.warn({ bodyType: typeof rawBody }, "msp-webhook/app: expected raw Buffer body");
    apiError(res, 400, ApiErrorCode.VALIDATION, "Webhook requires raw body — check Content-Type");
    return;
  }

  const sigHeader = req.headers["x-app-signature"] as string | undefined;
  const tsHeader = req.headers["x-app-timestamp"] as string | undefined;

  if (!verifyAppSignature(rawBody, sigHeader, tsHeader, secret)) {
    logger.warn({}, "msp-webhook/app: invalid signature");
    apiError(res, 400, ApiErrorCode.WEBHOOK_INVALID_SIGNATURE, "Webhook signature verification failed");
    return;
  }

  let event: { eventId: string; eventType: string; payload: Record<string, unknown> };
  try {
    event = JSON.parse(rawBody.toString("utf8")) as typeof event;
    if (!event.eventId || !event.eventType) throw new Error("Missing eventId or eventType");
  } catch {
    apiError(res, 400, ApiErrorCode.VALIDATION, "Invalid webhook payload — expected { eventId, eventType, payload }");
    return;
  }

  // Idempotency
  const bodyHash = hashBody({ eventId: event.eventId });
  const cached = await checkIdempotency(`app:${event.eventId}`, null, bodyHash);
  if (cached) {
    logger.info({ eventId: event.eventId }, "msp-webhook/app: duplicate event — returning cached response");
    res.status(cached.statusCode).json(cached.responseBody);
    return;
  }

  try {
    await handleAppCallback(event);
    const responseBody = { received: true, eventId: event.eventId, eventType: event.eventType };
    await recordIdempotency(`app:${event.eventId}`, null, bodyHash, 200, responseBody);
    res.json(responseBody);
  } catch (err) {
    logger.error({ err, eventId: event.eventId }, "msp-webhook/app: handler error");
    apiError(res, 500, ApiErrorCode.INTERNAL, "Webhook processing failed");
  }
});

export default router;
