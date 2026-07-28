// @vitest-environment jsdom
/**
 * Tests: AI Cost Governance Phase 3 (#51) — useAiCostSegments, the hook behind
 * the StatusBar's "Today"/"Month" spend segments.
 *
 * The contract worth protecting here is seed-then-delta:
 *   - totals are SEEDED from GET /admin/ai-billing/summary on mount;
 *   - each ai-cost SSE frame is a per-call DELTA that gets ADDED on top;
 *   - a frame is never applied twice, including across a stream reconnect
 *     (the hub caches only the last frame, so a re-applied one is a real
 *     double-count risk, not a theoretical one);
 *   - a seed that never lands leaves the total null so the segment can hide
 *     rather than render a $0.00 nobody verified.
 *
 * useLiveStream is mocked as a controllable frame source: the real hook owns
 * EventSource reconnect/backoff, which is its own tested concern and not what
 * this file is about.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { LiveStreamFrame } from "@/hooks/useLiveStream";

let summaryResponses: Record<string, unknown> = {
  today: { totalCostCents: 1234 },
  month: { totalCostCents: 56789 },
};
let summaryOk = true;
let recentResponse: unknown = { events: [] };

const fetchWithAuth = vi.fn(async (url: string) => {
  if (url.includes("/ai-billing/summary")) {
    const range = url.includes("range=month") ? "month" : "today";
    return {
      ok: summaryOk,
      json: async () => summaryResponses[range],
    } as Response;
  }
  if (url.includes("/ai-billing/recent")) {
    return { ok: true, json: async () => recentResponse } as Response;
  }
  return { ok: false, json: async () => ({}) } as Response;
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ fetchWithAuth, accessToken: "test-token" }),
}));

/** Frames handed to the hook, newest-first — the real hook's ordering. */
let liveFrames: LiveStreamFrame[] = [];
const useLiveStreamSpy = vi.fn();
vi.mock("@/hooks/useLiveStream", () => ({
  useLiveStream: (channel: string | null) => {
    useLiveStreamSpy(channel);
    return { frames: liveFrames, connected: true };
  },
}));

import { useAiCostSegments } from "./useAiCostSegments";

let frameSeq = 0;
function frame(costCents: number): LiveStreamFrame {
  frameSeq += 1;
  return {
    id: `f${frameSeq}`,
    receivedAt: Date.now(),
    data: { type: "ai-cost", costCents },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  frameSeq = 0;
  liveFrames = [];
  summaryOk = true;
  summaryResponses = { today: { totalCostCents: 1234 }, month: { totalCostCents: 56789 } };
  recentResponse = { events: [] };
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Mount seed ────────────────────────────────────────────────────────────────

describe("useAiCostSegments — mount seed", () => {
  it("seeds both totals from the summary endpoint", async () => {
    const { result } = renderHook(() => useAiCostSegments());

    await waitFor(() => {
      expect(result.current.todayCents).toBe(1234);
      expect(result.current.monthCents).toBe(56789);
    });
  });

  it("sends the viewer's own UTC offset so Today rolls over at their midnight", async () => {
    renderHook(() => useAiCostSegments());

    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledTimes(2));
    const urls = fetchWithAuth.mock.calls.map((c) => c[0] as string);
    const expectedTz = new Date().getTimezoneOffset();
    expect(urls.some((u) => u.includes("range=today") && u.includes(`tzOffsetMinutes=${expectedTz}`))).toBe(true);
    expect(urls.some((u) => u.includes("range=month") && u.includes(`tzOffsetMinutes=${expectedTz}`))).toBe(true);
  });

  it("leaves a total null when its seed fetch fails — never a fabricated $0.00", async () => {
    summaryOk = false;
    const { result } = renderHook(() => useAiCostSegments());

    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledTimes(2));
    expect(result.current.todayCents).toBeNull();
    expect(result.current.monthCents).toBeNull();
  });

  it("subscribes to the ai-cost channel", () => {
    renderHook(() => useAiCostSegments());
    expect(useLiveStreamSpy).toHaveBeenCalledWith("ai-cost");
  });
});

// ── SSE deltas ────────────────────────────────────────────────────────────────

describe("useAiCostSegments — SSE delta application", () => {
  it("adds a frame's cost to BOTH totals (a call now is inside both windows)", async () => {
    const { result, rerender } = renderHook(() => useAiCostSegments());
    await waitFor(() => expect(result.current.todayCents).toBe(1234));

    act(() => { liveFrames = [frame(50)]; });
    rerender();

    expect(result.current.todayCents).toBe(1284);
    expect(result.current.monthCents).toBe(56839);
    expect(result.current.deltaVisible).toBe(true);
    expect(result.current.deltaCents).toBe(50);
  });

  it("does NOT re-apply a frame it has already counted on a later render", async () => {
    const { result, rerender } = renderHook(() => useAiCostSegments());
    await waitFor(() => expect(result.current.todayCents).toBe(1234));

    const f = frame(50);
    act(() => { liveFrames = [f]; });
    rerender();
    expect(result.current.todayCents).toBe(1284);

    // Same buffer, another render — the total must not move again.
    act(() => { rerender(); });
    expect(result.current.todayCents).toBe(1284);
  });

  it("applies only the NEW frames when the buffer grows", async () => {
    const { result, rerender } = renderHook(() => useAiCostSegments());
    await waitFor(() => expect(result.current.todayCents).toBe(1234));

    const first = frame(50);
    act(() => { liveFrames = [first]; });
    rerender();
    expect(result.current.todayCents).toBe(1284);

    // Newest-first: the new frame is prepended ahead of the one already counted.
    const second = frame(25);
    act(() => { liveFrames = [second, first]; });
    rerender();
    expect(result.current.todayCents).toBe(1309);
  });

  it("applies frames that arrive after a reconnect clears the buffer", async () => {
    const { result, rerender } = renderHook(() => useAiCostSegments());
    await waitFor(() => expect(result.current.todayCents).toBe(1234));

    act(() => { liveFrames = [frame(50)]; });
    rerender();
    expect(result.current.todayCents).toBe(1284);

    // useLiveStream empties its buffer on reconnect; the marker frame is gone.
    act(() => { liveFrames = []; });
    rerender();
    act(() => { liveFrames = [frame(10)]; });
    rerender();

    expect(result.current.todayCents).toBe(1294);
  });

  it("leaves a null (unseeded) total null rather than starting it from the delta", async () => {
    summaryOk = false;
    const { result, rerender } = renderHook(() => useAiCostSegments());
    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledTimes(2));

    act(() => { liveFrames = [frame(50)]; });
    rerender();

    // A delta added to an unknown base would invent a total. Better to stay
    // hidden until a real seed lands.
    expect(result.current.todayCents).toBeNull();
    expect(result.current.monthCents).toBeNull();
  });

  it("ignores a malformed frame carrying no numeric costCents", async () => {
    const { result, rerender } = renderHook(() => useAiCostSegments());
    await waitFor(() => expect(result.current.todayCents).toBe(1234));

    act(() => {
      liveFrames = [{ id: "bad", receivedAt: Date.now(), data: { costCents: "lots" } }];
    });
    rerender();

    expect(result.current.todayCents).toBe(1234);
    expect(result.current.deltaVisible).toBe(false);
  });
});

// ── Delta chip lifecycle ──────────────────────────────────────────────────────

describe("useAiCostSegments — delta chip", () => {
  it("accumulates rapid successive calls into ONE chip instead of stacking", async () => {
    const { result, rerender } = renderHook(() => useAiCostSegments());
    await waitFor(() => expect(result.current.todayCents).toBe(1234));

    const f1 = frame(50);
    act(() => { liveFrames = [f1]; });
    rerender();
    expect(result.current.deltaCents).toBe(50);

    const f2 = frame(25);
    act(() => { liveFrames = [f2, f1]; });
    rerender();

    // One chip showing the combined 75 — not two chips, and not a reset to 25.
    expect(result.current.deltaCents).toBe(75);
    expect(result.current.deltaVisible).toBe(true);
  });

  it("fades the chip out and clears it, leaving the totals intact", async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(() => useAiCostSegments());
    await vi.waitFor(() => expect(result.current.todayCents).toBe(1234));

    act(() => { liveFrames = [frame(50)]; });
    rerender();
    expect(result.current.deltaVisible).toBe(true);
    expect(result.current.deltaExiting).toBe(false);

    // Hold window elapses → exit animation starts, chip still on screen.
    act(() => { vi.advanceTimersByTime(2000); });
    expect(result.current.deltaExiting).toBe(true);
    expect(result.current.deltaVisible).toBe(true);

    // Fade completes → chip gone, delta reset, totals untouched.
    act(() => { vi.advanceTimersByTime(300); });
    expect(result.current.deltaVisible).toBe(false);
    expect(result.current.deltaExiting).toBe(false);
    expect(result.current.deltaCents).toBe(0);
    expect(result.current.todayCents).toBe(1284);
  });

  it("restarts the fade timer on a new frame rather than leaking the old one", async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(() => useAiCostSegments());
    await vi.waitFor(() => expect(result.current.todayCents).toBe(1234));

    const f1 = frame(50);
    act(() => { liveFrames = [f1]; });
    rerender();

    act(() => { vi.advanceTimersByTime(1500); });
    const f2 = frame(25);
    act(() => { liveFrames = [f2, f1]; });
    rerender();

    // The first frame's 2s timer would have fired at 2000ms; it must have been
    // cleared, so the chip is still fully visible at 3000ms total.
    act(() => { vi.advanceTimersByTime(1000); });
    expect(result.current.deltaVisible).toBe(true);
    expect(result.current.deltaExiting).toBe(false);
    expect(result.current.deltaCents).toBe(75);
  });
});

// ── Recent transactions ───────────────────────────────────────────────────────

describe("useAiCostSegments — recent transactions", () => {
  it("does not fetch the last-10 list until loadRecent is called", async () => {
    const { result } = renderHook(() => useAiCostSegments());
    await waitFor(() => expect(result.current.todayCents).toBe(1234));

    expect(fetchWithAuth.mock.calls.some((c) => (c[0] as string).includes("/recent"))).toBe(false);

    act(() => { result.current.loadRecent(); });
    await waitFor(() => {
      expect(fetchWithAuth.mock.calls.some((c) => (c[0] as string).includes("/recent?limit=10"))).toBe(true);
    });
  });

  it("maps the real response fields the popover renders", async () => {
    recentResponse = {
      events: [
        {
          eventId: "e1",
          occurredAt: "2026-07-28T12:00:00.000Z",
          costCents: 134,
          mspName: "Acme MSP",
          customerName: "Contoso",
          generatedArtifactName: "SOW - Contoso",
          generatedArtifactType: "sow",
          feature: "workflow:generate_document",
          nodeType: "generate_document",
        },
      ],
    };
    const { result } = renderHook(() => useAiCostSegments());
    await waitFor(() => expect(result.current.todayCents).toBe(1234));

    act(() => { result.current.loadRecent(); });
    await waitFor(() => expect(result.current.recent).toHaveLength(1));

    expect(result.current.recent[0]).toEqual({
      eventId: "e1",
      occurredAt: "2026-07-28T12:00:00.000Z",
      costCents: 134,
      mspName: "Acme MSP",
      customerName: "Contoso",
      generatedArtifactName: "SOW - Contoso",
      generatedArtifactType: "sow",
      feature: "workflow:generate_document",
      nodeType: "generate_document",
    });
  });

  it("coerces missing fields to null rather than leaving them undefined", async () => {
    recentResponse = { events: [{ costCents: 5 }] };
    const { result } = renderHook(() => useAiCostSegments());
    await waitFor(() => expect(result.current.todayCents).toBe(1234));

    act(() => { result.current.loadRecent(); });
    await waitFor(() => expect(result.current.recent).toHaveLength(1));

    expect(result.current.recent[0]).toMatchObject({
      eventId: null,
      mspName: null,
      customerName: null,
      generatedArtifactName: null,
      costCents: 5,
    });
  });
});
