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
  users: TreeUserSummary[];
}

export interface MspTreeNode {
  id: number;
  name: string;
  slug: string;
  domain: string | null;
  status: string;
  customers: CustomerSummary[];
}

// Phase 10 (Issue #91): a real user row, scoped to the tenant it nests under
// in the tree. `tenantId` here is `users.tenantId` (the tenants.id FK) — not
// to be confused with CustomerRow.tenantId, which is the AAD GUID string.
// Only tenant-linked users (tenantId != null) are ever passed in; MSP staff
// and PlatformAdmin accounts have no tenant to nest under and are not part of
// this tree shape (they already surface via the Groups/RBAC nodes).
export interface DirectoryTreeUserRow {
  id: number;
  tenantId: number;
  email: string;
  name: string | null;
  mspRole: string;
  isActive: boolean;
}

export interface TreeUserSummary {
  id: number;
  email: string;
  name: string | null;
  mspRole: string;
  isActive: boolean;
}

/**
 * Groups every real customer under its owning MSP — MSP -> nested Customers,
 * never a flat parallel Customers list (locked initiative decision). MSPs with
 * zero customers still appear, with an empty `customers` array. As of Phase 10
 * (Issue #91), each customer also nests its real Users — an empty `users`
 * array for a customer with none, never omitted.
 */
export function buildMspTree(
  msps: MspRow[],
  customers: CustomerRow[],
  users: DirectoryTreeUserRow[] = [],
): MspTreeNode[] {
  const usersByCustomer = new Map<number, TreeUserSummary[]>();
  for (const u of users) {
    const list = usersByCustomer.get(u.tenantId) ?? [];
    list.push({ id: u.id, email: u.email, name: u.name, mspRole: u.mspRole, isActive: u.isActive });
    usersByCustomer.set(u.tenantId, list);
  }

  const customersByMsp = new Map<number, CustomerSummary[]>();
  for (const c of customers) {
    const list = customersByMsp.get(c.mspId) ?? [];
    list.push({
      id: c.id,
      name: c.name,
      domain: c.domain,
      tenantId: c.tenantId,
      status: c.status,
      users: usersByCustomer.get(c.id) ?? [],
    });
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
  primaryContactName: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
  address: string | null;
  notes: string | null;
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

// ── Customer Object detail pane (Phase 3) ────────────────────────────────────
//
// Everything the platform holds about one customer: profile, owning MSP
// (id/name only — a link-out via the tree's ad-select-object mechanism, not a
// duplicated MSP detail render), linked users with roles, Graph/SharePoint/
// write consent status, purchased services (client_services, reached via the
// users.tenantId bridge — client_services has no tenants FK of
// its own), and a summary of the N most recent diagnostic runs. Read-only, no
// customer-level edit actions belong in this phase (Issue #63).

// `ownerType` is gone as of the Tenant/User Refactor (#96): the dropped
// msp_customers table carried it, and the tenants table that replaced it has
// no analogue — every tenants row IS a customer, so the column had no
// remaining meaning. `tenantUrl` takes its place in the pane. `tenantId` is
// now NOT NULL on tenants, but stays nullable here so the pure builder keeps
// working against older fixtures.
export interface CustomerProfileRow {
  id: number;
  mspId: number;
  name: string;
  domain: string | null;
  industry: string | null;
  /** `tenants.business_unit` (#2085), nullable freeform text. */
  businessUnit: string | null;
  tenantId: string | null;
  tenantUrl: string | null;
  status: string;
  isTestbed: boolean;
  createdAt: Date;
}

export interface CustomerOwningMsp {
  id: number;
  name: string;
  slug: string;
}

export interface CustomerDetailUser {
  id: number;
  email: string;
  name: string | null;
  mspRole: string;
  isActive: boolean;
  lastLoginAt: Date | null;
}

export interface CustomerConsentStatus {
  tenantId: string;
  consentStatus: string;
  consentedAt: Date | null;
  revokedAt: Date | null;
  adminEmail: string | null;
}

export interface CustomerPurchasedService {
  id: number;
  serviceName: string;
  status: string;
  billingInterval: string;
  purchasedAt: Date;
}

export interface CustomerDiagnosticRunSummary {
  runId: string;
  packageKey: string;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface CustomerDetail {
  customer: CustomerProfileRow;
  owningMsp: CustomerOwningMsp | null;
  users: CustomerDetailUser[];
  userCount: number;
  graphConsent: CustomerConsentStatus | null;
  sharePointConsent: CustomerConsentStatus | null;
  writeConsent: CustomerConsentStatus | null;
  purchasedServices: CustomerPurchasedService[];
  recentDiagnosticRuns: CustomerDiagnosticRunSummary[];
}

/**
 * Assembles the full Customer Object detail payload — pure, DB-free so it can
 * be unit-tested against plain fixtures. A customer with no consent rows /
 * purchased services / diagnostic runs still returns real empty/null values
 * (honest empty states), never placeholders.
 */
export function buildCustomerDetail(params: {
  customer: CustomerProfileRow;
  owningMsp: CustomerOwningMsp | null;
  users: CustomerDetailUser[];
  graphConsent: CustomerConsentStatus | null;
  sharePointConsent: CustomerConsentStatus | null;
  writeConsent: CustomerConsentStatus | null;
  purchasedServices: CustomerPurchasedService[];
  recentDiagnosticRuns: CustomerDiagnosticRunSummary[];
}): CustomerDetail {
  const {
    customer,
    owningMsp,
    users,
    graphConsent,
    sharePointConsent,
    writeConsent,
    purchasedServices,
    recentDiagnosticRuns,
  } = params;

  return {
    customer,
    owningMsp,
    users,
    userCount: users.length,
    graphConsent,
    sharePointConsent,
    writeConsent,
    purchasedServices,
    recentDiagnosticRuns,
  };
}

// ── Organizational Unit placeholder objects (Phase 5) ────────────────────────
//
// A real, creatable/browsable OU container node — genuinely persisted, but
// with NO policy enforcement logic. The policy semantics reserved here are now
// defined by #1547: the OU is the attachment point for a standing policy
// (`standing_policies.ou_id`), and enactment/evaluation belong to #1548/#1549,
// not to this browse tree. Still do not add policy columns or an object-to-OU
// membership model HERE — the policy object is its own table that references
// the OU, never columns bolted onto this container node.
//
// `tenantId` (#1549) is the one exception, and a narrow one: it answers "which
// real tenant does this OU govern", not "who belongs to it" — the continuous
// evaluation loop cannot resolve ANY tenant to check policy against without
// it. Nullable — a platform/MSP-level grouping node legitimately has none.

export interface OuRow {
  id: number;
  name: string;
  tenantId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OuNode {
  id: number;
  name: string;
  tenantId: number | null;
}

/** OUs sorted by name — same list-shape convention as buildMspTree/buildGroupNodes. */
export function buildOuNodes(ous: OuRow[]): OuNode[] {
  return [...ous].sort((a, b) => a.name.localeCompare(b.name)).map((o) => ({ id: o.id, name: o.name, tenantId: o.tenantId }));
}

// ── User Object detail pane (Phase 6) ────────────────────────────────────────
//
// Everything the platform holds about one account: base profile (users
// table — note `users.role` is only ["admin","client"], NOT the real
// platform role), the real role/MSP/customer linkage (users.mspRole,
// same source-of-truth Phases 2/4 already query), entitlements inherited
// from the linked MSP's subscription tier (there is no separate per-user
// entitlements table — this reuses Phase 2's deriveEntitlements() rather
// than inventing a user-level concept that doesn't exist in the schema),
// an active-session summary, and MFA enrollment status. Read-only, per
// Issue #66 — RBAC/MSP reassignment, entitlement grant/revoke, credential
// ops, impersonation, and delete are Phases 7/8/9 and are NOT built here.

export interface UserProfileRow {
  id: number;
  email: string;
  name: string | null;
  company: string | null;
  phone: string | null;
  baseRole: string;
  createdAt: Date;
}

export interface UserMspLinkage {
  mspId: number | null;
  mspName: string | null;
  mspSlug: string | null;
  customerId: number | null;
  customerName: string | null;
  mspRole: DirectoryGroupRole;
  isActive: boolean;
  mfaEnforced: boolean;
  department: string | null;
  jobTitle: string | null;
  lastLoginAt: Date | null;
}

export interface UserSessionRow {
  sessionType: string;
  loginMethod: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastActiveAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface UserSessionSummary {
  activeSessionCount: number;
  totalSessionCount: number;
  mostRecentSession: UserSessionRow | null;
}

export interface UserMfaEnrollmentRow {
  method: string;
  createdAt: Date;
}

export interface UserMfaStatus {
  enrolled: boolean;
  methods: UserMfaEnrollmentRow[];
}

export interface UserDetail {
  profile: UserProfileRow;
  linkage: UserMspLinkage | null;
  entitlements: MspEntitlements | null;
  sessions: UserSessionSummary;
  mfa: UserMfaStatus;
}

/**
 * Live-session count: not revoked and not yet expired — same "still usable
 * right now" definition as `listActiveSessions` in session-tracking.ts,
 * recomputed here rather than reused so this stays DB-free/pure and
 * includes impersonation-type rows (that helper deliberately excludes
 * them; an admin detail view should not hide them).
 */
function isSessionActive(session: UserSessionRow, now: Date): boolean {
  return session.revokedAt == null && session.expiresAt.getTime() > now.getTime();
}

/**
 * Assembles the full User Object detail payload — pure, DB-free so it can be
 * unit-tested against plain fixtures. A user the caller could not resolve
 * (linkage null), zero sessions, or zero MFA enrollments still returns real
 * honest empty values, never placeholders.
 */
export function buildUserDetail(params: {
  profile: UserProfileRow;
  linkage: UserMspLinkage | null;
  subscriptionForEntitlements: MspSubscriptionRow | null;
  sessions: UserSessionRow[];
  mfaEnrollments: UserMfaEnrollmentRow[];
  now: Date;
  entitlementOverrides?: EntitlementOverrideRow[];
}): UserDetail {
  const { profile, linkage, subscriptionForEntitlements, sessions, mfaEnrollments, now, entitlementOverrides = [] } = params;

  const sortedSessions = [...sessions].sort((a, b) => b.lastActiveAt.getTime() - a.lastActiveAt.getTime());
  const activeSessionCount = sessions.filter((s) => isSessionActive(s, now)).length;

  const inherited = deriveEntitlements(subscriptionForEntitlements);

  return {
    profile,
    linkage,
    entitlements:
      entitlementOverrides.length > 0
        ? buildUserEntitlementsView(inherited, entitlementOverrides).effective
        : inherited,
    sessions: {
      activeSessionCount,
      totalSessionCount: sessions.length,
      mostRecentSession: sortedSessions[0] ?? null,
    },
    mfa: {
      enrolled: mfaEnrollments.length > 0,
      methods: mfaEnrollments,
    },
  };
}

// ── User Object write actions (Phase 7) ──────────────────────────────────────
//
// RBAC role change, MSP/customer reassignment, and entitlement grant/revoke —
// Issue #67. This mapping is no longer app-level discipline alone: as of the
// Tenant/User Refactor (#92 Phase 0) the single users table carries a real
// Postgres CHECK constraint, `users_role_scope_check`, and these rules MUST
// stay identical to it or every plan this module approves gets rejected by
// the database:
//
//   CustomerUser / Free / Assessment       -> tenant_id NOT NULL
//   MSPAdmin / MSPOperator / ServiceAccount -> msp_id    NOT NULL
//   PlatformAdmin                           -> neither required
//
// Free/Assessment therefore moved from "none" to "customer" here — under the
// old msp_users table they were a linkage-free floor tier, but the constraint
// now requires them to sit under a tenant like any other customer-side role.
// ("customer" means tenant linkage; the wire/field name customerId is kept
// deliberately — see admin-active-directory.ts's header.)

export type RoleLinkageRequirement = "none" | "msp" | "customer";

export function roleLinkageRequirement(role: DirectoryGroupRole): RoleLinkageRequirement {
  switch (role) {
    case "PlatformAdmin":
      return "none";
    case "MSPAdmin":
    case "MSPOperator":
    case "ServiceAccount":
      return "msp";
    case "CustomerUser":
    case "Free":
    case "Assessment":
      return "customer";
  }
}

export type RoleChangeResult =
  | { ok: true; mspRole: DirectoryGroupRole; mspId: number | null; customerId: number | null }
  | { ok: false; error: string };

/**
 * Computes the resulting mspId/customerId for a role change on an existing
 * users row. Never invents a new mspId/customerId —
 * a role that requires linkage the account doesn't currently have is
 * rejected, telling the caller to reassign MSP/customer linkage first via
 * planAssignmentChange. A role change to an MSP-scoped role from a
 * customer-scoped account (or vice versa) clears the linkage that no longer
 * applies rather than leaving an invalid combination on the row.
 */
export function planRoleChange(input: {
  newRole: DirectoryGroupRole;
  currentMspId: number | null;
  currentCustomerId: number | null;
}): RoleChangeResult {
  const requirement = roleLinkageRequirement(input.newRole);

  if (requirement === "none") {
    return { ok: true, mspRole: input.newRole, mspId: null, customerId: null };
  }

  if (requirement === "msp") {
    if (input.currentMspId == null) {
      return {
        ok: false,
        error: `Cannot set role to ${input.newRole}: this account has no MSP linkage yet — reassign it to an MSP first.`,
      };
    }
    return { ok: true, mspRole: input.newRole, mspId: input.currentMspId, customerId: null };
  }

  // requirement === "customer"
  if (input.currentCustomerId == null) {
    return {
      ok: false,
      error: `Cannot set role to ${input.newRole}: this account has no customer linkage yet — reassign it to a customer first.`,
    };
  }
  return { ok: true, mspRole: input.newRole, mspId: input.currentMspId, customerId: input.currentCustomerId };
}

export type AssignmentChangeResult =
  | { ok: true; mspId: number | null; customerId: number | null }
  | { ok: false; error: string };

/**
 * Computes the resulting mspId/customerId for an MSP/customer reassignment.
 * Which field is reassignable is entirely determined by the account's
 * CURRENT role (an MSP-scoped role reassigns mspId only; CustomerUser
 * reassigns customerId only, with mspId always derived server-side from the
 * target customer's real owning MSP — never client-supplied, so an mspId/
 * customerId pair can never disagree). Roles with no linkage requirement
 * (PlatformAdmin/Free/Assessment) have nothing to reassign.
 */
export function planAssignmentChange(input: {
  currentRole: DirectoryGroupRole;
  target: { mspId?: number | null; customerId?: number | null };
  /** The target customer's real owning mspId, resolved by the caller from tenantsTable — required when target.customerId is provided. */
  customerOwningMspId?: number | null;
}): AssignmentChangeResult {
  const requirement = roleLinkageRequirement(input.currentRole);

  if (requirement === "none") {
    return { ok: false, error: `${input.currentRole} accounts have no MSP/customer linkage to reassign.` };
  }

  if (requirement === "msp") {
    if (input.target.customerId != null) {
      return { ok: false, error: `${input.currentRole} accounts are reassigned by mspId only — they cannot be assigned a customer.` };
    }
    if (input.target.mspId == null) {
      return { ok: false, error: `Reassigning a ${input.currentRole} account requires a target mspId.` };
    }
    return { ok: true, mspId: input.target.mspId, customerId: null };
  }

  // requirement === "customer"
  if (input.target.mspId != null) {
    return { ok: false, error: `${input.currentRole} accounts are reassigned by customerId only — the owning MSP is derived automatically.` };
  }
  if (input.target.customerId == null) {
    return { ok: false, error: `Reassigning a ${input.currentRole} account requires a target customerId.` };
  }
  if (input.customerOwningMspId == null) {
    return { ok: false, error: "Could not resolve the owning MSP for the target customer." };
  }
  return { ok: true, mspId: input.customerOwningMspId, customerId: input.target.customerId };
}

// ── Entitlement grant/revoke overrides ───────────────────────────────────────

export interface EntitlementOverrideRow {
  capabilityKey: string;
  enabled: boolean;
  grantedByUserId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserEntitlementsView {
  inherited: MspEntitlements | null;
  overrides: EntitlementOverrideRow[];
  effective: MspEntitlements | null;
}

/**
 * Merges per-user entitlement overrides on top of the MSP-tier-inherited
 * entitlements. An override always wins over the inherited value for that
 * capability key; a key with no override falls through to the inherited
 * value (or is simply absent if there's no inherited entitlements at all).
 * Numeric allowances are never overridden — see the schema-side comment on
 * userEntitlementOverridesTable for why.
 */
export function buildUserEntitlementsView(
  inherited: MspEntitlements | null,
  overrides: EntitlementOverrideRow[],
): UserEntitlementsView {
  if (overrides.length === 0) {
    return { inherited, overrides, effective: inherited };
  }

  const effectiveCapabilities: Record<string, boolean> = { ...(inherited?.tierCapabilities ?? {}) };
  for (const o of overrides) effectiveCapabilities[o.capabilityKey] = o.enabled;

  return {
    inherited,
    overrides,
    effective: {
      tenantAllowance: inherited?.tenantAllowance ?? null,
      aiCreditAllowance: inherited?.aiCreditAllowance ?? null,
      overageRateCents: inherited?.overageRateCents ?? null,
      tierCapabilities: effectiveCapabilities,
    },
  };
}
