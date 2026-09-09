/**
 * RBAC evaluation — the single shared decision function (#2455, part of #1696).
 *
 * ONE implementation, used by both identity systems. #1696: *"Two systems, one
 * mechanism. Separate tables and separate UIs, but the capability catalog format,
 * the allow/deny evaluation rules and the enforcement middleware are shared code.
 * If those fork, they drift, and a permission bug in one will not be found by
 * testing the other."* Nothing in this file branches on `system` for anything but
 * matching rows — the customer side and the MSP side resolve through exactly the
 * same code path, so a test of one is a test of both.
 *
 * ── The rules, stated once, deliberately ────────────────────────────────────
 *
 * 1. **DENY WINS.** A user holding one role that allows a capability and another
 *    that denies it is DENIED. #1696 requirement 1: *"Windows resolves this: deny
 *    wins. Pick a rule explicitly and write it down — this is the single largest
 *    source of RBAC bugs, and 'it depends on role order' is not an answer."*
 *    Nothing here reads role order, array order or row order; the decision is a
 *    set intersection, so it is identical under any permutation of the inputs.
 *
 * 2. **Deny wins ACROSS scopes too.** A capability can be mapped twice: once by a
 *    platform-default row (orgId null, applying to every org) and once by that
 *    org's own override row. The two are merged — union of allows, union of
 *    denies — and rule 1 then applies to the merged sets. An org override can
 *    therefore GRANT something the platform default left unset, but it can never
 *    un-deny a platform deny. That direction is chosen on purpose: the platform
 *    deny is the stronger statement, and letting a tenant-editable row overturn it
 *    would make the platform default advisory rather than a floor.
 *
 * 3. **Default deny.** No matching allow is a denial (`unset`), not a fallthrough.
 *
 * 4. **An uncatalogued capability is a denial** (`unknown-capability`), never an
 *    allow. A typo'd route requirement, or a mapping row left behind by a deleted
 *    catalog entry, is a bug — and a bug on an authorization path must fail closed.
 *
 * 5. **Roles are compared by stable id, never by name.** #1696 requirement 2:
 *    *"Windows uses SIDs precisely so that renaming a group does not orphan every
 *    ACL that mentions it."* The ids here are the uuid primary keys of
 *    `msp_roles` / `customer_roles`. This function never sees a role name.
 *
 * This module is PURE — no database, no clock, no environment. That is what makes
 * the deny-wins rule directly unit-testable (./evaluate.test.ts), which is #2455's
 * own stated finish line. Loading the rows is ./load.ts's job.
 */

import { isKnownCapability, type RbacSystem } from "./capabilities";

/**
 * One `*_feature_role_mapping` row, already decoded.
 *
 * `allow`/`deny` hold role UUIDs — the jsonb column's real content. They are role
 * IDS; the shape is deliberately not "a list of role names".
 */
export interface RbacFeatureMapping {
  readonly system: RbacSystem;
  readonly capabilityKey: string;
  /** null = platform-default row (applies to every org); non-null = that org's override. */
  readonly orgId: number | null;
  readonly allow: readonly string[];
  readonly deny: readonly string[];
}

/**
 * Why a decision came out the way it did.
 *
 * - `deny`               — a held role is explicitly denied. Rule 1.
 * - `allow`              — a held role is explicitly allowed and none is denied.
 * - `unset`              — the capability is real, but no held role grants it. Rule 3.
 * - `unknown-capability` — not in the catalog at all. Rule 4.
 */
export type RbacEffect = "deny" | "allow" | "unset" | "unknown-capability";

export interface RbacDecision {
  readonly system: RbacSystem;
  readonly capability: string;
  /** The answer. Only `effect === "allow"` produces true. */
  readonly allowed: boolean;
  readonly effect: RbacEffect;
  /**
   * The held role ids that actually decided it — the denying roles for a `deny`,
   * the allowing roles for an `allow`, empty otherwise. Sorted, so the value is
   * stable for logging and for assertions. This is what an audit record keeps.
   */
  readonly decidedBy: readonly string[];
}

/** Role ids are uuids; Postgres emits them lowercase, but never trust the caller's casing. */
function normalizeId(id: string): string {
  return id.trim().toLowerCase();
}

function toIdSet(ids: Iterable<string> | undefined): Set<string> {
  const out = new Set<string>();
  for (const id of ids ?? []) {
    if (typeof id !== "string") continue;
    const normalized = normalizeId(id);
    if (normalized.length > 0) out.add(normalized);
  }
  return out;
}

function intersectionSorted(held: ReadonlySet<string>, other: ReadonlySet<string>): string[] {
  const hit: string[] = [];
  for (const id of held) if (other.has(id)) hit.push(id);
  return hit.sort();
}

export interface RbacEvaluationInput {
  readonly system: RbacSystem;
  /** Catalog key, e.g. `billing.view`. Paired with `system` — the key alone is not unique. */
  readonly capability: string;
  /** Stable role ids the user holds, from `*_user_roles`. */
  readonly roleIds: Iterable<string>;
  /** Candidate mapping rows. Rows for another system, capability or org are ignored. */
  readonly mappings: Iterable<RbacFeatureMapping>;
  /**
   * The org whose data is being evaluated (msps.id or tenants.id). Mapping rows
   * belonging to a DIFFERENT org are discarded rather than trusted.
   *
   * Defence in depth: ./load.ts already scopes its query, so a foreign row here
   * would mean a bug upstream — and a bug that leaks one org's permissions into
   * another org's decision is exactly the failure this redesign exists to make
   * impossible. Cheap to re-check, so it is re-checked.
   */
  readonly orgId?: number | null;
}

/** Evaluate ONE capability for ONE user. Deny wins; default deny; fail closed. */
export function evaluateCapability(input: RbacEvaluationInput): RbacDecision {
  const { system, capability } = input;

  if (!isKnownCapability(system, capability)) {
    return { system, capability, allowed: false, effect: "unknown-capability", decidedBy: [] };
  }

  const held = toIdSet(input.roleIds);
  const orgId = input.orgId ?? null;

  // Rule 2 — merge platform-default and org-override rows into one allow set and
  // one deny set before deciding anything.
  const allow = new Set<string>();
  const deny = new Set<string>();
  for (const mapping of input.mappings) {
    if (mapping.system !== system) continue;
    if (mapping.capabilityKey !== capability) continue;
    if (mapping.orgId !== null && mapping.orgId !== orgId) continue;
    for (const id of toIdSet(mapping.allow)) allow.add(id);
    for (const id of toIdSet(mapping.deny)) deny.add(id);
  }

  // Rule 1 — deny is checked first and unconditionally. Never reordered.
  const denied = intersectionSorted(held, deny);
  if (denied.length > 0) {
    return { system, capability, allowed: false, effect: "deny", decidedBy: denied };
  }

  const allowed = intersectionSorted(held, allow);
  if (allowed.length > 0) {
    return { system, capability, allowed: true, effect: "allow", decidedBy: allowed };
  }

  // Rule 3 — no grant is a denial.
  return { system, capability, allowed: false, effect: "unset", decidedBy: [] };
}

/**
 * The rows + role ids for one user in one org — everything a decision needs.
 * Produced by ./load.ts, consumed by `createRbacEvaluator`.
 */
export interface RbacContext {
  readonly system: RbacSystem;
  readonly userId: number;
  readonly orgId: number | null;
  readonly roleIds: readonly string[];
  readonly mappings: readonly RbacFeatureMapping[];
}

export interface RbacEvaluator {
  readonly context: RbacContext;
  /** Full decision, including WHY — use this when something is being audited. */
  decide(capability: string): RbacDecision;
  /** Just the answer. */
  can(capability: string): boolean;
  /** Every capability mapped in this system that resolves to allowed, sorted. */
  grantedCapabilities(): string[];
}

/**
 * Bind a loaded context so a request can ask many questions against one snapshot.
 *
 * One snapshot per request is the point: two `can()` calls in the same handler must
 * not be able to disagree because a role was revoked between them.
 */
export function createRbacEvaluator(context: RbacContext): RbacEvaluator {
  const decide = (capability: string): RbacDecision =>
    evaluateCapability({
      system: context.system,
      capability,
      roleIds: context.roleIds,
      mappings: context.mappings,
      orgId: context.orgId,
    });

  return {
    context,
    decide,
    can: (capability: string): boolean => decide(capability).allowed,
    grantedCapabilities: (): string[] => {
      const keys = new Set<string>();
      for (const mapping of context.mappings) {
        if (mapping.system === context.system) keys.add(mapping.capabilityKey);
      }
      return [...keys].filter((key) => decide(key).allowed).sort();
    },
  };
}
