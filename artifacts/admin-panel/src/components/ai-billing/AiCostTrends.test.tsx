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
import AiCostTrends, {
  type AnalyticsResponse,
  type LeadAnalyticsResponse,
} from "./AiCostTrends";
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

/**
 * Phase 4.1 (#81) fixture: GET /admin/ai-billing/lead-analytics.
 *
 * Deliberately carries BOTH unattributed reasons and a null run figure, since
 * those are the states the section exists to be honest about.
 */
function makeLeadResponse(over: Partial<LeadAnalyticsResponse> = {}): LeadAnalyticsResponse {
  return {
    bucket: "day",
    periodStart: "2026-06-29T00:00:00.000Z",
    periodEnd: "2026-07-29T00:00:00.000Z",
    totalCostCents: 1500,
    eventCount: 3,
    coverage: {
      rowsScanned: 3,
      rowLimit: 50_000,
      truncated: false,
      distinctTenants: 1,
      tenantsElided: 0,
      identityLinkRows: 1,
      identityLinksTruncated: false,
      assessmentRunsTruncated: false,
    },
    byLead: {
      slices: [
        {
          key: "100",
          leadStagingId: 100,
          label: "Acme Corp",
          email: "ops@acme.example",
          source: "assessment",
          costCents: 900,
          eventCount: 2,
        },
      ],
      other: { costCents: 0, eventCount: 0, sliceCount: 0 },
      unattributed: {
        costCents: 600,
        eventCount: 2,
        label: "Unattributed (no lead resolved)",
        breakdown: {
          noCustomer: { costCents: 400, eventCount: 1 },
          customerWithoutLead: { costCents: 200, eventCount: 1 },
        },
      },
      medianCostPerLeadCents: 900,
      meanCostPerLeadCents: 900,
      leadsWithSpend: 1,
      leadsReachable: 2,
      ambiguousTenantCount: 0,
      attributedCostCents: 900,
      totalCostCents: 1500,
      eventCount: 3,
    },
    byAssessmentRun: {
      slices: [],
      other: { costCents: 0, eventCount: 0, sliceCount: 0 },
      unattributed: {
        costCents: 1500,
        eventCount: 3,
        label: "Unattributed (outside any assessment run)",
      },
      medianCostPerRunCents: null,
      meanCostPerRunCents: null,
      runsInWindow: 0,
      runsWithSpend: 0,
      runsWithoutInterval: 0,
      overlappingEventCount: 0,
      attributedCostCents: 0,
      totalCostCents: 1500,
      eventCount: 3,
      attribution: {
        method: "customer-and-interval",
        openRunCapMs: 21_600_000,
        note: "Spend is attributed to a run when it belongs to the same customer and occurred inside that run's interval, which makes each figure an UPPER BOUND.",
      },
    },
    leadsStagedInWindow: 2,
    ...over,
  };
}

let response: AnalyticsResponse | null = makeResponse();
let leadResponse: LeadAnalyticsResponse | null = makeLeadResponse();
let ok = true;
let leadOk = true;
// Routed by URL: the component now calls two endpoints, and answering the lead
// endpoint with the trends payload would test a shape the server never sends.
const fetchWithAuth = vi.fn(async (url: string) => {
  if (url.includes("/lead-analytics")) {
    return { ok: leadOk, json: async () => leadResponse } as unknown as Response;
  }
  return { ok, json: async () => response } as unknown as Response;
});
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
  leadResponse = makeLeadResponse();
  ok = true;
  leadOk = true;
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

// ── Phase 4.1 (#81): cost per lead / cost per assessment run ──────────────────

describe("AiCostTrends — cost per lead is honest about what it cannot attribute", () => {
  it("fetches the lead endpoint with the same scope as the trends query", async () => {
    renderTrends({ ...EMPTY_SCOPE, mspId: "5", costOwner: "msp" });

    await waitFor(() => expect(fetchWithAuth).toHaveBeenCalledTimes(2));
    const leadUrl =
      fetchWithAuth.mock.calls
        .map((c) => String(c[0]))
        .find((u) => u.includes("/lead-analytics")) ?? "";
    expect(leadUrl).toContain("mspId=5");
    expect(leadUrl).toContain("costOwner=msp");
    expect(leadUrl).toContain("tzOffsetMinutes=240");
  });

  it("shows the median as the headline figure and names it as such", async () => {
    renderTrends();
    await waitFor(() => expect(screen.getByText(/Median cost per lead/)).toBeTruthy());
    // Scoped to the headline block: the same amount legitimately appears in the
    // cost-per-customer panel above, and a bare text match would pass on that
    // one instead of on the figure under test.
    const headline = screen.getByText("Median cost per lead").parentElement;
    expect(headline?.textContent).toContain(formatCents(900));
    expect(headline?.textContent).toContain("1 lead with spend");
    expect(headline?.textContent).not.toContain("No figure yet");
  });

  it("splits unattributed spend by reason rather than reporting one opaque number", async () => {
    renderTrends();

    await waitFor(() =>
      expect(screen.getByText("Unattributed (no lead resolved)")).toBeTruthy(),
    );
    // The two reasons call for different fixes, so they are never merged.
    expect(screen.getByText(/from calls with no customer recorded/)).toBeTruthy();
    expect(screen.getByText(/from\s+customers with no lead on record/)).toBeTruthy();
  });

  it("names the unpromoted-quiz case explicitly, so it reads as excluded rather than missing", async () => {
    renderTrends();
    await waitFor(() => expect(screen.getByText(/unpromoted quiz result/)).toBeTruthy());
  });

  it("renders a null figure as 'no figure yet', never as a fabricated zero", async () => {
    // This is the state to expect until #133's live Zoho verification lands.
    const base = makeLeadResponse();
    leadResponse = makeLeadResponse({
      byLead: {
        ...base.byLead,
        slices: [],
        medianCostPerLeadCents: null,
        meanCostPerLeadCents: null,
        leadsWithSpend: 0,
        attributedCostCents: 0,
      },
    });

    renderTrends();

    // Both headlines — cost per lead and cost per run — are null in this fixture.
    await waitFor(() => expect(screen.getAllByText("No figure yet").length).toBe(2));
    expect(screen.getByText(/no lead in this window incurred AI spend/)).toBeTruthy();
    expect(screen.getByText(/No AI spend traced to a lead in this window/)).toBeTruthy();
  });

  it("prints the server's own attribution note for assessment runs", async () => {
    renderTrends();
    // The run figure is an interval attribution, not a key join. The page says so
    // rather than implying a precision the data does not have.
    await waitFor(() => expect(screen.getByText(/UPPER BOUND/)).toBeTruthy());
  });

  it("says when the tie-break fired instead of hiding it", async () => {
    const base = makeLeadResponse();
    leadResponse = makeLeadResponse({
      byLead: { ...base.byLead, ambiguousTenantCount: 3 },
    });

    renderTrends();
    await waitFor(() =>
      expect(screen.getByText(/3 customers resolved to more than one lead/)).toBeTruthy(),
    );
  });

  it("declares a capped attribution rather than letting it read as complete", async () => {
    const base = makeLeadResponse();
    leadResponse = makeLeadResponse({
      coverage: { ...base.coverage, tenantsElided: 7, identityLinksTruncated: true },
    });

    renderTrends();
    await waitFor(() =>
      expect(screen.getByText(/These figures cover part of the window only/)).toBeTruthy(),
    );
    expect(screen.getByText(/7 customers left unresolved/)).toBeTruthy();
  });

  it("degrades to its own error state without taking the trend chart down", async () => {
    leadOk = false;
    renderTrends();

    await waitFor(() =>
      expect(screen.getByText("Could not load cost-per-lead analytics.")).toBeTruthy(),
    );
    // The anomaly rule above it still rendered, from its own successful request.
    expect(screen.getByText(/Flags a day whose spend is at least 3x/)).toBeTruthy();
  });
});
