/**
 * MSP Directory — API client.
 *
 * Every function here takes `adminFetch` (AuthContext's `fetchWithAuth`,
 * surfaced via `useAdminFetch()`) as its first argument rather than importing
 * a hook itself, so both real components (`useAuth()`) and the module-scope
 * ribbon closures (`dirAuthBridge`'s singleton) can call the same client.
 *
 * Every endpoint here is real and already shipped (initiative:
 * active-directory, docs/build-plans/active-directory.md, all 10 phases
 * Done) — this is a new adminv2-shell front end for it, not a new backend.
 */

import type {
  DirAssignableService,
  DirAssignServiceResult,
  DirCustomerDetail,
  DirDiagnosticRunFindingsResponse,
  DirDiagnosticRunSummary,
  DirEntitlementsView,
  DirGroupDetail,
  DirMonitoringPackage,
  DirMonitoringPackageCheckLink,
  DirMspAuditLogPage,
  DirMspDetail,
  DirMspProfile,
  DirOu,
  DirSearchResult,
  DirTree,
  DirUserDetail,
  DirWriteConsentStatus,
  DirectoryGroupRole,
  RbacCapability,
  RbacMappingRow,
  RbacRoleMappingPayload,
  RbacRoleSummary,
  RbacSystem,
} from "./dirTypes";
import type { AssessmentNode } from "../../../components/SimulatorLeftTree";

export type AdminFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `Request failed (${res.status})`);
  }
  return body as T;
}

function postJson(adminFetch: AdminFetch, path: string, body?: unknown) {
  return adminFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
}

function patchJson(adminFetch: AdminFetch, path: string, body: unknown) {
  return adminFetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function fetchDirTree(adminFetch: AdminFetch): Promise<DirTree> {
  const res = await adminFetch("/api/admin/msp-directory/tree");
  return json<DirTree>(res);
}

export async function searchDirDirectory(adminFetch: AdminFetch, q: string): Promise<DirSearchResult> {
  const res = await adminFetch(`/api/admin/msp-directory/search?q=${encodeURIComponent(q)}`);
  return json<DirSearchResult>(res);
}

export async function fetchDirMsp(adminFetch: AdminFetch, id: number): Promise<DirMspDetail> {
  const res = await adminFetch(`/api/admin/msp-directory/msp/${id}`);
  return json<DirMspDetail>(res);
}

export async function fetchDirGroup(adminFetch: AdminFetch, role: DirectoryGroupRole, q = ""): Promise<DirGroupDetail> {
  const qs = q ? `?q=${encodeURIComponent(q)}` : "";
  const res = await adminFetch(`/api/admin/msp-directory/group/${role}${qs}`);
  return json<DirGroupDetail>(res);
}

export async function fetchDirMspAuditLog(adminFetch: AdminFetch, mspId: number, limit = 25): Promise<DirMspAuditLogPage> {
  const res = await adminFetch(`/api/msp/audit?mspId=${mspId}&limit=${limit}`);
  return json<DirMspAuditLogPage>(res);
}

export async function fetchDirCustomer(adminFetch: AdminFetch, id: number): Promise<DirCustomerDetail> {
  const res = await adminFetch(`/api/admin/msp-directory/customer/${id}`);
  return json<DirCustomerDetail>(res);
}

export async function updateDirCustomerBusinessUnit(
  adminFetch: AdminFetch,
  id: number,
  businessUnit: string | null,
): Promise<{ id: number; businessUnit: string | null }> {
  const res = await patchJson(adminFetch, `/api/admin/msp-directory/customer/${id}`, { businessUnit });
  return json(res);
}

/** #4489 — internal-only testbed flag, editable the same way businessUnit is. */
export async function updateDirCustomerTestbed(
  adminFetch: AdminFetch,
  id: number,
  isTestbed: boolean,
): Promise<{ id: number; isTestbed: boolean }> {
  const res = await patchJson(adminFetch, `/api/admin/msp-directory/customer/${id}`, { isTestbed });
  return json(res);
}

/** #4489 — real service catalog for the Package Assignment picker; filter by deliveryType client-side. */
export async function fetchDirAssignableServices(adminFetch: AdminFetch): Promise<DirAssignableService[]> {
  const res = await adminFetch("/api/admin/services");
  return json(res);
}

/** #4489 — manual Monitoring/Retainer package swap. DB-only, no Stripe. */
export async function assignDirCustomerPackage(
  adminFetch: AdminFetch,
  id: number,
  serviceId: number,
): Promise<DirAssignServiceResult> {
  const res = await postJson(adminFetch, `/api/admin/msp-directory/customer/${id}/assign-service`, { serviceId });
  return json(res);
}

export async function fetchDirCustomerDiagnosticRuns(
  adminFetch: AdminFetch,
  id: number,
): Promise<{ recentDiagnosticRuns: DirDiagnosticRunSummary[] }> {
  const res = await adminFetch(`/api/admin/msp-directory/customer/${id}/diagnostics/runs`);
  return json(res);
}

// #371/#374/#379 — one run's real findings, reusing msp-diagnostics.ts's
// existing GET /msp/customers/:customerId/diagnostics/runs/:runId route
// exactly as the legacy ActiveDirectoryCustomerPane.tsx does (requireCapability
// bypasses for PlatformAdmin, same reuse pattern as runDirCustomerDiagnostics).
export async function fetchDirDiagnosticRunFindings(
  adminFetch: AdminFetch,
  customerId: number,
  runId: string,
): Promise<DirDiagnosticRunFindingsResponse> {
  const res = await adminFetch(`/api/msp/customers/${customerId}/diagnostics/runs/${runId}`);
  return json<DirDiagnosticRunFindingsResponse>(res);
}

// #376 — "Remove from scan package". Same two routes the legacy pane's
// handleRemoveClick/removeCheckFromPackage already use.
export async function fetchDirMonitoringPackageChecks(
  adminFetch: AdminFetch,
  packageKey: string,
): Promise<{ checks: DirMonitoringPackageCheckLink[] }> {
  const res = await adminFetch(`/api/admin/monitoring-packages/${encodeURIComponent(packageKey)}/checks`);
  return json(res);
}

export async function setDirMonitoringPackageChecks(
  adminFetch: AdminFetch,
  packageKey: string,
  checkKeys: string[],
): Promise<{ checks: DirMonitoringPackageCheckLink[] }> {
  const res = await adminFetch(`/api/admin/monitoring-packages/${encodeURIComponent(packageKey)}/checks`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ checkKeys }),
  });
  return json(res);
}

/** GET /api/admin/simulator/assessments — used only to run #376's shared-package detection. */
export async function fetchDirSimulatorAssessments(adminFetch: AdminFetch): Promise<{ assessments: AssessmentNode[] }> {
  const res = await adminFetch("/api/admin/simulator/assessments");
  return json(res);
}

export async function fetchDirUser(adminFetch: AdminFetch, id: number): Promise<DirUserDetail> {
  const res = await adminFetch(`/api/admin/msp-directory/user/${id}`);
  return json<DirUserDetail>(res);
}

export async function fetchDirUserEntitlements(adminFetch: AdminFetch, id: number): Promise<DirEntitlementsView> {
  const res = await adminFetch(`/api/admin/msp-directory/user/${id}/entitlements`);
  return json<DirEntitlementsView>(res);
}

// ── User writes (Phases 7/8/9) ────────────────────────────────────────────────

export async function setDirUserRole(adminFetch: AdminFetch, id: number, mspRole: DirectoryGroupRole) {
  const res = await patchJson(adminFetch, `/api/admin/msp-directory/user/${id}/role`, { mspRole });
  return json<{ ok: true; mspRole: string; mspId: number | null; customerId: number | null }>(res);
}

export async function setDirUserAssignment(
  adminFetch: AdminFetch,
  id: number,
  target: { mspId?: number } | { customerId?: number },
) {
  const res = await patchJson(adminFetch, `/api/admin/msp-directory/user/${id}/assignment`, target);
  return json<{ ok: true; mspId: number | null; customerId: number | null }>(res);
}

export async function setDirUserEntitlement(
  adminFetch: AdminFetch,
  id: number,
  capabilityKey: string,
  enabled: boolean | null,
) {
  const res = await patchJson(adminFetch, `/api/admin/msp-directory/user/${id}/entitlements`, {
    capabilityKey,
    enabled,
  });
  return json<DirEntitlementsView>(res);
}

export async function forceDirPasswordReset(adminFetch: AdminFetch, id: number) {
  const res = await postJson(adminFetch, `/api/admin/msp-directory/user/${id}/force-password-reset`);
  return json<{ ok: true; flow: string; revokedSessionCount: number; emailedTo: string }>(res);
}

export async function resetDirUserMfa(adminFetch: AdminFetch, id: number, method?: string) {
  const res = await postJson(adminFetch, `/api/admin/msp-directory/user/${id}/mfa-reset`, method ? { method } : {});
  return json<{ ok: true; clearedMethods: string[]; emailedTo: string }>(res);
}

export interface DirImpersonateResult {
  token: string;
  targetSlug: string | null;
  expiresAt: string;
  user: { id: number; email: string; name: string | null; mspRole: string | null; mspName: string | null };
}

export async function impersonateDirUser(adminFetch: AdminFetch, id: number) {
  const res = await postJson(adminFetch, `/api/admin/msp-directory/user/${id}/impersonate`);
  return json<DirImpersonateResult>(res);
}

/** Dev-environment-only cascading hard delete — the server refuses this outside a non-production environment. */
export async function hardDeleteDirUser(adminFetch: AdminFetch, id: number) {
  const res = await adminFetch(`/api/admin/msp-directory/user/${id}`, { method: "DELETE" });
  if (res.status === 204) return { ok: true as const };
  return json<{ ok: true }>(res);
}

// ── OU CRUD (Phase 5) ──────────────────────────────────────────────────────────

export async function createDirOu(adminFetch: AdminFetch, name: string) {
  const res = await postJson(adminFetch, "/api/admin/active-directory/ou", { name });
  return json<DirOu>(res);
}

export async function renameDirOu(adminFetch: AdminFetch, id: number, name: string) {
  const res = await patchJson(adminFetch, `/api/admin/active-directory/ou/${id}`, { name });
  return json<DirOu>(res);
}

export async function deleteDirOu(adminFetch: AdminFetch, id: number) {
  const res = await adminFetch(`/api/admin/active-directory/ou/${id}`, { method: "DELETE" });
  if (res.status === 204) return { ok: true as const };
  return json<{ ok: true }>(res);
}

// ── MSP writes (msp-admin-settings.ts) ────────────────────────────────────────

export async function createDirMsp(
  adminFetch: AdminFetch,
  input: { name: string; slug: string; domain?: string },
): Promise<DirMspProfile> {
  const res = await postJson(adminFetch, "/api/admin/msps", input);
  return json<DirMspProfile>(res);
}

export async function suspendDirMsp(adminFetch: AdminFetch, mspId: number) {
  const res = await postJson(adminFetch, `/api/admin/msps/${mspId}/suspend`);
  return json<{ ok: true; status: string }>(res);
}

export async function reactivateDirMsp(adminFetch: AdminFetch, mspId: number) {
  const res = await postJson(adminFetch, `/api/admin/msps/${mspId}/reactivate`);
  return json<{ ok: true; status: string }>(res);
}

/**
 * Profile edit — rehomed from the archived msp-portal msps.tsx / msp-detail.tsx
 * edit dialogs (Git #1672). Calls the same real `PATCH /admin/msps/:id`
 * msp-admin-settings.ts already exposed; AD's own Phase 2 canvas had never
 * called it (its doc comment: "no MSP-level edit actions in that phase").
 * `status` is deliberately not editable here — suspend/reactivate above are
 * the only sanctioned way to change it, so the state machine can't be
 * bypassed through a generic PATCH.
 */
export async function updateDirMspProfile(
  adminFetch: AdminFetch,
  mspId: number,
  input: {
    name?: string;
    domain?: string | null;
    isTestbed?: boolean;
    primaryContactName?: string | null;
    primaryContactEmail?: string | null;
    primaryContactPhone?: string | null;
    address?: string | null;
    notes?: string | null;
    entraTenantId?: string | null;
  },
): Promise<DirMspProfile> {
  const res = await patchJson(adminFetch, `/api/admin/msps/${mspId}`, input);
  return json<DirMspProfile>(res);
}

/**
 * MSP-level impersonation — issues a single-use token for that MSP's own
 * MSPAdmin user (admin-impersonation.ts), distinct from `impersonateDirUser`
 * above which impersonates one specific account. Rehomed from the archived
 * "Impersonate Partner" action on both msps.tsx and msp-detail.tsx.
 */
export async function impersonateDirMsp(adminFetch: AdminFetch, mspId: number) {
  const res = await postJson(adminFetch, `/api/admin/msps/${mspId}/impersonate`);
  return json<{ token: string; targetSlug: string; msp: { id: number; name: string; slug: string } }>(res);
}

// ── Tenant consent + scanning (consent.ts / msp-diagnostics.ts) ──────────────

export type ConsentKey = "graph" | "writeBack" | "sharepoint";

export async function revokeDirTenantConsent(adminFetch: AdminFetch, tenantGuid: string, key: ConsentKey = "graph") {
  const res = await patchJson(adminFetch, `/api/admin/consent/${encodeURIComponent(tenantGuid)}/revoke`, { key });
  return json<{ ok: true; tenantId: string; key: ConsentKey }>(res);
}

export async function runDirCustomerDiagnostics(adminFetch: AdminFetch, customerId: number, packageKey?: string) {
  const res = await postJson(adminFetch, `/api/msp/customers/${customerId}/diagnostics/run`, packageKey ? { packageKey } : undefined);
  return json<{ runId: string; status: string; message: string }>(res);
}

/** GET /api/msp/monitoring-packages — the real catalog #1770's picker chooses from. */
export async function fetchDirMonitoringPackages(adminFetch: AdminFetch): Promise<DirMonitoringPackage[]> {
  const res = await adminFetch("/api/msp/monitoring-packages");
  const body = await json<{ packages: DirMonitoringPackage[] }>(res);
  return body.packages;
}

/**
 * GET /api/msp/customers/:customerId/monitoring-package — already shipped
 * (msp-diagnostics.ts:342, née :327 per #1770's own diagnosis) to display the
 * resolved packageKey; reused here client-side to default the picker's
 * selection to the customer's real active subscription, per #1770's scope
 * item 3, without touching the server's resolution chain at all.
 */
export async function fetchDirCustomerMonitoringPackage(
  adminFetch: AdminFetch,
  customerId: number,
): Promise<{ packageKey: string | null; serviceId: number | null; serviceName: string | null }> {
  const res = await adminFetch(`/api/msp/customers/${customerId}/monitoring-package`);
  return json(res);
}

export interface DirConsentInviteLink {
  consentUrl: string;
  token: string;
  expiresAt: string;
  scopes: string[];
}

export async function createDirConsentInviteLink(
  adminFetch: AdminFetch,
  input: { tenantId?: string; customerId?: number },
): Promise<DirConsentInviteLink> {
  const res = await postJson(adminFetch, "/api/consent/invite-link", input);
  return json<DirConsentInviteLink>(res);
}

export interface DirCustomerHardDeleteResult {
  ok: true;
  deletedCustomerId: number;
  deletedCustomerName: string;
  usersDeleted: number;
  tenantOnlyTables: Record<string, number>;
  mspAuditLogsDetached: number;
}

/**
 * Dev-environment-only cascading hard delete of an entire tenant — revokes
 * all three consent grants first, then removes every user under the tenant
 * (the same cascade `hardDeleteDirUser` runs, once per user), then every
 * remaining tenant-scoped table, then the tenant row itself. One transaction
 * server-side; the server refuses this outside a non-production environment,
 * same gate as `hardDeleteDirUser`.
 */
export async function hardDeleteDirCustomer(adminFetch: AdminFetch, id: number): Promise<DirCustomerHardDeleteResult> {
  const res = await adminFetch(`/api/admin/msp-directory/customer/${id}`, { method: "DELETE" });
  return json<DirCustomerHardDeleteResult>(res);
}

// ── Write-back consent (consent.ts) ───────────────────────────────────────────
// Rehomed from the archived msp-portal customer-detail.tsx's WriteBackConsentCard
// (Git #1672) — the one admin-scoped piece of that otherwise MSP-operator page.
// Distinct from the read-only Graph/SharePoint consent above: this is the
// dedicated write-app (MT_APP_WRITE_CLIENT_ID) admin-consent flow, not the
// generic re-consent invite link.

export async function fetchDirCustomerWriteConsent(adminFetch: AdminFetch, customerId: number): Promise<DirWriteConsentStatus> {
  const res = await adminFetch(`/api/admin/customers/${customerId}/write-consent`);
  return json<DirWriteConsentStatus>(res);
}

export async function startDirCustomerWriteConsent(
  adminFetch: AdminFetch,
  customerId: number,
): Promise<{ consentUrl: string; expiresAt: string }> {
  const res = await adminFetch(`/api/admin/customers/${customerId}/write-consent/start`);
  return json<{ consentUrl: string; expiresAt: string }>(res);
}

// ── RBAC (#2461, part of #1696) ───────────────────────────────────────────────
// Manages the roles/user_roles/feature_role_mapping tables #2455 landed —
// additive alongside the DirectoryGroupRole ladder writes above. See
// dirTypes.ts's RBAC section header for why this is a separate surface rather
// than a replacement for setDirUserRole.

function orgQuery(orgId: number | null): string {
  return orgId == null ? "" : `&orgId=${orgId}`;
}

export async function fetchDirRbacCapabilities(adminFetch: AdminFetch, system: RbacSystem): Promise<RbacCapability[]> {
  const res = await adminFetch(`/api/admin/rbac/capabilities?system=${system}`);
  const body = await json<{ capabilities: RbacCapability[] }>(res);
  return body.capabilities;
}

export async function fetchDirRbacRoles(adminFetch: AdminFetch, system: RbacSystem, orgId: number | null): Promise<RbacRoleSummary[]> {
  const res = await adminFetch(`/api/admin/rbac/roles?system=${system}${orgQuery(orgId)}`);
  const body = await json<{ roles: RbacRoleSummary[] }>(res);
  return body.roles;
}

export async function createDirRbacRole(
  adminFetch: AdminFetch,
  input: { system: RbacSystem; orgId: number | null; key: string; name: string; description?: string },
): Promise<RbacRoleSummary> {
  const res = await postJson(adminFetch, "/api/admin/rbac/roles", input);
  const body = await json<{ role: RbacRoleSummary }>(res);
  return body.role;
}

export async function renameDirRbacRole(
  adminFetch: AdminFetch,
  roleId: string,
  input: { system: RbacSystem; name?: string; description?: string },
): Promise<RbacRoleSummary> {
  const res = await patchJson(adminFetch, `/api/admin/rbac/roles/${roleId}`, input);
  const body = await json<{ role: RbacRoleSummary }>(res);
  return body.role;
}

export async function deleteDirRbacRole(adminFetch: AdminFetch, roleId: string, system: RbacSystem): Promise<{ ok: true }> {
  const res = await adminFetch(`/api/admin/rbac/roles/${roleId}?system=${system}`, { method: "DELETE" });
  if (res.status === 204) return { ok: true };
  return json<{ ok: true }>(res);
}

export async function fetchDirUserRbacRoles(
  adminFetch: AdminFetch,
  userId: number,
  system: RbacSystem,
): Promise<{ roles: RbacRoleSummary[]; orgId: number | null }> {
  const res = await adminFetch(`/api/admin/rbac/user/${userId}/roles?system=${system}`);
  return json(res);
}

export async function grantDirUserRbacRole(
  adminFetch: AdminFetch,
  userId: number,
  system: RbacSystem,
  roleId: string,
): Promise<{ roles: RbacRoleSummary[] }> {
  const res = await postJson(adminFetch, `/api/admin/rbac/user/${userId}/roles`, { system, roleId });
  return json(res);
}

export async function revokeDirUserRbacRole(
  adminFetch: AdminFetch,
  userId: number,
  system: RbacSystem,
  roleId: string,
): Promise<{ roles: RbacRoleSummary[] }> {
  const res = await adminFetch(`/api/admin/rbac/user/${userId}/roles/${roleId}?system=${system}`, { method: "DELETE" });
  return json(res);
}

export async function fetchDirRbacMappings(adminFetch: AdminFetch, system: RbacSystem, orgId: number | null): Promise<RbacMappingRow[]> {
  const res = await adminFetch(`/api/admin/rbac/mappings?system=${system}${orgQuery(orgId)}`);
  const body = await json<{ mappings: RbacMappingRow[] }>(res);
  return body.mappings;
}

export async function setDirRbacMapping(
  adminFetch: AdminFetch,
  input: { system: RbacSystem; orgId: number | null; capabilityKey: string; allow: string[]; deny: string[] },
): Promise<RbacRoleMappingPayload> {
  const res = await adminFetch("/api/admin/rbac/mapping", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = await json<{ roles: RbacRoleMappingPayload }>(res);
  return body.roles;
}
