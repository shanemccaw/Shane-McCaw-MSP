/**
 * overshared-items.ts — normalizes a collected `SiteSharingSummary[]` (see
 * `sharepoint-sharing.ts`) into `overshared_items` rows (#1275).
 *
 * One row per (site x grant) — the signed-off granularity. A site with no
 * broad grants and no named grants contributes no row, matching the table's
 * purpose: a register of overshared items, not a full site inventory (the
 * item-count denominator for "N of M sites clean" still lives on
 * `tenant_check_item_details`).
 *
 * Emits rows for BOTH `SiteSharingSummary.grants` (the four broad tenant-wide
 * kinds) and `.namedGrants` (`user`/`guest` individuals resolved off the same
 * payload, #1286 / #1262 follow-up #3) — the latter is what finally populates
 * `principal_upn`, previously always null.
 *
 * `naturalKey` is independent of `runId` — it is the identity a rescan uses
 * to carry `remediationState` forward and a future trend query diffs two
 * runs against. Must match the backfill migration's SQL construction of the
 * same key exactly (`lib/db/migrations/manual/2026-08-25-overshared-items-1275.sql`)
 * so a row collected today and a row backfilled from history resolve to the
 * same identity.
 */

import type { InsertOversharedItem, OversharedItemGrantKind, OversharedItemSeverity } from "@workspace/db";
import type { SiteSharingSummary } from "./sharepoint-sharing";

/** The two check keys `sharepoint-sharing.ts` normalizers can produce. */
export const OVERSHARED_ITEM_CHECK_KEYS = ["compliance:eeeu-site-sharing", "onedrive:overshared-files"] as const;

const SEVERITY_BY_GRANT_KIND: Record<string, OversharedItemSeverity> = {
  anonymous_link: "critical",
  everyone: "high",
  eeeu: "high",
  organization_link: "medium",
  // A directly-named external guest is exactly the exposure this register
  // exists to flag. A directly-named internal user is informational on its
  // own — it only becomes actionable in aggregate ("too many admins"), which
  // the drill-down page computes by counting these rows per site, not here.
  guest: "medium",
  user: "low",
};

function isSiteSharingSummary(v: unknown): v is SiteSharingSummary {
  return typeof v === "object" && v !== null && "siteId" in v && "grants" in v;
}

export function buildOversharedItemNaturalKey(params: {
  tenantId: string;
  checkKey: string;
  siteId: string;
  grantKind: string;
  permissionId: string | null;
  loginName: string | null;
  principal: string | null;
}): string {
  const disambiguator = params.permissionId ?? params.loginName ?? params.principal ?? "";
  return `${params.tenantId}|${params.checkKey}|${params.siteId}|${params.grantKind}|${disambiguator}`;
}

export interface BuildOversharedItemRowsParams {
  runId: string;
  tenantId: string;
  customerId: number | null;
  checkKey: string;
  collectedAt: Date;
  items: unknown[];
}

/**
 * Flattens every site's broad grants into insertable rows. Skips a site with
 * no id (mirrors `normalizeSiteSharing`'s own guard) and any element that
 * isn't shaped like a `SiteSharingSummary` — a differently-shaped detail
 * collection (e.g. a future descent payload) should fail closed here, not
 * emit malformed rows.
 */
export function buildOversharedItemRows(params: BuildOversharedItemRowsParams): InsertOversharedItem[] {
  const rows: InsertOversharedItem[] = [];

  for (const raw of params.items) {
    if (!isSiteSharingSummary(raw)) continue;
    if (!raw.siteId) continue;

    // `namedGrants` is optional on older stored payloads (pre-#1286) — `?? []`
    // means re-reading historical `tenant_check_item_details` rows never throws.
    const allGrants = [...raw.grants, ...(raw.namedGrants ?? [])];

    for (const grant of allGrants) {
      rows.push({
        tenantId: params.tenantId,
        customerId: params.customerId,
        runId: params.runId,
        checkKey: params.checkKey,
        scope: "site",
        siteId: raw.siteId,
        siteName: raw.siteName,
        siteUrl: raw.siteUrl,
        isPersonalSite: raw.isPersonalSite,
        grantKind: grant.kind as OversharedItemGrantKind,
        principalLabel: grant.principal,
        principalUpn: grant.principalUpn ?? null,
        loginName: grant.loginName,
        roles: grant.roles,
        inherited: grant.inherited,
        permissionId: grant.permissionId,
        sharingLevel: raw.highestSharingLevel,
        severity: SEVERITY_BY_GRANT_KIND[grant.kind] ?? "info",
        naturalKey: buildOversharedItemNaturalKey({
          tenantId: params.tenantId,
          checkKey: params.checkKey,
          siteId: raw.siteId,
          grantKind: grant.kind,
          permissionId: grant.permissionId,
          loginName: grant.loginName,
          principal: grant.principal,
        }),
        collectedAt: params.collectedAt,
      });
    }
  }

  return rows;
}
