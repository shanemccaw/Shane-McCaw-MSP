/**
 * resolve-fulfillment.ts
 *
 * Single shared entry point for all fulfillment triggers.
 * Called by every purchase path (public checkout, portal checkout) and by
 * signal-triggered auto-creation. A fired signal is just another fulfillment
 * trigger — the same mechanism as a purchase, zero duplicated branching.
 *
 * Algorithm
 * ─────────
 * 1. Look up the FulfillmentType row by key.
 * 2. Check the idempotency store using the caller-supplied key.
 *    → If a row already exists, log and return early (already emitted).
 * 3. Insert the idempotency row (ON CONFLICT DO NOTHING for DB-level safety).
 * 4. Emit `fulfillment.<key>` on the workflow event bus.
 *
 * The idempotency key should be:
 *   - Purchase path:  Stripe checkout session ID (cs_xxx)
 *   - Signal path:    A stable UUID derived from (serviceId, clientId, signalKey, date)
 *   - Manual path:    Any caller-supplied unique string
 */

import { db } from "@workspace/db";
import { fulfillmentTypesTable, fulfillmentIdempotencyTable, clientServicesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { emitWorkflowEvent } from "./workflow-executor";
import { resolveCustomerPortalUserId } from "./tenant-signals";
import { logger } from "./logger";
const log = logger.child({ channel: "billing" });

export interface ResolveFulfillmentInput {
  /** Key into fulfillment_types (e.g. "assessment", "retainer") */
  fulfillmentTypeKey: string;
  /**
   * Dedup key — Stripe session ID for purchases, a stable UUID for signal fires.
   * Prevents double-emitting if a webhook is retried or a signal fires twice.
   */
  idempotencyKey: string;
  /** Surface that triggered this: "purchase" | "signal" | "manual" */
  trigger: "purchase" | "signal" | "manual";
  /**
   * Arbitrary context forwarded into the emitted workflow event payload.
   * Include enough data for the downstream workflow to act without DB re-reads:
   *   clientUserId, clientEmail, serviceId, serviceName, amountCents, signalKey, etc.
   */
  payload: Record<string, unknown>;
}

export interface ResolveFulfillmentResult {
  /** "emitted" — event fired; "duplicate" — idempotency guard hit; "unknown_type" — no matching FulfillmentType row */
  status: "emitted" | "duplicate" | "unknown_type";
  fulfillmentTypeKey: string;
  idempotencyKey: string;
  eventName?: string;
}

/**
 * Core resolver. Call from any purchase path or signal handler.
 * Never throws — returns a typed result so callers can handle gracefully.
 */
export async function resolveFulfillment(
  input: ResolveFulfillmentInput,
): Promise<ResolveFulfillmentResult> {
  const { fulfillmentTypeKey, idempotencyKey, trigger, payload } = input;

  // 1. Verify the type exists and is active
  const [fulfillmentType] = await db
    .select()
    .from(fulfillmentTypesTable)
    .where(eq(fulfillmentTypesTable.key, fulfillmentTypeKey))
    .limit(1);

  if (!fulfillmentType) {
    log.warn(
      { fulfillmentTypeKey, idempotencyKey, trigger },
      "resolve-fulfillment: unknown fulfillmentTypeKey — event not emitted",
    );
    return { status: "unknown_type", fulfillmentTypeKey, idempotencyKey };
  }

  if (!fulfillmentType.isActive) {
    log.info(
      { fulfillmentTypeKey, idempotencyKey, trigger },
      "resolve-fulfillment: fulfillmentType is inactive — event not emitted",
    );
    return { status: "unknown_type", fulfillmentTypeKey, idempotencyKey };
  }

  // 2. Idempotency check — select first, then try insert
  const [existing] = await db
    .select({ idempotencyKey: fulfillmentIdempotencyTable.idempotencyKey })
    .from(fulfillmentIdempotencyTable)
    .where(eq(fulfillmentIdempotencyTable.idempotencyKey, idempotencyKey))
    .limit(1);

  if (existing) {
    log.info(
      { fulfillmentTypeKey, idempotencyKey, trigger },
      "resolve-fulfillment: idempotency hit — skipping duplicate emission",
    );
    return { status: "duplicate", fulfillmentTypeKey, idempotencyKey };
  }

  // 3. Reserve the slot (ON CONFLICT DO NOTHING handles concurrent races)
  const fullPayload: Record<string, unknown> = {
    ...payload,
    fulfillmentTypeKey,
    idempotencyKey,
    trigger,
    recurring: fulfillmentType.recurring,
    _resolvedAt: new Date().toISOString(),
  };

  const inserted = await db
    .insert(fulfillmentIdempotencyTable)
    .values({
      idempotencyKey,
      fulfillmentTypeKey,
      payload: fullPayload,
    })
    .onConflictDoNothing()
    .returning({ key: fulfillmentIdempotencyTable.idempotencyKey });

  if (!inserted.length) {
    // Another concurrent call won the race
    log.info(
      { fulfillmentTypeKey, idempotencyKey, trigger },
      "resolve-fulfillment: concurrent idempotency race — skipping duplicate emission",
    );
    return { status: "duplicate", fulfillmentTypeKey, idempotencyKey };
  }

  // 4. Emit the event — downstream workflow definitions subscribe via an
  //    `event` trigger with eventName = "fulfillment.<key>"
  const eventName = `fulfillment.${fulfillmentTypeKey}`;
  await emitWorkflowEvent(eventName, fullPayload);

  log.info(
    { eventName, fulfillmentTypeKey, idempotencyKey, trigger },
    "resolve-fulfillment: emitted fulfillment event",
  );

  if (fulfillmentTypeKey === "monitoring_subscription") {
    await provisionMonitoringClientService(payload);
  }

  return { status: "emitted", fulfillmentTypeKey, idempotencyKey, eventName };
}

/**
 * monitoring_subscription is the one fulfillment type with a real downstream
 * reader today — msp-diagnostics.ts, support-chat.ts, etc. all resolve a
 * tenant's monitoring packageKey via `users -> client_services -> services`,
 * filtered on `fulfillment_type_key='monitoring_subscription' AND
 * status='active'`. No workflow definition subscribes to the
 * `fulfillment.monitoring_subscription` event above (confirmed: zero
 * client_services rows exist anywhere, ever), so without this write the
 * purchase this event represents stays invisible to every one of those
 * readers (Git #1164).
 */
async function provisionMonitoringClientService(payload: Record<string, unknown>): Promise<void> {
  const customerId = typeof payload["customerId"] === "number" ? payload["customerId"] : null;
  const serviceId = typeof payload["serviceId"] === "number" ? payload["serviceId"] : null;
  const stripeSubscriptionId = typeof payload["subscriptionId"] === "string" ? payload["subscriptionId"] : null;

  if (!customerId || !serviceId) {
    log.warn(
      { customerId, serviceId },
      "resolve-fulfillment: monitoring_subscription purchase missing customerId/serviceId in payload — client_services not provisioned",
    );
    return;
  }

  // client_services.clientUserId is a users.id FK, not a tenants.id — resolve
  // the tenant's canonical portal login the same way every other consumer of
  // that column does (tenant-signals.ts's resolveCustomerPortalUserId).
  const clientUserId = await resolveCustomerPortalUserId(customerId);
  if (!clientUserId) {
    log.warn(
      { customerId, serviceId },
      "resolve-fulfillment: no active portal user for tenant — client_services not provisioned",
    );
    return;
  }

  await db.insert(clientServicesTable).values({
    clientUserId,
    serviceId,
    status: "active",
    progress: 0,
    startDate: new Date(),
    ...(stripeSubscriptionId ? { stripeSubscriptionId } : {}),
  });

  log.info(
    { customerId, serviceId, clientUserId },
    "resolve-fulfillment: provisioned client_services row for monitoring purchase",
  );
}

/**
 * Convenience wrapper for signal-triggered fulfillment.
 *
 * The idempotencyKey is derived deterministically so re-firing the same
 * signal for the same client on the same calendar day is idempotent.
 * Pass a custom `idempotencyKey` override when finer dedup is needed.
 */
export async function resolveFulfillmentForSignal(opts: {
  fulfillmentTypeKey: string;
  signalKey: string;
  clientUserId?: number;
  serviceId?: number;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
}): Promise<ResolveFulfillmentResult> {
  const dateStamp = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const key =
    opts.idempotencyKey ??
    `signal:${opts.signalKey}:svc:${opts.serviceId ?? "none"}:client:${opts.clientUserId ?? "none"}:${dateStamp}`;

  return resolveFulfillment({
    fulfillmentTypeKey: opts.fulfillmentTypeKey,
    idempotencyKey: key,
    trigger: "signal",
    payload: {
      signalKey: opts.signalKey,
      clientUserId: opts.clientUserId,
      serviceId: opts.serviceId,
      ...(opts.payload ?? {}),
    },
  });
}
