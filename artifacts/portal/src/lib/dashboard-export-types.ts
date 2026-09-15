/**
 * Wire types for the Overview/Customer-Home dashboard export + share surface
 * (#4069), against the real, live `dashboard-export.ts` routes:
 *
 *   GET  /api/portal/dashboard/pdf
 *   GET  /api/portal/dashboard/ppt
 *   GET  /api/portal/dashboard/share
 *   POST /api/portal/dashboard/share
 */

/** `GET /api/portal/dashboard/share` response — null when no live link exists. */
export interface WireDashboardShare {
  shareUrl: string;
  expiresAt: string;
  createdAt: string;
}

export interface WireDashboardShareResponse {
  share: WireDashboardShare | null;
}

/** `POST /api/portal/dashboard/share` response — mints/replaces the link. */
export interface WireDashboardShareResult {
  shareUrl: string;
  expiresAt: string;
}

/** `dashboard-export.ts` sends `{ error: "<message>" }` — a bare string. */
export interface ApiErrorBody {
  error?: string;
}
