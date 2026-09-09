/**
 * Today's authorization model, transcribed (#2457, part of #1696).
 *
 * Migration step 2 of 5. #2455 landed the tables and the evaluator; this module
 * is the OTHER half of what step 2 needs — an exact, citable statement of the
 * rules the running product enforces right now, so that "the new model produces
 * the same answer" is a claim something can actually be run against.
 *
 * Nothing here is a design. Every rule below is a literal transcription of code
 * that is live on `main`, cited to file:line, and every one of them was read
 * before it was written down. Where the live rule is odd — `ServiceAccount`
 * outranking a human `CustomerUser`, `role === "admin"` silently promoting to
 * `PlatformAdmin`, one capability column that ORs across every role and another
 * that only fires for one rung — the oddity is carried across deliberately
 * rather than tidied up. Tidying it here would mean the comparison script proves
 * agreement with a model that was never running.
 *
 * Two consumers:
 *   - `parity-check.ts` — the acceptance test. Old decision (this file, against
 *     the real `users` row) vs new decision (the #2455 evaluator, against the
 *     real seeded rows), for every real user and every catalogued capability.
 *   - #2458 — moving `requireRole`'s decision source onto the evaluator needs
 *     `ladderCapabilityKey()` to know which capability a `requireRole("X")` call
 *     site is actually asking about.
 *
 * PURE. No database, no imports from the schema — the point is that it can be
 * read and checked against `requireAuth.ts` by eye.
 */

/**
 * `ROLE_ORDER` from `artifacts/api-server/src/middlewares/requireAuth.ts:80-88`,
 * copied exactly, including the order.
 *
 * Higher index = higher privilege, and every check is "your index >= the required
 * index" — which is why this is a ladder and not RBAC: every role is a strict
 * superset of the one below it, so there is no permission a lower rung has that a
 * higher rung lacks. `ServiceAccount` sitting ABOVE `CustomerUser` means a machine
 * credential outranks a human customer for every `requireRole` check. That is an
 * artifact of jamming account type into the same ordering as privilege level
 * (#1696), not a decision anyone made — and it is transcribed as-is.
 */
export const LEGACY_ROLE_ORDER = [
  "Assessment",
  "Free",
  "CustomerUser",
  "ServiceAccount",
  "MSPOperator",
  "MSPAdmin",
  "PlatformAdmin",
] as const;

export type LegacyRole = typeof LEGACY_ROLE_ORDER[number];

const LEGACY_ROLE_SET: ReadonlySet<string> = new Set(LEGACY_ROLE_ORDER);

/** True for the seven `MSP_ROLES` values and nothing else. */
export function isLegacyRole(value: string | null | undefined): value is LegacyRole {
  return typeof value === "string" && LEGACY_ROLE_SET.has(value);
}

/**
 * `roleIndex()` from `requireAuth.ts:89-92`, including its -1 for an absent or
 * unrecognised role — which denies every floor, because every floor in the
 * codebase is a real rung with index >= 0.
 */
export function legacyRoleIndex(role: string | null | undefined): number {
  if (!role) return -1;
  return (LEGACY_ROLE_ORDER as readonly string[]).indexOf(role);
}

/**
 * The subset of a `users` row that any of today's rules actually reads.
 *
 * `role` is the legacy two-value column (`"admin" | "client"`), NOT the MSP role.
 * All three capability columns are here: the issue body names two, but the
 * database carries three — `can_approve_changes` (#1496) was added after #1696
 * was written. Carrying two of three forward would be exactly the "gap" the
 * issue's own contract forbids.
 */
export interface LegacyUserRow {
  readonly id: number;
  readonly role: string;
  readonly mspRole: string | null;
  readonly mspId: number | null;
  readonly tenantId: number | null;
  readonly canApprovePurchases: boolean;
  readonly canManageTeam: boolean;
  readonly canApproveChanges: boolean;
}

/**
 * `requireAuth.ts:210-212` — *"Legacy admin users (role === 'admin') treated as
 * PlatformAdmin."*
 *
 * #1696 is explicit that this promotion *"must be carried across deliberately
 * rather than inherited by accident."* It is the one place the old model grants
 * the top of the ladder from a column that is not `msp_role`, so the seed reads
 * the effective role through this function rather than `msp_role` directly.
 */
export function effectiveLegacyRole(user: Pick<LegacyUserRow, "role" | "mspRole">): LegacyRole | undefined {
  const effective = user.role === "admin" ? "PlatformAdmin" : user.mspRole;
  return isLegacyRole(effective) ? effective : undefined;
}

/** `requireRole(minimum)` from `requireAuth.ts:205-223`, minus the HTTP plumbing. */
export function legacyRequireRole(user: Pick<LegacyUserRow, "role" | "mspRole">, minimum: LegacyRole): boolean {
  return legacyRoleIndex(effectiveLegacyRole(user)) >= legacyRoleIndex(minimum);
}

// ── The ladder, expressed as capability keys ──────────────────────────────────

/**
 * Capability-key prefix for the transitional "passes `requireRole(X)`" rungs.
 *
 * One capability per rung, so the ladder becomes ordinary data the #2455
 * evaluator can answer without knowing anything about ordering — the allow set of
 * `ladder.MSPAdmin` is simply {MSPAdmin, PlatformAdmin}, which is what
 * `roleIndex >= roleIndex("MSPAdmin")` evaluates to, enumerated.
 *
 * These seven live in the **msp** system, not the customer one, even though three
 * of the rungs name customer-facing tiers. `requireRole` is a single gate over the
 * whole `MspRole` enum and is the only thing that reads these keys; splitting them
 * across two systems would mean one `requireRole` call site needing two evaluators
 * to answer it. The customer system gets its own copies of the seven ROLES (a
 * customer-side capability like `team.manage` genuinely does branch on MSP tier
 * today) but not of these capabilities.
 *
 * Transitional by construction: #2460 retires `MSP_ROLES`, and these go with it.
 */
export const LADDER_CAPABILITY_PREFIX = "ladder.";

/**
 * Rung → capability key, written out rather than derived.
 *
 * The catalog's key convention is lowercase dotted/kebab
 * (`capabilities.test.ts` enforces it), and `MSPAdmin` has no unambiguous
 * mechanical lowercasing — `msp-admin` and `mspadmin` are both defensible, and a
 * regex that guesses would be a silent way to end up with two spellings of the
 * same authority. #2458 has to turn a `requireRole("MSPAdmin")` call site into a
 * capability key with no room for doubt, so the pairs are stated once, here, and
 * `legacy-ladder.test.ts` asserts the mapping is total and injective.
 */
export const LADDER_CAPABILITY_KEYS: Readonly<Record<LegacyRole, string>> = Object.freeze({
  Assessment: "ladder.assessment",
  Free: "ladder.free",
  CustomerUser: "ladder.customer-user",
  ServiceAccount: "ladder.service-account",
  MSPOperator: "ladder.msp-operator",
  MSPAdmin: "ladder.msp-admin",
  PlatformAdmin: "ladder.platform-admin",
});

/** The capability that means "passes `requireRole(<role>)`". */
export function ladderCapabilityKey(role: LegacyRole): string {
  return LADDER_CAPABILITY_KEYS[role];
}

const LADDER_ROLE_BY_KEY: ReadonlyMap<string, LegacyRole> = new Map(
  (Object.entries(LADDER_CAPABILITY_KEYS) as Array<[LegacyRole, string]>).map(([role, key]) => [key, role]),
);

/** Inverse of `ladderCapabilityKey`, or undefined if this is not a ladder key. */
export function ladderCapabilityRole(key: string): LegacyRole | undefined {
  return LADDER_ROLE_BY_KEY.get(key);
}

/**
 * Catalog label/description for a rung. Formulaic on purpose: the seed migration
 * builds the identical strings in SQL from the same ladder, so the TS catalog and
 * the `rbac_capabilities` table cannot disagree about what a rung means.
 */
export function ladderCapabilityLabel(role: LegacyRole): string {
  return `Passes requireRole("${role}")`;
}

export function ladderCapabilityDescription(role: LegacyRole): string {
  return (
    `Transitional transcription of the ROLE_ORDER ladder in ` +
    `artifacts/api-server/src/middlewares/requireAuth.ts:80-93 — true exactly when ` +
    `roleIndex(effective role) >= roleIndex("${role}"). Seeded as data by #2457, read by ` +
    `#2458 when requireRole's decision source moves onto the evaluator, retired with ` +
    `MSP_ROLES by #2460.`
  );
}

export const LADDER_CAPABILITY_CATEGORY = "legacy-ladder";

// ── The capability columns and the surfaces they gate ─────────────────────────

/**
 * One of today's real authorization rules, in a form the comparison script can
 * run. `source` is the code this was transcribed from — verify by reading it.
 *
 * `decide` deliberately covers ONLY the privilege half of a route's gate. Tenant
 * isolation (`assertCustomerAccess`), add-on entitlement
 * (`requireAddOnEntitlement`) and separation-of-duties checks in the store are
 * orthogonal concerns that the new model does not replace and #2458 does not
 * touch; folding them in here would compare the capability against something it
 * was never meant to answer.
 */
export interface LegacyCapabilityRule {
  readonly system: "msp" | "customer";
  readonly key: string;
  readonly source: string;
  decide(user: LegacyUserRow): boolean;
}

/**
 * Every catalogued capability's rule as it stands today, ladder rungs included.
 *
 * The comparison script iterates this against every real user, so a capability
 * missing from here is a capability that goes unproven — `parity-check.ts`
 * asserts this list covers the catalog exactly, in both directions.
 */
export const LEGACY_CAPABILITY_RULES: readonly LegacyCapabilityRule[] = Object.freeze([
  ...LEGACY_ROLE_ORDER.map((role): LegacyCapabilityRule => ({
    system: "msp",
    key: ladderCapabilityKey(role),
    source: "artifacts/api-server/src/middlewares/requireAuth.ts:80-93, 205-223",
    decide: (user) => legacyRequireRole(user, role),
  })),

  {
    system: "msp",
    key: "purchases.approve",
    source: "artifacts/api-server/src/routes/msp-v1.ts:337-351",
    /**
     * *"MSPAdmin and PlatformAdmin (legacy role: admin) can always decide.
     * MSPOperator needs canApprovePurchases = true."*
     *
     * Note what this is NOT: it is not "any role, plus the flag". A CustomerUser
     * carrying `can_approve_purchases` is denied today, and a ServiceAccount
     * carrying it is denied today, because the flag is only consulted on the
     * MSPOperator branch. The seed therefore grants the flag-carrying role to
     * MSPOperators only — a column that grants nothing is not a grant to carry
     * forward.
     */
    decide: (user) => {
      const effective = effectiveLegacyRole(user);
      if (effective === "PlatformAdmin" || effective === "MSPAdmin") return true;
      return effective === "MSPOperator" && user.canApprovePurchases;
    },
  },
  {
    system: "msp",
    key: "team.manage",
    source: "artifacts/api-server/src/routes/msp-settings.ts:559-1050, 1680-1830",
    /**
     * Managing the MSP's own staff — `/msp/settings/users/*` and
     * `/msp/settings/invites*` — is `requireRole("MSPAdmin")` on every route,
     * with no capability column beside it. So this is the MSPAdmin rung exactly,
     * and the seeded allow set is identical to `ladder.MSPAdmin`'s by design.
     */
    decide: (user) => legacyRequireRole(user, "MSPAdmin"),
  },

  {
    system: "customer",
    key: "team.manage",
    source: "artifacts/api-server/src/routes/portal-team.ts:40-54 (denyIfCannotManageTeam)",
    /**
     * *"a customer-tier user (CustomerUser/Free/Assessment) must ADDITIONALLY
     * carry the live `canManageTeam` flag. MSP staff (MSPAdmin/MSPOperator) and
     * PlatformAdmin manage customer teams by virtue of their role."*
     *
     * The live test is `isCustomerTier`, not a rung comparison — so `ServiceAccount`
     * passes without the flag, because it is not one of the three tiers named. That
     * is the ladder artifact #1696 records, and it is transcribed rather than
     * corrected.
     */
    decide: (user) => {
      const effective = effectiveLegacyRole(user);
      const isCustomerTier =
        effective === "CustomerUser" || effective === "Free" || effective === "Assessment";
      if (!isCustomerTier) return true;
      return user.canManageTeam;
    },
  },
  {
    system: "customer",
    key: "changes.approve",
    source: "artifacts/api-server/src/routes/portal-change-control.ts:493-506 (callerCanApproveChanges)",
    /**
     * *"MSP staff and PlatformAdmin approve by role and are not subject to the
     * per-user flag."* — an explicit three-role list, then the flag for everyone
     * else.
     *
     * Deliberately different from `customer:team.manage` above in two ways, both
     * real: `ServiceAccount` is NOT on the role list here (so it needs the flag),
     * and the flag path is open to every remaining role rather than to the
     * customer tier only. Two columns that look symmetrical in the schema are not
     * symmetrical in the code, which is precisely the kind of divergence a
     * one-boolean-per-permission model produces.
     */
    decide: (user) => {
      const effective = effectiveLegacyRole(user);
      if (effective === "MSPAdmin" || effective === "MSPOperator" || effective === "PlatformAdmin") {
        return true;
      }
      return user.canApproveChanges;
    },
  },
  {
    system: "customer",
    key: "billing.view",
    source: "artifacts/api-server/src/routes/portal-billing.ts:60-513 (requireAuth only)",
    /**
     * Every billing route in that file is `requireAuth` and nothing else, so today
     * the answer is "yes" for every authenticated principal — the tenant scoping
     * inside each handler limits WHICH invoices are returned, not WHO may ask.
     *
     * This is the capability #1696 was actually filed about (*"the customer needs
     * RBAC to stop say an engineer from seeing billing"*). Transcribing it as
     * "everyone" is the honest statement of today, not an endorsement: narrowing
     * it is a real product change that belongs to the step which moves the route
     * onto the evaluator, not to a step whose entire contract is that nothing
     * observable changes.
     */
    decide: () => true,
  },
]);

const RULES_BY_ID: ReadonlyMap<string, LegacyCapabilityRule> = new Map(
  LEGACY_CAPABILITY_RULES.map((rule) => [`${rule.system}:${rule.key}`, rule]),
);

/**
 * Today's answer for one user and one capability.
 *
 * Throws on an uncatalogued pair rather than defaulting: this function exists to
 * be the reference side of an equality proof, and a reference that quietly
 * returns `false` for a key it does not know would turn a missing rule into a
 * passing comparison.
 */
export function legacyDecision(user: LegacyUserRow, system: "msp" | "customer", capability: string): boolean {
  const rule = RULES_BY_ID.get(`${system}:${capability}`);
  if (!rule) {
    throw new Error(
      `legacyDecision: no transcribed rule for ${system}:${capability}. ` +
        `Every catalogued capability needs one in LEGACY_CAPABILITY_RULES, or the ` +
        `old-vs-new comparison silently skips it.`,
    );
  }
  return rule.decide(user);
}

// ── Role keys used by the seed ────────────────────────────────────────────────

/**
 * The `*_roles.key` of the role that carries one capability column's grant.
 *
 * A dedicated role per column is the faithful shape: the column grants exactly
 * one capability to exactly the users who carry it, which is a role with one
 * member set and one mapping. Once the model is live these become ordinary
 * editable roles — which is the point of the redesign, since a column can never
 * be "granted to everyone holding the Engineer role."
 */
export const CAPABILITY_COLUMN_ROLE_KEYS = Object.freeze({
  /** users.can_approve_purchases, granted only where it actually grants today. */
  approvePurchases: "cap.purchases.approve",
  /** users.can_manage_team. */
  manageTeam: "cap.team.manage",
  /** users.can_approve_changes (#1496). */
  approveChanges: "cap.changes.approve",
});
