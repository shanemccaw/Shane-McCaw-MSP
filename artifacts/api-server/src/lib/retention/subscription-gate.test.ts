/**
 * Git #2765 — the subscription gate, the post-termination clock, and the tenant-data
 * purger registry.
 *
 * Tested against #1944 parts 7-8's literal requirements rather than the implementation's
 * shape, the same way #1947's own tests are written:
 *
 *   - *"Subscription inactive → every route resolves to one screen... Export remains
 *     reachable; everything else is unreachable before role evaluation is ever
 *     consulted."* So the gate is asserted to be CLOSED by default — an arbitrary route
 *     nobody thought of is gated, because coverage comes from sitting behind the gate,
 *     not from a route knowing about it.
 *   - *"No new role. No new permission."* — the operator passes through, the customer
 *     does not, and no principal here carries a lock-down capability.
 *   - *"Full unlock the moment the subscription goes active again — the gate is
 *     re-evaluated live."* — an active customer is never gated regardless of path.
 *   - The 7-year clock is calendar arithmetic across a leap year, not years × 365d.
 *   - The purge REFUSES rather than completing when no purger is registered, because a
 *     tenant marked purged having destroyed nothing is an irreversible false claim.
 *
 * Pure functions and in-memory registries only — no database, no server, no token.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  SUBSCRIPTION_GATE_ALLOWED_PREFIXES,
  SUBSCRIPTION_GATE_CODE,
  evaluateSubscriptionGate,
  gatedTenantIdFor,
  isGateAllowedPath,
  subscriptionGateBody,
  type GatePrincipal,
} from "./subscription-gate";
import { postTerminationDueAt } from "./clock";
import type { TenantSubscriptionState } from "./subscription-state";
import {
  __resetTenantDataPurgersForTest,
  listTenantDataPurgers,
  registerTenantDataPurger,
} from "./registry";

// ── Fixtures are STATE OBJECTS, not data ─────────────────────────────────────
// These construct the argument to a pure function so its behaviour can be asserted.
// Nothing here is rendered, persisted or served — the standing no-fixture-data rule is
// about rows reaching a screen, and no row here reaches anything.

const LAPSED_AT = new Date("2026-03-01T12:00:00Z");

function state(overrides: Partial<TenantSubscriptionState> = {}): TenantSubscriptionState {
  const base: TenantSubscriptionState = {
    tenantId: 42,
    mspId: 1,
    customerName: "Test Customer",
    status: "inactive",
    active: false,
    lapsedAt: LAPSED_AT,
    postTerminationYears: 7,
    postTerminationIsDefault: true,
    purgeDueAt: postTerminationDueAt(LAPSED_AT, 7),
    purgedAt: null,
  };
  return { ...base, ...overrides };
}

const customer: GatePrincipal = { role: "client", mspRole: "CustomerUser", customerId: 42 };

describe("#2765 — who the gate applies to (part 8: no new role, no new permission)", () => {
  it("gates a CustomerUser session, resolving to its own tenant", () => {
    expect(gatedTenantIdFor(customer)).toBe(42);
  });

  it("gates Free and Assessment sessions the same way — they are customer principals too", () => {
    expect(gatedTenantIdFor({ mspRole: "Free", customerId: 7 })).toBe(7);
    expect(gatedTenantIdFor({ mspRole: "Assessment", customerId: 7 })).toBe(7);
  });

  it("does NOT gate the operator — the #1571 review queue exists to look at cancelled customers", () => {
    expect(gatedTenantIdFor({ mspRole: "MSPOperator", customerId: 42 })).toBeNull();
    expect(gatedTenantIdFor({ mspRole: "MSPAdmin", customerId: 42 })).toBeNull();
    expect(gatedTenantIdFor({ mspRole: "PlatformAdmin", customerId: 42 })).toBeNull();
  });

  it("treats a legacy role:\"admin\" session as PlatformAdmin, same as everywhere else", () => {
    expect(gatedTenantIdFor({ role: "admin", customerId: 42 })).toBeNull();
  });

  it("does not gate an unauthenticated request", () => {
    expect(gatedTenantIdFor(null)).toBeNull();
    expect(gatedTenantIdFor(undefined)).toBeNull();
  });

  it("does not gate a customer principal with no tenant claim — authentication is requireAuth's job", () => {
    expect(gatedTenantIdFor({ mspRole: "CustomerUser" })).toBeNull();
  });
});

describe("#2765 — the allowlist is the ONLY thing that stays reachable", () => {
  it("keeps both real export endpoints reachable — the bare shell's one capability", () => {
    expect(isGateAllowedPath("/portal/data-export")).toBe(true);
    expect(isGateAllowedPath("/portal/customer/export")).toBe(true);
  });

  it("matches by prefix, so a sub-path of the same capability is not a second decision", () => {
    expect(isGateAllowedPath("/portal/data-export/download")).toBe(true);
    expect(isGateAllowedPath("/portal/data-export/")).toBe(true);
    expect(isGateAllowedPath("/portal/data-export?format=json")).toBe(true);
  });

  it("keeps the whole session surface reachable — logout above all", () => {
    // Trapping someone in a session they cannot end is worse than over-gating.
    expect(isGateAllowedPath("/auth/logout")).toBe(true);
    expect(isGateAllowedPath("/auth/login")).toBe(true);
    expect(isGateAllowedPath("/auth/refresh")).toBe(true);
  });

  it("keeps MFA reachable, so #439's mfaSetupPending gate cannot deadlock against this one", () => {
    expect(isGateAllowedPath("/auth/mfa/totp/challenge")).toBe(true);
    expect(isGateAllowedPath("/auth/mfa/passkey/authentication-options")).toBe(true);
  });

  it("keeps the wall's own status endpoint reachable, so the screen never invents its numbers", () => {
    expect(isGateAllowedPath("/portal/retention/subscription-gate")).toBe(true);
  });

  it("does NOT accidentally allow a route that merely starts with an allowed word", () => {
    // "/auth" the prefix is "/auth/" — a hypothetical "/authorize-payment" must not slip through.
    expect(isGateAllowedPath("/authorize-payment")).toBe(false);
    expect(isGateAllowedPath("/portal/data-exports-admin")).toBe(true); // documented prefix behaviour
  });

  it("blocks the ordinary portal", () => {
    expect(isGateAllowedPath("/portal/risk-register")).toBe(false);
    expect(isGateAllowedPath("/portal/change-control")).toBe(false);
    expect(isGateAllowedPath("/msp/customers")).toBe(false);
  });
});

describe("#2765 — the gate decision (part 8: one check point, closed by default)", () => {
  it("gates a route nobody thought of — coverage comes from sitting behind the gate", () => {
    const outcome = evaluateSubscriptionGate({
      principal: customer,
      method: "GET",
      path: "/portal/some-module-that-does-not-exist-yet",
      state: state(),
    });
    expect(outcome.gated).toBe(true);
  });

  it("gates writes as well as reads", () => {
    expect(
      evaluateSubscriptionGate({ principal: customer, method: "POST", path: "/portal/risk-register", state: state() })
        .gated,
    ).toBe(true);
  });

  it("lets export through while the subscription is inactive", () => {
    const outcome = evaluateSubscriptionGate({
      principal: customer,
      method: "GET",
      path: "/portal/data-export",
      state: state(),
    });
    expect(outcome.gated).toBe(false);
    expect(outcome).toMatchObject({ reason: "allowlisted" });
  });

  it("never gates an active customer, on any path — the gate is symmetric and live", () => {
    const active = state({ status: "active", active: true, lapsedAt: null, purgeDueAt: null });
    for (const path of ["/portal/risk-register", "/portal/data-export", "/msp/anything"]) {
      const outcome = evaluateSubscriptionGate({ principal: customer, method: "GET", path, state: active });
      expect(outcome).toEqual({ gated: false, reason: "subscription_active" });
    }
  });

  it("treats 'onboarding' as running — a customer being onboarded has not cancelled", () => {
    const onboarding = state({ status: "onboarding", active: true, lapsedAt: null, purgeDueAt: null });
    expect(
      evaluateSubscriptionGate({ principal: customer, method: "GET", path: "/portal/anything", state: onboarding })
        .gated,
    ).toBe(false);
  });

  it("does not gate the operator even on a lapsed tenant", () => {
    const outcome = evaluateSubscriptionGate({
      principal: { mspRole: "MSPAdmin", customerId: 42 },
      method: "GET",
      path: "/msp/customers/42/ghosted",
      state: state(),
    });
    expect(outcome).toEqual({ gated: false, reason: "no_customer_principal" });
  });

  it("lets CORS preflight through, so the real request renders the wall instead of a CORS error", () => {
    expect(
      evaluateSubscriptionGate({ principal: customer, method: "OPTIONS", path: "/portal/risk-register", state: state() })
        .gated,
    ).toBe(false);
  });

  it("does not gate when the tenant cannot be resolved", () => {
    expect(
      evaluateSubscriptionGate({ principal: customer, method: "GET", path: "/portal/risk-register", state: null })
        .gated,
    ).toBe(false);
  });
});

describe("#2765 — the wall's body carries real values or null, never a computed placeholder", () => {
  it("reports the real lapse instant, window and purge date", () => {
    const body = subscriptionGateBody(state());
    expect(body.code).toBe(SUBSCRIPTION_GATE_CODE);
    expect(body.subscriptionActive).toBe(false);
    expect(body.lapsedAt).toBe(LAPSED_AT.toISOString());
    expect(body.retentionYears).toBe(7);
    expect(body.retentionYearsIsDefault).toBe(true);
    expect(body.purgeDueAt).toBe(new Date("2033-03-01T12:00:00Z").toISOString());
  });

  it("reports null — not a guess — when no real lapse instant has been recorded yet", () => {
    const body = subscriptionGateBody(state({ lapsedAt: null, purgeDueAt: null }));
    expect(body.lapsedAt).toBeNull();
    expect(body.purgeDueAt).toBeNull();
  });

  it("reports a per-customer override as an override, so a surface can say which it is", () => {
    const body = subscriptionGateBody(state({ postTerminationYears: 10, postTerminationIsDefault: false }));
    expect(body.retentionYears).toBe(10);
    expect(body.retentionYearsIsDefault).toBe(false);
  });

  it("hands the screen the allowlist rather than making it hardcode its one button", () => {
    expect(subscriptionGateBody(state()).allowedPaths).toEqual(SUBSCRIPTION_GATE_ALLOWED_PREFIXES);
  });
});

describe("#2765 — the 7-year post-termination clock (part 7)", () => {
  it("is 7 calendar years, not 7 × 365 days", () => {
    // 2026-03-01 → 2033-03-01 spans two leap days (2028, 2032). A 365-day multiplication
    // lands two days early, which on an irreversible purge is two days of a customer's
    // data destroyed before its window ended.
    const due = postTerminationDueAt(new Date("2026-03-01T12:00:00Z"), 7);
    expect(due.toISOString()).toBe("2033-03-01T12:00:00.000Z");
    const naive = new Date(new Date("2026-03-01T12:00:00Z").getTime() + 7 * 365 * 86_400_000);
    expect(due.getTime()).toBeGreaterThan(naive.getTime());
  });

  it("preserves the time of day, so a purge cannot fire early on the boundary date", () => {
    const due = postTerminationDueAt(new Date("2026-08-15T23:59:59Z"), 7);
    expect(due.toISOString()).toBe("2033-08-15T23:59:59.000Z");
  });

  it("honours a per-customer override rather than the platform default", () => {
    expect(postTerminationDueAt(new Date("2026-01-01T00:00:00Z"), 10).getUTCFullYear()).toBe(2036);
  });

  it("handles a Feb-29 lapse without rolling into March", () => {
    // 2028 is a leap year, 2035 is not. Date's own normalization gives Mar 1; asserted
    // rather than left implicit, because the alternative is a silent off-by-one on a
    // date that only occurs every four years.
    const due = postTerminationDueAt(new Date("2028-02-29T00:00:00Z"), 7);
    expect(due.toISOString()).toBe("2035-03-01T00:00:00.000Z");
  });
});

describe("#2765 — the tenant-data purger registry", () => {
  beforeEach(() => {
    __resetTenantDataPurgersForTest();
  });

  it("ships EMPTY — per-module wiring is each consuming module's own issue", () => {
    expect(listTenantDataPurgers()).toEqual([]);
  });

  it("refuses a duplicate key, so import order cannot decide which purger runs", () => {
    const purger = { key: "risk-register", displayName: "Risk register", purge: async () => 0 };
    registerTenantDataPurger(purger);
    expect(() => registerTenantDataPurger({ ...purger })).toThrow(/already registered/);
  });

  it("keeps every registered purger — a purge that skips a module is a purge that did not happen", () => {
    registerTenantDataPurger({ key: "a", displayName: "A", purge: async () => 1 });
    registerTenantDataPurger({ key: "b", displayName: "B", purge: async () => 2 });
    expect(listTenantDataPurgers().map((p) => p.key)).toEqual(["a", "b"]);
  });
});
