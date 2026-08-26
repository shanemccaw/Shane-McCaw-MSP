import { describe, it, expect } from "vitest";
import { computeDailyHistory, type IncidentWindow } from "./public-status";

// Fixed reference "now" (mid-day UTC) so the 90 UTC-day buckets are deterministic.
const NOW = new Date("2026-08-26T13:37:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

// Helper: a Date at the given whole-day offset back from NOW's UTC midnight, plus optional hours.
function dayAt(offsetDaysBack: number, hourUtc = 12): Date {
  const startOfToday = Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate());
  return new Date(startOfToday - offsetDaysBack * DAY_MS + hourUtc * 60 * 60 * 1000);
}

function incident(partial: Partial<IncidentWindow> & Pick<IncidentWindow, "severity" | "startedAt" | "endedAt">): IncidentWindow {
  return { title: "T", description: "D", ...partial };
}

describe("computeDailyHistory", () => {
  it("returns exactly 90 buckets, oldest first, index 89 = today (UTC)", () => {
    const out = computeDailyHistory([], NOW);
    expect(out).toHaveLength(90);
    expect(out[89].date).toBe("2026-08-26");
    expect(out[0].date).toBe(new Date(Date.UTC(2026, 7, 26) - 89 * DAY_MS).toISOString().slice(0, 10));
  });

  it("with no incidents every day is operational with null title/description", () => {
    const out = computeDailyHistory([], NOW);
    expect(out.every((d) => d.status === "operational")).toBe(true);
    expect(out.every((d) => d.title === null && d.description === null)).toBe(true);
  });

  it("a minor incident marks its overlapped day degraded and carries its real text", () => {
    const out = computeDailyHistory(
      [incident({ severity: "minor", title: "Email delayed", description: "Reset codes late.", startedAt: dayAt(10, 8), endedAt: dayAt(10, 10) })],
      NOW,
    );
    const day = out[89 - 10];
    expect(day.status).toBe("degraded");
    expect(day.title).toBe("Email delayed");
    expect(day.description).toBe("Reset codes late.");
    // Neighbouring days stay clean.
    expect(out[89 - 9].status).toBe("operational");
    expect(out[89 - 11].status).toBe("operational");
  });

  it("major and critical incidents both render as outage (red), outranking degraded on the same day", () => {
    const out = computeDailyHistory(
      [
        incident({ severity: "minor", title: "minor one", description: "d", startedAt: dayAt(5, 2), endedAt: dayAt(5, 4) }),
        incident({ severity: "major", title: "big outage", description: "cluster read-only", startedAt: dayAt(5, 6), endedAt: dayAt(5, 9) }),
      ],
      NOW,
    );
    const day = out[89 - 5];
    expect(day.status).toBe("outage");
    // worst-wins: the outage incident's text is surfaced, not the minor's.
    expect(day.title).toBe("big outage");
  });

  it("a multi-day incident colours every UTC day it spans", () => {
    const out = computeDailyHistory(
      [incident({ severity: "major", title: "span", description: "d", startedAt: dayAt(12, 20), endedAt: dayAt(10, 4) })],
      NOW,
    );
    expect(out[89 - 12].status).toBe("outage");
    expect(out[89 - 11].status).toBe("outage");
    expect(out[89 - 10].status).toBe("outage");
    expect(out[89 - 9].status).toBe("operational");
  });

  it("an ongoing incident (endedAt = now) covers today", () => {
    const out = computeDailyHistory(
      [incident({ severity: "critical", title: "live", description: "d", startedAt: dayAt(0, 1), endedAt: NOW })],
      NOW,
    );
    expect(out[89].status).toBe("outage");
    expect(out[89].title).toBe("live");
  });

  it("ignores incidents entirely outside the 90-day window", () => {
    const out = computeDailyHistory(
      [incident({ severity: "major", title: "old", description: "d", startedAt: dayAt(120, 2), endedAt: dayAt(120, 4) })],
      NOW,
    );
    expect(out.every((d) => d.status === "operational")).toBe(true);
  });
});
