/**
 * Phase 2b-1 — sse-channels.ts adapter coverage.
 *
 * The behavior-critical guarantee of this adapter is late-join replay for the
 * two channels that fire before a client can connect (diagnostics-run and
 * presentation phase-gen). These tests prove, against the REAL hub (no mocks):
 *
 *   1. A broadcast that fires BEFORE any client registers is still delivered to
 *      that client on register — the actual late-join proof.
 *   2. A SECOND client registering on the same key without an intervening
 *      broadcast replays the same cached state (replay is per-connect, not
 *      consumed by the first connector).
 *   3. clearDiagnosticsRunSSEState drops the cache so subsequent registrants get
 *      nothing.
 *   4. Payload envelopes are byte-identical to the original sse-broadcast.ts
 *      shapes the frontend parses.
 */
import { describe, it, expect } from "vitest";
import type { Response } from "express";
import {
  registerDiagnosticsRunSSEClient,
  broadcastDiagnosticsRunProgress,
  broadcastDiagnosticsRunComplete,
  clearDiagnosticsRunSSEState,
  registerPresentationSSEClient,
  broadcastPresentationPhaseGenProgress,
  replayPhaseGenState,
  broadcastNotification,
  registerNotificationSSEClient,
} from "./sse-channels.ts";

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
function parseFrame(frame: string): unknown {
  const m = frame.match(/^data: (.*)\n\n$/s);
  if (!m) throw new Error(`not an SSE data frame: ${JSON.stringify(frame)}`);
  return JSON.parse(m[1]);
}

describe("diagnostics-run late-join replay", () => {
  it("delivers a broadcast that fired BEFORE the client registered", () => {
    const runId = "run-late-join-1";
    // Broadcast first — zero clients connected.
    broadcastDiagnosticsRunProgress(runId, {
      checkKey: "dns",
      checkLabel: "DNS resolves",
      status: "ok",
      index: 1,
      total: 5,
      requiresCustomerScript: false,
    });

    // Now the client connects — must still receive the cached state.
    const a = fakeRes();
    registerDiagnosticsRunSSEClient(runId, a.res, () => {});
    expect(a.frames).toHaveLength(1);
    expect(parseFrame(a.frames[0])).toEqual({
      type: "diagnostics_progress",
      checkKey: "dns",
      checkLabel: "DNS resolves",
      status: "ok",
      index: 1,
      total: 5,
      requiresCustomerScript: false,
    });

    a.close();
  });

  it("replays the same cached state to a SECOND connector with no intervening broadcast", () => {
    const runId = "run-late-join-2";
    broadcastDiagnosticsRunComplete(runId, {
      status: "ok",
      checksTotal: 5,
      checksOk: 5,
      checksError: 0,
      requiresScript: 0,
      findings: 0,
    });

    const first = fakeRes();
    registerDiagnosticsRunSSEClient(runId, first.res, () => {});
    expect(first.frames).toHaveLength(1);

    // No broadcast between the two registers — the second must ALSO replay.
    const second = fakeRes();
    registerDiagnosticsRunSSEClient(runId, second.res, () => {});
    expect(second.frames).toHaveLength(1);
    expect(parseFrame(second.frames[0])).toEqual(parseFrame(first.frames[0]));

    first.close();
    second.close();
  });

  it("stops replaying once the cache is cleared", () => {
    const runId = "run-late-join-3";
    broadcastDiagnosticsRunProgress(runId, {
      checkKey: "tls",
      checkLabel: "TLS valid",
      status: "ok",
      index: 2,
      total: 5,
      requiresCustomerScript: false,
    });
    clearDiagnosticsRunSSEState(runId);

    const c = fakeRes();
    registerDiagnosticsRunSSEClient(runId, c.res, () => {});
    expect(c.frames).toHaveLength(0);
    c.close();
  });
});

describe("presentation phase-gen late-join replay", () => {
  it("replays cached phase_gen state via the standalone replayPhaseGenState (register does NOT replay)", () => {
    const presentationId = 90210;
    broadcastPresentationPhaseGenProgress(presentationId, {
      message: "Generating phase 2 of 4",
      current: 2,
      total: 4,
    });

    // register() must NOT replay for this channel (shared with scope-change subs).
    const a = fakeRes();
    registerPresentationSSEClient(presentationId, a.res, () => {});
    expect(a.frames).toHaveLength(0);

    // The explicit replay call delivers the cached state.
    replayPhaseGenState(presentationId, a.res);
    expect(a.frames).toHaveLength(1);
    expect(parseFrame(a.frames[0])).toEqual({
      type: "phase_gen_progress",
      message: "Generating phase 2 of 4",
      current: 2,
      total: 4,
    });

    // A second client replays the same cached state with no intervening broadcast.
    const b = fakeRes();
    replayPhaseGenState(presentationId, b.res);
    expect(b.frames).toHaveLength(1);
    expect(parseFrame(b.frames[0])).toEqual(parseFrame(a.frames[0]));

    a.close();
    b.close();
  });
});

describe("payload envelope shape preservation", () => {
  it("wraps notifications in the exact { type, notification } envelope", () => {
    const key = 4242;
    const c = fakeRes();
    registerNotificationSSEClient(key, c.res, () => {});
    broadcastNotification(key, { id: 7, title: "hi" });
    expect(c.frames).toHaveLength(1);
    expect(parseFrame(c.frames[0])).toEqual({
      type: "notification",
      notification: { id: 7, title: "hi" },
    });
    c.close();
  });
});
