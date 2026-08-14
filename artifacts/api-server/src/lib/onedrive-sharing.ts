/**
 * onedrive-sharing.ts
 *
 * OneDrive overshared files (#680) — zero coverage today. `/sites/getAllSites`
 * models every user's OneDrive as a `site` object with `isPersonalSite: true`
 * (documented in sharepoint-sharing.ts), and `/sites/{itemId}/drive/root/permissions`
 * returns the identical driveItem permission shape for a personal OneDrive drive
 * root as it does for a SharePoint site's drive root — grantedToV2.siteUser /
 * grantedToV2.siteGroup carrying the SharePoint claim in `loginName`, and sharing
 * links arriving as a `link` facet carrying `scope`. Broad-sharing classification
 * is therefore genuinely shared logic, not merely similar, so this module reuses
 * sharepoint-sharing.ts's `summarizeSiteSharing`/`classifySharingPermission`
 * rather than re-deriving the EEEU/Everyone/anonymous-link/organization-link
 * rules a second time (#357's migration explains why each of those four kinds
 * is recognised, and why link.scope "users"/"existingAccess" are not).
 *
 * This module owns only the OneDrive-specific fan-out registration: a distinct
 * normalizer key (personal drives, not sites, are the ones being reported on
 * here) and the one-line "no id" diagnostic, on its own logging binding.
 */

import { logger } from "./logger";
import { summarizeSiteSharing } from "./sharepoint-sharing";

const log = logger.child({ channel: "engine.monitor" });

/**
 * The registry key this module registers under in monitor-executor's code-owned
 * fan-out normalizer table. Stored in `monitor_checks.fan_out_item_normalizer`
 * as an identifier only — never a script — same contract as
 * SHAREPOINT_SITE_SHARING_NORMALIZER and ps_cmdlet_key.
 */
export const ONEDRIVE_DRIVE_SHARING_NORMALIZER = "onedrive:drive-sharing";

/**
 * Fan-out normalizer: collapses one OneDrive's permission list into exactly ONE
 * summary row, so the check's mapping rules count DRIVES (`countTruthy` over
 * `broadAccess`) instead of a flattened bag of permission objects with no owner
 * attached — the same reasoning as sharepoint-sharing.ts's site normalizer.
 *
 * A drive with no broad sharing still emits its row: "we looked at this OneDrive
 * and it is clean" is a different, and necessary, statement from "we never
 * looked".
 */
export function normalizeDriveSharing(site: Record<string, unknown>, permissions: unknown[]): unknown[] {
  const summary = summarizeSiteSharing(site, permissions);
  if (summary.siteId == null) {
    // The enumeration guarantees an id (it is the fan-out key), so this means a
    // reshaped payload, not an ordinary empty tenant.
    log.warn(
      { siteUrl: summary.siteUrl, permissionCount: summary.permissionCount },
      "onedrive-sharing: enumerated OneDrive drive carried no id - dropping its summary row",
    );
    return [];
  }
  return [summary];
}
