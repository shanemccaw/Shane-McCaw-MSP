/**
 * Phase 3a — firehose + log-bridge coverage (lib/sse-hub.ts, sse-hub-log-bridge.ts).
 *
 * Encodes the phase's manual acceptance criteria as automated checks against the
 * REAL hub (no mocks):
 *   - ?channel=* (firehose) receives EVERY broadcast, on every channel/scope,
 *     INCLUDING channels with no direct subscriber — the whole point of the tap.
 *   - ?channel=engine.sla receives ONLY engine.sla activity, nothing else.
 *   - Each firehose frame is tagged with its originating channel + scope; the
 *     channel-scoped frame is NOT (tagging happens only on the firehose path).
 *   - A replay broadcast reaches the firehose exactly once (no double-emit, since
 *     broadcastToHubWithReplay delegates to broadcastToHub).
 *   - bridgeLogEntryToHub maps a queued log entry to the { type: "log", … }
 *     envelope on its own channel + mspId scope.
 */
import { describe, it, expect } from "vitest";
import type { Response } from "express";
import {
  registerFirehoseClient,
  registerHubClient,
  broadcastToHub,
  broadcastToHubWithReplay,
} from "./sse-hub.ts";
import { bridgeLogEntryToHub } from "./sse-hub-log-bridge.ts";

// Minimal Response stub that captures written SSE frames and can fire "close".
function fakeRes(): { res: Response; frames: string[]; close: () => void } {
  const frames: string[] = [];
  let closeHandler: (() => void) | undefined;
  const res = {
    write: (line: string) => { frames.push(line); return true; },
    on: (event: string, cb: () => void) => { if (event === "close") closeHandler = cb; },
  } as unknown as Response;
  return { res, frames, close: () => closeHandler?.() };
}

/** Parse the single JSON object out of a `data: {...}\n\n` SSE frame. */
function parseFrame(frame: string): Record<string, unknown> {
  const m = frame.match(/^data: (.*)\n\n$/s);
  if (!m) throw new Error(`not an SSE data frame: ${JSON.stringify(frame)}`);
  return JSON.parse(m[1]) as Record<string, unknown>;
}

describe("firehose subscriber (?channel=*)", () => {
  it("receives a broadcast on a channel with NO direct subscriber, tagged with channel + scope", () => {
    const fh = fakeRes();
    registerFirehoseClient(fh.res, () => {});
    // Nobody is subscribed to engine.sla:42 — the firehose must still see it.
    broadcastToHub("engine.sla", 42, { type: "log", level: "warn", message: "breach" });
    expect(fh.frames).toHaveLength(1);
    expect(parseFrame(fh.frames[0])).toEqual({
      channel: "engine.sla", scope: 42, type: "log", level: "warn", message: "breach",
    });
    fh.close();
  });

  it("sees events across many different channels (the firehose sees everything)", () => {
    const fh = fakeRes();
    registerFirehoseClient(fh.res, () => {});
    broadcastToHub("engine.sla", null, { a: 1 });
    broadcastToHub("engine.scope-creep", 7, { b: 2 });
    broadcastToHub("system.core", null, { c: 3 });
    expect(fh.frames).toHaveLength(3);
    expect(fh.frames.map((f) => parseFrame(f).channel)).toEqual([
      "engine.sla", "engine.scope-creep", "system.core",
    ]);
    fh.close();
  });

  it("reaches the firehose exactly once for a replay broadcast (no double-emit)", () => {
    const fh = fakeRes();
    registerFirehoseClient(fh.res, () => {});
    broadcastToHubWithReplay("engine.monitor", "run-xyz", { type: "diagnostics_progress", index: 1 });
    expect(fh.frames).toHaveLength(1);
    expect(parseFrame(fh.frames[0])).toEqual({
      channel: "engine.monitor", scope: "run-xyz", type: "diagnostics_progress", index: 1,
    });
    fh.close();
  });

  it("stops receiving once it closes", () => {
    const fh = fakeRes();
    registerFirehoseClient(fh.res, () => {});
    fh.close();
    broadcastToHub("engine.sla", 1, { x: 1 });
    expect(fh.frames).toHaveLength(0);
  });
});

describe("channel-scoped client isolation (?channel=engine.sla)", () => {
  it("delivers ONLY the subscribed channel's events, never another channel's", () => {
    const sla = fakeRes();
    registerHubClient("engine.sla", 99, sla.res, () => {});
    // Same scope number, different channel — must NOT leak across.
    broadcastToHub("engine.scope-creep", 99, { type: "log", message: "creep" });
    expect(sla.frames).toHaveLength(0);
    // Matching channel + scope — delivered.
    broadcastToHub("engine.sla", 99, { type: "log", message: "sla" });
    expect(sla.frames).toHaveLength(1);
    expect(parseFrame(sla.frames[0])).toEqual({ type: "log", message: "sla" });
    sla.close();
  });

  it("does NOT firehose-tag a channel-scoped frame (tagging is firehose-only)", () => {
    const sla = fakeRes();
    registerHubClient("engine.sla", 5, sla.res, () => {});
    broadcastToHub("engine.sla", 5, { type: "log", message: "hi" });
    const parsed = parseFrame(sla.frames[0]);
    expect(parsed).not.toHaveProperty("channel");
    expect(parsed).toEqual({ type: "log", message: "hi" });
    sla.close();
  });
});

describe("bridgeLogEntryToHub", () => {
  it("maps a log entry to the { type: 'log', … } envelope on its channel + mspId scope", () => {
    const fh = fakeRes();
    registerFirehoseClient(fh.res, () => {});
    const sla = fakeRes();
    registerHubClient("engine.sla", 42, sla.res, () => {});

    bridgeLogEntryToHub({
      channel: "engine.sla", level: "warn", message: "SLA breach",
      meta: { ticketId: 7 }, correlationId: "trace-1", mspId: 42,
    });

    // The engine.sla:42 subscriber gets the untagged log envelope.
    expect(sla.frames).toHaveLength(1);
    expect(parseFrame(sla.frames[0])).toEqual({
      type: "log", level: "warn", message: "SLA breach", correlationId: "trace-1", meta: { ticketId: 7 },
    });
    // The firehose gets the same event, tagged with channel + scope.
    expect(fh.frames).toHaveLength(1);
    expect(parseFrame(fh.frames[0])).toEqual({
      channel: "engine.sla", scope: 42, type: "log", level: "warn", message: "SLA breach",
      correlationId: "trace-1", meta: { ticketId: 7 },
    });

    fh.close();
    sla.close();
  });
});
