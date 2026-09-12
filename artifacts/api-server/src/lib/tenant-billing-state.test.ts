/**
 * Git #2847 — the per-customer billing decision.
 *
 * The rule this file pins down is the one that decides whether a customer's portal is
 * open, whether their per-record retention clocks run, and whether a 7-year purge window
 * starts. Getting it wrong in the permissive direction leaves a non-paying customer with
 * a working portal; getting it wrong in the other direction freezes a paying customer's
 * clocks and schedules the destruction of their data. The second is why these cases are
 * enumerated exhaustively rather than sampled.
 *
 * `decideTenantBillingActive` is the pure form of exactly what `resolveTenantBillingState`
 * applies in TypeScript and `tenantBillingActiveCondition` applies in SQL. Testing the
 * pure function is testing all three, which is the whole reason it was extracted.
 */

import { describe, it, expect } from "vitest";
import {
  decideMspSubscriptionLapsed,
  decideTenantBillingActive,
  isActiveSubscriptionStatus,
  isLapsedMspDunningState,
  isLapsedMspSubscriptionStatus,
  isRunningTenantStatus,
} from "./tenant-billing-rules.ts";

const RUNNING_TENANT_STATUSES = ["active", "onboarding"] as const;
const STOPPED_TENANT_STATUSES = ["inactive", "archived"] as const;

describe("#2847 — tenants.status alone (no subscription ever recorded)", () => {
  it("falls back to tenants.status, and says so", () => {
    for (const status of RUNNING_TENANT_STATUSES) {
      const d = decideTenantBillingActive({ tenantStatus: status, subscriptionStatuses: [], msp: null });
      expect(d).toEqual({ active: true, source: "tenant_status", mspLapsed: false });
    }
    for (const status of STOPPED_TENANT_STATUSES) {
      const d = decideTenantBillingActive({ tenantStatus: status, subscriptionStatuses: [], msp: null });
      expect(d).toEqual({ active: false, source: "tenant_status", mspLapsed: false });
    }
  });

  it("ABSENCE OF A SUBSCRIPTION IS NOT CANCELLATION — this is the whole safety property", () => {
    // Every tenant in the database predates tenant_subscriptions. If "no row" meant "not
    // paying", deploying #2847 would gate every existing customer, freeze their clocks
    // and start a 7-year purge window for all of them — from a migration.
    expect(decideTenantBillingActive({ tenantStatus: "active", subscriptionStatuses: [], msp: null }).active).toBe(true);
  });
});

describe("#2847 — a real subscription decides", () => {
  it("an active-family subscription keeps the portal open", () => {
    for (const s of ["trialing", "active", "past_due"]) {
      expect(
        decideTenantBillingActive({ tenantStatus: "active", subscriptionStatuses: [s], msp: null }),
      ).toEqual({ active: true, source: "subscription", mspLapsed: false });
    }
  });

  it("a terminal subscription closes it, even while tenants.status still reads active", () => {
    // THE gap #2847 was filed for: nothing ever wrote `inactive` onto tenants.status on
    // non-payment, so before this the customer below stayed fully open forever.
    for (const s of ["canceled", "unpaid"]) {
      expect(
        decideTenantBillingActive({ tenantStatus: "active", subscriptionStatuses: [s], msp: null }),
      ).toEqual({ active: false, source: "subscription", mspLapsed: false });
    }
  });

  it("past_due keeps the portal open while Stripe retries the card", () => {
    // Deliberate, with a real in-repo precedent: msp-entitlement.ts revokes on
    // dunning reaching access_revoked, not on past_due. Gating here would freeze a
    // customer's retention clocks and start a purge window because a card expired.
    expect(isActiveSubscriptionStatus("past_due")).toBe(true);
    expect(isActiveSubscriptionStatus("unpaid")).toBe(false);
    expect(isActiveSubscriptionStatus("canceled")).toBe(false);
  });

  it("one active subscription among several cancelled ones keeps the portal open", () => {
    expect(
      decideTenantBillingActive({
        tenantStatus: "active",
        subscriptionStatuses: ["canceled", "canceled", "active"],
        msp: null,
      }).active,
    ).toBe(true);
  });

  it("all-terminal closes it", () => {
    expect(
      decideTenantBillingActive({
        tenantStatus: "active",
        subscriptionStatuses: ["canceled", "unpaid"],
        msp: null,
      }).active,
    ).toBe(false);
  });
});

describe("#2847 — tenants.status remains a conjunct, so this can only narrow", () => {
  it("an archived tenant is closed no matter how healthy its subscription is", () => {
    // An operator archiving a customer is a real end-of-relationship signal and is the
    // behaviour that shipped in #2765. Keeping it as an AND means nobody who is gated
    // today becomes ungated because a subscription row appeared.
    for (const status of STOPPED_TENANT_STATUSES) {
      expect(
        decideTenantBillingActive({ tenantStatus: status, subscriptionStatuses: ["active"], msp: null }).active,
      ).toBe(false);
    }
  });

  it("source reports the subscription even when tenants.status is what closed it", () => {
    // The tenant HAS a subscription on record; the wall must not claim there is none.
    expect(
      decideTenantBillingActive({ tenantStatus: "archived", subscriptionStatuses: ["active"], msp: null }).source,
    ).toBe("subscription");
  });
});

describe("#2847 — the two vocabularies", () => {
  it("onboarding counts as running: a customer being onboarded has not cancelled", () => {
    expect(isRunningTenantStatus("onboarding")).toBe(true);
    expect(isRunningTenantStatus("active")).toBe(true);
    expect(isRunningTenantStatus("inactive")).toBe(false);
    expect(isRunningTenantStatus("archived")).toBe(false);
  });

  it("null/undefined/unknown are never treated as running or active", () => {
    for (const v of [null, undefined, "", "paused", "incomplete"]) {
      expect(isRunningTenantStatus(v)).toBe(false);
      expect(isActiveSubscriptionStatus(v)).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Git #2936 — the MSP's own lapse cascades to its customers
// ─────────────────────────────────────────────────────────────────────────────
//
// Shane's decision (2026-09-05) reversed #2847's deliberate non-answer: an MSP's lapsed
// platform subscription DOES close its customers' portals and start their 7-year purge
// clocks, through this same rule rather than a parallel one. These cases are enumerated
// for the same reason as the ones above — the wrong answer in one direction serves a
// product nobody is paying for, and in the other it schedules the destruction of an
// entire book of business's data.

const HEALTHY_MSP = { status: "active", dunningState: null } as const;

describe("#2936 — an MSP with no subscription row is NOT a lapse", () => {
  it("null msp leaves the customer exactly as #2847 decided", () => {
    // The safety property that makes this deployable. Every MSP in the database predates
    // msp_subscriptions; reading "no row" as "not paying" would gate every one of their
    // customers and start seven-year purge windows for all of them on deploy. Confirmed
    // against the real local database at build time: one msp_subscriptions row exists,
    // for msp_id 1626, while every tenant sits under msp_id 1.
    expect(decideTenantBillingActive({ tenantStatus: "active", subscriptionStatuses: [], msp: null }))
      .toEqual({ active: true, source: "tenant_status", mspLapsed: false });
    expect(decideTenantBillingActive({ tenantStatus: "active", subscriptionStatuses: ["active"], msp: null }))
      .toEqual({ active: true, source: "subscription", mspLapsed: false });
  });
});

describe("#2936 — which MSP states cascade, and which deliberately do not", () => {
  it("canceled and unpaid cascade", () => {
    for (const status of ["canceled", "unpaid"]) {
      expect(decideMspSubscriptionLapsed({ status, dunningState: null })).toBe(true);
      expect(
        decideTenantBillingActive({
          tenantStatus: "active",
          subscriptionStatuses: ["active"],
          msp: { status, dunningState: null },
        }),
      ).toEqual({ active: false, source: "msp_subscription", mspLapsed: true });
    }
  });

  it("access_revoked and archival_flagged cascade — the same pair msp-entitlement already uses", () => {
    for (const dunningState of ["access_revoked", "archival_flagged"]) {
      expect(decideMspSubscriptionLapsed({ status: "past_due", dunningState })).toBe(true);
      expect(
        decideTenantBillingActive({
          tenantStatus: "active",
          subscriptionStatuses: ["active"],
          msp: { status: "past_due", dunningState },
        }).active,
      ).toBe(false);
    }
  });

  it("trialing/active/past_due, and the earlier dunning rungs, do NOT cascade", () => {
    // past_due is a card Stripe is still retrying, and `suspended` still leaves the MSP
    // itself fully entitled (msp-entitlement.ts revokes only at access_revoked). Closing
    // a customer's portal before their MSP's own access closed would be the wrong order,
    // and it would start an irreversible 7-year clock over a transient decline.
    for (const status of ["trialing", "active", "past_due"]) {
      for (const dunningState of [null, "reminder_sent", "suspended"]) {
        expect(decideMspSubscriptionLapsed({ status, dunningState })).toBe(false);
        expect(
          decideTenantBillingActive({
            tenantStatus: "active",
            subscriptionStatuses: ["active"],
            msp: { status, dunningState },
          }).active,
        ).toBe(true);
      }
    }
  });

  it("the two vocabularies reject unknown values rather than defaulting either way", () => {
    for (const v of [null, undefined, "", "suspended", "reminder_sent"]) {
      expect(isLapsedMspSubscriptionStatus(v)).toBe(false);
    }
    for (const v of [null, undefined, "", "canceled", "suspended"]) {
      expect(isLapsedMspDunningState(v)).toBe(false);
    }
    expect(isLapsedMspSubscriptionStatus("canceled")).toBe(true);
    expect(isLapsedMspSubscriptionStatus("unpaid")).toBe(true);
    expect(isLapsedMspDunningState("access_revoked")).toBe(true);
    expect(isLapsedMspDunningState("archival_flagged")).toBe(true);
  });
});

describe("#2936 — `source` says WHOSE lapse closed the portal", () => {
  it("a customer whose own billing is fine reports msp_subscription", () => {
    // The wall's copy is "your MSP hasn't paid". Reporting `subscription` here would tell
    // a customer their own subscription ended when it did not.
    const d = decideTenantBillingActive({
      tenantStatus: "active",
      subscriptionStatuses: ["active"],
      msp: { status: "canceled", dunningState: null },
    });
    expect(d.source).toBe("msp_subscription");
    expect(d.mspLapsed).toBe(true);
  });

  it("a customer who ALSO cancelled reports their own subscription, with mspLapsed still true", () => {
    // Their own state is the more specific fact and is what the screen leads with; the
    // MSP's lapse stays readable alongside it rather than being overwritten.
    const d = decideTenantBillingActive({
      tenantStatus: "active",
      subscriptionStatuses: ["canceled"],
      msp: { status: "canceled", dunningState: null },
    });
    expect(d).toEqual({ active: false, source: "subscription", mspLapsed: true });
  });

  it("an archived tenant under a lapsed MSP reports tenant/subscription, not the MSP", () => {
    expect(
      decideTenantBillingActive({
        tenantStatus: "archived",
        subscriptionStatuses: [],
        msp: { status: "canceled", dunningState: null },
      }),
    ).toEqual({ active: false, source: "tenant_status", mspLapsed: true });
  });
});

describe("#2936 — the un-cascade is the same rule read again", () => {
  it("a customer closed only by their MSP's lapse reopens when the MSP resumes", () => {
    // There is no separate resume path: the predicate flips back, and #2765's
    // reconciliation resumes the per-record clocks from where they froze and clears the
    // lapse instant. This assertion is that flip.
    const lapsed = decideTenantBillingActive({
      tenantStatus: "active",
      subscriptionStatuses: ["active"],
      msp: { status: "unpaid", dunningState: "access_revoked" },
    });
    expect(lapsed.active).toBe(false);

    const resumed = decideTenantBillingActive({
      tenantStatus: "active",
      subscriptionStatuses: ["active"],
      msp: HEALTHY_MSP,
    });
    expect(resumed).toEqual({ active: true, source: "subscription", mspLapsed: false });
  });
});
