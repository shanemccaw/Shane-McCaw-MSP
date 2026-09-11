/**
 * #2455 — the deny-wins rule under test, explicitly.
 *
 * #1696 requirement 1 names allow/deny precedence as *"the single largest source
 * of RBAC bugs"* and rules that *"'it depends on role order' is not an answer."*
 * #2455's own "Done when" therefore requires the evaluation function to be unit
 * tested against deny-wins specifically — not just tested in general. That is what
 * the first describe block below is, including the permutation cases that prove
 * the decision genuinely does not depend on any ordering.
 *
 * Both identity systems are exercised through the same assertions on purpose:
 * #1696 warns that if the two mechanisms fork, *"a permission bug in one will not
 * be found by testing the other."*
 */

import { describe, expect, it } from "vitest";
import { createRbacEvaluator, evaluateCapability, type RbacFeatureMapping } from "./evaluate.ts";
import type { RbacSystem } from "./capabilities.ts";

// Stable role ids. Real uuids, because that is what the columns hold — the
// evaluator must never see or compare a role NAME (#1696 requirement 2).
const ENGINEER = "11111111-1111-4111-8111-111111111111";
const BILLING_CONTACT = "22222222-2222-4222-8222-222222222222";
const OWNER = "33333333-3333-4333-8333-333333333333";

const TENANT = 42;
const OTHER_TENANT = 43;

function mapping(partial: Partial<RbacFeatureMapping> & Pick<RbacFeatureMapping, "capabilityKey">): RbacFeatureMapping {
  return {
    system: "customer",
    orgId: null,
    allow: [],
    deny: [],
    ...partial,
  };
}

describe("deny wins (#1696 requirement 1)", () => {
  it("denies when one held role allows and another held role denies the same capability", () => {
    const decision = evaluateCapability({
      system: "customer",
      capability: "billing.view",
      orgId: TENANT,
      roleIds: [BILLING_CONTACT, ENGINEER],
      mappings: [
        mapping({ capabilityKey: "billing.view", orgId: TENANT, allow: [BILLING_CONTACT], deny: [ENGINEER] }),
      ],
    });

    expect(decision.allowed).toBe(false);
    expect(decision.effect).toBe("deny");
    expect(decision.decidedBy).toEqual([ENGINEER]);
  });

  it("gives the same answer whichever order the user's roles are listed in", () => {
    const roleOrders = [
      [BILLING_CONTACT, ENGINEER],
      [ENGINEER, BILLING_CONTACT],
    ];

    for (const roleIds of roleOrders) {
      const decision = evaluateCapability({
        system: "customer",
        capability: "billing.view",
        orgId: TENANT,
        roleIds,
        mappings: [mapping({ capabilityKey: "billing.view", orgId: TENANT, allow: [BILLING_CONTACT], deny: [ENGINEER] })],
      });
      expect(decision.effect).toBe("deny");
    }
  });

  it("gives the same answer whichever order the mapping rows arrive in", () => {
    const allowRow = mapping({ capabilityKey: "billing.view", orgId: null, allow: [BILLING_CONTACT] });
    const denyRow = mapping({ capabilityKey: "billing.view", orgId: TENANT, deny: [ENGINEER] });

    for (const mappings of [[allowRow, denyRow], [denyRow, allowRow]]) {
      const decision = evaluateCapability({
        system: "customer",
        capability: "billing.view",
        orgId: TENANT,
        roleIds: [BILLING_CONTACT, ENGINEER],
        mappings,
      });
      expect(decision.effect).toBe("deny");
    }
  });

  it("denies when the platform default allows and the org override denies", () => {
    const decision = evaluateCapability({
      system: "customer",
      capability: "billing.view",
      orgId: TENANT,
      roleIds: [ENGINEER],
      mappings: [
        mapping({ capabilityKey: "billing.view", orgId: null, allow: [ENGINEER] }),
        mapping({ capabilityKey: "billing.view", orgId: TENANT, deny: [ENGINEER] }),
      ],
    });

    expect(decision.allowed).toBe(false);
    expect(decision.effect).toBe("deny");
  });

  it("denies when the org override allows and the platform default denies — an org cannot un-deny the platform", () => {
    const decision = evaluateCapability({
      system: "customer",
      capability: "billing.view",
      orgId: TENANT,
      roleIds: [ENGINEER],
      mappings: [
        mapping({ capabilityKey: "billing.view", orgId: null, deny: [ENGINEER] }),
        mapping({ capabilityKey: "billing.view", orgId: TENANT, allow: [ENGINEER] }),
      ],
    });

    expect(decision.allowed).toBe(false);
    expect(decision.effect).toBe("deny");
  });

  it("denies when a single role is listed in both allow and deny of the same row", () => {
    const decision = evaluateCapability({
      system: "customer",
      capability: "billing.view",
      orgId: TENANT,
      roleIds: [ENGINEER],
      mappings: [mapping({ capabilityKey: "billing.view", orgId: TENANT, allow: [ENGINEER], deny: [ENGINEER] })],
    });

    expect(decision.effect).toBe("deny");
  });

  it("reports every held role that denied, sorted — this is what an audit record keeps", () => {
    const decision = evaluateCapability({
      system: "customer",
      capability: "billing.view",
      orgId: TENANT,
      roleIds: [OWNER, ENGINEER, BILLING_CONTACT],
      mappings: [mapping({ capabilityKey: "billing.view", orgId: TENANT, allow: [OWNER], deny: [ENGINEER, BILLING_CONTACT] })],
    });

    expect(decision.effect).toBe("deny");
    expect(decision.decidedBy).toEqual([ENGINEER, BILLING_CONTACT].sort());
  });

  it("holds on the MSP side identically — the two systems share one implementation", () => {
    const decision = evaluateCapability({
      system: "msp",
      capability: "purchases.approve",
      orgId: 7,
      roleIds: [BILLING_CONTACT, ENGINEER],
      mappings: [
        { system: "msp", capabilityKey: "purchases.approve", orgId: 7, allow: [BILLING_CONTACT], deny: [ENGINEER] },
      ],
    });

    expect(decision.allowed).toBe(false);
    expect(decision.effect).toBe("deny");
  });
});

describe("allow", () => {
  it("allows when a held role is allowed and nothing denies", () => {
    const decision = evaluateCapability({
      system: "customer",
      capability: "billing.view",
      orgId: TENANT,
      roleIds: [BILLING_CONTACT],
      mappings: [mapping({ capabilityKey: "billing.view", orgId: TENANT, allow: [BILLING_CONTACT] })],
    });

    expect(decision.allowed).toBe(true);
    expect(decision.effect).toBe("allow");
    expect(decision.decidedBy).toEqual([BILLING_CONTACT]);
  });

  it("lets an org override grant what the platform default left unset", () => {
    const decision = evaluateCapability({
      system: "customer",
      capability: "billing.view",
      orgId: TENANT,
      roleIds: [ENGINEER],
      mappings: [
        mapping({ capabilityKey: "billing.view", orgId: null, allow: [BILLING_CONTACT] }),
        mapping({ capabilityKey: "billing.view", orgId: TENANT, allow: [ENGINEER] }),
      ],
    });

    expect(decision.allowed).toBe(true);
  });

  it("composes permission sets sideways — two roles, neither a superset of the other", () => {
    // The thing the legacy ladder structurally cannot do (#1696): an engineer
    // who can approve changes but not see billing, and a billing contact who can
    // see billing but not approve changes. Holding both grants both.
    const mappings = [
      mapping({ capabilityKey: "billing.view", orgId: TENANT, allow: [BILLING_CONTACT] }),
      mapping({ capabilityKey: "changes.approve", orgId: TENANT, allow: [ENGINEER] }),
    ];

    const engineer = createRbacEvaluator({ system: "customer", userId: 1, orgId: TENANT, roleIds: [ENGINEER], mappings });
    expect(engineer.can("changes.approve")).toBe(true);
    expect(engineer.can("billing.view")).toBe(false);

    const billing = createRbacEvaluator({ system: "customer", userId: 2, orgId: TENANT, roleIds: [BILLING_CONTACT], mappings });
    expect(billing.can("billing.view")).toBe(true);
    expect(billing.can("changes.approve")).toBe(false);

    const both = createRbacEvaluator({ system: "customer", userId: 3, orgId: TENANT, roleIds: [ENGINEER, BILLING_CONTACT], mappings });
    expect(both.grantedCapabilities()).toEqual(["billing.view", "changes.approve"]);
  });
});

describe("default deny", () => {
  it("denies when no mapping row exists for the capability at all", () => {
    const decision = evaluateCapability({
      system: "customer",
      capability: "billing.view",
      orgId: TENANT,
      roleIds: [ENGINEER, BILLING_CONTACT],
      mappings: [],
    });

    expect(decision.allowed).toBe(false);
    expect(decision.effect).toBe("unset");
    expect(decision.decidedBy).toEqual([]);
  });

  it("denies a user who holds no roles at all", () => {
    const decision = evaluateCapability({
      system: "customer",
      capability: "billing.view",
      orgId: TENANT,
      roleIds: [],
      mappings: [mapping({ capabilityKey: "billing.view", orgId: TENANT, allow: [BILLING_CONTACT] })],
    });

    expect(decision.effect).toBe("unset");
  });

  it("denies when the mapping allows only roles the user does not hold", () => {
    const decision = evaluateCapability({
      system: "customer",
      capability: "billing.view",
      orgId: TENANT,
      roleIds: [ENGINEER],
      mappings: [mapping({ capabilityKey: "billing.view", orgId: TENANT, allow: [BILLING_CONTACT, OWNER] })],
    });

    expect(decision.effect).toBe("unset");
  });
});

describe("fail closed", () => {
  it("denies an uncatalogued capability even when a mapping row allows it", () => {
    const decision = evaluateCapability({
      system: "customer",
      capability: "billing.viwe", // typo — exactly the #1698 case
      orgId: TENANT,
      roleIds: [BILLING_CONTACT],
      mappings: [mapping({ capabilityKey: "billing.viwe", orgId: TENANT, allow: [BILLING_CONTACT] })],
    });

    expect(decision.allowed).toBe(false);
    expect(decision.effect).toBe("unknown-capability");
  });

  it("treats a capability key as belonging to ONE system — the pair is the identity", () => {
    // `billing.view` is catalogued for the customer system and NOT for the MSP
    // system, so asking for it on the MSP side is an unknown capability, not a
    // silent cross-system grant.
    const asked = (system: RbacSystem) =>
      evaluateCapability({
        system,
        capability: "billing.view",
        orgId: TENANT,
        roleIds: [BILLING_CONTACT],
        mappings: [{ system, capabilityKey: "billing.view", orgId: TENANT, allow: [BILLING_CONTACT], deny: [] }],
      });

    expect(asked("customer").effect).toBe("allow");
    expect(asked("msp").effect).toBe("unknown-capability");
  });

  it("ignores a mapping row belonging to another system", () => {
    const decision = evaluateCapability({
      system: "customer",
      capability: "team.manage",
      orgId: TENANT,
      roleIds: [OWNER],
      mappings: [{ system: "msp", capabilityKey: "team.manage", orgId: TENANT, allow: [OWNER], deny: [] }],
    });

    expect(decision.effect).toBe("unset");
  });

  it("ignores a mapping row belonging to another org — no cross-tenant grant", () => {
    const decision = evaluateCapability({
      system: "customer",
      capability: "billing.view",
      orgId: TENANT,
      roleIds: [BILLING_CONTACT],
      mappings: [mapping({ capabilityKey: "billing.view", orgId: OTHER_TENANT, allow: [BILLING_CONTACT] })],
    });

    expect(decision.effect).toBe("unset");
  });

  it("ignores another org's DENY too — a foreign row decides nothing, in either direction", () => {
    const decision = evaluateCapability({
      system: "customer",
      capability: "billing.view",
      orgId: TENANT,
      roleIds: [BILLING_CONTACT],
      mappings: [
        mapping({ capabilityKey: "billing.view", orgId: TENANT, allow: [BILLING_CONTACT] }),
        mapping({ capabilityKey: "billing.view", orgId: OTHER_TENANT, deny: [BILLING_CONTACT] }),
      ],
    });

    expect(decision.effect).toBe("allow");
  });

  it("ignores a mapping row for a different capability", () => {
    const decision = evaluateCapability({
      system: "customer",
      capability: "billing.view",
      orgId: TENANT,
      roleIds: [BILLING_CONTACT],
      mappings: [mapping({ capabilityKey: "changes.approve", orgId: TENANT, allow: [BILLING_CONTACT] })],
    });

    expect(decision.effect).toBe("unset");
  });
});

describe("role id handling", () => {
  it("matches ids case-insensitively and ignores surrounding whitespace", () => {
    const decision = evaluateCapability({
      system: "customer",
      capability: "billing.view",
      orgId: TENANT,
      roleIds: [` ${BILLING_CONTACT.toUpperCase()} `],
      mappings: [mapping({ capabilityKey: "billing.view", orgId: TENANT, allow: [BILLING_CONTACT] })],
    });

    expect(decision.allowed).toBe(true);
  });

  it("still denies when the DENY entry is the differently-cased one", () => {
    const decision = evaluateCapability({
      system: "customer",
      capability: "billing.view",
      orgId: TENANT,
      roleIds: [BILLING_CONTACT],
      mappings: [mapping({ capabilityKey: "billing.view", orgId: TENANT, allow: [BILLING_CONTACT], deny: [BILLING_CONTACT.toUpperCase()] })],
    });

    expect(decision.effect).toBe("deny");
  });

  it("tolerates a duplicated or empty id in the jsonb payload", () => {
    const decision = evaluateCapability({
      system: "customer",
      capability: "billing.view",
      orgId: TENANT,
      roleIds: [BILLING_CONTACT, BILLING_CONTACT, ""],
      mappings: [mapping({ capabilityKey: "billing.view", orgId: TENANT, allow: [BILLING_CONTACT, BILLING_CONTACT, ""] })],
    });

    expect(decision.allowed).toBe(true);
    expect(decision.decidedBy).toEqual([BILLING_CONTACT]);
  });
});

describe("createRbacEvaluator", () => {
  const context = {
    system: "customer" as const,
    userId: 99,
    orgId: TENANT,
    roleIds: [ENGINEER],
    mappings: [
      mapping({ capabilityKey: "billing.view", orgId: TENANT, deny: [ENGINEER] }),
      mapping({ capabilityKey: "changes.approve", orgId: TENANT, allow: [ENGINEER] }),
      mapping({ capabilityKey: "team.manage", orgId: TENANT, allow: [OWNER] }),
    ],
  };

  it("answers many questions off one snapshot", () => {
    const evaluator = createRbacEvaluator(context);

    expect(evaluator.can("changes.approve")).toBe(true);
    expect(evaluator.can("billing.view")).toBe(false);
    expect(evaluator.decide("billing.view").effect).toBe("deny");
    expect(evaluator.can("team.manage")).toBe(false);
  });

  it("lists only the capabilities that actually resolve to allowed", () => {
    expect(createRbacEvaluator(context).grantedCapabilities()).toEqual(["changes.approve"]);
  });

  it("keeps the context it was built from, so a decision can be explained later", () => {
    expect(createRbacEvaluator(context).context.roleIds).toEqual([ENGINEER]);
  });
});
