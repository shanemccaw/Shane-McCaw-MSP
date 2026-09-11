/**
 * The RBAC capability rows, as `middlewares/rbac-capability-source.ts` returns them (#2460).
 *
 * The exact counterpart of ./rbac-ladder-fixture.ts, for the non-ladder half of the
 * model, and it exists for the same reason: dozens of suites mount a REAL router while
 * mocking `@workspace/db` down to their own route's tables, and the two capability
 * columns #2460 retires were previously readable from those same mocked tables. Once
 * `portal-team.ts` and `msp-v1.ts` started asking the model instead, every one of
 * those suites would fail closed with a 503 on assertions about link building and
 * email templates.
 *
 * ── What it supplies, and what it deliberately does not ────────────────────
 *
 * The shape #2457's seed migration writes, computed from the shim's own constants
 * rather than typed out:
 *
 *   - one platform role per rung, one `cap.*` role per capability column, and #3629's
 *     Customer Admin and Billing roles;
 *   - the `msp:purchases.approve` and `customer:team.manage` allow sets, derived by
 *     asking `LEGACY_CAPABILITY_RULES` — the cited transcription of the live rules —
 *     which rungs pass with no grant, and adding the column's own `cap.*` role. So
 *     these mappings cannot drift from the transcription, and the transcription is
 *     itself pinned against the real rules by `legacy-ladder.test.ts`.
 *
 * It invents no product data: no user, tenant, invoice or finding appears here, and no
 * MEMBERSHIP is granted to anyone. A test that needs a principal to hold a `cap.*`
 * grant declares that itself — the default is that nobody has been granted anything,
 * which is what a fresh database looks like and is the safe direction for a fixture on
 * an authorization path to be wrong in.
 *
 * What this CANNOT do is prove the real rows agree with the real rules. That is
 * `pnpm --filter @workspace/db run check-rbac-parity`, against live Postgres.
 */

import {
  CAPABILITY_COLUMN_ROLE_KEYS,
  CUSTOMER_PLATFORM_ROLE_KEYS,
  LEGACY_CAPABILITY_RULES,
  LEGACY_ROLE_ORDER,
  type LegacyRole,
  type LegacyUserRow,
} from "@workspace/db/rbac/legacy-ladder";
import type { RbacFeatureMapping } from "@workspace/db/rbac/evaluate";
import type { RbacSystem } from "@workspace/db/rbac/capabilities";
import type { RoleRow } from "../middlewares/rbac-capability-source.ts";

const roleId = (system: RbacSystem, key: string): string => `rbac-test-${system}-${key}`;

/**
 * Every non-rung platform role the seeds create, as the principal flag holding it sets.
 * The `cap.*` roles each carry a capability column; #3629's Customer Admin and Billing
 * carry none — the membership row is the grant.
 */
const GRANT_ROLES: ReadonlyArray<{ system: RbacSystem; key: string; holds: Partial<LegacyUserRow> }> = [
  { system: "msp", key: CAPABILITY_COLUMN_ROLE_KEYS.approvePurchases, holds: { canApprovePurchases: true } },
  { system: "customer", key: CAPABILITY_COLUMN_ROLE_KEYS.manageTeam, holds: { canManageTeam: true } },
  { system: "customer", key: CAPABILITY_COLUMN_ROLE_KEYS.approveChanges, holds: { canApproveChanges: true } },
  { system: "customer", key: CUSTOMER_PLATFORM_ROLE_KEYS.customerAdmin, holds: { customerAdmin: true } },
  { system: "customer", key: CUSTOMER_PLATFORM_ROLE_KEYS.billing, holds: { billingRole: true } },
];

/** Every platform role the seed creates, in both systems. */
function platformRoles(system: RbacSystem): RoleRow[] {
  const keys: string[] = [
    ...LEGACY_ROLE_ORDER,
    ...GRANT_ROLES.filter((grant) => grant.system === system).map((grant) => grant.key),
  ];
  return keys.map((key) => ({ id: roleId(system, key), key }));
}

/** A principal holding exactly `rung` and carrying no capability column or grant role. */
function flagless(rung: LegacyRole): LegacyUserRow {
  return {
    id: 1,
    role: "client",
    mspRole: rung,
    mspId: 1,
    tenantId: 1,
    canApprovePurchases: false,
    canManageTeam: false,
    canApproveChanges: false,
  };
}

/**
 * The seed's mapping rows for every NON-ladder capability.
 *
 * A rung is allowed when the transcribed rule already passes it without a grant. A
 * grant role is allowed when holding it turns some rung's refusal into a pass — which
 * is how #2457 seeded each column's `cap.*` role and #3629 seeded Customer Admin and
 * Billing. Both halves come from asking the rule, so the rows cannot drift from it.
 */
function mappingRows(): RbacFeatureMapping[] {
  return LEGACY_CAPABILITY_RULES
    .filter((rule) => !rule.key.startsWith("ladder."))
    .map((rule) => {
      const allow = LEGACY_ROLE_ORDER
        .filter((rung) => rule.decide(flagless(rung)))
        .map((rung) => roleId(rule.system, rung));
      for (const grant of GRANT_ROLES) {
        if (grant.system !== rule.system) continue;
        const unlocks = LEGACY_ROLE_ORDER.some(
          (rung) => !rule.decide(flagless(rung)) && rule.decide({ ...flagless(rung), ...grant.holds }),
        );
        if (unlocks) allow.push(roleId(rule.system, grant.key));
      }
      return {
        system: rule.system,
        capabilityKey: rule.key,
        orgId: null,
        allow,
        deny: [],
      };
    });
}

/** The full replacement module for `middlewares/rbac-capability-source.ts`. */
export function capabilityRowsModule(): Record<string, unknown> {
  const mappings = mappingRows();
  const roles: Record<RbacSystem, RoleRow[]> = {
    msp: platformRoles("msp"),
    customer: platformRoles("customer"),
  };
  /** userId → roleIds. Empty by default; a test grants into it explicitly. */
  const memberships = new Map<number, Set<string>>();

  return {
    readPlatformRoleId: (system: RbacSystem, key: string): Promise<string | null> =>
      Promise.resolve(roles[system].find((r) => r.key === key)?.id ?? null),

    readHeldRoles: (system: RbacSystem, userId: number): Promise<RoleRow[]> => {
      const held = memberships.get(userId);
      if (!held) return Promise.resolve([]);
      return Promise.resolve(roles[system].filter((r) => held.has(r.id)));
    },

    readMappings: (system: RbacSystem, capability: string): Promise<RbacFeatureMapping[]> =>
      Promise.resolve(mappings.filter((m) => m.system === system && m.capabilityKey === capability)),

    readRoleKeys: (system: RbacSystem, roleIds: readonly string[]): Promise<RoleRow[]> =>
      Promise.resolve(roles[system].filter((r) => roleIds.includes(r.id))),

    readRoleMembers: (_system: RbacSystem, roleIds: readonly string[]): Promise<number[]> =>
      Promise.resolve(
        [...memberships.entries()]
          .filter(([, held]) => roleIds.some((id) => held.has(id)))
          .map(([userId]) => userId),
      ),

    // No user table here — a suite asserting on rung-derived recipients supplies its
    // own mock of this module, the same way the ladder's unseeded-path tests do.
    readUsersWithRung: (): Promise<number[]> => Promise.resolve([]),

    readMembersAmong: (_system: RbacSystem, roleId_: string, userIds: readonly number[]): Promise<number[]> =>
      Promise.resolve(userIds.filter((id) => memberships.get(id)?.has(roleId_))),

    writeMembership: (
      _system: RbacSystem,
      userId: number,
      roleId_: string,
      granted: boolean,
    ): Promise<void> => {
      const held = memberships.get(userId) ?? new Set<string>();
      if (granted) held.add(roleId_);
      else held.delete(roleId_);
      memberships.set(userId, held);
      return Promise.resolve();
    },
  };
}
