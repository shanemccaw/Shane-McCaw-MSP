/**
 * securityPlanWire.test.ts — the Security Plan wire normaliser.
 *
 * `toSecurityPlan` is the seam between GET /api/portal/security-plan and the
 * page's own `SecurityPlan` shape, and the whole point of it is the decision it
 * makes about whether the payload is USABLE at all. These are the properties
 * worth failing a build over:
 *
 *   1. A NULL / EMPTY / malformed read returns null — never the design fixture
 *      (Git #1439 removed that fallback entirely) — so the page can render its
 *      own honest empty state instead of an empty masthead or a divide-by-zero
 *      on its derived percentage.
 *   2. AN UNKNOWN state is coerced to `gap`, never left as a value the row
 *      renderer would index off `SP_STATE_META` and crash on.
 *   3. THE SHAPES ARE REMAPPED, not passed through: to_route → to, updated_label
 *      → updated, and the owner chip is lifted out of the plan object.
 *   4. `isExplicitlyNoPlan` is the ONLY thing that tells an explicit `{ plan:
 *      null }` (this customer genuinely has none authored) apart from a
 *      malformed non-null plan (`toSecurityPlan` returns null for both) — the
 *      page renders different honest copy for each.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  isExplicitlyNoPlan,
  toSecurityPlan,
  type WireSecPlanSection,
  type WireSecurityPlanPayload,
} from "./securityPlanWire";

const goodPayload: WireSecurityPlanPayload = {
  plan: {
    tenant: "Halden Materials",
    env: "Production",
    tier: "Enhanced",
    version: "v4.2",
    updated: "19 August 2026",
    approver: "Dan Whitlock, Operations Director",
    owner: { initials: "DW", tone: "#fbbf24" },
    sections: [
      {
        k: "governance",
        n: "02",
        label: "Governance framework",
        lead: "What has to exist before anything else is meaningful.",
        rows: [
          {
            req: "Policy decisions recorded with an owner and a review date",
            state: "met",
            detail: "4 recorded, 1 due for review and 1 expired.",
            to: "/portal-v2/policy-decisions",
            toLabel: "Policy Decisions",
          },
        ],
      },
    ],
    history: [
      { v: "v4.2", when: "19 Aug 2026", who: "Dan Whitlock", what: "PII governance added.", cr: "CR-0131" },
    ],
  },
};

/** `goodPayload` with its `sections`/`history` swapped out, header fields kept. */
function withSections(sections: readonly WireSecPlanSection[]): WireSecurityPlanPayload {
  return { plan: { ...goodPayload.plan, sections, history: [] } };
}

describe("toSecurityPlan — source selection", () => {
  it("returns null for a null payload (failed read -> honest error state)", () => {
    assert.equal(toSecurityPlan(null), null);
  });

  it("returns null when the customer has no plan (plan: null -> honest no-plan state)", () => {
    assert.equal(toSecurityPlan({ plan: null }), null);
  });

  it("returns null when the plan has no sections", () => {
    assert.equal(toSecurityPlan(withSections([])), null);
  });

  it("returns null when every section is empty of rows (would divide-by-zero)", () => {
    assert.equal(
      toSecurityPlan(withSections([{ k: "governance", n: "02", label: "G", lead: "l", rows: [] }])),
      null,
    );
  });

  it("drops sections with no key rather than rendering an unselectable rail item, leaving nothing usable", () => {
    const out = toSecurityPlan(
      withSections([
        {
          k: "",
          n: "02",
          label: "no key",
          lead: "l",
          rows: [{ req: "r", state: "met", detail: "d", to: "/x", toLabel: "X" }],
        },
      ]),
    );
    assert.equal(out, null);
  });

  it("Git #1439: returns null (never the design fixture) when a header field is blank on an otherwise-usable plan", () => {
    const out = toSecurityPlan({ ...goodPayload, plan: { ...goodPayload.plan, tenant: "" } });
    assert.equal(out, null);
  });

  it("Git #1439: returns null when the owner chip is missing on an otherwise-usable plan", () => {
    const out = toSecurityPlan({ ...goodPayload, plan: { ...goodPayload.plan, owner: undefined } });
    assert.equal(out, null);
  });
});

describe("isExplicitlyNoPlan — Git #1439", () => {
  it("is true for exactly the payload the route sends when a customer has none authored", () => {
    assert.equal(isExplicitlyNoPlan({ plan: null }), true);
  });

  it("is false for a null payload (a failed read, not an explicit no-plan answer)", () => {
    assert.equal(isExplicitlyNoPlan(null), false);
  });

  it("is false for a usable plan payload", () => {
    assert.equal(isExplicitlyNoPlan(goodPayload), false);
  });

  it("is false for a malformed non-null plan (that's the 'error' branch, not 'no-plan')", () => {
    assert.equal(isExplicitlyNoPlan(withSections([])), false);
  });
});

describe("toSecurityPlan — mapping", () => {
  it("maps a full payload into the page's SecurityPlan + owner shapes", () => {
    const out = toSecurityPlan(goodPayload);
    assert.ok(out);
    assert.equal(out.plan.tenant, "Halden Materials");
    assert.equal(out.plan.updated, "19 August 2026");
    assert.equal(out.plan.sections.length, 1);
    assert.equal(out.plan.sections[0]!.k, "governance");
    assert.equal(out.plan.sections[0]!.rows[0]!.to, "/portal-v2/policy-decisions");
    assert.equal(out.plan.sections[0]!.rows[0]!.toLabel, "Policy Decisions");
    assert.equal(out.plan.history[0]!.cr, "CR-0131");
    assert.deepEqual(out.owner, { initials: "DW", tone: "#fbbf24" });
  });

  it("coerces an unknown row state to gap (never crashes the row renderer)", () => {
    const out = toSecurityPlan(
      withSections([
        {
          k: "governance",
          n: "02",
          label: "G",
          lead: "l",
          rows: [{ req: "r", state: "banana", detail: "d", to: "/x", toLabel: "X" }],
        },
      ]),
    );
    assert.ok(out);
    assert.equal(out.plan.sections[0]!.rows[0]!.state, "gap");
  });
});
