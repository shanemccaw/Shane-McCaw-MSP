/**
 * policy-enactment-route.test.ts — the Policy Engine's enactment-shape
 * resolver (#1551).
 *
 * Locks the settled table: same policy, same detection, different route,
 * decided by policy.isActive + tenants.policy_engine_opt_in (#1549) + the
 * tenant's own write-back consent — "opted in, granted" -> engine enacts,
 * "opted in, denied" -> checklist item (the NASA posture), "not opted in" ->
 * no evaluation at all.
 */

import { describe, it, expect } from "vitest";
import type { TenantConsentMap } from "@workspace/db";
import {
  POLICY_ENACTMENT_ROUTE,
  POLICY_ENACTMENT_ROUTE_LABELS,
  POLICY_ENACTMENT_AFFORDANCE,
  resolvePolicyEnactmentRoute,
} from "./policy-enactment-route";

const granted: TenantConsentMap = { writeBack: { status: "granted" } };
const declined: TenantConsentMap = { writeBack: { status: "declined" } };
const revoked: TenantConsentMap = { writeBack: { status: "revoked" } };
const noWriteRow: TenantConsentMap = {};

describe("resolvePolicyEnactmentRoute — the settled table", () => {
  it("opted in + write consent granted -> engine enacts", () => {
    expect(resolvePolicyEnactmentRoute({ policyActive: true, tenantOptedIn: true, consent: granted })).toEqual({
      route: "engine_enacts",
      reason: "write_consent_granted",
    });
  });

  it("opted in + write consent denied -> checklist item (the NASA posture)", () => {
    expect(resolvePolicyEnactmentRoute({ policyActive: true, tenantOptedIn: true, consent: declined })).toEqual({
      route: "checklist_item",
      reason: "write_consent_denied",
    });
  });

  it("every non-granted write status caps at checklist_item, never below", () => {
    expect(resolvePolicyEnactmentRoute({ policyActive: true, tenantOptedIn: true, consent: revoked }).route).toBe("checklist_item");
    expect(resolvePolicyEnactmentRoute({ policyActive: true, tenantOptedIn: true, consent: noWriteRow }).route).toBe("checklist_item");
    expect(resolvePolicyEnactmentRoute({ policyActive: true, tenantOptedIn: true, consent: null }).route).toBe("checklist_item");
    expect(resolvePolicyEnactmentRoute({ policyActive: true, tenantOptedIn: true, consent: undefined }).route).toBe("checklist_item");
  });

  it("tenant not opted in (policy_engine_opt_in = false) -> no evaluation, no action, regardless of write consent", () => {
    expect(resolvePolicyEnactmentRoute({ policyActive: true, tenantOptedIn: false, consent: granted })).toEqual({
      route: "not_evaluated",
      reason: "tenant_not_opted_in",
    });
  });

  it("a policy that is not switched on is not_evaluated regardless of tenant state", () => {
    expect(resolvePolicyEnactmentRoute({ policyActive: false, tenantOptedIn: true, consent: granted })).toEqual({
      route: "not_evaluated",
      reason: "policy_inactive",
    });
  });

  it("policy_inactive is checked before tenant opt-in — the policy gate comes first", () => {
    expect(resolvePolicyEnactmentRoute({ policyActive: false, tenantOptedIn: false, consent: null }).reason).toBe("policy_inactive");
  });
});

describe("vocabulary", () => {
  it("POLICY_ENACTMENT_ROUTE enumerates all three shapes", () => {
    expect(POLICY_ENACTMENT_ROUTE).toEqual(["engine_enacts", "checklist_item", "not_evaluated"]);
  });

  it("has a label for every route and no orphan labels", () => {
    expect(Object.keys(POLICY_ENACTMENT_ROUTE_LABELS).sort()).toEqual([...POLICY_ENACTMENT_ROUTE].sort());
  });

  it("has an affordance for every route and no orphan entries", () => {
    expect(Object.keys(POLICY_ENACTMENT_AFFORDANCE).sort()).toEqual([...POLICY_ENACTMENT_ROUTE].sort());
    expect(POLICY_ENACTMENT_AFFORDANCE.engine_enacts).toBe("execute");
    expect(POLICY_ENACTMENT_AFFORDANCE.checklist_item).toBe("copy");
    expect(POLICY_ENACTMENT_AFFORDANCE.not_evaluated).toBe("none");
  });
});
