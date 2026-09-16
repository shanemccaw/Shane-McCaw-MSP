/**
 * Git #4375 — the pending-purchase gate's decision, tested against #4370's literal
 * requirement: *"a `*Pending` account can see ONLY the resume-your-purchase stub —
 * nothing else in the portal."* So the gate is asserted CLOSED by default for a pending
 * principal — an arbitrary route nobody listed is gated — and OPEN for every other rung.
 *
 * Pure functions only — no database, no server, no token.
 */

import { describe, it, expect } from "vitest";
import { LEGACY_ROLE, LEGACY_ROLE_ORDER } from "@workspace/db/rbac/legacy-ladder";
import {
  PENDING_PURCHASE_GATE_ALLOWED_PREFIXES,
  PENDING_PURCHASE_GATE_CODE,
  PENDING_PURCHASE_ROLES,
  evaluatePendingPurchaseGate,
  isPendingGateAllowedPath,
  pendingPurchaseGateBody,
  pendingRoleOf,
} from "./pending-purchase-gate.ts";

describe("pendingRoleOf", () => {
  it("recognises exactly the three *Pending rungs", () => {
    const pending = LEGACY_ROLE_ORDER.filter((r) => pendingRoleOf({ role: "client", mspRole: r }) !== null);
    expect([...pending].sort()).toEqual(
      [LEGACY_ROLE.monitoringPending, LEGACY_ROLE.packPending, LEGACY_ROLE.retainerPending].sort(),
    );
    expect([...PENDING_PURCHASE_ROLES].sort()).toEqual([...pending].sort());
  });

  it("reads a pre-#4371 RetainerNoConsent token as RetainerPending", () => {
    expect(pendingRoleOf({ role: "client", mspRole: "RetainerNoConsent" })).toBe(LEGACY_ROLE.retainerPending);
  });

  it("never treats the Consented rungs, customers, operators or a legacy admin as pending", () => {
    for (const r of [LEGACY_ROLE.monitoringConsented, LEGACY_ROLE.packConsented, LEGACY_ROLE.retainerConsented, LEGACY_ROLE.customer, LEGACY_ROLE.free, LEGACY_ROLE.mspAdmin, LEGACY_ROLE.platformAdmin]) {
      expect(pendingRoleOf({ role: "client", mspRole: r })).toBeNull();
    }
    expect(pendingRoleOf({ role: "admin", mspRole: LEGACY_ROLE.retainerPending })).toBeNull();
    expect(pendingRoleOf(null)).toBeNull();
    expect(pendingRoleOf({ role: "client" })).toBeNull();
  });
});

describe("evaluatePendingPurchaseGate", () => {
  const pending = LEGACY_ROLE.packPending;

  it("gates every ordinary portal/msp/admin route for a pending principal", () => {
    for (const path of ["/portal/dashboard", "/portal/customer/export", "/msp/customers", "/admin/users", "/notifications", "/portal-projects", "/some/route/nobody/listed"]) {
      expect(evaluatePendingPurchaseGate({ pendingRole: pending, method: "GET", path })).toEqual({ gated: true, pendingRole: pending });
    }
  });

  it("leaves session, MFA enrollment, public checkout and liveness reachable", () => {
    for (const path of ["/auth/logout", "/auth/refresh", "/auth/me/context", "/auth/mfa/totp/setup", "/public/purchase/account-status", "/public/flow/payment-intent", "/health", "/version"]) {
      expect(evaluatePendingPurchaseGate({ pendingRole: pending, method: "POST", path }).gated).toBe(false);
    }
  });

  it("does not match look-alike prefixes", () => {
    expect(isPendingGateAllowedPath("/authz/anything")).toBe(false);
    expect(isPendingGateAllowedPath("/public-chat")).toBe(false);
    expect(isPendingGateAllowedPath("/healthcheck-admin")).toBe(true); // `/health` prefix, same rule as the subscription gate
  });

  it("never gates a non-pending principal or a CORS preflight", () => {
    expect(evaluatePendingPurchaseGate({ pendingRole: null, method: "GET", path: "/portal/dashboard" })).toEqual({ gated: false, reason: "not_pending" });
    expect(evaluatePendingPurchaseGate({ pendingRole: pending, method: "OPTIONS", path: "/portal/dashboard" }).gated).toBe(false);
  });
});

describe("pendingPurchaseGateBody", () => {
  it("carries the typed code, the rung, and an honest null resume path until #4379 lands", () => {
    expect(pendingPurchaseGateBody(LEGACY_ROLE.monitoringPending)).toEqual({
      code: PENDING_PURCHASE_GATE_CODE,
      pendingRole: LEGACY_ROLE.monitoringPending,
      resumePath: null,
      allowedPaths: PENDING_PURCHASE_GATE_ALLOWED_PREFIXES,
    });
  });
});
