/**
 * license-assignment-snapshots.ts — normalizes a collected `license:unused-assigned`
 * item list (real Graph `/users?$select=id,accountEnabled,assignedLicenses,signInActivity`
 * pages) into `license_assignment_snapshots` rows (#1291, licence-change detector
 * for #1278's `billing.license_change` condition).
 *
 * One row per (user x SKU) — mirrors overshared-items.ts's granularity decision.
 * `naturalKey` is independent of `runId` — the identity a run-to-run diff
 * (customer-tenant-alert-engine.ts's evalLicenseChange) joins two snapshots
 * against to find added/removed assignments.
 */

import type { InsertLicenseAssignmentSnapshot } from "@workspace/db";

/** The real monitor_checks key this collector's item list is sourced from. */
export const LICENSE_ASSIGNMENT_CHECK_KEY = "license:unused-assigned";

interface RawAssignedLicense {
  skuId?: unknown;
}

interface RawLicenseUser {
  id?: unknown;
  accountEnabled?: unknown;
  assignedLicenses?: unknown;
}

function isLicenseUser(v: unknown): v is RawLicenseUser {
  return typeof v === "object" && v !== null && "id" in v;
}

export function buildLicenseAssignmentNaturalKey(params: {
  tenantId: string;
  userId: string;
  skuId: string;
}): string {
  return `${params.tenantId}|${params.userId}|${params.skuId}`;
}

export interface BuildLicenseAssignmentSnapshotRowsParams {
  runId: string;
  tenantId: string;
  customerId: number | null;
  checkKey: string;
  collectedAt: Date;
  items: unknown[];
}

/**
 * Flattens every user's `assignedLicenses[]` into insertable rows. Skips a
 * user with no usable `id` (mirrors buildOversharedItemRows's own guard) and
 * any `skuId` that isn't a non-empty string. A user with zero assigned
 * licences contributes no row.
 */
export function buildLicenseAssignmentSnapshotRows(
  params: BuildLicenseAssignmentSnapshotRowsParams,
): InsertLicenseAssignmentSnapshot[] {
  const rows: InsertLicenseAssignmentSnapshot[] = [];

  for (const raw of params.items) {
    if (!isLicenseUser(raw)) continue;
    const userId = typeof raw.id === "string" ? raw.id : null;
    if (!userId) continue;

    const licenses = Array.isArray(raw.assignedLicenses) ? (raw.assignedLicenses as RawAssignedLicense[]) : [];
    const accountEnabled = typeof raw.accountEnabled === "boolean" ? raw.accountEnabled : null;

    for (const license of licenses) {
      const skuId = typeof license?.skuId === "string" && license.skuId.length > 0 ? license.skuId : null;
      if (!skuId) continue;

      rows.push({
        tenantId: params.tenantId,
        customerId: params.customerId,
        runId: params.runId,
        checkKey: params.checkKey,
        userId,
        accountEnabled,
        skuId,
        naturalKey: buildLicenseAssignmentNaturalKey({ tenantId: params.tenantId, userId, skuId }),
        collectedAt: params.collectedAt,
      });
    }
  }

  return rows;
}
