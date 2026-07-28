// artifacts/api-server/src/lib/active-directory.ts
//
// Pure, DB-free logic backing the Active Directory admin surface (Phase 1):
// building the OU=MSPs -> nested-Customers tree, the Groups (RBAC role) node
// list, and the universal cross-property search predicate. Kept separate from
// the route file (admin-active-directory.ts) so the tree-building query shape
// and the search predicate can be unit-tested against plain fixture arrays,
// without a database.

// ── Tree ───────────────────────────────────────────────────────────────────

export interface MspRow {
  id: number;
  name: string;
  slug: string;
  domain: string | null;
  status: string;
}

export interface CustomerRow {
  id: number;
  mspId: number;
  name: string;
  domain: string | null;
  tenantId: string | null;
  status: string;
}

export interface CustomerSummary {
  id: number;
  name: string;
  domain: string | null;
  tenantId: string | null;
  status: string;
}

export interface MspTreeNode {
  id: number;
  name: string;
  slug: string;
  domain: string | null;
  status: string;
  customers: CustomerSummary[];
}

/**
 * Groups every real customer under its owning MSP — MSP -> nested Customers,
 * never a flat parallel Customers list (locked initiative decision). MSPs with
 * zero customers still appear, with an empty `customers` array.
 */
export function buildMspTree(msps: MspRow[], customers: CustomerRow[]): MspTreeNode[] {
  const customersByMsp = new Map<number, CustomerSummary[]>();
  for (const c of customers) {
    const list = customersByMsp.get(c.mspId) ?? [];
    list.push({ id: c.id, name: c.name, domain: c.domain, tenantId: c.tenantId, status: c.status });
    customersByMsp.set(c.mspId, list);
  }
  return msps.map((msp) => ({
    id: msp.id,
    name: msp.name,
    slug: msp.slug,
    domain: msp.domain,
    status: msp.status,
    customers: customersByMsp.get(msp.id) ?? [],
  }));
}

// ── Groups (RBAC role nodes) ─────────────────────────────────────────────────
//
// All 7 real MSP_ROLES values from the schema (lib/db/src/schema/msp.ts),
// including Free and Assessment.

export const DIRECTORY_GROUP_ROLES = [
  "PlatformAdmin",
  "MSPAdmin",
  "MSPOperator",
  "CustomerUser",
  "ServiceAccount",
  "Free",
  "Assessment",
] as const;
export type DirectoryGroupRole = (typeof DIRECTORY_GROUP_ROLES)[number];

export interface GroupNode {
  role: DirectoryGroupRole;
  count: number;
}

/** Every group node always appears, even with a live count of 0. */
export function buildGroupNodes(roleCounts: Array<{ role: string; count: number }>): GroupNode[] {
  const countByRole = new Map(roleCounts.map((r) => [r.role, r.count]));
  return DIRECTORY_GROUP_ROLES.map((role) => ({ role, count: countByRole.get(role) ?? 0 }));
}

// ── Universal search ──────────────────────────────────────────────────────────

export interface SearchableUser {
  id: number;
  email: string;
  name: string | null;
  mspRole: string;
  mspId: number | null;
  mspName: string | null;
  customerId: number | null;
  customerName: string | null;
}

export interface DirectorySearchResult {
  msps: Array<{ id: number; name: string; slug: string }>;
  customers: Array<{ id: number; name: string; mspId: number; mspName: string | null }>;
  users: Array<{
    id: number;
    email: string;
    name: string | null;
    mspRole: string;
    mspName: string | null;
    customerName: string | null;
  }>;
  roles: DirectoryGroupRole[];
}

/** Same AND-of-terms convention SimulatorLeftTree's itemMatchesSearch uses. */
function matchesAllTerms(query: string, fields: Array<string | null | undefined>): boolean {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const combined = fields
    .filter((f): f is string => f != null && f !== "")
    .join(" ")
    .toLowerCase();
  return terms.every((term) => combined.includes(term));
}

/**
 * The universal search predicate: one query string matched across MSP
 * name/slug, customer name/domain/tenantId, user name/email, and role — all
 * from the single search box, never separate per-object-type boxes.
 */
export function searchDirectory(
  query: string,
  data: { msps: MspRow[]; customers: CustomerRow[]; users: SearchableUser[] },
): DirectorySearchResult {
  const q = query.trim();
  if (!q) return { msps: [], customers: [], users: [], roles: [] };

  const mspNameById = new Map(data.msps.map((m) => [m.id, m.name]));

  const msps = data.msps
    .filter((m) => matchesAllTerms(q, [m.name, m.slug, m.domain]))
    .map((m) => ({ id: m.id, name: m.name, slug: m.slug }));

  const customers = data.customers
    .filter((c) => matchesAllTerms(q, [c.name, c.domain, c.tenantId, mspNameById.get(c.mspId) ?? null]))
    .map((c) => ({ id: c.id, name: c.name, mspId: c.mspId, mspName: mspNameById.get(c.mspId) ?? null }));

  const users = data.users
    .filter((u) => matchesAllTerms(q, [u.email, u.name, u.mspRole, u.mspName, u.customerName]))
    .map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      mspRole: u.mspRole,
      mspName: u.mspName,
      customerName: u.customerName,
    }));

  const roles = DIRECTORY_GROUP_ROLES.filter((r) => matchesAllTerms(q, [r]));

  return { msps, customers, users, roles };
}

// ── MSP Object detail pane (Phase 2) ─────────────────────────────────────────
//
// Everything the platform holds about one MSP: profile, current
// subscription/plan + dunning state, entitlements (derived from the
// subscription's Product Catalog tier, per msp-entitlement.ts's loadTier() —
// there is no separate entitlements table), linked customers, linked users,
// and platform agreement acceptance status.

export interface MspProfileRow {
  id: number;
  name: string;
  slug: string;
  domain: string | null;
  logoUrl: string | null;
  status: string;
  trialEndsAt: Date | null;
  suspendedAt: Date | null;
  offboardingState: string | null;
  isDirectBusiness: boolean;
  isTestbed: boolean;
  writeBackEnabled: boolean;
  automatedCustomerEmailsEnabled: boolean;
  createdAt: Date;
}

export interface MspSubscriptionRow {
  status: string;
  tierName: string;
  billingInterval: string;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  dunningState: string | null;
  paymentFailedAt: Date | null;
  tenantCountSnapshot: number;
  contactEmail: string | null;
  typeAttributes: Record<string, unknown> | null;
}

export interface MspDetailCustomer {
  id: number;
  name: string;
  domain: string | null;
  tenantId: string | null;
  status: string;
}

export interface MspDetailUser {
  id: number;
  email: string;
  name: string | null;
  mspRole: string;
  isActive: boolean;
  lastLoginAt: Date | null;
}

export interface MspAgreementAcceptanceRow {
  agreementVersion: string;
  acceptedAt: Date;
  checkboxConfirmed: boolean;
}

export interface MspEntitlements {
  tenantAllowance: number | null;
  aiCreditAllowance: number | null;
  overageRateCents: number | null;
  tierCapabilities: Record<string, boolean>;
}

export interface MspDetail {
  msp: MspProfileRow;
  subscription: Omit<MspSubscriptionRow, "typeAttributes"> | null;
  entitlements: MspEntitlements | null;
  customers: MspDetailCustomer[];
  customerCount: number;
  users: MspDetailUser[];
  userCount: number;
  agreementAcceptances: MspAgreementAcceptanceRow[];
  currentAgreementVersion: string | null;
  hasAcceptedCurrentAgreement: boolean;
}

/** Derives the entitlements view of a subscription's typeAttributes jsonb — mirrors msp-entitlement.ts's loadTier(). */
export function deriveEntitlements(sub: MspSubscriptionRow | null): MspEntitlements | null {
  if (!sub) return null;
  const attrs = sub.typeAttributes ?? {};
  return {
    tenantAllowance: typeof attrs.tenantAllowance === "number" ? attrs.tenantAllowance : null,
    aiCreditAllowance:
      typeof attrs.aiCreditAllowancePlatformValue === "number"
        ? attrs.aiCreditAllowancePlatformValue
        : typeof attrs.aiCreditAllowance === "number"
          ? attrs.aiCreditAllowance
          : null,
    overageRateCents: typeof attrs.overageRateCents === "number" ? attrs.overageRateCents : null,
    tierCapabilities: (attrs.tierCapabilities ?? {}) as Record<string, boolean>,
  };
}

// ── RBAC/Group Object detail pane (Phase 4) ──────────────────────────────────
//
// Every real account holding a given DIRECTORY_GROUP_ROLES role, plus a live
// member count and a search-within-members predicate over name/email.

export interface GroupMember {
  id: number;
  email: string;
  name: string | null;
  mspId: number | null;
  mspName: string | null;
  customerId: number | null;
  customerName: string | null;
  isActive: boolean;
  lastLoginAt: Date | null;
}

export interface GroupDetail {
  role: DirectoryGroupRole;
  members: GroupMember[];
  memberCount: number;
}

/** Every group renders every real member holding that role — the live count always matches the rendered list length. */
export function buildGroupDetail(role: DirectoryGroupRole, members: GroupMember[]): GroupDetail {
  return { role, members, memberCount: members.length };
}

/** Same AND-of-terms search convention as searchDirectory/SimulatorLeftTree — filters members by name/email. */
export function filterGroupMembers(query: string, members: GroupMember[]): GroupMember[] {
  const q = query.trim();
  if (!q) return members;
  return members.filter((m) => matchesAllTerms(q, [m.name, m.email]));
}

/**
 * Assembles the full MSP Object detail payload — pure, DB-free so it can be
 * unit-tested against plain fixtures. An MSP with zero customers/users/
 * acceptances still returns real empty arrays (honest empty states), never
 * placeholders.
 */
export function buildMspDetail(params: {
  msp: MspProfileRow;
  subscription: MspSubscriptionRow | null;
  customers: MspDetailCustomer[];
  users: MspDetailUser[];
  agreementAcceptances: MspAgreementAcceptanceRow[];
  currentAgreementVersion: string | null;
}): MspDetail {
  const { msp, subscription, customers, users, agreementAcceptances, currentAgreementVersion } = params;

  const subscriptionSummary = subscription
    ? {
        status: subscription.status,
        tierName: subscription.tierName,
        billingInterval: subscription.billingInterval,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        dunningState: subscription.dunningState,
        paymentFailedAt: subscription.paymentFailedAt,
        tenantCountSnapshot: subscription.tenantCountSnapshot,
        contactEmail: subscription.contactEmail,
      }
    : null;

  const hasAcceptedCurrentAgreement =
    currentAgreementVersion != null && agreementAcceptances.some((a) => a.agreementVersion === currentAgreementVersion);

  return {
    msp,
    subscription: subscriptionSummary,
    entitlements: deriveEntitlements(subscription),
    customers,
    customerCount: customers.length,
    users,
    userCount: users.length,
    agreementAcceptances,
    currentAgreementVersion,
    hasAcceptedCurrentAgreement,
  };
}
