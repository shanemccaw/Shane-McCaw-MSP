/**
 * Canonical Event Bus
 *
 * Append-only event store using the msp_event_store table.
 * Every event carries: eventId, eventType, eventVersion, occurredAt,
 * correlationId, causationId, actor, source, meta.tenant, payload.
 *
 * Dispatching an event writes it to the store synchronously (within the
 * caller's transaction context if one is provided, otherwise auto-committed).
 * Out-of-band side-effects (webhooks, notifications) should subscribe
 * separately and fan-out from the stored rows.
 */

import { randomUUID } from "crypto";
import { z } from "zod";
import { db, mspEventStoreTable } from "@workspace/db";
import type {
  CanonicalEventActor,
  CanonicalEventMeta,
  MspRole,
} from "@workspace/db";
import { logger } from "./logger";
import { fanOutWebhooks } from "./webhook-delivery.ts";

// ── Runtime envelope schema ───────────────────────────────────────────────────

const actorSchema = z.object({
  id: z.union([z.string().min(1), z.number().int()]),
  role: z.string().min(1),
  type: z.string().min(1),
});

const envelopeSchema = z.object({
  eventType: z.string().min(1, "eventType must be a non-empty string"),
  source: z.string().min(1, "source must be a non-empty string"),
  actor: actorSchema,
  eventVersion: z.string().optional(),
  mspId: z.number().int().positive().nullish(),
  customerId: z.number().int().positive().nullish(),
  ownerType: z.enum(["customer", "msp", "platform"]).optional(),
  correlationId: z.string().uuid("correlationId must be a UUID"),
  causationId: z.string().uuid("causationId must be a UUID"),
  payload: z.record(z.unknown()).optional(),
  extraMeta: z.record(z.unknown()).optional(),
});

function validateEnvelope(opts: EventDispatchOptions): void {
  const result = envelopeSchema.safeParse(opts);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`event-bus: invalid envelope — ${msg}`);
  }
}

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface EventDispatchOptions {
  eventType: string;
  eventVersion?: string;
  actor: CanonicalEventActor;
  source: string;
  mspId?: number | null;
  customerId?: number | null;
  ownerType?: "customer" | "msp" | "platform";
  correlationId?: string;
  causationId?: string;
  payload?: Record<string, unknown>;
  extraMeta?: Record<string, unknown>;
}

export interface DispatchedEvent {
  eventId: string;
  eventType: string;
  occurredAt: Date;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildMeta(
  opts: EventDispatchOptions,
): CanonicalEventMeta {
  return {
    tenant: {
      mspId: opts.mspId ?? null,
      customerId: opts.customerId ?? null,
    },
    ...opts.extraMeta,
  };
}

// ── In-process event listeners ────────────────────────────────────────────────
// Lightweight pub/sub for in-process subscribers (e.g. portal-workflow-engine).
// Listeners receive a DispatchedEvent enriched with tenant context so they can
// make routing decisions without hitting the DB again.

export type EventListener = (
  event: DispatchedEvent & {
    mspId?: number | null;
    customerId?: number | null;
    payload?: Record<string, unknown>;
  },
) => void;

const eventListeners: EventListener[] = [];

/**
 * Register an in-process listener for all dispatched events.
 * Returns an unsubscribe function.
 */
export function addEventListener(fn: EventListener): () => void {
  eventListeners.push(fn);
  return () => {
    const i = eventListeners.indexOf(fn);
    if (i !== -1) eventListeners.splice(i, 1);
  };
}

function notifyListeners(
  dispatched: DispatchedEvent,
  opts: EventDispatchOptions,
): void {
  if (eventListeners.length === 0) return;
  const enriched = {
    ...dispatched,
    mspId: opts.mspId ?? null,
    customerId: opts.customerId ?? null,
    payload: opts.payload ?? {},
  };
  for (const fn of eventListeners) {
    try {
      fn(enriched);
    } catch (err) {
      logger.error({ err, eventType: dispatched.eventType }, "event-bus: listener threw");
    }
  }
}

// ── Core dispatch ─────────────────────────────────────────────────────────────

/**
 * Dispatch a single canonical event to the append-only store.
 * Returns the assigned eventId and occurredAt timestamp.
 *
 * Never throws — errors are logged and swallowed so callers are not
 * disrupted by event store failures. If you need transactional guarantees
 * wrap the DB insert in your own transaction and call dispatchUnsafe().
 */
export async function dispatchEvent(opts: EventDispatchOptions): Promise<DispatchedEvent | null> {
  try {
    return await dispatchUnsafe(opts);
  } catch (err) {
    logger.error({ err, eventType: opts.eventType }, "event-bus: failed to dispatch event");
    return null;
  }
}

/**
 * Like dispatchEvent but propagates errors — use inside explicit transactions.
 */
export async function dispatchUnsafe(opts: EventDispatchOptions): Promise<DispatchedEvent> {
  // Auto-generate correlationId and causationId if not provided so every event
  // always carries both fields (canonical envelope requirement).
  const normalized: EventDispatchOptions & { correlationId: string; causationId: string } = {
    ...opts,
    correlationId: opts.correlationId ?? randomUUID(),
    causationId: opts.causationId ?? randomUUID(),
  };

  validateEnvelope(normalized);

  const eventId = randomUUID();
  const occurredAt = new Date();

  await db.insert(mspEventStoreTable).values({
    eventId,
    eventType: normalized.eventType,
    eventVersion: normalized.eventVersion ?? "1.0",
    occurredAt,
    correlationId: normalized.correlationId,
    causationId: normalized.causationId,
    actor: opts.actor,
    source: opts.source,
    meta: buildMeta(opts),
    payload: opts.payload ?? {},
    ownerType: opts.ownerType ?? (opts.customerId != null ? "customer" : opts.mspId != null ? "msp" : "platform"),
    mspId: opts.mspId ?? null,
    customerId: opts.customerId ?? null,
  });

  const dispatched: DispatchedEvent = { eventId, eventType: opts.eventType, occurredAt };

  // Fan out to registered outbound webhooks (fire-and-forget, never throws)
  void fanOutWebhooks({
    eventId,
    eventType: normalized.eventType,
    occurredAt,
    mspId: opts.mspId ?? null,
    customerId: opts.customerId ?? null,
    payload: opts.payload,
  });

  // Notify in-process listeners (fire-and-forget; never throws)
  notifyListeners(dispatched, normalized);

  return dispatched;
}

// ── Actor builders ────────────────────────────────────────────────────────────

export function systemActor(): CanonicalEventActor {
  return { id: "system", role: "system", type: "system" };
}

export function userActor(userId: number, role: MspRole): CanonicalEventActor {
  return { id: userId, role, type: "user" };
}

export function serviceAccountActor(saId: number): CanonicalEventActor {
  return { id: saId, role: "ServiceAccount", type: "service_account" };
}

// ── Well-known event type constants ──────────────────────────────────────────

export const EVENT_TYPES = {
  AUTH_LOGIN: "auth.login",
  AUTH_LOGOUT: "auth.logout",
  AUTH_TOKEN_REFRESH: "auth.token.refresh",
  AUTH_TOKEN_REVOKED: "auth.token.revoked",
  AUTH_ROLE_CHANGED: "auth.role.changed",
  AUTH_ACCOUNT_SETUP: "auth.account.setup",
  AUTH_PASSWORD_RESET: "auth.password.reset",
  MSP_SERVICE_ACCOUNT_CREATED: "msp.service_account.created",
  MSP_SERVICE_ACCOUNT_REVOKED: "msp.service_account.revoked",

  MSP_CREATED: "msp.created",
  MSP_UPDATED: "msp.updated",
  MSP_SUSPENDED: "msp.suspended",

  CUSTOMER_CREATED: "customer.created",
  CUSTOMER_UPDATED: "customer.updated",
  CUSTOMER_STATUS_CHANGED: "customer.status.changed",

  USER_INVITED: "user.invited",
  USER_ACTIVATED: "user.activated",
  USER_DEACTIVATED: "user.deactivated",

  SERVICE_ACCOUNT_CREATED: "service_account.created",
  SERVICE_ACCOUNT_REVOKED: "service_account.revoked",

  DOCUMENT_CREATED: "document.created",
  DOCUMENT_VERSION_ADDED: "document.version.added",
  DOCUMENT_STATUS_CHANGED: "document.status.changed",

  IDEMPOTENCY_HIT: "idempotency.hit",
  DLQ_ITEM_ENQUEUED: "dlq.item.enqueued",
  DLQ_ITEM_RESOLVED: "dlq.item.resolved",
} as const;

export type EventType = typeof EVENT_TYPES[keyof typeof EVENT_TYPES];
