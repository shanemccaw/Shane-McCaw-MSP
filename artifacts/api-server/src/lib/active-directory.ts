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
// Exactly the 5 roles named in Issue #61 / the plan file's Groups container —
// deliberately excludes the schema's Free/Assessment roles, which are not
// "accounts" in the directory-browser sense this phase models.

export const DIRECTORY_GROUP_ROLES = [
  "PlatformAdmin",
  "MSPAdmin",
  "MSPOperator",
  "CustomerUser",
  "ServiceAccount",
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
