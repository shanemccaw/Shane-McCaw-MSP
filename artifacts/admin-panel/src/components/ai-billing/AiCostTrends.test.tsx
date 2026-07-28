// @vitest-environment jsdom
/**
 * Tests: AI Cost Governance Phase 4 (#52) — the Trends & anomalies section.
 *
 * What is worth protecting here is the HONESTY of the surface, not the pixels:
 *   - the anomaly rule printed on the page is the server's own rule object, so
 *     the stated threshold can never drift from the one the data was judged by;
 *   - unattributed spend is rendered as its own line, outside the ranking, on
 *     every dimension — the acceptance criterion this phase was written around;
 *   - a capped list says how much it folded away;
 *   - a clipped scan says so instead of drawing a confident chart over a
 *     partially-read window;
 *   - the filters the page holds are carried into the analytics query, so the
 *     charts and the ledger below them describe the same slice.
 *
 * The chart itself is not asserted: recharts' ResponsiveContainer measures zero
 * in jsdom and renders nothing, so any assertion about paths here would be
 * testing the test environment.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import AiCostTrends, { type AnalyticsResponse } from "./AiCostTrends";
import {
  formatBucketLabel,
  formatCents,
  formatCentsCompact,
  formatRatio,
} from "./format";

// jsdom ships no ResizeObserver, and recharts' ResponsiveContainer subscribes to
// one on mount. A no-op stub is enough: the container then measures 0x0 and
// renders no chart, which is precisely what this file assumes.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (!("ResizeObserver" in globalThis)) {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}

function makeResponse(over: Partial<AnalyticsResponse> = {}): AnalyticsResponse {
  return {
    bucket: "day",
    bucketCount: 30,
    periodStart: "2026-06-29T00:00:00.000Z",
    periodEnd: "2026-07-29T00:00:00.000Z",
    totalCostCents: 1500,
    eventCount: 3,
    coverage: { rowsScanned: 3, rowLimit: 50_000, truncated: false, observedFrom: null },
    series: [
      { bucketKey: "2026-07-26", bucketStart: "2026-07-26T00:00:00.000Z", costCents: 300, eventCount: 1, partial: false },
      { bucketKey: "2026-07-27", bucketStart: "2026-07-27T00:00:00.000Z", costCents: 1200, eventCount: 1, partial: false },
      { bucketKey: "2026-07-28", bucketStart: "2026-07-28T00:00:00.000Z", costCents: 0, eventCount: 0, partial: true },
    ],
    byCustomer: {
      dimension: "customer",
      slices: [{ key: "1", id: 1, label: "Acme", costCents: 900, eventCount: 2 }],
      other: { costCents: 0, eventCount: 0, sliceCount: 0 },
      unattributed: { costCents: 600, eventCount: 1, label: "Unattributed (no customer)" },
      totalCostCents: 1500,
      eventCount: 3,
    },
    byMsp: {
      dimension: "msp",
      slices: [{ key: "5", id: 5, label: "Northwind MSP", costCents: 1500, eventCount: 3 }],
      other: { costCents: 0, eventCount: 0, sliceCount: 0 },
      unattributed: { costCents: 0, eventCount: 0, label: "Unattributed (platform / no MSP)" },
      totalCostCents: 1500,
      eventCount: 3,
    },
    byArtifactType: {
      dimension: "artifactType",
      slices: [{ key: "sow", id: null, label: "sow", costCents: 1000, eventCount: 2 }],
      other: { costCents: 250, eventCount: 3, sliceCount: 4 },
      unattributed: { costCents: 250, eventCount: 1, label: "Unattributed (no artifact produced)" },
      totalCostCents: 1500,
      eventCount: 3,
    },
    anomalies: {
      rule: {
        direction: "high-is-bad",
        factor: 3,
        description:
          "Flags a day whose spend is at least 3x the median of the previous 7 fully-observed days (minimum 3) and is at least $1.00. Direction: high is bad — a fall in spend never flags.",
      },
      anomalies: [
        {
          bucketKey: "2026-07-27",
          bucketStart: "2026-07-27T00:00:00.000Z",
          costCents: 1200,
          baselineCents: 300,
          ratioBps: 40_000,
          severity: "elevated",
          reason: "above-baseline",
        },
      ],
      evaluated: 2,
      skipped: { partialBucket: 1, insufficientBaseline: 0 },
    },
    ...over,
  };
}

const EMPTY_SCOPE = {
  mspId: "",
  customerId: "",
  costOwner: "",
  feature: "",
  generatedArtifactType: "",
};

let response: AnalyticsResponse | null = makeResponse();
let ok = true;
const fetchWithAuth = vi.fn(
  async (_url: string) => ({ ok, json: async () => response }) as unknown as Response,
);
const onFilter = vi.fn();

function renderTrends(scope = EMPTY_SCOPE) {
  return render(
    <AiCostTrends
      fetchWithAuth={fetchWithAuth}
      tzOffsetMinutes={240}
      scope={scope}
      onFilter={onFilter}
    />,
  );
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  response = makeResponse();
  ok = true;
});

// ── The rule ──────────────────────────────────────────────────────────────────

describe("AiCostTrends — the anomaly rule is stated, not implied", () => {
  it("prints the server's own rule text verbatim", async () => {
    renderTrends();

    await waitFor(() => {
      expect(screen.getByText(/Flags a day whose spend is at least 3x/)).toBeTruthy();
    });
    // Including the direction, which is the property this repo has got wrong before.
    expect(screen.getByText(/high is bad/)).toBeTruthy();
  });

  it("says how many periods it actually judged and why it skipped the rest", async () => {
    renderTrends();
    await waitFor(() => {
      expect(screen.getByText(/2 of 3 periods judged/)).toBeTruthy();
    });
    expect(screen.getByText(/1 not fully observed/)).toBeTruthy();
  });

  it("lists each flagged period with its baseline and its multiple", async () => {
    renderTrends();

    await waitFor(() => expect(screen.getByText("elevated")).toBeTruthy());
    expect(screen.getByText(/vs \$3\.00 baseline · 4\.0x/)).toBeTruthy();
    expect(screen.getByText("1 flagged")).toBeTruthy();
  });

  it("says 'new spend' rather than inventing a multiple against a zero baseline", async () => {
    const base = makeResponse();
    response = makeResponse({
      anomalies: {
        ...base.anomalies,
        anomalies: [
          {
            bucketKey: "2026-07-27",
            bucketStart: "2026-07-27T00:00:00.000Z",
            costCents: 1200,
            baselineCents: 0,
            ratioBps: null,
            severity: "elevated",
            reason: "new-spend",
          },
        ],
      },
    });
    renderTrends();

    await waitFor(() => {
      expect(screen.getByText(/no spend in the preceding baseline/)).toBeTruthy();
    });
    expect(screen.queryByText(/NaNx|Infinityx/)).toBeNull();
  });
});

// ── Unattributed spend ────────────────────────────────────────────────────────

describe("AiCostTrends — unattributed spend", () => {
  it("renders it as its own line on each dimension that has any", async () => {
    renderTrends();

    await waitFor(() => {
      expect(screen.getByText("Unattributed (no customer)")).toBeTruthy();
    });
    expect(screen.getByText("Unattributed (no artifact produced)")).toBeTruthy();
    // The MSP dimension has none, so it is not asserted into existence.
    expect(screen.queryByText("Unattributed (platform / no MSP)")).toBeNull();
  });

  it("states its share of the window rather than leaving it to be eyeballed", async () => {
    renderTrends();
    await waitFor(() => {
      expect(screen.getByText(/40% of this window's spend, across 1 call/)).toBeTruthy();
    });
  });

  it("keeps it out of the ranked list", async () => {
    renderTrends();
    await waitFor(() => expect(screen.getByTitle("Filter by Acme")).toBeTruthy());
    // Acme is a button (drillable); the unattributed line is not — there is no
    // filter for "customer unknown", and offering one would be a lie.
    expect(screen.queryByTitle("Filter by Unattributed (no customer)")).toBeNull();
  });
});

// ── Capped lists and coverage ─────────────────────────────────────────────────

describe("AiCostTrends — honest caps", () => {
  it("says how many buckets the top-N list folded away", async () => {
    renderTrends();
    await waitFor(() => {
      expect(screen.getByText(/4 more document types/)).toBeTruthy();
    });
  });

  it("warns when the row scan was clipped", async () => {
    response = makeResponse({
      coverage: {
        rowsScanned: 50_000,
        rowLimit: 50_000,
        truncated: true,
        observedFrom: "2026-07-20T00:00:00.000Z",
      },
    });
    renderTrends();

    await waitFor(() => {
      expect(screen.getByText(/only the most recent 50,000 were read/)).toBeTruthy();
    });
    expect(screen.getByText(/excluded from anomaly detection/)).toBeTruthy();
  });

  it("shows no coverage warning on a complete scan", async () => {
    renderTrends();
    await waitFor(() => expect(screen.getByText("Cost per customer")).toBeTruthy());
    expect(screen.queryByText(/only the most recent/)).toBeNull();
  });
});

// ── Query construction ────────────────────────────────────────────────────────

describe("AiCostTrends — scoping", () => {
  it("carries the page's filters and the viewer's timezone into the query", async () => {
    renderTrends({
      mspId: "4",
      customerId: "9",
      costOwner: "platform",
      feature: "generate_document",
      generatedArtifactType: "sow",
    });

    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalled());
    const url = fetchWithAuth.mock.calls[0]?.[0] ?? "";

    expect(url).toContain("/api/admin/ai-billing/analytics?");
    expect(url).toContain("bucket=day");
    expect(url).toContain("tzOffsetMinutes=240");
    expect(url).toContain("mspId=4");
    expect(url).toContain("customerId=9");
    expect(url).toContain("costOwner=platform");
    expect(url).toContain("feature=generate_document");
    expect(url).toContain("generatedArtifactType=sow");
  });

  it("omits empty filters instead of sending blanks", async () => {
    renderTrends();
    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalled());
    const url = fetchWithAuth.mock.calls[0]?.[0] ?? "";

    expect(url).not.toContain("mspId=");
    expect(url).not.toContain("costOwner=");
  });

  it("surfaces a failed load rather than an empty-looking chart", async () => {
    ok = false;
    renderTrends();

    await waitFor(() => {
      expect(screen.getByText("Could not load AI cost trends.")).toBeTruthy();
    });
  });
});

// ── Formatting ────────────────────────────────────────────────────────────────

describe("format helpers", () => {
  it("formats integer cents as currency at the point of display only", () => {
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(1)).toBe("$0.01");
    expect(formatCents(123_456)).toBe("$1234.56");
  });

  it("keeps cents visible on an axis below $10 and compacts above it", () => {
    expect(formatCentsCompact(4)).toBe("$0.04");
    expect(formatCentsCompact(40)).toBe("$0.40");
    expect(formatCentsCompact(2500)).toBe("$25");
    expect(formatCentsCompact(250_000)).toBe("$2.5k");
  });

  it("returns null for an undefined ratio instead of Infinity", () => {
    expect(formatRatio(30_000)).toBe("3.0x");
    expect(formatRatio(null)).toBeNull();
  });

  it("labels bucket keys from their own parts, never through a UTC Date", () => {
    // Parsing "2026-07-28" with new Date() gives UTC midnight, which in any
    // negative-offset timezone renders as the 27th. These must not move.
    expect(formatBucketLabel("2026-07-28", "day")).toBe("Jul 28");
    expect(formatBucketLabel("2026-07-27", "week")).toBe("w/c Jul 27");
    expect(formatBucketLabel("2026-07", "month")).toBe("Jul 2026");
  });
});
