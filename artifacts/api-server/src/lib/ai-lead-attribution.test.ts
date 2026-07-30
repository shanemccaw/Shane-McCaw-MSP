/**
 * ai-lead-attribution.test.ts
 *
 * AI Cost Governance Phase 4.1 (#81): cost per lead and cost per assessment run.
 *
 * What these tests are actually protecting:
 *   - a REAL join produces a REAL figure — the identity chain from a usage
 *     event's customerId through to a lead_staging row works end to end;
 *   - an unpromoted quick_win_quiz_results row can never be attributed. Those
 *     rows carry no name and no email, so AI spend around them arrives with a
 *     null customerId and MUST land in `unattributed`, counted, never guessed at
 *     and never dropped;
 *   - a lead with NO usage events does not appear as a fabricated $0.00 line,
 *     while a lead with events that genuinely sum to zero DOES get its own
 *     slice — those two are different facts and only one of them is a cost;
 *   - the headline figure is a MEDIAN (Phase 4's convention), and is NULL rather
 *     than 0 when nothing has spend, because "no figure" is not "zero";
 *   - a near-empty dataset (pending #133's live Zoho verification) is an honest
 *     empty state, not a crash and not an invented number;
 *   - assessment-run attribution is interval-based and says so, with the open-run
 *     cap and the overlap tie-break both behaving as documented.
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_LEAD_LIMIT,
  OPEN_RUN_ATTRIBUTION_CAP_MS,
  UNATTRIBUTED_LEAD_LABEL,
  resolveTenantLeads,
  rollupCostPerAssessmentRun,
  rollupCostPerLead,
  type AssessmentRunCostInputRow,
  type AssessmentRunInput,
  type LeadCostInputRow,
  type TenantLeadLink,
} from "./ai-lead-attribution.ts";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function link(
  tenantId: number,
  leadStagingId: number,
  overrides: Partial<TenantLeadLink> = {},
): TenantLeadLink {
  return {
    tenantId,
    leadStagingId,
    leadName: `Lead ${leadStagingId}`,
    leadEmail: `lead${leadStagingId}@example.com`,
    leadSource: "assessment",
    ...overrides,
  };
}

function usage(customerId: number | null, costCents: number): LeadCostInputRow {
  return { customerId, costCents };
}

function runUsage(
  customerId: number | null,
  iso: string,
  costCents: number,
): AssessmentRunCostInputRow {
  return { customerId, occurredAt: new Date(iso), costCents };
}

function run(
  runId: string,
  customerId: number | null,
  startedAt: string | null,
  completedAt: string | null,
  overrides: Partial<AssessmentRunInput> = {},
): AssessmentRunInput {
  return {
    runId,
    customerId,
    status: "completed",
    startedAt: startedAt ? new Date(startedAt) : null,
    completedAt: completedAt ? new Date(completedAt) : null,
    createdAt: startedAt ? new Date(startedAt) : null,
    ...overrides,
  };
}

// ── Identity resolution ──────────────────────────────────────────────────────

describe("resolveTenantLeads", () => {
  it("resolves a tenant to its lead", () => {
    const r = resolveTenantLeads([link(10, 100)]);
    expect(r.byTenant.get(10)).toMatchObject({
      leadStagingId: 100,
      label: "Lead 100",
      email: "lead100@example.com",
    });
    expect(r.ambiguousTenantCount).toBe(0);
    expect(r.distinctLeadCount).toBe(1);
  });

  it("treats the same lead matched twice (legacyLeadId AND email) as one, not an ambiguity", () => {
    // The identity query ORs two predicates, so one real pair can come back
    // twice. That is a duplicate, not two competing leads.
    const r = resolveTenantLeads([link(10, 100), link(10, 100)]);
    expect(r.ambiguousTenantCount).toBe(0);
    expect(r.distinctLeadCount).toBe(1);
  });

  it("breaks a genuine tie deterministically on the earliest staged lead", () => {
    const forward = resolveTenantLeads([link(10, 300), link(10, 100), link(10, 200)]);
    const reversed = resolveTenantLeads([link(10, 200), link(10, 100), link(10, 300)]);

    expect(forward.byTenant.get(10)?.leadStagingId).toBe(100);
    // Row order out of the database must not change the answer.
    expect(reversed.byTenant.get(10)?.leadStagingId).toBe(100);
    expect(forward.ambiguousTenantCount).toBe(1);
    expect(forward.distinctLeadCount).toBe(3);
  });

  it("falls back to email, then to the id, rather than inventing a name", () => {
    const noName = resolveTenantLeads([link(10, 100, { leadName: "  " })]);
    expect(noName.byTenant.get(10)?.label).toBe("lead100@example.com");

    const noIdentity = resolveTenantLeads([
      link(11, 101, { leadName: null, leadEmail: null }),
    ]);
    expect(noIdentity.byTenant.get(11)?.label).toBe("Lead 101");
    expect(noIdentity.byTenant.get(11)?.email).toBeNull();
  });
});

// ── Cost per lead ────────────────────────────────────────────────────────────

describe("rollupCostPerLead", () => {
  it("produces a real figure from a real join", () => {
    const resolution = resolveTenantLeads([link(10, 100), link(20, 200)]);
    const rollup = rollupCostPerLead(
      [usage(10, 500), usage(10, 300), usage(20, 100)],
      resolution,
    );

    expect(rollup.slices).toHaveLength(2);
    expect(rollup.slices[0]).toMatchObject({ leadStagingId: 100, costCents: 800, eventCount: 2 });
    expect(rollup.slices[1]).toMatchObject({ leadStagingId: 200, costCents: 100, eventCount: 1 });
    expect(rollup.attributedCostCents).toBe(900);
    expect(rollup.leadsWithSpend).toBe(2);
    expect(rollup.unattributed.costCents).toBe(0);
  });

  it("reports an unpromoted quiz result's spend as unattributed, never folded into a lead", () => {
    // An unpromoted quick_win_quiz_results row has no name, no email and no
    // leadStagingId, so any AI spend around it reaches ai_usage_events with a
    // null customerId. It must be counted, and counted under noCustomer.
    const resolution = resolveTenantLeads([link(10, 100)]);
    const rollup = rollupCostPerLead(
      [usage(10, 500), usage(null, 250), usage(null, 125)],
      resolution,
    );

    expect(rollup.slices).toHaveLength(1);
    expect(rollup.slices[0]?.costCents).toBe(500);
    // Not folded into the named lead...
    expect(rollup.attributedCostCents).toBe(500);
    // ...and not dropped either.
    expect(rollup.unattributed.costCents).toBe(375);
    expect(rollup.unattributed.eventCount).toBe(2);
    expect(rollup.unattributed.breakdown.noCustomer).toEqual({ costCents: 375, eventCount: 2 });
    expect(rollup.unattributed.breakdown.customerWithoutLead).toEqual({
      costCents: 0,
      eventCount: 0,
    });
    expect(rollup.unattributed.label).toBe(UNATTRIBUTED_LEAD_LABEL);
  });

  it("separates a known customer with no resolvable lead from spend with no customer at all", () => {
    const resolution = resolveTenantLeads([link(10, 100)]);
    const rollup = rollupCostPerLead(
      [usage(10, 500), usage(99, 200), usage(null, 50)],
      resolution,
    );

    expect(rollup.unattributed.breakdown.customerWithoutLead).toEqual({
      costCents: 200,
      eventCount: 1,
    });
    expect(rollup.unattributed.breakdown.noCustomer).toEqual({ costCents: 50, eventCount: 1 });
    expect(rollup.unattributed.costCents).toBe(250);
  });

  it("does not invent a $0.00 line for a lead with no spend, but does keep a genuine zero-cost lead", () => {
    // Lead 100 has a zero-cost event; lead 200 is reachable but never spent.
    const resolution = resolveTenantLeads([link(10, 100), link(20, 200)]);
    const rollup = rollupCostPerLead([usage(10, 0)], resolution);

    // The genuine zero-cost lead is a real slice: it made a call, the call cost
    // nothing. That is a fact about spend.
    expect(rollup.slices).toHaveLength(1);
    expect(rollup.slices[0]).toMatchObject({ leadStagingId: 100, costCents: 0, eventCount: 1 });
    expect(rollup.leadsWithSpend).toBe(1);

    // Lead 200 is NOT fabricated as a $0.00 cost line — it is only visible as
    // the gap between leadsReachable and leadsWithSpend.
    expect(rollup.slices.some((s) => s.leadStagingId === 200)).toBe(false);
    expect(rollup.leadsReachable).toBe(2);
  });

  it("uses the median, not the mean, and computes it over every lead rather than the visible top-N", () => {
    const links = [1, 2, 3, 4, 5].map((n) => link(n * 10, n * 100));
    const resolution = resolveTenantLeads(links);
    // 100, 200, 300, 400, 10000 -> median 300, mean 2200.
    const rollup = rollupCostPerLead(
      [usage(10, 100), usage(20, 200), usage(30, 300), usage(40, 400), usage(50, 10_000)],
      resolution,
      2, // cap the visible slices well below the population
    );

    expect(rollup.slices).toHaveLength(2);
    expect(rollup.other.sliceCount).toBe(3);
    // One runaway lead does not drag the headline figure.
    expect(rollup.medianCostPerLeadCents).toBe(300);
    expect(rollup.meanCostPerLeadCents).toBe(2200);
    expect(rollup.leadsWithSpend).toBe(5);
  });

  it("returns null — not zero — for the headline figure when no lead has spend", () => {
    const rollup = rollupCostPerLead([usage(null, 400)], resolveTenantLeads([]));

    expect(rollup.medianCostPerLeadCents).toBeNull();
    expect(rollup.meanCostPerLeadCents).toBeNull();
    expect(rollup.leadsWithSpend).toBe(0);
    expect(rollup.unattributed.costCents).toBe(400);
  });

  it("handles a genuinely empty dataset as an empty state, not a crash (pending #133)", () => {
    const rollup = rollupCostPerLead([], resolveTenantLeads([]));

    expect(rollup.slices).toEqual([]);
    expect(rollup.totalCostCents).toBe(0);
    expect(rollup.eventCount).toBe(0);
    expect(rollup.medianCostPerLeadCents).toBeNull();
    expect(rollup.leadsReachable).toBe(0);
    expect(rollup.unattributed.costCents).toBe(0);
  });

  it("reconciles: attributed + other + unattributed always equals the total", () => {
    const links = [1, 2, 3, 4, 5, 6].map((n) => link(n * 10, n * 100));
    const rollup = rollupCostPerLead(
      [
        ...[1, 2, 3, 4, 5, 6].map((n) => usage(n * 10, n * 11)),
        usage(null, 77),
        usage(999, 88),
      ],
      resolveTenantLeads(links),
      2,
    );

    const visible = rollup.slices.reduce((acc, s) => acc + s.costCents, 0);
    expect(visible + rollup.other.costCents).toBe(rollup.attributedCostCents);
    expect(rollup.attributedCostCents + rollup.unattributed.costCents).toBe(
      rollup.totalCostCents,
    );
    expect(rollup.eventCount).toBe(8);
  });

  it("surfaces the ambiguity count rather than hiding the tie-break", () => {
    const resolution = resolveTenantLeads([link(10, 100), link(10, 200)]);
    const rollup = rollupCostPerLead([usage(10, 500)], resolution);

    expect(rollup.ambiguousTenantCount).toBe(1);
    // Attributed once, to the earliest lead — never counted against both.
    expect(rollup.attributedCostCents).toBe(500);
    expect(rollup.slices).toHaveLength(1);
    expect(rollup.slices[0]?.leadStagingId).toBe(100);
  });

  it("defaults to the documented slice cap", () => {
    const links = Array.from({ length: 12 }, (_, i) => link((i + 1) * 10, (i + 1) * 100));
    const rollup = rollupCostPerLead(
      links.map((l, i) => usage(l.tenantId, (i + 1) * 10)),
      resolveTenantLeads(links),
    );

    expect(rollup.slices).toHaveLength(DEFAULT_LEAD_LIMIT);
    expect(rollup.other.sliceCount).toBe(12 - DEFAULT_LEAD_LIMIT);
  });
});

// ── Cost per assessment run ──────────────────────────────────────────────────

describe("rollupCostPerAssessmentRun", () => {
  const NOW = new Date("2026-07-29T12:00:00.000Z");

  it("attributes spend inside a run's interval to that run", () => {
    const rollup = rollupCostPerAssessmentRun(
      [
        runUsage(10, "2026-07-29T09:30:00.000Z", 400),
        runUsage(10, "2026-07-29T09:45:00.000Z", 200),
      ],
      [run("run-a", 10, "2026-07-29T09:00:00.000Z", "2026-07-29T10:00:00.000Z")],
      { now: NOW },
    );

    expect(rollup.slices).toHaveLength(1);
    expect(rollup.slices[0]).toMatchObject({ runId: "run-a", costCents: 600, eventCount: 2 });
    expect(rollup.runsWithSpend).toBe(1);
    expect(rollup.runsInWindow).toBe(1);
    expect(rollup.unattributed.costCents).toBe(0);
  });

  it("reports spend outside every run interval as unattributed, not as a run's cost", () => {
    const rollup = rollupCostPerAssessmentRun(
      [
        runUsage(10, "2026-07-29T09:30:00.000Z", 400), // inside
        runUsage(10, "2026-07-29T11:30:00.000Z", 900), // after the run ended
        runUsage(null, "2026-07-29T09:30:00.000Z", 50), // no customer at all
        runUsage(77, "2026-07-29T09:30:00.000Z", 25), // customer with no run
      ],
      [run("run-a", 10, "2026-07-29T09:00:00.000Z", "2026-07-29T10:00:00.000Z")],
      { now: NOW },
    );

    expect(rollup.slices[0]?.costCents).toBe(400);
    expect(rollup.unattributed.costCents).toBe(975);
    expect(rollup.unattributed.eventCount).toBe(3);
    expect(rollup.attributedCostCents + rollup.unattributed.costCents).toBe(
      rollup.totalCostCents,
    );
  });

  it("does not let a run for one customer claim another customer's spend", () => {
    const rollup = rollupCostPerAssessmentRun(
      [runUsage(20, "2026-07-29T09:30:00.000Z", 400)],
      [run("run-a", 10, "2026-07-29T09:00:00.000Z", "2026-07-29T10:00:00.000Z")],
      { now: NOW },
    );

    expect(rollup.runsWithSpend).toBe(0);
    expect(rollup.unattributed.costCents).toBe(400);
    expect(rollup.medianCostPerRunCents).toBeNull();
  });

  it("caps an unfinished run's interval instead of letting it absorb everything after it", () => {
    const startIso = "2026-07-29T00:00:00.000Z";
    const justInside = new Date(
      new Date(startIso).getTime() + OPEN_RUN_ATTRIBUTION_CAP_MS - 60_000,
    ).toISOString();
    const justOutside = new Date(
      new Date(startIso).getTime() + OPEN_RUN_ATTRIBUTION_CAP_MS + 60_000,
    ).toISOString();

    const rollup = rollupCostPerAssessmentRun(
      [runUsage(10, justInside, 100), runUsage(10, justOutside, 900)],
      [run("run-open", 10, startIso, null, { status: "running" })],
      { now: NOW },
    );

    expect(rollup.slices[0]?.costCents).toBe(100);
    expect(rollup.unattributed.costCents).toBe(900);
  });

  it("gives an overlapped event to the latest-starting run and counts the overlap", () => {
    const rollup = rollupCostPerAssessmentRun(
      [runUsage(10, "2026-07-29T09:30:00.000Z", 400)],
      [
        run("run-early", 10, "2026-07-29T09:00:00.000Z", "2026-07-29T10:00:00.000Z"),
        run("run-late", 10, "2026-07-29T09:15:00.000Z", "2026-07-29T09:45:00.000Z"),
      ],
      { now: NOW },
    );

    expect(rollup.overlappingEventCount).toBe(1);
    // Counted once, for the later run — never against both.
    expect(rollup.attributedCostCents).toBe(400);
    expect(rollup.slices).toHaveLength(1);
    expect(rollup.slices[0]?.runId).toBe("run-late");
  });

  it("counts a run with no usable interval rather than silently ignoring it", () => {
    const rollup = rollupCostPerAssessmentRun(
      [runUsage(10, "2026-07-29T09:30:00.000Z", 400)],
      [
        run("run-a", 10, "2026-07-29T09:00:00.000Z", "2026-07-29T10:00:00.000Z"),
        { ...run("run-no-start", 10, null, null), createdAt: null },
        run("run-no-customer", null, "2026-07-29T09:00:00.000Z", "2026-07-29T10:00:00.000Z"),
      ],
      { now: NOW },
    );

    expect(rollup.runsInWindow).toBe(3);
    expect(rollup.runsWithoutInterval).toBe(2);
    expect(rollup.runsWithSpend).toBe(1);
  });

  it("uses the median for the per-run figure too", () => {
    const rollup = rollupCostPerAssessmentRun(
      [
        runUsage(10, "2026-07-29T01:30:00.000Z", 100),
        runUsage(20, "2026-07-29T02:30:00.000Z", 300),
        runUsage(30, "2026-07-29T03:30:00.000Z", 9_000),
      ],
      [
        run("r1", 10, "2026-07-29T01:00:00.000Z", "2026-07-29T02:00:00.000Z"),
        run("r2", 20, "2026-07-29T02:00:00.000Z", "2026-07-29T03:00:00.000Z"),
        run("r3", 30, "2026-07-29T03:00:00.000Z", "2026-07-29T04:00:00.000Z"),
      ],
      { now: NOW },
    );

    expect(rollup.medianCostPerRunCents).toBe(300);
    expect(rollup.meanCostPerRunCents).toBe(3133);
    expect(rollup.runsWithSpend).toBe(3);
  });

  it("handles an empty dataset honestly and states its attribution method", () => {
    const rollup = rollupCostPerAssessmentRun([], [], { now: NOW });

    expect(rollup.slices).toEqual([]);
    expect(rollup.runsInWindow).toBe(0);
    expect(rollup.medianCostPerRunCents).toBeNull();
    expect(rollup.meanCostPerRunCents).toBeNull();
    // The method is carried as data so the UI cannot describe an interval
    // attribution as an exact per-run cost.
    expect(rollup.attribution.method).toBe("customer-and-interval");
    expect(rollup.attribution.openRunCapMs).toBe(OPEN_RUN_ATTRIBUTION_CAP_MS);
    expect(rollup.attribution.note).toContain("UPPER BOUND");
  });
});
