/**
 * account-security-graph.ts — Git #1593.
 *
 * Backing for the three items the (now-retired) Account Security page's own
 * `useAccountSecurityLive.ts` header comment flagged as having no backend:
 * password age, failed-attempts, and device compliance. That page and its hook
 * were deleted wholesale in `f40438cdc` (retiring `artifacts/msp-portal` for the
 * new `artifacts/portal` scaffold, #1485) hours after #1593 was filed, and no
 * `.dc.html` design export exists yet for its replacement — so this module is
 * deliberately backend-only: the "build the endpoints" step of #1485's fixed
 * order (architect -> build the endpoints -> regenerate contract pack ->
 * Design -> wire), ahead of Design producing a page to wire it into.
 *
 * A real, confirmed constraint shapes all three functions: portal users have
 * no verified identity link to an M365 user object (testbed portal users are
 * personal outlook.com/gmail.com addresses, not tenant UPNs — confirmed by
 * direct query against the real `users` table for the testbed tenant). So
 * none of these can be "this specific portal user's own" facts the way MFA
 * enrollment and sessions are on that page — they are necessarily tenant-wide
 * Microsoft 365 facts, sourced from Graph via the tenant's own admin consent.
 *
 * Each function returns a real value when Graph genuinely has one for the
 * tenant, or an honest `available: false` with a specific, evidence-backed
 * `reason` when it does not — never a fabricated value and never a bare
 * "no backend" empty state. All three were verified against the real testbed
 * tenant (mccawsoft2.onmicrosoft.com, c4c814d4-3afe-441e-9145-62461d0a4fd3)
 * before this module was written:
 *
 *   - Password age: `GET /users?$select=lastPasswordChangeDateTime` returned
 *     200 with real data for all 24 users. Buildable for any tenant with
 *     Directory.Read.All consent (already in REQUIRED_MT_SCOPES).
 *   - Failed sign-in attempts: `GET /auditLogs/signIns` 403'd with the
 *     documented `Authentication_RequestFromNonPremiumTenantOrB2CTenant` code
 *     — this tenant has no Entra ID Premium P1/P2 (confirmed via
 *     `subscribedSkus`: only ENTERPRISEPACK/FLOW_FREE/POWER_BI_STANDARD/
 *     Power_Pages_vTrial). `graphFetchForTenant` already classifies this as a
 *     `LicenseGapError` — a real, known SKU limit for THIS tenant, not a
 *     universal limitation of the check itself.
 *   - Device compliance: the tenant's only device-management service plan is
 *     `INTUNE_O365` (the limited Office-apps-only MDM bundled in E3) and it is
 *     `PendingActivation`, not `Success` — no full Intune (`INTUNE_A`) is
 *     present. Checked structurally via `subscribedSkus` rather than relying
 *     on `/deviceManagement/managedDevices`'s error shape (a raw 401/503 with
 *     no documented error code isn't a reliable signature to hard-code).
 *
 * Nothing here is cached or persisted — every call below is cheap (a handful
 * of Graph reads for a tenant this size) and computed live per request, the
 * same live-per-request pattern `getInitialDomainForTenant` (graph.ts) already
 * uses. No new schema/migration was needed for this issue.
 *
 * A fourth signal, `getLocalFailedLoginSignal`, is not a Graph call at all: it
 * closes this same contract pack's §5 citation of `users.failedLoginAttempts`
 * as "column exists, no endpoint exposes it to the owning user yet." That
 * column (plus `lastFailedLoginAt` / `lockedUntil`, all written by every
 * login attempt in routes/auth.ts) is the PORTAL's own login-lockout state —
 * real, already-populated, local data, unrelated to the M365-tenant-wide
 * Graph facts above. Included here so one route answers this page's whole
 * "failed attempts" question, both halves of it.
 */

import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";
import { graphFetchForTenant, ConsentRevokedError, LicenseGapError } from "./graph";

const log = logger.child({ channel: "integration.azure" });

/** Age past which a password is considered stale — 90 days, the common baseline threshold. */
export const PASSWORD_STALE_THRESHOLD_DAYS = 90;

/** The full-Intune service plan name — presence + "Success" provisioning is what
 * makes `/deviceManagement/managedDevices` a real, populated endpoint rather than
 * a tenant that has never enrolled a device. `INTUNE_O365` (bundled in E3) only
 * covers Office mobile app protection, not device compliance state. */
const FULL_INTUNE_SERVICE_PLAN = "INTUNE_A";

export type GraphSignalUnavailableReason =
  | "consent_revoked"
  | "entra_premium_required"
  | "no_intune_license"
  | "error";

export interface GraphSignalUnavailable {
  available: false;
  reason: GraphSignalUnavailableReason;
  /** Customer-safe, specific explanation of why — never a generic "not available". */
  detail: string;
}

export interface PasswordAgeSignal {
  available: true;
  staleThresholdDays: number;
  totalUsers: number;
  staleCount: number;
  /** ISO timestamp of the single oldest `lastPasswordChangeDateTime` seen, or null if none had one. */
  oldestChangeAt: string | null;
}

export interface FailedSignInsSignal {
  available: true;
  /** Count of sign-ins with a non-zero error code in the returned page (Graph's own recency ordering). */
  failedCount: number;
  mostRecentFailureAt: string | null;
}

export interface DeviceComplianceSignal {
  available: true;
  totalDevices: number;
  compliantCount: number;
  noncompliantCount: number;
}

export interface LocalFailedLoginSignal {
  available: true;
  /** users.failed_login_attempts — consecutive bad passwords, reset on success or admin unlock. */
  failedAttempts: number;
  lastFailedLoginAt: string | null;
  /** users.locked_until, only when it is still in the future — a past lockout has already lapsed. */
  lockedUntil: string | null;
}

/**
 * The PORTAL's own login-lockout state for one user — real, already-populated
 * local data (`routes/auth.ts` writes it on every login attempt), not a Graph
 * call. This is the other half of "failed attempts": the contract pack's §5
 * cited `users.failedLoginAttempts` as "column exists, no endpoint exposes it
 * to the owning user yet" — this closes exactly that, and unlike the
 * tenant-wide M365 sign-in signal above, it genuinely is "this specific portal
 * user's own" fact (no identity-link problem — it's this user's own row).
 */
export async function getLocalFailedLoginSignal(userId: number): Promise<LocalFailedLoginSignal | GraphSignalUnavailable> {
  try {
    const [row] = await db
      .select({
        failedLoginAttempts: usersTable.failedLoginAttempts,
        lastFailedLoginAt: usersTable.lastFailedLoginAt,
        lockedUntil: usersTable.lockedUntil,
      })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!row) {
      return { available: false, reason: "error", detail: "No user row found for this account." };
    }

    const lockedUntil = row.lockedUntil && row.lockedUntil.getTime() > Date.now() ? row.lockedUntil.toISOString() : null;

    return {
      available: true,
      failedAttempts: row.failedLoginAttempts,
      lastFailedLoginAt: row.lastFailedLoginAt ? row.lastFailedLoginAt.toISOString() : null,
      lockedUntil,
    };
  } catch (err) {
    log.error({ err, userId }, "getLocalFailedLoginSignal: unexpected error");
    return { available: false, reason: "error", detail: "Unexpected error reading local login-lockout state." };
  }
}

interface GraphUserPasswordRow {
  id: string;
  userPrincipalName: string;
  lastPasswordChangeDateTime?: string | null;
}

interface GraphUsersPage {
  value: GraphUserPasswordRow[];
  "@odata.nextLink"?: string;
}

/** Safety cap on pagination — well beyond any real MSP customer's user count today. */
const MAX_USER_PAGES = 20;

/**
 * Tenant-wide password-age summary via `GET /users?$select=lastPasswordChangeDateTime`.
 * Paginates the full user list (capped at MAX_USER_PAGES pages) and computes the
 * stale count / oldest change across every user Graph returns.
 */
export async function getPasswordAgeSignal(
  tenantId: string,
): Promise<PasswordAgeSignal | GraphSignalUnavailable> {
  try {
    let totalUsers = 0;
    let staleCount = 0;
    let oldestChangeAt: string | null = null;
    const staleThresholdMs = PASSWORD_STALE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
    const now = Date.now();

    let path: string | null =
      "/users?$select=id,userPrincipalName,lastPasswordChangeDateTime&$top=999";
    let pages = 0;

    while (path && pages < MAX_USER_PAGES) {
      const res = await graphFetchForTenant(tenantId, path);
      if (!res.ok) {
        const text = await res.text();
        log.warn({ tenantId, status: res.status, body: text.slice(0, 400) }, "getPasswordAgeSignal: /users call failed");
        return { available: false, reason: "error", detail: `Graph /users returned ${res.status}.` };
      }
      const body = (await res.json()) as GraphUsersPage;
      for (const u of body.value ?? []) {
        totalUsers++;
        if (u.lastPasswordChangeDateTime) {
          if (now - new Date(u.lastPasswordChangeDateTime).getTime() > staleThresholdMs) {
            staleCount++;
          }
          if (!oldestChangeAt || new Date(u.lastPasswordChangeDateTime) < new Date(oldestChangeAt)) {
            oldestChangeAt = u.lastPasswordChangeDateTime;
          }
        }
      }
      // @odata.nextLink is a full URL; graphFetchForTenant only wants the path+query.
      const nextLink = body["@odata.nextLink"];
      path = nextLink ? nextLink.replace(/^https:\/\/graph\.microsoft\.com\/v1\.0/, "") : null;
      pages++;
    }

    return { available: true, staleThresholdDays: PASSWORD_STALE_THRESHOLD_DAYS, totalUsers, staleCount, oldestChangeAt };
  } catch (err) {
    if (err instanceof ConsentRevokedError) {
      return { available: false, reason: "consent_revoked", detail: "Admin consent for this tenant has been revoked or was never granted." };
    }
    if (err instanceof LicenseGapError) {
      return { available: false, reason: "entra_premium_required", detail: `Requires ${err.feature}, which this tenant does not have.` };
    }
    log.error({ err, tenantId }, "getPasswordAgeSignal: unexpected error");
    return { available: false, reason: "error", detail: "Unexpected error reading password-age data from Microsoft Graph." };
  }
}

interface GraphSignIn {
  id: string;
  createdDateTime: string;
  status?: { errorCode?: number };
}

interface GraphSignInsPage {
  value: GraphSignIn[];
}

/**
 * Tenant-wide failed sign-in count via `GET /auditLogs/signIns`. Requires
 * Entra ID Premium P1/P2 — `graphFetchForTenant` throws `LicenseGapError` for
 * the documented `Authentication_RequestFromNonPremiumTenantOrB2CTenant` /
 * `RequestFromNonPremiumTenantOrB2CTenant` codes, which this function reports
 * as the specific `entra_premium_required` reason rather than a generic error.
 * For a tenant that DOES carry the required license, this returns real data.
 */
export async function getFailedSignInsSignal(
  tenantId: string,
): Promise<FailedSignInsSignal | GraphSignalUnavailable> {
  try {
    const res = await graphFetchForTenant(
      tenantId,
      "/auditLogs/signIns?$filter=status/errorCode ne 0&$top=50&$orderby=createdDateTime desc",
    );
    if (!res.ok) {
      const text = await res.text();
      log.warn({ tenantId, status: res.status, body: text.slice(0, 400) }, "getFailedSignInsSignal: /auditLogs/signIns call failed");
      return { available: false, reason: "error", detail: `Graph /auditLogs/signIns returned ${res.status}.` };
    }
    const body = (await res.json()) as GraphSignInsPage;
    const rows = body.value ?? [];
    return {
      available: true,
      failedCount: rows.length,
      mostRecentFailureAt: rows[0]?.createdDateTime ?? null,
    };
  } catch (err) {
    if (err instanceof ConsentRevokedError) {
      return { available: false, reason: "consent_revoked", detail: "Admin consent for this tenant has been revoked or was never granted." };
    }
    if (err instanceof LicenseGapError) {
      return {
        available: false,
        reason: "entra_premium_required",
        detail: `Failed sign-in history requires ${err.feature}, which this tenant does not have.`,
      };
    }
    log.error({ err, tenantId }, "getFailedSignInsSignal: unexpected error");
    return { available: false, reason: "error", detail: "Unexpected error reading sign-in history from Microsoft Graph." };
  }
}

interface GraphServicePlan {
  servicePlanName: string;
  provisioningStatus: string;
}

interface GraphSubscribedSku {
  skuPartNumber: string;
  servicePlans: GraphServicePlan[];
}

interface GraphSubscribedSkusPage {
  value: GraphSubscribedSku[];
}

interface GraphManagedDevice {
  id: string;
  complianceState?: string;
}

interface GraphManagedDevicesPage {
  value: GraphManagedDevice[];
}

/** True only when the tenant has a real, active, full-Intune entitlement — the
 * structural signal `deviceManagement/managedDevices` needs a populated answer
 * rather than an unprovisioned-service error with no reliable error code. */
function hasActiveFullIntune(skus: GraphSubscribedSku[]): boolean {
  return skus.some((sku) =>
    sku.servicePlans.some(
      (sp) => sp.servicePlanName === FULL_INTUNE_SERVICE_PLAN && sp.provisioningStatus === "Success",
    ),
  );
}

/**
 * Tenant-wide device compliance via `GET /deviceManagement/managedDevices`,
 * gated on a real Intune entitlement check first (`subscribedSkus`) rather
 * than trusting `/deviceManagement`'s own error shape — that endpoint returns
 * an undocumented 401/503 for a tenant that has never enrolled a device, with
 * no stable error code to key off, which is not a signature `classifyGraphError`
 * (graph.ts) can be safely extended to recognize generically.
 */
export async function getDeviceComplianceSignal(
  tenantId: string,
): Promise<DeviceComplianceSignal | GraphSignalUnavailable> {
  try {
    const skuRes = await graphFetchForTenant(tenantId, "/subscribedSkus?$select=skuPartNumber,servicePlans");
    if (!skuRes.ok) {
      const text = await skuRes.text();
      log.warn({ tenantId, status: skuRes.status, body: text.slice(0, 400) }, "getDeviceComplianceSignal: /subscribedSkus call failed");
      return { available: false, reason: "error", detail: `Graph /subscribedSkus returned ${skuRes.status}.` };
    }
    const skuBody = (await skuRes.json()) as GraphSubscribedSkusPage;
    if (!hasActiveFullIntune(skuBody.value ?? [])) {
      return {
        available: false,
        reason: "no_intune_license",
        detail:
          "Device compliance requires an active Intune entitlement (e.g. Microsoft 365 Business Premium, EMS, or standalone Intune). This tenant's licensing does not include an active INTUNE_A service plan.",
      };
    }

    const devRes = await graphFetchForTenant(
      tenantId,
      "/deviceManagement/managedDevices?$select=id,complianceState&$top=999",
    );
    if (!devRes.ok) {
      const text = await devRes.text();
      log.warn({ tenantId, status: devRes.status, body: text.slice(0, 400) }, "getDeviceComplianceSignal: /deviceManagement/managedDevices call failed");
      return { available: false, reason: "error", detail: `Graph /deviceManagement/managedDevices returned ${devRes.status}.` };
    }
    const devBody = (await devRes.json()) as GraphManagedDevicesPage;
    const devices = devBody.value ?? [];
    const compliantCount = devices.filter((d) => d.complianceState === "compliant").length;
    return {
      available: true,
      totalDevices: devices.length,
      compliantCount,
      noncompliantCount: devices.length - compliantCount,
    };
  } catch (err) {
    if (err instanceof ConsentRevokedError) {
      return { available: false, reason: "consent_revoked", detail: "Admin consent for this tenant has been revoked or was never granted." };
    }
    if (err instanceof LicenseGapError) {
      return { available: false, reason: "entra_premium_required", detail: `Requires ${err.feature}, which this tenant does not have.` };
    }
    log.error({ err, tenantId }, "getDeviceComplianceSignal: unexpected error");
    return { available: false, reason: "error", detail: "Unexpected error reading device compliance from Microsoft Graph." };
  }
}
