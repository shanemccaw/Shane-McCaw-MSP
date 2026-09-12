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
 * outranking a human `Customer`, `role === "admin"` silently promoting to
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
 * higher rung lacks. `ServiceAccount` sitting ABOVE `Customer` means a machine
 * credential outranks a human customer for every `requireRole` check. That is an
 * artifact of jamming account type into the same ordering as privilege level
 * (#1696), not a decision anyone made — and it is transcribed as-is.
 *
 * #3590 changed two rungs by product decision, not by transcription: `CustomerUser`
 * is renamed `Customer`, and the old bottom rung `Assessment` is folded into `Free`.
 * Six rungs now; see `RETIRED_ROLE_VALUES` below.
 */
export const LEGACY_ROLE_ORDER = [
  "Free",
  "Customer",
  "ServiceAccount",
  "MSPOperator",
  "MSPAdmin",
  "PlatformAdmin",
] as const;

export type LegacyRole = typeof LEGACY_ROLE_ORDER[number];

/**
 * #3590 — two role values that no longer exist, and what each one became.
 *
 * Product decision, Shane 2026-09-11: `CustomerUser` is renamed `Customer` (the one
 * paid-customer rung), and `Assessment` is folded into `Free` — one pre-payment tier,
 * not two. Before this, the only place the two pre-payment tiers disagreed was the
 * marketplace/search catalog scope, and that now asks a capability
 * (`customer:marketplace.browse-full`) instead of comparing a role string.
 *
 * `2026-09-11-rbac-customer-free-roles-3590.sql` rewrites every stored value, so no
 * `users` row carries either spelling after it runs. What can still carry one is a
 * JWT signed before the deploy — access tokens live 15 minutes, impersonation tokens
 * 30 — and `canonicalRoleValue` maps those onto the value they now mean, so a session
 * straddling the deploy is decided as the role it actually holds rather than as no role
 * at all. Retire this with the claim itself.
 */
export const RETIRED_ROLE_VALUES: Readonly<Record<string, LegacyRole>> = Object.freeze({
  CustomerUser: "Customer",
  Assessment: "Free",
});

/** A role value as it should be read today: a retired spelling becomes what it was renamed to. */
export function canonicalRoleValue<T extends string | null | undefined>(value: T): T | LegacyRole {
  if (typeof value === "string" && Object.prototype.hasOwnProperty.call(RETIRED_ROLE_VALUES, value)) {
    return RETIRED_ROLE_VALUES[value]!;
  }
  return value;
}

/**
 * The seven role values by name — #2460's single home for the strings themselves.
 *
 * #2460's contract is mechanical: `grep -rn '"MSPAdmin"\|"MSPOperator"\|...' artifacts/ lib/`
 * must return nothing outside this shim. That is not a spelling exercise. Before
 * this, ~100 files each carried a hardcoded authorization or tenancy decision as a
 * bare string, which is precisely what #1696 records as the failure — *"every one of
 * those is a hardcoded authorization decision that a database-driven model is
 * supposed to own."* Anything that is genuinely a route GATE now names a capability
 * (see `LADDER` below) and asks the database. What legitimately remains is the role
 * as a VALUE — the thing stored in `users.msp_role`, compared when deciding which
 * ORG BOUNDARY a principal sits on, written by a seed, or asserted by a test — and
 * those reference it from here.
 *
 * The distinction is #1696's own axis separation: tenancy ("whose org do you belong
 * to") and account type are legitimately still read off this column; permission
 * ("what may you do") is not, and every remaining permission read was moved onto the
 * evaluator by #2458/#2460.
 */
export const LEGACY_ROLE = Object.freeze({
  free: "Free",
  customer: "Customer",
  serviceAccount: "ServiceAccount",
  mspOperator: "MSPOperator",
  mspAdmin: "MSPAdmin",
  platformAdmin: "PlatformAdmin",
} as const satisfies Record<string, LegacyRole>);

/**
 * MSP-side staff, as a value set: the two rungs that mean "works for the MSP".
 *
 * Deliberately NOT `ServiceAccount` and NOT `PlatformAdmin` — several real call
 * sites want exactly these two and nothing else (customer scoping, staff pickers,
 * invite roles). Sites that want a different set build their own from `LEGACY_ROLE`
 * rather than bending this one.
 */
export const LEGACY_MSP_STAFF_ROLES = Object.freeze([
  LEGACY_ROLE.mspAdmin,
  LEGACY_ROLE.mspOperator,
] as const);

/**
 * The customer-facing tiers, as a value set — the paid `Customer` rung and the one
 * pre-payment `Free` rung (#3590 folded `Assessment` into `Free`).
 *
 * `portal-team.ts`'s live rule tests membership of exactly these (which is why
 * `ServiceAccount` passes it without a flag — the ladder artifact #1696 records).
 */
export const LEGACY_CUSTOMER_TIER_ROLES = Object.freeze([
  LEGACY_ROLE.customer,
  LEGACY_ROLE.free,
] as const);

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
  /**
   * #3629 — membership of the two platform-default customer roles
   * (`CUSTOMER_PLATFORM_ROLE_KEYS`). Neither has a `users` column behind it: the
   * `customer_user_roles` row IS the grant, so these are read from there, not from
   * `users`. Optional, and absent reads as "holds neither".
   */
  readonly customerAdmin?: boolean;
  readonly billingRole?: boolean;
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
  // canonicalRoleValue: a pre-#3590 claim ("CustomerUser"/"Assessment") is read as
  // the rung it was renamed to, not as an unrecognised value that holds nothing.
  const effective = user.role === "admin" ? "PlatformAdmin" : canonicalRoleValue(user.mspRole);
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
 *
 * #3590 — `Customer` keeps the key `ladder.customer-user`. The rung was renamed from
 * `CustomerUser`, but a capability key is *"Immutable once shipped"*
 * (capabilities.ts): it is what 40+ route gates and the `msp_feature_role_mapping`
 * row both name, and an admin edit made to that row through AdminV2 must survive a
 * role rename. Renaming a ROLE is free precisely because nothing stores its name —
 * the key half of that bargain is that capability keys do not move. `Assessment`'s
 * key, `ladder.assessment`, is retired with the rung; its gates now ask `ladder.free`,
 * which after the merge admits exactly the set `ladder.assessment` did.
 */
export const LADDER_CAPABILITY_KEYS: Readonly<Record<LegacyRole, string>> = Object.freeze({
  Free: "ladder.free",
  Customer: "ladder.customer-user",
  ServiceAccount: "ladder.service-account",
  MSPOperator: "ladder.msp-operator",
  MSPAdmin: "ladder.msp-admin",
  PlatformAdmin: "ladder.platform-admin",
});

/** The capability that means "clears the `<role>` floor". */
export function ladderCapabilityKey(role: LegacyRole): string {
  return LADDER_CAPABILITY_KEYS[role];
}

/**
 * The seven ladder capability keys, by name — what a route gate actually names.
 *
 * `requireCapability(LADDER.mspAdmin)` reads as *"this route needs whatever the
 * `ladder.msp-admin` row says"*, and that row is editable. It is deliberately NOT
 * an alias for the role: two roles can be granted the same capability, one role can
 * be granted several, and neither is expressible against a rung. The keys are also
 * written out literally at most call sites (`"ladder.msp-admin"`) — they are real
 * row keys in `msp_feature_role_mapping`, and
 * `artifacts/api-server/src/middlewares/requireCapability-keys.test.ts` asserts
 * mechanically that every literal reaching `requireCapability` is catalogued, so a
 * typo on an authorization path cannot ship silently.
 */
export const LADDER = Object.freeze({
  free: LADDER_CAPABILITY_KEYS.Free,
  customer: LADDER_CAPABILITY_KEYS.Customer,
  serviceAccount: LADDER_CAPABILITY_KEYS.ServiceAccount,
  mspOperator: LADDER_CAPABILITY_KEYS.MSPOperator,
  mspAdmin: LADDER_CAPABILITY_KEYS.MSPAdmin,
  platformAdmin: LADDER_CAPABILITY_KEYS.PlatformAdmin,
} as const);

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
    `artifacts/api-server/src/middlewares/requireAuth.ts:115-123, 135-138 as of 3dddd4b26^ ` +
    `(ROLE_ORDER, roleIndex, pre-#2460) — true exactly when ` +
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
/**
 * #3629 — who holds `customer:billing.view` and `customer:billing.manage`.
 *
 * Shane's decision of 2026-09-11 (resolving #3587): the Customer Admin and Billing
 * roles, plus MSP staff. The staff rungs are the same set `customer:changes.approve`
 * lets act by role — every existing customer capability lets MSP staff act on a
 * customer's behalf — and on today's handlers the grant is inert, because every
 * portal billing route reads the caller's OWN rows (`clientUserId = req.user.id`).
 * `Free`, `Customer` and `ServiceAccount` hold neither capability by rung any more;
 * no capability COLUMN grants it either.
 */
function billingDecision(user: LegacyUserRow): boolean {
  const effective = effectiveLegacyRole(user);
  if (
    effective === LEGACY_ROLE.mspOperator ||
    effective === LEGACY_ROLE.mspAdmin ||
    effective === LEGACY_ROLE.platformAdmin
  ) {
    return true;
  }
  return user.customerAdmin === true || user.billingRole === true;
}

export const LEGACY_CAPABILITY_RULES: readonly LegacyCapabilityRule[] = Object.freeze([
  ...LEGACY_ROLE_ORDER.map((role): LegacyCapabilityRule => ({
    system: "msp",
    key: ladderCapabilityKey(role),
    source:
      "artifacts/api-server/src/middlewares/requireAuth.ts:115-123, 135-138 as of 3dddd4b26^ (ROLE_ORDER, roleIndex, pre-#2460)",
    decide: (user) => legacyRequireRole(user, role),
  })),

  {
    system: "msp",
    key: "purchases.approve",
    source:
      "artifacts/api-server/src/routes/msp-v1.ts:336-350 as of 2868efa79^ (decision authorization block, pre-#2460)",
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
    source: "artifacts/api-server/src/routes/portal-team.ts:40-56 as of 2868efa79^ (denyIfCannotManageTeam, pre-#2460)",
    /**
     * *"a customer-tier user (CustomerUser/Free/Assessment) must ADDITIONALLY
     * carry the live `canManageTeam` flag. MSP staff (MSPAdmin/MSPOperator) and
     * PlatformAdmin manage customer teams by virtue of their role."* — since #3590
     * those tiers are `Customer` and `Free`.
     *
     * The old test was `isCustomerTier`, not a rung comparison — so `ServiceAccount`
     * passes without the flag, because it is not one of the three tiers named. That
     * is the ladder artifact #1696 records, and it is transcribed rather than
     * corrected.
     *
     * The same allow-list is why an UNRECOGNISED role passed too (#3360). That half
     * is not carried into the seed, and since #2460 the live route reads the seeded
     * row instead of this rule, so it denies that principal. This rule is the old
     * behaviour, kept verbatim as parity-check.ts's oracle.
     *
     * #3629 adds one grant by decision: the Customer Admin role holds this too.
     */
    decide: (user) => {
      const effective = effectiveLegacyRole(user);
      const isCustomerTier = effective === LEGACY_ROLE.customer || effective === LEGACY_ROLE.free;
      if (!isCustomerTier) return true;
      return user.canManageTeam || user.customerAdmin === true;
    },
  },
  {
    system: "customer",
    key: "marketplace.browse-full",
    source: "artifacts/api-server/src/routes/portal-marketplace.ts:69-74 and portal-customer-search.ts:71-73, pre-#3590 (serviceTypesForRole)",
    /**
     * Both routes narrowed their catalog with `role === "Assessment" ? ASSESSMENT_SERVICE_TYPES
     * : CUSTOMER_SERVICE_TYPES`, where `role` was `role === "admin" ? PlatformAdmin : mspRole`
     * — the raw claim, never validated against the ladder. #3590 folded `Assessment` into
     * `Free`, so the one pre-payment tier is the one that gets the narrow catalog, and every
     * other value gets the full one.
     *
     * Transcribed verbatim, which includes a value the ladder does not recognise: it is
     * not the pre-payment tier, so the old comparison handed it the full catalog. The seed
     * does not carry that forward — a principal holding no rung holds no role row and is
     * denied (the same #3360 shape parity-check.ts registers for team.manage).
     *
     * #3629 adds one grant by decision: the Customer Admin role holds this on any rung.
     */
    decide: (user) => {
      const role = user.role === "admin" ? LEGACY_ROLE.platformAdmin : canonicalRoleValue(user.mspRole);
      return role !== LEGACY_ROLE.free || user.customerAdmin === true;
    },
  },
  {
    system: "customer",
    key: "changes.approve",
    source:
      "artifacts/api-server/src/routes/portal-change-control.ts:494-507 as of 548e42b04 (callerCanApproveChanges, pre-#3629 column read)",
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
     *
     * #3629 adds one grant by decision: the Customer Admin role holds this too, and
     * the route now asks the evaluator (callerChangeApproval) rather than the column,
     * so that grant is honoured live.
     */
    decide: (user) => {
      const effective = effectiveLegacyRole(user);
      if (effective === "MSPAdmin" || effective === "MSPOperator" || effective === "PlatformAdmin") {
        return true;
      }
      return user.canApproveChanges || user.customerAdmin === true;
    },
  },
  {
    system: "customer",
    key: "billing.view",
    source:
      "artifacts/api-server/src/routes/portal-billing.ts:61-80 (requireCustomerCapability, #3465); holders decided by #3629",
    /**
     * Until #3465 every billing route in that file was `requireAuth` and nothing
     * else, so the answer was "yes" for every authenticated principal. #3465 moved
     * the reads onto this capability WITHOUT narrowing it, and this rule was
     * `() => true`.
     *
     * #3629 narrowed it by product decision (Shane, 2026-09-11, resolving #3587) —
     * not a transcription, the same way #3590's marketplace rule is not. See
     * `billingDecision` for who holds it now.
     */
    decide: (user) => billingDecision(user),
  },
  {
    system: "customer",
    key: "billing.manage",
    source:
      "artifacts/api-server/src/routes/portal-billing.ts:61-80 (requireCustomerCapability, #3465); holders decided by #3629",
    /**
     * The write half of the same surface — pay an invoice, cancel / resume /
     * re-subscribe a subscription, open the Stripe customer portal, and
     * portal-retainer-billing.ts's interval switch. #3465 split it from
     * `billing.view` so a role can SEE billing without being able to spend.
     *
     * #3629's two roles each hold both halves, so today the two rules are equal; an
     * org that wants a view-only role builds it through its own mapping rows.
     */
    decide: (user) => billingDecision(user),
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

/**
 * #3629 — the `customer_roles.key` of the two platform-default customer roles that
 * are a product decision rather than a transcription (Shane, 2026-09-11, resolving
 * #3587). Seeded by `2026-09-11-rbac-customer-admin-billing-roles-3629.sql`.
 *
 * Unlike the `cap.*` roles above, neither carries a `users` column — membership in
 * `customer_user_roles` is the grant — and each holds several capabilities:
 *
 *  - `customerAdmin` — the top of a customer org, parallel to MSPAdmin: every
 *    customer-system capability (billing.view/manage, team.manage, changes.approve,
 *    marketplace.browse-full).
 *  - `billing` — billing.view + billing.manage only, assigned by a Customer Admin
 *    to specific employees. The migration's trigger also grants it to whoever an
 *    invoice or client service is addressed to, because the billing routes read the
 *    caller's own rows.
 */
export const CUSTOMER_PLATFORM_ROLE_KEYS = Object.freeze({
  customerAdmin: "customer-admin",
  billing: "billing",
});
