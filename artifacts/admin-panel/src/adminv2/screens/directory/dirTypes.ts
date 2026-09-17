import type { LegacyRole } from "@workspace/db/rbac/legacy-ladder";
import type { FailureClassification } from "../../../components/SimulatorFailureClassification";
/**
 * MSP Directory — wire types.
 *
 * Mirrors the real payload shapes from `artifacts/api-server/src/lib/active-directory.ts`
 * and `admin-active-directory.ts`. Dates travel as ISO strings over JSON, unlike
 * the server-side `Date` types those files declare — everything here is the
 * client-side (string-dated) shape of the same rows. Kept as a small, honest
 * duplicate rather than a cross-package import: admin-panel has no build-time
 * path to api-server's route/lib modules.
 */

/**
 * A directory group role, as it travels on the wire.
 *
 * #2459 (part of #1696) — the `DIRECTORY_GROUP_ROLES` runtime array that sat
 * beside this is gone. It was a transcription of the server's own list, and
 * `DirUserCanvas` rendered the role buttons from it; that list now comes from
 * `GET /admin/msp-directory/roles` via `@/lib/useDirectoryRoles`, so the
 * console cannot offer a role the server does not have (or miss one it does).
 *
 * The TYPE stays on purpose: it is the wire shape of a field the server sends, and
 * `setDirUserRole` takes it as an argument. That is describing a payload, not making
 * an authorization decision from a literal — which is the distinction #2459 is
 * actually about.
 *
 * #2460 — it was a hand-written union of the same seven strings the server's own
 * enum held, which is a second copy of a wire contract with nothing checking the two
 * agree. It is now an alias of `LegacyRole`, the single transcription in the
 * migration's compatibility shim that #2457's seed and its parity check are both
 * computed from. Same type, one definition, and a rung added or removed there now
 * reaches this console automatically instead of silently drifting from it.
 */
export type DirectoryGroupRole = LegacyRole;

// ── Tree (GET /admin/msp-directory/tree) ──────────────────────────────────

export interface DirTreeUser {
  id: number;
  email: string;
  name: string | null;
  mspRole: string;
  isActive: boolean;
}

export interface DirTreeCustomer {
  id: number;
  name: string;
  domain: string | null;
  tenantId: string | null;
  status: string;
  users: DirTreeUser[];
}

export interface DirTreeMsp {
  id: number;
  name: string;
  slug: string;
  domain: string | null;
  status: string;
  customers: DirTreeCustomer[];
}

export interface DirTreeGroup {
  role: DirectoryGroupRole;
  count: number;
}

export interface DirTreeOu {
  id: number;
  name: string;
}

export interface DirTree {
  msps: DirTreeMsp[];
  groups: DirTreeGroup[];
  ous: DirTreeOu[];
}

export interface DirSearchResult {
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

// ── MSP detail (GET /admin/msp-directory/msp/:id) ─────────────────────────

export interface DirMspProfile {
  id: number;
  name: string;
  slug: string;
  domain: string | null;
  logoUrl: string | null;
  status: string;
  trialEndsAt: string | null;
  suspendedAt: string | null;
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
  /** The MSP's own Entra tenant GUID (#4242); the mailbox connector is bound to it once set. */
  entraTenantId: string | null;
  createdAt: string;
}

export interface DirMspSubscription {
  status: string;
  tierName: string;
  billingInterval: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  dunningState: string | null;
  paymentFailedAt: string | null;
  tenantCountSnapshot: number;
  contactEmail: string | null;
}

export interface DirMspEntitlements {
  tenantAllowance: number | null;
  aiCreditAllowance: number | null;
  overageRateCents: number | null;
  tierCapabilities: Record<string, boolean>;
}

export interface DirMspDetailCustomer {
  id: number;
  name: string;
  domain: string | null;
  tenantId: string | null;
  status: string;
}

export interface DirMspDetailUser {
  id: number;
  email: string;
  name: string | null;
  mspRole: string;
  isActive: boolean;
  lastLoginAt: string | null;
}

export interface DirMspAgreementAcceptance {
  agreementVersion: string;
  acceptedAt: string;
  checkboxConfirmed: boolean;
}

export interface DirMspDetail {
  msp: DirMspProfile;
  subscription: DirMspSubscription | null;
  entitlements: DirMspEntitlements | null;
  customers: DirMspDetailCustomer[];
  customerCount: number;
  users: DirMspDetailUser[];
  userCount: number;
  agreementAcceptances: DirMspAgreementAcceptance[];
  currentAgreementVersion: string | null;
  hasAcceptedCurrentAgreement: boolean;
}

// ── Audit log (GET /api/msp/audit?mspId=) ─────────────────────────────────────

export interface DirMspAuditEntry {
  id: number;
  eventId: string;
  actorEmail: string | null;
  actorName: string | null;
  actorRole: string | null;
  action: string;
  resource: string | null;
  detail: string | null;
  outcome: "success" | "failure" | "partial";
  createdAt: string;
}

export interface DirMspAuditLogPage {
  entries: DirMspAuditEntry[];
  total: number;
  page: number;
  limit: number;
}

// ── Group detail (GET /admin/msp-directory/group/:role) ───────────────────

export interface DirGroupMember {
  id: number;
  email: string;
  name: string | null;
  mspId: number | null;
  mspName: string | null;
  customerId: number | null;
  customerName: string | null;
  isActive: boolean;
  lastLoginAt: string | null;
}

export interface DirGroupDetail {
  role: DirectoryGroupRole;
  members: DirGroupMember[];
  memberCount: number;
}

// ── Customer detail (GET /admin/msp-directory/customer/:id) ───────────────

export interface DirCustomerProfile {
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
  createdAt: string;
}

export interface DirCustomerOwningMsp {
  id: number;
  name: string;
  slug: string;
}

export interface DirCustomerDetailUser {
  id: number;
  email: string;
  name: string | null;
  mspRole: string;
  isActive: boolean;
  lastLoginAt: string | null;
}

export interface DirConsentStatus {
  tenantId: string;
  consentStatus: string;
  consentedAt: string | null;
  revokedAt: string | null;
  adminEmail: string | null;
}

export interface DirPurchasedService {
  id: number;
  serviceName: string;
  status: string;
  billingInterval: string;
  purchasedAt: string;
}

export interface DirDiagnosticRunSummary {
  runId: string;
  packageKey: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
}

/** GET /api/msp/monitoring-packages row — #1770's run-scan package picker. */
export interface DirMonitoringPackage {
  key: string;
  label: string;
  checkCount: number;
}

/**
 * GET /api/admin/services row, sliced to what the Customer canvas's #4489
 * "Package Assignment" picker needs — real `services` rows, not a fixture.
 * `deliveryType` is what the swap logic groups on: `bundle_subscription`
 * (Monitoring) and `retainer` (Retainer) are the two assignable categories.
 */
export interface DirAssignableService {
  id: number;
  name: string;
  deliveryType: string | null;
  tier: string | null;
}

/** POST /admin/msp-directory/customer/:id/assign-service response. */
export interface DirAssignServiceResult {
  clientService: { id: number; status: string };
  serviceName: string;
  completedPreviousIds: number[];
}

// ── Diagnostic run findings (#371/#374/#379, GET /msp/customers/:id/diagnostics/runs/:runId) ──
// Mirrors the legacy ActiveDirectoryCustomerPane.tsx's own wire shape for this
// route — same route, same server response, ported rather than redesigned.

export interface DirDiagnosticRunCounts {
  checksTotal: number;
  checksOk: number;
  checksError: number;
  checksRequiresScript: number;
  checksLicenseGap: number;
}

export interface DirDiagnosticFinding {
  findingId: string;
  runId: string;
  checkKey: string;
  checkLabel: string;
  severity: "ok" | "info" | "warning" | "critical";
  title: string;
  description: string | null;
  extractedProperties: Record<string, unknown> | null;
  checkStatus: string | null;
  /** #379 — the server's triage verdict for this finding, null when not a real failure. */
  classification?: FailureClassification | null;
}

export interface DirDiagnosticRunFindingsResponse {
  run: DirDiagnosticRunCounts;
  findings: DirDiagnosticFinding[];
}

// ── Monitoring package ↔ check assignments (GET/PUT /admin/monitoring-packages/:key/checks) ──
// #376 — "Remove from scan package" reads/writes this same route the legacy
// pane already uses.

export interface DirMonitoringPackageCheckLink {
  packageKey: string;
  checkKey: string;
  sortOrder: number;
}

export interface DirCustomerDetail {
  customer: DirCustomerProfile;
  owningMsp: DirCustomerOwningMsp | null;
  users: DirCustomerDetailUser[];
  userCount: number;
  graphConsent: DirConsentStatus | null;
  sharePointConsent: DirConsentStatus | null;
  writeConsent: DirConsentStatus | null;
  purchasedServices: DirPurchasedService[];
  recentDiagnosticRuns: DirDiagnosticRunSummary[];
}

// ── User detail (GET /admin/msp-directory/user/:id) ───────────────────────

export interface DirUserProfile {
  id: number;
  email: string;
  name: string | null;
  company: string | null;
  phone: string | null;
  baseRole: string;
  createdAt: string;
}

export interface DirUserLinkage {
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
  lastLoginAt: string | null;
}

export interface DirUserSessionSummary {
  activeSessionCount: number;
  totalSessionCount: number;
  mostRecentSession: {
    sessionType: string;
    loginMethod: string;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: string;
    lastActiveAt: string;
    expiresAt: string;
    revokedAt: string | null;
  } | null;
}

export interface DirUserMfaStatus {
  enrolled: boolean;
  methods: Array<{ method: string; createdAt: string }>;
}

export interface DirUserDetail {
  profile: DirUserProfile;
  linkage: DirUserLinkage | null;
  entitlements: DirMspEntitlements | null;
  sessions: DirUserSessionSummary;
  mfa: DirUserMfaStatus;
}

export interface DirEntitlementOverride {
  capabilityKey: string;
  enabled: boolean;
  grantedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface DirEntitlementsView {
  inherited: DirMspEntitlements | null;
  overrides: DirEntitlementOverride[];
  effective: DirMspEntitlements | null;
}

// ── Write-back consent (GET /admin/customers/:id/write-consent[/start]) ──────
// Git #1672 — rehomed from the archived msp-portal customer-detail.tsx's
// WriteBackConsentCard, the one genuinely admin-scoped piece of that page.

export interface DirWriteConsentStatus {
  tenantId: string | null;
  writeConsent: { consentStatus: string; consentedAt: string | null; revokedAt: string | null } | null;
}

// ── OU (POST/PATCH/DELETE /admin/active-directory/ou) ────────────────────────

export interface DirOu {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
}

// ── RBAC (GET/POST/PATCH/DELETE /admin/rbac/*) ────────────────────────────────
// #2461, part of #1696 — the new roles/user_roles/feature_role_mapping model
// #2455 landed. Additive alongside the DirectoryGroupRole ladder above: this
// manages the NEW tables, it does not (yet) replace what actually gates a
// request — that cutover is #2457/#2458, still pending.

/** The two separate identity systems (#1696's "two systems, one mechanism"). */
export type RbacSystem = "msp" | "customer";

export interface RbacCapability {
  system: RbacSystem;
  key: string;
  category: string;
  label: string;
  description: string;
}

export interface RbacRoleSummary {
  id: string;
  system: RbacSystem;
  /** null = platform-scoped role, holdable/applicable across every org. */
  orgId: number | null;
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  memberCount: number;
}

export interface RbacRoleMappingPayload {
  allow: string[];
  deny: string[];
}

export interface RbacMappingRow {
  capability: RbacCapability;
  /** The platform-default allow/deny row for this capability. */
  platform: RbacRoleMappingPayload;
  /** This org's own override row, or null when no org scope was requested. */
  org: RbacRoleMappingPayload | null;
}
