/**
 * RBAC capability catalog — the enumerable set (#2455, part of #1696).
 *
 * Architecture comment on #1696, requirement 3, verbatim: *"The capability
 * catalog must be enumerable. #1698's gating pass has to verify that every route
 * carries a requirement, mechanically. That is only possible if capabilities are
 * a real, listable set rather than strings appearing ad hoc in jsonb blobs."*
 *
 * So this module — not the database — is the source of truth. `RBAC_CAPABILITIES`
 * is a frozen, typed, compile-time-listable array; the `rbac_capabilities` table
 * is a projection of it, kept in sync by `syncCapabilityCatalog()` (./sync.ts),
 * and exists only so the mapping tables can carry a real foreign key. A
 * capability that is not in this array cannot be granted, cannot be denied, and
 * evaluates to `unknown-capability` (fail closed) — see ./evaluate.ts.
 *
 * ── Two systems, one mechanism ──────────────────────────────────────────────
 * #1696's decision (2026-08-29, re-confirmed 2026-09-09) is that MSP identity and
 * customer identity are SEPARATE systems — different lifecycles, different admins,
 * different blast radius — that share one mechanism. That is why every capability
 * declares which system it belongs to, and why the catalog key is the PAIR
 * (system, key), never the key alone. `purchases.approve` on the MSP side (approve
 * a charge against the MSP's own account) and a customer-side capability of the
 * same name would be different authorities over different money; nothing in this
 * file lets them collide.
 *
 * ── What is seeded here, and what deliberately is not ───────────────────────
 * Every entry below is backed by a REAL, distinct authorization decision that
 * already exists in the running product — the three live per-user capability
 * columns, plus the one real customer-side surface #1696 was filed about. This is
 * a foundation step: it does NOT attempt to enumerate all ~480 `requireRole` call
 * sites. Expressing today's seven roles and the boolean columns as data is #2457;
 * moving enforcement onto this evaluator is #2458; the mechanical route-coverage
 * pass is #1698. Adding an entry here is a one-line change plus a catalog sync —
 * that being cheap is the entire point of the redesign.
 */

/** The two identity systems. Separate tables, separate admins, shared mechanism. */
export const RBAC_SYSTEMS = ["msp", "customer"] as const;
export type RbacSystem = typeof RBAC_SYSTEMS[number];

export interface RbacCapability {
  /** Identity system this capability belongs to. Half of the catalog's primary key. */
  readonly system: RbacSystem;
  /**
   * Stable machine key, dotted `<surface>.<verb>`. Immutable once shipped — it is
   * what a route's requirement and a feature→role mapping row both reference.
   */
  readonly key: string;
  /** Coarse grouping for the admin UI's capability picker. */
  readonly category: string;
  /** Human label. Display only — never compared against. */
  readonly label: string;
  /** Why this capability exists, and what it actually gates today. */
  readonly description: string;
}

export const RBAC_CAPABILITIES: readonly RbacCapability[] = Object.freeze([
  // ── MSP system ────────────────────────────────────────────────────────────
  {
    system: "msp",
    key: "purchases.approve",
    category: "billing",
    label: "Approve purchases",
    description:
      "Approve or reject a pending purchase-charge approval for the MSP. Today this " +
      "is the per-user users.can_approve_purchases column, granted from MSP settings " +
      "(artifacts/api-server/src/routes/msp-settings.ts) and read live, never from the JWT.",
  },
  {
    system: "msp",
    key: "team.manage",
    category: "identity",
    label: "Manage MSP staff",
    description:
      "Invite, suspend and re-role the MSP's own staff members. Today this is not a " +
      "capability at all — it is the MSPAdmin rung of the requireAuth ROLE_ORDER ladder, " +
      "which is exactly the 'sideways permission' problem #1696 records.",
  },

  // ── Customer system ───────────────────────────────────────────────────────
  {
    system: "customer",
    key: "team.manage",
    category: "identity",
    label: "Manage company team",
    description:
      "Manage the customer's own team roster — invite/suspend teammates, force password " +
      "and MFA resets, unlock accounts, issue emergency MFA bypass codes. Today this is " +
      "the per-user users.can_manage_team column enforced in " +
      "artifacts/api-server/src/routes/portal-team.ts:50-54 (Git #1142).",
  },
  {
    system: "customer",
    key: "changes.approve",
    category: "change-control",
    label: "Approve change requests",
    description:
      "Approve or reject a Change Request against the customer's own live tenant. Today " +
      "this is the per-user users.can_approve_changes column, read live in " +
      "artifacts/api-server/src/routes/portal-change-control.ts:488-505 (Git #1496). " +
      "Deliberately distinct from purchases.approve and team.manage — approving a " +
      "configuration change to a live tenant is its own authority.",
  },
  {
    system: "customer",
    key: "billing.view",
    category: "billing",
    label: "View billing",
    description:
      "View the customer's invoices, subscriptions and payment history. This is the " +
      "capability #1696 was filed about — Shane, 2026-08-29: 'the customer needs RBAC to " +
      "stop say an engineer from seeing billing.' The surface is real and live " +
      "(artifacts/api-server/src/routes/portal-billing.ts) but is gated by requireAuth " +
      "alone today, so every authenticated customer user can read it. Cataloguing it " +
      "changes nothing on its own; #2458 is what moves that route onto this evaluator.",
  },
]);

/** Catalog key for a capability — the (system, key) pair, never the key alone. */
export function capabilityId(system: RbacSystem, key: string): string {
  return `${system}:${key}`;
}

const BY_ID: ReadonlyMap<string, RbacCapability> = new Map(
  RBAC_CAPABILITIES.map((c) => [capabilityId(c.system, c.key), c]),
);

/** Every capability in one system, in catalog order. */
export function listCapabilities(system?: RbacSystem): readonly RbacCapability[] {
  return system ? RBAC_CAPABILITIES.filter((c) => c.system === system) : RBAC_CAPABILITIES;
}

/** The catalog entry, or undefined if this (system, key) pair is not catalogued. */
export function findCapability(system: RbacSystem, key: string): RbacCapability | undefined {
  return BY_ID.get(capabilityId(system, key));
}

/**
 * Whether this (system, key) pair is a real catalogued capability.
 *
 * The evaluator calls this first and fails closed on false: an uncatalogued
 * string is a bug (a typo in a route requirement, or a capability deleted from
 * the catalog while a mapping row still references it), and a bug in an
 * authorization path must not resolve to "allowed".
 */
export function isKnownCapability(system: RbacSystem, key: string): boolean {
  return BY_ID.has(capabilityId(system, key));
}
