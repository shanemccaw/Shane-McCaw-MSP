/**
 * Every network call the Shared Links screen makes — `admin-quick-win.ts`.
 * The list route already existed (backing `pages/crm/DiagnosticShares.tsx`);
 * `revoke`/`extend` are new, added alongside this screen since the admin
 * side previously had no mutation on this table at all. Same `ApiError`/
 * `readJson` shape as `servicesApi.ts`/`fulfillmentApi.ts`, so the server's
 * own error text surfaces rather than a generic one.
 */

import { parseShare, type Share } from "./sharedLinksTypes";

export type AdminFetch = (path: string, init?: RequestInit) => Promise<Response>;

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const message =
      body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : fallback;
    throw new ApiError(res.status, message);
  }
  return body as T;
}

function json(adminFetch: AdminFetch, path: string, method: string, payload?: unknown): Promise<Response> {
  return adminFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload ?? {}),
  });
}

/** `GET /api/admin/quick-win/result-shares`. */
export async function listShares(adminFetch: AdminFetch): Promise<Share[]> {
  const res = await adminFetch("/api/admin/quick-win/result-shares");
  const data = await readJson<{ shares: unknown[] }>(res, "Failed to load shared links");
  return Array.isArray(data.shares) ? data.shares.map((r) => parseShare(r as Record<string, unknown>)) : [];
}

/** `POST /api/admin/quick-win/result-shares/:id/revoke` — expires it immediately. */
export async function revokeShare(adminFetch: AdminFetch, id: number): Promise<{ expiresAt: string }> {
  const res = await json(adminFetch, `/api/admin/quick-win/result-shares/${id}/revoke`, "POST");
  return readJson<{ id: number; expiresAt: string }>(res, "Failed to revoke the share");
}

/** `POST /api/admin/quick-win/result-shares/:id/extend` — pushes `expiresAt` out by `days` (default 14). */
export async function extendShare(adminFetch: AdminFetch, id: number, days = 14): Promise<{ expiresAt: string }> {
  const res = await json(adminFetch, `/api/admin/quick-win/result-shares/${id}/extend`, "POST", { days });
  return readJson<{ id: number; expiresAt: string }>(res, "Failed to extend the share");
}
