/**
 * Active Directory — wire types.
 *
 * Mirrors the real payload shapes from `artifacts/api-server/src/lib/active-directory.ts`
 * and `admin-active-directory.ts`. Dates travel as ISO strings over JSON, unlike
 * the server-side `Date` types those files declare — everything here is the
 * client-side (string-dated) shape of the same rows. Kept as a small, honest
 * duplicate rather than a cross-package import: admin-panel has no build-time
 * path to api-server's route/lib modules.
 */

export type DirectoryGroupRole =
  | "PlatformAdmin"
  | "MSPAdmin"
  | "MSPOperator"
  | "CustomerUser"
  | "ServiceAccount"
  | "Free"
  | "Assessment";

export const DIRECTORY_GROUP_ROLES: DirectoryGroupRole[] = [
  "PlatformAdmin",
  "MSPAdmin",
  "MSPOperator",
  "CustomerUser",
  "ServiceAccount",
  "Free",
  "Assessment",
];

// ── Tree (GET /admin/active-directory/tree) ──────────────────────────────────

export interface AdTreeUser {
  id: number;
  email: string;
  name: string | null;
  mspRole: string;
  isActive: boolean;
}

export interface AdTreeCustomer {
  id: number;
  name: string;
  domain: string | null;
  tenantId: string | null;
  status: string;
  users: AdTreeUser[];
}

export interface AdTreeMsp {
  id: number;
  name: string;
  slug: string;
  domain: string | null;
  status: string;
  customers: AdTreeCustomer[];
}

export interface AdTreeGroup {
  role: DirectoryGroupRole;
  count: number;
}

export interface AdTreeOu {
  id: number;
  name: string;
}

export interface AdTree {
  msps: AdTreeMsp[];
  groups: AdTreeGroup[];
  ous: AdTreeOu[];
}

export interface AdSearchResult {
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

// ── MSP detail (GET /admin/active-directory/msp/:id) ─────────────────────────

export interface AdMspProfile {
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
  createdAt: string;
}

export interface AdMspSubscription {
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

export interface AdMspEntitlements {
  tenantAllowance: number | null;
  aiCreditAllowance: number | null;
  overageRateCents: number | null;
  tierCapabilities: Record<string, boolean>;
}

export interface AdMspDetailCustomer {
  id: number;
  name: string;
  domain: string | null;
  tenantId: string | null;
  status: string;
}

export interface AdMspDetailUser {
  id: number;
  email: string;
  name: string | null;
  mspRole: string;
  isActive: boolean;
  lastLoginAt: string | null;
}

export interface AdMspAgreementAcceptance {
  agreementVersion: string;
  acceptedAt: string;
  checkboxConfirmed: boolean;
}

export interface AdMspDetail {
  msp: AdMspProfile;
  subscription: AdMspSubscription | null;
  entitlements: AdMspEntitlements | null;
  customers: AdMspDetailCustomer[];
  customerCount: number;
  users: AdMspDetailUser[];
  userCount: number;
  agreementAcceptances: AdMspAgreementAcceptance[];
  currentAgreementVersion: string | null;
  hasAcceptedCurrentAgreement: boolean;
}

// ── Group detail (GET /admin/active-directory/group/:role) ───────────────────

export interface AdGroupMember {
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

export interface AdGroupDetail {
  role: DirectoryGroupRole;
  members: AdGroupMember[];
  memberCount: number;
}

// ── Customer detail (GET /admin/active-directory/customer/:id) ───────────────

export interface AdCustomerProfile {
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

export interface AdCustomerOwningMsp {
  id: number;
  name: string;
  slug: string;
}

export interface AdCustomerDetailUser {
  id: number;
  email: string;
  name: string | null;
  mspRole: string;
  isActive: boolean;
  lastLoginAt: string | null;
}

export interface AdConsentStatus {
  tenantId: string;
  consentStatus: string;
  consentedAt: string | null;
  revokedAt: string | null;
  adminEmail: string | null;
}

export interface AdPurchasedService {
  id: number;
  serviceName: string;
  status: string;
  billingInterval: string;
  purchasedAt: string;
}

export interface AdDiagnosticRunSummary {
  runId: string;
  packageKey: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AdCustomerDetail {
  customer: AdCustomerProfile;
  owningMsp: AdCustomerOwningMsp | null;
  users: AdCustomerDetailUser[];
  userCount: number;
  graphConsent: AdConsentStatus | null;
  sharePointConsent: AdConsentStatus | null;
  writeConsent: AdConsentStatus | null;
  purchasedServices: AdPurchasedService[];
  recentDiagnosticRuns: AdDiagnosticRunSummary[];
}

// ── User detail (GET /admin/active-directory/user/:id) ───────────────────────

export interface AdUserProfile {
  id: number;
  email: string;
  name: string | null;
  company: string | null;
  phone: string | null;
  baseRole: string;
  createdAt: string;
}

export interface AdUserLinkage {
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

export interface AdUserSessionSummary {
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

export interface AdUserMfaStatus {
  enrolled: boolean;
  methods: Array<{ method: string; createdAt: string }>;
}

export interface AdUserDetail {
  profile: AdUserProfile;
  linkage: AdUserLinkage | null;
  entitlements: AdMspEntitlements | null;
  sessions: AdUserSessionSummary;
  mfa: AdUserMfaStatus;
}

export interface AdEntitlementOverride {
  capabilityKey: string;
  enabled: boolean;
  grantedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdEntitlementsView {
  inherited: AdMspEntitlements | null;
  overrides: AdEntitlementOverride[];
  effective: AdMspEntitlements | null;
}

// ── Write-back consent (GET /admin/customers/:id/write-consent[/start]) ──────
// Git #1672 — rehomed from the archived msp-portal customer-detail.tsx's
// WriteBackConsentCard, the one genuinely admin-scoped piece of that page.

export interface AdWriteConsentStatus {
  tenantId: string | null;
  writeConsent: { consentStatus: string; consentedAt: string | null; revokedAt: string | null } | null;
}

// ── OU (POST/PATCH/DELETE /admin/active-directory/ou) ────────────────────────

export interface AdOu {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
}
