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
  decideTenantBillingActive,
  isActiveSubscriptionStatus,
  isRunningTenantStatus,
} from "./tenant-billing-rules";

const RUNNING_TENANT_STATUSES = ["active", "onboarding"] as const;
const STOPPED_TENANT_STATUSES = ["inactive", "archived"] as const;

describe("#2847 — tenants.status alone (no subscription ever recorded)", () => {
  it("falls back to tenants.status, and says so", () => {
    for (const status of RUNNING_TENANT_STATUSES) {
      const d = decideTenantBillingActive({ tenantStatus: status, subscriptionStatuses: [] });
      expect(d).toEqual({ active: true, source: "tenant_status" });
    }
    for (const status of STOPPED_TENANT_STATUSES) {
      const d = decideTenantBillingActive({ tenantStatus: status, subscriptionStatuses: [] });
      expect(d).toEqual({ active: false, source: "tenant_status" });
    }
  });

  it("ABSENCE OF A SUBSCRIPTION IS NOT CANCELLATION — this is the whole safety property", () => {
    // Every tenant in the database predates tenant_subscriptions. If "no row" meant "not
    // paying", deploying #2847 would gate every existing customer, freeze their clocks
    // and start a 7-year purge window for all of them — from a migration.
    expect(decideTenantBillingActive({ tenantStatus: "active", subscriptionStatuses: [] }).active).toBe(true);
  });
});

describe("#2847 — a real subscription decides", () => {
  it("an active-family subscription keeps the portal open", () => {
    for (const s of ["trialing", "active", "past_due"]) {
      expect(
        decideTenantBillingActive({ tenantStatus: "active", subscriptionStatuses: [s] }),
      ).toEqual({ active: true, source: "subscription" });
    }
  });

  it("a terminal subscription closes it, even while tenants.status still reads active", () => {
    // THE gap #2847 was filed for: nothing ever wrote `inactive` onto tenants.status on
    // non-payment, so before this the customer below stayed fully open forever.
    for (const s of ["canceled", "unpaid"]) {
      expect(
        decideTenantBillingActive({ tenantStatus: "active", subscriptionStatuses: [s] }),
      ).toEqual({ active: false, source: "subscription" });
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
      }).active,
    ).toBe(true);
  });

  it("all-terminal closes it", () => {
    expect(
      decideTenantBillingActive({
        tenantStatus: "active",
        subscriptionStatuses: ["canceled", "unpaid"],
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
        decideTenantBillingActive({ tenantStatus: status, subscriptionStatuses: ["active"] }).active,
      ).toBe(false);
    }
  });

  it("source reports the subscription even when tenants.status is what closed it", () => {
    // The tenant HAS a subscription on record; the wall must not claim there is none.
    expect(
      decideTenantBillingActive({ tenantStatus: "archived", subscriptionStatuses: ["active"] }).source,
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
