/**
 * Active Directory — API client.
 *
 * Every function here takes `adminFetch` (AuthContext's `fetchWithAuth`,
 * surfaced via `useAdminFetch()`) as its first argument rather than importing
 * a hook itself, so both real components (`useAuth()`) and the module-scope
 * ribbon closures (`adAuthBridge`'s singleton) can call the same client.
 *
 * Every endpoint here is real and already shipped (initiative:
 * active-directory, docs/build-plans/active-directory.md, all 10 phases
 * Done) — this is a new adminv2-shell front end for it, not a new backend.
 */

import type {
  AdCustomerDetail,
  AdDiagnosticRunSummary,
  AdEntitlementsView,
  AdGroupDetail,
  AdMspDetail,
  AdMspProfile,
  AdOu,
  AdSearchResult,
  AdTree,
  AdUserDetail,
  AdWriteConsentStatus,
  DirectoryGroupRole,
} from "./adTypes";

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

export async function fetchAdTree(adminFetch: AdminFetch): Promise<AdTree> {
  const res = await adminFetch("/api/admin/active-directory/tree");
  return json<AdTree>(res);
}

export async function searchAdDirectory(adminFetch: AdminFetch, q: string): Promise<AdSearchResult> {
  const res = await adminFetch(`/api/admin/active-directory/search?q=${encodeURIComponent(q)}`);
  return json<AdSearchResult>(res);
}

export async function fetchAdMsp(adminFetch: AdminFetch, id: number): Promise<AdMspDetail> {
  const res = await adminFetch(`/api/admin/active-directory/msp/${id}`);
  return json<AdMspDetail>(res);
}

export async function fetchAdGroup(adminFetch: AdminFetch, role: DirectoryGroupRole, q = ""): Promise<AdGroupDetail> {
  const qs = q ? `?q=${encodeURIComponent(q)}` : "";
  const res = await adminFetch(`/api/admin/active-directory/group/${role}${qs}`);
  return json<AdGroupDetail>(res);
}

export async function fetchAdCustomer(adminFetch: AdminFetch, id: number): Promise<AdCustomerDetail> {
  const res = await adminFetch(`/api/admin/active-directory/customer/${id}`);
  return json<AdCustomerDetail>(res);
}

export async function updateAdCustomerBusinessUnit(
  adminFetch: AdminFetch,
  id: number,
  businessUnit: string | null,
): Promise<{ id: number; businessUnit: string | null }> {
  const res = await patchJson(adminFetch, `/api/admin/active-directory/customer/${id}`, { businessUnit });
  return json(res);
}

export async function fetchAdCustomerDiagnosticRuns(
  adminFetch: AdminFetch,
  id: number,
): Promise<{ recentDiagnosticRuns: AdDiagnosticRunSummary[] }> {
  const res = await adminFetch(`/api/admin/active-directory/customer/${id}/diagnostics/runs`);
  return json(res);
}

export async function fetchAdUser(adminFetch: AdminFetch, id: number): Promise<AdUserDetail> {
  const res = await adminFetch(`/api/admin/active-directory/user/${id}`);
  return json<AdUserDetail>(res);
}

export async function fetchAdUserEntitlements(adminFetch: AdminFetch, id: number): Promise<AdEntitlementsView> {
  const res = await adminFetch(`/api/admin/active-directory/user/${id}/entitlements`);
  return json<AdEntitlementsView>(res);
}

// ── User writes (Phases 7/8/9) ────────────────────────────────────────────────

export async function setAdUserRole(adminFetch: AdminFetch, id: number, mspRole: DirectoryGroupRole) {
  const res = await patchJson(adminFetch, `/api/admin/active-directory/user/${id}/role`, { mspRole });
  return json<{ ok: true; mspRole: string; mspId: number | null; customerId: number | null }>(res);
}

export async function setAdUserAssignment(
  adminFetch: AdminFetch,
  id: number,
  target: { mspId?: number } | { customerId?: number },
) {
  const res = await patchJson(adminFetch, `/api/admin/active-directory/user/${id}/assignment`, target);
  return json<{ ok: true; mspId: number | null; customerId: number | null }>(res);
}

export async function setAdUserEntitlement(
  adminFetch: AdminFetch,
  id: number,
  capabilityKey: string,
  enabled: boolean | null,
) {
  const res = await patchJson(adminFetch, `/api/admin/active-directory/user/${id}/entitlements`, {
    capabilityKey,
    enabled,
  });
  return json<AdEntitlementsView>(res);
}

export async function forceAdPasswordReset(adminFetch: AdminFetch, id: number) {
  const res = await postJson(adminFetch, `/api/admin/active-directory/user/${id}/force-password-reset`);
  return json<{ ok: true; flow: string; revokedSessionCount: number; emailedTo: string }>(res);
}

export async function resetAdUserMfa(adminFetch: AdminFetch, id: number, method?: string) {
  const res = await postJson(adminFetch, `/api/admin/active-directory/user/${id}/mfa-reset`, method ? { method } : {});
  return json<{ ok: true; clearedMethods: string[]; emailedTo: string }>(res);
}

export interface AdImpersonateResult {
  token: string;
  targetSlug: string | null;
  expiresAt: string;
  user: { id: number; email: string; name: string | null; mspRole: string | null; mspName: string | null };
}

export async function impersonateAdUser(adminFetch: AdminFetch, id: number) {
  const res = await postJson(adminFetch, `/api/admin/active-directory/user/${id}/impersonate`);
  return json<AdImpersonateResult>(res);
}

/** Dev-environment-only cascading hard delete — the server refuses this outside a non-production environment. */
export async function hardDeleteAdUser(adminFetch: AdminFetch, id: number) {
  const res = await adminFetch(`/api/admin/active-directory/user/${id}`, { method: "DELETE" });
  if (res.status === 204) return { ok: true as const };
  return json<{ ok: true }>(res);
}

// ── OU CRUD (Phase 5) ──────────────────────────────────────────────────────────

export async function createAdOu(adminFetch: AdminFetch, name: string) {
  const res = await postJson(adminFetch, "/api/admin/active-directory/ou", { name });
  return json<AdOu>(res);
}

export async function renameAdOu(adminFetch: AdminFetch, id: number, name: string) {
  const res = await patchJson(adminFetch, `/api/admin/active-directory/ou/${id}`, { name });
  return json<AdOu>(res);
}

export async function deleteAdOu(adminFetch: AdminFetch, id: number) {
  const res = await adminFetch(`/api/admin/active-directory/ou/${id}`, { method: "DELETE" });
  if (res.status === 204) return { ok: true as const };
  return json<{ ok: true }>(res);
}

// ── MSP writes (msp-admin-settings.ts) ────────────────────────────────────────

export async function createAdMsp(
  adminFetch: AdminFetch,
  input: { name: string; slug: string; domain?: string },
): Promise<AdMspProfile> {
  const res = await postJson(adminFetch, "/api/admin/msps", input);
  return json<AdMspProfile>(res);
}

export async function suspendAdMsp(adminFetch: AdminFetch, mspId: number) {
  const res = await postJson(adminFetch, `/api/admin/msps/${mspId}/suspend`);
  return json<{ ok: true; status: string }>(res);
}

export async function reactivateAdMsp(adminFetch: AdminFetch, mspId: number) {
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
export async function updateAdMspProfile(
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
  },
): Promise<AdMspProfile> {
  const res = await patchJson(adminFetch, `/api/admin/msps/${mspId}`, input);
  return json<AdMspProfile>(res);
}

/**
 * MSP-level impersonation — issues a single-use token for that MSP's own
 * MSPAdmin user (admin-impersonation.ts), distinct from `impersonateAdUser`
 * above which impersonates one specific account. Rehomed from the archived
 * "Impersonate Partner" action on both msps.tsx and msp-detail.tsx.
 */
export async function impersonateAdMsp(adminFetch: AdminFetch, mspId: number) {
  const res = await postJson(adminFetch, `/api/admin/msps/${mspId}/impersonate`);
  return json<{ token: string; targetSlug: string; msp: { id: number; name: string; slug: string } }>(res);
}

// ── Tenant consent + scanning (consent.ts / msp-diagnostics.ts) ──────────────

export type ConsentKey = "graph" | "writeBack" | "sharepoint";

export async function revokeAdTenantConsent(adminFetch: AdminFetch, tenantGuid: string, key: ConsentKey = "graph") {
  const res = await patchJson(adminFetch, `/api/admin/consent/${encodeURIComponent(tenantGuid)}/revoke`, { key });
  return json<{ ok: true; tenantId: string; key: ConsentKey }>(res);
}

export async function runAdCustomerDiagnostics(adminFetch: AdminFetch, customerId: number) {
  const res = await postJson(adminFetch, `/api/msp/customers/${customerId}/diagnostics/run`);
  return json<{ runId: string; status: string; message: string }>(res);
}

export interface AdConsentInviteLink {
  consentUrl: string;
  token: string;
  expiresAt: string;
  scopes: string[];
}

export async function createAdConsentInviteLink(
  adminFetch: AdminFetch,
  input: { tenantId?: string; customerId?: number },
): Promise<AdConsentInviteLink> {
  const res = await postJson(adminFetch, "/api/consent/invite-link", input);
  return json<AdConsentInviteLink>(res);
}

export interface AdCustomerHardDeleteResult {
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
 * (the same cascade `hardDeleteAdUser` runs, once per user), then every
 * remaining tenant-scoped table, then the tenant row itself. One transaction
 * server-side; the server refuses this outside a non-production environment,
 * same gate as `hardDeleteAdUser`.
 */
export async function hardDeleteAdCustomer(adminFetch: AdminFetch, id: number): Promise<AdCustomerHardDeleteResult> {
  const res = await adminFetch(`/api/admin/active-directory/customer/${id}`, { method: "DELETE" });
  return json<AdCustomerHardDeleteResult>(res);
}

// ── Write-back consent (consent.ts) ───────────────────────────────────────────
// Rehomed from the archived msp-portal customer-detail.tsx's WriteBackConsentCard
// (Git #1672) — the one admin-scoped piece of that otherwise MSP-operator page.
// Distinct from the read-only Graph/SharePoint consent above: this is the
// dedicated write-app (MT_APP_WRITE_CLIENT_ID) admin-consent flow, not the
// generic re-consent invite link.

export async function fetchAdCustomerWriteConsent(adminFetch: AdminFetch, customerId: number): Promise<AdWriteConsentStatus> {
  const res = await adminFetch(`/api/admin/customers/${customerId}/write-consent`);
  return json<AdWriteConsentStatus>(res);
}

export async function startAdCustomerWriteConsent(
  adminFetch: AdminFetch,
  customerId: number,
): Promise<{ consentUrl: string; expiresAt: string }> {
  const res = await adminFetch(`/api/admin/customers/${customerId}/write-consent/start`);
  return json<{ consentUrl: string; expiresAt: string }>(res);
}
