/**
 * webhooksModel.test.ts — pins the endpoint counts, per-event subscriber counts,
 * the "N of 11 events" line and the failing-banner copy against the fixture.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { WEBHOOK_EVENTS, WEBHOOKS } from "./webhooksData";
import {
  WH_ENDPOINT_COUNT,
  whBannerBody,
  whBannerTitle,
  whDegradedCount,
  whEventCatalogue,
  whEventChips,
  whEventCount,
  whFailingCount,
  whHasFailing,
  whPauseLabel,
  whReplayLabel,
} from "./webhooksModel";

describe("fixture", () => {
  it("has 4 endpoints and 11 catalogue events", () => {
    assert.equal(WH_ENDPOINT_COUNT, 4);
    assert.equal(WEBHOOK_EVENTS.length, 11);
  });
});

describe("state counts", () => {
  it("counts one failing and one degraded endpoint", () => {
    assert.equal(whFailingCount(), 1);
    assert.equal(whDegradedCount(), 1);
    assert.equal(whHasFailing(), true);
  });

  it("labels the paused endpoint's toggle Resume and the rest Pause", () => {
    assert.equal(whPauseLabel(WEBHOOKS.find((w) => w.state === "paused")!), "Resume deliveries");
    assert.equal(whPauseLabel(WEBHOOKS.find((w) => w.state === "healthy")!), "Pause deliveries");
  });
});

describe("per-endpoint chips and count", () => {
  it("lists the Sentinel endpoint's nine subscribed wires in catalogue order", () => {
    const sentinel = WEBHOOKS[0];
    assert.equal(whEventCount(sentinel.events), "9 of 11 events");
    assert.deepEqual(whEventChips(sentinel.events), [
      "finding.created",
      "drift.detected",
      "drift.resolved",
      "fix.verified",
      "score.changed",
      "risk.accepted",
      "risk.review_due",
      "scan.completed",
      "phase.gate_verified",
    ]);
  });
});

describe("event catalogue", () => {
  it("counts subscribers per event, singular vs plural", () => {
    const cat = whEventCatalogue();
    assert.deepEqual(cat.map((r) => r.subscribed), [
      "3 endpoints",
      "2 endpoints",
      "1 endpoint",
      "1 endpoint",
      "2 endpoints",
      "1 endpoint",
      "2 endpoints",
      "1 endpoint",
      "3 endpoints",
      "1 endpoint",
      "1 endpoint",
    ]);
  });
});

describe("failing banner", () => {
  it("interpolates the failing, dropped and degraded counts", () => {
    assert.equal(whBannerTitle(), "1 endpoint is failing and 14 events have been dropped");
    assert.ok(whBannerBody().includes("A further 1 endpoint is slow enough to be at risk."));
    assert.equal(whReplayLabel(), "Replay 14 dropped");
  });
});
