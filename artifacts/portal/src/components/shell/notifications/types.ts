/**
 * Client-side mirror of the real `notifications` table wire shape returned
 * by `GET /api/portal/notifications` / `.../activity-feed` and pushed over
 * `GET /api/portal/notifications/stream` (SSE) — see
 * `artifacts/api-server/src/routes/notifications.ts`. Apps in this monorepo
 * don't share types across the artifacts/* boundary (CLAUDE.md, "Workspace /
 * monorepo"), so this is typed independently rather than imported from the
 * server package.
 */

/** `portal-deep-links.ts`'s `ResolvedPortalDeepLink` — every row carries one. */
export interface PortalNotificationDeepLink {
  readonly href: string;
  readonly available: boolean;
  readonly label: string;
}

export type PortalNotificationSeverity = "info" | "warning" | "critical";

export interface PortalNotification {
  readonly id: number;
  readonly title: string;
  readonly body: string | null;
  readonly category: string | null;
  readonly severity: PortalNotificationSeverity;
  readonly linkPath: string | null;
  readonly deepLink: PortalNotificationDeepLink;
  readonly feedType: "personal" | "all_activity";
  readonly read: boolean;
  readonly createdAt: string;
}

export type PortalNotificationSseEvent =
  | { type: "notification"; notification: PortalNotification }
  | { type: "unread_count"; unreadCount: number };
