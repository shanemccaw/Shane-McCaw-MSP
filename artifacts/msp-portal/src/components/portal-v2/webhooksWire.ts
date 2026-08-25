/**
 * webhooksWire.ts — maps `GET /api/portal/webhooks` (+ its per-endpoint
 * `/deliveries` log) into the Webhooks page's fixture shapes (Git #1249).
 *
 * Kept separate from `webhooksData.ts` / `webhooksModel.ts` so the fixture's
 * own pinned tests (`webhooksModel.test.ts`) stay untouched — this module is
 * the live-data equivalent, not a replacement.
 *
 * The event catalogue's labels/"fires when"/alert-category text
 * (`WEBHOOK_EVENTS`) and the delivery-behaviour/verify-it copy blocks stay
 * static: they are documentation, not tenant data. Only the catalogue's
 * per-event *subscriber counts*, and everything endpoint-shaped (identity,
 * health state, event subscriptions, secret, recent deliveries, failure
 * banner), are computed from the real rows here.
 */

import { timeAgo } from "./overviewModel";
import {
  WEBHOOK_EVENTS,
  type Webhook,
  type WhDelivery,
  type WhDeliveryTone,
  type WhFailure,
  type WhState,
} from "./webhooksData";
import type { WhCatalogueRow } from "./webhooksModel";

/** The shape `GET /api/portal/webhooks` (and its `:webhookId` sibling) returns. */
export interface WireWebhook {
  readonly webhookId: string;
  readonly label: string;
  readonly url: string;
  readonly secretPrefix: string;
  readonly eventTypes: readonly string[];
  readonly isActive: boolean;
  readonly ownerType: "msp" | "customer" | "platform";
  readonly mspId: number | null;
  readonly customerId: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** One row of `GET /api/portal/webhooks/:webhookId/deliveries` (`DeliveryLogEntry`). */
export interface WireDelivery {
  readonly deliveryId: string;
  readonly webhookId: string;
  readonly eventId: string | null;
  readonly eventType: string;
  readonly attempt: number;
  readonly status: "pending" | "success" | "failed" | "retrying" | string;
  readonly statusCode: number | null;
  readonly responseSnippet: string | null;
  readonly nextRetryAt: string | null;
  readonly deliveredAt: string | null;
  readonly createdAt: string;
}

/** One live-mapped endpoint row, plus its real subscribed wire names (kept
 * alongside the `Webhook` shape rather than crammed into `.events`, since that
 * field is fixture-typed as the Alert-preferences category keys). */
export interface LiveEndpoint {
  readonly webhook: Webhook;
  readonly chips: readonly string[];
  readonly eventCountLabel: string;
}

function deliveryTone(d: WireDelivery): WhDeliveryTone {
  if (d.status === "success") return "green";
  if (d.status === "retrying") return "amber";
  return "red";
}

function deliveryCode(d: WireDelivery): string {
  return d.statusCode != null ? String(d.statusCode) : d.status;
}

/** Health state from real activity: inactive endpoints are paused regardless
 * of history; otherwise the recent-delivery success rate decides. */
export function deriveState(isActive: boolean, deliveries: readonly WireDelivery[]): WhState {
  if (!isActive) return "paused";
  if (deliveries.length === 0) return "healthy";
  const failed = deliveries.filter((d) => d.status === "failed" || d.status === "retrying").length;
  const rate = 1 - failed / deliveries.length;
  if (rate < 0.7) return "failing";
  if (rate < 0.98) return "degraded";
  return "healthy";
}

function successRateLabel(deliveries: readonly WireDelivery[]): string {
  if (deliveries.length === 0) return "—";
  const ok = deliveries.filter((d) => d.status === "success").length;
  return `${Math.round((ok / deliveries.length) * 100)}%`;
}

function buildFailure(deliveries: readonly WireDelivery[], state: WhState): WhFailure | undefined {
  if (state !== "failing" && state !== "degraded") return undefined;
  const failed = deliveries.filter((d) => d.status === "failed" || d.status === "retrying");
  if (failed.length === 0) return undefined;
  const newest = failed[0]!;
  const oldest = failed[failed.length - 1]!;
  return {
    since: timeAgo(oldest.createdAt),
    count: failed.length,
    code: deliveryCode(newest),
    reason: newest.responseSnippet
      ? `Most recent failure response: ${newest.responseSnippet}`
      : "Recent deliveries to this endpoint have not been confirmed successful.",
    next: "Retries follow the standard schedule below; failed events can be replayed once the endpoint is fixed.",
  };
}

/** Map one real endpoint row + its recent deliveries into the page's display shapes. */
export function toLiveEndpoint(row: WireWebhook, deliveries: readonly WireDelivery[]): LiveEndpoint {
  const state = deriveState(row.isActive, deliveries);
  const recent: readonly WhDelivery[] = deliveries.slice(0, 4).map((d) => ({
    event: d.eventType,
    when: timeAgo(d.createdAt),
    code: deliveryCode(d),
    ms: "—",
    tone: deliveryTone(d),
  }));
  const latest = deliveries[0];
  const nonSuccess = deliveries.filter((d) => d.status !== "success").length;

  const webhook: Webhook = {
    id: row.webhookId,
    name: row.label,
    url: row.url,
    target: row.ownerType === "msp" ? "MSP-level endpoint" : "Customer-level endpoint",
    state,
    events: [],
    lastDelivery: latest ? `${timeAgo(latest.createdAt)} · ${deliveryCode(latest)}` : "No deliveries yet",
    successRate: successRateLabel(deliveries),
    volume: `${deliveries.length} in recent log`,
    created: new Date(row.createdAt).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" }),
    secretHint: `${row.secretPrefix}••••••••••••`,
    rotated: "Rotation history not tracked",
    retries: nonSuccess === 0 ? "None in recent log" : `${nonSuccess} non-success in recent log`,
    failure: buildFailure(deliveries, state),
    recent,
  };

  return {
    webhook,
    chips: row.eventTypes,
    eventCountLabel: `${row.eventTypes.length} of ${WEBHOOK_EVENTS.length} catalogue events`,
  };
}

/** Per-catalogue-event subscriber counts, computed against real endpoints'
 * real subscribed wire names — same shape as the fixture's `whEventCatalogue`. */
export function liveEventCatalogue(endpoints: readonly LiveEndpoint[]): readonly WhCatalogueRow[] {
  return WEBHOOK_EVENTS.map((e) => {
    const n = endpoints.filter((ep) => ep.chips.includes(e.wire)).length;
    return {
      wire: e.wire,
      label: e.label,
      from: e.from,
      subscribed: `${n} endpoint${n === 1 ? "" : "s"}`,
    };
  });
}

export function liveFailingEndpoints(endpoints: readonly LiveEndpoint[]): readonly LiveEndpoint[] {
  return endpoints.filter((ep) => ep.webhook.state === "failing");
}

export function liveDegradedCount(endpoints: readonly LiveEndpoint[]): number {
  return endpoints.filter((ep) => ep.webhook.state === "degraded").length;
}

export function liveHasFailing(endpoints: readonly LiveEndpoint[]): boolean {
  return liveFailingEndpoints(endpoints).length > 0;
}

function liveDroppedCount(endpoints: readonly LiveEndpoint[]): number {
  return liveFailingEndpoints(endpoints).reduce((sum, ep) => sum + (ep.webhook.failure?.count ?? 0), 0);
}

export function liveBannerTitle(endpoints: readonly LiveEndpoint[]): string {
  const failing = liveFailingEndpoints(endpoints);
  const dropped = liveDroppedCount(endpoints);
  return `${failing.length} endpoint${failing.length === 1 ? "" : "s"} failing, ${dropped} recent ${dropped === 1 ? "delivery" : "deliveries"} not confirmed successful`;
}

export function liveBannerBody(endpoints: readonly LiveEndpoint[]): string {
  const failing = liveFailingEndpoints(endpoints);
  const degraded = liveDegradedCount(endpoints);
  const names = failing.map((ep) => ep.webhook.name).join(", ");
  const base = failing.length
    ? `${names} ${failing.length === 1 ? "has" : "have"} failed on recent delivery attempts. Review the delivery log on the endpoint below.`
    : "";
  return degraded > 0
    ? `${base} A further ${degraded} endpoint${degraded === 1 ? "" : "s"} is degraded enough to be at risk.`.trim()
    : base;
}

export function liveReplayLabel(endpoints: readonly LiveEndpoint[]): string {
  return `Replay ${liveDroppedCount(endpoints)} dropped`;
}
