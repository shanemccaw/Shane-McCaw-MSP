import { describe, it, expect } from "vitest";
import {
  SUBSCRIBABLE_EVENT_TYPES,
  createWebhookSchema,
  updateWebhookSchema,
} from "./webhooks.ts";

// #1607 — one event catalog. SUBSCRIBABLE_EVENT_TYPES is the single authoritative,
// currently-dispatchable list; create/PATCH must reject any subscription outside it.
// These 11 strings are the retired Design fixture's invented catalog (WEBHOOK_EVENTS)
// — confirmed to have zero dispatch backing anywhere. They must never validate.
const INVENTED_FIXTURE_EVENTS = [
  "finding.created",
  "drift.detected",
  "drift.resolved",
  "fix.verified",
  "score.changed",
  "risk.accepted",
  "risk.review_due",
  "scan.completed",
  "phase.gate_verified",
  "billing.event",
  "ticket.updated",
];

describe("webhook eventTypes catalog gating (#1607)", () => {
  it("create accepts a real dispatchable event type from the canonical catalog", () => {
    const r = createWebhookSchema.safeParse({
      label: "ok",
      url: "https://example.com/hook",
      eventTypes: [SUBSCRIBABLE_EVENT_TYPES[1]],
    });
    expect(r.success).toBe(true);
  });

  it("create rejects every invented fixture event string", () => {
    for (const ev of INVENTED_FIXTURE_EVENTS) {
      const r = createWebhookSchema.safeParse({
        label: "x",
        url: "https://example.com/hook",
        eventTypes: [ev],
      });
      expect(r.success, `expected ${ev} to be rejected`).toBe(false);
    }
  });

  it("create defaults eventTypes to [] and accepts it", () => {
    const r = createWebhookSchema.safeParse({ label: "x", url: "https://e.com" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.eventTypes).toEqual([]);
  });

  it("PATCH rejects an unknown event type", () => {
    const r = updateWebhookSchema.safeParse({ eventTypes: ["totally.made.up"] });
    expect(r.success).toBe(false);
  });

  it("PATCH accepts a known event type", () => {
    const r = updateWebhookSchema.safeParse({ eventTypes: [SUBSCRIBABLE_EVENT_TYPES[0]] });
    expect(r.success).toBe(true);
  });

  it("signal.fired was removed from the catalog (#3547 — Shane's decision, no dispatch call site ever existed)", () => {
    // #1607 flagged signal.fired as subscribable-but-never-dispatched and left removal
    // as an open decision for Shane; #3547 decided it — remove, confirmed zero live
    // subscriptions (see build-journal/3547.md).
    expect((SUBSCRIBABLE_EVENT_TYPES as readonly string[]).includes("signal.fired")).toBe(false);
  });
});
