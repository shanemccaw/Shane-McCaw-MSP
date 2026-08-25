/**
 * webhooksWire.test.ts — pins the derivations that turn real
 * `outbound_webhooks` / `outbound_webhook_deliveries` rows into the page's
 * health state, banner and catalogue counts.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  deriveState,
  liveBannerTitle,
  liveDegradedCount,
  liveEventCatalogue,
  liveHasFailing,
  liveReplayLabel,
  toLiveEndpoint,
  type WireDelivery,
  type WireWebhook,
} from "./webhooksWire";

function webhookRow(over: Partial<WireWebhook> = {}): WireWebhook {
  return {
    webhookId: "wh_1",
    label: "Sentinel ingestion",
    url: "https://ingest.example.com/events",
    secretPrefix: "whsec_abcd1234",
    eventTypes: ["finding.created", "drift.detected"],
    isActive: true,
    ownerType: "customer",
    mspId: null,
    customerId: 1,
    createdAt: "2026-01-11T00:00:00Z",
    updatedAt: "2026-01-11T00:00:00Z",
    ...over,
  };
}

function delivery(over: Partial<WireDelivery> = {}): WireDelivery {
  return {
    deliveryId: "d1",
    webhookId: "wh_1",
    eventId: "e1",
    eventType: "finding.created",
    attempt: 1,
    status: "success",
    statusCode: 200,
    responseSnippet: null,
    nextRetryAt: null,
    deliveredAt: "2026-08-19T09:00:00Z",
    createdAt: "2026-08-19T09:00:00Z",
    ...over,
  };
}

describe("deriveState()", () => {
  it("is paused when the row is inactive, regardless of delivery history", () => {
    assert.equal(deriveState(false, [delivery({ status: "success" })]), "paused");
    assert.equal(deriveState(false, []), "paused");
  });

  it("is healthy with no delivery history yet", () => {
    assert.equal(deriveState(true, []), "healthy");
  });

  it("is failing when most recent deliveries failed", () => {
    const deliveries = [delivery({ status: "failed" }), delivery({ status: "failed" }), delivery({ status: "success" })];
    assert.equal(deriveState(true, deliveries), "failing");
  });

  it("is degraded on a mixed but mostly-successful log", () => {
    const deliveries = Array.from({ length: 20 }, (_, i) => delivery({ status: i === 0 ? "failed" : "success" }));
    assert.equal(deriveState(true, deliveries), "degraded");
  });
});

describe("toLiveEndpoint()", () => {
  it("carries identity and real subscribed wires through", () => {
    const { webhook, chips, eventCountLabel } = toLiveEndpoint(webhookRow(), []);
    assert.equal(webhook.id, "wh_1");
    assert.equal(webhook.name, "Sentinel ingestion");
    assert.equal(webhook.secretHint, "whsec_abcd1234••••••••••••");
    assert.deepEqual(chips, ["finding.created", "drift.detected"]);
    assert.equal(eventCountLabel, "2 of 11 catalogue events");
  });

  it("reports no deliveries yet honestly rather than a fake rate", () => {
    const { webhook } = toLiveEndpoint(webhookRow(), []);
    assert.equal(webhook.successRate, "—");
    assert.equal(webhook.lastDelivery, "No deliveries yet");
    assert.equal(webhook.failure, undefined);
  });

  it("builds a failure block from real failed deliveries, none of the fixture's invented copy", () => {
    const deliveries = [
      delivery({ status: "failed", statusCode: 404, responseSnippet: "channel archived", createdAt: "2026-08-19T09:00:00Z" }),
      delivery({ status: "failed", statusCode: 404, createdAt: "2026-08-16T09:00:00Z" }),
    ];
    const { webhook } = toLiveEndpoint(webhookRow(), deliveries);
    assert.equal(webhook.state, "failing");
    assert.equal(webhook.failure?.count, 2);
    assert.equal(webhook.failure?.code, "404");
    assert.match(webhook.failure?.reason ?? "", /channel archived/);
  });
});

describe("live catalogue + banner", () => {
  const failingRow = webhookRow({ webhookId: "wh_fail", label: "Slack", eventTypes: ["finding.created"] });
  const healthyRow = webhookRow({ webhookId: "wh_ok", label: "Sentinel", eventTypes: ["finding.created", "drift.detected"] });
  const failing = toLiveEndpoint(failingRow, [
    delivery({ webhookId: "wh_fail", status: "failed", statusCode: 404 }),
    delivery({ webhookId: "wh_fail", status: "failed", statusCode: 404 }),
    delivery({ webhookId: "wh_fail", status: "failed", statusCode: 404 }),
  ]);
  const healthy = toLiveEndpoint(healthyRow, [delivery({ webhookId: "wh_ok", status: "success" })]);
  const endpoints = [failing, healthy];

  it("counts real subscribers per catalogue event", () => {
    const cat = liveEventCatalogue(endpoints);
    const findingRow = cat.find((r) => r.wire === "finding.created");
    const driftRow = cat.find((r) => r.wire === "drift.detected");
    assert.equal(findingRow?.subscribed, "2 endpoints");
    assert.equal(driftRow?.subscribed, "1 endpoint");
  });

  it("flags the real failing endpoint and names it in the banner", () => {
    assert.equal(liveHasFailing(endpoints), true);
    assert.equal(liveDegradedCount(endpoints), 0);
    assert.match(liveBannerTitle(endpoints), /^1 endpoint failing, 3 recent deliveries not confirmed successful$/);
    assert.match(liveReplayLabel(endpoints), /^Replay 3 dropped$/);
  });

  it("reports zero failing cleanly when every endpoint is healthy", () => {
    assert.equal(liveHasFailing([healthy]), false);
    assert.equal(liveBannerTitle([healthy]), "0 endpoints failing, 0 recent deliveries not confirmed successful");
  });
});
