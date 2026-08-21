/**
 * webhooksModel.ts — the Webhooks derivations (Part 12).
 *
 * Transcribes the prototype's `webhookRows` / `whEventCatalogue` / banner logic
 * (Customer Portal Shell.dc.html 15383-15444). Named and tested here so the
 * per-event subscriber counts, the "N of 11 events" line and the failing/dropped
 * banner counts can't drift from the fixture.
 */

import {
  WEBHOOK_EVENTS,
  WEBHOOKS,
  WH_DROPPED_COUNT,
  WH_STATE_META,
  WH_TONE_COLOR,
  type Webhook,
  type WhDelivery,
  type WhEventKey,
} from "./webhooksData";

/** How many endpoints are configured — prototype `whEndpointCount` (19700). */
export const WH_ENDPOINT_COUNT = WEBHOOKS.length;

/** Endpoints in the failing state — prototype `whFailingCount` (15438). */
export function whFailingCount(): number {
  return WEBHOOKS.filter((w) => w.state === "failing").length;
}

/** Endpoints in the degraded state — prototype `whDegradedCount` (15439). */
export function whDegradedCount(): number {
  return WEBHOOKS.filter((w) => w.state === "degraded").length;
}

/** Whether the failing banner shows — prototype `whHasFailing` (19695). */
export function whHasFailing(): boolean {
  return whFailingCount() > 0;
}

/** The subscribed-event wire chips for one endpoint, in catalogue order — 15404. */
export function whEventChips(events: readonly WhEventKey[]): readonly string[] {
  return WEBHOOK_EVENTS.filter((e) => events.includes(e.key)).map((e) => e.wire);
}

/** The "N of 11 events" line — prototype `eventCount` (15408). */
export function whEventCount(events: readonly WhEventKey[]): string {
  return `${events.length} of ${WEBHOOK_EVENTS.length} events`;
}

/** A delivery-row colour — prototype 15410-15414. */
export function whDeliveryColor(d: WhDelivery): string {
  return WH_TONE_COLOR[d.tone];
}

/** An endpoint's state colour + label — prototype `whStateMeta[w.state]`. */
export function whStateMeta(w: Webhook) {
  return WH_STATE_META[w.state];
}

/** The pause/resume toggle label — prototype `pauseLabel` (15434). */
export function whPauseLabel(w: Webhook): string {
  return w.state === "paused" ? "Resume deliveries" : "Pause deliveries";
}

export interface WhCatalogueRow {
  wire: string;
  label: string;
  from: string;
  subscribed: string;
}

/** The event catalogue with per-event subscriber counts — prototype 15441-15444. */
export function whEventCatalogue(): readonly WhCatalogueRow[] {
  return WEBHOOK_EVENTS.map((e) => {
    const n = WEBHOOKS.filter((w) => w.events.includes(e.key)).length;
    return {
      wire: e.wire,
      label: e.label,
      from: e.from,
      subscribed: `${n} endpoint${n === 1 ? "" : "s"}`,
    };
  });
}

/* ── The failing-banner copy, with the fixture's counts interpolated — 2541-2545 ── */

export function whBannerTitle(): string {
  return `${whFailingCount()} endpoint is failing and ${WH_DROPPED_COUNT} events have been dropped`;
}

export function whBannerBody(): string {
  return `IT operations Slack has returned 404 on every delivery for 3 days. Retries are exhausted, so those events were dropped rather than queued indefinitely — they can be replayed for 30 days once the endpoint is fixed. A further ${whDegradedCount()} endpoint is slow enough to be at risk.`;
}

export function whReplayLabel(): string {
  return `Replay ${WH_DROPPED_COUNT} dropped`;
}
