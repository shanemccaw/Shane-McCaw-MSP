/**
 * securityPlanWire.test.ts — the Security Plan wire normaliser.
 *
 * `toSecurityPlan` is the seam between GET /api/portal/security-plan and the
 * page's own `SecurityPlan` shape, and the whole point of it is the decision it
 * makes about WHICH SOURCE renders. These are the properties worth failing a
 * build over:
 *
 *   1. A NULL / EMPTY read falls back to the fixture (returns null here), so the
 *      page never renders an empty masthead or divides its derived percentage by
 *      zero requirements.
 *   2. AN UNKNOWN state is coerced to `gap`, never left as a value the row
 *      renderer would index off `SP_STATE_META` and crash on.
 *   3. THE SHAPES ARE REMAPPED, not passed through: to_route → to, updated_label
 *      → updated, and the owner chip is lifted out of the plan object.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { toSecurityPlan, type WireSecurityPlanPayload } from "./securityPlanWire";
import { SECURITY_PLAN, SECURITY_PLAN_OWNER } from "./securityPlanData";

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

describe("toSecurityPlan — source selection", () => {
  it("returns null for a null payload (failed read -> fixture)", () => {
    assert.equal(toSecurityPlan(null), null);
  });

  it("returns null when the customer has no plan (plan: null -> fixture)", () => {
    assert.equal(toSecurityPlan({ plan: null }), null);
  });

  it("returns null when the plan has no sections", () => {
    assert.equal(toSecurityPlan({ plan: { sections: [] } }), null);
  });

  it("returns null when every section is empty of rows (would divide-by-zero)", () => {
    assert.equal(
      toSecurityPlan({
        plan: { sections: [{ k: "governance", n: "02", label: "G", lead: "l", rows: [] }] },
      }),
      null,
    );
  });

  it("drops sections with no key rather than rendering an unselectable rail item", () => {
    const out = toSecurityPlan({
      plan: {
        sections: [
          {
            k: "",
            n: "02",
            label: "no key",
            lead: "l",
            rows: [{ req: "r", state: "met", detail: "d", to: "/x", toLabel: "X" }],
          },
        ],
      },
    });
    // The only section had no key and is dropped, leaving nothing -> fixture.
    assert.equal(out, null);
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
    const out = toSecurityPlan({
      plan: {
        sections: [
          {
            k: "governance",
            n: "02",
            label: "G",
            lead: "l",
            rows: [{ req: "r", state: "banana", detail: "d", to: "/x", toLabel: "X" }],
          },
        ],
      },
    });
    assert.ok(out);
    assert.equal(out.plan.sections[0]!.rows[0]!.state, "gap");
  });

  it("falls back to the fixture owner + header fields when the wire omits them", () => {
    const out = toSecurityPlan({
      plan: {
        sections: [
          {
            k: "governance",
            n: "02",
            label: "G",
            lead: "l",
            rows: [{ req: "r", state: "met", detail: "d", to: "/x", toLabel: "X" }],
          },
        ],
      },
    });
    assert.ok(out);
    assert.deepEqual(out.owner, {
      initials: SECURITY_PLAN_OWNER.initials,
      tone: SECURITY_PLAN_OWNER.tone,
    });
    assert.equal(out.plan.tenant, SECURITY_PLAN.tenant);
    assert.equal(out.plan.approver, SECURITY_PLAN.approver);
  });
});
